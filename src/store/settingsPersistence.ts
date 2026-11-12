/**
 * The user-level settings the Settings modal edits: where each group lives in
 * localStorage, its defaults, and how a change reaches the features that read
 * it. Save, Reset to Defaults and profile switches all go through
 * applyUserSettings, so storage, the open editors and terminals, inline
 * completion and the main process's prompts never disagree.
 */
import { DEFAULT_COMPLETION_SETTINGS, type CompletionProviderSetting } from './completion'
import { assertIpcSuccess } from '@/utils/ipcResult'

export type AutoSaveMode = 'off' | 'afterDelay' | 'onFocusChange' | 'onWindowChange'
export type EditorCursorStyle = 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin'
export type CursorBlinking = 'blink' | 'smooth' | 'expand' | 'solid' | 'phase'
export type WordWrapMode = 'off' | 'on' | 'wordWrapColumn' | 'bounded'
export type LineNumbersMode = 'on' | 'off' | 'relative' | 'interval'
export type MinimapSide = 'right' | 'left'
export type RenderWhitespace = 'none' | 'boundary' | 'selection' | 'trailing' | 'all'

export interface EditorSettings {
  fontSize: number
  fontFamily: string
  lineHeight: number
  fontLigatures: boolean
  letterSpacing: number
  cursorStyle: EditorCursorStyle
  cursorBlinking: CursorBlinking
  renderWhitespace: RenderWhitespace
  wordWrap: boolean // kept for backward compat
  wordWrapMode: WordWrapMode
  wordWrapColumn: number
  insertSpaces: boolean
  minimap: boolean
  minimapSide: MinimapSide
  minimapMaxColumn: number
  autoSave: boolean // kept for backward compat
  autoSaveMode: AutoSaveMode
  autoSaveDelay: number
  tabSize: number
  lineNumbers: boolean // kept for backward compat
  lineNumbersMode: LineNumbersMode
  bracketPairColorization: boolean
  stickyScroll: boolean
  smoothScrolling: boolean
  formatOnSave: boolean
  formatOnPaste: boolean
  trimTrailingWhitespace: boolean
  insertFinalNewline: boolean
  rulers: number[]
}

export interface TerminalSettings {
  defaultShell: string
  fontFamily: string
  fontSize: number
  cursorStyle: 'block' | 'bar' | 'underline'
  scrollback: number
}

/** The AI fields something reads (inline completion, see completionSettingsFrom). */
export interface AiSettings {
  ghostTextEnabled: boolean
  completionProvider: CompletionProviderSetting
  completionDelay: number
}

export interface PromptSettings {
  systemPrompt: string
  userPromptTemplate: string
}

export interface UserSettings {
  editor: EditorSettings
  terminal: TerminalSettings
  ai: AiSettings
  prompts: PromptSettings
}

export type SettingsGroup = keyof UserSettings

export const SETTINGS_STORAGE_KEYS = {
  editor: 'orion-editor-settings',
  terminal: 'orion-terminal-settings',
  ai: 'orion-ai-settings',
  prompts: 'orion-prompts',
} as const satisfies Record<SettingsGroup, string>

/** Events the editor, auto-save, terminals and completion store listen to. */
const CONFIG_EVENTS: Partial<Record<SettingsGroup, string>> = {
  editor: 'orion:editor-config',
  terminal: 'orion:terminal-config',
  ai: 'orion:ai-config',
}

const GROUPS = Object.keys(SETTINGS_STORAGE_KEYS) as SettingsGroup[]

