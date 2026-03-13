/**
 * Workspace Indexer for Orion IDE.
 *
 * Provides fast file-path, symbol, and full-text search across the entire
 * workspace using a trie-based file index, a symbol table, and a trigram
 * content index. Supports incremental updates, background chunked indexing,
 * ignore-pattern filtering, language detection, and index serialisation for
 * fast cold-start.
 *
 * Designed to scale to 100 000+ files without blocking the UI thread.
 */

/* ── Types ─────────────────────────────────────────────── */

export type SymbolKind =
  | 'function' | 'class' | 'interface' | 'type' | 'enum'
  | 'variable' | 'const' | 'method' | 'property' | 'namespace'
  | 'component' | 'hook' | 'module' | 'import'

export type FileChangeKind = 'added' | 'modified' | 'deleted'

export type SearchResultKind = 'file' | 'symbol' | 'content'

export type IndexingState = 'idle' | 'indexing' | 'paused' | 'error'

export interface IndexedFile {
  path: string
  relativePath: string
  language: string
  size: number
  lastModified: number
  hash: string
  symbolCount: number
}

export interface IndexedSymbol {
  name: string
  kind: SymbolKind
  filePath: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  containerName?: string
  exported: boolean
  signature?: string
  /** Lowercase name cached for fast matching. */
  nameLower: string
}

export interface ContentMatch {
  filePath: string
  line: number
  column: number
  lineContent: string
  matchLength: number
  contextBefore: string[]
  contextAfter: string[]
}

export interface SearchResult {
  kind: SearchResultKind
  score: number
  /** Set when kind === 'file' */
  file?: IndexedFile
  /** Set when kind === 'symbol' */
  symbol?: IndexedSymbol
  /** Set when kind === 'content' */
  contentMatch?: ContentMatch
  /** Indices in the matched string that correspond to the query chars. */
  matchIndices?: number[]
}

export interface SearchOptions {
  /** Search categories to include. Defaults to all. */
  kinds?: SearchResultKind[]
  /** Maximum total results returned. @default 100 */
  maxResults?: number
  /** Glob include pattern (e.g. '**\/*.ts'). */
  includePattern?: string
  /** Glob exclude pattern. */
  excludePattern?: string
  /** Case-sensitive search. @default false */
  caseSensitive?: boolean
  /** Treat query as regular expression (content search only). @default false */
  regex?: boolean
  /** Whole-word matching for content search. @default false */
  wholeWord?: boolean
  /** Number of context lines around content matches. @default 2 */
  contextLines?: number
  /** Only return exported symbols. @default false */
  exportedOnly?: boolean
  /** Filter by symbol kind. */
  symbolKinds?: SymbolKind[]
  /** Filter by language id. */
  languages?: string[]
}

export interface IndexStats {
  state: IndexingState
  fileCount: number
  symbolCount: number
  trigramCount: number
  trieNodeCount: number
  estimatedMemoryBytes: number
  indexedLanguages: Map<string, number>
  lastFullIndexMs: number
  lastIncrementalMs: number
  cacheAgeMs: number
}

export interface IndexingProgress {
  phase: 'scanning' | 'parsing' | 'indexing' | 'finalizing'
  filesTotal: number
  filesProcessed: number
  currentFile: string
  elapsedMs: number
}

export interface IgnoreConfig {
  patterns: string[]
  /** Always ignored regardless of config. */
  builtIn: string[]
}

export interface SerializedIndex {
  version: number
  timestamp: number
  rootPath: string
  files: Array<[string, IndexedFile]>
  symbols: IndexedSymbol[]
  trigrams: Array<[string, string[]]>
  ignorePatterns: string[]
}

export interface FileWatcherHook {
  onFileAdded(path: string, content: string): void
  onFileModified(path: string, content: string): void
  onFileDeleted(path: string): void
  onDirectoryAdded(path: string): void
  onDirectoryDeleted(path: string): void
}

/** Callback signature for indexing progress updates. */
export type ProgressCallback = (progress: IndexingProgress) => void

/* ── Constants ─────────────────────────────────────────── */

const INDEX_VERSION = 1
const DEFAULT_MAX_RESULTS = 100
const DEFAULT_CONTEXT_LINES = 2
const CHUNK_SIZE = 64
const YIELD_INTERVAL_MS = 4

/** Built-in ignore patterns that always apply. */
const BUILTIN_IGNORES: readonly string[] = [
  'node_modules', '.git', '.hg', '.svn', '.DS_Store', 'Thumbs.db',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.tox',
  'dist', 'build', 'out', '.next', '.nuxt', '.cache',
  'coverage', '.nyc_output', '.vscode-test',
  '*.min.js', '*.min.css', '*.map',
  '*.wasm', '*.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
]

/** Binary extensions we never index. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.avif',
  '.svg', '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.flac',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.xz',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.pyc', '.pyo', '.class', '.o', '.obj',
  '.sqlite', '.db', '.sqlite3',
])

/** Extension-to-language map. */
const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescriptreact', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascriptreact', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.pyw': 'python', '.pyi': 'python',
  '.rs': 'rust', '.go': 'go', '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
  '.swift': 'swift', '.cs': 'csharp', '.csx': 'csharp',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp', '.h': 'cpp',
  '.c': 'c',
  '.php': 'php', '.phtml': 'php',
  '.rb': 'ruby', '.rake': 'ruby', '.gemspec': 'ruby',
  '.lua': 'lua', '.pl': 'perl', '.pm': 'perl',
  '.r': 'r', '.R': 'r', '.rmd': 'r',
  '.html': 'html', '.htm': 'html', '.xhtml': 'html',
  '.css': 'css', '.scss': 'scss', '.less': 'less', '.sass': 'sass',
  '.json': 'json', '.jsonc': 'jsonc',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml', '.ini': 'ini',
  '.xml': 'xml', '.xsl': 'xml', '.xsd': 'xml',
  '.md': 'markdown', '.mdx': 'mdx',
  '.sql': 'sql',
  '.sh': 'shellscript', '.bash': 'shellscript', '.zsh': 'shellscript',
  '.ps1': 'powershell', '.psm1': 'powershell',
  '.dockerfile': 'dockerfile',
  '.graphql': 'graphql', '.gql': 'graphql',
  '.proto': 'protobuf',
  '.vue': 'vue', '.svelte': 'svelte',
  '.elm': 'elm', '.ex': 'elixir', '.exs': 'elixir',
  '.hs': 'haskell', '.lhs': 'haskell',
  '.scala': 'scala', '.sbt': 'scala',
  '.clj': 'clojure', '.cljs': 'clojure', '.cljc': 'clojure',
  '.erl': 'erlang', '.hrl': 'erlang',
  '.dart': 'dart', '.zig': 'zig', '.nim': 'nim',
  '.tf': 'terraform', '.hcl': 'terraform',
  '.prisma': 'prisma',
}

