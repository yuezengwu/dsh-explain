import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkCompatibility, type CompatibilityFiles } from '../scripts/check-compatibility.ts'
import { requireDshHost } from '../scripts/dsh-hosts.ts'

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const files: CompatibilityFiles = {
  inventory: read('scripts/dsh-hosts.json'), workflow: read('.github/workflows/ci.yml'),
  manifest: read('package.json'), documentation: read('docs/COMPATIBILITY.md'),
}

describe('verified DSH compatibility inventory', () => {
  it('agrees with all repository consumers and refuses an unverified host', () => {
    expect(checkCompatibility(files)).toEqual([])
    expect(requireDshHost('0.1.2-rc.1').settingsMigration).toBe(false)
    expect(requireDshHost('0.1.6-alpha.2').realtimeToggle).toBe(true)
    expect(requireDshHost('0.2.1-alpha.1')).toMatchObject({ sessionById: true, accountSettings: true, settingsMigration: true })
    expect(() => requireDshHost('0.2.1-alpha.2')).toThrow('unsupported DSH source')
  })

  it.each(['omission', 'pin drift'])('rejects a CI %s', (change) => {
    const workflow = change === 'omission'
      ? files.workflow.replace(/          - version: 0\.2\.1-alpha\.1\n            sha: [a-f0-9]+\n/u, '')
      : files.workflow.replace('5badb15009ae1756c3afe0ae0cef1faafc290ccc', '0'.repeat(40))
    expect(checkCompatibility({ ...files, workflow }).join('\n')).toContain('CI: missing or changed SHA for 0.2.1-alpha.1')
  })

  it.each(['omission', 'unverified version'])('rejects a peer %s', (change) => {
    const manifest = JSON.parse(files.manifest)
    const key = '@deepseek-ai/dsh-session'
    manifest.peerDependencies[key] = change === 'omission'
      ? manifest.peerDependencies[key].replace(' || 0.2.1-alpha.1', '')
      : manifest.peerDependencies[key] + ' || 0.2.1-alpha.2'
    expect(checkCompatibility({ ...files, manifest: JSON.stringify(manifest) }).join('\n')).toContain(`peers: ${key}`)
  })

  it('rejects mixed development package versions', () => {
    const manifest = JSON.parse(files.manifest)
    manifest.devDependencies['@deepseek-ai/dsh-session'] = '0.2.0-rc.2'
    expect(checkCompatibility({ ...files, manifest: JSON.stringify(manifest) }).join('\n')).toContain('development: @deepseek-ai/dsh-session')
  })

  it('rejects a changed documentation SHA', () => {
    const documentation = files.documentation.replace('5badb15009ae1756c3afe0ae0cef1faafc290ccc', '0'.repeat(40))
    expect(checkCompatibility({ ...files, documentation }).join('\n')).toContain('docs: missing or changed SHA for 0.2.1-alpha.1')
  })

  it('rejects changed Web and realtime M6 coverage claims', () => {
    const inventory = JSON.parse(files.inventory)
    inventory.hosts.at(-1).settingsMigration = false
    inventory.hosts.at(-1).realtimeToggle = true
    const errors = checkCompatibility({ ...files, inventory: JSON.stringify(inventory) }).join('\n')
    expect(errors).toContain('docs: Web coverage differs from settingsMigration for 0.2.1-alpha.1')
    expect(errors).toContain('docs: M6 realtime coverage differs for 0.2.1-alpha.1')
  })

  it('rejects duplicate inventory hosts and malformed capability flags', () => {
    const inventory = JSON.parse(files.inventory)
    inventory.hosts.push({ ...inventory.hosts[0], settingsMigration: 'yes' })
    const errors = checkCompatibility({ ...files, inventory: JSON.stringify(inventory) }).join('\n')
    expect(errors).toContain('inventory: host versions must be nonempty and unique')
    expect(errors).toContain('settingsMigration must be boolean')
  })
})
