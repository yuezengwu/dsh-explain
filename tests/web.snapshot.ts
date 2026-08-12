import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ExplainContextSnapshot, GenerationRecord, SourceCapsule } from '../src/domain.ts'
import { ExplainStore } from '../src/store.ts'

const REPOSITORY = fileURLToPath(new URL('..', import.meta.url))
const SNAPSHOT_DIRECTORY = join(REPOSITORY, 'tests/snapshots/learning-view')
const SESSION_FIXTURE = join(SNAPSHOT_DIRECTORY, 'session.jsonl')
const UI_GOLDEN = join(SNAPSHOT_DIRECTORY, 'ui.expected.md')
const SESSION_ID = 'web-snapshot-session'
const SOURCE_SESSION_ID = SessionId('fixture-source')
const FIXED_TIME = Date.UTC(2026, 0, 2, 3, 4, 5)
const DAY_MS = 86_400_000

type SnapshotMode = 'replay' | 'refresh'

function snapshotMode(): SnapshotMode {
  const value = process.env.DSH_SNAPSHOT
  if (value === undefined || value === '' || value === 'replay') return 'replay'
  if (value === 'refresh') return value
  throw new Error(`DSH_SNAPSHOT must be replay or refresh; got ${JSON.stringify(value)}`)
}

function requireDshSource(): string {
  const value = process.env.DSH_SOURCE_DIR
  if (value === undefined || value.trim() === '') {
    throw new Error('test:web requires DSH_SOURCE_DIR pointing to a built deepseek-harness checkout')
  }
  const source = realpathSync(value)
  const cli = join(source, 'apps/cli/src/bin.ts')
  const frontend = join(source, 'apps/web/dist/index.html')
  if (!existsSync(cli)) throw new Error(`DSH CLI source is missing: ${cli}`)
  if (!existsSync(frontend)) throw new Error(`DSH Web dist is missing: ${frontend}; build DSH first`)
  return source
}

function dshEnvironment(dshHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1',
    DEEPSEEK_API_KEY: '',
  }
}

function runDsh(dshSource: string, dshHome: string, args: readonly string[]): void {
  execFileSync(process.execPath, [
    '--import', 'tsx/esm', join(dshSource, 'apps/cli/src/bin.ts'), ...args,
  ], {
    cwd: dshSource,
    env: dshEnvironment(dshHome),
    encoding: 'utf8',
    stdio: 'pipe',
  })
}

async function seedLearningDatabase(dshHome: string): Promise<void> {
  const store = new ExplainStore(join(dshHome, 'dsh-explain/v1/thread.sqlite'))
  const lease = store.acquireLease('web-snapshot-fixture', Date.now(), DAY_MS)
  const generation: GenerationRecord = {
    provider: 'fixture-provider',
    model: 'fixture-model',
    generatedAt: FIXED_TIME,
  }
  const capsule: SourceCapsule = {
    sourceSessionId: SOURCE_SESSION_ID,
    turn: 1,
    endSeq: 9,
    observedAt: FIXED_TIME,
    cwdLabel: 'workspace',
    userText: '为什么 TypeScript 能安全缩小联合类型？',
    assistantText: '判别字段让每个联合成员拥有唯一的字面量。',
    tools: [{ name: 'read' }],
    truncated: false,
  }
  store.commitAutoDecision(lease, capsule, {
    kind: 'explain',
    topicKey: 'typescript/discriminated-unions',
    title: '用判别字段安全缩小联合类型',
    what: '共享的字面量字段会标记当前是哪一个联合成员。',
    why: '检查标记后，TypeScript 能证明该分支中哪些字段必然存在。',
    pitfall: '把标记写成宽泛的 string 会失去自动收窄。',
    contextObservations: [{
      kind: 'dialogue-preference',
      dimension: 'examples',
      value: '优先使用一个具体代码示例。',
      confidence: 'high',
    }],
  }, generation)
  const batch = store.compactionBatch()
  const observationId = batch?.observations[0]?.observationId
  if (batch === undefined || observationId === undefined) throw new Error('learning fixture has no compactable observation')
  const snapshot: ExplainContextSnapshot = {
    dialogueProfile: [{
      kind: 'examples',
      preference: '优先使用一个具体代码示例。',
      confidence: 'high',
      evidenceObservationIds: [observationId],
      evidenceEntryOrdinals: [],
    }],
    knowledgeOverview: '正在学习 TypeScript 的可辨识联合。',
    learningTrend: '能从实际重构中理解类型收窄。',
  }
  if (store.commitCheckpoint(lease, batch, 'idle', 'web-snapshot-checkpoint', snapshot, generation) === undefined) {
    throw new Error('learning fixture checkpoint was not committed')
  }
  store.releaseLease(lease)
  store.close()
}

