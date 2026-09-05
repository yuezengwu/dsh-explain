import { redactLearningData, redactSensitiveText } from './privacy.ts'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { SessionId, type SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import {
  AutoRequestId,
  CheckpointId,
  EntryId,
  ExplanationId,
  ObservationId,
  RequestId,
  ReviewBatchId,
  ReviewId,
  TopicId,
} from './brands.ts'
import type {
  AuxiliaryContext,
  ClosedExplanationContext,
  CompactionBatch,
  ContextObservation,
  ExplainContextSnapshot,
  ExplainDecision,
  ExplanationContent,
  ExplanationOrigin,
  GenerationRecord,
  LearnerProfileControl,
  LeaseToken,
  ManualExplanation,
  ManualExplainTarget,
  PersistedSourceSummary,
  RephraseTarget,
  ReviewEvaluation,
  ReviewEvaluationTarget,
  SourceCapsule,
  StoredCheckpoint,
  StoredContextObservation,
  TopicHint,
} from './domain.ts'
import type {
  ClearedLearningDataCounts,
  DialoguePreferenceView,
  ExplainDataExportV3,
  ExplainContextStats,
  ExplainContextView,
  ExplainMutationFailure,
  FeedbackMutationResult,
  FeedbackRequest,
  ReopenTopicRequest,
  ReopenTopicResult,
  LearnerProfileAuditEventView,
  LearnerProfileEvidenceView,
  ReviewAttemptView,
  ReviewDashboardView,
  ReviewQuestionKind,
  ReviewQuestionView,
  ReviewResult,
  StartReviewRequest,
  SubmitReviewAnswerRequest,
  ThreadEntryView,
  ThreadPageRequest,
  ThreadPageResult,
  TopicFamiliarityView,
  UpdateLearnerProfileRequest,
  UpdateLearnerProfileResult,
  ViewCursor,
  WatchResult,
} from './types.ts'
import {
  CREATE_SCHEMA_SQL,
  MIGRATE_V2_TO_V3_SQL,
  MIGRATE_V3_TO_V4_SQL,
  SCHEMA_VERSION,
} from './schema.ts'

// Keep review enrollment in topics.state; expose current learning evidence consistently
// without a schema migration or dropping a weak topic's existing review schedule.
const TOPIC_LEARNING_STATE = `CASE
  WHEN EXISTS(SELECT 1 FROM explanations active WHERE active.topic_id = t.topic_id AND active.state = 'active')
    OR EXISTS(SELECT 1 FROM review_state review WHERE review.topic_id = t.topic_id AND review.last_result IN ('partial', 'forgotten'))
  THEN 'learning' ELSE t.state END`

const DAY_MS = 24 * 60 * 60 * 1_000
const DEFAULT_PAGE_LIMIT = 30
const MAX_PAGE_LIMIT = 100
const WATCH_TIMEOUT_MS = 25_000
const DIALOGUE_DIMENSIONS = new Set(['verbosity', 'structure', 'examples', 'terminology'])
const TOPIC_FAMILIARITY_LEVELS = new Set(['unknown', 'beginner', 'working', 'advanced'])

interface MetaRow {
  schema_version: number
  store_revision: number
  next_ordinal: number
}

interface CountRow {
  count: number
}

interface EntryRow {
  entry_id: string
  ordinal: number
  kind: 'explanation' | 'feedback' | 'topic-reopen'
  explanation_id: string | null
  explanation_state: 'active' | 'closed' | null
  topic_id: string
  topic_key: string
  topic_title: string
  topic_state: 'learning' | 'mastered'
  topic_revision: number
  revision: number | null
  source_session_id: string | null
  source_turn: number | null
  payload_json: string
  created_at: number
}

interface ExplanationTargetRow {
  explanation_id: string
  source_session_id: string
  state: 'active' | 'closed'
  active_revision: number
  rephrase_pending: 0 | 1
  topic_id: string
  topic_state: 'learning' | 'mastered'
}

interface TopicTargetRow {
  topic_id: string
  state: 'learning' | 'mastered'
  topic_revision: number
}

interface CheckpointRow {
  checkpoint_id?: string
  generation?: number
  through_ordinal?: number
  context_json: string
  created_at: number
}

interface CheckpointPayload {
  dialogueProfile?: unknown
  knowledgeOverview?: unknown
  learningTrend?: unknown
}

interface RequestReplayRow {
  fingerprint: string
  entry_id: string
}

interface LeaseRow {
  owner_id: string
  generation: number
  expires_at: number
}

interface RuntimeStateRow {
  first_explain_output_at: number | null
  last_user_action_at: number | null
  activity_generation: number
  last_compacted_at: number | null
  context_generation: number
}

interface AutoBudgetRow {
  count: number
  earliest: number | null
}

interface TopicRow {
  topic_id: string
  topic_key: string
  title: string
  state: 'learning' | 'mastered'
  topic_revision: number
  active: number
}

interface ObservationRow {
  observation_id: string
  source_session_id: string
  source_turn: number
  kind: ContextObservation['kind']
  payload_json: string
  confidence: 'low' | 'medium' | 'high'
  created_at: number
}

interface ProfileOverrideRow {
  target_kind: 'dialogue-preference' | 'topic-familiarity'
  target_key: string
  value: string
  authority: 'correction' | 'explicit'
  source_observation_id: string | null
  updated_at: number
}

interface ProfileSuppressionRow {
  target_kind: 'dialogue-preference' | 'topic-familiarity'
  target_key: string
  through_created_at: number
  updated_at: number
}

interface ProfileEventRow {
  event_id: string
  target_kind: 'dialogue-preference' | 'topic-familiarity'
  target_key: string
  action: 'set' | 'forget'
  value: string | null
  authority: 'correction' | 'explicit' | null
  source_observation_id: string | null
  created_at: number
}

interface ExplanationContextRow {
  explanation_id: string
  topic_key: string
  topic_title: string
  source_session_id: string
  active_revision: number
  state: 'active' | 'closed'
}

interface ContextEntryRow {
  ordinal: number
  kind: 'explanation' | 'feedback'
  revision: number
  payload_json: string
}

interface RephraseRow extends ExplanationContextRow {
  topic_id: string
  source_turn: number
  feedback_ordinal: number
}

interface ReviewSourceRow {
  topic_id: string
  topic_title: string
  explanation_id: string
  active_revision: number
  source_session_id: string
  source_turn: number
  payload_json: string
}

interface ReviewAttemptRow {
  review_id: string
  batch_id: string
  position: number
  total: number
  topic_id: string
  topic_title: string
  question_kind: ReviewQuestionKind
  question: string
  source_session_id: string
  source_turn: number
  answer: string | null
  result: ReviewResult | null
  feedback: string | null
  created_at: number
  completed_at: number | null
  next_review_at: number | null
}

interface ReviewStateRow {
  stage: number
  streak: number
}

interface ReviewRequestRow {
  fingerprint: string
  review_id: string
}

export type PrepareReviewAnswerResult =
  | { readonly ok: true; readonly kind: 'evaluate'; readonly target: ReviewEvaluationTarget }
  | { readonly ok: true; readonly kind: 'replay'; readonly attempt: ReviewAttemptView }
  | { readonly ok: false; readonly code: 'REQUEST_ID_CONFLICT' | 'REVIEW_STALE'; readonly message: string }

/** Rolling autonomous-request budget state. */
export interface AutoBudgetStatus {
  readonly used: number
  readonly resumeAt?: number
}

/** Outcome of atomically reserving one provider attempt. */
export type AutoReservation =
  | { readonly ok: true; readonly autoRequestId: ReturnType<typeof AutoRequestId> }
  | { readonly ok: false; readonly resumeAt: number }

/** Outcome of accepting a model decision under current Topic/source state. */
export interface AutoCommitResult {
  readonly committed: boolean
  readonly entry?: ThreadEntryView
}

/** Internal CAS outcome used while the scheduler owns the destructive-operation fence. */
export type StoreClearLearningDataResult =
  | {
      readonly ok: true
      readonly cleared: ClearedLearningDataCounts
      readonly preservedAutoRequests: number
      readonly storeRevision: number
    }
  | { readonly ok: false; readonly actualStoreRevision: number }

/** Outcome of committing one explicit explanation under source and Topic gates. */
export type ManualCommitResult =
  | { readonly ok: true; readonly entry: ThreadEntryView }
  | { readonly ok: false; readonly reason: 'source-active' | 'topic-active' }

/** Corrupt revision-one data that prevents a source-independent rephrase. */
export class SourceSummaryError extends Error {
  readonly code = 'EXPLAIN_SOURCE_SUMMARY_INVALID'

  constructor(
    readonly explanationId: string,
    readonly revision: number,
    options?: ErrorOptions,
  ) {
    super('The saved source summary for this explanation is invalid.', options)
    this.name = 'SourceSummaryError'
  }
}

/** Fixture-only input used by store and Remote integration tests. */
export interface FixtureExplanationInput {
  readonly topicKey: string
  readonly title: string
  readonly sourceSessionId: SessionIdType
  readonly sourceTurn: number
  readonly state?: 'active' | 'closed'
  readonly topicState?: 'learning' | 'mastered'
  readonly revisions?: readonly {
    readonly title: string
    readonly what: string
    readonly why: string
    readonly pitfall: string
  }[]
  readonly userText?: string
  readonly toolNames?: readonly string[]
  readonly cwdLabel?: string
}

/** One local SQLite learning thread and its process-local view notifications. */
export class ExplainStore {
  readonly incarnation = randomUUID()
  private readonly database: DatabaseSync
  private readonly listeners = new Set<() => void>()
  private viewRevision = 0
  private closed = false

  /** Open or create one versioned learning database. */
  constructor(readonly databasePath: string) {
    const memory = databasePath === ':memory:'
    if (!memory) {
      const directory = dirname(databasePath)
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      if (process.platform !== 'win32') chmodSync(directory, 0o700)
    }
    this.database = new DatabaseSync(databasePath)
    try {
      if (!memory && process.platform !== 'win32') chmodSync(databasePath, 0o600)
      this.database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
      if (!memory) this.database.exec('PRAGMA journal_mode = WAL;')
      this.initialize()
    } catch (error) {
      this.database.close()
      throw error
    }
  }

  /** Current process-local cursor. */
  cursor(): ViewCursor {
    return { incarnation: this.incarnation, revision: this.viewRevision }
  }

  /** Current persistent store revision. */
  storeRevision(): number {
    return this.meta().store_revision
  }

  /** Count active explanations across every source Session. */
  activeExplanationCount(): number {
    return this.count('SELECT COUNT(*) AS count FROM explanations WHERE state = \'active\'')
  }

  /** Count autonomous requests sent in the rolling 24-hour window. */
  autoRequestsUsed(now = Date.now()): number {
    return this.count(
      'SELECT COUNT(*) AS count FROM auto_request_usage WHERE started_at > ?',
      now - DAY_MS,
    )
  }

  /** Read rolling autonomous usage and the first instant a full window slot reopens. */
  autoBudget(limit: number, now = Date.now()): AutoBudgetStatus {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count, MIN(started_at) AS earliest
      FROM auto_request_usage WHERE started_at > ?
    `).get(now - DAY_MS) as unknown as AutoBudgetRow
    return {
      used: row.count,
      ...(row.count < limit || row.earliest === null ? {} : { resumeAt: row.earliest + DAY_MS }),
    }
  }

  /** Current persisted activity/compaction clocks and dirty generations. */
  runtimeState(): {
    readonly firstExplainOutputAt?: number
    readonly lastUserActionAt?: number
    readonly activityGeneration: number
    readonly lastCompactedAt?: number
    readonly contextGeneration: number
  } {
    const row = this.runtimeStateRow()
    return {
      ...(row.first_explain_output_at === null ? {} : { firstExplainOutputAt: row.first_explain_output_at }),
      ...(row.last_user_action_at === null ? {} : { lastUserActionAt: row.last_user_action_at }),
      activityGeneration: row.activity_generation,
      ...(row.last_compacted_at === null ? {} : { lastCompactedAt: row.last_compacted_at }),
      contextGeneration: row.context_generation,
    }
  }

  /** Source Sessions currently blocked by their own active explanation. */
  activeSources(): ReadonlySet<SessionIdType> {
    const rows = this.database.prepare(`
      SELECT source_session_id FROM explanations WHERE state = 'active'
    `).all() as unknown as { source_session_id: string }[]
    return new Set(rows.map(row => SessionId(row.source_session_id)))
  }

  /** Acquire the process runtime lease or refuse another unexpired owner. */
  acquireLease(ownerId: string, now = Date.now(), ttlMs = 15_000): LeaseToken {
    return this.write(() => {
      const row = this.leaseRow()
      if (row !== undefined && row.owner_id !== ownerId && row.expires_at > now) {
        throw new Error('dsh-explain: another host runtime holds the explainer lease')
      }
      const generation = (row?.generation ?? 0) + 1
      this.database.prepare(`
        INSERT INTO runtime_lease(name, owner_id, generation, expires_at)
        VALUES ('explainer', ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET owner_id = excluded.owner_id,
          generation = excluded.generation, expires_at = excluded.expires_at
      `).run(ownerId, generation, now + ttlMs)
      return { ownerId, generation }
    })
  }

  /** Renew only the exact owner/generation; false means fencing was lost. */
  renewLease(token: LeaseToken, now = Date.now(), ttlMs = 15_000): boolean {
    return this.write(() => this.database.prepare(`
      UPDATE runtime_lease SET expires_at = ?
      WHERE name = 'explainer' AND owner_id = ? AND generation = ?
    `).run(now + ttlMs, token.ownerId, token.generation).changes === 1)
  }

  /** Release only this runtime's fencing generation. */
  releaseLease(token: LeaseToken): void {
    this.write(() => {
      this.database.prepare(`
        DELETE FROM runtime_lease WHERE name = 'explainer' AND owner_id = ? AND generation = ?
      `).run(token.ownerId, token.generation)
    })
  }

  /** Persist one autonomous attempt before provider dispatch. */
  reserveAutoRequest(
    token: LeaseToken,
    capsule: SourceCapsule,
    provider: string,
    model: string,
    attempt: number,
    limit: number,
    now = Date.now(),
  ): AutoReservation {
    return this.write(() => {
      this.assertLease(token, now)
      this.database.prepare('DELETE FROM auto_request_usage WHERE started_at <= ?').run(now - DAY_MS)
      const budget = this.autoBudget(limit, now)
      if (budget.used >= limit) {
        if (budget.resumeAt === undefined) throw new Error('dsh-explain: exhausted budget has no resume time')
        return { ok: false as const, resumeAt: budget.resumeAt }
      }
      const autoRequestId = AutoRequestId(randomUUID())
      this.database.prepare(`
        INSERT INTO auto_request_usage(
          auto_request_id, source_session_id, provider, model, attempt, started_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(autoRequestId, capsule.sourceSessionId, provider, model, attempt, now)
      return { ok: true as const, autoRequestId }
    }, true)
  }

  /** Notify clients about runtime/queue/settings state without changing durable learning revision. */
  notifyRuntimeChange(): void { this.signalViewChange() }

  /** Persist the successful enable operation as the idle-compaction activity baseline. */
  recordEnableAction(now = Date.now()): void {
    this.write(() => {
      this.database.prepare(`
        UPDATE runtime_state
        SET last_user_action_at = ?, activity_generation = activity_generation + 1
        WHERE singleton = 1
      `).run(now)
    }, true)
  }

  /** Atomically accept one autonomous decision under current source/Topic gates. */
  commitAutoDecision(
    token: LeaseToken,
    capsule: SourceCapsule,
    decision: ExplainDecision,
    generation: GenerationRecord,
  ): AutoCommitResult {
    return this.write(() => {
      this.assertLease(token)
      if (this.hasActiveSource(capsule.sourceSessionId)) return { committed: false }
      let topicId: TopicId | undefined
      if (decision.kind === 'explain') {
        const existing = this.database.prepare(`
          SELECT t.topic_id, ${TOPIC_LEARNING_STATE} AS state,
            EXISTS(SELECT 1 FROM explanations e WHERE e.topic_id = t.topic_id AND e.state = 'active') AS active
          FROM topics t WHERE t.topic_key = ?
        `).get(decision.topicKey) as unknown as { topic_id: string; state: 'learning' | 'mastered'; active: number } | undefined
        if (existing?.state === 'mastered' || existing?.active === 1) return { committed: false }
        topicId = existing === undefined ? TopicId(randomUUID()) : TopicId(existing.topic_id)
      }

      const now = generation.generatedAt
      for (const observation of decision.contextObservations) {
        const observationId = ObservationId(randomUUID())
        const payload = observation.kind === 'dialogue-preference'
          ? { dimension: observation.dimension, value: observation.value }
          : { topicKey: observation.topicKey, level: observation.level }
        this.database.prepare(`
          INSERT INTO context_observations(
            observation_id, source_session_id, source_turn, kind, payload_json, confidence, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          observationId,
          capsule.sourceSessionId,
          capsule.turn,
          observation.kind,
          JSON.stringify(payload),
          observation.confidence,
          now,
        )
      }

      let entry: ThreadEntryView | undefined
      if (decision.kind === 'explain' && topicId !== undefined) {
        const topic = this.database.prepare('SELECT topic_id FROM topics WHERE topic_key = ?')
          .get(decision.topicKey)
        if (topic === undefined) {
          this.database.prepare(`
            INSERT INTO topics(topic_id, topic_key, title, state, topic_revision, updated_at)
            VALUES (?, ?, ?, 'learning', 1, ?)
          `).run(topicId, decision.topicKey, decision.title, now)
        } else {
          this.cancelActiveReviewForTopic(topicId, now)
          this.database.prepare(`
            UPDATE topics SET title = ?, topic_revision = topic_revision + 1, updated_at = ?
            WHERE topic_id = ?
          `).run(decision.title, now, topicId)
        }
        const explanationId = ExplanationId(randomUUID())
        this.database.prepare(`
          INSERT INTO explanations(
            explanation_id, topic_id, source_session_id, state, active_revision,
            rephrase_pending, created_at, updated_at
          ) VALUES (?, ?, ?, 'active', 1, 0, ?, ?)
        `).run(explanationId, topicId, capsule.sourceSessionId, now, now)
        const entryId = EntryId(randomUUID())
        const ordinal = this.takeOrdinal()
        this.database.prepare(`
          INSERT INTO entries(
            entry_id, ordinal, kind, explanation_id, topic_id, revision,
            source_session_id, source_turn, payload_json, created_at
          ) VALUES (?, ?, 'explanation', ?, ?, 1, ?, ?, ?, ?)
        `).run(
          entryId,
          ordinal,
          explanationId,
          topicId,
          capsule.sourceSessionId,
          capsule.turn,
          JSON.stringify({
            title: decision.title,
            what: decision.what,
            why: decision.why,
            pitfall: decision.pitfall,
            sourceSummary: sourceSummary(capsule),
            generation,
          }),
          now,
        )
        entry = this.entryById(entryId)
      }
      if (decision.contextObservations.length === 0 && entry === undefined) return { committed: true }
      this.database.prepare(`
        UPDATE runtime_state
        SET first_explain_output_at = COALESCE(first_explain_output_at, ?),
            context_generation = context_generation + ?
        WHERE singleton = 1
      `).run(now, decision.contextObservations.length > 0 ? 1 : 0)
      this.advanceStoreRevision()
      return { committed: true, ...(entry === undefined ? {} : { entry }) }
    })
  }

  /** Atomically accept one explicit explanation without consuming autonomous budget. */
  commitManualExplanation(
    token: LeaseToken,
    target: ManualExplainTarget,
    explanation: ManualExplanation,
    generation: GenerationRecord,
  ): ManualCommitResult {
    return this.write(() => {
      this.assertLease(token)
      const { capsule } = target
      if (this.hasActiveSource(capsule.sourceSessionId)) return { ok: false, reason: 'source-active' }
      const existing = this.database.prepare(`
        SELECT t.topic_id,
          EXISTS(SELECT 1 FROM explanations e WHERE e.topic_id = t.topic_id AND e.state = 'active') AS active
        FROM topics t WHERE t.topic_key = ?
      `).get(explanation.topicKey) as unknown as { topic_id: string; active: number } | undefined
      if (existing?.active === 1) return { ok: false, reason: 'topic-active' }

      const now = generation.generatedAt
      const topicId = existing === undefined ? TopicId(randomUUID()) : TopicId(existing.topic_id)
      if (existing === undefined) {
        this.database.prepare(`
          INSERT INTO topics(topic_id, topic_key, title, state, topic_revision, updated_at)
          VALUES (?, ?, ?, 'learning', 1, ?)
        `).run(topicId, explanation.topicKey, explanation.title, now)
      } else {
        this.cancelActiveReviewForTopic(topicId, now)
        this.database.prepare(`
          UPDATE topics
          SET title = ?, state = 'learning', topic_revision = topic_revision + 1, updated_at = ?
          WHERE topic_id = ?
        `).run(explanation.title, now, topicId)
      }
      const explanationId = ExplanationId(randomUUID())
      this.database.prepare(`
        INSERT INTO explanations(
          explanation_id, topic_id, source_session_id, state, active_revision,
          rephrase_pending, created_at, updated_at
        ) VALUES (?, ?, ?, 'active', 1, 0, ?, ?)
      `).run(explanationId, topicId, capsule.sourceSessionId, now, now)
      const entryId = EntryId(randomUUID())
      const ordinal = this.takeOrdinal()
      this.database.prepare(`
        INSERT INTO entries(
          entry_id, ordinal, kind, explanation_id, topic_id, revision,
          source_session_id, source_turn, payload_json, created_at
        ) VALUES (?, ?, 'explanation', ?, ?, 1, ?, ?, ?, ?)
      `).run(
        entryId,
        ordinal,
        explanationId,
        topicId,
        capsule.sourceSessionId,
        capsule.turn,
        JSON.stringify({
          title: explanation.title,
          what: explanation.what,
          why: explanation.why,
          pitfall: explanation.pitfall,
          origin: target.origin,
          sourceSummary: sourceSummary(capsule),
          generation,
        }),
        now,
      )
      this.database.prepare(`
        UPDATE runtime_state
        SET first_explain_output_at = COALESCE(first_explain_output_at, ?),
            last_user_action_at = ?, activity_generation = activity_generation + 1
        WHERE singleton = 1
      `).run(now, now)
      this.advanceStoreRevision()
      return { ok: true, entry: this.entryById(entryId) }
    })
  }

  /** Reconstruct every persistent rephrase target in feedback order. */
  pendingRephrases(excluded: ReadonlySet<string> = new Set()): readonly RephraseTarget[] {
    const rows = this.database.prepare(`
      SELECT x.explanation_id, x.topic_id, t.topic_key, t.title AS topic_title,
             x.source_session_id, x.active_revision, x.state,
             first.source_turn,
             MAX(feedback.ordinal) AS feedback_ordinal
      FROM explanations x
      JOIN topics t ON t.topic_id = x.topic_id
      JOIN entries first ON first.explanation_id = x.explanation_id
        AND first.kind = 'explanation' AND first.revision = 1
      JOIN entries feedback ON feedback.explanation_id = x.explanation_id
        AND feedback.kind = 'feedback'
        AND json_extract(feedback.payload_json, '$.action') = 'not-understood'
      WHERE x.state = 'active' AND x.rephrase_pending = 1
      GROUP BY x.explanation_id
      ORDER BY feedback_ordinal ASC
    `).all() as unknown as RephraseRow[]
    return rows
      .filter(row => !excluded.has(rephraseIdentity(row.explanation_id, row.active_revision)))
      .map(row => this.rephraseTarget(row))
  }

  /** Check rephrase state without parsing the private revision-one summary. */
  isRephrasePending(explanationId: string, revision: number): boolean {
    return this.database.prepare(`
      SELECT 1 FROM explanations
      WHERE explanation_id = ? AND state = 'active' AND active_revision = ? AND rephrase_pending = 1
    `).get(explanationId, revision) !== undefined
  }

  /** Append the next revision if its pending target and lease are unchanged. */
  commitRephrase(
    token: LeaseToken,
    target: RephraseTarget,
    content: ExplanationContent,
    generation: GenerationRecord,
  ): ThreadEntryView | undefined {
    return this.write(() => {
      this.assertLease(token)
      const current = this.database.prepare(`
        SELECT state, active_revision, rephrase_pending FROM explanations WHERE explanation_id = ?
      `).get(target.explanationId) as unknown as {
        state: 'active' | 'closed'; active_revision: number; rephrase_pending: 0 | 1
      } | undefined
      if (current === undefined || current.state !== 'active'
        || current.active_revision !== target.revision || current.rephrase_pending !== 1) return undefined
      const revision = target.revision + 1
      const now = generation.generatedAt
      const entryId = EntryId(randomUUID())
      const ordinal = this.takeOrdinal()
      this.database.prepare(`
        INSERT INTO entries(
          entry_id, ordinal, kind, explanation_id, topic_id, revision,
          source_session_id, source_turn, payload_json, created_at
        ) VALUES (?, ?, 'explanation', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entryId,
        ordinal,
        target.explanationId,
        target.topicId,
        revision,
        target.sourceSessionId,
        target.sourceTurn,
        JSON.stringify({
          ...content,
          ...(target.origin === 'autonomous' ? {} : { origin: target.origin }),
          generation,
        }),
        now,
      )
      this.database.prepare(`
        UPDATE explanations SET active_revision = ?, rephrase_pending = 0, updated_at = ?
        WHERE explanation_id = ?
      `).run(revision, now, target.explanationId)
      this.database.prepare(`
        UPDATE topics SET title = ?, topic_revision = topic_revision + 1, updated_at = ?
        WHERE topic_id = ?
      `).run(content.title, now, target.topicId)
      this.advanceStoreRevision()
      return this.entryById(entryId)
    })
  }

  /** Read the complete private context input used by auxiliary requests. */
  auxiliaryContext(maxTopicHints: number): AuxiliaryContext {
    const checkpoint = this.latestCheckpoint()
    return {
      ...(checkpoint === undefined ? {} : { checkpoint }),
      topicHints: this.topicHints(maxTopicHints),
      uncoveredObservations: this.uncoveredObservations(),
      uncoveredClosedExplanations: this.closedExplanationContexts(),
      learnerProfileControls: this.learnerProfileControls(),
    }
  }

  /** Capture all currently uncovered inputs for one fenced compaction attempt. */
  compactionBatch(): CompactionBatch | undefined {
    const state = this.runtimeStateRow()
    const observations = this.uncoveredObservations()
    const explanations = this.closedExplanationContexts()
    if (observations.length === 0 && explanations.length === 0) return undefined
    const ordinals = explanations.flatMap(explanation => explanation.entryOrdinals)
    const previous = this.latestCheckpoint()
    const previousThroughOrdinal = previous?.throughOrdinal ?? 0
    return {
      contextGeneration: state.context_generation,
      activityGeneration: state.activity_generation,
      ...(previous === undefined ? {} : { previous }),
      observations,
      explanations,
      learnerProfileControls: this.learnerProfileControls(),
      throughOrdinal: ordinals.length === 0
        ? previousThroughOrdinal
        : Math.max(previousThroughOrdinal, ...ordinals),
    }
  }

  /** Commit one full checkpoint and its exact coverage set. */
  commitCheckpoint(
    token: LeaseToken,
    batch: CompactionBatch,
    trigger: 'idle' | 'pressure',
    requestId: string,
    snapshot: ExplainContextSnapshot,
    generationRecord: GenerationRecord,
  ): StoredCheckpoint | undefined {
    return this.write(() => {
      this.assertLease(token)
      const state = this.runtimeStateRow()
      if (state.context_generation !== batch.contextGeneration) return undefined
      const latest = this.latestCheckpoint()
      if ((latest?.generation ?? 0) !== (batch.previous?.generation ?? 0)) return undefined
      for (const explanation of batch.explanations) {
        const row = this.database.prepare(`
          SELECT state FROM explanations WHERE explanation_id = ?
        `).get(explanation.explanationId) as unknown as { state: string } | undefined
        if (row?.state !== 'closed') return undefined
      }
      const allowedObservations = new Set<string>([
        ...(batch.previous?.context.dialogueProfile.flatMap(item => item.evidenceObservationIds) ?? []),
        ...batch.observations.map(item => item.observationId),
      ])
      const allowedOrdinals = new Set<number>([
        ...(batch.previous?.context.dialogueProfile.flatMap(item => item.evidenceEntryOrdinals) ?? []),
        ...batch.explanations.flatMap(item => item.entryOrdinals),
      ])
      for (const profile of snapshot.dialogueProfile) {
        for (const observationId of profile.evidenceObservationIds) {
          if (!allowedObservations.has(observationId)
            || this.database.prepare('SELECT 1 FROM context_observations WHERE observation_id = ?')
              .get(observationId) === undefined) return undefined
        }
        for (const ordinal of profile.evidenceEntryOrdinals) {
          if (!allowedOrdinals.has(ordinal)
            || this.database.prepare('SELECT 1 FROM entries WHERE ordinal = ?').get(ordinal) === undefined) {
            return undefined
          }
        }
      }
      const previousGeneration = latest?.generation ?? 0
      const checkpointId = CheckpointId(randomUUID())
      const generation = previousGeneration + 1
      const now = generationRecord.generatedAt
      this.database.prepare(`
        INSERT INTO context_checkpoints(
          checkpoint_id, generation, trigger, through_ordinal, context_json,
          model_json, created_at, request_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        checkpointId,
        generation,
        trigger,
        batch.throughOrdinal,
        JSON.stringify(snapshot),
        JSON.stringify(generationRecord),
        now,
        requestId,
      )
      const coverExplanation = this.database.prepare(`
        INSERT INTO context_coverage(checkpoint_id, explanation_id) VALUES (?, ?)
      `)
      for (const explanation of batch.explanations) coverExplanation.run(checkpointId, explanation.explanationId)
      const coverObservation = this.database.prepare(`
        INSERT INTO observation_coverage(checkpoint_id, observation_id) VALUES (?, ?)
      `)
      for (const observation of batch.observations) coverObservation.run(checkpointId, observation.observationId)
      this.database.prepare(`
        UPDATE runtime_state SET last_compacted_at = ? WHERE singleton = 1
      `).run(now)
      this.advanceStoreRevision()
      return { checkpointId, generation, throughOrdinal: batch.throughOrdinal, context: snapshot, createdAt: now }
    })
  }

  /** Page backward through append-only entries without exposing sourceSummary. */
  threadPage(request: ThreadPageRequest): ThreadPageResult {
    const limit = request.limit ?? DEFAULT_PAGE_LIMIT
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
      throw new RangeError(`dsh-explain: page limit must be an integer from 1 to ${MAX_PAGE_LIMIT}`)
    }
    if (request.beforeOrdinal !== undefined
      && (!Number.isInteger(request.beforeOrdinal) || request.beforeOrdinal < 1)) {
      throw new RangeError('dsh-explain: beforeOrdinal must be a positive integer')
    }
    const rows = this.database.prepare(`
      SELECT e.entry_id, e.ordinal, e.kind, e.explanation_id,
             x.state AS explanation_state, e.topic_id,
             t.topic_key, t.title AS topic_title, ${TOPIC_LEARNING_STATE} AS topic_state,
             t.topic_revision, e.revision, e.source_session_id, e.source_turn,
             e.payload_json, e.created_at
      FROM entries e
      JOIN topics t ON t.topic_id = e.topic_id
      LEFT JOIN explanations x ON x.explanation_id = e.explanation_id
      WHERE (? IS NULL OR e.ordinal < ?)
      ORDER BY e.ordinal DESC
      LIMIT ?
    `).all(request.beforeOrdinal ?? null, request.beforeOrdinal ?? null, limit + 1) as unknown as EntryRow[]
    return {
      entries: rows.slice(0, limit).map(row => this.entryView(row)),
      hasMore: rows.length > limit,
      storeRevision: this.storeRevision(),
    }
  }

  /** Read every current active revision independently of historical pagination. */
  activeEntries(): readonly ThreadEntryView[] {
    const rows = this.database.prepare(`
      SELECT e.entry_id, e.ordinal, e.kind, e.explanation_id,
             x.state AS explanation_state, e.topic_id,
             t.topic_key, t.title AS topic_title, ${TOPIC_LEARNING_STATE} AS topic_state,
             t.topic_revision, e.revision, e.source_session_id, e.source_turn,
             e.payload_json, e.created_at
      FROM explanations x
      JOIN entries e ON e.explanation_id = x.explanation_id
        AND e.kind = 'explanation' AND e.revision = x.active_revision
      JOIN topics t ON t.topic_id = x.topic_id
      WHERE x.state = 'active'
      ORDER BY e.ordinal DESC
    `).all() as unknown as EntryRow[]
    return rows.map(row => this.entryView(row))
  }

  /** Export public learning fields with best-effort sensitive-text filtering. */
  exportData(exportedAt = Date.now()): ExplainDataExportV3 {
    const rows = this.database.prepare(`
      SELECT e.entry_id, e.ordinal, e.kind, e.explanation_id,
             x.state AS explanation_state, e.topic_id,
             t.topic_key, t.title AS topic_title, ${TOPIC_LEARNING_STATE} AS topic_state,
             t.topic_revision, e.revision, e.source_session_id, e.source_turn,
             e.payload_json, e.created_at
      FROM entries e
      JOIN topics t ON t.topic_id = e.topic_id
      LEFT JOIN explanations x ON x.explanation_id = e.explanation_id
      ORDER BY e.ordinal ASC
    `).all() as unknown as EntryRow[]
    return redactLearningData({
      format: 'dsh-explain-backup',
      version: 3,
      exportedAt,
      databaseSchemaVersion: SCHEMA_VERSION,
      storeRevision: this.storeRevision(),
      data: {
        entries: rows.map(row => this.entryView(row)),
        context: this.context(),
        review: {
          dashboard: this.reviewDashboard(exportedAt),
          attempts: this.reviewAttempts(),
        },
        profileAudit: this.profileAudit(),
      },
    })
  }

  /** Read due counts, the durable active question, and recent outcomes. */
  reviewDashboard(now = Date.now()): ReviewDashboardView {
    const current = this.currentReviewQuestion()
    const nextDue = this.database.prepare(`
      SELECT MIN(rs.next_review_at) AS value
      FROM review_state rs JOIN topics t ON t.topic_id = rs.topic_id
      WHERE t.state = 'mastered' AND rs.next_review_at > ?
    `).get(now) as unknown as { value: number | null }
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return {
      dueCount: this.count(`
        SELECT COUNT(*) AS count FROM review_state rs
        JOIN topics t ON t.topic_id = rs.topic_id
        WHERE t.state = 'mastered' AND rs.next_review_at <= ?
          AND NOT EXISTS(SELECT 1 FROM explanations x WHERE x.topic_id = t.topic_id AND x.state = 'active')
      `, now),
      weakCount: this.count(`
        SELECT COUNT(*) AS count FROM review_state rs
        JOIN topics t ON t.topic_id = rs.topic_id
        WHERE t.state = 'mastered' AND rs.last_result IN ('partial', 'forgotten')
      `),
      newCount: this.count(`
        SELECT COUNT(*) AS count FROM review_state rs
        JOIN topics t ON t.topic_id = rs.topic_id
        WHERE t.state = 'mastered' AND rs.last_reviewed_at IS NULL
      `),
      completedCount: this.count(`
        SELECT COUNT(*) AS count FROM review_attempts
        WHERE completed_at >= ? AND completed_at <= ?
      `, start.getTime(), now),
      ...(nextDue.value === null ? {} : { nextDueAt: nextDue.value }),
      ...(current === undefined ? {} : { current }),
      recent: this.reviewAttempts(8),
    }
  }

  /** Start or resume a durable round with at most three currently due mastered topics. */
  startReview(request: StartReviewRequest, now = Date.now()): {
    readonly created: boolean
    readonly dashboard: ReviewDashboardView
  } {
    assertRequestId(request.requestId)
    return this.write(() => {
      if (this.currentReviewQuestion() !== undefined) {
        return { created: false, dashboard: this.reviewDashboard(now) }
      }
      this.discardOrphanedActiveReview(now)
      const due = this.database.prepare(`
        SELECT t.topic_id
        FROM review_state rs JOIN topics t ON t.topic_id = rs.topic_id
        WHERE t.state = 'mastered' AND rs.next_review_at <= ?
          AND NOT EXISTS(SELECT 1 FROM explanations x WHERE x.topic_id = t.topic_id AND x.state = 'active')
        ORDER BY rs.next_review_at ASC, t.updated_at ASC, t.topic_id ASC
        LIMIT 3
      `).all(now) as unknown as { topic_id: string }[]
      if (due.length === 0) return { created: false, dashboard: this.reviewDashboard(now) }
      const batchId = ReviewBatchId(randomUUID())
      this.database.prepare(`
        INSERT INTO review_batches(batch_id, state, created_at) VALUES (?, 'active', ?)
      `).run(batchId, now)
      for (const [index, item] of due.entries()) {
        const source = this.reviewSource(item.topic_id)
        const previous = this.database.prepare(`
          SELECT question_kind, result FROM review_attempts
          WHERE topic_id = ? AND completed_at IS NOT NULL
          ORDER BY completed_at DESC, created_at DESC, review_id DESC LIMIT 1
        `).get(item.topic_id) as { question_kind: ReviewQuestionKind; result: ReviewResult } | undefined
        const kind = previous === undefined ? 'recall'
          : previous.result !== 'mastered' ? previous.question_kind
          : previous.question_kind === 'recall' ? 'application'
          : previous.question_kind === 'application' ? 'distinction' : 'recall'
        this.database.prepare(`
          INSERT INTO review_attempts(
            review_id, batch_id, position, topic_id, explanation_id, explanation_revision,
            question_kind, question, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          ReviewId(randomUUID()), batchId, index + 1, source.topic_id, source.explanation_id,
          source.active_revision, kind, reviewQuestion(kind, source.topic_title), now,
        )
      }
      this.advanceStoreRevision()
      return { created: true, dashboard: this.reviewDashboard(now) }
    })
  }

  /** Validate an exact answer and reconstruct the private explanation rubric. */
  prepareReviewAnswer(request: SubmitReviewAnswerRequest): PrepareReviewAnswerResult {
    assertRequestId(request.requestId)
    const answer = request.answer.trim()
    const fingerprint = reviewFingerprint(request.reviewId, answer)
    const replay = this.database.prepare(`
      SELECT fingerprint, review_id FROM review_mutation_requests WHERE request_id = ?
    `).get(request.requestId) as unknown as ReviewRequestRow | undefined
    if (replay !== undefined) {
      if (replay.fingerprint !== fingerprint) {
        return { ok: false, code: 'REQUEST_ID_CONFLICT', message: 'The request id already belongs to a different review answer.' }
      }
      const attempt = this.reviewAttemptById(ReviewId(replay.review_id))
      if (attempt === undefined || attempt.answer === undefined) {
        throw new Error('dsh-explain: committed review replay is missing')
      }
      return { ok: true, kind: 'replay', attempt }
    }
    const row = this.database.prepare(`
      SELECT ra.review_id, ra.question, ra.question_kind, ra.position,
             t.title AS topic_title, e.payload_json
      FROM review_attempts ra
      JOIN review_batches rb ON rb.batch_id = ra.batch_id
      JOIN topics t ON t.topic_id = ra.topic_id
      JOIN entries e ON e.explanation_id = ra.explanation_id
        AND e.kind = 'explanation' AND e.revision = ra.explanation_revision
      WHERE ra.review_id = ? AND ra.answer IS NULL AND rb.state = 'active'
        AND t.state = 'mastered'
        AND ra.position = (SELECT MIN(p.position) FROM review_attempts p
          WHERE p.batch_id = ra.batch_id AND p.answer IS NULL)
      LIMIT 1
    `).get(request.reviewId) as unknown as {
      review_id: string
      question: string
      question_kind: ReviewQuestionKind
      topic_title: string
      payload_json: string
    } | undefined
    if (row === undefined) {
      return { ok: false, code: 'REVIEW_STALE', message: 'This review question is no longer active.' }
    }
    return {
      ok: true,
      kind: 'evaluate',
      target: {
        reviewId: ReviewId(row.review_id),
        question: row.question,
        kind: row.question_kind,
        answer,
        topicTitle: row.topic_title,
        explanation: explanationContent(row.payload_json),
      },
    }
  }

  /** Commit one successful semantic evaluation and its deterministic next due date. */
  commitReviewAnswer(
    request: SubmitReviewAnswerRequest,
    evaluation: ReviewEvaluation,
    generation: GenerationRecord,
    now = Date.now(),
  ): { readonly ok: true; readonly attempt: ReviewAttemptView; readonly dashboard: ReviewDashboardView }
    | { readonly ok: false; readonly code: 'REQUEST_ID_CONFLICT' | 'REVIEW_STALE'; readonly message: string } {
    return this.write(() => {
      const prepared = this.prepareReviewAnswer(request)
      if (!prepared.ok) return prepared
      if (prepared.kind === 'replay') {
        return { ok: true as const, attempt: prepared.attempt, dashboard: this.reviewDashboard(now) }
      }
      const state = this.database.prepare(`
        SELECT rs.stage, rs.streak FROM review_attempts ra
        JOIN review_state rs ON rs.topic_id = ra.topic_id WHERE ra.review_id = ?
      `).get(request.reviewId) as unknown as ReviewStateRow | undefined
      if (state === undefined) {
        return { ok: false as const, code: 'REVIEW_STALE' as const, message: 'This review schedule no longer exists.' }
      }
      const next = nextReviewState(state, evaluation.result, now)
      const answer = request.answer.trim()
      const updated = this.database.prepare(`
        UPDATE review_attempts SET answer = ?, result = ?, feedback = ?, generation_json = ?,
          completed_at = ?, next_review_at = ?
        WHERE review_id = ? AND answer IS NULL
      `).run(answer, evaluation.result, evaluation.feedback, JSON.stringify(generation), now, next.nextReviewAt, request.reviewId)
      if (updated.changes !== 1) {
        return { ok: false as const, code: 'REVIEW_STALE' as const, message: 'This review question is no longer active.' }
      }
      this.database.prepare(`
        UPDATE review_state SET stage = ?, streak = ?, next_review_at = ?, last_reviewed_at = ?,
          last_result = ?, updated_at = ?
        WHERE topic_id = (SELECT topic_id FROM review_attempts WHERE review_id = ?)
      `).run(next.stage, next.streak, next.nextReviewAt, now, evaluation.result, now, request.reviewId)
      this.database.prepare(`
        UPDATE topics SET topic_revision = topic_revision + 1, updated_at = ?
        WHERE topic_id = (SELECT topic_id FROM review_attempts WHERE review_id = ?)
      `).run(now, request.reviewId)
      this.database.prepare(`
        INSERT INTO review_mutation_requests(request_id, fingerprint, review_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(request.requestId, reviewFingerprint(request.reviewId, answer), request.reviewId, now)
      this.database.prepare(`
        UPDATE review_batches SET state = 'completed', completed_at = ?
        WHERE batch_id = (SELECT batch_id FROM review_attempts WHERE review_id = ?)
          AND NOT EXISTS (
            SELECT 1 FROM review_attempts pending
            WHERE pending.batch_id = review_batches.batch_id AND pending.answer IS NULL
          )
      `).run(now, request.reviewId)
      this.database.prepare(`
        UPDATE runtime_state
        SET activity_generation = activity_generation + 1,
            context_generation = context_generation + 1, last_user_action_at = ?
        WHERE singleton = 1
      `).run(now)
      this.advanceStoreRevision()
      const attempt = this.reviewAttemptById(request.reviewId)
      if (attempt === undefined || attempt.answer === undefined) throw new Error('dsh-explain: committed review is missing')
      return { ok: true as const, attempt, dashboard: this.reviewDashboard(now) }
    })
  }

  /** Apply one idempotent, revision-fenced learner-profile correction without invoking a model. */
  updateLearnerProfile(request: UpdateLearnerProfileRequest, now = Date.now()): UpdateLearnerProfileResult {
    const invalid = profileRequestError(request)
    if (invalid !== undefined) return { ok: false, error: { code: 'PROFILE_INVALID', message: invalid } }
    const fingerprint = profileFingerprint(request)
    return this.write(() => {
      const replay = this.database.prepare(`
        SELECT fingerprint FROM learner_profile_events WHERE request_id = ?
      `).get(request.requestId) as unknown as { fingerprint: string } | undefined
      if (replay !== undefined) {
        return replay.fingerprint === fingerprint
          ? { ok: true as const, context: this.context(), storeRevision: this.storeRevision() }
          : {
              ok: false as const,
              error: {
                code: 'REQUEST_ID_CONFLICT' as const,
                message: 'The request id already belongs to a different learner-profile change.',
              },
            }
      }
      if (this.storeRevision() !== request.expectedStoreRevision) {
        return {
          ok: false as const,
          error: { code: 'STORE_STALE' as const, message: 'Learning data changed; refresh before editing the profile.' },
        }
      }
      if (request.sourceObservationId !== undefined
        && !this.observationMatchesTarget(request.sourceObservationId, request.targetKind, request.targetKey)) {
        return {
          ok: false as const,
          error: { code: 'PROFILE_INVALID' as const, message: 'The selected source does not support this profile field.' },
        }
      }
      const existing = this.database.prepare(`
        SELECT authority FROM learner_profile_overrides WHERE target_kind = ? AND target_key = ?
      `).get(request.targetKind, request.targetKey) as unknown as { authority: 'correction' | 'explicit' } | undefined
      if (request.action === 'set' && request.authority === 'correction' && existing?.authority === 'explicit') {
        return {
          ok: false as const,
          error: {
            code: 'PROFILE_EXPLICIT_PRECEDENCE' as const,
            message: 'An explicit preference already has priority over inferred corrections.',
          },
        }
      }
      if (request.action === 'set') {
        this.database.prepare(`
          INSERT INTO learner_profile_overrides(
            target_kind, target_key, value, authority, source_observation_id, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(target_kind, target_key) DO UPDATE SET
            value = excluded.value,
            authority = excluded.authority,
            source_observation_id = excluded.source_observation_id,
            updated_at = excluded.updated_at
        `).run(
          request.targetKind,
          request.targetKey,
          request.value!.trim(),
          request.authority!,
          request.sourceObservationId ?? null,
          now,
        )
        this.database.prepare(`
          DELETE FROM learner_profile_suppressions WHERE target_kind = ? AND target_key = ?
        `).run(request.targetKind, request.targetKey)
      } else {
        this.database.prepare(`
          DELETE FROM learner_profile_overrides WHERE target_kind = ? AND target_key = ?
        `).run(request.targetKind, request.targetKey)
        this.database.prepare(`
          INSERT INTO learner_profile_suppressions(target_kind, target_key, through_created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(target_kind, target_key) DO UPDATE SET
            through_created_at = MAX(through_created_at, excluded.through_created_at),
            updated_at = excluded.updated_at
        `).run(request.targetKind, request.targetKey, now, now)
      }
      this.database.prepare(`
        INSERT INTO learner_profile_events(
          event_id, request_id, fingerprint, target_kind, target_key, action,
          value, authority, source_observation_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        request.requestId,
        fingerprint,
        request.targetKind,
        request.targetKey,
        request.action,
        request.value?.trim() ?? null,
        request.authority ?? null,
        request.sourceObservationId ?? null,
        now,
      )
      this.database.prepare(`
        UPDATE runtime_state
        SET context_generation = context_generation + 1, last_user_action_at = ?
        WHERE singleton = 1
      `).run(now)
      this.advanceStoreRevision()
      return { ok: true as const, context: this.context(), storeRevision: this.storeRevision() }
    })
  }

  /** Atomically clear learned content while preserving settings, request usage, and the live runtime lease. */
  clearLearningData(expectedStoreRevision: number): StoreClearLearningDataResult {
    if (!Number.isInteger(expectedStoreRevision) || expectedStoreRevision < 0) {
      throw new RangeError('dsh-explain: expected store revision must be a non-negative integer')
    }
    return this.write(() => {
      const actualStoreRevision = this.storeRevision()
      if (actualStoreRevision !== expectedStoreRevision) return { ok: false as const, actualStoreRevision }
      const cleared: ClearedLearningDataCounts = {
        entries: this.count('SELECT COUNT(*) AS count FROM entries'),
        topics: this.count('SELECT COUNT(*) AS count FROM topics'),
        explanations: this.count('SELECT COUNT(*) AS count FROM explanations'),
        observations: this.count('SELECT COUNT(*) AS count FROM context_observations'),
        checkpoints: this.count('SELECT COUNT(*) AS count FROM context_checkpoints'),
        reviewAttempts: this.count('SELECT COUNT(*) AS count FROM review_attempts'),
        profileChanges: this.count('SELECT COUNT(*) AS count FROM learner_profile_events'),
      }
      this.database.exec(`
        DELETE FROM learner_profile_events;
        DELETE FROM learner_profile_overrides;
        DELETE FROM learner_profile_suppressions;
        DELETE FROM review_mutation_requests;
        DELETE FROM review_attempts;
        DELETE FROM review_batches;
        DELETE FROM review_state;
        DELETE FROM mutation_requests;
        DELETE FROM context_coverage;
        DELETE FROM observation_coverage;
        DELETE FROM context_checkpoints;
        DELETE FROM context_observations;
        DELETE FROM entries;
        DELETE FROM explanations;
        DELETE FROM topics;
        UPDATE runtime_state SET
          first_explain_output_at = NULL,
          last_user_action_at = NULL,
          activity_generation = 0,
          last_compacted_at = NULL,
          context_generation = 0
        WHERE singleton = 1;
        UPDATE meta SET next_ordinal = 1, store_revision = store_revision + 1 WHERE singleton = 1;
      `)
      return {
        ok: true as const,
        cleared,
        preservedAutoRequests: this.autoRequestsUsed(),
        storeRevision: this.storeRevision(),
      }
    })
  }

  /** Read the latest model checkpoint plus database-authoritative statistics. */
  context(): ExplainContextView {
    const stats = this.contextStats()
    const checkpoint = this.database.prepare(`
      SELECT context_json, created_at
      FROM context_checkpoints
      ORDER BY generation DESC
      LIMIT 1
    `).get() as unknown as CheckpointRow | undefined
    const payload = checkpoint === undefined
      ? undefined
      : parseObject(checkpoint.context_json, 'context checkpoint') as CheckpointPayload
    const profile = payload === undefined ? [] : parseDialogueProfile(payload.dialogueProfile)
    return {
      ...(checkpoint === undefined ? {} : { generatedAt: checkpoint.created_at }),
      dialogueProfile: this.effectiveDialogueProfile(profile, checkpoint?.created_at),
      topicFamiliarities: this.effectiveTopicFamiliarities(),
      profileAudit: this.profileAudit(20),
      knowledgeOverview: payload === undefined ? '' : checkpointText(payload.knowledgeOverview, 'knowledgeOverview'),
      learningTrend: payload === undefined ? '' : checkpointText(payload.learningTrend, 'learningTrend'),
      stats,
      inferred: checkpoint !== undefined,
    }
  }

  /** Wait until the view cursor changes or the ordinary long-poll timeout elapses. */
  async watch(after: ViewCursor, signal: AbortSignal): Promise<WatchResult> {
    signal.throwIfAborted()
    if (after.incarnation !== this.incarnation || after.revision !== this.viewRevision) {
      return { cursor: this.cursor(), changed: true }
    }
    return await new Promise<WatchResult>((resolve, reject) => {
      let settled = false
      const finish = (result: WatchResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.listeners.delete(changed)
        resolve(result)
      }
      const changed = (): void => finish({ cursor: this.cursor(), changed: true })
      const abort = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.listeners.delete(changed)
        reject(signal.reason)
      }
      const timer = setTimeout(() => finish({ cursor: this.cursor(), changed: false }), WATCH_TIMEOUT_MS)
      this.listeners.add(changed)
      signal.addEventListener('abort', abort, { once: true })
      if (after.revision !== this.viewRevision) changed()
    })
  }

  /** Commit understood/not-understood feedback with request idempotency and Explanation revision CAS. */
  feedback(request: FeedbackRequest): FeedbackMutationResult {
    assertRequestId(request.requestId)
    if (!Number.isInteger(request.revision) || request.revision < 1) {
      throw new RangeError('dsh-explain: feedback revision must be a positive integer')
    }
    const result = this.write(() => {
      const fingerprint = feedbackFingerprint(request)
      const replay = this.requestReplay(request.requestId)
      if (replay !== undefined) {
        if (replay.fingerprint !== fingerprint) {
          return failure('REQUEST_ID_CONFLICT', 'The request id already belongs to a different mutation.')
        }
        return {
          ok: true as const,
          value: {
            entry: this.entryById(EntryId(replay.entry_id)),
            storeRevision: this.storeRevision(),
            rephrasePending: request.action === 'not-understood',
          },
        }
      }
      const target = this.database.prepare(`
        SELECT e.explanation_id, e.source_session_id, e.state, e.active_revision, e.rephrase_pending,
               e.topic_id, t.state AS topic_state
        FROM explanations e
        JOIN topics t ON t.topic_id = e.topic_id
        WHERE e.explanation_id = ?
      `).get(request.explanationId) as unknown as ExplanationTargetRow | undefined
      if (target === undefined
        || target.source_session_id !== request.sourceSessionId
        || target.state !== 'active'
        || target.active_revision !== request.revision) {
        return failure('STALE_EXPLANATION_REVISION', 'The explanation revision is no longer active.')
      }
      if (target.rephrase_pending !== 0) {
        if (request.action === 'not-understood') {
          const duplicate = this.database.prepare(`
            SELECT e.entry_id
            FROM entries e
            WHERE e.explanation_id = ? AND e.revision = ? AND e.kind = 'feedback'
              AND json_extract(e.payload_json, '$.action') = 'not-understood'
            ORDER BY e.ordinal DESC LIMIT 1
          `).get(request.explanationId, request.revision) as unknown as { entry_id: string } | undefined
          if (duplicate === undefined) {
            throw new Error('dsh-explain: rephrase-pending explanation has no not-understood entry')
          }
          this.recordRequest(request.requestId, fingerprint, EntryId(duplicate.entry_id))
          return {
            ok: true as const,
            value: {
              entry: this.entryById(EntryId(duplicate.entry_id)),
              storeRevision: this.storeRevision(),
              rephrasePending: true,
            },
          }
        }
      }
      const entryId = EntryId(randomUUID())
      const ordinal = this.takeOrdinal()
      const now = Date.now()
      this.database.prepare(`
        INSERT INTO entries(
          entry_id, ordinal, kind, explanation_id, topic_id, revision,
          source_session_id, payload_json, created_at
        ) VALUES (?, ?, 'feedback', ?, ?, ?, ?, ?, ?)
      `).run(
        entryId,
        ordinal,
        request.explanationId,
        target.topic_id,
        request.revision,
        request.sourceSessionId,
        JSON.stringify({ action: request.action }),
        now,
      )
      this.recordRequest(request.requestId, fingerprint, entryId, now)
      if (request.action === 'understood') {
        this.database.prepare(`
          UPDATE explanations SET state = 'closed', rephrase_pending = 0, updated_at = ?
          WHERE explanation_id = ? AND state = 'active' AND active_revision = ?
        `).run(now, request.explanationId, request.revision)
        this.database.prepare(`
          UPDATE topics SET state = 'mastered', topic_revision = topic_revision + 1, updated_at = ?
          WHERE topic_id = ?
        `).run(now, target.topic_id)
        this.database.prepare(`
          INSERT INTO review_state(topic_id, stage, streak, next_review_at, updated_at)
          VALUES (?, 0, 0, ?, ?)
          ON CONFLICT(topic_id) DO UPDATE SET stage = 0, streak = 0,
            next_review_at = excluded.next_review_at, last_reviewed_at = NULL,
            last_result = NULL, updated_at = excluded.updated_at
        `).run(target.topic_id, now + DAY_MS, now)
        this.database.exec(`
          UPDATE runtime_state
          SET activity_generation = activity_generation + 1,
              context_generation = context_generation + 1,
              last_user_action_at = ${now}
          WHERE singleton = 1
        `)
      } else {
        this.database.prepare(`
          UPDATE explanations SET rephrase_pending = 1, updated_at = ?
          WHERE explanation_id = ? AND state = 'active' AND active_revision = ? AND rephrase_pending = 0
        `).run(now, request.explanationId, request.revision)
        this.database.exec(`
          UPDATE runtime_state
          SET activity_generation = activity_generation + 1,
              last_user_action_at = ${now}
          WHERE singleton = 1
        `)
      }
      const storeRevision = this.advanceStoreRevision()
      const entry = this.entryById(entryId)
      return {
        ok: true as const,
        value: { entry, storeRevision, rephrasePending: request.action === 'not-understood' },
      }
    })
    return result
  }

  /** Reopen a mastered Topic with Topic revision CAS. */
  reopenTopic(request: ReopenTopicRequest): ReopenTopicResult {
    assertRequestId(request.requestId)
    if (!Number.isInteger(request.expectedTopicRevision) || request.expectedTopicRevision < 1) {
      throw new RangeError('dsh-explain: expectedTopicRevision must be a positive integer')
    }
    return this.write(() => {
      const fingerprint = reopenFingerprint(request)
      const replay = this.requestReplay(request.requestId)
      if (replay !== undefined) {
        if (replay.fingerprint !== fingerprint) {
          return failure('REQUEST_ID_CONFLICT', 'The request id already belongs to a different mutation.')
        }
        return {
          ok: true as const,
          value: { entry: this.entryById(EntryId(replay.entry_id)), storeRevision: this.storeRevision() },
        }
      }
      const target = this.database.prepare(`
        SELECT topic_id, state, topic_revision FROM topics WHERE topic_id = ?
      `).get(request.topicId) as unknown as TopicTargetRow | undefined
      if (target === undefined || target.topic_revision !== request.expectedTopicRevision) {
        return failure('STALE_TOPIC_REVISION', 'The topic revision has changed.')
      }
      if (target.state !== 'mastered') {
        return failure('TOPIC_NOT_MASTERED', 'Only a mastered topic can be reopened.')
      }
      const entryId = EntryId(randomUUID())
      const ordinal = this.takeOrdinal()
      const now = Date.now()
      this.database.prepare(`
        UPDATE topics SET state = 'learning', topic_revision = topic_revision + 1, updated_at = ?
        WHERE topic_id = ? AND state = 'mastered' AND topic_revision = ?
      `).run(now, request.topicId, request.expectedTopicRevision)
      this.cancelActiveReviewForTopic(request.topicId, now)
      this.database.prepare(`
        INSERT INTO entries(entry_id, ordinal, kind, topic_id, payload_json, created_at)
        VALUES (?, ?, 'topic-reopen', ?, ?, ?)
      `).run(entryId, ordinal, request.topicId, JSON.stringify({ action: 'reopen' }), now)
      this.recordRequest(request.requestId, fingerprint, entryId, now)
      this.database.exec(`
        UPDATE runtime_state
        SET activity_generation = activity_generation + 1,
            last_user_action_at = ${now}
        WHERE singleton = 1
      `)
      const storeRevision = this.advanceStoreRevision()
      return { ok: true as const, value: { entry: this.entryById(entryId), storeRevision } }
    })
  }

  /** Add deterministic-shape fixture data through the same schema used by production. Tests only. */
  addFixtureExplanation(input: FixtureExplanationInput): ExplanationId {
    return this.write(() => {
      if (!/^[a-z0-9._/-]{1,80}$/.test(input.topicKey) || input.topicKey.split('/').some(part => part === '')) {
        throw new Error('dsh-explain: fixture topicKey is invalid')
      }
      const revisions = input.revisions ?? [{
        title: input.title,
        what: `What ${input.title} means.`,
        why: `Why ${input.title} matters.`,
        pitfall: `A common ${input.title} pitfall.`,
      }]
      if (revisions.length === 0) throw new Error('dsh-explain: fixture requires one revision')
      const topicId = TopicId(randomUUID())
      const explanationId = ExplanationId(randomUUID())
      const now = Date.now()
      const latest = revisions.at(-1)!
      this.database.prepare(`
        INSERT INTO topics(topic_id, topic_key, title, state, topic_revision, updated_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `).run(topicId, input.topicKey, latest.title, input.topicState ?? 'learning', now)
      if (input.topicState === 'mastered') {
        this.database.prepare(`
          INSERT INTO review_state(topic_id, stage, streak, next_review_at, updated_at)
          VALUES (?, 0, 0, ?, ?)
        `).run(topicId, now, now)
      }
      this.database.prepare(`
        INSERT INTO explanations(
          explanation_id, topic_id, source_session_id, state, active_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        explanationId,
        topicId,
        input.sourceSessionId,
        input.state ?? 'active',
        revisions.length,
        now,
        now,
      )
      revisions.forEach((revision, index) => {
        const ordinal = this.takeOrdinal()
        const sourceSummary = index === 0 ? {
          userText: (input.userText ?? `Learn ${input.title}`).slice(0, 2_000),
          toolNames: [...new Set(input.toolNames ?? [])].slice(0, 32),
          ...(input.cwdLabel === undefined ? {} : { cwdLabel: input.cwdLabel.slice(0, 160) }),
          truncated: (input.userText?.length ?? 0) > 2_000 || (input.toolNames?.length ?? 0) > 32,
        } : undefined
        this.database.prepare(`
          INSERT INTO entries(
            entry_id, ordinal, kind, explanation_id, topic_id, revision,
            source_session_id, source_turn, payload_json, created_at
          ) VALUES (?, ?, 'explanation', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          EntryId(randomUUID()),
          ordinal,
          explanationId,
          topicId,
          index + 1,
          input.sourceSessionId,
          input.sourceTurn,
          JSON.stringify({ ...revision, ...(sourceSummary === undefined ? {} : { sourceSummary }) }),
          now + index,
        )
      })
      this.database.prepare(`
        UPDATE runtime_state
        SET first_explain_output_at = COALESCE(first_explain_output_at, ?),
            context_generation = context_generation + 1
        WHERE singleton = 1
      `).run(now)
      this.advanceStoreRevision()
      return explanationId
    })
  }

  /** Close the SQLite handle and reject future writes. */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const listener of [...this.listeners]) listener()
    this.listeners.clear()
    this.database.close()
  }

  private runtimeStateRow(): RuntimeStateRow {
    const row = this.database.prepare(`
      SELECT first_explain_output_at, last_user_action_at, activity_generation,
             last_compacted_at, context_generation
      FROM runtime_state WHERE singleton = 1
    `).get() as unknown as RuntimeStateRow | undefined
    if (row === undefined) throw new Error('dsh-explain: database runtime_state row is missing')
    return row
  }

  private leaseRow(): LeaseRow | undefined {
    return this.database.prepare(`
      SELECT owner_id, generation, expires_at FROM runtime_lease WHERE name = 'explainer'
    `).get() as unknown as LeaseRow | undefined
  }

  private assertLease(token: LeaseToken, now = Date.now()): void {
    const row = this.leaseRow()
    if (row === undefined || row.owner_id !== token.ownerId || row.generation !== token.generation
      || row.expires_at <= now) {
      throw new Error('dsh-explain: runtime lease fencing token is no longer valid')
    }
  }

  private hasActiveSource(sourceSessionId: SessionIdType): boolean {
    return this.database.prepare(`
      SELECT 1 FROM explanations WHERE source_session_id = ? AND state = 'active' LIMIT 1
    `).get(sourceSessionId) !== undefined
  }

  private latestCheckpoint(): StoredCheckpoint | undefined {
    const row = this.database.prepare(`
      SELECT checkpoint_id, generation, through_ordinal, context_json, created_at
      FROM context_checkpoints ORDER BY generation DESC LIMIT 1
    `).get() as unknown as Required<CheckpointRow> | undefined
    if (row === undefined) return undefined
    return {
      checkpointId: CheckpointId(row.checkpoint_id),
      generation: row.generation,
      throughOrdinal: row.through_ordinal,
      context: parseContextSnapshot(row.context_json),
      createdAt: row.created_at,
    }
  }

  private learnerProfileControls(): readonly LearnerProfileControl[] {
    const overrides = this.database.prepare(`
      SELECT target_kind, target_key, value, authority, source_observation_id, updated_at
      FROM learner_profile_overrides ORDER BY target_kind, target_key
    `).all() as unknown as ProfileOverrideRow[]
    const suppressions = this.database.prepare(`
      SELECT target_kind, target_key, through_created_at, updated_at
      FROM learner_profile_suppressions ORDER BY target_kind, target_key
    `).all() as unknown as ProfileSuppressionRow[]
    return [
      ...overrides.map(row => ({
        targetKind: row.target_kind,
        targetKey: row.target_key,
        value: row.value,
        authority: row.authority,
        ...(row.source_observation_id === null
          ? {} : { sourceObservationId: ObservationId(row.source_observation_id) }),
        updatedAt: row.updated_at,
      })),
      ...suppressions.map(row => ({
        targetKind: row.target_kind,
        targetKey: row.target_key,
        suppressInferencesThrough: row.through_created_at,
        updatedAt: row.updated_at,
      })),
    ]
  }

  private effectiveDialogueProfile(
    inferred: ExplainContextSnapshot['dialogueProfile'],
    checkpointCreatedAt?: number,
  ): readonly DialoguePreferenceView[] {
    const overrides = this.profileOverrides('dialogue-preference')
    const suppressions = this.profileSuppressions('dialogue-preference')
    const candidates = new Map<DialoguePreferenceView['kind'], DialoguePreferenceView>()
    for (const item of inferred) {
      const evidence = this.profileEvidence(item.evidenceObservationIds, item.evidenceEntryOrdinals)
      candidates.set(item.kind, { ...item, authority: 'inferred', evidence })
    }
    const observationRows = this.database.prepare(`
      SELECT observation_id, source_session_id, source_turn, kind,
             payload_json, confidence, created_at
      FROM context_observations WHERE kind = 'dialogue-preference'
      ORDER BY created_at DESC, observation_id DESC
    `).all() as unknown as ObservationRow[]
    const newestObservations = new Set<string>()
    for (const row of observationRows) {
      const observation = parseStoredObservation(row)
      if (observation.kind !== 'dialogue-preference' || newestObservations.has(observation.dimension)) continue
      newestObservations.add(observation.dimension)
      if (checkpointCreatedAt !== undefined && row.created_at <= checkpointCreatedAt) continue
      candidates.set(observation.dimension, {
        kind: observation.dimension,
        preference: observation.value,
        confidence: observation.confidence,
        evidenceObservationIds: [ObservationId(row.observation_id)],
        evidenceEntryOrdinals: [],
        authority: 'inferred',
        evidence: [{
          observationId: ObservationId(row.observation_id),
          sourceSessionId: SessionId(row.source_session_id),
          sourceTurn: row.source_turn,
          createdAt: row.created_at,
        }],
      })
    }
    const visible: DialoguePreferenceView[] = [...candidates.values()].filter((item) => {
      if (overrides.has(item.kind)) return false
      const suppressedThrough = suppressions.get(item.kind)
      return suppressedThrough === undefined
        || (item.evidence ?? []).some(source => source.createdAt > suppressedThrough)
    })
    for (const row of overrides.values()) {
      const evidenceObservationIds = row.source_observation_id === null
        ? [] : [ObservationId(row.source_observation_id)]
      visible.push({
        kind: row.target_key as DialoguePreferenceView['kind'],
        preference: row.value,
        confidence: 'high',
        evidenceObservationIds,
        evidenceEntryOrdinals: [],
        authority: row.authority,
        evidence: this.profileEvidence(evidenceObservationIds, []),
      })
    }
    const order = ['verbosity', 'structure', 'examples', 'terminology']
    return visible.sort((left, right) => order.indexOf(left.kind) - order.indexOf(right.kind))
  }

  private effectiveTopicFamiliarities(): readonly TopicFamiliarityView[] {
    const overrides = this.profileOverrides('topic-familiarity')
    const suppressions = this.profileSuppressions('topic-familiarity')
    const rows = this.database.prepare(`
      SELECT observation_id, source_session_id, source_turn, kind,
             payload_json, confidence, created_at
      FROM context_observations WHERE kind = 'topic-familiarity'
      ORDER BY created_at DESC, observation_id DESC
    `).all() as unknown as ObservationRow[]
    const result = new Map<string, TopicFamiliarityView>()
    for (const row of rows) {
      const observation = parseStoredObservation(row)
      if (observation.kind !== 'topic-familiarity' || result.has(observation.topicKey)
        || overrides.has(observation.topicKey)
        || row.created_at <= (suppressions.get(observation.topicKey) ?? -1)) continue
      result.set(observation.topicKey, {
        topicKey: observation.topicKey,
        level: observation.level,
        confidence: observation.confidence,
        authority: 'inferred',
        evidence: [{
          observationId: ObservationId(row.observation_id),
          sourceSessionId: SessionId(row.source_session_id),
          sourceTurn: row.source_turn,
          createdAt: row.created_at,
        }],
      })
    }
    for (const row of overrides.values()) {
      const evidenceObservationIds = row.source_observation_id === null
        ? [] : [ObservationId(row.source_observation_id)]
      result.set(row.target_key, {
        topicKey: row.target_key,
        level: row.value as TopicFamiliarityView['level'],
        confidence: 'high',
        authority: row.authority,
        evidence: this.profileEvidence(evidenceObservationIds, []),
      })
    }
    return [...result.values()].sort((left, right) => left.topicKey.localeCompare(right.topicKey))
  }

  private profileOverrides(kind: ProfileOverrideRow['target_kind']): Map<string, ProfileOverrideRow> {
    const rows = this.database.prepare(`
      SELECT target_kind, target_key, value, authority, source_observation_id, updated_at
      FROM learner_profile_overrides WHERE target_kind = ? ORDER BY target_key
    `).all(kind) as unknown as ProfileOverrideRow[]
    return new Map(rows.map(row => [row.target_key, row]))
  }

  private profileSuppressions(kind: ProfileSuppressionRow['target_kind']): Map<string, number> {
    const rows = this.database.prepare(`
      SELECT target_kind, target_key, through_created_at, updated_at
      FROM learner_profile_suppressions WHERE target_kind = ? ORDER BY target_key
    `).all(kind) as unknown as ProfileSuppressionRow[]
    return new Map(rows.map(row => [row.target_key, row.through_created_at]))
  }

  private profileEvidence(
    observationIds: readonly ObservationId[],
    entryOrdinals: readonly number[],
  ): readonly LearnerProfileEvidenceView[] {
    const observation = this.database.prepare(`
      SELECT source_session_id, source_turn, created_at
      FROM context_observations WHERE observation_id = ?
    `)
    const entry = this.database.prepare(`
      SELECT source_session_id, source_turn, created_at FROM entries WHERE ordinal = ?
    `)
    return [
      ...observationIds.flatMap((observationId) => {
        const row = observation.get(observationId) as unknown as {
          source_session_id: string; source_turn: number; created_at: number
        } | undefined
        return row === undefined ? [] : [{
          observationId,
          sourceSessionId: SessionId(row.source_session_id),
          sourceTurn: row.source_turn,
          createdAt: row.created_at,
        }]
      }),
      ...entryOrdinals.flatMap((entryOrdinal) => {
        const row = entry.get(entryOrdinal) as unknown as {
          source_session_id: string | null; source_turn: number | null; created_at: number
        } | undefined
        return row === undefined ? [] : [{
          entryOrdinal,
          ...(row.source_session_id === null ? {} : { sourceSessionId: SessionId(row.source_session_id) }),
          ...(row.source_turn === null ? {} : { sourceTurn: row.source_turn }),
          createdAt: row.created_at,
        }]
      }),
    ]
  }

  private profileAudit(limit?: number): readonly LearnerProfileAuditEventView[] {
    const rows = this.database.prepare(`
      SELECT event_id, target_kind, target_key, action,
             value, authority, source_observation_id, created_at
      FROM learner_profile_events ORDER BY created_at DESC, event_id DESC
      ${limit === undefined ? '' : 'LIMIT ?'}
    `).all(...(limit === undefined ? [] : [limit])) as unknown as ProfileEventRow[]
    return rows.map(row => ({
      eventId: row.event_id,
      targetKind: row.target_kind,
      targetKey: row.target_key,
      action: row.action,
      ...(row.value === null ? {} : { value: row.value }),
      ...(row.authority === null ? {} : { authority: row.authority }),
      ...(row.source_observation_id === null
        ? {} : { sourceObservationId: ObservationId(row.source_observation_id) }),
      createdAt: row.created_at,
    }))
  }

  private observationMatchesTarget(
    observationId: ObservationId,
    targetKind: UpdateLearnerProfileRequest['targetKind'],
    targetKey: string,
  ): boolean {
    const row = this.database.prepare(`
      SELECT observation_id, source_session_id, source_turn, kind, payload_json, confidence, created_at
      FROM context_observations WHERE observation_id = ?
    `).get(observationId) as unknown as ObservationRow | undefined
    if (row === undefined) return false
    const observation = parseStoredObservation(row)
    return observation.kind === targetKind && (observation.kind === 'dialogue-preference'
      ? observation.dimension === targetKey
      : observation.topicKey === targetKey)
  }

  private topicHints(limit: number): readonly TopicHint[] {
    const rows = this.database.prepare(`
      SELECT t.topic_id, t.topic_key, t.title, ${TOPIC_LEARNING_STATE} AS state, t.topic_revision,
             EXISTS(SELECT 1 FROM explanations e
               WHERE e.topic_id = t.topic_id AND e.state = 'active') AS active
      FROM topics t ORDER BY t.updated_at DESC LIMIT ?
    `).all(limit) as unknown as TopicRow[]
    return rows.map(row => ({
      topicKey: row.topic_key,
      title: row.title,
      state: row.state,
      active: row.active === 1,
      topicRevision: row.topic_revision,
    }))
  }

  private uncoveredObservations(): readonly StoredContextObservation[] {
    const rows = this.database.prepare(`
      SELECT o.observation_id, o.source_session_id, o.source_turn, o.kind,
             o.payload_json, o.confidence, o.created_at
      FROM context_observations o
      LEFT JOIN observation_coverage c ON c.observation_id = o.observation_id
      WHERE c.observation_id IS NULL
      ORDER BY o.created_at, o.observation_id
    `).all() as unknown as ObservationRow[]
    return rows.map(row => ({
      observationId: ObservationId(row.observation_id),
      sourceSessionId: SessionId(row.source_session_id),
      sourceTurn: row.source_turn,
      observation: parseStoredObservation(row),
      createdAt: row.created_at,
    }))
  }

  private closedExplanationContexts(): readonly ClosedExplanationContext[] {
    const rows = this.database.prepare(`
      SELECT x.explanation_id, t.topic_key, t.title AS topic_title,
             x.source_session_id, x.active_revision, x.state
      FROM explanations x JOIN topics t ON t.topic_id = x.topic_id
      LEFT JOIN context_coverage c ON c.explanation_id = x.explanation_id
      WHERE x.state = 'closed' AND c.explanation_id IS NULL
      ORDER BY x.created_at, x.explanation_id
    `).all() as unknown as ExplanationContextRow[]
    return rows.map((row) => {
      const entries = this.contextEntries(row.explanation_id)
      const revisions = entries.flatMap(entry => entry.kind === 'explanation'
        ? [{ revision: entry.revision, ...explanationContent(entry.payload_json) }]
        : [])
      const feedback = entries.flatMap(entry => entry.kind === 'feedback'
        ? [{ ordinal: entry.ordinal, action: feedbackAction(entry.payload_json) }]
        : [])
      const base: ClosedExplanationContext = {
        explanationId: ExplanationId(row.explanation_id),
        topicKey: row.topic_key,
        topicTitle: row.topic_title,
        entryOrdinals: entries.map(entry => entry.ordinal),
        revisions,
        feedback,
      }
      return base
    })
  }

  private contextEntries(explanationId: string): readonly ContextEntryRow[] {
    return this.database.prepare(`
      SELECT ordinal, kind, revision, payload_json FROM entries
      WHERE explanation_id = ? AND kind IN ('explanation', 'feedback')
      ORDER BY ordinal
    `).all(explanationId) as unknown as ContextEntryRow[]
  }

  private rephraseTarget(row: RephraseRow): RephraseTarget {
    const entries = this.contextEntries(row.explanation_id)
    const first = entries.find(entry => entry.kind === 'explanation' && entry.revision === 1)
    if (first === undefined) {
      throw new SourceSummaryError(row.explanation_id, row.active_revision, {
        cause: new Error('dsh-explain: rephrase target is missing revision 1'),
      })
    }
    const revisions = entries.flatMap(entry => entry.kind === 'explanation'
      ? [{ revision: entry.revision, ...explanationContent(entry.payload_json) }]
      : [])
    let summary: PersistedSourceSummary
    try {
      summary = persistedSourceSummary(first.payload_json)
    } catch (error) {
      throw new SourceSummaryError(row.explanation_id, row.active_revision, { cause: error })
    }
    return {
      explanationId: ExplanationId(row.explanation_id),
      topicId: TopicId(row.topic_id),
      topicKey: row.topic_key,
      sourceSessionId: SessionId(row.source_session_id),
      sourceTurn: row.source_turn,
      revision: row.active_revision,
      feedbackOrdinal: row.feedback_ordinal,
      sourceSummary: summary,
      origin: explanationOrigin(first.payload_json),
      revisions,
    }
  }

  private initialize(): void {
    const row = this.database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'
    `).get()
    if (row === undefined) {
      this.database.exec('BEGIN IMMEDIATE')
      try {
        this.database.exec(CREATE_SCHEMA_SQL)
        this.database.exec('COMMIT')
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      }
      return
    }
    let meta = this.meta()
    if (meta.schema_version === 2) {
      this.database.exec('BEGIN IMMEDIATE')
      try {
        this.database.exec(MIGRATE_V2_TO_V3_SQL)
        this.database.exec('COMMIT')
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      }
      meta = this.meta()
    }
    if (meta.schema_version === 3) {
      this.database.exec('BEGIN IMMEDIATE')
      try {
        this.database.exec(MIGRATE_V3_TO_V4_SQL)
        this.database.exec('COMMIT')
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      }
      meta = this.meta()
    }
    if (meta.schema_version !== SCHEMA_VERSION) {
      throw new Error(`dsh-explain: unsupported schema version ${meta.schema_version}; expected ${SCHEMA_VERSION}`)
    }
    const foreignKeys = this.database.prepare('PRAGMA foreign_key_check').all()
    if (foreignKeys.length > 0) throw new Error('dsh-explain: database foreign-key integrity check failed')
  }

  private meta(): MetaRow {
    const row = this.database.prepare(`
      SELECT schema_version, store_revision, next_ordinal FROM meta WHERE singleton = 1
    `).get() as unknown as MetaRow | undefined
    if (row === undefined) throw new Error('dsh-explain: database meta row is missing')
    return row
  }

  private count(sql: string, ...parameters: (string | number | null)[]): number {
    const row = this.database.prepare(sql).get(...parameters) as unknown as CountRow | undefined
    if (row === undefined || !Number.isInteger(row.count) || row.count < 0) {
      throw new Error('dsh-explain: invalid database count result')
    }
    return row.count
  }

  private contextStats(): ExplainContextStats {
    return {
      learningTopics: this.count(`SELECT COUNT(*) AS count FROM topics t WHERE (${TOPIC_LEARNING_STATE}) = 'learning'`),
      masteredTopics: this.count(`SELECT COUNT(*) AS count FROM topics t WHERE (${TOPIC_LEARNING_STATE}) = 'mastered'`),
      activeExplanations: this.activeExplanationCount(),
      understoodFeedback: this.count(`
        SELECT COUNT(*) AS count FROM entries
        WHERE kind = 'feedback' AND json_extract(payload_json, '$.action') = 'understood'
      `),
      notUnderstoodFeedback: this.count(`
        SELECT COUNT(*) AS count FROM entries
        WHERE kind = 'feedback' AND json_extract(payload_json, '$.action') = 'not-understood'
      `),
    }
  }

  private takeOrdinal(): number {
    const ordinal = this.meta().next_ordinal
    this.database.prepare('UPDATE meta SET next_ordinal = next_ordinal + 1 WHERE singleton = 1').run()
    return ordinal
  }

  private advanceStoreRevision(): number {
    this.database.prepare('UPDATE meta SET store_revision = store_revision + 1 WHERE singleton = 1').run()
    return this.storeRevision()
  }

  private write<T>(operation: () => T, notify = false): T {
    if (this.closed) throw new Error('dsh-explain: store is closed')
    const startingRevision = this.storeRevision()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      const changed = this.storeRevision() !== startingRevision
      this.database.exec('COMMIT')
      if (changed || notify) this.signalViewChange()
      return value
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private signalViewChange(): void {
    if (this.closed) return
    this.viewRevision += 1
    for (const listener of [...this.listeners]) listener()
  }

  private entryById(entryId: EntryId): ThreadEntryView {
    const row = this.entryRow('e.entry_id = ?', entryId)
    if (row === undefined) throw new Error(`dsh-explain: committed entry ${entryId} is missing`)
    return this.entryView(row)
  }

  private reviewSource(topicId: string): ReviewSourceRow {
    const row = this.database.prepare(`
      SELECT t.topic_id, t.title AS topic_title, x.explanation_id, x.active_revision,
             x.source_session_id, e.source_turn, e.payload_json
      FROM topics t
      JOIN explanations x ON x.topic_id = t.topic_id AND x.state = 'closed'
      JOIN entries e ON e.explanation_id = x.explanation_id AND e.kind = 'explanation'
        AND e.revision = x.active_revision
      WHERE t.topic_id = ?
      ORDER BY x.updated_at DESC, x.explanation_id DESC
      LIMIT 1
    `).get(topicId) as unknown as ReviewSourceRow | undefined
    if (row === undefined) throw new Error('dsh-explain: due topic has no closed explanation source')
    return row
  }

  private cancelActiveReviewForTopic(topicId: TopicId, now: number): void {
    const row = this.database.prepare(`
      SELECT rb.batch_id FROM review_batches rb
      JOIN review_attempts ra ON ra.batch_id = rb.batch_id
      WHERE rb.state = 'active' AND ra.topic_id = ? AND ra.answer IS NULL
      LIMIT 1
    `).get(topicId) as unknown as { batch_id: string } | undefined
    if (row === undefined) return
    this.database.prepare(`DELETE FROM review_attempts WHERE batch_id = ? AND answer IS NULL`).run(row.batch_id)
    this.database.prepare(`
      UPDATE review_batches SET state = 'completed', completed_at = ? WHERE batch_id = ? AND state = 'active'
    `).run(now, row.batch_id)
  }

  private discardOrphanedActiveReview(now: number): void {
    const row = this.database.prepare(`
      SELECT batch_id FROM review_batches WHERE state = 'active' LIMIT 1
    `).get() as unknown as { batch_id: string } | undefined
    if (row === undefined) return
    this.database.prepare(`DELETE FROM review_attempts WHERE batch_id = ? AND answer IS NULL`).run(row.batch_id)
    this.database.prepare(`
      UPDATE review_batches SET state = 'completed', completed_at = ? WHERE batch_id = ?
    `).run(now, row.batch_id)
  }

  private currentReviewQuestion(): ReviewQuestionView | undefined {
    const row = this.database.prepare(`${reviewAttemptSelect()}
      WHERE rb.state = 'active' AND ra.answer IS NULL
      ORDER BY ra.position ASC LIMIT 1
    `).get() as unknown as ReviewAttemptRow | undefined
    return row === undefined ? undefined : reviewQuestionView(row)
  }

  private reviewAttemptById(reviewId: ReviewId): ReviewAttemptView | undefined {
    const row = this.database.prepare(`${reviewAttemptSelect()}
      WHERE ra.review_id = ? AND ra.answer IS NOT NULL
      LIMIT 1
    `).get(reviewId) as unknown as ReviewAttemptRow | undefined
    return row === undefined ? undefined : reviewAttemptView(row)
  }

  private reviewAttempts(limit?: number): readonly ReviewAttemptView[] {
    const rows = this.database.prepare(`${reviewAttemptSelect()}
      WHERE ra.answer IS NOT NULL
      ORDER BY ra.completed_at DESC, ra.review_id DESC
      ${limit === undefined ? '' : 'LIMIT ?'}
    `).all(...(limit === undefined ? [] : [limit])) as unknown as ReviewAttemptRow[]
    return rows.map(reviewAttemptView)
  }

  private requestReplay(requestId: RequestId): RequestReplayRow | undefined {
    return this.database.prepare(`
      SELECT fingerprint, entry_id FROM mutation_requests WHERE request_id = ?
    `).get(requestId) as unknown as RequestReplayRow | undefined
  }

  private recordRequest(
    requestId: RequestId,
    fingerprint: string,
    entryId: EntryId,
    createdAt = Date.now(),
  ): void {
    this.database.prepare(`
      INSERT INTO mutation_requests(request_id, fingerprint, entry_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(requestId, fingerprint, entryId, createdAt)
  }

  private entryRow(predicate: string, value: string): EntryRow | undefined {
    return this.database.prepare(`
      SELECT e.entry_id, e.ordinal, e.kind, e.explanation_id,
             x.state AS explanation_state, e.topic_id,
             t.topic_key, t.title AS topic_title, ${TOPIC_LEARNING_STATE} AS topic_state,
             t.topic_revision, e.revision, e.source_session_id, e.source_turn,
             e.payload_json, e.created_at
      FROM entries e
      JOIN topics t ON t.topic_id = e.topic_id
      LEFT JOIN explanations x ON x.explanation_id = e.explanation_id
      WHERE ${predicate}
      LIMIT 1
    `).get(value) as unknown as EntryRow | undefined
  }

  private entryView(row: EntryRow): ThreadEntryView {
    const payload = parseObject(row.payload_json, `entry ${row.entry_id}`)
    let publicPayload: ThreadEntryView['payload']
    if (row.kind === 'explanation') {
      const { title, what, why, pitfall } = payload
      publicPayload = {
        title: boundedStoredText(title, 'title', 120),
        what: boundedStoredText(what, 'what', 2_000),
        why: boundedStoredText(why, 'why', 2_000),
        pitfall: boundedStoredText(pitfall, 'pitfall', 2_000),
      }
    } else if (row.kind === 'feedback') {
      if (payload.action !== 'understood' && payload.action !== 'not-understood') {
        throw new Error(`dsh-explain: feedback entry ${row.entry_id} has an invalid payload`)
      }
      publicPayload = { action: payload.action }
    } else {
      if (payload.action !== 'reopen') throw new Error(`dsh-explain: reopen entry ${row.entry_id} has an invalid payload`)
      publicPayload = { action: 'reopen' }
    }
    return {
      entryId: EntryId(row.entry_id),
      ordinal: row.ordinal,
      kind: row.kind,
      ...(row.explanation_id === null ? {} : { explanationId: ExplanationId(row.explanation_id) }),
      ...(row.explanation_state === null ? {} : { explanationState: row.explanation_state }),
      topicId: TopicId(row.topic_id),
      topicKey: row.topic_key,
      topicTitle: row.topic_title,
      topicState: row.topic_state,
      topicRevision: row.topic_revision,
      ...(row.revision === null ? {} : { revision: row.revision }),
      ...(row.kind === 'explanation' && explanationOrigin(row.payload_json) !== 'autonomous'
        ? { origin: explanationOrigin(row.payload_json) as ExplanationOrigin } : {}),
      ...(row.source_session_id === null ? {} : { sourceSessionId: SessionId(row.source_session_id) }),
      ...(row.source_turn === null ? {} : { sourceTurn: row.source_turn }),
      payload: publicPayload,
      createdAt: row.created_at,
    }
  }
}

function parseDialogueProfile(value: unknown): ExplainContextSnapshot['dialogueProfile'] {
  if (!Array.isArray(value) || value.length > 16) {
    throw new Error('dsh-explain: context checkpoint dialogueProfile must contain at most 16 items')
  }
  return value.map((candidate, index) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`dsh-explain: dialogueProfile item ${index + 1} must be an object`)
    }
    const item = candidate as Record<string, unknown>
    const keys = Object.keys(item).sort()
    const expectedKeys = [
      'confidence',
      'evidenceEntryOrdinals',
      'evidenceObservationIds',
      'kind',
      'preference',
    ]
    if (keys.length !== expectedKeys.length || keys.some((key, keyIndex) => key !== expectedKeys[keyIndex])) {
      throw new Error(`dsh-explain: dialogueProfile item ${index + 1} has unexpected fields`)
    }
    if (item.kind !== 'verbosity' && item.kind !== 'structure'
      && item.kind !== 'examples' && item.kind !== 'terminology') {
      throw new Error(`dsh-explain: dialogueProfile item ${index + 1} has an invalid kind`)
    }
    if (item.confidence !== 'low' && item.confidence !== 'medium' && item.confidence !== 'high') {
      throw new Error(`dsh-explain: dialogueProfile item ${index + 1} has invalid confidence`)
    }
    if (typeof item.preference !== 'string' || item.preference.length === 0 || item.preference.length > 240) {
      throw new Error(`dsh-explain: dialogueProfile item ${index + 1} has an invalid preference`)
    }
    if (!Array.isArray(item.evidenceObservationIds) || item.evidenceObservationIds.length > 8
      || item.evidenceObservationIds.some(identity => typeof identity !== 'string' || identity.length === 0)) {
      throw new Error(`dsh-explain: dialogueProfile item ${index + 1} has invalid observation evidence`)
    }
    if (!Array.isArray(item.evidenceEntryOrdinals) || item.evidenceEntryOrdinals.length > 8
      || item.evidenceEntryOrdinals.some(ordinal => !Number.isInteger(ordinal) || (ordinal as number) < 1)) {
      throw new Error(`dsh-explain: dialogueProfile item ${index + 1} has invalid entry evidence`)
    }
    return {
      kind: item.kind,
      preference: item.preference,
      confidence: item.confidence,
      evidenceObservationIds: item.evidenceObservationIds.map(identity => ObservationId(identity as string)),
      evidenceEntryOrdinals: item.evidenceEntryOrdinals as number[],
    }
  })
}

