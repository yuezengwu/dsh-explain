// @vitest-environment jsdom
import React, { type ComponentProps, useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createSnapshotStore } from './client-runtime-stub.ts'
import { EntryId, ExplanationId, TopicId } from '../src/brands.ts'
import { LearningView } from '../src/client/LearningView.tsx'
import { LearningSettingsSection } from '../src/client/LearningSettingsSection.tsx'
import { diagnosticState } from '../src/client/diagnostics.ts'
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
    const current = {
      ...explanation(3, 'session-current', 'active', 'Current concept'),
      origin: 'selection' as const,
    }
    const other = {
      ...explanation(2, 'session-other', 'active', 'Other concept'),
      origin: 'manual' as const,
      sourceTurn: 0,
    }
    const history = {
      ...explanation(1, 'session-old', 'closed', 'Mastered concept'),
      origin: 'answer' as const,
    }
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
      configuration: {
        revision: 3,
        enabled: true,
        provider: 'test',
        model: 'model',
        maxAutoRequestsPerDay: 50,
      },
      modelCatalog: undefined,
      modelCatalogPhase: 'idle',
      modelCatalogError: undefined,
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
      configurationPending: false,
      configurationError: undefined,
      navigationError: undefined,
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
      useSessions: sessionsHook(['session-current', 'session-other']),
      activate,
      loadOlder: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      feedback,
      reopen: vi.fn().mockResolvedValue(undefined),
      openSource: vi.fn(() => true),
      t: (key: keyof typeof zh) => zh[key],
    } as unknown as ComponentProps<typeof LearningView>

    const mounted = render(React.createElement(LearningView, props))
    expect(mounted.container.querySelector('[data-conversation-composer-overlay]')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '全局学习线程' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Current concept' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Other concept' })).toBeTruthy()
    expect(screen.getByText('主动请求')).toBeTruthy()
    expect(screen.getByText('选中解释')).toBeTruthy()
    expect(screen.getByText('学习回答')).toBeTruthy()
    expect(screen.queryByText('回合 0')).toBeNull()
    expect(screen.getByText('Mastered concept')).toBeTruthy()
    expect(screen.getByText('已理解基础类型收窄。')).toBeTruthy()
    expect(screen.getByText('4/50')).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开来源会话' })).toBeTruthy()
    expect(screen.getByText('来源会话不可用')).toBeTruthy()
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
      configuration: {
        revision: 0,
        enabled: false,
        maxAutoRequestsPerDay: 50,
      },
      modelCatalog: undefined,
      modelCatalogPhase: 'idle',
      modelCatalogError: undefined,
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
      configurationPending: false,
      configurationError: undefined,
      navigationError: undefined,
      error: undefined,
    }
    const props = {
      sessionId: SessionId('session-current'),
      useLearning: learningHook(createSnapshotStore(snapshot)),
      useSessions: sessionsHook(['session-current']),
      activate: () => () => {},
      loadOlder: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      feedback: vi.fn().mockResolvedValue(undefined),
      reopen: vi.fn().mockResolvedValue(undefined),
      openSource: vi.fn(() => false),
      t: (key: keyof typeof zh) => zh[key],
    } as unknown as ComponentProps<typeof LearningView>

    render(React.createElement(LearningView, props))
    expect(screen.getByText('学习模式已关闭')).toBeTruthy()
    expect(screen.getByText('Readable history')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('MODEL_ROUTE_REQUIRED')
  })
})

