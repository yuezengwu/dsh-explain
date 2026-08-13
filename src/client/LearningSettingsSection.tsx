import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ExplainConfigurationView,
  ExplainStatusView,
  UpdateConfigurationRequest,
} from 'dsh-explain/types'
import type { LearningSnapshot } from './learning-store.ts'
import { diagnosticState } from './diagnostics.ts'

/** Global settings-page actions layered over the shared learning snapshot. */
export interface LearningSettingsInjected {
  hooks: { learning: SnapshotStore<LearningSnapshot> }
  activate: () => () => void
  refresh: () => Promise<void>
  updateConfiguration: (request: UpdateConfigurationRequest) => Promise<void>
}

type LearningSettingsProps = InjectFace<LearningSettingsInjected> & PropsLocale<'explain'>

interface SettingsDraft {
  readonly revision: number
  readonly enabled: boolean
  readonly provider: string
  readonly model: string
  readonly maxAutoRequestsPerDay: string
}

/** Settings page for ordinary learning-mode controls and runtime diagnostics. */
export function LearningSettingsSection({
  useLearning, activate, refresh, updateConfiguration, t,
}: LearningSettingsProps) {
  useEffect(() => activate(), [activate])
  const snapshot = useLearning(value => value)
  const [draft, setDraft] = useState<SettingsDraft | undefined>(undefined)
  useEffect(() => {
    if (snapshot.configuration === undefined) return
    setDraft(draftOf(snapshot.configuration))
  }, [snapshot.configuration?.revision])

  const providers = snapshot.modelCatalog?.providers ?? []
  const selectedProvider = providers.find(provider => provider.id === draft?.provider)
  const providerValues = useMemo(() => {
    if (draft?.provider === undefined || draft.provider === '' || selectedProvider !== undefined) return providers
    return [{ id: draft.provider, name: draft.provider, models: [] }, ...providers]
  }, [draft?.provider, providers, selectedProvider])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (draft === undefined) return
    const limit = Number(draft.maxAutoRequestsPerDay)
    void updateConfiguration({
      expectedRevision: draft.revision,
      enabled: draft.enabled,
      ...(draft.provider.trim() === '' ? {} : { provider: draft.provider.trim() }),
      ...(draft.model.trim() === '' ? {} : { model: draft.model.trim() }),
      maxAutoRequestsPerDay: limit,
    })
  }

  return (
    <div className="dsh-explain-settings" data-testid="dsh-explain-settings-section">
      <div className="dsh-explain-settings-heading">
        <div>
          <h2>{t('settings.title')}</h2>
          <p>{t('settings.intro')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { void refresh() }}>{t('action.refresh')}</Button>
      </div>

      {snapshot.configurationError !== undefined && (
        <div className="dsh-explain-error" role="alert">{snapshot.configurationError}</div>
      )}
      {snapshot.modelCatalogError !== undefined && (
        <div className="dsh-explain-error" role="alert">{snapshot.modelCatalogError}</div>
      )}

      {draft === undefined
        ? <div className="dsh-explain-empty">{t('status.loading')}</div>
        : (
          <form className="dsh-explain-settings-form" onSubmit={submit}>
            <label className="dsh-explain-toggle">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={event => { setDraft({ ...draft, enabled: event.currentTarget.checked }) }}
              />
              <span><strong>{t('settings.enabled')}</strong><small>{t('settings.enabledHelp')}</small></span>
            </label>

            <label className="dsh-explain-control">
              <span>{t('settings.provider')}</span>
              <select
                value={draft.provider}
                onChange={event => { setDraft({ ...draft, provider: event.currentTarget.value, model: '' }) }}
              >
                <option value="">{t('settings.providerPlaceholder')}</option>
                {providerValues.map(provider => (
                  <option value={provider.id} key={provider.id}>{provider.name} ({provider.id})</option>
                ))}
              </select>
            </label>

            <label className="dsh-explain-control">
              <span>{t('settings.model')}</span>
              <input
                value={draft.model}
                list="dsh-explain-model-options"
                placeholder={t('settings.modelPlaceholder')}
                onChange={event => { setDraft({ ...draft, model: event.currentTarget.value }) }}
              />
              <datalist id="dsh-explain-model-options">
                {(selectedProvider?.models ?? []).map(model => (
                  <option value={model.id} key={model.id}>{model.name}</option>
                ))}
              </datalist>
              <small>{selectedProvider?.error?.message ?? t('settings.modelHelp')}</small>
            </label>

            <label className="dsh-explain-control">
              <span>{t('settings.budget')}</span>
              <input
                type="number"
                min="1"
                step="1"
                value={draft.maxAutoRequestsPerDay}
                onChange={event => { setDraft({ ...draft, maxAutoRequestsPerDay: event.currentTarget.value }) }}
              />
              <small>{t('settings.budgetHelp')}</small>
            </label>

            <div className="dsh-explain-settings-actions">
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={snapshot.configurationPending || !validDraft(draft)}
              >
                {snapshot.configurationPending ? t('action.saving') : t('action.save')}
              </Button>
              <span>{t('settings.revision')} {draft.revision}</span>
            </div>
          </form>
        )}

      <Diagnostics status={snapshot.status} t={t} />
    </div>
  )
}

