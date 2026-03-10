import type { IpcMain, BrowserWindow } from 'electron'
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

  ipcMain.on(IPC.FS_WATCH_START, (_event, dirPath: string) => {
    startWatching(dirPath, getWindow)
  })

  ipcMain.on(IPC.FS_WATCH_STOP, () => {
    stopWatching()
  })
}
