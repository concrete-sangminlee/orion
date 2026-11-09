import { create } from 'zustand'
import type { OpenFile } from '@shared/types'
import { useRecentFilesStore } from './recentFiles'

// ─── Types ───────────────────────────────────────────────────────────────────

export type EditorGroupPosition = 'left' | 'right' | 'top' | 'bottom'

export interface EditorGroup {
  id: string
  position: EditorGroupPosition
  openFiles: OpenFile[]
  activeFilePath: string | null
  previewPath: string | null
  pinnedTabs: string[]
}

export interface CursorPosition {
  line: number
  column: number
}

export interface EditorFileState {
  cursorPosition: CursorPosition
  scrollTop: number
  scrollLeft: number
  foldedRanges: Array<{ start: number; end: number }>
}

export interface UnsavedSnapshot {
  path: string
  content: string
  timestamp: number
  originalContent: string
}

export interface WorkspaceSession {
  name: string
  createdAt: number
  updatedAt: number
  groups: Array<{
    id: string
    position: EditorGroupPosition
    filePaths: string[]
    activeFilePath: string | null
  }>
}

export interface RecoveryNotification {
  path: string
  snapshotTimestamp: number
  dismissed: boolean
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TAB_HISTORY_MAX_DEPTH = 50
const PERSISTENCE_DEBOUNCE_MS = 1000
const PERSISTENCE_KEY = 'orion-editor-state'
const RECOVERY_KEY = 'orion-editor-recovery'
const SESSIONS_KEY = 'orion-editor-sessions'

// ─── Persistence helpers ─────────────────────────────────────────────────────

let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null

function debouncedPersist(fileStates: Record<string, EditorFileState>) {
  if (persistDebounceTimer) clearTimeout(persistDebounceTimer)
  persistDebounceTimer = setTimeout(() => {
    try {
      localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(fileStates))
    } catch {
      // localStorage may be full or unavailable
    }
  }, PERSISTENCE_DEBOUNCE_MS)
}

function loadPersistedState(): Record<string, EditorFileState> {
  try {
    const raw = localStorage.getItem(PERSISTENCE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore parse errors
  }
  return {}
}

function persistRecoverySnapshots(snapshots: Record<string, UnsavedSnapshot>) {
  try {
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(snapshots))
  } catch {
    // localStorage may be full or unavailable
  }
}

function loadRecoverySnapshots(): Record<string, UnsavedSnapshot> {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return {}
}

function persistSessions(sessions: WorkspaceSession[]) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
  } catch {
    // ignore
  }
}

function loadSessions(): WorkspaceSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return []
}

// ─── Default group helper ────────────────────────────────────────────────────

function createDefaultGroup(): EditorGroup {
  return {
    id: 'group-left',
    position: 'left',
    openFiles: [],
    activeFilePath: null,
    previewPath: null,
    pinnedTabs: [],
  }
}

function generateGroupId(position: EditorGroupPosition): string {
  return `group-${position}-${Date.now()}`
}

// ─── Store interface ─────────────────────────────────────────────────────────

export interface EditorStore {
  // === Legacy flat state (kept for backward compatibility) ===
  openFiles: OpenFile[]
  activeFilePath: string | null
  previewPath: string | null
  pinnedTabs: string[]

  // === Existing actions ===
  openFile: (file: OpenFile, options?: { preview?: boolean }) => void
  closeFile: (path: string) => void
  closeAllFiles: () => void
  closeOtherFiles: (path: string) => void
  closeToRight: (path: string) => void
  closeSaved: () => void
  setActiveFile: (path: string) => void
  switchToNextTab: () => void
  switchToPrevTab: () => void
  updateFileContent: (path: string, content: string) => void
  markAiModified: (path: string) => void
  markSaved: (path: string) => void
  reorderFiles: (fromIndex: number, toIndex: number) => void
  pinFile: (path: string) => void
  pinTab: (path: string) => void
  unpinTab: (path: string) => void
  isTabPinned: (path: string) => boolean
  reloadFileContent: (path: string, content: string) => void
  markExternalChange: (path: string) => void
  dismissExternalChange: (path: string) => void
  markDeletedOnDisk: (path: string) => void

