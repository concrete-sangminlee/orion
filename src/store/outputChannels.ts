import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { create } from 'zustand'

/* ═══════════════════════════════════════════════════════════════════════════
   Output Channel Management Store & OutputPanel Component
   ─────────────────────────────────────────────────────────────────────────
   VS Code-style Output panel: multiple named channels with log levels,
   ANSI color support, virtualized rendering, search, and filtering.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Constants ─────────────────────────────────────────────────────────── */

const DEFAULT_MAX_BUFFER_LINES = 100_000
const VIRTUAL_LINE_HEIGHT = 18
const VIRTUAL_OVERSCAN = 20

const DEFAULT_CHANNEL_NAMES = [
  'Orion',
  'Git',
  'TypeScript',
  'ESLint',
  'Tasks',
  'Extensions',
  'Debug Console',
  'Telemetry',
] as const

export type DefaultChannelName = (typeof DEFAULT_CHANNEL_NAMES)[number]

/* ── Log Levels ────────────────────────────────────────────────────────── */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warning' | 'error'

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warning: 3,
  error: 4,
}

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  trace: 'var(--output-trace, #6a9955)',
  debug: 'var(--output-debug, #569cd6)',
  info: 'var(--output-info, #cccccc)',
  warning: 'var(--output-warning, #cca700)',
  error: 'var(--output-error, #f14c4c)',
}

const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO',
  warning: 'WARN',
  error: 'ERROR',
}

/* ── ANSI Color Parsing ────────────────────────────────────────────────── */

export interface AnsiSegment {
  text: string
  fg?: string
  bg?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  dim?: boolean
  strikethrough?: boolean
}

