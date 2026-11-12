import type { BrowserWindow } from 'electron'
import { shell, clipboard } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { IPC } from '../../shared/ipc-channels'
import {
  readFileForEditor,
  encodeFileContent,
  writeFileBytes,
  deleteItem,
  renameItem,
  createNewFile,
  createNewDirectory,
  buildFileTree,
  detectLanguage,
} from '../filesystem/operations'
import { startWatching, stopWatching, recordKnownContent } from '../filesystem/watcher'
import { setProjectPath } from '../workspace/project-path'
import { resolveActiveWorkspacePath, resolveWorkspaceRootPath, WorkspacePathAccessError } from './workspace-path-guard'
import { grantFileAccess, isGrantedFile } from '../workspace/granted-files'
import { isSafeRevealPath } from '../../shared/path-safety'
import { handle, listen } from './typed-ipc'

/**
 * Resolve a path the editor may read or save: anything inside the active
 * workspace, or a single file the user explicitly opened from the OS.
 */
async function resolveEditableFilePath(filePath: unknown): Promise<string> {
  try {
    return await resolveActiveWorkspacePath(filePath, 'file path')
  } catch (err) {
    if (err instanceof WorkspacePathAccessError && isGrantedFile(filePath)) {
      return path.resolve(filePath)
    }
    throw err
  }
}

