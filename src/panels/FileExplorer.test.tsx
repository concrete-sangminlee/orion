/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileNode } from '@shared/types'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { useToastStore } from '@/store/toast'
import { useRevealStore } from '@/utils/revealInExplorer'
import FileExplorer from './FileExplorer'

// "src" holds only "components", so the tree shows one compact row "src/components".
const tree: FileNode[] = [
  {
    name: 'src',
    path: '/w/src',
    type: 'directory',
    children: [
      {
        name: 'components',
        path: '/w/src/components',
        type: 'directory',
        children: [{ name: 'Button.tsx', path: '/w/src/components/Button.tsx', type: 'file' }],
      },
    ],
  },
  { name: 'notes.txt', path: '/w/notes.txt', type: 'file' },
]

let api: Record<string, ReturnType<typeof vi.fn>>

beforeAll(() => {
  ;(globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s.replace(/["\\]/g, '\\$&') }
})

beforeEach(() => {
  api = {
    renameFile: vi.fn().mockResolvedValue({ success: true }),
    readFile: vi.fn().mockResolvedValue({ content: 'text', language: 'plaintext' }),
    readDir: vi.fn().mockResolvedValue(tree),
    trashItem: vi.fn().mockResolvedValue({ success: true }),
  }
  ;(globalThis as unknown as { api: unknown }).api = api
  useFileStore.setState({ rootPath: '/w', fileTree: tree, expandedDirs: new Set() })
  useEditorStore.setState({ openFiles: [], activeFilePath: null, previewPath: null, pinnedTabs: [], closeRequest: null })
  useToastStore.setState({ toasts: [] })
  useRevealStore.setState({ target: null })
})

afterEach(cleanup)

function openMenu(label: string, item: string) {
  fireEvent.contextMenu(screen.getByText(label))
  fireEvent.click(screen.getByText(item))
}

describe('FileExplorer rename and delete of a compact folder row', () => {
  it('renames only the last folder of the row', async () => {
    render(<FileExplorer />)
    openMenu('src/components', 'Rename')
    const input = screen.getByDisplayValue('components')
    fireEvent.change(input, { target: { value: 'ui' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(api.renameFile).toHaveBeenCalledWith('/w/src/components', '/w/src/ui')
  })

  it('refuses a name with a path separator instead of moving the folder', async () => {
    render(<FileExplorer />)
    openMenu('src/components', 'Rename')
    const input = screen.getByDisplayValue('components')
    fireEvent.change(input, { target: { value: 'src/ui' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(api.renameFile).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      'Operation failed: a name cannot contain / or \\',
    ])
  })

  it('names the folder that Delete removes', () => {
    render(<FileExplorer />)
    openMenu('src/components', 'Delete')
    expect(screen.getByText('"components"')).toBeTruthy()
  })
})

describe('FileExplorer actions', () => {
  it('Open to the Side opens the chosen file in the split', async () => {
    const splitRight = vi.fn()
    const toggle = vi.fn()
    window.addEventListener('orion:split-editor-right', splitRight)
    window.addEventListener('orion:split-editor', toggle)
    useEditorStore.setState({
      openFiles: [{ path: '/w/other.ts', name: 'other.ts', content: '', language: 'typescript', isModified: false, aiModified: false }],
      activeFilePath: '/w/other.ts',
    })
    render(<FileExplorer />)
    fireEvent.contextMenu(screen.getAllByText('notes.txt').at(-1)!)
    await act(async () => {
      fireEvent.click(screen.getByText('Open to the Side'))
    })
    expect((splitRight.mock.calls[0][0] as CustomEvent).detail).toEqual({ path: '/w/notes.txt' })
    expect(toggle).not.toHaveBeenCalled()
    // The main pane keeps its file; the chosen one is open for the side pane.
    expect(useEditorStore.getState().activeFilePath).toBe('/w/other.ts')
    expect(useEditorStore.getState().openFiles.map((f) => f.path)).toContain('/w/notes.txt')
    window.removeEventListener('orion:split-editor-right', splitRight)
    window.removeEventListener('orion:split-editor', toggle)
  })

  it('the Open Editors X asks before closing a tab with unsaved edits', () => {
    useEditorStore.setState({
      openFiles: [{ path: '/w/notes.txt', name: 'notes.txt', content: 'edited', language: 'plaintext', isModified: true, aiModified: false }],
      activeFilePath: '/w/notes.txt',
    })
    const { container } = render(<FileExplorer />)
    fireEvent.click(container.querySelector('.open-editor-close-btn')!)
    expect(useEditorStore.getState().openFiles.map((f) => f.path)).toEqual(['/w/notes.txt'])
    expect(useEditorStore.getState().closeRequest).toMatchObject({ unsaved: ['/w/notes.txt'] })
  })

  it('scrolls to a revealed file', () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    useFileStore.setState({ expandedDirs: new Set(['/w/src', '/w/src/components']) })
    useRevealStore.setState({ target: '/w/src/components/Button.tsx' })
    render(<FileExplorer />)
    expect(scrolled).toHaveBeenCalledTimes(1)
    expect(scrolled.mock.contexts[0]).toBe(document.querySelector('[data-node-path="/w/src/components/Button.tsx"]'))
    expect(useRevealStore.getState().target).toBeNull()
  })

  it('offers no Clone Repository button, which had nothing behind it', () => {
    useFileStore.setState({ rootPath: null, fileTree: [] })
    render(<FileExplorer />)
    expect(screen.getByText('Open Folder')).toBeTruthy()
    expect(screen.queryByText('Clone Repository')).toBeNull()
  })
})