/* ── Trie (File-Path Index) ────────────────────────────── */

interface TrieNode {
  children: Map<string, TrieNode>
  /** Non-null when this node terminates a valid path. */
  filePath: string | null
  /** Number of leaf descendants (for stats). */
  leafCount: number
}

function createTrieNode(): TrieNode {
  return { children: new Map(), filePath: null, leafCount: 0 }
}

class PathTrie {
  readonly root: TrieNode = createTrieNode()
  private _nodeCount = 1

  get nodeCount(): number {
    return this._nodeCount
  }

  /** Insert a path, splitting on '/' for segment-level nodes. */
  insert(filePath: string): void {
    const segments = filePath.toLowerCase().split('/')
    let node = this.root
    for (const seg of segments) {
      for (const ch of seg) {
        let child = node.children.get(ch)
        if (!child) {
          child = createTrieNode()
          node.children.set(ch, child)
          this._nodeCount++
        }
        node = child
      }
      // Add a separator node for '/'
      let sep = node.children.get('/')
      if (!sep) {
        sep = createTrieNode()
        node.children.set('/', sep)
        this._nodeCount++
      }
      node = sep
    }
    node.filePath = filePath
    this._propagateLeafCount(filePath, 1)
  }

  /** Remove a path from the trie. */
  remove(filePath: string): boolean {
    const segments = filePath.toLowerCase().split('/')
    const trail: Array<{ node: TrieNode; key: string; parent: TrieNode }> = []
    let node = this.root

    for (const seg of segments) {
      for (const ch of seg) {
        const child = node.children.get(ch)
        if (!child) return false
        trail.push({ node: child, key: ch, parent: node })
        node = child
      }
      const sep = node.children.get('/')
      if (!sep) return false
      trail.push({ node: sep, key: '/', parent: node })
      node = sep
    }

    if (node.filePath !== filePath) return false
    node.filePath = null
    this._propagateLeafCount(filePath, -1)

    // Prune childless nodes bottom-up
    for (let i = trail.length - 1; i >= 0; i--) {
      const { node: n, key, parent } = trail[i]
      if (n.children.size === 0 && n.filePath === null) {
        parent.children.delete(key)
        this._nodeCount--
      } else {
        break
      }
    }
    return true
  }

  /** Fuzzy-match a query against all indexed paths. */
  fuzzySearch(query: string, maxResults: number): Array<{ path: string; score: number; indices: number[] }> {
    const queryLower = query.toLowerCase()
    const results: Array<{ path: string; score: number; indices: number[] }> = []
    this._collectPaths(this.root, (filePath) => {
      const match = fuzzyMatchPath(queryLower, filePath.toLowerCase(), filePath)
      if (match.score > 0) {
        results.push({ path: filePath, score: match.score, indices: match.indices })
      }
    })

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, maxResults)
  }

  /** Collect all file paths under this trie. */
  allPaths(): string[] {
    const out: string[] = []
    this._collectPaths(this.root, (p) => out.push(p))
    return out
  }

  clear(): void {
    this.root.children.clear()
    this.root.filePath = null
    this.root.leafCount = 0
    this._nodeCount = 1
  }

  private _collectPaths(node: TrieNode, cb: (path: string) => void): void {
    if (node.filePath !== null) cb(node.filePath)
    for (const child of node.children.values()) {
      this._collectPaths(child, cb)
    }
  }

  private _propagateLeafCount(filePath: string, delta: number): void {
    const segments = filePath.toLowerCase().split('/')
    let node = this.root
    node.leafCount += delta
    for (const seg of segments) {
      for (const ch of seg) {
        const child = node.children.get(ch)
        if (!child) return
        child.leafCount += delta
        node = child
      }
      const sep = node.children.get('/')
      if (!sep) return
      sep.leafCount += delta
      node = sep
    }
  }
}

/* ── Fuzzy Matching ────────────────────────────────────── */

interface FuzzyResult {
  score: number
  indices: number[]
}

const PATH_SEPARATORS = new Set(['/', '\\', '.', '-', '_'])

function fuzzyMatchPath(queryLower: string, targetLower: string, original: string): FuzzyResult {
  if (queryLower.length === 0) return { score: 0, indices: [] }
  if (queryLower.length > targetLower.length) return { score: 0, indices: [] }

  const indices: number[] = []
  let qi = 0
  let score = 0
  let consecutive = 0
  let prevMatchIdx = -2

  for (let ti = 0; ti < targetLower.length && qi < queryLower.length; ti++) {
    if (targetLower[ti] === queryLower[qi]) {
      indices.push(ti)
      // Exact case match bonus
      score += original[ti] === queryLower[qi] ? 1 : 0.8

      // Consecutive bonus
      if (ti === prevMatchIdx + 1) {
        consecutive++
        score += consecutive * 2
      } else {
        consecutive = 0
      }

      // Separator boundary bonus (char after '/' or '.' etc)
      if (ti > 0 && PATH_SEPARATORS.has(targetLower[ti - 1])) {
        score += 6
      }

      // Start of string bonus
      if (ti === 0) {
        score += 8
      }

      // CamelCase boundary bonus
      if (ti > 0 && original[ti] === original[ti].toUpperCase() &&
          original[ti - 1] === original[ti - 1].toLowerCase() &&
          original[ti] !== original[ti].toLowerCase()) {
        score += 4
      }

      prevMatchIdx = ti
      qi++
    } else {
      // Gap penalty
      if (qi > 0) score -= 0.3
    }
  }

  if (qi < queryLower.length) return { score: 0, indices: [] }

  // Filename match bonus: if most matches are in the basename, boost score
  const lastSlash = targetLower.lastIndexOf('/')
  const basenameMatches = indices.filter(i => i > lastSlash).length
  if (basenameMatches === indices.length && lastSlash >= 0) {
    score += basenameMatches * 3
  }

  // Length proximity bonus: shorter paths with same match quality win
  score -= targetLower.length * 0.05

  return { score, indices }
}

/* ── Trigram Content Index ─────────────────────────────── */

class TrigramIndex {
  /** trigram -> set of file paths containing it */
  private _index = new Map<string, Set<string>>()
  /** file path -> full content */
  private _contents = new Map<string, string>()
  /** file path -> set of trigrams generated from it */
  private _fileTrigrams = new Map<string, Set<string>>()

  get trigramCount(): number {
    return this._index.size
  }

  get fileCount(): number {
    return this._contents.size
  }

