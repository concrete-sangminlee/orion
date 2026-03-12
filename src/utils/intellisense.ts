/**
 * Comprehensive intellisense/autocomplete provider system for Orion IDE.
 * Supports multiple completion providers, signature help, auto-imports,
 * intelligent sorting/ranking, and caching.
 */

import { fuzzyMatch } from './fuzzyMatch'

/* ── Cancellation Support ─────────────────────────────── */

export class CancellationToken {
  private _isCancelled = false
  private _listeners: Array<() => void> = []

  get isCancellationRequested(): boolean {
    return this._isCancelled
  }

  cancel(): void {
    if (this._isCancelled) return
    this._isCancelled = true
    for (const listener of this._listeners) {
      try { listener() } catch { /* swallow */ }
    }
    this._listeners = []
  }

  onCancellationRequested(listener: () => void): { dispose: () => void } {
    if (this._isCancelled) {
      listener()
      return { dispose: () => {} }
    }
    this._listeners.push(listener)
    return {
      dispose: () => {
        const idx = this._listeners.indexOf(listener)
        if (idx >= 0) this._listeners.splice(idx, 1)
      },
    }
  }
}

export class CancellationTokenSource {
  readonly token = new CancellationToken()

  cancel(): void {
    this.token.cancel()
  }

  dispose(): void {
    this.cancel()
  }
}

/* ── Enums ────────────────────────────────────────────── */

export enum CompletionItemKind {
  Method = 0,
  Function = 1,
  Constructor = 2,
  Field = 3,
  Variable = 4,
  Class = 5,
  Interface = 6,
  Module = 7,
  Property = 8,
  Unit = 9,
  Value = 10,
  Enum = 11,
  Keyword = 12,
  Snippet = 13,
  Color = 14,
  File = 15,
  Reference = 16,
  Folder = 17,
}

export enum CompletionTriggerKind {
  /** Completion was triggered by typing an identifier or via API. */
  Invoked = 0,
  /** Completion was triggered by a trigger character (e.g. `.`). */
  TriggerCharacter = 1,
  /** Completion was re-triggered as the current list is incomplete. */
  TriggerForIncompleteCompletions = 2,
}

export enum InsertTextFormat {
  PlainText = 1,
  Snippet = 2,
}

export enum SignatureHelpTriggerKind {
  Invoked = 1,
  TriggerCharacter = 2,
  ContentChange = 3,
}

/* ── Core Interfaces ──────────────────────────────────── */

export interface Position {
  line: number
  character: number
}

export interface Range {
  start: Position
  end: Position
}

export interface TextEdit {
  range: Range
  newText: string
}

export interface MarkupContent {
  kind: 'plaintext' | 'markdown'
  value: string
}

export interface CompletionItem {
  label: string
  labelDetails?: {
    detail?: string
    description?: string
  }
  kind: CompletionItemKind
  tags?: number[]
  detail?: string
  documentation?: string | MarkupContent
  deprecated?: boolean
  preselect?: boolean
  sortText?: string
  filterText?: string
  insertText?: string
  insertTextFormat?: InsertTextFormat
  textEdit?: TextEdit
  additionalTextEdits?: TextEdit[]
  commitCharacters?: string[]
  command?: {
    title: string
    command: string
    arguments?: unknown[]
  }
  data?: unknown
  /** Internal: provider source identifier */
  _providerName?: string
  /** Internal: match score for sorting */
  _score?: number
  /** Internal: frequency of use */
  _frequency?: number
}

export interface CompletionList {
  isIncomplete: boolean
  items: CompletionItem[]
}

export interface CompletionContext {
  triggerKind: CompletionTriggerKind
  triggerCharacter?: string
}

export interface DocumentContext {
  uri: string
  languageId: string
  content: string
  lineAt: (line: number) => string
  wordAtPosition: (position: Position) => string | null
  lineCount: number
  fileName: string
  getText: (range?: Range) => string
}

export interface CompletionProvider {
  readonly name: string
  readonly triggerCharacters?: string[]
  readonly priority: number
  provideCompletionItems(
    document: DocumentContext,
    position: Position,
    context: CompletionContext,
    token: CancellationToken
  ): CompletionItem[] | CompletionList | Promise<CompletionItem[] | CompletionList>
  resolveCompletionItem?(
    item: CompletionItem,
    token: CancellationToken
  ): CompletionItem | Promise<CompletionItem>
}

/* ── Signature Help ───────────────────────────────────── */

export interface ParameterInfo {
  label: string | [number, number]
  documentation?: string | MarkupContent
}

export interface SignatureInfo {
  label: string
  documentation?: string | MarkupContent
  parameters: ParameterInfo[]
  activeParameter?: number
}

export interface SignatureHelp {
  signatures: SignatureInfo[]
  activeSignature: number
  activeParameter: number
}

export interface SignatureHelpContext {
  triggerKind: SignatureHelpTriggerKind
  triggerCharacter?: string
  isRetrigger: boolean
  activeSignatureHelp?: SignatureHelp
}

export interface SignatureHelpProvider {
  readonly triggerCharacters: string[]
  readonly retriggerCharacters?: string[]
  provideSignatureHelp(
    document: DocumentContext,
    position: Position,
    context: SignatureHelpContext,
    token: CancellationToken
  ): SignatureHelp | null | Promise<SignatureHelp | null>
}

/* ── Auto-Import Suggestion ───────────────────────────── */

export interface AutoImportSuggestion {
  symbolName: string
  modulePath: string
  isDefault: boolean
  kind: CompletionItemKind
  /** Resolved text edit to insert the import statement */
  importEdit: TextEdit
}

export interface AutoImportProvider {
  readonly name: string
  provideAutoImports(
    document: DocumentContext,
    symbolName: string,
    token: CancellationToken
  ): AutoImportSuggestion[] | Promise<AutoImportSuggestion[]>
}

/* ── Filter Strategies ────────────────────────────────── */

export type FilterStrategy = 'fuzzy' | 'prefix' | 'substring'

export interface FilterOptions {
  strategy: FilterStrategy
  caseSensitive?: boolean
}

function matchesPrefix(word: string, target: string, caseSensitive: boolean): number {
  const w = caseSensitive ? word : word.toLowerCase()
  const t = caseSensitive ? target : target.toLowerCase()
  if (t.startsWith(w)) {
    return 100 + (word.length / target.length) * 50
  }
  return 0
}

function matchesSubstring(word: string, target: string, caseSensitive: boolean): number {
  const w = caseSensitive ? word : word.toLowerCase()
  const t = caseSensitive ? target : target.toLowerCase()
  const idx = t.indexOf(w)
  if (idx >= 0) {
    const positionBonus = idx === 0 ? 50 : 0
    return 50 + positionBonus + (word.length / target.length) * 30
  }
  return 0
}

function matchesFuzzy(word: string, target: string): number {
  const result = fuzzyMatch(word, target)
  return result.score
}

