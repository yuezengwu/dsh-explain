import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { RuntimeSettings } from './config.ts'

interface SettingsTarget {
  describe(): { ns: string; revision: number; user?: unknown }[]
  update(ns: string, patch: object, revision?: number): Promise<void>
}

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

/** Import only Explain's old section into this profile, preserving explicit new overrides. */
export async function migrateLegacySettings(
  settings: SettingsTarget,
  namespace: string,
  home: string,
  profileDirectory: string,
  signal: AbortSignal,
): Promise<void> {
  const marker = join(profileDirectory, '.dsh-explain-settings-migrated')
  if (await readOptional(marker) !== undefined) return
  const text = await readOptional(join(home, 'settings.yaml'))
    ?? await readOptional(join(home, 'settings.yaml.imported'))
  if (text === undefined) return
  const document: unknown = parse(text)
  if (typeof document !== 'object' || document === null || !('dsh-explain' in document)) return
  const section = document['dsh-explain']
  if (typeof section !== 'object' || section === null || Array.isArray(section)) {
    throw new Error('dsh-explain: legacy settings section is invalid')
  }
  // Copy only settings owned by Explain, never other plugins or storage paths.
  const fields = Object.keys(RuntimeSettings.dict!)
  const legacy = Object.fromEntries(Object.entries(section).filter(([key]) => fields.includes(key)))
  RuntimeSettings(legacy)
  signal.throwIfAborted()
  const descriptor = settings.describe().find(row => row.ns === namespace)
  if (descriptor === undefined) throw new Error('dsh-explain: settings entry is not ready for migration')
  const overrides = descriptor.user
  const missing = Object.fromEntries(Object.entries(legacy).filter(([key]) =>
    typeof overrides !== 'object' || overrides === null || !Object.hasOwn(overrides, key)))
  if (Object.keys(missing).length > 0) await settings.update(namespace, missing, descriptor.revision)
  signal.throwIfAborted()
  // A separate marker prevents a later intentional reset from importing old values again.
  await writeFile(marker, '1\n', { mode: 0o600 })
}
