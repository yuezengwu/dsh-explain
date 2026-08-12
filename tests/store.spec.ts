import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { RequestId } from '../src/brands.ts'
import { ExplainStore } from '../src/store.ts'

const stores: ExplainStore[] = []
const directories: string[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function memoryStore(): ExplainStore {
  const store = new ExplainStore(':memory:')
  stores.push(store)
  return store
}

function diskPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-explain-test-'))
  directories.push(directory)
  return join(directory, 'nested', 'thread.sqlite')
}

function fixture(store: ExplainStore, source = 'session-a', topic = 'typescript/narrowing') {
  const explanationId = store.addFixtureExplanation({
    topicKey: topic,
    title: 'Narrowing',
    sourceSessionId: SessionId(source),
    sourceTurn: 7,
    revisions: [
      { title: 'Narrowing basics', what: 'First what', why: 'First why', pitfall: 'First pitfall' },
      { title: 'Narrowing precisely', what: 'Latest what', why: 'Latest why', pitfall: 'Latest pitfall' },
    ],
    userText: `private-source-${source}`,
    toolNames: ['bash', 'bash', 'read'],
    cwdLabel: 'workspace',
  })
  const page = store.threadPage({ limit: 10 })
  const latest = page.entries.find(entry => entry.explanationId === explanationId && entry.revision === 2)
  if (latest === undefined) throw new Error('fixture explanation is missing')
  return { explanationId, latest }
}

describe('ExplainStore schema and projections', () => {
  it.skipIf(process.platform === 'win32')('repairs private permissions and preserves state across restart', () => {
    const path = diskPath()
    mkdirSync(join(path, '..'), { recursive: true, mode: 0o755 })
    chmodSync(join(path, '..'), 0o755)
    const first = new ExplainStore(path)
    stores.push(first)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(join(path, '..')).mode & 0o077).toBe(0)
    const { explanationId } = fixture(first)
    for (const file of readdirSync(join(path, '..'))) {
      expect(statSync(join(path, '..', file)).mode & 0o077).toBe(0)
    }
    expect(first.storeRevision()).toBe(1)
    first.close()
    stores.splice(stores.indexOf(first), 1)

    const reopened = new ExplainStore(path)
    stores.push(reopened)
    expect(reopened.storeRevision()).toBe(1)
    expect(reopened.activeExplanationCount()).toBe(1)
    expect(reopened.threadPage({}).entries.some(entry => entry.explanationId === explanationId)).toBe(true)
  })

  it('pages newest first while stripping the private source summary', () => {
    const store = memoryStore()
    fixture(store)
    const newest = store.threadPage({ limit: 1 })
    expect(newest.entries).toHaveLength(1)
    expect(newest.hasMore).toBe(true)
    expect(newest.entries[0]?.ordinal).toBe(2)
    expect(JSON.stringify(newest.entries)).not.toContain('private-source')
    expect(JSON.stringify(newest.entries)).not.toContain('sourceSummary')

    const beforeOrdinal = newest.entries[0]?.ordinal
    if (beforeOrdinal === undefined) throw new Error('newest fixture page is empty')
    const older = store.threadPage({ beforeOrdinal, limit: 1 })
    expect(older.entries[0]?.ordinal).toBe(1)
    expect(older.entries[0]?.payload).toEqual({
      title: 'Narrowing basics',
      what: 'First what',
      why: 'First why',
      pitfall: 'First pitfall',
    })
    expect(older.entries[0]?.topicTitle).toBe('Narrowing precisely')
  })

  it('enforces one active explanation per source without retaining a partial write', () => {
    const store = memoryStore()
    fixture(store)
    expect(() => fixture(store, 'session-a', 'typescript/generics')).toThrow(/UNIQUE constraint failed/)
    expect(store.storeRevision()).toBe(1)
    expect(store.context().stats).toMatchObject({ learningTopics: 1, activeExplanations: 1 })
  })

  it('rejects an unknown schema without replacing the original database', () => {
    const path = diskPath()
    const store = new ExplainStore(path)
    store.close()
    const database = new DatabaseSync(path)
    database.exec('UPDATE meta SET schema_version = 99 WHERE singleton = 1')
    database.close()

    expect(() => new ExplainStore(path)).toThrow('unsupported schema version 99')
    const verify = new DatabaseSync(path)
    expect((verify.prepare('SELECT schema_version FROM meta').get() as { schema_version: number }).schema_version).toBe(99)
    verify.close()
  })

  it('reports corrupt SQLite input instead of silently reinitializing it', () => {
    const path = diskPath()
    const seed = new ExplainStore(path)
    seed.close()
    writeFileSync(path, 'this is not sqlite')
    const before = readFileSync(path)
    expect(() => new ExplainStore(path)).toThrow()
    expect(readFileSync(path)).toEqual(before)
  })

  it('validates page requests at the Remote boundary', () => {
    const store = memoryStore()
    expect(() => store.threadPage({ limit: 0 })).toThrow(RangeError)
    expect(() => store.threadPage({ limit: 101 })).toThrow(RangeError)
    expect(() => store.threadPage({ beforeOrdinal: 0 })).toThrow(RangeError)
  })
})

