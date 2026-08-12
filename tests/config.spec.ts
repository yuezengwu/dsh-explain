import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveExplainConfig } from '../src/config.ts'

const directories: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), 'dsh-explain-config-'))
  directories.push(value)
  return value
}

describe('resolveExplainConfig', () => {
  it('resolves defaults beneath the active DSH home', () => {
    const dshHome = directory()
    vi.stubEnv('DSH_HOME', dshHome)
    const config = resolveExplainConfig({})
    expect(config).toMatchObject({
      enabled: false,
      maxPendingCandidates: 8,
      maxAutoRequestsPerDay: 50,
      idleCompactMs: 1_800_000,
      contextThresholdRatio: 0.5,
      dshHome,
      storageDir: join(dshHome, 'dsh-explain', 'v1'),
      databasePath: join(dshHome, 'dsh-explain', 'v1', 'thread.sqlite'),
    })
    expect(config).not.toHaveProperty('provider')
    expect(config).not.toHaveProperty('model')
  })

  it('normalizes model routing and resolves a relative plugin storage directory', () => {
    const dshHome = directory()
    expect(resolveExplainConfig({
      dshHome,
      storageDir: 'private/explain',
      provider: '  deepseek-official  ',
      model: '  deepseek-chat  ',
    })).toMatchObject({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      storageDir: join(dshHome, 'private', 'explain'),
      databasePath: join(dshHome, 'private', 'explain', 'thread.sqlite'),
    })
  })

  it('preserves an explicit absolute storage directory', () => {
    const storageDir = directory()
    expect(resolveExplainConfig({ dshHome: directory(), storageDir }).databasePath)
      .toBe(join(storageDir, 'thread.sqlite'))
  })

  it('rejects unknown configuration fields before opening storage', () => {
    expect(() => resolveExplainConfig({ surprise: true } as never)).toThrow('unknown config key "surprise"')
    expect(() => resolveExplainConfig(null as never)).toThrow('configuration must be a plain object')
  })
})
