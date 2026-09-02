import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const REPOSITORY = fileURLToPath(new URL('..', import.meta.url))
const ASSETS = join(REPOSITORY, 'docs/assets')
const VIEWPORT = { width: 1440, height: 900 }
const DAY_MS = 86_400_000
const SESSION_ID = 'dsh-explain-demo-session'
const DEMO_NOW = Date.UTC(2026, 8, 2, 9, 45, 36)

function requireDshSource() {
  const value = process.env.DSH_SOURCE_DIR?.trim()
  if (value === undefined || value === '') throw new Error('DSH_SOURCE_DIR is required')
  const source = realpathSync(value)
  for (const expected of ['apps/cli/src/bin.ts', 'apps/web/dist/index.html']) {
    if (!existsSync(join(source, expected))) throw new Error(`DSH source is missing ${expected}: ${source}`)
  }
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  if (manifest.version !== '0.1.2-alpha.5') {
    throw new Error(`DSH source must be 0.1.2-alpha.5, received ${String(manifest.version)}: ${source}`)
  }
  return source
}

function dshEnvironment(dshHome) {
  return {
    ...process.env,
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1',
    DEEPSEEK_API_KEY: '',
  }
}

function dshArgs(dshSource, args) {
  return ['--import', 'tsx/esm', join(dshSource, 'apps/cli/src/bin.ts'), ...args]
}

function runDsh(dshSource, dshHome, args) {
  execFileSync(process.execPath, dshArgs(dshSource, args), {
    cwd: dshSource,
    env: dshEnvironment(dshHome),
    encoding: 'utf8',
    stdio: 'pipe',
  })
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => { reject(new Error('port probe returned no address')) })
        return
      }
      server.close(() => { resolvePort(address.port) })
    })
  })
}

function redactWebToken(output) {
  return output.replace(/([?&]token=)[^\s)]+/gu, '$1<redacted>')
}

async function startDsh(dshSource, dshHome, port) {
  const child = spawn(process.execPath, dshArgs(dshSource, [
    '--profile', 'web', '--no-open', '--port', String(port),
  ]), {
    cwd: dshSource,
    env: dshEnvironment(dshHome),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk.toString() })
  child.stderr.on('data', chunk => { output += chunk.toString() })
  const authenticatedUrl = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`DSH Web did not start\n${redactWebToken(output)}`))
    }, 45_000)
    const poll = setInterval(() => {
      const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/?\?token=[A-Za-z0-9_-]+)/u.exec(output)
      if (match?.[1] === undefined) return
      clearTimeout(timer)
      clearInterval(poll)
      resolveUrl(match[1])
    }, 25)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      clearInterval(poll)
      reject(new Error(`DSH Web exited before readiness (${String(code ?? signal)})\n${redactWebToken(output)}`))
    })
  })
  return { authenticatedUrl, child }
}

async function exitsWithin(child, timeoutMs) {
  if (child.exitCode !== null) return true
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.removeListener('exit', exited)
      resolve(false)
    }, timeoutMs)
    function exited() {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', exited)
  })
}

async function stopDsh(child) {
  if (child === undefined || child.exitCode !== null) return
  child.kill('SIGINT')
  if (await exitsWithin(child, 5_000)) return
  child.kill('SIGTERM')
  if (!await exitsWithin(child, 5_000)) throw new Error('DSH Web did not stop')
}

function demoSessionFixture(workspace) {
  const createdAt = Date.UTC(2026, 8, 2, 8, 0, 0)
  return [
    { type: 'session', version: 0, id: SESSION_ID, createdAt, cwd: workspace },
    { type: 'turn/start', seq: 0, time: createdAt + 1, data: { turn: 1 } },
    {
      type: 'user/message', seq: 1, time: createdAt + 2,
      data: {
        role: 'user', content: [{ type: 'text', text: 'Why does a discriminant make this TypeScript union safer?' }],
        source: { kind: 'user' }, id: '22222222-2222-4222-8222-222222222222',
      },
      surfaceOp: 'append',
    },
    { type: 'step/start', seq: 2, time: createdAt + 3, data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message', seq: 3, time: createdAt + 4,
      data: {
        turn: 1, step: 1,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'A shared literal field lets TypeScript identify the exact union member in each branch.' }],
          source: { kind: 'model', provider: 'demo-replay', model: 'demo' },
          id: '11111111-1111-4111-8111-111111111111',
        },
        usage: { inputTokens: 16, outputTokens: 18 },
      },
      surfaceOp: 'append',
    },
    { type: 'step/end', seq: 4, time: createdAt + 5, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 5, time: createdAt + 6, data: { turn: 1, reason: { kind: 'completed' } } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n'
}

