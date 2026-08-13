import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ObservationId, RequestId } from '../src/brands.ts'
import type {
  ExplainContextSnapshot,
  ExplainDecision,
  GenerationRecord,
  SourceCapsule,
} from '../src/domain.ts'
import { ExplainStore, SourceSummaryError } from '../src/store.ts'

const DAY_MS = 86_400_000
const stores: ExplainStore[] = []
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

function memoryStore(): ExplainStore {
  const store = new ExplainStore(':memory:')
  stores.push(store)
  return store
}

function capsule(source = 'source-a', turn = 3): SourceCapsule {
  return {
    sourceSessionId: SessionId(source),
    turn,
    endSeq: 12,
    observedAt: Date.now(),
    cwdLabel: 'workspace',
    userText: 'Why does TypeScript narrow this union?',
    assistantText: 'The discriminant gives each branch a unique literal.',
    tools: [{ name: 'read', resultPreview: 'private tool output' }, { name: 'read' }],
    truncated: false,
  }
}

function generation(at = Date.now()): GenerationRecord {
  return { provider: 'test-provider', model: 'test-model', generatedAt: at }
}

function decision(title = 'Discriminated unions'): ExplainDecision {
  return {
    kind: 'explain',
    topicKey: 'typescript/discriminated-unions',
    title,
    what: 'A shared literal property selects one union member.',
    why: 'The checker can prove which fields exist in each branch.',
    pitfall: 'A widened string property is not a discriminant.',
    contextObservations: [{
      kind: 'dialogue-preference',
      dimension: 'examples',
      value: 'Prefer one concrete code example.',
      confidence: 'high',
    }],
  }
}

describe('runtime lease and autonomous budget', () => {
  it('fences a live owner, permits takeover after expiry, and rejects the stale generation', () => {
    const store = memoryStore()
    const now = Date.now()
    const first = store.acquireLease('first', now, 100)
    expect(() => store.acquireLease('second', now + 50, 100)).toThrow(/another host runtime/)
    const second = store.acquireLease('second', now + 101, 100)
    expect(second.generation).toBe(first.generation + 1)
    expect(store.renewLease(first, now + 102, 100)).toBe(false)
    expect(() => store.commitAutoDecision(first, capsule(), decision(), generation()))
      .toThrow(/fencing token/)
  })

  it('persists a rolling 24-hour reservation before dispatch and reopens the exact expired slot', () => {
    const store = memoryStore()
    const now = Date.now()
    const lease = store.acquireLease('owner', now, DAY_MS * 2)
    expect(store.reserveAutoRequest(lease, capsule('a'), 'p', 'm', 1, 2, now)).toMatchObject({ ok: true })
    expect(store.reserveAutoRequest(lease, capsule('b'), 'p', 'm', 1, 2, now + 1)).toMatchObject({ ok: true })
    expect(store.reserveAutoRequest(lease, capsule('c'), 'p', 'm', 1, 2, now + 2)).toEqual({
      ok: false,
      resumeAt: now + DAY_MS,
    })
    expect(store.autoBudget(2, now + 2)).toEqual({ used: 2, resumeAt: now + DAY_MS })
    expect(store.reserveAutoRequest(lease, capsule('c'), 'p', 'm', 1, 2, now + DAY_MS))
      .toMatchObject({ ok: true })
  })
})

