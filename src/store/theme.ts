import { create } from 'zustand'
import { themes as builtInThemes, getThemeById as getBuiltInThemeById, type Theme } from '@/themes'

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'orion-theme'
const CUSTOM_THEMES_KEY = 'orion-custom-themes'
const COLOR_OVERRIDES_KEY = 'orion-color-overrides'
const AUTO_THEME_KEY = 'orion-auto-theme-config'
const ICON_THEME_KEY = 'orion-icon-theme'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A custom theme is a full Theme plus metadata indicating it is user-created. */
export interface CustomTheme extends Theme {
  isCustom: true
  /** The built-in theme id this was cloned from, if any. */
  clonedFrom?: string
  createdAt: number
}

/** Configuration for auto dark/light switching. */
export interface AutoThemeConfig {
  enabled: boolean
  lightThemeId: string
  darkThemeId: string
}

/** Per-scope color overrides that layer on top of the active theme. */
export interface ColorOverrides {
  /** Workbench color customizations (CSS variable -> value). */
  workbench: Record<string, string>
  /** Token color customizations (Monaco token -> foreground hex). */
  tokenColors: Array<{ scope: string | string[]; settings: { foreground?: string; fontStyle?: string } }>
}

/** Supported icon theme identifiers (placeholder for future expansion). */
export type IconThemeId = 'seti' | 'material' | 'vscode-icons' | 'none'

/** Minimal shape of a VS Code .json theme file we can import. */
interface VSCodeThemeJSON {
  name?: string
  type?: 'dark' | 'light'
  colors?: Record<string, string>
  tokenColors?: Array<{
    scope?: string | string[]
    settings?: { foreground?: string; background?: string; fontStyle?: string }
  }>
}

// ---------------------------------------------------------------------------
// Monaco registration tracking
// ---------------------------------------------------------------------------

/** Track which custom Monaco themes have already been registered. */
const registeredMonacoThemes = new Set<string>()

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/** Apply every CSS variable defined in a theme to the document root. */
function applyThemeToDOM(theme: Theme, overrides?: Record<string, string>) {
  const root = document.documentElement
  for (const [variable, value] of Object.entries(theme.colors)) {
    root.style.setProperty(variable, value)
  }
  // Layer workbench color overrides on top
  if (overrides) {
    for (const [variable, value] of Object.entries(overrides)) {
      root.style.setProperty(variable, value)
    }
  }
  // Toggle a data-attribute so CSS can respond to light/dark
  root.setAttribute('data-theme-type', theme.type)
}

/**
 * Register a custom Monaco theme definition if it has not already been registered.
 * Monaco must be available on the window (via @monaco-editor/react) for this to work;
 * if it isn't yet loaded, the EditorPanel's onMount handler will pick it up.
 */
function registerMonacoThemeIfNeeded(theme: Theme) {
  if (!theme.monacoThemeData) return
  if (registeredMonacoThemes.has(theme.monacoTheme)) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monaco = (window as any).monaco
  if (monaco?.editor?.defineTheme) {
    monaco.editor.defineTheme(theme.monacoTheme, theme.monacoThemeData)
    registeredMonacoThemes.add(theme.monacoTheme)
  }
}

/** Dispatch the theme-changed custom event so Monaco editors react. */
function dispatchThemeChanged(theme: Theme) {
  window.dispatchEvent(
    new CustomEvent('orion:theme-changed', { detail: { monacoTheme: theme.monacoTheme, themeId: theme.id } })
  )
}

// ---------------------------------------------------------------------------
// localStorage persistence helpers
// ---------------------------------------------------------------------------

/** Read the persisted theme id from localStorage (may be null). */
function loadPersistedThemeId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Persist the chosen theme id to localStorage. */
function persistThemeId(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // ignore quota errors
  }
}

/** Load custom themes from localStorage. */
function loadCustomThemes(): CustomTheme[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Persist custom themes to localStorage. */
function persistCustomThemes(customThemes: CustomTheme[]) {
  try {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(customThemes))
  } catch {
    // ignore quota errors
  }
}

