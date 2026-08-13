import type { ExplainStatusView } from 'dsh-explain/types'

/** Stable product-state precedence for every explain surface. */
export type ExplainDiagnosticState = 'disabled' | 'failed' | 'unconfigured' | 'budget-exhausted' | 'ready'

/** Classify one Host status without folding transport failures into business state. */
export function diagnosticState(status: ExplainStatusView): ExplainDiagnosticState {
  if (!status.enabled) return 'disabled'
  if (status.runtimeState === 'failed') return 'failed'
  if (!status.routeReady) return 'unconfigured'
  if (status.autoRequestsUsed >= status.autoRequestsLimit) return 'budget-exhausted'
  return 'ready'
}
