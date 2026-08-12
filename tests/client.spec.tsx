// @vitest-environment jsdom
import React, { type ComponentProps, useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/src/client/contract/store.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { EntryId, ExplanationId, TopicId } from '../src/brands.ts'
import { LearningView } from '../src/client/LearningView.tsx'
import { GlobalLearningStore, type LearningSnapshot } from '../src/client/learning-store.ts'
import { zh } from '../src/client/locales.ts'
import type { ThreadEntryView } from '../src/types.ts'

afterEach(cleanup)

function explanation(
  ordinal: number,
  source: string,
  state: 'active' | 'closed',
  title: string,
): ThreadEntryView {
  return {
    entryId: EntryId(`entry-${ordinal}`),
    ordinal,
    kind: 'explanation',
    explanationId: ExplanationId(`explanation-${ordinal}`),
    explanationState: state,
    topicId: TopicId(`topic-${ordinal}`),
    topicKey: `topic/${ordinal}`,
    topicTitle: title,
    topicState: state === 'closed' ? 'mastered' : 'learning',
    topicRevision: state === 'closed' ? 2 : 1,
    revision: 1,
    sourceSessionId: SessionId(source),
    sourceTurn: ordinal,
    payload: { title, what: `${title} what`, why: `${title} why`, pitfall: `${title} pitfall` },
    createdAt: 1_700_000_000_000 + ordinal,
  }
}

describe('conversation learning view', () => {
  it('renders the global thread with the current source first and dispatches entity feedback', () => {
    const current = explanation(3, 'session-current', 'active', 'Current concept')
    const other = explanation(2, 'session-other', 'active', 'Other concept')
    const history = explanation(1, 'session-old', 'closed', 'Mastered concept')
    const snapshot: LearningSnapshot = {
      phase: 'ready',
      status: {
        enabled: true,
        runtimeState: 'ready',
        activeExplanationCount: 2,
        pendingCandidateCount: 0,
        autoRequestsUsed: 4,
        autoRequestsLimit: 50,
        routeReady: true,
        provider: 'test',
        model: 'model',
        contextWindow: 128_000,
        storeRevision: 7,
        cursor: { incarnation: 'browser-test', revision: 7 },
      },
      context: {
        generatedAt: 1_700_000_000_000,
        dialogueProfile: [{
          kind: 'examples',
          preference: '偏好一个具体示例',
          confidence: 'high',
          evidenceObservationIds: [],
          evidenceEntryOrdinals: [1],
        }],
        knowledgeOverview: '已理解基础类型收窄。',
        learningTrend: '正在形成可靠的类型建模习惯。',
        stats: {
          learningTopics: 2,
          masteredTopics: 1,
          activeExplanations: 2,
          understoodFeedback: 1,
          notUnderstoodFeedback: 0,
        },
        inferred: true,
      },
      entries: [current, other, history],
      hasMore: false,
      pendingEntryIds: [],
      error: undefined,
    }
    const store = createSnapshotStore(snapshot)
    const feedback = vi.fn<NonNullable<ComponentProps<typeof LearningView>['feedback']>>()
      .mockResolvedValue(undefined)
    const cleanupView = vi.fn()
    const activate = vi.fn(() => cleanupView)
    const props = {
      sessionId: SessionId('session-current'),
      useLearning: learningHook(store),
      activate,
      loadOlder: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      feedback,
      reopen: vi.fn().mockResolvedValue(undefined),
      t: (key: keyof typeof zh) => zh[key],
    } as unknown as ComponentProps<typeof LearningView>

    const mounted = render(React.createElement(LearningView, props))
    expect(screen.getByRole('heading', { name: '全局学习线程' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Current concept' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Other concept' })).toBeTruthy()
    expect(screen.getByText('Mastered concept')).toBeTruthy()
    expect(screen.getByText('已理解基础类型收窄。')).toBeTruthy()
    expect(screen.getByText('4/50')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: '✓ 懂了' })[0]!)
    expect(feedback).toHaveBeenCalledWith(current, 'understood')
    expect(activate).toHaveBeenCalledOnce()
    mounted.unmount()
    expect(cleanupView).toHaveBeenCalledOnce()
  })

  it('keeps history readable while disabled and shows stable runtime failures', () => {
    const snapshot: LearningSnapshot = {
      phase: 'ready',
      status: {
        enabled: false,
        runtimeState: 'failed',
        activeExplanationCount: 0,
        pendingCandidateCount: 0,
        autoRequestsUsed: 0,
        autoRequestsLimit: 50,
        routeReady: false,
        lastError: { code: 'MODEL_ROUTE_REQUIRED', message: 'Choose an auxiliary model.' },
        storeRevision: 1,
        cursor: { incarnation: 'browser-test', revision: 1 },
      },
      context: {
        dialogueProfile: [],
        knowledgeOverview: '',
        learningTrend: '',
        stats: {
          learningTopics: 0, masteredTopics: 1, activeExplanations: 0,
          understoodFeedback: 1, notUnderstoodFeedback: 0,
        },
        inferred: false,
      },
      entries: [explanation(1, 'session-old', 'closed', 'Readable history')],
      hasMore: false,
      pendingEntryIds: [],
      error: undefined,
    }
    const props = {
      sessionId: SessionId('session-current'),
      useLearning: learningHook(createSnapshotStore(snapshot)),
      activate: () => () => {},
      loadOlder: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      feedback: vi.fn().mockResolvedValue(undefined),
      reopen: vi.fn().mockResolvedValue(undefined),
      t: (key: keyof typeof zh) => zh[key],
    } as unknown as ComponentProps<typeof LearningView>

    render(React.createElement(LearningView, props))
    expect(screen.getByText('学习模式当前已关闭；历史仍可阅读。')).toBeTruthy()
    expect(screen.getByText('Readable history')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('MODEL_ROUTE_REQUIRED')
  })
})

