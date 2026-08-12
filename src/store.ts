import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { SessionId, type SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import { EntryId, ExplanationId, ObservationId, RequestId, TopicId } from './brands.ts'
import type {
  DialoguePreferenceView,
  ExplainContextStats,
  ExplainContextView,
  ExplainMutationFailure,
  FeedbackMutationResult,
  FeedbackRequest,
  ReopenTopicRequest,
  ReopenTopicResult,
  ThreadEntryView,
  ThreadPageRequest,
  ThreadPageResult,
  ViewCursor,
  WatchResult,
} from './types.ts'
import { CREATE_SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts'

const DAY_MS = 24 * 60 * 60 * 1_000
const DEFAULT_PAGE_LIMIT = 30
const MAX_PAGE_LIMIT = 100
const WATCH_TIMEOUT_MS = 25_000

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
             t.topic_key, t.title AS topic_title, t.state AS topic_state,
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

  /** Read the latest model checkpoint plus database-authoritative statistics. */
  context(): ExplainContextView {
    const stats = this.contextStats()
    const checkpoint = this.database.prepare(`
      SELECT context_json, created_at
      FROM context_checkpoints
      ORDER BY generation DESC
      LIMIT 1
    `).get() as unknown as CheckpointRow | undefined
    if (checkpoint === undefined) {
      return {
        dialogueProfile: [],
        knowledgeOverview: '',
        learningTrend: '',
        stats,
        inferred: false,
      }
    }
    const payload = parseObject(checkpoint.context_json, 'context checkpoint') as CheckpointPayload
    const profile = parseDialogueProfile(payload.dialogueProfile)
    return {
      generatedAt: checkpoint.created_at,
      dialogueProfile: profile,
      knowledgeOverview: checkpointText(payload.knowledgeOverview, 'knowledgeOverview'),
      learningTrend: checkpointText(payload.learningTrend, 'learningTrend'),
      stats,
      inferred: true,
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
        if (request.action !== 'not-understood') {
          return failure('STALE_EXPLANATION_REVISION', 'The explanation revision is awaiting a rephrase.')
        }
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
    const meta = this.meta()
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
      learningTopics: this.count('SELECT COUNT(*) AS count FROM topics WHERE state = \'learning\''),
      masteredTopics: this.count('SELECT COUNT(*) AS count FROM topics WHERE state = \'mastered\''),
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

  private write<T>(operation: () => T): T {
    if (this.closed) throw new Error('dsh-explain: store is closed')
    const startingRevision = this.storeRevision()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      const changed = this.storeRevision() !== startingRevision
      this.database.exec('COMMIT')
      if (changed) {
        this.viewRevision += 1
        for (const listener of [...this.listeners]) listener()
      }
      return value
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private entryById(entryId: EntryId): ThreadEntryView {
    const row = this.entryRow('e.entry_id = ?', entryId)
    if (row === undefined) throw new Error(`dsh-explain: committed entry ${entryId} is missing`)
    return this.entryView(row)
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
             t.topic_key, t.title AS topic_title, t.state AS topic_state,
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
      if (![title, what, why, pitfall].every(value => typeof value === 'string')) {
        throw new Error(`dsh-explain: explanation entry ${row.entry_id} has an invalid payload`)
      }
      publicPayload = { title: title as string, what: what as string, why: why as string, pitfall: pitfall as string }
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
      ...(row.source_session_id === null ? {} : { sourceSessionId: SessionId(row.source_session_id) }),
      ...(row.source_turn === null ? {} : { sourceTurn: row.source_turn }),
      payload: publicPayload,
      createdAt: row.created_at,
    }
  }
}

function parseDialogueProfile(value: unknown): readonly DialoguePreferenceView[] {
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
