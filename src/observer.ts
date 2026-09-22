import { basename } from 'node:path'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ManualExplainTarget, SourceCapsule } from './domain.ts'

export interface ObservedSession extends Pick<Session, 'id' | 'header' | 'seq'> {
  /** Read backwards at one fixed cut through the host's asynchronous history API. */
  eventsBefore(beforeSeq?: number): AsyncIterable<SessionEvent>
}

export function observeSession(
  session: Pick<Session, 'id' | 'header' | 'seq'>,
  history: Pick<SessionController, 'page'>,
  signal: AbortSignal,
): ObservedSession {
  const { id, header, seq } = session
  return {
    id, header, seq,
    async * eventsBefore(beforeSeq = seq) {
      let cursor = Math.min(beforeSeq, seq)
      while (cursor > 0) {
        signal.throwIfAborted()
        const page = await history.page({
          address: { kind: 'session', sessionId: id },
          throughSeq: seq - 1,
          beforeSeq: cursor,
          maxMessages: 16,
        }, signal)
        signal.throwIfAborted()
        const next = page.records.reduce((min, record) => Math.min(min, record.event.seq), cursor)
        if (page.hasMore && next >= cursor) {
          throw new Error('dsh-explain: Session history page did not advance')
        }
        // Older hosts may pack stream chunks into separate records. Only settled
        // events participate in source capture; the host owns the wire encoding.
        for (const record of [...page.records].reverse()) {
          if (record.type !== 'event' || record.event.seq >= cursor || record.event.seq < 0) continue
          yield record.event as unknown as SessionEvent
        }
        if (!page.hasMore) return
        cursor = next
      }
    },
  }
}

/** Build one bounded capsule from a completed turn, or reject an ineligible turn. */
export async function captureSourceCapsule(
  session: ObservedSession,
  end: SessionEvent<'turn/end'>,
  maxSourceChars: number,
): Promise<SourceCapsule | undefined> {
  if (end.data.reason.kind !== 'completed') return undefined
  return captureEligibleSourceCapsule(session, end, maxSourceChars)
}

async function captureExplicitSourceCapsule(
  session: ObservedSession,
  end: SessionEvent<'turn/end'>,
  maxSourceChars: number,
): Promise<SourceCapsule | undefined> {
  if (end.data.reason.kind !== 'completed' && end.data.reason.kind !== 'max-tokens') return undefined
  return captureEligibleSourceCapsule(session, end, maxSourceChars)
}

async function captureEligibleSourceCapsule(
  session: ObservedSession,
  end: SessionEvent<'turn/end'>,
  maxSourceChars: number,
): Promise<SourceCapsule | undefined> {
  const events: SessionEvent[] = []
  let foundStart = false
  for await (const event of session.eventsBefore(end.seq + 1)) {
    events.push(event)
    if (event.type === 'turn/start' && event.data.turn === end.data.turn) {
      foundStart = true
      break
    }
  }
  if (!foundStart) return undefined
  events.reverse()
  if (!events.some(event => event.type === 'step/start' && event.data.turn === end.data.turn)) return undefined

  const userParts: string[] = []
  const assistantParts: string[] = []
  const tools: { name: string; resultPreview?: string }[] = []
  const calls = new Map<string, number>()
  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        if (event.data.source.kind === 'user') userParts.push(...textBlocks(event.data.content))
        break
      }
      case 'assistant/message': {
        if (event.data.turn === end.data.turn) assistantParts.push(...textBlocks(event.data.message.content))
        break
      }
      case 'tool/call': {
        if (event.data.turn !== end.data.turn) break
        calls.set(event.data.callId, tools.length)
        tools.push({ name: event.data.name })
        break
      }
      case 'tool/result': {
        if (event.data.turn !== end.data.turn) break
        const index = calls.get(event.data.message.source.callId)
        if (index === undefined) break
        const preview = textBlocks(event.data.message.content).join('\n').trim()
        const target = tools[index]
        if (target !== undefined && preview !== '') {
          tools[index] = { ...target, resultPreview: truncateMiddle(preview, 1_000).text }
        }
        break
      }
      default: break
    }
  }
  const assistantRaw = normalizeText(assistantParts.join('\n'))
  if (assistantRaw === '') return undefined
  const userRaw = normalizeText(userParts.join('\n'))
  const bounded = boundCapsule(userRaw, assistantRaw, tools, maxSourceChars)
  return {
    sourceSessionId: session.id,
    turn: end.data.turn,
    endSeq: end.seq,
    observedAt: Date.now(),
    ...(session.header.cwd === undefined ? {} : { cwdLabel: basename(session.header.cwd).slice(0, 160) }),
    userText: bounded.userText,
    assistantText: bounded.assistantText,
    tools: bounded.tools,
    truncated: bounded.truncated,
  }
}

