import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  createSnapshotStore,
  type SessionId,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ExplainContextView,
  ExplainStatusView,
  ThreadEntryView,
} from 'dsh-explain/types'
import type { RequestId } from 'dsh-explain/types'
import type {} from 'dsh-explain/remote'

const PAGE_SIZE = 30
const RETRY_MS = 1_000

/** Browser-wide projection of the one global learning thread. */
export interface LearningSnapshot {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly status: ExplainStatusView | undefined
  readonly context: ExplainContextView | undefined
  readonly entries: readonly ThreadEntryView[]
  readonly hasMore: boolean
  readonly pendingEntryIds: readonly string[]
  readonly error: string | undefined
}

const INITIAL: LearningSnapshot = {
  phase: 'loading',
  status: undefined,
  context: undefined,
  entries: [],
  hasMore: false,
  pendingEntryIds: [],
  error: undefined,
}

/** One Remote-backed store shared by every Session-scoped learning view. */
export class GlobalLearningStore {
  readonly store: SnapshotStore<LearningSnapshot> = createSnapshotStore(INITIAL)
  private watchController?: AbortController
  private disposed = false
  private mounts = 0
  private watching = false
  private watchGeneration = 0
  private readonly pendingEntries = new Set<string>()
  private refreshing: Promise<void> | undefined

  /** Bind this store to the Host snapshot and long-poll stream. */
  constructor(private readonly ctx: Context) {}

  /** Activate reads while at least one Session-scoped learning view is mounted. */
  mount(): () => void {
    if (this.disposed) throw new Error('dsh-explain: learning store is disposed')
    this.mounts += 1
    if (this.mounts === 1) {
      this.watching = true
      const generation = ++this.watchGeneration
      void this.startWatch(generation)
    }
    let active = true
    return () => {
      if (!active) return
      active = false
      this.mounts -= 1
      if (this.mounts === 0) {
        this.watching = false
        this.watchGeneration += 1
        this.watchController?.abort()
      }
    }
  }

  /** Abort the active long poll; the store owns no other browser resource. */
  dispose(): void {
    this.disposed = true
    this.watching = false
    this.watchGeneration += 1
    this.watchController?.abort()
  }

  /** Re-read every page currently materialized in the browser. */
  refresh(): Promise<void> {
    if (this.refreshing !== undefined) return this.refreshing
    const task = this.refreshNow().finally(() => {
      if (this.refreshing === task) this.refreshing = undefined
    })
    this.refreshing = task
    return task
  }

  /** Append one older immutable page. */
  async loadOlder(): Promise<void> {
    const snapshot = this.store.getSnapshot()
    if (!snapshot.hasMore || snapshot.entries.length === 0) return
    try {
      const oldest = snapshot.entries.at(-1)!
      const page = unwrapRemote(await this.ctx.remote.explain.threadPage({
        beforeOrdinal: oldest.ordinal,
        limit: PAGE_SIZE,
      }))
      const current = this.store.getSnapshot()
      const seen = new Set(current.entries.map(entry => entry.entryId))
      const appended = page.entries.filter(entry => !seen.has(entry.entryId))
      this.store.set({
        ...current,
        phase: 'ready',
        entries: [...current.entries, ...appended].sort((left, right) => right.ordinal - left.ordinal),
        hasMore: page.hasMore,
        error: undefined,
      })
    } catch (error) {
      this.fail(error)
    }
  }

  /** Submit feedback against the exact active Explanation revision rendered by the view. */
  async feedback(entry: ThreadEntryView, action: 'understood' | 'not-understood'): Promise<void> {
    if (entry.explanationId === undefined || entry.sourceSessionId === undefined || entry.revision === undefined) return
    const explanationId = entry.explanationId
    const sourceSessionId = entry.sourceSessionId
    const revision = entry.revision
    await this.mutate(entry.entryId, async () => unwrapRemote(await this.ctx.remote.explain.feedback({
      requestId: requestId(),
      sourceSessionId: sourceSessionId as SessionId,
      explanationId,
      revision,
      action,
    })))
  }

