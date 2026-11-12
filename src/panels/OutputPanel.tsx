import { useEffect, useRef, useState, useCallback, useMemo, type ReactNode, type CSSProperties } from 'react'
import {
  useOutputStore,
  type OutputLineType,
} from '@/store/output'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { openFileInEditor } from '@/utils/openFileInEditor'
import {
  ChevronDown, ChevronUp, Trash2, Copy, WrapText, FileOutput,
  Pin, PinOff, Clock, Search, X, Filter, ExternalLink,
} from 'lucide-react'

/* ══════════════════════════════════════════════════════════════
   Constants & helpers
   ══════════════════════════════════════════════════════════════ */

const LINE_HEIGHT = 20
const OVERSCAN = 10

/** All possible channels the panel recognises */
const ALL_CHANNELS = ['Orion', 'Git', 'Extensions', 'Tasks', 'TypeScript', 'ESLint'] as const

/** Log level → colour mapping (includes debug mapped from success) */
const LOG_LEVEL_COLORS: Record<string, string> = {
  info:    'var(--output-info, #58a6ff)',
  warn:    'var(--output-warn, #d29922)',
  error:   'var(--output-error, #f85149)',
  success: 'var(--output-success, #3fb950)',
  debug:   'var(--output-debug, #8b949e)',
}

/** Inline log‑level tag colours (when [INFO] etc. is inside the text) */
const TAG_COLORS: Record<string, string> = {
  INFO:  'var(--output-info, #58a6ff)',
  WARN:  'var(--output-warn, #d29922)',
  ERROR: 'var(--output-error, #f85149)',
  DEBUG: 'var(--output-debug, #8b949e)',
}

/* ── ANSI escape code parser ───────────────────────────────── */

const ANSI_RE = /\x1b\[([0-9;]*)m/g

interface AnsiSpan { text: string; style: CSSProperties }

function parseAnsi(raw: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  let last = 0
  let style: CSSProperties = {}
  let match: RegExpExecArray | null

  ANSI_RE.lastIndex = 0
  while ((match = ANSI_RE.exec(raw)) !== null) {
    if (match.index > last) {
      spans.push({ text: raw.slice(last, match.index), style: { ...style } })
    }
    last = ANSI_RE.lastIndex
    const codes = match[1].split(';').map(Number)
    for (const code of codes) {
      style = applyAnsiCode(code, style)
    }
  }
  if (last < raw.length) {
    spans.push({ text: raw.slice(last), style: { ...style } })
  }
  if (spans.length === 0) spans.push({ text: raw, style: {} })
  return spans
}

function applyAnsiCode(code: number, prev: CSSProperties): CSSProperties {
  const s = { ...prev }
  if (code === 0)  return {}
  if (code === 1)  { s.fontWeight = 'bold'; return s }
  if (code === 3)  { s.fontStyle = 'italic'; return s }
  if (code === 4)  { s.textDecoration = 'underline'; return s }
  if (code === 22) { delete s.fontWeight; return s }
  if (code === 23) { delete s.fontStyle; return s }
  if (code === 24) { delete s.textDecoration; return s }
  // Foreground colours
  const fg: Record<number, string> = {
    30: '#1e1e1e', 31: '#f85149', 32: '#3fb950', 33: '#d29922',
    34: '#58a6ff', 35: '#bc8cff', 36: '#39c5cf', 37: '#e6edf3',
    90: '#8b949e', 91: '#ff7b72', 92: '#56d364', 93: '#e3b341',
    94: '#79c0ff', 95: '#d2a8ff', 96: '#56d4dd', 97: '#ffffff',
  }
  if (fg[code]) { s.color = fg[code]; return s }
  // Background colours
  const bg: Record<number, string> = {
    40: '#1e1e1e', 41: '#f85149', 42: '#3fb950', 43: '#d29922',
    44: '#58a6ff', 45: '#bc8cff', 46: '#39c5cf', 47: '#e6edf3',
    100: '#8b949e', 101: '#ff7b72', 102: '#56d364', 103: '#e3b341',
    104: '#79c0ff', 105: '#d2a8ff', 106: '#56d4dd', 107: '#ffffff',
  }
  if (bg[code]) { s.backgroundColor = bg[code]; return s }
  if (code === 39) { delete s.color; return s }
  if (code === 49) { delete s.backgroundColor; return s }
  return s
}

/* ── File path detection ───────────────────────────────────── */

/**
 * File references such as /foo/bar.ts:42, ./src/x.js:10:5, src/a.tsx or
 * C:\foo\bar.ts:7. A link needs a directory part and a file extension that
 * starts with a letter, and must not continue a word, URL or path (a colour
 * code may precede it), so 'Mozilla/5.0', 'feature/login' or
 * 'https://host/x.js' stay plain.
 */
const FILE_PATH_RE = /(?:(?<=\x1b\[[\d;]*m)|(?<![\w.@+\-/\\:])(?<!\x1b\[[\d;]*))((?:(?:[a-zA-Z]:[\\/]|\.{0,2}\/|\.{1,2}\\)(?:[\w.@+-]+[\\/])*|(?:[\w.@+-]+[\\/])+)[\w.@+-]*\.[a-zA-Z]\w*)(?::(\d+)(?::\d+)?)?/g

export interface TextSegment {
  text: string
  filePath?: string
  line?: number
}

/** Split a line of output into plain text and file-reference segments. */
export function splitFileLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let last = 0
  FILE_PATH_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) })
    segments.push({ text: match[0], filePath: match[1], line: match[2] ? parseInt(match[2], 10) : undefined })
    last = FILE_PATH_RE.lastIndex
  }
  if (last < text.length) segments.push({ text: text.slice(last) })
  if (segments.length === 0) segments.push({ text })
  return segments
}