describe('autonomous, rephrase, and checkpoint persistence', () => {
  it('restores budget, mastered state, history, coverage, and ExplainContext from disk', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-explain-restart-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'thread.sqlite')
    const first = new ExplainStore(path)
    stores.push(first)
    const now = Date.now()
    const lease = first.acquireLease('owner', now, DAY_MS)
    const source = capsule('restart-source')
    expect(first.reserveAutoRequest(lease, source, 'p', 'm', 1, 50, now)).toMatchObject({ ok: true })
    const committed = first.commitAutoDecision(lease, source, decision(), generation(now + 1))
    const entry = committed.entry
    if (entry?.explanationId === undefined || entry.revision === undefined) throw new Error('missing restart fixture')
    expect(first.feedback({
      requestId: RequestId('restart-understood'),
      sourceSessionId: source.sourceSessionId,
      explanationId: entry.explanationId,
      revision: entry.revision,
      action: 'understood',
    }).ok).toBe(true)
    const batch = first.compactionBatch()
    const observationId = batch?.observations[0]?.observationId
    if (batch === undefined || observationId === undefined) throw new Error('missing restart compaction batch')
    const snapshot: ExplainContextSnapshot = {
      dialogueProfile: [{
        kind: 'examples', preference: 'Prefer one example.', confidence: 'high',
        evidenceObservationIds: [observationId], evidenceEntryOrdinals: [],
      }],
      knowledgeOverview: 'Understands one narrowing pattern.',
      learningTrend: 'Moving from examples to independent use.',
    }
    expect(first.commitCheckpoint(lease, batch, 'idle', 'restart-checkpoint', snapshot, generation(now + 2)))
      .toBeDefined()
    first.close()
    stores.splice(stores.indexOf(first), 1)

    const reopened = new ExplainStore(path)
    stores.push(reopened)
    expect(reopened.autoBudget(50, now + 3).used).toBe(1)
    expect(reopened.context()).toMatchObject({
      inferred: true,
      knowledgeOverview: snapshot.knowledgeOverview,
      stats: { masteredTopics: 1, activeExplanations: 0, understoodFeedback: 1 },
    })
    expect(reopened.compactionBatch()).toBeUndefined()
    expect(reopened.threadPage({ limit: 20 }).entries.map(item => item.kind))
      .toEqual(['feedback', 'explanation'])
  })

  it('persists the private revision-one summary, updates Topic title on rephrase, and compacts closed data', () => {
    const store = memoryStore()
    const lease = store.acquireLease('owner', Date.now(), DAY_MS)
    const source = capsule()
    const committed = store.commitAutoDecision(lease, source, decision(), generation())
    expect(committed).toMatchObject({
      committed: true,
      entry: {
        revision: 1,
        topicTitle: 'Discriminated unions',
        explanationState: 'active',
      },
    })
    expect(JSON.stringify(store.threadPage({}).entries)).not.toContain('sourceSummary')
    expect(JSON.stringify(store.threadPage({}).entries)).not.toContain('private tool output')
    expect(store.auxiliaryContext(10)).toMatchObject({
      activeExplanations: [{ topicKey: 'typescript/discriminated-unions', activeRevision: 1 }],
      uncoveredObservations: [{ observation: { kind: 'dialogue-preference', dimension: 'examples' } }],
    })

    const first = committed.entry
    if (first?.explanationId === undefined || first.revision === undefined) {
      throw new Error('autonomous explanation was not committed')
    }
    const feedback = store.feedback({
      requestId: RequestId('not-understood'),
      sourceSessionId: source.sourceSessionId,
      explanationId: first.explanationId,
      revision: first.revision,
      action: 'not-understood',
    })
    expect(feedback).toMatchObject({ ok: true, value: { rephrasePending: true } })
    const target = store.pendingRephrases()[0]
    expect(target).toMatchObject({
      explanationId: first.explanationId,
      sourceSummary: {
        userText: 'Why does TypeScript narrow this union?',
        toolNames: ['read'],
        cwdLabel: 'workspace',
      },
    })
    if (target === undefined) throw new Error('rephrase target was not persisted')
    const revisionTwo = store.commitRephrase(lease, target, {
      title: 'Union tags as labels',
      what: 'Treat the literal property like a label on each box.',
      why: 'Checking the label tells TypeScript which box was opened.',
      pitfall: 'Labels must remain literal values.',
    }, generation())
    expect(revisionTwo).toMatchObject({ revision: 2, topicTitle: 'Union tags as labels' })
    const historical = store.threadPage({ limit: 20 }).entries
      .find(entry => entry.kind === 'explanation' && entry.revision === 1)
    expect(historical?.payload).toMatchObject({ title: 'Discriminated unions' })
    expect(historical?.topicTitle).toBe('Union tags as labels')

    const understood = store.feedback({
      requestId: RequestId('understood'),
      sourceSessionId: source.sourceSessionId,
      explanationId: first.explanationId,
      revision: 2,
      action: 'understood',
    })
    expect(understood).toMatchObject({ ok: true, value: { entry: { topicState: 'mastered' } } })
    const batch = store.compactionBatch()
    if (batch === undefined) throw new Error('closed learning material was not compactable')
    const observationId = batch.observations[0]?.observationId
    const evidenceOrdinal = batch.explanations[0]?.entryOrdinals[0]
    if (observationId === undefined || evidenceOrdinal === undefined) throw new Error('compaction evidence is incomplete')
    const snapshot: ExplainContextSnapshot = {
      dialogueProfile: [{
        kind: 'examples',
        preference: 'Prefer one concrete code example.',
        confidence: 'high',
        evidenceObservationIds: [observationId],
        evidenceEntryOrdinals: [evidenceOrdinal],
      }],
      knowledgeOverview: 'Understands discriminated unions.',
      learningTrend: 'Progressing through TypeScript type refinement.',
    }
    const checkpoint = store.commitCheckpoint(lease, batch, 'idle', 'checkpoint-1', snapshot, generation())
    expect(checkpoint).toMatchObject({ generation: 1, throughOrdinal: batch.throughOrdinal, context: snapshot })
    expect(store.compactionBatch()).toBeUndefined()
    expect(store.context()).toMatchObject({
      inferred: true,
      knowledgeOverview: 'Understands discriminated unions.',
      stats: { masteredTopics: 1, activeExplanations: 0 },
    })
    expect(store.threadPage({ limit: 20 }).entries.some(entry => entry.explanationId === first.explanationId))
      .toBe(true)

    store.commitAutoDecision(lease, capsule('source-b'), {
      kind: 'skip',
      reason: 'already-known',
      contextObservations: [{
        kind: 'dialogue-preference',
        dimension: 'structure',
        value: 'Prefer a short definition before details.',
        confidence: 'medium',
      }],
    }, generation())
    const observationOnlyBatch = store.compactionBatch()
    if (observationOnlyBatch === undefined) throw new Error('new observation was not compactable')
    expect(observationOnlyBatch.explanations).toHaveLength(0)
    expect(observationOnlyBatch.throughOrdinal).toBe(batch.throughOrdinal)
    const observationCheckpoint = store.commitCheckpoint(
      lease,
      observationOnlyBatch,
      'idle',
      'checkpoint-observation-only',
      snapshot,
      generation(),
    )
    expect(observationCheckpoint).toMatchObject({ generation: 2, throughOrdinal: batch.throughOrdinal })
    expect(store.compactionBatch()).toBeUndefined()
    expect(store.commitCheckpoint(lease, batch, 'idle', 'checkpoint-2', snapshot, generation())).toBeUndefined()
  })

  it('commits a manual explanation without auto budget and preserves its origin through rephrase', () => {
    const store = memoryStore()
    const lease = store.acquireLease('owner', Date.now(), DAY_MS)
    const source = capsule('manual-source', 0)
    const committed = store.commitManualExplanation(lease, source, {
      topicKey: 'typescript/manual-narrowing',
      title: 'Requested narrowing lesson',
      what: 'A literal property selects one union member.',
      why: 'The checker can then prove which fields exist.',
      pitfall: 'A widened string does not discriminate.',
    }, generation())
    expect(committed).toMatchObject({
      ok: true,
      entry: {
        origin: 'manual',
        sourceSessionId: SessionId('manual-source'),
        sourceTurn: 0,
        topicTitle: 'Requested narrowing lesson',
      },
    })
    expect(store.autoBudget(50).used).toBe(0)
    if (!committed.ok || committed.entry.explanationId === undefined) throw new Error('missing manual explanation')
    expect(store.feedback({
      requestId: RequestId('manual-rephrase'),
      sourceSessionId: SessionId('manual-source'),
      explanationId: committed.entry.explanationId,
      revision: 1,
      action: 'not-understood',
    }).ok).toBe(true)
    const target = store.pendingRephrases()[0]
    expect(target).toMatchObject({
      origin: 'manual',
      sourceSummary: { userText: 'Why does TypeScript narrow this union?' },
    })
    if (target === undefined) throw new Error('missing manual rephrase target')
    expect(store.commitRephrase(lease, target, {
      title: 'Requested narrowing lesson, differently',
      what: 'Think of each literal as a label.',
      why: 'Reading the label identifies the member.',
      pitfall: 'The labels must remain literal.',
    }, generation())).toMatchObject({ origin: 'manual', revision: 2 })
    expect(store.autoBudget(50).used).toBe(0)
  })

  it('lets an explicit request reopen a mastered Topic but never duplicates an active source or Topic', () => {
    const store = memoryStore()
    const lease = store.acquireLease('owner', Date.now(), DAY_MS)
    const original = store.commitAutoDecision(lease, capsule('mastered-source'), decision(), generation()).entry
    if (original?.explanationId === undefined || original.revision === undefined) throw new Error('missing original')
    expect(store.feedback({
      requestId: RequestId('master-before-manual'),
      sourceSessionId: SessionId('mastered-source'),
      explanationId: original.explanationId,
      revision: original.revision,
      action: 'understood',
    }).ok).toBe(true)
    const manual = {
      topicKey: 'typescript/discriminated-unions',
      title: 'Reopened by request',
      what: 'Review the literal tag.',
      why: 'The user explicitly asked to study it again.',
      pitfall: 'Do not widen the tag.',
    }
    expect(store.commitManualExplanation(lease, capsule('manual-reopen'), manual, generation()))
      .toMatchObject({ ok: true, entry: { topicState: 'learning', origin: 'manual' } })
    expect(store.commitManualExplanation(lease, capsule('other-source'), manual, generation()))
      .toEqual({ ok: false, reason: 'topic-active' })
    expect(store.commitManualExplanation(lease, capsule('manual-reopen'), {
      ...manual,
      topicKey: 'typescript/other-topic',
    }, generation())).toEqual({ ok: false, reason: 'source-active' })
  })

  it('atomically drops observations when the source or Topic gate becomes stale', () => {
    const store = memoryStore()
    const lease = store.acquireLease('owner', Date.now(), DAY_MS)
    const first = store.commitAutoDecision(lease, capsule('a'), decision(), generation())
    expect(first.committed).toBe(true)
    const before = store.auxiliaryContext(10).uncoveredObservations.length
    expect(store.commitAutoDecision(lease, capsule('a', 4), decision('New title'), generation()))
      .toEqual({ committed: false })
    expect(store.auxiliaryContext(10).uncoveredObservations).toHaveLength(before)

    const entry = first.entry
    if (entry?.explanationId === undefined || entry.revision === undefined) throw new Error('missing first explanation')
    store.feedback({
      requestId: RequestId('master'),
      sourceSessionId: SessionId('a'),
      explanationId: entry.explanationId,
      revision: entry.revision,
      action: 'understood',
    })
    expect(store.commitAutoDecision(lease, capsule('b'), decision('Mastered duplicate'), generation()))
      .toEqual({ committed: false })
    expect(store.auxiliaryContext(10).uncoveredObservations).toHaveLength(before)
  })

  it('rejects checkpoint evidence invented outside the captured batch', () => {
    const store = memoryStore()
    const lease = store.acquireLease('owner', Date.now(), DAY_MS)
    const committed = store.commitAutoDecision(lease, capsule(), decision(), generation())
    const entry = committed.entry
    if (entry?.explanationId === undefined || entry.revision === undefined) throw new Error('missing explanation')
    store.feedback({
      requestId: RequestId('master'),
      sourceSessionId: SessionId('source-a'),
      explanationId: entry.explanationId,
      revision: entry.revision,
      action: 'understood',
    })
    const batch = store.compactionBatch()
    if (batch === undefined) throw new Error('missing compaction batch')
    const invalid: ExplainContextSnapshot = {
      dialogueProfile: [{
        kind: 'examples', preference: 'Invented', confidence: 'low',
        evidenceObservationIds: [ObservationId('invented')], evidenceEntryOrdinals: [],
      }],
      knowledgeOverview: '', learningTrend: '',
    }
    expect(store.commitCheckpoint(lease, batch, 'pressure', 'invalid', invalid, generation())).toBeUndefined()
    expect(store.compactionBatch()).toBeDefined()
  })

  it('classifies a missing private source summary without reading the source Session', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-explain-source-summary-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'thread.sqlite')
    const store = new ExplainStore(path)
    stores.push(store)
    const explanationId = store.addFixtureExplanation({
      topicKey: 'typescript/narrowing',
      title: 'Narrowing',
      sourceSessionId: SessionId('deleted-source'),
      sourceTurn: 1,
    })
    store.feedback({
      requestId: RequestId('needs-rephrase'),
      sourceSessionId: SessionId('deleted-source'),
      explanationId,
      revision: 1,
      action: 'not-understood',
    })
    store.close()

    const database = new DatabaseSync(path)
    const row = database.prepare(`
      SELECT entry_id, payload_json FROM entries
      WHERE explanation_id = ? AND kind = 'explanation' AND revision = 1
    `).get(explanationId) as unknown as { entry_id: string; payload_json: string }
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>
    delete payload.sourceSummary
    database.prepare('UPDATE entries SET payload_json = ? WHERE entry_id = ?')
      .run(JSON.stringify(payload), row.entry_id)
    database.close()

    const reopened = new ExplainStore(path)
    stores.push(reopened)
    expect(() => reopened.pendingRephrases()).toThrowError(SourceSummaryError)
  })
})
