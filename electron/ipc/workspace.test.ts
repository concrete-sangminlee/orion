import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('./typed-ipc', () => ({
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
}))

const { registerWorkspaceHandlers, parseWorkspaceSettings } = await import('./workspace')
const { setProjectPath } = await import('../workspace/project-path')

let root: string
const settingsFile = () => path.join(root, '.orion', 'settings.json')
const read = () => handlers.get('workspace:read-settings')!({}, root) as Promise<{ settings: unknown; error?: string }>
const write = (settings: unknown) => handlers.get('workspace:write-settings')!({}, root, settings) as Promise<{ success: boolean; error?: string }>

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orion-ws-settings-')))
  setProjectPath(root)
  registerWorkspaceHandlers()
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

beforeEach(() => fs.rmSync(path.join(root, '.orion'), { recursive: true, force: true }))

describe('workspace settings file', () => {
  it('reads a file saved with a UTF-8 byte-order mark', async () => {
    fs.mkdirSync(path.join(root, '.orion'))
    fs.writeFileSync(settingsFile(), '﻿{ "tabSize": 4 }')
    await expect(read()).resolves.toEqual({ settings: { tabSize: 4 } })
  })

  it('never overwrites a file it cannot read back as settings', async () => {
    fs.mkdirSync(path.join(root, '.orion'))
    const handEdited = '{\n  // my notes\n  "tabSize": 4,\n}\n'
    fs.writeFileSync(settingsFile(), handEdited)

    await expect(read()).resolves.toMatchObject({ settings: null, error: expect.stringContaining('not valid JSON') })
    await expect(write({ tabSize: 2 })).resolves.toMatchObject({ success: false, error: expect.stringContaining('Not overwritten') })
    expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(handEdited)
  })

  it('writes a new file, and replaces one that holds valid settings', async () => {
    await expect(write({ tabSize: 2 })).resolves.toEqual({ success: true })
    await expect(write({ tabSize: 8 })).resolves.toEqual({ success: true })
    expect(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))).toEqual({ tabSize: 8 })
  })

  it('reports a top-level value that is not an object', () => {
    expect(parseWorkspaceSettings('[1, 2]')).toEqual({ error: 'Workspace settings must be a JSON object' })
    expect(parseWorkspaceSettings('null')).toEqual({ error: 'Workspace settings must be a JSON object' })
  })
})
