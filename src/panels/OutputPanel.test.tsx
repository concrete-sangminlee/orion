/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { useOutputStore } from '@/store/output'
import { useToastStore } from '@/store/toast'
import OutputPanel, { resolveOutputPath, splitFileLinks } from './OutputPanel'

const links = (text: string) => splitFileLinks(text).filter((s) => s.filePath).map(({ filePath, line }) => ({ filePath, line }))

describe('splitFileLinks', () => {
  it('finds absolute, relative and Windows paths with their line numbers', () => {
    expect(links('at run (/home/me/proj/src/app.ts:10:5)')).toEqual([{ filePath: '/home/me/proj/src/app.ts', line: 10 }])
    expect(links('error in src/panels/Foo.tsx:7')).toEqual([{ filePath: 'src/panels/Foo.tsx', line: 7 }])
    expect(links('see ./lib/x.js')).toEqual([{ filePath: './lib/x.js', line: undefined }])
    expect(links('C:\\x.ts:7 failed')).toEqual([{ filePath: 'C:\\x.ts', line: 7 }])
    expect(links('\x1b[31msrc/a.ts:4\x1b[0m')).toEqual([{ filePath: 'src/a.ts', line: 4 }])
  })

  it('leaves user agents, branch names, URLs and plain words alone', () => {
    expect(links('Mozilla/5.0 (X11; Linux x86_64)')).toEqual([])
    expect(links("Switched to branch 'feature/login'")).toEqual([])
    expect(links('fetching https://github.com/o/r/blob/main/a.js')).toEqual([])
    expect(links('e.g. this works')).toEqual([])
  })

  it('keeps the whole line text across segments', () => {
    const text = 'M src/a.ts and src/b.ts:3 changed'
    expect(splitFileLinks(text).map((s) => s.text).join('')).toBe(text)
  })
})

describe('resolveOutputPath', () => {
  it('resolves relative paths against the workspace root and keeps absolute ones', () => {
    expect(resolveOutputPath('src/a.ts', '/proj')).toBe('/proj/src/a.ts')
    expect(resolveOutputPath('./src/a.ts', '/proj/')).toBe('/proj/src/a.ts')
    expect(resolveOutputPath('src\\a.ts', 'C:\\proj')).toBe('C:\\proj\\src\\a.ts')
    expect(resolveOutputPath('/etc/x.conf', '/proj')).toBe('/etc/x.conf')
    expect(resolveOutputPath('src/a.ts', null)).toBe('src/a.ts')
  })

  it('gives Windows paths the backslashes the file tree uses, so an open file is not opened twice', () => {
    expect(resolveOutputPath('src/panels/a.ts', 'C:\\proj')).toBe('C:\\proj\\src\\panels\\a.ts')
    expect(resolveOutputPath('./src/a.ts', 'C:\\proj\\')).toBe('C:\\proj\\src\\a.ts')
    expect(resolveOutputPath('C:/proj/src/a.ts', 'C:\\proj')).toBe('C:\\proj\\src\\a.ts')
  })
})

describe('OutputPanel file links', () => {
  const readFile = vi.fn()

  beforeEach(() => {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
    ;(window as unknown as { api: unknown }).api = { readFile }
    useEditorStore.setState({ openFiles: [], activeFilePath: null })
    useFileStore.setState({ rootPath: '/proj' })
    useToastStore.setState({ toasts: [] })
    useOutputStore.getState().clearChannel('Git')
    useOutputStore.getState().setActiveChannel('Git')
  })

  afterEach(() => {
    cleanup()
    readFile.mockReset()
  })

  it('opens the file with its content from disk, not an empty buffer', async () => {
    readFile.mockResolvedValue({ content: 'export const a = 1\n', language: 'typescript' })
    act(() => useOutputStore.getState().appendOutput('Git', 'error: src/a.ts:3: conflict', 'error'))
    render(<OutputPanel />)

    fireEvent.click(screen.getByTitle('Open src/a.ts:3'))

    await waitFor(() => expect(useEditorStore.getState().activeFilePath).toBe('/proj/src/a.ts'))
    expect(readFile).toHaveBeenCalledWith('/proj/src/a.ts')
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({ content: 'export const a = 1\n', isModified: false })
  })

  it('on Windows, switches to the tab already open on the file instead of opening a second one', async () => {
    readFile.mockResolvedValue({ content: 'disk', language: 'typescript' })
    useFileStore.setState({ rootPath: 'C:\\proj' })
    useEditorStore.setState({
      openFiles: [{ path: 'C:\\proj\\src\\a.ts', name: 'a.ts', content: 'unsaved', language: 'typescript', isModified: true, aiModified: false }],
      activeFilePath: null,
    })
    act(() => useOutputStore.getState().appendOutput('Git', 'error: src/a.ts:3: conflict', 'error'))
    render(<OutputPanel />)

    fireEvent.click(screen.getByTitle('Open src/a.ts:3'))

    await waitFor(() => expect(useEditorStore.getState().activeFilePath).toBe('C:\\proj\\src\\a.ts'))
    expect(useEditorStore.getState().openFiles.map((f) => [f.path, f.content])).toEqual([['C:\\proj\\src\\a.ts', 'unsaved']])
  })

  it('opens no tab when the file cannot be read', async () => {
    readFile.mockRejectedValue(new Error('ENOENT'))
    act(() => useOutputStore.getState().appendOutput('Git', '/proj/gone.ts', 'error'))
    render(<OutputPanel />)

    fireEvent.click(screen.getByTitle('Open /proj/gone.ts'))

    await waitFor(() => expect(useToastStore.getState().toasts.length).toBe(1))
    expect(useEditorStore.getState().openFiles).toEqual([])
  })
})
