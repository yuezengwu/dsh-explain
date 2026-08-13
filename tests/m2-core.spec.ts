import { describe, expect, it } from 'vitest'
import {
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ObservationId } from '../src/brands.ts'
import type { AuxiliaryContext, SourceCapsule } from '../src/domain.ts'
import {
  renderCompactionRequest,
  renderExplainRequest,
  renderManualExplainRequest,
  renderRephraseRequest,
} from '../src/explainer.ts'
import {
  captureManualExplainTarget,
  captureSelectionExplainTarget,
  captureSourceCapsule,
  captureSuggestedExplainTarget,
} from '../src/observer.ts'
import { CandidateQueue } from '../src/queue.ts'

const EMPTY_CONTEXT: AuxiliaryContext = {
  topicHints: [],
  activeExplanations: [],
  uncoveredObservations: [],
  uncoveredClosedExplanations: [],
}

function capsule(source: string, turn: number, observedAt: number): SourceCapsule {
  return {
    sourceSessionId: SessionId(source),
    turn,
    endSeq: turn * 10,
    observedAt,
    userText: `question ${turn}`,
    assistantText: `answer ${turn}`,
    tools: [],
    truncated: false,
  }
}

describe('completed-turn source observation', () => {
  it('captures human text, assistant text, and bounded tool results without synthetic context', () => {
    const session = Session.create(SessionId('source-a'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'How does narrowing work?' }],
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      source: { kind: 'plugin', plugin: 'test-context' },
      content: [{ type: 'text', text: 'private synthetic context' }],
    }), { surfaceOp: 'append' })
    const callId = CallId('call-1')
    session.append('tool/call', { turn: 1, step: 1, callId, name: 'read', arguments: '{"path":"secret"}' })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'result preview' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        source: { provider: 'test', model: 'test' },
        content: [
          { type: 'reasoning', text: 'hidden chain' },
          { type: 'text', text: 'A union narrows after a discriminant check.' },
        ],
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    const end = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const messagesBeforeObservation = session.deriveMessages()

    const captured = captureSourceCapsule(session, end, 10_000)
    expect(captured).toMatchObject({
      sourceSessionId: SessionId('source-a'),
      turn: 1,
      userText: 'How does narrowing work?',
      assistantText: 'A union narrows after a discriminant check.',
      tools: [{ name: 'read', resultPreview: 'result preview' }],
      truncated: false,
    })
    expect(JSON.stringify(captured)).not.toContain('private synthetic context')
    expect(JSON.stringify(captured)).not.toContain('hidden chain')
    expect(JSON.stringify(captured)).not.toContain('secret')
    expect(session.deriveMessages()).toEqual(messagesBeforeObservation)
  })

  it('rejects cancelled and step-free turns', () => {
    const cancelled = Session.create(SessionId('cancelled'))
    cancelled.append('turn/start', { turn: 1 })
    const cancelledEnd = cancelled.append('turn/end', {
      turn: 1,
      reason: { kind: 'aborted', reason: { kind: 'user' } },
    })
    expect(captureSourceCapsule(cancelled, cancelledEnd, 100)).toBeUndefined()

    const empty = Session.create(SessionId('empty'))
    empty.append('turn/start', { turn: 1 })
    const emptyEnd = empty.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(captureSourceCapsule(empty, emptyEnd, 100)).toBeUndefined()
  })

  it('pairs a manual request with the latest completed source turn or an empty-session marker', () => {
    const session = Session.create(SessionId('manual-source'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'What does this branch do?' }],
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        source: { provider: 'test', model: 'test' },
        content: [{ type: 'text', text: 'It narrows the union.' }],
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    expect(captureManualExplainTarget(session, '  请解释这个分支  ', 10_000)).toMatchObject({
      request: '请解释这个分支',
      capsule: {
        sourceSessionId: SessionId('manual-source'),
        turn: 1,
        userText: '请解释这个分支',
        assistantText: 'It narrows the union.',
      },
    })

    const empty = Session.create(SessionId('manual-empty'))
    expect(captureManualExplainTarget(empty, 'Explain discriminated unions', 10_000)).toMatchObject({
      request: 'Explain discriminated unions',
      capsule: { turn: 0, endSeq: 0, assistantText: '', tools: [] },
    })
  })

  it('locates selected assistant, tool, and context text without guessing an unavailable source', () => {
    const session = Session.create(SessionId('selection-source'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Explain the repeated marker.' }],
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        source: { provider: 'test', model: 'test' },
        content: [{ type: 'text', text: 'The repeated marker first appeared here.' }],
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('user/message', createUserMessage({
      source: { kind: 'advisor' } as never,
      content: [{ type: 'text', text: '[advisor:nit] Prefer exact checks.' }],
    }), { surfaceOp: 'append' })

    session.append('turn/start', { turn: 2 })
    session.append('step/start', { turn: 2, step: 1 })
    session.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'What changed now?' }],
    }), { surfaceOp: 'append' })
    const callId = CallId('selection-call')
    session.append('tool/call', { turn: 2, step: 1, callId, name: 'read', arguments: '{}' })
    session.append('tool/result', {
      turn: 2,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'Tool result selected text.' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 2,
      step: 1,
      message: createAssistantMessage({
        source: { provider: 'test', model: 'test' },
        content: [{ type: 'text', text: 'The repeated marker is newer in this answer.' }],
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 2, step: 1 })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    expect(captureSelectionExplainTarget(session, 'repeated   marker', 10_000)).toMatchObject({
      origin: 'selection',
      request: 'repeated marker',
      capsule: { turn: 2, assistantText: 'The repeated marker is newer in this answer.' },
    })
    expect(captureSelectionExplainTarget(session, 'Tool result selected text.', 10_000))
      .toMatchObject({ capsule: { turn: 2, tools: [{ resultPreview: 'Tool result selected text.' }] } })
    expect(captureSelectionExplainTarget(session, '[advisor:nit] Prefer exact checks.', 10_000))
      .toMatchObject({ capsule: { turn: 1 } })
    expect(captureSelectionExplainTarget(session, 'text not retained in this Session', 10_000))
      .toMatchObject({ capsule: { turn: 0, assistantText: '', tools: [] } })
    expect(captureSuggestedExplainTarget(session, 2, 'Explain the key concept.', 10_000))
      .toMatchObject({ origin: 'suggested', capsule: { turn: 2 } })
    expect(captureSuggestedExplainTarget(session, 99, 'Explain the key concept.', 10_000)).toBeUndefined()
  })

  it('allows an explicit source to bind a max-tokens answer without admitting it to autonomous observation', () => {
    const session = Session.create(SessionId('max-token-source'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        source: { provider: 'test', model: 'test' },
        content: [{ type: 'text', text: 'A partial but visible answer.' }],
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    const end = session.append('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })

    expect(captureSourceCapsule(session, end, 10_000)).toBeUndefined()
    expect(captureSuggestedExplainTarget(session, 1, 'Explain the partial answer.', 10_000))
      .toMatchObject({ origin: 'suggested', capsule: { turn: 1, assistantText: 'A partial but visible answer.' } })
  })
})

describe('latest-wins candidate queue', () => {
  it('replaces by source, evicts globally oldest, respects source gates, and retries only the latest target', () => {
    const queue = new CandidateQueue()
    const a1 = capsule('a', 1, 10)
    const b1 = capsule('b', 1, 20)
    const a2 = capsule('a', 2, 30)
    queue.push(a1, 2)
    queue.push(b1, 2)
    queue.push(a2, 2)
    expect(queue.size).toBe(2)
    expect(queue.hasExecutable(new Set([SessionId('a'), SessionId('b')]))).toBe(false)
    expect(queue.hasExecutable(new Set([SessionId('a')]))).toBe(true)

    const c1 = capsule('c', 1, 40)
    expect(queue.push(c1, 2)?.capsule).toEqual(b1)
    const selected = queue.take(new Set([SessionId('a')]))
    expect(selected?.capsule).toEqual(c1)
    if (selected === undefined) throw new Error('candidate was not selected')
    queue.retry(selected)
    expect(queue.take(new Set([SessionId('a')]))?.attempts).toBe(1)

    const oldA = queue.take(new Set())
    if (oldA === undefined) throw new Error('replacement candidate was not selected')
    queue.push(capsule('a', 3, 50), 2)
    queue.retry(oldA)
    expect(queue.take(new Set())?.capsule.turn).toBe(3)

    queue.push(capsule('d', 1, 60), 2)
    queue.push(capsule('e', 1, 70), 2)
    expect(queue.trim(1)).toHaveLength(1)
    const stale = queue.take(new Set())
    if (stale === undefined) throw new Error('candidate was not available before clear')
    queue.clear()
    queue.defer(stale)
    expect(queue.size).toBe(0)
  })
})

describe('strict auxiliary JSON parsing', () => {
  it('accepts bounded autonomous and rephrase results while rejecting extra fields and invalid TopicKey', () => {
    const explain = renderExplainRequest(EMPTY_CONTEXT, capsule('a', 1, 1), 500)
    expect(explain.parse(JSON.stringify({
      kind: 'explain',
      topicKey: 'typescript/narrowing',
      title: 'Narrowing',
      what: 'What',
      why: 'Why',
      pitfall: 'Pitfall',
      contextObservations: [{
        kind: 'dialogue-preference',
        dimension: 'examples',
        value: 'Prefer one concrete example.',
        confidence: 'medium',
      }],
    }))).toMatchObject({ kind: 'explain', topicKey: 'typescript/narrowing' })
    expect(() => explain.parse(JSON.stringify({
      kind: 'skip', reason: 'not-useful', contextObservations: [], extra: true,
    }))).toThrow(/unexpected fields/)
    expect(() => explain.parse(JSON.stringify({
      kind: 'explain', topicKey: 'Bad Topic', title: 'T', what: 'W', why: 'Y', pitfall: 'P',
      contextObservations: [],
    }))).toThrow(/invalid topicKey/)

    const rephrase = renderRephraseRequest(EMPTY_CONTEXT, {
      explanationId: 'explanation' as never,
      topicId: 'topic' as never,
      topicKey: 'typescript/narrowing',
      sourceSessionId: SessionId('a'),
      sourceTurn: 1,
      revision: 1,
      feedbackOrdinal: 2,
      sourceSummary: { userText: 'question', toolNames: [], truncated: false },
      origin: 'autonomous',
      revisions: [{ revision: 1, title: 'T', what: 'W', why: 'Y', pitfall: 'P' }],
    }, 500)
    expect(rephrase.parse('{"title":"T2","what":"W2","why":"Y2","pitfall":"P2"}'))
      .toEqual({ title: 'T2', what: 'W2', why: 'Y2', pitfall: 'P2' })

    const manual = renderManualExplainRequest(EMPTY_CONTEXT, {
      origin: 'manual',
      request: 'Explain narrowing',
      capsule: capsule('manual', 0, 1),
    }, 500)
    expect(manual.parse('{"topicKey":"typescript/narrowing","title":"T","what":"W","why":"Y","pitfall":"P"}'))
      .toEqual({ topicKey: 'typescript/narrowing', title: 'T', what: 'W', why: 'Y', pitfall: 'P' })
    expect(() => manual.parse('{"kind":"skip","reason":"not-useful"}')).toThrow(/unexpected fields/)
    expect(() => manual.parse('{"topicKey":"Bad Topic","title":"T","what":"W","why":"Y","pitfall":"P"}'))
      .toThrow(/invalid topicKey/)
  })

  it('allows checkpoint citations only from the supplied evidence sets', () => {
    const observationId = ObservationId('observation-1')
    const request = renderCompactionRequest({
      contextGeneration: 1,
      activityGeneration: 1,
      observations: [{
        observationId,
        sourceSessionId: SessionId('a'),
        sourceTurn: 1,
        observation: {
          kind: 'dialogue-preference', dimension: 'examples', value: 'Use examples', confidence: 'high',
        },
        createdAt: 1,
      }],
      explanations: [],
      throughOrdinal: 0,
    }, {}, 500)
    expect(JSON.stringify(request.messages)).toContain('dialogueProfile is always an array')
    const requestBlock = request.messages[0]?.content[0]
    if (requestBlock?.type !== 'text') throw new Error('compaction request text is missing')
    expect(JSON.parse(requestBlock.text)).toMatchObject({ languageSample: 'Use examples' })
    expect(request.parse(JSON.stringify({
      dialogueProfile: [{
        kind: 'examples', preference: 'Use examples', confidence: 'high',
        evidenceObservationIds: [observationId], evidenceEntryOrdinals: [],
      }],
      knowledgeOverview: '', learningTrend: '',
    })).dialogueProfile[0]?.evidenceObservationIds).toEqual([observationId])
    expect(() => request.parse(JSON.stringify({
      dialogueProfile: [{
        kind: 'examples', preference: 'Use examples', confidence: 'high',
        evidenceObservationIds: ['invented'], evidenceEntryOrdinals: [],
      }],
      knowledgeOverview: '', learningTrend: '',
    }))).toThrow(/unavailable evidence/)
  })

  it('rejects a context checkpoint that drops the source writing system', () => {
    const observationId = ObservationId('observation-zh')
    const request = renderCompactionRequest({
      contextGeneration: 1,
      activityGeneration: 1,
      observations: [{
        observationId,
        sourceSessionId: SessionId('a'),
        sourceTurn: 1,
        observation: {
          kind: 'dialogue-preference', dimension: 'examples', value: '请使用具体示例', confidence: 'high',
        },
        createdAt: 1,
      }],
      explanations: [],
      throughOrdinal: 0,
    }, {}, 500)
    expect(JSON.stringify(request.messages)).toContain('Han characters')
    expect(() => request.parse(JSON.stringify({
      dialogueProfile: [],
      knowledgeOverview: 'Understands discriminated unions.',
      learningTrend: 'Needs more practical examples.',
    }))).toThrow(/preserve Han characters/)
    expect(request.parse(JSON.stringify({
      dialogueProfile: [],
      knowledgeOverview: '已理解可辨识联合。',
      learningTrend: '需要更多实际示例。',
    })).learningTrend).toBe('需要更多实际示例。')
  })
})
