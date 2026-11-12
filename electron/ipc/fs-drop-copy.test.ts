import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const listeners = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({ shell: {}, clipboard: {} }))
vi.mock('./typed-ipc', () => ({
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
  listen: (channel: string, handler: (...args: unknown[]) => unknown) => listeners.set(channel, handler),
}))
vi.mock('../filesystem/watcher', () => ({ startWatching: () => {}, stopWatching: () => {}, recordKnownContent: () => {} }))

const { registerFilesystemHandlers } = await import('./filesystem')
const { setProjectPath } = await import('../workspace/project-path')

let tmp: string
let workspace: string
let outside: string

const copy = (src: string, destDir: string) =>
  handlers.get('fs:copy-file')!({}, src, destDir) as Promise<{ success: boolean; newPath?: string; error?: string }>
const dropped = (itemPath: string) => listeners.get('fs:grant-dropped-path')!({}, itemPath)

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orion-drop-')))
  workspace = path.join(tmp, 'workspace')
  outside = path.join(tmp, 'outside')
  fs.mkdirSync(workspace)
  fs.mkdirSync(path.join(outside, 'assets', 'icons'), { recursive: true })
  fs.writeFileSync(path.join(outside, 'assets', 'icons', 'a.svg'), '<svg/>')
  fs.writeFileSync(path.join(outside, 'notes.md'), 'notes')
  setProjectPath(workspace)
  registerFilesystemHandlers(() => null)
})

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('copying items dropped from the OS into the workspace', () => {
  it('copies a dropped folder with its contents', async () => {
    dropped(path.join(outside, 'assets'))
    const result = await copy(path.join(outside, 'assets'), workspace)
    expect(result).toMatchObject({ success: true, newPath: path.join(workspace, 'assets') })
    expect(fs.readFileSync(path.join(workspace, 'assets', 'icons', 'a.svg'), 'utf8')).toBe('<svg/>')
  })

  it('copies a dropped file', async () => {
    dropped(path.join(outside, 'notes.md'))
    await expect(copy(path.join(outside, 'notes.md'), workspace)).resolves.toMatchObject({ success: true })
    expect(fs.readFileSync(path.join(workspace, 'notes.md'), 'utf8')).toBe('notes')
  })

  it('refuses a source outside the workspace that was not dropped', async () => {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x')
    await expect(copy(path.join(outside, 'secret.txt'), workspace)).resolves.toMatchObject({ success: false })
    expect(fs.existsSync(path.join(workspace, 'secret.txt'))).toBe(false)
  })
})
