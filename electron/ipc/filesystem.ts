import type { IpcMain, BrowserWindow } from 'electron'
import { shell, clipboard } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { IPC } from '../../shared/ipc-channels'
import { readFileContent, writeFileContent, deleteItem, renameItem, buildFileTree, detectLanguage } from '../filesystem/operations'
import { startWatching, stopWatching } from '../filesystem/watcher'
import { setProjectPath } from '../terminal/manager'

export function registerFilesystemHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null) {
  ipcMain.handle(IPC.FS_READ_FILE, async (_event, filePath: string) => {
    try {
      const content = await readFileContent(filePath)
      const language = detectLanguage(filePath)
      return { content, language }
    } catch (err: any) {
      console.error('Failed to read file:', err.message)
      return { content: '', language: 'plaintext', error: err.message }
    }
  })

  ipcMain.handle(IPC.FS_WRITE_FILE, async (_event, filePath: string, content: string) => {
    try {
      await writeFileContent(filePath, content)
      return { success: true }
    } catch (err: any) {
      console.error('Failed to write file:', err.message)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(IPC.FS_DELETE, async (_event, itemPath: string) => {
    try {
      await deleteItem(itemPath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(IPC.FS_RENAME, async (_event, oldPath: string, newPath: string) => {
    try {
      await renameItem(oldPath, newPath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(IPC.FS_READ_DIR, async (_event, dirPath: string) => {
    try {
      setProjectPath(dirPath)
      return await buildFileTree(dirPath)
    } catch (err: any) {
      console.error('Failed to read dir:', err.message)
      return []
    }
  })

  ipcMain.handle(IPC.FS_CREATE_FILE, async (_event, filePath: string, content: string = '') => {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content, 'utf-8')
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(IPC.FS_CREATE_DIR, async (_event, dirPath: string) => {
    try {
      await fs.mkdir(dirPath, { recursive: true })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(IPC.FS_SEARCH, async (_event, rootPath: string, query: string, options?: { caseSensitive?: boolean; regex?: boolean }) => {
    const results: { file: string; line: number; content: string }[] = []
    const ignore = new Set(['node_modules', '.git', 'dist', 'dist-electron', '.next', '__pycache__', '.venv'])
    const maxResults = 200

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
              const flags = options?.caseSensitive ? 'g' : 'gi'
              const pattern = options?.regex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
              for (let i = 0; i < lines.length; i++) {
                if (pattern.test(lines[i])) {
                  results.push({ file: fullPath, line: i + 1, content: lines[i].trim().substring(0, 200) })
                  if (results.length >= maxResults) return
                }
                pattern.lastIndex = 0
              }
            } catch {}
          }
        }
      } catch {}
    }

    await searchDir(rootPath)
    return results
  })

  // Trash – attempt shell.trashItem first, fall back to rm
  ipcMain.handle(IPC.FS_TRASH, async (_event, itemPath: string) => {
    try {
      await shell.trashItem(itemPath)
      return { success: true }
    } catch {
      try {
        await fs.rm(itemPath, { recursive: true })
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  })

  // Copy path to clipboard
  ipcMain.handle(IPC.FS_COPY_PATH, async (_event, itemPath: string) => {
    try {
      clipboard.writeText(itemPath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Duplicate a file – creates "<name> (copy).<ext>" next to original
  ipcMain.handle(IPC.FS_DUPLICATE, async (_event, srcPath: string) => {
    try {
      const dir = path.dirname(srcPath)
      const ext = path.extname(srcPath)
      const base = path.basename(srcPath, ext)
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
      const stat = await fs.stat(srcPath)
      if (stat.isDirectory()) {
        await copyDir(srcPath, copyPath)
      } else {
        await fs.copyFile(srcPath, copyPath)
      }
      return { success: true, newPath: copyPath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.on(IPC.FS_WATCH_START, (_event, dirPath: string) => {
    startWatching(dirPath, getWindow)
  })

  ipcMain.on(IPC.FS_WATCH_STOP, () => {
    stopWatching()
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
