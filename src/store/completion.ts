import { create } from 'zustand'
import type { InlineCompletionProvider } from '@shared/ipc-contract'

/** 'off' disables inline completion; otherwise where suggestions come from. */
export type CompletionProviderSetting = 'off' | InlineCompletionProvider

export interface CompletionSettings {
  enabled: boolean
  provider: CompletionProviderSetting
  debounceMs: number
}

/**
 * Defaults: on, served by a local Ollama model (free). The cloud provider is
 * only used when the user selects it in Settings, since every typing pause
 * would be a billed request.
 */
export const DEFAULT_COMPLETION_SETTINGS: CompletionSettings = { enabled: true, provider: 'ollama', debounceMs: 300 }

const AI_SETTINGS_STORAGE_KEY = 'orion-ai-settings'

/** Map the AI section of the Settings modal onto completion settings. */
export function completionSettingsFrom(raw: unknown): CompletionSettings {
  const settings = { ...DEFAULT_COMPLETION_SETTINGS }
  if (!raw || typeof raw !== 'object') return settings
  const { ghostTextEnabled, completionDelay, completionProvider } = raw as Record<string, unknown>
  if (typeof ghostTextEnabled === 'boolean') settings.enabled = ghostTextEnabled
  if (typeof completionDelay === 'number' && completionDelay >= 50 && completionDelay <= 3000) settings.debounceMs = completionDelay
  if (completionProvider === 'off' || completionProvider === 'ollama' || completionProvider === 'anthropic') settings.provider = completionProvider
  return settings
}

function storedSettings(): CompletionSettings {
  try {
    const stored = localStorage.getItem(AI_SETTINGS_STORAGE_KEY)
    return completionSettingsFrom(stored ? JSON.parse(stored) : null)
  } catch {
    return { ...DEFAULT_COMPLETION_SETTINGS }
  }
}

interface CompletionStore extends CompletionSettings {
  ghostText: string | null
  triggerLine: number | null
  triggerColumn: number | null
  isLoading: boolean
  setEnabled: (enabled: boolean) => void
  applySettings: (settings: CompletionSettings) => void
  setGhostText: (text: string | null, line?: number, column?: number) => void
  setLoading: (loading: boolean) => void
  clear: () => void
}

export const useCompletionStore = create<CompletionStore>((set) => ({
  ...storedSettings(),
  ghostText: null,
  triggerLine: null,
  triggerColumn: null,
  isLoading: false,
  setEnabled: (enabled) => set({ enabled }),
  applySettings: (settings) => set({ ...settings }),
  setGhostText: (text, line, column) => set({
    ghostText: text,
    triggerLine: line ?? null,
    triggerColumn: column ?? null,
    isLoading: false,
  }),
  setLoading: (isLoading) => set({ isLoading }),
  clear: () => set({ ghostText: null, triggerLine: null, triggerColumn: null, isLoading: false }),
}))

// The Settings modal announces saved AI settings with this event. Nothing
// listened before, so the "Ghost Text Completions" toggle and delay were saved
// but never applied.
if (typeof window !== 'undefined') {
  window.addEventListener('orion:ai-config', (event) => {
    useCompletionStore.getState().applySettings(completionSettingsFrom((event as CustomEvent).detail))
  })
}