function parseContextSnapshot(value: string): ExplainContextSnapshot {
  const payload = parseObject(value, 'context checkpoint') as CheckpointPayload
  return {
    dialogueProfile: parseDialogueProfile(payload.dialogueProfile),
    knowledgeOverview: checkpointText(payload.knowledgeOverview, 'knowledgeOverview'),
    learningTrend: checkpointText(payload.learningTrend, 'learningTrend'),
  }
}

function parseStoredObservation(row: ObservationRow): ContextObservation {
  const payload = parseObject(row.payload_json, `observation ${row.observation_id}`)
  if (row.kind === 'dialogue-preference') {
    if (payload.dimension !== 'verbosity' && payload.dimension !== 'structure'
      && payload.dimension !== 'examples' && payload.dimension !== 'terminology') {
      throw new Error(`dsh-explain: observation ${row.observation_id} has invalid dimension`)
    }
    if (typeof payload.value !== 'string' || payload.value.length === 0 || payload.value.length > 240) {
      throw new Error(`dsh-explain: observation ${row.observation_id} has invalid value`)
    }
    return {
      kind: row.kind,
      dimension: payload.dimension,
      value: payload.value,
      confidence: row.confidence,
    }
  }
  if (row.kind !== 'topic-familiarity') {
    throw new Error(`dsh-explain: observation ${row.observation_id} has invalid kind`)
  }
  if (typeof payload.topicKey !== 'string' || !validTopicKey(payload.topicKey)) {
    throw new Error(`dsh-explain: observation ${row.observation_id} has invalid topicKey`)
  }
  if (payload.level !== 'unknown' && payload.level !== 'beginner'
    && payload.level !== 'working' && payload.level !== 'advanced') {
    throw new Error(`dsh-explain: observation ${row.observation_id} has invalid familiarity level`)
  }
  return {
    kind: row.kind,
    topicKey: payload.topicKey,
    level: payload.level,
    confidence: row.confidence,
  }
}

