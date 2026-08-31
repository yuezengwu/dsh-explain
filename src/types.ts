import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  EntryId, ExplanationId, ObservationId, RequestId, ReviewBatchId, ReviewId, TopicId,
} from './brands.ts'

export type {
  EntryId, ExplanationId, ObservationId, RequestId, ReviewBatchId, ReviewId, TopicId,
} from './brands.ts'

/** Monotonic process-local cursor used by long-polling clients. */
export interface ViewCursor {
  readonly incarnation: string
  readonly revision: number
}

/** Public plugin runtime state. */
export type ExplainRuntimeState = 'disabled' | 'ready' | 'failed'

/** Read-only status returned to every learning view. */
export interface ExplainStatusView {
  readonly enabled: boolean
  readonly runtimeState: ExplainRuntimeState
  readonly activeExplanationCount: number
  readonly pendingCandidateCount: number
  readonly autoRequestsUsed: number
  readonly autoRequestsLimit: number
  readonly autoRequestsResumeAt?: number
  readonly provider?: string
  readonly model?: string
  readonly routeReady: boolean
  readonly contextWindow?: number
  readonly lastUserActionAt?: number
  readonly lastCompactedAt?: number
  readonly estimatedContextRatio?: number
  readonly lastError?: { readonly code: string; readonly message: string }
  readonly storeRevision: number
  readonly cursor: ViewCursor
}

/** Persist the global enabled switch through the registered settings namespace. */
export interface SetEnabledRequest { readonly enabled: boolean }

/** Stable enable/disable result; route failures never become transport errors. */
export type SetEnabledResult =
  | { readonly ok: true; readonly status: ExplainStatusView }
  | {
      readonly ok: false
      readonly error: {
        readonly code: 'MODEL_ROUTE_REQUIRED' | 'MODEL_CONTEXT_REQUIRED' | 'RUNTIME_FAILED'
        readonly message: string
      }
    }

/** UI-editable settings and their native DSH settings revision. */
export interface ExplainConfigurationView {
  readonly revision: number
  readonly enabled: boolean
  readonly provider?: string
  readonly model?: string
  readonly maxAutoRequestsPerDay: number
}

/** One advisory model entry returned by a registered provider. */
export interface ExplainModelOptionView {
  readonly id: string
  readonly name: string
}

/** One provider and its advisory model catalog. */
export interface ExplainProviderOptionView {
  readonly id: string
  readonly name: string
  readonly models: readonly ExplainModelOptionView[]
  readonly error?: { readonly code: 'MODEL_CATALOG_UNAVAILABLE'; readonly message: string }
}

/** Current model choices; catalog membership never authorizes a route. */
export interface ExplainModelCatalogView {
  readonly providers: readonly ExplainProviderOptionView[]
}

/** Atomic editable-settings update based on one native settings revision. */
export interface UpdateConfigurationRequest {
  readonly expectedRevision: number
  readonly enabled: boolean
  readonly provider?: string
  readonly model?: string
  readonly maxAutoRequestsPerDay: number
}

/** Stable configuration failure returned without a partial settings write. */
export interface UpdateConfigurationFailure {
  readonly code:
    | 'SETTINGS_STALE'
    | 'INVALID_SETTINGS'
    | 'MODEL_ROUTE_REQUIRED'
    | 'MODEL_CONTEXT_REQUIRED'
    | 'RUNTIME_FAILED'
  readonly message: string
}

/** Configuration update result with the authoritative current revision. */
export type UpdateConfigurationResult =
  | {
      readonly ok: true
      readonly configuration: ExplainConfigurationView
      readonly status: ExplainStatusView
    }
  | {
      readonly ok: false
      readonly error: UpdateConfigurationFailure
      readonly configuration: ExplainConfigurationView
    }

/** Sanitized explanation payload visible to the browser. */
export interface ExplanationPayloadView {
  readonly title: string
  readonly what: string
  readonly why: string
  readonly pitfall: string
}

/** Sanitized feedback payload visible to the browser. */
export interface FeedbackPayloadView {
  readonly action: 'understood' | 'not-understood'
}

/** Sanitized Topic reopen payload visible to the browser. */
export interface ReopenPayloadView {
  readonly action: 'reopen'
}

