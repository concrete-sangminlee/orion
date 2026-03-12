import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Hash,
  Box,
  Braces,
  Variable,
  Type,
  Zap,
  Circle,
  ChevronDown,
  FileText,
  FileCode,
  Search,
  MoreHorizontal,
  ArrowRight,
  Diamond,
  Triangle,
  Square,
  Hexagon,
  Star,
  Key,
  Tag,
  Shield,
  Cpu,
  Globe,
  Palette,
  Settings,
  Lock,
  BookOpen,
  Image,
  Film,
  Music,
  Archive,
  Database,
  FileSpreadsheet,
  Terminal as TerminalIcon,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

export type SymbolKind =
  | 'file'
  | 'module'
  | 'namespace'
  | 'package'
  | 'class'
  | 'method'
  | 'property'
  | 'field'
  | 'constructor'
  | 'enum'
  | 'interface'
  | 'function'
  | 'variable'
  | 'constant'
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'key'
  | 'null'
  | 'enummember'
  | 'struct'
  | 'event'
  | 'operator'
  | 'typeparameter'

export interface BreadcrumbSegment {
  type: 'folder' | 'file' | 'symbol'
  label: string
  path?: string
  icon?: React.ReactNode
  children?: BreadcrumbSegment[]
  symbolKind?: SymbolKind
  range?: { startLine: number; startColumn: number; endLine: number; endColumn: number }
  detail?: string
  deprecated?: boolean
}

export interface BreadcrumbSymbol {
  name: string
  kind: SymbolKind
  range: { startLine: number; startColumn: number; endLine: number; endColumn: number }
  children?: BreadcrumbSymbol[]
  detail?: string
  deprecated?: boolean
  containerName?: string
}

export interface FileEntry {
  name: string
  type: 'file' | 'folder'
  path: string
}

interface Props {
  /** Full file path of the active file (forward slashes) */
  filePath: string
  /** Root workspace path (used to compute relative path) */
  workspacePath?: string
  /** Symbols parsed from the active file */
  symbols?: BreadcrumbSymbol[]
  /** Current cursor line (1-based), used to highlight the containing symbol */
  cursorLine?: number
  /** Current cursor column (1-based) */
  cursorColumn?: number
  /** Callback: navigate editor to a specific line */
  onNavigate?: (line: number, column?: number) => void
  /** Callback: open a different file by path */
  onOpenFile?: (path: string) => void
  /** Resolve children for a path segment (for dropdown siblings) */
  onResolveChildren?: (parentPath: string) => Promise<FileEntry[]> | FileEntry[]
  /** Whether the breadcrumb bar is visible */
  visible?: boolean
  /** Maximum width for the breadcrumb bar; enables ellipsis collapsing */
  maxWidth?: number
  /** Custom class name for the outermost container */
  className?: string
}

// ── Symbol icon mapping ────────────────────────────────────────────────────

const SYMBOL_ICON_CONFIG: Record<string, { icon: React.FC<any>; color: string }> = {
  file: { icon: File, color: '#8b949e' },
  module: { icon: Box, color: '#d19a66' },
  namespace: { icon: Box, color: '#d19a66' },
  package: { icon: Box, color: '#d19a66' },
  class: { icon: Diamond, color: '#e5c07b' },
  method: { icon: Braces, color: '#61afef' },
  property: { icon: Variable, color: '#c678dd' },
  field: { icon: Variable, color: '#c678dd' },
  constructor: { icon: Braces, color: '#e5c07b' },
  enum: { icon: Hexagon, color: '#e5c07b' },
  interface: { icon: Type, color: '#56b6c2' },
  function: { icon: Braces, color: '#61afef' },
  variable: { icon: Variable, color: '#c678dd' },
  constant: { icon: Square, color: '#d19a66' },
  string: { icon: Hash, color: '#98c379' },
  number: { icon: Hash, color: '#d19a66' },
  boolean: { icon: Circle, color: '#56b6c2' },
  array: { icon: Braces, color: '#c678dd' },
  object: { icon: Braces, color: '#e5c07b' },
  key: { icon: Key, color: '#d19a66' },
  null: { icon: Circle, color: '#8b949e' },
  enummember: { icon: Square, color: '#56b6c2' },
  struct: { icon: Diamond, color: '#e5c07b' },
  event: { icon: Zap, color: '#e5c07b' },
  operator: { icon: Triangle, color: '#56b6c2' },
  typeparameter: { icon: Type, color: '#56b6c2' },
}

function getSymbolIcon(kind: SymbolKind | string, size = 14): React.ReactNode {
  const cfg = SYMBOL_ICON_CONFIG[kind.toLowerCase()]
  if (cfg) {
    const Icon = cfg.icon
    return <Icon size={size} style={{ color: cfg.color, flexShrink: 0 }} />
  }
  return <Circle size={size} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
}

// ── File icon mapping (lightweight inline version) ─────────────────────────