  /** Reopen the exact mastered Topic revision rendered by the view. */
  async reopen(entry: ThreadEntryView): Promise<void> {
    await this.mutate(entry.entryId, async () => unwrapRemote(await this.ctx.remote.explain.reopenTopic({
      requestId: requestId(),
      topicId: entry.topicId,
      expectedTopicRevision: entry.topicRevision,
    })))
  }

  private async refreshNow(): Promise<void> {
    try {
      const desired = Math.max(PAGE_SIZE, this.store.getSnapshot().entries.length)
      const [statusResult, contextResult, initialPages] = await Promise.all([
        this.ctx.remote.explain.status(),
        this.ctx.remote.explain.context(),
        this.readPages(desired),
      ])
      const status = unwrapRemote(statusResult)
      const context = unwrapRemote(contextResult)
      let pages = initialPages
      while (pages.hasMore && pages.entries.length < this.store.getSnapshot().entries.length) {
        pages = await this.readPages(this.store.getSnapshot().entries.length)
      }
      this.store.set({
        phase: 'ready',
        status,
        context,
        entries: pages.entries,
        hasMore: pages.hasMore,
        pendingEntryIds: [...this.pendingEntries],
        error: undefined,
      })
    } catch (error) {
      this.fail(error)
    }
  }

  private async readPages(minimum: number): Promise<{
    readonly entries: readonly ThreadEntryView[]
    readonly hasMore: boolean
  }> {
    const entries: ThreadEntryView[] = []
    let beforeOrdinal: number | undefined
    let hasMore = false
    do {
      const page = unwrapRemote(await this.ctx.remote.explain.threadPage({
        ...(beforeOrdinal === undefined ? {} : { beforeOrdinal }),
        limit: Math.min(100, Math.max(PAGE_SIZE, minimum - entries.length)),
      }))
      entries.push(...page.entries)
      hasMore = page.hasMore
      beforeOrdinal = entries.at(-1)?.ordinal
    } while (hasMore && entries.length < minimum && beforeOrdinal !== undefined)
    return { entries, hasMore }
  }

  private async mutate(
    entryId: string,
    invoke: () => Promise<{ readonly ok: boolean; readonly error?: { readonly message: string } }>,
  ): Promise<void> {
    const before = this.store.getSnapshot()
    this.pendingEntries.add(entryId)
    this.store.set({ ...before, pendingEntryIds: [...this.pendingEntries], error: undefined })
    try {
      const result = await invoke()
      if (!result.ok) throw new Error(result.error?.message ?? 'Explain mutation was rejected.')
      await this.refresh()
    } catch (error) {
      this.fail(error)
    } finally {
      this.pendingEntries.delete(entryId)
      const current = this.store.getSnapshot()
      this.store.set({ ...current, pendingEntryIds: [...this.pendingEntries] })
    }
  }

  private async watchLoop(generation: number): Promise<void> {
    while (this.isWatching(generation)) {
      const cursor = this.store.getSnapshot().status?.cursor
      if (cursor === undefined) {
        await delay(RETRY_MS)
        if (this.isWatching(generation)) await this.refresh()
        continue
      }
      const controller = new AbortController()
      this.watchController = controller
      try {
        const result = unwrapRemote(await this.ctx.remote.explain.watch({ after: cursor }, controller.signal))
        if (result.changed) {
          await this.refresh()
          if (this.store.getSnapshot().phase === 'error') await delay(RETRY_MS)
        }
      } catch (error) {
        if (controller.signal.aborted || !this.isWatching(generation)) return
        this.fail(error)
        await delay(RETRY_MS)
        if (this.isWatching(generation)) await this.refresh()
      }
    }
  }

  private async startWatch(generation: number): Promise<void> {
    await this.refresh()
    if (this.isWatching(generation)) await this.watchLoop(generation)
  }

  private isWatching(generation: number): boolean {
    return !this.disposed && this.watching && this.watchGeneration === generation
  }

  private fail(error: unknown): void {
    const snapshot = this.store.getSnapshot()
    this.store.set({
      ...snapshot,
      phase: 'error',
      error: error instanceof Error ? error.message : 'Learning data is unavailable.',
    })
  }
}

function requestId(): RequestId {
  return `browser:${crypto.randomUUID()}` as RequestId
}

function unwrapRemote<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise(resolve => { setTimeout(resolve, milliseconds) })
}
