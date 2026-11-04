/**
 * Proves the main process registers every contract channel exactly once.
 *
 * electron/main.ts has import-time side effects (app lifecycle), so instead of
 * executing the registration code this scans the main-process sources for the
 * typed `handle()` / `listen()` / `emit()` helpers. Those helpers only accept
 * contract channels, so a literal or `IPC.*` first argument is guaranteed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { IPC, IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS, IPC_SEND_CHANNELS } from '../../shared/ipc-channels'

const ELECTRON_DIR = path.resolve(__dirname, '..')

function mainProcessSources(): Array<{ file: string; source: string }> {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) files.push(full)
    }
  }
  walk(ELECTRON_DIR)
  return files
    .filter((file) => !file.endsWith(`${path.sep}typed-ipc.ts`) && !/preload(-api)?\.ts$/.test(file))
    .map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }))
}

const CHANNEL_ARG = String.raw`(IPC\.[A-Z_]+|'[^']+')`

function resolveChannel(token: string): string {
  if (token.startsWith('IPC.')) {
    const key = token.slice(4) as keyof typeof IPC
    const value = IPC[key]
    if (!value) throw new Error(`Unknown IPC constant ${token}`)
    return value
  }
  return token.slice(1, -1)
}

function collect(pattern: RegExp): string[] {
  const channels: string[] = []
  for (const { source } of mainProcessSources()) {
    for (const match of source.matchAll(pattern)) channels.push(resolveChannel(match[1]))
  }
  return channels
}

const sorted = (values: readonly string[]) => [...values].sort()

describe('main-process IPC registration', () => {
  const handled = collect(new RegExp(String.raw`(?<![\w.])handle\(\s*${CHANNEL_ARG}`, 'g'))
  const listened = collect(new RegExp(String.raw`(?<![\w.])listen\(\s*${CHANNEL_ARG}`, 'g'))
  const emitted = collect(new RegExp(String.raw`(?<![\w.])emit\(\s*[^,()]+(?:\([^)]*\))?,\s*${CHANNEL_ARG}`, 'g'))

  it('registers a handler for every invoke channel, and only those', () => {
    expect(sorted([...new Set(handled)])).toEqual(sorted(IPC_INVOKE_CHANNELS))
  })

  it('never registers the same invoke channel twice (ipcMain.handle would throw)', () => {
    const duplicates = handled.filter((channel, index) => handled.indexOf(channel) !== index)
    expect(duplicates).toEqual([])
  })

  it('listens on every send channel, and only those', () => {
    expect(sorted([...new Set(listened)])).toEqual(sorted(IPC_SEND_CHANNELS))
  })

  it('emits every event channel the preload lets the renderer subscribe to', () => {
    expect(sorted([...new Set(emitted)])).toEqual(sorted(IPC_EVENT_CHANNELS))
  })

  it('does not bypass the typed helpers with raw ipcMain / webContents.send', () => {
    const offenders = mainProcessSources()
      .filter(({ source }) => /\bipcMain\.(handle|on|once)\(|\.webContents\.send\(/.test(source))
      .map(({ file }) => path.relative(ELECTRON_DIR, file))
    expect(offenders).toEqual([])
  })
})
