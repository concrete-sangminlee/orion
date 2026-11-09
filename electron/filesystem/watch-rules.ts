import { createHash } from 'crypto'
import path from 'path'

const IGNORED_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'dist-electron', '.superpowers'])

/**
 * Whether the workspace watcher should skip `candidate`.
 *
 * Matches whole path segments below the workspace root. The previous regex
 * matched substrings anywhere in the absolute path, so `src/distance.ts`,
 * `.github/`, `.gitignore`, and every file of a workspace that lives under a
 * folder named like `.../dist/...` or `.../redistribute/...` were never watched.
 */
export function isIgnoredWatchPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false
  return relative.split(/[\\/]+/).some((segment) => IGNORED_SEGMENTS.has(segment))
}

function digest(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Remembers what the app itself last wrote to each file, so the watcher can
 * tell its own saves from external edits by content instead of by time.
 *
 * A time window (previously 1.5 s after every save) also swallowed genuine
 * external changes that landed right after a save — a formatter or linter
 * running on save, a git checkout — leaving the editor showing stale text that
 * the next save would write back.
 */
export class OwnWriteTracker {
  private readonly written = new Map<string, string>()

  private key(filePath: string): string {
    return path.resolve(filePath).replace(/\\/g, '/')
  }

  record(filePath: string, content: string): void {
    this.written.set(this.key(filePath), digest(content))
  }

  /** True when the file now holds exactly what the app last wrote. */
  isOwnWrite(filePath: string, currentContent: string | Buffer): boolean {
    const expected = this.written.get(this.key(filePath))
    return expected !== undefined && expected === digest(currentContent)
  }

  forget(filePath: string): void {
    this.written.delete(this.key(filePath))
  }

  clear(): void {
    this.written.clear()
  }
}
