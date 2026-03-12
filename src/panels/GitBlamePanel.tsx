import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  GitCommit,
  User,
  Clock,
  Copy,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Calendar,
  ArrowLeft,
  ExternalLink,
  Hash,
  FileText,
  X,
  Search,
  Filter,
  MoreVertical,
  Info,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface BlameCommit {
  sha: string
  shortSha: string
  author: string
  authorEmail: string
  date: Date
  message: string
  summary: string
  parentSha: string | null
  filesChanged: number
  insertions: number
  deletions: number
}

interface BlameInfo {
  lineNumber: number
  commit: BlameCommit
  originalLine: number
  content: string
  isFirstLineOfGroup: boolean
  groupSize: number
}

interface BlameHistoryEntry {
  sha: string
  fileName: string
  label: string
}

interface AuthorStats {
  name: string
  email: string
  lineCount: number
  commitCount: number
  color: string
  firstCommitDate: Date
  lastCommitDate: Date
}

// ─── Constants ──────────────────────────────────────────────────────────────

const AUTHOR_COLORS = [
  '#388bfd', '#3fb950', '#d29922', '#f85149', '#d2a8ff',
  '#f78166', '#a5d6ff', '#7ee787', '#ff7b72', '#79c0ff',
  '#56d364', '#e3b341', '#bc8cff', '#ffa657', '#ff9bce',
  '#b1bac4', '#89929b', '#6cb6ff', '#db61a2', '#c9d1d9',
]

const WARM_TO_COOL_GRADIENT = [
  '#f85149', '#f0883e', '#d29922', '#e3b341', '#7ee787',
  '#56d364', '#3fb950', '#388bfd', '#6cb6ff', '#a5d6ff',
  '#8b949e',
]

const MOCK_AUTHORS = [
  { name: 'Alice Chen', email: 'alice.chen@example.com' },
  { name: 'Bob Martinez', email: 'bob.martinez@example.com' },
  { name: 'Carol Williams', email: 'carol.w@example.com' },
  { name: 'David Kim', email: 'david.kim@example.com' },
  { name: 'Eva Johnson', email: 'eva.j@example.com' },
  { name: 'Frank Li', email: 'frank.li@example.com' },
  { name: 'Grace Patel', email: 'grace.p@example.com' },
]

const MOCK_MESSAGES = [
  'feat: add user authentication flow',
  'fix: resolve null pointer in data parser',
  'refactor: extract common utilities into shared module',
  'chore: update dependencies to latest versions',
  'docs: add API documentation for endpoints',
  'style: format code with prettier config',
  'perf: optimize database query for user lookup',
  'feat: implement real-time notification system',
  'fix: handle edge case in date formatting',
  'refactor: simplify state management logic',
  'feat: add dark mode toggle support',
  'fix: correct off-by-one error in pagination',
  'chore: configure CI/CD pipeline stages',
  'feat: implement file drag-and-drop upload',
  'fix: prevent memory leak in event listeners',
  'refactor: migrate to functional components',
  'feat: add keyboard shortcuts for navigation',
  'fix: resolve race condition in async handler',
  'perf: lazy load heavy components',
  'feat: implement search with fuzzy matching',
]

