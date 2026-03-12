import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  Search,
  Replace,
  ChevronDown,
  ChevronRight,
  X,
  ArrowUp,
  ArrowDown,
  CaseSensitive,
  WholeWord,
  Regex,
  Files,
  Filter,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────

interface MatchPosition {
  line: number
  column: number
  length: number
  text: string
  file?: string
}

interface SearchHistoryEntry {
  term: string
  timestamp: number
}

interface FileResult {
  path: string
  matches: MatchPosition[]
}

interface ReplacePreview {
  original: string
  replaced: string
  line: number
  file?: string
}

// ── Storage helpers ────────────────────────────────────────────────────

const SEARCH_HISTORY_KEY = 'orion-search-history'
const REPLACE_HISTORY_KEY = 'orion-replace-history'
const MAX_HISTORY = 20

function loadHistory(key: string): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHistory(key: string, entries: SearchHistoryEntry[]) {
  try {
    localStorage.setItem(key, JSON.stringify(entries.slice(0, MAX_HISTORY)))
  } catch {
    // storage full — ignore
  }
}

function addToHistory(key: string, term: string) {
  if (!term.trim()) return
  const entries = loadHistory(key).filter((e) => e.term !== term)
  entries.unshift({ term, timestamp: Date.now() })
  saveHistory(key, entries)
}

// ── Regex validator ────────────────────────────────────────────────────

function validateRegex(pattern: string): { valid: boolean; error?: string } {
  if (!pattern) return { valid: true }
  try {
    new RegExp(pattern)
    return { valid: true }
  } catch (e: any) {
    return { valid: false, error: e.message?.replace(/^Invalid regular expression: /, '') || 'Invalid regex' }
  }
}

// ── Preserve-case replacement logic ────────────────────────────────────

function preserveCaseReplace(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase()
  if (original === original.toLowerCase()) return replacement.toLowerCase()
  if (original[0] === original[0].toUpperCase() && original.slice(1) === original.slice(1).toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase()
  }
  return replacement
}

// ── Build search regex ─────────────────────────────────────────────────

