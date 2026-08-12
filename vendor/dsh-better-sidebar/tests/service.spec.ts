/**
 * Tests for the BetterSidebar service registry: register/dispose lifecycle,
 * matchFileViewer priority/exts/detect algorithm, and openTab dedupe.
 */
import { describe, it, expect } from 'vitest'

// Mock browser globals (SidebarStore.reduce → schedulePersist uses window.setTimeout)
const g = globalThis as Record<string, unknown>
if (g.window === undefined) {
  g.window = {
    clearTimeout: () => {},
    setTimeout: (_fn: () => void) => 0,
    innerWidth: 1024,
  }
}
if (g.localStorage === undefined) {
  g.localStorage = {
    getItem: () => null,
    setItem: () => {},
  }
}

import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore, allLeaves, openDiffTab } from '../src/client/state.ts'

describe('BetterSidebar service', () => {
  it('registerTab adds to the registry and dispose removes it', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    expect(service.getTabs()).toHaveLength(0)
    const dispose = service.registerTab({
      id: 'test:tab',
      title: 'Test',
      component: () => null,
    })
    expect(service.getTabs()).toHaveLength(1)
    expect(service.getTab('test:tab')?.id).toBe('test:tab')
    dispose()
    expect(service.getTabs()).toHaveLength(0)
    expect(service.getTab('test:tab')).toBeUndefined()
  })

  it('registerTab throws on duplicate id', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'dup', title: 'A', component: () => null })
    expect(() => service.registerTab({ id: 'dup', title: 'B', component: () => null })).toThrow()
  })

  it('registerFileViewer adds and dispose removes', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    expect(service.getFileViewers()).toHaveLength(0)
    const dispose = service.registerFileViewer({
      id: 'csv',
      exts: ['csv'],
      fetchStrategy: 'custom',
      component: () => null,
    })
    expect(service.getFileViewers()).toHaveLength(1)
    dispose()
    expect(service.getFileViewers()).toHaveLength(0)
  })

  it('subscribe fires on register and dispose', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    let calls = 0
    const unsub = service.subscribe(() => { calls++ })
    const dispose = service.registerTab({ id: 'x', title: 'X', component: () => null })
    expect(calls).toBe(1)
    dispose()
    expect(calls).toBe(2)
    unsub()
    service.registerTab({ id: 'y', title: 'Y', component: () => null })
    expect(calls).toBe(2)
  })
})

describe('enable switches (declarative settings)', () => {
  /** A fresh store + service with one tab and one viewer registered. */
  const setup = () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'explorer', title: 'Explorer', component: () => null })
    service.registerFileViewer({ id: 'image', exts: ['png'], fetchStrategy: 'mediaUrl', component: () => null })
    return { store, service }
  }

  it('an absent map key means enabled (default state)', () => {
    const { service } = setup()
    expect(service.isTabEnabled('explorer')).toBe(true)
    expect(service.isViewerEnabled('image')).toBe(true)
    // Unknown ids are enabled too (nothing registered → the check is open).
    expect(service.isTabEnabled('whatever')).toBe(true)
  })

  it('only an explicit false disables a tab type', () => {
    const { store, service } = setup()
    store.setPrefs({ ...store.getPrefs(), tabsEnabled: { explorer: false } })
    expect(service.isTabEnabled('explorer')).toBe(false)
    store.setPrefs({ ...store.getPrefs(), tabsEnabled: { explorer: true } })
    expect(service.isTabEnabled('explorer')).toBe(true)
  })

  it('openTab refuses a disabled tab type (no tab lands, no createTab)', () => {
    const { store, service } = setup()
    store.setPrefs({ ...store.getPrefs(), tabsEnabled: { explorer: false } })
    store.setSession('s1')
    service.openTab({ type: 'explorer', title: 'Explorer' })
    const tabs = allLeaves(store.getSnapshot().state!.splits).flatMap(l => l.tabs)
    expect(tabs).toHaveLength(0)
  })

  it('matchFileViewer skips a disabled viewer (files fall through)', () => {
    const { store, service } = setup()
    service.registerFileViewer({ id: 'code', exts: [], priority: -100, fetchStrategy: 'fsRead', component: () => null })
    // image claims .png; disabling it lets the catch-all take over.
    expect(service.matchFileViewer('photo.png')?.id).toBe('image')
    store.setPrefs({ ...store.getPrefs(), viewersEnabled: { image: false } })
    expect(service.matchFileViewer('photo.png')?.id).toBe('code')
    // Disabling the catch-all too → no viewer at all.
    store.setPrefs({ ...store.getPrefs(), viewersEnabled: { image: false, code: false } })
    expect(service.matchFileViewer('photo.png')).toBeUndefined()
    // Re-enabling restores the image viewer.
    store.setPrefs({ ...store.getPrefs(), viewersEnabled: {} })
    expect(service.matchFileViewer('photo.png')?.id).toBe('image')
  })
})