/** One append-only learning entry; private sourceSummary data is never projected here. */
export interface ThreadEntryView {
  readonly entryId: EntryId
  readonly ordinal: number
  readonly kind: 'explanation' | 'feedback' | 'topic-reopen'
  readonly explanationId?: ExplanationId
  readonly explanationState?: 'active' | 'closed'
  readonly topicId: TopicId
  readonly topicKey: string
  readonly topicTitle: string
  readonly topicState: 'learning' | 'mastered'
  readonly topicRevision: number
  readonly revision?: number
  readonly origin?: 'manual' | 'selection' | 'answer' | 'suggested'
  readonly sourceSessionId?: SessionId
  readonly sourceTurn?: number
  readonly payload: ExplanationPayloadView | FeedbackPayloadView | ReopenPayloadView
  readonly createdAt: number
}

/** Backward page request over immutable ordinals. */
export interface ThreadPageRequest {
  readonly beforeOrdinal?: number
  readonly limit?: number
}

/** One immutable learning-thread page. */
export interface ThreadPageResult {
  readonly entries: readonly ThreadEntryView[]
  readonly hasMore: boolean
  readonly storeRevision: number
}

/** Database-authoritative learning statistics. */
export interface ExplainContextStats {
  readonly learningTopics: number
  readonly masteredTopics: number
  readonly activeExplanations: number
  readonly understoodFeedback: number
  readonly notUnderstoodFeedback: number
}

/** One evidence-backed explanation-style preference inferred by the auxiliary model. */
export interface DialoguePreferenceView {
  readonly kind: 'verbosity' | 'structure' | 'examples' | 'terminology'
  readonly preference: string
  readonly confidence: 'low' | 'medium' | 'high'
  readonly evidenceObservationIds: readonly ObservationId[]
  readonly evidenceEntryOrdinals: readonly number[]
}

/** Read-only ExplainContext projection. Model-generated fields are absent before M2 creates a checkpoint. */
export interface ExplainContextView {
  readonly generatedAt?: number
  readonly dialogueProfile: readonly DialoguePreferenceView[]
  readonly knowledgeOverview: string
  readonly learningTrend: string
  readonly stats: ExplainContextStats
  readonly inferred: boolean
}

/** Portable, privacy-bounded learning backup. The format is import-ready but v0.2 only exports it. */
export interface ExplainDataExportV1 {
  readonly format: 'dsh-explain-backup'
  readonly version: 1
  readonly exportedAt: number
  readonly databaseSchemaVersion: number
  readonly storeRevision: number
  readonly data: {
    readonly entries: readonly ThreadEntryView[]
    readonly context: ExplainContextView
  }
}

export type ReviewQuestionKind = 'recall' | 'application' | 'distinction'
export type ReviewResult = 'mastered' | 'partial' | 'forgotten'

/** One unanswered question in the durable active review round. */
export interface ReviewQuestionView {
  readonly reviewId: ReviewId
  readonly batchId: ReviewBatchId
  readonly position: number
  readonly total: number
  readonly topicId: TopicId
  readonly topicTitle: string
  readonly kind: ReviewQuestionKind
  readonly question: string
  readonly sourceSessionId: SessionId
  readonly sourceTurn: number
  readonly createdAt: number
}

/** One completed answer with its schedule transition. */
export interface ReviewAttemptView extends Omit<ReviewQuestionView, 'total'> {
  readonly answer: string
  readonly result: ReviewResult
  readonly feedback: string
  readonly completedAt: number
  readonly nextReviewAt: number
}

/** Read-only today-review projection used by the global Learning view. */
export interface ReviewDashboardView {
  readonly dueCount: number
  readonly weakCount: number
  readonly newCount: number
  readonly completedCount: number
  readonly nextDueAt?: number
  readonly current?: ReviewQuestionView
  readonly recent: readonly ReviewAttemptView[]
}

/** Start or resume one durable review round of up to three due concepts. */
export interface StartReviewRequest { readonly requestId: RequestId }
export type StartReviewResult =
  | { readonly ok: true; readonly dashboard: ReviewDashboardView }
  | { readonly ok: false; readonly error: ReviewFailure }

/** Evaluate one exact pending question. */
export interface SubmitReviewAnswerRequest {
  readonly requestId: RequestId
  readonly reviewId: ReviewId
  readonly answer: string
}