/** Build one explicit request from command input and the latest eligible completed turn. */
export async function captureManualExplainTarget(
  session: ObservedSession,
  request: string,
  maxSourceChars: number,
): Promise<ManualExplainTarget> {
  return buildManualTarget(session, request, maxSourceChars, 'manual', await latestSourceCapsule(session, maxSourceChars))
}

/** Pair selected visible text with its newest reliable source coordinate. */
export async function captureSelectionExplainTarget(
  session: ObservedSession,
  selection: string,
  maxSourceChars: number,
): Promise<ManualExplainTarget> {
  const normalized = normalizeText(selection)
  if (normalized === '') throw new Error('dsh-explain: selected explanation text must not be empty')
  return buildManualTarget(
    session,
    normalized,
    maxSourceChars,
    'selection',
    await selectionSourceCapsule(session, normalized, maxSourceChars),
  )
}

/** Pair one Explain-owned answer shortcut with its exact settled source turn. */
export async function captureAnswerExplainTarget(
  session: ObservedSession,
  turn: number,
  request: string,
  maxSourceChars: number,
): Promise<ManualExplainTarget | undefined> {
  const source = await sourceCapsuleForTurn(session, turn, maxSourceChars)
  if (source === undefined) return undefined
  return buildManualTarget(session, request, maxSourceChars, 'answer', source)
}

function buildManualTarget(
  session: ObservedSession,
  request: string,
  maxSourceChars: number,
  origin: ManualExplainTarget['origin'],
  source: SourceCapsule | undefined,
): ManualExplainTarget {
  const normalized = normalizeText(request)
  if (normalized === '') throw new Error('dsh-explain: manual explanation request must not be empty')
  const bounded = boundCapsule(
    normalized,
    source?.assistantText ?? '',
    source?.tools ?? [],
    maxSourceChars,
  )
  return {
    origin,
    request: bounded.userText,
    capsule: {
      sourceSessionId: session.id,
      turn: source?.turn ?? 0,
      endSeq: source?.endSeq ?? Math.max(session.seq - 1, 0),
      observedAt: Date.now(),
      ...(session.header.cwd === undefined ? {} : { cwdLabel: basename(session.header.cwd).slice(0, 160) }),
      userText: bounded.userText,
      assistantText: bounded.assistantText,
      tools: bounded.tools,
      truncated: bounded.truncated,
    },
  }
}

async function selectionSourceCapsule(
  session: ObservedSession,
  selection: string,
  maxSourceChars: number,
): Promise<SourceCapsule | undefined> {
  const needle = searchableText(selection)
  for await (const event of session.eventsBefore()) {
    if (event === undefined || !searchableEventText(event).includes(needle)) continue
    if (event.type === 'assistant/message' || event.type === 'tool/result') {
      return sourceCapsuleForTurn(session, event.data.turn, maxSourceChars)
    }
    if (event.type === 'user/message') {
      return previousSourceCapsule(session, event.seq, maxSourceChars)
    }
  }
  return undefined
}

