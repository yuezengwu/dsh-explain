import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SourceCapsule } from './domain.ts'

/** Scheduler-owned autonomous target with retry and replacement identity. */
export interface ExplainCandidate {
  readonly capsule: SourceCapsule
  readonly sequence: number
  readonly attempts: number
}

/** Per-source latest-wins queue with a global oldest-first cap. */
export class CandidateQueue {
  private readonly pending = new Map<SessionId, ExplainCandidate>()
  private readonly latestSequence = new Map<SessionId, number>()
  private nextSequence = 1

  /** Number of pending source candidates. */
  get size(): number { return this.pending.size }

  /** Whether at least one pending source is not blocked by an active explanation. */
  hasExecutable(blockedSources: ReadonlySet<SessionId>): boolean {
    return [...this.pending.keys()].some(sourceSessionId => !blockedSources.has(sourceSessionId))
  }

  /** Replace one source's pending turn and evict the globally oldest source at capacity. */
  push(capsule: SourceCapsule, limit: number): ExplainCandidate | undefined {
    const sequence = this.nextSequence++
    const candidate = { capsule, sequence, attempts: 0 }
    this.latestSequence.set(capsule.sourceSessionId, sequence)
    this.pending.set(capsule.sourceSessionId, candidate)
    if (this.pending.size <= limit) return undefined
    const oldest = [...this.pending.values()].sort(compareCandidates)[0]
    if (oldest === undefined) return undefined
    this.pending.delete(oldest.capsule.sourceSessionId)
    return oldest
  }

  /** Remove the earliest candidate whose source is currently executable. */
  take(blockedSources: ReadonlySet<SessionId>): ExplainCandidate | undefined {
    const candidate = [...this.pending.values()]
      .filter(item => !blockedSources.has(item.capsule.sourceSessionId))
      .sort(compareCandidates)[0]
    if (candidate === undefined) return undefined
    this.pending.delete(candidate.capsule.sourceSessionId)
    return candidate
  }

  /** Requeue a failed target only when no newer turn replaced it. */
  retry(candidate: ExplainCandidate): void {
    if (!this.isLatest(candidate)) return
    this.pending.set(candidate.capsule.sourceSessionId, { ...candidate, attempts: candidate.attempts + 1 })
  }

  /** Return a target to the queue without consuming an attempt. */
  defer(candidate: ExplainCandidate): void {
    if (!this.isLatest(candidate)) return
    this.pending.set(candidate.capsule.sourceSessionId, candidate)
  }

  /** Whether no newer candidate was observed for this source. */
  isLatest(candidate: ExplainCandidate): boolean {
    return this.latestSequence.get(candidate.capsule.sourceSessionId) === candidate.sequence
  }

  /** Evict globally oldest candidates until the live configurable cap is met. */
  trim(limit: number): readonly ExplainCandidate[] {
    const evicted: ExplainCandidate[] = []
    while (this.pending.size > limit) {
      const oldest = [...this.pending.values()].sort(compareCandidates)[0]
      if (oldest === undefined) break
      this.pending.delete(oldest.capsule.sourceSessionId)
      evicted.push(oldest)
    }
    return evicted
  }

  /** Forget every candidate and invalidate any in-flight target removed from the map. */
  clear(): void {
    this.pending.clear()
    this.latestSequence.clear()
  }
}

function compareCandidates(left: ExplainCandidate, right: ExplainCandidate): number {
  return left.capsule.observedAt - right.capsule.observedAt || left.sequence - right.sequence
}
