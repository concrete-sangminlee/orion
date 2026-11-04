import { create } from 'zustand'
import type { WorkspaceSettings } from '@shared/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  '.next',
  '__pycache__',
  '.DS_Store',
]

const DEFAULT_SEARCH_EXCLUDES = [
  'node_modules',
  '.git',
  'dist',
  '.next',
  '__pycache__',
  'dist-electron',
  '.venv',
]

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
  searchExcludes: DEFAULT_SEARCH_EXCLUDES,
  autoSave: true,
  formatOnSave: false,
  tabSize: 2,
  insertSpaces: true,
  fileAssociations: {},
}

// ---------------------------------------------------------------------------
// Local-storage keys
// ---------------------------------------------------------------------------

const LOCAL_STORAGE_KEY = 'orion-workspace-settings'
const RECENT_WORKSPACES_KEY = 'orion-recent-workspaces'
const WORKSPACE_STATE_KEY = 'orion-workspace-state'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Persisted state for a single workspace (keyed by a deterministic workspace id) */
export interface PersistedWorkspaceState {
  roots: string[]
  activeRoot: string | null
  panelStates: Record<string, PanelState>
  lastOpened: number // timestamp
}

export interface PanelState {
  isVisible: boolean
  size?: number
  position?: string
}

/** Extension recommendation entry stored in .orion/extensions.json */
export interface ExtensionRecommendation {
  id: string
  displayName?: string
  description?: string
}

export interface WorkspaceExtensions {
  recommendations: ExtensionRecommendation[]
  unwantedRecommendations?: string[]
}

/** A recent-workspace entry shown in the welcome screen / file menu */
export interface RecentWorkspace {
  /** Deterministic id (sorted roots joined by `|`) */
  id: string
  roots: string[]
  label: string
  lastOpened: number
}

// ---------------------------------------------------------------------------
// Helpers – user settings (localStorage)
// ---------------------------------------------------------------------------

function loadUserSettings(): Partial<WorkspaceSettings> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function saveUserSettings(settings: WorkspaceSettings) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings))
  } catch {}
}

// ---------------------------------------------------------------------------
// Helpers – recent workspaces (localStorage)
// ---------------------------------------------------------------------------