export interface ReviewFailure {
  readonly code:
    | 'EXPLAIN_DISABLED'
    | 'EXPLAIN_RUNTIME_FAILED'
    | 'REVIEW_NOT_DUE'
    | 'REVIEW_STALE'
    | 'REVIEW_ANSWER_INVALID'
    | 'REVIEW_REQUEST_CANCELLED'
    | 'REVIEW_EVALUATION_FAILED'
    | 'REQUEST_ID_CONFLICT'
  readonly message: string
}

export type SubmitReviewAnswerResult =
  | { readonly ok: true; readonly dashboard: ReviewDashboardView; readonly attempt: ReviewAttemptView }
  | { readonly ok: false; readonly error: ReviewFailure }

/** Portable v2 backup adds review schedules and answer history while retaining public-only fields. */
export interface ExplainDataExportV2 {
  readonly format: 'dsh-explain-backup'
  readonly version: 2
  readonly exportedAt: number
  readonly databaseSchemaVersion: number
  readonly storeRevision: number
  readonly data: {
    readonly entries: readonly ThreadEntryView[]
    readonly context: ExplainContextView
    readonly review: {
      readonly dashboard: ReviewDashboardView
      readonly attempts: readonly ReviewAttemptView[]
    }
  }
}

/** Destructive clear request guarded by both an explicit phrase and store revision CAS. */
export interface ClearLearningDataRequest {
  readonly expectedStoreRevision: number
  readonly confirmation: string
}

/** Counts removed by one atomic learning-data clear. */
export interface ClearedLearningDataCounts {
  readonly entries: number
  readonly topics: number
  readonly explanations: number
  readonly observations: number
  readonly checkpoints: number
  readonly reviewAttempts: number
}

/** Successful clear receipt, including the intentionally retained autonomous-request usage. */
export interface ClearLearningDataValue {
  readonly cleared: ClearedLearningDataCounts
  readonly preservedAutoRequests: number
  readonly storeRevision: number
}

/** Stable clear failure returned without a partial database mutation. */
export interface ClearLearningDataFailure {
  readonly code: 'CLEAR_CONFIRMATION_REQUIRED' | 'STORE_STALE' | 'CLEAR_IN_PROGRESS' | 'CLEAR_FAILED'
  readonly message: string
}

/** Clear result with the authoritative post-operation status on success. */
export type ClearLearningDataResult =
  | { readonly ok: true; readonly value: ClearLearningDataValue; readonly status: ExplainStatusView }
  | { readonly ok: false; readonly error: ClearLearningDataFailure }

/** Long-poll request from one previously observed view cursor. */
export interface WatchRequest {
  readonly after: ViewCursor
}

/** Long-poll result; changed=false is the ordinary timeout case. */
export interface WatchResult {
  readonly cursor: ViewCursor
  readonly changed: boolean
}

/** Entity-scoped feedback mutation. */
export interface FeedbackRequest {
  readonly requestId: RequestId
  readonly sourceSessionId: SessionId
  readonly explanationId: ExplanationId
  readonly revision: number
  readonly action: 'understood' | 'not-understood'
}

/** Entity-scoped Topic reopen mutation. */
export interface ReopenTopicRequest {
  readonly requestId: RequestId
  readonly topicId: TopicId
  readonly expectedTopicRevision: number
}

/** Stable business failure returned across the typed Remote. */
export interface ExplainMutationFailure {
  readonly code: 'EXPLAIN_DISABLED' | 'REQUEST_ID_CONFLICT' | 'STALE_EXPLANATION_REVISION' | 'STALE_TOPIC_REVISION' | 'TOPIC_NOT_MASTERED'
  readonly message: string
}

/** Accepted feedback state. */
export interface FeedbackMutationValue {
  readonly entry: ThreadEntryView
  readonly storeRevision: number
  readonly rephrasePending: boolean
}

/** Accepted Topic reopen state. */
export interface ReopenTopicValue {
  readonly entry: ThreadEntryView
  readonly storeRevision: number
}

/** Feedback mutation result with business failures kept out of transport errors. */
export type FeedbackMutationResult =
  | { readonly ok: true; readonly value: FeedbackMutationValue }
  | { readonly ok: false; readonly error: ExplainMutationFailure }

/** Topic reopen result with business failures kept out of transport errors. */
export type ReopenTopicResult =
  | { readonly ok: true; readonly value: ReopenTopicValue }
  | { readonly ok: false; readonly error: ExplainMutationFailure }