async function seedDshSession(dshSource, dshHome, workspace, fixturePath) {
  execFileSync(process.execPath, [join(REPOSITORY, 'tests/seed-web-session.mjs')], {
    cwd: REPOSITORY,
    env: {
      ...dshEnvironment(dshHome),
      DSH_SOURCE_DIR: dshSource,
      DSH_WEB_FIXTURE: fixturePath,
      DSH_WEB_SESSION_ID: SESSION_ID,
      DSH_WEB_WORKSPACE: workspace,
    },
    encoding: 'utf8',
    stdio: 'pipe',
  })
}

async function seedLearningDatabase(dshHome) {
  const [{ ExplainStore }] = await Promise.all([
    import(new URL('../lib/types/store.js', import.meta.url)),
  ])
  const now = DEMO_NOW
  const store = new ExplainStore(join(dshHome, 'dsh-explain/v1/thread.sqlite'))
  const lease = store.acquireLease('demo-seed', now, DAY_MS)
  const generation = { provider: 'demo-replay', model: 'demo', generatedAt: now }
  const capsule = (turn, userText, assistantText) => ({
    sourceSessionId: SESSION_ID,
    turn,
    endSeq: turn * 10,
    observedAt: now - DAY_MS,
    cwdLabel: 'project',
    userText,
    assistantText,
    tools: [],
    truncated: false,
  })

  const reviewSpecs = [
    {
      topicKey: 'typescript/exhaustive-checks',
      title: 'Catch missing branches with never',
      sourceSessionId: SESSION_ID,
      sourceTurn: 2,
      state: 'closed',
      topicState: 'mastered',
      revisions: [{
        title: 'Catch missing branches with never',
        what: 'After every union member is handled, the remaining value must narrow to never.',
        why: 'Adding a new member then produces a compile-time failure at the exhaustive check.',
        pitfall: 'A silent default branch hides missing cases.',
      }],
      userText: 'How does never help with exhaustive checks?',
      cwdLabel: 'project',
    },
    {
      topicKey: 'state/immutable-updates',
      title: 'Make state changes observable with immutable updates',
      sourceSessionId: SESSION_ID,
      sourceTurn: 3,
      state: 'closed',
      topicState: 'mastered',
      revisions: [{
        title: 'Make state changes observable with immutable updates',
        what: 'Each update creates a new reference instead of mutating the previous value.',
        why: 'Consumers can detect change with cheap identity comparisons.',
        pitfall: 'Mutating a nested value can leave the top-level reference unchanged.',
      }],
      userText: 'Why should reducer state stay immutable?',
      cwdLabel: 'project',
    },
  ]
  const realDateNow = Date.now
  try {
    Date.now = () => DEMO_NOW
    for (const review of reviewSpecs) store.addFixtureExplanation(review)
  } finally {
    Date.now = realDateNow
  }

  const active = store.commitAutoDecision(lease, capsule(
    1,
    'Why does a discriminant make this TypeScript union safer?',
    'A shared literal field lets TypeScript identify the exact union member in each branch.',
  ), {
    kind: 'explain',
    topicKey: 'typescript/discriminated-unions',
    title: 'Narrow unions safely with a discriminant',
    what: 'A shared literal field identifies the exact member of a union.',
    why: 'Once the field is checked, TypeScript can prove which properties exist in that branch.',
    pitfall: 'Typing the discriminant as a broad string removes automatic narrowing.',
    contextObservations: [
      {
        kind: 'dialogue-preference', dimension: 'examples',
        value: 'Prefer one concrete code example.', confidence: 'high',
      },
      {
        kind: 'topic-familiarity', topicKey: 'typescript/discriminated-unions',
        level: 'working', confidence: 'medium',
      },
    ],
  }, generation)
  if (active.entry === undefined) throw new Error('demo active explanation was not committed')

  const reviewNow = DEMO_NOW + 1_000
  const started = store.startReview({ requestId: 'demo-review-start' }, reviewNow)
  const current = started.dashboard.current
  if (current === undefined) throw new Error('demo review did not start')
  const reviewed = store.commitReviewAnswer({
    requestId: 'demo-review-answer',
    reviewId: current.reviewId,
    answer: 'The never assignment proves that no union member remains unhandled.',
  }, {
    result: 'mastered',
    feedback: 'Correct: the impossible remainder turns a missing branch into a compiler error.',
  }, { ...generation, generatedAt: reviewNow + 1 }, reviewNow + 1)
  if (!reviewed.ok) throw new Error(`demo review answer failed: ${reviewed.code}`)

  const batch = store.compactionBatch()
  const observation = batch?.observations.find(item => item.observation.kind === 'dialogue-preference')
  if (batch === undefined || observation === undefined) throw new Error('demo profile observation is missing')
  const checkpoint = store.commitCheckpoint(lease, batch, 'idle', 'demo-profile-checkpoint', {
    dialogueProfile: [{
      kind: 'examples',
      preference: 'Prefer one concrete code example.',
      confidence: 'high',
      evidenceObservationIds: [observation.observationId],
      evidenceEntryOrdinals: [],
    }],
    knowledgeOverview: 'Comfortable with TypeScript basics and actively learning safer modeling patterns.',
    learningTrend: 'Connects type-system rules to practical refactoring decisions.',
  }, { ...generation, generatedAt: now - 5 * 60_000 })
  if (checkpoint === undefined) throw new Error('demo profile checkpoint was not committed')
  store.releaseLease(lease)
  store.close()
}