  /** Add or update a file's content in the trigram index. */
  addFile(filePath: string, content: string): void {
    // Remove old trigrams first
    this.removeFile(filePath)

    this._contents.set(filePath, content)
    const trigrams = this._extractTrigrams(content)
    this._fileTrigrams.set(filePath, trigrams)

    for (const tri of trigrams) {
      let set = this._index.get(tri)
      if (!set) {
        set = new Set()
        this._index.set(tri, set)
      }
      set.add(filePath)
    }
  }

  /** Remove a file from the trigram index. */
  removeFile(filePath: string): void {
    const oldTrigrams = this._fileTrigrams.get(filePath)
    if (oldTrigrams) {
      for (const tri of oldTrigrams) {
        const set = this._index.get(tri)
        if (set) {
          set.delete(filePath)
          if (set.size === 0) this._index.delete(tri)
        }
      }
      this._fileTrigrams.delete(filePath)
    }
    this._contents.delete(filePath)
  }

  /** Get content for a file. */
  getContent(filePath: string): string | undefined {
    return this._contents.get(filePath)
  }

  /**
   * Find candidate files that likely contain the query using trigram
   * intersection, then verify with an actual string/regex search.
   */
  search(
    query: string,
    options: {
      caseSensitive?: boolean
      regex?: boolean
      wholeWord?: boolean
      contextLines?: number
      maxResults?: number
      fileFilter?: (path: string) => boolean
    } = {},
  ): ContentMatch[] {
    const {
      caseSensitive = false,
      regex = false,
      wholeWord = false,
      contextLines = DEFAULT_CONTEXT_LINES,
      maxResults = DEFAULT_MAX_RESULTS,
      fileFilter,
    } = options

    // 1. Build candidate set from trigram intersection
    const candidates = this._trigramCandidates(query, caseSensitive)

    // 2. Build the actual matcher
    let pattern: RegExp
    if (regex) {
      try {
        pattern = new RegExp(query, caseSensitive ? 'g' : 'gi')
      } catch {
        return []
      }
    } else {
      const escaped = escapeRegExp(query)
      const wrapped = wholeWord ? `\\b${escaped}\\b` : escaped
      pattern = new RegExp(wrapped, caseSensitive ? 'g' : 'gi')
    }

    // 3. Search candidates
    const results: ContentMatch[] = []

    for (const filePath of candidates) {
      if (fileFilter && !fileFilter(filePath)) continue
      if (results.length >= maxResults) break

      const content = this._contents.get(filePath)
      if (!content) continue

      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        pattern.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = pattern.exec(lines[i])) !== null) {
          if (results.length >= maxResults) break

          const ctxBefore: string[] = []
          for (let b = Math.max(0, i - contextLines); b < i; b++) {
            ctxBefore.push(lines[b])
          }
          const ctxAfter: string[] = []
          for (let a = i + 1; a <= Math.min(lines.length - 1, i + contextLines); a++) {
            ctxAfter.push(lines[a])
          }

          results.push({
            filePath,
            line: i + 1,
            column: m.index + 1,
            lineContent: lines[i],
            matchLength: m[0].length,
            contextBefore: ctxBefore,
            contextAfter: ctxAfter,
          })

          // Avoid infinite loop on zero-length matches
          if (m[0].length === 0) pattern.lastIndex++
        }
      }
    }
    return results
  }

  /** Collect all file paths. */
  allFiles(): string[] {
    return Array.from(this._contents.keys())
  }

  clear(): void {
    this._index.clear()
    this._contents.clear()
    this._fileTrigrams.clear()
  }

  /** Estimate memory usage in bytes. */
  estimateMemory(): number {
    let bytes = 0
    // Trigram index: key size + set overhead
    for (const [tri, set] of this._index) {
      bytes += tri.length * 2 + 64 // key
      bytes += set.size * 80 // avg path reference
    }
    // Content storage
    for (const [path, content] of this._contents) {
      bytes += path.length * 2 + content.length * 2 + 64
    }
    return bytes
  }

  /** Serialize to a storable form. */
  serialize(): Array<[string, string[]]> {
    const out: Array<[string, string[]]> = []
    for (const [tri, set] of this._index) {
      out.push([tri, Array.from(set)])
    }
    return out
  }

  /** Restore from serialized form. Requires contents to already be loaded. */
  deserializeTrigrams(data: Array<[string, string[]]>): void {
    this._index.clear()
    this._fileTrigrams.clear()
    for (const [tri, files] of data) {
      this._index.set(tri, new Set(files))
      for (const f of files) {
        let set = this._fileTrigrams.get(f)
        if (!set) {
          set = new Set()
          this._fileTrigrams.set(f, set)
        }
        set.add(tri)
      }
    }
  }

  private _extractTrigrams(content: string): Set<string> {
    const trigrams = new Set<string>()
    const lower = content.toLowerCase()
    const len = lower.length
    // We limit trigram extraction on very large files to avoid memory blow-up
    const limit = Math.min(len, 500_000)
    for (let i = 0; i < limit - 2; i++) {
      const tri = lower.substring(i, i + 3)
      // Skip trigrams that are all whitespace
      if (tri.trim().length > 0) {
        trigrams.add(tri)
      }
    }
    return trigrams
  }

  /** Return the set of files whose trigrams cover all query trigrams. */
  private _trigramCandidates(query: string, caseSensitive: boolean): Set<string> {
    const normalized = caseSensitive ? query : query.toLowerCase()
    if (normalized.length < 3) {
      // Trigrams won't help with very short queries, scan all files
      return new Set(this._contents.keys())
    }

    const queryTrigrams: string[] = []
    for (let i = 0; i <= normalized.length - 3; i++) {
      const tri = normalized.substring(i, i + 3)
      if (tri.trim().length > 0) queryTrigrams.push(tri)
    }

    if (queryTrigrams.length === 0) {
      return new Set(this._contents.keys())
    }

    // Intersect: start with the trigram that has the fewest files
    let smallest: Set<string> | null = null
    for (const tri of queryTrigrams) {
      const files = this._index.get(tri)
      if (!files || files.size === 0) return new Set()
      if (!smallest || files.size < smallest.size) {
        smallest = files
      }
    }

    if (!smallest) return new Set()

    // Filter smallest set against all other trigrams
    const candidates = new Set<string>()
    for (const f of smallest) {
      let match = true
      for (const tri of queryTrigrams) {
        const files = this._index.get(tri)
        if (!files || !files.has(f)) {
          match = false
          break
        }
      }
      if (match) candidates.add(f)
    }
    return candidates
  }
}

/* ── Symbol Extraction ─────────────────────────────────── */