function loadRecentWorkspaces(): RecentWorkspace[] {
  try {
    const raw = localStorage.getItem(RECENT_WORKSPACES_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function saveRecentWorkspaces(recent: RecentWorkspace[]) {
  try {
    localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(recent))
  } catch {}
}

// ---------------------------------------------------------------------------
// Helpers – per-workspace state persistence (localStorage)
// ---------------------------------------------------------------------------

function workspaceId(roots: string[]): string {
  return [...roots].sort().join('|')
}

function loadAllWorkspaceStates(): Record<string, PersistedWorkspaceState> {
  try {
    const raw = localStorage.getItem(WORKSPACE_STATE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function saveAllWorkspaceStates(states: Record<string, PersistedWorkspaceState>) {
  try {
    localStorage.setItem(WORKSPACE_STATE_KEY, JSON.stringify(states))
  } catch {}
}

function persistWorkspaceState(state: PersistedWorkspaceState) {
  const id = workspaceId(state.roots)
  const all = loadAllWorkspaceStates()
  all[id] = state
  saveAllWorkspaceStates(all)
}

function loadWorkspaceState(roots: string[]): PersistedWorkspaceState | null {
  const id = workspaceId(roots)
  const all = loadAllWorkspaceStates()
  return all[id] ?? null
}

// ---------------------------------------------------------------------------
// Helpers – workspace events
// ---------------------------------------------------------------------------

function dispatchWorkspaceEvent(name: string, detail?: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

// ---------------------------------------------------------------------------
// Helpers – settings merge  (default < user < workspace)
// ---------------------------------------------------------------------------

function mergeSettings(
  workspaceOverrides: Record<string, any>,
  userSettings: Partial<WorkspaceSettings>,
): WorkspaceSettings {
  return {
    ...DEFAULT_WORKSPACE_SETTINGS,
    ...userSettings,
    ...workspaceOverrides,
  }
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface WorkspaceStore {
  // --- Multi-root workspace ---------------------------------------------------
  /** All currently open root folders */
  roots: string[]
  /** The currently focused / active root */
  activeRoot: string | null
  /** Add a root folder to the workspace */
  addRoot: (path: string) => void
  /** Remove a root folder from the workspace */
  removeRoot: (path: string) => void
  /** Set the active (focused) root */
  setActiveRoot: (path: string) => void

  // --- Settings ---------------------------------------------------------------
  settings: WorkspaceSettings
  /** Raw workspace-level overrides (only keys explicitly set in .orion/settings.json) */
  workspaceOverrides: Record<string, any>
  /** Whether current settings were loaded from a workspace .orion/settings.json */
  isWorkspaceLevel: boolean
  setSettings: (settings: WorkspaceSettings) => void
  updateSettings: (patch: Partial<WorkspaceSettings>) => void
  /** Load .orion/settings.json for a given root and merge with defaults + user settings */
  loadWorkspaceSettings: (rootPath: string) => Promise<void>
  /** Persist the full settings object to .orion/settings.json */
  saveWorkspaceSettings: (rootPath: string) => Promise<void>
  /** Merge a single key/value into the workspace .orion/settings.json and persist */
  saveWorkspaceSetting: (rootPath: string, key: string, value: any) => Promise<void>

  // --- Extension recommendations ----------------------------------------------
  /** Recommended extensions for the current workspace */
  recommendedExtensions: WorkspaceExtensions
  /** Load .orion/extensions.json for a given root */
  loadWorkspaceExtensions: (rootPath: string) => Promise<void>
  /** Save extension recommendations to .orion/extensions.json */
  saveWorkspaceExtensions: (rootPath: string, extensions: WorkspaceExtensions) => Promise<void>
  /** Add a single extension recommendation */
  addRecommendedExtension: (rootPath: string, ext: ExtensionRecommendation) => Promise<void>
  /** Remove a single extension recommendation by id */
  removeRecommendedExtension: (rootPath: string, extensionId: string) => Promise<void>

  // --- Panel state per workspace ----------------------------------------------
  panelStates: Record<string, PanelState>
  setPanelState: (panelId: string, state: PanelState) => void

  // --- Recent workspaces ------------------------------------------------------
  recentWorkspaces: RecentWorkspace[]
  /** Open a workspace (replaces all roots, restores persisted state) */
  openWorkspace: (roots: string[]) => void
  /** Clear recent workspaces list */
  clearRecentWorkspaces: () => void
  removeRecentWorkspace: (id: string) => void

  // --- Persistence helpers ----------------------------------------------------
  /** Persist the current workspace state to localStorage */
  persistState: () => void
  /** Restore workspace state for given roots from localStorage */
  restoreState: (roots: string[]) => void
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  // --- Multi-root workspace ---------------------------------------------------
  roots: [],
  activeRoot: null,

  addRoot: (path: string) => {
    const { roots } = get()
    if (roots.includes(path)) return
    const newRoots = [...roots, path]
    const activeRoot = get().activeRoot ?? path
    set({ roots: newRoots, activeRoot })
    get().persistState()
    dispatchWorkspaceEvent('orion:root-added', { path, roots: newRoots })
    dispatchWorkspaceEvent('orion:workspace-changed', { roots: newRoots, activeRoot })
    // Update recent workspaces
    updateRecentWorkspaces(newRoots)
  },

  removeRoot: (path: string) => {
    const { roots, activeRoot } = get()
    const newRoots = roots.filter((r) => r !== path)
    const newActive = activeRoot === path ? (newRoots[0] ?? null) : activeRoot
    set({ roots: newRoots, activeRoot: newActive })
    get().persistState()
    dispatchWorkspaceEvent('orion:root-removed', { path, roots: newRoots })
    dispatchWorkspaceEvent('orion:workspace-changed', { roots: newRoots, activeRoot: newActive })
    updateRecentWorkspaces(newRoots)
  },

  setActiveRoot: (path: string) => {
    const { roots } = get()
    if (!roots.includes(path)) return
    set({ activeRoot: path })
    get().persistState()
    dispatchWorkspaceEvent('orion:workspace-changed', { roots, activeRoot: path })
  },

  // --- Settings ---------------------------------------------------------------
  settings: { ...DEFAULT_WORKSPACE_SETTINGS, ...loadUserSettings() },
  workspaceOverrides: {},
  isWorkspaceLevel: false,

  setSettings: (settings) => set({ settings }),

  updateSettings: (patch) =>
    set((state) => ({
      settings: { ...state.settings, ...patch },
    })),

  loadWorkspaceSettings: async (rootPath: string) => {
    const userSettings = loadUserSettings()
    try {
      const result = await window.api.workspaceReadSettings(rootPath)
      if (result.settings) {
        const merged = mergeSettings(result.settings, userSettings)
        set({ settings: merged, workspaceOverrides: result.settings, isWorkspaceLevel: true })
      } else {
        set({
          settings: mergeSettings({}, userSettings),
          workspaceOverrides: {},
          isWorkspaceLevel: false,
        })
      }
    } catch {
      set({
        settings: mergeSettings({}, userSettings),
        workspaceOverrides: {},
        isWorkspaceLevel: false,
      })
    }
  },

  saveWorkspaceSettings: async (rootPath: string) => {
    const { settings } = get()
    try {
      await window.api.workspaceWriteSettings(rootPath, settings)
      set({ isWorkspaceLevel: true })
    } catch (err) {
      console.error('Failed to save workspace settings:', err)
    }
    // Also persist to localStorage as user-level fallback
    saveUserSettings(settings)
  },

  saveWorkspaceSetting: async (rootPath: string, key: string, value: any) => {
    const { workspaceOverrides, settings } = get()
    const newOverrides = { ...workspaceOverrides, [key]: value }
    const newSettings = { ...settings, [key]: value } as WorkspaceSettings
    try {
      await window.api.workspaceWriteSettings(rootPath, newOverrides)
      set({ settings: newSettings, workspaceOverrides: newOverrides, isWorkspaceLevel: true })
    } catch (err) {
      console.error('Failed to save workspace setting:', err)
    }
  },

  // --- Extension recommendations ----------------------------------------------
  recommendedExtensions: { recommendations: [] },

  loadWorkspaceExtensions: async (rootPath: string) => {
    try {
      // Recommendations are persisted under `__extensions` in .orion/settings.json
      // (see saveWorkspaceExtensions). Reading `result.extensions` never matched.
      const result = await window.api.workspaceReadSettings(rootPath)
      const extensions = result.settings?.__extensions
      if (extensions && Array.isArray(extensions.recommendations)) {
        set({ recommendedExtensions: extensions as WorkspaceExtensions })
      } else {
        set({ recommendedExtensions: { recommendations: [] } })
      }
    } catch {
      set({ recommendedExtensions: { recommendations: [] } })
    }
  },

  saveWorkspaceExtensions: async (rootPath: string, extensions: WorkspaceExtensions) => {
    try {
      await window.api.workspaceWriteSettings(rootPath, {
        ...get().workspaceOverrides,
        __extensions: extensions,
      })
      set({ recommendedExtensions: extensions })
    } catch (err) {
      console.error('Failed to save workspace extensions:', err)
    }
  },

  addRecommendedExtension: async (rootPath: string, ext: ExtensionRecommendation) => {
    const { recommendedExtensions } = get()
    if (recommendedExtensions.recommendations.some((r) => r.id === ext.id)) return
    const updated: WorkspaceExtensions = {
      ...recommendedExtensions,
      recommendations: [...recommendedExtensions.recommendations, ext],
    }
    await get().saveWorkspaceExtensions(rootPath, updated)
  },

  removeRecommendedExtension: async (rootPath: string, extensionId: string) => {
    const { recommendedExtensions } = get()
    const updated: WorkspaceExtensions = {
      ...recommendedExtensions,
      recommendations: recommendedExtensions.recommendations.filter((r) => r.id !== extensionId),
    }
    await get().saveWorkspaceExtensions(rootPath, updated)
  },

  // --- Panel state per workspace ----------------------------------------------
  panelStates: {},

  setPanelState: (panelId: string, state: PanelState) => {
    set((prev) => ({
      panelStates: { ...prev.panelStates, [panelId]: state },
    }))
    get().persistState()
  },

  // --- Recent workspaces ------------------------------------------------------
  recentWorkspaces: loadRecentWorkspaces(),

  openWorkspace: (roots: string[]) => {
    if (roots.length === 0) return
    const persisted = loadWorkspaceState(roots)
    const activeRoot = persisted?.activeRoot ?? roots[0]
    const panelStates = persisted?.panelStates ?? {}

    set({ roots, activeRoot, panelStates })
    get().persistState()
    updateRecentWorkspaces(roots)

    dispatchWorkspaceEvent('orion:workspace-changed', { roots, activeRoot })

    // Automatically load settings from the first root
    get().loadWorkspaceSettings(roots[0])
  },

  clearRecentWorkspaces: () => {
    set({ recentWorkspaces: [] })
    saveRecentWorkspaces([])
  },

  removeRecentWorkspace: (id: string) => {
    const updated = get().recentWorkspaces.filter((r) => r.id !== id)
    set({ recentWorkspaces: updated })
    saveRecentWorkspaces(updated)
  },

  // --- Persistence helpers ----------------------------------------------------
  persistState: () => {
    const { roots, activeRoot, panelStates } = get()
    if (roots.length === 0) return
    const state: PersistedWorkspaceState = {
      roots,
      activeRoot,
      panelStates,
      lastOpened: Date.now(),
    }
    persistWorkspaceState(state)
  },

  restoreState: (roots: string[]) => {
    const persisted = loadWorkspaceState(roots)
    if (!persisted) return
    set({
      roots: persisted.roots,
      activeRoot: persisted.activeRoot,
      panelStates: persisted.panelStates,
    })
    dispatchWorkspaceEvent('orion:workspace-changed', {
      roots: persisted.roots,
      activeRoot: persisted.activeRoot,
    })
  },
}))

// ---------------------------------------------------------------------------
// Internal helper – keep the recent-workspaces list up to date
// ---------------------------------------------------------------------------

const MAX_RECENT_WORKSPACES = 10

function updateRecentWorkspaces(roots: string[]) {
  if (roots.length === 0) return
  const id = workspaceId(roots)
  const label = roots.length === 1
    ? roots[0].split(/[\\/]/).pop() ?? roots[0]
    : `${roots.length} folders`
  const entry: RecentWorkspace = { id, roots, label, lastOpened: Date.now() }

  const existing = loadRecentWorkspaces().filter((r) => r.id !== id)
  const updated = [entry, ...existing].slice(0, MAX_RECENT_WORKSPACES)
  saveRecentWorkspaces(updated)
  useWorkspaceStore.setState({ recentWorkspaces: updated })
}
