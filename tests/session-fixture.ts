import { createMessage, type AssistantMessage, type Message } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, type Session } from '@deepseek-ai/dsh-session'

/** Synthetic settled message accepted by DSH v1, v2 and v3 Session formats. */
export function settledAssistant<T extends { turn: number; step: number; message: AssistantMessage }>(data: T): T & { stream: never[] } {
  return { ...data, stream: [] }
}

/** Include private system context only on hosts that put system prompts in history. */
export function appendSystemContext(session: Session, text: string): void {
  if (SESSION_FORMAT_VERSION < 3) return
  // Older supported Session declarations do not expose the v3 event. The
  // version gate keeps this fixture on the host's real, validating append path.
  const append = session.append as unknown as (
    type: 'system/message',
    data: { turn: number; step: number; message: Message },
    intent: { surfaceOp: 'append' },
  ) => void
  append.call(session, 'system/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'system',
      source: { kind: 'plugin', plugin: 'test-system-context' },
      content: [{ type: 'text', text }],
    }),
  }, { surfaceOp: 'append' })
}
