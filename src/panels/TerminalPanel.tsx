import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useFileStore } from '@/store/files'
import { openFileInEditor } from '@/utils/openFileInEditor'
import '@xterm/xterm/css/xterm.css'
import {
  X, ChevronDown, Plus, Columns2, Trash2, Ban,
  Search, ArrowUp, ArrowDown,
  Terminal as TerminalIcon,
} from 'lucide-react'

/* ── Inject TerminalPanel-specific styles once ─────────── */
const tpStyleId = 'terminal-panel-v2-styles'
if (typeof document !== 'undefined' && !document.getElementById(tpStyleId)) {
  const style = document.createElement('style')
  style.id = tpStyleId
  style.textContent = `
    @keyframes tp-tab-slide-in {
      from { opacity: 0; transform: translateX(-4px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes tp-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes tp-find-slide {
      from { opacity: 0; transform: translateY(-8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes tp-split-grow {
      from { opacity: 0; flex-basis: 0; }
      to   { opacity: 1; }
    }
    .tp-tab {
      transition: background 0.12s, color 0.12s, box-shadow 0.12s;
    }
    .tp-tab:hover {
      background: var(--bg-tertiary) !important;
    }
    .tp-tab[data-active="true"] {
      background: var(--bg-secondary) !important;
      color: var(--text-primary) !important;
    }
    .tp-tab .tp-tab-close {
      opacity: 0;
      transition: opacity 0.1s, background 0.1s;
    }
    .tp-tab:hover .tp-tab-close {
      opacity: 0.6;
    }
    .tp-tab .tp-tab-close:hover {
      opacity: 1 !important;
      background: rgba(248,81,73,0.15);
    }
    .tp-toolbar-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      background: transparent;
      transition: background 0.12s, color 0.12s, transform 0.1s;
    }
    .tp-toolbar-btn:hover {
      background: rgba(255,255,255,0.08);
      color: var(--text-primary);
    }
    .tp-toolbar-btn:active {
      transform: scale(0.92);
    }
    .tp-toolbar-btn[data-active="true"] {
      color: var(--accent-blue);
      background: rgba(88,166,255,0.1);
    }
    .tp-rename-input {
      background: var(--bg-primary);
      border: 1px solid var(--accent-blue);
      border-radius: 2px;
      outline: none;
      color: var(--text-primary);
      font-size: 11px;
      padding: 0 4px;
      height: 18px;
      width: 90px;
      font-family: inherit;
    }
    .tp-shell-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      min-width: 200px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 4px 0;
      z-index: 1000;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      animation: tp-fade-in 0.12s ease;
    }
    .tp-shell-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 10px;
      font-size: 11px;
      color: var(--text-muted);
      background: transparent;
      border: none;
      cursor: pointer;
      text-align: left;
      transition: background 0.12s, color 0.12s;
    }
    .tp-shell-item:hover {
      background: rgba(255,255,255,0.06);
      color: var(--text-primary);
    }
    .tp-find-bar {
      animation: tp-find-slide 0.15s ease;
    }
    .tp-find-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 3px;
      color: var(--text-primary);
      font-size: 12px;
      padding: 3px 8px;
      height: 26px;
      outline: none;
      font-family: inherit;
      transition: border-color 0.15s;
    }
    .tp-find-input:focus {
      border-color: var(--accent-blue);
    }
    .tp-find-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 3px;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      background: transparent;
      transition: background 0.1s, color 0.1s;
    }
    .tp-find-btn:hover {
      background: rgba(255,255,255,0.08);
      color: var(--text-primary);
    }
    .tp-split-divider {
      width: 4px;
      cursor: col-resize;
      background: transparent;
      transition: background 0.15s;
      position: relative;
      flex-shrink: 0;
      z-index: 5;
    }
    .tp-split-divider::after {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 1px;
      width: 2px;
      background: var(--border-color);
      transition: background 0.15s;
    }
    .tp-split-divider:hover::after,
    .tp-split-divider.dragging::after {
      background: var(--accent-blue);
    }
    .tp-split-header {
      transition: background 0.15s, border-color 0.15s;
      cursor: pointer;
      user-select: none;
    }
    .tp-split-header:hover {
      background: rgba(255,255,255,0.03) !important;
    }
    .tp-kill-btn {
      color: var(--accent-red, #f85149) !important;
      opacity: 0.85;
    }
    .tp-kill-btn:hover {
      background: rgba(248,81,73,0.15) !important;
      color: var(--accent-red, #f85149) !important;
      opacity: 1;
    }
    .tp-xterm-container {
      padding: 6px 4px 4px 6px;
      border-radius: 0 0 6px 6px;
      overflow: hidden;
    }
    .tp-xterm-container .xterm {
      border-radius: 4px;
    }
    .tp-xterm-container .xterm-viewport {
      border-radius: 4px;
    }
  `
  document.head.appendChild(style)
}

