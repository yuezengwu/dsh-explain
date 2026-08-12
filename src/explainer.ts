import {
  BlockAssembler,
  createMessage,
  createUserMessage,
  type Message,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolves the token-meter Context declaration without adding a runtime import.
import type {} from '@deepseek-ai/dsh-token-meter'
import { ObservationId } from './brands.ts'
import type { ExplainRuntimeSettings } from './config.ts'
import type {
  AuxiliaryContext,
  CompactionBatch,
  ExplainContextSnapshot,
  ExplainDecision,
  ExplanationContent,
  GenerationRecord,
  RephraseTarget,
  SourceCapsule,
} from './domain.ts'

const SYSTEM = `You are dsh-explain, a private auxiliary learning assistant. Decide whether one completed coding-work turn contains a useful teachable concept for this user, using only the supplied bounded source capsule and learning context. Do not infer occupation, identity, health, politics, or other sensitive attributes. Return exactly one JSON object with no markdown or extra text.`

const REPHRASE_SYSTEM = `You are dsh-explain. Rephrase one still-active explanation after the user said they did not understand. Preserve the topic identity, use a materially different explanation strategy, and return exactly one JSON object with title, what, why, and pitfall. Do not return markdown or extra fields.`

const COMPACTION_SYSTEM = `You are dsh-explain's context compactor. Produce a full replacement learning-context snapshot from the previous snapshot, new structured observations, closed explanations, and authoritative statistics. Never infer occupation, identity, health, politics, or other sensitive attributes. Topic mastered/learning state is not yours to set. Return exactly one JSON object with dialogueProfile, knowledgeOverview, and learningTrend.`

/** Fully rendered request priced before any provider attempt is reserved. */
export interface AuxiliaryRequest<T> {
  readonly system: string
  readonly messages: readonly Message[]
  readonly maxTokens: number
  readonly purpose?: 'compaction'
  readonly parse: (text: string) => T
}

/** Exact route capacity required by the pressure gate. */
export interface ExplainRoute {
  readonly provider: string
  readonly model: string
  readonly contextWindow: number
}

/** Validate the configured exact provider/model route and capacity. */
export async function resolveExplainRoute(
  ctx: Context,
  settings: ExplainRuntimeSettings,
  signal?: AbortSignal,
): Promise<ExplainRoute> {
  if (settings.provider === undefined || settings.model === undefined) {
    throw new ExplainRouteError('MODEL_ROUTE_REQUIRED', 'Choose an auxiliary provider and model before enabling learning mode.')
  }
  const info = await ctx.llm.resolveModelInfo(settings.provider, settings.model, signal)
  if (info.context === undefined) {
    throw new ExplainRouteError(
      'MODEL_CONTEXT_REQUIRED',
      'The selected model does not publish a context window; configure its exact capacity first.',
    )
  }
  return { provider: settings.provider, model: settings.model, contextWindow: info.context.contextWindow }
}

/** Build the strict autonomous decision request. */
export function renderExplainRequest(
  context: AuxiliaryContext,
  capsule: SourceCapsule,
  maxTokens: number,
): AuxiliaryRequest<ExplainDecision> {
  return {
    system: SYSTEM,
    messages: [jsonMessage({
      task: 'Return kind=skip with reason and contextObservations, or kind=explain with topicKey/title/what/why/pitfall and contextObservations.',
      limits: { contextObservations: 4, titleChars: 120, fieldChars: 2_000, topicKeyChars: 80 },
      learningContext: context,
      sourceCapsule: capsule,
    })],
    maxTokens,
    parse: parseExplainDecision,
  }
}

/** Build one source-independent rephrase request. */
export function renderRephraseRequest(
  context: AuxiliaryContext,
  target: RephraseTarget,
  maxTokens: number,
): AuxiliaryRequest<ExplanationContent> {
  return {
    system: REPHRASE_SYSTEM,
    messages: [jsonMessage({
      task: 'Explain the same topic again using a different framing suitable for the current global learning context.',
      learningContext: context,
      target: {
        topicKey: target.topicKey,
        revisions: target.revisions,
        sourceSummary: target.sourceSummary,
      },
    })],
    maxTokens,
    parse: parseExplanationContent,
  }
}

/** Build one full-snapshot compaction request with evidence allowlists. */
export function renderCompactionRequest(
  batch: CompactionBatch,
  stats: unknown,
  maxTokens: number,
): AuxiliaryRequest<ExplainContextSnapshot> {
  const observationIds = new Set<string>([
    ...(batch.previous?.context.dialogueProfile.flatMap(item => item.evidenceObservationIds) ?? []),
    ...batch.observations.map(item => item.observationId),
  ])
  const entryOrdinals = new Set<number>([
    ...(batch.previous?.context.dialogueProfile.flatMap(item => item.evidenceEntryOrdinals) ?? []),
    ...batch.explanations.flatMap(item => item.entryOrdinals),
  ])
  return {
    system: COMPACTION_SYSTEM,
    messages: [jsonMessage({
      previous: batch.previous?.context ?? null,
      newObservations: batch.observations,
      closedExplanations: batch.explanations,
      authoritativeStats: stats,
    })],
    maxTokens,
    purpose: 'compaction',
    parse: text => parseContextSnapshot(text, observationIds, entryOrdinals),
  }
}

/** Heuristically price the complete request plus output reservation. */
export function estimateAuxiliaryRequest(ctx: Context, request: AuxiliaryRequest<unknown>): number {
  const system = createMessage({
    role: 'system',
    source: { kind: 'plugin', plugin: 'dsh-explain' },
    content: [{ type: 'text', text: request.system }],
  })
  return ctx.tokenMeter.estimateMessage(system)
    + request.messages.reduce((total, message) => total + ctx.tokenMeter.estimateMessage(message), 0)
    + request.maxTokens
}

/** Send one already-priced request and parse its single text result. */
export async function runAuxiliaryRequest<T>(
  ctx: Context,
  route: ExplainRoute,
  request: AuxiliaryRequest<T>,
  timeoutMs: number,
  parentSignal: AbortSignal,
): Promise<{ readonly value: T; readonly generation: GenerationRecord }> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = AbortSignal.any([parentSignal, timeout])
  const prepared = await ctx.llm.prepareCall({
    provider: route.provider,
    model: route.model,
    maxTokens: request.maxTokens,
  }, signal)
  const assembler = new BlockAssembler()
  for await (const chunk of prepared.stream({
    ...prepared.config,
    messages: [...request.messages],
    system: request.system,
    signal,
    ...(request.purpose === undefined ? {} : { purpose: request.purpose }),
  })) assembler.push(chunk)
  const finish = assembler.finish
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    throw new Error(`dsh-explain: auxiliary model failed (${finish.failure.code}): ${finish.failure.message}`)
  }
  if (finish.kind !== 'stop') throw new Error(`dsh-explain: auxiliary model stopped with ${finish.kind}`)
  const blocks = assembler.blocks()
  if (blocks.some(block => block.type === 'tool-call')) {
    throw new Error('dsh-explain: auxiliary model returned a tool call')
  }
  const text = blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('').trim()
  if (text === '') throw new Error('dsh-explain: auxiliary model returned no text')
  return {
    value: request.parse(text),
    generation: generation(route, assembler.usage),
  }
}

