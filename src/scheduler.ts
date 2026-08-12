import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ExplainRuntimeSettings } from './config.ts'
import { compactOnce, CompactionError } from './compactor.ts'
import type { LeaseToken, RephraseTarget, SourceCapsule } from './domain.ts'
import {
  estimateAuxiliaryRequest,
  ExplainRouteError,
  renderExplainRequest,
  renderRephraseRequest,
  resolveExplainRoute,
  runAuxiliaryRequest,
  type AuxiliaryRequest,
  type ExplainRoute,
} from './explainer.ts'
import { CandidateQueue, type ExplainCandidate } from './queue.ts'
import { SourceSummaryError, type ExplainStore } from './store.ts'

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
  private idleAttempted: string | undefined
  private readonly failedRephrases = new Set<string>()
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
    this.heartbeat = setInterval(() => { this.renewLease() }, LEASE_RENEW_MS)
    if (this.settings.enabled) await this.enableRuntime()
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

  /** Accept one already-bounded turn without blocking its session event dispatch. */
  enqueue(capsule: SourceCapsule): void {
    if (!this.settings.enabled || this.failed !== undefined || this.stopped) return
    const evicted = this.queue.push(capsule, this.settings.maxPendingCandidates)
    if (evicted !== undefined) this.logger.debug('evicted oldest autonomous candidate from %s', evicted.capsule.sourceSessionId)
    this.store.notifyRuntimeChange()
    this.kick()
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
    if (semanticChange) this.cancelCurrent()
    if (previous.maxSourceChars !== next.maxSourceChars) this.queue.clear()
    this.operationError = undefined
    if (!next.enabled) {
      this.route = undefined
      this.failed = undefined
      this.queue.clear()
      this.clearTimers()
      this.store.notifyRuntimeChange()
      return
    }
    const routeChanged = !previous.enabled || previous.provider !== next.provider || previous.model !== next.model
    if (routeChanged || this.route === undefined) await this.enableRuntime()
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
    this.clearTimers()
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    await Promise.allSettled(this.draining === undefined ? [] : [this.draining])
    this.store.releaseLease(this.lease)
  }

  private async enableRuntime(): Promise<void> {
    this.route = undefined
    try {
      this.route = await resolveExplainRoute(this.ctx, this.settings)
      this.failed = undefined
      this.store.notifyRuntimeChange()
      this.scheduleIdle()
      this.kick()
    } catch (error) {
      this.route = undefined
      this.fail(error)
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
    const controller = this.beginRequest()
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
        }
        this.logger.warn('autonomous explanation failed: %s', safeError(error).message)
      }
    } finally {
      if (!finished && controller.signal.aborted && this.settings.enabled && !this.stopped) {
        this.queue.defer(candidate)
      }
      this.endRequest(controller)
      this.store.notifyRuntimeChange()
    }
  }

  private async runRephrase(target: RephraseTarget): Promise<void> {
    const route = this.mustRoute()
    const epoch = this.epoch
    const controller = this.beginRequest()
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

  private async runIdleCompaction(): Promise<void> {
    const route = this.mustRoute()
    const state = this.store.runtimeState()
    this.idleAttempted = `${state.contextGeneration}:${state.activityGeneration}`
    const controller = this.beginRequest()
    try {
      await compactOnce(this.ctx, this.store, this.lease, this.settings, route, 'idle', controller.signal)
      if (this.failedRephrases.size === 0) this.operationError = undefined
    } catch (error) {
      if (!controller.signal.aborted) {
        this.operationError = {
          code: error instanceof CompactionError ? error.code : 'EXPLAIN_COMPACTION_FAILED',
          message: error instanceof CompactionError
            ? error.message
            : 'The learning context could not be compacted. No learning data was marked as covered.',
        }
        this.logger.warn('idle compaction failed: %s', safeError(error).message)
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

  private beginRequest(): AbortController {
    if (this.controller !== undefined) throw new Error('dsh-explain: scheduler single-flight invariant violated')
    const controller = new AbortController()
    this.controller = controller
    return controller
  }

  private endRequest(controller: AbortController): void {
    if (this.controller === controller) this.controller = undefined
  }

  private cancelCurrent(): void {
    this.epoch += 1
    this.controller?.abort(new Error('dsh-explain: runtime generation changed'))
  }

  private isCurrent(epoch: number, controller: AbortController): boolean {
    return !controller.signal.aborted && epoch === this.epoch && this.settings.enabled && !this.stopped
  }

  private hasImmediateWork(): boolean {
    return this.store.pendingRephrases(this.failedRephrases).length > 0
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
    this.store.notifyRuntimeChange()
  }

  private clearTimers(): void {
    if (this.budgetTimer !== undefined) clearTimeout(this.budgetTimer)
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
    this.budgetTimer = undefined
    this.idleTimer = undefined
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
