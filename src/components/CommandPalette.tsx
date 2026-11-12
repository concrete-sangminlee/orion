import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Search, FileText, ChevronRight, Eye, Palette, Code, Hash, Clock, HelpCircle, Pin, Circle, Diamond, Triangle, Hexagon } from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { useThemeStore } from '@/store/theme'
import { useRecentFilesStore } from '@/store/recentFiles'
import FileIcon from '@/components/FileIcon'
import { openFileInEditor } from '@/utils/openFileInEditor'
import { listCommands, runCommand } from '@/commands/registry'
import type { PaletteMode } from '@/commands/appCommands'
import '@/commands/appCommands'

interface PaletteItem {
  id: string
  label: string
  category: 'file' | 'command' | 'setting' | 'symbol' | 'goto-line' | 'help'
  icon: React.ReactNode
  shortcut?: string
  action: () => void
  description?: string
  badge?: string
  badges?: string[]
  fileSize?: number
  filePath?: string
  symbolKind?: string
  matchIndices?: number[]
  group?: string
  previewSnippet?: string
}

interface Props {
  open: boolean
  /** What to show on opening: files, `>` commands, `#` symbols, `:` line, or the theme picker. */
  mode?: PaletteMode
  onClose: () => void
}

const MODE_PREFIX: Record<PaletteMode, string> = { files: '', commands: '>', symbols: '#', line: ':', themes: '' }

// ── MRU command usage tracking ─────────────────────────────────────────
const MRU_STORAGE_KEY = 'orion-command-mru'

function getMRUCounts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(MRU_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function recordMRUUsage(commandId: string) {
  const counts = getMRUCounts()
  counts[commandId] = (counts[commandId] || 0) + 1
  try {
    localStorage.setItem(MRU_STORAGE_KEY, JSON.stringify(counts))
  } catch {
    // storage full - ignore
  }
}

// ── Fuzzy matching with character index tracking ───────────────────────
function fuzzyMatchWithIndices(text: string, query: string): { matches: boolean; indices: number[] } {
  let qi = 0
  const tl = text.toLowerCase()
  const ql = query.toLowerCase()
  const indices: number[] = []
  for (let i = 0; i < tl.length && qi < ql.length; i++) {
    if (tl[i] === ql[qi]) {
      indices.push(i)
      qi++
    }
  }
  return { matches: qi === ql.length, indices }
}

// ── Highlighted text component ─────────────────────────────────────────
function HighlightedText({ text, indices, style }: { text: string; indices?: number[]; style?: React.CSSProperties }) {
  if (!indices || indices.length === 0) {
    return <span style={style}>{text}</span>
  }
  const indexSet = new Set(indices)
  const parts: React.ReactNode[] = []
  let i = 0
  while (i < text.length) {
    if (indexSet.has(i)) {
      // Collect consecutive highlighted chars
      let j = i
      while (j < text.length && indexSet.has(j)) j++
      parts.push(
        <span key={i} style={{ color: 'var(--accent)', fontWeight: 600 }}>
          {text.slice(i, j)}
        </span>
      )
      i = j
    } else {
      let j = i
      while (j < text.length && !indexSet.has(j)) j++
      parts.push(<span key={i}>{text.slice(i, j)}</span>)
      i = j
    }
  }
  return <span style={style}>{parts}</span>
}

// ── Symbol kind icons ──────────────────────────────────────────────────
function SymbolKindIcon({ kind, size = 14 }: { kind: string; size?: number }) {
  const colorMap: Record<string, string> = {
    function: '#b180d7',
    class: '#ee9d28',
    interface: '#75beff',
    type: '#75beff',
    enum: '#ee9d28',
    variable: '#4fc1ff',
    constant: '#4fc1ff',
    method: '#b180d7',
    property: '#9cdcfe',
  }
  const color = colorMap[kind] || 'var(--text-muted)'

  switch (kind) {
    case 'function':
    case 'method':
      return <span style={{ color, fontSize: size, fontWeight: 700, fontFamily: 'monospace', lineHeight: 1 }}>f</span>
    case 'class':
      return <Diamond size={size} style={{ color, flexShrink: 0 }} />
    case 'interface':
      return <Circle size={size} style={{ color, flexShrink: 0 }} />
    case 'type':
      return <Triangle size={size} style={{ color, flexShrink: 0 }} />
    case 'enum':
      return <Hexagon size={size} style={{ color, flexShrink: 0 }} />
    case 'variable':
    case 'constant':
      return <span style={{ color, fontSize: size, fontWeight: 700, fontFamily: 'monospace', lineHeight: 1 }}>x</span>
    default:
      return <Code size={size} style={{ color, flexShrink: 0 }} />
  }
}

// ── File size formatter ────────────────────────────────────────────────
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Section header component ───────────────────────────────────────────
function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      padding: '6px 14px 3px',
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      userSelect: 'none',
      opacity: 0.7,
    }}>
      {label}
    </div>
  )
}

