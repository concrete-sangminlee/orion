/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { openFileInEditor } = vi.hoisted(() => ({ openFileInEditor: vi.fn(async (_path: string) => true) }))
vi.mock('@/utils/openFileInEditor', () => ({ openFileInEditor, pickAndOpenFiles: vi.fn() }))

import CommandPalette from './CommandPalette'
import { useFileStore } from '@/store/files'
import { useEditorStore } from '@/store/editor'
import { useRecentFilesStore } from '@/store/recentFiles'
import { listCommands } from '@/commands/registry'

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom has no layout.
  Element.prototype.scrollIntoView = () => {}
  localStorage.clear()
  useFileStore.setState({ fileTree: [{ name: 'a.ts', path: '/ws/a.ts', type: 'file' }] as never })
  useEditorStore.setState({ openFiles: [], activeFilePath: null })
  useRecentFilesStore.setState({ recentFiles: [] })
})
afterEach(cleanup)

const input = () => screen.getByRole('textbox') as HTMLInputElement

function events(name: string) {
  const seen = vi.fn()
  window.addEventListener(name, seen)
  return { seen, stop: () => window.removeEventListener(name, seen) }
}

describe('CommandPalette', () => {
  it('opens in the mode it was asked for', () => {
    render(<CommandPalette open mode="commands" onClose={() => {}} />)
    expect(input().value).toBe('>')
    cleanup()
    render(<CommandPalette open mode="symbols" onClose={() => {}} />)
    expect(input().value).toBe('#')
    cleanup()
    render(<CommandPalette open mode="themes" onClose={() => {}} />)
    expect(input().placeholder).toBe('Select a color theme...')
  })

  it('lists exactly the registry commands', () => {
    render(<CommandPalette open mode="commands" onClose={() => {}} />)
    const shown = (query: string) => {
      fireEvent.change(input(), { target: { value: `>${query}` } })
      return screen.queryAllByText((_, el) => el?.getAttribute('data-type') === 'item').map((el) => el.textContent)
    }
    expect(shown('Preferences: Keyboard Shortcuts')[0]).toContain('Preferences: Keyboard Shortcuts')
    expect(shown('Start Debugging')).toEqual([])
    expect(shown('New Window')).toEqual([])
    expect(listCommands().length).toBeGreaterThan(50)
  })

  it('runs the command it shows (Keyboard Shortcuts used to open Settings)', () => {
    const onClose = vi.fn()
    const shortcuts = events('orion:keyboard-shortcuts')
    const settings = events('orion:open-settings')
    render(<CommandPalette open mode="commands" onClose={onClose} />)
    fireEvent.change(input(), { target: { value: '>Preferences: Keyboard Shortcuts' } })
    fireEvent.click(screen.getByText('Preferences: Keyboard Shortcuts'))
    shortcuts.stop()
    settings.stop()
    expect(shortcuts.seen).toHaveBeenCalledTimes(1)
    expect(settings.seen).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('opens a file by reading it, never as an empty buffer', () => {
    const onClose = vi.fn()
    render(<CommandPalette open mode="files" onClose={onClose} />)
    fireEvent.click(screen.getByText('a.ts'))
    expect(openFileInEditor).toHaveBeenCalledWith('/ws/a.ts')
    expect(useEditorStore.getState().openFiles).toEqual([])
    expect(onClose).toHaveBeenCalled()
  })
})
