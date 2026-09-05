import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import LlmService, {
  ReasoningEffortId,
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import TokenMeterService from '@deepseek-ai/dsh-token-meter'
import { RequestId } from '../src/brands.ts'
import type { ExplainRuntimeSettings } from '../src/config.ts'
import type { SourceCapsule } from '../src/domain.ts'
import { ExplainScheduler } from '../src/scheduler.ts'
import { ExplainStore } from '../src/store.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'

const stores: ExplainStore[] = []
const schedulers: ExplainScheduler[] = []
const serviceFibers: Fiber[] = []

afterEach(async () => {
  for (const scheduler of schedulers.splice(0)) await scheduler.dispose()
  for (const store of stores.splice(0)) store.close()
  for (const fiber of serviceFibers.splice(0).reverse()) await fiber.dispose()
})

class LearningAdapter extends LlmAdapter {
  active = 0
  maxActive = 0
  contextWindow = 1_000_000
  delayMs = 5
  failCompaction = false
  failAutonomous = false
  failManual = false
  readonly calls: string[] = []
  readonly efforts: (string | undefined)[] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: this.contextWindow },
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('off'), name: 'Off' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
        defaultEffort: ReasoningEffortId('high'),
      },
    })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.active += 1
    this.maxActive = Math.max(this.maxActive, this.active)
    try {
      await abortableDelay(this.delayMs, options.signal)
      const compaction = options.purpose === 'compaction'
      const rephrase = options.system?.includes('Rephrase one still-active explanation') === true
      const manual = options.system?.includes('Fulfill one explicit learning request') === true
      const review = options.system?.includes('private review evaluator') === true
      const source = requestObject(options)
      const sourceId = String((source.sourceCapsule as { sourceSessionId?: unknown } | undefined)?.sourceSessionId ?? 'rephrase')
      this.calls.push(compaction ? 'compaction' : rephrase ? 'rephrase' : manual ? `manual:${sourceId}`
        : review ? 'review' : `auto:${sourceId}`)
      this.efforts.push(options.reasoningEffort)
      if (compaction && this.failCompaction) throw new Error('test compaction provider failure')
      if (manual && this.failManual) throw new Error('test manual provider failure')
      if (!compaction && !rephrase && !manual && !review && this.failAutonomous) throw new Error('test autonomous provider failure')
      const response = compaction
        ? {
            dialogueProfile: [],
            knowledgeOverview: 'Compressed learning context.',
            learningTrend: 'Closed material is retained as a summary.',
          }
        : rephrase
        ? { title: 'Narrowing with labels', what: 'Each member has a label.', why: 'The label identifies the member.', pitfall: 'Keep labels literal.' }
        : manual
        ? {
            topicKey: `manual/${sourceId}`,
            title: `Requested topic ${sourceId}`,
            what: 'A requested concept.',
            why: 'It answers the explicit learning request.',
            pitfall: 'Keep the source context bounded.',
          }
        : review
        ? { result: 'mastered', feedback: 'The answer captures the core idea.' }
        : {
            kind: 'explain',
            topicKey: `topic/${sourceId}`,
            title: `Topic ${sourceId}`,
            what: 'A focused concept.',
            why: 'It helps future work.',
            pitfall: 'Do not overgeneralize it.',
            contextObservations: [],
          }
      const text = JSON.stringify(response)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } finally {
      this.active -= 1
    }
  }
}

const SETTINGS: ExplainRuntimeSettings = {
  enabled: true,
  provider: 'learning',
  model: 'test-model',
  maxPendingCandidates: 8,
  maxSourceChars: 24_000,
  maxAutoRequestsPerDay: 50,
  maxTopicHints: 100,
  idleCompactMs: 1_800_000,
  contextThresholdRatio: 0.5,
  timeoutMs: 5_000,
  maxOutputTokens: 1_200,
  maxCompactionOutputTokens: 1_600,
  maxAttempts: 2,
}

function source(sourceId: string): SourceCapsule {
  return {
    sourceSessionId: SessionId(sourceId),
    turn: 1,
    endSeq: 5,
    observedAt: Date.now(),
    userText: 'Explain this code.',
    assistantText: 'The code uses one useful idea.',
    tools: [],
    truncated: false,
  }
}

