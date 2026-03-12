import { create } from 'zustand'
import type { AppSettings, ModelConfig } from '@shared/types'
import { DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY } from '@shared/constants'
import { useWorkspaceStore } from './workspace'

// ---------------------------------------------------------------------------
// 1. Settings Schema
// ---------------------------------------------------------------------------

/** The primitive types a setting value may hold. */
export type SettingValueType = 'string' | 'number' | 'boolean' | 'array' | 'object'

/** Descriptor that fully specifies a single setting entry. */
export interface SettingDescriptor {
  /** Dot-separated key, e.g. "editor.fontSize" */
  key: string
  type: SettingValueType
  default: unknown
  description: string
  /** If set, the value MUST be one of these. */
  enum?: unknown[]
  /** For numbers: inclusive minimum. */
  min?: number
  /** For numbers: inclusive maximum. */
  max?: number
  /** Human-readable category used for grouping in the UI. */
  category: string
}

/**
 * Complete settings schema for Orion IDE.
 * Every setting recognised by the application MUST be declared here.
 */
export const SETTINGS_SCHEMA: SettingDescriptor[] = [
  // -- editor.* ---------------------------------------------------------------
  {
    key: 'editor.fontSize',
    type: 'number',
    default: DEFAULT_FONT_SIZE,
    description: 'Controls the font size in pixels for the editor.',
    min: 8,
    max: 72,
    category: 'editor',
  },
  {
    key: 'editor.fontFamily',
    type: 'string',
    default: DEFAULT_FONT_FAMILY,
    description: 'Controls the font family used in the editor.',
    category: 'editor',
  },
  {
    key: 'editor.tabSize',
    type: 'number',
    default: 2,
    description: 'The number of spaces a tab is equal to.',
    min: 1,
    max: 16,
    category: 'editor',
  },
  {
    key: 'editor.insertSpaces',
    type: 'boolean',
    default: true,
    description: 'Insert spaces when pressing Tab.',
    category: 'editor',
  },
  {
    key: 'editor.wordWrap',
    type: 'string',
    default: 'off',
    description: 'Controls how lines should wrap.',
    enum: ['off', 'on', 'wordWrapColumn', 'bounded'],
    category: 'editor',
  },
  {
    key: 'editor.wordWrapColumn',
    type: 'number',
    default: 80,
    description: 'Column at which the editor will wrap when wordWrap is "wordWrapColumn" or "bounded".',
    min: 1,
    max: 500,
    category: 'editor',
  },
  {
    key: 'editor.lineNumbers',
    type: 'string',
    default: 'on',
    description: 'Controls the display of line numbers.',
    enum: ['on', 'off', 'relative', 'interval'],
    category: 'editor',
  },
  {
    key: 'editor.minimap.enabled',
    type: 'boolean',
    default: true,
    description: 'Controls whether the minimap is shown.',
    category: 'editor',
  },
  {
    key: 'editor.minimap.maxColumn',
    type: 'number',
    default: 120,
    description: 'Limit the width of the minimap to render at most a certain number of columns.',
    min: 1,
    max: 500,
    category: 'editor',
  },
  {
    key: 'editor.cursorStyle',
    type: 'string',
    default: 'line',
    description: 'Controls the cursor style.',
    enum: ['line', 'block', 'underline', 'line-thin', 'block-outline', 'underline-thin'],
    category: 'editor',
  },
  {
    key: 'editor.cursorBlinking',
    type: 'string',
    default: 'blink',
    description: 'Controls the cursor animation style.',
    enum: ['blink', 'smooth', 'phase', 'expand', 'solid'],
    category: 'editor',
  },
  {
    key: 'editor.renderWhitespace',
    type: 'string',
    default: 'selection',
    description: 'Controls how the editor should render whitespace characters.',
    enum: ['none', 'boundary', 'selection', 'trailing', 'all'],
    category: 'editor',
  },
  {
    key: 'editor.bracketPairColorization',
    type: 'boolean',
    default: true,
    description: 'Controls whether bracket pair colorization is enabled.',
    category: 'editor',
  },
  {
    key: 'editor.autoClosingBrackets',
    type: 'string',
    default: 'always',
    description: 'Controls whether the editor should auto close brackets.',
    enum: ['always', 'languageDefined', 'beforeWhitespace', 'never'],
    category: 'editor',
  },
  {
    key: 'editor.formatOnSave',
    type: 'boolean',
    default: false,
    description: 'Format a file on save.',
    category: 'editor',
  },
  {
    key: 'editor.formatOnPaste',
    type: 'boolean',
    default: false,
    description: 'Format pasted content.',
    category: 'editor',
  },
  {
    key: 'editor.autoSave',
    type: 'string',
    default: 'off',
    description: 'Controls auto-save behaviour.',
    enum: ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'],
    category: 'editor',
  },
  {
    key: 'editor.autoSaveDelay',
    type: 'number',
    default: 1000,
    description: 'Controls the delay in ms after which a dirty editor is auto-saved.',
    min: 100,
    max: 60000,
    category: 'editor',
  },
  {
    key: 'editor.scrollBeyondLastLine',
    type: 'boolean',
    default: true,
    description: 'Controls whether the editor scrolls beyond the last line.',
    category: 'editor',
  },
  {
    key: 'editor.smoothScrolling',
    type: 'boolean',
    default: false,
    description: 'Controls whether the editor uses smooth scrolling animations.',
    category: 'editor',
  },
  {
    key: 'editor.linkedEditing',
    type: 'boolean',
    default: false,
    description: 'Controls whether linked editing is enabled (e.g. editing matching HTML tags).',
    category: 'editor',
  },
  {
    key: 'editor.stickyScroll.enabled',
    type: 'boolean',
    default: true,
    description: 'Shows nested current scopes during scrolling at the top of the editor.',
    category: 'editor',
  },
  {
    key: 'editor.guides.indentation',
    type: 'boolean',
    default: true,
    description: 'Controls whether the editor should render indent guides.',
    category: 'editor',
  },
  {
    key: 'editor.guides.bracketPairs',
    type: 'string',
    default: 'active',
    description: 'Controls whether bracket pair guides are enabled.',
    enum: ['true', 'active', 'false'],
    category: 'editor',
  },
  {
    key: 'editor.lineHeight',
    type: 'number',
    default: 0,
    description: 'Controls the line height. Use 0 to automatically compute from font size.',
    min: 0,
    max: 150,
    category: 'editor',
  },
  {
    key: 'editor.eol',
    type: 'string',
    default: 'auto',
    description: 'The default end-of-line character.',
    enum: ['auto', '\\n', '\\r\\n'],
    category: 'editor',
  },

  // -- terminal.* -------------------------------------------------------------
  {
    key: 'terminal.fontSize',
    type: 'number',
    default: 13,
    description: 'Controls the font size of the terminal in pixels.',
    min: 6,
    max: 72,
    category: 'terminal',
  },
  {
    key: 'terminal.fontFamily',
    type: 'string',
    default: 'Cascadia Code, Menlo, monospace',
    description: 'Controls the font family of the terminal.',
    category: 'terminal',
  },
  {
    key: 'terminal.lineHeight',
    type: 'number',
    default: 1.2,
    description: 'Controls the line height of the terminal.',
    min: 0.5,
    max: 3,
    category: 'terminal',
  },
  {
    key: 'terminal.cursorStyle',
    type: 'string',
    default: 'block',
    description: 'Controls the style of the terminal cursor.',
    enum: ['block', 'underline', 'bar'],
    category: 'terminal',
  },
  {
    key: 'terminal.cursorBlinking',
    type: 'boolean',
    default: true,
    description: 'Controls whether the terminal cursor blinks.',
    category: 'terminal',
  },
  {
    key: 'terminal.scrollback',
    type: 'number',
    default: 1000,
    description: 'Controls the maximum number of lines the terminal keeps in its buffer.',
    min: 100,
    max: 100000,
    category: 'terminal',
  },
  {
    key: 'terminal.shell',
    type: 'string',
    default: '',
    description: 'The path of the shell that the terminal uses (empty = system default).',
    category: 'terminal',
  },
  {
    key: 'terminal.shellArgs',
    type: 'array',
    default: [],
    description: 'Arguments to pass to the terminal shell.',
    category: 'terminal',
  },
  {
    key: 'terminal.env',
    type: 'object',
    default: {},
    description: 'Environment variables to set for terminal sessions.',
    category: 'terminal',
  },
  {
    key: 'terminal.copyOnSelection',
    type: 'boolean',
    default: false,
    description: 'Automatically copy selected text in the terminal to the clipboard.',
    category: 'terminal',
  },
  {
    key: 'terminal.theme',
    type: 'string',
    default: 'default',
    description: 'The color theme used for the terminal.',
    enum: ['default', 'solarized-dark', 'solarized-light', 'monokai', 'dracula', 'nord'],
    category: 'terminal',
  },

  // -- ai.* -------------------------------------------------------------------
  {
    key: 'ai.activeModelId',
    type: 'string',
    default: '',
    description: 'The ID of the currently active AI model.',
    category: 'ai',
  },
  {
    key: 'ai.models',
    type: 'array',
    default: [],
    description: 'Configured AI model connections.',
    category: 'ai',
  },
  {
    key: 'ai.agentModelMapping',
    type: 'object',
    default: {},
    description: 'Maps agent roles to specific model IDs.',
    category: 'ai',
  },
  {
    key: 'ai.temperature',
    type: 'number',
    default: 0.7,
    description: 'Default sampling temperature for AI completions.',
    min: 0,
    max: 2,
    category: 'ai',
  },
  {
    key: 'ai.maxTokens',
    type: 'number',
    default: 4096,
    description: 'Default maximum number of tokens for AI responses.',
    min: 64,
    max: 128000,
    category: 'ai',
  },
  {
    key: 'ai.streaming',
    type: 'boolean',
    default: true,
    description: 'Enable streaming responses from the AI model.',
    category: 'ai',
  },
  {
    key: 'ai.codeActions',
    type: 'boolean',
    default: true,
    description: 'Enable AI-powered code actions (quick fixes, refactors).',
    category: 'ai',
  },
  {
    key: 'ai.inlineCompletions',
    type: 'boolean',
    default: true,
    description: 'Enable AI inline / ghost text completions.',
    category: 'ai',
  },
  {
    key: 'ai.inlineCompletionDebounce',
    type: 'number',
    default: 300,
    description: 'Debounce delay in ms before requesting inline completions.',
    min: 50,
    max: 5000,
    category: 'ai',
  },

  // -- theme.* ----------------------------------------------------------------
  {
    key: 'theme.colorTheme',
    type: 'string',
    default: 'dark',
    description: 'Specifies the color theme used in the workbench.',
    enum: ['dark', 'light', 'high-contrast', 'high-contrast-light', 'solarized-dark', 'monokai', 'dracula', 'nord'],
    category: 'theme',
  },
  {
    key: 'theme.iconTheme',
    type: 'string',
    default: 'material-icon-theme',
    description: 'Specifies the file icon theme used in the workbench.',
    enum: ['material-icon-theme', 'seti', 'none'],
    category: 'theme',
  },
  {
    key: 'theme.productIconTheme',
    type: 'string',
    default: 'Default',
    description: 'Specifies the product icon theme used in the workbench.',
    category: 'theme',
  },
  {
    key: 'theme.customCSS',
    type: 'object',
    default: {},
    description: 'Custom CSS token-color overrides applied on top of the active theme.',
    category: 'theme',
  },

  // -- general.* --------------------------------------------------------------
  {
    key: 'general.language',
    type: 'string',
    default: 'en',
    description: 'The display language for the Orion IDE interface.',
    enum: ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es', 'pt-BR', 'ru'],
    category: 'general',
  },
  {
    key: 'general.telemetry',
    type: 'boolean',
    default: false,
    description: 'Enable anonymous usage telemetry.',
    category: 'general',
  },
  {
    key: 'general.confirmOnExit',
    type: 'string',
    default: 'keyboardOnly',
    description: 'Controls whether to confirm before quitting.',
    enum: ['always', 'keyboardOnly', 'never'],
    category: 'general',
  },
  {
    key: 'general.restoreWindows',
    type: 'string',
    default: 'all',
    description: 'Controls how windows are restored after a restart.',
    enum: ['all', 'folders', 'one', 'none'],
    category: 'general',
  },
  {
    key: 'general.titleBarStyle',
    type: 'string',
    default: 'custom',
    description: 'Adjusts the appearance of the window title bar.',
    enum: ['native', 'custom'],
    category: 'general',
  },
  {
    key: 'general.sidebarPosition',
    type: 'string',
    default: 'left',
    description: 'Controls the position of the sidebar.',
    enum: ['left', 'right'],
    category: 'general',
  },
  {
    key: 'general.activityBarVisible',
    type: 'boolean',
    default: true,
    description: 'Controls visibility of the activity bar.',
    category: 'general',
  },
  {
    key: 'general.statusBarVisible',
    type: 'boolean',
    default: true,
    description: 'Controls visibility of the status bar.',
    category: 'general',
  },
  {
    key: 'general.breadcrumbs',
    type: 'boolean',
    default: true,
    description: 'Enable breadcrumb navigation in the editor.',
    category: 'general',
  },
  {
    key: 'general.openFilesInNewTab',
    type: 'boolean',
    default: true,
    description: 'Open files in a new tab instead of reusing an existing one.',
    category: 'general',
  },
  {
    key: 'general.previewMode',
    type: 'boolean',
    default: true,
    description: 'Enable preview (italic tab) mode for single-clicked files.',
    category: 'general',
  },
  {
    key: 'general.autoUpdate',
    type: 'boolean',
    default: true,
    description: 'Automatically download and install updates.',
    category: 'general',
  },

  // -- keybindings.* ----------------------------------------------------------
  {
    key: 'keybindings.preset',
    type: 'string',
    default: 'default',
    description: 'The keybinding preset to use.',
    enum: ['default', 'vim', 'emacs', 'sublime', 'atom', 'jetbrains'],
    category: 'keybindings',
  },
  {
    key: 'keybindings.customBindings',
    type: 'object',
    default: {},
    description: 'Custom keybinding overrides. Maps command IDs to key sequences.',
    category: 'keybindings',
  },
  {
    key: 'keybindings.enableVimMode',
    type: 'boolean',
    default: false,
    description: 'Enable Vim emulation in the editor.',
    category: 'keybindings',
  },
  {
    key: 'keybindings.enableEmacsMode',
    type: 'boolean',
    default: false,
    description: 'Enable Emacs keybinding emulation in the editor.',
    category: 'keybindings',
  },
]

