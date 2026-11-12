/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { openFileInEditor } = vi.hoisted(() => ({ openFileInEditor: vi.fn(async (_path: string) => true) }))
vi.mock('@/utils/openFileInEditor', () => ({ openFileInEditor, pickAndOpenFiles: vi.fn() }))

import TitleBar, { buildMenus } from './TitleBar'
import { useRecentFilesStore } from '@/store/recentFiles'
import { getCommand } from '@/commands/registry'

type Item = ReturnType<typeof buildMenus>[number]['items'][number]
const flatten = (items: Item[]): Item[] => items.flatMap((item) => (item.type === 'submenu' ? [item, ...flatten(item.children)] : [item]))

beforeEach(() => {
  vi.clearAllMocks()
  useRecentFilesStore.setState({ recentFiles: [] })
})
afterEach(cleanup)

describe('TitleBar menus', () => {
  it('offers only commands from the registry, each once per menu, and no debugger', () => {
    const menus = buildMenus([])
    expect(menus.map((m) => m.label)).toEqual(['File', 'Edit', 'Selection', 'View', 'Go', 'Terminal', 'Help'])
    for (const menu of menus) {
      const labels = flatten(menu.items).filter((i) => i.type !== 'separator').map((i) => (i as { label: string }).label)
      expect(new Set(labels).size, `${menu.label} has a duplicate item`).toBe(labels.length)
      expect(labels.filter((label) => /debug|breakpoint|extension|new window|remote/i.test(label))).toEqual([])
    }
  })

  it('shows the shortcut each command really has', () => {
    const save = flatten(buildMenus([])[0].items).find((i) => i.type === 'action' && i.label === 'Save')
    expect(save).toMatchObject({ shortcut: getCommand('file.save')!.keybinding })
  })

  it('Open Folder asks App to open the folder (it used to discard the chosen path)', () => {
    const openFolder = vi.fn()
    window.addEventListener('orion:open-folder', openFolder)
    const item = flatten(buildMenus([])[0].items).find((i) => i.type === 'action' && i.label === 'Open Folder...')
    ;(item as { action: () => void }).action()
    window.removeEventListener('orion:open-folder', openFolder)
    expect(openFolder).toHaveBeenCalledTimes(1)
  })

  it('opens a recent file in the editor', () => {
    useRecentFilesStore.setState({ recentFiles: [{ path: '/ws/notes.md', name: 'notes.md' }] as never })
    render(<TitleBar />)
    fireEvent.mouseDown(screen.getByText('File'))
    fireEvent.mouseEnter(screen.getByText('Open Recent'))
    fireEvent.click(screen.getByText('notes.md'))
    expect(openFileInEditor).toHaveBeenCalledWith('/ws/notes.md')
  })
})
