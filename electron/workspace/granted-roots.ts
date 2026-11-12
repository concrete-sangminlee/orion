import fs from 'fs'
import path from 'path'

/**
 * Folders the user chose as a workspace: through the Open Folder dialog or
 * menu, the command line, an OS drop onto the window, or earlier sessions.
 *
 * `fs:open-workspace` used to accept any directory the renderer named, so a
 * script in the renderer could open `~/.ssh` as the "workspace" and then read
 * and write there through the ordinary file handlers, which made workspace
 * confinement meaningless. Roots are now handed out by the main process only.
 *
 * Granted roots are remembered (by real path) in a file in the user data
 * directory, so recent workspaces keep opening after a restart.
 */

const MAX_REMEMBERED_ROOTS = 100

let storeFile: string | null = null
/** Real paths, most recently granted last. */
let roots: string[] = []

function realpathOrNull(target: string): string | null {
  try {
    return fs.realpathSync(target)
  } catch {
    return null
  }
}

/** Load remembered roots from `filePath` and keep it up to date from now on. */
export function initGrantedRoots(filePath: string): void {
  storeFile = filePath
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    roots = Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string' && path.isAbsolute(entry)) : []
  } catch {
    roots = []
  }
}

function persist(): void {
  if (!storeFile) return
  try {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true })
    fs.writeFileSync(storeFile, JSON.stringify(roots), { mode: 0o600 })
  } catch {
    // Best effort: the grant still holds for this session.
  }
}

/** Allow `folderPath` to be opened as a workspace. Ignores anything but an existing directory. */
export function grantWorkspaceRoot(folderPath: unknown): boolean {
  if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath) || folderPath.includes('\0')) return false
  const real = realpathOrNull(path.resolve(folderPath))
  if (!real) return false
  try {
    if (!fs.statSync(real).isDirectory()) return false
  } catch {
    return false
  }
  roots = [...roots.filter((root) => root !== real), real].slice(-MAX_REMEMBERED_ROOTS)
  persist()
  return true
}

/** Whether `folderPath` (any spelling of it) was granted as a workspace root. */
export function isGrantedWorkspaceRoot(folderPath: unknown): boolean {
  if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath) || folderPath.includes('\0')) return false
  const real = realpathOrNull(path.resolve(folderPath))
  return real !== null && roots.includes(real)
}

/** Test helper. */
export function resetGrantedRoots(): void {
  storeFile = null
  roots = []
}
