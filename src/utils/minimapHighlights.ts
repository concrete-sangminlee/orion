/**
 * Minimap highlight decorations for the Monaco editor.
 * Provides search result highlights, git changes, bookmarks,
 * breakpoints, and error markers in the minimap/overview ruler.
 */

import type { editor as MonacoEditor, IDisposable } from 'monaco-editor'

/* ── Types ─────────────────────────────────────────────── */

export type HighlightCategory =
  | 'search'
  | 'gitAdded'
  | 'gitModified'
  | 'gitDeleted'
  | 'error'
  | 'warning'
  | 'info'
  | 'bookmark'
  | 'breakpoint'
  | 'findMatch'
  | 'selection'
  | 'bracket'
  | 'wordHighlight'
  | 'custom'

export interface MinimapHighlight {
  line: number
  endLine?: number
  category: HighlightCategory
  color?: string
  tooltip?: string
}

export interface HighlightTheme {
  search: string
  gitAdded: string
  gitModified: string
  gitDeleted: string
  error: string
  warning: string
  info: string
  bookmark: string
  breakpoint: string
  findMatch: string
  selection: string
  bracket: string
  wordHighlight: string
  custom: string
}

const DEFAULT_THEME: HighlightTheme = {
  search: '#f8e45c',
  gitAdded: '#2ea04370',
  gitModified: '#0078d470',
  gitDeleted: '#f8514970',
  error: '#f85149',
  warning: '#d29922',
  info: '#58a6ff',
  bookmark: '#a371f7',
  breakpoint: '#f85149',
  findMatch: '#f8e45c80',
  selection: '#264f78',
  bracket: '#ffd70050',
  wordHighlight: '#575757',
  custom: '#8b949e',
}

/* ── Minimap Decoration Manager ────────────────────────── */

export class MinimapHighlightManager {
  private editor: MonacoEditor.IStandaloneCodeEditor
  private decorationCollections = new Map<HighlightCategory, MonacoEditor.IEditorDecorationsCollection>()
  private theme: HighlightTheme
  private disposables: IDisposable[] = []

  constructor(
    editor: MonacoEditor.IStandaloneCodeEditor,
    theme?: Partial<HighlightTheme>
  ) {
    this.editor = editor
    this.theme = { ...DEFAULT_THEME, ...theme }
  }

  /** Set highlights for a category, replacing any existing ones */
  setHighlights(category: HighlightCategory, highlights: MinimapHighlight[]): void {
    // Clear existing decorations for this category
    this.clearCategory(category)

    if (highlights.length === 0) return

    const color = this.theme[category] || this.theme.custom
    const position = this.getOverviewRulerLane(category)

    const decorations: MonacoEditor.IModelDeltaDecoration[] = highlights.map(h => ({
      range: {
        startLineNumber: h.line,
        startColumn: 1,
        endLineNumber: h.endLine || h.line,
        endColumn: 1,
      },
      options: {
        isWholeLine: true,
        overviewRuler: {
          color: h.color || color,
          position,
        },
        minimap: {
          color: h.color || color,
          position: 2, // MinimapPosition.Gutter = 1, Inline = 2
        },
        hoverMessage: h.tooltip ? { value: h.tooltip } : undefined,
        glyphMarginClassName: this.getGlyphClass(category),
      },
    }))

    const collection = this.editor.createDecorationsCollection(decorations)
    this.decorationCollections.set(category, collection)
  }

  /** Add highlights without clearing existing ones in the category */
  addHighlights(category: HighlightCategory, highlights: MinimapHighlight[]): void {
    const existing = this.getHighlights(category)
    this.setHighlights(category, [...existing, ...highlights])
  }

  /** Get current highlights for a category */
  getHighlights(category: HighlightCategory): MinimapHighlight[] {
    const collection = this.decorationCollections.get(category)
    if (!collection) return []

    const ranges = collection.getRanges()
    return ranges.map(range => ({
      line: range.startLineNumber,
      endLine: range.endLineNumber,
      category,
    }))
  }

  /** Clear all highlights for a category */
  clearCategory(category: HighlightCategory): void {
    const collection = this.decorationCollections.get(category)
    if (collection) {
      collection.clear()
      this.decorationCollections.delete(category)
    }
  }