/* ── Catppuccin-inspired dark theme matching the app ──── */
const terminalTheme = {
  background: '#0d1117',
  foreground: '#d4d4d4',
  cursor: '#58a6ff',
  cursorAccent: '#1e1e2e',
  selectionBackground: 'rgba(88, 166, 255, 0.3)',
  black: '#1e1e2e',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  cyan: '#94e2d5',
  white: '#cdd6f4',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#cba6f7',
  brightCyan: '#94e2d5',
  brightWhite: '#ffffff',
}

/* ── File path regex patterns for link detection ──────── */
const FILE_PATH_RE = /(?:(?:[a-zA-Z]:\\|\/)[^\s:*?"<>|]+|(?:\.\.?\/|\b(?:src|lib|app|components|pages|utils|hooks|store|config|test|spec|electron|shared)\/)[^\s:*?"<>|]+)(?::(\d+)(?::(\d+))?)?/g

/* ── OS detection ─────────────────────────────────────── */
const isWindows = navigator.userAgent.includes('Windows') || navigator.platform?.startsWith('Win')

/* ── Shell profile definitions ────────────────────────── */
interface ShellProfile {
  id: string
  name: string
  shellPath: string
  args: string[]
  icon: string
}

const windowsShellProfiles: ShellProfile[] = [
  { id: 'powershell', name: 'PowerShell', shellPath: 'powershell.exe', args: [], icon: 'PS' },
  { id: 'cmd', name: 'Command Prompt', shellPath: 'cmd.exe', args: [], icon: '>' },
  { id: 'gitbash', name: 'Git Bash', shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login', '-i'], icon: '$' },
  { id: 'wsl', name: 'WSL', shellPath: 'wsl.exe', args: [], icon: '#' },
]

const unixShellProfiles: ShellProfile[] = [
  { id: 'bash', name: 'bash', shellPath: '/bin/bash', args: ['--login'], icon: '$' },
  { id: 'zsh', name: 'zsh', shellPath: '/bin/zsh', args: ['--login'], icon: '%' },
]

const shellProfiles = isWindows ? windowsShellProfiles : unixShellProfiles

/* ── Detect shell type icon from path ─────────────────── */
function getShellIcon(shellPath?: string): string {
  if (!shellPath) return isWindows ? 'PS' : '$'
  const lower = shellPath.toLowerCase()
  if (lower.includes('powershell') || lower.includes('pwsh')) return 'PS'
  if (lower.includes('cmd')) return '>'
  if (lower.includes('bash')) return '$'
  if (lower.includes('zsh')) return '%'
  if (lower.includes('wsl')) return '#'
  if (lower.includes('fish')) return '><'
  return '$'
}

/* ── Settings > Terminal ──────────────────────────────── */
const TERMINAL_SETTINGS_KEY = 'orion-terminal-settings'

interface TerminalSettings {
  defaultShell: string
  fontFamily: string
  fontSize: number
  cursorStyle: 'block' | 'bar' | 'underline'
  scrollback: number
}

// What Settings > Terminal shows before anything has been saved.
const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  defaultShell: 'default',
  fontFamily: 'Cascadia Code',
  fontSize: 13,
  cursorStyle: 'block',
  scrollback: 1000,
}

/** Settings from localStorage or an orion:terminal-config event; bad fields fall back to defaults. */
function parseTerminalSettings(raw: unknown): TerminalSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof TerminalSettings, unknown>>
  const d = DEFAULT_TERMINAL_SETTINGS
  const isInt = (v: unknown, min: number, max: number): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
  return {
    defaultShell: typeof s.defaultShell === 'string' ? s.defaultShell : d.defaultShell,
    fontFamily: typeof s.fontFamily === 'string' && s.fontFamily.trim() ? s.fontFamily : d.fontFamily,
    fontSize: isInt(s.fontSize, 6, 72) ? s.fontSize : d.fontSize,
    cursorStyle: s.cursorStyle === 'bar' || s.cursorStyle === 'underline' || s.cursorStyle === 'block'
      ? s.cursorStyle
      : d.cursorStyle,
    scrollback: isInt(s.scrollback, 0, 100000) ? s.scrollback : d.scrollback,
  }
}

function loadTerminalSettings(): TerminalSettings {
  try {
    return parseTerminalSettings(JSON.parse(localStorage.getItem(TERMINAL_SETTINGS_KEY) ?? 'null'))
  } catch {
    return DEFAULT_TERMINAL_SETTINGS
  }
}