describe('matchFileViewer', () => {
  it('matches by extension', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerFileViewer({ id: 'img', exts: ['png', 'jpg'], fetchStrategy: 'mediaUrl', component: () => null })
    expect(service.matchFileViewer('photo.png')?.id).toBe('img')
    expect(service.matchFileViewer('photo.JPG')?.id).toBe('img')
    expect(service.matchFileViewer('doc.txt')).toBeUndefined()
  })

  it('higher priority wins on extension conflict', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerFileViewer({ id: 'basic', exts: ['png'], priority: 0, fetchStrategy: 'mediaUrl', component: () => null })
    service.registerFileViewer({ id: 'advanced', exts: ['png'], priority: 10, fetchStrategy: 'custom', component: () => null })
    expect(service.matchFileViewer('x.png')?.id).toBe('advanced')
  })

  it('catch-all (exts: []) matches anything at lowest priority', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerFileViewer({ id: 'catchall', exts: [], priority: -100, fetchStrategy: 'fsRead', component: () => null })
    service.registerFileViewer({ id: 'img', exts: ['png'], priority: 0, fetchStrategy: 'mediaUrl', component: () => null })
    expect(service.matchFileViewer('x.png')?.id).toBe('img')
    expect(service.matchFileViewer('x.txt')?.id).toBe('catchall')
  })

  it('detect claims files the viewer would otherwise miss, at its priority', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    // by-magic does not match 'bin' by extension; only its detect (PNG magic)
    // can claim it — and only when head bytes are available.
    service.registerFileViewer({ id: 'by-ext', exts: ['bin'], priority: 5, fetchStrategy: 'fsRead', component: () => null })
    service.registerFileViewer({
      id: 'by-magic',
      exts: ['mag'],
      priority: 10,
      fetchStrategy: 'fsRead',
      detect: (_path, head) => head[0] === 0x89,
      component: () => null,
    })
    // No head: by-magic's exts miss, by-ext claims .bin.
    expect(service.matchFileViewer('file.bin')?.id).toBe('by-ext')
    // Head with PNG magic: by-magic's detect fires at priority 10 before
    // by-ext (5) is consulted.
    expect(service.matchFileViewer('file.bin', new Uint8Array([0x89, 0x50]))?.id).toBe('by-magic')
    // Head without the magic: detect misses, by-ext claims .bin again.
    expect(service.matchFileViewer('file.bin', new Uint8Array([0x00, 0x50]))?.id).toBe('by-ext')
  })

  it('priority decides first: a higher-priority exts match beats a lower-priority detect', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerFileViewer({ id: 'by-ext', exts: ['bin'], priority: 10, fetchStrategy: 'fsRead', component: () => null })
    service.registerFileViewer({
      id: 'by-magic',
      exts: ['mag'],
      priority: 5,
      fetchStrategy: 'fsRead',
      detect: (_path, head) => head[0] === 0x89,
      component: () => null,
    })
    // Per-descriptor walk: by-ext (priority 10) claims .bin before by-magic's
    // detect (priority 5) is ever consulted — the design's priority-first rule.
    expect(service.matchFileViewer('file.bin', new Uint8Array([0x89, 0x50]))?.id).toBe('by-ext')
  })

  it('a catch-all with detect is sniff-only: it never blind-claims without head', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerFileViewer({ id: 'img', exts: ['png'], priority: 0, fetchStrategy: 'mediaUrl', component: () => null })
    service.registerFileViewer({
      id: 'magic-sniffer',
      exts: [],
      priority: 100,
      fetchStrategy: 'custom',
      detect: (_path, head) => head[0] === 0x89,
      component: () => null,
    })
    // No head: the sniff-only catch-all yields — the real png viewer wins.
    expect(service.matchFileViewer('photo.png')?.id).toBe('img')
    // Head with the magic: the sniffer claims it (detect at priority 100).
    expect(service.matchFileViewer('photo.png', new Uint8Array([0x89, 0x50]))?.id).toBe('magic-sniffer')
    // Head without the magic: the sniffer yields again, img claims it.
    expect(service.matchFileViewer('photo.png', new Uint8Array([0x00, 0x50]))?.id).toBe('img')
  })

  it('returns undefined when no viewer matches and no catch-all', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerFileViewer({ id: 'img', exts: ['png'], fetchStrategy: 'mediaUrl', component: () => null })
    expect(service.matchFileViewer('doc.txt')).toBeUndefined()
  })
})

