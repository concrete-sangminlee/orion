/**
 * Virtual File System abstraction layer.
 * Provides unified file operations across local, remote, and in-memory file systems.
 * Supports file watching, change events, and atomic operations.
 */

/* ── Types ─────────────────────────────────────────────── */

export type FileSystemProvider = 'local' | 'remote-ssh' | 'remote-docker' | 'memory' | 'zip'

export interface FileEntry {
  path: string
  name: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  modifiedAt: number
  createdAt: number
  permissions: string
  isReadOnly: boolean
  encoding?: string
  mimeType?: string
}

export interface FileContent {
  path: string
  content: string
  encoding: 'utf-8' | 'base64' | 'binary'
  size: number
  lastModified: number
  etag?: string
}

export interface FileWatchEvent {
  type: 'created' | 'changed' | 'deleted' | 'renamed'
  path: string
  oldPath?: string
  timestamp: number
}

export interface FileOperation {
  type: 'create' | 'write' | 'delete' | 'rename' | 'copy' | 'move'
  path: string
  newPath?: string
  content?: string
  timestamp: number
}

export interface SearchOptions {
  pattern: string
  isRegex: boolean
  caseSensitive: boolean
  wholeWord: boolean
  includeGlob?: string
  excludeGlob?: string
  maxResults?: number
  contextLines?: number
}

export interface SearchResult {
  file: string
  line: number
  column: number
  length: number
  lineContent: string
  contextBefore: string[]
  contextAfter: string[]
}

/* ── File System Interface ────────────────────────────── */

export interface IFileSystem {
  readonly provider: FileSystemProvider
  readonly root: string

  // Read operations
  readFile(path: string): Promise<FileContent>
  readDirectory(path: string): Promise<FileEntry[]>
  stat(path: string): Promise<FileEntry>
  exists(path: string): Promise<boolean>

  // Write operations
  writeFile(path: string, content: string, encoding?: string): Promise<void>
  createDirectory(path: string, recursive?: boolean): Promise<void>
  delete(path: string, recursive?: boolean): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  copy(source: string, destination: string): Promise<void>

  // Watch
  watch(path: string, recursive?: boolean): FileWatcher

  // Search
  search(rootPath: string, options: SearchOptions): Promise<SearchResult[]>
}

export interface FileWatcher {
  onEvent(handler: (event: FileWatchEvent) => void): () => void
  dispose(): void
}

/* ── Local File System (IPC-backed) ───────────────────── */

const api = () => (window as any).api

export class LocalFileSystem implements IFileSystem {
  readonly provider: FileSystemProvider = 'local'
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  async readFile(path: string): Promise<FileContent> {
    const result = await api()?.readFile?.(this.resolve(path))
    return {
      path,
      content: result?.content || '',
      encoding: result?.encoding || 'utf-8',
      size: result?.content?.length || 0,
      lastModified: result?.lastModified || Date.now(),
    }
  }

  async readDirectory(path: string): Promise<FileEntry[]> {
    const entries = await api()?.readDirectory?.(this.resolve(path))
    return (entries || []).map((e: any) => ({
      path: `${path}/${e.name}`.replace(/\/+/g, '/'),
      name: e.name,
      type: e.isDirectory ? 'directory' : e.isSymlink ? 'symlink' : 'file',
      size: e.size || 0,
      modifiedAt: e.modifiedAt || Date.now(),
      createdAt: e.createdAt || Date.now(),
      permissions: e.permissions || 'rw-r--r--',
      isReadOnly: e.isReadOnly || false,
    }))
  }

  async stat(path: string): Promise<FileEntry> {
    const result = await api()?.fileStat?.(this.resolve(path))
    return {
      path,
      name: path.split(/[/\\]/).pop() || '',
      type: result?.isDirectory ? 'directory' : 'file',
      size: result?.size || 0,
      modifiedAt: result?.modifiedAt || Date.now(),
      createdAt: result?.createdAt || Date.now(),
      permissions: result?.permissions || 'rw-r--r--',
      isReadOnly: result?.isReadOnly || false,
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path)
      return true
    } catch {
      return false
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    await api()?.writeFile?.(this.resolve(path), content)
  }

  async createDirectory(path: string, recursive = true): Promise<void> {
    await api()?.createDirectory?.(this.resolve(path), recursive)
  }

