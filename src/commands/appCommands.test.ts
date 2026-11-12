/** @vitest-environment jsdom */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { editorActions } = vi.hoisted(() => ({ editorActions: [] as string[] }))
vi.mock('./editor', () => ({
  runEditorAction: vi.fn(async (id: string) => { editorActions.push(id) }),
  runEditCommand: vi.fn(async () => {}),
}))

import { APP_COMMANDS } from './appCommands'
import { getCommand, runCommand } from './registry'
import { revertActiveFile, saveAllFiles } from './file'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'

const ROOT = path.resolve(__dirname, '../..')
const toasts = () => useToastStore.getState().notifications.map((n) => n.message)

const api = { readFile: vi.fn(), writeFile: vi.fn(), shellOpenExternal: vi.fn(), close: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as { api: typeof api }).api = api
  useToastStore.setState({ toasts: [], queuedToasts: [], notifications: [] })
})

const file = (path: string, content: string, isModified = false) => ({
  path, name: path.split('/').pop()!, content, language: 'typescript', isModified, aiModified: false,
})

describe('APP_COMMANDS', () => {
  it('registers every command once, with a title', () => {
    const ids = APP_COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const command of APP_COMMANDS) {
      expect(getCommand(command.id)).toBe(command)
      expect(command.title.trim()).not.toBe('')
    }
  })

  it('runs only editor actions that exist (Monaco built-ins or ones EditorPanel adds)', async () => {
    const commands = APP_COMMANDS.filter((c) => /^(editor|selection|go|ai)\./.test(c.id))
    vi.spyOn(window, 'dispatchEvent').mockReturnValue(true)
    for (const command of commands) await command.run()
    vi.mocked(window.dispatchEvent).mockRestore()
    expect(editorActions.length).toBeGreaterThan(10)

    const monacoSources = path.join(ROOT, 'node_modules/monaco-editor/esm/vs/editor')
    const appSources = ['src/panels/EditorPanel.tsx', 'src/utils/inlineEdit.ts'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
    const monacoText = fs
      .readdirSync(monacoSources, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(monacoSources, f), 'utf8'))
      .join('\n')
    const missing = editorActions.filter((id) => !monacoText.includes(`id: '${id}'`) && !monacoText.includes(`'${id}'`) && !appSources.includes(`id: '${id}'`))
    expect(missing).toEqual([])
  })

  it('shows a command that fails instead of swallowing it', async () => {
    api.shellOpenExternal.mockRejectedValue(new Error('blocked'))
    runCommand('help.reportIssue')
    await vi.waitFor(() => expect(toasts()).toContain('Report Issue failed: blocked'))
  })
})

describe('Revert File', () => {
  it('replaces the buffer with the file on disk', async () => {
    useEditorStore.setState({ openFiles: [file('/ws/a.ts', 'edited', true)], activeFilePath: '/ws/a.ts' })
    api.readFile.mockResolvedValue({ content: 'on disk', language: 'typescript' })
    await revertActiveFile()
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({ content: 'on disk', isModified: false })
  })

  it('keeps the buffer and says why when the file cannot be read', async () => {
    useEditorStore.setState({ openFiles: [file('/ws/a.ts', 'edited', true)], activeFilePath: '/ws/a.ts' })
    api.readFile.mockRejectedValue(new Error("Error invoking remote method 'fs:read-file': Error: ENOENT"))
    await revertActiveFile()
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({ content: 'edited', isModified: true })
    expect(toasts()).toEqual(['Could not revert a.ts: ENOENT'])
  })

  it('has nothing to revert an untitled buffer to', async () => {
    useEditorStore.setState({ openFiles: [file('untitled-1', 'draft', true)], activeFilePath: 'untitled-1' })
    await revertActiveFile()
    expect(api.readFile).not.toHaveBeenCalled()
    expect(useEditorStore.getState().openFiles[0].content).toBe('draft')
  })
})

describe('Save All', () => {
  it('writes every modified file and leaves untitled buffers for Save As', async () => {
    useEditorStore.setState({
      openFiles: [file('/ws/a.ts', 'A', true), file('/ws/b.ts', 'B'), file('untitled-2', 'U', true)],
      activeFilePath: '/ws/a.ts',
    })
    api.writeFile.mockResolvedValue({ success: true })
    await saveAllFiles()
    expect(api.writeFile.mock.calls).toEqual([['/ws/a.ts', 'A']])
    expect(useEditorStore.getState().openFiles.find((f) => f.path === '/ws/a.ts')?.isModified).toBe(false)
    expect(toasts()).toEqual(['1 untitled file(s) need Save As', 'Saved 1 file(s)'])
  })

  it('writes what the buffers hold when their turn comes, and keeps edits typed meanwhile unsaved', async () => {
    useEditorStore.setState({
      openFiles: [file('/ws/a.ts', 'A', true), file('/ws/b.ts', 'B', true)],
      activeFilePath: '/ws/a.ts',
    })
    // The user keeps typing in both files while a.ts is being written.
    api.writeFile.mockImplementation(async (path: string) => {
      if (path === '/ws/a.ts') {
        useEditorStore.getState().updateFileContent('/ws/a.ts', 'A2')
        useEditorStore.getState().updateFileContent('/ws/b.ts', 'B2')
      }
      return { success: true }
    })
    await saveAllFiles()
    expect(api.writeFile.mock.calls).toEqual([['/ws/a.ts', 'A'], ['/ws/b.ts', 'B2']])
    const state = (path: string) => useEditorStore.getState().openFiles.find((f) => f.path === path)
    // a.ts on disk is "A": its buffer must still show as modified, or "A2" is never saved.
    expect(state('/ws/a.ts')).toMatchObject({ content: 'A2', isModified: true })
    expect(state('/ws/b.ts')).toMatchObject({ content: 'B2', isModified: false })
  })
})
