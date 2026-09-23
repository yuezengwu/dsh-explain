import { DatabaseSync } from 'node:sqlite'
import { parse, stringify } from 'yaml'
import { COMPOSER_LABEL } from './web-locators.ts'
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

function runtimeOwner(dshHome: string): unknown {
  const database = new DatabaseSync(join(dshHome, 'dsh-explain/v1/thread.sqlite'), { readOnly: true })
  try { return database.prepare("SELECT owner_id FROM runtime_lease WHERE name = 'explainer'").get()?.['owner_id'] }
  finally { database.close() }
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
    origin: 'manual',
    request: '穷尽检查为什么能发现遗漏分支？',
    capsule: {
      ...capsule,
      sourceSessionId: MISSING_SOURCE_SESSION_ID,
      turn: 0,
      endSeq: 15,
      observedAt: FIXED_TIME + 1,
      userText: '穷尽检查为什么能发现遗漏分支？',
      assistantText: 'never 类型让缺失分支在编译期显现。',
    },
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

interface StartedDsh {
  readonly child: ChildProcessWithoutNullStreams
  readonly authenticatedUrl: string
}

function redactWebToken(output: string): string {
  return output.replace(/([?&]token=)[^\s)]+/gu, '$1<redacted>')
}

async function startDsh(dshSource: string, dshHome: string, port: number): Promise<StartedDsh> {
  const child = spawn(process.execPath, [
    '--import', 'tsx/esm', join(dshSource, 'apps/cli/src/bin.ts'),
    '--profile', 'web', '--no-open', '--port', String(port),
  ], {
    cwd: dshSource,
    env: dshEnvironment(dshHome),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  let authenticatedUrl: string | undefined
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
  await new Promise<void>((resolveReady, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`DSH Web did not start on port ${port}\n${redactWebToken(output)}`))
    }, 30_000)
    const poll = setInterval(() => {
      const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/u.exec(output)
      if (match?.[1] !== undefined) {
        authenticatedUrl = match[1]
        clearTimeout(timer)
        clearInterval(poll)
        resolveReady()
      }
    }, 25)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      clearInterval(poll)
      reject(new Error(`DSH Web exited before readiness (${String(code ?? signal)})\n${redactWebToken(output)}`))
    })
  })
  if (authenticatedUrl === undefined) throw new Error('DSH Web printed no authenticated URL')
  return { child, authenticatedUrl }
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