export function filterCompletionItem(
  word: string,
  item: CompletionItem,
  options: FilterOptions
): number {
  const target = item.filterText ?? item.label
  if (word.length === 0) return 1

  switch (options.strategy) {
    case 'prefix':
      return matchesPrefix(word, target, options.caseSensitive ?? false)
    case 'substring':
      return matchesSubstring(word, target, options.caseSensitive ?? false)
    case 'fuzzy':
    default:
      return matchesFuzzy(word, target)
  }
}

/* ── Commit Characters ────────────────────────────────── */

const DEFAULT_COMMIT_CHARACTERS: Record<CompletionItemKind, string[]> = {
  [CompletionItemKind.Method]: ['.', '(', ';'],
  [CompletionItemKind.Function]: ['(', ';'],
  [CompletionItemKind.Constructor]: ['('],
  [CompletionItemKind.Field]: ['.', ';'],
  [CompletionItemKind.Variable]: ['.', ';', '='],
  [CompletionItemKind.Class]: ['.', '('],
  [CompletionItemKind.Interface]: ['.'],
  [CompletionItemKind.Module]: ['.', '/'],
  [CompletionItemKind.Property]: ['.', ';'],
  [CompletionItemKind.Unit]: [],
  [CompletionItemKind.Value]: [';', ','],
  [CompletionItemKind.Enum]: ['.'],
  [CompletionItemKind.Keyword]: [' ', '('],
  [CompletionItemKind.Snippet]: ['\t'],
  [CompletionItemKind.Color]: [';'],
  [CompletionItemKind.File]: ['/', '.'],
  [CompletionItemKind.Reference]: ['.', ';'],
  [CompletionItemKind.Folder]: ['/'],
}

export function getCommitCharacters(kind: CompletionItemKind): string[] {
  return DEFAULT_COMMIT_CHARACTERS[kind] ?? []
}

/* ── Sorting & Ranking ────────────────────────────────── */

const KIND_PRIORITY: Record<CompletionItemKind, number> = {
  [CompletionItemKind.Variable]: 0,
  [CompletionItemKind.Property]: 1,
  [CompletionItemKind.Field]: 2,
  [CompletionItemKind.Method]: 3,
  [CompletionItemKind.Function]: 4,
  [CompletionItemKind.Constructor]: 5,
  [CompletionItemKind.Class]: 6,
  [CompletionItemKind.Interface]: 7,
  [CompletionItemKind.Enum]: 8,
  [CompletionItemKind.Module]: 9,
  [CompletionItemKind.Keyword]: 10,
  [CompletionItemKind.Snippet]: 11,
  [CompletionItemKind.Value]: 12,
  [CompletionItemKind.Unit]: 13,
  [CompletionItemKind.Color]: 14,
  [CompletionItemKind.File]: 15,
  [CompletionItemKind.Folder]: 16,
  [CompletionItemKind.Reference]: 17,
}

export interface SortingWeights {
  /** Weight for match score (0..1). Default: 0.5 */
  score: number
  /** Weight for item kind priority (0..1). Default: 0.2 */
  kind: number
  /** Weight for usage frequency (0..1). Default: 0.2 */
  frequency: number
  /** Weight for preselect items (0..1). Default: 0.1 */
  preselect: number
}

const DEFAULT_WEIGHTS: SortingWeights = {
  score: 0.5,
  kind: 0.2,
  frequency: 0.2,
  preselect: 0.1,
}

function computeSortScore(item: CompletionItem, weights: SortingWeights): number {
  const matchScore = item._score ?? 0
  const normalizedMatchScore = Math.min(matchScore / 200, 1)

  const kindPrio = KIND_PRIORITY[item.kind] ?? 18
  const normalizedKindScore = 1 - kindPrio / 18

  const freqScore = Math.min((item._frequency ?? 0) / 50, 1)
  const preselectScore = item.preselect ? 1 : 0

  return (
    normalizedMatchScore * weights.score +
    normalizedKindScore * weights.kind +
    freqScore * weights.frequency +
    preselectScore * weights.preselect
  )
}

export function sortCompletionItems(
  items: CompletionItem[],
  weights: SortingWeights = DEFAULT_WEIGHTS
): CompletionItem[] {
  return items.slice().sort((a, b) => {
    // Explicit sortText always wins
    if (a.sortText && b.sortText) {
      const cmp = a.sortText.localeCompare(b.sortText)
      if (cmp !== 0) return cmp
    } else if (a.sortText) return -1
    else if (b.sortText) return 1

    // Then by computed score, descending
    const scoreA = computeSortScore(a, weights)
    const scoreB = computeSortScore(b, weights)
    if (scoreB !== scoreA) return scoreB - scoreA

    // Tiebreak: alphabetical label
    return a.label.localeCompare(b.label)
  })
}

/* ── Completion Cache ─────────────────────────────────── */

interface CacheEntry {
  key: string
  items: CompletionItem[]
  isIncomplete: boolean
  timestamp: number
}

export class CompletionCache {
  private _cache = new Map<string, CacheEntry>()
  private _maxSize: number
  private _ttlMs: number

  constructor(maxSize = 50, ttlMs = 30_000) {
    this._maxSize = maxSize
    this._ttlMs = ttlMs
  }

  private _makeKey(uri: string, position: Position, prefix: string): string {
    return `${uri}:${position.line}:${position.character}:${prefix}`
  }

  get(uri: string, position: Position, prefix: string): CacheEntry | null {
    const key = this._makeKey(uri, position, prefix)
    const entry = this._cache.get(key)
    if (!entry) return null
    if (Date.now() - entry.timestamp > this._ttlMs) {
      this._cache.delete(key)
      return null
    }
    return entry
  }

  set(
    uri: string,
    position: Position,
    prefix: string,
    items: CompletionItem[],
    isIncomplete: boolean
  ): void {
    if (this._cache.size >= this._maxSize) {
      // Evict oldest entry
      let oldestKey: string | null = null
      let oldestTime = Infinity
      for (const [k, v] of this._cache) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp
          oldestKey = k
        }
      }
      if (oldestKey) this._cache.delete(oldestKey)
    }

    const key = this._makeKey(uri, position, prefix)
    this._cache.set(key, { key, items, isIncomplete, timestamp: Date.now() })
  }

  invalidate(uri?: string): void {
    if (!uri) {
      this._cache.clear()
      return
    }
    for (const [key] of this._cache) {
      if (key.startsWith(uri)) {
        this._cache.delete(key)
      }
    }
  }

  get size(): number {
    return this._cache.size
  }
}

/* ── Recently Used Completions ────────────────────────── */

export class RecentCompletionTracker {
  private _recentItems: Map<string, { count: number; lastUsed: number }> = new Map()
  private _maxEntries: number

  constructor(maxEntries = 500) {
    this._maxEntries = maxEntries
  }

