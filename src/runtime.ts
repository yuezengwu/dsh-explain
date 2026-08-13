import type { Context } from '@deepseek-ai/cordis'
import {
  SettingsConflictError,
  settingsNamespace,
  type SettingsScope,
} from '@deepseek-ai/dsh-settings'
import {
  RuntimeSettings,
  runtimeSettings,
  type ExplainRuntimeSettings,
  type ResolvedExplainConfig,
} from './config.ts'
import { ExplainRouteError, resolveExplainRoute } from './explainer.ts'
import { ExplainScheduler } from './scheduler.ts'
import type { ExplainStore } from './store.ts'
import type {
  ExplainConfigurationView,
  ExplainModelCatalogView,
  SetEnabledResult,
  UpdateConfigurationFailure,
  UpdateConfigurationRequest,
} from './types.ts'

type SetEnabledError = Extract<SetEnabledResult, { readonly ok: false }>['error']
const SETTINGS_NAMESPACE = settingsNamespace('dsh-explain')

/** Settings owner and lifecycle bridge around the global scheduler. */
export class ExplainRuntime {
  readonly scheduler: ExplainScheduler
  private readonly scope: SettingsScope<ExplainRuntimeSettings>
  private current: ExplainRuntimeSettings
  private synchronizeTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly ctx: Context,
    private readonly store: ExplainStore,
    resolved: ResolvedExplainConfig,
  ) {
    const base = runtimeSettings(resolved)
    this.scope = ctx.settings.register(SETTINGS_NAMESPACE, RuntimeSettings, { base })
    this.current = normalizeSettings(this.scope.get())
    this.scheduler = new ExplainScheduler(ctx, store, this.current)
    ctx.on('llm/adapters-updated', () => {
      this.store.notifyRuntimeChange()
      this.scheduler.adaptersUpdated()
    })
    this.scope.watch(() => this.synchronize())
  }

  /** Start lease renewal and any configured runtime work. */
  async start(): Promise<void> { await this.scheduler.start() }

  /** Current normalized live settings. */
  settings(): ExplainRuntimeSettings { return this.current }

  /** Current UI-editable settings paired with the native namespace revision. */
  configuration(): ExplainConfigurationView {
    const descriptor = this.ctx.settings.describe({ redactSecrets: true })
      .find(candidate => candidate.ns === SETTINGS_NAMESPACE)
    if (descriptor === undefined) throw new Error('dsh-explain: settings namespace is unavailable')
    const settings = normalizeSettings(this.scope.get())
    return {
      revision: descriptor.revision,
      enabled: settings.enabled,
      ...(settings.provider === undefined ? {} : { provider: settings.provider }),
      ...(settings.model === undefined ? {} : { model: settings.model }),
      maxAutoRequestsPerDay: settings.maxAutoRequestsPerDay,
    }
  }

  /** Read registered providers and their advisory model catalogs. */
  async modelCatalog(): Promise<ExplainModelCatalogView> {
    const providers = this.ctx.llm.listProviders()
    return {
      providers: await Promise.all(providers.map(async (provider) => {
        try {
          const models = await this.ctx.llm.listModels(provider.id)
          return {
            id: provider.id,
            name: provider.name,
            models: models.map(model => ({ id: model.id, name: model.name })),
          }
        } catch {
          return {
            id: provider.id,
            name: provider.name,
            models: [],
            error: {
              code: 'MODEL_CATALOG_UNAVAILABLE' as const,
              message: 'Suggested models are unavailable; enter an exact model id.',
            },
          }
        }
      })),
    }
  }

  /** Validate and merge the four settings-page fields with native revision CAS. */
  async updateConfiguration(request: UpdateConfigurationRequest): Promise<UpdateConfigurationFailure | undefined> {
    const before = this.configuration()
    if (request.expectedRevision !== before.revision) return staleSettings(request.expectedRevision, before.revision)
    let next: ExplainRuntimeSettings
    try {
      next = normalizeSettings(RuntimeSettings({
        ...this.current,
        enabled: request.enabled,
        provider: request.provider ?? '',
        model: request.model ?? '',
        maxAutoRequestsPerDay: request.maxAutoRequestsPerDay,
      }))
    } catch {
      return { code: 'INVALID_SETTINGS', message: 'Learning settings are invalid.' }
    }
    if (next.enabled) {
      try {
        await resolveExplainRoute(this.ctx, next)
      } catch (error) {
        if (error instanceof ExplainRouteError) return { code: error.code, message: error.message }
        return { code: 'RUNTIME_FAILED', message: 'The selected auxiliary model route is unavailable.' }
      }
    }
    try {
      await this.ctx.settings.update(SETTINGS_NAMESPACE, {
        enabled: request.enabled,
        provider: request.provider?.trim() ?? '',
        model: request.model?.trim() ?? '',
        maxAutoRequestsPerDay: request.maxAutoRequestsPerDay,
      }, request.expectedRevision)
    } catch (error) {
      if (error instanceof SettingsConflictError) return staleSettings(error.expected, error.actual)
      return { code: 'RUNTIME_FAILED', message: 'Learning settings could not be saved.' }
    }
    await this.synchronize()
    return undefined
  }

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
    await this.scope.update({ enabled })
    await this.synchronize()
    return undefined
  }

  /** Stop all scheduler work and release the runtime lease. */
  async dispose(): Promise<void> {
    await this.synchronizeTail
    await this.scheduler.dispose()
  }

  private synchronize(): Promise<void> {
    const task = this.synchronizeTail.then(async () => {
      const normalized = normalizeSettings(this.scope.get())
      if (settingsEqual(normalized, this.current)) return
      const previous = this.current
      this.current = normalized
      await this.scheduler.configure(normalized, previous)
      if (!previous.enabled && normalized.enabled && this.scheduler.status().state === 'ready') {
        this.store.recordEnableAction()
      }
    })
    this.synchronizeTail = task.catch(() => {})
    return task
  }
}

function staleSettings(expected: number, actual: number): UpdateConfigurationFailure {
  return {
    code: 'SETTINGS_STALE',
    message: `Learning settings changed since this page loaded (expected revision ${expected}, now ${actual}).`,
  }
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
