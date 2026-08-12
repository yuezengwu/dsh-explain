import { afterEach, describe, expect, it } from 'vitest'
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
  failCompaction = false
  failAutonomous = false
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
      await abortableDelay(5, options.signal)
      const compaction = options.purpose === 'compaction'
      const rephrase = options.system?.includes('Rephrase one still-active explanation') === true
      const source = requestObject(options)
      const sourceId = String((source.sourceCapsule as { sourceSessionId?: unknown } | undefined)?.sourceSessionId ?? 'rephrase')
      this.calls.push(compaction ? 'compaction' : rephrase ? 'rephrase' : `auto:${sourceId}`)
      this.efforts.push(options.reasoningEffort)
      if (compaction && this.failCompaction) throw new Error('test compaction provider failure')
      if (!compaction && !rephrase && this.failAutonomous) throw new Error('test autonomous provider failure')
      const response = rephrase
        ? { title: 'Narrowing with labels', what: 'Each member has a label.', why: 'The label identifies the member.', pitfall: 'Keep labels literal.' }
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

describe('real LLM-service scheduler integration', () => {
  it('recovers a configured route when its adapter registers after startup', async () => {
    const { ctx, store, adapter, scheduler } = await setup(SETTINGS, undefined, false)
    expect(scheduler.status()).toMatchObject({ state: 'failed', lastError: { code: 'RUNTIME_FAILED' } })

    ctx.llm.registerAdapter(['learning'], adapter)
    scheduler.adaptersUpdated()
    await until(() => scheduler.status().state === 'ready')
    scheduler.enqueue(source('late-adapter'))
    await until(() => store.activeExplanationCount() === 1)
    expect(adapter.calls).toEqual(['auto:late-adapter'])
  })

  it('serializes autonomous calls globally and persists both independent source explanations', async () => {
    const { store, adapter, scheduler } = await setup()
    scheduler.enqueue(source('a'))
    scheduler.enqueue(source('b'))
    await until(() => store.activeExplanationCount() === 2)
    expect(adapter.maxActive).toBe(1)
    expect(adapter.calls).toEqual(['auto:a', 'auto:b'])
    expect(adapter.efforts).toEqual(['off', 'off'])
    expect(store.autoBudget(50).used).toBe(2)
    expect(store.threadPage({ limit: 10 }).entries.map(entry => entry.sourceSessionId))
      .toEqual([SessionId('b'), SessionId('a')])
    await scheduler.dispose()
    schedulers.splice(schedulers.indexOf(scheduler), 1)
    stores.splice(stores.indexOf(store), 1)
    store.close()
  })

  it('restores a persisted rephrase target, appends revision two, and keeps it outside the auto budget', async () => {
    const { store, adapter, scheduler } = await setup()
    scheduler.enqueue(source('a'))
    await until(() => store.activeExplanationCount() === 1)
    const first = store.threadPage({ limit: 10 }).entries[0]
    if (first?.explanationId === undefined || first.revision === undefined) throw new Error('missing explanation')
    const result = store.feedback({
      requestId: RequestId('retry-explanation'),
      sourceSessionId: SessionId('a'),
      explanationId: first.explanationId,
      revision: first.revision,
      action: 'not-understood',
    })
    expect(result.ok).toBe(true)
    scheduler.learningStateChanged({ explanationId: first.explanationId, revision: first.revision })
    await until(() => store.threadPage({ limit: 10 }).entries.some(entry => entry.revision === 2))
    expect(adapter.calls).toEqual(['auto:a', 'rephrase'])
    expect(store.autoBudget(50).used).toBe(1)
    expect(store.threadPage({ limit: 10 }).entries[0]).toMatchObject({
      explanationId: first.explanationId,
      revision: 2,
      topicTitle: 'Narrowing with labels',
    })
    await scheduler.dispose()
    schedulers.splice(schedulers.indexOf(scheduler), 1)
    stores.splice(stores.indexOf(store), 1)
    store.close()
  })

  it('parks a candidate behind its source active gate without an empty-drain spin', async () => {
    const { store, adapter, scheduler } = await setup()
    scheduler.enqueue(source('a'))
    await until(() => store.activeExplanationCount() === 1)
    scheduler.enqueue({ ...source('a'), turn: 2, endSeq: 10, observedAt: Date.now() + 1 })
    await new Promise(resolve => { setTimeout(resolve, 30) })
    expect(adapter.calls).toEqual(['auto:a'])
    expect(scheduler.status().pendingCandidates).toBe(1)
    await scheduler.dispose()
    schedulers.splice(schedulers.indexOf(scheduler), 1)
    stores.splice(stores.indexOf(store), 1)
    store.close()
  })

  it('surfaces a terminal autonomous failure after exhausting its retry attempts', async () => {
    const { store, adapter, scheduler } = await setup(SETTINGS, target => { target.failAutonomous = true })
    scheduler.enqueue(source('provider-failure'))
    await until(() => scheduler.status().lastError?.code === 'EXPLAIN_AUTO_FAILED')
    expect(scheduler.status().lastError).toEqual({
      code: 'EXPLAIN_AUTO_FAILED',
      message: 'dsh-explain: auxiliary model failed (UNKNOWN): test autonomous provider failure',
    })
    expect(store.autoBudget(50).used).toBe(2)
    expect(store.activeExplanationCount()).toBe(0)
    expect(adapter.calls).toEqual(['auto:provider-failure', 'auto:provider-failure'])
  })

  it('surfaces pressure-compaction failure and never sends the autonomous request', async () => {
    const { store, adapter, scheduler } = await setup(
      { ...SETTINGS, maxOutputTokens: 100, maxCompactionOutputTokens: 100 },
      target => {
        target.contextWindow = 8_000
        target.failCompaction = true
      },
    )
    store.addFixtureExplanation({
      topicKey: 'existing/topic',
      title: 'Existing closed concept',
      sourceSessionId: SessionId('old-source'),
      sourceTurn: 1,
      state: 'closed',
      topicState: 'mastered',
    })
    scheduler.enqueue({
      ...source('new-source'),
      userText: 'x'.repeat(24_000),
      assistantText: 'A compact answer.',
    })
    await until(() => scheduler.status().lastError?.code === 'EXPLAIN_COMPACTION_FAILED')
    expect(adapter.calls).toEqual(['compaction'])
    expect(store.autoBudget(50).used).toBe(0)
    expect(store.activeExplanationCount()).toBe(0)
    await scheduler.dispose()
    schedulers.splice(schedulers.indexOf(scheduler), 1)
    stores.splice(stores.indexOf(store), 1)
    store.close()
  })
})

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
