/**
 * Bookmark management store.
 * Manages line bookmarks, labeled bookmarks, bookmark groups,
 * and cross-file navigation.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/* ── Types ─────────────────────────────────────────────── */

export interface Bookmark {
  id: string
  filePath: string
  line: number
  column?: number
  label?: string
  color?: string
  group?: string
  createdAt: number
  note?: string
}

export interface BookmarkGroup {
  id: string
  name: string
  color: string
  collapsed: boolean
  sortOrder: number
}

export type BookmarkSortBy = 'file' | 'line' | 'label' | 'created' | 'group'

/* ── Store ─────────────────────────────────────────────── */

interface BookmarkState {
  bookmarks: Bookmark[]
  groups: BookmarkGroup[]
  activeGroup: string | null
  sortBy: BookmarkSortBy
  showLabels: boolean
  showNotes: boolean

  // CRUD
  addBookmark: (filePath: string, line: number, options?: Partial<Bookmark>) => Bookmark
  removeBookmark: (id: string) => void
  toggleBookmark: (filePath: string, line: number) => void
  updateBookmark: (id: string, updates: Partial<Bookmark>) => void
  clearAll: () => void
  clearFile: (filePath: string) => void

  // Groups
  addGroup: (name: string, color?: string) => BookmarkGroup
  removeGroup: (id: string) => void
  updateGroup: (id: string, updates: Partial<BookmarkGroup>) => void
  toggleGroupCollapse: (id: string) => void
  moveToGroup: (bookmarkId: string, groupId: string | null) => void

  // Navigation
  getBookmarksForFile: (filePath: string) => Bookmark[]
  getNext: (filePath: string, currentLine: number) => Bookmark | undefined
  getPrevious: (filePath: string, currentLine: number) => Bookmark | undefined
  getNextGlobal: (currentFile: string, currentLine: number) => Bookmark | undefined
  getPreviousGlobal: (currentFile: string, currentLine: number) => Bookmark | undefined

  // Queries
  hasBookmark: (filePath: string, line: number) => boolean
  getBookmarkAt: (filePath: string, line: number) => Bookmark | undefined
  getGroupedBookmarks: () => Map<string, Bookmark[]>
  getSortedBookmarks: () => Bookmark[]

  // Settings
  setSortBy: (sort: BookmarkSortBy) => void
  setShowLabels: (show: boolean) => void
  setShowNotes: (show: boolean) => void
  setActiveGroup: (groupId: string | null) => void

  // Import/Export
  exportBookmarks: () => string
  importBookmarks: (json: string) => number
}

/* ── Default Groups ────────────────────────────────────── */

const DEFAULT_GROUPS: BookmarkGroup[] = [
  { id: 'todo', name: 'TODO', color: '#f0883e', collapsed: false, sortOrder: 0 },
  { id: 'important', name: 'Important', color: '#f85149', collapsed: false, sortOrder: 1 },
  { id: 'review', name: 'Review', color: '#a371f7', collapsed: false, sortOrder: 2 },
  { id: 'reference', name: 'Reference', color: '#58a6ff', collapsed: false, sortOrder: 3 },
]

const BOOKMARK_COLORS = [
  '#58a6ff', '#3fb950', '#f0883e', '#f85149', '#a371f7',
  '#d29922', '#79c0ff', '#56d364', '#ffa657', '#ff7b72',
]

/* ── Store Implementation ──────────────────────────────── */

