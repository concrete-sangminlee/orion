import fs from 'fs'
import path from 'path'

/**
 * Files and folders named on a command line. Any existing file is accepted:
 * an extension allowlist dropped files Orion is registered for (.txt, .sql,
 * .env) and extensionless ones (Makefile, Dockerfile). Relative paths resolve
 * against `cwd`, the directory the command was run in.
 */
export function itemsFromArgs(
  argv: string[],
  cwd: string,
  /** The app's own directory in development (`electron <app> ...`), which is not a user argument. */
  appPath?: string,
): { files: string[]; folders: string[] } {
  const files: string[] = []
  const folders: string[] = []
  // argv[0] is the executable. Flags can come before the app path (Chromium
  // and debugger switches), so the app path is matched, not counted.
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue
    const resolved = path.resolve(cwd, arg)
    if (appPath && resolved === path.resolve(appPath)) continue
    try {
      const stat = fs.statSync(resolved)
      if (stat.isFile()) files.push(resolved)
      else if (stat.isDirectory()) folders.push(resolved)
    } catch {
      // Not an existing path: an Electron/Chromium argument or a typo.
    }
  }
  return { files, folders }
}
