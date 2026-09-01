export type {
  ObservableSnapshot,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-store'
export type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
export type { SessionId } from '@deepseek-ai/dsh-session'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Minimal synchronous snapshot store for client component tests. */
export function createSnapshotStore<T>(initial: T): SnapshotStore<T> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    update: (mutator) => {
      const next = structuredClone(snapshot)
      mutator(next)
      snapshot = next
      notify()
    },
    set: (next) => {
      snapshot = next
      notify()
    },
  }
}