  // === 1. Tab groups / Split editor state ===
  editorGroups: EditorGroup[]
  activeGroupId: string
  createGroup: (position: EditorGroupPosition) => string
  closeGroup: (groupId: string) => void
  setActiveGroup: (groupId: string) => void
  openFileInGroup: (groupId: string, file: OpenFile, options?: { preview?: boolean }) => void
  closeFileInGroup: (groupId: string, path: string) => void
  moveTabToGroup: (fromGroupId: string, toGroupId: string, filePath: string) => void
  getGroup: (groupId: string) => EditorGroup | undefined
  splitEditor: (position: EditorGroupPosition, filePath?: string) => string

  // === 2. File recovery ===
  unsavedSnapshots: Record<string, UnsavedSnapshot>
  recoveryNotifications: RecoveryNotification[]
  trackUnsavedChange: (path: string, content: string, originalContent: string) => void
  clearRecoverySnapshot: (path: string) => void
  getRecoverableFiles: () => UnsavedSnapshot[]
  recoverFile: (path: string) => UnsavedSnapshot | null
  dismissRecoveryNotification: (path: string) => void
  dismissAllRecoveryNotifications: () => void
  checkForRecoverableFiles: () => void

  // === 3. Editor state persistence ===
  fileStates: Record<string, EditorFileState>
  updateCursorPosition: (path: string, position: CursorPosition) => void
  updateScrollPosition: (path: string, scrollTop: number, scrollLeft: number) => void
  updateFoldingState: (path: string, foldedRanges: Array<{ start: number; end: number }>) => void
  getFileState: (path: string) => EditorFileState | undefined

  // === 4. Tab history navigation ===
  tabHistory: string[]
  tabHistoryIndex: number
  navigateBack: () => void
  navigateForward: () => void
  canNavigateBack: () => boolean
  canNavigateForward: () => boolean

  // === 5. Workspace sessions ===
  sessions: WorkspaceSession[]
  activeSessionName: string | null
  saveSession: (name: string) => void
  loadSession: (name: string) => void
  deleteSession: (name: string) => void
  renameSession: (oldName: string, newName: string) => void
  getSessions: () => WorkspaceSession[]
  autoSaveSession: () => void
}

// ─── Load initial persisted data ─────────────────────────────────────────────

const initialFileStates = loadPersistedState()
const initialRecoverySnapshots = loadRecoverySnapshots()
const initialSessions = loadSessions()

// Build initial recovery notifications from any existing snapshots
const initialRecoveryNotifications: RecoveryNotification[] = Object.values(
  initialRecoverySnapshots
).map((s) => ({
  path: s.path,
  snapshotTimestamp: s.timestamp,
  dismissed: false,
}))

// ─── Store implementation ────────────────────────────────────────────────────

