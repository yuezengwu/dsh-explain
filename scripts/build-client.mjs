#!/usr/bin/env node
import { build } from 'esbuild'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(repository, 'lib', 'client.js')
const platformModules = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-web-react',
]

if (!existsSync(resolve(repository, 'lib', 'typert.remote-client.js'))) {
  throw new Error('client build requires generated lib/typert.remote-client.js; run build:host first')
}

await build({
  absWorkingDir: repository,
  entryPoints: ['src/client/index.ts'],
  outfile: output,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  external: platformModules,
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-explain", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  },
  footer: { js: 'return module.exports; } });' },
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
  logLevel: 'info',
})

const bundle = readFileSync(output, 'utf8')
if (
  !bundle.includes('window.__ModuleLoader__.load(')
  || !bundle.includes('var module = { exports: {} }')
  || !bundle.includes('dsh-explain')
) {
  throw new Error('dsh-explain: client bundle is missing the ModuleLoader handoff')
}
if (bundle.includes('import.meta') || /(^|\n)\s*(import|export)\s/.test(bundle)) {
  throw new Error('dsh-explain: client bundle contains ESM syntax')
}
for (const match of bundle.matchAll(/require\(\s*["'](@deepseek-ai\/[^"']+)["']\s*\)/g)) {
  if (!platformModules.includes(match[1])) {
    throw new Error(`dsh-explain: unsupported client runtime dependency ${match[1]}`)
  }
}

const require = createRequire(import.meta.url)
const tsc = require.resolve('typescript/bin/tsc')
rmSync(resolve(repository, 'lib', 'client'), { recursive: true, force: true })
const declarations = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.client.json'], {
  cwd: repository,
  encoding: 'utf8',
})
if (declarations.status !== 0) {
  throw new Error(`client declaration build failed:\n${declarations.stdout}${declarations.stderr}`)
}
