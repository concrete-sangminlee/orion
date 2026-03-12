/**
 * Editor group management store.
 * Manages split editors, editor groups, tab ordering,
 * and multi-pane editor layouts.
 */

import { create } from 'zustand'

/* ── Types ─────────────────────────────────────────────── */

export type SplitDirection = 'horizontal' | 'vertical'

export interface EditorTab {
  id: string
  filePath: string
  fileName: string
  isModified: boolean
  isPinned: boolean
  isPreview: boolean
  scrollTop: number
  cursorLine: number
  cursorColumn: number
  viewState?: any
}

export interface EditorGroup {
  id: string
  tabs: EditorTab[]
  activeTabId: string | null
  width: number  // percentage
  height: number // percentage
}

export interface EditorLayout {
  type: 'single' | 'split'
  direction?: SplitDirection
  groups: EditorGroup[]
  activeGroupId: string
  ratio: number[] // split ratio (e.g. [50, 50])
}

/* ── Store ─────────────────────────────────────────────── */

interface EditorGroupState {
  layout: EditorLayout
  maxGroups: number
  closedTabs: { filePath: string; groupId: string; timestamp: number }[]
  maxClosedTabs: number

  // Group operations
  getActiveGroup: () => EditorGroup
  setActiveGroup: (groupId: string) => void
  splitEditor: (direction: SplitDirection, tabId?: string) => string
  closeGroup: (groupId: string) => void
  mergeGroups: () => void

  // Tab operations
  openTab: (groupId: string, filePath: string, options?: { preview?: boolean; pinned?: boolean }) => string
  closeTab: (groupId: string, tabId: string) => void
  closeOtherTabs: (groupId: string, tabId: string) => void
  closeTabsToRight: (groupId: string, tabId: string) => void
  closeTabsToLeft: (groupId: string, tabId: string) => void
  closeAllTabs: (groupId: string) => void
  closeSavedTabs: (groupId: string) => void
  setActiveTab: (groupId: string, tabId: string) => void
  pinTab: (groupId: string, tabId: string) => void
  unpinTab: (groupId: string, tabId: string) => void
  moveTab: (fromGroupId: string, toGroupId: string, tabId: string) => void
  reorderTab: (groupId: string, fromIndex: number, toIndex: number) => void
  updateTabState: (groupId: string, tabId: string, updates: Partial<EditorTab>) => void
  reopenClosedTab: () => string | undefined

  // Layout
  setSplitRatio: (ratio: number[]) => void
  resetLayout: () => void

  // Queries
  findTabByFilePath: (filePath: string) => { groupId: string; tab: EditorTab } | undefined
  getGroupTabs: (groupId: string) => EditorTab[]
  getActiveTab: () => EditorTab | undefined
  isFileOpen: (filePath: string) => boolean
}

/* ── Helpers ───────────────────────────────────────────── */

function createGroup(): EditorGroup {
  return {
    id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    tabs: [],
    activeTabId: null,
    width: 100,
    height: 100,
  }
}

function getFileName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() || filePath
}

const defaultGroup = createGroup()
defaultGroup.id = 'group-default'

/* ── Store Implementation ──────────────────────────────── */

