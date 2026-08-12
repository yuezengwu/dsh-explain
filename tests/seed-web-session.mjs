import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

function required(name) {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is required`)
  return value
}

const dshSource = required('DSH_SOURCE_DIR')
const fixturePath = required('DSH_WEB_FIXTURE')
const sessionIdText = required('DSH_WEB_SESSION_ID')
const workspace = required('DSH_WEB_WORKSPACE')
const persistenceRoot = join(required('DSH_HOME'), 'sessions')
const resolveFrom = (owner, name) => createRequire(join(dshSource, owner, 'package.json')).resolve(name)
const load = async (owner, name) => import(pathToFileURL(resolveFrom(owner, name)).href)
const [{ Context }, sessionModule, persistenceModule, replayModule] = await Promise.all([
  load('apps/cli', '@deepseek-ai/cordis'),
  load('packages/core/session', '@deepseek-ai/dsh-session'),
  load('packages/session/session-persistence-jsonl', '@deepseek-ai/dsh-session-persistence-jsonl'),
  load('packages/support/llm-replay', '@deepseek-ai/dsh-llm-replay'),
])

const fixture = (await readFile(fixturePath, 'utf8'))
  .split('{{sessionId}}').join(sessionIdText)
  .split('{{cwd}}/workspace').join(workspace)
  .split('{{rpcId}}').join('web-snapshot-rpc')
const events = replayModule.parseSessionLog(fixture)
const sessionId = sessionModule.SessionId(sessionIdText)
const context = new Context()
try {
  await context.plugin(sessionModule.default)
  await context.plugin(persistenceModule.default, { root: persistenceRoot })
  const meta = {
    version: sessionModule.SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: Date.UTC(2026, 0, 2, 3, 4, 0),
    cwd: workspace,
    delegationDepth: 0,
  }
  await context.sessionPersistence.create(meta)
  await context.sessionPersistence.append(sessionId, events)
} finally {
  await context.fiber.dispose()
}
