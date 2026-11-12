import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const showSaveDialog = vi.fn()
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: () => '/home/me/Documents' },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) },
}))

vi.mock('./typed-ipc', () => ({
  handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, handler),
}))

const { registerDialogHandlers, sanitizeSuggestedName } = await import('./dialogs')
const { clearGrantedFiles, isGrantedFile } = await import('../workspace/granted-files')
const { setProjectPath } = await import('../workspace/project-path')

registerDialogHandlers()
const saveFileDialog = (suggestedName?: unknown) =>
  handlers.get('fs:save-file-dialog')!({ sender: {} }, suggestedName) as Promise<{ filePath: string; language: string } | null>

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-save-dialog-'))
  setProjectPath('/workspace')
  showSaveDialog.mockReset()
  clearGrantedFiles()
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('fs:save-file-dialog', () => {
  it('lets the renderer save to the chosen file, even outside the workspace', async () => {
    const chosen = path.join(dir, 'notes.ts')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: chosen })

    expect(await saveFileDialog('Untitled-1')).toEqual({ filePath: chosen, language: 'typescript' })
    expect(isGrantedFile(chosen)).toBe(true)
    expect(fs.readFileSync(chosen, 'utf8')).toBe('')
  })

  it('never truncates an existing file it is asked to overwrite', async () => {
    const chosen = path.join(dir, 'keep.md')
    fs.writeFileSync(chosen, 'original')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: chosen })

    expect(await saveFileDialog('keep.md')).toEqual({ filePath: chosen, language: 'markdown' })
    expect(fs.readFileSync(chosen, 'utf8')).toBe('original')
    expect(isGrantedFile(chosen)).toBe(true)
  })

  it('grants nothing when the dialog is cancelled', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    expect(await saveFileDialog('a.ts')).toBeNull()

    showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'relative/a.ts' })
    expect(await saveFileDialog('a.ts')).toBeNull()
  })

  it('opens in the workspace with only the suggested file name', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true })
    await saveFileDialog('../../etc/passwd')
    expect(showSaveDialog).toHaveBeenCalledWith({ defaultPath: path.join('/workspace', 'passwd') })
  })
})

describe('sanitizeSuggestedName', () => {
  it('keeps a plain file name and falls back for anything unusable', () => {
    expect(sanitizeSuggestedName('report.md')).toBe('report.md')
    expect(sanitizeSuggestedName('C:\\Users\\x\\a.ts')).toBe('a.ts')
    expect(sanitizeSuggestedName('bad\u0000name')).toBe('badname')
    expect(sanitizeSuggestedName('..')).toBe('Untitled')
    expect(sanitizeSuggestedName('dir/')).toBe('Untitled')
    expect(sanitizeSuggestedName(42)).toBe('Untitled')
  })
})
