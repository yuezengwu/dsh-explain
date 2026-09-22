import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { migrateLegacySettings } from '../src/settings-migration.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'explain-settings-migration-'))
  directories.push(home)
  const document = 'dsh-explain:\n  enabled: false\n  provider: old-provider\n  model: old-model\n  maxAutoRequestsPerDay: 17\n  storageDir: /not-imported\nother-plugin:\n  apiKey: fixture-secret\n'
  const path = join(home, 'settings.yaml.imported')
  await writeFile(path, document)
  let user: Record<string, unknown> = { maxAutoRequestsPerDay: 12 }
  const writes: object[] = []
  const settings = {
    describe: () => [{ ns: 'custom-explain-id', revision: writes.length, user }],
    update: async (ns: string, patch: object, revision?: number) => {
      expect(ns).toBe('custom-explain-id')
      expect(revision).toBe(writes.length)
      writes.push(patch)
      user = { ...user, ...patch }
    },
  }
  return { home, path, document, settings, writes }
}

it('imports only Explain preferences, preserves explicit profile values, and does not reimport after reset', async () => {
  const f = await fixture()
  await migrateLegacySettings(f.settings, 'custom-explain-id', f.home, f.home, new AbortController().signal)
  expect(f.writes).toEqual([{ enabled: false, provider: 'old-provider', model: 'old-model' }])
  expect(await readFile(f.path, 'utf8')).toBe(f.document)
  expect(await readFile(join(f.home, '.dsh-explain-settings-migrated'), 'utf8')).toBe('1\n')
  await migrateLegacySettings({ ...f.settings, describe: () => [{ ns: 'custom-explain-id', revision: 2, user: {} }] },
    'custom-explain-id', f.home, f.home, new AbortController().signal)
  expect(f.writes).toHaveLength(1)
})

it('leaves failed imports retryable and never marks a failed profile write complete', async () => {
  const f = await fixture()
  await expect(migrateLegacySettings({ ...f.settings, update: async () => { throw new Error('read-only profile') } },
    'custom-explain-id', f.home, f.home, new AbortController().signal)).rejects.toThrow('read-only profile')
  await expect(readFile(join(f.home, '.dsh-explain-settings-migrated'))).rejects.toMatchObject({ code: 'ENOENT' })
  await migrateLegacySettings(f.settings, 'custom-explain-id', f.home, f.home, new AbortController().signal)
  expect(f.writes).toHaveLength(1)
})

it('cancels migration when the plugin unloads and refuses invalid stored settings', async () => {
  const f = await fixture()
  const abort = new AbortController(); abort.abort()
  await expect(migrateLegacySettings(f.settings, 'custom-explain-id', f.home, f.home, abort.signal)).rejects.toThrow()
  await writeFile(f.path, 'dsh-explain:\n  maxAutoRequestsPerDay: -1\n')
  await expect(migrateLegacySettings(f.settings, 'custom-explain-id', f.home, f.home, new AbortController().signal)).rejects.toThrow()
  expect(f.writes).toEqual([])
  await expect(readFile(join(f.home, '.dsh-explain-settings-migrated'))).rejects.toMatchObject({ code: 'ENOENT' })
})
