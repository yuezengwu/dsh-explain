/** Client Session navigation and slot targets across the supported DSH releases. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { commitExplainDraft, type ExplainDraftResult } from './ExplainShortcuts.tsx'

/** Older slots pass an id; 0.1.6-alpha.2 passes an owned Session reference. */
export type ExplainSessionTarget = SessionId | { readonly binding: { readonly ctx: Context } }

/** Draft into the slot's live Session generation without retaining another one. */
export function draftForSession(ctx: Context, target: ExplainSessionTarget, command: string): ExplainDraftResult {
  try {
    const scope = typeof target === 'string' ? ctx.sessions.scope(target) : target.binding.ctx
    return commitExplainDraft(scope === undefined ? undefined : ctx.conversation.input.for(scope), command)
  } catch {
    // A released reference or disposed input cannot receive a delayed click.
    return { ok: false, reason: 'unavailable' }
  }
}

/** Navigate through the host's view owner; older releases own navigation on sessions. */
export function openLearningSource(ctx: Context, sessionId: SessionId): void {
  const sessions = ctx.sessions as typeof ctx.sessions & { open?: (id: SessionId) => void }
  if (typeof sessions.open === 'function') {
    sessions.open(sessionId)
    return
  }
  // uiWorkspace is supplied by the assembled Web host in 0.1.6-alpha.2.
  const workspace = ctx.get('uiWorkspace') as { openSession(id: SessionId): void } | undefined
  if (workspace === undefined) throw new Error('dsh-explain: source navigation is unavailable')
  workspace.openSession(sessionId)
}
