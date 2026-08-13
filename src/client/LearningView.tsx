import { useEffect, useMemo } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ObservableSnapshot,
  SessionId,
  SessionListState,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ThreadEntryView } from 'dsh-explain/types'
import type { LearningSnapshot } from './learning-store.ts'
import { diagnosticState } from './diagnostics.ts'

/** Session-bound actions layered over the browser-wide learning snapshot. */
export interface LearningViewInjected {
  hooks: {
    learning: SnapshotStore<LearningSnapshot>
    sessions: ObservableSnapshot<SessionListState>
  }
  activate: () => () => void
  loadOlder: () => Promise<void>
  refresh: () => Promise<void>
  feedback: (entry: ThreadEntryView, action: 'understood' | 'not-understood') => Promise<void>
  reopen: (entry: ThreadEntryView) => Promise<void>
  openSource: (sourceSessionId: SessionId) => boolean
}

type LearningViewProps = ConvViewProps & InjectFace<LearningViewInjected> & PropsLocale<'explain'>

/** Global learning thread rendered through one Session-scoped conversation view entry. */
export function LearningView({
  sessionId, useLearning, useSessions, activate, loadOlder, refresh, feedback, reopen, openSource, t,
}: LearningViewProps) {
  useEffect(() => activate(), [activate])
  const snapshot = useLearning(value => value)
  const sources = useSessions(value => value.byId)
  const active = useMemo(() => latestActiveExplanations(snapshot.entries), [snapshot.entries])
  const current = active.filter(entry => entry.sourceSessionId === sessionId)
  const other = active.filter(entry => entry.sourceSessionId !== sessionId)
  const activeIds = new Set(active.map(entry => entry.entryId))
  const history = snapshot.entries.filter(entry => !activeIds.has(entry.entryId))
  const latestTopicOrdinals = new Map<string, number>()
  for (const entry of snapshot.entries) {
    if (!latestTopicOrdinals.has(entry.topicId)) latestTopicOrdinals.set(entry.topicId, entry.ordinal)
  }

  return (
    <div
      className="dsh-explain-root"
      data-conversation-composer-overlay=""
      data-testid="dsh-explain-learning-view"
    >
      <main className="dsh-explain-shell">
        <header className="dsh-explain-heading">
          <div>
            <h1>{t('title.learning')}</h1>
            <div className="dsh-explain-status">
              {snapshot.phase === 'loading'
                ? t('status.loading')
                : snapshot.status === undefined ? null : t(`diagnostic.${diagnosticState(snapshot.status)}`)}
            </div>
            {snapshot.status?.autoRequestsResumeAt !== undefined
              && diagnosticState(snapshot.status) === 'budget-exhausted' && (
              <div className="dsh-explain-status">
                {t('status.budgetResumes')} {new Date(snapshot.status.autoRequestsResumeAt).toLocaleString()}
              </div>
            )}
            {snapshot.status?.estimatedContextRatio !== undefined && (
              <div className="dsh-explain-status">
                {t('diagnostic.pressure')} {(snapshot.status.estimatedContextRatio * 100).toFixed(1)}%
              </div>
            )}
          </div>
          {snapshot.phase === 'error' && (
            <Button size="sm" variant="outline" onClick={() => { void refresh() }}>{t('action.retry')}</Button>
          )}
        </header>

        {snapshot.error !== undefined && (
          <div className="dsh-explain-error" role="alert">{snapshot.error || t('error.generic')}</div>
        )}
        {snapshot.status?.lastError !== undefined && (
          <div className="dsh-explain-error" role="alert">
            {snapshot.status.lastError.code}: {snapshot.status.lastError.message}
          </div>
        )}
        {snapshot.navigationError !== undefined && (
          <div className="dsh-explain-error" role="alert">
            {snapshot.navigationError === 'SOURCE_UNAVAILABLE'
              ? t('error.sourceUnavailable') : t('error.sourceOpenFailed')}
          </div>
        )}

        {snapshot.status !== undefined && snapshot.context !== undefined && (
          <>
            <div className="dsh-explain-metrics">
              <Metric value={snapshot.context.stats.learningTopics} label={t('metric.learning')} />
              <Metric value={snapshot.context.stats.masteredTopics} label={t('metric.mastered')} />
              <Metric value={snapshot.status.activeExplanationCount} label={t('metric.active')} />
              <Metric
                value={`${snapshot.status.autoRequestsUsed}/${snapshot.status.autoRequestsLimit}`}
                label={t('metric.budget')}
              />
            </div>
            <ContextPanel snapshot={snapshot} t={t} />
          </>
        )}

        <section className="dsh-explain-section">
          <h2 className="dsh-explain-section-title">{t('section.current')}</h2>
          {current.length === 0
            ? <div className="dsh-explain-empty">{t('current.none')}</div>
            : current.map(entry => (
              <ExplanationCard
                key={entry.entryId}
                entry={entry}
                current
                pending={snapshot.pendingEntryIds.includes(entry.entryId)}
                disabled={snapshot.status?.enabled !== true}
                onFeedback={feedback}
                sourceAvailable={entry.sourceSessionId !== undefined && sources[entry.sourceSessionId] !== undefined}
                onOpenSource={openSource}
                t={t}
              />
            ))}
        </section>

        {other.length > 0 && (
          <section className="dsh-explain-section">
            <h2 className="dsh-explain-section-title">
              {t('section.otherActive')} <span className="dsh-explain-count">{other.length}</span>
            </h2>
            {other.map(entry => (
              <ExplanationCard
                key={entry.entryId}
                entry={entry}
                pending={snapshot.pendingEntryIds.includes(entry.entryId)}
                disabled={snapshot.status?.enabled !== true}
                onFeedback={feedback}
                sourceAvailable={entry.sourceSessionId !== undefined && sources[entry.sourceSessionId] !== undefined}
                onOpenSource={openSource}
                t={t}
              />
            ))}
          </section>
        )}

        <section className="dsh-explain-section">
          <h2 className="dsh-explain-section-title">{t('section.history')}</h2>
          {history.length === 0 && snapshot.phase !== 'loading'
            ? <div className="dsh-explain-empty">{t('status.empty')}</div>
            : (
              <div className="dsh-explain-history">
                {history.map(entry => (
                  <HistoryRow
                    key={entry.entryId}
                    entry={entry}
                    canReopen={entry.topicState === 'mastered'
                      && latestTopicOrdinals.get(entry.topicId) === entry.ordinal}
                    pending={snapshot.pendingEntryIds.includes(entry.entryId)}
                    disabled={snapshot.status?.enabled !== true}
                    onReopen={reopen}
                    currentSessionId={sessionId}
                    sourceAvailable={entry.sourceSessionId !== undefined && sources[entry.sourceSessionId] !== undefined}
                    onOpenSource={openSource}
                    t={t}
                  />
                ))}
              </div>
            )}
          {snapshot.hasMore && (
            <div className="dsh-explain-load">
              <Button size="sm" variant="outline" onClick={() => { void loadOlder() }}>
                {t('action.loadOlder')}
              </Button>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function Metric({ value, label }: { readonly value: number | string; readonly label: string }) {
  return <div className="dsh-explain-metric"><strong>{value}</strong><span>{label}</span></div>
}

function ContextPanel({ snapshot, t }: { readonly snapshot: LearningSnapshot; readonly t: LearningViewProps['t'] }) {
  const context = snapshot.context!
  return (
    <section className="dsh-explain-section">
      <h2 className="dsh-explain-section-title">
        {t('section.context')}
        {context.inferred && <span className="dsh-explain-badge">{t('status.inferred')}</span>}
      </h2>
      {!context.inferred
        ? <div className="dsh-explain-empty">{t('status.noContext')}</div>
        : (
          <div className="dsh-explain-context">
            <div className="dsh-explain-context-block">
              <h3>{t('context.knowledge')}</h3><p>{context.knowledgeOverview}</p>
            </div>
            <div className="dsh-explain-context-block">
              <h3>{t('context.trend')}</h3><p>{context.learningTrend}</p>
            </div>
            <div className="dsh-explain-context-block dsh-explain-context-wide">
              <h3>{t('context.preferences')}</h3>
              <div className="dsh-explain-preferences">
                {context.dialogueProfile.map(preference => (
                  <span className="dsh-explain-chip" key={`${preference.kind}:${preference.preference}`}>
                    {preference.preference}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
    </section>
  )
}

function ExplanationCard({
  entry, current = false, pending, disabled, sourceAvailable, onFeedback, onOpenSource, t,
}: {
  readonly entry: ThreadEntryView
  readonly current?: boolean
  readonly pending: boolean
  readonly disabled: boolean
  readonly sourceAvailable: boolean
  readonly onFeedback: LearningViewInjected['feedback']
  readonly onOpenSource: LearningViewInjected['openSource']
  readonly t: LearningViewProps['t']
}) {
  if (entry.kind !== 'explanation') return null
  const payload = entry.payload as { readonly title: string; readonly what: string; readonly why: string; readonly pitfall: string }
  return (
    <article className="dsh-explain-card dsh-explain-card-active" data-explanation-id={entry.explanationId}>
      <div className="dsh-explain-card-header">
        <div>
          <h3>{payload.title}</h3>
          <EntryMeta entry={entry} current={current} t={t} />
        </div>
        {current && <span className="dsh-explain-badge">{t('entry.current')}</span>}
      </div>
      <div className="dsh-explain-fields">
        <Field title={t('entry.what')} text={payload.what} />
        <Field title={t('entry.why')} text={payload.why} />
        <Field title={t('entry.pitfall')} text={payload.pitfall} />
      </div>
      <div className="dsh-explain-actions">
        <Button size="sm" variant="primary" disabled={disabled || pending}
          onClick={() => { void onFeedback(entry, 'understood') }}>
          {pending ? t('action.pending') : t('feedback.understood')}
        </Button>
        <Button size="sm" variant="outline" disabled={disabled || pending}
          onClick={() => { void onFeedback(entry, 'not-understood') }}>
          {pending ? t('action.pending') : t('feedback.notUnderstood')}
        </Button>
        <SourceNavigation
          entry={entry}
          current={current}
          available={sourceAvailable}
          onOpen={onOpenSource}
          t={t}
        />
      </div>
    </article>
  )
}

function Field({ title, text }: { readonly title: string; readonly text: string }) {
  return <div className="dsh-explain-field"><h4>{title}</h4><p>{text}</p></div>
}

function HistoryRow({
  entry, canReopen, pending, disabled, currentSessionId, sourceAvailable, onReopen, onOpenSource, t,
}: {
  readonly entry: ThreadEntryView
  readonly canReopen: boolean
  readonly pending: boolean
  readonly disabled: boolean
  readonly currentSessionId: SessionId
  readonly sourceAvailable: boolean
  readonly onReopen: LearningViewInjected['reopen']
  readonly onOpenSource: LearningViewInjected['openSource']
  readonly t: LearningViewProps['t']
}) {
  let title = entry.topicTitle
  if (entry.kind === 'explanation') title = (entry.payload as { readonly title: string }).title
  if (entry.kind === 'feedback') {
    title = (entry.payload as { readonly action: string }).action === 'understood'
      ? t('feedback.understoodRecord') : t('feedback.notUnderstoodRecord')
  }
  if (entry.kind === 'topic-reopen') title = t('action.reopen')
  return (
    <div className="dsh-explain-history-row">
      <div className="dsh-explain-history-main">
        <div className="dsh-explain-history-title">{title}</div>
        <EntryMeta entry={entry} t={t} />
      </div>
      <div className="dsh-explain-history-actions">
        {entry.topicState === 'mastered' && <span className="dsh-explain-badge">{t('entry.mastered')}</span>}
        {canReopen && (
          <Button size="sm" variant="outline" disabled={disabled || pending}
            onClick={() => { void onReopen(entry) }}>
            {pending ? t('action.pending') : t('action.reopen')}
          </Button>
        )}
        <SourceNavigation
          entry={entry}
          current={entry.sourceSessionId === currentSessionId}
          available={sourceAvailable}
          onOpen={onOpenSource}
          t={t}
        />
      </div>
    </div>
  )
}

function SourceNavigation({ entry, current, available, onOpen, t }: {
  readonly entry: ThreadEntryView
  readonly current: boolean
  readonly available: boolean
  readonly onOpen: LearningViewInjected['openSource']
  readonly t: LearningViewProps['t']
}) {
  const sourceSessionId = entry.sourceSessionId
  if (sourceSessionId === undefined || current) return null
  if (!available) return <span className="dsh-explain-source-unavailable">{t('entry.sourceUnavailable')}</span>
  return (
    <Button size="sm" variant="outline" onClick={() => { onOpen(sourceSessionId) }}>
      {t('action.openSource')}
    </Button>
  )
}

function EntryMeta({ entry, current = false, t }: {
  readonly entry: ThreadEntryView
  readonly current?: boolean
  readonly t: LearningViewProps['t']
}) {
  return (
    <div className="dsh-explain-meta">
      {entry.sourceSessionId !== undefined && (
        <span>{t('entry.source')} {shortSession(entry.sourceSessionId)}{current ? ` · ${t('entry.current')}` : ''}</span>
      )}
      {entry.origin === 'manual' && <span>{t('entry.manual')}</span>}
      {entry.sourceTurn !== undefined && entry.sourceTurn > 0 && <span>{t('entry.turn')} {entry.sourceTurn}</span>}
      <time dateTime={new Date(entry.createdAt).toISOString()}>{new Date(entry.createdAt).toLocaleString()}</time>
    </div>
  )
}

function latestActiveExplanations(entries: readonly ThreadEntryView[]): readonly ThreadEntryView[] {
  const seen = new Set<string>()
  const result: ThreadEntryView[] = []
  for (const entry of entries) {
    if (entry.kind !== 'explanation' || entry.explanationState !== 'active' || entry.explanationId === undefined) continue
    if (seen.has(entry.explanationId)) continue
    seen.add(entry.explanationId)
    result.push(entry)
  }
  return result
}

function shortSession(sessionId: string): string {
  return sessionId.length <= 12 ? sessionId : `${sessionId.slice(0, 8)}…`
}