export const DEFAULT_USER_SETTINGS: UserSettings = {
  editor: {
    fontSize: 14, fontFamily: 'Cascadia Code', lineHeight: 1.5, fontLigatures: true,
    letterSpacing: 0, cursorStyle: 'line', cursorBlinking: 'blink',
    renderWhitespace: 'selection',
    wordWrap: false, wordWrapMode: 'off', wordWrapColumn: 80,
    insertSpaces: true,
    minimap: true, minimapSide: 'right', minimapMaxColumn: 120,
    autoSave: true,
    autoSaveMode: 'afterDelay', autoSaveDelay: 1000, tabSize: 2,
    lineNumbers: true, lineNumbersMode: 'on',
    bracketPairColorization: true, stickyScroll: true, smoothScrolling: true,
    formatOnSave: false, formatOnPaste: false,
    trimTrailingWhitespace: true, insertFinalNewline: true,
    rulers: [],
  },
  terminal: {
    defaultShell: 'default', fontFamily: 'Cascadia Code',
    fontSize: 13, cursorStyle: 'block', scrollback: 1000,
  },
  ai: {
    ghostTextEnabled: true,
    completionProvider: DEFAULT_COMPLETION_SETTINGS.provider,
    completionDelay: 300,
  },
  prompts: { systemPrompt: '', userPromptTemplate: '' },
}

/**
 * The defaults overlaid with the fields of `raw` they know, where the type
 * matches. Fields of removed controls and junk from storage or an imported
 * profile are dropped.
 */
function overDefaults<T extends object>(defaults: T, raw: unknown): T {
  const result = { ...defaults }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue
    const fallback = (defaults as Record<string, unknown>)[key]
    if (Array.isArray(fallback) ? Array.isArray(value) : typeof value === typeof fallback) {
      (result as Record<string, unknown>)[key] = value
    }
  }
  return result
}

/** Editor settings saved before the *Mode fields existed kept booleans. */
function migrateEditor(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const parsed: Record<string, unknown> = { ...raw }
  if (parsed.autoSave !== undefined && !parsed.autoSaveMode) parsed.autoSaveMode = parsed.autoSave ? 'afterDelay' : 'off'
  if (parsed.wordWrap !== undefined && !parsed.wordWrapMode) parsed.wordWrapMode = parsed.wordWrap ? 'on' : 'off'
  if (parsed.lineNumbers !== undefined && !parsed.lineNumbersMode) parsed.lineNumbersMode = parsed.lineNumbers ? 'on' : 'off'
  return parsed
}

/** A complete settings group from stored or imported data; defaults fill the gaps. */
export function normalizeSettings<G extends SettingsGroup>(group: G, raw: unknown): UserSettings[G] {
  return overDefaults(DEFAULT_USER_SETTINGS[group], group === 'editor' ? migrateEditor(raw) : raw)
}

/** The effective user settings: what is stored, with defaults for anything missing or unreadable. */
export function readStoredSettings(storage: Storage = localStorage): UserSettings {
  const read = <G extends SettingsGroup>(group: G): UserSettings[G] => {
    try {
      const raw = storage.getItem(SETTINGS_STORAGE_KEYS[group])
      return normalizeSettings(group, raw ? JSON.parse(raw) : null)
    } catch {
      return normalizeSettings(group, null)
    }
  }
  return { editor: read('editor'), terminal: read('terminal'), ai: read('ai'), prompts: read('prompts') }
}

/**
 * Store the given groups and apply them now: the open editors, auto-save,
 * terminals and inline completion get their config event, and the prompts go
 * to the main process, which uses them for every chat request. Rejects when
 * storage or the main process refused.
 */
export async function applyUserSettings(values: Partial<UserSettings>): Promise<void> {
  // The main process goes first: when it refuses, nothing has been stored or
  // applied, so "not applied" (and a profile switch that stays put) is true.
  if (values.prompts) assertIpcSuccess(await window.api.omoSetPrompts(values.prompts), 'Apply prompts')
  for (const group of GROUPS) {
    if (values[group]) localStorage.setItem(SETTINGS_STORAGE_KEYS[group], JSON.stringify(values[group]))
  }
  for (const group of GROUPS) {
    const event = CONFIG_EVENTS[group]
    if (event && values[group]) window.dispatchEvent(new CustomEvent(event, { detail: values[group] }))
  }
}
