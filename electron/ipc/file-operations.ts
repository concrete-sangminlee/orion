import type { BrowserWindow } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import { IPC } from '../../shared/ipc-channels'
import { resolveActiveWorkspacePath, WorkspacePathAccessError } from './workspace-path-guard'
import { handle, emit } from './typed-ipc'
import { copyItem, renameItem } from '../filesystem/operations'

// Track per-path watchers for file:watch
const fileWatchers = new Map<string, FSWatcher>()
const FILE_WATCH_KINDS = ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const

/** Close every file:watch watcher (also used when the workspace changes). */
export async function closeAllFileWatchers(): Promise<void> {
  const watchers = [...fileWatchers.values()]
  fileWatchers.clear()
  await Promise.allSettled(watchers.map((watcher) => watcher.close()))
}

export function registerFileOperationHandlers(getWindow: () => BrowserWindow | null) {
  // file:rename - rename/move a file or directory
  handle(IPC.FILE_RENAME, async (_event, oldPath: string, newPath: string) => {
    try {
      const safeOldPath = await resolveActiveWorkspacePath(oldPath, 'old path')
      const safeNewPath = await resolveActiveWorkspacePath(newPath, 'new path')
      await renameItem(safeOldPath, safeNewPath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // file:copy - copy a file from sourcePath to destPath
  handle(IPC.FILE_COPY, async (_event, sourcePath: string, destPath: string) => {
    try {
      const safeSourcePath = await resolveActiveWorkspacePath(sourcePath, 'source path')
      const safeDestPath = await resolveActiveWorkspacePath(destPath, 'destination path')
      // Files and directories alike; refuses to copy over something that exists.
      await copyItem(safeSourcePath, safeDestPath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // file:move - move a file from sourcePath to destPath
  handle(IPC.FILE_MOVE, async (_event, sourcePath: string, destPath: string) => {
    try {
      const safeSourcePath = await resolveActiveWorkspacePath(sourcePath, 'source path')
      const safeDestPath = await resolveActiveWorkspacePath(destPath, 'destination path')
      await renameItem(safeSourcePath, safeDestPath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // file:stat - get file stats
  handle(IPC.FILE_STAT, async (_event, filePath: string) => {
    try {
      const safeFilePath = await resolveActiveWorkspacePath(filePath, 'file path')
      const stat = await fs.stat(safeFilePath)
      return {
        success: true,
        stat: {
          size: stat.size,
          created: stat.birthtime.toISOString(),
          modified: stat.mtime.toISOString(),
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          isSymbolicLink: stat.isSymbolicLink(),
        },
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // file:exists - check if path exists
  handle(IPC.FILE_EXISTS, async (_event, filePath: string) => {
    try {
      const safeFilePath = await resolveActiveWorkspacePath(filePath, 'file path')
      await fs.access(safeFilePath)
      return true
    } catch (err: any) {
      if (err instanceof WorkspacePathAccessError) {
        console.warn(`Refused file existence check: ${err.message}`)
      }
      return false
    }
  })

  // file:create-directory - recursively create directory
  handle(IPC.FILE_CREATE_DIRECTORY, async (_event, dirPath: string) => {
    try {
      const safeDirPath = await resolveActiveWorkspacePath(dirPath, 'directory path')
      await fs.mkdir(safeDirPath, { recursive: true })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // file:delete-directory - recursively delete directory
  handle(IPC.FILE_DELETE_DIRECTORY, async (_event, dirPath: string) => {
    try {
      const safeDirPath = await resolveActiveWorkspacePath(dirPath, 'directory path')
      await fs.rm(safeDirPath, { recursive: true, force: true })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // file:watch - watch a path for changes and send events to renderer
  handle(IPC.FILE_WATCH, async (_event, watchPath: unknown) => {
    try {
      const safeWatchPath = await resolveActiveWorkspacePath(watchPath, 'watch path')

      // Stop any existing watcher on this path
      const existing = fileWatchers.get(safeWatchPath)
      if (existing) {
        await existing.close()
        fileWatchers.delete(safeWatchPath)
      }

      const watcher = chokidar.watch(safeWatchPath, {
        persistent: true,
        ignoreInitial: true,
      })

      for (const kind of FILE_WATCH_KINDS) {
        watcher.on(kind, (filePath: string) => {
          emit(getWindow(), IPC.FILE_WATCH_EVENT, { watchPath: safeWatchPath, event: kind, path: filePath })
        })
      }

      fileWatchers.set(safeWatchPath, watcher)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  handle(IPC.FILE_UNWATCH, async (_event, watchPath: unknown) => {
    try {
      const safeWatchPath = await resolveActiveWorkspacePath(watchPath, 'watch path')
      const watcher = fileWatchers.get(safeWatchPath)
      if (watcher) {
        fileWatchers.delete(safeWatchPath)
        await watcher.close()
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  handle(IPC.FILE_UNWATCH_ALL, async () => {
    await closeAllFileWatchers()
    return { success: true }
  })

  // file:read-binary - read file as base64 (for images, etc.)
  handle(IPC.FILE_READ_BINARY, async (_event, filePath: string) => {
    try {
      const safeFilePath = await resolveActiveWorkspacePath(filePath, 'file path')
      const buffer = await fs.readFile(safeFilePath)
      return { success: true, data: buffer.toString('base64') }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