describe('service.openTab dedupe', () => {
  it('dedupeKey focuses existing tab instead of duplicating', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({
      id: 'singleton',
      title: 'Singleton',
      dedupeKey: () => 'singleton',
      component: () => null,
    })
    store.setSession('s1')
    service.openTab({ type: 'singleton', title: 'Singleton' })
    service.openTab({ type: 'singleton', title: 'Singleton' })
    const state = store.getSnapshot().state!
    const tabs = allLeaves(state.splits).flatMap(l => l.tabs)
    expect(tabs.filter(t => t.type === 'singleton')).toHaveLength(1)
  })

  it('no dedupeKey opens a new tab for each distinct id', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({
      id: 'multi',
      title: 'Multi',
      component: () => null,
    })
    store.setSession('s1')
    service.openTab({ type: 'multi', title: 'Multi', id: 'multi:1' })
    service.openTab({ type: 'multi', title: 'Multi', id: 'multi:2' })
    const state = store.getSnapshot().state!
    const tabs = allLeaves(state.splits).flatMap(l => l.tabs)
    expect(tabs.filter(t => t.type === 'multi')).toHaveLength(2)
  })

  it('reopening with the same id focuses the existing tab (id safety net)', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({
      id: 'multi',
      title: 'Multi',
      component: () => null,
    })
    store.setSession('s1')
    service.openTab({ type: 'multi', title: 'Multi', id: 'multi:1' })
    service.openTab({ type: 'multi', title: 'Multi', id: 'multi:1' })
    const state = store.getSnapshot().state!
    const tabs = allLeaves(state.splits).flatMap(l => l.tabs)
    expect(tabs.filter(t => t.type === 'multi')).toHaveLength(1)
  })

  it('createTab mints custom ids and patches state', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({
      id: 'counter',
      title: 'Counter',
      createTab: (state) => ({
        tab: { id: `counter:${state.nextTerminal}`, type: 'counter', title: `C${state.nextTerminal}` },
        patch: { nextTerminal: state.nextTerminal + 1 },
      }),
      component: () => null,
    })
    store.setSession('s1')
    service.openTab({ type: 'counter', title: 'Counter' })
    service.openTab({ type: 'counter', title: 'Counter' })
    const state = store.getSnapshot().state!
    const tabs = allLeaves(state.splits).flatMap(l => l.tabs).filter(t => t.type === 'counter')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]!.id).toBe('counter:1')
    expect(tabs[1]!.id).toBe('counter:2')
    expect(state.nextTerminal).toBe(3)
  })

  it('a caller-provided title wins over the descriptor title (editor shows the file name)', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'editor', title: () => 'Editor', component: () => null })
    store.setSession('s1')
    service.openTab({ type: 'editor', title: 'main.ts', path: '/p/main.ts' })
    const state = store.getSnapshot().state!
    const tab = allLeaves(state.splits).flatMap(l => l.tabs).find(t => t.type === 'editor')
    expect(tab?.title).toBe('main.ts')
  })

  it('a url seed lands the tab with its path pre-set (the sidebar-browser navigation seed)', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({
      id: 'browser',
      title: () => 'Browser',
      createTab: (state) => ({
        tab: { id: `browser:${state.nextBrowser}`, type: 'browser', title: 'Browser' },
        patch: { nextBrowser: state.nextBrowser + 1 },
      }),
      component: () => null,
    })
    store.setSession('s1')
    service.openTab({ type: 'browser', url: 'https://example.com/x', title: 'example.com' })
    const state = store.getSnapshot().state!
    const tab = allLeaves(state.splits).flatMap(l => l.tabs).find(t => t.type === 'browser')
    expect(tab?.id).toBe('browser:1')
    expect(tab?.path).toBe('https://example.com/x')
    expect(tab?.title).toBe('example.com')
    expect(state.nextBrowser).toBe(2)
  })

  it('the descriptor title is the default when no title is given', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'plain', title: () => 'Plain', component: () => null })
    store.setSession('s1')
    service.openTab({ type: 'plain' })
    const state = store.getSnapshot().state!
    const tab = allLeaves(state.splits).flatMap(l => l.tabs).find(t => t.type === 'plain')
    expect(tab?.title).toBe('Plain')
  })

  it('single: true dedupes like dedupeKey: () => id (sugar)', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'singleton', title: 'Singleton', single: true, component: () => null })
    store.setSession('s1')
    service.openTab({ type: 'singleton' })
    service.openTab({ type: 'singleton', id: 'singleton:extra' })
    const state = store.getSnapshot().state!
    const tabs = allLeaves(state.splits).flatMap(l => l.tabs).filter(t => t.type === 'singleton')
    expect(tabs).toHaveLength(1)
  })

  it('an explicit dedupeKey wins over single: true', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({
      id: 'multi',
      title: 'Multi',
      single: true,
      dedupeKey: (tab) => tab.id, // per-id, not per-type: two tabs coexist
      component: () => null,
    })
    store.setSession('s1')
    service.openTab({ type: 'multi', id: 'multi:1' })
    service.openTab({ type: 'multi', id: 'multi:2' })
    const state = store.getSnapshot().state!
    const tabs = allLeaves(state.splits).flatMap(l => l.tabs).filter(t => t.type === 'multi')
    expect(tabs).toHaveLength(2)
    service.openTab({ type: 'multi', id: 'multi:1' })
    const state2 = store.getSnapshot().state!
    const tabs2 = allLeaves(state2.splits).flatMap(l => l.tabs).filter(t => t.type === 'multi')
    expect(tabs2).toHaveLength(2)
  })

  it('available receives ctx, scope and the live state (superset signature)', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    const seen: unknown[] = []
    service.registerTab({
      id: 'gated',
      title: 'Gated',
      available: (ctx, scope, state) => {
        seen.push([ctx, scope, state])
        return true
      },
      component: () => null,
    })
    store.setSession('s1')
    expect(service.getTabs()[0]!.available?.({} as never, { sessionId: 's1', cwd: '/p' }, store.getSnapshot().state!)).toBe(true)
    expect(seen).toHaveLength(1)
  })

  it('openDiffTab and the service dedupeKey agree on diff identity (per-change id rule)', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({
      id: 'diff',
      title: 'Diff',
      dedupeKey: (tab) => tab.id,
      component: () => null,
    })
    store.setSession('s1')
    const seed = { kind: 'worktree' as const, path: '/p/a.ts', staged: false }
    const paneId = store.getSnapshot().state!.activePane!
    // The git view's placement path (split surgery) opens the diff tab...
    store.reduce(s => openDiffTab(s, paneId, { id: 'diff:1', type: 'diff', title: 'a.ts', diff: seed }))
    // ...and a service open of the same change focuses the existing tab
    // (the descriptor's dedupeKey is the same per-change id rule).
    service.openTab({ type: 'diff', title: 'a.ts', diff: seed, id: 'diff:1' })
    const state = store.getSnapshot().state!
    const tabs = allLeaves(state.splits).flatMap(l => l.tabs).filter(t => t.type === 'diff')
    expect(tabs).toHaveLength(1)
  })
})

