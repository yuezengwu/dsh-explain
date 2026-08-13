import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ExplainRuntimeSettings } from './config.ts'
import { compactOnce, CompactionError } from './compactor.ts'
import type { LeaseToken, ManualExplainTarget, RephraseTarget, SourceCapsule } from './domain.ts'
import {
  estimateAuxiliaryRequest,
  ExplainRouteError,
  renderExplainRequest,
  renderManualExplainRequest,
  renderRephraseRequest,
  resolveExplainRoute,
  runAuxiliaryRequest,
  type AuxiliaryRequest,
  type ExplainRoute,
} from './explainer.ts'
import { CandidateQueue, type ExplainCandidate } from './queue.ts'
import { SourceSummaryError, type ExplainStore } from './store.ts'
import type { ThreadEntryView } from './types.ts'

const LEASE_RENEW_MS = 5_000
const LEASE_TTL_MS = 15_000

/** Mutable runtime facts projected by the typed status Remote. */
export interface SchedulerStatus {
  readonly state: 'disabled' | 'ready' | 'failed'
  readonly pendingCandidates: number
  readonly route?: ExplainRoute
  readonly estimatedContextRatio?: number
  readonly lastError?: { readonly code: string; readonly message: string }
}

/** Stable settlement returned to the explicit `/explain <request>` command. */
export type ManualExplainResult =
  | { readonly ok: true; readonly entry: ThreadEntryView }
  | {
      readonly ok: false
      readonly error: {
        readonly code:
          | 'EXPLAIN_DISABLED'
          | 'EXPLAIN_RUNTIME_FAILED'
          | 'EXPLAIN_SOURCE_BUSY'
          | 'EXPLAIN_TOPIC_ACTIVE'
          | 'EXPLAIN_REQUEST_CANCELLED'
          | 'EXPLAIN_MANUAL_FAILED'
          | 'EXPLAIN_COMPACTION_FAILED'
          | 'EXPLAIN_COMPACTION_STALE'
          | 'EXPLAIN_CONTEXT_PRESSURE_UNRESOLVED'
        readonly message: string
      }
    }

interface ManualJob {
  readonly target: ManualExplainTarget
  readonly signal: AbortSignal
  readonly settle: (result: ManualExplainResult) => void
}

/** Single-flight owner for autonomous explanations, rephrases, and compaction. */
export class ExplainScheduler {
  private settings: ExplainRuntimeSettings
  private readonly queue = new CandidateQueue()
  private readonly lease: LeaseToken
  private readonly logger
  private epoch = 0
  private controller: AbortController | undefined
  private draining: Promise<void> | undefined
  private route: ExplainRoute | undefined
  private failed: SchedulerStatus['lastError'] | undefined
  private operationError: SchedulerStatus['lastError'] | undefined
  private estimatedContextRatio: number | undefined
  private budgetTimer: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private routeRefresh: Promise<void> | undefined
  private idleAttempted: string | undefined
  private readonly failedRephrases = new Set<string>()
  private readonly manualQueue: ManualJob[] = []
  private activeManual: ManualJob | undefined
  private controllerKind: 'auto' | 'rephrase' | 'manual' | 'idle' | undefined
  private started = false
  private stopped = false

  constructor(
    private readonly ctx: Context,
    private readonly store: ExplainStore,
    initial: ExplainRuntimeSettings,
  ) {
    this.settings = initial
    this.logger = ctx.logger('dsh-explain')
    this.lease = store.acquireLease(randomUUID(), Date.now(), LEASE_TTL_MS)
  }

  /** Validate initial configuration, start lease renewal, and restore persistent work. */
  async start(): Promise<void> {
    this.started = true
    this.heartbeat = setInterval(() => { this.renewLease() }, LEASE_RENEW_MS)
    if (this.settings.enabled) await this.refreshRoute()
    else this.scheduleIdle()
  }

