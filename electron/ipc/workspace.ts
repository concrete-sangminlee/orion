import type { IpcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { IPC } from '../../shared/ipc-channels'
import type { WorkspaceSettings } from '../../shared/types'

const SETTINGS_DIR = '.orion'
const SETTINGS_FILE = 'settings.json'

function settingsPath(rootPath: string): string {
  return path.join(rootPath, SETTINGS_DIR, SETTINGS_FILE)
}

export function registerWorkspaceHandlers(ipcMain: IpcMain) {
  ipcMain.handle(
    IPC.WORKSPACE_READ_SETTINGS,
    async (_event, rootPath: string): Promise<{ settings: WorkspaceSettings | null; error?: string }> => {
      try {
        const filePath = settingsPath(rootPath)
        const content = await fs.readFile(filePath, 'utf-8')
        const settings = JSON.parse(content) as WorkspaceSettings
        return { settings }
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          return { settings: null }
        }
        console.error('Failed to read workspace settings:', err.message)
        return { settings: null, error: err.message }
      }
    },
  )

  ipcMain.handle(
    IPC.WORKSPACE_WRITE_SETTINGS,
    async (_event, rootPath: string, settings: WorkspaceSettings): Promise<{ success: boolean; error?: string }> => {
      try {
        const dirPath = path.join(rootPath, SETTINGS_DIR)
        await fs.mkdir(dirPath, { recursive: true })
        const filePath = settingsPath(rootPath)
        await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8')
        return { success: true }
      } catch (err: any) {
        console.error('Failed to write workspace settings:', err.message)
        return { success: false, error: err.message }
      }
    },
  )
}
