import { create } from 'zustand'
import type { FileNode } from '@shared/types'
import type { FileWatchEventPayload } from '@shared/ipc-contract'

// ---------------------------------------------------------------------------
// IPC helpers
// ---------------------------------------------------------------------------

let unsubscribeFileWatch: (() => void) | null = null

/** Turn an `{ success: false }` IPC envelope into a thrown error. */
function expectSuccess(result: { success: boolean; error?: string }, operation: string): void {
  if (!result.success) throw new Error(result.error || `${operation} failed`)
}

/** Map the main-process chokidar event onto the store's watch-event shape. */
function toFileWatchEvent(payload: FileWatchEventPayload): FileWatchEvent | null {
  switch (payload.event) {
    case 'change':
      return { type: 'change', path: payload.path }
    case 'add':
      return { type: 'create', path: payload.path, isDirectory: false }
    case 'addDir':
      return { type: 'create', path: payload.path, isDirectory: true }
    case 'unlink':
    case 'unlinkDir':
      return { type: 'delete', path: payload.path }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Events emitted by the file-watcher IPC channel */
export type FileWatchEvent =
  | { type: 'change'; path: string }
  | { type: 'create'; path: string; isDirectory: boolean }
  | { type: 'delete'; path: string }

/** Frecency entry for recently-opened files */
export interface FrecencyEntry {
  path: string
  name: string
  /** Last access timestamp (ms) */
  lastAccessed: number
  /** Total number of accesses */
  accessCount: number
  /** Pre-computed frecency score (higher = more relevant) */
  score: number
}

/** Metadata for files that require special handling */
export interface FileMetadata {
  size: number
  isLargeFile: boolean
  isBinary: boolean
  encoding: FileEncoding
  hasBOM: boolean
  /** True when actual content has not been loaded yet (lazy) */
  contentDeferred: boolean
}

export type FileEncoding =
  | 'utf-8'
  | 'utf-16le'
  | 'utf-16be'
  | 'ascii'
  | 'iso-8859-1'
  | 'windows-1252'
  | 'shift-jis'
  | 'euc-jp'
  | 'gb2312'
  | 'unknown'

/** Template definition used by "create from template" */
export interface FileTemplate {
  id: string
  label: string
  /** File extension (without dot) */
  extension: string
  /** Content to seed the new file with */
  content: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LARGE_FILE_THRESHOLD = 1_048_576 // 1 MB
const MAX_RECENT_FILES = 50
const FRECENCY_DECAY_FACTOR = 0.95
const FRECENCY_TIME_BUCKET_MS = 1000 * 60 * 60 // 1 hour

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

const DEFAULT_TEMPLATES: FileTemplate[] = [
  {
    id: 'react-component',
    label: 'React Component',
    extension: 'tsx',
    content: `import React from 'react'\n\ninterface Props {\n  // props\n}\n\nexport const Component: React.FC<Props> = (props) => {\n  return <div></div>\n}\n`,
  },
  {
    id: 'typescript-module',
    label: 'TypeScript Module',
    extension: 'ts',
    content: `export {}\n`,
  },
  {
    id: 'css-module',
    label: 'CSS Module',
    extension: 'module.css',
    content: `.container {\n}\n`,
  },
  {
    id: 'test-file',
    label: 'Test File',
    extension: 'test.ts',
    content: `import { describe, it, expect } from 'vitest'\n\ndescribe('', () => {\n  it('should work', () => {\n    expect(true).toBe(true)\n  })\n})\n`,
  },
  {
    id: 'json-config',
    label: 'JSON Config',
    extension: 'json',
    content: `{\n  \n}\n`,
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a frecency score.
 * Higher score = accessed more recently & more frequently.
 */
function computeFrecencyScore(entry: Pick<FrecencyEntry, 'lastAccessed' | 'accessCount'>): number {
  const now = Date.now()
  const hoursSinceAccess = (now - entry.lastAccessed) / FRECENCY_TIME_BUCKET_MS
  const recency = Math.pow(FRECENCY_DECAY_FACTOR, hoursSinceAccess)
  return entry.accessCount * recency
}

/**
 * Very simple fuzzy match.
 * Returns a score >= 0 (higher = better). Returns -1 for no match.
 * Characters must appear in order but not contiguously.
 */
function fuzzyMatch(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  if (q.length === 0) return 0

  let qi = 0
  let score = 0
  let consecutive = 0
  let lastMatchIndex = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Bonus for consecutive matches
      if (ti === lastMatchIndex + 1) {
        consecutive++
        score += consecutive * 2
      } else {
        consecutive = 0
        score += 1
      }
      // Bonus for matching at word boundaries (after / . - _ or uppercase)
      if (
        ti === 0 ||
        t[ti - 1] === '/' ||
        t[ti - 1] === '\\' ||
        t[ti - 1] === '.' ||
        t[ti - 1] === '-' ||
        t[ti - 1] === '_' ||
        (t[ti] >= 'A' && t[ti] <= 'Z')
      ) {
        score += 5
      }
      lastMatchIndex = ti
      qi++
    }
  }

  // All query chars must be matched
  if (qi < q.length) return -1

  // Penalise long targets slightly so shorter matches win ties
  score -= target.length * 0.1

  return score
}

/**
 * Detect if a buffer (represented as Uint8Array) is likely binary.
 * Heuristic: if more than 10 % of the first 8 KB are non-text bytes, treat as binary.
 */
function detectBinary(bytes: Uint8Array): boolean {
  const sampleSize = Math.min(bytes.length, 8192)
  let nonText = 0
  for (let i = 0; i < sampleSize; i++) {
    const b = bytes[i]
    // Allow common control chars: \t \n \r
    if (b === 0 || (b < 7) || (b > 14 && b < 32 && b !== 27)) {
      nonText++
    }
  }
  return nonText / sampleSize > 0.1
}

/**
 * Detect encoding from the first bytes of a file (BOM check + heuristic).
 */
function detectEncoding(bytes: Uint8Array): { encoding: FileEncoding; hasBOM: boolean } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', hasBOM: true }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', hasBOM: true }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', hasBOM: true }
  }

  // Simple heuristic: if every byte is valid ASCII, call it ascii; otherwise assume utf-8
  let allAscii = true
  const sample = Math.min(bytes.length, 8192)
  for (let i = 0; i < sample; i++) {
    if (bytes[i] > 127) {
      allAscii = false
      break
    }
  }

  return { encoding: allAscii ? 'ascii' : 'utf-8', hasBOM: false }
}