function explanationContent(value: string): ExplanationContent {
  const payload = parseObject(value, 'explanation entry')
  return {
    title: boundedStoredText(payload.title, 'title', 120),
    what: boundedStoredText(payload.what, 'what', 2_000),
    why: boundedStoredText(payload.why, 'why', 2_000),
    pitfall: boundedStoredText(payload.pitfall, 'pitfall', 2_000),
  }
}

function explanationOrigin(value: string): 'autonomous' | ExplanationOrigin {
  const payload = parseObject(value, 'explanation entry')
  if (payload.origin === undefined) return 'autonomous'
  if (
    payload.origin === 'manual'
    || payload.origin === 'selection'
    || payload.origin === 'answer'
    || payload.origin === 'suggested'
  ) {
    return payload.origin
  }
  throw new Error('dsh-explain: explanation origin is invalid')
}

function feedbackAction(value: string): 'understood' | 'not-understood' {
  const payload = parseObject(value, 'feedback entry')
  if (payload.action !== 'understood' && payload.action !== 'not-understood') {
    throw new Error('dsh-explain: feedback entry has an invalid action')
  }
  return payload.action
}

function persistedSourceSummary(value: string): PersistedSourceSummary {
  const payload = parseObject(value, 'revision 1 explanation entry')
  const summary = payload.sourceSummary
  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new Error('dsh-explain: revision 1 sourceSummary is invalid')
  }
  const object = summary as Record<string, unknown>
  if (typeof object.userText !== 'string' || object.userText.length > 2_000
    || !Array.isArray(object.toolNames) || object.toolNames.length > 32
    || object.toolNames.some(name => typeof name !== 'string' || name.length === 0 || name.length > 160)
    || typeof object.truncated !== 'boolean'
    || (object.cwdLabel !== undefined
      && (typeof object.cwdLabel !== 'string' || object.cwdLabel.length > 160 || /[/\\]/.test(object.cwdLabel)))) {
    throw new Error('dsh-explain: revision 1 sourceSummary is invalid')
  }
  return {
    userText: object.userText,
    toolNames: object.toolNames as string[],
    ...(object.cwdLabel === undefined ? {} : { cwdLabel: object.cwdLabel as string }),
    truncated: object.truncated,
  }
}