const FILE_EXT_COLORS: Record<string, { icon: React.FC<any>; color: string }> = {
  ts: { icon: FileCode, color: '#3178c6' },
  tsx: { icon: FileCode, color: '#3178c6' },
  js: { icon: FileCode, color: '#f7df1e' },
  jsx: { icon: FileCode, color: '#61dafb' },
  py: { icon: FileCode, color: '#3776ab' },
  go: { icon: FileCode, color: '#00add8' },
  rs: { icon: FileCode, color: '#dea584' },
  java: { icon: FileCode, color: '#ed8b00' },
  rb: { icon: FileCode, color: '#cc342d' },
  c: { icon: FileCode, color: '#a8b9cc' },
  cpp: { icon: FileCode, color: '#00599c' },
  cs: { icon: FileCode, color: '#239120' },
  swift: { icon: FileCode, color: '#f05138' },
  kt: { icon: FileCode, color: '#7f52ff' },
  html: { icon: Globe, color: '#e34f26' },
  css: { icon: Palette, color: '#1572b6' },
  scss: { icon: Palette, color: '#cc6699' },
  json: { icon: Braces, color: '#f7df1e' },
  yaml: { icon: FileText, color: '#cb171e' },
  yml: { icon: FileText, color: '#cb171e' },
  xml: { icon: FileText, color: '#e37933' },
  md: { icon: BookOpen, color: '#083fa1' },
  txt: { icon: FileText, color: '#8b949e' },
  svg: { icon: Image, color: '#ffb13b' },
  png: { icon: Image, color: '#a4c639' },
  jpg: { icon: Image, color: '#a4c639' },
  gif: { icon: Image, color: '#a4c639' },
  sql: { icon: Database, color: '#e38c00' },
  sh: { icon: TerminalIcon, color: '#89e051' },
  env: { icon: Lock, color: '#ecd53f' },
  lock: { icon: Lock, color: '#8b949e' },
  csv: { icon: FileSpreadsheet, color: '#217346' },
  toml: { icon: Settings, color: '#9c4121' },
}

function getFileIcon(fileName: string, size = 14): React.ReactNode {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const cfg = FILE_EXT_COLORS[ext]
  if (cfg) {
    const Icon = cfg.icon
    return <Icon size={size} style={{ color: cfg.color, flexShrink: 0 }} />
  }
  return <FileText size={size} style={{ color: '#8b949e', flexShrink: 0 }} />
}

function getFolderIcon(size = 14, open = false): React.ReactNode {
  return open
    ? <FolderOpen size={size} style={{ color: '#dcb67a', flexShrink: 0 }} />
    : <Folder size={size} style={{ color: '#c09553', flexShrink: 0 }} />
}

// ── Fuzzy match ────────────────────────────────────────────────────────────

interface FuzzyResult {
  matches: boolean
  score: number
  indices: number[]
}

function fuzzyMatch(text: string, query: string): FuzzyResult {
  if (!query) return { matches: true, score: 0, indices: [] }
  const tl = text.toLowerCase()
  const ql = query.toLowerCase()
  let qi = 0
  const indices: number[] = []
  let score = 0
  let prevMatchIndex = -1

  for (let i = 0; i < tl.length && qi < ql.length; i++) {
    if (tl[i] === ql[qi]) {
      indices.push(i)
      // Bonus for consecutive matches
      if (prevMatchIndex === i - 1) {
        score += 5
      }
      // Bonus for matching at word boundaries
      if (i === 0 || tl[i - 1] === '/' || tl[i - 1] === '.' || tl[i - 1] === '-' || tl[i - 1] === '_' || tl[i - 1] === ' ') {
        score += 10
      }
      // Bonus for matching uppercase in camelCase
      if (text[i] === text[i].toUpperCase() && text[i] !== text[i].toLowerCase()) {
        score += 3
      }
      score += 1
      prevMatchIndex = i
      qi++
    }
  }

  return { matches: qi === ql.length, score, indices }
}

// ── Highlighted text ───────────────────────────────────────────────────────

function HighlightedLabel({
  text,
  indices,
  style,
}: {
  text: string
  indices?: number[]
  style?: React.CSSProperties
}) {
  if (!indices || indices.length === 0) {
    return <span style={style}>{text}</span>
  }
  const indexSet = new Set(indices)
  const parts: React.ReactNode[] = []
  let i = 0

  while (i < text.length) {
    if (indexSet.has(i)) {
      let end = i
      while (end < text.length && indexSet.has(end)) end++
      parts.push(
        <span key={i} style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>
          {text.slice(i, end)}
        </span>
      )
      i = end
    } else {
      let end = i
      while (end < text.length && !indexSet.has(end)) end++
      parts.push(<span key={i}>{text.slice(i, end)}</span>)
      i = end
    }
  }

  return <span style={style}>{parts}</span>
}

// ── Current-symbol resolver ────────────────────────────────────────────────

function findCurrentSymbolPath(
  symbols: BreadcrumbSymbol[],
  cursorLine: number,
  cursorColumn: number
): BreadcrumbSymbol[] {
  const path: BreadcrumbSymbol[] = []

  function search(list: BreadcrumbSymbol[]): boolean {
    for (const sym of list) {
      if (
        cursorLine >= sym.range.startLine &&
        cursorLine <= sym.range.endLine
      ) {
        path.push(sym)
        if (sym.children && sym.children.length > 0) {
          // Try to find a more specific child
          if (!search(sym.children)) {
            // No child matched, current symbol is the deepest
          }
        }
        return true
      }
    }
    return false
  }

  search(symbols)
  return path
}

function flattenSymbols(symbols: BreadcrumbSymbol[], depth = 0): (BreadcrumbSymbol & { depth: number })[] {
  const result: (BreadcrumbSymbol & { depth: number })[] = []
  for (const sym of symbols) {
    result.push({ ...sym, depth })
    if (sym.children) {
      result.push(...flattenSymbols(sym.children, depth + 1))
    }
  }
  return result
}

