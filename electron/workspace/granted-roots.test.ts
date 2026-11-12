import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { grantWorkspaceRoot, initGrantedRoots, isGrantedWorkspaceRoot, resetGrantedRoots } from './granted-roots'

let dir: string
let store: string

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orion-roots-')))
  fs.mkdirSync(path.join(dir, 'project'))
  fs.mkdirSync(path.join(dir, 'other'))
  fs.writeFileSync(path.join(dir, 'file.txt'), '')
  store = path.join(dir, 'user-data', 'granted-roots.json')
  initGrantedRoots(store)
})

afterEach(() => {
  resetGrantedRoots()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('granted workspace roots', () => {
  it('only folders the main process granted can be opened as a workspace', () => {
    expect(isGrantedWorkspaceRoot(path.join(dir, 'project'))).toBe(false)
    expect(grantWorkspaceRoot(path.join(dir, 'project'))).toBe(true)
    expect(isGrantedWorkspaceRoot(path.join(dir, 'project'))).toBe(true)
    expect(isGrantedWorkspaceRoot(path.join(dir, 'project', '..', 'project'))).toBe(true)
    expect(isGrantedWorkspaceRoot(path.join(dir, 'other'))).toBe(false)
    // A granted folder does not grant its parent.
    expect(isGrantedWorkspaceRoot(dir)).toBe(false)
  })

  it('grants nothing for files, missing paths, relative paths or bad input', () => {
    for (const candidate of [path.join(dir, 'file.txt'), path.join(dir, 'missing'), 'project', '', 42, null, `${dir}\0x`]) {
      expect(grantWorkspaceRoot(candidate)).toBe(false)
    }
    expect(fs.existsSync(store)).toBe(false)
  })

  it('follows the real path, so a symlink retargeted later is not trusted', () => {
    const link = path.join(dir, 'link')
    fs.symlinkSync(path.join(dir, 'project'), link)
    grantWorkspaceRoot(link)
    fs.unlinkSync(link)
    fs.symlinkSync(path.join(dir, 'other'), link)
    expect(isGrantedWorkspaceRoot(link)).toBe(false)
    expect(isGrantedWorkspaceRoot(path.join(dir, 'project'))).toBe(true)
  })

  it('remembers grants across restarts', () => {
    grantWorkspaceRoot(path.join(dir, 'project'))
    resetGrantedRoots()
    expect(isGrantedWorkspaceRoot(path.join(dir, 'project'))).toBe(false)
    initGrantedRoots(store)
    expect(isGrantedWorkspaceRoot(path.join(dir, 'project'))).toBe(true)
  })

  it('ignores a corrupt store', () => {
    fs.mkdirSync(path.dirname(store), { recursive: true })
    fs.writeFileSync(store, '{"not": "a list"')
    initGrantedRoots(store)
    expect(isGrantedWorkspaceRoot(path.join(dir, 'project'))).toBe(false)
    expect(grantWorkspaceRoot(path.join(dir, 'project'))).toBe(true)
  })
})