/** Load color overrides from localStorage. */
function loadColorOverrides(): ColorOverrides {
  try {
    const raw = localStorage.getItem(COLOR_OVERRIDES_KEY)
    if (!raw) return { workbench: {}, tokenColors: [] }
    return JSON.parse(raw)
  } catch {
    return { workbench: {}, tokenColors: [] }
  }
}

/** Persist color overrides to localStorage. */
function persistColorOverrides(overrides: ColorOverrides) {
  try {
    localStorage.setItem(COLOR_OVERRIDES_KEY, JSON.stringify(overrides))
  } catch {
    // ignore quota errors
  }
}

/** Load auto-theme config from localStorage. */
function loadAutoThemeConfig(): AutoThemeConfig {
  try {
    const raw = localStorage.getItem(AUTO_THEME_KEY)
    if (!raw) return { enabled: false, lightThemeId: 'github-light', darkThemeId: 'orion-dark' }
    return JSON.parse(raw)
  } catch {
    return { enabled: false, lightThemeId: 'github-light', darkThemeId: 'orion-dark' }
  }
}

/** Persist auto-theme config to localStorage. */
function persistAutoThemeConfig(config: AutoThemeConfig) {
  try {
    localStorage.setItem(AUTO_THEME_KEY, JSON.stringify(config))
  } catch {
    // ignore quota errors
  }
}

/** Load icon theme from localStorage. */
function loadIconTheme(): IconThemeId {
  try {
    return (localStorage.getItem(ICON_THEME_KEY) as IconThemeId) || 'seti'
  } catch {
    return 'seti'
  }
}

/** Persist icon theme to localStorage. */
function persistIconTheme(id: IconThemeId) {
  try {
    localStorage.setItem(ICON_THEME_KEY, id)
  } catch {
    // ignore quota errors
  }
}

// ---------------------------------------------------------------------------
// Unified theme lookup (built-in + custom)
// ---------------------------------------------------------------------------

function getAllThemes(customThemes: CustomTheme[]): Theme[] {
  return [...builtInThemes, ...customThemes]
}

function findThemeById(id: string, customThemes: CustomTheme[]): Theme {
  const all = getAllThemes(customThemes)
  return all.find((t) => t.id === id) || builtInThemes[0]
}

// ---------------------------------------------------------------------------
// VS Code theme import helpers
// ---------------------------------------------------------------------------

/** Map VS Code workbench color keys to our CSS variables where possible. */
const vscodeColorMapping: Record<string, string> = {
  'editor.background': '--bg-primary',
  'sideBar.background': '--bg-secondary',
  'activityBar.background': '--bg-tertiary',
  'editor.foreground': '--text-primary',
  'sideBar.foreground': '--text-secondary',
  'editorLineNumber.foreground': '--text-muted',
  'focusBorder': '--border-focus',
  'panel.border': '--border',
  'sideBarSectionHeader.border': '--border-bright',
  'list.hoverBackground': '--bg-hover',
  'list.activeSelectionBackground': '--bg-active',
  'editorWidget.background': '--bg-elevated',
  'scrollbarSlider.background': '--scrollbar-thumb',
  'scrollbarSlider.activeBackground': '--scrollbar-track',
  'button.background': '--accent',
  'textLink.foreground': '--accent-blue',
  'terminal.ansiGreen': '--accent-green',
  'terminal.ansiRed': '--accent-red',
  'terminal.ansiYellow': '--accent-yellow',
  'terminal.ansiBlue': '--accent-blue',
  'terminal.ansiMagenta': '--accent-purple',
  'terminal.ansiCyan': '--accent-cyan',
  'editorError.foreground': '--accent-red',
  'editorWarning.foreground': '--accent-orange',
}

/**
 * Convert a VS Code theme JSON into our Theme format.
 * Missing colors are filled from a base dark/light theme.
 */