interface SymbolPattern {
  regex: RegExp
  kind: SymbolKind
  exported: boolean
  nameGroup: number
  signatureGroup?: number
  containerGroup?: number
}

const SYMBOL_PATTERNS: SymbolPattern[] = [
  // TypeScript / JavaScript
  { regex: /^export\s+(?:async\s+)?function\s+(\w+)/gm, kind: 'function', exported: true, nameGroup: 1 },
  { regex: /^export\s+default\s+(?:async\s+)?function\s+(\w+)/gm, kind: 'function', exported: true, nameGroup: 1 },
  { regex: /^(?:async\s+)?function\s+(\w+)/gm, kind: 'function', exported: false, nameGroup: 1 },
  { regex: /^export\s+(?:default\s+)?class\s+(\w+)/gm, kind: 'class', exported: true, nameGroup: 1 },
  { regex: /^class\s+(\w+)/gm, kind: 'class', exported: false, nameGroup: 1 },
  { regex: /^export\s+interface\s+(\w+)/gm, kind: 'interface', exported: true, nameGroup: 1 },
  { regex: /^interface\s+(\w+)/gm, kind: 'interface', exported: false, nameGroup: 1 },
  { regex: /^export\s+type\s+(\w+)\s*=/gm, kind: 'type', exported: true, nameGroup: 1 },
  { regex: /^type\s+(\w+)\s*=/gm, kind: 'type', exported: false, nameGroup: 1 },
  { regex: /^export\s+(?:const\s+)?enum\s+(\w+)/gm, kind: 'enum', exported: true, nameGroup: 1 },
  { regex: /^(?:const\s+)?enum\s+(\w+)/gm, kind: 'enum', exported: false, nameGroup: 1 },
  { regex: /^export\s+(?:const|let|var)\s+(\w+)/gm, kind: 'const', exported: true, nameGroup: 1 },
  { regex: /^(?:const|let|var)\s+(\w+)/gm, kind: 'variable', exported: false, nameGroup: 1 },
  { regex: /^export\s+namespace\s+(\w+)/gm, kind: 'namespace', exported: true, nameGroup: 1 },
  { regex: /^namespace\s+(\w+)/gm, kind: 'namespace', exported: false, nameGroup: 1 },
  // React components (arrow-fn)
  { regex: /^export\s+(?:const|let)\s+(\w+)\s*[:=]\s*(?:React\.)?(?:FC|memo|forwardRef)/gm, kind: 'component', exported: true, nameGroup: 1 },
  // React hooks
  { regex: /^export\s+(?:const|function)\s+(use\w+)/gm, kind: 'hook', exported: true, nameGroup: 1 },
  { regex: /^(?:const|function)\s+(use\w+)/gm, kind: 'hook', exported: false, nameGroup: 1 },
  // Python
  { regex: /^def\s+(\w+)/gm, kind: 'function', exported: false, nameGroup: 1 },
  { regex: /^class\s+(\w+)/gm, kind: 'class', exported: false, nameGroup: 1 },
  // Rust
  { regex: /^pub\s+(?:async\s+)?fn\s+(\w+)/gm, kind: 'function', exported: true, nameGroup: 1 },
  { regex: /^(?:async\s+)?fn\s+(\w+)/gm, kind: 'function', exported: false, nameGroup: 1 },
  { regex: /^pub\s+struct\s+(\w+)/gm, kind: 'class', exported: true, nameGroup: 1 },
  { regex: /^struct\s+(\w+)/gm, kind: 'class', exported: false, nameGroup: 1 },
  { regex: /^pub\s+enum\s+(\w+)/gm, kind: 'enum', exported: true, nameGroup: 1 },
  { regex: /^pub\s+trait\s+(\w+)/gm, kind: 'interface', exported: true, nameGroup: 1 },
  { regex: /^trait\s+(\w+)/gm, kind: 'interface', exported: false, nameGroup: 1 },
  // Go
  { regex: /^func\s+(\w+)/gm, kind: 'function', exported: false, nameGroup: 1 },
  { regex: /^type\s+(\w+)\s+struct/gm, kind: 'class', exported: false, nameGroup: 1 },
  { regex: /^type\s+(\w+)\s+interface/gm, kind: 'interface', exported: false, nameGroup: 1 },
]

function extractSymbols(filePath: string, content: string, language: string): IndexedSymbol[] {
  const symbols: IndexedSymbol[] = []
  const lines = content.split('\n')
  const seen = new Set<string>()

  for (const pattern of SYMBOL_PATTERNS) {
    if (!isPatternRelevant(pattern, language)) continue

    // Clone regex to avoid shared state
    const re = new RegExp(pattern.regex.source, pattern.regex.flags)
    let match: RegExpExecArray | null

    while ((match = re.exec(content)) !== null) {
      const name = match[pattern.nameGroup]
      if (!name) continue

      // Compute line/column
      const offset = match.index
      let line = 1
      let col = 1
      for (let i = 0; i < offset && i < content.length; i++) {
        if (content[i] === '\n') {
          line++
          col = 1
        } else {
          col++
        }
      }

      // Deduplicate: same name + same line
      const key = `${name}:${line}`
      if (seen.has(key)) continue
      seen.add(key)

      // Extract signature (rest of the match line)
      const matchLine = lines[line - 1] || ''
      const signature = matchLine.trim()

      symbols.push({
        name,
        kind: pattern.kind,
        filePath,
        line,
        column: col,
        exported: pattern.exported || isGoExported(name, language),
        signature: signature.length <= 200 ? signature : signature.substring(0, 200) + '...',
        nameLower: name.toLowerCase(),
      })
    }
  }

  return symbols
}

/** In Go, exported identifiers start with uppercase. */
function isGoExported(name: string, language: string): boolean {
  return language === 'go' && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
}

/** Filter patterns by language to avoid false positives. */
function isPatternRelevant(pattern: SymbolPattern, language: string): boolean {
  const src = pattern.regex.source

  // Python-specific patterns
  if (src.startsWith('^def\\s')) return ['python'].includes(language)

  // Rust-specific patterns
  if (src.includes('pub\\s') || src.includes('struct\\s') ||
      src.includes('trait\\s') || src.startsWith('^(?:async\\s+)?fn')) {
    return ['rust'].includes(language)
  }

  // Go-specific patterns
  if (src.startsWith('^func\\s') || src.includes('+struct') || src.includes('+interface')) {
    return ['go'].includes(language)
  }

  // Default: relevant for JS/TS and similar languages
  return true
}

/* ── Ignore Matcher ────────────────────────────────────── */

class IgnoreMatcher {
  private _patterns: string[] = []
  private _regexCache = new Map<string, RegExp>()

