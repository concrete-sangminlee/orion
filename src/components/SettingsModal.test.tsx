/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsModal from './SettingsModal'
import { useFileStore } from '@/store/files'
import { DEFAULT_WORKSPACE_SETTINGS, useWorkspaceStore } from '@/store/workspace'
import { DEFAULT_USER_SETTINGS, SETTINGS_STORAGE_KEYS } from '@/store/settingsPersistence'
import { PROJECT_LINKS } from '@/utils/projectLinks'

const api = {
  appGetInfo: vi.fn(),
  omoGetApiKeyStatus: vi.fn(),
  omoSetApiKeys: vi.fn(),
  omoSetPrompts: vi.fn(),
  workspaceReadSettings: vi.fn(),
  workspaceWriteSettings: vi.fn(),
}

const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null')

async function openSettings() {
  await act(async () => {
    render(<SettingsModal open onClose={() => {}} />)
  })
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element)
  })
}

const tab = (name: string) => click(screen.getByRole('button', { name }))

beforeEach(() => {
  localStorage.clear()
  Object.values(api).forEach((fn) => fn.mockReset())
  api.appGetInfo.mockResolvedValue({ version: '9.8.7', electron: '41.0.1', chrome: '', node: '', v8: '', platform: 'linux', arch: 'x64' })
  api.omoGetApiKeyStatus.mockResolvedValue({
    configured: { anthropic: false, openai: false, kimi: false, gemini: false, nvidia: false, custom: false },
    encryptionAvailable: true,
  })
  api.omoSetApiKeys.mockResolvedValue({ success: true })
  api.omoSetPrompts.mockResolvedValue({ success: true })
  api.workspaceReadSettings.mockResolvedValue({ settings: null })
  api.workspaceWriteSettings.mockResolvedValue({ success: true })
  ;(window as unknown as { api: unknown }).api = api
  useFileStore.setState({ rootPath: '/proj' })
  useWorkspaceStore.setState({ settings: { ...DEFAULT_WORKSPACE_SETTINGS }, workspaceOverrides: {}, isWorkspaceLevel: false, loadError: null })
})

afterEach(() => cleanup())

describe('Settings controls', () => {
  it('offers no control that nothing applies', async () => {
    await openSettings()
    const dead: Record<string, string[]> = {
      General: ['Startup Behavior', 'Window Title Format', 'Confirm Before Close', 'Telemetry', 'Insert Spaces', 'Tab Size', 'Format on Save', 'File Associations'],
      'AI / Models': ['API Provider', 'Model', 'Custom Model Name', 'Endpoint URL', 'Temperature', 'Max Tokens', 'Custom Provider'],
      Appearance: ['UI Font Size Scaling', 'Zoom Level'],
      Files: ['Hot Exit', 'Default Encoding', 'Auto Guess Encoding', 'File Exclusion Patterns'],
    }
    for (const [category, labels] of Object.entries(dead)) {
      await tab(category)
      for (const label of labels) expect(screen.queryByText(label), `${category} > ${label}`).toBeNull()
    }
    // The workspace control the explorer does read stays.
    await tab('General')
    expect(screen.getByText('Exclude Patterns')).toBeTruthy()
  })
})

