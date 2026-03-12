/**
 * File content search engine with regex, replace preview, and incremental indexing.
 */

/* ── Types ─────────────────────────────────────────────── */

export interface SearchOptions {
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  includePattern?: string   // glob
  excludePattern?: string   // glob
  maxResults?: number
  contextLines?: number
}

export interface SearchMatch {
  file: string
  line: number
  column: number
  matchText: string
  matchLength: number
  lineContent: string
  contextBefore: string[]
  contextAfter: string[]
}

export interface FileSearchResult {
  file: string
  matches: SearchMatch[]
  matchCount: number
}

export interface ReplacePreview {
  file: string
  line: number
  original: string
  replaced: string
}

/* ── Search Engine ─────────────────────────────────────── */

class SearchEngineImpl {
  private fileContents = new Map<string, string>()
  private searchHistory: string[] = []
  private _cancelToken = false

  /** Index a file's content for searching */
  indexFile(filePath: string, content: string): void {
    this.fileContents.set(filePath, content)
  }

  /** Remove a file from the index */
  removeFile(filePath: string): void {
    this.fileContents.delete(filePath)
  }

  /** Cancel an ongoing search */
  cancel(): void {
    this._cancelToken = true
  }

  /** Search across all indexed files */
  search(
    query: string,
    options: SearchOptions = {},
    onProgress?: (file: string, found: number) => void,
  ): FileSearchResult[] {
    this._cancelToken = false
    if (!query) return []

    // Track search history
    if (!this.searchHistory.includes(query)) {
      this.searchHistory.unshift(query)
      if (this.searchHistory.length > 50) this.searchHistory.pop()
    }

    const {
      regex = false,
      caseSensitive = false,
      wholeWord = false,
      includePattern,
      excludePattern,
      maxResults = 10000,
      contextLines = 0,
    } = options

    const results: FileSearchResult[] = []
    let totalMatches = 0

    const searchRegex = this.buildRegex(query, { regex, caseSensitive, wholeWord })
    if (!searchRegex) return []

    for (const [filePath, content] of this.fileContents) {
      if (this._cancelToken) break
      if (totalMatches >= maxResults) break

      // Apply include/exclude patterns
      if (includePattern && !this.matchGlob(filePath, includePattern)) continue
      if (excludePattern && this.matchGlob(filePath, excludePattern)) continue

      const fileResult = this.searchInContent(filePath, content, searchRegex, contextLines, maxResults - totalMatches)

      if (fileResult.matchCount > 0) {
        results.push(fileResult)
        totalMatches += fileResult.matchCount
        onProgress?.(filePath, totalMatches)
      }
    }

    return results
  }

  /** Search within a specific file */
  searchInFile(filePath: string, query: string, options: SearchOptions = {}): SearchMatch[] {
    const content = this.fileContents.get(filePath)
    if (!content) return []

    const { regex = false, caseSensitive = false, wholeWord = false, contextLines = 0 } = options
    const searchRegex = this.buildRegex(query, { regex, caseSensitive, wholeWord })
    if (!searchRegex) return []

    return this.searchInContent(filePath, content, searchRegex, contextLines).matches
  }

  /** Generate replace previews */
  previewReplace(
    query: string,
    replacement: string,
    files: string[],
    options: SearchOptions = {},
  ): ReplacePreview[] {
    const previews: ReplacePreview[] = []
    const { regex = false, caseSensitive = false, wholeWord = false } = options
    const searchRegex = this.buildRegex(query, { regex, caseSensitive, wholeWord })
    if (!searchRegex) return []

    for (const filePath of files) {
      const content = this.fileContents.get(filePath)
      if (!content) continue

      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const lineRegex = new RegExp(searchRegex.source, searchRegex.flags)

        if (lineRegex.test(line)) {
          const replaced = line.replace(new RegExp(searchRegex.source, searchRegex.flags), replacement)
          if (replaced !== line) {
            previews.push({
              file: filePath,
              line: i + 1,
              original: line,
              replaced,
            })
          }
        }
      }
    }

    return previews
  }

  /** Execute replace across files (returns new content map) */
  replaceAll(
    query: string,
    replacement: string,
    files: string[],
    options: SearchOptions = {},
  ): Map<string, string> {
    const results = new Map<string, string>()
    const { regex = false, caseSensitive = false, wholeWord = false } = options
    const searchRegex = this.buildRegex(query, { regex, caseSensitive, wholeWord })
    if (!searchRegex) return results

    const globalRegex = new RegExp(searchRegex.source, searchRegex.flags.includes('g') ? searchRegex.flags : searchRegex.flags + 'g')

    for (const filePath of files) {
      const content = this.fileContents.get(filePath)
      if (!content) continue

      const newContent = content.replace(globalRegex, replacement)
      if (newContent !== content) {
        results.set(filePath, newContent)
        this.fileContents.set(filePath, newContent)
      }
    }

    return results
  }

  /** Get search history */
  getHistory(): string[] {
    return [...this.searchHistory]
  }

  /** Clear search history */
  clearHistory(): void {
    this.searchHistory = []
  }

  get indexedFileCount(): number {
    return this.fileContents.size
  }

  clear(): void {
    this.fileContents.clear()
  }

  /* ── Private ───────────────────────────────────────── */

  private buildRegex(
    query: string,
    opts: { regex: boolean; caseSensitive: boolean; wholeWord: boolean },
  ): RegExp | null {
    try {
      let pattern = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (opts.wholeWord) pattern = `\\b${pattern}\\b`
      const flags = opts.caseSensitive ? 'g' : 'gi'
      return new RegExp(pattern, flags)
    } catch {
      return null
    }
  }

  private searchInContent(
    filePath: string,
    content: string,
    regex: RegExp,
    contextLines: number,
    limit = 10000,
  ): FileSearchResult {
    const lines = content.split('\n')
    const matches: SearchMatch[] = []

    for (let i = 0; i < lines.length && matches.length < limit; i++) {
      const line = lines[i]
      const lineRegex = new RegExp(regex.source, regex.flags)
      let match: RegExpExecArray | null

      while ((match = lineRegex.exec(line)) !== null && matches.length < limit) {
        const contextBefore: string[] = []
        const contextAfter: string[] = []

        if (contextLines > 0) {
          for (let b = Math.max(0, i - contextLines); b < i; b++) {
            contextBefore.push(lines[b])
          }
          for (let a = i + 1; a <= Math.min(lines.length - 1, i + contextLines); a++) {
            contextAfter.push(lines[a])
          }
        }

        matches.push({
          file: filePath,
          line: i + 1,
          column: match.index + 1,
          matchText: match[0],
          matchLength: match[0].length,
          lineContent: line,
          contextBefore,
          contextAfter,
        })

        // Prevent infinite loop on zero-length matches
        if (match[0].length === 0) lineRegex.lastIndex++
      }
    }

    return { file: filePath, matches, matchCount: matches.length }
  }

  private matchGlob(path: string, pattern: string): boolean {
    // Simple glob matching (supports * and **)
    const parts = pattern.split(',').map(p => p.trim())
    return parts.some(p => {
      const re = p
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '{{GLOBSTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/\{\{GLOBSTAR\}\}/g, '.*')
      return new RegExp(re).test(path)
    })
  }
}

export const searchEngine = new SearchEngineImpl()
