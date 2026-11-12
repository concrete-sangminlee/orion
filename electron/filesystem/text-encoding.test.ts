import { describe, expect, it } from 'vitest'
import { decodeText, encodeText, UnsupportedTextFileError, type TextEncoding } from './text-encoding'

const SAMPLE = 'const greeting = "héllo wörld — 안녕 👋"\r\nline two\n'

function bytesFor(text: string, encoding: TextEncoding): Buffer {
  return encodeText(text, encoding)
}

describe('decodeText / encodeText', () => {
  it.each<TextEncoding>(['utf8', 'utf8bom', 'utf16le', 'utf16be'])('round-trips %s byte for byte', (encoding) => {
    const original = bytesFor(SAMPLE, encoding)
    const decoded = decodeText(original)
    expect(decoded).toEqual({ text: SAMPLE, encoding })
    expect(encodeText(decoded.text, decoded.encoding).equals(original)).toBe(true)
  })

  it('writes the byte-order mark the file had and never puts it in the text', () => {
    expect([...bytesFor('a', 'utf8bom')]).toEqual([0xef, 0xbb, 0xbf, 0x61])
    expect([...bytesFor('a', 'utf16le')]).toEqual([0xff, 0xfe, 0x61, 0x00])
    expect([...bytesFor('a', 'utf16be')]).toEqual([0xfe, 0xff, 0x00, 0x61])
    expect(decodeText(bytesFor('a', 'utf8bom')).text).toBe('a')
  })

  it('opens an empty file as UTF-8', () => {
    expect(decodeText(new Uint8Array())).toEqual({ text: '', encoding: 'utf8' })
  })

  it('refuses bytes that are not valid UTF-8 instead of replacing them', () => {
    // "café" in Latin-1: 0xE9 alone is not UTF-8. It used to decode to
    // "caf�", and the next save wrote EF BF BD over the original byte.
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9])
    expect(() => decodeText(latin1)).toThrow(UnsupportedTextFileError)
    expect(() => decodeText(latin1)).toThrow(/not UTF-8/)
  })

  it('refuses binary content', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
    expect(() => decodeText(png)).toThrow(/binary/)
    // Valid UTF-8, but a NUL byte never occurs in a text file.
    expect(() => decodeText(Buffer.from('ab\u0000cd', 'utf8'))).toThrow(/binary/)
  })

  it('refuses UTF-16 that cannot be written back unchanged', () => {
    // Odd number of bytes after the BOM.
    expect(() => decodeText(Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x62]))).toThrow(UnsupportedTextFileError)
    // A lone surrogate.
    expect(() => decodeText(Buffer.from([0xff, 0xfe, 0x00, 0xd8]))).toThrow(UnsupportedTextFileError)
    // UTF-32 LE starts with the UTF-16 LE mark followed by two zero bytes.
    expect(() => decodeText(Buffer.from([0xff, 0xfe, 0x00, 0x00, 0x61, 0x00, 0x00, 0x00]))).toThrow(UnsupportedTextFileError)
  })
})