function sourceSummary(capsule: SourceCapsule): PersistedSourceSummary {
  const normalized = redactSensitiveText(capsule.userText).replace(/\s+/g, ' ').trim()
  const user = privateBound(normalized, 2_000)
  const toolNames = [...new Set(capsule.tools.map(tool => tool.name.trim()).filter(name => name !== ''))]
  const boundedNames = toolNames.slice(0, 32).map(name => privateBound(name, 160).text)
  const cwd = capsule.cwdLabel === undefined ? undefined : privateBound(capsule.cwdLabel.replace(/[/\\]/g, ''), 160)
  return {
    userText: user.text,
    toolNames: boundedNames,
    ...(cwd === undefined || cwd.text === '' ? {} : { cwdLabel: cwd.text }),
    truncated: user.truncated || toolNames.length > boundedNames.length
      || boundedNames.some((name, index) => name !== toolNames[index]) || cwd?.truncated === true,
  }
}

function privateBound(value: string, limit: number): { readonly text: string; readonly truncated: boolean } {
  if (value.length <= limit) return { text: value, truncated: false }
  const head = Math.ceil((limit - 1) / 2)
  const tail = Math.floor((limit - 1) / 2)
  return { text: `${value.slice(0, head)}…${value.slice(value.length - tail)}`, truncated: true }
}