describe('service.openTab across the two panels', () => {
  it('openTab lands in the bottom tree when the active pane lives there', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'git', title: 'Git', component: () => null })
    store.setSession('s1')
    store.reduce(s => ({ ...s, activePane: (s.bottomSplits as { id: string }).id }))
    service.openTab({ type: 'git', title: 'Git' })
    const state = store.getSnapshot().state!
    expect(allLeaves(state.bottomSplits).flatMap(l => l.tabs).some(t => t.type === 'git')).toBe(true)
    expect(allLeaves(state.splits).flatMap(l => l.tabs).some(t => t.type === 'git')).toBe(false)
  })

  it('dedupeKey focuses an existing instance in the OTHER tree (single-instance across panels)', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({
      id: 'singleton',
      title: 'Singleton',
      single: true,
      component: () => null,
    })
    store.setSession('s1')
    // Open in the right tree first.
    service.openTab({ type: 'singleton', title: 'Singleton' })
    // Switch the active pane to the bottom tree and open again: the dedupe
    // scan covers both trees, so the existing instance is focused, not
    // duplicated in the bottom panel.
    store.reduce(s => ({ ...s, activePane: (s.bottomSplits as { id: string }).id }))
    service.openTab({ type: 'singleton', title: 'Singleton' })
    const state = store.getSnapshot().state!
    const total = allLeaves(state.splits).concat(allLeaves(state.bottomSplits))
      .flatMap(l => l.tabs).filter(t => t.type === 'singleton')
    expect(total).toHaveLength(1)
  })

  it('closeTab by id closes a tab living in the bottom tree', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'git', title: 'Git', component: () => null })
    store.setSession('s1')
    store.reduce(s => ({ ...s, activePane: (s.bottomSplits as { id: string }).id }))
    service.openTab({ type: 'git', title: 'Git' })
    const state = store.getSnapshot().state!
    const gitTab = allLeaves(state.bottomSplits).flatMap(l => l.tabs).find(t => t.type === 'git')!
    service.closeTab(gitTab.id)
    const after = store.getSnapshot().state!
    expect(allLeaves(after.bottomSplits).flatMap(l => l.tabs).some(t => t.id === gitTab.id)).toBe(false)
  })
})

