import { describe, expect, it } from 'vitest'
import { MAX_CLIPBOARD_TEXT_BYTES, UnsafeClipboardPayloadError, validateClipboardText } from './clipboard-guard'

describe('validateClipboardText', () => {
  it('accepts ordinary text', () => {
    expect(validateClipboardText('hello')).toBe('hello')
  })

  it('accepts text up to the byte limit', () => {
    expect(validateClipboardText('a'.repeat(MAX_CLIPBOARD_TEXT_BYTES))).toHaveLength(MAX_CLIPBOARD_TEXT_BYTES)
  })

  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    expect(() => validateClipboardText('\u00a2'.repeat(Math.floor(MAX_CLIPBOARD_TEXT_BYTES / 2) + 1))).toThrow(UnsafeClipboardPayloadError)
  })

  it('rejects non-string text payloads', () => {
    expect(() => validateClipboardText(null)).toThrow('must be a string')
    expect(() => validateClipboardText(123)).toThrow('must be a string')
  })

  it('rejects text over the byte limit', () => {
    expect(() => validateClipboardText('a'.repeat(MAX_CLIPBOARD_TEXT_BYTES + 1))).toThrow('exceeds')
  })
})
