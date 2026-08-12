import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ExplainRuntimeSettings } from './config.ts'
import type {
  CompactionBatch,
  ExplainContextSnapshot,
  LeaseToken,
  StoredCheckpoint,
} from './domain.ts'
import {
  estimateAuxiliaryRequest,
  renderCompactionRequest,
  runAuxiliaryRequest,
  type ExplainRoute,
} from './explainer.ts'
import type { ExplainStore } from './store.ts'

/** Compact at least one uncovered item, respecting the same pressure ratio as target requests. */
export async function compactOnce(
  ctx: Context,
  store: ExplainStore,
  token: LeaseToken,
  settings: ExplainRuntimeSettings,
  route: ExplainRoute,
  trigger: 'idle' | 'pressure',
  signal: AbortSignal,
): Promise<{ readonly kind: 'noop' } | { readonly kind: 'committed'; readonly checkpoint: StoredCheckpoint }> {
  const available = store.compactionBatch()
  if (available === undefined) return { kind: 'noop' }
  const batch = fitBatch(ctx, store, available, settings, route)
  const request = renderCompactionRequest(batch, store.context().stats, settings.maxCompactionOutputTokens)
  let generated: Awaited<ReturnType<typeof runAuxiliaryRequest<ExplainContextSnapshot>>>
  try {
    generated = await runAuxiliaryRequest(ctx, route, request, settings.timeoutMs, signal)
  } catch (error) {
    if (signal.aborted) throw error
    throw new CompactionError(
      'EXPLAIN_COMPACTION_FAILED',
      'The learning context could not be compacted. No learning data was marked as covered.',
      { cause: error },
    )
  }
  const checkpoint = store.commitCheckpoint(
    token,
    batch,
    trigger,
    randomUUID(),
    generated.value,
    generated.generation,
  )
  if (checkpoint === undefined) throw new CompactionError('EXPLAIN_COMPACTION_STALE', 'Learning context changed during compaction.')
  return { kind: 'committed', checkpoint }
}

function fitBatch(
  ctx: Context,
  store: ExplainStore,
  available: CompactionBatch,
  settings: ExplainRuntimeSettings,
  route: ExplainRoute,
): CompactionBatch {
  let observationCount = available.observations.length
  let explanationCount = available.explanations.length
  while (observationCount + explanationCount > 0) {
    const observations = available.observations.slice(0, observationCount)
    const explanations = available.explanations.slice(0, explanationCount)
    const ordinals = explanations.flatMap(explanation => explanation.entryOrdinals)
    const batch: CompactionBatch = {
      ...available,
      observations,
      explanations,
      throughOrdinal: ordinals.length === 0
        ? available.previous?.throughOrdinal ?? 0
        : Math.max(available.previous?.throughOrdinal ?? 0, ...ordinals),
    }
    const request = renderCompactionRequest(batch, store.context().stats, settings.maxCompactionOutputTokens)
    if (estimateAuxiliaryRequest(ctx, request) / route.contextWindow <= settings.contextThresholdRatio) return batch
    if (explanationCount > 0) explanationCount -= 1
    else observationCount -= 1
  }
  throw new CompactionError(
    'EXPLAIN_CONTEXT_PRESSURE_UNRESOLVED',
    'Even one safe compaction batch exceeds the selected model context threshold.',
  )
}

/** Stable compaction failure used by runtime status and pressure control. */
export class CompactionError extends Error {
  constructor(
    readonly code:
      | 'EXPLAIN_COMPACTION_FAILED'
      | 'EXPLAIN_COMPACTION_STALE'
      | 'EXPLAIN_CONTEXT_PRESSURE_UNRESOLVED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CompactionError'
  }
}
