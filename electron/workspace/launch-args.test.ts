import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { itemsFromArgs } from './launch-args'

let dir: string

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orion-args-')))
  for (const name of ['notes.txt', 'query.sql', '.env', 'Makefile', 'app.ts']) fs.writeFileSync(path.join(dir, name), '')
  fs.mkdirSync(path.join(dir, 'project'))
})

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('itemsFromArgs', () => {
  it('accepts any existing file, including ones without an extension', () => {
    const argv = ['/opt/orion/orion-ide', 'notes.txt', 'query.sql', '.env', 'Makefile', 'app.ts']
    expect(itemsFromArgs(argv, dir).files).toEqual(['notes.txt', 'query.sql', '.env', 'Makefile', 'app.ts'].map((name) => path.join(dir, name)))
  })

  it('resolves relative paths against the directory the command ran in', () => {
    // A second launch from another folder: its cwd, not ours.
    expect(itemsFromArgs(['orion-ide', 'app.ts'], dir).files).toEqual([path.join(dir, 'app.ts')])
    expect(itemsFromArgs(['orion-ide', 'app.ts'], os.tmpdir()).files).toEqual([])
  })

  it('returns folders separately and skips flags, the executable and missing paths', () => {
    const argv = [path.join(dir, 'project'), '--no-sandbox', 'project', 'missing.ts', '']
    expect(itemsFromArgs(argv, dir)).toEqual({ files: [], folders: [path.join(dir, 'project')] })
  })

  it('skips the app directory in development even when flags come before it', () => {
    // `electron --inspect=0 <app> <folder>`, as test runners launch it.
    fs.mkdirSync(path.join(dir, 'app'))
    const argv = ['electron', '--inspect=0', '--remote-debugging-port=0', path.join(dir, 'app'), 'project']
    expect(itemsFromArgs(argv, dir, path.join(dir, 'app')).folders).toEqual([path.join(dir, 'project')])
  })
})