function xtermAppearance(settings: TerminalSettings) {
  return {
    fontFamily: `"${settings.fontFamily.replace(/["\\]/g, '')}", monospace`,
    fontSize: settings.fontSize,
    cursorStyle: settings.cursorStyle,
    scrollback: settings.scrollback,
  }
}

/** The "Default Shell" setting as a launch profile; undefined means the system shell. */
function defaultShellProfile(defaultShell: string): ShellProfile | undefined {
  // Settings lists Git Bash as 'bash'; on Unix that is plain bash.
  const id = isWindows && defaultShell === 'bash' ? 'gitbash' : defaultShell
  return shellProfiles.find(p => p.id === id)
}

/* ── File links in terminal output ────────────────────── */

/** Relative paths in tool output (src/x.ts, ./x.ts) are relative to the workspace. */
function resolveTerminalPath(filePath: string): string {
  if (/^(?:[a-zA-Z]:\\|\/)/.test(filePath)) return filePath
  const root = useFileStore.getState().rootPath
  if (!root) return filePath
  const sep = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${filePath.replace(/^\.[\\/]/, '')}`
}

async function openTerminalLink(filePath: string, line?: number, column?: number) {
  const opened = await openFileInEditor(resolveTerminalPath(filePath))
  if (opened && line) {
    // Same hand-off as the Problems panel: the editor switches models first.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('orion:go-to-line', { detail: { line, column: column ?? 1 } }))
    }, 50)
  }
}

/* ── Terminal Find Bar component ──────────────────────── */

interface FindBarProps {
  visible: boolean
  onClose: () => void
  searchAddonRef: React.RefObject<SearchAddon | null>
}

function TerminalFindBar({ visible, onClose, searchAddonRef }: FindBarProps) {
  const [query, setQuery] = useState('')
  const [matchCount, setMatchCount] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setQuery('')
      setMatchCount('')
    }
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [visible, onClose])

  const doSearch = useCallback((term: string, direction: 'next' | 'prev' = 'next') => {
    if (!searchAddonRef.current || !term) {
      setMatchCount('')
      return
    }
    const found = direction === 'next'
      ? searchAddonRef.current.findNext(term, { regex: false, wholeWord: false, caseSensitive: false, incremental: true })
      : searchAddonRef.current.findPrevious(term, { regex: false, wholeWord: false, caseSensitive: false, incremental: true })
    setMatchCount(found ? 'Found' : 'No results')
  }, [searchAddonRef])

  const handleQueryChange = useCallback((val: string) => {
    setQuery(val)
    doSearch(val, 'next')
  }, [doSearch])

  const findNext = useCallback(() => doSearch(query, 'next'), [doSearch, query])
  const findPrev = useCallback(() => doSearch(query, 'prev'), [doSearch, query])

  if (!visible) return null

  return (
    <div
      className="tp-find-bar"
      style={{
        position: 'absolute',
        top: 4,
        right: 12,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 6px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      }}
    >
      <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      <input
        ref={inputRef}
        className="tp-find-input"
        value={query}
        onChange={e => handleQueryChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) findPrev()
            else findNext()
          }
        }}
        placeholder="Find in terminal..."
        style={{ width: 180 }}
      />
      {matchCount && (
        <span style={{
          fontSize: 10,
          color: matchCount === 'No results' ? 'var(--text-muted)' : 'var(--accent-blue)',
          whiteSpace: 'nowrap',
          padding: '0 4px',
        }}>
          {matchCount}
        </span>
      )}
      <button className="tp-find-btn" onClick={findPrev} title="Previous match (Shift+Enter)">
        <ArrowUp size={12} />
      </button>
      <button className="tp-find-btn" onClick={findNext} title="Next match (Enter)">
        <ArrowDown size={12} />
      </button>
      <button className="tp-find-btn" onClick={onClose} title="Close (Esc)">
        <X size={12} />
      </button>
    </div>
  )
}

/* ── Single xterm instance (inner component) ──────────── */

interface SingleTerminalProps {
  sessionId: string
  shellPath?: string
  shellArgs?: string[]
  /** Typed into the shell once it has started (used to run tasks). */
  initialCommand?: string
  onTitleChange?: (sessionId: string, title: string) => void
  isActive?: boolean
}

function SingleTerminal({ sessionId, shellPath, shellArgs, initialCommand, onTitleChange, isActive }: SingleTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const refitRef = useRef<(() => void) | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const [showFind, setShowFind] = useState(false)

  // The pty lives exactly as long as this component is mounted. Parents keep
  // hidden terminals mounted (display:none), so the cleanup below runs when
  // the user closes the terminal, not when another tab or panel is shown.
  // (No run-once guard: under StrictMode's re-run the pty is simply recreated.)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    const settings = loadTerminalSettings()

    const term = new Terminal({
      theme: terminalTheme,
      ...xtermAppearance(settings),
      cursorBlink: true,
      cursorWidth: 2,
      smoothScrollDuration: 100,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)

    const search = new SearchAddon()
    term.loadAddon(search)
    searchRef.current = search

    /* ── URL link detection ── */
    term.loadAddon(new WebLinksAddon((_event, uri) => {
      window.open(uri, '_blank')
    }))

    /* ── File path link detection ── */
    term.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const line = term.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) { callback(undefined); return }

        const text = line.translateToString(true)
        const links: Array<{
          range: { start: { x: number; y: number }; end: { x: number; y: number } }
          text: string
          activate: (_event: MouseEvent, linkText: string) => void
          hover?: (_event: MouseEvent, linkText: string) => void
        }> = []

        FILE_PATH_RE.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = FILE_PATH_RE.exec(text)) !== null) {
          const fullMatch = match[0]
          const startX = match.index + 1
          const endX = startX + fullMatch.length - 1
          const pathOnly = fullMatch.replace(/:\d+(?::\d+)?$/, '')
          const lineNum = match[1] ? parseInt(match[1], 10) : undefined
          const colNum = match[2] ? parseInt(match[2], 10) : undefined

          links.push({
            range: {
              start: { x: startX, y: bufferLineNumber },
              end: { x: endX, y: bufferLineNumber },
            },
            text: fullMatch,
            activate: () => { void openTerminalLink(pathOnly, lineNum, colNum) },
          })
        }

        callback(links.length > 0 ? links : undefined)
      },
    })

    // Hidden terminals stay mounted under display:none. There FitAddon reads
    // the container's "100%" as 100px and would shrink the shell to about
    // 10x6 (reflowing away scrollback), so only fit while it has a layout box.
    const refit = () => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return
      try { fit.fit() } catch {}
    }

    term.open(container)
    refit()
    refitRef.current = refit

    /* ── Title tracking ── */
    term.onTitleChange((title) => {
      onTitleChange?.(sessionId, title)
    })

    /* ── Keyboard shortcuts ── */
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      // Ctrl+F: Open terminal find bar
      if (event.ctrlKey && !event.shiftKey && event.key === 'f' && event.type === 'keydown') {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('terminal:toggle-find', {
          detail: { sessionId },
        }))
        return false
      }

      // Ctrl+Shift+C: Copy from terminal
      if (event.ctrlKey && event.shiftKey && event.key === 'C' && event.type === 'keydown') {
        const sel = term.getSelection()
        if (sel) {
          navigator.clipboard.writeText(sel)
        }
        return false
      }

      // Ctrl+Shift+V: Paste to terminal
      if (event.ctrlKey && event.shiftKey && event.key === 'V' && event.type === 'keydown') {
        navigator.clipboard.readText().then((text) => {
          term.paste(text)
        })
        return false
      }

      // Ctrl+Shift+`: New terminal (handled by the bottom panel). With Shift
      // held, e.key is '~', so match the physical key.
      if (event.ctrlKey && event.shiftKey && event.code === 'Backquote') {
        return false
      }

      // Ctrl+L: Clear terminal
      if (event.ctrlKey && !event.shiftKey && event.key === 'l' && event.type === 'keydown') {
        term.clear()
        return true
      }

      return true
    })

    /* ── Create backend PTY at the size xterm was fitted to ── */
    const profile = shellPath ? undefined : defaultShellProfile(settings.defaultShell)
    const shellOptions = shellPath
      ? { shellPath, shellArgs: shellArgs || [] }
      : profile ? { shellPath: profile.shellPath, shellArgs: profile.args } : undefined
    const startSize = { cols: term.cols, rows: term.rows }

    window.api.termCreate(sessionId, shellOptions, startSize).then((result) => {
      if (disposed) return
      if (!result.success) {
        term.writeln('\x1b[31mTerminal failed to start: ' + (result.error || 'Unknown error') + '\x1b[0m')
        term.writeln('\x1b[33mThis is a known issue with node-pty on some Windows configurations.\x1b[0m')
        return
      }
      term.onData((data) => window.api.termWrite(sessionId, data))
      term.onResize(({ cols, rows }) => window.api.termResize(sessionId, cols, rows))
      // The view may have been refitted while the shell was starting.
      if (term.cols !== startSize.cols || term.rows !== startSize.rows) {
        window.api.termResize(sessionId, term.cols, term.rows)
      }
      if (initialCommand) window.api.termWrite(sessionId, initialCommand + '\r')
    }).catch((err: unknown) => {
      if (disposed) return
      term.writeln('\x1b[31mTerminal error: ' + (err instanceof Error ? err.message : String(err)) + '\x1b[0m')
    })

    const offData = window.api.onTermData((id: string, data: string) => {
      if (id === sessionId) term.write(data)
    })

    const offExit = window.api.onTermExit((id: string, exitCode: number) => {
      if (id === sessionId) term.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`)
    })

    const resizeObserver = new ResizeObserver(refit)
    resizeObserver.observe(container)

    /* ── Listen for clear terminal events ── */
    const handleClear = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.sessionId === sessionId) {
        term.clear()
        term.write('\x1b[2J\x1b[H')
      }
    }
    window.addEventListener('terminal:clear', handleClear)

    /* ── Settings > Terminal changes apply to open terminals ── */
    const handleConfig = (e: Event) => {
      Object.assign(term.options, xtermAppearance(parseTerminalSettings((e as CustomEvent).detail)))
      refit()
    }
    window.addEventListener('orion:terminal-config', handleConfig)

    return () => {
      disposed = true
      offData()
      offExit()
      resizeObserver.disconnect()
      window.removeEventListener('terminal:clear', handleClear)
      window.removeEventListener('orion:terminal-config', handleConfig)
      term.dispose()
      window.api.termKill(sessionId)
    }
  }, [])

  /* ── Refit on visibility change ── */
  useEffect(() => {
    if (isActive) refitRef.current?.()
  }, [isActive])

  /* ── Listen for Ctrl+F toggle event ── */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.sessionId === sessionId) {
        setShowFind(prev => !prev)
      }
    }
    window.addEventListener('terminal:toggle-find', handler)
    return () => window.removeEventListener('terminal:toggle-find', handler)
  }, [sessionId])

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <div ref={containerRef} className="tp-xterm-container" style={{ height: '100%', width: '100%' }} />
      <TerminalFindBar
        visible={showFind}
        onClose={() => setShowFind(false)}
        searchAddonRef={searchRef}
      />
    </div>
  )
}

/* ── Terminal Tab interface ────────────────────────────── */

interface TerminalTab {
  id: string
  name: string
  shellPath?: string
  shellArgs?: string[]
  shellIcon: string
  /** If set, this tab is a split child of the parent tab */
  splitParentId?: string
  /** Named by the user; shell title escapes no longer rename it. */
  renamed?: boolean
}

let tabCounter = 0
function nextTabId(): string {
  tabCounter += 1
  return `term-tab-${Date.now()}-${tabCounter}`
}

/* ── Split Divider (drag-resizable) ───────────────────── */

interface SplitDividerProps {
  onResize: (deltaX: number) => void
}

function SplitDivider({ onResize }: SplitDividerProps) {
  const [dragging, setDragging] = useState(false)
  const startXRef = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    startXRef.current = e.clientX

    const handleMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startXRef.current
      startXRef.current = ev.clientX
      onResize(delta)
    }

    const handleUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [onResize])

  return (
    <div
      className={`tp-split-divider ${dragging ? 'dragging' : ''}`}
      onMouseDown={handleMouseDown}
    />
  )
}

/* ── Main TerminalPanel component (exported) ──────────── */

interface Props {
  sessionId: string
  shellPath?: string
  shellArgs?: string[]
  /** Typed into the first terminal once its shell has started. */
  initialCommand?: string
  onTitleChange?: (sessionId: string, title: string) => void
}

export default function TerminalPanel({ sessionId, shellPath, shellArgs, initialCommand, onTitleChange }: Props) {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [{
    id: sessionId,
    name: 'Terminal 1',
    shellPath,
    shellArgs,
    shellIcon: getShellIcon(shellPath),
  }])
  const [activeTabId, setActiveTabId] = useState(sessionId)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showShellDropdown, setShowShellDropdown] = useState(false)
  const [splitSizes, setSplitSizes] = useState<Record<string, number>>({})
  const renameInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  /* ── Derived: build split groups ────────────────────── */
  const { groups, activeGroupParentId } = useMemo(() => {
    const grps: TerminalTab[][] = []
    const used = new Set<string>()
    for (const t of tabs) {
      if (used.has(t.id) || t.splitParentId) continue
      const group = [t]
      used.add(t.id)
      for (const s of tabs) {
        if (s.splitParentId === t.id && !used.has(s.id)) {
          group.push(s)
          used.add(s.id)
        }
      }
      grps.push(group)
    }
    const ag = grps.find(g => g.some(t => t.id === activeTabId))
    const agpId = ag?.[0]?.splitParentId || ag?.[0]?.id
    return { groups: grps, activeGroupParentId: agpId }
  }, [tabs, activeTabId])

  /* ── Create new terminal tab ────────────────────────── */
  const addTab = useCallback((profile?: ShellProfile) => {
    const num = tabs.length + 1
    const name = profile ? `${profile.name} ${num}` : `Terminal ${num}`
    const tab: TerminalTab = {
      id: nextTabId(),
      name,
      shellPath: profile?.shellPath,
      shellArgs: profile?.args,
      shellIcon: profile ? profile.icon : getShellIcon(undefined),
    }
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    setShowShellDropdown(false)
  }, [tabs.length])

  /* ── Close tab (unmounting its SingleTerminal kills the pty) ── */
  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const closing = prev.find(t => t.id === id)
      let next: TerminalTab[]
      if (closing?.splitParentId) {
        // Closing a split child - just remove it
        next = prev.filter(t => t.id !== id)
      } else {
        // Closing a parent - also remove its splits
        next = prev.filter(t => t.id !== id && t.splitParentId !== id)
      }
      if (next.length === 0) {
        // Always keep at least one terminal
        const fallback: TerminalTab = {
          id: nextTabId(),
          name: 'Terminal 1',
          shellIcon: getShellIcon(undefined),
        }
        setActiveTabId(fallback.id)
        return [fallback]
      }
      if (activeTabId === id) {
        setActiveTabId(next[0].id)
      }
      return next
    })
  }, [activeTabId])

  /* ── Split terminal ─────────────────────────────────── */
  const splitTerminal = useCallback(() => {
    const current = tabs.find(t => t.id === activeTabId)
    if (!current) return
    const parentId = current.splitParentId || current.id
    const num = tabs.length + 1
    const tab: TerminalTab = {
      id: nextTabId(),
      name: `Terminal ${num}`,
      shellIcon: getShellIcon(current.shellPath),
      shellPath: current.shellPath,
      shellArgs: current.shellArgs,
      splitParentId: parentId,
    }
    setTabs(prev => {
      const parentIdx = prev.findIndex(x => x.id === parentId)
      let lastIdx = parentIdx
      for (let i = parentIdx + 1; i < prev.length; i++) {
        if (prev[i].splitParentId === parentId) lastIdx = i
        else break
      }
      const copy = [...prev]
      copy.splice(lastIdx + 1, 0, tab)
      return copy
    })
    setActiveTabId(tab.id)
  }, [tabs, activeTabId])

  /* ── Clear active terminal ──────────────────────────── */
  const clearTerminal = useCallback(() => {
    window.dispatchEvent(new CustomEvent('terminal:clear', { detail: { sessionId: activeTabId } }))
  }, [activeTabId])

  /* ── Kill active terminal (same as close) ───────────── */
  const killTerminal = useCallback(() => {
    closeTab(activeTabId)
  }, [activeTabId, closeTab])

  /* ── Rename ─────────────────────────────────────────── */
  const startRename = useCallback((id: string, currentName: string) => {
    setRenamingId(id)
    setRenameValue(currentName)
  }, [])

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      setTabs(prev =>
        prev.map(t => t.id === renamingId ? { ...t, name: renameValue.trim(), renamed: true } : t)
      )
    }
    setRenamingId(null)
    setRenameValue('')
  }, [renamingId, renameValue])

  const cancelRename = useCallback(() => {
    setRenamingId(null)
    setRenameValue('')
  }, [])

  // Focus rename input
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  /* ── Close dropdown on outside click ────────────────── */
  useEffect(() => {
    if (!showShellDropdown) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowShellDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showShellDropdown])

  /* ── Handle title changes from child terminals ──────── */
  const handleChildTitleChange = useCallback((sid: string, title: string) => {
    setTabs(prev =>
      prev.map(t => t.id === sid && !t.renamed ? { ...t, name: title || t.name } : t)
    )
    // Propagate to parent if it's the original session
    if (sid === sessionId) {
      onTitleChange?.(sessionId, title)
    }
  }, [sessionId, onTitleChange])

  /* ── Handle split divider drag resize ───────────────── */
  const handleSplitResize = useCallback((groupId: string, index: number, deltaX: number) => {
    setSplitSizes(prev => {
      const key = `${groupId}-${index}`
      const current = prev[key] || 0
      return { ...prev, [key]: current + deltaX }
    })
  }, [])

  /* ── Only render parent (non-split) tabs in tab bar ─── */
  const parentTabs = useMemo(() =>
    tabs.filter(t => !t.splitParentId),
  [tabs])

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
      }}
    >
      {/* ── Terminal Tab Bar + Toolbar ─────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 32,
          flexShrink: 0,
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border-color)',
          padding: '0 2px',
          gap: 0,
        }}
      >
        {/* ── Tab list (scrollable) ───────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flex: 1,
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollbarWidth: 'none',
            paddingLeft: 2,
          }}
        >
          {parentTabs.map(tab => {
            const isActive = activeTabId === tab.id ||
              tabs.some(s => s.splitParentId === tab.id && s.id === activeTabId)
            const splitChildren = tabs.filter(s => s.splitParentId === tab.id)
            const hasSplits = splitChildren.length > 0

            return (
              <div
                key={tab.id}
                className="tp-tab"
                data-active={isActive}
                onClick={() => setActiveTabId(tab.id)}
                onDoubleClick={() => startRename(tab.id, tab.name)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  height: 26,
                  padding: '0 4px 0 8px',
                  fontSize: 11,
                  borderRadius: 4,
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  background: isActive ? 'var(--bg-secondary)' : 'transparent',
                  cursor: 'pointer',
                  maxWidth: 180,
                  animation: 'tp-tab-slide-in 0.15s ease',
                  position: 'relative',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                }}
                title={tab.name + (tab.shellPath ? `\nShell: ${tab.shellPath}` : '') + (hasSplits ? `\n+${splitChildren.length} split` : '')}
              >
                {/* Shell type indicator */}
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 16,
                    height: 16,
                    borderRadius: 3,
                    background: isActive ? 'rgba(88,166,255,0.12)' : 'rgba(255,255,255,0.04)',
                    fontSize: 8,
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono, monospace)',
                    color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
                    flexShrink: 0,
                    transition: 'background 0.12s, color 0.12s',
                  }}
                >
                  {tab.shellIcon}
                </span>

                {/* Tab name (editable on double-click) */}
                {renamingId === tab.id ? (
                  <input
                    ref={renameInputRef}
                    className="tp-rename-input"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') cancelRename()
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: 110,
                  }}>
                    {tab.name}
                  </span>
                )}

                {/* Split indicator */}
                {hasSplits && (
                  <Columns2 size={9} style={{ flexShrink: 0, opacity: 0.4 }} />
                )}

                {/* Close button */}
                <span
                  className="tp-tab-close"
                  onClick={e => { e.stopPropagation(); closeTab(tab.id) }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 16,
                    height: 16,
                    borderRadius: 3,
                    flexShrink: 0,
                    cursor: 'pointer',
                    marginLeft: 2,
                  }}
                >
                  <X size={10} />
                </span>
              </div>
            )
          })}
        </div>

        {/* ── Toolbar buttons ─────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexShrink: 0,
            paddingRight: 4,
            paddingLeft: 4,
          }}
        >
          {/* New terminal with default shell */}
          <button
            className="tp-toolbar-btn"
            onClick={() => addTab()}
            title="New Terminal"
            style={{ width: 24, height: 24 }}
          >
            <Plus size={13} />
          </button>

          {/* Shell type dropdown */}
          <div style={{ position: 'relative' }} ref={dropdownRef}>
            <button
              className="tp-toolbar-btn"
              data-active={showShellDropdown}
              onClick={() => setShowShellDropdown(prev => !prev)}
              title="Select Shell Type"
              style={{ width: 24, height: 24 }}
            >
              <ChevronDown size={13} />
            </button>

            {showShellDropdown && (
              <div className="tp-shell-dropdown">
                <div
                  style={{
                    padding: '4px 10px',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Select Shell
                </div>
                {shellProfiles.map(profile => (
                  <button
                    key={profile.id}
                    className="tp-shell-item"
                    onClick={() => addTab(profile)}
                  >
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        background: 'rgba(255,255,255,0.04)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 9,
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono, monospace)',
                        color: 'var(--accent-blue)',
                        flexShrink: 0,
                      }}
                    >
                      {profile.icon}
                    </span>
                    <span style={{ flex: 1 }}>{profile.name}</span>
                    <span
                      style={{
                        fontSize: 9,
                        color: 'var(--text-muted)',
                        opacity: 0.5,
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    >
                      {profile.shellPath.split(/[/\\]/).pop()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Separator */}
          <div style={{ width: 1, height: 14, background: 'var(--border-color)', margin: '0 2px', opacity: 0.4 }} />

          {/* Split terminal */}
          <button
            className="tp-toolbar-btn"
            onClick={splitTerminal}
            title="Split Terminal"
            style={{ width: 24, height: 24 }}
          >
            <Columns2 size={13} />
          </button>

          {/* Separator */}
          <div style={{ width: 1, height: 14, background: 'var(--border-color)', margin: '0 2px', opacity: 0.4 }} />

          {/* Clear terminal */}
          <button
            className="tp-toolbar-btn"
            onClick={clearTerminal}
            title="Clear Terminal (Ctrl+L)"
            style={{ width: 24, height: 24 }}
          >
            <Ban size={13} />
          </button>

          {/* Terminal find */}
          <button
            className="tp-toolbar-btn"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('terminal:toggle-find', {
                detail: { sessionId: activeTabId },
              }))
            }}
            title="Find in Terminal (Ctrl+F)"
            style={{ width: 24, height: 24 }}
          >
            <Search size={13} />
          </button>

          {/* Separator */}
          <div style={{ width: 1, height: 14, background: 'var(--border-color)', margin: '0 2px', opacity: 0.4 }} />

          {/* Kill terminal */}
          <button
            className="tp-toolbar-btn tp-kill-btn"
            onClick={killTerminal}
            title="Kill Terminal"
            style={{ width: 24, height: 24 }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* ── Terminal Content Area ──────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {groups.map(group => {
          const parentId = group[0].splitParentId || group[0].id
          const isGroupVisible = parentId === activeGroupParentId

          // Hidden groups render the same tree as visible ones, only with
          // display:none: a different element shape would remount (and so
          // kill) their terminals on every tab switch.
          return (
            <div
              key={parentId}
              style={{
                display: isGroupVisible ? 'flex' : 'none',
                height: '100%',
              }}
            >
              {group.map((t, idx) => {
                const isTabActive = isGroupVisible && activeTabId === t.id
                const sizeKey = `${parentId}-${idx}`
                const extraWidth = splitSizes[sizeKey] || 0

                return (
                  <div key={t.id} style={{ display: 'contents' }}>
                    {/* Split divider between panes */}
                    {idx > 0 && (
                      <SplitDivider
                        onResize={(delta) => {
                          handleSplitResize(parentId, idx - 1, delta)
                          handleSplitResize(parentId, idx, -delta)
                        }}
                      />
                    )}
                    <div
                      style={{
                        flex: `1 1 0`,
                        width: extraWidth ? `calc(${100 / group.length}% + ${extraWidth}px)` : undefined,
                        minWidth: 80,
                        height: '100%',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        animation: group.length > 1 ? 'tp-split-grow 0.2s ease' : undefined,
                      }}
                      onClick={() => setActiveTabId(t.id)}
                    >
                      {/* Split pane header (only when there are splits) */}
                      {group.length > 1 && (
                        <div
                          className="tp-split-header"
                          style={{
                            height: 24,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '0 8px',
                            flexShrink: 0,
                            background: isTabActive
                              ? 'rgba(88,166,255,0.06)'
                              : 'rgba(255,255,255,0.01)',
                            borderBottom: `1px solid ${isTabActive ? 'rgba(88,166,255,0.2)' : 'var(--border-color)'}`,
                            fontSize: 10,
                            color: isTabActive ? 'var(--text-primary)' : 'var(--text-muted)',
                          }}
                          onClick={() => setActiveTabId(t.id)}
                        >
                          {/* Shell icon */}
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 14,
                              height: 14,
                              borderRadius: 2,
                              background: isTabActive ? 'rgba(88,166,255,0.1)' : 'rgba(255,255,255,0.04)',
                              fontSize: 7,
                              fontWeight: 700,
                              fontFamily: 'var(--font-mono, monospace)',
                              color: isTabActive ? 'var(--accent-blue)' : 'var(--text-muted)',
                              flexShrink: 0,
                            }}
                          >
                            {t.shellIcon}
                          </span>

                          <TerminalIcon size={10} style={{ opacity: 0.6, flexShrink: 0 }} />

                          {renamingId === t.id ? (
                            <input
                              ref={renameInputRef}
                              className="tp-rename-input"
                              value={renameValue}
                              onChange={e => setRenameValue(e.target.value)}
                              onBlur={commitRename}
                              onKeyDown={e => {
                                if (e.key === 'Enter') commitRename()
                                if (e.key === 'Escape') cancelRename()
                              }}
                              onClick={e => e.stopPropagation()}
                              style={{ width: 70, height: 16, fontSize: 10 }}
                            />
                          ) : (
                            <span
                              onDoubleClick={() => startRename(t.id, t.name)}
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {t.name}
                            </span>
                          )}
                          <span style={{ flex: 1 }} />
                          <span
                            onClick={e => { e.stopPropagation(); closeTab(t.id) }}
                            className="tp-toolbar-btn"
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: 3,
                              cursor: 'pointer',
                            }}
                            title="Close split"
                          >
                            <X size={10} />
                          </span>
                        </div>
                      )}

                      {/* Terminal instance */}
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <SingleTerminal
                          sessionId={t.id}
                          shellPath={t.shellPath}
                          shellArgs={t.shellArgs}
                          initialCommand={t.id === sessionId ? initialCommand : undefined}
                          onTitleChange={handleChildTitleChange}
                          isActive={isTabActive}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
