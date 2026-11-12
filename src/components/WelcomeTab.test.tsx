/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WelcomeTab from './WelcomeTab'
import { useRecentFilesStore } from '@/store/recentFiles'
import { useCompletionStore } from '@/store/completion'
import { useThemeStore } from '@/store/theme'
import { useEditorStore } from '@/store/editor'
import { PROJECT_LINKS } from '@/utils/projectLinks'

const props = {
  onOpenFolder: vi.fn(),
  onOpenPalette: vi.fn(),
  onOpenTerminal: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenChat: vi.fn(),
}

const api = {
  openFileDialog: vi.fn(),
  readFile: vi.fn(),
  shellOpenExternal: vi.fn(),
}

function renderWelcome() {
  return render(<WelcomeTab {...props} />)
}

function expandQuickSettings() {
  if (!screen.queryByText('Color Theme')) fireEvent.click(screen.getByText('Quick Settings'))
}

describe('WelcomeTab', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.values(props).forEach((fn) => fn.mockReset())
    api.openFileDialog.mockReset().mockResolvedValue(['/w/picked.ts'])
    api.readFile.mockReset().mockResolvedValue({ content: 'x', language: 'typescript' })
    api.shellOpenExternal.mockReset().mockResolvedValue(undefined)
    ;(window as unknown as { api: unknown }).api = api
    useRecentFilesStore.setState({ recentFiles: [] })
    useEditorStore.setState({ openFiles: [], activeFilePath: null })
  })
  afterEach(() => cleanup())

  it('offers only start actions that work, and Open File opens the file picker', async () => {
    renderWelcome()
    expect(screen.queryByText('Connect to Remote...')).toBeNull()
    expect(screen.queryByText('Clone Git Repository...')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByText('Open File...'))
    })
    expect(api.openFileDialog).toHaveBeenCalledTimes(1)
    expect(props.onOpenFolder).not.toHaveBeenCalled()
    expect(api.readFile).toHaveBeenCalledWith('/w/picked.ts')
  })

  it('lists recent files from the recent-files store and reopens them from disk', async () => {
    useRecentFilesStore.setState({
      recentFiles: [
        { path: '/w/src/app.ts', name: 'app.ts', timestamp: Date.now() },
        { path: 'untitled-1', name: 'Untitled', timestamp: Date.now() },
      ],
    })
    renderWelcome()
    expect(screen.queryByText('No recent files yet.')).toBeNull()
    expect(screen.queryByText('Untitled')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByText('app.ts'))
    })
    expect(api.readFile).toHaveBeenCalledWith('/w/src/app.ts')
    expect(useEditorStore.getState().openFiles.map((f) => f.path)).toEqual(['/w/src/app.ts'])

    fireEvent.click(screen.getByText('Clear All'))
    expect(useRecentFilesStore.getState().recentFiles).toEqual([])
  })

  it('the Recent badge counts the files it lists', () => {
    useRecentFilesStore.setState({
      recentFiles: Array.from({ length: 25 }, (_, i) => ({ path: `/w/f${i}.ts`, name: `f${i}.ts`, timestamp: Date.now() })),
    })
    renderWelcome()
    expect(screen.getAllByTitle(/^\/w\/f\d+\.ts$/)).toHaveLength(10)
    expect(screen.getByText('10')).toBeTruthy()
    expect(screen.queryByText('25')).toBeNull()
  })

  it('walkthrough steps open real features and dead steps are gone', () => {
    useCompletionStore.getState().setEnabled(false)
    const shortcuts = vi.fn()
    window.addEventListener('orion:keyboard-shortcuts', shortcuts)
    renderWelcome()

    expect(screen.queryByText('Install Extensions')).toBeNull()
    expect(screen.queryByText('Create a Custom Theme')).toBeNull()
    expect(screen.queryByText('Advanced Key Bindings')).toBeNull()

    fireEvent.click(screen.getByText('Customize Keybindings'))
    expect(shortcuts).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Choose a Color Theme'))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('AI-Powered Development'))
    fireEvent.click(screen.getByText('AI Code Completions'))
    expect(useCompletionStore.getState().enabled).toBe(true)
    window.removeEventListener('orion:keyboard-shortcuts', shortcuts)
  })

  it('learn and footer links open the project URLs and links without a destination are gone', () => {
    renderWelcome()
    for (const gone of ['Video Tutorials', 'Community Forum', 'Discord', 'Twitter', 'Sponsor']) {
      expect(screen.queryByText(gone)).toBeNull()
    }
    fireEvent.click(screen.getByText('Release Notes'))
    fireEvent.click(screen.getByText('Report an Issue'))
    fireEvent.click(screen.getByText('GitHub'))
    expect(api.shellOpenExternal.mock.calls.map(([url]) => url)).toEqual([
      PROJECT_LINKS.releases,
      PROJECT_LINKS.issues,
      PROJECT_LINKS.repository,
    ])
  })

  it('quick settings change the real theme and editor font size; no unwired controls', () => {
    useThemeStore.getState().setTheme('orion-dark')
    const editorConfig = vi.fn()
    window.addEventListener('orion:editor-config', editorConfig)
    renderWelcome()
    expandQuickSettings()

    expect(screen.queryByText('AI Provider')).toBeNull()
    expect(screen.queryByText('Show Welcome Tab on Startup')).toBeNull()
    expect(screen.queryByText('Orion Light')).toBeNull()

    fireEvent.click(screen.getByText('Nord'))
    expect(useThemeStore.getState().activeThemeId).toBe('nord')

    fireEvent.click(screen.getByTitle('Increase font size'))
    expect(JSON.parse(localStorage.getItem('orion-editor-settings') || '{}').fontSize).toBe(15)
    expect(editorConfig.mock.calls.at(-1)?.[0].detail).toEqual({ fontSize: 15 })
    expect(screen.getByText('15px')).toBeTruthy()
    window.removeEventListener('orion:editor-config', editorConfig)
  })

  it('keeps other editor settings when changing the font size', () => {
    localStorage.setItem('orion-editor-settings', JSON.stringify({ fontSize: 20, minimap: false }))
    renderWelcome()
    expandQuickSettings()
    expect(screen.getByText('20px')).toBeTruthy()
    fireEvent.click(screen.getByTitle('Decrease font size'))
    expect(JSON.parse(localStorage.getItem('orion-editor-settings') || '{}')).toEqual({ fontSize: 19, minimap: false })
  })
})
