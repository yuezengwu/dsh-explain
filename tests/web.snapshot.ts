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
const SETTINGS_GOLDEN = join(SNAPSHOT_DIRECTORY, 'settings.expected.md')
const SESSION_ID = 'web-snapshot-session'
const SOURCE_SESSION_ID = SessionId('fixture-source')
const MISSING_SOURCE_SESSION_ID = SessionId('missing-source')
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
  store.commitManualExplanation(lease, {
    ...capsule,
    sourceSessionId: MISSING_SOURCE_SESSION_ID,
    turn: 0,
    endSeq: 15,
    observedAt: FIXED_TIME + 1,
    userText: '穷尽检查为什么能发现遗漏分支？',
    assistantText: 'never 类型让缺失分支在编译期显现。',
  }, {
    topicKey: 'typescript/exhaustiveness',
    title: '用 never 完成穷尽检查',
    what: '所有联合成员处理后，剩余值应当收窄为 never。',
    why: '新增联合成员却没有补充分支时，编译器会立即报错。',
    pitfall: 'default 分支直接吞掉值会掩盖遗漏成员。',
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

async function seedDshSession(
  dshSource: string,
  dshHome: string,
  workspace: string,
  sessionId: string,
): Promise<void> {
  execFileSync(process.execPath, [join(REPOSITORY, 'tests/seed-web-session.mjs')], {
    cwd: REPOSITORY,
    env: {
      ...dshEnvironment(dshHome),
      DSH_SOURCE_DIR: dshSource,
      DSH_WEB_FIXTURE: SESSION_FIXTURE,
      DSH_WEB_SESSION_ID: sessionId,
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

async function compareOrRefresh(actual: string, golden = UI_GOLDEN): Promise<void> {
  const payload = `${actual}\n`
  if (snapshotMode() === 'refresh') {
    await writeFile(golden, payload)
    return
  }
  if (!existsSync(golden)) {
    throw new Error(`missing ${golden}; run pnpm run test:web:refresh`)
  }
  expect(payload).toBe(await readFile(golden, 'utf8'))
}

describe('keyless assembled DSH Web learning view', () => {
  let root: string
  let dshHome: string
  let workspace: string
  let sourceWorkspace: string
  let host: ChildProcessWithoutNullStreams | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  const pageErrors: string[] = []

  beforeAll(async () => {
    const dshSource = requireDshSource()
    root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-explain-web-snapshot-')))
    dshHome = join(root, 'home')
    workspace = join(root, 'workspace-primary')
    sourceWorkspace = join(root, 'workspace-source')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(sourceWorkspace, { recursive: true }),
    ])
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
    await seedDshSession(dshSource, dshHome, sourceWorkspace, SOURCE_SESSION_ID)
    await seedDshSession(dshSource, dshHome, workspace, SESSION_ID)
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
    const continueButton = page.getByRole('button', { name: '继续', exact: true })
    await continueButton.waitFor({ timeout: 15_000 })
    await continueButton.click()
    await page.locator('[class*="onboardingStage"]').waitFor({ state: 'detached', timeout: 15_000 })
    expect(await page.getByRole('tab', { name: '学习' }).count()).toBe(0)
    const session = page.getByRole('treeitem', { name: /workspace-primary 刚刚/ })
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

  it('renders available and missing sources while disabled', async () => {
    if (page === undefined) throw new Error('web page is not initialized')
    const view = page.getByTestId('dsh-explain-learning-view')
    const snapshot = await stableAria(view)
    await compareOrRefresh(snapshot)
    expect(snapshot).toContain('学习模式已关闭')
    expect(snapshot).toContain('正在学习 TypeScript 的可辨识联合。')
    expect(snapshot).toContain('其他会话的活跃讲解')
    expect(snapshot).toContain('来源会话不可用')
    expect(snapshot).toContain('主动请求')
    expect(snapshot).not.toContain('回合 0')
    expect(await view.getByRole('button', { name: '打开来源会话' }).count()).toBe(1)
    const feedback = view.getByRole('button', { name: '✓ 懂了' })
    expect(await feedback.count()).toBe(2)
    expect(await feedback.first().isDisabled()).toBe(true)
    expect(await feedback.last().isDisabled()).toBe(true)
    expect(pageErrors).toEqual([])
  })

  it('discovers the explain request command from the composer', async () => {
    if (page === undefined) throw new Error('web page is not initialized')
    const composer = page.getByRole('textbox', { name: '给智能体发消息' })
    await composer.fill('/expl')
    const option = page.getByRole('option', {
      name: /explain Request a learning explanation or control the global learning thread/,
    })
    await option.waitFor({ timeout: 15_000 })
    await option.click()
    expect(await composer.inputValue()).toBe('/explain ')
    await page.getByText('<request> | on | off | status', { exact: true }).waitFor({ timeout: 15_000 })
    await composer.fill('')
    expect(pageErrors).toEqual([])
  })

  it('saves one native settings revision and opens an available source Session', async () => {
    if (page === undefined) throw new Error('web page is not initialized')
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settingsDialog = page.getByRole('dialog', { name: '设置', exact: true })
    await settingsDialog.waitFor({ timeout: 15_000 })
    await settingsDialog.getByRole('button', { name: '学习', exact: true }).click()
    const settings = page.getByTestId('dsh-explain-settings-section')
    await settings.waitFor({ timeout: 15_000 })
    await settings.getByRole('spinbutton', { name: '每 24 小时自主请求上限' }).fill('12')
    await settings.getByRole('button', { name: '保存设置' }).click()
    await settings.getByText('设置 revision 1', { exact: true }).waitFor({ timeout: 15_000 })
    await compareOrRefresh(await stableAria(settings), SETTINGS_GOLDEN)
    await settingsDialog.getByRole('button', { name: '关闭', exact: true }).click()

    const view = page.getByTestId('dsh-explain-learning-view')
    await view.getByRole('button', { name: '打开来源会话' }).click()
    await page.getByRole('treeitem', { name: /workspace-source 刚刚/, selected: true }).waitFor({ timeout: 15_000 })
    await page.getByRole('tab', { name: '学习' }).click()
    await page.getByRole('heading', { name: '用判别字段安全缩小联合类型' }).waitFor({ timeout: 15_000 })
    expect(await page.getByText('来源会话不可用').count()).toBeGreaterThan(0)
    expect(pageErrors).toEqual([])
  })

  it('keeps the fixture inventory closed', async () => {
    expect((await readdir(SNAPSHOT_DIRECTORY)).sort()).toEqual([
      'session.jsonl', 'settings.expected.md', 'ui.expected.md',
    ])
  })
})
