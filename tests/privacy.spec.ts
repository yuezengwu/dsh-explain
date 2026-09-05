import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { RequestId } from '../src/brands.ts'
import { renderManualExplainRequest } from '../src/explainer.ts'
import { redactSensitiveText } from '../src/privacy.ts'
import { ExplainStore } from '../src/store.ts'

describe('learning text privacy', () => {
  it('filters recognizable paths and credentials while preserving URLs and relative examples', () => {
    for (const text of [
      '/Users/SYNTHETIC/example.ts', '/home/SYNTHETIC/example.ts',
      'C:\\Users\\SYNTHETIC\\example.ts', '\\\\server\\SYNTHETIC\\example.ts',
      'API_KEY="SYNTHETIC_CREDENTIAL"', 'service_api_key=SYNTHETIC_CREDENTIAL',
      'Bearer SYNTHETIC_CREDENTIAL', 'ghp_SYNTHETIC000000000000',
    ]) expect(redactSensitiveText(text)).not.toContain('SYNTHETIC')
    const ordinary = 'See https://example.com/home/alice and src/observer.ts; use /explain topic.'
    expect(redactSensitiveText(ordinary)).toBe(ordinary)
  })

  it('filters outgoing requests, retained summaries, generated text, and legacy export fields', () => {
    const store = new ExplainStore(':memory:')
    try {
      const marker = '/Users/SYNTHETIC/example.ts'
      const capsule = {
        sourceSessionId: SessionId('privacy-source'), turn: 1, endSeq: 3,
        observedAt: Date.now(), userText: `Explain ${marker}`, assistantText: `Read ${marker}`,
        tools: [], truncated: false,
      }
      const request = renderManualExplainRequest(store.auxiliaryContext(10), {
        origin: 'manual', request: capsule.userText, capsule,
      }, 1_000)
      expect(JSON.stringify(request.messages)).not.toContain(marker)
      const content = request.parse(JSON.stringify({
        topicKey: 'privacy/example', title: 'Example', what: `Read ${marker}`, why: 'Why', pitfall: 'Pitfall',
      }))
      expect(content.what).not.toContain(marker)
      const lease = store.acquireLease('privacy-test')
      const committed = store.commitManualExplanation(lease, {
        origin: 'manual', request: capsule.userText, capsule,
      }, content, { provider: 'test', model: 'test', generatedAt: Date.now() })
      if (!committed.ok) throw new Error('fixture explanation was rejected')
      store.feedback({ requestId: RequestId('privacy-rephrase'), explanationId: committed.entry.explanationId!,
        sourceSessionId: capsule.sourceSessionId, revision: 1, action: 'not-understood' })
      expect(store.pendingRephrases()[0]!.sourceSummary.userText).not.toContain(marker)
      store.addFixtureExplanation({
        topicKey: 'privacy/legacy', title: 'Legacy', sourceSessionId: SessionId('legacy'), sourceTurn: 1,
        revisions: [{ title: 'Legacy', what: marker, why: 'API_KEY=SYNTHETIC_CREDENTIAL', pitfall: 'Pitfall' }],
      })
      const exported = JSON.stringify(store.exportData())
      expect(exported).not.toContain('SYNTHETIC')
      expect(exported).not.toContain('sourceSummary')
      expect(store.activeEntries().find(entry => entry.topicKey === 'privacy/legacy')?.payload)
        .toMatchObject({ what: marker })
    } finally {
      store.close()
    }
  })
})