function Diagnostics({ status, t }: {
  readonly status: ExplainStatusView | undefined
  readonly t: LearningSettingsProps['t']
}) {
  if (status === undefined) return null
  return (
    <section className="dsh-explain-diagnostics">
      <h3>{t('settings.diagnostics')}</h3>
      <div className="dsh-explain-diagnostic-state" data-state={diagnosticState(status)}>
        {diagnosticLabel(status, t)}
      </div>
      {status.lastError !== undefined && (
        <div className="dsh-explain-error" role="alert">{status.lastError.code}: {status.lastError.message}</div>
      )}
      <dl>
        <Diagnostic label={t('diagnostic.route')} value={routeLabel(status, t)} />
        <Diagnostic
          label={t('diagnostic.budget')}
          value={`${status.autoRequestsUsed}/${status.autoRequestsLimit}`}
        />
        <Diagnostic label={t('diagnostic.resume')} value={formatTime(status.autoRequestsResumeAt, t)} />
        <Diagnostic label={t('diagnostic.pressure')} value={formatPressure(status.estimatedContextRatio, t)} />
        <Diagnostic label={t('diagnostic.active')} value={String(status.activeExplanationCount)} />
        <Diagnostic label={t('diagnostic.candidates')} value={String(status.pendingCandidateCount)} />
        <Diagnostic label={t('diagnostic.lastAction')} value={formatTime(status.lastUserActionAt, t)} />
        <Diagnostic label={t('diagnostic.lastCompaction')} value={formatTime(status.lastCompactedAt, t)} />
      </dl>
    </section>
  )
}

function Diagnostic({ label, value }: { readonly label: string; readonly value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}

function diagnosticLabel(status: ExplainStatusView, t: LearningSettingsProps['t']): string {
  switch (diagnosticState(status)) {
    case 'disabled': return t('diagnostic.disabled')
    case 'failed': return t('diagnostic.failed')
    case 'unconfigured': return t('diagnostic.unconfigured')
    case 'budget-exhausted': return t('diagnostic.budget-exhausted')
    case 'ready': return t('diagnostic.ready')
  }
}

function routeLabel(status: ExplainStatusView, t: LearningSettingsProps['t']): string {
  if (status.provider === undefined || status.model === undefined) return t('diagnostic.none')
  const capacity = status.contextWindow === undefined ? '' : ` · ${status.contextWindow.toLocaleString()} tokens`
  return `${status.provider}/${status.model}${capacity}`
}

function formatPressure(value: number | undefined, t: LearningSettingsProps['t']): string {
  return value === undefined ? t('diagnostic.none') : `${(value * 100).toFixed(1)}%`
}

function formatTime(value: number | undefined, t: LearningSettingsProps['t']): string {
  return value === undefined ? t('diagnostic.never') : new Date(value).toLocaleString()
}

function draftOf(configuration: ExplainConfigurationView): SettingsDraft {
  return {
    revision: configuration.revision,
    enabled: configuration.enabled,
    provider: configuration.provider ?? '',
    model: configuration.model ?? '',
    maxAutoRequestsPerDay: String(configuration.maxAutoRequestsPerDay),
  }
}

function validDraft(draft: SettingsDraft): boolean {
  const limit = Number(draft.maxAutoRequestsPerDay)
  return Number.isSafeInteger(limit) && limit > 0
}