const ANSI_REGEX = /\x1b\[([0-9;]*)m/g

const ANSI_FG_MAP: Record<number, string> = {
  30: '#000000', 31: '#cd3131', 32: '#0dbc79', 33: '#e5e510',
  34: '#2472c8', 35: '#bc3fbc', 36: '#11a8cd', 37: '#e5e5e5',
  90: '#666666', 91: '#f14c4c', 92: '#23d18b', 93: '#f5f543',
  94: '#3b8eea', 95: '#d670d6', 96: '#29b8db', 97: '#ffffff',
}

const ANSI_BG_MAP: Record<number, string> = {
  40: '#000000', 41: '#cd3131', 42: '#0dbc79', 43: '#e5e510',
  44: '#2472c8', 45: '#bc3fbc', 46: '#11a8cd', 47: '#e5e5e5',
  100: '#666666', 101: '#f14c4c', 102: '#23d18b', 103: '#f5f543',
  104: '#3b8eea', 105: '#d670d6', 106: '#29b8db', 107: '#ffffff',
}

export function parseAnsi(raw: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  let lastIndex = 0
  let fg: string | undefined
  let bg: string | undefined
  let bold = false
  let italic = false
  let underline = false
  let dim = false
  let strikethrough = false

  let match: RegExpExecArray | null
  ANSI_REGEX.lastIndex = 0
  while ((match = ANSI_REGEX.exec(raw)) !== null) {
    // Push text before this escape
    if (match.index > lastIndex) {
      const text = raw.slice(lastIndex, match.index)
      if (text) segments.push({ text, fg, bg, bold, italic, underline, dim, strikethrough })
    }
    lastIndex = ANSI_REGEX.lastIndex

    // Parse codes
    const codes = match[1].split(';').map(Number)
    for (const code of codes) {
      if (code === 0) { fg = undefined; bg = undefined; bold = false; italic = false; underline = false; dim = false; strikethrough = false }
      else if (code === 1) bold = true
      else if (code === 2) dim = true
      else if (code === 3) italic = true
      else if (code === 4) underline = true
      else if (code === 9) strikethrough = true
      else if (code === 22) { bold = false; dim = false }
      else if (code === 23) italic = false
      else if (code === 24) underline = false
      else if (code === 29) strikethrough = false
      else if (code === 39) fg = undefined
      else if (code === 49) bg = undefined
      else if (ANSI_FG_MAP[code]) fg = ANSI_FG_MAP[code]
      else if (ANSI_BG_MAP[code]) bg = ANSI_BG_MAP[code]
    }
  }

  // Remaining text
  if (lastIndex < raw.length) {
    const text = raw.slice(lastIndex)
    if (text) segments.push({ text, fg, bg, bold, italic, underline, dim, strikethrough })
  }

  if (segments.length === 0 && raw.length > 0) {
    segments.push({ text: raw })
  }

  return segments
}

export function stripAnsi(raw: string): string {
  return raw.replace(ANSI_REGEX, '')
}

/* ── Types ─────────────────────────────────────────────────────────────── */

let globalLineId = 0

export interface OutputLine {
  id: number
  text: string
  rawText: string
  level: LogLevel
  timestamp: number
  channelId: string
  ansiSegments: AnsiSegment[]
}

export interface OutputChannel {
  id: string
  name: string
  lines: OutputLine[]
  visible: boolean
  disposed: boolean
  unreadCount: number
  maxBufferSize: number
  createdAt: number
  isLanguageServer: boolean
  /** Last time a line was written */
  lastWriteAt: number
}

export interface OutputChannelConfig {
  name: string
  maxBufferSize?: number
  isLanguageServer?: boolean
}

/* ── Store Interface ───────────────────────────────────────────────────── */

interface OutputChannelsState {
  channels: Record<string, OutputChannel>
  activeChannelId: string
  autoScroll: boolean
  wordWrap: boolean
  showTimestamps: boolean
  filterLevel: LogLevel
  searchQuery: string
  searchMatches: number[]

  // Channel CRUD
  createChannel: (config: OutputChannelConfig) => string
  disposeChannel: (channelId: string) => void
  removeChannel: (channelId: string) => void

  // Channel output operations
  append: (channelId: string, text: string, level?: LogLevel) => void
  appendLine: (channelId: string, text: string, level?: LogLevel) => void
  clear: (channelId: string) => void
  showChannel: (channelId: string) => void
  hideChannel: (channelId: string) => void

  // UI state
  setActiveChannel: (channelId: string) => void
  toggleAutoScroll: () => void
  toggleWordWrap: () => void
  toggleTimestamps: () => void
  setFilterLevel: (level: LogLevel) => void
  setSearchQuery: (query: string) => void
  markChannelRead: (channelId: string) => void

  // Bulk operations
  copyAllOutput: (channelId: string) => string
  getOutputAsText: (channelId: string) => string
  clearAll: () => void

  // Language server helper
  createLanguageServerChannel: (serverName: string) => string

  // Selectors
  getChannel: (channelId: string) => OutputChannel | undefined
  getFilteredLines: (channelId: string) => OutputLine[]
  getChannelNames: () => { id: string; name: string; unread: number; isLanguageServer: boolean }[]
  getSearchResults: (channelId: string, query: string) => number[]
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function createOutputChannel(config: OutputChannelConfig): OutputChannel {
  return {
    id: config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: config.name,
    lines: [],
    visible: true,
    disposed: false,
    unreadCount: 0,
    maxBufferSize: config.maxBufferSize ?? DEFAULT_MAX_BUFFER_LINES,
    createdAt: Date.now(),
    isLanguageServer: config.isLanguageServer ?? false,
    lastWriteAt: 0,
  }
}

function buildLine(channelId: string, text: string, level: LogLevel): OutputLine {
  const rawText = text
  const ansiSegments = parseAnsi(text)
  return {
    id: ++globalLineId,
    text: stripAnsi(text),
    rawText,
    level,
    timestamp: Date.now(),
    channelId,
    ansiSegments,
  }
}

function trimBuffer(lines: OutputLine[], max: number): OutputLine[] {
  if (lines.length <= max) return lines
  return lines.slice(lines.length - max)
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `[${h}:${m}:${s}.${ms}]`
}

/* ── Store ─────────────────────────────────────────────────────────────── */

export const useOutputChannelsStore = create<OutputChannelsState>((set, get) => {
  // Bootstrap default channels
  const initialChannels: Record<string, OutputChannel> = {}
  for (const name of DEFAULT_CHANNEL_NAMES) {
    const ch = createOutputChannel({ name })
    initialChannels[ch.id] = ch
  }

  return {
    channels: initialChannels,
    activeChannelId: 'orion',
    autoScroll: true,
    wordWrap: true,
    showTimestamps: false,
    filterLevel: 'info',
    searchQuery: '',
    searchMatches: [],

    /* ── Channel CRUD ──────────────────────────────────────────── */

    createChannel: (config) => {
      const ch = createOutputChannel(config)
      set((s) => ({
        channels: { ...s.channels, [ch.id]: ch },
      }))
      return ch.id
    },

    disposeChannel: (channelId) => {
      set((s) => {
        const ch = s.channels[channelId]
        if (!ch) return s
        return {
          channels: {
            ...s.channels,
            [channelId]: { ...ch, disposed: true, visible: false },
          },
        }
      })
    },

    removeChannel: (channelId) => {
      set((s) => {
        const { [channelId]: _, ...rest } = s.channels
        const nextActive = s.activeChannelId === channelId
          ? Object.keys(rest)[0] ?? 'orion'
          : s.activeChannelId
        return { channels: rest, activeChannelId: nextActive }
      })
    },

    /* ── Output Operations ─────────────────────────────────────── */

    append: (channelId, text, level = 'info') => {
      set((s) => {
        let ch = s.channels[channelId]
        if (!ch || ch.disposed) return s

        const newLine = buildLine(channelId, text, level)
        const lines = trimBuffer([...ch.lines, newLine], ch.maxBufferSize)
        const unreadCount = s.activeChannelId === channelId ? 0 : ch.unreadCount + 1

        return {
          channels: {
            ...s.channels,
            [channelId]: { ...ch, lines, unreadCount, lastWriteAt: Date.now() },
          },
        }
      })
    },

    appendLine: (channelId, text, level = 'info') => {
      set((s) => {
        let ch = s.channels[channelId]
        if (!ch || ch.disposed) return s

        const textLines = text.split('\n')
        const newLines = textLines.map((t) => buildLine(channelId, t, level))
        const lines = trimBuffer([...ch.lines, ...newLines], ch.maxBufferSize)
        const unreadCount = s.activeChannelId === channelId
          ? 0
          : ch.unreadCount + textLines.length

        return {
          channels: {
            ...s.channels,
            [channelId]: { ...ch, lines, unreadCount, lastWriteAt: Date.now() },
          },
        }
      })
    },

    clear: (channelId) => {
      set((s) => {
        const ch = s.channels[channelId]
        if (!ch) return s
        return {
          channels: {
            ...s.channels,
            [channelId]: { ...ch, lines: [], unreadCount: 0 },
          },
        }
      })
    },

    showChannel: (channelId) => {
      set((s) => {
        const ch = s.channels[channelId]
        if (!ch) return s
        return {
          channels: {
            ...s.channels,
            [channelId]: { ...ch, visible: true },
          },
          activeChannelId: channelId,
        }
      })
    },

    hideChannel: (channelId) => {
      set((s) => {
        const ch = s.channels[channelId]
        if (!ch) return s
        return {
          channels: {
            ...s.channels,
            [channelId]: { ...ch, visible: false },
          },
        }
      })
    },

    /* ── UI State ──────────────────────────────────────────────── */

    setActiveChannel: (channelId) => {
      set((s) => {
        const ch = s.channels[channelId]
        if (!ch) return s
        return {
          activeChannelId: channelId,
          channels: {
            ...s.channels,
            [channelId]: { ...ch, unreadCount: 0 },
          },
        }
      })
    },

    toggleAutoScroll: () => set((s) => ({ autoScroll: !s.autoScroll })),
    toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
    toggleTimestamps: () => set((s) => ({ showTimestamps: !s.showTimestamps })),
    setFilterLevel: (level) => set({ filterLevel: level }),

    setSearchQuery: (query) => {
      set((s) => {
        if (!query) return { searchQuery: '', searchMatches: [] }
        const ch = s.channels[s.activeChannelId]
        if (!ch) return { searchQuery: query, searchMatches: [] }
        const matches: number[] = []
        const lowerQ = query.toLowerCase()
        for (let i = 0; i < ch.lines.length; i++) {
          if (ch.lines[i].text.toLowerCase().includes(lowerQ)) {
            matches.push(ch.lines[i].id)
          }
        }
        return { searchQuery: query, searchMatches: matches }
      })
    },

    markChannelRead: (channelId) => {
      set((s) => {
        const ch = s.channels[channelId]
        if (!ch) return s
        return {
          channels: { ...s.channels, [channelId]: { ...ch, unreadCount: 0 } },
        }
      })
    },

    /* ── Bulk Operations ───────────────────────────────────────── */

    copyAllOutput: (channelId) => {
      const ch = get().channels[channelId]
      if (!ch) return ''
      const text = ch.lines.map((l) => l.text).join('\n')
      try { navigator.clipboard.writeText(text) } catch { /* noop */ }
      return text
    },

    getOutputAsText: (channelId) => {
      const ch = get().channels[channelId]
      if (!ch) return ''
      return ch.lines.map((l) => {
        const ts = formatTimestamp(l.timestamp)
        return `${ts} [${LOG_LEVEL_LABELS[l.level]}] ${l.text}`
      }).join('\n')
    },

    clearAll: () => {
      set((s) => {
        const channels = { ...s.channels }
        for (const id of Object.keys(channels)) {
          channels[id] = { ...channels[id], lines: [], unreadCount: 0 }
        }
        return { channels }
      })
    },

    /* ── Language Server Helper ─────────────────────────────────── */

    createLanguageServerChannel: (serverName) => {
      const config: OutputChannelConfig = {
        name: `${serverName} Language Server`,
        isLanguageServer: true,
      }
      const ch = createOutputChannel(config)
      set((s) => ({
        channels: { ...s.channels, [ch.id]: ch },
      }))
      return ch.id
    },

    /* ── Selectors ─────────────────────────────────────────────── */

    getChannel: (channelId) => get().channels[channelId],

    getFilteredLines: (channelId) => {
      const state = get()
      const ch = state.channels[channelId]
      if (!ch) return []
      const minSeverity = LOG_LEVEL_SEVERITY[state.filterLevel]
      let filtered = ch.lines.filter(
        (l) => LOG_LEVEL_SEVERITY[l.level] >= minSeverity,
      )
      if (state.searchQuery) {
        const lq = state.searchQuery.toLowerCase()
        filtered = filtered.filter((l) => l.text.toLowerCase().includes(lq))
      }
      return filtered
    },

    getChannelNames: () => {
      const state = get()
      return Object.values(state.channels)
        .filter((ch) => !ch.disposed)
        .sort((a, b) => {
          // Default channels first, then language servers, then custom
          if (a.isLanguageServer !== b.isLanguageServer) return a.isLanguageServer ? 1 : -1
          return a.createdAt - b.createdAt
        })
        .map((ch) => ({
          id: ch.id,
          name: ch.name,
          unread: ch.unreadCount,
          isLanguageServer: ch.isLanguageServer,
        }))
    },

    getSearchResults: (channelId, query) => {
      const ch = get().channels[channelId]
      if (!ch || !query) return []
      const lq = query.toLowerCase()
      return ch.lines
        .filter((l) => l.text.toLowerCase().includes(lq))
        .map((l) => l.id)
    },
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   OutputPanel Component
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Injected Styles ───────────────────────────────────────────────────── */

const PANEL_STYLES = `
.output-panel-scrollbar::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
.output-panel-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.output-panel-scrollbar::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb, rgba(121,121,121,0.4));
  border-radius: 5px;
}
.output-panel-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover, rgba(121,121,121,0.7));
}
.output-channel-selector:focus {
  outline: 1px solid var(--focus-border, #007fd4);
  outline-offset: -1px;
}
.output-search-input:focus {
  outline: 1px solid var(--focus-border, #007fd4);
  outline-offset: -1px;
}
.output-toolbar-btn:hover {
  background: var(--toolbar-hover-bg, rgba(90,93,110,0.31));
}
.output-toolbar-btn.active {
  color: var(--toolbar-active-fg, #007fd4);
}
.output-line-highlight {
  background: var(--editor-findMatch-bg, rgba(234,192,0,0.22));
}
`

/* ── AnsiSpan sub-component ────────────────────────────────────────────── */

function AnsiSpan({ segment }: { segment: AnsiSegment }) {
  const style: React.CSSProperties = {}
  if (segment.fg) style.color = segment.fg
  if (segment.bg) style.backgroundColor = segment.bg
  if (segment.bold) style.fontWeight = 'bold'
  if (segment.italic) style.fontStyle = 'italic'
  if (segment.dim) style.opacity = 0.6
  if (segment.underline) style.textDecoration = 'underline'
  if (segment.strikethrough) style.textDecoration = (style.textDecoration ? style.textDecoration + ' line-through' : 'line-through')

  return React.createElement('span', { style }, segment.text)
}

/* ── LineRenderer sub-component ────────────────────────────────────────── */

interface LineRendererProps {
  line: OutputLine
  showTimestamps: boolean
  wordWrap: boolean
  isSearchMatch: boolean
  searchQuery: string
}

const LineRenderer = React.memo(function LineRenderer({
  line,
  showTimestamps,
  wordWrap,
  isSearchMatch,
  searchQuery,
}: LineRendererProps) {
  const lineStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    padding: '0 12px',
    minHeight: VIRTUAL_LINE_HEIGHT,
    lineHeight: `${VIRTUAL_LINE_HEIGHT}px`,
    whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
    wordBreak: wordWrap ? 'break-all' : undefined,
    fontFamily: 'var(--editor-font, "Cascadia Code", "Fira Code", "Consolas", monospace)',
    fontSize: 'var(--editor-font-size, 12px)',
    background: isSearchMatch
      ? 'var(--editor-findMatch-bg, rgba(234,192,0,0.22))'
      : undefined,
    borderLeft: `3px solid transparent`,
  }

  const levelColor = LOG_LEVEL_COLORS[line.level]

  // Level indicator border
  if (line.level === 'error') {
    lineStyle.borderLeftColor = 'var(--output-error, #f14c4c)'
  } else if (line.level === 'warning') {
    lineStyle.borderLeftColor = 'var(--output-warning, #cca700)'
  }

  const timestampEl = showTimestamps
    ? React.createElement('span', {
        style: {
          color: 'var(--output-timestamp, #858585)',
          marginRight: 8,
          flexShrink: 0,
          userSelect: 'none' as const,
          fontSize: '11px',
        },
      }, formatTimestamp(line.timestamp))
    : null

  // Render ANSI segments or highlighted search text
  let contentEl: React.ReactNode
  if (line.ansiSegments.length > 1 || (line.ansiSegments.length === 1 && line.ansiSegments[0].fg)) {
    contentEl = React.createElement('span', { style: { color: levelColor } },
      line.ansiSegments.map((seg, i) =>
        React.createElement(AnsiSpan, { key: i, segment: seg })
      )
    )
  } else if (searchQuery && isSearchMatch) {
    // Highlight search matches in text
    const parts: React.ReactNode[] = []
    const lowerText = line.text.toLowerCase()
    const lowerQuery = searchQuery.toLowerCase()
    let idx = 0
    let matchIdx = lowerText.indexOf(lowerQuery, idx)
    let partKey = 0
    while (matchIdx !== -1) {
      if (matchIdx > idx) {
        parts.push(React.createElement('span', { key: partKey++ }, line.text.slice(idx, matchIdx)))
      }
      parts.push(React.createElement('span', {
        key: partKey++,
        style: {
          background: 'var(--editor-findMatch-highlight, #ea0)',
          color: '#000',
          borderRadius: 2,
          padding: '0 1px',
        },
      }, line.text.slice(matchIdx, matchIdx + searchQuery.length)))
      idx = matchIdx + searchQuery.length
      matchIdx = lowerText.indexOf(lowerQuery, idx)
    }
    if (idx < line.text.length) {
      parts.push(React.createElement('span', { key: partKey++ }, line.text.slice(idx)))
    }
    contentEl = React.createElement('span', { style: { color: levelColor } }, parts)
  } else {
    contentEl = React.createElement('span', { style: { color: levelColor } }, line.text)
  }

  return React.createElement('div', { style: lineStyle }, timestampEl, contentEl)
})

/* ── OutputPanel Component ─────────────────────────────────────────────── */

export function OutputPanel() {
  const {
    channels,
    activeChannelId,
    autoScroll,
    wordWrap,
    showTimestamps,
    filterLevel,
    searchQuery,
    searchMatches,
    setActiveChannel,
    toggleAutoScroll,
    toggleWordWrap,
    toggleTimestamps,
    setFilterLevel,
    setSearchQuery,
    clear,
    copyAllOutput,
    getOutputAsText,
    getFilteredLines,
    getChannelNames,
  } = useOutputChannelsStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stylesInjectedRef = useRef(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(400)
  const [showSearch, setShowSearch] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Inject styles once
  useEffect(() => {
    if (stylesInjectedRef.current) return
    stylesInjectedRef.current = true
    const style = document.createElement('style')
    style.textContent = PANEL_STYLES
    document.head.appendChild(style)
    return () => { document.head.removeChild(style) }
  }, [])

  // Observe container size
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Get filtered lines
  const filteredLines = useMemo(() => getFilteredLines(activeChannelId), [
    activeChannelId,
    channels,
    filterLevel,
    searchQuery,
  ])

  const searchMatchSet = useMemo(() => new Set(searchMatches), [searchMatches])

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filteredLines.length, autoScroll, activeChannelId])

  // Virtualization calculations
  const totalHeight = filteredLines.length * VIRTUAL_LINE_HEIGHT
  const startIdx = Math.max(0, Math.floor(scrollTop / VIRTUAL_LINE_HEIGHT) - VIRTUAL_OVERSCAN)
  const visibleCount = Math.ceil(containerHeight / VIRTUAL_LINE_HEIGHT) + VIRTUAL_OVERSCAN * 2
  const endIdx = Math.min(filteredLines.length, startIdx + visibleCount)
  const visibleLines = filteredLines.slice(startIdx, endIdx)
  const offsetY = startIdx * VIRTUAL_LINE_HEIGHT

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const channelNames = useMemo(() => getChannelNames(), [channels])

  // Keyboard shortcut for search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && containerRef.current?.contains(document.activeElement)) {
        e.preventDefault()
        setShowSearch(true)
        requestAnimationFrame(() => searchInputRef.current?.focus())
      }
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false)
        setSearchQuery('')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showSearch])

  const handleSaveOutput = useCallback(() => {
    const text = getOutputAsText(activeChannelId)
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const ch = channels[activeChannelId]
    a.download = `${ch?.name ?? 'output'}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(url)
  }, [activeChannelId, channels])

  // ─── Render ─────────────────────────────────────────────────────────

  const activeChannel = channels[activeChannelId]

  return React.createElement('div', {
    ref: containerRef,
    style: {
      display: 'flex',
      flexDirection: 'column' as const,
      height: '100%',
      background: 'var(--panel-bg, #1e1e1e)',
      color: 'var(--panel-fg, #cccccc)',
      fontFamily: 'var(--ui-font, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
      fontSize: 12,
      overflow: 'hidden',
    },
    tabIndex: 0,
  },
    // ─ Toolbar ──────────────────────────────────────────────
    React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderBottom: '1px solid var(--panel-border, #2d2d2d)',
        background: 'var(--toolbar-bg, #252526)',
        minHeight: 30,
        flexShrink: 0,
      },
    },
      // Channel selector dropdown
      React.createElement('select', {
        className: 'output-channel-selector',
        value: activeChannelId,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setActiveChannel(e.target.value),
        style: {
          background: 'var(--dropdown-bg, #3c3c3c)',
          color: 'var(--dropdown-fg, #cccccc)',
          border: '1px solid var(--dropdown-border, #3c3c3c)',
          borderRadius: 2,
          padding: '2px 20px 2px 6px',
          fontSize: 11,
          cursor: 'pointer',
          maxWidth: 200,
          appearance: 'none' as const,
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath fill='%23cccccc' d='M0 2l4 4 4-4z'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 6px center',
        },
      },
        channelNames.map((ch) =>
          React.createElement('option', {
            key: ch.id,
            value: ch.id,
          }, `${ch.name}${ch.unread > 0 ? ` (${ch.unread})` : ''}${ch.isLanguageServer ? ' [LS]' : ''}`)
        )
      ),

      // Separator
      React.createElement('div', {
        style: { width: 1, height: 16, background: 'var(--panel-border, #3c3c3c)', margin: '0 4px' },
      }),

      // Filter level dropdown
      React.createElement('select', {
        value: filterLevel,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setFilterLevel(e.target.value as LogLevel),
        title: 'Log level filter',
        style: {
          background: 'var(--dropdown-bg, #3c3c3c)',
          color: 'var(--dropdown-fg, #cccccc)',
          border: '1px solid var(--dropdown-border, #3c3c3c)',
          borderRadius: 2,
          padding: '2px 20px 2px 6px',
          fontSize: 11,
          cursor: 'pointer',
          appearance: 'none' as const,
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath fill='%23cccccc' d='M0 2l4 4 4-4z'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 6px center',
        },
      },
        (['trace', 'debug', 'info', 'warning', 'error'] as LogLevel[]).map((lvl) =>
          React.createElement('option', { key: lvl, value: lvl }, LOG_LEVEL_LABELS[lvl])
        )
      ),

      // Spacer
      React.createElement('div', { style: { flex: 1 } }),

      // Toolbar buttons
      ...([
        { label: '\u2315', title: 'Search (Ctrl+F)', onClick: () => { setShowSearch(!showSearch); if (!showSearch) requestAnimationFrame(() => searchInputRef.current?.focus()) } },
        { label: showTimestamps ? '\u23f0' : '\u23f1', title: 'Toggle timestamps', onClick: toggleTimestamps, active: showTimestamps },
        { label: '\u2938', title: `Word wrap: ${wordWrap ? 'on' : 'off'}`, onClick: toggleWordWrap, active: wordWrap },
        { label: autoScroll ? '\u21e3' : '\u21e1', title: `Auto-scroll: ${autoScroll ? 'on' : 'off'}`, onClick: toggleAutoScroll, active: autoScroll },
        { label: '\u2398', title: 'Copy all output', onClick: () => copyAllOutput(activeChannelId) },
        { label: '\u2913', title: 'Save output to file', onClick: handleSaveOutput },
        { label: '\u2715', title: 'Clear output', onClick: () => clear(activeChannelId) },
      ] as const).map((btn, i) =>
        React.createElement('button', {
          key: i,
          className: `output-toolbar-btn${('active' in btn && btn.active) ? ' active' : ''}`,
          title: btn.title,
          onClick: btn.onClick,
          style: {
            background: 'transparent',
            border: 'none',
            color: ('active' in btn && btn.active) ? 'var(--toolbar-active-fg, #007fd4)' : 'var(--panel-fg, #cccccc)',
            cursor: 'pointer',
            padding: '2px 6px',
            borderRadius: 3,
            fontSize: 14,
            lineHeight: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 24,
            minHeight: 24,
          },
        }, btn.label)
      ),
    ),

    // ─ Search bar (collapsible) ─────────────────────────────
    showSearch
      ? React.createElement('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 8px',
            borderBottom: '1px solid var(--panel-border, #2d2d2d)',
            background: 'var(--toolbar-bg, #252526)',
            flexShrink: 0,
          },
        },
          React.createElement('input', {
            ref: searchInputRef,
            className: 'output-search-input',
            type: 'text',
            placeholder: 'Search output...',
            value: searchQuery,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Escape') {
                setShowSearch(false)
                setSearchQuery('')
              }
            },
            style: {
              flex: 1,
              background: 'var(--input-bg, #3c3c3c)',
              color: 'var(--input-fg, #cccccc)',
              border: '1px solid var(--input-border, #3c3c3c)',
              borderRadius: 2,
              padding: '3px 8px',
              fontSize: 12,
              outline: 'none',
              fontFamily: 'inherit',
            },
          }),
          React.createElement('span', {
            style: { fontSize: 11, color: 'var(--output-timestamp, #858585)', whiteSpace: 'nowrap' as const },
          }, searchQuery
            ? `${searchMatches.length} match${searchMatches.length !== 1 ? 'es' : ''}`
            : ''
          ),
          React.createElement('button', {
            onClick: () => { setShowSearch(false); setSearchQuery('') },
            style: {
              background: 'transparent',
              border: 'none',
              color: 'var(--panel-fg, #cccccc)',
              cursor: 'pointer',
              fontSize: 12,
              padding: '2px 4px',
            },
          }, '\u2715'),
        )
      : null,

    // ─ Channel info / empty state ───────────────────────────
    !activeChannel || filteredLines.length === 0
      ? React.createElement('div', {
          style: {
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--output-timestamp, #858585)',
            fontSize: 13,
            fontStyle: 'italic',
          },
        }, activeChannel
          ? (searchQuery ? 'No matching output lines.' : 'No output yet.')
          : 'No channel selected.'
        )
      : // ─ Virtualized output area ──────────────────────────────
        React.createElement('div', {
          ref: scrollRef,
          className: 'output-panel-scrollbar',
          onScroll: handleScroll,
          style: {
            flex: 1,
            overflow: 'auto',
            position: 'relative' as const,
          },
        },
          React.createElement('div', {
            style: {
              height: totalHeight,
              position: 'relative' as const,
              willChange: 'transform',
            },
          },
            React.createElement('div', {
              style: {
                position: 'absolute' as const,
                top: offsetY,
                left: 0,
                right: 0,
              },
            },
              visibleLines.map((line) =>
                React.createElement(LineRenderer, {
                  key: line.id,
                  line,
                  showTimestamps,
                  wordWrap,
                  isSearchMatch: searchMatchSet.has(line.id),
                  searchQuery,
                })
              )
            )
          )
        ),

    // ─ Status bar ───────────────────────────────────────────
    React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1px 8px',
        borderTop: '1px solid var(--panel-border, #2d2d2d)',
        background: 'var(--toolbar-bg, #252526)',
        fontSize: 11,
        color: 'var(--output-timestamp, #858585)',
        minHeight: 20,
        flexShrink: 0,
        gap: 12,
      },
    },
      React.createElement('span', null,
        activeChannel
          ? `${activeChannel.name} \u2014 ${filteredLines.length.toLocaleString()} line${filteredLines.length !== 1 ? 's' : ''}`
          : 'No channel',
        filteredLines.length !== (activeChannel?.lines.length ?? 0)
          ? ` (${(activeChannel?.lines.length ?? 0).toLocaleString()} total)`
          : ''
      ),
      React.createElement('span', {
        style: { display: 'flex', gap: 8 },
      },
        autoScroll
          ? React.createElement('span', { title: 'Auto-scroll enabled' }, '\u21e3 Follow')
          : React.createElement('span', {
              title: 'Auto-scroll disabled',
              style: { color: 'var(--output-warning, #cca700)' },
            }, '\u21e1 Scroll Lock'),
        wordWrap
          ? React.createElement('span', null, 'Wrap')
          : React.createElement('span', null, 'No Wrap'),
        React.createElement('span', null, `Filter: ${LOG_LEVEL_LABELS[filterLevel]}+`),
      ),
    ),
  )
}

/* ── Convenience aliases / re-exports ──────────────────────────────────── */

/** Quick access to append a line to a default channel */
export function logToChannel(
  channel: DefaultChannelName | string,
  message: string,
  level: LogLevel = 'info',
) {
  const store = useOutputChannelsStore.getState()
  const channelId = channel.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  // Auto-create the channel if it doesn't exist
  if (!store.channels[channelId]) {
    store.createChannel({ name: channel })
  }
  store.appendLine(channelId, message, level)
}

/** Create and return a channel API object (VS Code-style) */
export function createOutputChannelAPI(name: string, options?: { log?: boolean }) {
  const store = useOutputChannelsStore.getState()
  const channelId = options?.log
    ? store.createLanguageServerChannel(name)
    : store.createChannel({ name })

  return {
    name,
    channelId,
    append: (value: string) => useOutputChannelsStore.getState().append(channelId, value),
    appendLine: (value: string) => useOutputChannelsStore.getState().appendLine(channelId, value),
    clear: () => useOutputChannelsStore.getState().clear(channelId),
    show: () => useOutputChannelsStore.getState().showChannel(channelId),
    hide: () => useOutputChannelsStore.getState().hideChannel(channelId),
    dispose: () => useOutputChannelsStore.getState().disposeChannel(channelId),
    replace: (value: string) => {
      useOutputChannelsStore.getState().clear(channelId)
      useOutputChannelsStore.getState().appendLine(channelId, value)
    },
    trace: (msg: string) => useOutputChannelsStore.getState().appendLine(channelId, msg, 'trace'),
    debug: (msg: string) => useOutputChannelsStore.getState().appendLine(channelId, msg, 'debug'),
    info: (msg: string) => useOutputChannelsStore.getState().appendLine(channelId, msg, 'info'),
    warn: (msg: string) => useOutputChannelsStore.getState().appendLine(channelId, msg, 'warning'),
    error: (msg: string) => useOutputChannelsStore.getState().appendLine(channelId, msg, 'error'),
  }
}

export default OutputPanel
