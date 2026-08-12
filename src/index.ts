/**
 * dsh-explain host plugin: one global SQLite learning thread and its typed Remote service.
 * @module dsh-explain
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only imports install the consumed service/event declarations on Context.
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-token-meter'
import { resolveExplainConfig, type ExplainConfig } from './config.ts'
import { ExplainGateway } from './gateway.ts'
import { captureSourceCapsule } from './observer.ts'
import { ExplainRuntime } from './runtime.ts'
import { ExplainStore } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-side global learning-thread Remote service. */
    explain: ExplainGateway
  }
}

export const name = 'dsh-explain'

/** Required host services for global observation, auxiliary calls, settings, and slash commands. */
export const inject = ['sessions', 'llm', 'tokenMeter', 'settings', 'commands']

export { Config } from './config.ts'
export type { ExplainConfig, ResolvedExplainConfig } from './config.ts'
export { ExplainGateway } from './gateway.ts'
export * from './brands.ts'
export type * from './types.ts'

/** Open the global runtime, observe eligible completed turns, and publish commands and Remote methods. */
export async function apply(ctx: Context, config: ExplainConfig): Promise<void> {
  const resolved = resolveExplainConfig(config)
  const store = new ExplainStore(resolved.databasePath)
  const runtime = new ExplainRuntime(ctx, store, resolved)
  try {
    await runtime.start()
  } catch (error) {
    await runtime.dispose().catch(() => {})
    store.close()
    throw error
  }
  ctx.effect(() => async () => {
    await runtime.dispose()
    store.close()
  }, 'dsh-explain: stop runtime and close SQLite store')

  const gateway = new ExplainGateway(ctx, store, runtime)
  registerExplainCommand(ctx, runtime, gateway)

  const seenTurnEnds = new WeakMap<Session, number>()
  const logger = ctx.logger('dsh-explain')
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end' || session.header.origin === 'subagent'
      || !runtime.settings().enabled || (seenTurnEnds.get(session) ?? -1) >= event.seq) return
    seenTurnEnds.set(session, event.seq)
    const generation = runtime.scheduler.generation()
    queueMicrotask(() => {
      try {
        if (!runtime.scheduler.acceptsGeneration(generation)) return
        const capsule = captureSourceCapsule(
          session,
          event as SessionEvent<'turn/end'>,
          runtime.settings().maxSourceChars,
        )
        if (capsule !== undefined) runtime.scheduler.enqueue(capsule)
      } catch (error) {
        logger.warn('completed-turn observation failed: %s', safeMessage(error))
      }
    })
  }, { global: true })
}

function registerExplainCommand(ctx: Context, runtime: ExplainRuntime, gateway: ExplainGateway): void {
  ctx.commands.register({
    name: 'explain',
    description: 'Control the global auxiliary learning thread',
    input: { hint: 'on | off | status' },
    handler: async (invocation): Promise<CommandResult> => {
      const action = invocation.rawInput.trim()
      if (action === 'status') return { kind: 'success', text: renderStatus(gateway.status()) }
      if (action !== 'on' && action !== 'off') {
        return { kind: 'error', text: 'Usage: /explain on | off | status' }
      }
      const error = await runtime.setEnabled(action === 'on', invocation.signal)
      if (error !== undefined) return { kind: 'error', text: `${error.code}: ${error.message}` }
      return { kind: 'success', text: renderStatus(gateway.status()) }
    },
  })
}

function renderStatus(status: ReturnType<ExplainGateway['status']>): string {
  const route = status.provider === undefined || status.model === undefined
    ? 'not configured'
    : `${status.provider}/${status.model}`
  const capacity = status.contextWindow === undefined ? 'unavailable' : `${status.contextWindow} tokens`
  const pressure = status.estimatedContextRatio === undefined
    ? 'not measured'
    : `${(status.estimatedContextRatio * 100).toFixed(1)}%`
  return [
    `Explain: ${status.enabled ? 'on' : 'off'} (${status.runtimeState})`,
    `Route: ${route}; capacity: ${capacity}`,
    `Active: ${status.activeExplanationCount}; candidates: ${status.pendingCandidateCount}`,
    `Auto budget: ${status.autoRequestsUsed}/${status.autoRequestsLimit}; pressure: ${pressure}`,
    `Last action: ${formatTime(status.lastUserActionAt)}; last compaction: ${formatTime(status.lastCompactedAt)}`,
  ].join('\n')
}

function formatTime(value: number | undefined): string {
  return value === undefined ? 'never' : new Date(value).toISOString()
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown observation failure'
}
