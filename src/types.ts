import type { SessionId } from '@deepseek-ai/dsh-session'
import type { EntryId, ExplanationId, ObservationId, RequestId, TopicId } from './brands.ts'

export type { EntryId, ExplanationId, ObservationId, RequestId, TopicId } from './brands.ts'

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
  readonly storeRevision: number
  readonly cursor: ViewCursor
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
