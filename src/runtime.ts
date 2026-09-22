import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  SettingsConflictError,
} from '@deepseek-ai/dsh-settings'
import {
  RuntimeSettings,
  runtimeSettings,
  type ExplainRuntimeSettings,
  type ResolvedExplainConfig,
} from './config.ts'
import { ExplainRouteError, resolveExplainRoute } from './explainer.ts'
import { migrateLegacySettings } from './settings-migration.ts'
import { ExplainScheduler } from './scheduler.ts'
import type { ExplainStore } from './store.ts'
import type {
  ClearLearningDataFailure,
  ClearLearningDataRequest,
  ClearLearningDataValue,
  ExplainConfigurationView,
  ExplainModelCatalogView,
  SetEnabledResult,
  UpdateConfigurationFailure,
  UpdateConfigurationRequest,
} from './types.ts'

type SetEnabledError = Extract<SetEnabledResult, { readonly ok: false }>['error']
interface LegacySettings {
  installSection(ctx: Context, ns: string, schema: typeof RuntimeSettings, entry: ExplainRuntimeSettings, options: {
    setSource(source: () => ExplainRuntimeSettings): void
    onChange(): void
  }): void
}

const SETTINGS_NAMESPACE = 'dsh-explain'

/** Settings owner and lifecycle bridge around the global scheduler. */
export class ExplainRuntime {
  readonly scheduler: ExplainScheduler
  private settingsSource: () => ExplainRuntimeSettings
  private current: ExplainRuntimeSettings
  private synchronizeTail: Promise<void> = Promise.resolve()
  private clearing = false
  private readonly namespace: string

  constructor(
    private readonly ctx: Context,
    private readonly store: ExplainStore,
    resolved: ResolvedExplainConfig,
    liveSettings: () => ExplainRuntimeSettings,
  ) {
    const entry = runtimeSettings(resolved)
    this.settingsSource = () => entry
    this.current = normalizeSettings(entry)
    this.scheduler = new ExplainScheduler(ctx, store, this.current)
    ctx.on('llm/adapters-updated', () => {
      this.store.notifyRuntimeChange()
      this.scheduler.adaptersUpdated()
    })
    const synchronize = (): void => {
      void this.synchronize().catch((error: unknown) => {
        ctx.logger('dsh-explain').warn('settings synchronization failed: %s', messageOf(error))
      })
    }
    const settings = ctx.settings as typeof ctx.settings & Partial<LegacySettings>
    if (typeof settings.installSection === 'function') {
      this.namespace = SETTINGS_NAMESPACE
      settings.installSection(ctx, this.namespace, RuntimeSettings, entry, {
        setSource: source => { this.settingsSource = source },
        onChange: synchronize,
      })
    } else {
      const fiber = ctx.fiber as typeof ctx.fiber & { entry?: { options: { id?: string } } }
      const id = fiber.entry?.options.id
      if (id === undefined) throw new Error('dsh-explain: live settings require a profile entry')
      this.namespace = id
      this.settingsSource = liveSettings
      // Older supported Cordis declarations predate this event. Only the new
      // settings path registers it; the loader dispatches it to the owning fiber.
      const on = ctx.on as (name: 'loader/volatile-update', listener: () => void) => () => void
      on.call(ctx, 'loader/volatile-update', synchronize)
      const abort = new AbortController()
      ctx.effect(() => () => { abort.abort() }, 'dsh-explain: stop legacy settings migration')
      const host = ctx as Context & {
        profileContext: { home: string }
        loader: { await(): Promise<void> }
      }
      void (host.root as typeof host).loader.await().then(async () => {
        if (abort.signal.aborted) return
        await migrateLegacySettings(settings, this.namespace, host.profileContext.home,
          dirname(settings.documentPath!), abort.signal)
      }).catch(() => {
        if (!abort.signal.aborted) ctx.logger('dsh-explain').warn('Legacy learning settings could not be imported; the original settings file is retained.')
      })
    }
  }

  /** Start lease renewal and any configured runtime work. */
  async start(): Promise<void> { await this.scheduler.start() }

  /** Current normalized live settings. */
  settings(): ExplainRuntimeSettings { return this.current }

  /** Current UI-editable settings paired with the native namespace revision. */
  configuration(): ExplainConfigurationView {
    const descriptor = this.ctx.settings.describe({ redactSecrets: true })
      .find(candidate => candidate.ns === this.namespace)
    if (descriptor === undefined) throw new Error('dsh-explain: settings namespace is unavailable')
    const settings = normalizeSettings(this.settingsSource())
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
      await this.ctx.settings.update(this.namespace, {
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
    await this.ctx.settings.update(this.namespace, { enabled })
    await this.synchronize()
    return undefined
  }

  /** Validate the destructive phrase and serialize the scheduler-owned database reset. */
  async clearLearningData(
    request: ClearLearningDataRequest,
  ): Promise<{ readonly ok: true; readonly value: ClearLearningDataValue } | {
    readonly ok: false; readonly error: ClearLearningDataFailure
  }> {
    if (request.confirmation !== 'CLEAR') {
      return {
        ok: false,
        error: {
          code: 'CLEAR_CONFIRMATION_REQUIRED',
          message: 'Type CLEAR exactly to confirm deletion of all learning data.',
        },
      }
    }
    if (!Number.isInteger(request.expectedStoreRevision) || request.expectedStoreRevision < 0) {
      return {
        ok: false,
        error: { code: 'STORE_STALE', message: 'Learning data changed; refresh before clearing it.' },
      }
    }
    if (this.clearing) {
      return {
        ok: false,
        error: { code: 'CLEAR_IN_PROGRESS', message: 'Learning data is already being cleared.' },
      }
    }
    this.clearing = true
    try {
      const result = await this.scheduler.resetLearningData(request.expectedStoreRevision)
      if (!result.ok) {
        return {
          ok: false,
          error: {
            code: 'STORE_STALE',
            message: `Learning data changed since this page loaded (expected revision ${request.expectedStoreRevision}, now ${result.actualStoreRevision}).`,
          },
        }
      }
      return {
        ok: true,
        value: {
          cleared: result.cleared,
          preservedAutoRequests: result.preservedAutoRequests,
          storeRevision: result.storeRevision,
        },
      }
    } catch {
      return {
        ok: false,
        error: { code: 'CLEAR_FAILED', message: 'Learning data could not be cleared.' },
      }
    } finally {
      this.clearing = false
    }
  }

  /** Stop all scheduler work and release the runtime lease. */
  async dispose(): Promise<void> {
    await this.synchronizeTail
    await this.scheduler.dispose()
  }

  private synchronize(): Promise<void> {
    const task = this.synchronizeTail.then(async () => {
      const normalized = normalizeSettings(this.settingsSource())
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown settings failure'
}