  async delete(path: string, recursive = false): Promise<void> {
    await api()?.deleteFile?.(this.resolve(path), recursive)
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await api()?.renameFile?.(this.resolve(oldPath), this.resolve(newPath))
  }

  async copy(source: string, destination: string): Promise<void> {
    await api()?.copyFile?.(this.resolve(source), this.resolve(destination))
  }

  watch(path: string, recursive = true): FileWatcher {
    const handlers = new Set<(event: FileWatchEvent) => void>()
    const watchId = api()?.watchDirectory?.(this.resolve(path), recursive, (event: any) => {
      const mapped: FileWatchEvent = {
        type: event.type,
        path: event.path,
        oldPath: event.oldPath,
        timestamp: Date.now(),
      }
      handlers.forEach(h => h(mapped))
    })

    return {
      onEvent(handler) {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
      dispose() {
        handlers.clear()
        api()?.unwatchDirectory?.(watchId)
      },
    }
  }

  async search(rootPath: string, options: SearchOptions): Promise<SearchResult[]> {
    const results = await api()?.searchFiles?.(this.resolve(rootPath), {
      query: options.pattern,
      isRegex: options.isRegex,
      caseSensitive: options.caseSensitive,
      wholeWord: options.wholeWord,
      include: options.includeGlob,
      exclude: options.excludeGlob,
      maxResults: options.maxResults || 1000,
    })
    return results || []
  }

  private resolve(path: string): string {
    if (path.startsWith('/') || path.match(/^[A-Z]:/i)) return path
    return `${this.root}/${path}`.replace(/\/+/g, '/')
  }
}

/* ── In-Memory File System ────────────────────────────── */

export class MemoryFileSystem implements IFileSystem {
  readonly provider: FileSystemProvider = 'memory'
  readonly root = '/'
  private files = new Map<string, { content: string; modifiedAt: number; createdAt: number }>()
  private watchers = new Map<string, Set<(event: FileWatchEvent) => void>>()

  async readFile(path: string): Promise<FileContent> {
    const file = this.files.get(this.normalize(path))
    if (!file) throw new Error(`File not found: ${path}`)
    return {
      path,
      content: file.content,
      encoding: 'utf-8',
      size: file.content.length,
      lastModified: file.modifiedAt,
    }
  }

  async readDirectory(path: string): Promise<FileEntry[]> {
    const normalized = this.normalize(path)
    const entries: FileEntry[] = []
    const seen = new Set<string>()

    for (const [filePath] of this.files) {
      if (filePath.startsWith(normalized + '/')) {
        const relative = filePath.slice(normalized.length + 1)
        const parts = relative.split('/')
        const name = parts[0]
        if (seen.has(name)) continue
        seen.add(name)

        entries.push({
          path: `${normalized}/${name}`,
          name,
          type: parts.length > 1 ? 'directory' : 'file',
          size: parts.length > 1 ? 0 : (this.files.get(filePath)?.content.length || 0),
          modifiedAt: Date.now(),
          createdAt: Date.now(),
          permissions: 'rw-r--r--',
          isReadOnly: false,
        })
      }
    }

    return entries
  }

  async stat(path: string): Promise<FileEntry> {
    const normalized = this.normalize(path)
    const file = this.files.get(normalized)
    const isDir = !file && [...this.files.keys()].some(k => k.startsWith(normalized + '/'))

    if (!file && !isDir) throw new Error(`Not found: ${path}`)

    return {
      path,
      name: path.split('/').pop() || '',
      type: isDir ? 'directory' : 'file',
      size: file?.content.length || 0,
      modifiedAt: file?.modifiedAt || Date.now(),
      createdAt: file?.createdAt || Date.now(),
      permissions: 'rw-r--r--',
      isReadOnly: false,
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path)
      return true
    } catch {
      return false
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const normalized = this.normalize(path)
    const existing = this.files.get(normalized)
    const now = Date.now()

    this.files.set(normalized, {
      content,
      modifiedAt: now,
      createdAt: existing?.createdAt || now,
    })

    this.emit(normalized, { type: existing ? 'changed' : 'created', path: normalized, timestamp: now })
  }

  async createDirectory(_path: string): Promise<void> {
    // Directories are implicit in memory FS
  }