  constructor(builtIn: readonly string[] = BUILTIN_IGNORES) {
    this._patterns = [...builtIn]
  }

  /** Add patterns from a .gitignore-style file. */
  addPatterns(patterns: string[]): void {
    for (const p of patterns) {
      const trimmed = p.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        this._patterns.push(trimmed)
      }
    }
  }

  /** Replace all custom patterns (keeps built-in). */
  setPatterns(patterns: string[]): void {
    this._patterns = [...BUILTIN_IGNORES]
    this.addPatterns(patterns)
  }

  /** Get all active patterns. */
  getPatterns(): string[] {
    return [...this._patterns]
  }

  /** Test whether a relative path should be ignored. */
  isIgnored(relativePath: string): boolean {
    const segments = relativePath.split('/')
    for (const pattern of this._patterns) {
      if (this._matchPattern(pattern, relativePath, segments)) return true
    }
    return false
  }

  /** Test if a file has a binary extension. */
  isBinary(filePath: string): boolean {
    const dot = filePath.lastIndexOf('.')
    if (dot < 0) return false
    return BINARY_EXTENSIONS.has(filePath.substring(dot).toLowerCase())
  }

  private _matchPattern(pattern: string, relativePath: string, segments: string[]): boolean {
    // Negation patterns not supported yet
    if (pattern.startsWith('!')) return false

    const isDir = pattern.endsWith('/')
    const cleaned = isDir ? pattern.slice(0, -1) : pattern

    // Simple name match (no slashes in pattern) -> match any segment
    if (!cleaned.includes('/')) {
      if (cleaned.includes('*')) {
        const re = this._globToRegex(cleaned)
        const basename = segments[segments.length - 1]
        return re.test(basename) || segments.some(s => re.test(s))
      }
      return segments.includes(cleaned)
    }

    // Path pattern: match against the full relative path
    const re = this._globToRegex(cleaned)
    return re.test(relativePath)
  }

  private _globToRegex(glob: string): RegExp {
    let cached = this._regexCache.get(glob)
    if (cached) return cached

    let pattern = ''
    for (let i = 0; i < glob.length; i++) {
      const ch = glob[i]
      if (ch === '*' && glob[i + 1] === '*') {
        pattern += '.*'
        i++ // skip second *
        if (glob[i + 1] === '/') i++ // skip trailing /
      } else if (ch === '*') {
        pattern += '[^/]*'
      } else if (ch === '?') {
        pattern += '[^/]'
      } else if (ch === '.') {
        pattern += '\\.'
      } else if (ch === '{') {
        pattern += '('
      } else if (ch === '}') {
        pattern += ')'
      } else if (ch === ',') {
        pattern += '|'
      } else {
        pattern += ch
      }
    }

    cached = new RegExp(`^${pattern}$|(?:^|/)${pattern}(?:/|$)`, 'i')
    this._regexCache.set(glob, cached)
    return cached
  }
}

/* ── Language Detection ────────────────────────────────── */

function detectLanguage(filePath: string): string {
  // Special filenames
  const basename = filePath.split('/').pop() || ''
  const basenameMap: Record<string, string> = {
    'Dockerfile': 'dockerfile',
    'Makefile': 'makefile',
    'CMakeLists.txt': 'cmake',
    'Rakefile': 'ruby',
    'Gemfile': 'ruby',
    '.gitignore': 'gitignore',
    '.env': 'dotenv',
    '.editorconfig': 'editorconfig',
    'tsconfig.json': 'jsonc',
    'jsconfig.json': 'jsonc',
    '.prettierrc': 'json',
    '.eslintrc': 'json',
    '.babelrc': 'json',
  }
  if (basenameMap[basename]) return basenameMap[basename]

  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return 'plaintext'

  const ext = filePath.substring(dot).toLowerCase()
  return LANGUAGE_MAP[ext] || 'plaintext'
}

/* ── Utility Functions ─────────────────────────────────── */

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function simpleHash(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i)
    hash = ((hash << 5) - hash + ch) | 0
  }
  return (hash >>> 0).toString(36)
}

/** Minimal glob test for include/exclude patterns in search options. */
function testGlob(pattern: string, filePath: string): boolean {
  const parts = pattern.split('*')
  if (parts.length === 1) return filePath.includes(pattern)

  let idx = 0
  for (const part of parts) {
    if (part === '') continue
    const found = filePath.indexOf(part, idx)
    if (found < 0) return false
    idx = found + part.length
  }
  return true
}

/** Yield control back to the event loop (for chunked processing). */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, YIELD_INTERVAL_MS))
}

/* ── Workspace Indexer ─────────────────────────────────── */

export class WorkspaceIndexer implements FileWatcherHook {
  private _rootPath: string
  private _state: IndexingState = 'idle'
  private _files = new Map<string, IndexedFile>()
  private _symbols = new Map<string, IndexedSymbol[]>()
  private _allSymbols: IndexedSymbol[] = []
  private _pathTrie = new PathTrie()
  private _trigramIndex = new TrigramIndex()
  private _ignoreMatcher = new IgnoreMatcher()
  private _progressCbs = new Set<ProgressCallback>()
  private _cancelRequested = false
  private _lastFullIndexMs = 0
  private _lastIncrementalMs = 0
  private _lastCacheTimestamp = 0
  private _disposed = false

  constructor(rootPath: string) {
    this._rootPath = rootPath.replace(/\\/g, '/')
  }

  /* ── Getters ───────────────────────────────────────────── */

  get rootPath(): string { return this._rootPath }
  get state(): IndexingState { return this._state }
  get fileCount(): number { return this._files.size }
  get symbolCount(): number { return this._allSymbols.length }

  /* ── Ignore Configuration ──────────────────────────────── */

  /** Load .gitignore-style patterns. */
  loadIgnorePatterns(content: string): void {
    const patterns = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
    this._ignoreMatcher.addPatterns(patterns)
  }

  /** Set custom ignore patterns. */
  setIgnorePatterns(patterns: string[]): void {
    this._ignoreMatcher.setPatterns(patterns)
  }

  /** Check if a path should be ignored. */
  isIgnored(relativePath: string): boolean {
    return this._ignoreMatcher.isIgnored(relativePath) || this._ignoreMatcher.isBinary(relativePath)
  }

  /* ── Progress Callbacks ────────────────────────────────── */

  onProgress(cb: ProgressCallback): () => void {
    this._progressCbs.add(cb)
    return () => { this._progressCbs.delete(cb) }
  }

  private _emitProgress(progress: IndexingProgress): void {
    for (const cb of this._progressCbs) {
      try { cb(progress) } catch { /* consumer error */ }
    }
  }

  /* ── Full Indexing (background / chunked) ───────────────── */

