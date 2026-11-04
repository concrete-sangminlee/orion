import fs from 'fs'
import path from 'path'

/**
 * Files the user explicitly opened through a native "Open File" dialog, an OS
 * file association, or the command line.
 *
 * The renderer is otherwise confined to the active workspace. A grant covers
 * exactly one file (never its directory) and is pinned to the file's real path
 * at grant time, so retargeting a symlink afterwards does not widen access.
 */
const grantedFiles = new Map<string, string>()

function realpathOrNull(filePath: string): string | null {
  try {
    return fs.realpathSync(filePath)
  } catch {
    return null
  }
}

export function grantFileAccess(filePath: string): void {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.includes('\0')) return
  const lexical = path.resolve(filePath)
  const real = realpathOrNull(lexical)
  if (!real) return
  grantedFiles.set(lexical, real)
}

export function isGrantedFile(filePath: unknown): filePath is string {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.includes('\0')) return false
  const lexical = path.resolve(filePath)
  const grantedReal = grantedFiles.get(lexical)
  if (!grantedReal) return false
  return realpathOrNull(lexical) === grantedReal
}

/** Test helper. */
export function clearGrantedFiles(): void {
  grantedFiles.clear()
}