/**
 * Recursively find a node in the file tree by path.
 */
function findNode(tree: FileNode[], targetPath: string): FileNode | null {
  for (const node of tree) {
    if (node.path === targetPath) return node
    if (node.children) {
      const found = findNode(node.children, targetPath)
      if (found) return found
    }
  }
  return null
}

/**
 * Return the parent directory path for a given file/folder path.
 */
function parentDir(filePath: string): string {
  const sep = filePath.includes('/') ? '/' : '\\'
  const parts = filePath.split(sep)
  parts.pop()
  return parts.join(sep)
}

/**
 * Extract the file name from a path.
 */
function baseName(filePath: string): string {
  const sep = filePath.includes('/') ? '/' : '\\'
  return filePath.split(sep).pop() || filePath
}

/**
 * Deep-clone a file tree (simple JSON round-trip for immutable updates).
 */
function cloneTree(tree: FileNode[]): FileNode[] {
  return JSON.parse(JSON.stringify(tree))
}

/**
 * Remove a node from the tree by path. Returns whether the node was found.
 */
function removeNode(tree: FileNode[], targetPath: string): boolean {
  for (let i = 0; i < tree.length; i++) {
    if (tree[i].path === targetPath) {
      tree.splice(i, 1)
      return true
    }
    if (tree[i].children) {
      if (removeNode(tree[i].children!, targetPath)) return true
    }
  }
  return false
}

