import { useState, useEffect, useRef, useCallback } from 'react'
import { useAgentStore } from '@/store/agents'
import { useEditorStore } from '@/store/editor'
import { useChatStore } from '@/store/chat'
import { useFileStore } from '@/store/files'
import { useToastStore } from '@/store/toast'
import { useCompletionStore } from '@/store/completion'
import NotificationCenter from '@/components/NotificationCenter'
import {
  GitBranch,
  AlertTriangle,
  XCircle,
  Bot,
  Zap,
  CheckCircle2,
  Cloud,
  CloudOff,
  MessageSquare,
  Terminal,
  ArrowUpDown,
  Bell,
  Sparkles,
  ChevronDown,
  Check,
  Cpu,
  Puzzle,
  Files,
} from 'lucide-react'

interface Props {
  onToggleTerminal?: () => void
  onToggleChat?: () => void
}

interface StatusItemProps {
  children: React.ReactNode
  style?: React.CSSProperties
  onClick?: () => void
  title?: string
}

function StatusItem({ children, style, onClick, title }: StatusItemProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className="flex items-center"
      title={title}
      style={{
        height: '100%',
        padding: '0 7px',
        gap: 4,
        cursor: onClick ? 'pointer' : 'default',
        background: hovered ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
        transition: 'background 0.1s',
        ...style,
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </div>
  )
}

// ── Dropdown component used by all selectors ──────────────────
interface DropdownItem {
  id: string
  label: string
  active?: boolean
}

interface StatusDropdownProps {
  items: DropdownItem[]
  onSelect: (id: string) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLDivElement | null>
  maxHeight?: number
  searchable?: boolean
}

function StatusDropdown({ items, onSelect, onClose, anchorRef, maxHeight = 260, searchable = false }: StatusDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState('')
  const [hoveredIdx, setHoveredIdx] = useState(-1)

  const filtered = filter
    ? items.filter((i) => i.label.toLowerCase().includes(filter.toLowerCase()))
    : items

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, anchorRef])

  // Close on Escape, navigate with arrows
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHoveredIdx((p) => Math.min(p + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHoveredIdx((p) => Math.max(p - 1, 0))
      } else if (e.key === 'Enter' && hoveredIdx >= 0 && hoveredIdx < filtered.length) {
        e.preventDefault()
        onSelect(filtered[hoveredIdx].id)
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, onSelect, filtered, hoveredIdx])

  // Focus search input when opened
  useEffect(() => {
    if (searchable) inputRef.current?.focus()
  }, [searchable])

  // Position above the anchor
  const rect = anchorRef.current?.getBoundingClientRect()
  const left = rect ? rect.left : 0
  const bottom = rect ? window.innerHeight - rect.top + 2 : 24

  return (
    <div
      ref={dropdownRef}
      style={{
        position: 'fixed',
        left: Math.max(0, Math.min(left, window.innerWidth - 200)),
        bottom,
        minWidth: 180,
        maxWidth: 300,
        maxHeight,
        background: 'var(--bg-secondary, #1e1e2e)',
        border: '1px solid var(--border, #333)',
        borderRadius: 4,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        fontSize: 12,
        color: 'var(--text-primary, #ccc)',
      }}
    >
      {searchable && (
        <div style={{ padding: '4px 6px', borderBottom: '1px solid var(--border, #333)' }}>
          <input
            ref={inputRef}
            type="text"
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setHoveredIdx(0) }}
            placeholder="Search..."
            style={{
              width: '100%',
              background: 'var(--bg-primary, #111)',
              border: '1px solid var(--border, #444)',
              borderRadius: 3,
              padding: '3px 6px',
              fontSize: 11,
              color: 'var(--text-primary, #ccc)',
              outline: 'none',
            }}
          />
        </div>
      )}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {filtered.map((item, idx) => (
          <div
            key={item.id}
            style={{
              padding: '4px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: hoveredIdx === idx ? 'rgba(255,255,255,0.08)' : 'transparent',
              color: item.active ? 'var(--accent, #58a6ff)' : undefined,
            }}
            onMouseEnter={() => setHoveredIdx(idx)}
            onClick={() => { onSelect(item.id); onClose() }}
          >
            {item.active && <Check size={10} style={{ flexShrink: 0 }} />}
            {!item.active && <span style={{ width: 10, flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.label}
            </span>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: '8px', color: 'var(--text-muted)', textAlign: 'center' }}>
            No results
          </div>
        )}
      </div>
    </div>
  )
}