async function finishOnboarding(page) {
  const continueButton = page.getByRole('button', { name: /^(Continue|继续)$/u }).first()
  await continueButton.waitFor({ timeout: 20_000 })
  await continueButton.click()
  await page.locator('[class*="onboardingStage"]').waitFor({ state: 'detached', timeout: 20_000 })
  const later = page.getByRole('button', { name: /^(Configure later|稍后配置)$/u }).first()
  try {
    await later.waitFor({ timeout: 3_000 })
    await later.click()
    await later.waitFor({ state: 'detached', timeout: 20_000 })
  } catch {
    // A configured keyless demo provider skips the credential-onboarding step.
  }
}

async function openWorkspaceSession(page, workspaceLabel) {
  const workspace = page.getByRole('treeitem', { name: workspaceLabel, exact: true })
  await workspace.waitFor({ timeout: 20_000 })
  if (await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click()
  const session = page.locator('[role="treeitem"][aria-selected="false"]').filter({ hasText: workspaceLabel })
  if (await session.count() > 0) await session.first().click()
  await page.getByRole('tab', { name: /^(Chat|对话)$/u, exact: true }).waitFor({ timeout: 20_000 })
}

async function installDemoOverlay(page) {
  await page.addStyleTag({ content: `
    html { scroll-behavior: smooth !important; }
    [data-dsh-explain-demo-focus="true"] {
      outline: 3px solid #4f9cff !important;
      outline-offset: 5px !important;
      box-shadow: 0 0 0 9px rgba(79, 156, 255, .18), 0 0 28px rgba(79, 156, 255, .35) !important;
      border-radius: 10px !important;
    }
    #dsh-explain-demo-caption {
      position: fixed;
      z-index: 2147483647;
      left: 50%;
      bottom: 28px;
      transform: translateX(-50%);
      max-width: 920px;
      padding: 13px 22px;
      border: 1px solid rgba(106, 169, 255, .42);
      border-radius: 999px;
      background: rgba(8, 15, 29, .88);
      box-shadow: 0 12px 42px rgba(0, 0, 0, .42);
      color: #f5f9ff;
      font: 600 18px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: -.01em;
      text-align: center;
      backdrop-filter: blur(14px);
      pointer-events: none;
    }
  ` })
  await page.evaluate(() => {
    const caption = document.createElement('div')
    caption.id = 'dsh-explain-demo-caption'
    document.body.append(caption)
  })
}

async function setCaption(page, text) {
  await page.evaluate((value) => {
    const caption = document.getElementById('dsh-explain-demo-caption')
    if (caption !== null) caption.textContent = value
  }, text)
}

async function spotlight(locator, duration = 900) {
  await locator.scrollIntoViewIfNeeded()
  await locator.evaluate(node => { node.setAttribute('data-dsh-explain-demo-focus', 'true') })
  await new Promise(resolve => { setTimeout(resolve, duration) })
}

async function clearSpotlight(locator) {
  await locator.evaluate(node => { node.removeAttribute('data-dsh-explain-demo-focus') })
}

async function evidenceScreenshot(page, filename) {
  await page.evaluate(() => {
    const caption = document.getElementById('dsh-explain-demo-caption')
    if (caption !== null) caption.style.visibility = 'hidden'
  })
  await page.screenshot({ path: join(ASSETS, filename), animations: 'disabled' })
  await page.evaluate(() => {
    const caption = document.getElementById('dsh-explain-demo-caption')
    if (caption !== null) caption.style.visibility = 'visible'
  })
}

function transcode(rawVideo) {
  const mp4 = join(ASSETS, 'dsh-explain-demo.mp4')
  const gif = join(ASSETS, 'dsh-explain-demo.gif')
  execFileSync('ffmpeg', [
    '-y', '-ss', '1.0', '-i', rawVideo,
    '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4,
  ], { stdio: 'pipe' })
  execFileSync('ffmpeg', [
    '-y', '-i', mp4,
    '-filter_complex',
    '[0:v]fps=8,scale=960:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
    '-loop', '0', gif,
  ], { stdio: 'pipe' })
}

async function main() {
  const dshSource = requireDshSource()
  const root = await mkdtemp(join(tmpdir(), 'dsh-explain-demo-'))
  const dshHome = join(root, 'home')
  const workspace = join(root, 'project')
  const sessionFixture = join(root, 'demo-session.jsonl')
  const replayFixture = join(root, 'demo-replay.jsonl')
  const rawDirectory = join(root, 'video')
  let host
  let browser
  try {
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(rawDirectory, { recursive: true }),
      mkdir(ASSETS, { recursive: true }),
    ])
    await writeFile(sessionFixture, demoSessionFixture(workspace))
    await writeFile(replayFixture, `${JSON.stringify({
      type: 'session', version: 0, id: 'demo-replay-fixture', createdAt: DEMO_NOW, cwd: workspace,
    })}\n`)
    runDsh(dshSource, dshHome, ['plugin', '--profile', 'web', 'add', REPOSITORY])
    await writeFile(join(dshHome, 'profiles/web/cordis.patch.yml'), [
      '- id: directory-picker',
      '  disabled: true',
      '',
      '- id: explain',
      '  config:',
      '    enabled: true',
      '    provider: demo-replay',
      '    model: demo',
      '    maxAutoRequestsPerDay: 24',
      '',
      '- insert:',
      '    - id: directory-picker-browse',
      "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
      '    - id: llm-replay',
      "      name: '@deepseek-ai/dsh-llm-replay'",
      '      config:',
      `        file: ${JSON.stringify(replayFixture)}`,
      '        providers:',
      '          - id: demo-replay',
      '            name: Demo Replay',
      '            models:',
      '              - id: demo',
      '                name: Demo',
      '                contextWindow: 128000',
      '',
    ].join('\n'))
    await seedDshSession(dshSource, dshHome, workspace, sessionFixture)
    await seedLearningDatabase(dshHome)

    const port = await freePort()
    const started = await startDsh(dshSource, dshHome, port)
    host = started.child
    browser = await chromium.launch()

    const setupContext = await browser.newContext({ viewport: VIEWPORT, locale: 'en-US', colorScheme: 'dark' })
    const setupPage = await setupContext.newPage()
    await setupPage.goto(started.authenticatedUrl, { waitUntil: 'load' })
    await finishOnboarding(setupPage)
    await openWorkspaceSession(setupPage, basename(workspace))
    const storageState = await setupContext.storageState()
    await setupContext.close()

    const recordingContext = await browser.newContext({
      viewport: VIEWPORT,
      locale: 'en-US',
      colorScheme: 'dark',
      storageState,
      recordVideo: { dir: rawDirectory, size: VIEWPORT },
    })
    const page = await recordingContext.newPage()
    const baseUrl = new URL(started.authenticatedUrl).origin
    await page.goto(baseUrl, { waitUntil: 'load' })
    await openWorkspaceSession(page, basename(workspace))
    await installDemoOverlay(page)
    await setCaption(page, 'Capture a useful answer without leaving the work flow.')
    await new Promise(resolve => { setTimeout(resolve, 1_800) })

    const answerAction = page.getByRole('button', { name: 'Learn from this answer', exact: true })
    await answerAction.waitFor({ timeout: 20_000 })
    await spotlight(answerAction)
    await answerAction.click()
    await clearSpotlight(answerAction)
    await page.mouse.move(1_050, 110)
    const composer = page.locator('[contenteditable="true"][role="textbox"]').first()
    await composer.waitFor({ timeout: 20_000 })
    await page.waitForFunction(() => document.body.textContent?.includes('/explain --answer 1') === true)
    await setCaption(page, 'Explain creates an editable draft—and never submits it automatically.')
    await spotlight(composer, 700)
    await evidenceScreenshot(page, 'demo-capture.png')
    await new Promise(resolve => { setTimeout(resolve, 2_200) })
    await clearSpotlight(composer)
    await composer.click()
    await composer.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await composer.press('Backspace')

    const learningTab = page.getByRole('tab', { name: 'Learning', exact: true })
    await setCaption(page, 'Everything lands in one private learning thread.')
    await spotlight(learningTab, 650)
    await learningTab.click()
    await clearSpotlight(learningTab)
    const view = page.getByTestId('dsh-explain-learning-view')
    await view.getByRole('heading', { name: 'Global learning thread', exact: true }).waitFor({ timeout: 20_000 })
    await view.getByText('Loading learning records…', { exact: true })
      .waitFor({ state: 'detached', timeout: 20_000 })
    const learningText = await view.innerText()
    if (!learningText.includes('Running normally and waiting for an eligible turn')) {
      throw new Error(`demo learning runtime is not ready:\n${learningText.slice(0, 2_000)}`)
    }
    await evidenceScreenshot(page, 'demo-learning.png')
    await new Promise(resolve => { setTimeout(resolve, 2_600) })

    const review = view.getByRole('heading', { name: "Today's review", exact: true })
    await setCaption(page, 'Mastered concepts return as scheduled recall and application questions.')
    await spotlight(review, 700)
    await new Promise(resolve => { setTimeout(resolve, 2_200) })
    await clearSpotlight(review)

    const activeCard = view.locator('article').filter({ hasText: 'Narrow unions safely with a discriminant' })
    await setCaption(page, 'Each card explains what it is, why it matters, and the common pitfall.')
    await spotlight(activeCard, 800)
    await new Promise(resolve => { setTimeout(resolve, 2_400) })
    const understood = activeCard.getByRole('button', { name: '✓ Got it', exact: true })
    await spotlight(understood, 550)
    await understood.click()
    await view.getByText('No explanation for the current session', { exact: true }).waitFor({ timeout: 20_000 })
    await new Promise(resolve => { setTimeout(resolve, 1_200) })

    const examples = view.locator('.dsh-explain-profile-row').filter({ hasText: 'Examples' })
    await setCaption(page, 'Every inference stays inspectable, sourced, and correctable.')
    await spotlight(examples, 750)
    const correct = examples.getByRole('button', { name: 'Correct', exact: true })
    await correct.click()
    const preference = examples.getByRole('textbox', { name: 'Examples', exact: true })
    await preference.fill('Use two contrasting examples, then summarize the difference.')
    await new Promise(resolve => { setTimeout(resolve, 1_100) })
    await examples.getByRole('button', { name: 'Save settings', exact: true }).click()
    await examples.getByText('User correction', { exact: true }).waitFor({ timeout: 20_000 })
    await page.mouse.move(900, 430)
    await page.mouse.wheel(0, -460)
    await new Promise(resolve => { setTimeout(resolve, 600) })
    await evidenceScreenshot(page, 'demo-profile.png')
    await new Promise(resolve => { setTimeout(resolve, 2_600) })
    await clearSpotlight(examples)

    await setCaption(page, 'Learning data stays local—and remains yours to export.')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settingsDialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settingsDialog.waitFor({ timeout: 20_000 })
    await settingsDialog.getByRole('button', { name: 'Learning', exact: true }).click()
    const data = page.getByTestId('dsh-explain-settings-section')
    const dataHeading = data.getByRole('heading', { name: 'Data management', exact: true })
    await spotlight(dataHeading, 700)
    await evidenceScreenshot(page, 'demo-data.png')
    const downloadReady = page.waitForEvent('download')
    await data.getByRole('button', { name: 'Export JSON', exact: true }).click()
    await downloadReady
    await data.getByText('Downloaded dsh-explain-backup-v3.json.', { exact: true }).waitFor({ timeout: 20_000 })
    await new Promise(resolve => { setTimeout(resolve, 2_300) })
    await clearSpotlight(dataHeading)

    await settingsDialog.getByRole('button', { name: 'Close', exact: true }).click()
    await setCaption(page, 'Work once. Learn continuously.')
    await learningTab.click()
    await view.getByRole('heading', { name: 'Global learning thread', exact: true }).waitFor({ timeout: 20_000 })
    await new Promise(resolve => { setTimeout(resolve, 2_800) })

    const video = page.video()
    await recordingContext.close()
    if (video === null) throw new Error('Playwright produced no demo video')
    const rawVideo = await video.path()
    await copyFile(rawVideo, join(root, 'dsh-explain-demo.webm'))
    transcode(join(root, 'dsh-explain-demo.webm'))
  } finally {
    await browser?.close().catch(() => {})
    await stopDsh(host).catch(() => {})
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

await main()