describe('global learning store lifecycle', () => {
  it('fences a stale mount while an initial refresh is shared with a new mount', async () => {
    let resolveStatus!: (value: { readonly ok: true; readonly value: NonNullable<LearningSnapshot['status']> }) => void
    const status = new Promise<{ readonly ok: true; readonly value: NonNullable<LearningSnapshot['status']> }>(
      resolve => { resolveStatus = resolve },
    )
    const watch = vi.fn((_request: unknown, signal: AbortSignal) => new Promise(resolve => {
      signal.addEventListener('abort', () => { resolve({ ok: true, value: { changed: false } }) }, { once: true })
    }))
    const remote = {
      status: vi.fn(() => status),
      context: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          dialogueProfile: [], knowledgeOverview: '', learningTrend: '', inferred: false,
          stats: {
            learningTopics: 0, masteredTopics: 0, activeExplanations: 0,
            understoodFeedback: 0, notUnderstoodFeedback: 0,
          },
        },
      }),
      configuration: vi.fn().mockResolvedValue({
        ok: true,
        value: { revision: 0, enabled: true, maxAutoRequestsPerDay: 50 },
      }),
      modelCatalog: vi.fn().mockResolvedValue({ ok: true, value: { providers: [] } }),
      threadPage: vi.fn().mockResolvedValue({
        ok: true,
        value: { entries: [], hasMore: false, storeRevision: 0 },
      }),
      watch,
    }
    const learning = new GlobalLearningStore({ remote: { explain: remote } } as unknown as Context)
    const firstUnmount = learning.mount()
    firstUnmount()
    const secondUnmount = learning.mountSettings()
    resolveStatus({
      ok: true,
      value: {
        enabled: true,
        runtimeState: 'ready',
        activeExplanationCount: 0,
        pendingCandidateCount: 0,
        autoRequestsUsed: 0,
        autoRequestsLimit: 50,
        routeReady: true,
        storeRevision: 0,
        cursor: { incarnation: 'lifecycle-test', revision: 0 },
      },
    })

    await waitFor(() => {
      expect(watch).toHaveBeenCalledTimes(1)
      expect(remote.modelCatalog).toHaveBeenCalledTimes(1)
    })
    secondUnmount()
    learning.dispose()
  })

  it('surfaces typed Remote transport failures without replacing cached data', async () => {
    const remote = {
      status: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'TRANSPORT', message: 'connection lost' },
      }),
      context: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          dialogueProfile: [], knowledgeOverview: '', learningTrend: '', inferred: false,
          stats: {
            learningTopics: 0, masteredTopics: 0, activeExplanations: 0,
            understoodFeedback: 0, notUnderstoodFeedback: 0,
          },
        },
      }),
      configuration: vi.fn().mockResolvedValue({
        ok: true,
        value: { revision: 0, enabled: true, maxAutoRequestsPerDay: 50 },
      }),
      threadPage: vi.fn().mockResolvedValue({
        ok: true,
        value: { entries: [], hasMore: false, storeRevision: 0 },
      }),
    }
    const learning = new GlobalLearningStore({ remote: { explain: remote } } as unknown as Context)
    const cached = explanation(1, 'cached-session', 'closed', 'Cached explanation')
    learning.store.set({
      ...learning.store.getSnapshot(),
      phase: 'ready',
      entries: [cached],
    })

    await learning.refresh()

    expect(learning.store.getSnapshot()).toMatchObject({
      phase: 'error',
      entries: [cached],
      error: 'TRANSPORT: connection lost',
    })
    learning.dispose()
  })

  it('refreshes after a stale settings write and opens only inventory sources', async () => {
    const status = {
      enabled: false,
      runtimeState: 'disabled' as const,
      activeExplanationCount: 0,
      pendingCandidateCount: 0,
      autoRequestsUsed: 0,
      autoRequestsLimit: 50,
      routeReady: false,
      storeRevision: 0,
      cursor: { incarnation: 'mutation-test', revision: 0 },
    }
    const remote = {
      status: vi.fn().mockResolvedValue({ ok: true, value: status }),
      configuration: vi.fn().mockResolvedValue({
        ok: true,
        value: { revision: 2, enabled: false, maxAutoRequestsPerDay: 20 },
      }),
      context: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          dialogueProfile: [], knowledgeOverview: '', learningTrend: '', inferred: false,
          stats: {
            learningTopics: 0, masteredTopics: 0, activeExplanations: 0,
            understoodFeedback: 0, notUnderstoodFeedback: 0,
          },
        },
      }),
      threadPage: vi.fn().mockResolvedValue({
        ok: true,
        value: { entries: [], hasMore: false, storeRevision: 0 },
      }),
      updateConfiguration: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          ok: false,
          error: { code: 'SETTINGS_STALE', message: 'stale form' },
          configuration: { revision: 2, enabled: false, maxAutoRequestsPerDay: 20 },
        },
      }),
    }
    const open = vi.fn()
    const ctx = {
      remote: { explain: remote },
      sessions: {
        list: createSnapshotStore({ byId: { available: { id: 'available' } } }),
        open,
      },
    } as unknown as Context
    const learning = new GlobalLearningStore(ctx)

    await learning.updateConfiguration({
      expectedRevision: 1,
      enabled: false,
      maxAutoRequestsPerDay: 10,
    })
    expect(learning.store.getSnapshot()).toMatchObject({
      configuration: { revision: 2, maxAutoRequestsPerDay: 20 },
      configurationPending: false,
      configurationError: 'SETTINGS_STALE: stale form',
    })
    expect(remote.status).toHaveBeenCalledOnce()
    expect(learning.openSource(SessionId('available'))).toBe(true)
    expect(open).toHaveBeenCalledWith(SessionId('available'))
    expect(learning.openSource(SessionId('missing'))).toBe(false)
    expect(learning.store.getSnapshot().navigationError).toBe('SOURCE_UNAVAILABLE')
    learning.dispose()
  })
})