const MOCK_CODE_LINES = [
  "import React, { useState, useCallback, useMemo } from 'react'",
  "import { createPortal } from 'react-dom'",
  "import { useStore } from '@/store'",
  '',
  '// Types for the component props',
  'interface ComponentProps {',
  '  title: string',
  '  description?: string',
  '  onSubmit: (data: FormData) => void',
  '  isLoading?: boolean',
  '  variant?: "primary" | "secondary" | "ghost"',
  '}',
  '',
  '// Utility function to format dates',
  'function formatRelativeDate(date: Date): string {',
  '  const now = new Date()',
  '  const diff = now.getTime() - date.getTime()',
  '  const days = Math.floor(diff / (1000 * 60 * 60 * 24))',
  '  if (days === 0) return "today"',
  '  if (days === 1) return "yesterday"',
  '  if (days < 7) return `${days} days ago`',
  '  if (days < 30) return `${Math.floor(days / 7)} weeks ago`',
  '  if (days < 365) return `${Math.floor(days / 30)} months ago`',
  '  return `${Math.floor(days / 365)} years ago`',
  '}',
  '',
  '// Custom hook for form validation',
  'function useFormValidation<T extends Record<string, unknown>>(initialValues: T) {',
  '  const [values, setValues] = useState<T>(initialValues)',
  '  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({})',
  '  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({})',
  '',
  '  const validate = useCallback((fieldName: keyof T, value: unknown) => {',
  '    if (!value && typeof value !== "boolean") {',
  '      return `${String(fieldName)} is required`',
  '    }',
  '    return undefined',
  '  }, [])',
  '',
  '  const handleChange = useCallback((field: keyof T, value: unknown) => {',
  '    setValues(prev => ({ ...prev, [field]: value }))',
  '    const error = validate(field, value)',
  '    setErrors(prev => ({ ...prev, [field]: error }))',
  '  }, [validate])',
  '',
  '  const handleBlur = useCallback((field: keyof T) => {',
  '    setTouched(prev => ({ ...prev, [field]: true }))',
  '  }, [])',
  '',
  '  return { values, errors, touched, handleChange, handleBlur }',
  '}',
  '',
  'export default function DataViewer({ title, description, onSubmit, isLoading, variant = "primary" }: ComponentProps) {',
  '  const [isExpanded, setIsExpanded] = useState(false)',
  '  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)',
  '  const [searchQuery, setSearchQuery] = useState("")',
  '  const containerRef = useRef<HTMLDivElement>(null)',
  '',
  '  const filteredItems = useMemo(() => {',
  '    if (!searchQuery.trim()) return items',
  '    const query = searchQuery.toLowerCase()',
  '    return items.filter(item =>',
  '      item.name.toLowerCase().includes(query) ||',
  '      item.description?.toLowerCase().includes(query)',
  '    )',
  '  }, [searchQuery, items])',
  '',
  '  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {',
  '    switch (e.key) {',
  '      case "ArrowDown":',
  '        e.preventDefault()',
  '        setSelectedIndex(prev =>',
  '          prev === null ? 0 : Math.min(prev + 1, filteredItems.length - 1)',
  '        )',
  '        break',
  '      case "ArrowUp":',
  '        e.preventDefault()',
  '        setSelectedIndex(prev =>',
  '          prev === null ? filteredItems.length - 1 : Math.max(prev - 1, 0)',
  '        )',
  '        break',
  '      case "Enter":',
  '        if (selectedIndex !== null) {',
  '          handleItemSelect(filteredItems[selectedIndex])',
  '        }',
  '        break',
  '      case "Escape":',
  '        setIsExpanded(false)',
  '        setSearchQuery("")',
  '        break',
  '    }',
  '  }, [selectedIndex, filteredItems])',
  '',
  '  useEffect(() => {',
  '    const el = containerRef.current',
  '    if (!el) return',
  '    const observer = new ResizeObserver(entries => {',
  '      for (const entry of entries) {',
  '        console.log("Resized:", entry.contentRect)',
  '      }',
  '    })',
  '    observer.observe(el)',
  '    return () => observer.disconnect()',
  '  }, [])',
  '',
  '  const renderItem = useCallback((item: ItemType, index: number) => {',
  '    const isSelected = index === selectedIndex',
  '    return (',
  '      <div',
  '        key={item.id}',
  '        className={`item ${isSelected ? "selected" : ""}`}',
  '        onClick={() => handleItemSelect(item)}',
  '        role="option"',
  '        aria-selected={isSelected}',
  '      >',
  '        <span className="item-name">{item.name}</span>',
  '        {item.badge && <span className="badge">{item.badge}</span>}',
  '      </div>',
  '    )',
  '  }, [selectedIndex])',
  '',
  '  if (isLoading) {',
  '    return (',
  '      <div className="loading-container">',
  '        <div className="spinner" />',
  '        <span>Loading data...</span>',
  '      </div>',
  '    )',
  '  }',
  '',
  '  return (',
  '    <div ref={containerRef} className="data-viewer">',
  '      <header className="viewer-header">',
  '        <h2>{title}</h2>',
  '        {description && <p>{description}</p>}',
  '      </header>',
  '      <div className="viewer-content">',
  '        {filteredItems.map(renderItem)}',
  '      </div>',
  '      <footer className="viewer-footer">',
  '        <span>{filteredItems.length} items</span>',
  '        <button onClick={() => onSubmit(new FormData())}>Submit</button>',
  '      </footer>',
  '    </div>',
  '  )',
  '}',
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash)
}

function getAuthorColor(name: string): string {
  return AUTHOR_COLORS[hashString(name) % AUTHOR_COLORS.length]
}

function getAuthorInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

function generateSha(): string {
  const chars = '0123456789abcdef'
  let sha = ''
  for (let i = 0; i < 40; i++) {
    sha += chars[Math.floor(Math.random() * chars.length)]
  }
  return sha
}

function formatRelativeDate(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)

  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (weeks < 5) return `${weeks}w ago`
  if (months < 12) return `${months}mo ago`
  return `${years}y ago`
}

function formatFullDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getAgeColor(date: Date, oldestDate: Date, newestDate: Date): string {
  const range = newestDate.getTime() - oldestDate.getTime()
  if (range === 0) return WARM_TO_COOL_GRADIENT[WARM_TO_COOL_GRADIENT.length - 1]
  const age = (date.getTime() - oldestDate.getTime()) / range
  const index = Math.floor((1 - age) * (WARM_TO_COOL_GRADIENT.length - 1))
  return WARM_TO_COOL_GRADIENT[Math.min(index, WARM_TO_COOL_GRADIENT.length - 1)]
}

function getAgeOpacity(date: Date, oldestDate: Date, newestDate: Date): number {
  const range = newestDate.getTime() - oldestDate.getTime()
  if (range === 0) return 1
  const age = (date.getTime() - oldestDate.getTime()) / range
  return 0.3 + age * 0.7
}

// ─── Mock Data Generator ────────────────────────────────────────────────────