// ── Constants ──────────────────
const AVAILABLE_ENCODINGS = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'utf-16le', label: 'UTF-16 LE' },
  { id: 'utf-16be', label: 'UTF-16 BE' },
  { id: 'ascii', label: 'ASCII' },
  { id: 'iso-8859-1', label: 'ISO-8859-1' },
]

const INDENTATION_OPTIONS = [
  { id: 'spaces-2', label: 'Spaces: 2' },
  { id: 'spaces-4', label: 'Spaces: 4' },
  { id: 'spaces-8', label: 'Spaces: 8' },
  { id: 'tabs-2', label: 'Tab Size: 2' },
  { id: 'tabs-4', label: 'Tab Size: 4' },
  { id: 'tabs-8', label: 'Tab Size: 8' },
]

const MONACO_LANGUAGES = [
  { id: 'plaintext', label: 'Plain Text' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'typescriptreact', label: 'TypeScript React' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'javascriptreact', label: 'JavaScript React' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'csharp', label: 'C#' },
  { id: 'cpp', label: 'C++' },
  { id: 'c', label: 'C' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'php', label: 'PHP' },
  { id: 'swift', label: 'Swift' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'scss', label: 'SCSS' },
  { id: 'less', label: 'Less' },
  { id: 'json', label: 'JSON' },
  { id: 'xml', label: 'XML' },
  { id: 'yaml', label: 'YAML' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'sql', label: 'SQL' },
  { id: 'shell', label: 'Shell Script' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'lua', label: 'Lua' },
  { id: 'perl', label: 'Perl' },
  { id: 'r', label: 'R' },
  { id: 'objective-c', label: 'Objective-C' },
  { id: 'bat', label: 'Batch' },
  { id: 'ini', label: 'INI' },
  { id: 'handlebars', label: 'Handlebars' },
  { id: 'razor', label: 'Razor' },
  { id: 'pug', label: 'Pug' },
  { id: 'coffeescript', label: 'CoffeeScript' },
  { id: 'fsharp', label: 'F#' },
  { id: 'clojure', label: 'Clojure' },
  { id: 'dart', label: 'Dart' },
  { id: 'elixir', label: 'Elixir' },
  { id: 'scheme', label: 'Scheme' },
]

interface GitInfo {
  isRepo: boolean
  branch: string
  files: { path: string; state: string }[]
  ahead: number
  behind: number
}

interface BranchInfo {
  name: string
  current: boolean
}

