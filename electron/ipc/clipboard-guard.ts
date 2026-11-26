export const MAX_CLIPBOARD_TEXT_BYTES = 5 * 1024 * 1024

export class UnsafeClipboardPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeClipboardPayloadError'
  }
}

export function validateClipboardText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new UnsafeClipboardPayloadError('Clipboard text must be a string')
  }

  const byteLength = Buffer.byteLength(value, 'utf8')
  if (byteLength > MAX_CLIPBOARD_TEXT_BYTES) {
    throw new UnsafeClipboardPayloadError(`Clipboard text exceeds ${MAX_CLIPBOARD_TEXT_BYTES} bytes`)
  }

  return value
}