async function setup(
  settings: ExplainRuntimeSettings = SETTINGS,
  configureAdapter?: (adapter: LearningAdapter) => void,
  registerAdapter = true,
): Promise<{
  readonly ctx: Context
  readonly store: ExplainStore
  readonly adapter: LearningAdapter
  readonly scheduler: ExplainScheduler
}> {
  const ctx = new Context()
  const llm = ctx.plugin(LlmService)
  serviceFibers.push(llm)
  await llm
  const projections = ctx.plugin(SessionProjectionRegistry)
  serviceFibers.push(projections)
  await projections
  const meter = ctx.plugin(TokenMeterService)
  serviceFibers.push(meter)
  await meter
  const adapter = new LearningAdapter()
  configureAdapter?.(adapter)
  if (registerAdapter) ctx.llm.registerAdapter(['learning'], adapter)
  const store = new ExplainStore(':memory:')
  stores.push(store)
  const scheduler = new ExplainScheduler(ctx, store, settings)
  schedulers.push(scheduler)
  await scheduler.start()
  return { ctx, store, adapter, scheduler }
}

function requestObject(options: GenerateOptions): Record<string, unknown> {
  const first = options.messages[0]?.content[0]
  if (first?.type !== 'text') throw new Error('test adapter expected one JSON text request')
  return JSON.parse(first.text) as Record<string, unknown>
}

async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) throw signal.reason
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, milliseconds)
    function done(): void {
      signal?.removeEventListener('abort', aborted)
      resolve()
    }
    function aborted(): void {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', aborted, { once: true })
  })
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for scheduler state')
    await new Promise(resolve => { setTimeout(resolve, 5) })
  }
}

const GENERATION = { provider: 'test', model: 'test', generatedAt: 1 }