  record(label: string, kind: CompletionItemKind): void {
    const key = `${kind}:${label}`
    const existing = this._recentItems.get(key)
    if (existing) {
      existing.count++
      existing.lastUsed = Date.now()
    } else {
      if (this._recentItems.size >= this._maxEntries) {
        // Evict LRU entry
        let lruKey: string | null = null
        let lruTime = Infinity
        for (const [k, v] of this._recentItems) {
          if (v.lastUsed < lruTime) {
            lruTime = v.lastUsed
            lruKey = k
          }
        }
        if (lruKey) this._recentItems.delete(lruKey)
      }
      this._recentItems.set(key, { count: 1, lastUsed: Date.now() })
    }
  }

  getFrequency(label: string, kind: CompletionItemKind): number {
    const key = `${kind}:${label}`
    return this._recentItems.get(key)?.count ?? 0
  }

  getRecent(limit = 20): Array<{ label: string; kind: CompletionItemKind; count: number }> {
    const entries = [...this._recentItems.entries()]
      .sort((a, b) => b[1].lastUsed - a[1].lastUsed)
      .slice(0, limit)

    return entries.map(([key, val]) => {
      const colonIdx = key.indexOf(':')
      const kind = parseInt(key.slice(0, colonIdx), 10) as CompletionItemKind
      const label = key.slice(colonIdx + 1)
      return { label, kind, count: val.count }
    })
  }

  clear(): void {
    this._recentItems.clear()
  }

  get size(): number {
    return this._recentItems.size
  }
}

/* ── Documentation Resolver ───────────────────────────── */

export type DocumentationResolverFn = (
  item: CompletionItem,
  token: CancellationToken
) => Promise<string | MarkupContent | null>

export class DocumentationResolver {
  private _resolvers = new Map<string, DocumentationResolverFn>()
  private _docCache = new Map<string, string | MarkupContent>()
  private _maxCacheSize: number

  constructor(maxCacheSize = 200) {
    this._maxCacheSize = maxCacheSize
  }

  registerResolver(providerName: string, resolver: DocumentationResolverFn): void {
    this._resolvers.set(providerName, resolver)
  }

  unregisterResolver(providerName: string): void {
    this._resolvers.delete(providerName)
  }

  async resolve(item: CompletionItem, token: CancellationToken): Promise<CompletionItem> {
    if (item.documentation) return item

    const cacheKey = `${item._providerName ?? ''}:${item.kind}:${item.label}`
    const cached = this._docCache.get(cacheKey)
    if (cached) {
      return { ...item, documentation: cached }
    }

    const providerName = item._providerName ?? ''
    const resolver = this._resolvers.get(providerName)
    if (!resolver) return item

    try {
      const doc = await resolver(item, token)
      if (token.isCancellationRequested) return item
      if (doc) {
        if (this._docCache.size >= this._maxCacheSize) {
          // Evict first entry
          const firstKey = this._docCache.keys().next().value
          if (firstKey !== undefined) this._docCache.delete(firstKey)
        }
        this._docCache.set(cacheKey, doc)
        return { ...item, documentation: doc }
      }
    } catch {
      // Documentation resolution is best-effort
    }

    return item
  }

  clearCache(): void {
    this._docCache.clear()
  }
}

/* ── Built-in Provider: Path Completion ───────────────── */

export class PathCompletionProvider implements CompletionProvider {
  readonly name = 'path'
  readonly triggerCharacters = ['/', '.', "'", '"']
  readonly priority = 80

  private _fileIndex: Map<string, Set<string>> = new Map()