/** Fast lookup: setting key -> descriptor. */
const SCHEMA_MAP = new Map<string, SettingDescriptor>(
  SETTINGS_SCHEMA.map((d) => [d.key, d])
)

/** Return the descriptor for a given key, or undefined if unknown. */
export function getSettingDescriptor(key: string): SettingDescriptor | undefined {
  return SCHEMA_MAP.get(key)
}

/** Build a plain object of all default values keyed by their setting key. */
function buildDefaults(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const d of SETTINGS_SCHEMA) {
    defaults[d.key] = d.default
  }
  return defaults
}

export const SETTING_DEFAULTS: Readonly<Record<string, unknown>> = buildDefaults()

// ---------------------------------------------------------------------------
// 2. Settings Layers
// ---------------------------------------------------------------------------

export type SettingsLayer = 'default' | 'user' | 'workspace' | 'folder'

/** Precedence order from lowest to highest. */
const LAYER_PRECEDENCE: SettingsLayer[] = ['default', 'user', 'workspace', 'folder']

// ---------------------------------------------------------------------------
// 3. Settings Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean
  message?: string
}

/**
 * Validate a value against the schema for the given key.
 * Returns `{ valid: true }` when acceptable, or `{ valid: false, message }`.
 */
export function validateSetting(key: string, value: unknown): ValidationResult {
  const descriptor = SCHEMA_MAP.get(key)
  if (!descriptor) {
    return { valid: false, message: `Unknown setting key: "${key}"` }
  }

  // Type check
  const actualType = Array.isArray(value) ? 'array' : typeof value
  if (actualType !== descriptor.type) {
    return {
      valid: false,
      message: `Expected type "${descriptor.type}" for "${key}", got "${actualType}".`,
    }
  }

  // Enum check
  if (descriptor.enum && !descriptor.enum.includes(value)) {
    return {
      valid: false,
      message: `Value for "${key}" must be one of: ${descriptor.enum.map(String).join(', ')}. Got "${String(value)}".`,
    }
  }

  // Number range checks
  if (descriptor.type === 'number' && typeof value === 'number') {
    if (descriptor.min !== undefined && value < descriptor.min) {
      return {
        valid: false,
        message: `Value for "${key}" must be >= ${descriptor.min}. Got ${value}.`,
      }
    }
    if (descriptor.max !== undefined && value > descriptor.max) {
      return {
        valid: false,
        message: `Value for "${key}" must be <= ${descriptor.max}. Got ${value}.`,
      }
    }
  }

  return { valid: true }
}

