/**
 * Layout state management store.
 * Manages window layout, panel sizes, split editors, and workspace arrangement.
 */

import { create } from 'zustand'

/* ── Types ─────────────────────────────────────────────── */

export type SplitDirection = 'horizontal' | 'vertical'

export interface EditorGroup {
  id: string
  tabs: EditorTab[]
  activeTabId: string | null
  size: number // percentage
}

export interface EditorTab {
  id: string
  path: string
  label: string
  isDirty: boolean
  isPinned: boolean
  isPreview: boolean
  viewType: 'code' | 'diff' | 'image' | 'markdown' | 'notebook' | 'custom'
}

export interface SplitNode {
  id: string
  type: 'leaf' | 'split'
  direction?: SplitDirection
  children?: SplitNode[]
  groupId?: string
  size: number
}

export interface PanelLayout {
  left: PanelState
  right: PanelState
  bottom: PanelState
}

export interface PanelState {
  visible: boolean
  size: number
  activeTab: string
  tabs: string[]
  collapsed: boolean
}

export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
  fullscreen: boolean
}

export interface LayoutPreset {
  id: string
  name: string
  description: string
  editorLayout: SplitNode
  panels: PanelLayout
  icon?: string
}

/* ── Store ─────────────────────────────────────────────── */

interface LayoutStore {
  // Editor groups
  editorLayout: SplitNode
  editorGroups: EditorGroup[]
  activeGroupId: string

  // Panel layout
  panels: PanelLayout

  // Window state
  windowState: WindowState
  zenMode: boolean
  centeredLayout: boolean

  // Presets
  presets: LayoutPreset[]
  activePreset: string | null

  // Editor group management
  createGroup: (direction?: SplitDirection) => string
  closeGroup: (groupId: string) => void
  setActiveGroup: (groupId: string) => void
  moveTabToGroup: (tabId: string, fromGroupId: string, toGroupId: string) => void
  splitEditor: (direction: SplitDirection, tabId?: string) => void
  joinGroups: (groupId1: string, groupId2: string) => void
  resizeGroups: (groupId: string, newSize: number) => void

  // Tab management
  addTab: (groupId: string, tab: Omit<EditorTab, 'id'>) => string
  closeTab: (groupId: string, tabId: string) => void
  setActiveTab: (groupId: string, tabId: string) => void
  pinTab: (groupId: string, tabId: string) => void
  unpinTab: (groupId: string, tabId: string) => void
  reorderTabs: (groupId: string, fromIndex: number, toIndex: number) => void
  markTabDirty: (groupId: string, tabId: string, dirty: boolean) => void

  // Panel management
  togglePanel: (panel: 'left' | 'right' | 'bottom') => void
  setPanelSize: (panel: 'left' | 'right' | 'bottom', size: number) => void
  setPanelTab: (panel: 'left' | 'right' | 'bottom', tab: string) => void
  collapsePanel: (panel: 'left' | 'right' | 'bottom') => void
  expandPanel: (panel: 'left' | 'right' | 'bottom') => void

  // Layout modes
  toggleZenMode: () => void
  toggleCenteredLayout: () => void
  setFullscreen: (fullscreen: boolean) => void

  // Presets
  savePreset: (name: string, description?: string) => string
  loadPreset: (presetId: string) => void
  deletePreset: (presetId: string) => void

  // Persistence
  saveLayout: () => void
  restoreLayout: () => void
  resetLayout: () => void
}

let nextGroupId = 1
let nextTabId = 1

const DEFAULT_GROUP: EditorGroup = {
  id: 'group-1',
  tabs: [],
  activeTabId: null,
  size: 100,
}

const DEFAULT_LAYOUT: SplitNode = {
  id: 'root',
  type: 'leaf',
  groupId: 'group-1',
  size: 100,
}

const DEFAULT_PANELS: PanelLayout = {
  left: { visible: true, size: 260, activeTab: 'explorer', tabs: ['explorer', 'search', 'git', 'debug', 'extensions'], collapsed: false },
  right: { visible: true, size: 350, activeTab: 'chat', tabs: ['chat', 'composer'], collapsed: false },
  bottom: { visible: true, size: 250, activeTab: 'terminal', tabs: ['terminal', 'output', 'problems', 'debug-console', 'ports'], collapsed: false },
}