/**
 * Relative paths in tool output (src/x.ts, ./x.ts) are relative to the
 * workspace root. Windows paths get backslashes throughout, as the file tree
 * has them: tabs are keyed by path, so git's 'src/a.ts' must not become
 * 'C:\p\src/a.ts', a second tab on a file that is already open.
 */
export function resolveOutputPath(filePath: string, root: string | null): string {
  if (/^[a-zA-Z]:[\\/]/.test(filePath)) return filePath.replace(/\//g, '\\')
  if (filePath.startsWith('/') || !root) return filePath
  const sep = root.includes('\\') ? '\\' : '/'
  const rel = filePath.replace(/^\.[\\/]/, '')
  return `${root.replace(/[\\/]+$/, '')}${sep}${sep === '\\' ? rel.replace(/\//g, '\\') : rel}`
}

/** Read the file into a tab (never an empty buffer bound to the real path), then jump to the line. */
export async function openOutputLink(filePath: string, line?: number): Promise<void> {
  const opened = await openFileInEditor(resolveOutputPath(filePath, useFileStore.getState().rootPath))
  if (opened && line) {
    // The editor switches models after the store update; go to the line once it has.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('orion:go-to-line', { detail: { line } }))
    }, 50)
  }
}

function renderTextWithLinks(
  text: string,
  baseStyle: CSSProperties,
  searchTerm: string,
  onFileClick: (path: string, line?: number) => void,
): ReactNode[] {
  const segments = splitFileLinks(text)

  const nodes: ReactNode[] = []
  let key = 0

  for (const seg of segments) {
    if (seg.filePath) {
      const filePath = seg.filePath
      nodes.push(
        <span
          key={key++}
          onClick={(e) => {
            e.stopPropagation()
            onFileClick(filePath, seg.line)
          }}
          style={{
            ...baseStyle,
            color: 'var(--accent, #58a6ff)',
            textDecoration: 'underline',
            cursor: 'pointer',
            textUnderlineOffset: 2,
          }}
          title={`Open ${seg.filePath}${seg.line ? `:${seg.line}` : ''}`}
        >
          {highlightSearch(seg.text, searchTerm, key)}
        </span>,
      )
    } else {
      // Parse ANSI within non-path segments
      const spans = parseAnsi(seg.text)
      for (const span of spans) {
        nodes.push(
          <span key={key++} style={{ ...baseStyle, ...span.style }}>
            {highlightSearch(span.text, searchTerm, key)}
          </span>,
        )
      }
    }
  }
  return nodes
}

/* ── Search highlight ──────────────────────────────────────── */

