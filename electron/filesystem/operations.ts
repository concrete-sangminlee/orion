import type { Dirent } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import type { FileNode } from '../../shared/types'
import { decodeText, encodeText, MAX_EDITABLE_FILE_BYTES, UnsupportedTextFileError, type TextEncoding } from './text-encoding'

const IGNORED = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'dist-electron', '.superpowers'])

/**
 * The encoding each opened file was read in, so a save writes it back the same
 * way. `binary` marks an image opened as a preview: the editor holds no text
 * for it, so nothing may be written over it.
 */
const fileEncodings = new Map<string, TextEncoding | 'binary'>()

/** Binary images the editor shows as a preview instead of text. (SVG is text.) */
const PREVIEW_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp'])

function encodingKey(filePath: string): string {
  return path.resolve(filePath)
}

/**
 * Read a file for the editor. Rejects (never returns mangled text) when the
 * file is binary, in an encoding that cannot be written back unchanged, or too
 * large to edit.
 */
export async function readFileContent(filePath: string): Promise<string> {
  return (await readTextFile(filePath)).text
}

/** {@link readFileContent}, also returning the bytes that were decoded. */
export async function readTextFile(filePath: string): Promise<{ text: string; bytes: Buffer }> {
  await assertEditableSize(filePath)
  try {
    const bytes = await fs.readFile(filePath)
    const { text, encoding } = decodeText(bytes)
    fileEncodings.set(encodingKey(filePath), encoding)
    return { text, bytes }
  } catch (err) {
    if (err instanceof UnsupportedTextFileError) {
      // Phrased to follow "Failed to open <name>: " in the UI.
      throw new UnsupportedTextFileError(
        err.reason,
        err.reason === 'binary'
          ? 'it is a binary file and cannot be edited as text'
          : 'its encoding is not UTF-8 or UTF-16, so it cannot be edited without damaging it',
      )
    }
    throw err
  }
}

async function assertRegularFile(filePath: string) {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new UnsupportedTextFileError('not-a-file', 'it is not a regular file')
  return stat
}

async function assertEditableSize(filePath: string): Promise<void> {
  const stat = await assertRegularFile(filePath)
  if (stat.size > MAX_EDITABLE_FILE_BYTES) {
    const megabytes = Math.round(stat.size / (1024 * 1024))
    throw new UnsupportedTextFileError('too-large', `it is too large to edit (${megabytes} MB)`)
  }
}

/**
 * What `fs:read-file` returns for `filePath`: its text, or an empty
 * placeholder for an image, which the editor renders from the file itself.
 */
export async function readFileForEditor(filePath: string): Promise<{ content: string; binary: boolean; bytes?: Buffer }> {
  if (PREVIEW_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    await assertRegularFile(filePath)
    fileEncodings.set(encodingKey(filePath), 'binary')
    return { content: '', binary: true }
  }
  const { text, bytes } = await readTextFile(filePath)
  return { content: text, binary: false, bytes }
}

/** The bytes a save of `content` to `filePath` writes (same encoding the file was opened in). */
export function encodeFileContent(filePath: string, content: string): Buffer {
  const encoding = fileEncodings.get(encodingKey(filePath)) ?? 'utf8'
  if (encoding === 'binary') {
    throw new UnsupportedTextFileError('binary', `Refusing to overwrite "${path.basename(filePath)}": it is not a text file`)
  }
  return encodeText(content, encoding)
}

export async function writeFileBytes(filePath: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, bytes)
}

export async function writeFileContent(filePath: string, content: string): Promise<void> {
  await writeFileBytes(filePath, encodeFileContent(filePath, content))
}

/** Carry remembered encodings over when a file or folder is renamed or moved. */
function moveFileEncodings(oldPath: string, newPath: string): void {
  const from = encodingKey(oldPath)
  const to = encodingKey(newPath)
  for (const [key, encoding] of [...fileEncodings]) {
    if (key === from || key.startsWith(from + path.sep)) {
      fileEncodings.delete(key)
      fileEncodings.set(to + key.slice(from.length), encoding)
    }
  }
}