describe('global learning store lifecycle', () => {
  it('fences a stale mount while an initial refresh is shared with a new mount', async () => {
    let resolveStatus!: (value: LearningSnapshot['status']) => void
    const status = new Promise<LearningSnapshot['status']>(resolve => { resolveStatus = resolve })
    const watch = vi.fn((_request: unknown, signal: AbortSignal) => new Promise<{ changed: boolean }>(resolve => {
      signal.addEventListener('abort', () => { resolve({ changed: false }) }, { once: true })
    }))
    const remote = {
      status: vi.fn(() => status),
      context: vi.fn().mockResolvedValue({
        dialogueProfile: [], knowledgeOverview: '', learningTrend: '', inferred: false,
        stats: {
          learningTopics: 0, masteredTopics: 0, activeExplanations: 0,
          understoodFeedback: 0, notUnderstoodFeedback: 0,
        },
      }),
      threadPage: vi.fn().mockResolvedValue({ entries: [], hasMore: false, storeRevision: 0 }),
      watch,
    }
    const learning = new GlobalLearningStore({ remote: { explain: remote } } as unknown as Context)
    const firstUnmount = learning.mount()
    firstUnmount()
    const secondUnmount = learning.mount()
    resolveStatus({
      enabled: true,
      runtimeState: 'ready',
      activeExplanationCount: 0,
      pendingCandidateCount: 0,
      autoRequestsUsed: 0,
      autoRequestsLimit: 50,
      routeReady: true,
      storeRevision: 0,
      cursor: { incarnation: 'lifecycle-test', revision: 0 },
    })

    await waitFor(() => { expect(watch).toHaveBeenCalledTimes(1) })
    secondUnmount()
    learning.dispose()
  })
})

function learningHook(store: ReturnType<typeof createSnapshotStore<LearningSnapshot>>) {
  return <Selected,>(selector: (snapshot: LearningSnapshot) => Selected): Selected => {
    return selector(useSyncExternalStore(store.subscribe, store.getSnapshot))
  }
}
