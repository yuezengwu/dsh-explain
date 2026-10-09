import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import type { DshHost } from './dsh-hosts.ts'

/** Repository files checked without modifying them or contacting a registry. */
export interface CompatibilityFiles {
  readonly inventory: string
  readonly workflow: string
  readonly manifest: string
  readonly documentation: string
}

/** Report omissions, pin drift, and peer declarations beyond the verified inventory. */
export function checkCompatibility(files: CompatibilityFiles): readonly string[] {
  const errors: string[] = []
  try {
    const inventory: { developmentVersion: string; hosts: DshHost[] } = JSON.parse(files.inventory)
    const hosts = inventory.hosts
    const versions = hosts.map(h => h.version)
    if (hosts.length === 0 || new Set(versions).size !== hosts.length) errors.push('inventory: host versions must be nonempty and unique')
    for (const host of hosts) {
      if (!/^\d+\.\d+\.\d+(?:-(?:alpha|rc)\.\d+)?$/u.test(host.version)
        || !/^[a-f0-9]{40}$/u.test(host.sha)) errors.push(`inventory: invalid version/SHA for ${host.version}`)
      for (const key of ['sessionById', 'accountSettings', 'settingsMigration', 'realtimeToggle'] as const) {
        if (typeof host[key] !== 'boolean') errors.push(`inventory: ${host.version}.${key} must be boolean`)
      }
    }
    if (!versions.includes(inventory.developmentVersion)) errors.push('inventory: developmentVersion must be a supported host')
    const workflow: { jobs: { assembled: { strategy: { matrix: { include: { version: string; sha: string }[] } } } } } = parse(files.workflow)
    const matrix = workflow.jobs.assembled.strategy.matrix.include
    if (matrix.length !== hosts.length || new Set(matrix.map(h => h.version)).size !== matrix.length) errors.push('CI: matrix must contain each supported host exactly once')
    for (const host of hosts) {
      if (!matrix.some(row => row.version === host.version && row.sha === host.sha)) errors.push(`CI: missing or changed SHA for ${host.version}`)
    }
    for (const row of matrix) {
      if (!versions.includes(row.version)) errors.push(`CI: undeclared host ${row.version}`)
    }
    const manifest: { peerDependencies: Record<string, string>; devDependencies: Record<string, string> } = JSON.parse(files.manifest)
    const expectedPeers = new Set(versions.map((v, i) => i === 0 ? `^${v}` : v))
    const peers = Object.entries(manifest.peerDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    const development = Object.entries(manifest.devDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    if (peers.length === 0 || development.length === 0) errors.push('manifest: DSH peer and development declarations must be nonempty')
    for (const [name, range] of peers) {
      const actual = range.split('||').map(part => part.trim())
      if (actual.length !== hosts.length || new Set(actual).size !== hosts.length
        || actual.some(part => !expectedPeers.has(part))) errors.push(`peers: ${name} must list exactly the supported ranges`)
    }
    for (const [name, version] of development) {
      if (version !== inventory.developmentVersion) errors.push(`development: ${name} must be ${inventory.developmentVersion}`)
    }
    const rows = [...files.documentation.matchAll(/^\|[^\n]*?\| `([^`]+)` \| `([a-f0-9]{40})` \|([^\n]*)/gmu)]
    if (rows.length !== hosts.length || new Set(rows.map(row => row[1])).size !== rows.length) errors.push('docs: source table must contain each supported host exactly once')
    for (const host of hosts) {
      const row = rows.find(row => row[1] === host.version)
      if (row?.[2] !== host.sha) errors.push(`docs: missing or changed SHA for ${host.version}`)
      if (!row?.[3]?.includes(`${host.settingsMigration ? 8 : 7} 个 Web 场景`)) errors.push(`docs: Web coverage differs from settingsMigration for ${host.version}`)
      if (row?.[3]?.includes('实时停用/启用') !== host.realtimeToggle) errors.push(`docs: M6 realtime coverage differs for ${host.version}`)
    }
  } catch (error) {
    errors.push(`compatibility files could not be checked: ${error instanceof Error ? error.message : String(error)}`)
  }
  return errors
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = new URL('../', import.meta.url)
  const read = (path: string): string => readFileSync(new URL(path, root), 'utf8')
  const errors = checkCompatibility({ inventory: read('scripts/dsh-hosts.json'),
    workflow: read('.github/workflows/ci.yml'), manifest: read('package.json'), documentation: read('docs/COMPATIBILITY.md') })
  if (errors.length > 0) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  } else {
    console.log('DSH compatibility inventory, CI pins, peers, development versions and Web coverage agree.')
  }
}
