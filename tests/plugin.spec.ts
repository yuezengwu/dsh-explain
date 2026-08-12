import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-type-meta'
import { Config, apply, inject, name } from '../src/index.ts'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('dsh-explain plugin lifecycle', () => {
  it('publishes the exact Remote namespace and closes its database with the fiber', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-explain-plugin-'))
    directories.push(dshHome)
    const ctx = new Context()
    const fiber = ctx.plugin({ name, Config, inject, apply }, { dshHome })
    await fiber.await()
    try {
      expect(ctx.explain.typertGateway).toMatchObject({ serviceKey: 'explain', namespace: 'explain' })
      expect(remoteMethods(ctx.explain)).toEqual([
        { method: 'status', invocation: { kind: 'direct' } },
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
        storeRevision: 0,
      })
    } finally {
      await fiber.dispose()
    }
    rmSync(dshHome, { recursive: true, force: true })
    directories.splice(directories.indexOf(dshHome), 1)
  })
})