  /** Clear all highlights */
  clearAll(): void {
    for (const [, collection] of this.decorationCollections) {
      collection.clear()
    }
    this.decorationCollections.clear()
  }

  /** Update theme colors */
  setTheme(theme: Partial<HighlightTheme>): void {
    this.theme = { ...this.theme, ...theme }
    // Re-apply all existing highlights with new colors
    for (const [category] of this.decorationCollections) {
      const highlights = this.getHighlights(category)
      this.setHighlights(category, highlights)
    }
  }

  /** Dispose all resources */
  dispose(): void {
    this.clearAll()
    this.disposables.forEach(d => d.dispose())
    this.disposables = []
  }

  private getOverviewRulerLane(category: HighlightCategory): number {
    // OverviewRulerLane: Left = 1, Center = 2, Right = 4, Full = 7
    switch (category) {
      case 'error':
      case 'warning':
      case 'info':
        return 1 // Left lane
      case 'search':
      case 'findMatch':
      case 'wordHighlight':
        return 2 // Center lane
      case 'gitAdded':
      case 'gitModified':
      case 'gitDeleted':
        return 4 // Right lane
      default:
        return 7 // Full
    }
  }

  private getGlyphClass(category: HighlightCategory): string | undefined {
    switch (category) {
      case 'breakpoint': return 'minimap-breakpoint-glyph'
      case 'bookmark': return 'minimap-bookmark-glyph'
      case 'error': return 'minimap-error-glyph'
      case 'warning': return 'minimap-warning-glyph'
      default: return undefined
    }
  }
}

/* ── Search Result Highlighter ─────────────────────────── */

export class SearchHighlighter {
  private manager: MinimapHighlightManager
  private editor: MonacoEditor.IStandaloneCodeEditor
  private disposables: IDisposable[] = []

  constructor(editor: MonacoEditor.IStandaloneCodeEditor, manager: MinimapHighlightManager) {
    this.editor = editor
    this.manager = manager
  }

  /** Highlight all occurrences of a search term */
  highlightSearchResults(
    query: string,
    options: { caseSensitive?: boolean; wholeWord?: boolean; isRegex?: boolean } = {}
  ): number {
    const model = this.editor.getModel()
    if (!model || !query) {
      this.manager.clearCategory('search')
      return 0
    }

    let regex: RegExp
    try {
      const pattern = options.isRegex ? query : escapeRegex(query)
      const flags = options.caseSensitive ? 'g' : 'gi'
      const finalPattern = options.wholeWord ? `\\b${pattern}\\b` : pattern
      regex = new RegExp(finalPattern, flags)
    } catch {
      this.manager.clearCategory('search')
      return 0
    }

    const highlights: MinimapHighlight[] = []
    const lineCount = model.getLineCount()

    for (let i = 1; i <= lineCount && highlights.length < 10000; i++) {
      const content = model.getLineContent(i)
      if (regex.test(content)) {
        highlights.push({
          line: i,
          category: 'search',
          tooltip: `Search match on line ${i}`,
        })
      }
      regex.lastIndex = 0
    }

    this.manager.setHighlights('search', highlights)
    return highlights.length
  }

  /** Clear search highlights */
  clear(): void {
    this.manager.clearCategory('search')
  }

  dispose(): void {
    this.clear()
    this.disposables.forEach(d => d.dispose())
  }
}

/* ── Git Change Highlighter ────────────────────────────── */

export interface GitLineChange {
  type: 'added' | 'modified' | 'deleted'
  startLine: number
  endLine: number
}

export class GitChangeHighlighter {
  private manager: MinimapHighlightManager

  constructor(manager: MinimapHighlightManager) {
    this.manager = manager
  }

  /** Update git change indicators */
  setChanges(changes: GitLineChange[]): void {
    const added: MinimapHighlight[] = []
    const modified: MinimapHighlight[] = []
    const deleted: MinimapHighlight[] = []

    for (const change of changes) {
      const highlight: MinimapHighlight = {
        line: change.startLine,
        endLine: change.endLine,
        category: change.type === 'added' ? 'gitAdded' : change.type === 'modified' ? 'gitModified' : 'gitDeleted',
        tooltip: `${change.type}: lines ${change.startLine}-${change.endLine}`,
      }

      switch (change.type) {
        case 'added': added.push(highlight); break
        case 'modified': modified.push(highlight); break
        case 'deleted': deleted.push(highlight); break
      }
    }

    this.manager.setHighlights('gitAdded', added)
    this.manager.setHighlights('gitModified', modified)
    this.manager.setHighlights('gitDeleted', deleted)
  }

