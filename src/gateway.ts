import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ExplainRuntime } from './runtime.ts'
import type { ExplainStore } from './store.ts'
import type {
  ClearLearningDataRequest,
  ClearLearningDataResult,
  ExplainDataExportV3,
  ExplainContextView,
  ExplainConfigurationView,
  ExplainModelCatalogView,
  ExplainStatusView,
  FeedbackMutationResult,
  FeedbackRequest,
  ReopenTopicRequest,
  ReopenTopicResult,
  ReviewDashboardView,
  SetEnabledRequest,
  SetEnabledResult,
  StartReviewRequest,
  StartReviewResult,
  SubmitReviewAnswerRequest,
  SubmitReviewAnswerResult,
  ThreadPageRequest,
  ThreadPageResult,
  UpdateConfigurationRequest,
  UpdateConfigurationResult,
  UpdateLearnerProfileRequest,
  UpdateLearnerProfileResult,
  WatchRequest,
  WatchResult,
} from './types.ts'

/** Host-side typed Remote service for the global learning thread. */
export class ExplainGateway extends TypertRemoteService {
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

  /** Read the settings-page fields and native settings revision. */
  @Remote
  configuration(): ExplainConfigurationView {
    return this.runtime.configuration()
  }

  /** Read current providers and advisory model choices. */
  @Remote
  modelCatalog(): Promise<ExplainModelCatalogView> {
    return this.runtime.modelCatalog()
  }

  /** Merge settings-page fields with native settings revision CAS. */
  @Remote
  async updateConfiguration(request: UpdateConfigurationRequest): Promise<UpdateConfigurationResult> {
    const error = await this.runtime.updateConfiguration(request)
    const configuration = this.runtime.configuration()
    return error === undefined
      ? { ok: true, configuration, status: this.status() }
      : { ok: false, error, configuration }
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

  /** Export the complete public learning projection as a versioned, privacy-bounded backup. */
  @Remote
  exportData(): ExplainDataExportV3 {
    return this.store.exportData()
  }

  /** Persist one explicit learner-profile correction without scheduling an auxiliary request. */
  @Remote
  updateLearnerProfile(request: UpdateLearnerProfileRequest): UpdateLearnerProfileResult {
    return this.store.updateLearnerProfile(request)
  }

  /** Read today's review counts, active question, and recent outcomes. */
  @Remote
  reviewDashboard(): ReviewDashboardView {
    return this.store.reviewDashboard()
  }

  /** Start or resume one local review round of up to three due concepts. */
  @Remote
  startReview(request: StartReviewRequest): StartReviewResult {
    if (!this.runtime.settings().enabled) {
      return { ok: false, error: { code: 'EXPLAIN_DISABLED', message: 'Learning mode is disabled.' } }
    }
    const scheduler = this.runtime.scheduler.status()
    if (scheduler.state !== 'ready' || scheduler.route === undefined) {
      return { ok: false, error: { code: 'EXPLAIN_RUNTIME_FAILED', message: 'The learning runtime is not ready.' } }
    }
    const result = this.store.startReview(request)
    if (!result.created && result.dashboard.current === undefined) {
      return { ok: false, error: { code: 'REVIEW_NOT_DUE', message: 'No mastered concept is due for review.' } }
    }
    return { ok: true, dashboard: result.dashboard }
  }

  /** Evaluate one exact review answer through the scheduler's single model flight. */
  @Remote
  submitReviewAnswer(
    request: SubmitReviewAnswerRequest,
    signal: AbortSignal,
  ): Promise<SubmitReviewAnswerResult> {
    return this.runtime.scheduler.requestReviewAnswer(request, signal)
  }

  /** Fence producers and atomically clear learned content while retaining settings and usage counters. */
  @Remote
  async clearLearningData(request: ClearLearningDataRequest): Promise<ClearLearningDataResult> {
    const result = await this.runtime.clearLearningData(request)
    return result.ok
      ? { ok: true, value: result.value, status: this.status() }
      : result
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
