import type { Context } from '@deepseek-ai/cordis'
import { GatewayService, Remote } from '@deepseek-ai/dsh-type-meta'
import type { ResolvedExplainConfig } from './config.ts'
import type { ExplainStore } from './store.ts'
import type {
  ExplainContextView,
  ExplainStatusView,
  FeedbackMutationResult,
  FeedbackRequest,
  ReopenTopicRequest,
  ReopenTopicResult,
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
    private readonly config: () => ResolvedExplainConfig,
  ) {
    super(ctx, 'explain')
  }

  /** Read runtime, queue, budget, and persistence status. */
  @Remote
  status(): ExplainStatusView {
    const config = this.config()
    return {
      enabled: config.enabled,
      runtimeState: config.enabled ? 'ready' : 'disabled',
      activeExplanationCount: this.store.activeExplanationCount(),
      pendingCandidateCount: 0,
      autoRequestsUsed: this.store.autoRequestsUsed(),
      autoRequestsLimit: config.maxAutoRequestsPerDay,
      storeRevision: this.store.storeRevision(),
      cursor: this.store.cursor(),
    }
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
    if (!this.config().enabled) {
      return {
        ok: false,
        error: { code: 'EXPLAIN_DISABLED', message: 'Learning mode is disabled.' },
      }
    }
    return this.store.feedback(request)
  }

  /** Reopen one mastered Topic with Topic revision CAS. */
  @Remote
  reopenTopic(request: ReopenTopicRequest): ReopenTopicResult {
    if (!this.config().enabled) {
      return {
        ok: false,
        error: { code: 'EXPLAIN_DISABLED', message: 'Learning mode is disabled.' },
      }
    }
    return this.store.reopenTopic(request)
  }
}