function boundedStoredText(value: unknown, label: string, limit: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > limit) {
    throw new Error(`dsh-explain: explanation ${label} is invalid`)
  }
  return value
}

function validTopicKey(value: string): boolean {
  return /^[a-z0-9._/-]{1,80}$/.test(value) && !value.split('/').some(part => part === '')
}

function rephraseIdentity(explanationId: string, revision: number): string {
  return `${explanationId}:${revision}`
}

function checkpointText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 2_000) {
    throw new Error(`dsh-explain: context checkpoint ${field} must be a string of at most 2,000 characters`)
  }
  return value
}

function feedbackFingerprint(request: FeedbackRequest): string {
  return JSON.stringify([
    'feedback',
    request.sourceSessionId,
    request.explanationId,
    request.revision,
    request.action,
  ])
}

function reopenFingerprint(request: ReopenTopicRequest): string {
  return JSON.stringify(['topic-reopen', request.topicId, request.expectedTopicRevision])
}

function reviewFingerprint(reviewId: string, answer: string): string {
  return JSON.stringify(['review-answer', reviewId, answer])
}

function profileFingerprint(request: UpdateLearnerProfileRequest): string {
  return JSON.stringify([
    'learner-profile',
    request.targetKind,
    request.targetKey,
    request.action,
    request.value?.trim() ?? null,
    request.authority ?? null,
    request.sourceObservationId ?? null,
  ])
}