  /**
   * Register known file paths in the workspace, organized by directory.
   */
  setFileIndex(files: string[]): void {
    this._fileIndex.clear()
    for (const filePath of files) {
      const lastSlash = filePath.lastIndexOf('/')
      const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash) : ''
      const name = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath
      if (!this._fileIndex.has(dir)) {
        this._fileIndex.set(dir, new Set())
      }
      this._fileIndex.get(dir)!.add(name)
    }
  }

  provideCompletionItems(
    document: DocumentContext,
    position: Position,
    _context: CompletionContext,
    token: CancellationToken
  ): CompletionItem[] {
    const line = document.lineAt(position.line)
    const textBefore = line.slice(0, position.character)

    // Detect if we're inside an import or require statement
    const importMatch = textBefore.match(
      /(?:from\s+['"]|import\s*\(?['"]|require\s*\(\s*['"])(\.{0,2}\/[^'"]*)?$/
    )
    if (!importMatch) {
      // Also try CSS url() or HTML src attributes
      const urlMatch = textBefore.match(
        /(?:url\(\s*['"]?|src\s*=\s*['"]|href\s*=\s*['"])(\.{0,2}\/[^'"]*)?$/
      )
      if (!urlMatch) return []
    }

    if (token.isCancellationRequested) return []

    // Extract the partial path typed so far
    const pathMatch = textBefore.match(/(\.{0,2}\/[^'"\s]*)$/)
    const partialPath = pathMatch ? pathMatch[1] : ''

    const lastSlash = partialPath.lastIndexOf('/')
    const dirPart = lastSlash >= 0 ? partialPath.slice(0, lastSlash) : ''
    const prefix = lastSlash >= 0 ? partialPath.slice(lastSlash + 1) : ''

    // Resolve directory relative to the current file
    const currentDir = document.fileName.slice(0, document.fileName.lastIndexOf('/'))
    const resolvedDir = this._resolveRelativePath(currentDir, dirPart)

    const items: CompletionItem[] = []

    // List files in the resolved directory
    const filesInDir = this._fileIndex.get(resolvedDir)
    if (filesInDir) {
      for (const name of filesInDir) {
        if (token.isCancellationRequested) return items
        if (prefix && !name.toLowerCase().startsWith(prefix.toLowerCase())) {
          // Still include if fuzzy matches
          const score = matchesFuzzy(prefix, name)
          if (score === 0) continue
        }

        const isDir = this._fileIndex.has(resolvedDir + '/' + name)
        items.push({
          label: name,
          kind: isDir ? CompletionItemKind.Folder : CompletionItemKind.File,
          detail: isDir ? 'Directory' : 'File',
          insertText: name,
          sortText: isDir ? '0' + name : '1' + name,
          commitCharacters: isDir ? ['/'] : undefined,
          _providerName: this.name,
        })
      }
    }

    // Also list subdirectories that match
    for (const [dir] of this._fileIndex) {
      if (dir.startsWith(resolvedDir + '/')) {
        const remaining = dir.slice(resolvedDir.length + 1)
        if (!remaining.includes('/')) {
          if (prefix && !remaining.toLowerCase().startsWith(prefix.toLowerCase())) continue
          if (!items.some(i => i.label === remaining)) {
            items.push({
              label: remaining,
              kind: CompletionItemKind.Folder,
              detail: 'Directory',
              insertText: remaining,
              sortText: '0' + remaining,
              commitCharacters: ['/'],
              _providerName: this.name,
            })
          }
        }
      }
    }

    return items
  }

  private _resolveRelativePath(base: string, relative: string): string {
    if (!relative || relative === '.') return base
    const parts = base.split('/')
    const relParts = relative.split('/')
    for (const p of relParts) {
      if (p === '..') parts.pop()
      else if (p !== '.' && p !== '') parts.push(p)
    }
    return parts.join('/')
  }
}

/* ── Built-in Provider: Word Completion ───────────────── */

export class WordCompletionProvider implements CompletionProvider {
  readonly name = 'word'
  readonly priority = 10
  private _minWordLength: number
  private _maxSuggestions: number

  constructor(minWordLength = 3, maxSuggestions = 50) {
    this._minWordLength = minWordLength
    this._maxSuggestions = maxSuggestions
  }

  provideCompletionItems(
    document: DocumentContext,
    position: Position,
    _context: CompletionContext,
    token: CancellationToken
  ): CompletionItem[] {
    const currentWord = document.wordAtPosition(position)
    if (!currentWord || currentWord.length < 1) return []

    const content = document.content
    const wordRegex = /\b[a-zA-Z_$][\w$]*\b/g
    const wordCounts = new Map<string, number>()
    let match: RegExpExecArray | null

    while ((match = wordRegex.exec(content)) !== null) {
      if (token.isCancellationRequested) return []
      const word = match[0]
      if (word.length < this._minWordLength) continue
      if (word === currentWord) continue
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1)
    }

    // Sort by frequency descending, then alphabetically
    const sortedWords = [...wordCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, this._maxSuggestions)

    return sortedWords.map(([word, count]) => ({
      label: word,
      kind: CompletionItemKind.Value,
      detail: `Word (${count}×)`,
      insertText: word,
      _providerName: this.name,
      _frequency: count,
      sortText: String(1000 - count).padStart(5, '0'),
    }))
  }
}

/* ── Built-in Provider: Snippet Completion ────────────── */

export interface SnippetDefinition {
  name: string
  prefix: string | string[]
  body: string | string[]
  description?: string
  scope?: string
}

export class SnippetCompletionProvider implements CompletionProvider {
  readonly name = 'snippet'
  readonly priority = 60
  private _snippets: Map<string, SnippetDefinition[]> = new Map()

  /**
   * Register snippets for a language.
   */
  registerSnippets(languageId: string, snippets: SnippetDefinition[]): void {
    const existing = this._snippets.get(languageId) ?? []
    this._snippets.set(languageId, [...existing, ...snippets])
  }

  /**
   * Clear all snippets for a language, or all snippets if no language specified.
   */
  clearSnippets(languageId?: string): void {
    if (languageId) {
      this._snippets.delete(languageId)
    } else {
      this._snippets.clear()
    }
  }

  provideCompletionItems(
    document: DocumentContext,
    position: Position,
    _context: CompletionContext,
    token: CancellationToken
  ): CompletionItem[] {
    const langSnippets = this._snippets.get(document.languageId) ?? []
    const globalSnippets = this._snippets.get('*') ?? []
    const allSnippets = [...langSnippets, ...globalSnippets]

    if (allSnippets.length === 0) return []

    const currentWord = document.wordAtPosition(position) ?? ''
    const items: CompletionItem[] = []

    for (const snippet of allSnippets) {
      if (token.isCancellationRequested) return items

      // Check scope restrictions
      if (snippet.scope && !snippet.scope.split(',').map(s => s.trim()).includes(document.languageId)) {
        continue
      }

      const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix]
      for (const prefix of prefixes) {
        // Skip if there's a current word and it doesn't match the prefix
        if (currentWord.length > 0) {
          const score = matchesFuzzy(currentWord, prefix)
          if (score === 0) continue
        }

        const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body

        items.push({
          label: prefix,
          kind: CompletionItemKind.Snippet,
          detail: snippet.name,
          documentation: {
            kind: 'markdown',
            value: [
              snippet.description ?? '',
              '```' + document.languageId,
              this._previewSnippetBody(body),
              '```',
            ]
              .filter(Boolean)
              .join('\n'),
          },
          insertText: body,
          insertTextFormat: InsertTextFormat.Snippet,
          _providerName: this.name,
        })
      }
    }

    return items
  }

  /**
   * Convert snippet body to a preview by stripping tabstop markers.
   */
  private _previewSnippetBody(body: string): string {
    return body
      .replace(/\$\{(\d+)(?::([^}]*))?}/g, (_m, _idx, placeholder) => placeholder ?? '')
      .replace(/\$(\d+)/g, '')
      .replace(/\$\{(\d+)\|([^}]*)\|}/g, (_m, _idx, choices) => choices.split(',')[0] ?? '')
  }
}

/* ── Built-in Provider: Recently Used ─────────────────── */

export class RecentCompletionProvider implements CompletionProvider {
  readonly name = 'recent'
  readonly priority = 50
  private _tracker: RecentCompletionTracker

  constructor(tracker: RecentCompletionTracker) {
    this._tracker = tracker
  }

  provideCompletionItems(
    _document: DocumentContext,
    _position: Position,
    _context: CompletionContext,
    token: CancellationToken
  ): CompletionItem[] {
    const recentItems = this._tracker.getRecent(30)
    if (recentItems.length === 0) return []

    return recentItems
      .filter(() => !token.isCancellationRequested)
      .map((entry, idx) => ({
        label: entry.label,
        kind: entry.kind,
        detail: `Recently used (${entry.count}×)`,
        sortText: String(idx).padStart(5, '0'),
        _providerName: this.name,
        _frequency: entry.count,
        preselect: idx === 0,
      }))
  }
}

/* ── Built-in Provider: Keyword Completion ────────────── */

const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  typescript: [
    'abstract', 'any', 'as', 'asserts', 'async', 'await', 'bigint', 'boolean',
    'break', 'case', 'catch', 'class', 'const', 'constructor', 'continue',
    'debugger', 'declare', 'default', 'delete', 'do', 'else', 'enum', 'export',
    'extends', 'false', 'finally', 'for', 'from', 'function', 'get', 'if',
    'implements', 'import', 'in', 'infer', 'instanceof', 'interface', 'is',
    'keyof', 'let', 'module', 'namespace', 'never', 'new', 'null', 'number',
    'object', 'of', 'override', 'package', 'private', 'protected', 'public',
    'readonly', 'require', 'return', 'satisfies', 'set', 'static', 'string',
    'super', 'switch', 'symbol', 'this', 'throw', 'true', 'try', 'type',
    'typeof', 'undefined', 'unique', 'unknown', 'var', 'void', 'while',
    'with', 'yield',
  ],
  typescriptreact: [], // Inherits from typescript
  javascript: [
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends',
    'false', 'finally', 'for', 'from', 'function', 'get', 'if', 'import',
    'in', 'instanceof', 'let', 'new', 'null', 'of', 'return', 'set',
    'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
    'undefined', 'var', 'void', 'while', 'with', 'yield',
  ],
  javascriptreact: [], // Inherits from javascript
  python: [
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
    'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
    'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
    'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
    'while', 'with', 'yield',
  ],
  rust: [
    'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn',
    'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in',
    'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return',
    'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type',
    'unsafe', 'use', 'where', 'while',
  ],
  go: [
    'break', 'case', 'chan', 'const', 'continue', 'default', 'defer',
    'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import',
    'interface', 'map', 'package', 'range', 'return', 'select', 'struct',
    'switch', 'type', 'var',
  ],
  java: [
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch',
    'char', 'class', 'const', 'continue', 'default', 'do', 'double',
    'else', 'enum', 'extends', 'false', 'final', 'finally', 'float',
    'for', 'if', 'implements', 'import', 'instanceof', 'int', 'interface',
    'long', 'native', 'new', 'null', 'package', 'private', 'protected',
    'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch',
    'synchronized', 'this', 'throw', 'throws', 'transient', 'true', 'try',
    'void', 'volatile', 'while',
  ],
  css: [
    'inherit', 'initial', 'unset', 'revert', 'auto', 'none', 'block',
    'inline', 'flex', 'grid', 'absolute', 'relative', 'fixed', 'sticky',
    'hidden', 'visible', 'solid', 'dashed', 'dotted', 'transparent',
    'important', 'media', 'keyframes', 'supports', 'import',
  ],
  html: [
    'div', 'span', 'p', 'a', 'img', 'input', 'button', 'form',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'footer', 'nav',
    'main', 'section', 'article', 'aside', 'script', 'style', 'link',
    'meta', 'title', 'head', 'body', 'html',
  ],
}

// Inheritance for react variants
LANGUAGE_KEYWORDS['typescriptreact'] = [...LANGUAGE_KEYWORDS['typescript']]
LANGUAGE_KEYWORDS['javascriptreact'] = [...LANGUAGE_KEYWORDS['javascript']]

export class KeywordCompletionProvider implements CompletionProvider {
  readonly name = 'keyword'
  readonly priority = 30

  provideCompletionItems(
    document: DocumentContext,
    position: Position,
    _context: CompletionContext,
    token: CancellationToken
  ): CompletionItem[] {
    const keywords = LANGUAGE_KEYWORDS[document.languageId]
    if (!keywords || keywords.length === 0) return []

    const currentWord = document.wordAtPosition(position)
    if (!currentWord || currentWord.length < 1) return []

    const items: CompletionItem[] = []
    for (const kw of keywords) {
      if (token.isCancellationRequested) return items
      const score = matchesFuzzy(currentWord, kw)
      if (score > 0) {
        items.push({
          label: kw,
          kind: CompletionItemKind.Keyword,
          detail: 'Keyword',
          insertText: kw,
          _providerName: this.name,
          _score: score,
        })
      }
    }

    return items
  }
}

/* ── Auto-Import Provider ─────────────────────────────── */

export interface ExportedSymbol {
  name: string
  kind: CompletionItemKind
  modulePath: string
  isDefault: boolean
}

export class AutoImportCompletionProvider implements CompletionProvider {
  readonly name = 'auto-import'
  readonly priority = 40
  private _symbols: ExportedSymbol[] = []
  private _symbolIndex = new Map<string, ExportedSymbol[]>()

  /**
   * Update the index of exported symbols from all workspace files.
   */
  setExportedSymbols(symbols: ExportedSymbol[]): void {
    this._symbols = symbols
    this._symbolIndex.clear()
    for (const sym of symbols) {
      const key = sym.name.toLowerCase()
      if (!this._symbolIndex.has(key)) {
        this._symbolIndex.set(key, [])
      }
      this._symbolIndex.get(key)!.push(sym)
    }
  }

  provideCompletionItems(
    document: DocumentContext,
    position: Position,
    _context: CompletionContext,
    token: CancellationToken
  ): CompletionItem[] {
    const currentWord = document.wordAtPosition(position)
    if (!currentWord || currentWord.length < 2) return []

    const items: CompletionItem[] = []
    const seen = new Set<string>()

    for (const symbol of this._symbols) {
      if (token.isCancellationRequested) return items

      const score = matchesFuzzy(currentWord, symbol.name)
      if (score === 0) continue

      // Don't suggest symbols from the same file
      if (symbol.modulePath === document.uri) continue

      // Deduplicate by name + module
      const dedupKey = `${symbol.name}:${symbol.modulePath}`
      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)

      const relativePath = this._computeRelativePath(document.fileName, symbol.modulePath)

      const importStatement = symbol.isDefault
        ? `import ${symbol.name} from '${relativePath}'`
        : `import { ${symbol.name} } from '${relativePath}'`

      // Compute the text edit for adding the import at the top of the file
      const importInsertLine = this._findImportInsertPosition(document)

      items.push({
        label: symbol.name,
        kind: symbol.kind,
        detail: `Auto import from '${relativePath}'`,
        labelDetails: {
          description: relativePath,
        },
        insertText: symbol.name,
        additionalTextEdits: [
          {
            range: {
              start: { line: importInsertLine, character: 0 },
              end: { line: importInsertLine, character: 0 },
            },
            newText: importStatement + '\n',
          },
        ],
        _providerName: this.name,
        _score: score,
        data: { modulePath: symbol.modulePath, isDefault: symbol.isDefault },
      })
    }

    return items
  }

  private _computeRelativePath(fromFile: string, toFile: string): string {
    const fromParts = fromFile.split('/').slice(0, -1)
    const toParts = toFile.split('/')

    // Remove file extension from target
    const lastPart = toParts[toParts.length - 1]
    const extIdx = lastPart.lastIndexOf('.')
    if (extIdx > 0) {
      toParts[toParts.length - 1] = lastPart.slice(0, extIdx)
    }

    // Find common prefix length
    let common = 0
    while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
      common++
    }

    const ups = fromParts.length - common
    const prefix = ups === 0 ? './' : '../'.repeat(ups)
    return prefix + toParts.slice(common).join('/')
  }

  private _findImportInsertPosition(document: DocumentContext): number {
    // Find the last import statement and insert after it
    let lastImportLine = -1
    for (let i = 0; i < Math.min(document.lineCount, 100); i++) {
      const line = document.lineAt(i)
      if (/^\s*(import\s|\/\/|\/\*|\*|$)/.test(line)) {
        if (/^\s*import\s/.test(line)) {
          lastImportLine = i
        }
      } else if (lastImportLine >= 0) {
        break
      }
    }
    return lastImportLine >= 0 ? lastImportLine + 1 : 0
  }
}

