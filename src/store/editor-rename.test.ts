/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import type { OpenFile } from '@shared/types'
import { retargetPath, useEditorStore } from './editor'

const file = (path: string, overrides: Partial<OpenFile> = {}): OpenFile => ({
  path,
  name: path.split('/').pop()!,
  content: `// ${path}`,
  language: 'typescript',
  isModified: false,
  aiModified: false,
  ...overrides,
})

describe('retargetPath', () => {
  it('rewrites the path itself and everything inside it', () => {
    expect(retargetPath('/w/src/a.ts', '/w/src/a.ts', '/w/src/b.ts')).toBe('/w/src/b.ts')
    expect(retargetPath('/w/src/deep/a.ts', '/w/src', '/w/lib')).toBe('/w/lib/deep/a.ts')
    expect(retargetPath('C:\\w\\src\\a.ts', 'C:\\w\\src', 'C:\\w\\lib')).toBe('C:\\w\\lib\\a.ts')
  })

  it('leaves siblings that merely share a name prefix alone', () => {
    expect(retargetPath('/w/src-old/a.ts', '/w/src', '/w/lib')).toBe('/w/src-old/a.ts')
    expect(retargetPath('/w/src/a.tsx', '/w/src/a.ts', '/w/src/b.ts')).toBe('/w/src/a.tsx')
  })
})

describe('renamePath', () => {
  beforeEach(() => {
    useEditorStore.setState({
      openFiles: [file('/w/src/a.ts', { content: 'unsaved edit', isModified: true }), file('/w/src/keep.ts'), file('/w/other.ts')],
      activeFilePath: '/w/src/a.ts',
      previewPath: null,
      pinnedTabs: ['/w/src/a.ts'],
      tabHistory: ['/w/other.ts', '/w/src/a.ts'],
      fileStates: { '/w/src/a.ts': { cursorPosition: { line: 7, column: 3 }, scrollTop: 40, scrollLeft: 0, foldedRanges: [] } },
      unsavedSnapshots: { '/w/src/a.ts': { path: '/w/src/a.ts', content: 'unsaved edit', originalContent: '', timestamp: 1 } },
      recoveryNotifications: [],
    })
  })

  it('moves an open tab to the new name without losing unsaved edits, position or order', () => {
    useEditorStore.getState().renamePath('/w/src/a.ts', '/w/src/renamed.py', 'python')
    const state = useEditorStore.getState()

    expect(state.openFiles.map((f) => f.path)).toEqual(['/w/src/renamed.py', '/w/src/keep.ts', '/w/other.ts'])
    expect(state.openFiles[0]).toMatchObject({ name: 'renamed.py', language: 'python', content: 'unsaved edit', isModified: true })
    expect(state.activeFilePath).toBe('/w/src/renamed.py')
    expect(state.pinnedTabs).toEqual(['/w/src/renamed.py'])
    expect(state.tabHistory).toEqual(['/w/other.ts', '/w/src/renamed.py'])
    expect(state.fileStates['/w/src/renamed.py'].cursorPosition).toEqual({ line: 7, column: 3 })
    expect(state.fileStates['/w/src/a.ts']).toBeUndefined()
    expect(state.unsavedSnapshots['/w/src/renamed.py'].path).toBe('/w/src/renamed.py')
    // No tab is left pointing at the old path, where a save would recreate it.
    expect(state.openFiles.some((f) => f.path === '/w/src/a.ts')).toBe(false)
  })

  it('moves every open tab inside a renamed folder and keeps their language', () => {
    useEditorStore.getState().renamePath('/w/src', '/w/lib', 'ignored-for-children')
    const state = useEditorStore.getState()
    expect(state.openFiles.map((f) => f.path)).toEqual(['/w/lib/a.ts', '/w/lib/keep.ts', '/w/other.ts'])
    expect(state.openFiles.map((f) => f.language)).toEqual(['typescript', 'typescript', 'typescript'])
    expect(state.activeFilePath).toBe('/w/lib/a.ts')
  })
})
