/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUserSettings, DEFAULT_USER_SETTINGS, readStoredSettings, SETTINGS_STORAGE_KEYS } from './settingsPersistence'

const omoSetPrompts = vi.fn()

beforeEach(() => {
  localStorage.clear()
  omoSetPrompts.mockReset().mockResolvedValue({ success: true })
  ;(window as unknown as { api: unknown }).api = { omoSetPrompts }
})

afterEach(() => vi.restoreAllMocks())

describe('readStoredSettings', () => {
  it('fills missing groups and fields with the defaults', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEYS.editor, JSON.stringify({ fontSize: 18 }))
    const settings = readStoredSettings()
    expect(settings.editor).toEqual({ ...DEFAULT_USER_SETTINGS.editor, fontSize: 18 })
    expect(settings.terminal).toEqual(DEFAULT_USER_SETTINGS.terminal)
    expect(settings.prompts).toEqual({ systemPrompt: '', userPromptTemplate: '' })
  })

  it('migrates the old boolean editor fields', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEYS.editor, JSON.stringify({ autoSave: false, wordWrap: true, lineNumbers: false }))
    expect(readStoredSettings().editor).toMatchObject({ autoSaveMode: 'off', wordWrapMode: 'on', lineNumbersMode: 'off' })
  })

  it('drops fields of removed controls and values of the wrong type', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEYS.ai, JSON.stringify({ activeProvider: 'custom', temperature: 2, completionDelay: 'fast', ghostTextEnabled: false }))
    localStorage.setItem(SETTINGS_STORAGE_KEYS.terminal, '{not json')
    const settings = readStoredSettings()
    expect(settings.ai).toEqual({ ...DEFAULT_USER_SETTINGS.ai, ghostTextEnabled: false })
    expect(settings.terminal).toEqual(DEFAULT_USER_SETTINGS.terminal)
  })
})

describe('applyUserSettings', () => {
  it('stores each group, announces it and sends the prompts to the main process', async () => {
    const events: Array<[string, unknown]> = []
    for (const name of ['orion:editor-config', 'orion:terminal-config', 'orion:ai-config']) {
      window.addEventListener(name, (e) => events.push([name, (e as CustomEvent).detail]))
    }
    const prompts = { systemPrompt: 'Be terse.', userPromptTemplate: '' }
    await applyUserSettings({ ...DEFAULT_USER_SETTINGS, prompts })

    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEYS.editor)!)).toEqual(DEFAULT_USER_SETTINGS.editor)
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEYS.prompts)!)).toEqual(prompts)
    expect(events).toEqual([
      ['orion:editor-config', DEFAULT_USER_SETTINGS.editor],
      ['orion:terminal-config', DEFAULT_USER_SETTINGS.terminal],
      ['orion:ai-config', DEFAULT_USER_SETTINGS.ai],
    ])
    expect(omoSetPrompts).toHaveBeenCalledWith(prompts)
  })

  it('rejects when storage refuses the write', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    await expect(applyUserSettings({ editor: DEFAULT_USER_SETTINGS.editor })).rejects.toThrow('QuotaExceededError')
  })

  it('rejects when the main process does not take the prompts, having stored and applied nothing', async () => {
    omoSetPrompts.mockResolvedValue({ success: false, error: 'bridge offline' })
    const editorConfig = vi.fn()
    window.addEventListener('orion:editor-config', editorConfig)

    await expect(applyUserSettings({ ...DEFAULT_USER_SETTINGS, editor: { ...DEFAULT_USER_SETTINGS.editor, fontSize: 20 } }))
      .rejects.toThrow('bridge offline')

    window.removeEventListener('orion:editor-config', editorConfig)
    expect(localStorage.getItem(SETTINGS_STORAGE_KEYS.editor)).toBeNull()
    expect(localStorage.getItem(SETTINGS_STORAGE_KEYS.prompts)).toBeNull()
    expect(editorConfig).not.toHaveBeenCalled()
  })
})
