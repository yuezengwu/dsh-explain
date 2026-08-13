import { basename } from 'node:path'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ManualExplainTarget, SourceCapsule } from './domain.ts'

/** Build one bounded capsule from a completed turn, or reject an ineligible turn. */
export function captureSourceCapsule(
  session: Session,
  end: SessionEvent<'turn/end'>,
  maxSourceChars: number,
): SourceCapsule | undefined {
  if (end.data.reason.kind !== 'completed') return undefined
  return captureEligibleSourceCapsule(session, end, maxSourceChars)
}

function captureExplicitSourceCapsule(
  session: Session,
  end: SessionEvent<'turn/end'>,
  maxSourceChars: number,
): SourceCapsule | undefined {
  if (end.data.reason.kind !== 'completed' && end.data.reason.kind !== 'max-tokens') return undefined
  return captureEligibleSourceCapsule(session, end, maxSourceChars)
}

function captureEligibleSourceCapsule(
  session: Session,
  end: SessionEvent<'turn/end'>,
  maxSourceChars: number,
): SourceCapsule | undefined {
  const start = findTurnStart(session.events, end.data.turn, end.seq)
  if (start === undefined) return undefined
  const events = session.events.slice(start, end.seq + 1)
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
export function captureManualExplainTarget(
  session: Session,
  request: string,
  maxSourceChars: number,
): ManualExplainTarget {
  return buildManualTarget(session, request, maxSourceChars, 'manual', latestSourceCapsule(session, maxSourceChars))
}

/** Pair selected visible text with its newest reliable source coordinate. */
export function captureSelectionExplainTarget(
  session: Session,
  selection: string,
  maxSourceChars: number,
): ManualExplainTarget {
  const normalized = normalizeText(selection)
  if (normalized === '') throw new Error('dsh-explain: selected explanation text must not be empty')
  return buildManualTarget(
    session,
    normalized,
    maxSourceChars,
    'selection',
    selectionSourceCapsule(session, normalized, maxSourceChars),
  )
}

/** Pair one suggested-replies accessory with the exact settled turn that produced it. */
export function captureSuggestedExplainTarget(
  session: Session,
  turn: number,
  request: string,
  maxSourceChars: number,
): ManualExplainTarget | undefined {
  const source = sourceCapsuleForTurn(session, turn, maxSourceChars)
  if (source === undefined) return undefined
  return buildManualTarget(session, request, maxSourceChars, 'suggested', source)
}

function buildManualTarget(
  session: Session,
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
      endSeq: source?.endSeq ?? session.events.at(-1)?.seq ?? 0,
      observedAt: Date.now(),
      ...(session.header.cwd === undefined ? {} : { cwdLabel: basename(session.header.cwd).slice(0, 160) }),
      userText: bounded.userText,
      assistantText: bounded.assistantText,
      tools: bounded.tools,
      truncated: bounded.truncated,
    },
  }
}

function selectionSourceCapsule(
  session: Session,
  selection: string,
  maxSourceChars: number,
): SourceCapsule | undefined {
  const needle = searchableText(selection)
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event === undefined || !searchableEventText(event).includes(needle)) continue
    if (event.type === 'assistant/message' || event.type === 'tool/result') {
      return sourceCapsuleForTurn(session, event.data.turn, maxSourceChars)
    }
    if (event.type === 'user/message') {
      return previousSourceCapsule(session, index, maxSourceChars)
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

function previousSourceCapsule(
  session: Session,
  beforeIndex: number,
  maxSourceChars: number,
): SourceCapsule | undefined {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type !== 'turn/end') continue
    const capsule = captureExplicitSourceCapsule(session, event, maxSourceChars)
    if (capsule !== undefined) return capsule
  }
  return undefined
}

function sourceCapsuleForTurn(
  session: Session,
  turn: number,
  maxSourceChars: number,
): SourceCapsule | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type !== 'turn/end' || event.data.turn !== turn) continue
    return captureExplicitSourceCapsule(session, event, maxSourceChars)
  }
  return undefined
}

function latestSourceCapsule(session: Session, maxSourceChars: number): SourceCapsule | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type !== 'turn/end') continue
    const capsule = captureSourceCapsule(session, event, maxSourceChars)
    if (capsule !== undefined) return capsule
  }
  return undefined
}

function findTurnStart(events: readonly SessionEvent[], turn: number, beforeSeq: number): number | undefined {
  for (let index = Math.min(beforeSeq, events.length - 1); index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/start' && event.data.turn === turn) return index
  }
  return undefined
}

function textBlocks(blocks: readonly ContentBlock[]): string[] {
  const texts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') texts.push(block.text)
    if (block.type === 'tool-result') texts.push(...textBlocks(block.content))
  }
  return texts
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
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
