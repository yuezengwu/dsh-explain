import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandService from '@deepseek-ai/dsh-commands'
import LlmService, {
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import Settings, { settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import TokenMeterService from '@deepseek-ai/dsh-token-meter'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { Config, apply, inject, name } from '../src/index.ts'

const directories: string[] = []

class MemorySettings extends Settings {
  override readonly writable = true
  private readonly data: Record<string, unknown> = {}

  protected override load(): Promise<Record<string, unknown>> { return Promise.resolve(this.data) }

  protected override persist(namespace: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.data[namespace] = structuredClone(section)
    return Promise.resolve()
  }
}

class CatalogAdapter extends LlmAdapter {
  override listModels(provider: string) {
    return Promise.resolve([{ provider, id: 'learning-model', name: 'Learning Model' }])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 128_000 },
    })
  }

  override async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('not used by configuration tests')
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('dsh-explain plugin lifecycle', () => {
  it('publishes the exact Remote namespace and closes its database with the fiber', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-explain-plugin-'))
    directories.push(dshHome)
    const ctx = new Context()
    const sessions = ctx.plugin(SessionStore)
    await sessions
    const llm = ctx.plugin(LlmService)
    await llm
    const meter = ctx.plugin(TokenMeterService)
    await meter
    const settings = ctx.plugin(MemorySettings)
    await settings
    const commands = ctx.plugin(CommandService)
    await commands
    const fiber = ctx.plugin({ name, Config, inject, apply }, { dshHome })
    await fiber.await()
    try {
      expect(ctx.explain.typertRemote).toMatchObject({ serviceKey: 'explain', namespace: 'explain' })
      expect(remoteMethods(ctx.explain)).toEqual([
        { method: 'status', invocation: { kind: 'direct' } },
        { method: 'setEnabled', invocation: { kind: 'direct' } },
        { method: 'configuration', invocation: { kind: 'direct' } },
        { method: 'modelCatalog', invocation: { kind: 'direct' } },
        { method: 'updateConfiguration', invocation: { kind: 'direct' } },
        { method: 'threadPage', invocation: { kind: 'direct' } },
        { method: 'context', invocation: { kind: 'direct' } },
        { method: 'watch', invocation: { kind: 'direct' } },
        { method: 'feedback', invocation: { kind: 'direct' } },
        { method: 'reopenTopic', invocation: { kind: 'direct' } },
      ])
      expect(ctx.explain.status()).toMatchObject({
        enabled: false,
        runtimeState: 'disabled',
        activeExplanationCount: 0,
        routeReady: false,
        storeRevision: 0,
      })
      await expect(ctx.explain.setEnabled({ enabled: true })).resolves.toMatchObject({
        ok: false,
        error: { code: 'MODEL_ROUTE_REQUIRED' },
      })
      expect(ctx.explain.configuration()).toEqual({
        revision: 0,
        enabled: false,
        maxAutoRequestsPerDay: 50,
      })
      await expect(ctx.explain.updateConfiguration({
        expectedRevision: 9,
        enabled: false,
        maxAutoRequestsPerDay: 10,
      })).resolves.toMatchObject({
        ok: false,
        error: { code: 'SETTINGS_STALE' },
        configuration: { revision: 0 },
      })

      ctx.llm.registerAdapter(['learning-provider'], new CatalogAdapter())
      await expect(ctx.explain.modelCatalog()).resolves.toEqual({
        providers: [{
          id: 'learning-provider',
          name: 'learning-provider',
          models: [{ id: 'learning-model', name: 'Learning Model' }],
        }],
      })
      await expect(ctx.explain.updateConfiguration({
        expectedRevision: 0,
        enabled: true,
        provider: 'learning-provider',
        model: 'learning-model',
        maxAutoRequestsPerDay: 10,
      })).resolves.toMatchObject({
        ok: true,
        configuration: {
          revision: 1,
          enabled: true,
          provider: 'learning-provider',
          model: 'learning-model',
          maxAutoRequestsPerDay: 10,
        },
        status: { enabled: true, routeReady: true, contextWindow: 128_000 },
      })
      await expect(ctx.explain.updateConfiguration({
        expectedRevision: 0,
        enabled: false,
        maxAutoRequestsPerDay: 20,
      })).resolves.toMatchObject({ ok: false, error: { code: 'SETTINGS_STALE' } })

      await ctx.settings.update(settingsNamespace('dsh-explain'), { timeoutMs: 9_000 })
      expect(ctx.explain.configuration().revision).toBe(2)
      await expect(ctx.explain.updateConfiguration({
        expectedRevision: 2,
        enabled: true,
        provider: 'learning-provider',
        model: 'learning-model',
        maxAutoRequestsPerDay: 25,
      })).resolves.toMatchObject({ ok: true, configuration: { revision: 3 } })
      expect(ctx.settings.describe().find(descriptor => descriptor.ns === 'dsh-explain')?.user)
        .toMatchObject({ timeoutMs: 9_000, maxAutoRequestsPerDay: 25 })
      await expect(ctx.explain.updateConfiguration({
        expectedRevision: 3,
        enabled: true,
        provider: 'learning-provider',
        model: 'learning-model',
        maxAutoRequestsPerDay: 0,
      })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_SETTINGS' } })
      expect(ctx.explain.configuration()).toMatchObject({ revision: 3, maxAutoRequestsPerDay: 25 })
    } finally {
      await fiber.dispose()
      await commands.dispose()
      await settings.dispose()
      await meter.dispose()
      await llm.dispose()
      await sessions.dispose()
    }
    rmSync(dshHome, { recursive: true, force: true })
    directories.splice(directories.indexOf(dshHome), 1)
  })
})