async function openWorkspaceSession(page: Page, workspaceLabel: string): Promise<void> {
  const workspace = page.getByRole('treeitem', { name: workspaceLabel, exact: true })
  await workspace.waitFor({ timeout: 15_000 })
  if (await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click()
  const session = page.locator('[role="treeitem"][aria-selected]').filter({ hasText: workspaceLabel })
  await session.waitFor({ timeout: 15_000 })
  await session.click()
}

describe('keyless assembled DSH Web learning view', () => {
  let root: string
  let dshHome: string
  let dshSource: string
  let workspace: string
  let sourceWorkspace: string
  let host: ChildProcessWithoutNullStreams | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  const pageErrors: string[] = []

  beforeAll(async () => {
    dshSource = requireDshSource()
    root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-explain-web-snapshot-')))
    dshHome = join(root, 'home')
    workspace = join(root, 'workspace-primary')
    sourceWorkspace = join(root, 'workspace-source')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(sourceWorkspace, { recursive: true }),
    ])
    runDsh(dshSource, dshHome, ['plugin', '--profile', 'web', 'add', process.env.DSH_EXPLAIN_INSTALL_SPEC ?? REPOSITORY])
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
    const started = await startDsh(dshSource, dshHome, port)
    host = started.child
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 1680, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'UTC',
    })
    page.on('pageerror', error => { pageErrors.push(String(error)) })
    await page.goto(started.authenticatedUrl, { waitUntil: 'load' })
    const continueButton = page.getByRole('button', { name: '继续', exact: true })
    try {
      await continueButton.waitFor({ timeout: 15_000 })
    } catch (error) {
      throw new Error([
        'DSH onboarding did not become ready.',
        await page.locator('body').ariaSnapshot(),
        `Page errors: ${JSON.stringify(pageErrors)}`,
      ].join('\n'), { cause: error })
    }
    await continueButton.click()
    await page.locator('[class*="onboardingStage"]').waitFor({ state: 'detached', timeout: 15_000 })
    const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
    await configureLater.waitFor({ timeout: 15_000 })
    await configureLater.click()
    await configureLater.waitFor({ state: 'detached', timeout: 15_000 })
    expect(await page.getByRole('tab', { name: '学习' }).count()).toBe(0)
    try {
      await openWorkspaceSession(page, 'workspace-primary')
    } catch (error) {
      throw new Error(`seeded Session did not appear\n${await page.locator('body').ariaSnapshot()}`, { cause: error })
    }
    const learning = page.getByRole('tab', { name: '学习' })
    await learning.waitFor({ timeout: 15_000 })
    expect(await learning.count()).toBe(1)
    await page.getByRole('textbox', { name: COMPOSER_LABEL }).waitFor({ timeout: 15_000 })
    await learning.click()
    await page.getByRole('heading', { name: '全局学习线程' }).waitFor({ timeout: 15_000 })
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
    await view.getByText('学习模式已关闭', { exact: true }).waitFor({ timeout: 15_000 })
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
    await page.getByRole('tab', { name: '对话', exact: true }).click()
    const composer = page.getByRole('textbox', { name: COMPOSER_LABEL })
    await composer.waitFor({ timeout: 15_000 })
    await composer.fill('/expl')
    const option = page.getByRole('option', {
      name: /explain Request a learning explanation or control the global learning thread/,
    })
    await option.waitFor({ timeout: 15_000 })
    await option.click()
    expect(await composer.textContent()).toBe('/explain ')
    expect(await composer.evaluate(node => (node as HTMLElement).style.getPropertyValue('--dsh-composer-hint')))
      .toContain('<request> | on | off | status')
    await composer.fill('')
    await page.getByRole('tab', { name: '学习', exact: true }).click()
    await page.getByRole('heading', { name: '全局学习线程' }).waitFor({ timeout: 15_000 })
    expect(pageErrors).toEqual([])
  })

  it('saves settings without remounting and opens an available source Session', async () => {
    if (page === undefined) throw new Error('web page is not initialized')
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settingsDialog = page.getByRole('dialog', { name: '设置', exact: true })
    await settingsDialog.waitFor({ timeout: 15_000 })
    await settingsDialog.getByRole('button', { name: '学习', exact: true }).click()
    const settings = page.getByTestId('dsh-explain-settings-section')
    await settings.waitFor({ timeout: 15_000 })
    const owner = runtimeOwner(dshHome)
    expect(typeof owner).toBe('string')
    await settings.getByRole('spinbutton', { name: '每 24 小时自主请求上限' }).fill('12')
    await settings.getByRole('button', { name: '保存设置' }).click()
    await settings.getByText('设置 revision 1', { exact: true }).waitFor({ timeout: 15_000 })
    // The revision push can arrive before the save request finishes.
    await settings.getByRole('button', { name: '保存设置', exact: true }).waitFor({ timeout: 15_000 })
    expect(runtimeOwner(dshHome)).toBe(owner)
    await compareOrRefresh(await stableAria(settings), SETTINGS_GOLDEN)
    await settingsDialog.getByRole('button', { name: '关闭', exact: true }).click()

    const view = page.getByTestId('dsh-explain-learning-view')
    await view.getByRole('button', { name: '打开来源会话' }).click()
    await page.locator('[role="treeitem"][aria-selected="true"]')
      .filter({ hasText: 'workspace-source' })
      .waitFor({ timeout: 15_000 })
    await page.getByRole('tab', { name: '学习' }).click()
    await page.getByRole('heading', { name: '用判别字段安全缩小联合类型' }).waitFor({ timeout: 15_000 })
    expect(await page.getByText('来源会话不可用').count()).toBeGreaterThan(0)
    expect(pageErrors).toEqual([])
  })

  it('corrects an inference and sets an explicit preference without leaving the learning view', async () => {
    if (page === undefined) throw new Error('web page is not initialized')
    const view = page.getByTestId('dsh-explain-learning-view')
    const examples = view.locator('.dsh-explain-profile-row').filter({ hasText: '示例方式' })
    await examples.getByRole('button', { name: '纠正', exact: true }).click()
    await examples.getByRole('textbox', { name: '示例方式' }).fill('使用两个对比代码示例。')
    await examples.getByRole('button', { name: '保存设置', exact: true }).click()
    await examples.getByText('使用两个对比代码示例。', { exact: true }).waitFor({ timeout: 15_000 })
    await examples.getByText('用户修正', { exact: true }).waitFor({ timeout: 15_000 })
    const verbosity = view.locator('.dsh-explain-profile-row').filter({ hasText: '讲解长度' })
    await verbosity.getByRole('button', { name: '设置偏好', exact: true }).click()
    await verbosity.getByRole('textbox', { name: '讲解长度' }).fill('先给出简短结论，再展开细节。')
    await verbosity.getByRole('button', { name: '保存设置', exact: true }).click()
    await verbosity.getByText('先给出简短结论，再展开细节。', { exact: true }).waitFor({ timeout: 15_000 })
    await verbosity.getByText('显式偏好', { exact: true }).waitFor({ timeout: 15_000 })
    expect(pageErrors).toEqual([])
  })

  it('downloads the v3 backup and clears learning data through the real settings page', async () => {
    if (page === undefined) throw new Error('web page is not initialized')
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settingsDialog = page.getByRole('dialog', { name: '设置', exact: true })
    await settingsDialog.waitFor({ timeout: 15_000 })
    await settingsDialog.getByRole('button', { name: '学习', exact: true }).click()
    const settings = page.getByTestId('dsh-explain-settings-section')
    await settings.waitFor({ timeout: 15_000 })

    const downloadReady = page.waitForEvent('download')
    await settings.getByRole('button', { name: '导出 JSON' }).click()
    const download = await downloadReady
    expect(download.suggestedFilename()).toBe('dsh-explain-backup-v3.json')
    const downloadPath = await download.path()
    if (downloadPath === null) throw new Error('learning backup download has no local path')
    const backupJson = await readFile(downloadPath, 'utf8')
    const backup = JSON.parse(backupJson) as {
      readonly format: string
      readonly version: number
      readonly data: {
        readonly entries: readonly unknown[]
        readonly review: unknown
        readonly context: { readonly dialogueProfile: readonly unknown[] }
        readonly profileAudit: readonly unknown[]
      }
    }
    expect(backup).toMatchObject({
      format: 'dsh-explain-backup',
      version: 3,
      data: {
        entries: [{ ordinal: 1 }, { ordinal: 2 }],
        review: { dashboard: { dueCount: 0 }, attempts: [] },
      },
    })
    expect(backup.data.context.dialogueProfile).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'examples', preference: '使用两个对比代码示例。', authority: 'correction' }),
      expect.objectContaining({ kind: 'verbosity', preference: '先给出简短结论，再展开细节。', authority: 'explicit' }),
    ]))
    expect(backup.data.profileAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetKey: 'examples', action: 'set', authority: 'correction' }),
      expect.objectContaining({ targetKey: 'verbosity', action: 'set', authority: 'explicit' }),
    ]))
    expect(backupJson).not.toContain('sourceSummary')
    expect(backupJson).not.toContain(sourceWorkspace)

    const clearButton = settings.getByRole('button', { name: '清除所有学习数据' })
    expect(await clearButton.isDisabled()).toBe(true)
    await settings.getByRole('textbox', { name: '输入 CLEAR 以确认' }).fill('CLEAR')
    expect(await clearButton.isEnabled()).toBe(true)
    await clearButton.click()
    await settings.getByText('已清除学习数据。删除的学习记录数： 2', { exact: true })
      .waitFor({ timeout: 15_000 })
    expect(await settings.getByRole('spinbutton', { name: '每 24 小时自主请求上限' }).inputValue()).toBe('12')
    await settings.getByText('设置 revision 1', { exact: true }).waitFor({ timeout: 15_000 })
    await settingsDialog.getByRole('button', { name: '关闭', exact: true }).click()

    const view = page.getByTestId('dsh-explain-learning-view')
    await view.getByText('还没有讲解。完成工作回合后，explain 会在值得讲解时记录到这里。', { exact: true })
      .waitFor({ timeout: 15_000 })
    await view.getByRole('heading', { name: '用判别字段安全缩小联合类型' }).waitFor({ state: 'detached', timeout: 15_000 })
    expect(pageErrors).toEqual([])
  })

  it('shows active cards older than the first history page', async () => {
    if (page === undefined) throw new Error('web page is not initialized')
    const store = new ExplainStore(join(dshHome, 'dsh-explain/v1/thread.sqlite'))
    try {
      store.addFixtureExplanation({
        topicKey: 'pagination/active', title: '仍在等待反馈的旧讲解',
        sourceSessionId: SOURCE_SESSION_ID, sourceTurn: 1,
      })
      for (let index = 0; index < 31; index += 1) {
        store.addFixtureExplanation({
          topicKey: `pagination/closed-${index}`, title: `较新的历史 ${index}`,
          sourceSessionId: SessionId(`pagination-${index}`), sourceTurn: 1,
          state: 'closed', topicState: 'mastered',
        })
      }
    } finally {
      store.close()
    }
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('tab', { name: '学习', exact: true }).click()
    const view = page.getByTestId('dsh-explain-learning-view')
    await view.getByRole('heading', { name: '仍在等待反馈的旧讲解', exact: true }).waitFor({ timeout: 15_000 })
    expect(await view.getByRole('button', { name: '✓ 懂了', exact: true }).count()).toBe(1)
    expect(await view.getByRole('button', { name: '加载更早记录', exact: true }).isVisible()).toBe(true)
    expect(pageErrors).toEqual([])
  })

  it('imports legacy settings into the new profile and keeps later edits after two restarts', async (test) => {
    const manifest = JSON.parse(await readFile(join(dshSource, 'package.json'), 'utf8')) as { version: string }
    if (!['0.1.7-alpha.1', '0.1.7-alpha.2'].includes(manifest.version)) test.skip()
    if (page === undefined) throw new Error('web page is not initialized')
    await stopDsh(host)
    host = undefined
    const legacyPath = join(dshHome, 'settings.yaml.imported')
    const legacy = 'dsh-explain:\n  enabled: false\n  provider: legacy-provider\n  model: legacy-model\n  timeoutMs: 19000\n  maxAutoRequestsPerDay: 17\n'
    await writeFile(legacyPath, legacy)
    // Simulate a profile that set its budget but has not overridden the old route.
    const patchPath = join(dshHome, 'profiles/web/cordis.patch.yml')
    const rows = parse(await readFile(patchPath, 'utf8')) as { id?: string; config?: Record<string, unknown> }[]
    const config = rows.find(row => row.id === 'explain')?.config
    if (config === undefined) throw new Error('saved Explain profile configuration is missing')
    delete config.provider
    delete config.model
    await writeFile(patchPath, stringify(rows))
    const restart = async (): Promise<Locator> => {
      const started = await startDsh(dshSource, dshHome, await freePort())
      host = started.child
      await page!.goto(started.authenticatedUrl, { waitUntil: 'load' })
      // A keyless profile may offer model setup again after a process restart.
      const later = page!.getByRole('button', { name: '稍后配置', exact: true })
      await later.waitFor({ state: 'visible', timeout: 3_000 }).then(() => later.click()).catch(() => {})
      await page!.getByRole('button', { name: '设置', exact: true }).click()
      await page!.getByRole('dialog', { name: '设置', exact: true })
        .getByRole('button', { name: '学习', exact: true }).click()
      const settings = page!.getByTestId('dsh-explain-settings-section')
      await settings.waitFor({ timeout: 15_000 })
      return settings
    }
    const settings = await restart()
    await expect.poll(() => settings.getByRole('combobox', { name: /^模型/u }).inputValue(), { timeout: 15_000 }).toBe('legacy-model')
    expect(await settings.getByRole('spinbutton', { name: '每 24 小时自主请求上限' }).inputValue()).toBe('12')
    const patch = await readFile(join(dshHome, 'profiles/web/cordis.patch.yml'), 'utf8')
    expect(patch).toContain('legacy-provider')
    expect(patch).toContain('19000')
    expect(await readFile(legacyPath, 'utf8')).toBe(legacy)
    expect(await readFile(join(dshHome, 'profiles/web/.dsh-explain-settings-migrated'), 'utf8')).toBe('1\n')
    await settings.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('')
    await settings.getByRole('combobox', { name: /^模型/u }).fill('')
    await settings.getByRole('spinbutton', { name: '每 24 小时自主请求上限' }).fill('13')
    await settings.getByRole('button', { name: '保存设置', exact: true }).click()
    await settings.getByRole('button', { name: '保存设置', exact: true }).waitFor({ timeout: 15_000 })
    await stopDsh(host)
    host = undefined
    const restored = await restart()
    expect(await restored.getByRole('combobox', { name: /^模型/u }).inputValue()).toBe('')
    expect(await restored.getByRole('spinbutton', { name: '每 24 小时自主请求上限' }).inputValue()).toBe('13')
    expect(await readFile(legacyPath, 'utf8')).toBe(legacy)
    expect(pageErrors).toEqual([])
  }, 60_000)

  it('keeps the fixture inventory closed', async () => {
    expect((await readdir(SNAPSHOT_DIRECTORY)).sort()).toEqual([
      'session.jsonl', 'settings.expected.md', 'ui.expected.md',
    ])
  })
})