function buildSearchRegex(
  term: string,
  opts: { caseSensitive: boolean; wholeWord: boolean; useRegex: boolean }
): RegExp | null {
  if (!term) return null
  try {
    let pattern = opts.useRegex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (opts.wholeWord) pattern = `\\b${pattern}\\b`
    return new RegExp(pattern, opts.caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

// ── Mock data generators for demo ──────────────────────────────────────

function generateDemoMatches(
  searchTerm: string,
  opts: { caseSensitive: boolean; wholeWord: boolean; useRegex: boolean },
  selectionOnly: boolean
): MatchPosition[] {
  if (!searchTerm) return []
  const regex = buildSearchRegex(searchTerm, opts)
  if (!regex) return []

  // Simulated editor content lines
  const demoLines = [
    'import React from "react"',
    'import { useState, useEffect } from "react"',
    '',
    'interface SearchProps {',
    '  query: string',
    '  onSearch: (term: string) => void',
    '}',
    '',
    'export default function SearchComponent({ query, onSearch }: SearchProps) {',
    '  const [search, setSearch] = useState(query)',
    '  const [results, setResults] = useState<string[]>([])',
    '',
    '  useEffect(() => {',
    '    if (search) {',
    '      onSearch(search)',
    '    }',
    '  }, [search, onSearch])',
    '',
    '  return (',
    '    <div className="search-container">',
    '      <input value={search} onChange={e => setSearch(e.target.value)} />',
    '      {results.map(r => <div key={r}>{r}</div>)}',
    '    </div>',
    '  )',
    '}',
  ]

  const lineRange = selectionOnly ? { start: 8, end: 16 } : { start: 0, end: demoLines.length }
  const matches: MatchPosition[] = []

  for (let i = lineRange.start; i < lineRange.end; i++) {
    const line = demoLines[i]
    let match: RegExpExecArray | null
    const lineRegex = new RegExp(regex.source, regex.flags)
    while ((match = lineRegex.exec(line)) !== null) {
      matches.push({
        line: i + 1,
        column: match.index + 1,
        length: match[0].length,
        text: line,
      })
      if (!lineRegex.global) break
    }
  }

  return matches
}

function generateFileResults(
  searchTerm: string,
  opts: { caseSensitive: boolean; wholeWord: boolean; useRegex: boolean },
  includePattern: string,
  excludePattern: string
): FileResult[] {
  if (!searchTerm) return []
  const regex = buildSearchRegex(searchTerm, opts)
  if (!regex) return []

  const demoFiles: { path: string; lines: string[] }[] = [
    {
      path: 'src/components/App.tsx',
      lines: [
        'import React from "react"',
        `function App() { return <Search /> }`,
        'export default App',
      ],
    },
    {
      path: 'src/hooks/useSearch.ts',
      lines: [
        'import { useState } from "react"',
        'export function useSearch(initial: string) {',
        '  const [query, setQuery] = useState(initial)',
        '  return { query, setQuery }',
        '}',
      ],
    },
    {
      path: 'src/utils/search.ts',
      lines: [
        'export function search(text: string, term: string): number[] {',
        '  const indices: number[] = []',
        '  // perform search logic',
        '  return indices',
        '}',
      ],
    },
    {
      path: 'src/components/SearchBar.tsx',
      lines: [
        'import { Search } from "lucide-react"',
        'export function SearchBar() {',
        '  return <div><Search size={16} /></div>',
        '}',
      ],
    },
  ]

  // Apply include/exclude glob simulation
  let files = demoFiles
  if (includePattern.trim()) {
    const inc = includePattern.replace(/\*/g, '').toLowerCase()
    files = files.filter((f) => f.path.toLowerCase().includes(inc))
  }
  if (excludePattern.trim()) {
    const exc = excludePattern.replace(/\*/g, '').toLowerCase()
    files = files.filter((f) => !f.path.toLowerCase().includes(exc))
  }

  const results: FileResult[] = []
  for (const file of files) {
    const fileMatches: MatchPosition[] = []
    for (let i = 0; i < file.lines.length; i++) {
      const lineRegex = new RegExp(regex.source, regex.flags)
      let m: RegExpExecArray | null
      while ((m = lineRegex.exec(file.lines[i])) !== null) {
        fileMatches.push({
          line: i + 1,
          column: m.index + 1,
          length: m[0].length,
          text: file.lines[i],
          file: file.path,
        })
        if (!lineRegex.global) break
      }
    }
    if (fileMatches.length > 0) {
      results.push({ path: file.path, matches: fileMatches })
    }
  }
  return results
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    right: 0,
    zIndex: 1000,
    padding: '8px 60px 0 0',
    pointerEvents: 'none' as const,
  },
  container: {
    pointerEvents: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    background: 'var(--bg-secondary, #161b22)',
    border: '1px solid var(--border-bright, #30363d)',
    borderRadius: '4px',
    boxShadow: 'var(--shadow-lg, 0 12px 40px rgba(0,0,0,0.5))',
    minWidth: '420px',
    maxWidth: '540px',
    fontFamily: 'var(--font-sans, "Segoe UI", system-ui, sans-serif)',
    fontSize: '13px',
    color: 'var(--text-primary, #e6edf3)',
    overflow: 'hidden',
    transition: 'all 0.15s ease',
  },
  topRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '2px',
    padding: '6px 4px 4px 4px',
  },
  toggleBtn: (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-secondary, #8b949e)',
    cursor: 'pointer',
    borderRadius: '3px',
    padding: 0,
    marginTop: '3px',
    flexShrink: 0,
    transition: 'color 0.1s, background 0.1s',
  }),
  inputsColumn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    minWidth: 0,
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    height: '26px',
  },
  inputWrapper: (focused: boolean, error?: boolean): React.CSSProperties => ({
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    height: '24px',
    background: 'var(--bg-primary, #0d1117)',
    border: `1px solid ${error ? 'var(--accent-red, #f85149)' : focused ? 'var(--border-focus, #58a6ff)' : 'var(--border, #21262d)'}`,
    borderRadius: '3px',
    paddingLeft: '6px',
    paddingRight: '2px',
    overflow: 'hidden',
    transition: 'border-color 0.15s ease',
  }),
  input: {
    flex: 1,
    height: '22px',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--text-primary, #e6edf3)',
    fontSize: '12px',
    fontFamily: 'var(--font-mono, "Cascadia Code", Consolas, monospace)',
    padding: 0,
    minWidth: 0,
  },
  matchBadge: {
    fontSize: '11px',
    color: 'var(--text-secondary, #8b949e)',
    whiteSpace: 'nowrap' as const,
    padding: '0 6px',
    flexShrink: 0,
    userSelect: 'none' as const,
  },
  optionBtn: (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '20px',
    border: `1px solid ${active ? 'var(--accent, #58a6ff)' : 'transparent'}`,
    background: active ? 'rgba(88,166,255,0.15)' : 'transparent',
    color: active ? 'var(--accent, #58a6ff)' : 'var(--text-secondary, #8b949e)',
    cursor: 'pointer',
    borderRadius: '3px',
    padding: 0,
    flexShrink: 0,
    transition: 'all 0.1s ease',
  }),
  navBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '20px',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-secondary, #8b949e)',
    cursor: 'pointer',
    borderRadius: '3px',
    padding: 0,
    flexShrink: 0,
    transition: 'all 0.1s ease',
  },
  actionBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '20px',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-secondary, #8b949e)',
    cursor: 'pointer',
    borderRadius: '3px',
    padding: '0 4px',
    flexShrink: 0,
    fontSize: '11px',
    fontFamily: 'var(--font-sans, "Segoe UI", system-ui, sans-serif)',
    gap: '3px',
    transition: 'all 0.1s ease',
  },
  closeBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-secondary, #8b949e)',
    cursor: 'pointer',
    borderRadius: '3px',
    padding: 0,
    flexShrink: 0,
    marginTop: '3px',
    transition: 'all 0.1s ease',
  },
  regexError: {
    fontSize: '11px',
    color: 'var(--accent-red, #f85149)',
    padding: '0 8px 4px 30px',
    lineHeight: '1.3',
  },
  filesModeSection: {
    borderTop: '1px solid var(--border, #21262d)',
    padding: '6px 8px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    height: '24px',
  },
  filterLabel: {
    fontSize: '11px',
    color: 'var(--text-muted, #484f58)',
    whiteSpace: 'nowrap' as const,
    width: '52px',
    flexShrink: 0,
  },
  filterInput: {
    flex: 1,
    height: '22px',
    background: 'var(--bg-primary, #0d1117)',
    border: '1px solid var(--border, #21262d)',
    borderRadius: '3px',
    color: 'var(--text-primary, #e6edf3)',
    fontSize: '11px',
    fontFamily: 'var(--font-mono, "Cascadia Code", Consolas, monospace)',
    padding: '0 6px',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  resultsSection: {
    borderTop: '1px solid var(--border, #21262d)',
    maxHeight: '260px',
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
  },
  resultFileHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 8px',
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--text-primary, #e6edf3)',
    background: 'var(--bg-hover, #1c2128)',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  resultLine: (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '2px 8px 2px 24px',
    fontSize: '11px',
    fontFamily: 'var(--font-mono, "Cascadia Code", Consolas, monospace)',
    cursor: 'pointer',
    background: active ? 'rgba(88,166,255,0.08)' : 'transparent',
    borderLeft: active ? '2px solid var(--accent, #58a6ff)' : '2px solid transparent',
    transition: 'background 0.1s',
  }),
  resultLineNum: {
    color: 'var(--text-muted, #484f58)',
    flexShrink: 0,
    width: '32px',
    textAlign: 'right' as const,
  },
  resultLineText: {
    flex: 1,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: 'var(--text-secondary, #8b949e)',
  },
  matchHighlight: {
    background: 'rgba(255,213,79,0.25)',
    color: '#ffd54f',
    borderRadius: '2px',
  },
  previewSection: {
    borderTop: '1px solid var(--border, #21262d)',
    padding: '6px 8px',
    maxHeight: '160px',
    overflowY: 'auto' as const,
  },
  previewHeader: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--text-secondary, #8b949e)',
    marginBottom: '4px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  previewLine: {
    fontSize: '11px',
    fontFamily: 'var(--font-mono, "Cascadia Code", Consolas, monospace)',
    padding: '1px 4px',
    lineHeight: '1.5',
    whiteSpace: 'pre' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  previewOriginal: {
    background: 'rgba(248,81,73,0.1)',
    color: 'var(--accent-red, #f85149)',
    textDecoration: 'line-through',
  },
  previewReplaced: {
    background: 'rgba(63,185,80,0.1)',
    color: 'var(--accent-green, #3fb950)',
  },
  historyDropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    right: 0,
    background: 'var(--bg-secondary, #161b22)',
    border: '1px solid var(--border-bright, #30363d)',
    borderRadius: '4px',
    boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.4))',
    zIndex: 10,
    maxHeight: '160px',
    overflowY: 'auto' as const,
    marginTop: '2px',
  },
  historyItem: (highlighted: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
    fontSize: '12px',
    fontFamily: 'var(--font-mono, "Cascadia Code", Consolas, monospace)',
    color: 'var(--text-primary, #e6edf3)',
    cursor: 'pointer',
    background: highlighted ? 'var(--bg-hover, #1c2128)' : 'transparent',
    transition: 'background 0.1s',
  }),
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '3px 8px',
    borderTop: '1px solid var(--border, #21262d)',
    fontSize: '11px',
    color: 'var(--text-muted, #484f58)',
  },
}

