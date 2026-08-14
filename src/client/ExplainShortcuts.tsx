/** Explain-owned composer and assistant-message shortcuts. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconSparkle16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from './locales.ts'

const MAX_SELECTION_CHARS = 10_000

/** The live input facade needed for one compare-before-write draft mutation. */
export interface ExplainDraftInput {
  readonly state: {
    getSnapshot(): { readonly phase: string; readonly draft: string }
  }
  setDraft(text: string): void
}

/** Stable result of a shortcut draft attempt. */
export type ExplainDraftResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unavailable' | 'busy' | 'nonempty-draft' | 'rejected' }

/** Per-Session mutation supplied by the Explain client plugin. */
export interface ExplainShortcutInjected {
  /** Write a command only while the current input remains plain and empty. */
  draft(command: string): ExplainDraftResult
}

/** Full props of the composer selection shortcut. */
export type ExplainSelectionShortcutProps =
  PropsRuntime<'conversation.input.left'>
  & InjectFace<ExplainShortcutInjected>
  & PropsLocale<'explain'>

/** Full props of the finalized assistant-message shortcut. */
export type ExplainAnswerShortcutProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<ExplainShortcutInjected>
  & PropsLocale<'explain'>

/** Normalize visible browser text while retaining meaningful line breaks. */
export function normalizeShortcutSelection(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t \u00a0\u1680\u2000-\u200b\u202f\u205f\u3000]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .slice(0, MAX_SELECTION_CHARS)
}

/** Commit one command without overwriting a newer draft or a busy composer. */
export function commitExplainDraft(input: ExplainDraftInput | undefined, command: string): ExplainDraftResult {
  if (input === undefined) return { ok: false, reason: 'unavailable' }
  const state = input.state.getSnapshot()
  if (state.phase !== 'plain') return { ok: false, reason: 'busy' }
  if (state.draft.trim() !== '') return { ok: false, reason: 'nonempty-draft' }
  input.setDraft(command)
  return input.state.getSnapshot().draft === command
    ? { ok: true }
    : { ok: false, reason: 'rejected' }
}

/** Resolve a finalized assistant message to its exact source turn. */
export function assistantTurn(snapshot: ConversationSnapshot, messageId: unknown): number | undefined {
  for (let index = snapshot.nodes.length - 1; index >= 0; index -= 1) {
    const node = snapshot.nodes[index]
    if (node?.kind === 'assistant' && node.messageId === messageId) return node.turn
  }
  return undefined
}

function selectedText(): string {
  return normalizeShortcutSelection(window.getSelection()?.toString() ?? '')
}

function failureCopy(result: ExplainDraftResult, t: ExplainSelectionShortcutProps['t']): string | null {
  if (result.ok) return null
  if (result.reason === 'busy') return t('shortcut.error.busy')
  if (result.reason === 'nonempty-draft') return t('shortcut.error.draftOccupied')
  return t('shortcut.error.unavailable')
}

/** Composer-row action that turns the current browser selection into an editable command. */
export function ExplainSelectionShortcut({ input, draft, t }: ExplainSelectionShortcutProps) {
  const [selection, setSelection] = useState(selectedText)
  const [status, setStatus] = useState<string | null>(null)
  const pointerSelection = useRef('')
  useEffect(() => {
    const refresh = () => { setSelection(selectedText()) }
    document.addEventListener('selectionchange', refresh)
    refresh()
    return () => { document.removeEventListener('selectionchange', refresh) }
  }, [])
  const blocked = input.phase !== 'plain' || input.draft.trim() !== ''
  const unavailable = selection === '' || blocked
  const label = selection === ''
    ? t('shortcut.selection.empty')
    : input.draft.trim() !== ''
      ? t('shortcut.error.draftOccupied')
      : input.phase !== 'plain'
        ? t('shortcut.error.busy')
        : t('shortcut.selection')
  const capture = useCallback(() => {
    pointerSelection.current = selectedText()
  }, [])
  const activate = useCallback(() => {
    const text = pointerSelection.current || selectedText()
    pointerSelection.current = ''
    if (text === '') return
    setStatus(failureCopy(draft(`/explain --selection ${text}`), t))
  }, [draft, t])

  return (
    <>
      <Tooltip label={label} side="top">
        <button
          type="button"
          className="dsh-explain-shortcut"
          aria-label={t('shortcut.selection')}
          aria-disabled={unavailable || undefined}
          data-unavailable={unavailable || undefined}
          onPointerDown={capture}
          onClick={activate}
        >
          <IconSparkle16 />
        </button>
      </Tooltip>
      {status !== null && <span className="dsh-explain-visually-hidden" role="status">{status}</span>}
    </>
  )
}

/** Per-message action that drafts an exact-turn learning request. */
export function ExplainAnswerShortcut({ messageId, useSession, useInput, draft, t }: ExplainAnswerShortcutProps) {
  const turn = useSession(snapshot => assistantTurn(snapshot, messageId))
  const input = useInput(snapshot => snapshot)
  const [status, setStatus] = useState<string | null>(null)
  const unavailable = turn === undefined || input.phase !== 'plain' || input.draft.trim() !== ''
  const label = turn === undefined
    ? t('shortcut.error.sourceUnavailable')
    : input.draft.trim() !== ''
      ? t('shortcut.error.draftOccupied')
      : input.phase !== 'plain'
        ? t('shortcut.error.busy')
        : t('shortcut.answer')
  const activate = useCallback(() => {
    if (turn === undefined) return
    const command = `/explain --answer ${turn} ${t('shortcut.answer.request')}`
    setStatus(failureCopy(draft(command), t))
  }, [draft, t, turn])

  return (
    <>
      <Tooltip label={label} side="bottom">
        <button
          type="button"
          className="dsh-explain-shortcut"
          aria-label={t('shortcut.answer')}
          aria-disabled={unavailable || undefined}
          data-unavailable={unavailable || undefined}
          onClick={activate}
        >
          <IconSparkle16 />
        </button>
      </Tooltip>
      {status !== null && <span className="dsh-explain-visually-hidden" role="status">{status}</span>}
    </>
  )
}