export function registerFilesystemHandlers(getWindow: () => BrowserWindow | null) {
  // Rejects on failure. It used to resolve with `{ content: '' }`, and since
  // every caller handles errors with try/catch, an unreadable file was opened
  // as an empty buffer that a subsequent save could write back.
  handle(IPC.FS_READ_FILE, async (_event, filePath: unknown) => {
    const safeFilePath = await resolveEditableFilePath(filePath)
    // Also rejects for binary files and text that is not UTF-8/UTF-16: showing
    // those as mangled text let a save destroy the original bytes.
    const { content, binary, bytes } = await readFileForEditor(safeFilePath)
    if (bytes) recordKnownContent(safeFilePath, bytes)
    return binary
      ? { content, language: 'plaintext', binary: true }
      : { content, language: detectLanguage(safeFilePath) }
  })

  handle(IPC.FS_WRITE_FILE, async (_event, filePath: unknown, content: unknown) => {
    try {
      if (typeof content !== 'string') {
        return { success: false, error: 'Invalid file content: expected a string' }
      }
      const safeFilePath = await resolveEditableFilePath(filePath)
      // Written in the encoding the file was opened in (BOM, UTF-16).
      const bytes = encodeFileContent(safeFilePath, content)
      recordKnownContent(safeFilePath, bytes)
      await writeFileBytes(safeFilePath, bytes)
      // Again once the bytes are on disk: a watcher event that fired mid-write
      // saw other content and dropped the record.
      recordKnownContent(safeFilePath, bytes)
      return { success: true }
    } catch (err: any) {
      console.error('Failed to write file:', err.message)
      return { success: false, error: err.message }
    }
  })

  handle(IPC.FS_DELETE, async (_event, itemPath: string) => {
    try {
      const safeItemPath = await resolveActiveWorkspacePath(itemPath, 'item path')
      await deleteItem(safeItemPath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  handle(IPC.FS_RENAME, async (_event, oldPath: string, newPath: string) => {
    try {
      const safeOldPath = await resolveActiveWorkspacePath(oldPath, 'old path')
      const safeNewPath = await resolveActiveWorkspacePath(newPath, 'new path')
      await renameItem(safeOldPath, safeNewPath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Opens or switches the active workspace root. All ordinary directory reads
  // below are then constrained to this root.
  //
  // Both listing handlers reject on failure. They used to resolve with `[]`,
  // which the renderer cannot tell from an empty folder: a dropped file was
  // accepted as a workspace, and a failed refresh emptied the explorer.
  handle(IPC.FS_OPEN_WORKSPACE, async (_event, rootPath: string) => {
    const safeRootPath = await resolveWorkspaceRootPath(rootPath)
    const tree = await buildFileTree(safeRootPath)
    setProjectPath(safeRootPath)
    return tree
  })

  // Reads a directory inside the active workspace without changing the root.
  handle(IPC.FS_READ_DIR, async (_event, dirPath: string) => {
    const safeDirPath = await resolveActiveWorkspacePath(dirPath, 'directory path')
    return buildFileTree(safeDirPath)
  })

  handle(IPC.FS_CREATE_FILE, async (_event, filePath: string, content: string = '') => {
    try {
      if (typeof content !== 'string') {
        return { success: false, error: 'Invalid file content: expected a string' }
      }
      const safeFilePath = await resolveActiveWorkspacePath(filePath, 'file path')
      // Fails if the file exists: creating must never empty an existing file.
      await createNewFile(safeFilePath, content)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  handle(IPC.FS_CREATE_DIR, async (_event, dirPath: string) => {
    try {
      const safeDirPath = await resolveActiveWorkspacePath(dirPath, 'directory path')
      await createNewDirectory(safeDirPath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  handle(IPC.FS_SEARCH, async (_event, rootPath: string, query: string, options?: { caseSensitive?: boolean; regex?: boolean }) => {
    const results: { file: string; line: number; content: string }[] = []
    const ignore = new Set(['node_modules', '.git', 'dist', 'dist-electron', '.next', '__pycache__', '.venv'])
    const maxResults = 200

    if (!query) return results

    let safeRootPath: string
    try {
      safeRootPath = await resolveActiveWorkspacePath(rootPath, 'search root')
    } catch (err: any) {
      console.warn('Refused fs:search root:', err.message)
      return results
    }

    // Construct the search pattern once, outside the recursion. The previous
    // implementation rebuilt it for every file (and used the `g` flag with
    // `.test()`, which leaks `lastIndex` between calls and forced a manual
    // reset). `.test()` doesn't need `g`, so drop it — that removes both the
    // foot-gun and ~200 allocations per scan on a medium repo.
    const flags = options?.caseSensitive ? '' : 'i'
    const pattern = options?.regex
      ? new RegExp(query, flags)
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)

    async function searchDir(dir: string) {
      if (results.length >= maxResults) return
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (results.length >= maxResults) return
          if (ignore.has(entry.name) || entry.name.startsWith('.')) continue
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            await searchDir(fullPath)
          } else {
            try {
              const content = await fs.readFile(fullPath, 'utf-8')
              const lines = content.split('\n')
              for (let i = 0; i < lines.length; i++) {
                if (pattern.test(lines[i])) {
                  results.push({ file: fullPath, line: i + 1, content: lines[i].trim().substring(0, 200) })
                  if (results.length >= maxResults) return
                }
              }
            } catch {}
          }
        }
      } catch {}
    }

    await searchDir(safeRootPath)
    return results
  })

  // Trash – attempt shell.trashItem first, fall back to rm
  handle(IPC.FS_TRASH, async (_event, itemPath: string) => {
    try {
      const safeItemPath = await resolveActiveWorkspacePath(itemPath, 'item path')
      try {
        await shell.trashItem(safeItemPath)
        return { success: true }
      } catch {
        await fs.rm(safeItemPath, { recursive: true })
        return { success: true }
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Copy path to clipboard – the path is never touched on disk, but we still
  // reject NUL / control characters so a compromised renderer can't smuggle
  // weird payloads into the user clipboard.
  handle(IPC.FS_COPY_PATH, async (_event, itemPath: string) => {
    try {
      if (!isSafeRevealPath(itemPath)) {
        return { success: false, error: 'Refused to copy path: empty or contains control characters' }
      }
      clipboard.writeText(itemPath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Duplicate a file – creates "<name> (copy).<ext>" next to original
  handle(IPC.FS_DUPLICATE, async (_event, srcPath: string) => {
    try {
      const safeSrcPath = await resolveActiveWorkspacePath(srcPath, 'source path')
      const dir = path.dirname(safeSrcPath)
      const ext = path.extname(safeSrcPath)
      const base = path.basename(safeSrcPath, ext)
      let copyPath = path.join(dir, `${base} (copy)${ext}`)
      // Avoid collisions
      let counter = 2
      while (true) {
        try {
          await fs.access(copyPath)
          copyPath = path.join(dir, `${base} (copy ${counter})${ext}`)
          counter++
        } catch {
          break // path doesn't exist, safe to use
        }
      }
      const stat = await fs.stat(safeSrcPath)
      if (stat.isDirectory()) {
        await copyDir(safeSrcPath, copyPath)
      } else {
        await fs.copyFile(safeSrcPath, copyPath)
      }
      return { success: true, newPath: copyPath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Reveal item in system file manager. showItemInFolder doesn't execute the
  // target, so a lighter NUL/control-character check (mirroring shell.ts) is
  // sufficient — applying full workspace containment would break the legit
  // case of revealing a recently-opened file that's outside the project.
  handle(IPC.FS_SHOW_ITEM, async (_event, itemPath: string) => {
    if (!isSafeRevealPath(itemPath)) {
      return { success: false, error: 'Refused to reveal path: empty or contains control characters' }
    }
    try {
      shell.showItemInFolder(itemPath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Copy a file from source to destination directory
  handle(IPC.FS_COPY_FILE, async (_event, srcPath: string, destDir: string) => {
    try {
      // The source is in the workspace, or an item the user dropped from outside it.
      const safeSrcPath = await resolveEditableFilePath(srcPath)
      const safeDestDir = await resolveActiveWorkspacePath(destDir, 'destination directory')
      const fileName = path.basename(safeSrcPath)
      let destPath = path.join(safeDestDir, fileName)
      // Avoid overwriting: if destination exists, add a suffix
      let counter = 1
      const ext = path.extname(fileName)
      const base = path.basename(fileName, ext)
      while (true) {
        try {
          await fs.access(destPath)
          counter++
          destPath = path.join(safeDestDir, `${base} (${counter})${ext}`)
        } catch {
          break // path doesn't exist, safe to use
        }
      }
      const stat = await fs.stat(safeSrcPath)
      if (stat.isDirectory()) {
        await copyDir(safeSrcPath, destPath)
      } else {
        await fs.mkdir(safeDestDir, { recursive: true })
        await fs.copyFile(safeSrcPath, destPath)
      }
      return { success: true, newPath: destPath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  listen(IPC.FS_WATCH_START, async (_event, dirPath: string) => {
    try {
      const safeDirPath = await resolveActiveWorkspacePath(dirPath, 'watch path')
      startWatching(safeDirPath, getWindow)
    } catch (err: any) {
      console.warn('Refused fs:watch-start:', err.message)
    }
  })

  listen(IPC.FS_WATCH_STOP, () => {
    stopWatching()
  })

  // Only the preload sends this, with a path Electron itself resolved from a
  // dropped File. It grants that one item, like the "Open File" dialog does.
  listen('fs:grant-dropped-path', (_event, itemPath: unknown) => {
    if (typeof itemPath === 'string') grantFileAccess(itemPath)
  })
}

/** Recursively copy a directory */
async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcChild = path.join(src, entry.name)
    const destChild = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcChild, destChild)
    } else {
      await fs.copyFile(srcChild, destChild)
    }
  }
}
