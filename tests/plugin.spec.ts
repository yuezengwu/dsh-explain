import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandService from '@deepseek-ai/dsh-commands'
import LlmService from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import Settings, { type SettingsNamespace } from '@deepseek-ai/dsh-settings'
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