// ── Preview panel component ────────────────────────────────────────────
function PreviewPanel({ snippet }: { snippet: string }) {
  return (
    <div style={{
      padding: '6px 14px',
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-tertiary)',
      maxHeight: 100,
      overflow: 'hidden',
    }}>
      <pre style={{
        margin: 0,
        fontSize: 11,
        fontFamily: 'var(--font-mono, monospace)',
        color: 'var(--text-secondary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        lineHeight: 1.4,
        opacity: 0.85,
      }}>
        {snippet}
      </pre>
    </div>
  )
}

function flattenFiles(nodes: any[], prefix = ''): { name: string; path: string }[] {
  const result: { name: string; path: string }[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      result.push({ name: node.name, path: node.path })
    } else if (node.children) {
      result.push(...flattenFiles(node.children, node.path))
    }
  }
  return result
}

function getParentDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts.slice(-3, -1).join('/')
}

// Symbol extraction regex patterns
const SYMBOL_PATTERNS = [
  // TypeScript/JavaScript: function declarations, arrow functions assigned to const/let/var
  { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, kind: 'function' },
  { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>/gm, kind: 'function' },
  // Classes
  { regex: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm, kind: 'class' },
  // Interfaces and types
  { regex: /^(?:export\s+)?interface\s+(\w+)/gm, kind: 'interface' },
  { regex: /^(?:export\s+)?type\s+(\w+)\s*[=<]/gm, kind: 'type' },
  // Enums
  { regex: /^(?:export\s+)?enum\s+(\w+)/gm, kind: 'enum' },
  // Python: def, class
  { regex: /^(?:async\s+)?def\s+(\w+)/gm, kind: 'function' },
  // Rust: fn, struct, enum, trait
  { regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm, kind: 'function' },
  { regex: /^(?:pub\s+)?struct\s+(\w+)/gm, kind: 'class' },
  { regex: /^(?:pub\s+)?trait\s+(\w+)/gm, kind: 'interface' },
  // Go: func
  { regex: /^func\s+(?:\([^)]*\)\s+)?(\w+)/gm, kind: 'function' },
]

interface SymbolResult {
  name: string
  kind: string
  fileName: string
  filePath: string
  lineNumber: number
}

function extractSymbols(content: string, fileName: string, filePath: string): SymbolResult[] {
  const results: SymbolResult[] = []

  for (const pattern of SYMBOL_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
    let match
    while ((match = regex.exec(content)) !== null) {
      const symbolName = match[1]
      const beforeMatch = content.slice(0, match.index)
      const lineNumber = beforeMatch.split('\n').length
      if (!results.some(r => r.name === symbolName && r.lineNumber === lineNumber)) {
        results.push({
          name: symbolName,
          kind: pattern.kind,
          fileName,
          filePath,
          lineNumber,
        })
      }
    }
  }

  return results
}