/* ── Signature Help Provider ──────────────────────────── */

export interface FunctionSignature {
  name: string
  signatures: Array<{
    parameters: Array<{
      name: string
      type?: string
      optional?: boolean
      defaultValue?: string
      documentation?: string
    }>
    returnType?: string
    documentation?: string
  }>
}

export class BuiltinSignatureHelpProvider implements SignatureHelpProvider {
  readonly triggerCharacters = ['(', ',']
  readonly retriggerCharacters = [',', ')']
  private _signatures = new Map<string, FunctionSignature>()

  registerSignature(sig: FunctionSignature): void {
    this._signatures.set(sig.name, sig)
  }

  registerSignatures(sigs: FunctionSignature[]): void {
    for (const sig of sigs) {
      this._signatures.set(sig.name, sig)
    }
  }

  clearSignatures(): void {
    this._signatures.clear()
  }

  provideSignatureHelp(
    document: DocumentContext,
    position: Position,
    context: SignatureHelpContext,
    token: CancellationToken
  ): SignatureHelp | null {
    const line = document.lineAt(position.line)
    const textBefore = line.slice(0, position.character)

    // Find the function name and determine active parameter
    const callInfo = this._parseCallExpression(textBefore)
    if (!callInfo) return null
    if (token.isCancellationRequested) return null

    const funcSig = this._signatures.get(callInfo.functionName)
    if (!funcSig) return null

    const activeParameter = callInfo.parameterIndex

    // Find the best matching signature based on parameter count
    let activeSignature = 0
    for (let i = 0; i < funcSig.signatures.length; i++) {
      const paramCount = funcSig.signatures[i].parameters.length
      if (activeParameter < paramCount) {
        activeSignature = i
        break
      }
    }

    // If retrigger, prefer the previously active signature
    if (context.isRetrigger && context.activeSignatureHelp) {
      activeSignature = context.activeSignatureHelp.activeSignature
    }

    const signatures: SignatureInfo[] = funcSig.signatures.map((sig) => {
      const paramLabels = sig.parameters.map((p) => {
        let label = p.name
        if (p.type) label += `: ${p.type}`
        if (p.optional) label += '?'
        if (p.defaultValue) label += ` = ${p.defaultValue}`
        return label
      })

      const fullLabel = `${callInfo.functionName}(${paramLabels.join(', ')})`
      const returnSuffix = sig.returnType ? `: ${sig.returnType}` : ''

      return {
        label: fullLabel + returnSuffix,
        documentation: sig.documentation
          ? { kind: 'markdown' as const, value: sig.documentation }
          : undefined,
        parameters: sig.parameters.map((p) => {
          let paramLabel = p.name
          if (p.type) paramLabel += `: ${p.type}`
          if (p.optional) paramLabel += '?'
          if (p.defaultValue) paramLabel += ` = ${p.defaultValue}`
          return {
            label: paramLabel,
            documentation: p.documentation
              ? { kind: 'markdown' as const, value: p.documentation }
              : undefined,
          }
        }),
        activeParameter,
      }
    })

    return {
      signatures,
      activeSignature,
      activeParameter,
    }
  }