function profileRequestError(request: UpdateLearnerProfileRequest): string | undefined {
  try {
    assertRequestId(request.requestId)
  } catch {
    return 'The request id is invalid.'
  }
  if (!Number.isInteger(request.expectedStoreRevision) || request.expectedStoreRevision < 0) {
    return 'The expected store revision must be a non-negative integer.'
  }
  if (request.targetKind === 'dialogue-preference') {
    if (!DIALOGUE_DIMENSIONS.has(request.targetKey)) return 'The dialogue-preference dimension is invalid.'
  } else if (request.targetKind === 'topic-familiarity') {
    if (!validTopicKey(request.targetKey)) return 'The topic key is invalid.'
  } else {
    return 'The learner-profile target kind is invalid.'
  }
  if (request.action === 'forget') {
    if (request.value !== undefined || request.authority !== undefined) {
      return 'A forget request cannot include a value or authority.'
    }
    return undefined
  }
  if (request.action !== 'set') return 'The learner-profile action is invalid.'
  if (request.authority !== 'correction' && request.authority !== 'explicit') {
    return 'A profile value must be marked as a correction or explicit preference.'
  }
  if (typeof request.value !== 'string' || request.value.trim() === '' || request.value.length > 240) {
    return 'The profile value must be a non-empty string of at most 240 characters.'
  }
  if (request.targetKind === 'topic-familiarity' && !TOPIC_FAMILIARITY_LEVELS.has(request.value)) {
    return 'The topic-familiarity level is invalid.'
  }
  return undefined
}

