/**
 * Structural types for the cordis services this plugin consumes, plus the
 * Context augmentation both halves share. A third-party plugin resolves
 * outside the DSH monorepo's single cordis instance, so the upstream
 * `declare module 'cordis'` augmentations do not reach this Context — and
 * the npm cordis package does not declare the DSH-vendored runtime members
 * (`ctx.effect`, service properties). The members below mirror the actual
 * runtime shapes this plugin touches:
 * - httpServer: @deepseek-ai/dsh-host-webserver
 * - sessions: host side @deepseek-ai/dsh-session (SessionStore), client
 *   side the runtime ISessions list feed
 * - conversation: client side ui-conversation's IConversation (composer
 *   draft), read lazily through `ctx.get` — cross-plugin service reads need
 *   an inject declaration, so the direct property is never typed here
 * - loader: @cordisjs/plugin-loader (entry options)
 * - slots: the client runtime SlotsService
 * - effect: the DSH-vendored cordis lifecycle helper
 * Drift from upstream is contained to this file.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from 'cordis'
import type { BetterSidebarService } from './client/service.ts'

/** One named webserver route (mirror of the host-webserver WebRoute). */
export interface SidebarWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** One exact-path HTTP upgrade registration (mirror of WebUpgradeRoute). */
export interface SidebarWebUpgradeRoute {
  path: string
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

/** The httpServer service face this plugin uses. */
export interface SidebarHttpServer {
  register(route: SidebarWebRoute): () => void
  registerUpgrade(route: SidebarWebUpgradeRoute): () => void
}

/** A published session's header slice the sidebar reads (authoritative cwd). */
export interface SidebarSessionHeader {
  cwd?: string
}

/** The host session store face (`ctx.sessions.get(id)` returns the live session). */
export interface SidebarSessionStore {
  get(id: string): { header: SidebarSessionHeader } | undefined
}

/** One loader entry's options slice (the connection row's resolved config). */
export interface SidebarLoaderEntry {
  options: { name: string; config?: unknown }
}

/** The loader face used to read the connection row's trustedHosts config. */
export interface SidebarLoader {
  entries(): Iterable<SidebarLoaderEntry>
}

/** Registration options the sidebar passes to `ctx.slots.register` (subset of the real options). */
export interface SidebarSlotRegisterOptions {
  name: string
  key?: string
  id?: string
  order?: number
  label?: string | (() => string)
  /** Chain routing selector (returns the matched value, or null to pass on). */
  select?: (owner: unknown) => unknown
  priority?: number
  locale?: string
  registrant?: string
  /** Business-face factory; args depend on the slot scope. */
  inject?: (...args: any[]) => Record<string, unknown>
  children?: Record<string, unknown>
}

/** The client slots service face (register returns the disposer). */
export interface SidebarSlotsService {
  register(options: SidebarSlotRegisterOptions, component: unknown): () => void
  /**
   * Run a callback for each declaration lifetime of a slot (the runtime
   * SlotsService.inject): a no-op while the slot is undeclared, so the
   * settings section registration waits for the settings shell.
   */
  inject(key: string, callback: () => () => void): () => void
}

/** The client session list row the sidebar reads (cwd for the explorer). */
export interface SidebarSessionSummary {
  id: string
  cwd?: string
  displayTitle: string
  /** Coarse durable origin for navigation filtering (subagent children). */
  origin?: 'subagent'
  /** Durable direct parent session id (present on subagent children). */
  parentId?: string
  /** Whether the session's agent is currently running. */
  running?: boolean
}

/** One healthy subagent catalog child row (structural mirror of the runtime). */
export interface SidebarSubagentChildEntry {
  kind: 'child'
  id: string
  /** Whether the child Agent driver is running at the Host sampling boundary. */
  activity: 'running' | 'inactive'
  /** Whether a direct descendant has durable `origin: 'subagent'`. */
  hasChildren: boolean
  mode: 'one-shot' | 'continuable'
  label?: string
}

/** One unreadable catalog row (corrupt / unsupported / unavailable). */
export interface SidebarSubagentDiagnosticEntry {
  kind: 'diagnostic'
  id: string
  reason: 'corrupt' | 'unsupported' | 'unavailable'
}

/** The per-parent lazy catalog delivered through the sessions list feed. */
export interface SidebarSubagentCatalog {
  entries: Array<SidebarSubagentChildEntry | SidebarSubagentDiagnosticEntry>
  parentAvailable: boolean
  state: 'loading' | 'ready' | 'error'
  error: { code?: string; message?: string } | null
}

/** Durable parent/child address that selects subagent transport in the client. */
export interface SidebarSubagentAddress {
  parentSessionId: string
  childSessionId: string
  mode: 'one-shot' | 'continuable'
}

/** Minimal structural mirror of one session event (the subagent history tail). */
export interface SidebarSessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
}

/** One history row: the durable event plus an optional tool presentation view. */
export interface SidebarHistoryEntry {
  event: SidebarSessionEvent
  view?: unknown
}

/** RPC result slot mirror (`RpcResult<T>` on the wire). */
export type SidebarRpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** Unary response mirror (`RpcResponse<T>` on the wire). */
export interface SidebarRpcResponse<T> {
  rpcId: unknown
  result: SidebarRpcResult<T>
}

/** The wire face the Subagent activity summary needs (subset of `ctx.connection`). */
export interface SidebarConnectionHandle {
  api: {
    subagents: {
      history(
        payload: SidebarSubagentAddress & { beforeSeq?: number; maxMessages?: number },
        signal?: AbortSignal,
      ): Promise<SidebarRpcResponse<{ events: SidebarHistoryEntry[]; hasMore: boolean }>>
    }
  }
}

