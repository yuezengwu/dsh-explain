import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REPOSITORY = fileURLToPath(new URL('..', import.meta.url))
const SESSION_FIXTURE = join(REPOSITORY, 'tests/snapshots/learning-view/session.jsonl')
const SESSION_ID = 'm6-combination-session'

interface PluginSpec {
  readonly marker: string
  readonly packageName: string
  readonly installSpec: string
}

function requireDirectory(envName: string, fallback: string, expected: string): string {
  const candidate = process.env[envName]?.trim() || fallback
  if (!existsSync(join(candidate, expected))) {
    throw new Error(`${envName} must point to a built repository containing ${expected}: ${candidate}`)
  }
  return realpathSync(candidate)
}

function dshEnvironment(dshHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1',
    DEEPSEEK_API_KEY: '',
  }
}

function dshArgs(dshSource: string, args: readonly string[]): string[] {
  return ['--import', 'tsx/esm', join(dshSource, 'apps/cli/src/bin.ts'), ...args]
}

function runDsh(dshSource: string, dshHome: string, args: readonly string[]): string {
  return execFileSync(process.execPath, dshArgs(dshSource, args), {
    cwd: dshSource,
    env: dshEnvironment(dshHome),
    encoding: 'utf8',
    stdio: 'pipe',
  })
}

function count(value: string, fragment: string): number {
  return value.split(fragment).length - 1
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => { reject(new Error('port probe returned no address')) })
        return
      }
      probe.close(() => { resolvePort(address.port) })
    })
  })
}

async function startDsh(dshSource: string, dshHome: string, port: number): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(process.execPath, dshArgs(dshSource, ['--profile', 'web', '--port', String(port)]), {
    cwd: dshSource,
    env: dshEnvironment(dshHome),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
  await new Promise<void>((resolveReady, reject) => {
    const timer = setTimeout(() => { reject(new Error(`DSH Web did not start\n${output}`)) }, 45_000)
    const poll = setInterval(() => {
      if (!output.includes(`dsh web: http://127.0.0.1:${port}`)) return
      clearTimeout(timer)
      clearInterval(poll)
      resolveReady()
    }, 25)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      clearInterval(poll)
      reject(new Error(`DSH Web exited before readiness (${String(code ?? signal)})\n${output}`))
    })
  })
  return child
}

async function stopDsh(child: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null) return
  child.kill('SIGINT')
  await new Promise<void>((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('DSH Web did not unload after SIGINT'))
    }, 10_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveExit()
    })
  })
}

async function seedSession(dshSource: string, dshHome: string, workspace: string): Promise<void> {
  execFileSync(process.execPath, [join(REPOSITORY, 'tests/seed-web-session.mjs')], {
    cwd: REPOSITORY,
    env: {
      ...dshEnvironment(dshHome),
      DSH_SOURCE_DIR: dshSource,
      DSH_WEB_FIXTURE: SESSION_FIXTURE,
      DSH_WEB_SESSION_ID: SESSION_ID,
      DSH_WEB_WORKSPACE: workspace,
    },
    encoding: 'utf8',
    stdio: 'pipe',
  })
}

async function finishOnboarding(page: Page): Promise<void> {
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.locator('[class*="onboardingStage"]').waitFor({ state: 'detached', timeout: 15_000 })
  await page.getByRole('button', { name: '稍后配置', exact: true }).click()
}

