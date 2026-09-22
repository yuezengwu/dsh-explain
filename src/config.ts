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

/** Settings-backed fields that may change while the host is running. */
export type ExplainRuntimeSettings = Pick<ResolvedExplainConfig,
  | 'enabled'
  | 'maxPendingCandidates'
  | 'maxSourceChars'
  | 'maxAutoRequestsPerDay'
  | 'maxTopicHints'
  | 'idleCompactMs'
  | 'contextThresholdRatio'
  | 'timeoutMs'
  | 'maxOutputTokens'
  | 'maxCompactionOutputTokens'
  | 'maxAttempts'
> & { readonly provider?: string; readonly model?: string }

/** Loader schema with every deployment tunable defined in architecture v6. */
const PlainConfig = z.object({
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

/** User-settings section; storage paths remain immutable composition fields. */
export const RuntimeSettings = z.object({
  enabled: z.boolean().default(false),
  provider: z.string(),
  model: z.string(),
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

/** Loader values are plain on older hosts and live references on DSH 0.1.7+. */
export type ExplainPluginConfig = {
  readonly [K in keyof ExplainConfig]: ExplainConfig[K] | { readonly get: () => ExplainConfig[K] }
}

/** Mark runtime fields live when the host supports volatile configuration. */
export const Config = z.object(Object.fromEntries(
  Object.entries(PlainConfig.dict!).map(([key, field]) => {
    const schema = field as z & { volatile?: () => z }
    return [key, key !== 'dshHome' && key !== 'storageDir' && typeof schema.volatile === 'function'
      ? schema.volatile() : schema]
  }),
)) as z<ExplainPluginConfig>

/** Capture one consistent set of plain loader values without retaining live refs. */
export function readExplainConfig(config: ExplainPluginConfig): ExplainConfig {
  return Object.fromEntries(Object.entries(config).map(([key, value]) => [
    key, typeof value === 'object' && value !== null && 'get' in value ? value.get() : value,
  ]))
}

/** Project one resolved loader config into the settings-owned live subset. */
export function runtimeSettings(config: ResolvedExplainConfig): ExplainRuntimeSettings {
  return {
    enabled: config.enabled,
    ...(config.provider === undefined ? {} : { provider: config.provider }),
    ...(config.model === undefined ? {} : { model: config.model }),
    maxPendingCandidates: config.maxPendingCandidates,
    maxSourceChars: config.maxSourceChars,
    maxAutoRequestsPerDay: config.maxAutoRequestsPerDay,
    maxTopicHints: config.maxTopicHints,
    idleCompactMs: config.idleCompactMs,
    contextThresholdRatio: config.contextThresholdRatio,
    timeoutMs: config.timeoutMs,
    maxOutputTokens: config.maxOutputTokens,
    maxCompactionOutputTokens: config.maxCompactionOutputTokens,
    maxAttempts: config.maxAttempts,
  }
}

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
  const config = PlainConfig(input)
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
