import type { Context } from '@deepseek-ai/cordis'
import { GatewayService, Remote } from '@deepseek-ai/dsh-type-meta'
import type { ExplainRuntime } from './runtime.ts'
import type { ExplainStore } from './store.ts'
import type {
  ExplainContextView,
  ExplainStatusView,
  FeedbackMutationResult,
  FeedbackRequest,
  ReopenTopicRequest,
  ReopenTopicResult,
  SetEnabledRequest,
  SetEnabledResult,
  ThreadPageRequest,
  ThreadPageResult,
  WatchRequest,
  WatchResult,
} from './types.ts'

/** Host-side typed Remote service for the global learning thread. */
export class ExplainGateway extends GatewayService {
  /** Register the explain namespace against one store and live config source. */
  constructor(
    ctx: Context,
    private readonly store: ExplainStore,
    private readonly runtime: ExplainRuntime,
  ) {
    super(ctx, 'explain')
  }

  /** Read runtime, queue, budget, and persistence status. */
  @Remote
  status(): ExplainStatusView {
    const settings = this.runtime.settings()
    const scheduler = this.runtime.scheduler.status()
    const budget = this.store.autoBudget(settings.maxAutoRequestsPerDay)
    const persisted = this.store.runtimeState()
    return {
      enabled: settings.enabled,
      runtimeState: scheduler.state,
      activeExplanationCount: this.store.activeExplanationCount(),
      pendingCandidateCount: scheduler.pendingCandidates,
      autoRequestsUsed: budget.used,
      autoRequestsLimit: settings.maxAutoRequestsPerDay,
      ...(budget.resumeAt === undefined ? {} : { autoRequestsResumeAt: budget.resumeAt }),
      ...(settings.provider === undefined ? {} : { provider: settings.provider }),
      ...(settings.model === undefined ? {} : { model: settings.model }),
      routeReady: scheduler.route !== undefined,
      ...(scheduler.route === undefined ? {} : { contextWindow: scheduler.route.contextWindow }),
      ...(persisted.lastUserActionAt === undefined ? {} : { lastUserActionAt: persisted.lastUserActionAt }),
      ...(persisted.lastCompactedAt === undefined ? {} : { lastCompactedAt: persisted.lastCompactedAt }),
      ...(scheduler.estimatedContextRatio === undefined
        ? {} : { estimatedContextRatio: scheduler.estimatedContextRatio }),
      ...(scheduler.lastError === undefined ? {} : { lastError: scheduler.lastError }),
      storeRevision: this.store.storeRevision(),
      cursor: this.store.cursor(),
    }
  }

  /** Validate and persist the one global learning-mode switch. */
  @Remote
  async setEnabled(request: SetEnabledRequest): Promise<SetEnabledResult> {
    const error = await this.runtime.setEnabled(request.enabled)
    return error === undefined ? { ok: true, status: this.status() } : { ok: false, error }
  }

  /** Read one backward page from the append-only learning thread. */
  @Remote
  threadPage(request: ThreadPageRequest): ThreadPageResult {
    return this.store.threadPage(request)
  }

  /** Read the latest ExplainContext projection and authoritative statistics. */
  @Remote
  context(): ExplainContextView {
    return this.store.context()
  }

  /** Wait for a view revision change or the ordinary long-poll timeout. */
  @Remote
  watch(request: WatchRequest, signal: AbortSignal): Promise<WatchResult> {
    return this.store.watch(request.after, signal)
  }

  /** Submit entity-scoped understood or not-understood feedback. */
  @Remote
  feedback(request: FeedbackRequest): FeedbackMutationResult {
    if (!this.runtime.settings().enabled) {
      return {
        ok: false,
        error: { code: 'EXPLAIN_DISABLED', message: 'Learning mode is disabled.' },
      }
    }
    const revision = this.store.storeRevision()
    const result = this.store.feedback(request)
    if (result.ok) {
      const changed = this.store.storeRevision() !== revision
      const rephrasePending = request.action === 'not-understood'
        && this.store.isRephrasePending(request.explanationId, request.revision)
      if (changed || rephrasePending) {
        this.runtime.scheduler.learningStateChanged({
          explanationId: request.explanationId,
          revision: request.revision,
        })
      }
    }
    return result
  }

  /** Reopen one mastered Topic with Topic revision CAS. */
  @Remote
  reopenTopic(request: ReopenTopicRequest): ReopenTopicResult {
    if (!this.runtime.settings().enabled) {
      return {
        ok: false,
        error: { code: 'EXPLAIN_DISABLED', message: 'Learning mode is disabled.' },
      }
    }
    const revision = this.store.storeRevision()
    const result = this.store.reopenTopic(request)
    if (result.ok && this.store.storeRevision() !== revision) this.runtime.scheduler.learningStateChanged()
    return result
  }
}
