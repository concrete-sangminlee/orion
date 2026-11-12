/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import type { OpenFile } from '@shared/types'
import { useEditorStore } from './editor'

const file = (path: string, overrides: Partial<OpenFile> = {}): OpenFile => ({
  path,
  name: path.split('/').pop()!,
  content: `// ${path}`,
  language: 'typescript',
  isModified: false,
  aiModified: false,
  ...overrides,
})

const openPaths = () => useEditorStore.getState().openFiles.map((f) => f.path)

describe('closing tabs with unsaved edits', () => {
  beforeEach(() => {
    useEditorStore.setState({
      openFiles: [
        file('/w/pinned.ts'),
        file('/w/a.ts'),
        file('/w/dirty.ts', { content: 'unsaved', isModified: true }),
        file('/w/c.ts'),
      ],
      activeFilePath: '/w/dirty.ts',
      previewPath: null,
      pinnedTabs: ['/w/pinned.ts'],
      closeRequest: null,
    })
  })

  it('closes a saved tab right away', () => {
    useEditorStore.getState().closeFile('/w/a.ts')
    expect(openPaths()).toEqual(['/w/pinned.ts', '/w/dirty.ts', '/w/c.ts'])
    expect(useEditorStore.getState().closeRequest).toBeNull()
  })

  it('asks before closing a tab with unsaved edits, and closes it only when confirmed', () => {
    useEditorStore.getState().closeFile('/w/dirty.ts')
    expect(openPaths()).toContain('/w/dirty.ts')
    expect(useEditorStore.getState().closeRequest).toEqual({ paths: ['/w/dirty.ts'], unsaved: ['/w/dirty.ts'], next: undefined })

    useEditorStore.getState().confirmCloseRequest()
    expect(openPaths()).toEqual(['/w/pinned.ts', '/w/a.ts', '/w/c.ts'])
    expect(useEditorStore.getState().activeFilePath).toBe('/w/c.ts')
    expect(useEditorStore.getState().closeRequest).toBeNull()
  })

  it('keeps everything open when the question is cancelled', () => {
    useEditorStore.getState().closeAllFiles()
    useEditorStore.getState().cancelCloseRequest()
    expect(openPaths()).toEqual(['/w/pinned.ts', '/w/a.ts', '/w/dirty.ts', '/w/c.ts'])
    expect(useEditorStore.getState().closeRequest).toBeNull()
  })

  it('asks once for Close All, Close Others and Close to the Right, about the unsaved tabs only', () => {
    const { closeAllFiles, closeOtherFiles, closeToRight } = useEditorStore.getState()

    closeAllFiles()
    expect(useEditorStore.getState().closeRequest).toMatchObject({
      paths: ['/w/a.ts', '/w/dirty.ts', '/w/c.ts'],
      unsaved: ['/w/dirty.ts'],
    })
    expect(openPaths()).toHaveLength(4)

    closeOtherFiles('/w/c.ts')
    expect(useEditorStore.getState().closeRequest).toMatchObject({ paths: ['/w/a.ts', '/w/dirty.ts'], next: '/w/c.ts' })

    closeToRight('/w/a.ts')
    expect(useEditorStore.getState().closeRequest).toMatchObject({ paths: ['/w/dirty.ts', '/w/c.ts'], next: '/w/a.ts' })
    expect(openPaths()).toHaveLength(4)

    useEditorStore.getState().confirmCloseRequest()
    expect(openPaths()).toEqual(['/w/pinned.ts', '/w/a.ts'])
    expect(useEditorStore.getState().activeFilePath).toBe('/w/a.ts')
  })

  it('does not close a tab that picked up edits after the question was asked', () => {
    useEditorStore.getState().closeAllFiles()
    useEditorStore.getState().updateFileContent('/w/c.ts', 'typed while asking')
    useEditorStore.getState().confirmCloseRequest()
    expect(openPaths()).toEqual(['/w/pinned.ts', '/w/c.ts'])
  })

  it('never closes a pinned tab', () => {
    useEditorStore.getState().closeFile('/w/pinned.ts')
    expect(openPaths()).toContain('/w/pinned.ts')
    expect(useEditorStore.getState().closeRequest).toBeNull()
  })
})