function searchableEventText(event: SessionEvent): string {
  if (event.type === 'user/message') return searchableText(textBlocks(event.data.content).join('\n'))
  if (event.type === 'assistant/message') return searchableText(textBlocks(event.data.message.content).join('\n'))
  if (event.type === 'tool/result') return searchableText(textBlocks(event.data.message.content).join('\n'))
  return ''
}

function searchableText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

async function previousSourceCapsule(
  session: ObservedSession,
  beforeIndex: number,
  maxSourceChars: number,
): Promise<SourceCapsule | undefined> {
  for await (const event of session.eventsBefore(beforeIndex)) {
    if (event?.type !== 'turn/end') continue
    const capsule = await captureExplicitSourceCapsule(session, event, maxSourceChars)
    if (capsule !== undefined) return capsule
  }
  return undefined
}

async function sourceCapsuleForTurn(
  session: ObservedSession,
  turn: number,
  maxSourceChars: number,
): Promise<SourceCapsule | undefined> {
  for await (const event of session.eventsBefore()) {
    if (event?.type !== 'turn/end' || event.data.turn !== turn) continue
    return captureExplicitSourceCapsule(session, event, maxSourceChars)
  }
  return undefined
}

async function latestSourceCapsule(session: ObservedSession, maxSourceChars: number): Promise<SourceCapsule | undefined> {
  for await (const event of session.eventsBefore()) {
    if (event?.type !== 'turn/end') continue
    const capsule = await captureSourceCapsule(session, event, maxSourceChars)
    if (capsule !== undefined) return capsule
  }
  return undefined
}

type ReadableBlock = ContentBlock | { readonly type: 'tool-result'; readonly content: readonly ReadableBlock[] }

function textBlocks(blocks: readonly ReadableBlock[]): string[] {
  const texts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') texts.push(block.text)
    if (block.type === 'tool-result') texts.push(...textBlocks(block.content))
  }
  return texts
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t \u00a0\u1680\u2000-\u200b\u202f\u205f\u3000]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function boundCapsule(
  userText: string,
  assistantText: string,
  tools: readonly { readonly name: string; readonly resultPreview?: string }[],
  limit: number,
): { userText: string; assistantText: string; tools: SourceCapsule['tools']; truncated: boolean } {
  const toolChars = tools.reduce((total, tool) => total + tool.name.length + (tool.resultPreview?.length ?? 0), 0)
  if (userText.length + assistantText.length + toolChars <= limit) {
    return { userText, assistantText, tools, truncated: false }
  }
  const userLimit = Math.floor(limit * 0.3)
  const assistantLimit = Math.max(1, Math.floor(limit * 0.55))
  let remaining = Math.max(0, limit - userLimit - assistantLimit)
  const boundedTools: { name: string; resultPreview?: string }[] = []
  for (const tool of tools) {
    if (remaining <= 0) break
    const name = truncateMiddle(tool.name, remaining)
    remaining -= name.text.length
    if (name.text === '') break
    if (tool.resultPreview === undefined || remaining <= 0) {
      boundedTools.push({ name: name.text })
      continue
    }
    const preview = truncateMiddle(tool.resultPreview, remaining)
    remaining -= preview.text.length
    boundedTools.push({ name: name.text, ...(preview.text === '' ? {} : { resultPreview: preview.text }) })
  }
  return {
    userText: truncateMiddle(userText, userLimit).text,
    assistantText: truncateMiddle(assistantText, assistantLimit).text,
    tools: boundedTools,
    truncated: true,
  }
}

function truncateMiddle(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false }
  if (limit <= 0) return { text: '', truncated: true }
  if (limit === 1) return { text: '…', truncated: true }
  const head = Math.ceil((limit - 1) / 2)
  const tail = Math.floor((limit - 1) / 2)
  return { text: `${text.slice(0, head)}…${text.slice(text.length - tail)}`, truncated: true }
}