function highlightSearch(text: string, term: string, baseKey: number): ReactNode {
  if (!term) return text
  const lower = text.toLowerCase()
  const tLower = term.toLowerCase()
  const parts: ReactNode[] = []
  let last = 0
  let idx = lower.indexOf(tLower, last)
  let k = 0
  while (idx !== -1) {
    if (idx > last) parts.push(text.slice(last, idx))
    parts.push(
      <mark
        key={`hl-${baseKey}-${k++}`}
        style={{
          background: 'var(--output-search-match, rgba(255,200,0,0.35))',
          color: 'inherit',
          borderRadius: 2,
          padding: '0 1px',
        }}
      >
        {text.slice(idx, idx + term.length)}
      </mark>,
    )
    last = idx + term.length
    idx = lower.indexOf(tLower, last)
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length > 0 ? <>{parts}</> : text
}

/* ── Detect inline log level tag ───────────────────────────── */

const LOG_TAG_RE = /^\[?(INFO|WARN|WARNING|ERROR|ERR|DEBUG)\]?\s*/i

function detectLogLevel(text: string): 'info' | 'warn' | 'error' | 'debug' | null {
  const m = text.match(LOG_TAG_RE)
  if (!m) return null
  const t = m[1].toUpperCase()
  if (t === 'INFO') return 'info'
  if (t === 'WARN' || t === 'WARNING') return 'warn'
  if (t === 'ERROR' || t === 'ERR') return 'error'
  if (t === 'DEBUG') return 'debug'
  return null
}

/* ── Format timestamp ────────────────────────────────────────── */

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

/* ══════════════════════════════════════════════════════════════
   OutputPanel – main component
   ══════════════════════════════════════════════════════════════ */

export default function OutputPanel() {
  const channels    = useOutputStore((s) => s.channels)
  const active      = useOutputStore((s) => s.activeChannel)
  const setActive   = useOutputStore((s) => s.setActiveChannel)
  const clearChan   = useOutputStore((s) => s.clearChannel)
  const openFile    = useEditorStore((s) => s.openFile)

  const [wordWrap, setWordWrap]             = useState(true)
  const [dropdownOpen, setDropdownOpen]     = useState(false)
  const [copyFeedback, setCopyFeedback]     = useState(false)
  const [pinToBottom, setPinToBottom]        = useState(true)
  const [showTimestamps, setShowTimestamps] = useState(true)
  const [filterOpen, setFilterOpen]         = useState(false)
  const [filterText, setFilterText]         = useState('')
  const [searchOpen, setSearchOpen]         = useState(false)
  const [searchText, setSearchText]         = useState('')
  const [searchMatchIdx, setSearchMatchIdx] = useState(0)
  const [levelFilter, setLevelFilter]       = useState<Set<string>>(new Set(['info', 'warn', 'error', 'success', 'debug']))
  const [levelDropdownOpen, setLevelDropdownOpen] = useState(false)

  /** Track the last‑seen line count per channel for unread badges */
  const [lastSeen, setLastSeen] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>()
    for (const ch of ALL_CHANNELS) m.set(ch, 0)
    return m
  })

  const scrollRef     = useRef<HTMLDivElement>(null)
  const dropdownRef   = useRef<HTMLDivElement>(null)
  const filterRef     = useRef<HTMLInputElement>(null)
  const searchRef     = useRef<HTMLInputElement>(null)
  const levelDropRef  = useRef<HTMLDivElement>(null)
  const containerRef  = useRef<HTMLDivElement>(null)

  /* ── Mark active channel as "seen" ─────────────────────────── */

  const allLines = channels.get(active) ?? []

  useEffect(() => {
    setLastSeen((prev) => {
      const next = new Map(prev)
      next.set(active, allLines.length)
      return next
    })
  }, [active, allLines.length])

  /* ── Unread counts per channel ─────────────────────────────── */

  const unreadCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const ch of ALL_CHANNELS) {
      const total = (channels.get(ch) ?? []).length
      const seen = lastSeen.get(ch) ?? 0
      counts.set(ch, Math.max(0, total - seen))
    }
    return counts
  }, [channels, lastSeen])

  /* ── Filtered lines (by log level + text filter) ───────────── */

  const lines = useMemo(() => {
    let result = allLines

    // Filter by log level
    if (levelFilter.size < 5) {
      result = result.filter((l) => {
        const detected = detectLogLevel(l.text)
        const effectiveLevel = detected ?? l.type
        return levelFilter.has(effectiveLevel)
      })
    }

    // Filter by text
    if (filterText) {
      const lower = filterText.toLowerCase()
      result = result.filter((l) => l.text.toLowerCase().includes(lower))
    }
    return result
  }, [allLines, filterText, levelFilter])

  /* ── Search matches ────────────────────────────────────────── */

  const searchMatches = useMemo(() => {
    if (!searchText) return []
    const lower = searchText.toLowerCase()
    const matches: number[] = []
    lines.forEach((l, i) => {
      if (l.text.toLowerCase().includes(lower)) matches.push(i)
    })
    return matches
  }, [lines, searchText])

  useEffect(() => {
    if (searchMatches.length > 0) {
      setSearchMatchIdx((prev) => Math.min(prev, searchMatches.length - 1))
    }
  }, [searchMatches.length])

  /* ── Virtual scrolling state ───────────────────────────────── */

  const [scrollTop, setScrollTop]       = useState(0)
  const [viewportH, setViewportH]       = useState(400)

  const totalHeight = lines.length * LINE_HEIGHT
  const startIdx    = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN)
  const endIdx      = Math.min(lines.length, Math.ceil((scrollTop + viewportH) / LINE_HEIGHT) + OVERSCAN)
  const visibleLines = lines.slice(startIdx, endIdx)
  const offsetY      = startIdx * LINE_HEIGHT

  /* ── Measure viewport ──────────────────────────────────────── */

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setViewportH(e.contentRect.height)
    })
    ro.observe(el)
    setViewportH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  /* ── Auto-scroll (pin to bottom) ───────────────────────────── */

  useEffect(() => {
    if (pinToBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines.length, pinToBottom])

  /* ── Scroll to search match ────────────────────────────────── */

  useEffect(() => {
    if (searchMatches.length === 0 || !scrollRef.current) return
    const matchLine = searchMatches[searchMatchIdx]
    if (matchLine === undefined) return
    const targetTop = matchLine * LINE_HEIGHT
    const el = scrollRef.current
    if (targetTop < el.scrollTop || targetTop > el.scrollTop + el.clientHeight - LINE_HEIGHT) {
      el.scrollTop = targetTop - el.clientHeight / 2
    }
  }, [searchMatchIdx, searchMatches])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollTop(el.scrollTop)

    if (pinToBottom) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      if (!atBottom) setPinToBottom(false)
    }
  }, [pinToBottom])

  /* ── Close dropdowns on outside click ──────────────────────── */

  useEffect(() => {
    if (!dropdownOpen && !levelDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownOpen && dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
      if (levelDropdownOpen && levelDropRef.current && !levelDropRef.current.contains(e.target as Node)) {
        setLevelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen, levelDropdownOpen])

  /* ── Focus inputs on open ──────────────────────────────────── */

  useEffect(() => {
    if (filterOpen && filterRef.current) filterRef.current.focus()
  }, [filterOpen])

  useEffect(() => {
    if (searchOpen && searchRef.current) searchRef.current.focus()
  }, [searchOpen])

  /* ── Keyboard shortcuts (Ctrl+F) ───────────────────────────── */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        // Only capture if panel is focused
        if (containerRef.current?.contains(document.activeElement) || containerRef.current === document.activeElement) {
          e.preventDefault()
          e.stopPropagation()
          setSearchOpen(true)
        }
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [])

  /* ── Copy all output ───────────────────────────────────────── */

  const handleCopy = useCallback(() => {
    const text = lines
      .map((l) => `[${fmtTime(l.timestamp)}] ${l.text}`)
      .join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 1500)
    })
  }, [lines])

  /* ── Open in editor ────────────────────────────────────────── */

  const handleOpenInEditor = useCallback(() => {
    const text = lines
      .map((l) => `[${fmtTime(l.timestamp)}] ${l.text}`)
      .join('\n')
    const vpath = `output://${active}.log`
    openFile({ path: vpath, name: `${active} Output`, content: text, language: 'log', isModified: false, aiModified: false })
  }, [lines, active, openFile])

  /* ── Toggle filter bar ─────────────────────────────────────── */

  const toggleFilter = useCallback(() => {
    setFilterOpen((v) => {
      if (v) setFilterText('')
      return !v
    })
  }, [])

  /* ── Toggle level filter ───────────────────────────────────── */

  const toggleLevel = useCallback((level: string) => {
    setLevelFilter((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }, [])

  /* ── Search navigation ─────────────────────────────────────── */

  const gotoNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return
    setSearchMatchIdx((prev) => (prev + 1) % searchMatches.length)
  }, [searchMatches.length])

  const gotoPrevMatch = useCallback(() => {
    if (searchMatches.length === 0) return
    setSearchMatchIdx((prev) => (prev - 1 + searchMatches.length) % searchMatches.length)
  }, [searchMatches.length])

  /* ── Channel list (ensure all default channels appear) ─────── */

  const channelNames = useMemo(() => {
    const set = new Set<string>(ALL_CHANNELS)
    for (const k of channels.keys()) set.add(k)
    return Array.from(set)
  }, [channels])

  /* ── Determine effective color for a line ──────────────────── */

  const getLineColor = useCallback((line: { text: string; type: OutputLineType }) => {
    const detected = detectLogLevel(line.text)
    if (detected) return LOG_LEVEL_COLORS[detected] ?? LOG_LEVEL_COLORS.info
    return LOG_LEVEL_COLORS[line.type] ?? LOG_LEVEL_COLORS.info
  }, [])

  /* ── Render a log level tag with colour ────────────────────── */

  const renderLogTag = useCallback((text: string): { tag: ReactNode; rest: string } | null => {
    const m = text.match(LOG_TAG_RE)
    if (!m) return null
    const tagText = m[0]
    const level = m[1].toUpperCase()
    const color = TAG_COLORS[level === 'WARNING' ? 'WARN' : level === 'ERR' ? 'ERROR' : level] ?? TAG_COLORS.INFO
    return {
      tag: (
        <span style={{ color, fontWeight: 600 }}>{tagText}</span>
      ),
      rest: text.slice(tagText.length),
    }
  }, [])

  /* ── Toolbar shared props ──────────────────────────────────── */

  const toolbarProps = {
    channelNames,
    active,
    setActive,
    dropdownOpen,
    setDropdownOpen,
    dropdownRef,
    onClear: () => clearChan(active),
    onCopy: handleCopy,
    copyFeedback,
    wordWrap,
    onToggleWrap: () => setWordWrap((v) => !v),
    pinToBottom,
    onTogglePin: () => setPinToBottom((v) => !v),
    showTimestamps,
    onToggleTimestamps: () => setShowTimestamps((v) => !v),
    onToggleFilter: toggleFilter,
    filterOpen,
    onOpenInEditor: handleOpenInEditor,
    levelFilter,
    onToggleLevel: toggleLevel,
    levelDropdownOpen,
    setLevelDropdownOpen,
    levelDropRef,
    unreadCounts,
    onToggleSearch: () => setSearchOpen((v) => !v),
    searchOpen,
  }

  /* ── Empty state ───────────────────────────────────────────── */

  if (lines.length === 0 && !filterText && !searchText) {
    return (
      <div ref={containerRef} tabIndex={-1} style={{ height: '100%', display: 'flex', flexDirection: 'column', outline: 'none' }}>
        <Toolbar {...toolbarProps} />
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FileOutput size={18} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, marginTop: 4 }}>
            No output
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 11, opacity: 0.5 }}>
            Output from {active} channel will appear here
          </p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} tabIndex={-1} style={{ height: '100%', display: 'flex', flexDirection: 'column', outline: 'none', position: 'relative' }}>
      <Toolbar {...toolbarProps} />

      {/* ── Search bar (Ctrl+F) ──────────────────────────────── */}
      {searchOpen && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 8px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            flexShrink: 0,
          }}
        >
          <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search output... (Ctrl+F)"
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); setSearchMatchIdx(0) }}
            style={{
              flex: 1,
              height: 22,
              fontSize: 11,
              color: 'var(--text-primary)',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              padding: '0 6px',
              outline: 'none',
              fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchText('')
                setSearchOpen(false)
              } else if (e.key === 'Enter') {
                if (e.shiftKey) gotoPrevMatch()
                else gotoNextMatch()
              }
            }}
          />
          {searchText && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {searchMatches.length > 0 ? `${searchMatchIdx + 1}/${searchMatches.length}` : 'No matches'}
            </span>
          )}
          <ToolbarButton title="Previous match (Shift+Enter)" onClick={gotoPrevMatch}>
            <ChevronUp size={12} />
          </ToolbarButton>
          <ToolbarButton title="Next match (Enter)" onClick={gotoNextMatch}>
            <ChevronDown size={12} />
          </ToolbarButton>
          <button
            onClick={() => { setSearchText(''); setSearchOpen(false) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 2,
              borderRadius: 3,
            }}
            title="Close search (Esc)"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── Filter bar ──────────────────────────────────────── */}
      {filterOpen && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 8px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            flexShrink: 0,
          }}
        >
          <Filter size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={filterRef}
            type="text"
            placeholder="Filter output..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{
              flex: 1,
              height: 22,
              fontSize: 11,
              color: 'var(--text-primary)',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              padding: '0 6px',
              outline: 'none',
              fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFilterText('')
                setFilterOpen(false)
              }
            }}
          />
          {filterText && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
              {lines.length} match{lines.length !== 1 ? 'es' : ''}
            </span>
          )}
          <button
            onClick={() => { setFilterText(''); setFilterOpen(false) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 2,
              borderRadius: 3,
            }}
            title="Close filter"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── Log area (virtual scrolling) ─────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: wordWrap ? 'hidden' : 'auto',
          fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
          fontSize: 12,
          lineHeight: `${LINE_HEIGHT}px`,
          position: 'relative',
        }}
      >
        {lines.length === 0 && (filterText || levelFilter.size < 5) ? (
          <div
            style={{
              padding: '20px 10px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 11,
            }}
          >
            No results matching current filters
          </div>
        ) : (
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ position: 'absolute', top: offsetY, left: 0, right: 0 }}>
              {visibleLines.map((line, i) => {
                const globalIdx = startIdx + i
                const isSearchMatch = searchText && searchMatches.includes(globalIdx)
                const isCurrentMatch = isSearchMatch && searchMatches[searchMatchIdx] === globalIdx
                const lineColor = getLineColor(line)
                const tagResult = renderLogTag(line.text)

                return (
                  <div
                    key={line.id}
                    style={{
                      display: 'flex',
                      height: LINE_HEIGHT,
                      padding: '0 10px',
                      whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
                      wordBreak: wordWrap ? 'break-all' : undefined,
                      alignItems: 'center',
                      background: isCurrentMatch
                        ? 'var(--output-search-current, rgba(255,200,0,0.15))'
                        : isSearchMatch
                        ? 'var(--output-search-bg, rgba(255,200,0,0.07))'
                        : 'transparent',
                      borderLeft: isCurrentMatch
                        ? '2px solid var(--output-search-border, #e3b341)'
                        : '2px solid transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      if (!isCurrentMatch && !isSearchMatch) {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isCurrentMatch && !isSearchMatch) {
                        e.currentTarget.style.background = 'transparent'
                      }
                    }}
                  >
                    {/* Line number */}
                    <span
                      style={{
                        color: 'var(--text-muted)',
                        opacity: 0.3,
                        fontSize: 10,
                        flexShrink: 0,
                        width: 36,
                        textAlign: 'right',
                        paddingRight: 8,
                        userSelect: 'none',
                      }}
                    >
                      {globalIdx + 1}
                    </span>

                    {/* Timestamp */}
                    {showTimestamps && (
                      <span
                        style={{
                          color: 'var(--text-muted)',
                          opacity: 0.4,
                          fontSize: 10,
                          flexShrink: 0,
                          width: 62,
                          userSelect: 'none',
                        }}
                      >
                        {fmtTime(line.timestamp)}
                      </span>
                    )}

                    {/* Log level indicator dot */}
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: lineColor,
                        flexShrink: 0,
                        marginRight: 6,
                        opacity: 0.7,
                      }}
                    />

                    {/* Text */}
                    <span style={{ color: lineColor, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {tagResult ? (
                        <>
                          {tagResult.tag}
                          {renderTextWithLinks(tagResult.rest, { color: lineColor }, searchText, openOutputLink)}
                        </>
                      ) : (
                        renderTextWithLinks(line.text, { color: lineColor }, searchText, openOutputLink)
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Scroll-to-bottom indicator ────────────────────────── */}
      {!pinToBottom && (
        <button
          onClick={() => {
            setPinToBottom(true)
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight
            }
          }}
          style={{
            position: 'absolute',
            bottom: 8,
            right: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            fontSize: 10,
            fontWeight: 500,
            color: 'var(--text-primary)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            zIndex: 10,
          }}
          title="Scroll to bottom and pin"
        >
          <ChevronDown size={12} />
          Follow output
        </button>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   Toolbar
   ══════════════════════════════════════════════════════════════ */

interface ToolbarProps {
  channelNames: string[]
  active: string
  setActive: (ch: string) => void
  dropdownOpen: boolean
  setDropdownOpen: (v: boolean) => void
  dropdownRef: React.RefObject<HTMLDivElement | null>
  onClear: () => void
  onCopy: () => void
  copyFeedback: boolean
  wordWrap: boolean
  onToggleWrap: () => void
  pinToBottom: boolean
  onTogglePin: () => void
  showTimestamps: boolean
  onToggleTimestamps: () => void
  onToggleFilter: () => void
  filterOpen: boolean
  onOpenInEditor: () => void
  levelFilter: Set<string>
  onToggleLevel: (level: string) => void
  levelDropdownOpen: boolean
  setLevelDropdownOpen: (v: boolean) => void
  levelDropRef: React.RefObject<HTMLDivElement | null>
  unreadCounts: Map<string, number>
  onToggleSearch: () => void
  searchOpen: boolean
}

function Toolbar(props: ToolbarProps) {
  const {
    channelNames, active, setActive, dropdownOpen, setDropdownOpen, dropdownRef,
    onClear, onCopy, copyFeedback, wordWrap, onToggleWrap,
    pinToBottom, onTogglePin, showTimestamps, onToggleTimestamps,
    onToggleFilter, filterOpen, onOpenInEditor,
    levelFilter, onToggleLevel, levelDropdownOpen, setLevelDropdownOpen, levelDropRef,
    unreadCounts, onToggleSearch, searchOpen,
  } = props

  const allLevels = [
    { key: 'info',    label: 'Info',    color: LOG_LEVEL_COLORS.info },
    { key: 'warn',    label: 'Warn',    color: LOG_LEVEL_COLORS.warn },
    { key: 'error',   label: 'Error',   color: LOG_LEVEL_COLORS.error },
    { key: 'debug',   label: 'Debug',   color: LOG_LEVEL_COLORS.debug },
    { key: 'success', label: 'Success', color: LOG_LEVEL_COLORS.success },
  ]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      {/* ── Channel selector ──────────────────────────────────── */}
      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            height: 24,
            padding: '0 8px',
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--text-primary)',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent, #58a6ff)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
        >
          <FileOutput size={11} style={{ opacity: 0.6, flexShrink: 0 }} />
          {active}
          {(unreadCounts.get(active) ?? 0) > 0 && (
            <UnreadBadge count={unreadCounts.get(active)!} />
          )}
          <ChevronDown size={11} style={{ opacity: 0.5 }} />
        </button>

        {dropdownOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 2,
              minWidth: 180,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              borderRadius: 5,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              zIndex: 100,
              overflow: 'hidden',
            }}
          >
            {channelNames.map((ch) => {
              const unread = unreadCounts.get(ch) ?? 0
              return (
                <button
                  key={ch}
                  onClick={() => {
                    setActive(ch)
                    setDropdownOpen(false)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    textAlign: 'left',
                    padding: '5px 10px',
                    fontSize: 11,
                    fontWeight: active === ch ? 600 : 400,
                    color: active === ch ? 'var(--accent)' : 'var(--text-secondary)',
                    background: active === ch ? 'rgba(88,166,255,0.08)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    gap: 8,
                  }}
                  onMouseEnter={(e) => {
                    if (active !== ch) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                  }}
                  onMouseLeave={(e) => {
                    if (active !== ch) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <span>{ch}</span>
                  {unread > 0 && <UnreadBadge count={unread} />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* ── Log level filter dropdown ─────────────────────────── */}
      <div ref={levelDropRef} style={{ position: 'relative' }}>
        <ToolbarButton
          title="Filter by log level"
          active={levelFilter.size < 5}
          onClick={() => setLevelDropdownOpen(!levelDropdownOpen)}
        >
          <Filter size={13} />
        </ToolbarButton>

        {levelDropdownOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 2,
              minWidth: 150,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              borderRadius: 5,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              zIndex: 100,
              overflow: 'hidden',
              padding: '4px 0',
            }}
          >
            <div style={{ padding: '3px 10px 5px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Log Levels
            </div>
            {allLevels.map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => onToggleLevel(key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  textAlign: 'left',
                  padding: '4px 10px',
                  fontSize: 11,
                  color: levelFilter.has(key) ? 'var(--text-primary)' : 'var(--text-muted)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    border: `1px solid ${levelFilter.has(key) ? color : 'var(--border)'}`,
                    background: levelFilter.has(key) ? color : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: 9,
                    color: '#fff',
                    fontWeight: 700,
                  }}
                >
                  {levelFilter.has(key) ? '\u2713' : ''}
                </span>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: color,
                    flexShrink: 0,
                    opacity: 0.7,
                  }}
                />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Search toggle (Ctrl+F) ───────────────────────────── */}
      <ToolbarButton
        title={searchOpen ? 'Close search (Esc)' : 'Search output (Ctrl+F)'}
        active={searchOpen}
        onClick={onToggleSearch}
      >
        <Search size={13} />
      </ToolbarButton>

      {/* ── Filter toggle ────────────────────────────────────── */}
      <ToolbarButton
        title={filterOpen ? 'Close filter' : 'Filter output'}
        active={filterOpen}
        onClick={onToggleFilter}
      >
        <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1 }}>F</span>
      </ToolbarButton>

      {/* ── Timestamp toggle ─────────────────────────────────── */}
      <ToolbarButton
        title={showTimestamps ? 'Hide timestamps' : 'Show timestamps'}
        active={showTimestamps}
        onClick={onToggleTimestamps}
      >
        <Clock size={13} />
      </ToolbarButton>

      {/* ── Pin to bottom toggle ─────────────────────────────── */}
      <ToolbarButton
        title={pinToBottom ? 'Unpin from bottom' : 'Pin to bottom (auto-scroll)'}
        active={pinToBottom}
        onClick={onTogglePin}
      >
        {pinToBottom ? <Pin size={13} /> : <PinOff size={13} />}
      </ToolbarButton>

      {/* ── Word wrap toggle ─────────────────────────────────── */}
      <ToolbarButton
        title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
        active={wordWrap}
        onClick={onToggleWrap}
      >
        <WrapText size={13} />
      </ToolbarButton>

      {/* ── Open in editor ───────────────────────────────────── */}
      <ToolbarButton title="Open output in editor" onClick={onOpenInEditor}>
        <ExternalLink size={13} />
      </ToolbarButton>

      {/* ── Copy ─────────────────────────────────────────────── */}
      <ToolbarButton title="Copy all output" onClick={onCopy}>
        <Copy size={13} />
        {copyFeedback && (
          <span style={{ fontSize: 9, marginLeft: 2, color: 'var(--accent-green, #3fb950)' }}>
            Copied
          </span>
        )}
      </ToolbarButton>

      {/* ── Clear ────────────────────────────────────────────── */}
      <button
        title="Clear output"
        onClick={onClear}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          height: 22,
          padding: '0 5px',
          borderRadius: 3,
          border: 'none',
          cursor: 'pointer',
          color: 'var(--accent-red, #f85149)',
          background: 'transparent',
          transition: 'background 0.1s, color 0.1s',
          opacity: 0.8,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(248,81,73,0.15)'
          e.currentTarget.style.opacity = '1'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.opacity = '0.8'
        }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   Small sub-components
   ══════════════════════════════════════════════════════════════ */

function UnreadBadge({ count }: { count: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 16,
        height: 14,
        padding: '0 4px',
        borderRadius: 7,
        fontSize: 9,
        fontWeight: 700,
        color: '#fff',
        background: 'var(--accent, #58a6ff)',
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function ToolbarButton({
  title,
  onClick,
  children,
  active,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        height: 22,
        padding: '0 5px',
        borderRadius: 3,
        border: 'none',
        cursor: 'pointer',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        background: active ? 'rgba(88,166,255,0.10)' : 'transparent',
        transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
        e.currentTarget.style.color = 'var(--text-primary)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? 'rgba(88,166,255,0.10)' : 'transparent'
        e.currentTarget.style.color = active ? 'var(--accent)' : 'var(--text-muted)'
      }}
    >
      {children}
    </button>
  )
}
