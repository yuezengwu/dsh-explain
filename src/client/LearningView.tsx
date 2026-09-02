import { useEffect, useMemo, useState } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  DialoguePreferenceView,
  LearnerProfileEvidenceView,
  ReviewId,
  ThreadEntryView,
  TopicFamiliarityView,
  UpdateLearnerProfileRequest,
} from 'dsh-explain/types'
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
  startReview: () => Promise<void>
  submitReviewAnswer: (reviewId: ReviewId, answer: string) => Promise<void>
  updateLearnerProfile: (
    change: Omit<UpdateLearnerProfileRequest, 'requestId' | 'expectedStoreRevision'>,
  ) => Promise<boolean>
  openSource: (sourceSessionId: SessionId) => boolean
}

type LearningViewProps = ConvViewProps & InjectFace<LearningViewInjected> & PropsLocale<'explain'>

/** Global learning thread rendered through one Session-scoped conversation view entry. */
export function LearningView({
  sessionId, useLearning, useSessions, activate, loadOlder, refresh, feedback, reopen,
  startReview, submitReviewAnswer, updateLearnerProfile, openSource, t,
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
            {snapshot.review !== undefined && (
              <ReviewPanel
                snapshot={snapshot}
                sessionId={sessionId}
                sources={sources}
                onStart={startReview}
                onSubmit={submitReviewAnswer}
                onOpenSource={openSource}
                t={t}
              />
            )}
            <ContextPanel
              snapshot={snapshot}
              sessionId={sessionId}
              sources={sources}
              onUpdate={updateLearnerProfile}
              onOpenSource={openSource}
              t={t}
            />
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

function ReviewPanel({ snapshot, sessionId, sources, onStart, onSubmit, onOpenSource, t }: {
  readonly snapshot: LearningSnapshot
  readonly sessionId: SessionId
  readonly sources: SessionListState['byId']
  readonly onStart: LearningViewInjected['startReview']
  readonly onSubmit: LearningViewInjected['submitReviewAnswer']
  readonly onOpenSource: LearningViewInjected['openSource']
  readonly t: LearningViewProps['t']
}) {
  const review = snapshot.review!
  const current = review.current
  const [answer, setAnswer] = useState('')
  useEffect(() => { setAnswer('') }, [current?.reviewId])
  return (
    <section className="dsh-explain-section dsh-explain-review">
      <div className="dsh-explain-review-heading">
        <div>
          <h2 className="dsh-explain-section-title">{t('review.title')}</h2>
          <p className="dsh-explain-review-intro">{t('review.intro')}</p>
        </div>
        {current === undefined && (
          <Button size="sm" variant="primary"
            disabled={snapshot.reviewPending || snapshot.status?.enabled !== true || review.dueCount === 0}
            onClick={() => { void onStart() }}>
            {snapshot.reviewPending ? t('review.starting') : t('review.start')}
          </Button>
        )}
      </div>
      <div className="dsh-explain-review-stats">
        <Metric value={review.dueCount} label={t('review.due')} />
        <Metric value={review.weakCount} label={t('review.weak')} />
        <Metric value={review.newCount} label={t('review.new')} />
        <Metric value={review.completedCount} label={t('review.completed')} />
      </div>
      {snapshot.reviewError !== undefined && (
        <div className="dsh-explain-error" role="alert">{snapshot.reviewError}</div>
      )}
      {current === undefined
        ? <div className="dsh-explain-empty">
            {review.dueCount === 0
              ? review.nextDueAt === undefined ? t('review.none')
                : `${t('review.next')} ${new Date(review.nextDueAt).toLocaleString()}`
              : t('review.ready')}
          </div>
        : (
          <article className="dsh-explain-card dsh-explain-review-card">
            <div className="dsh-explain-card-header">
              <div>
                <span className="dsh-explain-badge">{t(`review.kind.${current.kind}`)}</span>
                <h3>{current.topicTitle}</h3>
              </div>
              <span className="dsh-explain-count">{current.position}/{current.total}</span>
            </div>
            <p className="dsh-explain-review-question">{current.question}</p>
            <textarea
              className="dsh-explain-review-answer"
              value={answer}
              maxLength={4_000}
              placeholder={t('review.answerPlaceholder')}
              disabled={snapshot.reviewPending}
              onChange={event => { setAnswer(event.target.value) }}
            />
            <div className="dsh-explain-actions">
              <Button size="sm" variant="primary"
                disabled={snapshot.reviewPending || answer.trim() === ''}
                onClick={() => { void onSubmit(current.reviewId, answer) }}>
                {snapshot.reviewPending ? t('review.evaluating') : t('review.submit')}
              </Button>
              {sources[current.sourceSessionId] === undefined
                ? <span className="dsh-explain-source-unavailable">{t('entry.sourceUnavailable')}</span>
                : current.sourceSessionId !== sessionId && <Button size="sm" variant="outline" onClick={() => { onOpenSource(current.sourceSessionId) }}>
                    {t('action.openSource')}
                  </Button>}
            </div>
          </article>
        )}
      {review.recent.length > 0 && (
        <div className="dsh-explain-review-recent">
          <h3>{t('review.recent')}</h3>
          {review.recent.slice(0, 3).map(attempt => (
            <div className="dsh-explain-review-result" key={attempt.reviewId}>
              <div>
                <strong>{attempt.topicTitle}</strong>
                <span className={`dsh-explain-review-verdict dsh-explain-review-verdict-${attempt.result}`}>
                  {t(`review.result.${attempt.result}`)}
                </span>
              </div>
              <p>{attempt.feedback}</p>
              <div className="dsh-explain-review-result-footer">
                <small>{t('review.next')} {new Date(attempt.nextReviewAt).toLocaleString()}</small>
                {sources[attempt.sourceSessionId] !== undefined && attempt.sourceSessionId !== sessionId && (
                  <Button size="sm" variant="outline" onClick={() => { onOpenSource(attempt.sourceSessionId) }}>
                    {t('action.openSource')}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Metric({ value, label }: { readonly value: number | string; readonly label: string }) {
  return <div className="dsh-explain-metric"><strong>{value}</strong><span>{label}</span></div>
}

const PROFILE_DIMENSIONS = ['verbosity', 'structure', 'examples', 'terminology'] as const

function ContextPanel({ snapshot, sessionId, sources, onUpdate, onOpenSource, t }: {
  readonly snapshot: LearningSnapshot
  readonly sessionId: SessionId
  readonly sources: SessionListState['byId']
  readonly onUpdate: LearningViewInjected['updateLearnerProfile']
  readonly onOpenSource: LearningViewInjected['openSource']
  readonly t: LearningViewProps['t']
}) {
  const context = snapshot.context!
  return (
    <section className="dsh-explain-section">
      <h2 className="dsh-explain-section-title">
        {t('section.context')}
        {context.inferred && <span className="dsh-explain-badge">{t('status.inferred')}</span>}
      </h2>
      <div className="dsh-explain-context">
        {context.inferred
          ? <>
            <div className="dsh-explain-context-block">
              <h3>{t('context.knowledge')}</h3><p>{context.knowledgeOverview}</p>
            </div>
            <div className="dsh-explain-context-block">
              <h3>{t('context.trend')}</h3><p>{context.learningTrend}</p>
            </div>
          </>
          : <div className="dsh-explain-empty dsh-explain-context-wide">{t('status.noContext')}</div>}
        {snapshot.profileError !== undefined && (
          <div className="dsh-explain-error dsh-explain-context-wide" role="alert">{snapshot.profileError}</div>
        )}
        <div className="dsh-explain-context-block dsh-explain-context-wide">
          <h3>{t('context.preferences')}</h3>
          <p className="dsh-explain-profile-intro">{t('profile.intro')}</p>
          <div className="dsh-explain-profile-list">
            {PROFILE_DIMENSIONS.map(dimension => (
              <DialogueProfileRow
                key={dimension}
                dimension={dimension}
                item={context.dialogueProfile.find(candidate => candidate.kind === dimension)}
                pending={snapshot.profilePendingKeys?.includes(`dialogue-preference:${dimension}`) === true}
                sessionId={sessionId}
                sources={sources}
                onUpdate={onUpdate}
                onOpenSource={onOpenSource}
                t={t}
              />
            ))}
          </div>
        </div>
        <div className="dsh-explain-context-block dsh-explain-context-wide">
          <h3>{t('context.familiarity')}</h3>
          {(context.topicFamiliarities ?? []).length === 0
            ? <div className="dsh-explain-empty">{t('profile.noTopics')}</div>
            : <div className="dsh-explain-profile-list">
                {(context.topicFamiliarities ?? []).map(item => (
                  <TopicProfileRow
                    key={item.topicKey}
                    item={item}
                    pending={snapshot.profilePendingKeys?.includes(`topic-familiarity:${item.topicKey}`) === true}
                    sessionId={sessionId}
                    sources={sources}
                    onUpdate={onUpdate}
                    onOpenSource={onOpenSource}
                    t={t}
                  />
                ))}
              </div>}
        </div>
        {(context.profileAudit ?? []).length > 0 && (
          <details className="dsh-explain-profile-audit dsh-explain-context-wide">
            <summary>{t('profile.audit')}</summary>
            {(context.profileAudit ?? []).slice(0, 5).map(event => (
              <div key={event.eventId}>
                <span>{new Date(event.createdAt).toLocaleString()}</span>
                <strong>{t(`profile.action.${event.action}`)}</strong>
                <code>{event.targetKey}</code>
                {event.value !== undefined && <span>{event.value}</span>}
              </div>
            ))}
          </details>
        )}
      </div>
    </section>
  )
}

function DialogueProfileRow({ dimension, item, pending, sessionId, sources, onUpdate, onOpenSource, t }: {
  readonly dimension: DialoguePreferenceView['kind']
  readonly item: DialoguePreferenceView | undefined
  readonly pending: boolean
  readonly sessionId: SessionId
  readonly sources: SessionListState['byId']
  readonly onUpdate: LearningViewInjected['updateLearnerProfile']
  readonly onOpenSource: LearningViewInjected['openSource']
  readonly t: LearningViewProps['t']
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(item?.preference ?? '')
  useEffect(() => { if (!editing) setValue(item?.preference ?? '') }, [editing, item?.preference])
  const source = item?.evidence?.find(candidate => candidate.sourceSessionId !== undefined)
  const itemAuthority = item?.authority ?? 'inferred'
  const authority = item === undefined ? 'explicit' : itemAuthority === 'inferred' ? 'correction' : itemAuthority
  return (
    <div className="dsh-explain-profile-row">
      <div className="dsh-explain-profile-copy">
        <strong>{t(`profile.dimension.${dimension}`)}</strong>
        {item === undefined
          ? <span className="dsh-explain-profile-empty">{t('profile.unknown')}</span>
          : <span>{item.preference}</span>}
        {item !== undefined && (
          <div className="dsh-explain-profile-meta">
            <span className="dsh-explain-badge">{t(`profile.authority.${itemAuthority}`)}</span>
            {itemAuthority === 'inferred' && <span>{t('profile.confidence')} {t(`profile.confidence.${item.confidence}`)}</span>}
            <ProfileSource source={source} sessionId={sessionId} sources={sources} onOpenSource={onOpenSource} t={t} />
          </div>
        )}
      </div>
      {editing
        ? <div className="dsh-explain-profile-editor">
            <input
              value={value}
              maxLength={240}
              autoFocus
              aria-label={t(`profile.dimension.${dimension}`)}
              onChange={event => { setValue(event.target.value) }}
            />
            <Button size="sm" variant="primary" disabled={pending || value.trim() === ''} onClick={() => {
              void onUpdate({
                targetKind: 'dialogue-preference', targetKey: dimension, action: 'set',
                value: value.trim(), authority,
                ...(source?.observationId === undefined ? {} : { sourceObservationId: source.observationId }),
              }).then((ok) => { if (ok) setEditing(false) })
            }}>{pending ? t('action.pending') : t('action.save')}</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(false) }}>
              {t('action.cancel')}
            </Button>
          </div>
        : <div className="dsh-explain-actions">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(true) }}>
              {item === undefined ? t('profile.set') : t('profile.correct')}
            </Button>
            {item !== undefined && <Button size="sm" variant="outline" disabled={pending} onClick={() => {
              void onUpdate({
                targetKind: 'dialogue-preference', targetKey: dimension, action: 'forget',
                ...(source?.observationId === undefined ? {} : { sourceObservationId: source.observationId }),
              })
            }}>{t('profile.forget')}</Button>}
          </div>}
    </div>
  )
}

function TopicProfileRow({ item, pending, sessionId, sources, onUpdate, onOpenSource, t }: {
  readonly item: TopicFamiliarityView
  readonly pending: boolean
  readonly sessionId: SessionId
  readonly sources: SessionListState['byId']
  readonly onUpdate: LearningViewInjected['updateLearnerProfile']
  readonly onOpenSource: LearningViewInjected['openSource']
  readonly t: LearningViewProps['t']
}) {
  const [editing, setEditing] = useState(false)
  const [level, setLevel] = useState(item.level)
  useEffect(() => { if (!editing) setLevel(item.level) }, [editing, item.level])
  const source = item.evidence.find(candidate => candidate.sourceSessionId !== undefined)
  const authority = item.authority === 'inferred' ? 'correction' : item.authority
  return (
    <div className="dsh-explain-profile-row">
      <div className="dsh-explain-profile-copy">
        <strong>{item.topicKey}</strong><span>{t(`profile.level.${item.level}`)}</span>
        <div className="dsh-explain-profile-meta">
          <span className="dsh-explain-badge">{t(`profile.authority.${item.authority}`)}</span>
          {item.authority === 'inferred' && <span>{t('profile.confidence')} {t(`profile.confidence.${item.confidence}`)}</span>}
          <ProfileSource source={source} sessionId={sessionId} sources={sources} onOpenSource={onOpenSource} t={t} />
        </div>
      </div>
      {editing
        ? <div className="dsh-explain-profile-editor">
            <select value={level} aria-label={t('context.familiarity')}
              onChange={event => { setLevel(event.target.value as TopicFamiliarityView['level']) }}>
              {(['unknown', 'beginner', 'working', 'advanced'] as const).map(value => (
                <option key={value} value={value}>{t(`profile.level.${value}`)}</option>
              ))}
            </select>
            <Button size="sm" variant="primary" disabled={pending} onClick={() => {
              void onUpdate({
                targetKind: 'topic-familiarity', targetKey: item.topicKey, action: 'set', value: level, authority,
                ...(source?.observationId === undefined ? {} : { sourceObservationId: source.observationId }),
              }).then((ok) => { if (ok) setEditing(false) })
            }}>{pending ? t('action.pending') : t('action.save')}</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(false) }}>
              {t('action.cancel')}
            </Button>
          </div>
        : <div className="dsh-explain-actions">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(true) }}>
              {t('profile.correct')}
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => {
              void onUpdate({
                targetKind: 'topic-familiarity', targetKey: item.topicKey, action: 'forget',
                ...(source?.observationId === undefined ? {} : { sourceObservationId: source.observationId }),
              })
            }}>{t('profile.forget')}</Button>
          </div>}
    </div>
  )
}

function ProfileSource({ source, sessionId, sources, onOpenSource, t }: {
  readonly source: LearnerProfileEvidenceView | undefined
  readonly sessionId: SessionId
  readonly sources: SessionListState['byId']
  readonly onOpenSource: LearningViewInjected['openSource']
  readonly t: LearningViewProps['t']
}) {
  if (source?.sourceSessionId === undefined) return null
  const available = sources[source.sourceSessionId] !== undefined
  if (!available) return <span className="dsh-explain-source-unavailable">{t('entry.sourceUnavailable')}</span>
  const label = `${t('profile.source')}${source.sourceTurn === undefined ? '' : ` · ${t('entry.turn')} ${source.sourceTurn}`}`
  return source.sourceSessionId === sessionId
    ? <span>{label}</span>
    : <button className="dsh-explain-profile-source" type="button" onClick={() => { onOpenSource(source.sourceSessionId!) }}>
        {label}
      </button>
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
      {entry.origin === 'selection' && <span>{t('entry.selection')}</span>}
      {entry.origin === 'answer' && <span>{t('entry.answer')}</span>}
      {entry.origin === 'suggested' && <span>{t('entry.suggested')}</span>}
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