  /** Current queue, route, pressure, and safe failure projection. */
  status(): SchedulerStatus {
    const lastError = this.failed ?? this.operationError
    return {
      state: this.failed !== undefined ? 'failed' : this.settings.enabled ? 'ready' : 'disabled',
      pendingCandidates: this.queue.size,
      ...(this.route === undefined ? {} : { route: this.route }),
      ...(this.estimatedContextRatio === undefined ? {} : { estimatedContextRatio: this.estimatedContextRatio }),
      ...(lastError === undefined ? {} : { lastError }),
    }
  }

  /** Capture the current semantic generation for deferred source observation. */
  generation(): number { return this.epoch }

  /** Admit a deferred candidate only while its captured runtime generation is still current. */
  acceptsGeneration(generation: number): boolean {
    return generation === this.epoch && this.settings.enabled && this.failed === undefined && !this.stopped
  }

  /** Re-resolve the configured route after an adapter registration or disposal. */
  adaptersUpdated(): void {
    if (!this.started || this.stopped || !this.settings.enabled) return
    void this.refreshRoute().catch((error: unknown) => { this.fail(error) })
  }

  /** Accept one already-bounded turn without blocking its session event dispatch. */
  enqueue(capsule: SourceCapsule): void {
    if (!this.settings.enabled || this.failed !== undefined || this.stopped) return
    const evicted = this.queue.push(capsule, this.settings.maxPendingCandidates)
    if (evicted !== undefined) this.logger.debug('evicted oldest autonomous candidate from %s', evicted.capsule.sourceSessionId)
    this.store.notifyRuntimeChange()
    this.kick()
  }

  /** Queue one explicit request ahead of background work without consuming autonomous budget. */
  requestManual(target: ManualExplainTarget, signal: AbortSignal): Promise<ManualExplainResult> {
    if (signal.aborted) return Promise.resolve(manualFailure(
      'EXPLAIN_REQUEST_CANCELLED', 'The explanation request was cancelled.',
    ))
    if (!this.settings.enabled) return Promise.resolve(manualFailure(
      'EXPLAIN_DISABLED', 'Learning mode is disabled.',
    ))
    if (this.failed !== undefined || this.route === undefined || this.stopped) return Promise.resolve(manualFailure(
      'EXPLAIN_RUNTIME_FAILED', 'The learning runtime is not ready.',
    ))
    const source = target.capsule.sourceSessionId
    if (this.store.activeSources().has(source)
      || this.activeManual?.target.capsule.sourceSessionId === source
      || this.manualQueue.some(job => job.target.capsule.sourceSessionId === source)) {
      return Promise.resolve(manualFailure(
        'EXPLAIN_SOURCE_BUSY', 'This Session already has an active or pending explanation.',
      ))
    }
    return new Promise((resolve) => {
      let settled = false
      const job: ManualJob = {
        target,
        signal,
        settle: (result) => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          resolve(result)
        },
      }
      const onAbort = (): void => {
        const index = this.manualQueue.indexOf(job)
        if (index !== -1) {
          this.manualQueue.splice(index, 1)
          job.settle(manualFailure('EXPLAIN_REQUEST_CANCELLED', 'The explanation request was cancelled.'))
          this.store.notifyRuntimeChange()
        }
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.manualQueue.push(job)
      if (this.controllerKind === 'auto' || this.controllerKind === 'idle') {
        this.controller?.abort(new Error('dsh-explain: explicit explanation takes priority'))
      }
      this.store.notifyRuntimeChange()
      this.kick()
    })
  }

