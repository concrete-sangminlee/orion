/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { completionSettingsFrom, DEFAULT_COMPLETION_SETTINGS, useCompletionStore } from './completion'

describe('completionSettingsFrom', () => {
  it('defaults to the free local provider', () => {
    expect(completionSettingsFrom(null)).toEqual({ enabled: true, provider: 'ollama', debounceMs: 300 })
    expect(completionSettingsFrom('nonsense')).toEqual(DEFAULT_COMPLETION_SETTINGS)
  })

  it('maps the Settings modal fields', () => {
    expect(completionSettingsFrom({ ghostTextEnabled: false, completionDelay: 800, completionProvider: 'anthropic' })).toEqual({
      enabled: false,
      provider: 'anthropic',
      debounceMs: 800,
    })
  })

  it('never selects a billed provider from an unknown or malformed value', () => {
    expect(completionSettingsFrom({ completionProvider: 'openai' }).provider).toBe('ollama')
    expect(completionSettingsFrom({ completionProvider: true }).provider).toBe('ollama')
    expect(completionSettingsFrom({ completionDelay: 5 }).debounceMs).toBe(300)
  })
})

describe('useCompletionStore', () => {
  beforeEach(() => {
    useCompletionStore.getState().applySettings({ ...DEFAULT_COMPLETION_SETTINGS })
  })

  it('applies settings announced by the Settings modal', () => {
    window.dispatchEvent(
      new CustomEvent('orion:ai-config', { detail: { ghostTextEnabled: false, completionDelay: 1200, completionProvider: 'off' } }),
    )
    expect(useCompletionStore.getState()).toMatchObject({ enabled: false, provider: 'off', debounceMs: 1200 })
  })
})