// ---------------------------------------------------------------------------
// 4. Settings Events
// ---------------------------------------------------------------------------

export interface SettingChangedDetail {
  key: string
  oldValue: unknown
  newValue: unknown
  layer: SettingsLayer
}

/** Dispatch a custom DOM event whenever a setting is changed. */
function dispatchSettingChanged(detail: SettingChangedDetail): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<SettingChangedDetail>('orion:setting-changed', { detail })
    )
  }
}

// ---------------------------------------------------------------------------
// 5. Settings Migration
// ---------------------------------------------------------------------------

export interface SettingsMigration {
  /** The version this migration upgrades FROM. */
  fromVersion: number
  /** The version this migration upgrades TO. */
  toVersion: number
  /** Transform the raw settings blob and return the upgraded copy. */
  migrate: (settings: Record<string, unknown>) => Record<string, unknown>
}

/** Current settings schema version. Bump this when you add a migration. */
export const SETTINGS_VERSION = 2

/**
 * Registry of migrations, ordered by fromVersion ascending.
 * Each migration is responsible for moving settings from one version to the next.
 */
export const SETTINGS_MIGRATIONS: SettingsMigration[] = [
  {
    fromVersion: 0,
    toVersion: 1,
    migrate(settings) {
      const out = { ...settings }
      // v0 -> v1: the flat "theme" key was renamed to "theme.colorTheme".
      if ('theme' in out && typeof out['theme'] === 'string') {
        out['theme.colorTheme'] = out['theme']
        delete out['theme']
      }
      // v0 -> v1: "fontSize" became "editor.fontSize".
      if ('fontSize' in out) {
        out['editor.fontSize'] = out['fontSize']
        delete out['fontSize']
      }
      // v0 -> v1: "fontFamily" became "editor.fontFamily".
      if ('fontFamily' in out) {
        out['editor.fontFamily'] = out['fontFamily']
        delete out['fontFamily']
      }
      // v0 -> v1: "activeModelId" became "ai.activeModelId".
      if ('activeModelId' in out) {
        out['ai.activeModelId'] = out['activeModelId']
        delete out['activeModelId']
      }
      // v0 -> v1: "models" became "ai.models".
      if ('models' in out) {
        out['ai.models'] = out['models']
        delete out['models']
      }
      // v0 -> v1: "agentModelMapping" became "ai.agentModelMapping".
      if ('agentModelMapping' in out) {
        out['ai.agentModelMapping'] = out['agentModelMapping']
        delete out['agentModelMapping']
      }
      out['__settingsVersion'] = 1
      return out
    },
  },
  {
    fromVersion: 1,
    toVersion: 2,
    migrate(settings) {
      const out = { ...settings }
      // v1 -> v2: renamed "ai.maxTokens" default from 2048 to 4096 — no key rename,
      // but if user had the old default we bump it.
      if (out['ai.maxTokens'] === 2048) {
        out['ai.maxTokens'] = 4096
      }
      out['__settingsVersion'] = 2
      return out
    },
  },
]

