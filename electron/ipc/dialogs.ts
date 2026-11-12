import { app, BrowserWindow, dialog } from 'electron'
import path from 'path'
import { createNewFile, DestinationExistsError, detectLanguage } from '../filesystem/operations'
import { grantFileAccess } from '../workspace/granted-files'
import { getProjectPath } from '../workspace/project-path'
import { handle } from './typed-ipc'

const CONTROL_CHARACTER_RE = /[\x00-\x1F\x7F]/g

/**
 * The renderer only suggests a file name. Anything that looks like a path is
 * cut down to its last segment, so it cannot steer the dialog elsewhere.
 */
export function sanitizeSuggestedName(value: unknown): string {
  if (typeof value !== 'string') return 'Untitled'
  const name = value.replace(CONTROL_CHARACTER_RE, '').split(/[\\/]/).pop()?.trim().slice(0, 255) ?? ''
  return name && name !== '.' && name !== '..' ? name : 'Untitled'
}

export function registerDialogHandlers(): void {
  // Native "Save As". The chosen path may lie outside the workspace, so it is
  // granted like a file picked in "Open File"; fs:write-file then accepts it.
  handle('fs:save-file-dialog', async (event, suggestedName: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const defaultPath = path.join(getProjectPath() ?? app.getPath('documents'), sanitizeSuggestedName(suggestedName))
    const options: Electron.SaveDialogOptions = { defaultPath }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    const filePath = result.filePath
    if (result.canceled || !filePath || !path.isAbsolute(filePath)) return null

    // A grant is pinned to the file's real path, so the file has to exist.
    // An existing file is left untouched: the save that follows overwrites it.
    try {
      await createNewFile(filePath)
    } catch (err) {
      if (!(err instanceof DestinationExistsError)) throw err
    }
    grantFileAccess(filePath)
    return { filePath, language: detectLanguage(filePath) }
  })
}
