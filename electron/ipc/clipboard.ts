import { clipboard } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { validateClipboardText } from './clipboard-guard'
import { handle } from './typed-ipc'

// Electron 44 made the main-process clipboard asynchronous (the W3C Clipboard
// API): readText and writeText return promises.
export function registerClipboardHandlers() {
  handle(IPC.CLIPBOARD_READ_TEXT, async () => {
    try {
      return { success: true, text: await clipboard.readText() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  handle(IPC.CLIPBOARD_WRITE_TEXT, async (_event, text: string) => {
    try {
      await clipboard.writeText(validateClipboardText(text))
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