const DEFAULT_WINDOW: WindowState = {
  x: 100, y: 100, width: 1400, height: 900, maximized: false, fullscreen: false,
}

const BUILT_IN_PRESETS: LayoutPreset[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Standard IDE layout with sidebar, editor, and bottom panel',
    editorLayout: DEFAULT_LAYOUT,
    panels: DEFAULT_PANELS,
    icon: 'layout',
  },
  {
    id: 'focus',
    name: 'Focus Mode',
    description: 'Editor only — no panels, no distractions',
    editorLayout: DEFAULT_LAYOUT,
    panels: {
      left: { ...DEFAULT_PANELS.left, visible: false },
      right: { ...DEFAULT_PANELS.right, visible: false },
      bottom: { ...DEFAULT_PANELS.bottom, visible: false },
    },
    icon: 'maximize',
  },
  {
    id: 'split',
    name: 'Side-by-Side',
    description: 'Two editors side by side',
    editorLayout: {
      id: 'root',
      type: 'split',
      direction: 'horizontal',
      size: 100,
      children: [
        { id: 'left', type: 'leaf', groupId: 'group-1', size: 50 },
        { id: 'right', type: 'leaf', groupId: 'group-2', size: 50 },
      ],
    },
    panels: DEFAULT_PANELS,
    icon: 'columns',
  },
  {
    id: 'review',
    name: 'Code Review',
    description: 'Git panel + split editors for reviewing changes',
    editorLayout: {
      id: 'root',
      type: 'split',
      direction: 'horizontal',
      size: 100,
      children: [
        { id: 'left', type: 'leaf', groupId: 'group-1', size: 50 },
        { id: 'right', type: 'leaf', groupId: 'group-2', size: 50 },
      ],
    },
    panels: {
      ...DEFAULT_PANELS,
      left: { ...DEFAULT_PANELS.left, activeTab: 'git' },
    },
    icon: 'git-compare',
  },
  {
    id: 'debug',
    name: 'Debug Layout',
    description: 'Debug panel + variables + console optimized for debugging',
    editorLayout: DEFAULT_LAYOUT,
    panels: {
      left: { ...DEFAULT_PANELS.left, activeTab: 'debug' },
      right: { ...DEFAULT_PANELS.right, visible: false },
      bottom: { ...DEFAULT_PANELS.bottom, activeTab: 'debug-console', size: 300 },
    },
    icon: 'bug',
  },
]

const STORAGE_KEY = 'orion:layout'