/**
 * Apply all applicable migrations to bring a settings blob up to the
 * current `SETTINGS_VERSION`. Returns the migrated copy.
 */
export function migrateSettings(raw: Record<string, unknown>): Record<string, unknown> {
  let current = { ...raw }
  let version = typeof current['__settingsVersion'] === 'number'
    ? (current['__settingsVersion'] as number)
    : 0

  // Sort migrations ascending just in case they were registered out of order.
  const sorted = [...SETTINGS_MIGRATIONS].sort((a, b) => a.fromVersion - b.fromVersion)

  for (const migration of sorted) {
    if (version === migration.fromVersion) {
      current = migration.migrate(current)
      version = migration.toVersion
    }
  }

  current['__settingsVersion'] = SETTINGS_VERSION
  return current
}

// ---------------------------------------------------------------------------
// 6. Settings Search
// ---------------------------------------------------------------------------

export interface SettingSearchResult {
  descriptor: SettingDescriptor
  /** Which part matched: "key" | "description" | "category" */
  matchedOn: ('key' | 'description' | 'category')[]
}

/**
 * Search settings schema by free-text query.
 * Matches against key, description, and category (case-insensitive).
 */
export function searchSettings(query: string): SettingSearchResult[] {
  if (!query.trim()) return SETTINGS_SCHEMA.map((d) => ({
    descriptor: d,
    matchedOn: ['key', 'description', 'category'] as ('key' | 'description' | 'category')[],
  }))

  const lower = query.toLowerCase()
  const results: SettingSearchResult[] = []

  for (const descriptor of SETTINGS_SCHEMA) {
    const matchedOn: ('key' | 'description' | 'category')[] = []
    if (descriptor.key.toLowerCase().includes(lower)) matchedOn.push('key')
    if (descriptor.description.toLowerCase().includes(lower)) matchedOn.push('description')
    if (descriptor.category.toLowerCase().includes(lower)) matchedOn.push('category')
    if (matchedOn.length > 0) {
      results.push({ descriptor, matchedOn })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// 7. Zustand Store (enhanced)
// ---------------------------------------------------------------------------

interface SettingsStore {
  // Legacy AppSettings kept for backward-compatibility with existing consumers.
  settings: AppSettings

  /** Layer data stores — each layer is a sparse key-value map. */
  layers: Record<SettingsLayer, Record<string, unknown>>

  /** Settings schema version stored alongside user data. */
  version: number

  // --- Legacy mutations (preserved API) ------------------------------------
  setSettings: (settings: AppSettings) => void
  addModel: (model: ModelConfig) => void
  removeModel: (modelId: string) => void
  setActiveModel: (modelId: string) => void

  // --- New layered mutations -----------------------------------------------
  /** Set a single setting in a given layer, with validation. Returns true on success. */
  setSetting: (key: string, value: unknown, layer?: SettingsLayer) => boolean
  /** Remove a setting override from a layer (it will fall through to lower layers). */
  removeSetting: (key: string, layer?: SettingsLayer) => void
  /** Bulk-set many settings in one layer. Invalid keys/values are silently skipped. */
  setMany: (entries: Record<string, unknown>, layer?: SettingsLayer) => void
  /** Replace an entire layer's data (useful when loading from disk). */
  loadLayer: (layer: SettingsLayer, data: Record<string, unknown>) => void

  // --- Reset ---------------------------------------------------------------
  /** Reset a single setting to its default (removes overrides in all layers). */
  resetSetting: (key: string) => void
  /** Reset ALL settings to defaults (clears user, workspace, and folder layers). */
  resetAll: () => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  // Legacy shape — kept in sync automatically by the helpers below.
  settings: {
    theme: 'dark',
    fontSize: DEFAULT_FONT_SIZE,
    fontFamily: DEFAULT_FONT_FAMILY,
    models: [],
    activeModelId: '',
    agentModelMapping: {},
  },

  layers: {
    default: { ...SETTING_DEFAULTS },
    user: {},
    workspace: {},
    folder: {},
  },

  version: SETTINGS_VERSION,

  // --- Legacy mutations (backward-compatible) ------------------------------
  setSettings: (settings) => set({ settings }),

  addModel: (model) =>
    set((state) => ({
      settings: { ...state.settings, models: [...state.settings.models, model] },
    })),

  removeModel: (modelId) =>
    set((state) => ({
      settings: {
        ...state.settings,
        models: state.settings.models.filter((m) => m.modelId !== modelId),
      },
    })),

  setActiveModel: (modelId) =>
    set((state) => ({
      settings: { ...state.settings, activeModelId: modelId },
    })),

  // --- Layered mutations ---------------------------------------------------
  setSetting: (key, value, layer: SettingsLayer = 'user') => {
    const validation = validateSetting(key, value)
    if (!validation.valid) {
      console.warn(`[Orion Settings] Invalid value for "${key}": ${validation.message}`)
      return false
    }

    const oldValue = getEffectiveSetting(key)

    set((state) => ({
      layers: {
        ...state.layers,
        [layer]: { ...state.layers[layer], [key]: value },
      },
    }))

    dispatchSettingChanged({ key, oldValue, newValue: value, layer })
    return true
  },

  removeSetting: (key, layer: SettingsLayer = 'user') => {
    const oldValue = getEffectiveSetting(key)

    set((state) => {
      const updated = { ...state.layers[layer] }
      delete updated[key]
      return { layers: { ...state.layers, [layer]: updated } }
    })

    const newValue = getEffectiveSetting(key)
    if (oldValue !== newValue) {
      dispatchSettingChanged({ key, oldValue, newValue, layer })
    }
  },

  setMany: (entries, layer: SettingsLayer = 'user') => {
    const validEntries: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(entries)) {
      const v = validateSetting(key, value)
      if (v.valid) {
        validEntries[key] = value
      } else {
        console.warn(`[Orion Settings] Skipping "${key}": ${v.message}`)
      }
    }

    if (Object.keys(validEntries).length === 0) return

    const oldValues: Record<string, unknown> = {}
    for (const key of Object.keys(validEntries)) {
      oldValues[key] = getEffectiveSetting(key)
    }

    set((state) => ({
      layers: {
        ...state.layers,
        [layer]: { ...state.layers[layer], ...validEntries },
      },
    }))

    for (const [key, newValue] of Object.entries(validEntries)) {
      dispatchSettingChanged({ key, oldValue: oldValues[key], newValue, layer })
    }
  },

  loadLayer: (layer, data) => {
    const migrated = migrateSettings(data)
    // Strip the internal version key before storing.
    const { __settingsVersion: _, ...clean } = migrated
    set((state) => ({
      layers: { ...state.layers, [layer]: { ...state.layers.default, ...clean } },
      version: SETTINGS_VERSION,
    }))
  },

  // --- Reset ---------------------------------------------------------------
  resetSetting: (key) => {
    const oldValue = getEffectiveSetting(key)

    set((state) => {
      const user = { ...state.layers.user }
      const workspace = { ...state.layers.workspace }
      const folder = { ...state.layers.folder }
      delete user[key]
      delete workspace[key]
      delete folder[key]
      return { layers: { ...state.layers, user, workspace, folder } }
    })

    const newValue = getEffectiveSetting(key)
    if (oldValue !== newValue) {
      dispatchSettingChanged({ key, oldValue, newValue, layer: 'default' })
    }
  },

  resetAll: () => {
    set((state) => ({
      layers: { ...state.layers, user: {}, workspace: {}, folder: {} },
    }))
  },
}))

