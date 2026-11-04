import fs from 'fs/promises'
import path from 'path'
import { IPC } from '../../shared/ipc-channels'
import type { WorkspaceSettingsFile } from '../../shared/ipc-contract'
import { resolveActiveWorkspacePath } from './workspace-path-guard'
import { handle } from './typed-ipc'

const SETTINGS_DIR = '.orion'
const SETTINGS_FILE = 'settings.json'

function settingsPath(rootPath: string): string {
  return path.join(rootPath, SETTINGS_DIR, SETTINGS_FILE)
}

export function registerWorkspaceHandlers() {
  handle(
    IPC.WORKSPACE_READ_SETTINGS,
    async (_event, rootPath: string): Promise<{ settings: WorkspaceSettingsFile | null; error?: string }> => {
      let safeRootPath: string
      try {
        safeRootPath = await resolveActiveWorkspacePath(rootPath, 'workspace settings root')
      } catch (err: any) {
        console.warn('Refused workspace:read-settings:', err.message)
        return { settings: null, error: err.message }
      }
      try {
        const filePath = settingsPath(safeRootPath)
        const content = await fs.readFile(filePath, 'utf-8')
        const parsed: unknown = JSON.parse(content)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { settings: null, error: 'Workspace settings must be a JSON object' }
        }
        const settings = parsed as WorkspaceSettingsFile
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

  handle(
    IPC.WORKSPACE_WRITE_SETTINGS,
    async (_event, rootPath: string, settings: unknown): Promise<{ success: boolean; error?: string }> => {
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return { success: false, error: 'Workspace settings must be an object' }
      }
      let safeRootPath: string
      try {
        safeRootPath = await resolveActiveWorkspacePath(rootPath, 'workspace settings root')
      } catch (err: any) {
        console.warn('Refused workspace:write-settings:', err.message)
        return { success: false, error: err.message }
      }
      try {
        const dirPath = path.join(safeRootPath, SETTINGS_DIR)
        await fs.mkdir(dirPath, { recursive: true })
        const filePath = settingsPath(safeRootPath)
        await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8')
        return { success: true }
      } catch (err: any) {
        console.error('Failed to write workspace settings:', err.message)
        return { success: false, error: err.message }
      }
    },
  )
}
