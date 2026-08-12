/**
 * dsh-explain host plugin: one global SQLite learning thread and its typed Remote service.
 * @module dsh-explain
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveExplainConfig, type ExplainConfig } from './config.ts'
import { ExplainGateway } from './gateway.ts'
import { ExplainStore } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-side global learning-thread Remote service. */
    explain: ExplainGateway
  }
}

export const name = 'dsh-explain'

/** M1 has no host service dependency; later P0 phases add Session, LLM, token-meter, and settings consumers. */
export const inject: string[] = []

export { Config } from './config.ts'
export type { ExplainConfig, ResolvedExplainConfig } from './config.ts'
export { ExplainGateway } from './gateway.ts'
export * from './brands.ts'
export type * from './types.ts'

/** Open the global store, publish its Remote service, and bind database closure to the plugin fiber. */
export function apply(ctx: Context, config: ExplainConfig): void {
  const resolved = resolveExplainConfig(config)
  const store = new ExplainStore(resolved.databasePath)
  try {
    new ExplainGateway(ctx, store, () => resolved)
  } catch (error) {
    store.close()
    throw error
  }
  ctx.effect(() => () => { store.close() }, 'dsh-explain: close SQLite store')
}
