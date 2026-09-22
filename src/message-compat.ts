import * as llm from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'

/** Build an auxiliary system message across the legacy and V4 message APIs. */
export function auxiliarySystemMessage(text: string): Message {
  const host = llm as typeof llm & {
    createSystemMessage?: (text: string, plugin: string) => Message
    createMessage(input: { role: 'system'; source: { kind: 'plugin'; plugin: string }; content: { type: 'text'; text: string }[] }): Message
  }
  if (host.createSystemMessage !== undefined) return host.createSystemMessage(text, 'dsh-explain')
  // Early hosts expose only createMessage and accept plugin-attributed system
  // messages. The V4 path above always uses the host's stricter system source.
  return host.createMessage({
    role: 'system',
    source: { kind: 'plugin', plugin: 'dsh-explain' },
    content: [{ type: 'text', text }],
  })
}