describe('Workspace settings', () => {
  it('cannot be saved over a .orion/settings.json that could not be read', async () => {
    api.workspaceReadSettings.mockResolvedValue({ settings: null, error: 'Unexpected token / in JSON at position 4' })
    await openSettings()
    expect(screen.getByRole('alert').textContent).toContain('Unexpected token / in JSON at position 4')
    expect((screen.getByRole('button', { name: 'Save to .orion/settings.json' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('say why a write failed instead of showing Saved', async () => {
    api.workspaceWriteSettings.mockResolvedValue({ success: false, error: 'EACCES: permission denied' })
    await openSettings()
    await click(screen.getByRole('button', { name: 'Save to .orion/settings.json' }))
    expect(screen.getByText('Not saved: EACCES: permission denied')).toBeTruthy()
    expect(screen.queryByText(/Workspace Settings Saved/)).toBeNull()
  })
})

describe('Profiles', () => {
  it('a switch is not undone by the Save button', async () => {
    const work = { ...DEFAULT_USER_SETTINGS.editor, fontSize: 20 }
    localStorage.setItem('orion-profiles', JSON.stringify([
      { id: 'default', name: 'Default', icon: '', settings: {}, theme: 'github-dark', createdAt: '', isDefault: true },
      { id: 'work', name: 'Work', icon: '', settings: { [SETTINGS_STORAGE_KEYS.editor]: work }, theme: 'github-dark', createdAt: '', isDefault: false },
    ]))
    localStorage.setItem('orion-active-profile', 'default')
    await openSettings()

    await tab('Profiles')
    await click(screen.getByRole('button', { name: 'Switch' }))
    await click(screen.getByRole('button', { name: 'Save' }))

    expect(stored(SETTINGS_STORAGE_KEYS.editor).fontSize).toBe(20)
  })
})

describe('Reset to Defaults', () => {
  it('applies the defaults now, prompts included', async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEYS.editor, JSON.stringify({ ...DEFAULT_USER_SETTINGS.editor, fontSize: 20 }))
    localStorage.setItem(SETTINGS_STORAGE_KEYS.prompts, JSON.stringify({ systemPrompt: 'Pirate voice.', userPromptTemplate: '' }))
    const editorConfig = vi.fn()
    window.addEventListener('orion:editor-config', (e) => editorConfig((e as CustomEvent).detail))
    await openSettings()

    await click(screen.getByRole('button', { name: /Reset to Defaults/ }))
    await click(screen.getByRole('button', { name: 'Confirm' }))

    expect(stored(SETTINGS_STORAGE_KEYS.editor)).toEqual(DEFAULT_USER_SETTINGS.editor)
    expect(editorConfig).toHaveBeenCalledWith(DEFAULT_USER_SETTINGS.editor)
    expect(api.omoSetPrompts).toHaveBeenCalledWith({ systemPrompt: '', userPromptTemplate: '' })
  })
})

describe('API keys', () => {
  it('a rejected key is reported and kept, and the other keys are still saved', async () => {
    api.omoSetApiKeys.mockImplementation(async (patch: Record<string, string>) =>
      Object.values(patch).some((key) => /\s/.test(key))
        ? { success: false, error: 'API key for anthropic contains invalid characters' }
        : { success: true })
    await openSettings()
    await tab('AI / Models')
    const anthropic = screen.getByPlaceholderText('sk-ant-...') as HTMLInputElement
    const gemini = screen.getByPlaceholderText('AIza...') as HTMLInputElement
    fireEvent.change(anthropic, { target: { value: 'sk-ant EXAMPLE' } })
    fireEvent.change(gemini, { target: { value: '​AIza-EXAMPLE ' } })

    await click(screen.getByRole('button', { name: 'Save' }))

    expect(api.omoSetApiKeys).toHaveBeenCalledWith({ gemini: 'AIza-EXAMPLE' })
    expect(screen.getByText('Not saved: API key for anthropic contains invalid characters')).toBeTruthy()
    expect(screen.getByText(/API key not saved for Anthropic \(Claude\)/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Saved/ })).toBeNull()
    expect(anthropic.value).toBe('sk-ant EXAMPLE')
    expect(gemini.value).toBe('')
  })

  it('drops the error of an earlier save once the rejected key is cleared', async () => {
    api.omoSetApiKeys.mockResolvedValue({ success: false, error: 'API key for anthropic contains invalid characters' })
    await openSettings()
    await tab('AI / Models')
    const anthropic = screen.getByPlaceholderText('sk-ant-...') as HTMLInputElement
    fireEvent.change(anthropic, { target: { value: 'sk-ant EXAMPLE' } })
    await click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.queryByText(/^Not saved:/)).toBeTruthy()

    fireEvent.change(anthropic, { target: { value: '' } })
    await click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.queryByText(/^Not saved:/)).toBeNull()
    expect(screen.getByRole('button', { name: /Saved/ })).toBeTruthy()
  })

  it('a Custom Provider key saved by an earlier version can still be removed', async () => {
    api.omoGetApiKeyStatus.mockResolvedValue({
      configured: { anthropic: false, openai: false, kimi: false, gemini: false, nvidia: false, custom: true },
      encryptionAvailable: true,
    })
    await openSettings()
    await tab('AI / Models')

    await click(screen.getByRole('button', { name: 'Remove saved Custom Provider key' }))

    expect(api.omoSetApiKeys).toHaveBeenCalledWith({ custom: null })
  })
})

describe('About', () => {
  it('shows the versions the main process reports', async () => {
    await openSettings()
    await tab('About')
    expect(screen.getByText('Version 9.8.7')).toBeTruthy()
    expect(screen.getByText('41.0.1')).toBeTruthy()
  })
})

describe('About links', () => {
  it("point to this project's repository", async () => {
    await openSettings()
    await tab('About')
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href')
    expect(href('Documentation')).toBe(PROJECT_LINKS.readme)
    expect(href('Report Issue')).toBe(PROJECT_LINKS.issues)
    expect(href('Release Notes')).toBe(PROJECT_LINKS.releases)
    expect(href('License')).toBe(PROJECT_LINKS.license)
  })
})