/** Stable route-validation error used by commands and Remote. */
export class ExplainRouteError extends Error {
  constructor(
    readonly code: 'MODEL_ROUTE_REQUIRED' | 'MODEL_CONTEXT_REQUIRED',
    message: string,
  ) {
    super(message)
    this.name = 'ExplainRouteError'
  }
}

function jsonMessage(value: unknown): Message {
  return createUserMessage({
    source: { kind: 'plugin', plugin: 'dsh-explain' },
    content: [{ type: 'text', text: JSON.stringify(value) }],
  })
}

function generation(route: ExplainRoute, usage: TokenUsage | undefined): GenerationRecord {
  return {
    provider: route.provider,
    model: route.model,
    generatedAt: Date.now(),
    ...(usage === undefined ? {} : { usage }),
  }
}

function parseExplainDecision(text: string): ExplainDecision {
  const value = jsonObject(text, 'autonomous decision')
  const observations = parseObservations(value.contextObservations)
  if (value.kind === 'skip') {
    exactKeys(value, ['contextObservations', 'kind', 'reason'], 'skip decision')
    if (value.reason !== 'already-known' && value.reason !== 'not-useful'
      && value.reason !== 'insufficient-context') throw new Error('dsh-explain: invalid skip reason')
    return { kind: 'skip', reason: value.reason, contextObservations: observations }
  }
  if (value.kind !== 'explain') throw new Error('dsh-explain: autonomous decision has invalid kind')
  exactKeys(value, ['contextObservations', 'kind', 'pitfall', 'title', 'topicKey', 'what', 'why'], 'explain decision')
  const content = parseExplanationObject(value)
  const topicKey = requiredText(value.topicKey, 'topicKey', 80)
  if (!validTopicKey(topicKey)) throw new Error('dsh-explain: invalid topicKey')
  return { kind: 'explain', topicKey, ...content, contextObservations: observations }
}