// ── Dropdown filter input ──────────────────────────────────────────────────

function DropdownFilterInput({
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary, rgba(255,255,255,0.03))',
      }}
    >
      <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Filter...'}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--text-primary)',
          fontSize: 12,
          lineHeight: '18px',
          padding: 0,
          fontFamily: 'inherit',
        }}
        autoFocus
      />
    </div>
  )
}

// ── Dropdown item row ──────────────────────────────────────────────────────

interface DropdownItemData {
  id: string
  label: string
  icon: React.ReactNode
  detail?: string
  deprecated?: boolean
  isActive?: boolean
  depth?: number
  matchIndices?: number[]
  action: () => void
}

function DropdownItemRow({
  item,
  isFocused,
  onMouseEnter,
  onClick,
}: {
  item: DropdownItemData
  isFocused: boolean
  onMouseEnter: () => void
  onClick: () => void
}) {
  return (
    <div
      role="option"
      aria-selected={isFocused}
      data-dropdown-item
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 8px',
        paddingLeft: item.depth ? 8 + item.depth * 12 : 8,
        fontSize: 12,
        lineHeight: '20px',
        color: item.deprecated
          ? 'var(--text-muted)'
          : item.isActive
            ? 'var(--accent-blue)'
            : 'var(--text-primary)',
        textDecoration: item.deprecated ? 'line-through' : 'none',
        cursor: 'pointer',
        background: isFocused ? 'var(--list-active-bg, rgba(255,255,255,0.08))' : 'transparent',
        transition: 'background 0.06s',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        borderLeft: item.isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
      }}
    >
      <span style={{ flexShrink: 0 }}>{item.icon}</span>
      <HighlightedLabel
        text={item.label}
        indices={item.matchIndices}
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontWeight: item.isActive ? 500 : 400,
        }}
      />
      {item.detail && (
        <span
          style={{
            marginLeft: 'auto',
            paddingLeft: 8,
            fontSize: 11,
            color: 'var(--text-muted)',
            opacity: 0.7,
            flexShrink: 0,
          }}
        >
          {item.detail}
        </span>
      )}
    </div>
  )
}

// ── Dropdown menu ──────────────────────────────────────────────────────────

interface DropdownMenuProps {
  items: DropdownItemData[]
  anchorRect: DOMRect
  onClose: () => void
  showFilter?: boolean
  filterPlaceholder?: string
  title?: string
  maxHeight?: number
}

function DropdownMenu({
  items,
  anchorRect,
  onClose,
  showFilter = true,
  filterPlaceholder,
  title,
  maxHeight = 320,
}: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [filterText, setFilterText] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [isAnimating, setIsAnimating] = useState(true)

  // Entrance animation
  useEffect(() => {
    const timer = requestAnimationFrame(() => setIsAnimating(false))
    return () => cancelAnimationFrame(timer)
  }, [])

  // Filter items
  const filteredItems = useMemo(() => {
    if (!filterText) return items
    return items
      .map((item) => {
        const result = fuzzyMatch(item.label, filterText)
        return result.matches ? { ...item, matchIndices: result.indices, _score: result.score } : null
      })
      .filter(Boolean)
      .sort((a, b) => (b as any)._score - (a as any)._score) as DropdownItemData[]
  }, [items, filterText])

  // Reset focus on filter change
  useEffect(() => {
    setFocusedIndex(filteredItems.length > 0 ? 0 : -1)
  }, [filterText, filteredItems.length])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Use a slight delay so the opening click does not immediately close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [onClose])

  // Keyboard handling
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          onClose()
          break
        case 'ArrowDown':
          e.preventDefault()
          setFocusedIndex((prev) => {
            const next = prev + 1
            return next < filteredItems.length ? next : 0
          })
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocusedIndex((prev) => {
            const next = prev - 1
            return next >= 0 ? next : filteredItems.length - 1
          })
          break
        case 'Enter':
          e.preventDefault()
          if (focusedIndex >= 0 && focusedIndex < filteredItems.length) {
            filteredItems[focusedIndex].action()
            onClose()
          }
          break
        case 'Home':
          e.preventDefault()
          setFocusedIndex(0)
          break
        case 'End':
          e.preventDefault()
          setFocusedIndex(filteredItems.length - 1)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [focusedIndex, filteredItems, onClose])

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex < 0 || !listRef.current) return
    const children = listRef.current.querySelectorAll('[data-dropdown-item]')
    const target = children[focusedIndex] as HTMLElement | undefined
    target?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex])

  // Position calculation
  const { left, top, width: dropdownWidth } = useMemo(() => {
    const minW = 200
    const maxW = 340
    const targetW = Math.max(minW, Math.min(maxW, anchorRect.width + 100))
    let l = anchorRect.left
    // Keep within viewport
    if (l + targetW > window.innerWidth) {
      l = Math.max(0, window.innerWidth - targetW - 4)
    }
    let t = anchorRect.bottom + 2
    // If dropdown would go below viewport, position it above
    if (t + maxHeight > window.innerHeight) {
      const aboveT = anchorRect.top - maxHeight - 2
      if (aboveT > 0) t = aboveT
    }
    return { left: l, top: t, width: targetW }
  }, [anchorRect, maxHeight])

  return (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: 'fixed',
        left,
        top,
        width: dropdownWidth,
        maxHeight,
        zIndex: 10000,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 4,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.45)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        opacity: isAnimating ? 0 : 1,
        transform: isAnimating ? 'translateY(-4px)' : 'translateY(0)',
        transition: 'opacity 0.1s ease-out, transform 0.1s ease-out',
      }}
    >
      {/* Title bar */}
      {title && (
        <div
          style={{
            padding: '4px 8px',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            borderBottom: showFilter ? 'none' : '1px solid var(--border-color)',
          }}
        >
          {title}
        </div>
      )}

      {/* Filter input */}
      {showFilter && items.length > 6 && (
        <DropdownFilterInput
          value={filterText}
          onChange={setFilterText}
          placeholder={filterPlaceholder}
          inputRef={filterInputRef}
        />
      )}

      {/* Items list */}
      <div
        ref={listRef}
        style={{
          overflowY: 'auto',
          overflowX: 'hidden',
          flex: 1,
          padding: '4px 0',
        }}
      >
        {filteredItems.map((item, i) => (
          <DropdownItemRow
            key={item.id}
            item={item}
            isFocused={i === focusedIndex}
            onMouseEnter={() => setFocusedIndex(i)}
            onClick={() => {
              item.action()
              onClose()
            }}
          />
        ))}
        {filteredItems.length === 0 && (
          <div
            style={{
              padding: '12px 8px',
              fontSize: 12,
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            {filterText ? 'No matching items' : 'No items'}
          </div>
        )}
      </div>

      {/* Footer with count */}
      {filteredItems.length > 0 && items.length > 6 && (
        <div
          style={{
            padding: '3px 8px',
            fontSize: 10,
            color: 'var(--text-muted)',
            opacity: 0.6,
            borderTop: '1px solid var(--border-color)',
            textAlign: 'right',
          }}
        >
          {filterText
            ? `${filteredItems.length} of ${items.length}`
            : `${items.length} items`}
        </div>
      )}
    </div>
  )
}