  /**
   * Index an array of file entries. Uses chunked processing with periodic
   * yields to keep the UI responsive.
   */
  async indexFiles(
    entries: Array<{ path: string; content: string; size?: number; lastModified?: number }>,
  ): Promise<void> {
    if (this._disposed) return
    this._state = 'indexing'
    this._cancelRequested = false
    const startTime = performance.now()

    const total = entries.length
    let processed = 0

    for (let i = 0; i < total; i += CHUNK_SIZE) {
      if (this._cancelRequested) {
        this._state = 'idle'
        return
      }

      const chunk = entries.slice(i, i + CHUNK_SIZE)
      for (const entry of chunk) {
        if (this._cancelRequested) break

        const relativePath = this._toRelative(entry.path)
        if (this._ignoreMatcher.isIgnored(relativePath) || this._ignoreMatcher.isBinary(entry.path)) {
          processed++
          continue
        }

        this._indexSingleFile(entry.path, relativePath, entry.content, entry.size, entry.lastModified)
        processed++
      }

      this._emitProgress({
        phase: processed < total ? 'indexing' : 'finalizing',
        filesTotal: total,
        filesProcessed: processed,
        currentFile: chunk[chunk.length - 1]?.path || '',
        elapsedMs: performance.now() - startTime,
      })

      // Yield to event loop between chunks
      if (i + CHUNK_SIZE < total) {
        await yieldToEventLoop()
      }
    }

    this._rebuildAllSymbols()
    this._lastFullIndexMs = performance.now() - startTime
    this._state = 'idle'
  }

  /** Cancel an ongoing indexing operation. */
  cancelIndexing(): void {
    this._cancelRequested = true
  }

  /** Pause indexing (can be resumed). */
  pauseIndexing(): void {
    if (this._state === 'indexing') {
      this._state = 'paused'
    }
  }

  /** Resume paused indexing. */
  resumeIndexing(): void {
    if (this._state === 'paused') {
      this._state = 'indexing'
    }
  }

  /* ── Incremental Updates ───────────────────────────────── */

  /** Add or update a single file incrementally. */
  addFile(path: string, content: string, size?: number, lastModified?: number): void {
    const start = performance.now()
    const relativePath = this._toRelative(path)
    if (this._ignoreMatcher.isIgnored(relativePath) || this._ignoreMatcher.isBinary(path)) return

    this._indexSingleFile(path, relativePath, content, size, lastModified)
    this._rebuildAllSymbols()
    this._lastIncrementalMs = performance.now() - start
  }

  /** Remove a single file from all indices. */
  removeFile(path: string): void {
    const start = performance.now()
    this._pathTrie.remove(path)
    this._trigramIndex.removeFile(path)
    this._symbols.delete(path)
    this._files.delete(path)
    this._rebuildAllSymbols()
    this._lastIncrementalMs = performance.now() - start
  }

  /** Update a file (remove + add). */
  updateFile(path: string, content: string, size?: number, lastModified?: number): void {
    this.removeFile(path)
    this.addFile(path, content, size, lastModified)
  }

  /* ── FileWatcherHook Implementation ────────────────────── */

  onFileAdded(path: string, content: string): void {
    this.addFile(path, content)
  }

  onFileModified(path: string, content: string): void {
    this.updateFile(path, content)
  }

  onFileDeleted(path: string): void {
    this.removeFile(path)
  }

  onDirectoryAdded(_path: string): void {
    // No-op: files within will trigger onFileAdded individually
  }

  onDirectoryDeleted(path: string): void {
    // Remove all files under this directory
    const prefix = path.endsWith('/') ? path : path + '/'
    const toRemove: string[] = []
    for (const filePath of this._files.keys()) {
      if (filePath.startsWith(prefix)) {
        toRemove.push(filePath)
      }
    }
    for (const fp of toRemove) {
      this.removeFile(fp)
    }
  }

  /* ── Search API ────────────────────────────────────────── */

  /**
   * Unified search across file paths, symbols, and file content.
   * Results are ranked by relevance score and capped at maxResults.
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    if (!query || this._disposed) return []

    const {
      kinds = ['file', 'symbol', 'content'],
      maxResults = DEFAULT_MAX_RESULTS,
      includePattern,
      excludePattern,
      caseSensitive = false,
      regex = false,
      wholeWord = false,
      contextLines = DEFAULT_CONTEXT_LINES,
      exportedOnly = false,
      symbolKinds,
      languages,
    } = options

    const fileFilter = (path: string): boolean => {
      if (includePattern && !testGlob(includePattern, path)) return false
      if (excludePattern && testGlob(excludePattern, path)) return false
      if (languages && languages.length > 0) {
        const file = this._files.get(path)
        if (file && !languages.includes(file.language)) return false
      }
      return true
    }

    const results: SearchResult[] = []

    // 1. File path search
    if (kinds.includes('file')) {
      const fileResults = this._pathTrie.fuzzySearch(query, maxResults)
      for (const fr of fileResults) {
        if (!fileFilter(fr.path)) continue
        const file = this._files.get(fr.path)
        if (file) {
          results.push({
            kind: 'file',
            score: fr.score,
            file,
            matchIndices: fr.indices,
          })
        }
      }
    }

    // 2. Symbol search
    if (kinds.includes('symbol')) {
      const symbolResults = this._searchSymbols(query, {
        maxResults,
        caseSensitive,
        exportedOnly,
        symbolKinds,
        fileFilter,
      })
      for (const sr of symbolResults) {
        results.push({
          kind: 'symbol',
          score: sr.score,
          symbol: sr.symbol,
          matchIndices: sr.indices,
        })
      }
    }

    // 3. Content search
    if (kinds.includes('content')) {
      const contentResults = this._trigramIndex.search(query, {
        caseSensitive,
        regex,
        wholeWord,
        contextLines,
        maxResults,
        fileFilter,
      })
      for (const cr of contentResults) {
        // Score content matches: prefer matches earlier in the file
        const score = 50 - cr.line * 0.01
        results.push({
          kind: 'content',
          score,
          contentMatch: cr,
        })
      }
    }

    // Sort all results by score descending
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, maxResults)
  }

  /** Search only file paths. */
  searchFiles(query: string, maxResults = DEFAULT_MAX_RESULTS): SearchResult[] {
    return this.search(query, { kinds: ['file'], maxResults })
  }

  /** Search only symbols. */
  searchSymbols(query: string, options: Partial<SearchOptions> = {}): SearchResult[] {
    return this.search(query, { ...options, kinds: ['symbol'] })
  }

  /** Search only content. */
  searchContent(query: string, options: Partial<SearchOptions> = {}): SearchResult[] {
    return this.search(query, { ...options, kinds: ['content'] })
  }

