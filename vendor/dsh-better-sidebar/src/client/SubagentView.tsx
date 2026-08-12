/**
 * Subagent page: the FULL agent topology of the current tree's main session.
 *
 * The root is resolved by walking the durable parent chain upward from the
 * current session to the first non-subagent session — the MAIN session — and
 * every subagent under it shares this one topology view, no matter how deep
 * the current selection is (including a subagent transcript opened in the
 * main view). The main agent renders as the root node card (click it to jump
 * back to the main session), with its subagents hanging below it in clearly
 * LAYERED levels: tree connector lines (first level included) and per-level
 * indentation show the hierarchy, and the currently-open session is
 * highlighted in place. Every branch is expanded automatically (lazy
 * catalogs hydrate on demand and consume live membership while visible).
 *
 * Each node card carries live status (state dot, durable label, mode and
 * activity); while a child RUNS, its card additionally shows the LAST text
 * output and LAST tool call pulled from its history tail, auto-refreshing
 * every few seconds while the page is visible. Clicking a card jumps
 * straight into the child transcript (`openSubagent`); the page stays open
 * and the topology remains rooted at the main session.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useSyncExternalStore } from 'react'
import clsx from 'clsx'
import {
  IconRefreshOutline14, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  Context,
  SidebarSessionSummary,
  SidebarSubagentAddress,
  SidebarSubagentCatalog,
  SidebarSubagentChildEntry,
  SidebarSubagentDiagnosticEntry,
} from '../context-types.ts'
import {
  collectBranchIds,
  countSubagentDescendants,
  rootAncestor,
} from './subagent-detect.ts'
import { lastActivity } from './subagent-activity.ts'
import { t } from './locales.ts'
import css from './SubagentView.module.css'

/** Refresh cadence of the live "last text + tool call" lines while a child runs. */
const POLL_MS = 3000
/** Preview cap of one tool-call argument line. */
const ARGS_PREVIEW = 60

/** The direct subagent children of one parent (durable `origin` rows). */
function directChildren(
  byId: Readonly<Record<string, SidebarSessionSummary>>,
  parentSessionId: string,
): SidebarSessionSummary[] {
  return Object.values(byId).filter(
    summary => summary.origin === 'subagent' && summary.parentId === parentSessionId,
  )
}

/** Human label of one catalog child: durable label, then summary title, then id. */
function childLabel(
  entry: SidebarSubagentChildEntry,
  summary: SidebarSessionSummary | undefined,
): string {
  return entry.label ?? summary?.displayTitle ?? entry.id
}

function diagnosticReason(entry: SidebarSubagentDiagnosticEntry): string {
  switch (entry.reason) {
    case 'corrupt': return t('subagentDiagCorrupt')
    case 'unsupported': return t('subagentDiagUnsupported')
    case 'unavailable': return t('subagentDiagUnavailable')
  }
}

/** The secondary line of one card: title · mode · activity (skips empty parts). */
function cardSecondary(
  summary: SidebarSessionSummary | undefined,
  entry: SidebarSubagentChildEntry,
): string {
  return [
    summary?.displayTitle,
    entry.mode === 'one-shot' ? t('subagentModeOneShot') : t('subagentModeContinuable'),
    entry.activity === 'running' ? t('subagentRunning') : t('subagentInactive'),
  ].filter(Boolean).join(' · ')
}

