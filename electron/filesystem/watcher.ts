import chokidar, { type FSWatcher } from 'chokidar'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { emit } from '../ipc/typed-ipc'

let watcher: FSWatcher | null = null

// Debounce map for external file change notifications
const pendingChanges = new Map<string, { type: string; timer: ReturnType<typeof setTimeout> }>()
const DEBOUNCE_MS = 500

// Set of file paths that the app itself recently wrote (to suppress self-triggered events)
const recentWrites = new Set<string>()

export function markRecentWrite(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/')
  recentWrites.add(normalized)
  setTimeout(() => recentWrites.delete(normalized), 1500)
}

function sendDebouncedChange(
  filePath: string,
  changeType: 'change' | 'delete' | 'add',
  getWindow: () => BrowserWindow | null
) {
  const normalized = filePath.replace(/\\/g, '/')

  // Skip if this was a self-triggered write
  if (recentWrites.has(normalized)) {
    return
  }

  // Clear any pending debounce for this path
  const pending = pendingChanges.get(normalized)
  if (pending) {
    clearTimeout(pending.timer)
  }

  const timer = setTimeout(() => {
    pendingChanges.delete(normalized)
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      emit(win, IPC.FS_EXTERNAL_CHANGE, { path: normalized, type: changeType })
    }
  }, DEBOUNCE_MS)

  pendingChanges.set(normalized, { type: changeType, timer })
}

export function startWatching(dirPath: string, getWindow: () => BrowserWindow | null) {
  stopWatching()

  watcher = chokidar.watch(dirPath, {
    ignored: /(node_modules|\.git|dist|dist-electron|\.superpowers)/,
    persistent: true,
    ignoreInitial: true,
  })

  watcher
    .on('add', (filePath: string) => {
      emit(getWindow(), IPC.FS_CHANGE, 'add', filePath)
      sendDebouncedChange(filePath, 'add', getWindow)
    })
    .on('change', (filePath: string) => {
      emit(getWindow(), IPC.FS_CHANGE, 'change', filePath)
      sendDebouncedChange(filePath, 'change', getWindow)
    })
    .on('unlink', (filePath: string) => {
      emit(getWindow(), IPC.FS_CHANGE, 'unlink', filePath)
      sendDebouncedChange(filePath, 'delete', getWindow)
    })
    .on('addDir', (filePath: string) => emit(getWindow(), IPC.FS_CHANGE, 'addDir', filePath))
    .on('unlinkDir', (filePath: string) => emit(getWindow(), IPC.FS_CHANGE, 'unlinkDir', filePath))
}

export function stopWatching() {
  if (watcher) {
    watcher.close()
    watcher = null
  }
  // Clear all pending debounce timers
  for (const { timer } of pendingChanges.values()) {
    clearTimeout(timer)
  }
  pendingChanges.clear()
}