  private _parseCallExpression(
    text: string
  ): { functionName: string; parameterIndex: number } | null {
    // Walk backwards to find the matching open paren
    let depth = 0
    let commaCount = 0
    let parenPos = -1

    for (let i = text.length - 1; i >= 0; i--) {
      const ch = text[i]
      if (ch === ')') depth++
      else if (ch === '(') {
        if (depth === 0) {
          parenPos = i
          break
        }
        depth--
      } else if (ch === ',' && depth === 0) {
        commaCount++
      }
    }

    if (parenPos < 0) return null

    // Extract function name before the open paren
    const beforeParen = text.slice(0, parenPos).trimEnd()
    const nameMatch = beforeParen.match(/([a-zA-Z_$][\w$.]*)$/)
    if (!nameMatch) return null

    return {
      functionName: nameMatch[1],
      parameterIndex: commaCount,
    }
  }
}

/* ── Completion Provider Registry ─────────────────────── */

interface RegisteredProvider {
  provider: CompletionProvider
  languages: Set<string> | null // null means all languages
  disposable: { dispose: () => void }
}

export class CompletionProviderRegistry {
  private _providers: RegisteredProvider[] = []

  /**
   * Register a completion provider for specific languages.
   * Pass `['*']` or omit languages to register for all languages.
   */
  register(
    provider: CompletionProvider,
    languages?: string[]
  ): { dispose: () => void } {
    const langSet = languages && !languages.includes('*')
      ? new Set(languages)
      : null

    const entry: RegisteredProvider = {
      provider,
      languages: langSet,
      disposable: {
        dispose: () => {
          const idx = this._providers.indexOf(entry)
          if (idx >= 0) this._providers.splice(idx, 1)
        },
      },
    }

    this._providers.push(entry)
    // Keep sorted by priority descending
    this._providers.sort((a, b) => b.provider.priority - a.provider.priority)

    return entry.disposable
  }

  /**
   * Get all providers registered for a given language, sorted by priority.
   */
  getProviders(languageId: string): CompletionProvider[] {
    return this._providers
      .filter((entry) => entry.languages === null || entry.languages.has(languageId))
      .map((entry) => entry.provider)
  }

  /**
   * Get all trigger characters across all providers for a language.
   */
  getTriggerCharacters(languageId: string): Set<string> {
    const chars = new Set<string>()
    for (const provider of this.getProviders(languageId)) {
      if (provider.triggerCharacters) {
        for (const ch of provider.triggerCharacters) {
          chars.add(ch)
        }
      }
    }
    return chars
  }

  /**
   * Clear all registered providers.
   */
  clear(): void {
    this._providers = []
  }

  get count(): number {
    return this._providers.length
  }
}

/* ── Signature Help Provider Registry ─────────────────── */

export class SignatureHelpProviderRegistry {
  private _providers: Array<{
    provider: SignatureHelpProvider
    languages: Set<string> | null
  }> = []

  register(
    provider: SignatureHelpProvider,
    languages?: string[]
  ): { dispose: () => void } {
    const langSet = languages && !languages.includes('*')
      ? new Set(languages)
      : null

    const entry = { provider, languages: langSet }
    this._providers.push(entry)

    return {
      dispose: () => {
        const idx = this._providers.indexOf(entry)
        if (idx >= 0) this._providers.splice(idx, 1)
      },
    }
  }

  getProviders(languageId: string): SignatureHelpProvider[] {
    return this._providers
      .filter((entry) => entry.languages === null || entry.languages.has(languageId))
      .map((entry) => entry.provider)
  }

  getTriggerCharacters(languageId: string): Set<string> {
    const chars = new Set<string>()
    for (const provider of this.getProviders(languageId)) {
      for (const ch of provider.triggerCharacters) {
        chars.add(ch)
      }
      if (provider.retriggerCharacters) {
        for (const ch of provider.retriggerCharacters) {
          chars.add(ch)
        }
      }
    }
    return chars
  }

  clear(): void {
    this._providers = []
  }
}

/* ── Completion Engine ────────────────────────────────── */

export interface CompletionEngineOptions {
  /** Maximum number of items to return. Default: 100 */
  maxItems?: number
  /** Filter strategy. Default: 'fuzzy' */
  filterStrategy?: FilterStrategy
  /** Whether filtering is case-sensitive. Default: false */
  caseSensitive?: boolean
  /** Sorting weights. Uses defaults if not specified. */
  sortingWeights?: SortingWeights
  /** Cache TTL in milliseconds. Default: 30000 */
  cacheTtlMs?: number
  /** Maximum cache size. Default: 50 */
  cacheMaxSize?: number
  /** Enable caching. Default: true */
  cacheEnabled?: boolean
}

