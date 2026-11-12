/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileSearchMatch, FileSearchResult } from '@shared/ipc-contract'
import type { OpenFile } from '@shared/types'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { useToastStore } from '@/store/toast'

const monacoEditors = vi.hoisted(() => [] as unknown[])
vi.mock('@/monaco/setup', () => ({
  modelPathFor: (filePath: string) => `file://${filePath}`,
  monaco: { editor: { getEditors: () => monacoEditors } },
}))

const { default: SearchPanel } = await import('./SearchPanel')

/** Files on "disk", read and written through the mocked window.api. */
let disk: Record<string, string>
let searchResult: FileSearchResult
const api = {
  searchFiles: vi.fn(async () => searchResult),
  readFile: vi.fn(async (filePath: string) => {
    if (!(filePath in disk)) throw new Error('ENOENT')
    // Like fs:read-file, which reads images without their text.
    if (filePath.endsWith('.png')) return { content: '', language: 'plaintext', binary: true }
    return { content: disk[filePath], language: 'typescript' }
  }),
  writeFile: vi.fn(async (filePath: string, content: string) => {
    disk[filePath] = content
    return { success: true }
  }),
}
const addToast = vi.fn()

/** What fs:search lists for `query` in the files on disk. */
function listOnDisk(query: string): FileSearchResult {
  const matches: FileSearchMatch[] = []
  for (const [file, content] of Object.entries(disk)) {
    content.split(/\r?\n/).forEach((line, i) => {
      if (line.includes(query)) matches.push({ file, line: i + 1, content: line.trim() })
    })
  }
  return { matches, truncated: false }
}

function tab(path: string, overrides: Partial<OpenFile> = {}): OpenFile {
  return { path, name: path.split('/').pop()!, content: disk[path] ?? '', language: 'typescript', isModified: false, aiModified: false, ...overrides }
}