// ── Segment component ──────────────────────────────────────────────────────

interface SegmentProps {
  index: number
  label: string
  icon: React.ReactNode
  isActive: boolean
  isHovered: boolean
  isFocused: boolean
  isDropdownOpen: boolean
  isCurrentSymbol?: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onClick: (el: HTMLDivElement) => void
  onRef: (el: HTMLDivElement | null) => void
}

function Segment({
  index,
  label,
  icon,
  isActive,
  isHovered,
  isFocused,
  isDropdownOpen,
  isCurrentSymbol,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onRef,
}: SegmentProps) {
  const ref = useRef<HTMLDivElement>(null)

  const handleRef = useCallback(
    (el: HTMLDivElement | null) => {
      (ref as any).current = el
      onRef(el)
    },
    [onRef]
  )

  const highlighted = isHovered || isFocused || isDropdownOpen

  return (
    <div
      ref={handleRef}
      role="button"
      tabIndex={-1}
      aria-expanded={isDropdownOpen}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={() => ref.current && onClick(ref.current)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '0 4px',
        height: 20,
        borderRadius: 3,
        cursor: 'pointer',
        fontSize: 12,
        lineHeight: '20px',
        color: isCurrentSymbol
          ? 'var(--accent-blue)'
          : highlighted
            ? 'var(--text-primary)'
            : 'var(--text-muted)',
        fontWeight: isCurrentSymbol ? 500 : 400,
        background: highlighted
          ? 'rgba(255, 255, 255, 0.07)'
          : isDropdownOpen
            ? 'rgba(255, 255, 255, 0.05)'
            : 'transparent',
        outline: isFocused ? '1px solid var(--accent-blue)' : 'none',
        outlineOffset: -1,
        transition: 'background 0.1s, color 0.1s',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        userSelect: 'none',
        flexShrink: label.length > 20 ? 1 : 0,
        minWidth: 0,
      }}
    >
      <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}>
        {icon}
      </span>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
      {isDropdownOpen && (
        <ChevronDown
          size={10}
          style={{ flexShrink: 0, opacity: 0.6, marginLeft: -1 }}
        />
      )}
    </div>
  )
}

// ── Separator ──────────────────────────────────────────────────────────────

function Separator() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        color: 'var(--text-muted)',
        opacity: 0.4,
        flexShrink: 0,
        height: 20,
      }}
    >
      <ChevronRight size={12} />
    </span>
  )
}

// ── Ellipsis segment for responsive collapse ───────────────────────────────

