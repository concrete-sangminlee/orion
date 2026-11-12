/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileStore } from '@/store/files'
import { useToastStore } from '@/store/toast'
import { ancestorFolders, revealInExplorer, useRevealStore } from './revealInExplorer'

describe('ancestorFolders', () => {
  it('lists the folders between the root and the file', () => {
    expect(ancestorFolders('/w', '/w/src/ui/Button.tsx')).toEqual(['/w/src', '/w/src/ui'])
    expect(ancestorFolders('/w/', '/w/a.ts')).toEqual([])
    expect(ancestorFolders('C:\\w', 'C:\\w\\src\\a.ts')).toEqual(['C:\\w\\src'])
  })

  it('is null for a file outside the root, including a sibling sharing its prefix', () => {
    expect(ancestorFolders('/w', '/other/a.ts')).toBeNull()
    expect(ancestorFolders('/w', '/w-old/a.ts')).toBeNull()
  })
})

describe('revealInExplorer', () => {
  beforeEach(() => {
    useFileStore.setState({ rootPath: '/w', expandedDirs: new Set(['/w/lib']) })
    useRevealStore.setState({ target: null })
    useToastStore.setState({ toasts: [] })
  })

  it('expands the folders, sets the target and shows the Explorer', () => {
    const shown = vi.fn()
    window.addEventListener('orion:show-explorer', shown)
    revealInExplorer('/w/src/ui/Button.tsx')
    expect([...useFileStore.getState().expandedDirs].sort()).toEqual(['/w/lib', '/w/src', '/w/src/ui'])
    expect(useRevealStore.getState().target).toBe('/w/src/ui/Button.tsx')
    expect(shown).toHaveBeenCalledTimes(1)
    window.removeEventListener('orion:show-explorer', shown)
  })

  it('says so for a file outside the open folder', () => {
    revealInExplorer('/elsewhere/notes.md')
    expect(useRevealStore.getState().target).toBeNull()
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['notes.md is not in the open folder'])
  })
})