// ---------------------------------------------------------------------------
// getEffectiveSetting — resolves through layers with precedence
// ---------------------------------------------------------------------------

/**
 * Get the effective value for a setting key.
 *
 * Resolution order (highest wins):
 *   Folder → Workspace → User → Default
 *
 * Additionally, workspace-level overrides from `useWorkspaceStore` (loaded from
 * `.orion/settings.json`) are checked at the Workspace layer for backward
 * compatibility with the previous implementation.
 */
export function getEffectiveSetting(key: string): unknown {
  const { layers } = useSettingsStore.getState()

  // Walk from highest precedence to lowest.
  for (let i = LAYER_PRECEDENCE.length - 1; i >= 0; i--) {
    const layer = LAYER_PRECEDENCE[i]

    // For the workspace layer, also consult the legacy workspaceOverrides store.
    if (layer === 'workspace') {
      const { workspaceOverrides } = useWorkspaceStore.getState()
      if (key in workspaceOverrides) {
        return workspaceOverrides[key]
      }
    }

    const layerData = layers[layer]
    if (key in layerData) {
      return layerData[key]
    }
  }

  // Final fallback: check the legacy flat AppSettings object (for keys that
  // pre-date the schema, e.g. "theme", "fontSize").
  const appSettings = useSettingsStore.getState().settings as Record<string, unknown>
  if (key in appSettings) {
    return appSettings[key]
  }

  return undefined
}

/**
 * Convenience: get effective value with a typed fallback.
 */
export function getEffectiveSettingTyped<T>(key: string, fallback: T): T {
  const value = getEffectiveSetting(key)
  return (value as T) ?? fallback
}

/**
 * Return all categories present in the schema.
 */
export function getSettingCategories(): string[] {
  const cats = new Set<string>()
  for (const d of SETTINGS_SCHEMA) {
    cats.add(d.category)
  }
  return [...cats]
}