// ── Help mode items ────────────────────────────────────────────────────
function getHelpItems(onClose: () => void): PaletteItem[] {
  return [
    {
      id: 'help-files',
      label: 'Search files by name',
      category: 'help' as const,
      icon: <FileText size={14} style={{ color: '#75beff' }} />,
      description: 'Just start typing',
      badge: 'default',
      action: () => {},
    },
    {
      id: 'help-commands',
      label: 'Run a command',
      category: 'help' as const,
      icon: <ChevronRight size={14} style={{ color: '#b180d7' }} />,
      description: 'Type ">" to enter command mode',
      badge: '>',
      action: () => {},
    },
    {
      id: 'help-symbols',
      label: 'Search workspace symbols',
      category: 'help' as const,
      icon: <Hash size={14} style={{ color: '#ee9d28' }} />,
      description: 'Type "#" to search symbols across open files',
      badge: '#',
      action: () => {},
    },
    {
      id: 'help-goto-line',
      label: 'Go to a specific line',
      category: 'help' as const,
      icon: <Hash size={14} style={{ color: '#4fc1ff' }} />,
      description: 'Type ":" followed by a line number',
      badge: ':',
      action: () => {},
    },
    {
      id: 'help-help',
      label: 'Show this help',
      category: 'help' as const,
      icon: <HelpCircle size={14} style={{ color: 'var(--text-muted)' }} />,
      description: 'Type "?" to show available modes',
      badge: '?',
      action: () => {},
    },
  ]
}

// ── Get preview snippet from file content ──────────────────────────────
function getFilePreviewSnippet(content: string | undefined, maxLines: number = 5): string {
  if (!content) return ''
  const lines = content.split('\n').slice(0, maxLines)
  return lines.join('\n')
}

