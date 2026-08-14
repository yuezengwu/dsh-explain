import type { SessionId } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { CheckpointId, ExplanationId, ObservationId, TopicId } from './brands.ts'

/** Bounded, ephemeral source material from one completed top-level turn. */
export interface SourceCapsule {
  readonly sourceSessionId: SessionId
  readonly turn: number
  readonly endSeq: number
  readonly observedAt: number
  readonly cwdLabel?: string
  readonly userText: string
  readonly assistantText: string
  readonly tools: readonly { readonly name: string; readonly resultPreview?: string }[]
  readonly truncated: boolean
}

/** Persisted explicit origin; `suggested` is read-only compatibility for M6 v10 rows. */
export type ExplanationOrigin = 'manual' | 'selection' | 'answer' | 'suggested'

/** One explicit learning request paired with bounded context from its source Session. */
export interface ManualExplainTarget {
  readonly origin: Exclude<ExplanationOrigin, 'suggested'>
  readonly request: string
  readonly capsule: SourceCapsule
}

/** Fixed private summary retained only for revision-one rephrasing. */
export interface PersistedSourceSummary {
  readonly userText: string
  readonly toolNames: readonly string[]
  readonly cwdLabel?: string
  readonly truncated: boolean
}

/** Bounded explanation fields shared by autonomous and rephrase outputs. */
export interface ExplanationContent {
  readonly title: string
  readonly what: string
  readonly why: string
  readonly pitfall: string
}

/** Strict model result for an explicit learning request. */
export interface ManualExplanation extends ExplanationContent {
  readonly topicKey: string
}

/** One model-inferred observation accepted beside an autonomous decision. */
export type ContextObservation =
  | {
    readonly kind: 'dialogue-preference'
    readonly dimension: 'verbosity' | 'structure' | 'examples' | 'terminology'
    readonly value: string
    readonly confidence: 'low' | 'medium' | 'high'
  }
  | {
    readonly kind: 'topic-familiarity'
    readonly topicKey: string
    readonly level: 'unknown' | 'beginner' | 'working' | 'advanced'
    readonly confidence: 'low' | 'medium' | 'high'
  }

/** Strict autonomous model result. */
export type ExplainDecision = ({
  readonly kind: 'skip'
  readonly reason: 'already-known' | 'not-useful' | 'insufficient-context'
} | ({
  readonly kind: 'explain'
  readonly topicKey: string
} & ExplanationContent)) & { readonly contextObservations: readonly ContextObservation[] }

/** Provider facts stored only after a successful auxiliary result commits. */
export interface GenerationRecord {
  readonly provider: string
  readonly model: string
  readonly generatedAt: number
  readonly usage?: TokenUsage
}

/** Lease fencing identity held by one host runtime. */
export interface LeaseToken {
  readonly ownerId: string
  readonly generation: number
}

/** Durable rephrase target reconstructed without the source Session. */
export interface RephraseTarget {
  readonly explanationId: ExplanationId
  readonly topicId: TopicId
  readonly topicKey: string
  readonly sourceSessionId: SessionId
  readonly sourceTurn: number
  readonly revision: number
  readonly feedbackOrdinal: number
  readonly sourceSummary: PersistedSourceSummary
  readonly origin: 'autonomous' | ExplanationOrigin
  readonly revisions: readonly ({ readonly revision: number } & ExplanationContent)[]
}

/** Internal context observation with host-owned identity and source coordinates. */
export interface StoredContextObservation {
  readonly observationId: ObservationId
  readonly sourceSessionId: SessionId
  readonly sourceTurn: number
  readonly observation: ContextObservation
  readonly createdAt: number
}

/** One closed explanation reduced to safe display fields for compaction. */
export interface ClosedExplanationContext {
  readonly explanationId: ExplanationId
  readonly topicKey: string
  readonly topicTitle: string
  readonly entryOrdinals: readonly number[]
  readonly revisions: readonly ({ readonly revision: number } & ExplanationContent)[]
  readonly feedback: readonly { readonly ordinal: number; readonly action: 'understood' | 'not-understood' }[]
}

/** Latest active explanation state that must remain verbatim in every request. */
export interface ActiveExplanationContext extends ClosedExplanationContext {
  readonly sourceSessionId: SessionId
  readonly activeRevision: number
}

/** Latest full model-authored global context checkpoint. */
export interface ExplainContextSnapshot {
  readonly dialogueProfile: readonly {
    readonly kind: 'verbosity' | 'structure' | 'examples' | 'terminology'
    readonly preference: string
    readonly confidence: 'low' | 'medium' | 'high'
    readonly evidenceObservationIds: readonly ObservationId[]
    readonly evidenceEntryOrdinals: readonly number[]
  }[]
  readonly knowledgeOverview: string
  readonly learningTrend: string
}

/** Context checkpoint with host generation metadata. */
export interface StoredCheckpoint {
  readonly checkpointId: CheckpointId
  readonly generation: number
  readonly throughOrdinal: number
  readonly context: ExplainContextSnapshot
  readonly createdAt: number
}

/** Uncovered inputs captured for one compaction request. */
export interface CompactionBatch {
  readonly contextGeneration: number
  readonly activityGeneration: number
  readonly previous?: StoredCheckpoint
  readonly observations: readonly StoredContextObservation[]
  readonly explanations: readonly ClosedExplanationContext[]
  readonly throughOrdinal: number
}

/** Database-generated Topic hint used by every auxiliary request. */
export interface TopicHint {
  readonly topicKey: string
  readonly title: string
  readonly state: 'learning' | 'mastered'
  readonly active: boolean
  readonly topicRevision: number
}

/** Complete private baseline used to render autonomous and rephrase requests. */
export interface AuxiliaryContext {
  readonly checkpoint?: StoredCheckpoint
  readonly topicHints: readonly TopicHint[]
  readonly activeExplanations: readonly ActiveExplanationContext[]
  readonly uncoveredObservations: readonly StoredContextObservation[]
  readonly uncoveredClosedExplanations: readonly ClosedExplanationContext[]
}
