import { readFileSync } from 'node:fs'

/** Fixed source host and the assembly-fixture behaviors already verified for it. */
export interface DshHost {
  readonly version: string
  readonly sha: string
  readonly sessionById: boolean
  readonly accountSettings: boolean
  readonly settingsMigration: boolean
  readonly realtimeToggle: boolean
}

/** Shared inventory; compat:check validates it against CI, peers and documentation. */
export const dshCompatibility: {
  readonly developmentVersion: string
  readonly hosts: readonly DshHost[]
} = JSON.parse(readFileSync(new URL('./dsh-hosts.json', import.meta.url), 'utf8'))

/** Require an explicitly verified host; unknown versions never inherit fixture behavior. */
export function requireDshHost(version: string): DshHost {
  const host = dshCompatibility.hosts.find(host => host.version === version)
  if (host === undefined) throw new Error(`unsupported DSH source ${version}; expected ${dshCompatibility.hosts.map(h => h.version).join(', ')}`)
  return host
}