/** First `limit` characters with an ellipsis when truncated. */
function preview(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** Collapse whitespace for the single-paragraph live-text preview. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Disabled "loading…" cards backed by the summary mirror while a catalog hydrates. */
function CatalogLoadingRows(props: {
  parentSessionId: string
  byId: Readonly<Record<string, SidebarSessionSummary>>
  level: number
}) {
  const { parentSessionId, byId, level } = props
  const children = directChildren(byId, parentSessionId)
  if (children.length === 0) {
    return <div className={css.subagentEmpty}>{t('loading')}</div>
  }
  return (
    <>
      {children.map(summary => (
        <div
          key={summary.id}
          role="treeitem"
          aria-disabled="true"
          aria-level={level}
          aria-label={t('loading')}
          className={`${css.subagentRow} ${css.subagentRowDisabled} ${css.subagentRowLoading}`}
        >
          <StateDot state={summary.running === true ? 'ongoing' : 'done'} className={css.subagentDot} />
          <span className={css.subagentContent}>
            <span className={css.subagentLabel}>{t('loading')}</span>
          </span>
        </div>
      ))}
    </>
  )
}

/**
 * The live lines of one RUNNING subagent card: the last text output and the
 * last tool call of the child's history tail, refreshed every few seconds
 * while the page is visible. Idle cards render nothing (a quiet topology); a
 * running child with neither output yet reads "thinking…".
 */
function SubagentLiveLines(props: {
  ctx: Context
  parentSessionId: string
  childSessionId: string
  mode: SidebarSubagentAddress['mode']
  running: boolean
  /** The page is visible (active tab + open panel): skip polling otherwise. */
  active: boolean
}) {
  const { ctx, parentSessionId, childSessionId, mode, running, active } = props
  const [live, setLive] = useState<ReturnType<typeof lastActivity>>({})
  const controllerRef = useRef<AbortController | undefined>(undefined)
  const address = useMemo(
    () => ({ parentSessionId, childSessionId, mode }),
    [parentSessionId, childSessionId, mode],
  )

  const load = useCallback(async (): Promise<void> => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const response = await ctx.connection.api.subagents.history(
        { ...address, maxMessages: 12 },
        controller.signal,
      )
      if (!response.result.ok) return
      setLive(lastActivity(response.result.value.events))
    } catch {
      // Aborted by a newer pull or a wire failure: keep the last known lines.
    }
  }, [ctx, address])

  useEffect(() => {
    if (!active) return
    void load()
    if (!running) return
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [load, running, active])

  useEffect(() => () => { controllerRef.current?.abort() }, [])

  if (!running) return null
  if (live.text === undefined && live.tool === undefined) {
    return <span className={css.subagentLive}>{t('subagentThinking')}</span>
  }
  return (
    <>
      {live.tool !== undefined && (
        <span className={css.subagentLive}>
          <span className={css.subagentLiveTool}>{live.tool.name}</span>
          {live.tool.args !== '' && (
            <span className={css.subagentLiveArgs}>{preview(live.tool.args, ARGS_PREVIEW)}</span>
          )}
        </span>
      )}
      {live.text !== undefined && (
        <span className={css.subagentLiveText}>{flatten(live.text)}</span>
      )}
    </>
  )
}

interface RowsProps {
  parentSessionId: string
  catalog: SidebarSubagentCatalog | undefined
  catalogs: Readonly<Record<string, SidebarSubagentCatalog>>
  byId: Readonly<Record<string, SidebarSessionSummary>>
  level: number
  /** The currently-open session id (highlighted in the topology). */
  currentSessionId: string
  /** The page is visible (active tab + open panel): live polling pauses otherwise. */
  active: boolean
  ctx: Context
  openChild: (address: SidebarSubagentAddress) => void
  refresh: (parentSessionId: string) => void
}

