/** Filter recognizable local paths and credential formats; arbitrary private prose remains possible. */
export function redactSensitiveText(text: string): string {
  return text
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{16,}|github_pat_[a-zA-Z0-9_]{16,}|xox[baprs]-[a-zA-Z0-9-]{10,})\b/gu, '[redacted credential]')
    .replace(/\b((?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD))([\t ]*[:=][\t ]*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/giu, '$1$2[redacted credential]')
    .replace(/\bBearer[\t ]+[a-zA-Z0-9._~+\/-]{8,}/giu, 'Bearer [redacted credential]')
    .replace(/(?<![\w:/])(?:[a-zA-Z]:[\\/]|\\\\)[^\s<>"'`|]+/gu, '[redacted path]')
    .replace(/(?<![\w:/])\/(?:Users|home|private|tmp|var|etc|opt|usr|Volumes|mnt|srv|root)(?:\/[^\s<>"'`|,;)]*)?/gu, '[redacted path]')
}

/** Apply text filtering to JSON-compatible learning data without changing its keys or numeric values. */
export function redactLearningData<T>(value: T): T {
  if (typeof value === 'string') return redactSensitiveText(value) as T
  if (Array.isArray(value)) return value.map(item => redactLearningData(item)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactLearningData(item)])) as T
  }
  return value
}