  /** Get all symbols for a specific file. */
  getFileSymbols(filePath: string): IndexedSymbol[] {
    return this._symbols.get(filePath) || []
  }

  /** Get indexed file information. */
  getFile(filePath: string): IndexedFile | undefined {
    return this._files.get(filePath)
  }

  /** Get file content from the trigram index. */
  getFileContent(filePath: string): string | undefined {
    return this._trigramIndex.getContent(filePath)
  }

  /** List all indexed file paths. */
  getAllFiles(): string[] {
    return Array.from(this._files.keys())
  }

  /** List all indexed symbols. */
  getAllSymbols(): IndexedSymbol[] {
    return this._allSymbols
  }

  /* ── Statistics ─────────────────────────────────────────── */

  getStats(): IndexStats {
    const langMap = new Map<string, number>()
    for (const file of this._files.values()) {
      langMap.set(file.language, (langMap.get(file.language) || 0) + 1)
    }

    // Estimate memory
    let mem = 0
    // File index
    mem += this._files.size * 300 // avg IndexedFile overhead
    // Symbol index
    mem += this._allSymbols.length * 250 // avg IndexedSymbol overhead
    // Trie
    mem += this._pathTrie.nodeCount * 80
    // Trigram index
    mem += this._trigramIndex.estimateMemory()

    return {
      state: this._state,
      fileCount: this._files.size,
      symbolCount: this._allSymbols.length,
      trigramCount: this._trigramIndex.trigramCount,
      trieNodeCount: this._pathTrie.nodeCount,
      estimatedMemoryBytes: mem,
      indexedLanguages: langMap,
      lastFullIndexMs: this._lastFullIndexMs,
      lastIncrementalMs: this._lastIncrementalMs,
      cacheAgeMs: this._lastCacheTimestamp > 0
        ? Date.now() - this._lastCacheTimestamp
        : -1,
    }
  }

  /* ── Cache / Serialization ─────────────────────────────── */

  /** Serialize the entire index to a JSON-safe object. */
  serialize(): SerializedIndex {
    return {
      version: INDEX_VERSION,
      timestamp: Date.now(),
      rootPath: this._rootPath,
      files: Array.from(this._files.entries()),
      symbols: this._allSymbols,
      trigrams: this._trigramIndex.serialize(),
      ignorePatterns: this._ignoreMatcher.getPatterns(),
    }
  }

  /** Restore index from a serialized snapshot. */
  deserialize(data: SerializedIndex): boolean {
    if (data.version !== INDEX_VERSION) return false
    if (data.rootPath !== this._rootPath) return false

    this.clear()

    // Restore files
    for (const [path, file] of data.files) {
      this._files.set(path, file)
      this._pathTrie.insert(path)
    }

    // Restore symbols
    for (const sym of data.symbols) {
      let list = this._symbols.get(sym.filePath)
      if (!list) {
        list = []
        this._symbols.set(sym.filePath, list)
      }
      list.push(sym)
    }
    this._allSymbols = [...data.symbols]

    // Restore trigrams (contents must be re-loaded separately or pre-populated)
    this._trigramIndex.deserializeTrigrams(data.trigrams)

    // Restore ignore patterns
    this._ignoreMatcher.setPatterns(
      data.ignorePatterns.filter(p => !BUILTIN_IGNORES.includes(p)),
    )

    this._lastCacheTimestamp = data.timestamp
    return true
  }

  /** Serialize to a JSON string. */
  toJSON(): string {
    return JSON.stringify(this.serialize())
  }

  /** Restore from a JSON string. */
  fromJSON(json: string): boolean {
    try {
      const data = JSON.parse(json) as SerializedIndex
      return this.deserialize(data)
    } catch {
      return false
    }
  }

  /* ── Lifecycle ─────────────────────────────────────────── */

  /** Clear all indices. */
  clear(): void {
    this._files.clear()
    this._symbols.clear()
    this._allSymbols = []
    this._pathTrie.clear()
    this._trigramIndex.clear()
    this._state = 'idle'
    this._lastFullIndexMs = 0
    this._lastIncrementalMs = 0
    this._lastCacheTimestamp = 0
  }

  /** Dispose the indexer and free resources. */
  dispose(): void {
    this._disposed = true
    this._cancelRequested = true
    this.clear()
    this._progressCbs.clear()
  }

  /* ── Private Helpers ───────────────────────────────────── */

  /** Index a single file into all sub-indices. */
  private _indexSingleFile(
    path: string,
    relativePath: string,
    content: string,
    size?: number,
    lastModified?: number,
  ): void {
    const language = detectLanguage(path)
    const hash = simpleHash(content)

    // Check if content has changed
    const existing = this._files.get(path)
    if (existing && existing.hash === hash) return

    // Remove old data if updating
    if (existing) {
      this._pathTrie.remove(path)
      this._trigramIndex.removeFile(path)
      this._symbols.delete(path)
    }

    // Extract symbols
    const symbols = extractSymbols(path, content, language)

    // Build IndexedFile
    const indexedFile: IndexedFile = {
      path,
      relativePath,
      language,
      size: size ?? content.length,
      lastModified: lastModified ?? Date.now(),
      hash,
      symbolCount: symbols.length,
    }

    // Store in all indices
    this._files.set(path, indexedFile)
    this._pathTrie.insert(path)
    this._trigramIndex.addFile(path, content)
    if (symbols.length > 0) {
      this._symbols.set(path, symbols)
    }
  }

  /** Rebuild the flat _allSymbols array from the per-file map. */
  private _rebuildAllSymbols(): void {
    const all: IndexedSymbol[] = []
    for (const list of this._symbols.values()) {
      for (const sym of list) {
        all.push(sym)
      }
    }
    this._allSymbols = all
  }

  /** Convert an absolute path to a relative one. */
  private _toRelative(path: string): string {
    const normalized = path.replace(/\\/g, '/')
    if (normalized.startsWith(this._rootPath + '/')) {
      return normalized.substring(this._rootPath.length + 1)
    }
    return normalized
  }