/** Render one topology level; branches are always expanded (lazy catalogs). */
function CatalogRows({
  parentSessionId, catalog, catalogs, byId, level, currentSessionId, active, ctx,
  openChild, refresh,
}: RowsProps) {
  const emptyLoading = catalog?.state === 'loading' && catalog.entries.length === 0
  return (
    <>
      {emptyLoading && (
        <CatalogLoadingRows parentSessionId={parentSessionId} byId={byId} level={level} />
      )}
      {catalog?.state === 'error' && (
        <div className={css.subagentError}>
          <span>{catalog.error?.message ?? t('error')}</span>
          <button
            type="button"
            className={css.subagentErrorRetry}
            onClick={() => { refresh(parentSessionId) }}
          >
            <IconRefreshOutline14 />
            {t('retry')}
          </button>
        </div>
      )}
      {(catalog?.entries ?? []).map((entry) => {
        if (entry.kind === 'diagnostic') {
          return (
            <div key={entry.id} className={css.subagentNode}>
              <div
                role="treeitem"
                aria-disabled="true"
                aria-level={level}
                className={`${css.subagentRow} ${css.subagentRowDisabled}`}
                title={diagnosticReason(entry)}
              >
                <StateDot state="error" className={css.subagentDot} />
                <span className={css.subagentContent}>
                  <span className={css.subagentLabel}>{entry.id}</span>
                  <span className={css.subagentSecondary}>{diagnosticReason(entry)}</span>
                </span>
              </div>
            </div>
          )
        }

        const childCatalog = catalogs[entry.id]
        const knownLeaf = !entry.hasChildren
        const summary = byId[entry.id]
        const label = childLabel(entry, summary)
        const secondary = cardSecondary(summary, entry)
        const childLoading = childCatalog === undefined
          || (childCatalog.state === 'loading' && childCatalog.entries.length === 0)
        const address: SidebarSubagentAddress = {
          parentSessionId,
          childSessionId: entry.id,
          mode: entry.mode,
        }
        const current = entry.id === currentSessionId

        return (
          <div key={entry.id} className={css.subagentNode}>
            <div
              role="treeitem"
              tabIndex={0}
              aria-level={level}
              aria-label={`${label} ${secondary}`}
              aria-current={current ? 'true' : undefined}
              {...knownLeaf ? {} : { 'aria-expanded': true }}
              className={clsx(css.subagentRow, current && css.subagentRowActive)}
              onClick={() => { openChild(address) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  openChild(address)
                }
              }}
            >
              <StateDot
                state={entry.activity === 'running' ? 'ongoing' : 'done'}
                className={css.subagentDot}
              />
              <span className={css.subagentContent}>
                <span className={css.subagentLabel}>{label}</span>
                <span className={css.subagentSecondary}>{secondary}</span>
                <SubagentLiveLines
                  ctx={ctx}
                  parentSessionId={parentSessionId}
                  childSessionId={entry.id}
                  mode={entry.mode}
                  running={entry.activity === 'running'}
                  active={active}
                />
              </span>
            </div>
            {!knownLeaf && (
              <div role="group" className={css.subagentChildren} aria-busy={childLoading || undefined}>
                {childCatalog === undefined
                  ? (
                    <CatalogLoadingRows
                      parentSessionId={entry.id}
                      byId={byId}
                      level={level + 1}
                    />
                  )
                  : (
                    <CatalogRows
                      parentSessionId={entry.id}
                      catalog={childCatalog}
                      catalogs={catalogs}
                      byId={byId}
                      level={level + 1}
                      currentSessionId={currentSessionId}
                      active={active}
                      ctx={ctx}
                      openChild={openChild}
                      refresh={refresh}
                    />
                  )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

/**
 * The sidebar's Subagent topology page.
 * @param props - current session id, whether the page is actually visible
 *   (active tab + open panel), the client context, and an optional
 *   jump-notify hook fired right before `openSubagent` (lets the sidebar
 *   shell re-open the Subagent page after the conversation switch lands on
 *   the child session).
 * @returns the main agent's topology tree, or the empty/error/loading states.
 */
export function SubagentView(props: {
  sessionId: string
  active: boolean
  ctx: Context
  onOpenChild?: (address: SidebarSubagentAddress) => void
}) {
  const { sessionId, active, ctx, onOpenChild } = props
  const sessions = ctx.sessions

  // The same list feed the official catalog consumes (byId lineage + the
  // lazy per-parent catalogs). Older DSH snapshots without the subagent seam
  // simply leave these surfaces empty — the page degrades to the empty state.
  const list = useSyncExternalStore(
    useMemo(() => (callback: () => void) => sessions.list.subscribe(callback), [sessions]),
    useCallback(() => sessions.list.getSnapshot(), [sessions]),
  )
  const byId = list.byId
  const catalogs = list.subagentsByParent ?? {}

  // The topology root: the main agent of the current session's tree.
  const rootId = useMemo(() => rootAncestor(byId, sessionId), [byId, sessionId])
  const rootCatalog = rootId === undefined ? undefined : catalogs[rootId]
  const rootSummary = rootId === undefined ? undefined : byId[rootId]

  /** Catalog owners currently consuming live membership updates. */
  const observedRef = useRef(new Set<string>())

  const observe = useCallback((parentSessionId: string, open: boolean): void => {
    sessions.setSubagentCatalogOpen?.(parentSessionId, open)
    if (open) observedRef.current.add(parentSessionId)
    else observedRef.current.delete(parentSessionId)
  }, [sessions])

  // While the page is visible the topology root consumes live membership; a
  // root change (switching to another main agent's tree) or the page hiding
  // (tab switched away / panel collapsed) releases everything observed.
  useEffect(() => {
    if (rootId === undefined || !active) return
    observe(rootId, true)
    return () => {
      for (const parentSessionId of observedRef.current) {
        sessions.setSubagentCatalogOpen?.(parentSessionId, false)
      }
      observedRef.current.clear()
    }
  }, [rootId, active, observe, sessions])

  // Every branch of the always-expanded topology consumes live membership
  // (add-only: a branch stays observed until the root changes or the page
  // hides, which releases the whole set via the root effect's cleanup).
  const branches = useMemo(() => collectBranchIds(catalogs, rootId), [catalogs, rootId])
  useEffect(() => {
    if (!active) return
    for (const id of branches) {
      if (!observedRef.current.has(id)) observe(id, true)
    }
  }, [branches, active, observe])

  // Unobserve everything on unmount (the host stops refreshing unused catalogs).
  useEffect(() => () => {
    for (const parentSessionId of observedRef.current) {
      sessions.setSubagentCatalogOpen?.(parentSessionId, false)
    }
    observedRef.current.clear()
  }, [sessions])

  const openChild = useCallback((address: SidebarSubagentAddress): void => {
    // Notify the shell first: the jump switches the sidebar to the child
    // session's own layout, and the shell re-opens the Subagent page on top
    // of it (the topology stays rooted at the main agent with the child
    // highlighted) — the README "page stays open" contract.
    onOpenChild?.(address)
    try {
      sessions.openSubagent?.(address)
    } catch (error) {
      console.warn('[dsh-better-sidebar] openSubagent failed:', error)
    }
  }, [sessions, onOpenChild])

  /** Jump back to the main agent (the topology root) from its node. */
  const openMain = useCallback((): void => {
    if (rootId === undefined) return
    try {
      sessions.open?.(rootId)
    } catch (error) {
      console.warn('[dsh-better-sidebar] open session failed:', error)
    }
  }, [sessions, rootId])

  const refresh = useCallback((parentSessionId: string): void => {
    void sessions.refreshSubagents?.(parentSessionId)
  }, [sessions])

  const totals = useMemo(
    () => rootId === undefined
      ? { count: 0, runningCount: 0 }
      : countSubagentDescendants(byId, rootId),
    [byId, rootId],
  )
  // Session summaries can announce membership before the descriptor-backed
  // catalog catches up (or a catalog that just went ready is still empty).
  const summaryBackedLoading = rootId !== undefined
    && (rootCatalog === undefined || (rootCatalog.state === 'ready' && rootCatalog.entries.length === 0))
    && directChildren(byId, rootId).length > 0
  const readyEmpty = rootCatalog?.state === 'ready'
    && rootCatalog.entries.length === 0
    && directChildren(byId, rootId ?? '').length === 0
  const countLabel = totals.count === 0
    ? undefined
    : totals.runningCount > 0
      ? t('subagentCountRunning', { count: totals.count, running: totals.runningCount })
      : t('subagentCount', { count: totals.count })

  /** Arrow-key tree navigation over the visible rows (official catalog recipe). */
  const bodyRef = useRef<HTMLDivElement>(null)
  const focusAt = useCallback((index: number): void => {
    const items = bodyRef.current?.querySelectorAll<HTMLElement>(
      '[role="treeitem"]:not([aria-disabled="true"])',
    ) ?? []
    if (items.length === 0) return
    items[(index + items.length) % items.length]?.focus()
  }, [])
  const onTreeKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    const items = bodyRef.current?.querySelectorAll<HTMLElement>(
      '[role="treeitem"]:not([aria-disabled="true"])',
    ) ?? []
    const index = Array.prototype.indexOf.call(items, document.activeElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusAt(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusAt(index < 0 ? items.length - 1 : index - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(items.length - 1)
    }
  }, [focusAt])

  return (
    <div className={css.subagent}>
      <div className={css.subagentHeader}>
        <span className={css.subagentTitle}>
          {t('subagent')}
          {rootSummary?.displayTitle !== undefined && rootSummary.displayTitle !== ''
            ? ` · ${rootSummary.displayTitle}`
            : ''}
        </span>
        {countLabel !== undefined && <span className={css.subagentCount}>{countLabel}</span>}
        <button
          type="button"
          className={css.subagentRefresh}
          aria-label={t('refresh')}
          title={t('refresh')}
          disabled={rootId === undefined}
          onClick={() => { if (rootId !== undefined) refresh(rootId) }}
        >
          <IconRefreshOutline14 />
        </button>
      </div>
      <div
        ref={bodyRef}
        className={css.subagentBody}
        role="tree"
        aria-label={t('subagent')}
        aria-busy={summaryBackedLoading || undefined}
        onKeyDown={onTreeKeyDown}
      >
        {rootId !== undefined && rootSummary !== undefined && (
          <div
            role="treeitem"
            tabIndex={0}
            aria-level={0}
            aria-label={`${rootSummary.displayTitle !== '' ? rootSummary.displayTitle : t('subagentMainAgent')} ${t('subagentMainAgent')}`}
            aria-current={rootId === sessionId ? 'true' : undefined}
            className={clsx(css.subagentRow, rootId === sessionId && css.subagentRowActive)}
            onClick={openMain}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                openMain()
              }
            }}
          >
            <StateDot
              state={rootSummary.running === true ? 'ongoing' : 'done'}
              className={css.subagentDot}
            />
            <span className={css.subagentContent}>
              <span className={css.subagentLabel}>
                {rootSummary.displayTitle !== '' ? rootSummary.displayTitle : t('subagentMainAgent')}
              </span>
              <span className={css.subagentSecondary}>
                {`${t('subagentMainAgent')} · ${rootSummary.running === true ? t('subagentRunning') : t('subagentInactive')}`}
              </span>
            </span>
          </div>
        )}
        {rootId !== undefined && (
          <div className={css.subagentChildren} role="group" aria-busy={summaryBackedLoading || undefined}>
            {summaryBackedLoading && (
              <CatalogLoadingRows parentSessionId={rootId} byId={byId} level={1} />
            )}
            {!summaryBackedLoading && (
              <CatalogRows
                parentSessionId={rootId}
                catalog={rootCatalog}
                catalogs={catalogs}
                byId={byId}
                level={1}
                currentSessionId={sessionId}
                active={active}
                ctx={ctx}
                openChild={openChild}
                refresh={refresh}
              />
            )}
          </div>
        )}
        {readyEmpty && (
          <div className={css.subagentEmpty}>
            <div>{t('subagentEmpty')}</div>
            <div className={css.subagentEmptyHint}>{t('subagentEmptyDesc')}</div>
          </div>
        )}
      </div>
    </div>
  )
}
