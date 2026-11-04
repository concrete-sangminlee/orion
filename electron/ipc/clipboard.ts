import { clipboard } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { validateClipboardImageSize, validateClipboardPngBuffer, validateClipboardText } from './clipboard-guard'
import { handle } from './typed-ipc'

export function registerClipboardHandlers() {
  // clipboard:read-text - read text from clipboard
  handle(IPC.CLIPBOARD_READ_TEXT, async () => {
    try {
      const text = clipboard.readText()
      return { success: true, text }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // clipboard:write-text - write text to clipboard
  handle(IPC.CLIPBOARD_WRITE_TEXT, async (_event, text: string) => {
    try {
      const safeText = validateClipboardText(text)
      clipboard.writeText(safeText)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // clipboard:read-image - read image from clipboard as base64 PNG
  handle(IPC.CLIPBOARD_READ_IMAGE, async () => {
    try {
      const image = clipboard.readImage()
      if (image.isEmpty()) {
        return { success: true, data: null }
      }
      validateClipboardImageSize(image.getSize())
      const pngBuffer = validateClipboardPngBuffer(image.toPNG())
      const base64 = pngBuffer.toString('base64')
      return { success: true, data: base64 }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