/** The client session list snapshot the sidebar subscribes to. */
export interface SidebarSessionList {
  current: string | undefined
  byId: Record<string, SidebarSessionSummary>
  /** Direct durable catalogs keyed by their selected parent address. */
  subagentsByParent?: Readonly<Record<string, SidebarSubagentCatalog>>
}

/** The client sessions service face (only the list feed is needed). */
export interface SidebarSessionsService {
  list: {
    getSnapshot(): SidebarSessionList
    subscribe(fn: () => void): () => void
  }
  /**
   * Select a listed session as current (mirror of the runtime ISessions.open)
   * — used to jump back to the main agent from the topology root node.
   */
  open?(id: string): void
  /**
   * Resolve an Agent-scoped context view for one session (mirror of the
   * runtime ISessions.scope) — the ticket `ctx.conversation.input.for`
   * requires to reach that session's composer.
   */
  scope(id: string): Context | undefined
  /**
   * Open a healthy catalog child through its exact direct-parent address
   * (mirror of the runtime ISessions.openSubagent).
   */
  openSubagent?(address: SidebarSubagentAddress): void
  /**
   * Resolve an already discovered direct-parent address without opening it.
   */
  subagentAddress?(id: string): SidebarSubagentAddress | undefined
  /**
   * Mark whether a catalog surface is consuming live membership updates.
   */
  setSubagentCatalogOpen?(parentSessionId: string, open: boolean): void
  /**
   * Refresh one direct-child catalog.
   */
  refreshSubagents?(parentSessionId: string): Promise<void>
}

/** The composer draft face the sidebar reaches through `ctx.conversation.input`. */
export interface SidebarSessionInput {
  /** The live input store (draft read for append). */
  state: {
    getSnapshot(): { draft: string }
  }
  /** Replace the draft text (the input machine's single public write path). */
  setDraft(text: string): void
}

/** The composer draft face the sidebar reaches through `ctx.get('conversation')`. */
export interface SidebarConversation {
  input: {
    for(actx: Context): SidebarSessionInput
  }
}

/**
 * The client workspaces service face (mirror of the runtime IWorkspaces). Only
 * the chat's file-open funnel is touched: `openPath` hands an absolute path
 * to the Host OS's default application, and every chat-side file open
 * (tool rows, produced-files, prose mentions) funnels through it.
 */
export interface SidebarWorkspacesService {
  /** Open a filesystem path with the Host operating system's default application. */
  openPath(path: string): Promise<void>
}

/**
 * The invariant service face (mirror of @deepseek-ai/dsh-invariants'
 * InvariantService). The upstream augmentation does not reach this Context
 * (dual-cordis-instance resolution), so the register signature is restated
 * structurally, exactly like the other service faces above.
 */
export interface SidebarInvariantsService {
  /** Reserve one package's checks and install them in the service's child fiber. */
  register(
    packageName: string,
    installer: (ctx: Context, fail: (message: string) => never) => void | Promise<void>,
  ): () => void
}

/** The settings service face (mirror of @deepseek-ai/dsh-settings' Settings). */
export interface SidebarSettingsService {
  /**
   * Register one namespace schema (the resolved value layers schema defaults,
   * then the composition base, then the user document).
   */
  register<T>(
    ns: string,
    schema: unknown,
    options?: { base?: Partial<T>; applies?: 'live' | 'restart' },
  ): {
    get(): T
    watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
    update(patch: object): Promise<void>
    replace(section: object): Promise<void>
  }
  /** Redacted descriptors of every registered namespace (secrets stripped). */
  describe(options?: { redactSecrets?: boolean }): Array<{
    ns: string
    value?: unknown
    base?: unknown
    user?: unknown
    applies: 'live' | 'restart'
    revision: number
  }>
  /** Service-level merge write with the revision guard (a stale writer is refused). */
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
}

/**
 * The tools service face (mirror of @deepseek-ai/dsh-tools' ToolRegistry).
 * The host half registers model-facing tools here; the registry attaches the
 * returned disposer to the contributing fiber so unloading unregisters them.
 */
export interface SidebarToolsService {
  /** Register one tool definition (raw JSON-Schema or defineTool-sugar form). */
  register(tool: unknown): () => void
}

/**
 * The agent face a tool sees on `exec.agent` (mirror of @deepseek-ai/dsh-agent's
 * Agent). Only the slices the terminal tools touch are restated: the live
 * session identity and its header cwd, both readonly.
 */
export interface SidebarAgent {
  /** The live session identity shared with the session log. */
  readonly id: string
  /** The live session this agent drives. */
  readonly session: {
    /** The session's header (validated cwd, lineage metadata). */
    readonly header: { readonly cwd?: string }
  }
}

declare module 'cordis' {
  interface Context {
    httpServer: SidebarHttpServer
    sessions: SidebarSessionStore & SidebarSessionsService
    connection: SidebarConnectionHandle
    loader: SidebarLoader
    slots: SidebarSlotsService
    workspaces: SidebarWorkspacesService
    settings: SidebarSettingsService
    invariants: SidebarInvariantsService
    tools: SidebarToolsService
    /**
     * The client-side sidebar registry: external plugins register tab types
     * and file previewers here. Provided by the client half (see
     * {@link ./client/index.tsx}); undefined on the host side.
     */
    betterSidebar: BetterSidebarService
    /**
     * Register a lifecycle callback (DSH-vendored cordis): runs at plugin
     * activation; its returned cleanup runs at disposal.
     */
    effect(fn: () => void | (() => void), label?: string): void
  }
}

export type { Context }