  async delete(path: string, recursive = false): Promise<void> {
    const normalized = this.normalize(path)
    if (recursive) {
      for (const key of [...this.files.keys()]) {
        if (key === normalized || key.startsWith(normalized + '/')) {
          this.files.delete(key)
        }
      }
    } else {
      this.files.delete(normalized)
    }
    this.emit(normalized, { type: 'deleted', path: normalized, timestamp: Date.now() })
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldNorm = this.normalize(oldPath)
    const newNorm = this.normalize(newPath)
    const file = this.files.get(oldNorm)
    if (file) {
      this.files.set(newNorm, file)
      this.files.delete(oldNorm)
      this.emit(oldNorm, { type: 'renamed', path: newNorm, oldPath: oldNorm, timestamp: Date.now() })
    }
  }

  async copy(source: string, destination: string): Promise<void> {
    const file = this.files.get(this.normalize(source))
    if (file) {
      this.files.set(this.normalize(destination), { ...file, createdAt: Date.now() })
    }
  }

  watch(path: string): FileWatcher {
    const normalized = this.normalize(path)
    if (!this.watchers.has(normalized)) {
      this.watchers.set(normalized, new Set())
    }
    const handlers = this.watchers.get(normalized)!

    return {
      onEvent(handler) {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
      dispose() {
        handlers.clear()
      },
    }
  }

  async search(rootPath: string, options: SearchOptions): Promise<SearchResult[]> {
    const results: SearchResult[] = []
    const normalized = this.normalize(rootPath)

    let regex: RegExp
    try {
      const pattern = options.isRegex ? options.pattern : escapeRegExp(options.pattern)
      const flags = options.caseSensitive ? 'g' : 'gi'
      regex = new RegExp(options.wholeWord ? `\\b${pattern}\\b` : pattern, flags)
    } catch {
      return results
    }

    for (const [filePath, file] of this.files) {
      if (!filePath.startsWith(normalized)) continue

      const lines = file.content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const match = regex.exec(lines[i])
        if (match) {
          results.push({
            file: filePath,
            line: i + 1,
            column: match.index + 1,
            length: match[0].length,
            lineContent: lines[i],
            contextBefore: lines.slice(Math.max(0, i - 2), i),
            contextAfter: lines.slice(i + 1, Math.min(lines.length, i + 3)),
          })

          if (options.maxResults && results.length >= options.maxResults) return results
        }
        regex.lastIndex = 0
      }
    }

    return results
  }

  /** Get all file paths in the memory FS */
  getAllPaths(): string[] {
    return [...this.files.keys()]
  }

  /** Clear all files */
  clear(): void {
    this.files.clear()
  }

  private normalize(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/'
  }

  private emit(path: string, event: FileWatchEvent): void {
    // Emit to watchers matching this path or parent paths
    for (const [watchPath, handlers] of this.watchers) {
      if (path.startsWith(watchPath)) {
        handlers.forEach(h => h(event))
      }
    }
  }
}

/* ── File Operation Journal ───────────────────────────── */

export class FileOperationJournal {
  private operations: FileOperation[] = []
  private maxOperations = 1000

  record(op: FileOperation): void {
    this.operations.push({ ...op, timestamp: Date.now() })
    if (this.operations.length > this.maxOperations) {
      this.operations = this.operations.slice(-this.maxOperations)
    }
  }

  getHistory(limit = 50): FileOperation[] {
    return this.operations.slice(-limit).reverse()
  }

  getOperationsForFile(path: string): FileOperation[] {
    return this.operations.filter(op => op.path === path || op.newPath === path)
  }

  clear(): void {
    this.operations = []
  }

  undo(): FileOperation | undefined {
    return this.operations.pop()
  }
}

/* ── Helpers ──────────────────────────────────────────── */

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function getRelativePath(from: string, to: string): string {
  const fromParts = from.replace(/\\/g, '/').split('/').filter(Boolean)
  const toParts = to.replace(/\\/g, '/').split('/').filter(Boolean)

  let common = 0
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++
  }

  const ups = fromParts.length - common
  const downs = toParts.slice(common)

  return [...Array(ups).fill('..'), ...downs].join('/') || '.'
}

export function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

export function getBaseName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || ''
}

export function getDirName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  parts.pop()
  return parts.join('/') || '/'
}

export function getExtension(path: string): string {
  const name = getBaseName(path)
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot) : ''
}

export function matchGlob(path: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')
    .replace(/\?/g, '[^/]')

  return new RegExp(`^${regexStr}$`).test(path.replace(/\\/g, '/'))
}