  /** Apply a resolved settings snapshot; model-semantic changes fence in-flight work. */
  async configure(next: ExplainRuntimeSettings, previous = this.settings): Promise<void> {
    if (this.stopped) return
    this.settings = next
    const evicted = this.queue.trim(next.maxPendingCandidates)
    if (evicted.length > 0) this.logger.debug('evicted %d autonomous candidates after queue limit changed', evicted.length)
    const semanticChange = previous.enabled !== next.enabled
      || previous.provider !== next.provider || previous.model !== next.model
      || previous.maxSourceChars !== next.maxSourceChars
      || previous.maxTopicHints !== next.maxTopicHints
      || previous.maxOutputTokens !== next.maxOutputTokens
      || previous.maxCompactionOutputTokens !== next.maxCompactionOutputTokens
      || previous.contextThresholdRatio !== next.contextThresholdRatio
    if (semanticChange) {
      this.cancelCurrent()
      this.settleQueuedManual(next.enabled
        ? manualFailure('EXPLAIN_RUNTIME_FAILED', 'The learning runtime changed before the explanation started.')
        : manualFailure('EXPLAIN_DISABLED', 'Learning mode is disabled.'))
    }
    if (previous.maxSourceChars !== next.maxSourceChars) this.queue.clear()
    this.operationError = undefined
    if (!next.enabled) {
      this.route = undefined
      this.failed = undefined
      this.queue.clear()
      this.settleQueuedManual(manualFailure('EXPLAIN_DISABLED', 'Learning mode is disabled.'))
      this.clearTimers()
      this.store.notifyRuntimeChange()
      return
    }
    const routeChanged = !previous.enabled || previous.provider !== next.provider || previous.model !== next.model
    if (routeChanged || this.route === undefined) await this.refreshRoute()
    else {
      this.store.notifyRuntimeChange()
      this.scheduleIdle()
      this.kick()
    }
  }

  /** Fence model work after any accepted feedback/reopen and schedule resulting tasks. */
  learningStateChanged(rephrase?: { readonly explanationId: string; readonly revision: number }): void {
    this.cancelCurrent()
    this.operationError = undefined
    if (rephrase !== undefined) this.failedRephrases.delete(rephraseKey(rephrase.explanationId, rephrase.revision))
    this.idleAttempted = undefined
    this.scheduleIdle()
    this.kick()
  }

  /** Stop timers, abort the one request, release the lease, and await quiescence. */
  async dispose(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.cancelCurrent()
    this.settleQueuedManual(manualFailure('EXPLAIN_RUNTIME_FAILED', 'The learning runtime stopped.'))
    this.clearTimers()
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    await Promise.allSettled(this.draining === undefined ? [] : [this.draining])
    this.store.releaseLease(this.lease)
  }

  private refreshRoute(): Promise<void> {
    this.cancelCurrent()
    if (this.routeRefresh !== undefined) return this.routeRefresh
    const task = this.refreshRouteUntilCurrent().finally(() => {
      if (this.routeRefresh === task) this.routeRefresh = undefined
    })
    this.routeRefresh = task
    return task
  }

  private async refreshRouteUntilCurrent(): Promise<void> {
    while (this.settings.enabled && !this.stopped) {
      const epoch = this.epoch
      try {
        const route = await resolveExplainRoute(this.ctx, this.settings)
        if (epoch !== this.epoch) continue
        this.route = route
        this.failed = undefined
        this.store.notifyRuntimeChange()
        this.scheduleIdle()
        this.kick()
        return
      } catch (error) {
        if (epoch !== this.epoch) continue
        this.route = undefined
        this.fail(error)
        return
      }
    }
  }

  private kick(): void {
    if (this.draining !== undefined || this.stopped || !this.settings.enabled || this.failed !== undefined) return
    const task = this.drain().finally(() => {
      if (this.draining === task) this.draining = undefined
      if (!this.stopped && this.settings.enabled && this.failed === undefined && this.hasImmediateWork()) this.kick()
    })
    this.draining = task
  }

  private async drain(): Promise<void> {
    while (!this.stopped && this.settings.enabled && this.failed === undefined) {
      const manual = this.manualQueue.shift()
      if (manual !== undefined) {
        await this.runManual(manual)
        continue
      }
      const rephrase = this.nextRephrase()
      if (rephrase !== undefined) {
        await this.runRephrase(rephrase)
        continue
      }
      const budget = this.store.autoBudget(this.settings.maxAutoRequestsPerDay)
      if (budget.used >= this.settings.maxAutoRequestsPerDay) {
        this.armBudget(budget.resumeAt)
      } else {
        const candidate = this.queue.take(this.store.activeSources())
        if (candidate !== undefined) {
          await this.runCandidate(candidate)
          continue
        }
      }
      if (this.idleDue()) {
        await this.runIdleCompaction()
        continue
      }
      this.scheduleIdle()
      return
    }
  }