describe('M6 Explain-owned shortcuts', () => {
  let root: string
  let dshHome: string
  let dshSource: string
  let host: ChildProcessWithoutNullStreams | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  const plugin: PluginSpec = {
    marker: '# == dsh-explain',
    packageName: 'dsh-explain',
    installSpec: REPOSITORY,
  }
  const pageErrors: string[] = []

  beforeAll(async () => {
    dshSource = requireDirectory('DSH_SOURCE_DIR', '', 'apps/cli/src/bin.ts')
    root = await mkdtemp(join(tmpdir(), 'dsh-explain-m6-combination-'))
    dshHome = join(root, 'home')
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    runDsh(dshSource, dshHome, ['plugin', '--profile', 'web', 'add', plugin.installSpec])
    await writeFile(join(dshHome, 'profiles/web/cordis.patch.yml'), [
      '- id: directory-picker',
      '  disabled: true',
      '- insert:',
      '    - id: directory-picker-browse',
      "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
      '',
    ].join('\n'))
    await seedSession(dshSource, dshHome, workspace)
    const port = await freePort()
    host = await startDsh(dshSource, dshHome, port)
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 920 }, locale: 'zh-CN' })
    page.on('pageerror', error => { pageErrors.push(String(error)) })
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'load' })
    await finishOnboarding(page)
    const workspaceItem = page.getByRole('treeitem', { name: 'workspace', exact: true })
    await workspaceItem.waitFor({ timeout: 15_000 })
    if (await workspaceItem.getAttribute('aria-expanded') !== 'true') await workspaceItem.click()
    const session = page.locator('[role="treeitem"][aria-selected="false"]').filter({ hasText: 'workspace' })
    await session.waitFor({ timeout: 15_000 })
    await session.click()
  }, 180_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch(error => { failures.push(error) })
    await stopDsh(host).catch(error => { failures.push(error) })
    if (root !== undefined) await rm(root, { recursive: true, force: true }).catch(error => { failures.push(error) })
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'M6 combination cleanup failed')
  })

  it('assembles one self-contained Explain layer without consumer plugins', () => {
    const dump = runDsh(dshSource, dshHome, ['--profile', 'web', '--dump-config'])
    expect(count(dump, plugin.marker), plugin.marker).toBe(1)
    expect(dump).not.toContain('dsh-selection-chat')
    expect(dump).not.toContain('dsh-suggested-replies')
    expect(dump).not.toContain('dsh-advisor')
  })

  it('drafts selection and exact-answer requests without submitting either', async () => {
    if (page === undefined) throw new Error('Web page is not initialized')
    await page.getByRole('tab', { name: '学习', exact: true }).waitFor({ timeout: 15_000 })
    const selectionAction = page.getByRole('button', { name: '解释选中文字', exact: true })
    await selectionAction.waitFor({ timeout: 15_000 })
    await expect.poll(() => selectionAction.getAttribute('aria-disabled')).toBe('true')
    const text = '判别字段帮助 TypeScript 确定联合成员。'
    const message = page.getByText(text, { exact: true })
    await message.waitFor({ timeout: 15_000 })
    await message.evaluate((node) => {
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(node)
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await expect.poll(() => selectionAction.getAttribute('aria-disabled')).toBeNull()
    await selectionAction.click()
    const composer = page.getByRole('textbox', { name: '给智能体发消息' })
    await expect.poll(() => composer.inputValue()).toBe(`/explain --selection ${text}`)
    await composer.fill('')
    const answerAction = page.getByRole('button', { name: '学习这个回答', exact: true })
    await answerAction.waitFor({ timeout: 15_000 })
    await answerAction.click()
    await expect.poll(() => composer.inputValue()).toBe('/explain --answer 1 请解释这个回答中最关键、最值得学习的概念。')
    expect(await page.getByText(text, { exact: true }).count()).toBe(1)
    expect(pageErrors).toEqual([])
  })

  it('removes and restores the complete shortcut layer after Web unload', async () => {
    await browser?.close()
    browser = undefined
    await stopDsh(host)
    host = undefined
    runDsh(dshSource, dshHome, ['plugin', '--profile', 'web', 'remove', plugin.packageName])
    const removed = runDsh(dshSource, dshHome, ['--profile', 'web', '--dump-config'])
    expect(removed).not.toContain(plugin.marker)
    runDsh(dshSource, dshHome, ['plugin', '--profile', 'web', 'add', plugin.installSpec])
    const restored = runDsh(dshSource, dshHome, ['--profile', 'web', '--dump-config'])
    expect(count(restored, plugin.marker), plugin.marker).toBe(1)
  }, 90_000)
})