  /** Clear git highlights */
  clear(): void {
    this.manager.clearCategory('gitAdded')
    this.manager.clearCategory('gitModified')
    this.manager.clearCategory('gitDeleted')
  }
}

/* ── Diagnostic Highlighter ────────────────────────────── */

export interface DiagnosticMark {
  line: number
  severity: 'error' | 'warning' | 'info'
  message: string
}

export class DiagnosticHighlighter {
  private manager: MinimapHighlightManager

  constructor(manager: MinimapHighlightManager) {
    this.manager = manager
  }

  /** Update diagnostic markers */
  setDiagnostics(diagnostics: DiagnosticMark[]): void {
    const errors: MinimapHighlight[] = []
    const warnings: MinimapHighlight[] = []
    const infos: MinimapHighlight[] = []

    for (const diag of diagnostics) {
      const highlight: MinimapHighlight = {
        line: diag.line,
        category: diag.severity,
        tooltip: `${diag.severity}: ${diag.message}`,
      }

      switch (diag.severity) {
        case 'error': errors.push(highlight); break
        case 'warning': warnings.push(highlight); break
        case 'info': infos.push(highlight); break
      }
    }

    this.manager.setHighlights('error', errors)
    this.manager.setHighlights('warning', warnings)
    this.manager.setHighlights('info', infos)
  }

  /** Clear diagnostic highlights */
  clear(): void {
    this.manager.clearCategory('error')
    this.manager.clearCategory('warning')
    this.manager.clearCategory('info')
  }
}

/* ── Bookmark Manager ──────────────────────────────────── */

export class BookmarkHighlighter {
  private manager: MinimapHighlightManager
  private bookmarks = new Map<string, Set<number>>() // filePath -> line numbers

  constructor(manager: MinimapHighlightManager) {
    this.manager = manager
  }

  /** Toggle bookmark on a line */
  toggle(filePath: string, line: number): boolean {
    if (!this.bookmarks.has(filePath)) {
      this.bookmarks.set(filePath, new Set())
    }
    const fileBookmarks = this.bookmarks.get(filePath)!

    if (fileBookmarks.has(line)) {
      fileBookmarks.delete(line)
      this.refresh(filePath)
      return false
    } else {
      fileBookmarks.add(line)
      this.refresh(filePath)
      return true
    }
  }

  /** Get all bookmarks for a file */
  getBookmarks(filePath: string): number[] {
    return [...(this.bookmarks.get(filePath) || [])].sort((a, b) => a - b)
  }

  /** Get next bookmark after current line */
  getNext(filePath: string, currentLine: number): number | undefined {
    const marks = this.getBookmarks(filePath)
    return marks.find(l => l > currentLine) || marks[0]
  }

  /** Get previous bookmark before current line */
  getPrevious(filePath: string, currentLine: number): number | undefined {
    const marks = this.getBookmarks(filePath)
    const reversed = [...marks].reverse()
    return reversed.find(l => l < currentLine) || reversed[0]
  }

  /** Clear all bookmarks for a file */
  clearFile(filePath: string): void {
    this.bookmarks.delete(filePath)
    this.manager.clearCategory('bookmark')
  }

  /** Clear all bookmarks */
  clearAll(): void {
    this.bookmarks.clear()
    this.manager.clearCategory('bookmark')
  }

  /** Get all bookmarks across all files */
  getAllBookmarks(): Map<string, number[]> {
    const result = new Map<string, number[]>()
    for (const [path, lines] of this.bookmarks) {
      if (lines.size > 0) {
        result.set(path, [...lines].sort((a, b) => a - b))
      }
    }
    return result
  }

  private refresh(filePath: string): void {
    const lines = this.getBookmarks(filePath)
    this.manager.setHighlights(
      'bookmark',
      lines.map(line => ({
        line,
        category: 'bookmark' as const,
        tooltip: `Bookmark on line ${line}`,
      }))
    )
  }
}

/* ── Word Occurrence Highlighter ───────────────────────── */