function EllipsisSegment({
  onClick,
  isHovered,
  onMouseEnter,
  onMouseLeave,
  onRef,
  isFocused,
  isDropdownOpen,
}: {
  onClick: (el: HTMLDivElement) => void
  isHovered: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onRef: (el: HTMLDivElement | null) => void
  isFocused: boolean
  isDropdownOpen: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  const handleRef = useCallback(
    (el: HTMLDivElement | null) => {
      (ref as any).current = el
      onRef(el)
    },
    [onRef]
  )

  const highlighted = isHovered || isFocused || isDropdownOpen

  return (
    <div
      ref={handleRef}
      role="button"
      tabIndex={-1}
      onClick={() => ref.current && onClick(ref.current)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        borderRadius: 3,
        cursor: 'pointer',
        color: 'var(--text-muted)',
        background: highlighted
          ? 'rgba(255, 255, 255, 0.07)'
          : 'transparent',
        outline: isFocused ? '1px solid var(--accent-blue)' : 'none',
        outlineOffset: -1,
        transition: 'background 0.1s',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      <MoreHorizontal size={14} />
    </div>
  )
}

// ── Default sibling resolver (simulated) ───────────────────────────────────

function defaultSiblingFiles(fileName: string): FileEntry[] {
  // Generate plausible sibling files as a fallback
  const ext = fileName.split('.').pop() || 'ts'
  const baseSiblings: FileEntry[] = [
    { name: fileName, type: 'file', path: fileName },
  ]
  const common = ['index', 'utils', 'types', 'styles', 'constants', 'helpers']
  common.forEach((name) => {
    const fullName = `${name}.${ext}`
    if (fullName !== fileName) {
      baseSiblings.push({ name: fullName, type: 'file', path: fullName })
    }
  })
  return baseSiblings
}

function defaultSiblingFolders(segmentName: string): FileEntry[] {
  const siblings: FileEntry[] = [
    { name: segmentName, type: 'folder', path: segmentName },
  ]
  const common = ['src', 'lib', 'utils', 'components', 'hooks', 'types', 'store', 'assets', 'public', 'tests']
  common.forEach((name) => {
    if (name !== segmentName) {
      siblings.push({ name, type: 'folder', path: name })
    }
  })
  return siblings
}

// ── Main component ─────────────────────────────────────────────────────────

export default function BreadcrumbDropdown({
  filePath,
  workspacePath,
  symbols,
  cursorLine,
  cursorColumn,
  onNavigate,
  onOpenFile,
  onResolveChildren,
  visible = true,
  maxWidth,
  className,
}: Props) {
  // ── State ────────────────────────────────────────────────────────────────

  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null)
  const [activeDropdown, setActiveDropdown] = useState<number | null>(null)
  const [dropdownAnchor, setDropdownAnchor] = useState<DOMRect | null>(null)
  const [dropdownItems, setDropdownItems] = useState<DropdownItemData[]>([])
  const [dropdownTitle, setDropdownTitle] = useState<string | undefined>()
  const [dropdownFilterPlaceholder, setDropdownFilterPlaceholder] = useState<string | undefined>()
  const [focusedSegmentIndex, setFocusedSegmentIndex] = useState(-1)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [containerWidth, setContainerWidth] = useState(0)
  const [resolvedChildren, setResolvedChildren] = useState<Map<string, FileEntry[]>>(new Map())

  const containerRef = useRef<HTMLDivElement>(null)
  const segmentRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const measureRef = useRef<HTMLDivElement>(null)

  // ── Derived data ─────────────────────────────────────────────────────────

  const normalized = useMemo(() => filePath.replace(/\\/g, '/'), [filePath])

  const relativePath = useMemo(() => {
    if (!workspacePath) return normalized
    const normalizedWs = workspacePath.replace(/\\/g, '/').replace(/\/$/, '')
    if (normalized.startsWith(normalizedWs)) {
      return normalized.slice(normalizedWs.length + 1)
    }
    return normalized
  }, [normalized, workspacePath])

  const pathSegments = useMemo(
    () => relativePath.split('/').filter(Boolean),
    [relativePath]
  )

  const fileName = pathSegments[pathSegments.length - 1] || ''
  const folderSegments = pathSegments.slice(0, -1)

  // Current symbol path based on cursor position
  const currentSymbolPath = useMemo(() => {
    if (!symbols || !cursorLine) return []
    return findCurrentSymbolPath(symbols, cursorLine, cursorColumn || 1)
  }, [symbols, cursorLine, cursorColumn])

  // Build all visible segments with their global indices
  // Index layout:
  //   0 .. folderSegments.length-1        = folder segments
  //   folderSegments.length               = file segment
  //   folderSegments.length + 1 + i       = symbol segments (from currentSymbolPath)
  const fileSegmentIndex = folderSegments.length
  const symbolSegmentBase = folderSegments.length + 1

  // If collapsed, we show: first folder, ellipsis, last folder (or just file)
  const collapsedFolders = useMemo(() => {
    if (!isCollapsed || folderSegments.length <= 3) return null
    return {
      first: folderSegments[0],
      hidden: folderSegments.slice(1, -1),
      last: folderSegments[folderSegments.length - 1],
    }
  }, [isCollapsed, folderSegments])

  const totalVisibleSegments = useMemo(() => {
    const symbolCount = currentSymbolPath.length
    if (collapsedFolders) {
      // first + ellipsis + last + file + symbols
      return 3 + 1 + symbolCount
    }
    return folderSegments.length + 1 + symbolCount
  }, [collapsedFolders, folderSegments.length, currentSymbolPath.length])

  // ── Responsive collapse detection ────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // Check if we need to collapse based on content overflow
  useEffect(() => {
    if (!containerRef.current || !measureRef.current) return
    const containerW = maxWidth || containerRef.current.clientWidth
    const contentW = measureRef.current.scrollWidth
    setIsCollapsed(contentW > containerW && folderSegments.length > 3)
  }, [containerWidth, folderSegments.length, currentSymbolPath, maxWidth])

  // ── Dropdown logic ───────────────────────────────────────────────────────

  const closeDropdown = useCallback(() => {
    setActiveDropdown(null)
    setDropdownAnchor(null)
    setDropdownItems([])
    setDropdownTitle(undefined)
    setDropdownFilterPlaceholder(undefined)
  }, [])

  const buildFolderDropdownItems = useCallback(
    (segmentIndex: number): DropdownItemData[] => {
      const segment = folderSegments[segmentIndex]
      const parentPath = folderSegments.slice(0, segmentIndex).join('/')
      const cacheKey = parentPath || '__root__'

      // Check if we have resolved children from the parent
      const cached = resolvedChildren.get(cacheKey)
      if (cached) {
        return cached
          .filter((e) => e.type === 'folder')
          .map((entry) => ({
            id: `folder-${entry.path}`,
            label: entry.name,
            icon: getFolderIcon(14, entry.name === segment),
            isActive: entry.name === segment,
            action: () => {
              if (entry.name !== segment && onOpenFile) {
                const newPath = [...folderSegments.slice(0, segmentIndex), entry.name, ...folderSegments.slice(segmentIndex + 1), fileName].join('/')
                onOpenFile(workspacePath ? `${workspacePath}/${newPath}` : newPath)
              }
            },
          }))
      }

      // Default simulated siblings
      const siblings = defaultSiblingFolders(segment)
      return siblings.map((entry) => ({
        id: `folder-${entry.name}`,
        label: entry.name,
        icon: getFolderIcon(14, entry.name === segment),
        isActive: entry.name === segment,
        action: () => {
          if (entry.name !== segment && onOpenFile) {
            const newPath = [...folderSegments.slice(0, segmentIndex), entry.name, ...folderSegments.slice(segmentIndex + 1), fileName].join('/')
            onOpenFile(workspacePath ? `${workspacePath}/${newPath}` : newPath)
          }
        },
      }))
    },
    [folderSegments, fileName, onOpenFile, workspacePath, resolvedChildren]
  )

  const buildFileDropdownItems = useCallback((): DropdownItemData[] => {
    const parentPath = folderSegments.join('/')
    const cacheKey = parentPath || '__filedir__'

    const cached = resolvedChildren.get(cacheKey)
    if (cached) {
      return cached.map((entry) => ({
        id: `file-${entry.path}`,
        label: entry.name,
        icon: entry.type === 'folder' ? getFolderIcon(14) : getFileIcon(entry.name),
        isActive: entry.name === fileName,
        detail: entry.type === 'folder' ? 'folder' : undefined,
        action: () => {
          if (entry.name !== fileName && onOpenFile) {
            onOpenFile(entry.path)
          }
        },
      }))
    }

    // Default simulated siblings
    const siblings = defaultSiblingFiles(fileName)
    return siblings.map((entry) => ({
      id: `file-${entry.name}`,
      label: entry.name,
      icon: getFileIcon(entry.name),
      isActive: entry.name === fileName,
      action: () => {
        if (entry.name !== fileName && onOpenFile) {
          const fullPath = folderSegments.length > 0
            ? `${folderSegments.join('/')}/${entry.name}`
            : entry.name
          onOpenFile(workspacePath ? `${workspacePath}/${fullPath}` : fullPath)
        }
      },
    }))
  }, [folderSegments, fileName, onOpenFile, workspacePath, resolvedChildren])

  const buildSymbolDropdownItems = useCallback(
    (symbolIndex: number): DropdownItemData[] => {
      if (!symbols) return []

      // Get the parent container for this level
      let sourceList = symbols
      if (symbolIndex > 0 && currentSymbolPath.length > symbolIndex) {
        // Navigate to the parent
        const parent = currentSymbolPath[symbolIndex - 1]
        sourceList = parent.children || []
      }

      // If clicking the deepest symbol, show all symbols at that level
      const currentSym = currentSymbolPath[symbolIndex]
      const flat = flattenSymbols(sourceList)

      return flat.map((sym) => ({
        id: `sym-${sym.name}-${sym.range.startLine}`,
        label: sym.name,
        icon: getSymbolIcon(sym.kind),
        detail: sym.detail || sym.kind,
        deprecated: sym.deprecated,
        isActive: currentSym ? sym.name === currentSym.name && sym.range.startLine === currentSym.range.startLine : false,
        depth: sym.depth,
        action: () => {
          onNavigate?.(sym.range.startLine, sym.range.startColumn)
        },
      }))
    },
    [symbols, currentSymbolPath, onNavigate]
  )

  const buildHiddenFoldersDropdownItems = useCallback((): DropdownItemData[] => {
    if (!collapsedFolders) return []
    return collapsedFolders.hidden.map((seg, i) => ({
      id: `hidden-folder-${i}-${seg}`,
      label: seg,
      icon: getFolderIcon(14),
      action: () => {
        // Could navigate to that folder's context
      },
    }))
  }, [collapsedFolders])

  // Resolve children async when opening a dropdown
  const resolveAndOpenDropdown = useCallback(
    async (globalIndex: number, el: HTMLElement) => {
      if (activeDropdown === globalIndex) {
        closeDropdown()
        return
      }

      const rect = el.getBoundingClientRect()

      if (globalIndex < folderSegments.length) {
        // Folder segment
        const parentPath = folderSegments.slice(0, globalIndex).join('/')
        const cacheKey = parentPath || '__root__'

        // Try to resolve children if resolver is provided
        if (onResolveChildren && !resolvedChildren.has(cacheKey)) {
          try {
            const children = await onResolveChildren(
              workspacePath ? `${workspacePath}/${parentPath}` : parentPath
            )
            setResolvedChildren((prev) => new Map(prev).set(cacheKey, children))
          } catch {
            // Fall back to simulated siblings
          }
        }

        setDropdownTitle('Folders')
        setDropdownFilterPlaceholder('Search folders...')
        setActiveDropdown(globalIndex)
        setDropdownAnchor(rect)
        setDropdownItems(buildFolderDropdownItems(globalIndex))
      } else if (globalIndex === fileSegmentIndex) {
        // File segment
        const parentPath = folderSegments.join('/')
        const cacheKey = parentPath || '__filedir__'

        if (onResolveChildren && !resolvedChildren.has(cacheKey)) {
          try {
            const children = await onResolveChildren(
              workspacePath ? `${workspacePath}/${parentPath}` : parentPath
            )
            setResolvedChildren((prev) => new Map(prev).set(cacheKey, children))
          } catch {
            // Fall back
          }
        }

        setDropdownTitle('Files')
        setDropdownFilterPlaceholder('Search files...')
        setActiveDropdown(globalIndex)
        setDropdownAnchor(rect)
        setDropdownItems(buildFileDropdownItems())
      } else if (globalIndex >= symbolSegmentBase) {
        // Symbol segment
        const symbolIdx = globalIndex - symbolSegmentBase
        setDropdownTitle('Symbols')
        setDropdownFilterPlaceholder('Search symbols...')
        setActiveDropdown(globalIndex)
        setDropdownAnchor(rect)
        setDropdownItems(buildSymbolDropdownItems(symbolIdx))
      }
    },
    [
      activeDropdown,
      closeDropdown,
      folderSegments,
      fileSegmentIndex,
      symbolSegmentBase,
      onResolveChildren,
      resolvedChildren,
      workspacePath,
      buildFolderDropdownItems,
      buildFileDropdownItems,
      buildSymbolDropdownItems,
    ]
  )

  // Ellipsis dropdown
  const openEllipsisDropdown = useCallback(
    (el: HTMLElement) => {
      if (activeDropdown === -999) {
        closeDropdown()
        return
      }
      const rect = el.getBoundingClientRect()
      setDropdownTitle('Path')
      setDropdownFilterPlaceholder('Search path segments...')
      setActiveDropdown(-999)
      setDropdownAnchor(rect)
      setDropdownItems(buildHiddenFoldersDropdownItems())
    },
    [activeDropdown, closeDropdown, buildHiddenFoldersDropdownItems]
  )

  // ── Segment click handler ────────────────────────────────────────────────

  const handleSegmentClick = useCallback(
    (globalIndex: number, el: HTMLDivElement) => {
      resolveAndOpenDropdown(globalIndex, el)
    },
    [resolveAndOpenDropdown]
  )

  // ── Symbol click (also navigates) ────────────────────────────────────────

  const handleSymbolSegmentClick = useCallback(
    (symbolIndex: number, el: HTMLDivElement) => {
      const sym = currentSymbolPath[symbolIndex]
      if (sym) {
        onNavigate?.(sym.range.startLine, sym.range.startColumn)
      }
      resolveAndOpenDropdown(symbolSegmentBase + symbolIndex, el)
    },
    [currentSymbolPath, onNavigate, resolveAndOpenDropdown, symbolSegmentBase]
  )

  // ── Keyboard navigation (segment-level) ──────────────────────────────────

  useEffect(() => {
    if (activeDropdown !== null) return // dropdown handles its own keys

    const handler = (e: KeyboardEvent) => {
      if (focusedSegmentIndex < 0) return

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          setFocusedSegmentIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'ArrowRight':
          e.preventDefault()
          setFocusedSegmentIndex((prev) =>
            Math.min(prev + 1, totalVisibleSegments - 1)
          )
          break
        case 'Enter':
        case ' ': {
          e.preventDefault()
          const el = segmentRefs.current.get(focusedSegmentIndex)
          if (el) handleSegmentClick(focusedSegmentIndex, el)
          break
        }
        case 'Escape':
          setFocusedSegmentIndex(-1)
          containerRef.current?.blur()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [focusedSegmentIndex, activeDropdown, totalVisibleSegments, handleSegmentClick])

  // ── Ref management ───────────────────────────────────────────────────────

  const setSegmentRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) {
      segmentRefs.current.set(index, el)
    } else {
      segmentRefs.current.delete(index)
    }
  }, [])

  // ── Recalculate dropdown items when resolved children change ─────────────

  useEffect(() => {
    if (activeDropdown === null) return

    if (activeDropdown < folderSegments.length) {
      setDropdownItems(buildFolderDropdownItems(activeDropdown))
    } else if (activeDropdown === fileSegmentIndex) {
      setDropdownItems(buildFileDropdownItems())
    }
    // Symbol dropdowns don't depend on resolvedChildren
  }, [resolvedChildren, activeDropdown, folderSegments.length, fileSegmentIndex, buildFolderDropdownItems, buildFileDropdownItems])

  // ── Render ───────────────────────────────────────────────────────────────

  if (!visible) return null

  const renderFolderSegment = (
    folderName: string,
    globalIndex: number,
    isLast: boolean
  ) => (
    <React.Fragment key={`folder-${globalIndex}`}>
      <Segment
        index={globalIndex}
        label={folderName}
        icon={getFolderIcon(13)}
        isActive={activeDropdown === globalIndex}
        isHovered={hoveredSegment === globalIndex}
        isFocused={focusedSegmentIndex === globalIndex}
        isDropdownOpen={activeDropdown === globalIndex}
        onMouseEnter={() => setHoveredSegment(globalIndex)}
        onMouseLeave={() => setHoveredSegment(null)}
        onClick={(el) => handleSegmentClick(globalIndex, el)}
        onRef={(el) => setSegmentRef(globalIndex, el)}
      />
      <Separator />
    </React.Fragment>
  )

  const renderFileSegment = () => (
    <Segment
      key="file-segment"
      index={fileSegmentIndex}
      label={fileName}
      icon={getFileIcon(fileName, 13)}
      isActive={activeDropdown === fileSegmentIndex}
      isHovered={hoveredSegment === fileSegmentIndex}
      isFocused={focusedSegmentIndex === fileSegmentIndex}
      isDropdownOpen={activeDropdown === fileSegmentIndex}
      onMouseEnter={() => setHoveredSegment(fileSegmentIndex)}
      onMouseLeave={() => setHoveredSegment(null)}
      onClick={(el) => handleSegmentClick(fileSegmentIndex, el)}
      onRef={(el) => setSegmentRef(fileSegmentIndex, el)}
    />
  )

  const renderSymbolSegments = () => {
    if (currentSymbolPath.length === 0) return null
    return currentSymbolPath.map((sym, i) => {
      const globalIdx = symbolSegmentBase + i
      return (
        <React.Fragment key={`sym-${i}-${sym.name}`}>
          <Separator />
          <Segment
            index={globalIdx}
            label={sym.name}
            icon={getSymbolIcon(sym.kind, 13)}
            isActive={activeDropdown === globalIdx}
            isHovered={hoveredSegment === globalIdx}
            isFocused={focusedSegmentIndex === globalIdx}
            isDropdownOpen={activeDropdown === globalIdx}
            isCurrentSymbol={i === currentSymbolPath.length - 1}
            onMouseEnter={() => setHoveredSegment(globalIdx)}
            onMouseLeave={() => setHoveredSegment(null)}
            onClick={(el) => handleSymbolSegmentClick(i, el)}
            onRef={(el) => setSegmentRef(globalIdx, el)}
          />
        </React.Fragment>
      )
    })
  }

  // Decide which folder segments to render
  const renderFolders = () => {
    if (collapsedFolders) {
      // Collapsed mode: first > ... > last
      return (
        <>
          {renderFolderSegment(collapsedFolders.first, 0, false)}
          <EllipsisSegment
            onClick={(el) => openEllipsisDropdown(el)}
            isHovered={hoveredSegment === -999}
            onMouseEnter={() => setHoveredSegment(-999)}
            onMouseLeave={() => setHoveredSegment(null)}
            onRef={(el) => setSegmentRef(-999, el)}
            isFocused={focusedSegmentIndex === -999}
            isDropdownOpen={activeDropdown === -999}
          />
          <Separator />
          {renderFolderSegment(
            collapsedFolders.last,
            folderSegments.length - 1,
            true
          )}
        </>
      )
    }

    return folderSegments.map((seg, i) =>
      renderFolderSegment(seg, i, i === folderSegments.length - 1)
    )
  }

  return (
    <div
      ref={containerRef}
      className={className}
      tabIndex={0}
      role="navigation"
      aria-label="Breadcrumb navigation"
      onFocus={() => {
        if (focusedSegmentIndex < 0) setFocusedSegmentIndex(0)
      }}
      onBlur={(e) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
          setFocusedSegmentIndex(-1)
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 22,
        minHeight: 22,
        maxHeight: 22,
        paddingLeft: 8,
        paddingRight: 8,
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
        overflow: 'hidden',
        flexShrink: 0,
        outline: 'none',
        maxWidth: maxWidth || '100%',
        position: 'relative',
      }}
    >
      {/* Hidden measure div to detect overflow */}
      <div
        ref={measureRef}
        aria-hidden
        style={{
          position: 'absolute',
          visibility: 'hidden',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          height: 22,
          pointerEvents: 'none',
        }}
      >
        {folderSegments.map((seg, i) => (
          <React.Fragment key={`m-folder-${i}`}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0 4px', fontSize: 12 }}>
              {seg}
            </span>
            <ChevronRight size={12} />
          </React.Fragment>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0 4px', fontSize: 12 }}>
          {fileName}
        </span>
        {currentSymbolPath.map((sym, i) => (
          <React.Fragment key={`m-sym-${i}`}>
            <ChevronRight size={12} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0 4px', fontSize: 12 }}>
              {sym.name}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* Visible segments */}
      {renderFolders()}
      {renderFileSegment()}
      {renderSymbolSegments()}

      {/* Dropdown overlay */}
      {activeDropdown !== null && dropdownAnchor && dropdownItems.length >= 0 && (
        <DropdownMenu
          items={dropdownItems}
          anchorRect={dropdownAnchor}
          onClose={closeDropdown}
          showFilter
          filterPlaceholder={dropdownFilterPlaceholder}
          title={dropdownTitle}
        />
      )}
    </div>
  )
}

// ── Export sub-types and helpers for external use ───────────────────────────

export { getSymbolIcon, getFileIcon, getFolderIcon, flattenSymbols, findCurrentSymbolPath, fuzzyMatch }
export type { DropdownItemData, FileEntry as BreadcrumbFileEntry }