export const useEditorStore = create<EditorStore>((set, get) => ({
  // === Legacy flat state ===
  openFiles: [],
  activeFilePath: null,
  previewPath: null,
  pinnedTabs: [],

  // === Tab groups state ===
  editorGroups: [createDefaultGroup()],
  activeGroupId: 'group-left',

  // === File recovery state ===
  unsavedSnapshots: initialRecoverySnapshots,
  recoveryNotifications: initialRecoveryNotifications,

  // === Editor state persistence ===
  fileStates: initialFileStates,

  // === Tab history ===
  tabHistory: [],
  tabHistoryIndex: -1,

  // === Workspace sessions ===
  sessions: initialSessions,
  activeSessionName: null,

  // ─── Existing actions (unchanged) ──────────────────────────────────────────

  openFile: (file, options) => {
    // Track in recent files
    setTimeout(() => {
      useRecentFilesStore.getState().addRecentFile(file.path, file.name)
    }, 0)

    return set((state) => {
      const isPreview = options?.preview ?? false

      // If the file is already open
      const exists = state.openFiles.find((f) => f.path === file.path)
      if (exists) {
        // If opening as pinned (double-click) and currently a preview, pin it
        if (!isPreview && !exists.isPinned) {
          return {
            openFiles: state.openFiles.map((f) =>
              f.path === file.path ? { ...f, isPinned: true } : f
            ),
            activeFilePath: file.path,
            previewPath: state.previewPath === file.path ? null : state.previewPath,
            // Push to tab history
            ...pushTabHistory(state.tabHistory, state.tabHistoryIndex, file.path),
          }
        }
        return {
          activeFilePath: file.path,
          ...pushTabHistory(state.tabHistory, state.tabHistoryIndex, file.path),
        }
      }

      // Opening a new file
      if (isPreview) {
        // Replace existing preview tab if any
        const currentPreview = state.previewPath
        if (currentPreview) {
          const filtered = state.openFiles.filter((f) => f.path !== currentPreview)
          return {
            openFiles: [...filtered, { ...file, isPinned: false }],
            activeFilePath: file.path,
            previewPath: file.path,
            ...pushTabHistory(state.tabHistory, state.tabHistoryIndex, file.path),
          }
        }
        // No existing preview, just add as preview
        return {
          openFiles: [...state.openFiles, { ...file, isPinned: false }],
          activeFilePath: file.path,
          previewPath: file.path,
          ...pushTabHistory(state.tabHistory, state.tabHistoryIndex, file.path),
        }
      }

      // Opening as pinned (double-click, command palette, search, etc.)
      return {
        openFiles: [...state.openFiles, { ...file, isPinned: true }],
        activeFilePath: file.path,
        // If this file was somehow the preview, clear that
        previewPath: state.previewPath === file.path ? null : state.previewPath,
        ...pushTabHistory(state.tabHistory, state.tabHistoryIndex, file.path),
      }
    })
  },

  closeFile: (path) =>
    set((state) => {
      // Pinned tabs cannot be closed without unpinning first
      if (state.pinnedTabs.includes(path)) return state
      const files = state.openFiles.filter((f) => f.path !== path)
      const activePath =
        state.activeFilePath === path
          ? files[files.length - 1]?.path ?? null
          : state.activeFilePath
      return {
        openFiles: files,
        activeFilePath: activePath,
        previewPath: state.previewPath === path ? null : state.previewPath,
      }
    }),

  setActiveFile: (path) =>
    set((state) => ({
      activeFilePath: path,
      ...pushTabHistory(state.tabHistory, state.tabHistoryIndex, path),
    })),

  updateFileContent: (path, content) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, content, isModified: true, isPinned: true } : f
      ),
      // Editing a file pins it
      previewPath: state.previewPath === path ? null : state.previewPath,
    })),

  markAiModified: (path) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, aiModified: true, isPinned: true } : f
      ),
      previewPath: state.previewPath === path ? null : state.previewPath,
    })),

  markSaved: (path) =>
    set((state) => {
      // Clear recovery snapshot when file is saved
      const newSnapshots = { ...state.unsavedSnapshots }
      delete newSnapshots[path]
      persistRecoverySnapshots(newSnapshots)

      return {
        // The disk now holds this buffer, so any conflict flag is resolved.
        openFiles: state.openFiles.map((f) =>
          f.path === path ? { ...f, isModified: false, hasExternalChange: false, isDeletedOnDisk: false } : f
        ),
        unsavedSnapshots: newSnapshots,
      }
    }),

  closeAllFiles: () =>
    set((state) => {
      const pinnedFiles = state.openFiles.filter((f) => state.pinnedTabs.includes(f.path))
      if (pinnedFiles.length === 0) {
        return { openFiles: [], activeFilePath: null, previewPath: null }
      }
      const activePath = pinnedFiles.find((f) => f.path === state.activeFilePath)
        ? state.activeFilePath
        : pinnedFiles[0]?.path ?? null
      return {
        openFiles: pinnedFiles,
        activeFilePath: activePath,
        previewPath: state.previewPath && pinnedFiles.find((f) => f.path === state.previewPath)
          ? state.previewPath
          : null,
      }
    }),

  closeOtherFiles: (path) =>
    set((state) => ({
      openFiles: state.openFiles.filter((f) => f.path === path || state.pinnedTabs.includes(f.path)),
      activeFilePath: path,
      previewPath: state.previewPath === path ? state.previewPath : null,
    })),

  closeToRight: (path) =>
    set((state) => {
      const idx = state.openFiles.findIndex((f) => f.path === path)
      if (idx === -1) return state
      // Keep tabs to the left (including target), plus any pinned tabs to the right
      const files = state.openFiles.filter((f, i) =>
        i <= idx || state.pinnedTabs.includes(f.path)
      )
      const activePath =
        state.activeFilePath && files.find((f) => f.path === state.activeFilePath)
          ? state.activeFilePath
          : path
      return {
        openFiles: files,
        activeFilePath: activePath,
        previewPath:
          state.previewPath && files.find((f) => f.path === state.previewPath)
            ? state.previewPath
            : null,
      }
    }),

  closeSaved: () =>
    set((state) => {
      const files = state.openFiles.filter((f) => f.isModified || state.pinnedTabs.includes(f.path))
      const activePath =
        state.activeFilePath && files.find((f) => f.path === state.activeFilePath)
          ? state.activeFilePath
          : files[files.length - 1]?.path ?? null
      return {
        openFiles: files,
        activeFilePath: activePath,
        previewPath:
          state.previewPath && files.find((f) => f.path === state.previewPath)
            ? state.previewPath
            : null,
      }
    }),

  switchToNextTab: () =>
    set((state) => {
      if (state.openFiles.length <= 1) return state
      const idx = state.openFiles.findIndex((f) => f.path === state.activeFilePath)
      const nextIdx = (idx + 1) % state.openFiles.length
      const nextPath = state.openFiles[nextIdx].path
      return {
        activeFilePath: nextPath,
        ...pushTabHistory(state.tabHistory, state.tabHistoryIndex, nextPath),
      }
    }),

  switchToPrevTab: () =>
    set((state) => {
      if (state.openFiles.length <= 1) return state
      const idx = state.openFiles.findIndex((f) => f.path === state.activeFilePath)
      const prevIdx = (idx - 1 + state.openFiles.length) % state.openFiles.length
      const prevPath = state.openFiles[prevIdx].path
      return {
        activeFilePath: prevPath,
        ...pushTabHistory(state.tabHistory, state.tabHistoryIndex, prevPath),
      }
    }),

  reorderFiles: (fromIndex, toIndex) =>
    set((state) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= state.openFiles.length ||
        toIndex >= state.openFiles.length ||
        fromIndex === toIndex
      ) {
        return state
      }
      const pinnedCount = state.openFiles.filter((f) => state.pinnedTabs.includes(f.path)).length
      const movedFile = state.openFiles[fromIndex]
      const isMovedPinned = state.pinnedTabs.includes(movedFile.path)
      // Pinned tabs cannot be moved past the pinned zone boundary
      if (isMovedPinned && toIndex >= pinnedCount) return state
      // Unpinned tabs cannot be moved into the pinned zone
      if (!isMovedPinned && toIndex < pinnedCount) return state
      const files = [...state.openFiles]
      const [moved] = files.splice(fromIndex, 1)
      files.splice(toIndex, 0, moved)
      return { openFiles: files }
    }),

  pinFile: (path) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, isPinned: true } : f
      ),
      previewPath: state.previewPath === path ? null : state.previewPath,
    })),

  pinTab: (path) =>
    set((state) => {
      if (state.pinnedTabs.includes(path)) return state
      // Also ensure the file is "permanent" (not preview)
      const newPinnedTabs = [...state.pinnedTabs, path]
      // Move the pinned tab to end of pinned zone
      const pinnedCount = state.pinnedTabs.length // count before adding
      const fileIndex = state.openFiles.findIndex((f) => f.path === path)
      if (fileIndex === -1) return state
      const files = [...state.openFiles]
      if (fileIndex > pinnedCount) {
        const [moved] = files.splice(fileIndex, 1)
        files.splice(pinnedCount, 0, moved)
      }
      return {
        openFiles: files.map((f) =>
          f.path === path ? { ...f, isPinned: true } : f
        ),
        pinnedTabs: newPinnedTabs,
        previewPath: state.previewPath === path ? null : state.previewPath,
      }
    }),

  unpinTab: (path) =>
    set((state) => {
      if (!state.pinnedTabs.includes(path)) return state
      const newPinnedTabs = state.pinnedTabs.filter((p) => p !== path)
      // Move the unpinned tab to just after the remaining pinned zone
      const fileIndex = state.openFiles.findIndex((f) => f.path === path)
      if (fileIndex === -1) return state
      const files = [...state.openFiles]
      const newPinnedCount = newPinnedTabs.length
      if (fileIndex < newPinnedCount) {
        // Already in correct zone or before it
        const [moved] = files.splice(fileIndex, 1)
        files.splice(newPinnedCount, 0, moved)
      }
      return {
        openFiles: files,
        pinnedTabs: newPinnedTabs,
      }
    }),

  isTabPinned: (path: string): boolean => {
    return (useEditorStore as unknown as { getState: () => EditorStore }).getState().pinnedTabs.includes(path)
  },

  // Silently reload file content (used when file has no unsaved changes)
  reloadFileContent: (path, content) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path
          ? { ...f, content, isModified: false, hasExternalChange: false, isDeletedOnDisk: false }
          : f
      ),
    })),

  // Flag that a file has changed externally (used when file has unsaved changes)
  markExternalChange: (path) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, hasExternalChange: true } : f
      ),
    })),

  // Dismiss the external change flag (user chose "Keep Mine")
  dismissExternalChange: (path) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, hasExternalChange: false } : f
      ),
    })),

  // Mark a file as deleted on disk
  markDeletedOnDisk: (path) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, isDeletedOnDisk: true, hasExternalChange: false } : f
      ),
    })),

  // ─── 1. Tab groups / Split editor state ────────────────────────────────────

  createGroup: (position) => {
    const id = generateGroupId(position)
    set((state) => ({
      editorGroups: [
        ...state.editorGroups,
        {
          id,
          position,
          openFiles: [],
          activeFilePath: null,
          previewPath: null,
          pinnedTabs: [],
        },
      ],
      activeGroupId: id,
    }))
    return id
  },

  closeGroup: (groupId) =>
    set((state) => {
      // Cannot close the last group
      if (state.editorGroups.length <= 1) return state
      const filtered = state.editorGroups.filter((g) => g.id !== groupId)
      const newActiveGroupId =
        state.activeGroupId === groupId
          ? filtered[0]?.id ?? state.activeGroupId
          : state.activeGroupId
      return {
        editorGroups: filtered,
        activeGroupId: newActiveGroupId,
      }
    }),

  setActiveGroup: (groupId) =>
    set({ activeGroupId: groupId }),

  openFileInGroup: (groupId, file, options) => {
    // Track in recent files
    setTimeout(() => {
      useRecentFilesStore.getState().addRecentFile(file.path, file.name)
    }, 0)

    set((state) => {
      const isPreview = options?.preview ?? false
      const groups = state.editorGroups.map((group) => {
        if (group.id !== groupId) return group

        const exists = group.openFiles.find((f) => f.path === file.path)
        if (exists) {
          if (!isPreview && !exists.isPinned) {
            return {
              ...group,
              openFiles: group.openFiles.map((f) =>
                f.path === file.path ? { ...f, isPinned: true } : f
              ),
              activeFilePath: file.path,
              previewPath: group.previewPath === file.path ? null : group.previewPath,
            }
          }
          return { ...group, activeFilePath: file.path }
        }

        if (isPreview) {
          const currentPreview = group.previewPath
          if (currentPreview) {
            const filtered = group.openFiles.filter((f) => f.path !== currentPreview)
            return {
              ...group,
              openFiles: [...filtered, { ...file, isPinned: false }],
              activeFilePath: file.path,
              previewPath: file.path,
            }
          }
          return {
            ...group,
            openFiles: [...group.openFiles, { ...file, isPinned: false }],
            activeFilePath: file.path,
            previewPath: file.path,
          }
        }

        return {
          ...group,
          openFiles: [...group.openFiles, { ...file, isPinned: true }],
          activeFilePath: file.path,
          previewPath: group.previewPath === file.path ? null : group.previewPath,
        }
      })

      return {
        editorGroups: groups,
        activeGroupId: groupId,
        ...pushTabHistory(state.tabHistory, state.tabHistoryIndex, file.path),
      }
    })
  },

  closeFileInGroup: (groupId, path) =>
    set((state) => {
      let shouldRemoveGroup = false
      const groups = state.editorGroups.map((group) => {
        if (group.id !== groupId) return group
        if (group.pinnedTabs.includes(path)) return group

        const files = group.openFiles.filter((f) => f.path !== path)
        if (files.length === 0 && state.editorGroups.length > 1) {
          shouldRemoveGroup = true
        }

        const activePath =
          group.activeFilePath === path
            ? files[files.length - 1]?.path ?? null
            : group.activeFilePath

        return {
          ...group,
          openFiles: files,
          activeFilePath: activePath,
          previewPath: group.previewPath === path ? null : group.previewPath,
        }
      })

      const finalGroups = shouldRemoveGroup
        ? groups.filter((g) => g.id !== groupId)
        : groups

      // Ensure we always have at least one group
      const resultGroups = finalGroups.length === 0
        ? [createDefaultGroup()]
        : finalGroups

      const newActiveGroupId =
        state.activeGroupId === groupId && shouldRemoveGroup
          ? resultGroups[0]?.id ?? state.activeGroupId
          : state.activeGroupId

      return {
        editorGroups: resultGroups,
        activeGroupId: newActiveGroupId,
      }
    }),

  moveTabToGroup: (fromGroupId, toGroupId, filePath) =>
    set((state) => {
      let fileToMove: OpenFile | null = null

      // Remove from source group
      let groups = state.editorGroups.map((group) => {
        if (group.id !== fromGroupId) return group
        const file = group.openFiles.find((f) => f.path === filePath)
        if (!file) return group
        fileToMove = file

        const files = group.openFiles.filter((f) => f.path !== filePath)
        const activePath =
          group.activeFilePath === filePath
            ? files[files.length - 1]?.path ?? null
            : group.activeFilePath

        return {
          ...group,
          openFiles: files,
          activeFilePath: activePath,
          previewPath: group.previewPath === filePath ? null : group.previewPath,
          pinnedTabs: group.pinnedTabs.filter((p) => p !== filePath),
        }
      })

      if (!fileToMove) return state

      // Add to target group
      groups = groups.map((group) => {
        if (group.id !== toGroupId) return group
        const exists = group.openFiles.find((f) => f.path === filePath)
        if (exists) return { ...group, activeFilePath: filePath }

        return {
          ...group,
          openFiles: [...group.openFiles, fileToMove!],
          activeFilePath: filePath,
        }
      })

      // Remove empty source group (if it has no files and there are other groups)
      const sourceGroup = groups.find((g) => g.id === fromGroupId)
      if (sourceGroup && sourceGroup.openFiles.length === 0 && groups.length > 1) {
        groups = groups.filter((g) => g.id !== fromGroupId)
      }

      return {
        editorGroups: groups,
        activeGroupId: toGroupId,
      }
    }),

  getGroup: (groupId) => {
    return get().editorGroups.find((g) => g.id === groupId)
  },

  splitEditor: (position, filePath) => {
    const state = get()
    const activeGroup = state.editorGroups.find((g) => g.id === state.activeGroupId)
    const pathToOpen = filePath ?? activeGroup?.activeFilePath

    const newGroupId = state.createGroup(position)

    if (pathToOpen && activeGroup) {
      const file = activeGroup.openFiles.find((f) => f.path === pathToOpen)
      if (file) {
        // Open a copy in the new group (don't remove from source)
        state.openFileInGroup(newGroupId, { ...file })
      }
    }

    return newGroupId
  },

  // ─── 2. File recovery ──────────────────────────────────────────────────────

  trackUnsavedChange: (path, content, originalContent) =>
    set((state) => {
      const newSnapshots = {
        ...state.unsavedSnapshots,
        [path]: {
          path,
          content,
          timestamp: Date.now(),
          originalContent,
        },
      }
      persistRecoverySnapshots(newSnapshots)
      return { unsavedSnapshots: newSnapshots }
    }),

  clearRecoverySnapshot: (path) =>
    set((state) => {
      const newSnapshots = { ...state.unsavedSnapshots }
      delete newSnapshots[path]
      persistRecoverySnapshots(newSnapshots)
      return {
        unsavedSnapshots: newSnapshots,
        recoveryNotifications: state.recoveryNotifications.filter((n) => n.path !== path),
      }
    }),

  getRecoverableFiles: () => {
    return Object.values(get().unsavedSnapshots)
  },

  recoverFile: (path) => {
    const state = get()
    const snapshot = state.unsavedSnapshots[path]
    if (!snapshot) return null

    // Apply the recovered content to the open file if it exists
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path
          ? { ...f, content: snapshot.content, isModified: true, isPinned: true }
          : f
      ),
      recoveryNotifications: s.recoveryNotifications.map((n) =>
        n.path === path ? { ...n, dismissed: true } : n
      ),
    }))

    return snapshot
  },

  dismissRecoveryNotification: (path) =>
    set((state) => ({
      recoveryNotifications: state.recoveryNotifications.map((n) =>
        n.path === path ? { ...n, dismissed: true } : n
      ),
    })),

  dismissAllRecoveryNotifications: () =>
    set((state) => ({
      recoveryNotifications: state.recoveryNotifications.map((n) => ({
        ...n,
        dismissed: true,
      })),
    })),

  checkForRecoverableFiles: () => {
    const state = get()
    const snapshots = state.unsavedSnapshots
    const existingPaths = new Set(state.recoveryNotifications.map((n) => n.path))

    const newNotifications: RecoveryNotification[] = Object.values(snapshots)
      .filter((s) => !existingPaths.has(s.path))
      .map((s) => ({
        path: s.path,
        snapshotTimestamp: s.timestamp,
        dismissed: false,
      }))

    if (newNotifications.length > 0) {
      set((s) => ({
        recoveryNotifications: [...s.recoveryNotifications, ...newNotifications],
      }))
    }
  },

  // ─── 3. Editor state persistence ──────────────────────────────────────────

  updateCursorPosition: (path, position) =>
    set((state) => {
      const newStates = {
        ...state.fileStates,
        [path]: {
          ...state.fileStates[path] ?? { scrollTop: 0, scrollLeft: 0, foldedRanges: [] },
          cursorPosition: position,
        },
      }
      debouncedPersist(newStates)
      return { fileStates: newStates }
    }),

  updateScrollPosition: (path, scrollTop, scrollLeft) =>
    set((state) => {
      const newStates = {
        ...state.fileStates,
        [path]: {
          ...state.fileStates[path] ?? { cursorPosition: { line: 1, column: 1 }, foldedRanges: [] },
          scrollTop,
          scrollLeft,
        },
      }
      debouncedPersist(newStates)
      return { fileStates: newStates }
    }),

  updateFoldingState: (path, foldedRanges) =>
    set((state) => {
      const newStates = {
        ...state.fileStates,
        [path]: {
          ...state.fileStates[path] ?? { cursorPosition: { line: 1, column: 1 }, scrollTop: 0, scrollLeft: 0 },
          foldedRanges,
        },
      }
      debouncedPersist(newStates)
      return { fileStates: newStates }
    }),

  getFileState: (path) => {
    return get().fileStates[path]
  },

  // ─── 4. Tab history navigation ─────────────────────────────────────────────

  navigateBack: () =>
    set((state) => {
      if (state.tabHistoryIndex <= 0) return state
      const newIndex = state.tabHistoryIndex - 1
      const targetPath = state.tabHistory[newIndex]
      // Only navigate if the file is still open
      const isOpen = state.openFiles.some((f) => f.path === targetPath)
      if (!isOpen) {
        // Skip closed files and try the next one back
        let idx = newIndex
        while (idx > 0) {
          idx--
          if (state.openFiles.some((f) => f.path === state.tabHistory[idx])) {
            return {
              tabHistoryIndex: idx,
              activeFilePath: state.tabHistory[idx],
            }
          }
        }
        return state
      }
      return {
        tabHistoryIndex: newIndex,
        activeFilePath: targetPath,
      }
    }),

  navigateForward: () =>
    set((state) => {
      if (state.tabHistoryIndex >= state.tabHistory.length - 1) return state
      const newIndex = state.tabHistoryIndex + 1
      const targetPath = state.tabHistory[newIndex]
      const isOpen = state.openFiles.some((f) => f.path === targetPath)
      if (!isOpen) {
        // Skip closed files and try the next one forward
        let idx = newIndex
        while (idx < state.tabHistory.length - 1) {
          idx++
          if (state.openFiles.some((f) => f.path === state.tabHistory[idx])) {
            return {
              tabHistoryIndex: idx,
              activeFilePath: state.tabHistory[idx],
            }
          }
        }
        return state
      }
      return {
        tabHistoryIndex: newIndex,
        activeFilePath: targetPath,
      }
    }),

  canNavigateBack: () => {
    const state = get()
    return state.tabHistoryIndex > 0
  },

  canNavigateForward: () => {
    const state = get()
    return state.tabHistoryIndex < state.tabHistory.length - 1
  },

  // ─── 5. Workspace sessions ─────────────────────────────────────────────────

  saveSession: (name) =>
    set((state) => {
      const session: WorkspaceSession = {
        name,
        createdAt: state.sessions.find((s) => s.name === name)?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        groups: state.editorGroups.map((g) => ({
          id: g.id,
          position: g.position,
          filePaths: g.openFiles.map((f) => f.path),
          activeFilePath: g.activeFilePath,
        })),
      }

      // If no groups have files, save from flat state instead
      const hasGroupFiles = session.groups.some((g) => g.filePaths.length > 0)
      if (!hasGroupFiles && state.openFiles.length > 0) {
        session.groups = [{
          id: 'group-left',
          position: 'left' as EditorGroupPosition,
          filePaths: state.openFiles.map((f) => f.path),
          activeFilePath: state.activeFilePath,
        }]
      }

      const existingIdx = state.sessions.findIndex((s) => s.name === name)
      const newSessions =
        existingIdx >= 0
          ? state.sessions.map((s, i) => (i === existingIdx ? session : s))
          : [...state.sessions, session]

      persistSessions(newSessions)
      return {
        sessions: newSessions,
        activeSessionName: name,
      }
    }),

  loadSession: (name) => {
    const state = get()
    const session = state.sessions.find((s) => s.name === name)
    if (!session) return

    // Restore groups structure
    const restoredGroups: EditorGroup[] = session.groups.map((sg) => ({
      id: sg.id,
      position: sg.position,
      openFiles: [], // Files need to be opened by the consumer via openFileInGroup
      activeFilePath: sg.activeFilePath,
      previewPath: null,
      pinnedTabs: [],
    }))

    set({
      editorGroups: restoredGroups.length > 0 ? restoredGroups : [createDefaultGroup()],
      activeGroupId: restoredGroups[0]?.id ?? 'group-left',
      activeSessionName: name,
    })

    // Note: Actual file content loading must be handled by the consumer
    // since we don't have access to the file system here. The session
    // stores the file paths so consumers can call openFileInGroup() to
    // load each file.
  },

  deleteSession: (name) =>
    set((state) => {
      const newSessions = state.sessions.filter((s) => s.name !== name)
      persistSessions(newSessions)
      return {
        sessions: newSessions,
        activeSessionName:
          state.activeSessionName === name ? null : state.activeSessionName,
      }
    }),

  renameSession: (oldName, newName) =>
    set((state) => {
      if (state.sessions.some((s) => s.name === newName)) return state
      const newSessions = state.sessions.map((s) =>
        s.name === oldName ? { ...s, name: newName, updatedAt: Date.now() } : s
      )
      persistSessions(newSessions)
      return {
        sessions: newSessions,
        activeSessionName:
          state.activeSessionName === oldName ? newName : state.activeSessionName,
      }
    }),

  getSessions: () => {
    return get().sessions
  },

  autoSaveSession: () => {
    const state = get()
    const name = state.activeSessionName ?? '__autosave__'
    state.saveSession(name)
  },
}))

// ─── Tab history helper (pure function) ──────────────────────────────────────

function pushTabHistory(
  history: string[],
  currentIndex: number,
  path: string
): { tabHistory: string[]; tabHistoryIndex: number } {
  // Don't push duplicate of current position
  if (history[currentIndex] === path) {
    return { tabHistory: history, tabHistoryIndex: currentIndex }
  }

  // Truncate forward history when navigating to a new tab
  const truncated = history.slice(0, currentIndex + 1)
  truncated.push(path)

  // Enforce max depth
  if (truncated.length > TAB_HISTORY_MAX_DEPTH) {
    const trimmed = truncated.slice(truncated.length - TAB_HISTORY_MAX_DEPTH)
    return { tabHistory: trimmed, tabHistoryIndex: trimmed.length - 1 }
  }

  return { tabHistory: truncated, tabHistoryIndex: truncated.length - 1 }
}