export const useBookmarkStore = create<BookmarkState>()(
  persist(
    (set, get) => ({
      bookmarks: [],
      groups: DEFAULT_GROUPS,
      activeGroup: null,
      sortBy: 'file' as BookmarkSortBy,
      showLabels: true,
      showNotes: false,

      addBookmark: (filePath, line, options = {}) => {
        const id = `bm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const bookmark: Bookmark = {
          id,
          filePath,
          line,
          column: options.column || 1,
          label: options.label,
          color: options.color || BOOKMARK_COLORS[get().bookmarks.length % BOOKMARK_COLORS.length],
          group: options.group || get().activeGroup || undefined,
          createdAt: Date.now(),
          note: options.note,
        }

        set(s => ({ bookmarks: [...s.bookmarks, bookmark] }))
        return bookmark
      },

      removeBookmark: (id) => {
        set(s => ({ bookmarks: s.bookmarks.filter(b => b.id !== id) }))
      },

      toggleBookmark: (filePath, line) => {
        const existing = get().getBookmarkAt(filePath, line)
        if (existing) {
          get().removeBookmark(existing.id)
        } else {
          get().addBookmark(filePath, line)
        }
      },

      updateBookmark: (id, updates) => {
        set(s => ({
          bookmarks: s.bookmarks.map(b => b.id === id ? { ...b, ...updates } : b),
        }))
      },

      clearAll: () => set({ bookmarks: [] }),

      clearFile: (filePath) => {
        set(s => ({ bookmarks: s.bookmarks.filter(b => b.filePath !== filePath) }))
      },

      // Groups
      addGroup: (name, color) => {
        const id = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const group: BookmarkGroup = {
          id,
          name,
          color: color || BOOKMARK_COLORS[get().groups.length % BOOKMARK_COLORS.length],
          collapsed: false,
          sortOrder: get().groups.length,
        }
        set(s => ({ groups: [...s.groups, group] }))
        return group
      },

      removeGroup: (id) => {
        set(s => ({
          groups: s.groups.filter(g => g.id !== id),
          bookmarks: s.bookmarks.map(b => b.group === id ? { ...b, group: undefined } : b),
        }))
      },

      updateGroup: (id, updates) => {
        set(s => ({
          groups: s.groups.map(g => g.id === id ? { ...g, ...updates } : g),
        }))
      },

      toggleGroupCollapse: (id) => {
        set(s => ({
          groups: s.groups.map(g => g.id === id ? { ...g, collapsed: !g.collapsed } : g),
        }))
      },

      moveToGroup: (bookmarkId, groupId) => {
        set(s => ({
          bookmarks: s.bookmarks.map(b =>
            b.id === bookmarkId ? { ...b, group: groupId || undefined } : b
          ),
        }))
      },

      // Navigation
      getBookmarksForFile: (filePath) => {
        return get().bookmarks
          .filter(b => b.filePath === filePath)
          .sort((a, b) => a.line - b.line)
      },

      getNext: (filePath, currentLine) => {
        const fileBookmarks = get().getBookmarksForFile(filePath)
        return fileBookmarks.find(b => b.line > currentLine) || fileBookmarks[0]
      },

      getPrevious: (filePath, currentLine) => {
        const fileBookmarks = get().getBookmarksForFile(filePath)
        const reversed = [...fileBookmarks].reverse()
        return reversed.find(b => b.line < currentLine) || reversed[0]
      },

      getNextGlobal: (currentFile, currentLine) => {
        const sorted = get().getSortedBookmarks()
        const currentIdx = sorted.findIndex(
          b => b.filePath === currentFile && b.line > currentLine
        )
        if (currentIdx >= 0) return sorted[currentIdx]

        // Find first bookmark in a file that comes after current file
        const fileIdx = sorted.findIndex(b => b.filePath > currentFile)
        if (fileIdx >= 0) return sorted[fileIdx]

        // Wrap around
        return sorted[0]
      },

      getPreviousGlobal: (currentFile, currentLine) => {
        const sorted = get().getSortedBookmarks()
        const reversed = [...sorted].reverse()
        const currentIdx = reversed.findIndex(
          b => b.filePath === currentFile && b.line < currentLine
        )
        if (currentIdx >= 0) return reversed[currentIdx]

        const fileIdx = reversed.findIndex(b => b.filePath < currentFile)
        if (fileIdx >= 0) return reversed[fileIdx]

        return reversed[0]
      },

      // Queries
      hasBookmark: (filePath, line) => {
        return get().bookmarks.some(b => b.filePath === filePath && b.line === line)
      },

      getBookmarkAt: (filePath, line) => {
        return get().bookmarks.find(b => b.filePath === filePath && b.line === line)
      },

      getGroupedBookmarks: () => {
        const groups = new Map<string, Bookmark[]>()
        groups.set('ungrouped', [])

        for (const group of get().groups) {
          groups.set(group.id, [])
        }

        for (const bookmark of get().bookmarks) {
          const key = bookmark.group || 'ungrouped'
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key)!.push(bookmark)
        }

        return groups
      },

      getSortedBookmarks: () => {
        const { bookmarks, sortBy } = get()
        return [...bookmarks].sort((a, b) => {
          switch (sortBy) {
            case 'file':
              return a.filePath.localeCompare(b.filePath) || a.line - b.line
            case 'line':
              return a.line - b.line
            case 'label':
              return (a.label || '').localeCompare(b.label || '')
            case 'created':
              return b.createdAt - a.createdAt
            case 'group':
              return (a.group || 'zzz').localeCompare(b.group || 'zzz') || a.line - b.line
            default:
              return 0
          }
        })
      },

      // Settings
      setSortBy: (sort) => set({ sortBy: sort }),
      setShowLabels: (show) => set({ showLabels: show }),
      setShowNotes: (show) => set({ showNotes: show }),
      setActiveGroup: (groupId) => set({ activeGroup: groupId }),

      // Import/Export
      exportBookmarks: () => {
        const { bookmarks, groups } = get()
        return JSON.stringify({ bookmarks, groups, version: 1 }, null, 2)
      },

      importBookmarks: (json) => {
        try {
          const data = JSON.parse(json)
          if (!data.bookmarks || !Array.isArray(data.bookmarks)) return 0

          const newBookmarks = data.bookmarks.map((b: any) => ({
            ...b,
            id: `bm-imported-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            createdAt: b.createdAt || Date.now(),
          }))

          set(s => ({
            bookmarks: [...s.bookmarks, ...newBookmarks],
            groups: data.groups ? [...s.groups, ...data.groups.filter(
              (g: any) => !s.groups.some(eg => eg.id === g.id)
            )] : s.groups,
          }))

          return newBookmarks.length
        } catch {
          return 0
        }
      },
    }),
    {
      name: 'orion-bookmarks',
      partialize: (state) => ({
        bookmarks: state.bookmarks,
        groups: state.groups,
        sortBy: state.sortBy,
        showLabels: state.showLabels,
        showNotes: state.showNotes,
        activeGroup: state.activeGroup,
      }),
    }
  )
)