export class WordOccurrenceHighlighter {
  private manager: MinimapHighlightManager
  private editor: MonacoEditor.IStandaloneCodeEditor
  private disposable: IDisposable | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(editor: MonacoEditor.IStandaloneCodeEditor, manager: MinimapHighlightManager) {
    this.editor = editor
    this.manager = manager
  }

  /** Start auto-highlighting word under cursor */
  enable(): void {
    this.disable()
    this.disposable = this.editor.onDidChangeCursorPosition(() => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => this.highlightCurrentWord(), 150)
    })
  }

  /** Stop auto-highlighting */
  disable(): void {
    if (this.disposable) {
      this.disposable.dispose()
      this.disposable = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.manager.clearCategory('wordHighlight')
  }

  private highlightCurrentWord(): void {
    const model = this.editor.getModel()
    const position = this.editor.getPosition()
    if (!model || !position) return

    const word = model.getWordAtPosition(position)
    if (!word || word.word.length < 2) {
      this.manager.clearCategory('wordHighlight')
      return
    }

    const highlights: MinimapHighlight[] = []
    const regex = new RegExp(`\\b${escapeRegex(word.word)}\\b`, 'g')
    const lineCount = model.getLineCount()

    for (let i = 1; i <= lineCount && highlights.length < 500; i++) {
      const content = model.getLineContent(i)
      if (regex.test(content)) {
        highlights.push({
          line: i,
          category: 'wordHighlight',
          tooltip: `"${word.word}" on line ${i}`,
        })
      }
      regex.lastIndex = 0
    }

    // Only show if there are multiple occurrences (not just the cursor position)
    if (highlights.length > 1) {
      this.manager.setHighlights('wordHighlight', highlights)
    } else {
      this.manager.clearCategory('wordHighlight')
    }
  }

  dispose(): void {
    this.disable()
  }
}

/* ── CSS Injection for Glyph Styles ────────────────────── */

let glyphStylesInjected = false

export function injectMinimapGlyphStyles(): void {
  if (glyphStylesInjected) return
  glyphStylesInjected = true

  const style = document.createElement('style')
  style.id = 'minimap-glyph-styles'
  style.textContent = `
    .minimap-breakpoint-glyph {
      background: #f85149;
      border-radius: 50%;
      width: 8px !important;
      height: 8px !important;
      margin-top: 4px;
      margin-left: 4px;
    }
    .minimap-bookmark-glyph {
      background: #a371f7;
      border-radius: 2px;
      width: 6px !important;
      height: 14px !important;
      margin-top: 1px;
      margin-left: 5px;
    }
    .minimap-error-glyph::before {
      content: '●';
      color: #f85149;
      font-size: 10px;
    }
    .minimap-warning-glyph::before {
      content: '▲';
      color: #d29922;
      font-size: 8px;
    }
  `
  document.head.appendChild(style)
}

/* ── Factory Function ──────────────────────────────────── */

export interface MinimapHighlightSuite {
  manager: MinimapHighlightManager
  search: SearchHighlighter
  git: GitChangeHighlighter
  diagnostics: DiagnosticHighlighter
  bookmarks: BookmarkHighlighter
  wordOccurrences: WordOccurrenceHighlighter
  dispose: () => void
}

export function createMinimapHighlightSuite(
  editor: MonacoEditor.IStandaloneCodeEditor,
  theme?: Partial<HighlightTheme>
): MinimapHighlightSuite {
  injectMinimapGlyphStyles()

  const manager = new MinimapHighlightManager(editor, theme)
  const search = new SearchHighlighter(editor, manager)
  const git = new GitChangeHighlighter(manager)
  const diagnostics = new DiagnosticHighlighter(manager)
  const bookmarks = new BookmarkHighlighter(manager)
  const wordOccurrences = new WordOccurrenceHighlighter(editor, manager)

  // Enable word occurrence highlighting by default
  wordOccurrences.enable()

  return {
    manager,
    search,
    git,
    diagnostics,
    bookmarks,
    wordOccurrences,
    dispose() {
      wordOccurrences.dispose()
      search.dispose()
      diagnostics.clear()
      git.clear()
      bookmarks.clearAll()
      manager.dispose()
    },
  }
}

/* ── Helpers ───────────────────────────────────────────── */

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