export const useLayoutStore = create<LayoutStore>((set, get) => ({
  editorLayout: DEFAULT_LAYOUT,
  editorGroups: [DEFAULT_GROUP],
  activeGroupId: 'group-1',
  panels: DEFAULT_PANELS,
  windowState: DEFAULT_WINDOW,
  zenMode: false,
  centeredLayout: false,
  presets: [...BUILT_IN_PRESETS],
  activePreset: 'default',

  /* ── Editor Groups ──────────────────────────────── */

  createGroup: (direction = 'horizontal') => {
    const id = `group-${++nextGroupId}`
    const newGroup: EditorGroup = { id, tabs: [], activeTabId: null, size: 50 }

    set(s => {
      const groups = [...s.editorGroups, newGroup]

      // Update layout to include new group
      const currentLeaf = findLeaf(s.editorLayout, s.activeGroupId)
      if (currentLeaf) {
        currentLeaf.size = 50
      }

      return {
        editorGroups: groups,
        editorLayout: {
          id: 'root',
          type: 'split',
          direction,
          size: 100,
          children: [
            s.editorLayout,
            { id: `leaf-${id}`, type: 'leaf', groupId: id, size: 50 },
          ],
        },
      }
    })

    return id
  },

  closeGroup: (groupId) => {
    set(s => {
      if (s.editorGroups.length <= 1) return s
      const groups = s.editorGroups.filter(g => g.id !== groupId)
      const activeGroupId = s.activeGroupId === groupId
        ? groups[0]?.id || 'group-1'
        : s.activeGroupId

      return {
        editorGroups: groups,
        activeGroupId,
        editorLayout: removeGroupFromLayout(s.editorLayout, groupId),
      }
    })
  },

  setActiveGroup: (groupId) => set({ activeGroupId: groupId }),

  moveTabToGroup: (tabId, fromGroupId, toGroupId) => {
    set(s => {
      const fromGroup = s.editorGroups.find(g => g.id === fromGroupId)
      const toGroup = s.editorGroups.find(g => g.id === toGroupId)
      if (!fromGroup || !toGroup) return s

      const tab = fromGroup.tabs.find(t => t.id === tabId)
      if (!tab) return s

      return {
        editorGroups: s.editorGroups.map(g => {
          if (g.id === fromGroupId) {
            const tabs = g.tabs.filter(t => t.id !== tabId)
            return { ...g, tabs, activeTabId: tabs[0]?.id || null }
          }
          if (g.id === toGroupId) {
            return { ...g, tabs: [...g.tabs, tab], activeTabId: tabId }
          }
          return g
        }),
      }
    })
  },

  splitEditor: (direction, tabId) => {
    const state = get()
    const activeGroup = state.editorGroups.find(g => g.id === state.activeGroupId)
    if (!activeGroup) return

    const newGroupId = state.createGroup(direction)

    if (tabId) {
      state.moveTabToGroup(tabId, state.activeGroupId, newGroupId)
    } else if (activeGroup.activeTabId) {
      // Duplicate active tab to new group
      const tab = activeGroup.tabs.find(t => t.id === activeGroup.activeTabId)
      if (tab) {
        state.addTab(newGroupId, { ...tab })
      }
    }
  },

  joinGroups: (groupId1, groupId2) => {
    set(s => {
      const group1 = s.editorGroups.find(g => g.id === groupId1)
      const group2 = s.editorGroups.find(g => g.id === groupId2)
      if (!group1 || !group2) return s

      const mergedTabs = [...group1.tabs, ...group2.tabs]
      return {
        editorGroups: s.editorGroups
          .map(g => g.id === groupId1 ? { ...g, tabs: mergedTabs } : g)
          .filter(g => g.id !== groupId2),
        editorLayout: removeGroupFromLayout(s.editorLayout, groupId2),
      }
    })
  },

  resizeGroups: (groupId, newSize) => {
    set(s => ({
      editorGroups: s.editorGroups.map(g =>
        g.id === groupId ? { ...g, size: newSize } : g
      ),
    }))
  },

  /* ── Tab Management ─────────────────────────────── */

  addTab: (groupId, tab) => {
    const id = `tab-${++nextTabId}`
    set(s => ({
      editorGroups: s.editorGroups.map(g =>
        g.id === groupId ? {
          ...g,
          tabs: [...g.tabs, { ...tab, id }],
          activeTabId: id,
        } : g
      ),
      activeGroupId: groupId,
    }))
    return id
  },

  closeTab: (groupId, tabId) => {
    set(s => ({
      editorGroups: s.editorGroups.map(g => {
        if (g.id !== groupId) return g
        const tabs = g.tabs.filter(t => t.id !== tabId)
        const activeTabId = g.activeTabId === tabId ? (tabs[tabs.length - 1]?.id || null) : g.activeTabId
        return { ...g, tabs, activeTabId }
      }),
    }))
  },

  setActiveTab: (groupId, tabId) => {
    set(s => ({
      editorGroups: s.editorGroups.map(g =>
        g.id === groupId ? { ...g, activeTabId: tabId } : g
      ),
      activeGroupId: groupId,
    }))
  },

  pinTab: (groupId, tabId) => {
    set(s => ({
      editorGroups: s.editorGroups.map(g =>
        g.id === groupId ? {
          ...g,
          tabs: g.tabs.map(t => t.id === tabId ? { ...t, isPinned: true, isPreview: false } : t),
        } : g
      ),
    }))
  },

  unpinTab: (groupId, tabId) => {
    set(s => ({
      editorGroups: s.editorGroups.map(g =>
        g.id === groupId ? {
          ...g,
          tabs: g.tabs.map(t => t.id === tabId ? { ...t, isPinned: false } : t),
        } : g
      ),
    }))
  },

  reorderTabs: (groupId, fromIndex, toIndex) => {
    set(s => ({
      editorGroups: s.editorGroups.map(g => {
        if (g.id !== groupId) return g
        const tabs = [...g.tabs]
        const [moved] = tabs.splice(fromIndex, 1)
        tabs.splice(toIndex, 0, moved)
        return { ...g, tabs }
      }),
    }))
  },

  markTabDirty: (groupId, tabId, dirty) => {
    set(s => ({
      editorGroups: s.editorGroups.map(g =>
        g.id === groupId ? {
          ...g,
          tabs: g.tabs.map(t => t.id === tabId ? { ...t, isDirty: dirty } : t),
        } : g
      ),
    }))
  },

  /* ── Panel Management ───────────────────────────── */

  togglePanel: (panel) => {
    set(s => ({
      panels: { ...s.panels, [panel]: { ...s.panels[panel], visible: !s.panels[panel].visible } },
    }))
  },

  setPanelSize: (panel, size) => {
    set(s => ({
      panels: { ...s.panels, [panel]: { ...s.panels[panel], size } },
    }))
  },

  setPanelTab: (panel, tab) => {
    set(s => ({
      panels: { ...s.panels, [panel]: { ...s.panels[panel], activeTab: tab, visible: true } },
    }))
  },

  collapsePanel: (panel) => {
    set(s => ({
      panels: { ...s.panels, [panel]: { ...s.panels[panel], collapsed: true } },
    }))
  },

  expandPanel: (panel) => {
    set(s => ({
      panels: { ...s.panels, [panel]: { ...s.panels[panel], collapsed: false, visible: true } },
    }))
  },

  /* ── Layout Modes ───────────────────────────────── */

  toggleZenMode: () => set(s => ({ zenMode: !s.zenMode })),
  toggleCenteredLayout: () => set(s => ({ centeredLayout: !s.centeredLayout })),
  setFullscreen: (fullscreen) => set(s => ({ windowState: { ...s.windowState, fullscreen } })),

  /* ── Presets ────────────────────────────────────── */

  savePreset: (name, description) => {
    const id = `preset-${Date.now()}`
    const state = get()
    const preset: LayoutPreset = {
      id,
      name,
      description: description || '',
      editorLayout: state.editorLayout,
      panels: state.panels,
    }
    set(s => ({ presets: [...s.presets, preset] }))
    return id
  },

  loadPreset: (presetId) => {
    const preset = get().presets.find(p => p.id === presetId)
    if (!preset) return

    set({
      editorLayout: preset.editorLayout,
      panels: preset.panels,
      activePreset: presetId,
    })
  },

  deletePreset: (presetId) => {
    set(s => ({
      presets: s.presets.filter(p => p.id !== presetId || BUILT_IN_PRESETS.some(b => b.id === p.id)),
    }))
  },

  /* ── Persistence ────────────────────────────────── */

  saveLayout: () => {
    const state = get()
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        panels: state.panels,
        windowState: state.windowState,
        activePreset: state.activePreset,
      }))
    } catch {}
  },

  restoreLayout: () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const data = JSON.parse(stored)
        set({
          panels: { ...DEFAULT_PANELS, ...data.panels },
          windowState: { ...DEFAULT_WINDOW, ...data.windowState },
          activePreset: data.activePreset || 'default',
        })
      }
    } catch {}
  },

  resetLayout: () => {
    set({
      editorLayout: DEFAULT_LAYOUT,
      editorGroups: [{ ...DEFAULT_GROUP, id: `group-${++nextGroupId}` }],
      panels: DEFAULT_PANELS,
      zenMode: false,
      centeredLayout: false,
      activePreset: 'default',
    })
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  },
}))

/* ── Helpers ──────────────────────────────────────────── */

function findLeaf(node: SplitNode, groupId: string): SplitNode | null {
  if (node.type === 'leaf' && node.groupId === groupId) return node
  if (node.children) {
    for (const child of node.children) {
      const found = findLeaf(child, groupId)
      if (found) return found
    }
  }
  return null
}

function removeGroupFromLayout(node: SplitNode, groupId: string): SplitNode {
  if (node.type === 'leaf') return node
  if (!node.children) return node

  const filtered = node.children.filter(child => {
    if (child.type === 'leaf' && child.groupId === groupId) return false
    return true
  }).map(child => removeGroupFromLayout(child, groupId))

  if (filtered.length === 1) return filtered[0]
  return { ...node, children: filtered }
}
