import type { AssistantMessage } from '@deepseek-ai/dsh-llm'

/** Synthetic settled message accepted by both DSH v1 and v2 Session formats. */
export function settledAssistant<T extends { turn: number; step: number; message: AssistantMessage }>(data: T): T & { stream: never[] } {
  return { ...data, stream: [] }
}
