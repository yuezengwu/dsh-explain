import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'

/** Loader and settings configuration owned by dsh-explain. */
export interface ExplainConfig {
  readonly enabled?: boolean
  readonly provider?: string
  readonly model?: string
  readonly dshHome?: string
  readonly storageDir?: string
  readonly maxPendingCandidates?: number
  readonly maxSourceChars?: number
  readonly maxAutoRequestsPerDay?: number
  readonly maxTopicHints?: number
  readonly idleCompactMs?: number
  readonly contextThresholdRatio?: number
  readonly timeoutMs?: number
  readonly maxOutputTokens?: number
  readonly maxCompactionOutputTokens?: number
  readonly maxAttempts?: number
}

/** Runtime configuration with an absolute SQLite path. */
export interface ResolvedExplainConfig extends Required<Omit<ExplainConfig, 'provider' | 'model'>> {
  readonly provider?: string
  readonly model?: string
  readonly databasePath: string
}

/** Loader schema with every deployment tunable defined in architecture v6. */
export const Config = z.object({
  enabled: z.boolean().default(false),
  provider: z.string(),
  model: z.string(),
  dshHome: z.string(),
  storageDir: z.string(),
  maxPendingCandidates: z.number().step(1).min(1).default(8),
  maxSourceChars: z.number().step(1).min(1).default(24_000),
  maxAutoRequestsPerDay: z.number().step(1).min(1).default(50),
  maxTopicHints: z.number().step(1).min(1).default(100),
  idleCompactMs: z.number().step(1).min(1).default(1_800_000),
  contextThresholdRatio: z.number().min(0.01).max(0.99).default(0.5),
  timeoutMs: z.number().step(1).min(1).default(30_000),
  maxOutputTokens: z.number().step(1).min(1).default(1_200),
  maxCompactionOutputTokens: z.number().step(1).min(1).default(1_600),
  maxAttempts: z.number().step(1).min(1).default(2),
})

const CONFIG_KEYS = new Set([
  'enabled', 'provider', 'model', 'dshHome', 'storageDir', 'maxPendingCandidates', 'maxSourceChars',
  'maxAutoRequestsPerDay', 'maxTopicHints', 'idleCompactMs', 'contextThresholdRatio', 'timeoutMs',
  'maxOutputTokens', 'maxCompactionOutputTokens', 'maxAttempts',
])

/** Validate Loader input and resolve its one immutable database path. */
export function resolveExplainConfig(input: ExplainConfig): ResolvedExplainConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('dsh-explain: configuration must be a plain object')
  }
  for (const key of Object.keys(input)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`dsh-explain: unknown config key "${key}"`)
  }
  const config = Config(input)
  const dshHome = config.dshHome?.trim() || process.env.DSH_HOME || resolve(homedir(), '.dsh')
  const storageDir = config.storageDir?.trim()
  const provider = config.provider?.trim()
  const model = config.model?.trim()
  const directory = storageDir === undefined || storageDir === ''
    ? resolve(dshHome, 'dsh-explain', 'v1')
    : isAbsolute(storageDir) ? storageDir : resolve(dshHome, storageDir)
  const { provider: _provider, model: _model, ...base } = config
  return {
    ...base,
    ...(provider === undefined || provider === '' ? {} : { provider }),
    ...(model === undefined || model === '' ? {} : { model }),
    dshHome,
    storageDir: directory,
    databasePath: resolve(directory, 'thread.sqlite'),
  }
}
