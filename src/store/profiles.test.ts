/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProfileStore, type Profile } from './profiles'
import { DEFAULT_USER_SETTINGS, SETTINGS_STORAGE_KEYS } from './settingsPersistence'
import { useThemeStore } from './theme'

const omoSetPrompts = vi.fn()

function profile(id: string, settings: Record<string, unknown>): Profile {
  return { id, name: id, icon: '', settings, theme: useThemeStore.getState().activeThemeId, createdAt: '', isDefault: id === 'default' }
}

const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null')

beforeEach(() => {
  localStorage.clear()
  omoSetPrompts.mockReset().mockResolvedValue({ success: true })
  ;(window as unknown as { api: unknown }).api = { omoSetPrompts }
})

describe('switchProfile', () => {
  it("sends the profile's prompts to the main process, which builds every chat request from them", async () => {
    const prompts = { systemPrompt: 'Answer in English.', userPromptTemplate: 'Q: {message}' }
    useProfileStore.setState({ profiles: [profile('work', { [SETTINGS_STORAGE_KEYS.prompts]: prompts })], activeProfileId: '' })

    await useProfileStore.getState().switchProfile('work')

    expect(omoSetPrompts).toHaveBeenCalledWith(prompts)
    expect(useProfileStore.getState().activeProfileId).toBe('work')
  })

  it('restores the defaults when switching to a profile saved before anything was set', async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEYS.editor, JSON.stringify({ ...DEFAULT_USER_SETTINGS.editor, fontSize: 22 }))
    localStorage.setItem(SETTINGS_STORAGE_KEYS.prompts, JSON.stringify({ systemPrompt: 'Pirate voice.', userPromptTemplate: '' }))
    useProfileStore.setState({ profiles: [profile('default', {})], activeProfileId: 'other' })
    const editorConfig = vi.fn()
    window.addEventListener('orion:editor-config', (e) => editorConfig((e as CustomEvent).detail))

    await useProfileStore.getState().switchProfile('default')

    expect(stored(SETTINGS_STORAGE_KEYS.editor)).toEqual(DEFAULT_USER_SETTINGS.editor)
    expect(editorConfig).toHaveBeenCalledWith(DEFAULT_USER_SETTINGS.editor)
    expect(omoSetPrompts).toHaveBeenCalledWith({ systemPrompt: '', userPromptTemplate: '' })
  })

  it('stays on the current profile, settings included, when they could not be applied', async () => {
    omoSetPrompts.mockRejectedValue(new Error('bridge gone'))
    const home = { ...DEFAULT_USER_SETTINGS.editor, fontSize: 13 }
    localStorage.setItem(SETTINGS_STORAGE_KEYS.editor, JSON.stringify(home))
    useProfileStore.setState({
      profiles: [profile('work', { [SETTINGS_STORAGE_KEYS.editor]: { ...DEFAULT_USER_SETTINGS.editor, fontSize: 20 } })],
      activeProfileId: 'home',
    })
    await expect(useProfileStore.getState().switchProfile('work')).rejects.toThrow('bridge gone')
    expect(useProfileStore.getState().activeProfileId).toBe('home')
    // Otherwise "Update" on the still-active profile would save the other one's settings into it.
    expect(stored(SETTINGS_STORAGE_KEYS.editor)).toEqual(home)
  })
})

describe('createProfile', () => {
  it('snapshots the effective settings, defaults included', () => {
    useProfileStore.setState({ profiles: [], activeProfileId: '' })
    const created = useProfileStore.getState().createProfile('Fresh', '')
    expect(created.settings).toEqual({
      [SETTINGS_STORAGE_KEYS.editor]: DEFAULT_USER_SETTINGS.editor,
      [SETTINGS_STORAGE_KEYS.terminal]: DEFAULT_USER_SETTINGS.terminal,
      [SETTINGS_STORAGE_KEYS.prompts]: DEFAULT_USER_SETTINGS.prompts,
    })
  })
})
