import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import {
  RuntimeSettings,
  runtimeSettings,
  type ExplainRuntimeSettings,
  type ResolvedExplainConfig,
} from './config.ts'
import { ExplainRouteError, resolveExplainRoute } from './explainer.ts'
import { ExplainScheduler } from './scheduler.ts'
import type { ExplainStore } from './store.ts'
import type { SetEnabledResult } from './types.ts'

type SetEnabledError = Extract<SetEnabledResult, { readonly ok: false }>['error']

/** Settings owner and lifecycle bridge around the global scheduler. */
export class ExplainRuntime {
  readonly scheduler: ExplainScheduler
  private readonly scope: SettingsScope<ExplainRuntimeSettings>
  private current: ExplainRuntimeSettings

  constructor(
    private readonly ctx: Context,
    private readonly store: ExplainStore,
    resolved: ResolvedExplainConfig,
  ) {
    const base = runtimeSettings(resolved)
    this.scope = ctx.settings.register(settingsNamespace('dsh-explain'), RuntimeSettings, { base })
    this.current = normalizeSettings(this.scope.get())
    this.scheduler = new ExplainScheduler(ctx, store, this.current)
    ctx.on('llm/adapters-updated', () => { this.scheduler.adaptersUpdated() })
    this.scope.watch(async (next) => {
      const normalized = normalizeSettings(next)
      if (settingsEqual(normalized, this.current)) return
      const previous = this.current
      this.current = normalized
      await this.scheduler.configure(normalized, previous)
      if (!previous.enabled && normalized.enabled && this.scheduler.status().state === 'ready') {
        this.store.recordEnableAction()
      }
    })
  }

  /** Start lease renewal and any configured runtime work. */
  async start(): Promise<void> { await this.scheduler.start() }

  /** Current normalized live settings. */
  settings(): ExplainRuntimeSettings { return this.current }

  /** Validate and persist the global enable switch. */
  async setEnabled(enabled: boolean, signal?: AbortSignal): Promise<SetEnabledError | undefined> {
    const next = { ...this.current, enabled }
    if (enabled) {
      try {
        await resolveExplainRoute(this.ctx, next, signal)
      } catch (error) {
        if (error instanceof ExplainRouteError) return { code: error.code, message: error.message }
        return { code: 'RUNTIME_FAILED', message: 'The selected auxiliary model route is unavailable.' }
      }
    }
    const previous = this.current
    await this.scope.update({ enabled })
    const normalized = normalizeSettings(this.scope.get())
    if (!settingsEqual(normalized, this.current)) {
      this.current = normalized
      await this.scheduler.configure(normalized, previous)
      if (!previous.enabled && normalized.enabled && this.scheduler.status().state === 'ready') {
        this.store.recordEnableAction()
      }
    }
    return undefined
  }

  /** Stop all scheduler work and release the runtime lease. */
  async dispose(): Promise<void> { await this.scheduler.dispose() }
}

function normalizeSettings(input: ExplainRuntimeSettings): ExplainRuntimeSettings {
  const provider = input.provider?.trim()
  const model = input.model?.trim()
  const { provider: _provider, model: _model, ...base } = input
  return {
    ...base,
    ...(provider === undefined || provider === '' ? {} : { provider }),
    ...(model === undefined || model === '' ? {} : { model }),
  }
}

function settingsEqual(left: ExplainRuntimeSettings, right: ExplainRuntimeSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