function generateMockBlame(lineCount: number): BlameInfo[] {
  const commits: BlameCommit[] = []
  const numCommits = Math.min(15, Math.max(5, Math.floor(lineCount / 5)))

  for (let i = 0; i < numCommits; i++) {
    const author = MOCK_AUTHORS[i % MOCK_AUTHORS.length]
    const daysAgo = Math.floor(Math.random() * 730) + 1
    const sha = generateSha()
    const message = MOCK_MESSAGES[i % MOCK_MESSAGES.length]

    commits.push({
      sha,
      shortSha: sha.slice(0, 7),
      author: author.name,
      authorEmail: author.email,
      date: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      message,
      summary: message,
      parentSha: i > 0 ? commits[i - 1].sha : null,
      filesChanged: Math.floor(Math.random() * 12) + 1,
      insertions: Math.floor(Math.random() * 150) + 5,
      deletions: Math.floor(Math.random() * 80) + 1,
    })
  }

  const blameLines: BlameInfo[] = []
  let currentLine = 0

  while (currentLine < lineCount) {
    const commit = commits[Math.floor(Math.random() * commits.length)]
    const groupSize = Math.min(
      Math.floor(Math.random() * 8) + 1,
      lineCount - currentLine
    )

    for (let j = 0; j < groupSize; j++) {
      const lineIdx = currentLine + j
      blameLines.push({
        lineNumber: lineIdx + 1,
        commit,
        originalLine: lineIdx + 1,
        content: lineIdx < MOCK_CODE_LINES.length ? MOCK_CODE_LINES[lineIdx] : '',
        isFirstLineOfGroup: j === 0,
        groupSize: j === 0 ? groupSize : 0,
      })
    }
    currentLine += groupSize
  }

  return blameLines
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

interface AvatarProps {
  name: string
  size?: number
}

function AuthorAvatar({ name, size = 22 }: AvatarProps) {
  const color = getAuthorColor(name)
  const initials = getAuthorInitials(name)
  return (
    <div
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: '50%',
        background: `linear-gradient(135deg, ${color}, ${color}88)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 700,
        color: '#fff',
        letterSpacing: '-0.02em',
        textShadow: '0 1px 2px rgba(0,0,0,0.3)',
        boxShadow: `0 0 0 1px ${color}44`,
      }}
      title={name}
    >
      {initials}
    </div>
  )
}

interface AgeBarProps {
  date: Date
  oldestDate: Date
  newestDate: Date
}

function AgeBar({ date, oldestDate, newestDate }: AgeBarProps) {
  const color = getAgeColor(date, oldestDate, newestDate)
  const opacity = getAgeOpacity(date, oldestDate, newestDate)
  return (
    <div
      style={{
        width: 3,
        height: '100%',
        minHeight: 20,
        borderRadius: 1.5,
        backgroundColor: color,
        opacity,
        transition: 'opacity 0.2s ease',
      }}
      title={`Changed ${formatRelativeDate(date)}`}
    />
  )
}

interface CommitPopupProps {
  commit: BlameCommit
  position: { x: number; y: number }
  onClose: () => void
  onNavigateToCommit: (sha: string) => void
  onCopySha: (sha: string) => void
}

function CommitDetailsPopup({
  commit,
  position,
  onClose,
  onNavigateToCommit,
  onCopySha,
}: CommitPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null)
  const [adjustedPosition, setAdjustedPosition] = useState(position)

  useEffect(() => {
    if (popupRef.current) {
      const rect = popupRef.current.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      let { x, y } = position

      if (x + rect.width > vw - 16) x = vw - rect.width - 16
      if (y + rect.height > vh - 16) y = y - rect.height - 8
      if (x < 16) x = 16
      if (y < 16) y = 16

      setAdjustedPosition({ x, y })
    }
  }, [position])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const authorColor = getAuthorColor(commit.author)

  return (
    <div
      ref={popupRef}
      style={{
        position: 'fixed',
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        zIndex: 10000,
        width: 380,
        backgroundColor: '#1e1e1e',
        border: '1px solid #3c3c3c',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
        overflow: 'hidden',
        animation: 'blamePopupFadeIn 0.15s ease-out',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid #2d2d2d',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          backgroundColor: '#252526',
        }}
      >
        <AuthorAvatar name={commit.author} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ color: authorColor, fontWeight: 600, fontSize: 13 }}>
              {commit.author}
            </span>
          </div>
          <div style={{ color: '#8b949e', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={10} />
            {formatFullDate(commit.date)}
            <span style={{ color: '#6e7681' }}>({formatRelativeDate(commit.date)})</span>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#6e7681',
            cursor: 'pointer',
            padding: 2,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#d4d4d4')}
          onMouseLeave={e => (e.currentTarget.style.color = '#6e7681')}
        >
          <X size={14} />
        </button>
      </div>

      {/* Commit message */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #2d2d2d' }}>
        <div style={{ color: '#e6e6e6', fontSize: 13, lineHeight: 1.5, fontWeight: 500 }}>
          {commit.message}
        </div>
      </div>

      {/* SHA and stats */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #2d2d2d' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Hash size={12} style={{ color: '#6e7681' }} />
          <code
            style={{
              color: '#79c0ff',
              fontSize: 12,
              fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
              backgroundColor: '#1a1a2e',
              padding: '2px 6px',
              borderRadius: 4,
              letterSpacing: '0.03em',
            }}
          >
            {commit.sha}
          </code>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
          <span style={{ color: '#8b949e' }}>
            <FileText size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            {commit.filesChanged} files
          </span>
          <span style={{ color: '#3fb950' }}>+{commit.insertions}</span>
          <span style={{ color: '#f85149' }}>-{commit.deletions}</span>
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '8px 10px', display: 'flex', gap: 4 }}>
        <PopupAction
          icon={<Copy size={12} />}
          label="Copy SHA"
          onClick={() => onCopySha(commit.sha)}
        />
        <PopupAction
          icon={<GitCommit size={12} />}
          label="View Commit"
          onClick={() => onNavigateToCommit(commit.sha)}
        />
        <PopupAction
          icon={<ExternalLink size={12} />}
          label="Open in Browser"
          onClick={() => {}}
        />
      </div>
    </div>
  )
}

interface PopupActionProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
}

function PopupAction({ icon, label, onClick }: PopupActionProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 10px',
        borderRadius: 4,
        border: 'none',
        backgroundColor: hovered ? '#2d2d2d' : 'transparent',
        color: hovered ? '#e6e6e6' : '#8b949e',
        fontSize: 11,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        fontFamily: 'inherit',
      }}
    >
      {icon}
      {label}
    </button>
  )
}

interface ContextMenuProps {
  position: { x: number; y: number }
  commit: BlameCommit
  onClose: () => void
  onCopySha: (sha: string) => void
  onCopyMessage: (message: string) => void
  onViewCommit: (sha: string) => void
  onBlameParent: (sha: string) => void
}

function ContextMenu({
  position,
  commit,
  onClose,
  onCopySha,
  onCopyMessage,
  onViewCommit,
  onBlameParent,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = () => onClose()
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const items = [
    { icon: <Copy size={13} />, label: `Copy Commit Hash (${commit.shortSha})`, action: () => onCopySha(commit.sha) },
    { icon: <FileText size={13} />, label: 'Copy Commit Message', action: () => onCopyMessage(commit.message) },
    { divider: true },
    { icon: <GitCommit size={13} />, label: 'View Commit Details', action: () => onViewCommit(commit.sha) },
    { icon: <ArrowLeft size={13} />, label: 'Blame Previous Revision', action: () => onBlameParent(commit.parentSha || commit.sha) },
    { divider: true },
    { icon: <ExternalLink size={13} />, label: 'Open Commit in Browser', action: () => {} },
    { icon: <User size={13} />, label: `Show All Changes by ${commit.author}`, action: () => {} },
  ]

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 10001,
        minWidth: 260,
        backgroundColor: '#252526',
        border: '1px solid #3c3c3c',
        borderRadius: 6,
        boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
        padding: '4px 0',
        animation: 'blamePopupFadeIn 0.1s ease-out',
      }}
    >
      {items.map((item, i) => {
        if ('divider' in item && item.divider) {
          return (
            <div
              key={`d-${i}`}
              style={{ height: 1, backgroundColor: '#3c3c3c', margin: '4px 8px' }}
            />
          )
        }
        return <ContextMenuItem key={i} icon={item.icon!} label={item.label!} onClick={item.action!} />
      })}
    </div>
  )
}

interface ContextMenuItemProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
}

function ContextMenuItem({ icon, label, onClick }: ContextMenuItemProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={e => {
        e.stopPropagation()
        onClick()
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        cursor: 'pointer',
        backgroundColor: hovered ? '#094771' : 'transparent',
        color: hovered ? '#ffffff' : '#cccccc',
        fontSize: 12,
        transition: 'background-color 0.08s ease',
      }}
    >
      <span style={{ display: 'flex', opacity: 0.8 }}>{icon}</span>
      <span>{label}</span>
    </div>
  )
}

interface AuthorFilterPanelProps {
  authors: AuthorStats[]
  selectedAuthors: Set<string>
  onToggleAuthor: (name: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
}

function AuthorFilterPanel({
  authors,
  selectedAuthors,
  onToggleAuthor,
  onSelectAll,
  onDeselectAll,
}: AuthorFilterPanelProps) {
  const sorted = useMemo(
    () => [...authors].sort((a, b) => b.lineCount - a.lineCount),
    [authors]
  )
  const totalLines = useMemo(
    () => authors.reduce((sum, a) => sum + a.lineCount, 0),
    [authors]
  )

  return (
    <div
      style={{
        padding: '8px 0',
        borderBottom: '1px solid #2d2d2d',
        maxHeight: 220,
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 12px 6px', alignItems: 'center' }}>
        <span style={{ color: '#8b949e', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Authors
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onSelectAll}
            style={{ background: 'none', border: 'none', color: '#79c0ff', fontSize: 11, cursor: 'pointer', padding: 0 }}
          >
            All
          </button>
          <button
            onClick={onDeselectAll}
            style={{ background: 'none', border: 'none', color: '#79c0ff', fontSize: 11, cursor: 'pointer', padding: 0 }}
          >
            None
          </button>
        </div>
      </div>
      {sorted.map(author => {
        const isSelected = selectedAuthors.has(author.name)
        const pct = ((author.lineCount / totalLines) * 100).toFixed(1)
        return (
          <div
            key={author.name}
            onClick={() => onToggleAuthor(author.name)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 12px',
              cursor: 'pointer',
              opacity: isSelected ? 1 : 0.4,
              transition: 'opacity 0.15s ease',
            }}
          >
            <AuthorAvatar name={author.name} size={18} />
            <span style={{ color: '#cccccc', fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {author.name}
            </span>
            <span style={{ color: '#6e7681', fontSize: 11, whiteSpace: 'nowrap' }}>
              {author.lineCount}L ({pct}%)
            </span>
            <div
              style={{
                width: 50,
                height: 4,
                backgroundColor: '#21262d',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  backgroundColor: author.color,
                  borderRadius: 2,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function GitBlamePanel() {
  const [blameEnabled, setBlameEnabled] = useState(true)
  const [blameData, setBlameData] = useState<BlameInfo[]>([])
  const [hoveredLine, setHoveredLine] = useState<number | null>(null)
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null)
  const [popup, setPopup] = useState<{ commit: BlameCommit; position: { x: number; y: number } } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ commit: BlameCommit; position: { x: number; y: number } } | null>(null)
  const [showAuthorFilter, setShowAuthorFilter] = useState(false)
  const [selectedAuthors, setSelectedAuthors] = useState<Set<string>>(new Set())
  const [blameHistory, setBlameHistory] = useState<BlameHistoryEntry[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [compactMode, setCompactMode] = useState(false)
  const [showAgeIndicator, setShowAgeIndicator] = useState(true)
  const [copiedSha, setCopiedSha] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState('')
  const [isFullWidth, setIsFullWidth] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const fileName = 'src/components/DataViewer.tsx'

  // Initialize blame data
  useEffect(() => {
    const data = generateMockBlame(MOCK_CODE_LINES.length)
    setBlameData(data)

    const allAuthors = new Set(data.map(b => b.commit.author))
    setSelectedAuthors(allAuthors)

    setBlameHistory([{ sha: 'HEAD', fileName, label: 'Current (HEAD)' }])
    setHistoryIndex(0)
  }, [])

  // Derived data
  const { oldestDate, newestDate } = useMemo(() => {
    if (blameData.length === 0) return { oldestDate: new Date(), newestDate: new Date() }
    const dates = blameData.map(b => b.commit.date.getTime())
    return {
      oldestDate: new Date(Math.min(...dates)),
      newestDate: new Date(Math.max(...dates)),
    }
  }, [blameData])

  const authorStats = useMemo((): AuthorStats[] => {
    const map = new Map<string, AuthorStats>()
    const commitSet = new Map<string, Set<string>>()

    for (const blame of blameData) {
      const { author, authorEmail, date, sha } = blame.commit
      if (!map.has(author)) {
        map.set(author, {
          name: author,
          email: authorEmail,
          lineCount: 0,
          commitCount: 0,
          color: getAuthorColor(author),
          firstCommitDate: date,
          lastCommitDate: date,
        })
        commitSet.set(author, new Set())
      }
      const stats = map.get(author)!
      stats.lineCount++
      commitSet.get(author)!.add(sha)
      if (date < stats.firstCommitDate) stats.firstCommitDate = date
      if (date > stats.lastCommitDate) stats.lastCommitDate = date
    }

    for (const [name, commits] of commitSet) {
      map.get(name)!.commitCount = commits.size
    }

    return Array.from(map.values())
  }, [blameData])

  const uniqueCommits = useMemo(() => {
    const map = new Map<string, BlameCommit>()
    for (const blame of blameData) {
      if (!map.has(blame.commit.sha)) {
        map.set(blame.commit.sha, blame.commit)
      }
    }
    return Array.from(map.values()).sort((a, b) => b.date.getTime() - a.date.getTime())
  }, [blameData])

  const filteredBlameData = useMemo(() => {
    let filtered = blameData
    if (selectedAuthors.size < authorStats.length) {
      filtered = filtered.map(b =>
        selectedAuthors.has(b.commit.author) ? b : { ...b, dimmed: true } as BlameInfo & { dimmed?: boolean }
      )
    }
    return filtered
  }, [blameData, selectedAuthors, authorStats.length])

  // Handlers
  const handleCopySha = useCallback((sha: string) => {
    navigator.clipboard?.writeText(sha).catch(() => {})
    setCopiedSha(sha)
    setTimeout(() => setCopiedSha(null), 2000)
    setContextMenu(null)
  }, [])

  const handleCopyMessage = useCallback((message: string) => {
    navigator.clipboard?.writeText(message).catch(() => {})
    setContextMenu(null)
  }, [])

  const handleNavigateToCommit = useCallback((sha: string) => {
    setSelectedCommitSha(sha)
    setPopup(null)
  }, [])

  const handleBlameParent = useCallback(
    (parentSha: string) => {
      const newData = generateMockBlame(MOCK_CODE_LINES.length)
      setBlameData(newData)

      const newEntry: BlameHistoryEntry = {
        sha: parentSha,
        fileName,
        label: `${parentSha.slice(0, 7)}`,
      }
      const newHistory = [...blameHistory.slice(0, historyIndex + 1), newEntry]
      setBlameHistory(newHistory)
      setHistoryIndex(newHistory.length - 1)

      const allAuthors = new Set(newData.map(b => b.commit.author))
      setSelectedAuthors(allAuthors)
      setContextMenu(null)
      setPopup(null)
    },
    [blameHistory, historyIndex]
  )

  const handleHistoryBack = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1)
      const newData = generateMockBlame(MOCK_CODE_LINES.length)
      setBlameData(newData)
      const allAuthors = new Set(newData.map(b => b.commit.author))
      setSelectedAuthors(allAuthors)
    }
  }, [historyIndex])

  const handleHistoryForward = useCallback(() => {
    if (historyIndex < blameHistory.length - 1) {
      setHistoryIndex(historyIndex + 1)
      const newData = generateMockBlame(MOCK_CODE_LINES.length)
      setBlameData(newData)
      const allAuthors = new Set(newData.map(b => b.commit.author))
      setSelectedAuthors(allAuthors)
    }
  }, [historyIndex, blameHistory.length])

  const handleToggleAuthor = useCallback((name: string) => {
    setSelectedAuthors(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const handleSelectAllAuthors = useCallback(() => {
    setSelectedAuthors(new Set(authorStats.map(a => a.name)))
  }, [authorStats])

  const handleDeselectAllAuthors = useCallback(() => {
    setSelectedAuthors(new Set())
  }, [])

  const handleLineContextMenu = useCallback(
    (e: React.MouseEvent, commit: BlameCommit) => {
      e.preventDefault()
      setContextMenu({ commit, position: { x: e.clientX, y: e.clientY } })
      setPopup(null)
    },
    []
  )

  const handleBlameAnnotationClick = useCallback(
    (e: React.MouseEvent, commit: BlameCommit) => {
      setPopup({ commit, position: { x: e.clientX + 8, y: e.clientY + 8 } })
      setContextMenu(null)
    },
    []
  )

  // Render
  const LINE_HEIGHT = compactMode ? 20 : 24
  const GUTTER_WIDTH = compactMode ? 260 : 320

  const matchesSearch = useCallback(
    (blame: BlameInfo) => {
      if (!searchFilter.trim()) return true
      const q = searchFilter.toLowerCase()
      return (
        blame.commit.author.toLowerCase().includes(q) ||
        blame.commit.message.toLowerCase().includes(q) ||
        blame.commit.shortSha.includes(q) ||
        blame.content.toLowerCase().includes(q)
      )
    },
    [searchFilter]
  )

  if (!blameEnabled) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          backgroundColor: '#1e1e1e',
          color: '#cccccc',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #2d2d2d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GitCommit size={16} style={{ color: '#79c0ff' }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Git Blame</span>
            <span style={{ color: '#6e7681', fontSize: 12 }}>{fileName}</span>
          </div>
          <button
            onClick={() => setBlameEnabled(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 12px',
              borderRadius: 4,
              border: '1px solid #3c3c3c',
              backgroundColor: '#2d2d2d',
              color: '#cccccc',
              fontSize: 12,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = '#3c3c3c'
              e.currentTarget.style.borderColor = '#505050'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.backgroundColor = '#2d2d2d'
              e.currentTarget.style.borderColor = '#3c3c3c'
            }}
          >
            <Eye size={13} />
            Enable Blame
          </button>
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 12,
            color: '#6e7681',
          }}
        >
          <EyeOff size={40} style={{ opacity: 0.4 }} />
          <span style={{ fontSize: 14 }}>Blame annotations are hidden</span>
          <span style={{ fontSize: 12, opacity: 0.6 }}>Click "Enable Blame" to show inline annotations</span>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#1e1e1e',
        color: '#cccccc',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: 13,
        position: 'relative',
      }}
    >
      {/* Injected keyframes */}
      <style>{`
        @keyframes blamePopupFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes blameCopiedFlash {
          0% { background-color: #3fb95033; }
          100% { background-color: transparent; }
        }
        .blame-line:hover .blame-gutter-cell {
          background-color: #2a2d2e !important;
        }
        .blame-gutter-cell:hover {
          filter: brightness(1.2);
        }
        .blame-scrollbar::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .blame-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .blame-scrollbar::-webkit-scrollbar-thumb {
          background: #424242;
          border-radius: 5px;
        }
        .blame-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #555555;
        }
      `}</style>

      {/* ── Toolbar ────────────────────────────────────────────── */}
      <div
        style={{
          padding: '6px 12px',
          borderBottom: '1px solid #2d2d2d',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          backgroundColor: '#252526',
          flexShrink: 0,
        }}
      >
        {/* Left section */}
        <GitCommit size={15} style={{ color: '#79c0ff', flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>Git Blame</span>
        <span
          style={{
            color: '#6e7681',
            fontSize: 11,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 200,
          }}
          title={fileName}
        >
          {fileName}
        </span>

        {/* History navigation */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            marginLeft: 4,
            padding: '2px 4px',
            borderRadius: 4,
            backgroundColor: '#1e1e1e',
          }}
        >
          <button
            onClick={handleHistoryBack}
            disabled={historyIndex <= 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: 3,
              border: 'none',
              borderRadius: 3,
              backgroundColor: 'transparent',
              color: historyIndex <= 0 ? '#3c3c3c' : '#8b949e',
              cursor: historyIndex <= 0 ? 'default' : 'pointer',
            }}
            title="Previous revision"
          >
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: 10, color: '#6e7681', padding: '0 4px', whiteSpace: 'nowrap' }}>
            {blameHistory[historyIndex]?.label || 'HEAD'}
          </span>
          <button
            onClick={handleHistoryForward}
            disabled={historyIndex >= blameHistory.length - 1}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: 3,
              border: 'none',
              borderRadius: 3,
              backgroundColor: 'transparent',
              color: historyIndex >= blameHistory.length - 1 ? '#3c3c3c' : '#8b949e',
              cursor: historyIndex >= blameHistory.length - 1 ? 'default' : 'pointer',
            }}
            title="Next revision"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Search */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            backgroundColor: '#1e1e1e',
            border: '1px solid #3c3c3c',
            borderRadius: 4,
            padding: '2px 8px',
            maxWidth: 180,
          }}
        >
          <Search size={12} style={{ color: '#6e7681', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Filter..."
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            style={{
              border: 'none',
              background: 'none',
              color: '#cccccc',
              fontSize: 11,
              outline: 'none',
              width: '100%',
              padding: '2px 0',
              fontFamily: 'inherit',
            }}
          />
          {searchFilter && (
            <button
              onClick={() => setSearchFilter('')}
              style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', display: 'flex', padding: 0 }}
            >
              <X size={11} />
            </button>
          )}
        </div>

        {/* Toggle buttons */}
        <ToolbarButton
          icon={<Filter size={13} />}
          label="Authors"
          active={showAuthorFilter}
          onClick={() => setShowAuthorFilter(!showAuthorFilter)}
        />
        <ToolbarButton
          icon={<Calendar size={13} />}
          label="Age"
          active={showAgeIndicator}
          onClick={() => setShowAgeIndicator(!showAgeIndicator)}
        />
        <ToolbarButton
          icon={compactMode ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
          label={compactMode ? 'Expand' : 'Compact'}
          active={false}
          onClick={() => setCompactMode(!compactMode)}
        />
        <ToolbarButton
          icon={isFullWidth ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          label={isFullWidth ? 'Fit' : 'Full'}
          active={isFullWidth}
          onClick={() => setIsFullWidth(!isFullWidth)}
        />

        <div style={{ width: 1, height: 18, backgroundColor: '#3c3c3c' }} />

        <ToolbarButton
          icon={<EyeOff size={13} />}
          label="Hide"
          active={false}
          onClick={() => setBlameEnabled(false)}
        />
      </div>

      {/* ── Author Filter Panel ─────────────────────────────── */}
      {showAuthorFilter && (
        <AuthorFilterPanel
          authors={authorStats}
          selectedAuthors={selectedAuthors}
          onToggleAuthor={handleToggleAuthor}
          onSelectAll={handleSelectAllAuthors}
          onDeselectAll={handleDeselectAllAuthors}
        />
      )}

      {/* ── Commit summary strip ────────────────────────────── */}
      {selectedCommitSha && (
        <div
          style={{
            padding: '8px 14px',
            borderBottom: '1px solid #2d2d2d',
            backgroundColor: '#1a2332',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}
        >
          <Info size={14} style={{ color: '#388bfd', flexShrink: 0 }} />
          {(() => {
            const c = uniqueCommits.find(c => c.sha === selectedCommitSha)
            if (!c) return <span style={{ color: '#6e7681', fontSize: 12 }}>Commit not found</span>
            const authorColor = getAuthorColor(c.author)
            return (
              <>
                <AuthorAvatar name={c.author} size={20} />
                <span style={{ color: authorColor, fontSize: 12, fontWeight: 600 }}>{c.author}</span>
                <code style={{ color: '#79c0ff', fontSize: 11, fontFamily: 'monospace' }}>{c.shortSha}</code>
                <span
                  style={{
                    color: '#cccccc',
                    fontSize: 12,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.message}
                </span>
                <span style={{ color: '#6e7681', fontSize: 11, whiteSpace: 'nowrap' }}>
                  {formatRelativeDate(c.date)}
                </span>
              </>
            )
          })()}
          <button
            onClick={() => setSelectedCommitSha(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#6e7681',
              cursor: 'pointer',
              display: 'flex',
              padding: 2,
              borderRadius: 3,
              flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#cccccc')}
            onMouseLeave={e => (e.currentTarget.style.color = '#6e7681')}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* ── Main blame view ─────────────────────────────────── */}
      <div
        ref={scrollContainerRef}
        className="blame-scrollbar"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          position: 'relative',
        }}
      >
        <div style={{ minWidth: isFullWidth ? undefined : GUTTER_WIDTH + 600 }}>
          {filteredBlameData.map((blame, index) => {
            const isHovered = hoveredLine === blame.lineNumber
            const isSelected = selectedCommitSha === blame.commit.sha
            const isDimmed = (blame as BlameInfo & { dimmed?: boolean }).dimmed
            const matches = matchesSearch(blame)
            const authorColor = getAuthorColor(blame.commit.author)

            return (
              <div
                key={blame.lineNumber}
                className="blame-line"
                onMouseEnter={() => setHoveredLine(blame.lineNumber)}
                onMouseLeave={() => setHoveredLine(null)}
                onContextMenu={e => handleLineContextMenu(e, blame.commit)}
                style={{
                  display: 'flex',
                  height: LINE_HEIGHT,
                  lineHeight: `${LINE_HEIGHT}px`,
                  borderBottom: '1px solid #1a1a1a',
                  opacity: isDimmed ? 0.25 : matches ? 1 : 0.2,
                  backgroundColor: isSelected
                    ? '#1a2332'
                    : isHovered
                    ? '#2a2d2e'
                    : copiedSha === blame.commit.sha
                    ? '#3fb95015'
                    : 'transparent',
                  transition: 'background-color 0.1s ease, opacity 0.2s ease',
                }}
              >
                {/* Age indicator bar */}
                {showAgeIndicator && (
                  <div
                    style={{
                      width: 4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <AgeBar date={blame.commit.date} oldestDate={oldestDate} newestDate={newestDate} />
                  </div>
                )}

                {/* Blame gutter */}
                <div
                  className="blame-gutter-cell"
                  onClick={e => blame.isFirstLineOfGroup && handleBlameAnnotationClick(e, blame.commit)}
                  style={{
                    width: GUTTER_WIDTH,
                    minWidth: GUTTER_WIDTH,
                    padding: '0 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: blame.isFirstLineOfGroup ? 'pointer' : 'default',
                    borderRight: '1px solid #2d2d2d',
                    overflow: 'hidden',
                    flexShrink: 0,
                    backgroundColor: isSelected ? '#1a233244' : 'transparent',
                    transition: 'background-color 0.1s ease',
                  }}
                >
                  {blame.isFirstLineOfGroup ? (
                    <>
                      {/* Author avatar */}
                      <AuthorAvatar name={blame.commit.author} size={compactMode ? 16 : 20} />

                      {/* Author name */}
                      <span
                        style={{
                          color: authorColor,
                          fontSize: compactMode ? 10 : 11,
                          fontWeight: 600,
                          width: compactMode ? 60 : 80,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                      >
                        {blame.commit.author.split(' ')[0]}
                      </span>

                      {/* Date */}
                      <span
                        style={{
                          color: '#6e7681',
                          fontSize: compactMode ? 9 : 10,
                          width: compactMode ? 45 : 55,
                          textAlign: 'right',
                          flexShrink: 0,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatRelativeDate(blame.commit.date)}
                      </span>

                      {/* Commit message (truncated) */}
                      <span
                        style={{
                          color: '#8b949e',
                          fontSize: compactMode ? 10 : 11,
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={blame.commit.message}
                      >
                        {blame.commit.message}
                      </span>
                    </>
                  ) : (
                    /* Continuation line - show thin connector */
                    <div
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <div
                        style={{
                          width: compactMode ? 16 : 20,
                          display: 'flex',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <div
                          style={{
                            width: 1,
                            height: '100%',
                            minHeight: LINE_HEIGHT,
                            backgroundColor: `${authorColor}30`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Line number */}
                <div
                  style={{
                    width: 48,
                    minWidth: 48,
                    textAlign: 'right',
                    padding: '0 12px 0 8px',
                    color: isHovered ? '#c9d1d9' : '#6e7681',
                    fontSize: compactMode ? 10 : 11,
                    fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace',
                    userSelect: 'none',
                    flexShrink: 0,
                    transition: 'color 0.1s ease',
                  }}
                >
                  {blame.lineNumber}
                </div>

                {/* Code content */}
                <div
                  style={{
                    flex: 1,
                    padding: '0 16px 0 0',
                    fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace',
                    fontSize: compactMode ? 11 : 12,
                    whiteSpace: 'pre',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    color: '#d4d4d4',
                    letterSpacing: '0.01em',
                  }}
                >
                  {syntaxHighlight(blame.content)}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Status bar ──────────────────────────────────────── */}
      <div
        style={{
          padding: '4px 12px',
          borderTop: '1px solid #2d2d2d',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          fontSize: 11,
          color: '#6e7681',
          backgroundColor: '#252526',
          flexShrink: 0,
        }}
      >
        <span>{blameData.length} lines</span>
        <span style={{ color: '#3c3c3c' }}>|</span>
        <span>{uniqueCommits.length} commits</span>
        <span style={{ color: '#3c3c3c' }}>|</span>
        <span>{authorStats.length} authors</span>
        <div style={{ flex: 1 }} />
        {copiedSha && (
          <span style={{ color: '#3fb950', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Copy size={10} /> Copied!
          </span>
        )}
        <span>
          {formatRelativeDate(oldestDate)} - {formatRelativeDate(newestDate)}
        </span>
      </div>

      {/* ── Popups / Context Menus ──────────────────────────── */}
      {popup && (
        <CommitDetailsPopup
          commit={popup.commit}
          position={popup.position}
          onClose={() => setPopup(null)}
          onNavigateToCommit={handleNavigateToCommit}
          onCopySha={handleCopySha}
        />
      )}

      {contextMenu && (
        <ContextMenu
          position={contextMenu.position}
          commit={contextMenu.commit}
          onClose={() => setContextMenu(null)}
          onCopySha={handleCopySha}
          onCopyMessage={handleCopyMessage}
          onViewCommit={handleNavigateToCommit}
          onBlameParent={handleBlameParent}
        />
      )}
    </div>
  )
}

// ─── Toolbar Button ─────────────────────────────────────────────────────────

interface ToolbarButtonProps {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}

function ToolbarButton({ icon, label, active, onClick }: ToolbarButtonProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 4,
        border: active ? '1px solid #388bfd55' : '1px solid transparent',
        backgroundColor: active ? '#388bfd22' : hovered ? '#2d2d2d' : 'transparent',
        color: active ? '#79c0ff' : hovered ? '#cccccc' : '#8b949e',
        fontSize: 11,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {label}
    </button>
  )
}

// ─── Minimal Syntax Highlighting ────────────────────────────────────────────

function syntaxHighlight(code: string): React.ReactNode {
  if (!code.trim()) return code

  const tokens: { text: string; color: string }[] = []
  let remaining = code

  const patterns: [RegExp, string][] = [
    [/^(\/\/.*)/, '#6a9955'],                              // Comments
    [/^('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/, '#ce9178'], // Strings
    [/^(\b(?:import|export|from|default|function|return|const|let|var|if|else|switch|case|break|for|while|do|new|typeof|instanceof|in|of|class|extends|implements|interface|type|enum|async|await|try|catch|finally|throw|void|null|undefined|true|false|this|super)\b)/, '#c586c0'], // Keywords
    [/^(\b(?:React|useState|useCallback|useMemo|useRef|useEffect|HTMLDivElement|Record|Partial|Set|Map|Date|FormData|ResizeObserver)\b)/, '#4ec9b0'], // Types
    [/^(\b\d+(?:\.\d+)?\b)/, '#b5cea8'],                  // Numbers
    [/^([{}()\[\]<>])/, '#ffd700'],                         // Brackets
    [/^(=>|===|!==|&&|\|\||\.\.\.|\?\.)/, '#d4d4d4'],      // Operators
    [/^(\b[A-Z][a-zA-Z0-9]*\b)/, '#4ec9b0'],              // PascalCase (types/components)
    [/^(\.[a-zA-Z_]\w*\b)/, '#dcdcaa'],                    // Method calls
  ]

  while (remaining.length > 0) {
    let matched = false
    for (const [pattern, color] of patterns) {
      const match = remaining.match(pattern)
      if (match) {
        tokens.push({ text: match[1], color })
        remaining = remaining.slice(match[1].length)
        matched = true
        break
      }
    }
    if (!matched) {
      const existingLast = tokens[tokens.length - 1]
      if (existingLast && existingLast.color === '#d4d4d4') {
        existingLast.text += remaining[0]
      } else {
        tokens.push({ text: remaining[0], color: '#d4d4d4' })
      }
      remaining = remaining.slice(1)
    }
  }

  return tokens.map((token, i) => (
    <span key={i} style={{ color: token.color }}>
      {token.text}
    </span>
  ))
}