function convertVSCodeTheme(json: VSCodeThemeJSON, id: string): CustomTheme {
  const isDark = json.type !== 'light'
  const baseFallback = isDark ? getBuiltInThemeById('orion-dark') : getBuiltInThemeById('github-light')

  // Build CSS variable colors from VS Code color mappings
  const colors: Record<string, string> = { ...baseFallback.colors }
  if (json.colors) {
    for (const [vscKey, cssVar] of Object.entries(vscodeColorMapping)) {
      if (json.colors[vscKey]) {
        colors[cssVar] = json.colors[vscKey]
      }
    }
  }

  // Build Monaco theme data from token colors
  const monacoBase = isDark ? 'vs-dark' : 'vs'
  const bg = json.colors?.['editor.background'] || baseFallback.colors['--bg-primary']
  const fg = json.colors?.['editor.foreground'] || baseFallback.colors['--text-primary']

  const rules: Array<{ token: string; foreground?: string; fontStyle?: string }> = [
    { token: '', foreground: fg.replace('#', '') },
  ]

  if (json.tokenColors) {
    for (const tc of json.tokenColors) {
      if (!tc.scope || !tc.settings) continue
      const scopes = Array.isArray(tc.scope) ? tc.scope : [tc.scope]
      for (const scope of scopes) {
        rules.push({
          token: scope,
          foreground: tc.settings.foreground?.replace('#', ''),
          fontStyle: tc.settings.fontStyle,
        })
      }
    }
  }

  const editorColors: Record<string, string> = { 'editor.background': bg, 'editor.foreground': fg }
  if (json.colors) {
    for (const key of Object.keys(json.colors)) {
      if (key.startsWith('editor')) {
        editorColors[key] = json.colors[key]
      }
    }
  }

  // Extract preview colors
  const previewColors = [
    colors['--bg-primary'],
    colors['--text-primary'],
    colors['--accent-blue'] || colors['--accent'],
    colors['--accent-green'],
    colors['--accent-red'],
    colors['--accent-purple'],
  ]

  return {
    id,
    name: json.name || id,
    type: isDark ? 'dark' : 'light',
    author: 'Imported',
    tags: ['imported', isDark ? 'dark' : 'light'],
    previewColors,
    monacoTheme: `custom-${id}`,
    monacoThemeData: {
      base: monacoBase as 'vs' | 'vs-dark',
      inherit: true,
      rules,
      colors: editorColors,
    },
    colors,
    isCustom: true,
    createdAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface ThemeStore {
  // ---- Core state ----
  /** All available themes (built-in + custom). */
  themes: Theme[]
  /** Custom themes created or imported by the user. */
  customThemes: CustomTheme[]
  /** Id of the currently active theme. */
  activeThemeId: string
  /** Id of the theme currently being previewed (hovered), or null. */
  previewThemeId: string | null

  // ---- Auto dark/light ----
  autoThemeConfig: AutoThemeConfig
  /** Cleanup function for the media query listener. */
  _autoThemeCleanup: (() => void) | null

  // ---- Color overrides ----
  colorOverrides: ColorOverrides

  // ---- Icon theme ----
  iconTheme: IconThemeId

  // ---- Core actions ----
  /** Set and apply a theme by id. */
  setTheme: (id: string) => void
  /** Preview a theme temporarily (on hover). Pass null to cancel. */
  previewTheme: (id: string | null) => void
  /** Convenience getter for the full Theme object. */
  activeTheme: () => Theme

  // ---- Custom theme CRUD ----
  /** Create a new custom theme by cloning an existing theme. */
  createCustomTheme: (baseThemeId: string, name: string, colorEdits?: Record<string, string>) => CustomTheme
  /** Update colors on a custom theme. */
  updateCustomTheme: (themeId: string, updates: Partial<Pick<Theme, 'name' | 'colors' | 'monacoThemeData'>>) => void
  /** Delete a custom theme by id. Reverts to default if it was active. */
  deleteCustomTheme: (themeId: string) => void

  // ---- Import / Export ----
  /** Import a VS Code .json theme. Returns the created CustomTheme. */
  importVSCodeTheme: (jsonString: string) => CustomTheme
  /** Export a theme as a JSON string. */
  exportTheme: (themeId: string) => string
  /** Copy a theme's JSON to the clipboard. Returns true on success. */
  shareThemeToClipboard: (themeId: string) => Promise<boolean>

  // ---- Auto dark/light ----
  /** Enable or disable auto dark/light switching. */
  setAutoThemeEnabled: (enabled: boolean) => void
  /** Configure which themes to use for light/dark OS preference. */
  setAutoThemePair: (lightThemeId: string, darkThemeId: string) => void

  // ---- Color overrides ----
  /** Set a workbench color override (CSS variable). */
  setWorkbenchColorOverride: (variable: string, value: string) => void
  /** Remove a workbench color override. */
  removeWorkbenchColorOverride: (variable: string) => void
  /** Set token color customizations. */
  setTokenColorOverrides: (tokenColors: ColorOverrides['tokenColors']) => void
  /** Clear all color overrides. */
  clearAllColorOverrides: () => void

  // ---- Icon theme ----
  /** Set the active icon theme. */
  setIconTheme: (id: IconThemeId) => void
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

const initialCustomThemes = loadCustomThemes()
const initialAutoConfig = loadAutoThemeConfig()
const initialColorOverrides = loadColorOverrides()
const initialIconTheme = loadIconTheme()

/** Determine the initial theme: persisted choice or default. */
const initialId = loadPersistedThemeId() || 'orion-dark'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useThemeStore = create<ThemeStore>((set, get) => ({
  themes: getAllThemes(initialCustomThemes),
  customThemes: initialCustomThemes,
  activeThemeId: initialId,
  previewThemeId: null,
  autoThemeConfig: initialAutoConfig,
  _autoThemeCleanup: null,
  colorOverrides: initialColorOverrides,
  iconTheme: initialIconTheme,

  // ---------- Core actions ----------

  setTheme: (id: string) => {
    const state = get()
    const theme = findThemeById(id, state.customThemes)
    applyThemeToDOM(theme, state.colorOverrides.workbench)
    persistThemeId(theme.id)
    registerMonacoThemeIfNeeded(theme)
    dispatchThemeChanged(theme)
    set({ activeThemeId: theme.id, previewThemeId: null })
  },

  previewTheme: (id: string | null) => {
    const state = get()
    if (id === null) {
      // Revert to active theme
      const active = findThemeById(state.activeThemeId, state.customThemes)
      applyThemeToDOM(active, state.colorOverrides.workbench)
      registerMonacoThemeIfNeeded(active)
      dispatchThemeChanged(active)
      set({ previewThemeId: null })
      return
    }

    const theme = findThemeById(id, state.customThemes)
    applyThemeToDOM(theme)
    registerMonacoThemeIfNeeded(theme)
    dispatchThemeChanged(theme)
    set({ previewThemeId: id })
  },

  activeTheme: () => {
    const state = get()
    return findThemeById(state.activeThemeId, state.customThemes)
  },

  // ---------- Custom theme CRUD ----------

  createCustomTheme: (baseThemeId: string, name: string, colorEdits?: Record<string, string>) => {
    const state = get()
    const base = findThemeById(baseThemeId, state.customThemes)
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const newTheme: CustomTheme = {
      ...base,
      id,
      name,
      monacoTheme: id,
      monacoThemeData: base.monacoThemeData ? { ...base.monacoThemeData } : undefined,
      colors: { ...base.colors, ...colorEdits },
      tags: [...base.tags.filter((t) => t !== 'default'), 'custom'],
      author: 'Custom',
      isCustom: true,
      clonedFrom: baseThemeId,
      createdAt: Date.now(),
      previewColors: base.previewColors.slice(),
    }

    // Update preview colors if colors were edited
    if (colorEdits) {
      const c = newTheme.colors
      newTheme.previewColors = [
        c['--bg-primary'],
        c['--text-primary'],
        c['--accent-blue'] || c['--accent'],
        c['--accent-green'],
        c['--accent-red'],
        c['--accent-purple'],
      ]
    }

    const updatedCustom = [...state.customThemes, newTheme]
    persistCustomThemes(updatedCustom)
    set({ customThemes: updatedCustom, themes: getAllThemes(updatedCustom) })
    return newTheme
  },

  updateCustomTheme: (themeId: string, updates: Partial<Pick<Theme, 'name' | 'colors' | 'monacoThemeData'>>) => {
    const state = get()
    const idx = state.customThemes.findIndex((t) => t.id === themeId)
    if (idx === -1) return

    const updated = [...state.customThemes]
    updated[idx] = { ...updated[idx], ...updates }

    // Recalculate preview colors if colors changed
    if (updates.colors) {
      const c = updated[idx].colors
      updated[idx].previewColors = [
        c['--bg-primary'],
        c['--text-primary'],
        c['--accent-blue'] || c['--accent'],
        c['--accent-green'],
        c['--accent-red'],
        c['--accent-purple'],
      ]
    }

    persistCustomThemes(updated)
    set({ customThemes: updated, themes: getAllThemes(updated) })

    // Re-apply if this is the active theme
    if (state.activeThemeId === themeId) {
      const theme = updated[idx]
      applyThemeToDOM(theme, state.colorOverrides.workbench)
      registerMonacoThemeIfNeeded(theme)
      dispatchThemeChanged(theme)
    }
  },

  deleteCustomTheme: (themeId: string) => {
    const state = get()
    const updated = state.customThemes.filter((t) => t.id !== themeId)
    persistCustomThemes(updated)

    const patch: Partial<ThemeStore> = { customThemes: updated, themes: getAllThemes(updated) }

    // If the deleted theme was active, revert to default
    if (state.activeThemeId === themeId) {
      const fallback = builtInThemes[0]
      applyThemeToDOM(fallback, state.colorOverrides.workbench)
      persistThemeId(fallback.id)
      registerMonacoThemeIfNeeded(fallback)
      dispatchThemeChanged(fallback)
      patch.activeThemeId = fallback.id
      patch.previewThemeId = null
    }

    set(patch as ThemeStore)
  },

  // ---------- Import / Export ----------

  importVSCodeTheme: (jsonString: string) => {
    const state = get()
    let parsed: VSCodeThemeJSON
    try {
      parsed = JSON.parse(jsonString)
    } catch {
      throw new Error('Invalid JSON: could not parse the theme file.')
    }

    const id = `imported-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const customTheme = convertVSCodeTheme(parsed, id)

    const updatedCustom = [...state.customThemes, customTheme]
    persistCustomThemes(updatedCustom)
    set({ customThemes: updatedCustom, themes: getAllThemes(updatedCustom) })
    return customTheme
  },

  exportTheme: (themeId: string) => {
    const state = get()
    const theme = findThemeById(themeId, state.customThemes)

    // Export in a format that can be re-imported or shared
    const exportData = {
      name: theme.name,
      type: theme.type,
      author: theme.author,
      colors: theme.colors,
      monacoTheme: theme.monacoTheme,
      monacoThemeData: theme.monacoThemeData,
      previewColors: theme.previewColors,
      tags: theme.tags,
    }

    return JSON.stringify(exportData, null, 2)
  },

  shareThemeToClipboard: async (themeId: string) => {
    const state = get()
    const json = state.exportTheme(themeId)
    try {
      await navigator.clipboard.writeText(json)
      return true
    } catch {
      return false
    }
  },

  // ---------- Auto dark/light ----------

  setAutoThemeEnabled: (enabled: boolean) => {
    const state = get()
    const config = { ...state.autoThemeConfig, enabled }
    persistAutoThemeConfig(config)

    // Tear down existing listener
    if (state._autoThemeCleanup) {
      state._autoThemeCleanup()
    }

    if (enabled) {
      const mql = window.matchMedia('(prefers-color-scheme: dark)')

      const applyOSPreference = (isDark: boolean) => {
        const currentConfig = get().autoThemeConfig
        const targetId = isDark ? currentConfig.darkThemeId : currentConfig.lightThemeId
        get().setTheme(targetId)
      }

      const handler = (e: MediaQueryListEvent) => applyOSPreference(e.matches)
      mql.addEventListener('change', handler)

      const cleanup = () => mql.removeEventListener('change', handler)

      // Apply immediately based on current OS preference
      applyOSPreference(mql.matches)

      set({ autoThemeConfig: config, _autoThemeCleanup: cleanup })
    } else {
      set({ autoThemeConfig: config, _autoThemeCleanup: null })
    }
  },

  setAutoThemePair: (lightThemeId: string, darkThemeId: string) => {
    const state = get()
    const config = { ...state.autoThemeConfig, lightThemeId, darkThemeId }
    persistAutoThemeConfig(config)
    set({ autoThemeConfig: config })

    // Re-apply if auto is enabled
    if (config.enabled) {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      get().setTheme(isDark ? darkThemeId : lightThemeId)
    }
  },

  // ---------- Color overrides ----------

  setWorkbenchColorOverride: (variable: string, value: string) => {
    const state = get()
    const overrides = {
      ...state.colorOverrides,
      workbench: { ...state.colorOverrides.workbench, [variable]: value },
    }
    persistColorOverrides(overrides)
    set({ colorOverrides: overrides })

    // Re-apply current theme with updated overrides
    const theme = findThemeById(state.previewThemeId || state.activeThemeId, state.customThemes)
    applyThemeToDOM(theme, overrides.workbench)
  },

  removeWorkbenchColorOverride: (variable: string) => {
    const state = get()
    const workbench = { ...state.colorOverrides.workbench }
    delete workbench[variable]
    const overrides = { ...state.colorOverrides, workbench }
    persistColorOverrides(overrides)
    set({ colorOverrides: overrides })

    // Re-apply to remove the override from DOM
    const theme = findThemeById(state.previewThemeId || state.activeThemeId, state.customThemes)
    applyThemeToDOM(theme, overrides.workbench)
  },

  setTokenColorOverrides: (tokenColors: ColorOverrides['tokenColors']) => {
    const state = get()
    const overrides = { ...state.colorOverrides, tokenColors }
    persistColorOverrides(overrides)
    set({ colorOverrides: overrides })

    // Notify Monaco editors so they can apply token customizations
    window.dispatchEvent(new CustomEvent('orion:token-colors-changed', { detail: { tokenColors } }))
  },

  clearAllColorOverrides: () => {
    const overrides: ColorOverrides = { workbench: {}, tokenColors: [] }
    persistColorOverrides(overrides)
    set({ colorOverrides: overrides })

    // Re-apply active theme without overrides
    const state = get()
    const theme = findThemeById(state.activeThemeId, state.customThemes)
    applyThemeToDOM(theme)
    dispatchThemeChanged(theme)
  },

  // ---------- Icon theme ----------

  setIconTheme: (id: IconThemeId) => {
    persistIconTheme(id)
    set({ iconTheme: id })
    document.documentElement.setAttribute('data-icon-theme', id)
    window.dispatchEvent(new CustomEvent('orion:icon-theme-changed', { detail: { iconTheme: id } }))
  },
}))

// ---------------------------------------------------------------------------
// Boot: apply the initial theme as soon as this module is imported.
// ---------------------------------------------------------------------------
;(() => {
  const theme = findThemeById(initialId, initialCustomThemes)
  const overrides = initialColorOverrides.workbench
  applyThemeToDOM(theme, Object.keys(overrides).length > 0 ? overrides : undefined)
  document.documentElement.setAttribute('data-icon-theme', initialIconTheme)

  // If auto-theme was enabled, kick it off
  if (initialAutoConfig.enabled) {
    // Defer to allow the store to be fully initialized
    queueMicrotask(() => {
      useThemeStore.getState().setAutoThemeEnabled(true)
    })
  }
})()
