import chokidar, { type FSWatcher } from 'chokidar'
import type { BrowserWindow } from 'electron'
import fs from 'fs/promises'
import { IPC } from '../../shared/ipc-channels'
import { emit } from '../ipc/typed-ipc'
import { isIgnoredWatchPath, OwnWriteTracker } from './watch-rules'

let watcher: FSWatcher | null = null

// Debounce map for external file change notifications
const pendingChanges = new Map<string, { type: string; timer: ReturnType<typeof setTimeout> }>()
const DEBOUNCE_MS = 500

// What the app itself last wrote to each file, so its own saves are not
// reported back as external changes (compared by content, not by time).
const ownWrites = new OwnWriteTracker()

export function recordOwnWrite(filePath: string, content: string) {
  ownWrites.record(filePath, content)
}

function sendDebouncedChange(
  filePath: string,
  changeType: 'change' | 'delete' | 'add',
  getWindow: () => BrowserWindow | null
) {
  const normalized = filePath.replace(/\\/g, '/')

  // Clear any pending debounce for this path
  const pending = pendingChanges.get(normalized)
  if (pending) {
    clearTimeout(pending.timer)
  }

  const timer = setTimeout(async () => {
    pendingChanges.delete(normalized)
    if (changeType !== 'delete') {
      try {
        // The file now holds exactly what the app saved: our own write.
        if (ownWrites.isOwnWrite(filePath, await fs.readFile(filePath))) return
      } catch {
        // Unreadable (e.g. removed meanwhile): report the change.
      }
    } else {
      ownWrites.forget(filePath)
    }
    emit(getWindow(), IPC.FS_EXTERNAL_CHANGE, { path: normalized, type: changeType })
  }, DEBOUNCE_MS)

  pendingChanges.set(normalized, { type: changeType, timer })
}

export function startWatching(dirPath: string, getWindow: () => BrowserWindow | null) {
  stopWatching()

  watcher = chokidar.watch(dirPath, {
    ignored: (candidate: string) => isIgnoredWatchPath(dirPath, candidate),
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