export default function StatusBar({ onToggleTerminal, onToggleChat }: Props) {
  const agents = useAgentStore((s) => s.agents)
  const activeFile = useEditorStore((s) =>
    s.openFiles.find((f) => f.path === s.activeFilePath)
  )
  const model = useChatStore((s) => s.selectedModel)
  const rootPath = useFileStore((s) => s.rootPath)
  const logs = useAgentStore((s) => s.logs)
  const activeAgents = agents.filter((a) => a.status !== 'idle').length
  const errorCount = logs.filter((l) => l.type === 'error').length
  const warningCount = logs.filter((l) => l.type === 'action').length
  const storeUnreadCount = useToastStore((s) => s.getUnreadCount)()

  // Auto-saved indicator: shows briefly when auto-save triggers
  const [autoSavedVisible, setAutoSavedVisible] = useState(false)
  const autoSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handler = () => {
      setAutoSavedVisible(true)
      if (autoSavedTimerRef.current) clearTimeout(autoSavedTimerRef.current)
      autoSavedTimerRef.current = setTimeout(() => setAutoSavedVisible(false), 2000)
    }
    window.addEventListener('orion:auto-saved', handler)
    return () => {
      window.removeEventListener('orion:auto-saved', handler)
      if (autoSavedTimerRef.current) clearTimeout(autoSavedTimerRef.current)
    }
  }, [])
  const unreadNotifications = storeUnreadCount > 0 ? storeUnreadCount : errorCount + activeAgents
  const completionEnabled = useCompletionStore((s) => s.enabled)
  const completionLoading = useCompletionStore((s) => s.isLoading)
  const setCompletionEnabled = useCompletionStore((s) => s.setEnabled)
  const [notifCenterOpen, setNotifCenterOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [cursorInfo, setCursorInfo] = useState({ line: 1, column: 1, selectedChars: 0, selectedLines: 0, totalLines: 0 })

  // Dropdown states
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false)
  const [encodingDropdownOpen, setEncodingDropdownOpen] = useState(false)
  const [indentDropdownOpen, setIndentDropdownOpen] = useState(false)
  const [eolDropdownOpen, setEolDropdownOpen] = useState(false)
  const [selectedEncoding, setSelectedEncoding] = useState('utf-8')
  const [indentConfig, setIndentConfig] = useState({ useSpaces: true, size: 2 })
  const [eolSequence, setEolSequence] = useState<'LF' | 'CRLF'>('LF')

  // Refs for dropdown anchoring
  const branchRef = useRef<HTMLDivElement>(null)
  const languageRef = useRef<HTMLDivElement>(null)
  const encodingRef = useRef<HTMLDivElement>(null)
  const indentRef = useRef<HTMLDivElement>(null)
  const eolRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!rootPath) return
    const fetchGit = async () => {
      try {
        const info = await window.api?.gitStatus(rootPath)
        if (info) setGitInfo(info)
      } catch {}
    }
    fetchGit()
    const interval = setInterval(fetchGit, 5000)
    return () => clearInterval(interval)
  }, [rootPath])

  // Listen for cursor position changes from EditorPanel
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail) setCursorInfo(detail)
    }
    window.addEventListener('orion:cursor-position', handler)
    return () => window.removeEventListener('orion:cursor-position', handler)
  }, [])

  // Reset cursor position when the active file changes
  useEffect(() => {
    setCursorInfo({ line: 1, column: 1, selectedChars: 0, selectedLines: 0, totalLines: 0 })
  }, [activeFile?.path])

  // Listen for file-info events from EditorPanel to sync indent/EOL/language
  const [editorLanguageId, setEditorLanguageId] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail) return
      if (detail.useSpaces !== undefined && detail.tabSize !== undefined) {
        setIndentConfig({ useSpaces: detail.useSpaces, size: detail.tabSize })
      }
      if (detail.eol) {
        setEolSequence(detail.eol as 'LF' | 'CRLF')
      }
      if (detail.languageId) {
        setEditorLanguageId(detail.languageId)
      }
    }
    window.addEventListener('orion:file-info', handler)
    return () => window.removeEventListener('orion:file-info', handler)
  }, [])

  // Reset editor language override when active file changes
  useEffect(() => {
    setEditorLanguageId(null)
  }, [activeFile?.path])

  // Derive display language from file extension
  const getLanguageLabel = (filename?: string, language?: string): string => {
    if (language) {
      const langMap: Record<string, string> = {
        typescript: 'TypeScript',
        typescriptreact: 'TypeScript React',
        javascript: 'JavaScript',
        javascriptreact: 'JavaScript React',
        python: 'Python',
        html: 'HTML',
        css: 'CSS',
        scss: 'SCSS',
        less: 'Less',
        json: 'JSON',
        markdown: 'Markdown',
        yaml: 'YAML',
        xml: 'XML',
        rust: 'Rust',
        go: 'Go',
        java: 'Java',
        cpp: 'C++',
        c: 'C',
        csharp: 'C#',
        ruby: 'Ruby',
        php: 'PHP',
        swift: 'Swift',
        kotlin: 'Kotlin',
        sql: 'SQL',
        shell: 'Shell',
        bash: 'Bash',
        powershell: 'PowerShell',
        dockerfile: 'Dockerfile',
        plaintext: 'Plain Text',
      }
      return langMap[language] || language.charAt(0).toUpperCase() + language.slice(1)
    }
    if (!filename) return 'Plain Text'
    const ext = filename.split('.').pop()?.toLowerCase()
    const extMap: Record<string, string> = {
      ts: 'TypeScript', tsx: 'TypeScript React',
      js: 'JavaScript', jsx: 'JavaScript React',
      py: 'Python', rb: 'Ruby', rs: 'Rust', go: 'Go',
      java: 'Java', kt: 'Kotlin', swift: 'Swift',
      cpp: 'C++', c: 'C', cs: 'C#', php: 'PHP',
      html: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less',
      json: 'JSON', md: 'Markdown', yml: 'YAML', yaml: 'YAML',
      xml: 'XML', sql: 'SQL', sh: 'Shell', ps1: 'PowerShell',
    }
    return ext ? (extMap[ext] || 'Plain Text') : 'Plain Text'
  }

  // Get the current language ID from the active file (prefer editor-reported)
  const getCurrentLanguageId = (): string => {
    if (editorLanguageId) return editorLanguageId
    if (activeFile?.language) return activeFile.language
    if (!activeFile?.name) return 'plaintext'
    const ext = activeFile.name.split('.').pop()?.toLowerCase()
    const extToId: Record<string, string> = {
      ts: 'typescript', tsx: 'typescriptreact',
      js: 'javascript', jsx: 'javascriptreact',
      py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
      java: 'java', kt: 'kotlin', swift: 'swift',
      cpp: 'cpp', c: 'c', cs: 'csharp', php: 'php',
      html: 'html', css: 'css', scss: 'scss', less: 'less',
      json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml',
      xml: 'xml', sql: 'sql', sh: 'shell', ps1: 'powershell',
    }
    return ext ? (extToId[ext] || 'plaintext') : 'plaintext'
  }

  // ── Git branch actions ──────────────────
  const handleBranchClick = useCallback(async () => {
    if (!rootPath || !gitInfo?.isRepo) return
    try {
      const branchList = await window.api?.gitBranches(rootPath)
      if (branchList) {
        setBranches(branchList)
        setBranchDropdownOpen(true)
      }
    } catch {}
  }, [rootPath, gitInfo])

  const handleBranchSelect = useCallback(async (branchName: string) => {
    if (!rootPath) return
    try {
      await window.api?.gitCheckout(rootPath, branchName)
      // Re-fetch git status after checkout
      const info = await window.api?.gitStatus(rootPath)
      if (info) setGitInfo(info)
    } catch {}
  }, [rootPath])

  // ── Language mode action ──────────────────
  const handleLanguageSelect = useCallback((languageId: string) => {
    setEditorLanguageId(languageId)
    window.dispatchEvent(
      new CustomEvent('orion:set-language', { detail: { languageId } })
    )
  }, [])

  // ── Format document action ──────────────────
  const handleFormat = useCallback(() => {
    window.dispatchEvent(new CustomEvent('orion:format-document'))
  }, [])

  // ── Indentation display ──────────────────
  const indentLabel = indentConfig.useSpaces
    ? `Spaces: ${indentConfig.size}`
    : `Tab Size: ${indentConfig.size}`

  const indentOptionId = `${indentConfig.useSpaces ? 'spaces' : 'tabs'}-${indentConfig.size}`

  const handleIndentSelect = useCallback((id: string) => {
    const [type, sizeStr] = id.split('-')
    const size = parseInt(sizeStr, 10)
    const useSpaces = type === 'spaces'
    setIndentConfig({ useSpaces, size })
    window.dispatchEvent(
      new CustomEvent('orion:set-indent', { detail: { useSpaces, size } })
    )
  }, [])

  // ── EOL action ──────────────────
  const handleEolSelect = useCallback((id: string) => {
    const eol = id as 'LF' | 'CRLF'
    setEolSequence(eol)
    window.dispatchEvent(
      new CustomEvent('orion:set-eol', { detail: { eol } })
    )
  }, [])

  // ── Performance monitoring ──────────────────
  const [memoryMB, setMemoryMB] = useState<number | null>(null)
  const openFilesCount = useEditorStore((s) => s.openFiles.length)
  const SIMULATED_EXTENSIONS = 12

  // Memory usage polling (every 10 seconds)
  useEffect(() => {
    const readMemory = () => {
      try {
        // Chromium/Electron: performance.memory is available
        const perfMemory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        if (perfMemory?.usedJSHeapSize) {
          setMemoryMB(Math.round(perfMemory.usedJSHeapSize / (1024 * 1024)))
          return
        }
      } catch {
        // ignore
      }
      // Fallback: estimate based on open files
      setMemoryMB(80 + openFilesCount * 8)
    }
    readMemory()
    const interval = setInterval(readMemory, 10_000)
    return () => clearInterval(interval)
  }, [openFilesCount])

  const getMemoryColor = (mb: number): string => {
    if (mb < 300) return 'var(--accent-green, #89d185)'
    if (mb <= 500) return 'var(--accent-orange, #cca700)'
    return 'var(--accent-red, #f44747)'
  }

  const handleMemoryClick = useCallback(() => {
    // Hint the GC by clearing weak references / forcing minor collection
    if (typeof window !== 'undefined' && (window as unknown as { gc?: () => void }).gc) {
      ;(window as unknown as { gc: () => void }).gc()
    }
    // Dispatch event so other parts of the app can respond
    window.dispatchEvent(new CustomEvent('orion:gc-hint'))
    // Re-read memory after a short delay
    setTimeout(() => {
      try {
        const perfMemory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        if (perfMemory?.usedJSHeapSize) {
          setMemoryMB(Math.round(perfMemory.usedJSHeapSize / (1024 * 1024)))
        }
      } catch {
        // ignore
      }
    }, 500)
  }, [])

  const changedFiles = gitInfo?.files?.length || 0

  // Build ahead/behind label for branch display using arrow symbols
  const aheadBehindLabel = gitInfo?.isRepo
    ? [
        gitInfo.ahead > 0 ? `\u2191${gitInfo.ahead}` : '',
        gitInfo.behind > 0 ? `\u2193${gitInfo.behind}` : '',
      ].filter(Boolean).join(' ')
    : ''

  return (
    <footer
      className="shrink-0 flex items-center select-none"
      style={{
        height: 22,
        background: 'var(--bg-tertiary)',
        borderTop: '1px solid var(--border)',
        fontSize: 11,
        color: 'var(--text-muted)',
      }}
    >
      {/* LEFT SECTION */}
      <div className="flex items-center" style={{ height: '100%' }}>
        {/* Brand badge */}
        <div
          className="flex items-center justify-center"
          style={{
            height: 22,
            padding: '0 10px',
            background: 'linear-gradient(135deg, #58a6ff, #bc8cff)',
            color: '#fff',
            fontWeight: 600,
            fontSize: 10,
            gap: 4,
            display: 'flex',
          }}
        >
          <Zap size={9} fill="#fff" />
          Orion
        </div>

        {/* Branch info with click-to-switch */}
        <div ref={branchRef} style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <StatusItem
            title={gitInfo?.isRepo ? `Branch: ${gitInfo.branch} (click to switch)` : 'Not a git repository'}
            onClick={handleBranchClick}
          >
            <GitBranch size={11} style={{ color: 'var(--text-secondary)' }} />
            <span style={{ color: 'var(--text-secondary)' }}>
              {gitInfo?.isRepo ? gitInfo.branch : 'No repo'}
            </span>
            {aheadBehindLabel && (
              <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 2 }}>
                {aheadBehindLabel}
              </span>
            )}
            {gitInfo?.isRepo && <ChevronDown size={9} style={{ color: 'var(--text-muted)', marginLeft: 1 }} />}
          </StatusItem>
        </div>

        {branchDropdownOpen && branchRef.current && (
          <StatusDropdown
            items={branches
              .filter((b) => !b.name.startsWith('origin/'))
              .map((b) => ({
                id: b.name,
                label: b.name,
                active: b.name === gitInfo?.branch,
              }))}
            onSelect={handleBranchSelect}
            onClose={() => setBranchDropdownOpen(false)}
            anchorRef={branchRef}
            searchable
          />
        )}

        {/* Sync indicator */}
        <StatusItem title={gitInfo?.isRepo ? `${gitInfo.ahead || 0}\u2191 ${gitInfo.behind || 0}\u2193` : ''}>
          {gitInfo?.isRepo ? (
            <>
              <ArrowUpDown size={10} style={{ color: 'var(--text-muted)' }} />
              {(gitInfo.ahead > 0 || gitInfo.behind > 0) && (
                <span style={{ fontSize: 10 }}>
                  {gitInfo.ahead > 0 && `${gitInfo.ahead}\u2191`}
                  {gitInfo.behind > 0 && ` ${gitInfo.behind}\u2193`}
                </span>
              )}
            </>
          ) : (
            <CloudOff size={10} style={{ color: 'var(--text-muted)' }} />
          )}
        </StatusItem>

        {/* Changed files count */}
        {changedFiles > 0 && (
          <StatusItem title={`${changedFiles} changed files`}>
            <Cloud size={10} style={{ color: 'var(--accent-orange)' }} />
            <span style={{ color: 'var(--accent-orange)' }}>{changedFiles}</span>
          </StatusItem>
        )}

        {/* Active agents */}
        {activeAgents > 0 && (
          <StatusItem style={{ color: 'var(--accent-green)' }}>
            <Bot size={11} />
            <span>{activeAgents} active</span>
          </StatusItem>
        )}

        {/* Divider */}
        <div className="status-divider" />

        {/* Error & warning counters (always visible, like VS Code) */}
        <StatusItem title={`${errorCount} error(s), ${warningCount} warning(s)`}>
          <XCircle
            size={10}
            style={{ color: errorCount > 0 ? 'var(--accent-red, #f44747)' : 'var(--text-muted)' }}
          />
          <span style={{ color: errorCount > 0 ? 'var(--accent-red, #f44747)' : undefined }}>
            {errorCount}
          </span>
          <AlertTriangle
            size={10}
            style={{
              color: warningCount > 0 ? 'var(--accent-orange, #cca700)' : 'var(--text-muted)',
              marginLeft: 4,
            }}
          />
          <span style={{ color: warningCount > 0 ? 'var(--accent-orange, #cca700)' : undefined }}>
            {warningCount}
          </span>
        </StatusItem>
      </div>

      {/* SPACER pushes right section to the end */}
      <div className="flex-1" />

      {/* RIGHT SECTION */}
      <div className="flex items-center" style={{ height: '100%' }}>
        {activeFile && (
          <>
            {/* Cursor position - clickable to trigger Go to Line */}
            <StatusItem
              title={cursorInfo.selectedChars > 0 ? `${cursorInfo.selectedChars} characters selected across ${cursorInfo.selectedLines} line(s) - Click to Go to Line` : `Line ${cursorInfo.line}, Column ${cursorInfo.column} - Click to Go to Line (Ctrl+G)`}
              onClick={() => window.dispatchEvent(new CustomEvent('orion:go-to-line'))}
            >
              <span style={{ padding: '0 4px', fontSize: 11 }}>
                Ln {cursorInfo.line}, Col {cursorInfo.column}
                {cursorInfo.totalLines > 0 && (
                  <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                    / {cursorInfo.totalLines}
                  </span>
                )}
                {cursorInfo.selectedChars > 0 && (
                  <span style={{ marginLeft: 6, color: 'var(--accent-blue)' }}>
                    ({cursorInfo.selectedChars} selected{cursorInfo.selectedLines > 1 ? `, ${cursorInfo.selectedLines} lines` : ''})
                  </span>
                )}
              </span>
            </StatusItem>

            {/* Indentation indicator */}
            <div ref={indentRef} style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
              <StatusItem
                title="Indentation settings (click to change)"
                onClick={() => setIndentDropdownOpen((v) => !v)}
              >
                <span>{indentLabel}</span>
                <ChevronDown size={9} style={{ color: 'var(--text-muted)' }} />
              </StatusItem>
            </div>

            {indentDropdownOpen && indentRef.current && (
              <StatusDropdown
                items={INDENTATION_OPTIONS.map((o) => ({
                  ...o,
                  active: o.id === indentOptionId,
                }))}
                onSelect={handleIndentSelect}
                onClose={() => setIndentDropdownOpen(false)}
                anchorRef={indentRef}
              />
            )}

            {/* End of line selector */}
            <div ref={eolRef} style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
              <StatusItem
                title="End of line sequence (click to change)"
                onClick={() => setEolDropdownOpen((v) => !v)}
              >
                <span>{eolSequence}</span>
                <ChevronDown size={9} style={{ color: 'var(--text-muted)' }} />
              </StatusItem>
            </div>

            {eolDropdownOpen && eolRef.current && (
              <StatusDropdown
                items={[
                  { id: 'LF', label: 'LF (Unix)', active: eolSequence === 'LF' },
                  { id: 'CRLF', label: 'CRLF (Windows)', active: eolSequence === 'CRLF' },
                ]}
                onSelect={handleEolSelect}
                onClose={() => setEolDropdownOpen(false)}
                anchorRef={eolRef}
              />
            )}

            {/* File encoding selector */}
            <div ref={encodingRef} style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
              <StatusItem
                title="File encoding (click to change)"
                onClick={() => setEncodingDropdownOpen((v) => !v)}
              >
                <span>{AVAILABLE_ENCODINGS.find((e) => e.id === selectedEncoding)?.label || 'UTF-8'}</span>
                <ChevronDown size={9} style={{ color: 'var(--text-muted)' }} />
              </StatusItem>
            </div>

            {encodingDropdownOpen && encodingRef.current && (
              <StatusDropdown
                items={AVAILABLE_ENCODINGS.map((e) => ({
                  ...e,
                  active: e.id === selectedEncoding,
                }))}
                onSelect={(id) => setSelectedEncoding(id)}
                onClose={() => setEncodingDropdownOpen(false)}
                anchorRef={encodingRef}
              />
            )}

            {/* Language mode selector */}
            <div ref={languageRef} style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
              <StatusItem
                title={`Language: ${getLanguageLabel(activeFile.name, editorLanguageId || activeFile.language)} (click to change)`}
                onClick={() => setLanguageDropdownOpen((v) => !v)}
              >
                <span style={{ color: 'var(--text-secondary)' }}>
                  {getLanguageLabel(activeFile.name, editorLanguageId || activeFile.language)}
                </span>
                <ChevronDown size={9} style={{ color: 'var(--text-muted)' }} />
              </StatusItem>
            </div>

            {languageDropdownOpen && languageRef.current && (
              <StatusDropdown
                items={MONACO_LANGUAGES.map((l) => ({
                  ...l,
                  active: l.id === getCurrentLanguageId(),
                }))}
                onSelect={handleLanguageSelect}
                onClose={() => setLanguageDropdownOpen(false)}
                anchorRef={languageRef}
                maxHeight={320}
                searchable
              />
            )}

            {/* Format document button */}
            <StatusItem title="Format Document (Shift+Alt+F)" onClick={handleFormat}>
              <Sparkles size={11} style={{ color: 'var(--text-muted)' }} />
            </StatusItem>
          </>
        )}

        {/* ── Performance indicators ── */}

        {/* Open files / editor performance */}
        <StatusItem title={`${openFilesCount} file(s) open${cursorInfo.totalLines > 0 ? `, ${cursorInfo.totalLines} lines in current file` : ''}`}>
          <Files size={10} style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
            {openFilesCount} file{openFilesCount !== 1 ? 's' : ''}
            {activeFile && cursorInfo.totalLines > 0 && (
              <span style={{ marginLeft: 4, opacity: 0.7 }}>
                ({cursorInfo.totalLines.toLocaleString()} ln)
              </span>
            )}
          </span>
        </StatusItem>

        {/* Memory usage */}
        {memoryMB !== null && (
          <StatusItem
            title={`Memory: ${memoryMB} MB (click to hint GC)`}
            onClick={handleMemoryClick}
          >
            <Cpu size={10} style={{ color: getMemoryColor(memoryMB) }} />
            <span style={{ color: getMemoryColor(memoryMB), fontSize: 10 }}>
              {memoryMB} MB
            </span>
          </StatusItem>
        )}

        {/* Extensions count */}
        <StatusItem title={`${SIMULATED_EXTENSIONS} extensions active`}>
          <Puzzle size={10} style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
            {SIMULATED_EXTENSIONS} ext
          </span>
        </StatusItem>

        {/* AI Autocomplete toggle */}
        <StatusItem
          title={completionEnabled ? 'AI Autocomplete: ON' : 'AI Autocomplete: OFF'}
          onClick={() => setCompletionEnabled(!completionEnabled)}
        >
          <Sparkles size={12} style={{ animation: completionLoading ? 'pulse 1s infinite' : 'none', opacity: completionEnabled ? 1 : 0.5 }} />
          <span style={{ opacity: completionEnabled ? 1 : 0.5 }}>Copilot</span>
        </StatusItem>

        {/* Divider before bell */}
        <div className="status-divider" />

        {/* Notification bell */}
        <div ref={bellRef} style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <StatusItem
            title={unreadNotifications > 0 ? `${unreadNotifications} notification(s)` : 'No notifications'}
            onClick={() => setNotifCenterOpen((v) => !v)}
          >
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Bell size={11} style={{ color: unreadNotifications > 0 ? 'var(--accent, #58a6ff)' : 'var(--text-muted)' }} />
              {unreadNotifications > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -6,
                    background: 'var(--accent-red, #f44747)',
                    color: '#fff',
                    fontSize: 8,
                    fontWeight: 700,
                    lineHeight: 1,
                    minWidth: 12,
                    height: 12,
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 3px',
                  }}
                >
                  {unreadNotifications > 99 ? '99+' : unreadNotifications}
                </span>
              )}
            </div>
          </StatusItem>
        </div>

        <NotificationCenter
          open={notifCenterOpen}
          onClose={() => setNotifCenterOpen(false)}
          anchorRef={bellRef}
        />

        {/* Toggle buttons */}
        <StatusItem onClick={onToggleTerminal} title="Toggle Terminal (Ctrl+`)">
          <Terminal size={11} />
        </StatusItem>
        <StatusItem onClick={onToggleChat} title="Toggle Chat (Ctrl+L)">
          <MessageSquare size={11} />
        </StatusItem>

        {/* AI model */}
        <StatusItem>
          <Zap size={9} />
          <span>{model}</span>
        </StatusItem>

        {/* Divider */}
        <div className="status-divider" />

        {/* Feedback button */}
        <StatusItem
          title="Send feedback"
          onClick={() => window.open('https://github.com/orion-editor/orion/issues', '_blank')}
        >
          <span style={{ fontSize: 10 }}>Feedback</span>
        </StatusItem>

        {/* Divider */}
        <div className="status-divider" />

        {/* Auto-saved indicator */}
        {autoSavedVisible && (
          <StatusItem title="File auto-saved">
            <CheckCircle2 size={10} style={{ color: 'var(--accent-green)' }} />
            <span style={{
              color: 'var(--accent-green)',
              fontSize: 10,
              opacity: 0.9,
              transition: 'opacity 0.3s ease',
            }}>
              Auto-saved
            </span>
          </StatusItem>
        )}

        {/* Status */}
        <StatusItem>
          <CheckCircle2 size={10} style={{ color: 'var(--accent-green)' }} />
          <span style={{ color: 'var(--accent-green)' }}>Ready</span>
        </StatusItem>
      </div>
    </footer>
  )
}