function parseObservations(value: unknown): ExplainDecision['contextObservations'] {
  if (!Array.isArray(value) || value.length > 4) {
    throw new Error('dsh-explain: contextObservations must contain at most four items')
  }
  return value.map((candidate) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('dsh-explain: context observation must be an object')
    }
    const item = candidate as Record<string, unknown>
    const confidence = item.confidence
    if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') {
      throw new Error('dsh-explain: context observation has invalid confidence')
    }
    if (item.kind === 'dialogue-preference') {
      exactKeys(item, ['confidence', 'dimension', 'kind', 'value'], 'dialogue observation')
      if (item.dimension !== 'verbosity' && item.dimension !== 'structure'
        && item.dimension !== 'examples' && item.dimension !== 'terminology') {
        throw new Error('dsh-explain: context observation has invalid dimension')
      }
      return {
        kind: item.kind,
        dimension: item.dimension,
        value: requiredText(item.value, 'observation value', 240),
        confidence,
      }
    }
    if (item.kind !== 'topic-familiarity') throw new Error('dsh-explain: context observation has invalid kind')
    exactKeys(item, ['confidence', 'kind', 'level', 'topicKey'], 'familiarity observation')
    const topicKey = requiredText(item.topicKey, 'observation topicKey', 80)
    if (!validTopicKey(topicKey)) throw new Error('dsh-explain: context observation has invalid topicKey')
    if (item.level !== 'unknown' && item.level !== 'beginner'
      && item.level !== 'working' && item.level !== 'advanced') {
      throw new Error('dsh-explain: context observation has invalid level')
    }
    return { kind: item.kind, topicKey, level: item.level, confidence }
  })
}

function parseExplanationContent(text: string): ExplanationContent {
  const value = jsonObject(text, 'rephrase decision')
  exactKeys(value, ['pitfall', 'title', 'what', 'why'], 'rephrase decision')
  return parseExplanationObject(value)
}

function parseExplanationObject(value: Record<string, unknown>): ExplanationContent {
  return {
    title: requiredText(value.title, 'title', 120),
    what: requiredText(value.what, 'what', 2_000),
    why: requiredText(value.why, 'why', 2_000),
    pitfall: requiredText(value.pitfall, 'pitfall', 2_000),
  }
}

function parseContextSnapshot(
  text: string,
  allowedObservationIds: ReadonlySet<string>,
  allowedEntryOrdinals: ReadonlySet<number>,
): ExplainContextSnapshot {
  const value = jsonObject(text, 'context checkpoint')
  exactKeys(value, ['dialogueProfile', 'knowledgeOverview', 'learningTrend'], 'context checkpoint')
  if (!Array.isArray(value.dialogueProfile) || value.dialogueProfile.length > 16) {
    throw new Error('dsh-explain: dialogueProfile must contain at most 16 items')
  }
  const dialogueProfile: ExplainContextSnapshot['dialogueProfile'][number][] = value.dialogueProfile.map((candidate) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('dsh-explain: dialogueProfile item must be an object')
    }
    const item = candidate as Record<string, unknown>
    exactKeys(item, ['confidence', 'evidenceEntryOrdinals', 'evidenceObservationIds', 'kind', 'preference'], 'dialogueProfile item')
    if (item.kind !== 'verbosity' && item.kind !== 'structure'
      && item.kind !== 'examples' && item.kind !== 'terminology') {
      throw new Error('dsh-explain: dialogueProfile item has invalid kind')
    }
    if (item.confidence !== 'low' && item.confidence !== 'medium' && item.confidence !== 'high') {
      throw new Error('dsh-explain: dialogueProfile item has invalid confidence')
    }
    const observationIds = evidenceStrings(item.evidenceObservationIds, 'observation')
    const ordinals = evidenceOrdinals(item.evidenceEntryOrdinals)
    if (observationIds.some(identity => !allowedObservationIds.has(identity))
      || ordinals.some(ordinal => !allowedEntryOrdinals.has(ordinal))) {
      throw new Error('dsh-explain: dialogueProfile cites unavailable evidence')
    }
    return {
      kind: item.kind,
      preference: requiredText(item.preference, 'preference', 240),
      confidence: item.confidence,
      evidenceObservationIds: observationIds.map(ObservationId),
      evidenceEntryOrdinals: ordinals,
    }
  })
  return {
    dialogueProfile,
    knowledgeOverview: optionalText(value.knowledgeOverview, 'knowledgeOverview', 2_000),
    learningTrend: optionalText(value.learningTrend, 'learningTrend', 2_000),
  }
}

function evidenceStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 8
    || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`dsh-explain: invalid ${label} evidence`)
  }
  return value as string[]
}

function evidenceOrdinals(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 8
    || value.some(item => !Number.isInteger(item) || (item as number) < 1)) {
    throw new Error('dsh-explain: invalid entry evidence')
  }
  return value as number[]
}

function jsonObject(text: string, label: string): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(text) } catch (error) {
    throw new Error(`dsh-explain: ${label} is not valid JSON`, { cause: error })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`dsh-explain: ${label} must be one object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`dsh-explain: ${label} has unexpected fields`)
  }
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new Error(`dsh-explain: ${label} must be a non-empty string of at most ${max} characters`)
  }
  return value
}

function optionalText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`dsh-explain: ${label} must be a string of at most ${max} characters`)
  }
  return value
}

function validTopicKey(value: string): boolean {
  return /^[a-z0-9._/-]{1,80}$/.test(value) && !value.split('/').some(part => part === '')
}