async function searchFor(query: string) {
  searchResult = listOnDisk(query)
  const input = screen.getByPlaceholderText('Search in files...')
  fireEvent.change(input, { target: { value: query } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(screen.queryByText(/results? in/)).not.toBeNull())
}

async function replaceAllWith(replacement: string) {
  fireEvent.click(screen.getByTitle('Show Replace'))
  fireEvent.change(screen.getByPlaceholderText('Replace...'), { target: { value: replacement } })
  await act(async () => {
    fireEvent.click(screen.getByTitle('Replace All in All Files'))
  })
  await waitFor(() => expect(addToast).toHaveBeenCalled())
}

const lastToast = () => addToast.mock.calls.at(-1)![0] as { type: string; message: string }

beforeEach(() => {
  disk = {}
  monacoEditors.length = 0
  Object.assign(window, { api })
  Object.values(api).forEach((fn) => fn.mockClear())
  addToast.mockReset()
  useToastStore.setState({ addToast })
  useFileStore.setState({ rootPath: '/w' })
  useEditorStore.setState({ openFiles: [], activeFilePath: null, previewPath: null, pinnedTabs: [] })
  render(<SearchPanel />)
})

afterEach(() => cleanup())

describe('Replace in Files', () => {
  it('never writes over a tab with unsaved edits, and keeps a clean tab in step with the disk', async () => {
    disk = { '/w/dirty.ts': 'foo\n', '/w/clean.ts': 'foo\n', '/w/closed.ts': 'foo\n' }
    useEditorStore.setState({ openFiles: [tab('/w/dirty.ts', { content: 'foo, edited', isModified: true }), tab('/w/clean.ts')] })
    await searchFor('foo')
    await replaceAllWith('bar')

    expect(disk).toEqual({ '/w/dirty.ts': 'foo\n', '/w/clean.ts': 'bar\n', '/w/closed.ts': 'bar\n' })
    const [dirty, clean] = useEditorStore.getState().openFiles
    expect(dirty).toMatchObject({ content: 'foo, edited', isModified: true })
    expect(clean).toMatchObject({ content: 'bar\n', isModified: false })
    expect(lastToast()).toMatchObject({ type: 'warning', message: expect.stringContaining('dirty.ts (unsaved or conflicting changes in the editor)') })
  })

  it('keeps edits typed into a clean tab while the replace was writing, and flags the conflict', async () => {
    disk = { '/w/a.ts': 'foo\n' }
    useEditorStore.setState({ openFiles: [tab('/w/a.ts')] })
    await searchFor('foo')
    api.writeFile.mockImplementationOnce(async (filePath: string, content: string) => {
      useEditorStore.getState().updateFileContent(filePath, 'typed meanwhile\n')
      disk[filePath] = content
      return { success: true }
    })
    await replaceAllWith('bar')

    expect(disk['/w/a.ts']).toBe('bar\n')
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({ content: 'typed meanwhile\n', isModified: true, hasExternalChange: true })
  })

  it('skips a tab flagged as changed on disk, and an image', async () => {
    disk = { '/w/a.ts': 'foo\n', '/w/img.png': 'foo' }
    useEditorStore.setState({ openFiles: [tab('/w/a.ts', { hasExternalChange: true })] })
    await searchFor('foo')
    await replaceAllWith('bar')

    expect(api.writeFile).not.toHaveBeenCalled()
    expect(lastToast()).toMatchObject({ type: 'error', message: expect.stringContaining('a.ts (unsaved or conflicting changes in the editor)') })
    expect(lastToast().message).toContain('img.png (not a text file)')
  })

  it('replaces only the matches still listed, literally outside regex mode', async () => {
    disk = { '/w/a.ts': 'foo 1\nfoo 2\nfoo 3\n' }
    await searchFor('foo')
    fireEvent.click(screen.getAllByTitle('Dismiss this match')[1])
    await replaceAllWith('$&!')

    expect(disk['/w/a.ts']).toBe('$&! 1\nfoo 2\n$&! 3\n')
    expect(lastToast()).toMatchObject({ type: 'success', message: 'Replaced 2 occurrences in 1 file.' })
  })

  it('refuses to replace in a file that changed since the search', async () => {
    disk = { '/w/a.ts': 'foo\n' }
    await searchFor('foo')
    disk['/w/a.ts'] = 'new first line\nfoo\n'
    await replaceAllWith('bar')

    expect(api.writeFile).not.toHaveBeenCalled()
    expect(lastToast()).toMatchObject({ type: 'error', message: expect.stringContaining('a.ts (line 1 changed since the search)') })
  })

  it('edits the buffers, not the disk, for results listed from open editors', async () => {
    disk = { '/w/a.ts': 'foo on disk\n' }
    useEditorStore.setState({ openFiles: [tab('/w/a.ts', { content: 'unsaved foo\n', isModified: true })] })
    fireEvent.click(screen.getByTitle('Search open editors only'))
    const input = screen.getByPlaceholderText('Search in files...')
    fireEvent.change(input, { target: { value: 'foo' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByText(/results? in/)).not.toBeNull())
    await replaceAllWith('bar')

    expect(api.writeFile).not.toHaveBeenCalled()
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({ content: 'unsaved bar\n', isModified: true })
  })
})

describe('Undo Last Replace', () => {
  it('restores a file that still holds what the replace wrote', async () => {
    disk = { '/w/a.ts': 'foo\n' }
    await searchFor('foo')
    await replaceAllWith('bar')
    await act(async () => {
      fireEvent.click(screen.getByTitle(/Undo Last Replace/))
    })

    await waitFor(() => expect(lastToast().message).toContain('Reverted'))
    expect(disk['/w/a.ts']).toBe('foo\n')
  })

  it('leaves a file alone that changed after the replace', async () => {
    disk = { '/w/a.ts': 'foo\n' }
    await searchFor('foo')
    await replaceAllWith('bar')
    disk['/w/a.ts'] = 'bar\nlater edit\n'
    api.writeFile.mockClear()
    await act(async () => {
      fireEvent.click(screen.getByTitle(/Undo Last Replace/))
    })

    await waitFor(() => expect(lastToast().message).toContain('a.ts (changed since)'))
    expect(api.writeFile).not.toHaveBeenCalled()
    expect(disk['/w/a.ts']).toBe('bar\nlater edit\n')
  })

  it('leaves a file alone whose tab has unsaved edits', async () => {
    disk = { '/w/a.ts': 'foo\n' }
    useEditorStore.setState({ openFiles: [tab('/w/a.ts')] })
    await searchFor('foo')
    await replaceAllWith('bar')
    useEditorStore.getState().updateFileContent('/w/a.ts', 'bar\nunsaved\n')
    api.writeFile.mockClear()
    await act(async () => {
      fireEvent.click(screen.getByTitle(/Undo Last Replace/))
    })

    await waitFor(() => expect(lastToast().message).toContain('a.ts (unsaved changes in the editor)'))
    expect(api.writeFile).not.toHaveBeenCalled()
    expect(disk['/w/a.ts']).toBe('bar\n')
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({ content: 'bar\nunsaved\n', isModified: true })
  })

  it('reverts an Open Only replace only in buffers that still hold what it put there', async () => {
    useEditorStore.setState({
      openFiles: [tab('/w/kept.ts', { content: 'foo\n' }), tab('/w/closed.ts', { content: 'foo\n' }), tab('/w/edited.ts', { content: 'foo\n' })],
    })
    fireEvent.click(screen.getByTitle('Search open editors only'))
    await searchFor('foo')
    await replaceAllWith('bar')
    useEditorStore.setState((s) => ({ openFiles: s.openFiles.filter((f) => f.path !== '/w/closed.ts') }))
    useEditorStore.getState().updateFileContent('/w/edited.ts', 'bar\nmore\n')
    await act(async () => {
      fireEvent.click(screen.getByTitle(/Undo Last Replace/))
    })

    await waitFor(() => expect(lastToast().message).toContain('Reverted 1 file.'))
    expect(lastToast().message).toContain('closed.ts (no longer open)')
    expect(lastToast().message).toContain('edited.ts (edited since)')
    expect(Object.fromEntries(useEditorStore.getState().openFiles.map((f) => [f.path, f.content]))).toEqual({
      '/w/kept.ts': 'foo\n',
      '/w/edited.ts': 'bar\nmore\n',
    })
    expect(api.writeFile).not.toHaveBeenCalled()
  })
})

describe('Find in Files', () => {
  it('sends the whole-word flag and file filters to the search', async () => {
    fireEvent.click(screen.getByTitle('Match Whole Word (Alt+W)'))
    fireEvent.click(screen.getByTitle('Show Filters (include/exclude files)'))
    fireEvent.change(screen.getByPlaceholderText('files to include (e.g. *.ts, src/**)'), { target: { value: 'src/**, *.ts' } })
    fireEvent.change(screen.getByPlaceholderText('files to exclude (e.g. node_modules, dist)'), { target: { value: 'gen' } })
    disk = { '/w/src/a.ts': 'foo\n' }
    await searchFor('foo')

    expect(api.searchFiles).toHaveBeenCalledWith('/w', 'foo', {
      caseSensitive: false, regex: false, wholeWord: true, include: ['src/**', '*.ts'], exclude: ['gen'], extensions: [],
    })
  })

  it('says when the results stop at the limit, and a replace says it did not cover the rest', async () => {
    disk = { '/w/a.ts': 'foo\n' }
    searchResult = { ...listOnDisk('foo'), truncated: true }
    const input = screen.getByPlaceholderText('Search in files...')
    fireEvent.change(input, { target: { value: 'foo' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.queryByText(/Only the first matching lines are listed/)).not.toBeNull())
    await replaceAllWith('bar')
    expect(lastToast()).toMatchObject({ type: 'warning', message: expect.stringContaining('More matches exist than the list shows') })
  })

  it('opens a clicked result at its line', async () => {
    disk = { '/w/a.ts': 'one\ntwo\nfoo three\n' }
    await searchFor('foo')
    const editorShowing = (uri: string) => ({
      getModel: () => ({ uri: { toString: () => uri } }),
      revealLineInCenter: vi.fn(),
      setPosition: vi.fn(),
      focus: vi.fn(),
    })
    // Still showing the previous file, whose view state would replace the jump once the tab switches.
    const previous = editorShowing('file:///w/previous.ts')
    monacoEditors.push(previous)
    const editor = editorShowing('file:///w/a.ts')
    await act(async () => {
      fireEvent.click(screen.getByText('3'))
    })
    // The editor shows the file only after the tab switch renders.
    monacoEditors.push(editor)

    await waitFor(() => expect(editor.revealLineInCenter).toHaveBeenCalledWith(3))
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 3, column: 1 })
    expect(previous.revealLineInCenter).not.toHaveBeenCalled()
    expect(previous.setPosition).not.toHaveBeenCalled()
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({ path: '/w/a.ts', content: 'one\ntwo\nfoo three\n', isModified: false })
    expect(useEditorStore.getState().activeFilePath).toBe('/w/a.ts')
  })
})