describe('long-running learning regressions', () => {
  it('parks a failed idle compaction until learning activity changes', async () => {
    const { store, adapter, scheduler } = await setup(
      { ...SETTINGS, idleCompactMs: 1 },
      adapter => { adapter.failCompaction = true },
    )
    store.addFixtureExplanation({
      topicKey: 'idle/closed', title: 'Closed', sourceSessionId: SessionId('idle'),
      sourceTurn: 1, state: 'closed', topicState: 'mastered',
    })
    const reads = vi.spyOn(store, 'compactionBatch')
    scheduler.learningStateChanged()
    await until(() => scheduler.status().lastError?.code === 'EXPLAIN_COMPACTION_FAILED')
    const before = reads.mock.calls.length
    await new Promise(resolve => { setTimeout(resolve, 80) })
    expect(reads.mock.calls.length - before).toBeLessThan(4)
    expect(adapter.calls).toEqual(['compaction'])
    adapter.failCompaction = false
    store.recordEnableAction()
    scheduler.learningStateChanged()
    await until(() => store.context().inferred)
    expect(adapter.calls).toEqual(['compaction', 'compaction'])
  })

  it('explains new work while many unrelated long explanations await feedback', async () => {
    const { store, adapter, scheduler } = await setup(
      { ...SETTINGS, maxOutputTokens: 100 },
      adapter => { adapter.contextWindow = 8_000 },
    )
    for (let index = 0; index < 20; index += 1) {
      store.addFixtureExplanation({
        topicKey: `active/${index}`, title: 'Active concept',
        sourceSessionId: SessionId(`active-${index}`), sourceTurn: 1,
        revisions: [{
          title: 'Active concept', what: 'w'.repeat(800), why: 'y'.repeat(800), pitfall: 'p'.repeat(800),
        }],
      })
    }
    const result = await scheduler.requestManual({
      origin: 'manual', request: 'Explain a new topic', capsule: source('new-manual'),
    }, new AbortController().signal)
    expect(result.ok).toBe(true)
    expect(adapter.calls).toEqual(['manual:new-manual'])
    expect(store.activeExplanationCount()).toBe(21)
    expect(store.activeEntries().find(entry => entry.topicKey === 'active/0')?.payload)
      .toMatchObject({ what: 'w'.repeat(800) })
  })

  it('rephrases a long revision history while keeping original revisions readable', async () => {
    const { store, scheduler } = await setup(
      { ...SETTINGS, maxOutputTokens: 100 },
      adapter => { adapter.contextWindow = 8_000 },
    )
    const id = store.addFixtureExplanation({
      topicKey: 'rephrase/history', title: 'Original',
      sourceSessionId: SessionId('history'), sourceTurn: 1,
      revisions: Array.from({ length: 40 }, (_, index) => ({
        title: `Revision ${index + 1}`,
        what: 'w'.repeat(600), why: 'y'.repeat(600), pitfall: 'p'.repeat(600),
      })),
    })
    store.feedback({
      requestId: RequestId('retry-history'), explanationId: id,
      sourceSessionId: SessionId('history'), revision: 40, action: 'not-understood',
    })
    scheduler.learningStateChanged()
    await until(() => store.activeEntries()[0]?.revision === 41 || scheduler.status().lastError !== undefined)
    expect(scheduler.status().lastError).toBeUndefined()
    expect(store.threadPage({ limit: 100 }).entries.filter(entry => entry.kind === 'explanation')).toHaveLength(41)
  })

  it.each(['partial', 'forgotten'] as const)(
    'uses %s review evidence in hints, display, statistics, and autonomous teaching',
    result => {
      const store = new ExplainStore(':memory:')
      stores.push(store)
      const lease = store.acquireLease('review-regression')
      store.addFixtureExplanation({
        topicKey: 'review/weak', title: 'Weak concept', sourceSessionId: SessionId('review'),
        sourceTurn: 1, state: 'closed', topicState: 'mastered',
      })
      const now = Date.now()
      const first = store.startReview({ requestId: RequestId('start') }, now + 1).dashboard.current!
      const committed = store.commitReviewAnswer({
        requestId: RequestId('answer'), reviewId: first.reviewId, answer: 'An incomplete answer',
      }, { result, feedback: 'Practise this idea again.' }, GENERATION, now + 2)
      expect(committed.ok).toBe(true)
      expect(store.auxiliaryContext(100).topicHints[0]?.state).toBe('learning')
      expect(store.threadPage({}).entries[0]?.topicState).toBe('learning')
      expect(store.context().stats).toMatchObject({ learningTopics: 1, masteredTopics: 0 })
      const later = now + 2 + 86_400_001
      expect(store.reviewDashboard(later).dueCount).toBe(1)
      const pending = store.startReview({ requestId: RequestId('next-round') }, later).dashboard.current!
      const again = store.commitAutoDecision(lease, source('new-work'), {
        kind: 'explain', topicKey: 'review/weak', title: 'Weak concept',
        what: 'What', why: 'Why', pitfall: 'Pitfall', contextObservations: [],
      }, GENERATION)
      expect(again.committed).toBe(true)
      expect(store.activeExplanationCount()).toBe(1)
      expect(store.prepareReviewAnswer({
        requestId: RequestId('old-question'), reviewId: pending.reviewId, answer: 'old',
      })).toMatchObject({ ok: false, code: 'REVIEW_STALE' })
      expect(store.reviewDashboard(later).dueCount).toBe(0)
      const active = store.activeEntries()[0]!
      store.feedback({
        requestId: RequestId('understood-again'), explanationId: active.explanationId!,
        sourceSessionId: active.sourceSessionId!, revision: active.revision!, action: 'understood',
      })
      expect(store.auxiliaryContext(100).topicHints[0]?.state).toBe('mastered')
      expect(store.context().stats).toMatchObject({ learningTopics: 0, masteredTopics: 1 })
    },
  )

  it('advances question kinds per topic and repeats a failed skill', () => {
    const store = new ExplainStore(':memory:')
    stores.push(store)
    store.addFixtureExplanation({
      topicKey: 'review/single', title: 'Single concept', sourceSessionId: SessionId('single'),
      sourceTurn: 1, state: 'closed', topicState: 'mastered',
    })
    let now = Date.now() + 10
    const kinds: string[] = []
    for (const [index, result] of (['mastered', 'forgotten', 'mastered', 'mastered'] as const).entries()) {
      const question = store.startReview({ requestId: RequestId(`round-${index}`) }, now).dashboard.current!
      kinds.push(question.kind)
      const committed = store.commitReviewAnswer({
        requestId: RequestId(`answer-${index}`), reviewId: question.reviewId, answer: 'A test answer',
      }, { result, feedback: 'Feedback' }, GENERATION, now)
      if (!committed.ok) throw new Error('review commit failed')
      expect(store.auxiliaryContext(100).topicHints[0]?.state)
        .toBe(result === 'mastered' ? 'mastered' : 'learning')
      now = committed.attempt.nextReviewAt + 1
    }
    expect(kinds).toEqual(['recall', 'application', 'application', 'distinction'])
  })

  it('returns older active revisions without moving the history page cursor', () => {
    const store = new ExplainStore(':memory:')
    stores.push(store)
    const id = store.addFixtureExplanation({
      topicKey: 'page/active', title: 'Still waiting',
      sourceSessionId: SessionId('current-session'), sourceTurn: 1,
    })
    for (let index = 0; index < 31; index += 1) {
      store.addFixtureExplanation({
        topicKey: `page/history-${index}`, title: 'Later history',
        sourceSessionId: SessionId(`later-${index}`), sourceTurn: 1,
        state: 'closed', topicState: 'mastered',
      })
    }
    expect(store.threadPage({ limit: 30 }).entries.some(entry => entry.explanationId === id)).toBe(false)
    expect(store.activeEntries()).toHaveLength(1)
    expect(store.activeEntries()[0]?.explanationId).toBe(id)
    expect(store.threadPage({ limit: 30 }).hasMore).toBe(true)
  })
})