/**
 * Insert a node under a parent directory in the tree.
 */
function insertNode(tree: FileNode[], parentPath: string, node: FileNode): boolean {
  for (const n of tree) {
    if (n.path === parentPath && n.type === 'directory') {
      if (!n.children) n.children = []
      n.children.push(node)
      // Sort: directories first, then alphabetical
      n.children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      return true
    }
    if (n.children) {
      if (insertNode(n.children, parentPath, node)) return true
    }
  }
  return false
}

/**
 * Recursively update all paths under a renamed/moved subtree.
 */
function rebasePaths(node: FileNode, oldBase: string, newBase: string): void {
  node.path = node.path.replace(oldBase, newBase)
  node.name = baseName(node.path)
  if (node.children) {
    for (const child of node.children) {
      rebasePaths(child, oldBase, newBase)
    }
  }
}

/**
 * Collect all file paths from a tree (recursively).
 */
function collectFilePaths(tree: FileNode[]): string[] {
  const paths: string[] = []
  for (const node of tree) {
    if (node.type === 'file') paths.push(node.path)
    if (node.children) paths.push(...collectFilePaths(node.children))
  }
  return paths
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface FileStore {
  // --- Existing state ---
  rootPath: string | null
  fileTree: FileNode[]
  expandedDirs: Set<string>

  // --- File watching ---
  watchedPaths: Set<string>
  isWatching: boolean
  startWatching: (rootPath: string) => void
  stopWatching: () => void
  addWatchedPath: (path: string) => void
  removeWatchedPath: (path: string) => void
  handleFileWatchEvent: (event: FileWatchEvent) => void

  // --- Existing actions ---
  setRootPath: (path: string) => void
  setFileTree: (tree: FileNode[]) => void
  toggleDir: (path: string) => void

  // --- File operations ---
  copyFile: (sourcePath: string, destPath: string) => Promise<void>
  copyFolder: (sourcePath: string, destPath: string) => Promise<void>
  moveFile: (sourcePath: string, destPath: string) => Promise<void>
  moveFolder: (sourcePath: string, destPath: string) => Promise<void>
  duplicateFile: (filePath: string) => Promise<void>
  createFileFromTemplate: (dirPath: string, fileName: string, templateId: string) => Promise<void>
  moveToTrash: (filePath: string) => Promise<void>

  // --- File search ---
  searchQuery: string
  searchResults: FileNode[]
  recentFiles: FrecencyEntry[]
  setSearchQuery: (query: string) => void
  searchFiles: (query: string, typeFilter?: string) => FileNode[]
  quickOpen: (query: string) => Array<FileNode & { matchScore: number }>
  recordFileAccess: (filePath: string, fileName: string) => void
  getRecentFiles: (limit?: number) => FrecencyEntry[]
  clearRecentFiles: () => void

  // --- File metadata / large file handling ---
  fileMetadataCache: Map<string, FileMetadata>
  analyzeFile: (filePath: string, sizeBytes: number, headerBytes?: Uint8Array) => FileMetadata
  isLargeFile: (filePath: string) => boolean
  isBinaryFile: (filePath: string) => boolean
  getFileMetadata: (filePath: string) => FileMetadata | null
  clearMetadataCache: () => void

  // --- File encoding ---
  detectFileEncoding: (headerBytes: Uint8Array) => { encoding: FileEncoding; hasBOM: boolean }
  convertEncoding: (content: string, from: FileEncoding, to: FileEncoding) => string

  // --- Templates ---
  templates: FileTemplate[]
  addTemplate: (template: FileTemplate) => void
  removeTemplate: (templateId: string) => void
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useFileStore = create<FileStore>((set, get) => ({
  // =========================================================================
  // Existing state
  // =========================================================================
  rootPath: null,
  fileTree: [],
  expandedDirs: new Set<string>(),

  // =========================================================================
  // File watching state
  // =========================================================================
  watchedPaths: new Set<string>(),
  isWatching: false,

  startWatching: (rootPath: string) => {
    const state = get()
    if (state.isWatching) return

    void window.api?.fileWatch(rootPath)

    const watched = new Set(state.watchedPaths)
    watched.add(rootPath)

    set({ isWatching: true, watchedPaths: watched })

    unsubscribeFileWatch?.()
    unsubscribeFileWatch = window.api?.onFileWatchEvent((payload) => {
      const event = toFileWatchEvent(payload)
      if (event) get().handleFileWatchEvent(event)
    }) ?? null
  },

  stopWatching: () => {
    const state = get()
    if (!state.isWatching) return

    unsubscribeFileWatch?.()
    unsubscribeFileWatch = null
    void window.api?.fileUnwatchAll()

    set({ isWatching: false, watchedPaths: new Set<string>() })
  },

  addWatchedPath: (path: string) =>
    set((state) => {
      const next = new Set(state.watchedPaths)
      next.add(path)
      void window.api?.fileWatch(path)
      return { watchedPaths: next }
    }),

  removeWatchedPath: (path: string) =>
    set((state) => {
      const next = new Set(state.watchedPaths)
      next.delete(path)
      void window.api?.fileUnwatch(path)
      return { watchedPaths: next }
    }),

  handleFileWatchEvent: (event: FileWatchEvent) => {
    const state = get()
    const tree = cloneTree(state.fileTree)

    switch (event.type) {
      case 'change': {
        // File content changed externally -- the node stays in the tree.
        // We just signal a refresh by returning a cloned tree so React picks
        // up the change. Downstream consumers (editor tabs) should re-read
        // the content.
        const node = findNode(tree, event.path)
        if (node) {
          // Mark git status as potentially stale; real status will come from
          // a separate git-status refresh.
          set({ fileTree: tree })
        }
        break
      }

      case 'create': {
        const parent = parentDir(event.path)
        const name = baseName(event.path)
        const newNode: FileNode = {
          name,
          path: event.path,
          type: event.isDirectory ? 'directory' : 'file',
          children: event.isDirectory ? [] : undefined,
        }
        // Insert into tree under parent
        insertNode(tree, parent, newNode)
        set({ fileTree: tree })
        break
      }

      case 'delete': {
        removeNode(tree, event.path)
        // Also clean up expanded dirs
        const nextExpanded = new Set(state.expandedDirs)
        nextExpanded.delete(event.path)
        // Remove metadata cache entry
        const metaCache = new Map(state.fileMetadataCache)
        metaCache.delete(event.path)
        set({ fileTree: tree, expandedDirs: nextExpanded, fileMetadataCache: metaCache })
        break
      }
    }
  },

  // =========================================================================
  // Existing actions
  // =========================================================================
  setRootPath: (path) => set({ rootPath: path }),

  setFileTree: (tree) => set({ fileTree: tree }),

  toggleDir: (path) =>
    set((state) => {
      const next = new Set(state.expandedDirs)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return { expandedDirs: next }
    }),

  // =========================================================================
  // File operations
  // =========================================================================

  copyFile: async (sourcePath: string, destPath: string) => {
    try {
      expectSuccess(await window.api.fileCopy(sourcePath, destPath), 'copyFile')
    } catch (err) {
      console.error('[FileStore] copyFile failed:', err)
      throw err
    }

    // Optimistically add the node to the tree
    const state = get()
    const tree = cloneTree(state.fileTree)
    const sourceNode = findNode(tree, sourcePath)
    if (sourceNode) {
      const newNode: FileNode = {
        name: baseName(destPath),
        path: destPath,
        type: 'file',
      }
      insertNode(tree, parentDir(destPath), newNode)
      set({ fileTree: tree })
    }
  },

  copyFolder: async (sourcePath: string, destPath: string) => {
    try {
      expectSuccess(await window.api.fileCopy(sourcePath, destPath), 'copyFolder')
    } catch (err) {
      console.error('[FileStore] copyFolder failed:', err)
      throw err
    }

    // Deep-clone the subtree under a new base path
    const state = get()
    const tree = cloneTree(state.fileTree)
    const sourceNode = findNode(tree, sourcePath)
    if (sourceNode) {
      const copied: FileNode = JSON.parse(JSON.stringify(sourceNode))
      rebasePaths(copied, sourcePath, destPath)
      insertNode(tree, parentDir(destPath), copied)
      set({ fileTree: tree })
    }
  },

  moveFile: async (sourcePath: string, destPath: string) => {
    try {
      expectSuccess(await window.api.fileMove(sourcePath, destPath), 'moveFile')
    } catch (err) {
      console.error('[FileStore] moveFile failed:', err)
      throw err
    }

    const state = get()
    const tree = cloneTree(state.fileTree)
    const sourceNode = findNode(tree, sourcePath)
    if (sourceNode) {
      removeNode(tree, sourcePath)
      const movedNode: FileNode = {
        name: baseName(destPath),
        path: destPath,
        type: 'file',
        gitStatus: sourceNode.gitStatus,
      }
      insertNode(tree, parentDir(destPath), movedNode)
    }

    // Update recent files
    const recentFiles = state.recentFiles.map((f) =>
      f.path === sourcePath ? { ...f, path: destPath, name: baseName(destPath) } : f
    )

    // Update metadata cache
    const metaCache = new Map(state.fileMetadataCache)
    const meta = metaCache.get(sourcePath)
    if (meta) {
      metaCache.delete(sourcePath)
      metaCache.set(destPath, meta)
    }

    set({ fileTree: tree, recentFiles, fileMetadataCache: metaCache })
  },

  moveFolder: async (sourcePath: string, destPath: string) => {
    try {
      expectSuccess(await window.api.fileMove(sourcePath, destPath), 'moveFolder')
    } catch (err) {
      console.error('[FileStore] moveFolder failed:', err)
      throw err
    }

    const state = get()
    const tree = cloneTree(state.fileTree)
    const sourceNode = findNode(tree, sourcePath)
    if (sourceNode) {
      removeNode(tree, sourcePath)
      rebasePaths(sourceNode, sourcePath, destPath)
      insertNode(tree, parentDir(destPath), sourceNode)
    }

    // Update expanded dirs that were under the old path
    const nextExpanded = new Set<string>()
    for (const dir of state.expandedDirs) {
      if (dir.startsWith(sourcePath)) {
        nextExpanded.add(dir.replace(sourcePath, destPath))
      } else {
        nextExpanded.add(dir)
      }
    }

    set({ fileTree: tree, expandedDirs: nextExpanded })
  },

  duplicateFile: async (filePath: string) => {
    const ext = filePath.includes('.') ? '.' + filePath.split('.').pop() : ''
    const nameWithoutExt = ext
      ? filePath.slice(0, filePath.length - ext.length)
      : filePath

    // Generate a unique duplicate name: foo-copy.ts, foo-copy-2.ts, ...
    let destPath = `${nameWithoutExt}-copy${ext}`
    let attempt = 2
    const state = get()
    const allPaths = new Set(collectFilePaths(state.fileTree))
    while (allPaths.has(destPath)) {
      destPath = `${nameWithoutExt}-copy-${attempt}${ext}`
      attempt++
    }

    await get().copyFile(filePath, destPath)
  },

  createFileFromTemplate: async (dirPath: string, fileName: string, templateId: string) => {
    const state = get()
    const template = state.templates.find((t) => t.id === templateId)
    if (!template) {
      throw new Error(`Template "${templateId}" not found`)
    }

    const sep = dirPath.includes('/') ? '/' : '\\'
    const filePath = `${dirPath}${sep}${fileName}`

    try {
      expectSuccess(await window.api.createFile(filePath, template.content), 'createFileFromTemplate')
    } catch (err) {
      console.error('[FileStore] createFileFromTemplate failed:', err)
      throw err
    }

    // Add to tree
    const tree = cloneTree(state.fileTree)
    const newNode: FileNode = {
      name: fileName,
      path: filePath,
      type: 'file',
    }
    insertNode(tree, dirPath, newNode)
    set({ fileTree: tree })
  },

  moveToTrash: async (filePath: string) => {
    try {
      // Uses Electron's shell.trashItem (falls back to rm in the main process)
      expectSuccess(await window.api.trashItem(filePath), 'moveToTrash')
    } catch (err) {
      console.error('[FileStore] moveToTrash failed:', err)
      throw err
    }

    const state = get()
    const tree = cloneTree(state.fileTree)
    removeNode(tree, filePath)

    // Clean up expanded dirs
    const nextExpanded = new Set(state.expandedDirs)
    nextExpanded.delete(filePath)
    // Also remove any children from expanded dirs
    for (const dir of nextExpanded) {
      if (dir.startsWith(filePath)) {
        nextExpanded.delete(dir)
      }
    }

    // Remove from metadata cache
    const metaCache = new Map(state.fileMetadataCache)
    metaCache.delete(filePath)

    // Remove from recent files
    const recentFiles = state.recentFiles.filter((f) => f.path !== filePath)

    set({
      fileTree: tree,
      expandedDirs: nextExpanded,
      fileMetadataCache: metaCache,
      recentFiles,
    })
  },

  // =========================================================================
  // File search
  // =========================================================================
  searchQuery: '',
  searchResults: [],
  recentFiles: [],

  setSearchQuery: (query: string) => {
    const results = query ? get().searchFiles(query) : []
    set({ searchQuery: query, searchResults: results })
  },

  searchFiles: (query: string, typeFilter?: string): FileNode[] => {
    const state = get()
    const allFiles = collectFilePaths(state.fileTree)
    const lowerQuery = query.toLowerCase()

    const matched = allFiles
      .filter((p) => {
        const name = baseName(p).toLowerCase()
        // Type filter: e.g. "ts", "tsx", "json"
        if (typeFilter) {
          const ext = name.includes('.') ? name.split('.').pop() || '' : ''
          if (ext !== typeFilter.toLowerCase()) return false
        }
        return name.includes(lowerQuery) || p.toLowerCase().includes(lowerQuery)
      })
      .map((p) => ({
        name: baseName(p),
        path: p,
        type: 'file' as const,
      }))

    return matched.slice(0, 100) // cap results
  },

  quickOpen: (query: string): Array<FileNode & { matchScore: number }> => {
    const state = get()
    if (!query) {
      // Return recent files when query is empty
      return state.recentFiles.slice(0, 20).map((r) => ({
        name: r.name,
        path: r.path,
        type: 'file' as const,
        matchScore: r.score,
      }))
    }

    const allFiles = collectFilePaths(state.fileTree)
    const scored: Array<FileNode & { matchScore: number }> = []

    for (const p of allFiles) {
      const name = baseName(p)
      const nameScore = fuzzyMatch(query, name)
      const pathScore = fuzzyMatch(query, p)
      const bestScore = Math.max(nameScore, pathScore)

      if (bestScore >= 0) {
        // Boost score if the file is in recent files
        const recentEntry = state.recentFiles.find((r) => r.path === p)
        const frecencyBoost = recentEntry ? recentEntry.score * 0.5 : 0

        scored.push({
          name,
          path: p,
          type: 'file' as const,
          matchScore: bestScore + frecencyBoost,
        })
      }
    }

    scored.sort((a, b) => b.matchScore - a.matchScore)
    return scored.slice(0, 50)
  },

  recordFileAccess: (filePath: string, fileName: string) =>
    set((state) => {
      const recentFiles = [...state.recentFiles]
      const existingIdx = recentFiles.findIndex((f) => f.path === filePath)

      if (existingIdx >= 0) {
        const entry = { ...recentFiles[existingIdx] }
        entry.accessCount += 1
        entry.lastAccessed = Date.now()
        entry.score = computeFrecencyScore(entry)
        recentFiles[existingIdx] = entry
      } else {
        const entry: FrecencyEntry = {
          path: filePath,
          name: fileName,
          lastAccessed: Date.now(),
          accessCount: 1,
          score: 1,
        }
        entry.score = computeFrecencyScore(entry)
        recentFiles.push(entry)
      }

      // Sort by score descending and cap
      recentFiles.sort((a, b) => b.score - a.score)
      if (recentFiles.length > MAX_RECENT_FILES) {
        recentFiles.length = MAX_RECENT_FILES
      }

      return { recentFiles }
    }),

  getRecentFiles: (limit = 20): FrecencyEntry[] => {
    const state = get()
    // Recompute scores on access (decay)
    const updated = state.recentFiles.map((entry) => ({
      ...entry,
      score: computeFrecencyScore(entry),
    }))
    updated.sort((a, b) => b.score - a.score)
    return updated.slice(0, limit)
  },

  clearRecentFiles: () => set({ recentFiles: [] }),

  // =========================================================================
  // File metadata / large file handling
  // =========================================================================
  fileMetadataCache: new Map<string, FileMetadata>(),

  analyzeFile: (filePath: string, sizeBytes: number, headerBytes?: Uint8Array): FileMetadata => {
    const isLargeFile = sizeBytes > LARGE_FILE_THRESHOLD
    let isBinary = false
    let encoding: FileEncoding = 'utf-8'
    let hasBOM = false

    if (headerBytes && headerBytes.length > 0) {
      isBinary = detectBinary(headerBytes)
      const enc = detectEncoding(headerBytes)
      encoding = enc.encoding
      hasBOM = enc.hasBOM
    }

    const metadata: FileMetadata = {
      size: sizeBytes,
      isLargeFile,
      isBinary,
      encoding,
      hasBOM,
      contentDeferred: isLargeFile || isBinary,
    }

    // Cache it
    set((state) => {
      const next = new Map(state.fileMetadataCache)
      next.set(filePath, metadata)
      return { fileMetadataCache: next }
    })

    return metadata
  },

  isLargeFile: (filePath: string): boolean => {
    const meta = get().fileMetadataCache.get(filePath)
    return meta?.isLargeFile ?? false
  },

  isBinaryFile: (filePath: string): boolean => {
    const meta = get().fileMetadataCache.get(filePath)
    return meta?.isBinary ?? false
  },

  getFileMetadata: (filePath: string): FileMetadata | null => {
    return get().fileMetadataCache.get(filePath) ?? null
  },

  clearMetadataCache: () => set({ fileMetadataCache: new Map() }),

  // =========================================================================
  // File encoding
  // =========================================================================

  detectFileEncoding: (headerBytes: Uint8Array): { encoding: FileEncoding; hasBOM: boolean } => {
    return detectEncoding(headerBytes)
  },

  convertEncoding: (content: string, _from: FileEncoding, to: FileEncoding): string => {
    // JS strings are UTF-16 internally; only UTF-8/ASCII round-trips are
    // supported in the renderer. (No main-process transcoding API exists.)
    if (to === 'utf-8' || to === 'ascii') {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder(to === 'ascii' ? 'ascii' : 'utf-8')
      return decoder.decode(encoder.encode(content))
    }

    // For other encodings, return as-is and log a warning
    console.warn(`[FileStore] Encoding conversion from ${_from} to ${to} not supported in renderer`)
    return content
  },

  // =========================================================================
  // Templates
  // =========================================================================
  templates: [...DEFAULT_TEMPLATES],

  addTemplate: (template: FileTemplate) =>
    set((state) => ({
      templates: [...state.templates, template],
    })),

  removeTemplate: (templateId: string) =>
    set((state) => ({
      templates: state.templates.filter((t) => t.id !== templateId),
    })),
}))
