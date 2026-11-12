/** @vitest-environment jsdom */
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@shared/types'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import TabBar from './TabBar'

const file = (path: string, overrides: Partial<OpenFile> = {}): OpenFile => ({
  path,
  name: path.split('/').pop()!,
  content: `saved ${path}`,
  language: 'typescript',
  isModified: false,
  aiModified: false,
  isPinned: true,
  ...overrides,
})

let writeFile: ReturnType<typeof vi.fn>

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  ;(globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s.replace(/["\\]/g, '\\$&') }
  Element.prototype.scrollIntoView ??= () => {}
})

beforeEach(() => {
  writeFile = vi.fn().mockResolvedValue({ success: true })
  ;(globalThis as unknown as { api: unknown }).api = { writeFile }
  useEditorStore.setState({
    openFiles: [file('/w/src/clean.ts'), file('/w/src/dirty.ts', { content: 'unsaved', isModified: true })],
    activeFilePath: '/w/src/clean.ts',
    previewPath: null,
    pinnedTabs: [],
    closeRequest: null,
  })
})

afterEach(cleanup)

const tab = (name: string) => screen.getByText(name).closest('[data-path]') as HTMLElement
const openNames = () => useEditorStore.getState().openFiles.map((f) => f.name)
const dialog = () => screen.queryByRole('alertdialog')

describe('TabBar close guard', () => {
  it("asks before the tab X discards unsaved edits; Don't Save closes", () => {
    render(<TabBar />)
    fireEvent.mouseEnter(tab('dirty.ts'))
    fireEvent.click(tab('dirty.ts').querySelector('button')!)
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain('Save changes to dirty.ts?')
    expect(openNames()).toContain('dirty.ts')

    fireEvent.click(screen.getByText("Don't Save"))
    expect(openNames()).toEqual(['clean.ts'])
    expect(dialog()).toBeNull()
  })

  it('asks on middle-click too', () => {
    render(<TabBar />)
    fireEvent(tab('dirty.ts'), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(dialog()).not.toBeNull()
  })

  it('asks for the close-all button and the tab menu, and Cancel keeps every tab', () => {
    render(<TabBar />)
    fireEvent.click(screen.getByTitle('Close all tabs'))
    expect(dialog()).not.toBeNull()
    fireEvent.click(screen.getByText('Cancel'))
    expect(openNames()).toEqual(['clean.ts', 'dirty.ts'])

    fireEvent.contextMenu(tab('clean.ts'))
    fireEvent.click(screen.getByText('Close Others'))
    expect(dialog()!.textContent).toContain('dirty.ts')
    fireEvent.click(screen.getByText('Cancel'))
    expect(openNames()).toEqual(['clean.ts', 'dirty.ts'])
  })

  it('Save writes the file, then closes the tab', async () => {
    render(<TabBar />)
    fireEvent.click(screen.getByTitle('Close all tabs'))
    await act(async () => {
      fireEvent.click(screen.getByText('Save'))
    })
    expect(writeFile).toHaveBeenCalledWith('/w/src/dirty.ts', 'unsaved')
    expect(openNames()).toEqual([])
  })
})

describe('TabBar menu and drop actions', () => {
  it('Reveal in Explorer expands the folders and shows the Explorer', () => {
    useFileStore.setState({ rootPath: '/w', expandedDirs: new Set() })
    const shown = vi.fn()
    window.addEventListener('orion:show-explorer', shown)
    render(<TabBar />)
    fireEvent.contextMenu(tab('dirty.ts'))
    fireEvent.click(screen.getByText('Reveal in Explorer'))
    expect([...useFileStore.getState().expandedDirs]).toEqual(['/w/src'])
    expect(shown).toHaveBeenCalledTimes(1)
    window.removeEventListener('orion:show-explorer', shown)
  })

  it('Compare with... compares the tab it was opened on', () => {
    const compared = vi.fn()
    window.addEventListener('orion:compare-files', compared)
    render(<TabBar />)
    fireEvent.contextMenu(tab('dirty.ts'))
    fireEvent.click(screen.getByText('Compare with...'))
    expect((compared.mock.calls[0][0] as CustomEvent).detail).toEqual({ path: '/w/src/dirty.ts' })
    expect(useEditorStore.getState().activeFilePath).toBe('/w/src/dirty.ts')
    window.removeEventListener('orion:compare-files', compared)
  })

  it('a tab dropped on the right edge opens that file in a split to the right', () => {
    const splitRight = vi.fn()
    window.addEventListener('orion:split-editor-right', splitRight)
    const groupsBefore = useEditorStore.getState().editorGroups.length
    const { container } = render(<TabBar />)
    const bar = container.querySelector('.tab-scroll-container')!.parentElement!
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 500 } as DOMRect)
    const dataTransfer = {
      types: ['application/x-orion-tab'],
      getData: (type: string) => (type === 'application/x-orion-tab' ? '/w/src/clean.ts' : ''),
      dropEffect: 'none',
    }
    // jsdom has no DragEvent, so clientX has to be put on the plain Event.
    const atRightEdge = (event: Event) => Object.defineProperty(event, 'clientX', { value: 480 })
    fireEvent(bar, atRightEdge(createEvent.dragOver(bar, { dataTransfer })))
    fireEvent(bar, atRightEdge(createEvent.drop(bar, { dataTransfer })))
    expect((splitRight.mock.calls[0][0] as CustomEvent).detail).toEqual({ path: '/w/src/clean.ts' })
    // Nothing renders extra editor groups, so none are created.
    expect(useEditorStore.getState().editorGroups).toHaveLength(groupsBefore)
    window.removeEventListener('orion:split-editor-right', splitRight)
  })
})
