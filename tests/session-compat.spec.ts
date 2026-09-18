import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { draftForSession } from '../src/client/session-compat.ts'
import { GlobalLearningStore } from '../src/client/learning-store.ts'
import { createSnapshotStore } from './client-runtime-stub.ts'

describe('client Session compatibility', () => {
  it('drafts into the reference generation and refuses a click after release', () => {
    const scope = {} as Context
    const state = createSnapshotStore({ phase: 'plain', draft: '' })
    const input = { state, setDraft: (draft: string) => state.set({ phase: 'plain', draft }) }
    const resolveInput = vi.fn(() => input)
    const legacyScope = vi.fn()
    const ctx = { sessions: { scope: legacyScope }, conversation: { input: { for: resolveInput } } } as unknown as Context
    let released = false
    const reference = {
      get binding() {
        if (released) throw new Error('released Session reference')
        return { ctx: scope }
      },
    }
    expect(draftForSession(ctx, reference, '/explain --answer 1 explain')).toEqual({ ok: true })
    expect(resolveInput).toHaveBeenCalledWith(scope)
    expect(legacyScope).not.toHaveBeenCalled()
    released = true
    state.set({ phase: 'plain', draft: '' })
    expect(draftForSession(ctx, reference, '/explain stale')).toEqual({ ok: false, reason: 'unavailable' })
    expect(state.getSnapshot().draft).toBe('')
  })

  it('resolves legacy id slots and preserves an existing composer draft', () => {
    const scope = {} as Context
    const state = createSnapshotStore({ phase: 'plain', draft: 'unsent user work' })
    const setDraft = vi.fn()
    const resolveScope = vi.fn(() => scope)
    const ctx = {
      sessions: { scope: resolveScope },
      conversation: { input: { for: () => ({ state, setDraft }) } },
    } as unknown as Context
    expect(draftForSession(ctx, SessionId('legacy'), '/explain selection')).toEqual({ ok: false, reason: 'nonempty-draft' })
    expect(resolveScope).toHaveBeenCalledWith(SessionId('legacy'))
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('opens a visible source through the workspace owner when sessions has no open method', () => {
    const openSession = vi.fn()
    const ctx = {
      sessions: { list: createSnapshotStore({ byId: { source: { id: 'source' } } }) },
      get: (name: string) => name === 'uiWorkspace' ? { openSession } : undefined,
    } as unknown as Context
    const learning = new GlobalLearningStore(ctx)
    expect(learning.openSource(SessionId('source'))).toBe(true)
    expect(openSession).toHaveBeenCalledWith(SessionId('source'))
    expect(learning.openSource(SessionId('missing'))).toBe(false)
    expect(openSession).toHaveBeenCalledTimes(1)
    openSession.mockImplementationOnce(() => { throw new Error('disposed workspace') })
    expect(learning.openSource(SessionId('source'))).toBe(false)
    expect(learning.store.getSnapshot().navigationError).toBe('SOURCE_OPEN_FAILED')
    learning.dispose()
  })
})