function reviewQuestion(kind: ReviewQuestionKind, title: string): string {
  const chinese = /\p{Script=Han}/u.test(title)
  if (chinese) {
    if (kind === 'recall') return `请用自己的话解释“${title}”：它是什么，为什么重要？`
    if (kind === 'application') return `假设你在实际工作中遇到“${title}”，你会如何应用它？请说明理由。`
    return `“${title}”最容易和什么混淆或踩什么坑？你会如何区分或避免？`
  }
  if (kind === 'recall') return `Explain “${title}” in your own words: what is it, and why does it matter?`
  if (kind === 'application') return `How would you apply “${title}” in a concrete work scenario, and why?`
  return `What is “${title}” easiest to confuse or misuse, and how would you distinguish or avoid it?`
}

function nextReviewState(
  current: ReviewStateRow,
  result: ReviewResult,
  now: number,
): { readonly stage: number; readonly streak: number; readonly nextReviewAt: number } {
  if (result === 'mastered') {
    const stage = Math.min(5, current.stage + 1)
    const intervals = [DAY_MS, 3 * DAY_MS, 7 * DAY_MS, 14 * DAY_MS, 30 * DAY_MS, 60 * DAY_MS]
    return { stage, streak: current.streak + 1, nextReviewAt: now + intervals[stage]! }
  }
  if (result === 'partial') {
    return { stage: Math.max(0, current.stage - 1), streak: 0, nextReviewAt: now + DAY_MS }
  }
  return { stage: 0, streak: 0, nextReviewAt: now + DAY_MS }
}