export default function CommandPalette({ open, mode = 'files', onClose }: Props) {
  const [query, setQuery] = useState(MODE_PREFIX[mode])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [themeMode, setThemeMode] = useState(mode === 'themes')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const openFiles = useEditorStore((s) => s.openFiles)
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  const fileTree = useFileStore((s) => s.fileTree)
  const allThemes = useThemeStore((s) => s.themes)
  const setTheme = useThemeStore((s) => s.setTheme)
  const activeThemeId = useThemeStore((s) => s.activeThemeId)
  const previewTheme = useThemeStore((s) => s.previewTheme)
  const recentFiles = useRecentFilesStore((s) => s.recentFiles)
  const pinnedTabs = useEditorStore(s => s.pinnedTabs)

  // Determine mode based on prefix
  const isHelpMode = !themeMode && query === '?'
  const isSymbolMode = !themeMode && !isHelpMode && query.startsWith('#')
  const isGotoLineMode = !themeMode && !isHelpMode && query.startsWith(':')
  const isCommandMode = !themeMode && !isHelpMode && !isSymbolMode && !isGotoLineMode && query.startsWith('>')
  const isFileMode = !themeMode && !isHelpMode && !isSymbolMode && !isGotoLineMode && !isCommandMode

  const searchQuery = themeMode
    ? query.trim()
    : isCommandMode ? query.slice(1).trim()
    : isSymbolMode ? query.slice(1).trim()
    : isGotoLineMode ? query.slice(1).trim()
    : isHelpMode ? ''
    : query.trim()

  const dispatch = (event: string, detail?: any) => window.dispatchEvent(new CustomEvent(event, { detail }))

  const openFileAction = (f: { path: string; name: string }) => {
    onClose()
    void openFileInEditor(f.path)
  }

  // Wrap command action with MRU tracking
  const withMRU = useCallback((id: string, action: () => void) => {
    return () => {
      recordMRUUsage(id)
      action()
    }
  }, [])

  // Every command comes from the registry the menus and shortcuts use, so
  // the palette offers nothing they cannot do.
  const commands: PaletteItem[] = useMemo(() => listCommands().map((command) => {
    const Icon = command.icon ?? ChevronRight
    return {
      id: command.id,
      label: `${command.category}: ${command.title}`,
      category: 'command' as const,
      icon: <Icon size={14} />,
      shortcut: command.keybinding,
      group: command.category,
      action: () => {
        // Edit commands act on the focused field; that must not be this input.
        inputRef.current?.blur()
        onClose()
        runCommand(command.id)
      },
    }
  }), [onClose])

  // Wrap commands with MRU tracking
  const commandsWithMRU: PaletteItem[] = useMemo(() => {
    return commands.map(cmd => ({
      ...cmd,
      action: withMRU(cmd.id, cmd.action),
    }))
  }, [commands, withMRU])

  // Sort commands by MRU frequency
  const mruSortedCommands: PaletteItem[] = useMemo(() => {
    const counts = getMRUCounts()
    return [...commandsWithMRU].sort((a, b) => {
      const ca = counts[a.id] || 0
      const cb = counts[b.id] || 0
      return cb - ca
    })
  }, [commandsWithMRU])

  // File items with prioritization and badges
  const fileItems: PaletteItem[] = useMemo(() => {
    const allFiles = flattenFiles(fileTree)
    const openTabPaths = new Set(openFiles.map(f => f.path))
    const recentPaths = new Set(recentFiles.map(f => f.path))
    const pinnedSet = new Set(pinnedTabs)
    const modifiedSet = new Set(openFiles.filter(f => f.isModified).map(f => f.path))

    const makeItem = (f: { name: string; path: string }, badge?: string, content?: string): PaletteItem => {
      // Compute multiple badges
      const badges: string[] = []
      if (pinnedSet.has(f.path)) badges.push('pinned')
      if (modifiedSet.has(f.path)) badges.push('modified')
      if (badge === 'open') badges.push('open')
      else if (badge === 'recent') badges.push('recent')

      // File size from content if available
      const fileSize = content ? new Blob([content]).size : undefined

      return {
        id: f.path,
        label: f.name,
        category: 'file' as const,
        icon: <FileIcon fileName={f.name} size={14} />,
        badge,
        badges,
        description: getParentDir(f.path),
        filePath: f.path,
        fileSize,
        previewSnippet: content ? getFilePreviewSnippet(content) : undefined,
        action: () => openFileAction(f),
        group: badge === 'open' ? 'Open Editors' : badge === 'recent' ? 'Recently Opened' : 'Workspace',
      }
    }

    // Open tabs (currently open in editor)
    const openTabItems = openFiles.map(f => makeItem(
      { name: f.name, path: f.path },
      'open',
      f.content
    ))

    // Recent files that are NOT currently open
    const recentOnlyItems = recentFiles
      .filter(f => !openTabPaths.has(f.path))
      .map(f => makeItem(f, 'recent'))

    // Workspace files that are NOT open and NOT recent
    const workspaceOnlyItems = allFiles
      .filter(f => !openTabPaths.has(f.path) && !recentPaths.has(f.path))
      .map(f => makeItem(f))

    return [...openTabItems, ...recentOnlyItems, ...workspaceOnlyItems]
  }, [fileTree, onClose, openFiles, recentFiles, pinnedTabs])

  // Symbol search items (# mode) with kind icons
  const symbolItems: PaletteItem[] = useMemo(() => {
    if (!isSymbolMode) return []

    const symbols: SymbolResult[] = []
    for (const file of openFiles) {
      if (file.content) {
        symbols.push(...extractSymbols(file.content, file.name, file.path))
      }
    }

    // Group symbols by kind
    const kindOrder = ['class', 'interface', 'enum', 'type', 'function', 'variable']

    return symbols
      .sort((a, b) => {
        const ai = kindOrder.indexOf(a.kind)
        const bi = kindOrder.indexOf(b.kind)
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      })
      .map(sym => ({
        id: `symbol-${sym.filePath}-${sym.name}-${sym.lineNumber}`,
        label: sym.name,
        category: 'symbol' as const,
        icon: <SymbolKindIcon kind={sym.kind} size={14} />,
        description: `${sym.fileName}:${sym.lineNumber}`,
        badge: sym.kind,
        symbolKind: sym.kind,
        group: sym.kind.charAt(0).toUpperCase() + sym.kind.slice(1) + 's',
        action: () => {
          const file = openFiles.find(f => f.path === sym.filePath)
          if (file) {
            useEditorStore.getState().setActiveFile(sym.filePath)
            setTimeout(() => {
              dispatch('orion:go-to-line', { line: sym.lineNumber })
            }, 50)
          }
          onClose()
        },
      }))
  }, [isSymbolMode, openFiles, onClose])

  // Go to line items (: mode)
  const gotoLineItems: PaletteItem[] = useMemo(() => {
    if (!isGotoLineMode) return []

    const lineNum = parseInt(searchQuery, 10)
    const activeFile = openFiles.find(f => f.path === activeFilePath)
    const totalLines = activeFile?.content?.split('\n').length ?? 0

    if (!activeFile) {
      return [{
        id: 'goto-line-no-file',
        label: 'No active editor',
        category: 'goto-line' as const,
        icon: <Hash size={14} />,
        description: 'Open a file first',
        action: () => {},
      }]
    }

    if (!searchQuery) {
      return [{
        id: 'goto-line-prompt',
        label: `Type a line number (1 - ${totalLines})`,
        category: 'goto-line' as const,
        icon: <Hash size={14} />,
        description: activeFile.name,
        action: () => {},
      }]
    }

    if (isNaN(lineNum) || lineNum < 1) {
      return [{
        id: 'goto-line-invalid',
        label: 'Enter a valid line number',
        category: 'goto-line' as const,
        icon: <Hash size={14} />,
        description: activeFile.name,
        action: () => {},
      }]
    }

    const clampedLine = Math.min(lineNum, totalLines)
    return [{
      id: `goto-line-${clampedLine}`,
      label: `Go to Line ${clampedLine}`,
      category: 'goto-line' as const,
      icon: <Hash size={14} />,
      description: `${activeFile.name} (${totalLines} lines)`,
      action: () => {
        dispatch('orion:go-to-line', { line: clampedLine })
        onClose()
      },
    }]
  }, [isGotoLineMode, searchQuery, openFiles, activeFilePath, onClose])

  // Help mode items
  const helpItems: PaletteItem[] = useMemo(() => {
    if (!isHelpMode) return []
    return getHelpItems(onClose)
  }, [isHelpMode, onClose])

  // Theme picker items (shown in theme-mode)
  const themeItems: PaletteItem[] = useMemo(() => {
    return allThemes.map((t) => ({
      id: `theme-${t.id}`,
      label: `${t.name}${t.id === activeThemeId ? '  (active)' : ''}`,
      category: 'command' as const,
      icon: <Palette size={14} />,
      badge: t.type,
      action: () => { setTheme(t.id); onClose() },
    }))
  }, [allThemes, activeThemeId, setTheme, onClose])

  const items = useMemo(() => {
    const source = themeMode
      ? themeItems
      : isHelpMode
        ? helpItems
        : isGotoLineMode
          ? gotoLineItems
          : isSymbolMode
            ? symbolItems
            : isFileMode
              ? fileItems
              : mruSortedCommands

    if (!searchQuery) return source.slice(0, 30)

    // For goto-line mode, items are already computed based on query
    if (isGotoLineMode) return source
    // Help mode shows all items
    if (isHelpMode) return source

    const lower = searchQuery.toLowerCase()

    // Score with fuzzy match indices
    const scored = source
      .map(item => {
        const labelMatch = fuzzyMatchWithIndices(item.label, lower)
        const descMatch = item.description ? fuzzyMatchWithIndices(item.description, lower) : { matches: false, indices: [] }

        if (!labelMatch.matches && !descMatch.matches) return null

        const ll = item.label.toLowerCase()
        let score = 0
        if (ll === lower) score = 100
        else if (ll.startsWith(lower)) score = 80
        else if (ll.includes(lower)) score = 60
        else if (item.description?.toLowerCase().includes(lower)) score = 40
        else score = 30 // fuzzy only

        // Boost open tabs and recent files when searching
        if (isFileMode && item.badge === 'open') score += 5
        else if (isFileMode && item.badge === 'recent') score += 3

        // Boost by MRU frequency for commands
        if (isCommandMode) {
          const counts = getMRUCounts()
          const freq = counts[item.id] || 0
          if (freq > 0) score += Math.min(freq * 2, 20)
        }

        return {
          item: {
            ...item,
            matchIndices: labelMatch.matches ? labelMatch.indices : undefined,
          },
          score,
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.score - a.score)

    return scored.map(s => s.item).slice(0, 30)
  }, [themeMode, isFileMode, isSymbolMode, isGotoLineMode, isHelpMode, searchQuery, themeItems, fileItems, mruSortedCommands, symbolItems, gotoLineItems, helpItems])

  // Compute grouped items for section headers
  const groupedItems = useMemo(() => {
    // Only group when not searching (grouping on filtered results is noisy)
    const shouldGroup = !searchQuery && (isFileMode || isCommandMode || isSymbolMode)

    if (!shouldGroup) {
      return items.map(item => ({ type: 'item' as const, item }))
    }

    const result: Array<{ type: 'header'; label: string } | { type: 'item'; item: PaletteItem }> = []
    let lastGroup = ''

    for (const item of items) {
      const group = item.group || ''
      if (group && group !== lastGroup) {
        result.push({ type: 'header', label: group })
        lastGroup = group
      }
      result.push({ type: 'item', item })
    }

    return result
  }, [items, searchQuery, isFileMode, isCommandMode, isSymbolMode])

  // Build flat item index for keyboard navigation (skipping headers)
  const flatItems = useMemo(() => {
    return groupedItems.filter((e): e is { type: 'item'; item: PaletteItem } => e.type === 'item').map(e => e.item)
  }, [groupedItems])

  // Compute preview snippet for selected file item
  const selectedPreview = useMemo(() => {
    const selected = flatItems[selectedIndex]
    if (!selected) return null
    if (selected.category === 'file' && selected.previewSnippet) {
      return selected.previewSnippet
    }
    // For files without pre-loaded content, try to find from open files
    if (selected.category === 'file' && selected.filePath) {
      const openF = openFiles.find(f => f.path === selected.filePath)
      if (openF?.content) {
        return getFilePreviewSnippet(openF.content)
      }
    }
    return null
  }, [flatItems, selectedIndex, openFiles])

  useEffect(() => {
    if (open) {
      setQuery(MODE_PREFIX[mode])
      setSelectedIndex(0)
      setThemeMode(mode === 'themes')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, mode])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    // Scroll the selected item into view within the list
    if (!listRef.current) return
    let itemIdx = 0
    for (const child of Array.from(listRef.current.children)) {
      if (child.getAttribute('data-type') === 'header') continue
      if (itemIdx === selectedIndex) {
        ;(child as HTMLElement).scrollIntoView({ block: 'nearest' })
        break
      }
      itemIdx++
    }
  }, [selectedIndex])

  // Live-preview theme when navigating in theme mode
  useEffect(() => {
    if (themeMode && items[selectedIndex]) {
      const item = items[selectedIndex]
      const themeId = item.id.replace('theme-', '')
      previewTheme(themeId)
    }
  }, [selectedIndex, themeMode, items, previewTheme])

  // Revert preview when leaving theme mode or closing palette
  useEffect(() => {
    if (!open || !themeMode) {
      previewTheme(null)
    }
  }, [open, themeMode, previewTheme])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { previewTheme(null); onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, flatItems.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter' && flatItems[selectedIndex]) {
      flatItems[selectedIndex].action()
    }
  }

  const getPlaceholder = () => {
    if (themeMode) return 'Select a color theme...'
    if (isHelpMode) return 'Available command palette modes'
    if (isSymbolMode) return 'Search symbols in open files...'
    if (isGotoLineMode) return 'Type a line number to go to...'
    if (isCommandMode) return 'Type a command...'
    return 'Search files (> commands, # symbols, : line, ? help)'
  }

  const getInputIcon = () => {
    if (themeMode) return <Palette size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
    if (isHelpMode) return <HelpCircle size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
    if (isSymbolMode) return <Hash size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
    if (isGotoLineMode) return <Hash size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
    if (isCommandMode) return <ChevronRight size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
    return <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
  }

  if (!open) return null

  // Track the item index for mapping grouped entries to the flat index
  let itemCounter = 0

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', justifyContent: 'center',
        paddingTop: 80,
      }}
      onClick={onClose}
    >
      <div
        className="anim-scale-in"
        onClick={e => e.stopPropagation()}
        style={{
          width: 580, maxHeight: selectedPreview ? 500 : 400,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-bright)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
        }}>
          {getInputIcon()}
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={getPlaceholder()}
            style={{
              flex: 1, background: 'transparent',
              border: 'none', outline: 'none',
              fontSize: 13, color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
            }}
          />
          {isFileMode && searchQuery && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
              {flatItems.length} result{flatItems.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} style={{
          flex: 1, overflowY: 'auto',
          padding: '4px 0',
        }}>
          {flatItems.length === 0 ? (
            <div style={{
              padding: '24px 16px', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: 12,
            }}>
              {isHelpMode ? 'Type a prefix to activate a mode' : isSymbolMode ? 'No symbols found in open files' : 'No results found'}
            </div>
          ) : (
            (() => {
              itemCounter = 0
              return groupedItems.map((entry, rawIdx) => {
                if (entry.type === 'header') {
                  return (
                    <SectionHeader key={`header-${entry.label}-${rawIdx}`} label={entry.label} />
                  )
                }

                const item = entry.item
                const currentItemIdx = itemCounter
                itemCounter++

                return (
                  <div
                    key={item.id}
                    data-type="item"
                    onClick={item.action}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 14px',
                      cursor: 'pointer',
                      background: currentItemIdx === selectedIndex ? 'var(--bg-active)' : 'transparent',
                      color: currentItemIdx === selectedIndex ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontSize: 13,
                    }}
                    onMouseEnter={() => setSelectedIndex(currentItemIdx)}
                  >
                    <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                      {item.icon}
                    </span>

                    {/* Main label area */}
                    <span className="truncate" style={{ flex: 1, display: 'flex', flexDirection: item.category === 'file' ? 'column' : 'row', alignItems: item.category === 'file' ? 'flex-start' : 'center', gap: item.category === 'file' ? 1 : 6, minWidth: 0 }}>
                      {/* Label with fuzzy match highlighting */}
                      <HighlightedText
                        text={item.label}
                        indices={item.matchIndices}
                        style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      />

                      {/* File path shown dimmed below filename */}
                      {item.category === 'file' && item.description && (
                        <span style={{
                          fontSize: 11, opacity: 0.4, overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap', maxWidth: '100%', lineHeight: 1.2,
                        }}>
                          {item.description}
                        </span>
                      )}

                      {item.category === 'symbol' && item.description && (
                        <span style={{ fontSize: 11, opacity: 0.5, flexShrink: 0 }}>
                          — {item.description}
                        </span>
                      )}
                      {item.category === 'goto-line' && item.description && (
                        <span style={{ fontSize: 11, opacity: 0.5 }}>
                          {item.description}
                        </span>
                      )}
                      {item.category === 'help' && item.description && (
                        <span style={{ fontSize: 11, opacity: 0.5 }}>
                          — {item.description}
                        </span>
                      )}
                    </span>

                    {/* File size info */}
                    {item.category === 'file' && item.fileSize != null && (
                      <span style={{
                        fontSize: 10, color: 'var(--text-muted)', opacity: 0.5,
                        flexShrink: 0, fontFamily: 'var(--font-mono, monospace)',
                      }}>
                        {formatFileSize(item.fileSize)}
                      </span>
                    )}

                    {/* Result badges for files */}
                    {item.category === 'file' && item.badges && item.badges.length > 0 && (
                      <span style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                        {item.badges.includes('pinned') && (
                          <span style={{
                            fontSize: 9, color: '#ee9d28',
                            background: 'rgba(238,157,40,0.12)',
                            padding: '1px 5px', borderRadius: 3,
                            display: 'flex', alignItems: 'center', gap: 2,
                          }}>
                            <Pin size={8} /> pinned
                          </span>
                        )}
                        {item.badges.includes('modified') && (
                          <span style={{
                            fontSize: 9, color: '#e5c07b',
                            background: 'rgba(229,192,123,0.12)',
                            padding: '1px 5px', borderRadius: 3,
                          }}>
                            modified
                          </span>
                        )}
                        {item.badges.includes('open') && !item.badges.includes('modified') && !item.badges.includes('pinned') && (
                          <span style={{
                            fontSize: 10, color: 'var(--accent)', opacity: 0.7,
                            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3,
                          }}>
                            <Eye size={10} /> open
                          </span>
                        )}
                        {item.badges.includes('recent') && (
                          <span style={{
                            fontSize: 10, color: 'var(--text-muted)', opacity: 0.7,
                            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3,
                          }}>
                            <Clock size={10} /> recent
                          </span>
                        )}
                      </span>
                    )}

                    {/* Legacy badge rendering for non-file items */}
                    {item.badge === 'open' && item.category !== 'file' && (
                      <span style={{
                        fontSize: 10, color: 'var(--accent)', opacity: 0.7,
                        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3,
                      }}>
                        <Eye size={10} /> open
                      </span>
                    )}
                    {item.badge === 'recent' && item.category !== 'file' && (
                      <span style={{
                        fontSize: 10, color: 'var(--text-muted)', opacity: 0.7,
                        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3,
                      }}>
                        <Clock size={10} /> recent
                      </span>
                    )}
                    {item.badge && item.category === 'symbol' && (
                      <span style={{
                        fontSize: 9, color: 'var(--text-muted)',
                        background: 'var(--bg-tertiary)',
                        padding: '1px 5px', borderRadius: 3,
                        flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.5px',
                      }}>
                        {item.badge}
                      </span>
                    )}
                    {/* Help mode prefix badges */}
                    {item.category === 'help' && item.badge && (
                      <span style={{
                        fontSize: 11, color: 'var(--accent)',
                        background: 'var(--bg-tertiary)',
                        padding: '1px 7px', borderRadius: 3,
                        flexShrink: 0, fontFamily: 'var(--font-mono, monospace)',
                        fontWeight: 600,
                      }}>
                        {item.badge}
                      </span>
                    )}
                    {item.shortcut && (
                      <span className="kbd">{item.shortcut}</span>
                    )}
                  </div>
                )
              })
            })()
          )}
        </div>

        {/* Quick open preview panel */}
        {selectedPreview && isFileMode && (
          <PreviewPanel snippet={selectedPreview} />
        )}

        {/* Footer hint */}
        <div style={{
          padding: '6px 14px',
          borderTop: '1px solid var(--border)',
          display: 'flex', gap: 12,
          fontSize: 11, color: 'var(--text-muted)',
        }}>
          <span><span className="kbd" style={{ marginRight: 4 }}>↑↓</span> navigate</span>
          <span><span className="kbd" style={{ marginRight: 4 }}>↵</span> select</span>
          <span><span className="kbd" style={{ marginRight: 4 }}>esc</span> close</span>
          {!isHelpMode && <span><span className="kbd" style={{ marginRight: 4 }}>?</span> help</span>}
        </div>
      </div>
    </div>
  )
}
