import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { captureManualExplainTarget, observeSession } from '../src/observer.ts'
import { historyReader } from './session-fixture.ts'

describe('asynchronous source history', () => {
  it('reads one fixed cut while the live Session advances, without synchronous Session readers', async () => {
    const session = Session.create(SessionId('fixed-cut'))
    session.append('turn/start', { turn: 1 })
    const cut = session.seq
    const metadata = { id: session.id, header: session.header, seq: cut }
    const requests: number[] = []
    const reader = historyReader(session, 1)
    const observed = observeSession(metadata, { page: async (request, signal) => {
      requests.push(request.throughSeq)
      await Promise.resolve()
      return reader.page(request, signal)
    } }, new AbortController().signal)
    session.append('step/start', { turn: 1, step: 1 })
    const events = []
    for await (const event of observed.eventsBefore()) events.push(event)
    expect(events.map(event => event.type)).toEqual(['turn/start'])
    expect(requests.every(value => value === cut - 1)).toBe(true)
  })

  it('discards a page that arrives after cancellation', async () => {
    const session = Session.create(SessionId('cancel-page'))
    session.append('turn/start', { turn: 1 })
    const abort = new AbortController()
    const reader = historyReader(session)
    const observed = observeSession(session, { page: async (request, signal) => {
      const page = await reader.page(request, signal)
      abort.abort(new Error('cancel history'))
      return page
    } }, abort.signal)
    await expect(captureManualExplainTarget(observed, 'Explain cancellation', 100))
      .rejects.toThrow('cancel history')
  })

  it('rejects a stalled page instead of looping indefinitely', async () => {
    const session = Session.create(SessionId('stalled-page'))
    session.append('turn/start', { turn: 1 })
    const observed = observeSession(session, {
      page: async () => ({ records: [], hasMore: true }),
    }, new AbortController().signal)
    await expect(captureManualExplainTarget(observed, 'Explain pagination', 100))
      .rejects.toThrow('did not advance')
  })

  it('advances past legacy packed chunks without treating them as source text', async () => {
    const session = Session.create(SessionId('legacy-chunks'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const cursors: number[] = []
    const page: SessionController['page'] = async request => {
      cursors.push(request.beforeSeq!)
      return request.beforeSeq === session.seq
        ? { records: [{ type: 'chunks', event: { seq: 1, type: 'chunkrow/text', time: 0, data: 'private stream' } }], hasMore: true } as never
        : { records: [], hasMore: false }
    }
    const target = await captureManualExplainTarget(observeSession(session, { page }, new AbortController().signal), 'Explain paging', 100)
    expect(cursors).toEqual([2, 1])
    expect(target.capsule.assistantText).toBe('')
  })
})
