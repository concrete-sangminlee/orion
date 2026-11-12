/**
 * Decoding and encoding of files the editor opens.
 *
 * Files used to be read with `fs.readFile(path, 'utf-8')`, which never fails:
 * bytes that are not UTF-8 become U+FFFD. Opening a Latin-1, Shift-JIS, UTF-16
 * or binary file therefore showed garbage, and the next save (auto-save
 * included) wrote that garbage over the original bytes.
 *
 * A file is now opened only if it can be written back byte for byte:
 * UTF-8 (with or without a BOM) and UTF-16 with a BOM. The encoding is
 * returned so a save can use the same one. Anything else is refused.
 */

export type TextEncoding = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be'

export type UnsupportedTextReason = 'binary' | 'encoding' | 'too-large' | 'not-a-file'

export class UnsupportedTextFileError extends Error {
  constructor(
    readonly reason: UnsupportedTextReason,
    message: string,
  ) {
    super(message)
    this.name = 'UnsupportedTextFileError'
  }
}

/** Larger files are refused: the editor holds the whole text in memory several times over. */
export const MAX_EDITABLE_FILE_BYTES = 50 * 1024 * 1024

const UTF8_BOM = [0xef, 0xbb, 0xbf]

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte)
}

function decodeStrict(bytes: Uint8Array, label: 'utf-8' | 'utf-16le'): string | null {
  try {
    // ignoreBOM keeps any further U+FEFF as text, so encoding gives the same bytes back.
    return new TextDecoder(label, { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return null
  }
}

function swap16(bytes: Uint8Array): Uint8Array {
  const swapped = new Uint8Array(bytes.length)
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    swapped[index] = bytes[index + 1]
    swapped[index + 1] = bytes[index]
  }
  return swapped
}

/**
 * Decode file bytes as text, or throw {@link UnsupportedTextFileError} when
 * the file is not text this editor can save back unchanged.
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: TextEncoding } {
  let text: string | null
  let encoding: TextEncoding

  if (startsWith(bytes, UTF8_BOM)) {
    encoding = 'utf8bom'
    text = decodeStrict(bytes.subarray(3), 'utf-8')
  } else if (startsWith(bytes, [0xff, 0xfe]) && !startsWith(bytes, [0xff, 0xfe, 0x00, 0x00])) {
    encoding = 'utf16le'
    text = bytes.length % 2 === 0 ? decodeStrict(bytes.subarray(2), 'utf-16le') : null
  } else if (startsWith(bytes, [0xfe, 0xff])) {
    encoding = 'utf16be'
    text = bytes.length % 2 === 0 ? decodeStrict(swap16(bytes.subarray(2)), 'utf-16le') : null
  } else {
    encoding = 'utf8'
    // A NUL byte is valid UTF-8 but does not occur in text files.
    if (bytes.includes(0)) throw new UnsupportedTextFileError('binary', 'binary file')
    text = decodeStrict(bytes, 'utf-8')
  }

  if (text === null) {
    throw new UnsupportedTextFileError('encoding', 'not UTF-8 or UTF-16 text')
  }
  if (text.includes('\u0000')) throw new UnsupportedTextFileError('binary', 'binary file')
  return { text, encoding }
}

/** Encode editor text with the encoding the file was opened in. */
export function encodeText(text: string, encoding: TextEncoding): Buffer {
  switch (encoding) {
    case 'utf8':
      return Buffer.from(text, 'utf8')
    case 'utf8bom':
      return Buffer.concat([Buffer.from(UTF8_BOM), Buffer.from(text, 'utf8')])
    case 'utf16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    case 'utf16be':
      return Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(swap16(Buffer.from(text, 'utf16le')))])
  }
}