describe('service.openTab auto-expand for content opens', () => {
  /** The window stub is a plain object (see the file header), so the width is writable. */
  const setWidth = (width: number): void => {
    ;(g.window as { innerWidth: number }).innerWidth = width
  }
  /** Collapse the right panel (the store defaults it open). */
  const collapseRightPanel = (store: ReturnType<typeof createSidebarStore>): void => {
    store.reduce(s => ({ ...s, panelOpen: false }))
  }

  it('expands the collapsed drawer for a path (file) open on a narrow viewport', () => {
    setWidth(390)
    try {
      const store = createSidebarStore()
      const service = createBetterSidebarService(store)
      service.registerTab({ id: 'editor', title: 'Editor', component: () => null })
      store.setSession('s1')
      store.reduce(s => ({ ...s, panelOpen: false }))
      service.openTab({ type: 'editor', title: 'main.ts', path: '/p/main.ts' })
      expect(store.getSnapshot().state?.panelOpen).toBe(true)
    } finally {
      setWidth(1024)
    }
  })

  it('expands the collapsed drawer for a URL (browser) open on a narrow viewport', () => {
    setWidth(390)
    try {
      const store = createSidebarStore()
      const service = createBetterSidebarService(store)
      service.registerTab({ id: 'browser', title: 'Browser', component: () => null })
      store.setSession('s1')
      store.reduce(s => ({ ...s, panelOpen: false }))
      service.openTab({ type: 'browser', url: 'https://example.com', title: 'example.com' })
      expect(store.getSnapshot().state?.panelOpen).toBe(true)
    } finally {
      setWidth(1024)
    }
  })

  it('keeps a collapsed drawer for a type-only open on a narrow viewport', () => {
    setWidth(390)
    try {
      const store = createSidebarStore()
      const service = createBetterSidebarService(store)
      service.registerTab({ id: 'explorer', title: 'Explorer', component: () => null })
      store.setSession('s1')
      store.reduce(s => ({ ...s, panelOpen: false }))
      service.openTab({ type: 'explorer', title: 'Explorer' })
      expect(store.getSnapshot().state?.panelOpen).toBe(false)
    } finally {
      setWidth(1024)
    }
  })

  it('expands the collapsed right panel for a path (file) open on a wide viewport', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'editor', title: 'Editor', component: () => null })
    store.setSession('s1')
    collapseRightPanel(store)
    service.openTab({ type: 'editor', title: 'main.ts', path: '/p/main.ts' })
    const state = store.getSnapshot().state!
    expect(state.panelOpen).toBe(true)
    expect(allLeaves(state.splits).flatMap(l => l.tabs).some(t => t.type === 'editor')).toBe(true)
  })

  it('expands the collapsed right panel for a URL (browser) open on a wide viewport', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'browser', title: 'Browser', component: () => null })
    store.setSession('s1')
    collapseRightPanel(store)
    service.openTab({ type: 'browser', url: 'https://example.com', title: 'example.com' })
    expect(store.getSnapshot().state!.panelOpen).toBe(true)
  })

  it('a wide-viewport path open landing in the bottom tree expands the bottom panel instead', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'editor', title: 'Editor', component: () => null })
    store.setSession('s1')
    // The last-touched pane lives in the bottom tree and BOTH panels are
    // collapsed: the open must surface the bottom panel, not the right one.
    store.reduce(s => ({ ...s, activePane: (s.bottomSplits as { id: string }).id, panelOpen: false, bottomOpen: false }))
    service.openTab({ type: 'editor', title: 'main.ts', path: '/p/main.ts' })
    const state = store.getSnapshot().state!
    expect(state.bottomOpen).toBe(true)
    expect(state.panelOpen).toBe(false)
    expect(allLeaves(state.bottomSplits).flatMap(l => l.tabs).some(t => t.type === 'editor')).toBe(true)
  })

  it('keeps a collapsed panel for a type-only open on a wide viewport', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'explorer', title: 'Explorer', component: () => null })
    store.setSession('s1')
    collapseRightPanel(store)
    service.openTab({ type: 'explorer', title: 'Explorer' })
    expect(store.getSnapshot().state?.panelOpen).toBe(false)
  })

  it('expands on a narrow viewport even when the open focuses an existing tab (id dedupe)', () => {
    setWidth(390)
    try {
      const store = createSidebarStore()
      const service = createBetterSidebarService(store)
      service.registerTab({ id: 'editor', title: 'Editor', component: () => null })
      store.setSession('s1')
      service.openTab({ type: 'editor', title: 'main.ts', path: '/p/main.ts' })
      store.reduce(s => ({ ...s, panelOpen: false }))
      service.openTab({ type: 'editor', title: 'main.ts', path: '/p/main.ts' })
      expect(store.getSnapshot().state?.panelOpen).toBe(true)
    } finally {
      setWidth(1024)
    }
  })

  it('expands on a wide viewport even when the open focuses an existing tab (id dedupe)', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'editor', title: 'Editor', component: () => null })
    store.setSession('s1')
    service.openTab({ type: 'editor', title: 'main.ts', path: '/p/main.ts' })
    collapseRightPanel(store)
    service.openTab({ type: 'editor', title: 'main.ts', path: '/p/main.ts' })
    const state = store.getSnapshot().state!
    expect(state.panelOpen).toBe(true)
    expect(allLeaves(state.splits).flatMap(l => l.tabs).filter(t => t.type === 'editor')).toHaveLength(1)
  })
})