function reviewAttemptSelect(): string {
  return `
    SELECT ra.review_id, ra.batch_id, ra.position,
           (SELECT COUNT(*) FROM review_attempts total WHERE total.batch_id = ra.batch_id) AS total,
           ra.topic_id, t.title AS topic_title, ra.question_kind, ra.question,
           x.source_session_id, e.source_turn, ra.answer, ra.result, ra.feedback,
           ra.created_at, ra.completed_at, ra.next_review_at
    FROM review_attempts ra
    JOIN review_batches rb ON rb.batch_id = ra.batch_id
    JOIN topics t ON t.topic_id = ra.topic_id
    JOIN explanations x ON x.explanation_id = ra.explanation_id
    JOIN entries e ON e.explanation_id = ra.explanation_id AND e.kind = 'explanation'
      AND e.revision = ra.explanation_revision
  `
}

function reviewQuestionView(row: ReviewAttemptRow): ReviewQuestionView {
  return {
    reviewId: ReviewId(row.review_id),
    batchId: ReviewBatchId(row.batch_id),
    position: row.position,
    total: row.total,
    topicId: TopicId(row.topic_id),
    topicTitle: row.topic_title,
    kind: row.question_kind,
    question: row.question,
    sourceSessionId: SessionId(row.source_session_id),
    sourceTurn: row.source_turn,
    createdAt: row.created_at,
  }
}

function reviewAttemptView(row: ReviewAttemptRow): ReviewAttemptView {
  if (row.answer === null || row.result === null || row.feedback === null
    || row.completed_at === null || row.next_review_at === null) {
    throw new Error(`dsh-explain: completed review ${row.review_id} is incomplete`)
  }
  const { total: _total, ...question } = reviewQuestionView(row)
  return {
    ...question,
    answer: row.answer,
    result: row.result,
    feedback: row.feedback,
    completedAt: row.completed_at,
    nextReviewAt: row.next_review_at,
  }
}

function parseObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(`dsh-explain: ${label} contains invalid JSON`, { cause: error })
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`dsh-explain: ${label} must contain a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function assertRequestId(requestId: RequestId): void {
  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 160) {
    throw new Error('dsh-explain: requestId must be a non-empty string of at most 160 characters')
  }
}

function failure(
  code: ExplainMutationFailure['code'],
  message: string,
): { readonly ok: false; readonly error: ExplainMutationFailure } {
  return { ok: false, error: { code, message } }
}