// ── HighlightedMatch: renders a line with the matched portion highlighted ─

function HighlightedMatchLine({ text, column, length }: { text: string; column: number; length: number }) {
  const before = text.slice(0, column - 1)
  const match = text.slice(column - 1, column - 1 + length)
  const after = text.slice(column - 1 + length)
  return (
    <span>
      {before}
      <span style={styles.matchHighlight}>{match}</span>
      {after}
    </span>
  )
}

// ── History Dropdown ───────────────────────────────────────────────────

function HistoryDropdown({
  entries,
  highlightIndex,
  onSelect,
}: {
  entries: SearchHistoryEntry[]
  highlightIndex: number
  onSelect: (term: string) => void
}) {
  if (entries.length === 0) return null
  return (
    <div style={styles.historyDropdown}>
      {entries.map((entry, i) => (
        <div
          key={entry.term + entry.timestamp}
          style={styles.historyItem(i === highlightIndex)}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(entry.term)
          }}
        >
          {entry.term}
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// ── Main Component ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

export default function SearchReplaceDialog() {
  // ── State ──────────────────────────────────────────────────────────
  const [isOpen, setIsOpen] = useState(true)
  const [showReplace, setShowReplace] = useState(false)
  const [findInFiles, setFindInFiles] = useState(false)

  const [searchTerm, setSearchTerm] = useState('')
  const [replaceTerm, setReplaceTerm] = useState('')

  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [searchInSelection, setSearchInSelection] = useState(false)
  const [preserveCase, setPreserveCase] = useState(false)

  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const [showPreview, setShowPreview] = useState(false)

  // Files mode
  const [includePattern, setIncludePattern] = useState('')
  const [excludePattern, setExcludePattern] = useState('')
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())

  // History
  const [showSearchHistory, setShowSearchHistory] = useState(false)
  const [showReplaceHistory, setShowReplaceHistory] = useState(false)
  const [searchHistoryIndex, setSearchHistoryIndex] = useState(-1)
  const [replaceHistoryIndex, setReplaceHistoryIndex] = useState(-1)

  // Focus tracking
  const [searchFocused, setSearchFocused] = useState(false)
  const [replaceFocused, setReplaceFocused] = useState(false)

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ── Derived ────────────────────────────────────────────────────────

  const regexValidation = useMemo(
    () => (useRegex ? validateRegex(searchTerm) : { valid: true }),
    [searchTerm, useRegex]
  )

  const searchOpts = useMemo(
    () => ({ caseSensitive, wholeWord, useRegex }),
    [caseSensitive, wholeWord, useRegex]
  )

  const matches = useMemo(
    () =>
      !findInFiles
        ? generateDemoMatches(searchTerm, searchOpts, searchInSelection)
        : [],
    [searchTerm, searchOpts, searchInSelection, findInFiles]
  )

  const fileResults = useMemo(
    () =>
      findInFiles
        ? generateFileResults(searchTerm, searchOpts, includePattern, excludePattern)
        : [],
    [searchTerm, searchOpts, findInFiles, includePattern, excludePattern]
  )

  const totalFileMatches = useMemo(
    () => fileResults.reduce((sum, f) => sum + f.matches.length, 0),
    [fileResults]
  )

  const currentMatch = matches[currentMatchIndex] || null

  const searchHistory = useMemo(() => loadHistory(SEARCH_HISTORY_KEY), [showSearchHistory])
  const replaceHistory = useMemo(() => loadHistory(REPLACE_HISTORY_KEY), [showReplaceHistory])

  const replacePreview = useMemo((): ReplacePreview[] => {
    if (!searchTerm || !replaceTerm || !showPreview) return []
    const regex = buildSearchRegex(searchTerm, searchOpts)
    if (!regex) return []

    const items = findInFiles
      ? fileResults.flatMap((f) => f.matches)
      : matches

    return items.slice(0, 20).map((m) => {
      const lineRegex = new RegExp(regex.source, regex.flags)
      const replaced = m.text.replace(lineRegex, (match) =>
        preserveCase ? preserveCaseReplace(match, replaceTerm) : replaceTerm
      )
      return { original: m.text, replaced, line: m.line, file: m.file }
    })
  }, [searchTerm, replaceTerm, showPreview, searchOpts, matches, fileResults, findInFiles, preserveCase])

  // ── Handlers ───────────────────────────────────────────────────────

  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  const open = useCallback(() => {
    setIsOpen(true)
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [])

  const gotoNextMatch = useCallback(() => {
    if (matches.length === 0) return
    setCurrentMatchIndex((prev) => (prev + 1) % matches.length)
  }, [matches.length])

  const gotoPrevMatch = useCallback(() => {
    if (matches.length === 0) return
    setCurrentMatchIndex((prev) => (prev - 1 + matches.length) % matches.length)
  }, [matches.length])

  const replaceCurrent = useCallback(() => {
    if (!currentMatch || !replaceTerm) return
    addToHistory(SEARCH_HISTORY_KEY, searchTerm)
    addToHistory(REPLACE_HISTORY_KEY, replaceTerm)
    // In a real editor, this would modify the document at currentMatch position
    gotoNextMatch()
  }, [currentMatch, replaceTerm, searchTerm, gotoNextMatch])

  const replaceAll = useCallback(() => {
    if (matches.length === 0 || !replaceTerm) return
    addToHistory(SEARCH_HISTORY_KEY, searchTerm)
    addToHistory(REPLACE_HISTORY_KEY, replaceTerm)
    // In a real editor, this would replace all matches in the document/workspace
    setCurrentMatchIndex(0)
  }, [matches.length, replaceTerm, searchTerm])

  const toggleFileExpanded = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const commitSearchToHistory = useCallback(() => {
    if (searchTerm.trim()) addToHistory(SEARCH_HISTORY_KEY, searchTerm)
  }, [searchTerm])

  const commitReplaceToHistory = useCallback(() => {
    if (replaceTerm.trim()) addToHistory(REPLACE_HISTORY_KEY, replaceTerm)
  }, [replaceTerm])

  // ── Clamp current match index ──────────────────────────────────────

  useEffect(() => {
    if (matches.length === 0) {
      setCurrentMatchIndex(0)
    } else if (currentMatchIndex >= matches.length) {
      setCurrentMatchIndex(0)
    }
  }, [matches.length, currentMatchIndex])

  // ── Auto-expand all files in find-in-files ─────────────────────────

  useEffect(() => {
    if (findInFiles) {
      setExpandedFiles(new Set(fileResults.map((f) => f.path)))
    }
  }, [findInFiles, fileResults])

  // ── Global keyboard shortcut to open (Ctrl+F / Ctrl+H) ────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !e.shiftKey) {
        e.preventDefault()
        setFindInFiles(false)
        open()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault()
        setShowReplace(true)
        setFindInFiles(false)
        open()
        requestAnimationFrame(() => searchInputRef.current?.focus())
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        setFindInFiles(true)
        open()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // ── Auto-focus search input on open ────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus())
    }
  }, [isOpen])

  // ── Key handlers for search input ──────────────────────────────────

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSearchHistory) {
          setShowSearchHistory(false)
        } else {
          close()
        }
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        commitSearchToHistory()
        setShowSearchHistory(false)
        gotoNextMatch()
        return
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        commitSearchToHistory()
        setShowSearchHistory(false)
        gotoPrevMatch()
        return
      }
      if (e.key === 'ArrowDown' && showSearchHistory) {
        e.preventDefault()
        setSearchHistoryIndex((prev) => Math.min(prev + 1, searchHistory.length - 1))
        return
      }
      if (e.key === 'ArrowUp' && showSearchHistory) {
        e.preventDefault()
        setSearchHistoryIndex((prev) => Math.max(prev - 1, -1))
        return
      }
      if (e.key === 'ArrowDown' && !showSearchHistory && searchHistory.length > 0) {
        setShowSearchHistory(true)
        setSearchHistoryIndex(-1)
        return
      }
      if (e.key === 'Tab' && !e.shiftKey && showReplace) {
        e.preventDefault()
        replaceInputRef.current?.focus()
        return
      }
    },
    [showSearchHistory, searchHistory.length, showReplace, close, commitSearchToHistory, gotoNextMatch, gotoPrevMatch]
  )

  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showReplaceHistory) {
          setShowReplaceHistory(false)
        } else {
          close()
        }
        return
      }
      // Ctrl+Shift+1 = replace current
      if (e.ctrlKey && e.shiftKey && e.key === '1') {
        e.preventDefault()
        replaceCurrent()
        return
      }
      // Ctrl+Alt+Enter = replace all
      if (e.ctrlKey && e.altKey && e.key === 'Enter') {
        e.preventDefault()
        replaceAll()
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        commitReplaceToHistory()
        setShowReplaceHistory(false)
        replaceCurrent()
        return
      }
      if (e.key === 'ArrowDown' && showReplaceHistory) {
        e.preventDefault()
        setReplaceHistoryIndex((prev) => Math.min(prev + 1, replaceHistory.length - 1))
        return
      }
      if (e.key === 'ArrowUp' && showReplaceHistory) {
        e.preventDefault()
        setReplaceHistoryIndex((prev) => Math.max(prev - 1, -1))
        return
      }
      if (e.key === 'ArrowDown' && !showReplaceHistory && replaceHistory.length > 0) {
        setShowReplaceHistory(true)
        setReplaceHistoryIndex(-1)
        return
      }
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
    },
    [showReplaceHistory, replaceHistory.length, close, commitReplaceToHistory, replaceCurrent, replaceAll]
  )

  // ── Global keydown for replace shortcuts ───────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isOpen) return
      if (e.ctrlKey && e.shiftKey && e.key === '1') {
        e.preventDefault()
        replaceCurrent()
      }
      if (e.ctrlKey && e.altKey && e.key === 'Enter') {
        e.preventDefault()
        replaceAll()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, replaceCurrent, replaceAll])

  // ── Select history on index change ─────────────────────────────────

  useEffect(() => {
    if (showSearchHistory && searchHistoryIndex >= 0 && searchHistoryIndex < searchHistory.length) {
      setSearchTerm(searchHistory[searchHistoryIndex].term)
    }
  }, [searchHistoryIndex, showSearchHistory, searchHistory])

  useEffect(() => {
    if (showReplaceHistory && replaceHistoryIndex >= 0 && replaceHistoryIndex < replaceHistory.length) {
      setReplaceTerm(replaceHistory[replaceHistoryIndex].term)
    }
  }, [replaceHistoryIndex, showReplaceHistory, replaceHistory])

  // ── Close history on blur ──────────────────────────────────────────

  const handleSearchBlur = useCallback(() => {
    setSearchFocused(false)
    setTimeout(() => setShowSearchHistory(false), 150)
  }, [])

  const handleReplaceBlur = useCallback(() => {
    setReplaceFocused(false)
    setTimeout(() => setShowReplaceHistory(false), 150)
  }, [])

  // ── Render ─────────────────────────────────────────────────────────

  if (!isOpen) return null

  const matchCountLabel = (() => {
    if (!searchTerm) return ''
    if (!regexValidation.valid) return 'Invalid'
    if (findInFiles) {
      if (totalFileMatches === 0) return 'No results'
      return `${totalFileMatches} result${totalFileMatches !== 1 ? 's' : ''} in ${fileResults.length} file${fileResults.length !== 1 ? 's' : ''}`
    }
    if (matches.length === 0) return 'No results'
    return `${currentMatchIndex + 1} of ${matches.length}`
  })()

  return (
    <div style={styles.overlay}>
      <div ref={containerRef} style={styles.container} role="dialog" aria-label="Find and Replace">
        {/* ── Top row: chevron, inputs, close ──────────────────────────── */}
        <div style={styles.topRow}>
          {/* Replace toggle chevron */}
          <button
            style={styles.toggleBtn(showReplace)}
            onClick={() => setShowReplace(!showReplace)}
            title={showReplace ? 'Hide replace (Ctrl+H)' : 'Show replace (Ctrl+H)'}
            aria-label="Toggle replace"
            aria-expanded={showReplace}
          >
            {showReplace ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          {/* Inputs column */}
          <div style={styles.inputsColumn}>
            {/* ── Search row ──────────────────────────────────────────── */}
            <div style={styles.inputRow}>
              <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
                <div style={styles.inputWrapper(searchFocused, useRegex && !regexValidation.valid)}>
                  <Search size={13} style={{ color: 'var(--text-muted, #484f58)', flexShrink: 0, marginRight: 4 }} />
                  <input
                    ref={searchInputRef}
                    style={styles.input}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={handleSearchBlur}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Find"
                    spellCheck={false}
                    aria-label="Search"
                  />
                  {searchTerm && (
                    <span style={styles.matchBadge} aria-live="polite">
                      {matchCountLabel}
                    </span>
                  )}
                </div>
                {showSearchHistory && searchHistory.length > 0 && (
                  <HistoryDropdown
                    entries={searchHistory}
                    highlightIndex={searchHistoryIndex}
                    onSelect={(term) => {
                      setSearchTerm(term)
                      setShowSearchHistory(false)
                      searchInputRef.current?.focus()
                    }}
                  />
                )}
              </div>

              {/* Match option buttons */}
              <button
                style={styles.optionBtn(caseSensitive)}
                onClick={() => setCaseSensitive(!caseSensitive)}
                title="Match Case (Alt+C)"
                aria-label="Match case"
                aria-pressed={caseSensitive}
              >
                <CaseSensitive size={14} />
              </button>
              <button
                style={styles.optionBtn(wholeWord)}
                onClick={() => setWholeWord(!wholeWord)}
                title="Match Whole Word (Alt+W)"
                aria-label="Match whole word"
                aria-pressed={wholeWord}
              >
                <WholeWord size={14} />
              </button>
              <button
                style={styles.optionBtn(useRegex)}
                onClick={() => setUseRegex(!useRegex)}
                title="Use Regular Expression (Alt+R)"
                aria-label="Use regular expression"
                aria-pressed={useRegex}
              >
                <Regex size={14} />
              </button>

              {/* Separator */}
              <div style={{ width: 1, height: 14, background: 'var(--border, #21262d)', margin: '0 2px', flexShrink: 0 }} />

              {/* Navigation buttons */}
              <button
                style={styles.navBtn}
                onClick={gotoPrevMatch}
                title="Previous Match (Shift+Enter)"
                aria-label="Previous match"
                disabled={matches.length === 0}
                onMouseEnter={(e) => { (e.currentTarget.style.background) = 'var(--bg-hover, #1c2128)' }}
                onMouseLeave={(e) => { (e.currentTarget.style.background) = 'transparent' }}
              >
                <ArrowUp size={14} />
              </button>
              <button
                style={styles.navBtn}
                onClick={gotoNextMatch}
                title="Next Match (Enter)"
                aria-label="Next match"
                disabled={matches.length === 0}
                onMouseEnter={(e) => { (e.currentTarget.style.background) = 'var(--bg-hover, #1c2128)' }}
                onMouseLeave={(e) => { (e.currentTarget.style.background) = 'transparent' }}
              >
                <ArrowDown size={14} />
              </button>

              {/* Selection / Files toggle */}
              {!findInFiles && (
                <button
                  style={styles.optionBtn(searchInSelection)}
                  onClick={() => setSearchInSelection(!searchInSelection)}
                  title="Find in Selection (Alt+L)"
                  aria-label="Search in selection"
                  aria-pressed={searchInSelection}
                >
                  <Filter size={13} />
                </button>
              )}
              <button
                style={styles.optionBtn(findInFiles)}
                onClick={() => setFindInFiles(!findInFiles)}
                title="Find in Files (Ctrl+Shift+F)"
                aria-label="Find in files"
                aria-pressed={findInFiles}
              >
                <Files size={13} />
              </button>
            </div>

            {/* ── Replace row (collapsible) ───────────────────────────── */}
            {showReplace && (
              <div style={styles.inputRow}>
                <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
                  <div style={styles.inputWrapper(replaceFocused)}>
                    <Replace size={13} style={{ color: 'var(--text-muted, #484f58)', flexShrink: 0, marginRight: 4 }} />
                    <input
                      ref={replaceInputRef}
                      style={styles.input}
                      value={replaceTerm}
                      onChange={(e) => setReplaceTerm(e.target.value)}
                      onFocus={() => setReplaceFocused(true)}
                      onBlur={handleReplaceBlur}
                      onKeyDown={handleReplaceKeyDown}
                      placeholder="Replace"
                      spellCheck={false}
                      aria-label="Replace"
                    />
                  </div>
                  {showReplaceHistory && replaceHistory.length > 0 && (
                    <HistoryDropdown
                      entries={replaceHistory}
                      highlightIndex={replaceHistoryIndex}
                      onSelect={(term) => {
                        setReplaceTerm(term)
                        setShowReplaceHistory(false)
                        replaceInputRef.current?.focus()
                      }}
                    />
                  )}
                </div>

                {/* Preserve case button */}
                <button
                  style={{
                    ...styles.optionBtn(preserveCase),
                    fontSize: '10px',
                    fontWeight: 700,
                    fontFamily: 'var(--font-sans)',
                    width: '22px',
                  }}
                  onClick={() => setPreserveCase(!preserveCase)}
                  title="Preserve Case"
                  aria-label="Preserve case"
                  aria-pressed={preserveCase}
                >
                  AB
                </button>

                {/* Replace actions */}
                <button
                  style={styles.actionBtn}
                  onClick={replaceCurrent}
                  title="Replace (Ctrl+Shift+1)"
                  aria-label="Replace current match"
                  disabled={!currentMatch || !replaceTerm}
                  onMouseEnter={(e) => { (e.currentTarget.style.background) = 'var(--bg-hover, #1c2128)' }}
                  onMouseLeave={(e) => { (e.currentTarget.style.background) = 'transparent' }}
                >
                  <Replace size={13} />
                </button>
                <button
                  style={styles.actionBtn}
                  onClick={replaceAll}
                  title="Replace All (Ctrl+Alt+Enter)"
                  aria-label="Replace all matches"
                  disabled={matches.length === 0 || !replaceTerm}
                  onMouseEnter={(e) => { (e.currentTarget.style.background) = 'var(--bg-hover, #1c2128)' }}
                  onMouseLeave={(e) => { (e.currentTarget.style.background) = 'transparent' }}
                >
                  <Files size={13} />
                </button>

                {/* Preview toggle */}
                {replaceTerm && searchTerm && (
                  <button
                    style={{
                      ...styles.optionBtn(showPreview),
                      fontSize: '9px',
                      fontWeight: 600,
                      fontFamily: 'var(--font-sans)',
                      width: 'auto',
                      padding: '0 4px',
                    }}
                    onClick={() => setShowPreview(!showPreview)}
                    title="Preview replacements"
                    aria-label="Toggle replacement preview"
                  >
                    Preview
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Close button */}
          <button
            style={styles.closeBtn}
            onClick={close}
            title="Close (Escape)"
            aria-label="Close search"
            onMouseEnter={(e) => { (e.currentTarget.style.background) = 'var(--bg-hover, #1c2128)' }}
            onMouseLeave={(e) => { (e.currentTarget.style.background) = 'transparent' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Regex error ─────────────────────────────────────────────── */}
        {useRegex && !regexValidation.valid && (
          <div style={styles.regexError} role="alert">
            {regexValidation.error}
          </div>
        )}

        {/* ── File filter inputs (find-in-files mode) ─────────────────── */}
        {findInFiles && (
          <div style={styles.filesModeSection}>
            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>include</span>
              <input
                style={styles.filterInput}
                value={includePattern}
                onChange={(e) => setIncludePattern(e.target.value)}
                placeholder="e.g. *.tsx, src/**"
                spellCheck={false}
                onFocus={(e) => { (e.currentTarget.style.borderColor) = 'var(--border-focus, #58a6ff)' }}
                onBlur={(e) => { (e.currentTarget.style.borderColor) = 'var(--border, #21262d)' }}
              />
            </div>
            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>exclude</span>
              <input
                style={styles.filterInput}
                value={excludePattern}
                onChange={(e) => setExcludePattern(e.target.value)}
                placeholder="e.g. node_modules, dist"
                spellCheck={false}
                onFocus={(e) => { (e.currentTarget.style.borderColor) = 'var(--border-focus, #58a6ff)' }}
                onBlur={(e) => { (e.currentTarget.style.borderColor) = 'var(--border, #21262d)' }}
              />
            </div>
          </div>
        )}

        {/* ── File results (find-in-files mode) ───────────────────────── */}
        {findInFiles && fileResults.length > 0 && (
          <div style={styles.resultsSection}>
            {fileResults.map((file) => (
              <div key={file.path}>
                <div
                  style={styles.resultFileHeader}
                  onClick={() => toggleFileExpanded(file.path)}
                >
                  {expandedFiles.has(file.path) ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.path}
                  </span>
                  <span style={{ color: 'var(--text-muted, #484f58)', fontWeight: 400 }}>
                    {file.matches.length}
                  </span>
                </div>
                {expandedFiles.has(file.path) &&
                  file.matches.map((m, mi) => (
                    <div
                      key={`${m.line}-${m.column}-${mi}`}
                      style={styles.resultLine(false)}
                      onMouseEnter={(e) => { (e.currentTarget.style.background) = 'var(--bg-hover, #1c2128)' }}
                      onMouseLeave={(e) => { (e.currentTarget.style.background) = 'transparent' }}
                    >
                      <span style={styles.resultLineNum}>{m.line}</span>
                      <span style={styles.resultLineText}>
                        <HighlightedMatchLine text={m.text} column={m.column} length={m.length} />
                      </span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}

        {/* ── Current file match results ──────────────────────────────── */}
        {!findInFiles && matches.length > 0 && searchTerm && (
          <div style={styles.resultsSection}>
            {matches.map((m, i) => (
              <div
                key={`${m.line}-${m.column}-${i}`}
                style={styles.resultLine(i === currentMatchIndex)}
                onClick={() => setCurrentMatchIndex(i)}
                onMouseEnter={(e) => {
                  if (i !== currentMatchIndex) (e.currentTarget.style.background) = 'var(--bg-hover, #1c2128)'
                }}
                onMouseLeave={(e) => {
                  if (i !== currentMatchIndex) (e.currentTarget.style.background) = 'transparent'
                }}
              >
                <span style={styles.resultLineNum}>{m.line}</span>
                <span style={styles.resultLineText}>
                  <HighlightedMatchLine text={m.text} column={m.column} length={m.length} />
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Replacement preview ─────────────────────────────────────── */}
        {showPreview && replacePreview.length > 0 && (
          <div style={styles.previewSection}>
            <div style={styles.previewHeader}>
              <Replace size={12} />
              Replacement Preview ({replacePreview.length} of {findInFiles ? totalFileMatches : matches.length})
            </div>
            {replacePreview.map((p, i) => (
              <div key={i}>
                {p.file && (
                  <div style={{ fontSize: '10px', color: 'var(--text-muted, #484f58)', padding: '2px 4px 0' }}>
                    {p.file}:{p.line}
                  </div>
                )}
                <div style={{ ...styles.previewLine, ...styles.previewOriginal }}>
                  - {p.original}
                </div>
                <div style={{ ...styles.previewLine, ...styles.previewReplaced }}>
                  + {p.replaced}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Status bar ──────────────────────────────────────────────── */}
        {searchTerm && (
          <div style={styles.statusBar}>
            <span>
              {findInFiles
                ? `${totalFileMatches} match${totalFileMatches !== 1 ? 'es' : ''} in ${fileResults.length} file${fileResults.length !== 1 ? 's' : ''}`
                : `${matches.length} match${matches.length !== 1 ? 'es' : ''}${searchInSelection ? ' in selection' : ''}`}
            </span>
            <span style={{ display: 'flex', gap: '8px' }}>
              {caseSensitive && <span title="Case sensitive">Aa</span>}
              {wholeWord && <span title="Whole word">W</span>}
              {useRegex && <span title="Regex">.*</span>}
              {preserveCase && <span title="Preserve case">AB</span>}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
