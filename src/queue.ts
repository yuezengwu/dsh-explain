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
  private limit = 0

  /** Number of pending source candidates. */
  get size(): number { return this.pending.size }

  /** Number of source identities retained for latest-wins checks. */
  get retainedSourceCount(): number { return this.latestSequence.size }

  /** Whether at least one pending source is not blocked by an active explanation. */
  hasExecutable(blockedSources: ReadonlySet<SessionId>): boolean {
    return [...this.pending.keys()].some(sourceSessionId => !blockedSources.has(sourceSessionId))
  }

  /** Replace a pending turn, enforce the live cap, and return the first evicted target. */
  push(capsule: SourceCapsule, limit: number): ExplainCandidate | undefined {
    const sequence = this.nextSequence++
    const candidate = { capsule, sequence, attempts: 0 }
    this.latestSequence.set(capsule.sourceSessionId, sequence)
    this.pending.set(capsule.sourceSessionId, candidate)
    return this.trim(limit)[0]
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

  /** Requeue a still-current failed target within the live capacity. */
  retry(candidate: ExplainCandidate): void {
    if (!this.isLatest(candidate)) return
    this.pending.set(candidate.capsule.sourceSessionId, { ...candidate, attempts: candidate.attempts + 1 })
    this.trim(this.limit)
  }

  /** Return a still-current target within capacity without consuming an attempt. */
  defer(candidate: ExplainCandidate): void {
    if (!this.isLatest(candidate)) return
    this.pending.set(candidate.capsule.sourceSessionId, candidate)
    this.trim(this.limit)
  }

  /** Whether no newer candidate was observed for this source. */
  isLatest(candidate: ExplainCandidate): boolean {
    return this.latestSequence.get(candidate.capsule.sourceSessionId) === candidate.sequence
  }

  /** Release a finished attempt, preserving queued retries and replacements. */
  finish(candidate: ExplainCandidate): void {
    const source = candidate.capsule.sourceSessionId
    if (!this.pending.has(source) && this.isLatest(candidate)) this.latestSequence.delete(source)
  }

  /** Evict globally oldest candidates until the live configurable cap is met. */
  trim(limit: number): readonly ExplainCandidate[] {
    this.limit = limit
    const evicted: ExplainCandidate[] = []
    while (this.pending.size > limit) {
      const oldest = [...this.pending.values()].sort(compareCandidates)[0]
      if (oldest === undefined) break
      this.pending.delete(oldest.capsule.sourceSessionId)
      this.finish(oldest)
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