export class CompletionEngine {
  private _registry = new CompletionProviderRegistry()
  private _signatureRegistry = new SignatureHelpProviderRegistry()
  private _cache: CompletionCache
  private _recentTracker = new RecentCompletionTracker()
  private _docResolver = new DocumentationResolver()
  private _autoImportProviders: AutoImportProvider[] = []
  private _currentCancellation: CancellationTokenSource | null = null
  private _options: Required<CompletionEngineOptions>

  constructor(options: CompletionEngineOptions = {}) {
    this._options = {
      maxItems: options.maxItems ?? 100,
      filterStrategy: options.filterStrategy ?? 'fuzzy',
      caseSensitive: options.caseSensitive ?? false,
      sortingWeights: options.sortingWeights ?? DEFAULT_WEIGHTS,
      cacheTtlMs: options.cacheTtlMs ?? 30_000,
      cacheMaxSize: options.cacheMaxSize ?? 50,
      cacheEnabled: options.cacheEnabled ?? true,
    }

    this._cache = new CompletionCache(this._options.cacheMaxSize, this._options.cacheTtlMs)
  }

  /* ── Provider Registration ── */

  get registry(): CompletionProviderRegistry {
    return this._registry
  }

  get signatureRegistry(): SignatureHelpProviderRegistry {
    return this._signatureRegistry
  }

  get recentTracker(): RecentCompletionTracker {
    return this._recentTracker
  }

  get documentationResolver(): DocumentationResolver {
    return this._docResolver
  }

  /**
   * Register a completion provider for specific languages.
   */
  registerProvider(provider: CompletionProvider, languages?: string[]): { dispose: () => void } {
    return this._registry.register(provider, languages)
  }

  /**
   * Register a signature help provider.
   */
  registerSignatureProvider(
    provider: SignatureHelpProvider,
    languages?: string[]
  ): { dispose: () => void } {
    return this._signatureRegistry.register(provider, languages)
  }

  /**
   * Register an auto-import provider.
   */
  registerAutoImportProvider(provider: AutoImportProvider): { dispose: () => void } {
    this._autoImportProviders.push(provider)
    return {
      dispose: () => {
        const idx = this._autoImportProviders.indexOf(provider)
        if (idx >= 0) this._autoImportProviders.splice(idx, 1)
      },
    }
  }

  /**
   * Register all built-in providers with sensible defaults.
   */
  registerBuiltinProviders(): {
    path: PathCompletionProvider
    word: WordCompletionProvider
    snippet: SnippetCompletionProvider
    recent: RecentCompletionProvider
    keyword: KeywordCompletionProvider
    autoImport: AutoImportCompletionProvider
    signature: BuiltinSignatureHelpProvider
  } {
    const path = new PathCompletionProvider()
    const word = new WordCompletionProvider()
    const snippet = new SnippetCompletionProvider()
    const recent = new RecentCompletionProvider(this._recentTracker)
    const keyword = new KeywordCompletionProvider()
    const autoImport = new AutoImportCompletionProvider()
    const signature = new BuiltinSignatureHelpProvider()

    this.registerProvider(path, ['*'])
    this.registerProvider(word, ['*'])
    this.registerProvider(snippet, ['*'])
    this.registerProvider(recent, ['*'])
    this.registerProvider(keyword, ['*'])
    this.registerProvider(autoImport, ['*'])
    this.registerSignatureProvider(signature, ['*'])

    return { path, word, snippet, recent, keyword, autoImport, signature }
  }

  /* ── Completion Retrieval ── */

  /**
   * Cancel any in-flight completion requests.
   */
  cancelCurrentRequest(): void {
    if (this._currentCancellation) {
      this._currentCancellation.cancel()
      this._currentCancellation = null
    }
  }

  /**
   * Request completions at the given position.
   */
  async provideCompletions(
    document: DocumentContext,
    position: Position,
    context: CompletionContext
  ): Promise<CompletionList> {
    // Cancel any previous in-flight request
    this.cancelCurrentRequest()

    const tokenSource = new CancellationTokenSource()
    this._currentCancellation = tokenSource
    const token = tokenSource.token

    try {
      const currentWord = document.wordAtPosition(position) ?? ''

      // Check cache first (only for incremental typing, not trigger characters)
      if (
        this._options.cacheEnabled &&
        context.triggerKind !== CompletionTriggerKind.TriggerCharacter
      ) {
        const cached = this._cache.get(document.uri, position, currentWord)
        if (cached && !cached.isIncomplete) {
          // Re-filter and re-sort cached items against the current prefix
          const filtered = this._filterAndScore(cached.items, currentWord)
          const sorted = sortCompletionItems(filtered, this._options.sortingWeights)
          return {
            isIncomplete: false,
            items: sorted.slice(0, this._options.maxItems),
          }
        }
      }

      // Collect items from all providers
      const providers = this._registry.getProviders(document.languageId)
      const allItems: CompletionItem[] = []
      let isIncomplete = false

      // Run providers in parallel, grouped by priority tiers
      const providerPromises = providers.map(async (provider) => {
        if (token.isCancellationRequested) return

        // Skip providers that don't match the trigger character
        if (
          context.triggerKind === CompletionTriggerKind.TriggerCharacter &&
          context.triggerCharacter &&
          provider.triggerCharacters &&
          !provider.triggerCharacters.includes(context.triggerCharacter)
        ) {
          return
        }

        try {
          const result = await Promise.resolve(
            provider.provideCompletionItems(document, position, context, token)
          )
          if (token.isCancellationRequested) return

          if (Array.isArray(result)) {
            for (const item of result) {
              item._providerName = item._providerName ?? provider.name
              allItems.push(item)
            }
          } else if (result) {
            if (result.isIncomplete) isIncomplete = true
            for (const item of result.items) {
              item._providerName = item._providerName ?? provider.name
              allItems.push(item)
            }
          }
        } catch (err) {
          console.warn(`[Intellisense] Provider "${provider.name}" threw:`, err)
        }
      })

      await Promise.all(providerPromises)
      if (token.isCancellationRequested) return { isIncomplete: true, items: [] }

      // Deduplicate: higher priority provider wins
      const deduplicated = this._deduplicateItems(allItems, providers)

      // Assign commit characters from defaults if not set
      for (const item of deduplicated) {
        if (!item.commitCharacters) {
          item.commitCharacters = getCommitCharacters(item.kind)
        }
      }

      // Apply frequency data from recent tracker
      for (const item of deduplicated) {
        if (item._frequency === undefined) {
          item._frequency = this._recentTracker.getFrequency(item.label, item.kind)
        }
      }

      // Filter and score
      const filtered = this._filterAndScore(deduplicated, currentWord)

      // Sort
      const sorted = sortCompletionItems(filtered, this._options.sortingWeights)

      // Trim to max
      const trimmed = sorted.slice(0, this._options.maxItems)

      // Cache the result
      if (this._options.cacheEnabled) {
        this._cache.set(document.uri, position, currentWord, deduplicated, isIncomplete)
      }

      return { isIncomplete, items: trimmed }
    } finally {
      if (this._currentCancellation === tokenSource) {
        this._currentCancellation = null
      }
    }
  }