function forgetFileEncodings(itemPath: string): void {
  const target = encodingKey(itemPath)
  for (const key of [...fileEncodings.keys()]) {
    if (key === target || key.startsWith(target + path.sep)) fileEncodings.delete(key)
  }
}

/** Thrown instead of replacing something that already exists. */
export class DestinationExistsError extends Error {
  readonly code = 'EEXIST'
  constructor(destination: string) {
    super(`"${path.basename(destination)}" already exists`)
    this.name = 'DestinationExistsError'
  }
}

async function lstatOrNull(target: string) {
  try {
    return await fs.lstat(target, { bigint: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/**
 * Create a file that does not exist yet. "New File" used to write with the
 * default flag, so typing the name of an existing file emptied it.
 */
export async function createNewFile(filePath: string, content = ''): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  try {
    await fs.writeFile(filePath, content, { encoding: 'utf-8', flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new DestinationExistsError(filePath)
    throw err
  }
  forgetFileEncodings(filePath)
}

/** Create a folder that does not exist yet (parents are created as needed). */
export async function createNewDirectory(dirPath: string): Promise<void> {
  if (await lstatOrNull(dirPath)) throw new DestinationExistsError(dirPath)
  await fs.mkdir(dirPath, { recursive: true })
}

/**
 * Throws when `destination` exists and is not `source` itself. The two are the
 * same entry for a case-only rename on a case-insensitive file system.
 */
async function assertDestinationFree(source: string, destination: string): Promise<void> {
  const existing = await lstatOrNull(destination)
  if (!existing) return
  const origin = await lstatOrNull(source)
  const sameEntry = origin !== null && origin.dev === existing.dev && origin.ino === existing.ino && origin.ino !== 0n
  if (!sameEntry) throw new DestinationExistsError(destination)
}

export async function deleteItem(itemPath: string): Promise<void> {
  await fs.rm(itemPath, { recursive: true })
  forgetFileEncodings(itemPath)
}

/**
 * Rename or move without replacing anything. `fs.rename` silently replaces an
 * existing file (and an empty directory), so renaming `a.ts` to the name of a
 * sibling used to destroy the sibling.
 */
export async function renameItem(oldPath: string, newPath: string): Promise<void> {
  if (path.resolve(oldPath) === path.resolve(newPath)) return
  await assertDestinationFree(oldPath, newPath)
  await fs.mkdir(path.dirname(newPath), { recursive: true })
  await fs.rename(oldPath, newPath)
  moveFileEncodings(oldPath, newPath)
}

/** Copy a file or folder to a path that does not exist yet. */
export async function copyItem(sourcePath: string, destPath: string): Promise<void> {
  if (await lstatOrNull(destPath)) throw new DestinationExistsError(destPath)
  await fs.mkdir(path.dirname(destPath), { recursive: true })
  await fs.cp(sourcePath, destPath, { recursive: true, force: false, errorOnExist: true })
}

/**
 * List a directory tree. A folder that cannot be read (permissions, a broken
 * mount, removed while listing) is shown empty instead of failing the whole
 * workspace; only an unreadable root is an error.
 */
export async function buildFileTree(dirPath: string, isRoot = true): Promise<FileNode[]> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch (err) {
    if (isRoot) throw err
    return []
  }
  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue

    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, false)
      nodes.push({ name: entry.name, path: fullPath, type: 'directory', children })
    } else {
      nodes.push({ name: entry.name, path: fullPath, type: 'file' })
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Monaco language id for a file. The renderer hands it straight to Monaco, so
 * .tsx/.jsx map to 'typescript'/'javascript': Monaco has no '*react' ids and
 * would show such files as plain text. The TS worker still parses JSX because
 * it picks the script kind from the model URI's extension.
 */
export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.json': 'json', '.md': 'markdown', '.html': 'html',
    '.css': 'css', '.scss': 'scss', '.py': 'python',
    '.rs': 'rust', '.go': 'go', '.java': 'java',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c',
    '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.sql': 'sql', '.graphql': 'graphql', '.xml': 'xml',
    '.svg': 'xml', '.vue': 'vue', '.svelte': 'svelte',
  }
  return map[ext] || 'plaintext'
}
