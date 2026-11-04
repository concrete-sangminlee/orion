import { shell } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { isSafeExternalUrl } from '../../shared/url-safety'
import { isSafeOpenPath, isSafeRevealPath } from '../../shared/path-safety'
import { handle } from './typed-ipc'

export function registerShellHandlers() {
  // shell:open-external - open URL in default browser
  handle(IPC.SHELL_OPEN_EXTERNAL, async (_event, url: string) => {
    if (!isSafeExternalUrl(url)) {
      return { success: false, error: 'Refused to open URL: protocol not in allowlist (http, https, mailto, tel)' }
    }
    try {
      await shell.openExternal(url)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // shell:show-item-in-folder - open file manager and select the file
  handle(IPC.SHELL_SHOW_ITEM_IN_FOLDER, async (_event, filePath: string) => {
    if (!isSafeRevealPath(filePath)) {
      return { success: false, error: 'Refused to reveal path: empty or contains control characters' }
    }
    try {
      shell.showItemInFolder(filePath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // shell:open-path - open file with default system application
  handle(IPC.SHELL_OPEN_PATH, async (_event, filePath: string) => {
    if (!isSafeOpenPath(filePath)) {
      return { success: false, error: 'Refused to open path: executable or script extensions are blocked' }
    }
    try {
      const errorMessage = await shell.openPath(filePath)
      if (errorMessage) {
        return { success: false, error: errorMessage }
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