async function seedDshSession(dshSource: string, dshHome: string, workspace: string): Promise<void> {
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
  const child = spawn(process.execPath, [
    '--import', 'tsx/esm', join(dshSource, 'apps/cli/src/bin.ts'), '--profile', 'web', '--port', String(port),
  ], {
    cwd: dshSource,
    env: dshEnvironment(dshHome),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
  await new Promise<void>((resolveReady, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`DSH Web did not start on port ${port}\n${output}`))
    }, 30_000)
    const poll = setInterval(() => {
      if (output.includes(`dsh web: http://127.0.0.1:${port}`)) {
        clearTimeout(timer)
        clearInterval(poll)
        resolveReady()
      }
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
  if (await exitsWithin(child, 5_000)) return
  child.kill('SIGTERM')
  if (!await exitsWithin(child, 5_000)) throw new Error('DSH Web did not stop after SIGINT and SIGTERM')
}

function exitsWithin(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true)
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.removeListener('exit', exited)
      resolve(false)
    }, timeoutMs)
    function exited(): void {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', exited)
  })
}

async function stableAria(locator: Locator): Promise<string> {
  let previous = await locator.ariaSnapshot()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise(resolve => { setTimeout(resolve, 100) })
    const current = await locator.ariaSnapshot()
    if (current === previous) return normalizeAria(current)
    previous = current
  }
  throw new Error('learning-view aria snapshot did not stabilize')
}

function normalizeAria(value: string): string {
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{{uuid}}')
    .replace(/\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}:\d{2}/g, '{{clock}}')
}

async function compareOrRefresh(actual: string): Promise<void> {
  const payload = `${actual}\n`
  if (snapshotMode() === 'refresh') {
    await writeFile(UI_GOLDEN, payload)
    return
  }
  if (!existsSync(UI_GOLDEN)) {
    throw new Error(`missing ${UI_GOLDEN}; run pnpm run test:web:refresh`)
  }
  expect(payload).toBe(await readFile(UI_GOLDEN, 'utf8'))
}

describe('keyless assembled DSH Web learning view', () => {
  let root: string
  let dshHome: string
  let workspace: string
  let host: ChildProcessWithoutNullStreams | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  const pageErrors: string[] = []

  beforeAll(async () => {
    const dshSource = requireDshSource()
    root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-explain-web-snapshot-')))
    dshHome = join(root, 'home')
    workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    runDsh(dshSource, dshHome, ['plugin', '--profile', 'web', 'add', REPOSITORY])
    await writeFile(join(dshHome, 'profiles/web/cordis.patch.yml'), [
      '- id: directory-picker',
      '  disabled: true',
      '- insert:',
      '    - id: directory-picker-browse',
      "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
      '',
    ].join('\n'))
    await seedLearningDatabase(dshHome)
    await seedDshSession(dshSource, dshHome, workspace)
    const port = await freePort()
    host = await startDsh(dshSource, dshHome, port)
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 1680, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'UTC',
    })
    page.on('pageerror', error => { pageErrors.push(String(error)) })
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'load' })
    const continueButton = page.getByRole('button', { name: '继续' })
    await continueButton.waitFor({ timeout: 15_000 })
    await continueButton.click()
    expect(await page.getByRole('tab', { name: '学习' }).count()).toBe(0)
    const session = page.getByRole('treeitem', { name: /workspace 刚刚/ })
    try {
      await session.waitFor({ timeout: 15_000 })
    } catch (error) {
      throw new Error(`seeded Session did not appear\n${await page.locator('body').ariaSnapshot()}`, { cause: error })
    }
    await session.click()
    const learning = page.getByRole('tab', { name: '学习' })
    await learning.waitFor({ timeout: 15_000 })
    expect(await learning.count()).toBe(1)
    await learning.click()
    await page.getByRole('heading', { name: '全局学习线程' }).waitFor({ timeout: 15_000 })
    await page.getByRole('textbox', { name: '给智能体发消息' }).waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch(error => { failures.push(error) })
    await stopDsh(host).catch(error => { failures.push(error) })
    if (root !== undefined) await rm(root, { recursive: true, force: true }).catch(error => { failures.push(error) })
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'web snapshot cleanup failed')
  })

  it('renders the global context and another source active card while disabled', async () => {
    if (page === undefined) throw new Error('web page is not initialized')
    const view = page.getByTestId('dsh-explain-learning-view')
    const snapshot = await stableAria(view)
    await compareOrRefresh(snapshot)
    expect(snapshot).toContain('学习模式当前已关闭；历史仍可阅读。')
    expect(snapshot).toContain('正在学习 TypeScript 的可辨识联合。')
    expect(snapshot).toContain('其他会话的活跃讲解')
    expect(await view.getByRole('button', { name: '✓ 懂了' }).isDisabled()).toBe(true)
    expect(pageErrors).toEqual([])
  })

  it('keeps the fixture inventory closed', async () => {
    expect((await readdir(SNAPSHOT_DIRECTORY)).sort()).toEqual(['session.jsonl', 'ui.expected.md'])
  })
})
