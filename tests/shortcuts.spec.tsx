// @vitest-environment jsdom
import React, { type ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  assistantTurn,
  commitExplainDraft,
  ExplainAnswerShortcut,
  ExplainSelectionShortcut,
  normalizeShortcutSelection,
  type ExplainDraftInput,
} from '../src/client/ExplainShortcuts.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

describe('Explain-owned shortcuts', () => {
  it('normalizes a bounded selection while preserving line breaks', () => {
    expect(normalizeShortcutSelection('  first\r\n\tsecond\n\n\nthird  ')).toBe('first\n second\n\nthird')
    expect(normalizeShortcutSelection('x'.repeat(10_001))).toHaveLength(10_000)
  })

  it('admits a draft only from a live plain and empty input', () => {
    let state = { phase: 'plain', draft: '' }
    const input: ExplainDraftInput = {
      state: { getSnapshot: () => state },
      setDraft: (draft) => { state = { ...state, draft } },
    }
    expect(commitExplainDraft(input, '/explain one')).toEqual({ ok: true })
    expect(state.draft).toBe('/explain one')
    expect(commitExplainDraft(input, '/explain overwrite')).toEqual({ ok: false, reason: 'nonempty-draft' })
    state = { phase: 'submitting', draft: '' }
    expect(commitExplainDraft(input, '/explain busy')).toEqual({ ok: false, reason: 'busy' })
    expect(commitExplainDraft(undefined, '/explain gone')).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('captures selected text into an editable command without submitting', async () => {
    const draft = vi.fn().mockReturnValue({ ok: true })
    const props = {
      input: { phase: 'plain', draft: '' },
      draft,
      t: (key: keyof typeof zh) => zh[key],
    } as unknown as ComponentProps<typeof ExplainSelectionShortcut>
    render(React.createElement(React.Fragment, null,
      React.createElement('p', { 'data-testid': 'source' }, 'first line', React.createElement('br'), 'second line'),
      React.createElement(ExplainSelectionShortcut, props),
    ))
    const source = screen.getByTestId('source')
    const range = document.createRange()
    range.selectNodeContents(source)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    const button = screen.getByRole('button', { name: '解释选中文字' })
    await waitFor(() => { expect(button.getAttribute('aria-disabled')).toBeNull() })
    fireEvent.pointerDown(button)
    fireEvent.click(button)
    expect(draft).toHaveBeenCalledOnce()
    expect(draft.mock.calls[0]?.[0]).toMatch(/^\/explain --selection first line\s*second line$/u)
  })

  it('maps each finalized assistant action to its exact source turn', () => {
    const snapshot = {
      nodes: [
        { kind: 'assistant', messageId: 'older', turn: 2 },
        { kind: 'assistant', messageId: 'target', turn: 7 },
      ],
    } as unknown as ConversationSnapshot
    expect(assistantTurn(snapshot, 'target')).toBe(7)
    expect(assistantTurn(snapshot, 'missing')).toBeUndefined()
    const draft = vi.fn().mockReturnValue({ ok: true })
    const props = {
      messageId: 'target',
      useSession: (selector: (value: ConversationSnapshot) => unknown) => selector(snapshot),
      useInput: (selector: (value: { phase: string; draft: string }) => unknown) => selector({
        phase: 'plain', draft: '',
      }),
      draft,
      t: (key: keyof typeof zh) => zh[key],
    } as unknown as ComponentProps<typeof ExplainAnswerShortcut>
    render(React.createElement(ExplainAnswerShortcut, props))
    fireEvent.click(screen.getByRole('button', { name: '学习这个回答' }))
    expect(draft).toHaveBeenCalledWith('/explain --answer 7 请解释这个回答中最关键、最值得学习的概念。')
  })
})
