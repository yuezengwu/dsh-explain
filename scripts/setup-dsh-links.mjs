#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')

function readDirectories(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
      .sort()
  } catch {
    return []
  }
}

function resolveSourceRoot() {
  const candidates = [
    process.env.DSH_SOURCE_DIR,
    process.env.DSH_HOME === undefined ? undefined : join(process.env.DSH_HOME, 'source', 'current'),
    process.env.HOME === undefined ? undefined : join(process.env.HOME, '.dsh', 'source', 'current'),
  ].filter(candidate => candidate !== undefined)
  const found = candidates.find(candidate => existsSync(join(candidate, 'packages')) && existsSync(join(candidate, 'vendor')))
  if (found === undefined) {
    throw new Error(`no DSH source tree found; set DSH_SOURCE_DIR (tried ${candidates.join(', ')})`)
  }
  return resolve(found)
}

function collectPackages(sourceRoot) {
  const packages = new Map()
  for (const area of ['packages', 'vendor']) {
    const areaRoot = join(sourceRoot, area)
    for (const first of readDirectories(areaRoot)) {
      const direct = join(areaRoot, first)
      const candidates = existsSync(join(direct, 'package.json')) ? [direct] : []
      for (const second of readDirectories(direct)) {
        const grouped = join(direct, second)
        if (existsSync(join(grouped, 'package.json'))) candidates.push(grouped)
      }
      for (const candidate of candidates) {
        const manifest = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8'))
        if (typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/')) {
          packages.set(manifest.name, candidate)
        }
      }
    }
  }
  return packages
}

function requiredPeers() {
  const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'))
  return Object.keys(manifest.peerDependencies ?? {})
    .filter(name => name.startsWith('@deepseek-ai/') && name !== '@deepseek-ai/cordis')
    .sort()
}

function linkKind() {
  return process.platform === 'win32' ? 'junction' : 'dir'
}

function replaceLink(linkPath, target) {
  rmSync(linkPath, { force: true, recursive: true })
  mkdirSync(dirname(linkPath), { recursive: true })
  symlinkSync(target, linkPath, linkKind())
}

function linkProblem(linkPath, target) {
  if (!existsSync(linkPath)) return 'missing'
  try {
    return resolve(dirname(linkPath), readlinkSync(linkPath)) === resolve(target) ? undefined : 'stale target'
  } catch {
    return 'not a symlink'
  }
}

function writeCordisShim(sourceRoot) {
  const target = join(sourceRoot, 'vendor', 'cordis')
  const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/cordis') throw new Error(`unexpected Cordis package name ${String(manifest.name)}`)
  const shim = join(repository, 'node_modules', '@deepseek-ai', 'cordis')
  rmSync(shim, { force: true, recursive: true })
  mkdirSync(shim, { recursive: true })
  replaceLink(join(shim, 'index.js'), join(target, 'lib', 'index.js'))
  replaceLink(join(shim, 'index.d.ts'), join(target, 'lib', 'types', 'index.d.ts'))
  if (existsSync(join(target, 'src'))) replaceLink(join(shim, 'src'), join(target, 'src'))
  writeFileSync(join(shim, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/cordis',
    version: manifest.version,
    private: true,
    type: 'module',
    main: './index.js',
    types: './index.d.ts',
    exports: {
      '.': { types: './index.d.ts', default: './index.js' },
      './src/*': './src/*',
      './package.json': './package.json',
    },
  }, null, 2)}\n`)
}

function cordisProblem(sourceRoot) {
  const shim = join(repository, 'node_modules', '@deepseek-ai', 'cordis')
  const target = join(sourceRoot, 'vendor', 'cordis')
  return linkProblem(join(shim, 'index.js'), join(target, 'lib', 'index.js'))
    ?? linkProblem(join(shim, 'index.d.ts'), join(target, 'lib', 'types', 'index.d.ts'))
}

function reactIdentity(sourceRoot) {
  const reactRequire = createRequire(join(sourceRoot, 'apps', 'web', 'package.json'))
  const domRequire = createRequire(join(sourceRoot, 'packages', 'client', 'ui-primitives', 'package.json'))
  return new Map([
    ['react', dirname(reactRequire.resolve('react/package.json'))],
    ['react-dom', dirname(domRequire.resolve('react-dom/package.json'))],
  ])
}

function main() {
  const sourceRoot = resolveSourceRoot()
  const available = collectPackages(sourceRoot)
  const missing = requiredPeers().filter(name => !available.has(name))
  if (missing.length > 0) throw new Error(`DSH source tree is missing peers: ${missing.join(', ')}`)
  const links = new Map(requiredPeers().map(name => [name, available.get(name)]))
  for (const identity of reactIdentity(sourceRoot)) links.set(...identity)

  if (checkOnly) {
    const problems = []
    for (const [name, target] of links) {
      const problem = linkProblem(join(repository, 'node_modules', name), target)
      if (problem !== undefined) problems.push(`${name}: ${problem}`)
    }
    const cordis = cordisProblem(sourceRoot)
    if (cordis !== undefined) problems.push(`@deepseek-ai/cordis: ${cordis}`)
    if (problems.length > 0) throw new Error(`DSH link check failed:\n  ${problems.join('\n  ')}`)
    console.log(`DSH link farm ok: ${links.size + 1} packages from ${sourceRoot}`)
    return
  }

  for (const [name, target] of links) replaceLink(join(repository, 'node_modules', name), target)
  writeCordisShim(sourceRoot)
  rmSync(join(repository, 'node_modules', 'cordis'), { force: true, recursive: true })
  console.log(`DSH link farm: ${links.size + 1} packages from ${sourceRoot}`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`dsh-explain link setup failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