describe('learning settings section', () => {
  it('submits the native settings revision and renders advisory choices', () => {
    const snapshot: LearningSnapshot = {
      phase: 'ready',
      status: {
        enabled: false,
        runtimeState: 'disabled',
        activeExplanationCount: 1,
        pendingCandidateCount: 2,
        autoRequestsUsed: 4,
        autoRequestsLimit: 50,
        routeReady: false,
        storeRevision: 7,
        cursor: { incarnation: 'settings-test', revision: 7 },
      },
      configuration: {
        revision: 9,
        enabled: false,
        provider: 'deepseek-official',
        model: 'deepseek-chat',
        maxAutoRequestsPerDay: 50,
      },
      modelCatalog: {
        providers: [{
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
        }],
      },
      modelCatalogPhase: 'ready',
      modelCatalogError: undefined,
      context: undefined,
      entries: [],
      hasMore: false,
      pendingEntryIds: [],
      configurationPending: false,
      configurationError: undefined,
      navigationError: undefined,
      error: undefined,
    }
    const updateConfiguration = vi.fn().mockResolvedValue(undefined)
    const props = {
      useLearning: learningHook(createSnapshotStore(snapshot)),
      activate: () => () => {},
      refresh: vi.fn().mockResolvedValue(undefined),
      updateConfiguration,
      t: (key: keyof typeof zh) => zh[key],
    } as unknown as ComponentProps<typeof LearningSettingsSection>

    render(React.createElement(LearningSettingsSection, props))
    expect(screen.getByRole('heading', { name: '学习模式' })).toBeTruthy()
    expect(screen.getByText('学习模式已关闭')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /启用学习模式/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    expect(updateConfiguration).toHaveBeenCalledWith({
      expectedRevision: 9,
      enabled: true,
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      maxAutoRequestsPerDay: 50,
    })
  })

  it('uses one diagnostic precedence for failure and exhausted budget', () => {
    expect(diagnosticState({
      enabled: true,
      runtimeState: 'failed',
      activeExplanationCount: 0,
      pendingCandidateCount: 0,
      autoRequestsUsed: 50,
      autoRequestsLimit: 50,
      routeReady: false,
      storeRevision: 0,
      cursor: { incarnation: 'diagnostic', revision: 0 },
    })).toBe('failed')
    expect(diagnosticState({
      enabled: true,
      runtimeState: 'ready',
      activeExplanationCount: 0,
      pendingCandidateCount: 0,
      autoRequestsUsed: 50,
      autoRequestsLimit: 50,
      routeReady: true,
      storeRevision: 0,
      cursor: { incarnation: 'diagnostic', revision: 0 },
    })).toBe('budget-exhausted')
  })
})

function learningHook(store: ReturnType<typeof createSnapshotStore<LearningSnapshot>>) {
  return <Selected,>(selector: (snapshot: LearningSnapshot) => Selected): Selected => {
    return selector(useSyncExternalStore(store.subscribe, store.getSnapshot))
  }
}

function sessionsHook(ids: readonly string[]) {
  const byId = Object.fromEntries(ids.map(id => [id, { id }]))
  const store = createSnapshotStore({
    ids: ids.map(SessionId),
    byId,
    current: ids[0] === undefined ? undefined : SessionId(ids[0]),
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } as unknown as SessionListState)
  return <Selected,>(selector: (snapshot: SessionListState) => Selected): Selected => {
    return selector(useSyncExternalStore(store.subscribe, store.getSnapshot))
  }
}