  private async runCandidate(candidate: ExplainCandidate): Promise<void> {
    const route = this.mustRoute()
    const budget = this.store.autoBudget(this.settings.maxAutoRequestsPerDay)
    if (budget.used >= this.settings.maxAutoRequestsPerDay) {
      this.queue.defer(candidate)
      this.armBudget(budget.resumeAt)
      return
    }
    const epoch = this.epoch
    const controller = this.beginRequest('auto')
    let finished = false
    try {
      let context = this.store.auxiliaryContext(this.settings.maxTopicHints)
      let request = renderExplainRequest(context, candidate.capsule, this.settings.maxOutputTokens)
      ;({ context, request } = await this.relievePressure(context, request, candidate.capsule, controller.signal))
      if (!this.isCurrent(epoch, controller) || !this.queue.isLatest(candidate)) return
      const reservation = this.store.reserveAutoRequest(
        this.lease,
        candidate.capsule,
        route.provider,
        route.model,
        candidate.attempts + 1,
        this.settings.maxAutoRequestsPerDay,
      )
      if (!reservation.ok) {
        this.queue.defer(candidate)
        this.armBudget(reservation.resumeAt)
        return
      }
      const generated = await runAuxiliaryRequest(
        this.ctx,
        route,
        request,
        this.settings.timeoutMs,
        controller.signal,
      )
      if (!this.isCurrent(epoch, controller) || !this.queue.isLatest(candidate)) return
      this.store.commitAutoDecision(this.lease, candidate.capsule, generated.value, generated.generation)
      finished = true
      if (this.failedRephrases.size === 0) this.operationError = undefined
      this.idleAttempted = undefined
      this.scheduleIdle()
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof CompactionError) {
          this.operationError = { code: error.code, message: error.message }
        } else if (candidate.attempts + 1 < this.settings.maxAttempts) {
          this.queue.retry(candidate)
        } else {
          this.operationError = {
            code: 'EXPLAIN_AUTO_FAILED',
            message: safeError(error).message,
          }
        }
        this.logger.warn('autonomous explanation failed: %s',
          error instanceof CompactionError ? safeCause(error).message : safeError(error).message)
      }
    } finally {
      if (!finished && controller.signal.aborted && this.settings.enabled && !this.stopped) {
        this.queue.defer(candidate)
      }
      this.endRequest(controller)
      this.store.notifyRuntimeChange()
    }
  }

  private async runManual(job: ManualJob): Promise<void> {
    if (job.signal.aborted) {
      job.settle(manualFailure('EXPLAIN_REQUEST_CANCELLED', 'The explanation request was cancelled.'))
      return
    }
    const route = this.mustRoute()
    const epoch = this.epoch
    const controller = this.beginRequest('manual')
    this.activeManual = job
    const signal = AbortSignal.any([controller.signal, job.signal])
    let result: ManualExplainResult
    try {
      let context = this.store.auxiliaryContext(this.settings.maxTopicHints)
      let request = renderManualExplainRequest(context, job.target, this.settings.maxOutputTokens)
      ;({ context, request } = await this.relieveManualPressure(context, request, job.target, signal))
      const generated = await runAuxiliaryRequest(this.ctx, route, request, this.settings.timeoutMs, signal)
      if (!this.isCurrent(epoch, controller)) {
        result = this.settings.enabled
          ? manualFailure('EXPLAIN_RUNTIME_FAILED', 'The learning runtime changed before the explanation completed.')
          : manualFailure('EXPLAIN_DISABLED', 'Learning mode is disabled.')
      } else {
        const committed = this.store.commitManualExplanation(
          this.lease,
          job.target.capsule,
          generated.value,
          generated.generation,
        )
        result = committed.ok
          ? { ok: true, entry: committed.entry }
          : committed.reason === 'source-active'
            ? manualFailure('EXPLAIN_SOURCE_BUSY', 'This Session already has an active explanation.')
            : manualFailure('EXPLAIN_TOPIC_ACTIVE', 'This topic already has an active explanation in the global learning thread.')
        if (committed.ok) {
          if (this.failedRephrases.size === 0) this.operationError = undefined
          this.idleAttempted = undefined
          this.scheduleIdle()
        }
      }
    } catch (error) {
      if (job.signal.aborted) {
        result = manualFailure('EXPLAIN_REQUEST_CANCELLED', 'The explanation request was cancelled.')
      } else if (controller.signal.aborted) {
        result = this.settings.enabled
          ? manualFailure('EXPLAIN_RUNTIME_FAILED', 'The learning runtime changed before the explanation completed.')
          : manualFailure('EXPLAIN_DISABLED', 'Learning mode is disabled.')
      } else if (error instanceof CompactionError) {
        result = manualFailure(error.code, error.message)
        this.operationError = { code: error.code, message: error.message }
      } else {
        result = manualFailure('EXPLAIN_MANUAL_FAILED', 'The requested explanation could not be generated.')
        this.operationError = {
          code: 'EXPLAIN_MANUAL_FAILED',
          message: 'The requested explanation could not be generated.',
        }
        this.logger.warn('explicit explanation failed: %s', safeError(error).message)
      }
    } finally {
      this.activeManual = undefined
      this.endRequest(controller)
      this.store.notifyRuntimeChange()
    }
    job.settle(result)
  }

  private async runRephrase(target: RephraseTarget): Promise<void> {
    const route = this.mustRoute()
    const epoch = this.epoch
    const controller = this.beginRequest('rephrase')
    try {
      let context = this.store.auxiliaryContext(this.settings.maxTopicHints)
      let request = renderRephraseRequest(context, target, this.settings.maxOutputTokens)
      ;({ context, request } = await this.relieveRephrasePressure(context, request, target, controller.signal))
      const generated = await runAuxiliaryRequest(this.ctx, route, request, this.settings.timeoutMs, controller.signal)
      if (!this.isCurrent(epoch, controller)) return
      this.store.commitRephrase(this.lease, target, generated.value, generated.generation)
      this.failedRephrases.delete(rephraseKey(target.explanationId, target.revision))
      if (this.failedRephrases.size === 0) this.operationError = undefined
    } catch (error) {
      if (!controller.signal.aborted) {
        this.failedRephrases.add(rephraseKey(target.explanationId, target.revision))
        this.operationError = {
          code: error instanceof CompactionError ? error.code : 'EXPLAIN_REPHRASE_FAILED',
          message: error instanceof CompactionError
            ? error.message
            : 'The explanation could not be rephrased. Select Not understood to try again.',
        }
        this.logger.warn('rephrase failed: %s', safeError(error).message)
      }
    } finally {
      this.endRequest(controller)
      this.store.notifyRuntimeChange()
    }
  }

  private async relievePressure<T>(
    context: ReturnType<ExplainStore['auxiliaryContext']>,
    request: AuxiliaryRequest<T>,
    capsule: SourceCapsule,
    signal: AbortSignal,
  ): Promise<{ context: ReturnType<ExplainStore['auxiliaryContext']>; request: AuxiliaryRequest<T> }> {
    const route = this.mustRoute()
    while (this.pressure(request, route) > this.settings.contextThresholdRatio) {
      const compacted = await compactOnce(this.ctx, this.store, this.lease, this.settings, route, 'pressure', signal)
      if (compacted.kind === 'noop') throw new CompactionError('EXPLAIN_CONTEXT_PRESSURE_UNRESOLVED', 'No safe content remains to compact.')
      context = this.store.auxiliaryContext(this.settings.maxTopicHints)
      request = renderExplainRequest(context, capsule, this.settings.maxOutputTokens) as AuxiliaryRequest<T>
    }
    return { context, request }
  }

  private async relieveRephrasePressure<T>(
    context: ReturnType<ExplainStore['auxiliaryContext']>,
    request: AuxiliaryRequest<T>,
    target: RephraseTarget,
    signal: AbortSignal,
  ): Promise<{ context: ReturnType<ExplainStore['auxiliaryContext']>; request: AuxiliaryRequest<T> }> {
    const route = this.mustRoute()
    while (this.pressure(request, route) > this.settings.contextThresholdRatio) {
      const compacted = await compactOnce(this.ctx, this.store, this.lease, this.settings, route, 'pressure', signal)
      if (compacted.kind === 'noop') throw new CompactionError('EXPLAIN_CONTEXT_PRESSURE_UNRESOLVED', 'No safe content remains to compact.')
      context = this.store.auxiliaryContext(this.settings.maxTopicHints)
      request = renderRephraseRequest(context, target, this.settings.maxOutputTokens) as AuxiliaryRequest<T>
    }
    return { context, request }
  }

  private async relieveManualPressure<T>(
    context: ReturnType<ExplainStore['auxiliaryContext']>,
    request: AuxiliaryRequest<T>,
    target: ManualExplainTarget,
    signal: AbortSignal,
  ): Promise<{ context: ReturnType<ExplainStore['auxiliaryContext']>; request: AuxiliaryRequest<T> }> {
    const route = this.mustRoute()
    while (this.pressure(request, route) > this.settings.contextThresholdRatio) {
      const compacted = await compactOnce(this.ctx, this.store, this.lease, this.settings, route, 'pressure', signal)
      if (compacted.kind === 'noop') throw new CompactionError('EXPLAIN_CONTEXT_PRESSURE_UNRESOLVED', 'No safe content remains to compact.')
      context = this.store.auxiliaryContext(this.settings.maxTopicHints)
      request = renderManualExplainRequest(context, target, this.settings.maxOutputTokens) as AuxiliaryRequest<T>
    }
    return { context, request }
  }

  private async runIdleCompaction(): Promise<void> {
    const route = this.mustRoute()
    const state = this.store.runtimeState()
    this.idleAttempted = `${state.contextGeneration}:${state.activityGeneration}`
    const controller = this.beginRequest('idle')
    try {
      await compactOnce(this.ctx, this.store, this.lease, this.settings, route, 'idle', controller.signal)
      if (this.failedRephrases.size === 0) this.operationError = undefined
    } catch (error) {
      if (controller.signal.aborted) {
        this.idleAttempted = undefined
      } else {
        this.operationError = {
          code: error instanceof CompactionError ? error.code : 'EXPLAIN_COMPACTION_FAILED',
          message: error instanceof CompactionError
            ? error.message
            : 'The learning context could not be compacted. No learning data was marked as covered.',
        }
        this.logger.warn('idle compaction failed: %s', safeCause(safeError(error)).message)
      }
    } finally {
      this.endRequest(controller)
      this.scheduleIdle()
      this.store.notifyRuntimeChange()
    }
  }

  private pressure(request: AuxiliaryRequest<unknown>, route: ExplainRoute): number {
    const ratio = estimateAuxiliaryRequest(this.ctx, request) / route.contextWindow
    this.estimatedContextRatio = ratio
    return ratio
  }

  private idleDue(now = Date.now()): boolean {
    const batch = this.store.compactionBatch()
    if (batch === undefined) return false
    const state = this.store.runtimeState()
    const key = `${state.contextGeneration}:${state.activityGeneration}`
    if (this.idleAttempted === key) return false
    const baseline = state.lastUserActionAt ?? state.firstExplainOutputAt
    return baseline !== undefined && now - baseline >= this.settings.idleCompactMs
  }

  private scheduleIdle(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    if (!this.settings.enabled || this.store.compactionBatch() === undefined) return
    const state = this.store.runtimeState()
    const baseline = state.lastUserActionAt ?? state.firstExplainOutputAt
    if (baseline === undefined) return
    const delay = Math.max(0, baseline + this.settings.idleCompactMs - Date.now())
    this.idleTimer = setTimeout(() => { this.kick() }, delay)
  }

  private armBudget(resumeAt: number | undefined): void {
    if (this.budgetTimer !== undefined) clearTimeout(this.budgetTimer)
    if (resumeAt === undefined) return
    this.budgetTimer = setTimeout(() => { this.kick() }, Math.max(0, resumeAt - Date.now()))
  }

  private beginRequest(kind: NonNullable<ExplainScheduler['controllerKind']>): AbortController {
    if (this.controller !== undefined) throw new Error('dsh-explain: scheduler single-flight invariant violated')
    const controller = new AbortController()
    this.controller = controller
    this.controllerKind = kind
    return controller
  }

  private endRequest(controller: AbortController): void {
    if (this.controller === controller) {
      this.controller = undefined
      this.controllerKind = undefined
    }
  }

  private cancelCurrent(): void {
    this.epoch += 1
    this.controller?.abort(new Error('dsh-explain: runtime generation changed'))
  }

  private isCurrent(epoch: number, controller: AbortController): boolean {
    return !controller.signal.aborted && epoch === this.epoch && this.settings.enabled && !this.stopped
  }

  private hasImmediateWork(): boolean {
    return this.manualQueue.length > 0
      || this.store.pendingRephrases(this.failedRephrases).length > 0
      || (this.queue.hasExecutable(this.store.activeSources())
        && this.store.autoBudget(this.settings.maxAutoRequestsPerDay).used
        < this.settings.maxAutoRequestsPerDay)
      || this.idleDue()
  }

  private nextRephrase(): RephraseTarget | undefined {
    while (true) {
      try {
        return this.store.pendingRephrases(this.failedRephrases)[0]
      } catch (error) {
        if (!(error instanceof SourceSummaryError)) throw error
        this.failedRephrases.add(rephraseKey(error.explanationId, error.revision))
        this.operationError = { code: error.code, message: error.message }
        this.logger.error('saved rephrase source summary is invalid: %s', safeCause(error).message)
        this.store.notifyRuntimeChange()
      }
    }
  }

  private mustRoute(): ExplainRoute {
    if (this.route === undefined) throw new Error('dsh-explain: enabled scheduler has no resolved model route')
    return this.route
  }

  private renewLease(): void {
    if (this.stopped) return
    try {
      if (this.store.renewLease(this.lease, Date.now(), LEASE_TTL_MS)) return
      this.fail(new Error('dsh-explain: runtime lease was lost'))
      this.cancelCurrent()
    } catch (error) {
      this.fail(error)
      this.cancelCurrent()
    }
  }

  private fail(error: unknown): void {
    const safe = safeError(error)
    const code = error instanceof ExplainRouteError ? error.code
      : error instanceof CompactionError ? error.code : 'RUNTIME_FAILED'
    this.failed = { code, message: safe.message }
    this.settleQueuedManual(manualFailure('EXPLAIN_RUNTIME_FAILED', 'The learning runtime is not ready.'))
    this.store.notifyRuntimeChange()
  }

  private clearTimers(): void {
    if (this.budgetTimer !== undefined) clearTimeout(this.budgetTimer)
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
    this.budgetTimer = undefined
    this.idleTimer = undefined
  }

  private settleQueuedManual(result: ManualExplainResult): void {
    for (const job of this.manualQueue.splice(0)) job.settle(result)
  }
}

function rephraseKey(explanationId: string, revision: number): string {
  return `${explanationId}:${revision}`
}

function safeError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Auxiliary learning operation failed.')
}

function safeCause(error: Error): Error {
  return error.cause instanceof Error ? error.cause : error
}

function manualFailure(
  code: Extract<ManualExplainResult, { readonly ok: false }>['error']['code'],
  message: string,
): ManualExplainResult {
  return { ok: false, error: { code, message } }
}