  /** Search symbols by fuzzy name matching. */
  private _searchSymbols(
    query: string,
    options: {
      maxResults: number
      caseSensitive: boolean
      exportedOnly: boolean
      symbolKinds?: SymbolKind[]
      fileFilter: (path: string) => boolean
    },
  ): Array<{ symbol: IndexedSymbol; score: number; indices: number[] }> {
    const { maxResults, caseSensitive, exportedOnly, symbolKinds, fileFilter } = options
    const queryNorm = caseSensitive ? query : query.toLowerCase()
    const results: Array<{ symbol: IndexedSymbol; score: number; indices: number[] }> = []

    for (const sym of this._allSymbols) {
      if (exportedOnly && !sym.exported) continue
      if (symbolKinds && !symbolKinds.includes(sym.kind)) continue
      if (!fileFilter(sym.filePath)) continue

      const target = caseSensitive ? sym.name : sym.nameLower
      const match = fuzzyMatchSymbol(queryNorm, target, sym.name)
      if (match.score > 0) {
        // Boost exported symbols
        const boost = sym.exported ? 1.5 : 1
        results.push({
          symbol: sym,
          score: match.score * boost,
          indices: match.indices,
        })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, maxResults)
  }
}

/* ── Symbol Fuzzy Matching ─────────────────────────────── */

function fuzzyMatchSymbol(queryLower: string, targetLower: string, original: string): FuzzyResult {
  if (queryLower.length === 0) return { score: 0, indices: [] }
  if (queryLower.length > targetLower.length) return { score: 0, indices: [] }

  // Exact match shortcut
  if (queryLower === targetLower) {
    return {
      score: 100 + targetLower.length,
      indices: Array.from({ length: targetLower.length }, (_, i) => i),
    }
  }

  // Prefix match shortcut
  if (targetLower.startsWith(queryLower)) {
    return {
      score: 80 + queryLower.length - targetLower.length * 0.1,
      indices: Array.from({ length: queryLower.length }, (_, i) => i),
    }
  }

  const indices: number[] = []
  let qi = 0
  let score = 0
  let consecutive = 0
  let prevIdx = -2

  for (let ti = 0; ti < targetLower.length && qi < queryLower.length; ti++) {
    if (targetLower[ti] === queryLower[qi]) {
      indices.push(ti)

      // Case match bonus
      score += original[ti] === queryLower[qi] ? 1 : 0.8

      // Consecutive bonus
      if (ti === prevIdx + 1) {
        consecutive++
        score += consecutive * 3
      } else {
        consecutive = 0
      }

      // CamelCase boundary
      if (ti > 0 && original[ti] !== original[ti].toLowerCase() &&
          original[ti - 1] === original[ti - 1].toLowerCase()) {
        score += 5
      }

      // Start of string
      if (ti === 0) score += 10

      prevIdx = ti
      qi++
    } else if (qi > 0) {
      score -= 0.4
    }
  }

  if (qi < queryLower.length) return { score: 0, indices: [] }

  // Penalize long names
  score -= (targetLower.length - queryLower.length) * 0.2

  return { score: Math.max(score, 0.1), indices }
}

/* ── Factory & Singleton ─────────────────────────────────── */

let _defaultInstance: WorkspaceIndexer | null = null

/** Create a new workspace indexer for the given root path. */
export function createWorkspaceIndexer(rootPath: string): WorkspaceIndexer {
  return new WorkspaceIndexer(rootPath)
}

/** Get or create a singleton indexer for the given root path. */
export function getWorkspaceIndexer(rootPath: string): WorkspaceIndexer {
  if (!_defaultInstance || _defaultInstance.rootPath !== rootPath) {
    _defaultInstance?.dispose()
    _defaultInstance = new WorkspaceIndexer(rootPath)
  }
  return _defaultInstance
}

/** Dispose the singleton indexer. */
export function disposeWorkspaceIndexer(): void {
  _defaultInstance?.dispose()
  _defaultInstance = null
}

/* ── Batch Helpers ─────────────────────────────────────── */

/**
 * Scan a flat file list and partition into indexable vs ignored.
 * Useful for pre-filtering before calling indexFiles().
 */
export function partitionFiles(
  indexer: WorkspaceIndexer,
  paths: string[],
): { indexable: string[]; ignored: string[] } {
  const indexable: string[] = []
  const ignored: string[] = []
  for (const p of paths) {
    const rel = p.replace(/\\/g, '/')
    if (indexer.isIgnored(rel)) {
      ignored.push(p)
    } else {
      indexable.push(p)
    }
  }
  return { indexable, ignored }
}

/**
 * Build a search summary string from results.
 * Handy for status bar display.
 */
export function formatSearchSummary(results: SearchResult[], query: string, elapsedMs: number): string {
  const files = results.filter(r => r.kind === 'file').length
  const symbols = results.filter(r => r.kind === 'symbol').length
  const content = results.filter(r => r.kind === 'content').length
  const parts: string[] = []
  if (files > 0) parts.push(`${files} file${files > 1 ? 's' : ''}`)
  if (symbols > 0) parts.push(`${symbols} symbol${symbols > 1 ? 's' : ''}`)
  if (content > 0) parts.push(`${content} match${content > 1 ? 'es' : ''}`)
  if (parts.length === 0) return `No results for "${query}"`
  return `${parts.join(', ')} for "${query}" (${elapsedMs.toFixed(0)}ms)`
}

/**
 * Compute incremental diff between two snapshots of the file system.
 * Returns the minimal set of add/modify/delete operations needed.
 */
export function computeFileDiff(
  oldPaths: Map<string, string>, // path -> hash
  newPaths: Map<string, string>, // path -> hash
): Array<{ path: string; kind: FileChangeKind }> {
  const changes: Array<{ path: string; kind: FileChangeKind }> = []

  for (const [path, hash] of newPaths) {
    const oldHash = oldPaths.get(path)
    if (!oldHash) {
      changes.push({ path, kind: 'added' })
    } else if (oldHash !== hash) {
      changes.push({ path, kind: 'modified' })
    }
  }

  for (const path of oldPaths.keys()) {
    if (!newPaths.has(path)) {
      changes.push({ path, kind: 'deleted' })
    }
  }

  return changes
}

/**
 * Apply a set of file changes to the indexer.
 * Reads content for added/modified files from the provided resolver.
 */
export async function applyFileDiff(
  indexer: WorkspaceIndexer,
  changes: Array<{ path: string; kind: FileChangeKind }>,
  contentResolver: (path: string) => Promise<string | null>,
): Promise<{ applied: number; skipped: number }> {
  let applied = 0
  let skipped = 0

  for (const change of changes) {
    if (change.kind === 'deleted') {
      indexer.removeFile(change.path)
      applied++
      continue
    }

    const content = await contentResolver(change.path)
    if (content === null) {
      skipped++
      continue
    }

    if (change.kind === 'added') {
      indexer.addFile(change.path, content)
    } else {
      indexer.updateFile(change.path, content)
    }
    applied++
  }

  return { applied, skipped }
}

/* ── Re-exports for convenience ──────────────────────────── */

export { detectLanguage, BINARY_EXTENSIONS, BUILTIN_IGNORES, LANGUAGE_MAP }
