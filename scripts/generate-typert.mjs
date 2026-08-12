#!/usr/bin/env node
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = mkdtempSync(join(tmpdir(), 'dsh-explain-typert-'))
const packageRoot = join(workspace, 'packages', 'dsh-explain')
const typeMetaRoot = join(workspace, 'packages', 'typert', 'type-meta')
const dshSource = resolve(repository, 'node_modules', '@deepseek-ai', 'dsh-type-meta')

try {
  mkdirSync(packageRoot, { recursive: true })
  cpSync(join(repository, 'src'), join(packageRoot, 'src'), { recursive: true })
  rmSync(join(packageRoot, 'src', 'client'), { recursive: true, force: true })
  mkdirSync(typeMetaRoot, { recursive: true })
  cpSync(join(dshSource, 'src'), join(typeMetaRoot, 'src'), { recursive: true })
  const typeMetaManifest = JSON.parse(readFileSync(join(dshSource, 'package.json'), 'utf8'))
  typeMetaManifest.exports = { '.': './src/index.ts' }
  writeFileSync(join(typeMetaRoot, 'package.json'), `${JSON.stringify(typeMetaManifest, null, 2)}\n`)
  writeFileSync(join(typeMetaRoot, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2024',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ['src'],
  }, null, 2)}\n`)
  const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'))
  manifest.exports = {
    '.': './src/index.ts',
    './types': './src/types.ts',
    './typert': {
      types: './lib/typert.host.d.ts',
      default: './lib/typert.host.js',
    },
    './remote': {
      types: './lib/typert.remote-client.d.ts',
      default: './lib/typert.remote-client.js',
    },
  }
  writeFileSync(join(packageRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(packageRoot, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2024',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2024'],
      types: ['node'],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
      baseUrl: '.',
      paths: {
        '@deepseek-ai/dsh-type-meta': ['../typert/type-meta/src/index.ts'],
      },
      useDefineForClassFields: true,
    },
    include: ['src'],
  }, null, 2)}\n`)
  writeFileSync(join(workspace, 'tsconfig.host.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2024',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      baseUrl: '.',
      paths: {
        '@deepseek-ai/dsh-type-meta': ['packages/typert/type-meta/src/index.ts'],
      },
    },
    files: [],
    references: [
      { path: './packages/dsh-explain' },
      { path: './packages/typert/type-meta' },
    ],
  }, null, 2)}\n`)
  symlinkSync(join(repository, 'node_modules'), join(workspace, 'node_modules'), 'dir')

  const generator = new WorkspaceTypertGenerator(workspace)
  const discovered = generator.discover(['host'])
  const artifacts = generator.generate(['dsh-explain'], ['host'])
  const artifact = artifacts.find(candidate => candidate.package === 'dsh-explain' && candidate.face === 'host')
  if (artifact === undefined || artifact.remote === undefined) {
    const summary = artifacts.map(candidate => ({
      package: candidate.package,
      face: candidate.face,
      remote: candidate.remote !== undefined,
    }))
    throw new Error(`TypeRT generator did not emit the dsh-explain host and Remote artifacts: ${JSON.stringify({ discovered, artifacts: summary })}`)
  }
  mkdirSync(join(repository, 'lib'), { recursive: true })
  writeFileSync(join(repository, 'lib', 'typert.host.js'), artifact.js)
  writeFileSync(join(repository, 'lib', 'typert.host.d.ts'), artifact.dts)
  writeFileSync(join(repository, 'lib', 'typert.remote-client.js'), artifact.remote.js)
  writeFileSync(join(repository, 'lib', 'typert.remote-client.d.ts'), artifact.remote.dts)
  writeFileSync(join(repository, 'lib', 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
  console.log('generated TypeRT host and Remote artifacts')
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