describe('ExplainStore feedback and entity CAS', () => {
  it('keeps stale failures and exact idempotent replays revision-neutral', () => {
    const store = memoryStore()
    const { explanationId, latest } = fixture(store)
    const cursor = store.cursor()
    const stale = store.feedback({
      requestId: RequestId('stale'),
      sourceSessionId: SessionId('session-a'),
      explanationId,
      revision: 1,
      action: 'understood',
    })
    expect(stale).toMatchObject({ ok: false, error: { code: 'STALE_EXPLANATION_REVISION' } })
    expect(store.cursor()).toEqual(cursor)
    expect(store.storeRevision()).toBe(1)

    const request = {
      requestId: RequestId('retry-me'),
      sourceSessionId: SessionId('session-a'),
      explanationId,
      revision: latest.revision!,
      action: 'not-understood' as const,
    }
    const accepted = store.feedback(request)
    expect(accepted).toMatchObject({ ok: true, value: { rephrasePending: true } })
    const acceptedCursor = store.cursor()
    const acceptedRevision = store.storeRevision()
    expect(store.feedback(request)).toEqual(accepted)
    expect(store.cursor()).toEqual(acceptedCursor)
    expect(store.storeRevision()).toBe(acceptedRevision)

    const semanticDuplicate = store.feedback({ ...request, requestId: RequestId('same-meaning') })
    expect(semanticDuplicate).toMatchObject({
      ok: true,
      value: { entry: { entryId: accepted.ok && accepted.value.entry.entryId }, rephrasePending: true },
    })
    expect(store.cursor()).toEqual(acceptedCursor)
    expect(store.storeRevision()).toBe(acceptedRevision)
    expect(store.feedback({ ...request, requestId: RequestId('same-meaning') })).toEqual(semanticDuplicate)
  })

  it('rejects RequestId reuse for a different mutation', () => {
    const store = memoryStore()
    const { explanationId, latest } = fixture(store)
    const requestId = RequestId('one-operation-only')
    const first = store.feedback({
      requestId,
      sourceSessionId: SessionId('session-a'),
      explanationId,
      revision: latest.revision!,
      action: 'not-understood',
    })
    expect(first.ok).toBe(true)
    const cursor = store.cursor()
    expect(store.feedback({
      requestId,
      sourceSessionId: SessionId('session-a'),
      explanationId,
      revision: latest.revision!,
      action: 'understood',
    })).toMatchObject({ ok: false, error: { code: 'REQUEST_ID_CONFLICT' } })
    expect(store.reopenTopic({
      requestId,
      topicId: latest.topicId,
      expectedTopicRevision: latest.topicRevision,
    })).toMatchObject({ ok: false, error: { code: 'REQUEST_ID_CONFLICT' } })
    expect(store.cursor()).toEqual(cursor)
  })

  it('recovers a pending rephrase and its idempotency aliases after restart', () => {
    const path = diskPath()
    const first = new ExplainStore(path)
    const { explanationId, latest } = fixture(first)
    const initial = first.feedback({
      requestId: RequestId('durable-rephrase'),
      sourceSessionId: SessionId('session-a'),
      explanationId,
      revision: latest.revision!,
      action: 'not-understood',
    })
    expect(initial.ok).toBe(true)
    first.close()

    const reopened = new ExplainStore(path)
    stores.push(reopened)
    const aliasRequest = {
      requestId: RequestId('durable-rephrase-alias'),
      sourceSessionId: SessionId('session-a'),
      explanationId,
      revision: latest.revision!,
      action: 'not-understood' as const,
    }
    const alias = reopened.feedback(aliasRequest)
    expect(alias).toMatchObject({ ok: true, value: { rephrasePending: true } })
    expect(reopened.feedback(aliasRequest)).toEqual(alias)
    expect(reopened.feedback({
      ...aliasRequest,
      requestId: RequestId('cannot-master-pending'),
      action: 'understood',
    })).toMatchObject({ ok: true, value: { rephrasePending: false } })
    expect(reopened.activeExplanationCount()).toBe(0)
  })

  it('masters only the addressed explanation, then reopens its Topic with Topic CAS', () => {
    const store = memoryStore()
    const left = fixture(store, 'session-a', 'typescript/narrowing')
    const right = fixture(store, 'session-b', 'sqlite/wal')
    const understood = store.feedback({
      requestId: RequestId('understood-left'),
      sourceSessionId: SessionId('session-a'),
      explanationId: left.explanationId,
      revision: left.latest.revision!,
      action: 'understood',
    })
    expect(understood).toMatchObject({
      ok: true,
      value: { entry: { topicState: 'mastered', topicRevision: 2 }, rephrasePending: false },
    })
    expect(store.activeExplanationCount()).toBe(1)
    expect(store.threadPage({ limit: 20 }).entries.find(entry => entry.explanationId === right.explanationId)?.topicState)
      .toBe('learning')

    const stale = store.reopenTopic({
      requestId: RequestId('stale-topic'),
      topicId: left.latest.topicId,
      expectedTopicRevision: 1,
    })
    expect(stale).toMatchObject({ ok: false, error: { code: 'STALE_TOPIC_REVISION' } })
    const reopened = store.reopenTopic({
      requestId: RequestId('reopen-left'),
      topicId: left.latest.topicId,
      expectedTopicRevision: 2,
    })
    expect(reopened).toMatchObject({ ok: true, value: { entry: { topicState: 'learning', topicRevision: 3 } } })
    if (!reopened.ok) throw new Error('Topic did not reopen')
    const revision = store.storeRevision()
    const cursor = store.cursor()
    expect(store.reopenTopic({
      requestId: RequestId('reopen-left'),
      topicId: left.latest.topicId,
      expectedTopicRevision: 2,
    })).toEqual(reopened)
    expect(store.reopenTopic({
      requestId: RequestId('reopen-left'),
      topicId: left.latest.topicId,
      expectedTopicRevision: 3,
    })).toMatchObject({ ok: false, error: { code: 'REQUEST_ID_CONFLICT' } })
    expect(store.storeRevision()).toBe(revision)
    expect(store.cursor()).toEqual(cursor)
  })

  it('lets only one of two tabs commit the same Explanation revision', () => {
    const store = memoryStore()
    const { explanationId, latest } = fixture(store)
    const base = {
      sourceSessionId: SessionId('session-a'),
      explanationId,
      revision: latest.revision!,
      action: 'understood' as const,
    }
    expect(store.feedback({ ...base, requestId: RequestId('tab-one') }).ok).toBe(true)
    expect(store.feedback({ ...base, requestId: RequestId('tab-two') }))
      .toMatchObject({ ok: false, error: { code: 'STALE_EXPLANATION_REVISION' } })
  })
})

describe('ExplainStore long polling', () => {
  it('wakes on a committed store revision and not on a stale failure', async () => {
    const store = memoryStore()
    const controller = new AbortController()
    const waiting = store.watch(store.cursor(), controller.signal)
    fixture(store)
    await expect(waiting).resolves.toMatchObject({ changed: true, cursor: { revision: 1 } })

    const current = store.cursor()
    const abort = new AbortController()
    const unchanged = store.watch(current, abort.signal)
    const page = store.threadPage({ limit: 1 })
    const latest = page.entries[0]!
    store.feedback({
      requestId: RequestId('stale-watch'),
      sourceSessionId: SessionId('session-a'),
      explanationId: latest.explanationId!,
      revision: 1,
      action: 'understood',
    })
    expect(store.cursor()).toEqual(current)
    abort.abort()
    await expect(unchanged).rejects.toThrow()
  })

  it('releases outstanding watchers during close', async () => {
    const store = memoryStore()
    const waiting = store.watch(store.cursor(), new AbortController().signal)
    store.close()
    stores.splice(stores.indexOf(store), 1)
    await expect(waiting).resolves.toMatchObject({ changed: true })
  })
})