  /**
   * Resolve additional details for a completion item (lazy documentation).
   */
  async resolveCompletionItem(item: CompletionItem): Promise<CompletionItem> {
    const tokenSource = new CancellationTokenSource()
    const token = tokenSource.token

    try {
      // First try provider-specific resolution
      if (item._providerName) {
        const providers = this._registry.getProviders('*')
        for (const provider of providers) {
          if (provider.name === item._providerName && provider.resolveCompletionItem) {
            const resolved = await provider.resolveCompletionItem(item, token)
            if (resolved.documentation) return resolved
          }
        }
      }

      // Fall back to documentation resolver
      return await this._docResolver.resolve(item, token)
    } finally {
      tokenSource.dispose()
    }
  }

  /**
   * Record that a completion item was accepted/committed.
   */
  acceptCompletion(item: CompletionItem): void {
    this._recentTracker.record(item.label, item.kind)
  }

  /* ── Signature Help ── */

  /**
   * Request signature help at the given position.
   */
  async provideSignatureHelp(
    document: DocumentContext,
    position: Position,
    context: SignatureHelpContext
  ): Promise<SignatureHelp | null> {
    const tokenSource = new CancellationTokenSource()
    const token = tokenSource.token

    try {
      const providers = this._signatureRegistry.getProviders(document.languageId)

      for (const provider of providers) {
        if (token.isCancellationRequested) return null

        try {
          const result = await Promise.resolve(
            provider.provideSignatureHelp(document, position, context, token)
          )
          if (result) return result
        } catch (err) {
          console.warn('[Intellisense] Signature help provider threw:', err)
        }
      }

      return null
    } finally {
      tokenSource.dispose()
    }
  }

  /* ── Auto-Import ── */

  /**
   * Suggest auto-imports for an unresolved symbol.
   */
  async suggestAutoImports(
    document: DocumentContext,
    symbolName: string
  ): Promise<AutoImportSuggestion[]> {
    const tokenSource = new CancellationTokenSource()
    const token = tokenSource.token

    try {
      const allSuggestions: AutoImportSuggestion[] = []

      for (const provider of this._autoImportProviders) {
        if (token.isCancellationRequested) break
        try {
          const suggestions = await Promise.resolve(
            provider.provideAutoImports(document, symbolName, token)
          )
          allSuggestions.push(...suggestions)
        } catch (err) {
          console.warn(`[Intellisense] Auto-import provider "${provider.name}" threw:`, err)
        }
      }

      return allSuggestions
    } finally {
      tokenSource.dispose()
    }
  }

  /* ── Cache Management ── */

  /**
   * Invalidate cached completions for a document, or all cached completions.
   */
  invalidateCache(uri?: string): void {
    this._cache.invalidate(uri)
  }

  /* ── Internal Helpers ── */

  private _filterAndScore(items: CompletionItem[], word: string): CompletionItem[] {
    if (word.length === 0) return items

    const filterOpts: FilterOptions = {
      strategy: this._options.filterStrategy,
      caseSensitive: this._options.caseSensitive,
    }

    const scored: CompletionItem[] = []
    for (const item of items) {
      const score = filterCompletionItem(word, item, filterOpts)
      if (score > 0) {
        scored.push({ ...item, _score: score })
      }
    }

    return scored
  }

  private _deduplicateItems(
    items: CompletionItem[],
    providers: CompletionProvider[]
  ): CompletionItem[] {
    // Build a priority map for quick lookup
    const priorityMap = new Map<string, number>()
    for (const p of providers) {
      priorityMap.set(p.name, p.priority)
    }

    const seen = new Map<string, CompletionItem>()
    for (const item of items) {
      const key = `${item.kind}:${item.label}`
      const existing = seen.get(key)
      if (!existing) {
        seen.set(key, item)
      } else {
        // Keep the item from the higher-priority provider
        const existPrio = priorityMap.get(existing._providerName ?? '') ?? 0
        const newPrio = priorityMap.get(item._providerName ?? '') ?? 0
        if (newPrio > existPrio) {
          seen.set(key, item)
        }
      }
    }

    return [...seen.values()]
  }

  /**
   * Dispose the engine and all internal state.
   */
  dispose(): void {
    this.cancelCurrentRequest()
    this._registry.clear()
    this._signatureRegistry.clear()
    this._cache.invalidate()
    this._recentTracker.clear()
    this._docResolver.clearCache()
    this._autoImportProviders = []
  }
}

/* ── Helper: Create DocumentContext from raw data ─────── */

export function createDocumentContext(opts: {
  uri: string
  languageId: string
  content: string
  fileName: string
}): DocumentContext {
  const lines = opts.content.split('\n')

  return {
    uri: opts.uri,
    languageId: opts.languageId,
    content: opts.content,
    fileName: opts.fileName,
    lineCount: lines.length,
    lineAt: (line: number) => lines[line] ?? '',
    wordAtPosition: (position: Position) => {
      const lineText = lines[position.line] ?? ''
      // Walk backwards from position to find word start
      let start = position.character
      while (start > 0 && /[\w$]/.test(lineText[start - 1])) start--
      // Walk forwards to find word end
      let end = position.character
      while (end < lineText.length && /[\w$]/.test(lineText[end])) end++
      if (start === end) return null
      return lineText.slice(start, end)
    },
    getText: (range?: Range) => {
      if (!range) return opts.content
      const startLine = range.start.line
      const endLine = range.end.line
      if (startLine === endLine) {
        return (lines[startLine] ?? '').slice(range.start.character, range.end.character)
      }
      const result: string[] = []
      result.push((lines[startLine] ?? '').slice(range.start.character))
      for (let i = startLine + 1; i < endLine; i++) {
        result.push(lines[i] ?? '')
      }
      result.push((lines[endLine] ?? '').slice(0, range.end.character))
      return result.join('\n')
    },
  }
}

/* ── Factory: Create a pre-configured engine ──────────── */

export function createIntellisenseEngine(
  options?: CompletionEngineOptions
): {
  engine: CompletionEngine
  providers: {
    path: PathCompletionProvider
    word: WordCompletionProvider
    snippet: SnippetCompletionProvider
    recent: RecentCompletionProvider
    keyword: KeywordCompletionProvider
    autoImport: AutoImportCompletionProvider
    signature: BuiltinSignatureHelpProvider
  }
} {
  const engine = new CompletionEngine(options)
  const providers = engine.registerBuiltinProviders()
  return { engine, providers }
}