export const useEditorGroupStore = create<EditorGroupState>()((set, get) => ({
  layout: {
    type: 'single',
    groups: [defaultGroup],
    activeGroupId: defaultGroup.id,
    ratio: [100],
  },
  maxGroups: 4,
  closedTabs: [],
  maxClosedTabs: 20,

  getActiveGroup: () => {
    const { layout } = get()
    return layout.groups.find(g => g.id === layout.activeGroupId) || layout.groups[0]
  },

  setActiveGroup: (groupId) => {
    set(s => ({
      layout: { ...s.layout, activeGroupId: groupId },
    }))
  },

  splitEditor: (direction, tabId) => {
    const state = get()
    if (state.layout.groups.length >= state.maxGroups) return state.layout.groups[state.layout.groups.length - 1].id

    const newGroup = createGroup()
    const activeGroup = state.getActiveGroup()

    // If tabId specified, move that tab to new group
    if (tabId) {
      const tab = activeGroup.tabs.find(t => t.id === tabId)
      if (tab) {
        newGroup.tabs = [{ ...tab }]
        newGroup.activeTabId = tab.id
      }
    }

    const groupCount = state.layout.groups.length + 1
    const evenRatio = Array(groupCount).fill(Math.floor(100 / groupCount))

    set(s => ({
      layout: {
        type: 'split',
        direction,
        groups: [...s.layout.groups, newGroup],
        activeGroupId: newGroup.id,
        ratio: evenRatio,
      },
    }))

    return newGroup.id
  },

  closeGroup: (groupId) => {
    set(s => {
      const groups = s.layout.groups.filter(g => g.id !== groupId)
      if (groups.length === 0) {
        groups.push(createGroup())
      }

      const activeGroupId = s.layout.activeGroupId === groupId
        ? groups[0].id
        : s.layout.activeGroupId

      return {
        layout: {
          type: groups.length === 1 ? 'single' : 'split',
          direction: s.layout.direction,
          groups,
          activeGroupId,
          ratio: Array(groups.length).fill(Math.floor(100 / groups.length)),
        },
      }
    })
  },

  mergeGroups: () => {
    set(s => {
      const allTabs: EditorTab[] = []
      const seen = new Set<string>()

      for (const group of s.layout.groups) {
        for (const tab of group.tabs) {
          if (!seen.has(tab.filePath)) {
            seen.add(tab.filePath)
            allTabs.push(tab)
          }
        }
      }

      const merged = createGroup()
      merged.tabs = allTabs
      merged.activeTabId = allTabs[allTabs.length - 1]?.id || null

      return {
        layout: {
          type: 'single',
          groups: [merged],
          activeGroupId: merged.id,
          ratio: [100],
        },
      }
    })
  },

  openTab: (groupId, filePath, options = {}) => {
    const state = get()

    // Check if already open in this group
    const group = state.layout.groups.find(g => g.id === groupId)
    if (group) {
      const existing = group.tabs.find(t => t.filePath === filePath)
      if (existing) {
        // If it's a preview tab, make it permanent
        if (existing.isPreview && !options.preview) {
          get().updateTabState(groupId, existing.id, { isPreview: false })
        }
        get().setActiveTab(groupId, existing.id)
        return existing.id
      }
    }

    const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
    const tab: EditorTab = {
      id: tabId,
      filePath,
      fileName: getFileName(filePath),
      isModified: false,
      isPinned: options.pinned || false,
      isPreview: options.preview || false,
      scrollTop: 0,
      cursorLine: 1,
      cursorColumn: 1,
    }

    set(s => ({
      layout: {
        ...s.layout,
        groups: s.layout.groups.map(g => {
          if (g.id !== groupId) return g

          // Replace existing preview tab if opening as preview
          let newTabs = g.tabs
          if (options.preview) {
            const previewIdx = g.tabs.findIndex(t => t.isPreview)
            if (previewIdx >= 0) {
              newTabs = [...g.tabs]
              newTabs[previewIdx] = tab
              return { ...g, tabs: newTabs, activeTabId: tabId }
            }
          }

          return { ...g, tabs: [...g.tabs, tab], activeTabId: tabId }
        }),
      },
    }))

    return tabId
  },

  closeTab: (groupId, tabId) => {
    set(s => {
      const group = s.layout.groups.find(g => g.id === groupId)
      if (!group) return s

      const tab = group.tabs.find(t => t.id === tabId)
      const tabIndex = group.tabs.findIndex(t => t.id === tabId)
      const newTabs = group.tabs.filter(t => t.id !== tabId)

      // Track closed tab
      const closedTabs = tab ? [
        { filePath: tab.filePath, groupId, timestamp: Date.now() },
        ...s.closedTabs.slice(0, s.maxClosedTabs - 1),
      ] : s.closedTabs

      // Select next active tab
      let activeTabId = group.activeTabId
      if (activeTabId === tabId) {
        if (newTabs.length === 0) {
          activeTabId = null
        } else if (tabIndex >= newTabs.length) {
          activeTabId = newTabs[newTabs.length - 1].id
        } else {
          activeTabId = newTabs[tabIndex].id
        }
      }

      return {
        layout: {
          ...s.layout,
          groups: s.layout.groups.map(g =>
            g.id === groupId ? { ...g, tabs: newTabs, activeTabId } : g
          ),
        },
        closedTabs,
      }
    })
  },

  closeOtherTabs: (groupId, tabId) => {
    set(s => ({
      layout: {
        ...s.layout,
        groups: s.layout.groups.map(g =>
          g.id === groupId
            ? { ...g, tabs: g.tabs.filter(t => t.id === tabId || t.isPinned), activeTabId: tabId }
            : g
        ),
      },
    }))
  },

  closeTabsToRight: (groupId, tabId) => {
    set(s => ({
      layout: {
        ...s.layout,
        groups: s.layout.groups.map(g => {
          if (g.id !== groupId) return g
          const idx = g.tabs.findIndex(t => t.id === tabId)
          return {
            ...g,
            tabs: g.tabs.filter((t, i) => i <= idx || t.isPinned),
            activeTabId: tabId,
          }
        }),
      },
    }))
  },

  closeTabsToLeft: (groupId, tabId) => {
    set(s => ({
      layout: {
        ...s.layout,
        groups: s.layout.groups.map(g => {
          if (g.id !== groupId) return g
          const idx = g.tabs.findIndex(t => t.id === tabId)
          return {
            ...g,
            tabs: g.tabs.filter((t, i) => i >= idx || t.isPinned),
            activeTabId: tabId,
          }
        }),
      },
    }))
  },

  closeAllTabs: (groupId) => {
    set(s => ({
      layout: {
        ...s.layout,
        groups: s.layout.groups.map(g =>
          g.id === groupId
            ? { ...g, tabs: g.tabs.filter(t => t.isPinned), activeTabId: null }
            : g
        ),
      },
    }))
  },

  closeSavedTabs: (groupId) => {
    set(s => ({
      layout: {
        ...s.layout,
        groups: s.layout.groups.map(g =>
          g.id === groupId
            ? { ...g, tabs: g.tabs.filter(t => t.isModified || t.isPinned) }
            : g
        ),
      },
    }))
  },

  setActiveTab: (groupId, tabId) => {
    set(s => ({
      layout: {
        ...s.layout,
        activeGroupId: groupId,
        groups: s.layout.groups.map(g =>
          g.id === groupId ? { ...g, activeTabId: tabId } : g
        ),
      },
    }))
  },

  pinTab: (groupId, tabId) => {
    get().updateTabState(groupId, tabId, { isPinned: true, isPreview: false })
  },

  unpinTab: (groupId, tabId) => {
    get().updateTabState(groupId, tabId, { isPinned: false })
  },

  moveTab: (fromGroupId, toGroupId, tabId) => {
    set(s => {
      const fromGroup = s.layout.groups.find(g => g.id === fromGroupId)
      if (!fromGroup) return s

      const tab = fromGroup.tabs.find(t => t.id === tabId)
      if (!tab) return s

      return {
        layout: {
          ...s.layout,
          groups: s.layout.groups.map(g => {
            if (g.id === fromGroupId) {
              const tabs = g.tabs.filter(t => t.id !== tabId)
              return { ...g, tabs, activeTabId: tabs[tabs.length - 1]?.id || null }
            }
            if (g.id === toGroupId) {
              return { ...g, tabs: [...g.tabs, tab], activeTabId: tab.id }
            }
            return g
          }),
          activeGroupId: toGroupId,
        },
      }
    })
  },

  reorderTab: (groupId, fromIndex, toIndex) => {
    set(s => ({
      layout: {
        ...s.layout,
        groups: s.layout.groups.map(g => {
          if (g.id !== groupId) return g
          const tabs = [...g.tabs]
          const [moved] = tabs.splice(fromIndex, 1)
          tabs.splice(toIndex, 0, moved)
          return { ...g, tabs }
        }),
      },
    }))
  },

  updateTabState: (groupId, tabId, updates) => {
    set(s => ({
      layout: {
        ...s.layout,
        groups: s.layout.groups.map(g =>
          g.id === groupId
            ? {
                ...g,
                tabs: g.tabs.map(t =>
                  t.id === tabId ? { ...t, ...updates } : t
                ),
              }
            : g
        ),
      },
    }))
  },

  reopenClosedTab: () => {
    const { closedTabs } = get()
    if (closedTabs.length === 0) return undefined

    const last = closedTabs[0]
    set(s => ({ closedTabs: s.closedTabs.slice(1) }))

    const groupId = get().layout.groups.find(g => g.id === last.groupId)?.id
      || get().layout.groups[0]?.id

    if (groupId) {
      return get().openTab(groupId, last.filePath)
    }
    return undefined
  },

  setSplitRatio: (ratio) => {
    set(s => ({ layout: { ...s.layout, ratio } }))
  },

  resetLayout: () => {
    const group = createGroup()
    set({
      layout: {
        type: 'single',
        groups: [group],
        activeGroupId: group.id,
        ratio: [100],
      },
    })
  },

  findTabByFilePath: (filePath) => {
    for (const group of get().layout.groups) {
      const tab = group.tabs.find(t => t.filePath === filePath)
      if (tab) return { groupId: group.id, tab }
    }
    return undefined
  },

  getGroupTabs: (groupId) => {
    return get().layout.groups.find(g => g.id === groupId)?.tabs || []
  },

  getActiveTab: () => {
    const group = get().getActiveGroup()
    return group.tabs.find(t => t.id === group.activeTabId)
  },

  isFileOpen: (filePath) => {
    return get().layout.groups.some(g => g.tabs.some(t => t.filePath === filePath))
  },
}))
