import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Search, FileText, Settings, Terminal, FolderOpen, MessageSquare, Zap, ChevronRight, Columns, Eye, EyeOff, Type, Minus, Plus, GitBranch, Paintbrush, WrapText, Map, PanelLeft, PanelBottom, X, Save, RotateCcw, RotateCw, Scissors, Copy, Clipboard, Keyboard, MousePointer, CaseSensitive, ArrowUpDown, ArrowDownUp, Merge, MessageSquareCode, Braces, ChevronsDownUp, ChevronsUpDown, Palette, Code, Rows2, Link2, GitCompare, Hash, Eraser, Bug, Maximize2, Clock, ArrowLeftRight, FilePlus, FolderOpenDot, SaveAll, Undo2, Redo2, FileSearch, CheckSquare, Activity, PanelTop, Fullscreen, ZoomIn, ZoomOut, Navigation, Milestone, AlertTriangle, ArrowUp, ArrowDown, Indent, Outdent, Trash2, SplitSquareVertical, XCircle, GitCommitHorizontal, Upload, Download, RefreshCw, Archive, Brain, TestTube, Wand2, Languages, HelpCircle, Pin, GitPullRequest, Circle, Diamond, Triangle, Square, Star, Hexagon, Bookmark } from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { useThemeStore } from '@/store/theme'
import { useRecentFilesStore } from '@/store/recentFiles'
import FileIcon from '@/components/FileIcon'

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
  onClose: () => void
  onOpenSettings: () => void
}

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

export default function CommandPalette({ open, onClose, onOpenSettings }: Props) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [themeMode, setThemeMode] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { openFile, openFiles, activeFilePath } = useEditorStore()
  const { fileTree } = useFileStore()
  const { themes: allThemes, setTheme, activeThemeId, previewTheme } = useThemeStore()
  const { recentFiles } = useRecentFilesStore()
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

  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
    json: 'json', md: 'markdown', css: 'css', html: 'html', py: 'python',
    rs: 'rust', go: 'go', java: 'java', yml: 'yaml', yaml: 'yaml',
    scss: 'scss', less: 'less', vue: 'vue', sh: 'shell', bash: 'shell',
    toml: 'toml', xml: 'xml', svg: 'xml', sql: 'sql', graphql: 'graphql',
  }

  const openFileAction = (f: { path: string; name: string }) => {
    window.api?.readFile(f.path).then((result: any) => {
      const content = typeof result === 'string' ? result : result?.content || ''
      const ext = f.name.split('.').pop() || ''
      openFile({
        path: f.path, name: f.name, content,
        language: result?.language || langMap[ext] || ext,
        isModified: false, aiModified: false,
      })
    })
    onClose()
  }

  // Wrap command action with MRU tracking
  const withMRU = useCallback((id: string, action: () => void) => {
    return () => {
      recordMRUUsage(id)
      action()
    }
  }, [])

  const commands: PaletteItem[] = useMemo(() => [
    // ── File commands ──────────────────────────────────────────────────
    { id: 'new-file', label: 'File: New File', category: 'command' as const, icon: <FilePlus size={14} />, shortcut: 'Ctrl+N', action: () => { dispatch('orion:new-file'); onClose() }, group: 'File' },
    { id: 'new-window', label: 'File: New Window', category: 'command' as const, icon: <Maximize2 size={14} />, shortcut: 'Ctrl+Shift+N', action: () => { dispatch('orion:new-window'); onClose() }, group: 'File' },
    { id: 'open-file', label: 'File: Open File', category: 'command' as const, icon: <FolderOpenDot size={14} />, shortcut: 'Ctrl+O', action: () => { window.api?.openFile?.(); onClose() }, group: 'File' },
    { id: 'open-folder', label: 'File: Open Folder', category: 'command' as const, icon: <FolderOpen size={14} />, shortcut: 'Ctrl+K Ctrl+O', action: () => { window.api?.openFolder(); onClose() }, group: 'File' },
    { id: 'save', label: 'File: Save', category: 'command' as const, icon: <Save size={14} />, shortcut: 'Ctrl+S', action: () => { dispatch('orion:save-file'); onClose() }, group: 'File' },
    { id: 'save-as', label: 'File: Save As...', category: 'command' as const, icon: <Save size={14} />, shortcut: 'Ctrl+Shift+S', action: () => { dispatch('orion:save-file-as'); onClose() }, group: 'File' },
    { id: 'save-all', label: 'File: Save All', category: 'command' as const, icon: <SaveAll size={14} />, shortcut: 'Ctrl+K S', action: () => { dispatch('orion:save-all'); onClose() }, group: 'File' },
    { id: 'close-tab', label: 'File: Close Tab', category: 'command' as const, icon: <X size={14} />, shortcut: 'Ctrl+W', action: () => { dispatch('orion:close-tab'); onClose() }, group: 'File' },
    { id: 'close-all', label: 'File: Close All Tabs', category: 'command' as const, icon: <X size={14} />, action: () => { dispatch('orion:close-all-tabs'); onClose() }, group: 'File' },
    { id: 'revert-file', label: 'File: Revert File', category: 'command' as const, icon: <RotateCcw size={14} />, action: () => { dispatch('orion:revert-file'); onClose() }, group: 'File' },

    // ── Edit commands ──────────────────────────────────────────────────
    { id: 'undo', label: 'Edit: Undo', category: 'command' as const, icon: <Undo2 size={14} />, shortcut: 'Ctrl+Z', action: () => { dispatch('orion:undo'); onClose() }, group: 'Edit' },
    { id: 'redo', label: 'Edit: Redo', category: 'command' as const, icon: <Redo2 size={14} />, shortcut: 'Ctrl+Y', action: () => { dispatch('orion:redo'); onClose() }, group: 'Edit' },
    { id: 'cut', label: 'Edit: Cut', category: 'command' as const, icon: <Scissors size={14} />, shortcut: 'Ctrl+X', action: () => { document.execCommand('cut'); onClose() }, group: 'Edit' },
    { id: 'copy', label: 'Edit: Copy', category: 'command' as const, icon: <Copy size={14} />, shortcut: 'Ctrl+C', action: () => { document.execCommand('copy'); onClose() }, group: 'Edit' },
    { id: 'paste', label: 'Edit: Paste', category: 'command' as const, icon: <Clipboard size={14} />, shortcut: 'Ctrl+V', action: () => { document.execCommand('paste'); onClose() }, group: 'Edit' },
    { id: 'find', label: 'Edit: Find', category: 'command' as const, icon: <Search size={14} />, shortcut: 'Ctrl+F', action: () => { dispatch('orion:editor-find'); onClose() }, group: 'Edit' },
    { id: 'replace', label: 'Edit: Replace', category: 'command' as const, icon: <Search size={14} />, shortcut: 'Ctrl+H', action: () => { dispatch('orion:editor-replace'); onClose() }, group: 'Edit' },
    { id: 'find-in-files', label: 'Edit: Find in Files', category: 'command' as const, icon: <FileSearch size={14} />, shortcut: 'Ctrl+Shift+F', action: () => { dispatch('orion:show-search'); onClose() }, group: 'Edit' },
    { id: 'select-all', label: 'Edit: Select All', category: 'command' as const, icon: <CheckSquare size={14} />, shortcut: 'Ctrl+A', action: () => { document.execCommand('selectAll'); onClose() }, group: 'Edit' },

    // ── View commands ──────────────────────────────────────────────────
    { id: 'toggle-sidebar', label: 'View: Toggle Sidebar', category: 'command' as const, icon: <PanelLeft size={14} />, shortcut: 'Ctrl+B', action: () => { dispatch('orion:toggle-sidebar'); onClose() }, group: 'View' },
    { id: 'toggle-panel', label: 'View: Toggle Panel', category: 'command' as const, icon: <PanelBottom size={14} />, shortcut: 'Ctrl+J', action: () => { dispatch('orion:toggle-terminal'); onClose() }, group: 'View' },
    { id: 'toggle-activity-bar', label: 'View: Toggle Activity Bar', category: 'command' as const, icon: <Activity size={14} />, action: () => { dispatch('orion:toggle-activity-bar'); onClose() }, group: 'View' },
    { id: 'toggle-status-bar', label: 'View: Toggle Status Bar', category: 'command' as const, icon: <PanelTop size={14} />, action: () => { dispatch('orion:toggle-status-bar'); onClose() }, group: 'View' },
    { id: 'toggle-minimap', label: 'View: Toggle Minimap', category: 'command' as const, icon: <Map size={14} />, action: () => { dispatch('orion:toggle-minimap'); onClose() }, group: 'View' },
    { id: 'toggle-wordwrap', label: 'View: Toggle Word Wrap', category: 'command' as const, icon: <WrapText size={14} />, shortcut: 'Alt+Z', action: () => { dispatch('orion:toggle-wordwrap'); onClose() }, group: 'View' },
    { id: 'toggle-zen-mode', label: 'View: Toggle Zen Mode', category: 'command' as const, icon: <Maximize2 size={14} />, shortcut: 'Ctrl+K Z', action: () => { dispatch('orion:toggle-zen-mode'); onClose() }, group: 'View' },
    { id: 'toggle-fullscreen', label: 'View: Toggle Full Screen', category: 'command' as const, icon: <Fullscreen size={14} />, shortcut: 'F11', action: () => { dispatch('orion:toggle-fullscreen'); onClose() }, group: 'View' },
    { id: 'zoom-in', label: 'View: Zoom In', category: 'command' as const, icon: <ZoomIn size={14} />, shortcut: 'Ctrl+=', action: () => { dispatch('orion:font-increase'); onClose() }, group: 'View' },
    { id: 'zoom-out', label: 'View: Zoom Out', category: 'command' as const, icon: <ZoomOut size={14} />, shortcut: 'Ctrl+-', action: () => { dispatch('orion:font-decrease'); onClose() }, group: 'View' },
    { id: 'zoom-reset', label: 'View: Reset Zoom', category: 'command' as const, icon: <Type size={14} />, shortcut: 'Ctrl+0', action: () => { dispatch('orion:font-reset'); onClose() }, group: 'View' },
    { id: 'toggle-terminal', label: 'View: Toggle Terminal', category: 'command' as const, icon: <Terminal size={14} />, shortcut: 'Ctrl+`', action: () => { dispatch('orion:toggle-terminal'); onClose() }, group: 'View' },
    { id: 'toggle-chat', label: 'View: Toggle Chat Panel', category: 'command' as const, icon: <MessageSquare size={14} />, shortcut: 'Ctrl+L', action: () => { dispatch('orion:toggle-chat'); onClose() }, group: 'View' },
    { id: 'show-explorer', label: 'View: Show Explorer', category: 'command' as const, icon: <FileText size={14} />, shortcut: 'Ctrl+Shift+E', action: () => { dispatch('orion:show-explorer'); onClose() }, group: 'View' },
    { id: 'show-search', label: 'View: Show Search', category: 'command' as const, icon: <Search size={14} />, shortcut: 'Ctrl+Shift+F', action: () => { dispatch('orion:show-search'); onClose() }, group: 'View' },
    { id: 'show-git', label: 'View: Show Source Control', category: 'command' as const, icon: <GitBranch size={14} />, shortcut: 'Ctrl+Shift+G', action: () => { dispatch('orion:show-git'); onClose() }, group: 'View' },
    { id: 'show-agents', label: 'View: Show Agents', category: 'command' as const, icon: <Zap size={14} />, action: () => { dispatch('orion:show-agents'); onClose() }, group: 'View' },
    { id: 'toggle-timeline', label: 'View: Toggle Timeline', category: 'command' as const, icon: <Clock size={14} />, action: () => { dispatch('orion:toggle-timeline'); onClose() }, group: 'View' },

    // ── Go commands ────────────────────────────────────────────────────
    { id: 'go-to-file', label: 'Go to File...', category: 'command' as const, icon: <FileText size={14} />, shortcut: 'Ctrl+P', action: () => { onClose(); setTimeout(() => dispatch('orion:open-command-palette', { mode: 'file' }), 50) }, group: 'Go' },
    { id: 'go-to-symbol', label: 'Go to Symbol (#)', category: 'command' as const, icon: <Hash size={14} />, shortcut: 'Ctrl+Shift+O', action: () => { onClose(); setTimeout(() => dispatch('orion:open-command-palette', { mode: 'symbol' }), 50) }, group: 'Go' },
    { id: 'go-to-line', label: 'Go to Line (:)', category: 'command' as const, icon: <Hash size={14} />, shortcut: 'Ctrl+G', action: () => { onClose(); setTimeout(() => dispatch('orion:open-command-palette', { mode: 'goto-line' }), 50) }, group: 'Go' },
    { id: 'go-to-definition', label: 'Go to Definition', category: 'command' as const, icon: <Navigation size={14} />, shortcut: 'F12', action: () => { dispatch('orion:go-to-definition'); onClose() }, group: 'Go' },
    { id: 'go-to-references', label: 'Go to References', category: 'command' as const, icon: <Milestone size={14} />, shortcut: 'Shift+F12', action: () => { dispatch('orion:go-to-references'); onClose() }, group: 'Go' },
    { id: 'go-to-next-error', label: 'Go to Next Error', category: 'command' as const, icon: <AlertTriangle size={14} />, shortcut: 'F8', action: () => { dispatch('orion:go-to-next-error'); onClose() }, group: 'Go' },
    { id: 'go-to-prev-error', label: 'Go to Previous Error', category: 'command' as const, icon: <AlertTriangle size={14} />, shortcut: 'Shift+F8', action: () => { dispatch('orion:go-to-prev-error'); onClose() }, group: 'Go' },

    // ── Editor commands ────────────────────────────────────────────────
    { id: 'format', label: 'Editor: Format Document', category: 'command' as const, icon: <Paintbrush size={14} />, shortcut: 'Shift+Alt+F', action: () => { dispatch('orion:format-document'); onClose() }, group: 'Editor' },
    { id: 'toggle-line-comment', label: 'Editor: Toggle Line Comment', category: 'command' as const, icon: <MessageSquareCode size={14} />, shortcut: 'Ctrl+/', action: () => { dispatch('orion:toggle-line-comment'); onClose() }, group: 'Editor' },
    { id: 'toggle-block-comment', label: 'Editor: Toggle Block Comment', category: 'command' as const, icon: <Braces size={14} />, shortcut: 'Ctrl+Shift+/', action: () => { dispatch('orion:toggle-block-comment'); onClose() }, group: 'Editor' },
    { id: 'indent-line', label: 'Editor: Indent Line', category: 'command' as const, icon: <Indent size={14} />, shortcut: 'Ctrl+]', action: () => { dispatch('orion:indent-line'); onClose() }, group: 'Editor' },
    { id: 'outdent-line', label: 'Editor: Outdent Line', category: 'command' as const, icon: <Outdent size={14} />, shortcut: 'Ctrl+[', action: () => { dispatch('orion:outdent-line'); onClose() }, group: 'Editor' },
    { id: 'move-line-up', label: 'Editor: Move Line Up', category: 'command' as const, icon: <ArrowUp size={14} />, shortcut: 'Alt+Up', action: () => { dispatch('orion:move-line-up'); onClose() }, group: 'Editor' },
    { id: 'move-line-down', label: 'Editor: Move Line Down', category: 'command' as const, icon: <ArrowDown size={14} />, shortcut: 'Alt+Down', action: () => { dispatch('orion:move-line-down'); onClose() }, group: 'Editor' },
    { id: 'duplicate-lines', label: 'Editor: Duplicate Lines', category: 'command' as const, icon: <Copy size={14} />, shortcut: 'Shift+Alt+Down', action: () => { dispatch('orion:duplicate-selection'); onClose() }, group: 'Editor' },
    { id: 'delete-line', label: 'Editor: Delete Line', category: 'command' as const, icon: <Trash2 size={14} />, shortcut: 'Ctrl+Shift+K', action: () => { dispatch('orion:delete-line'); onClose() }, group: 'Editor' },
    { id: 'sort-lines-asc', label: 'Editor: Sort Lines Ascending', category: 'command' as const, icon: <ArrowUpDown size={14} />, action: () => { dispatch('orion:sort-lines-asc'); onClose() }, group: 'Editor' },
    { id: 'sort-lines-desc', label: 'Editor: Sort Lines Descending', category: 'command' as const, icon: <ArrowDownUp size={14} />, action: () => { dispatch('orion:sort-lines-desc'); onClose() }, group: 'Editor' },
    { id: 'join-lines', label: 'Editor: Join Lines', category: 'command' as const, icon: <Merge size={14} />, action: () => { dispatch('orion:join-lines'); onClose() }, group: 'Editor' },
    { id: 'trim-whitespace', label: 'Editor: Trim Trailing Whitespace', category: 'command' as const, icon: <Eraser size={14} />, action: () => { dispatch('orion:trim-whitespace'); onClose() }, group: 'Editor' },
    // Split / Compare
    { id: 'split-editor', label: 'Editor: Split Editor Right', category: 'command' as const, icon: <Columns size={14} />, shortcut: 'Ctrl+\\', action: () => { dispatch('orion:split-editor-right'); onClose() }, group: 'Editor' },
    { id: 'split-editor-down', label: 'Editor: Split Editor Down', category: 'command' as const, icon: <Rows2 size={14} />, action: () => { dispatch('orion:split-editor-down'); onClose() }, group: 'Editor' },
    { id: 'toggle-split-direction', label: 'Editor: Toggle Split Direction', category: 'command' as const, icon: <ArrowLeftRight size={14} />, action: () => { dispatch('orion:toggle-split-direction'); onClose() }, group: 'Editor' },
    { id: 'toggle-sync-scroll', label: 'Editor: Toggle Sync Scroll', category: 'command' as const, icon: <Link2 size={14} />, action: () => { dispatch('orion:toggle-sync-scroll'); onClose() }, group: 'Editor' },
    { id: 'compare-files', label: 'Editor: Compare Active File With...', category: 'command' as const, icon: <GitCompare size={14} />, action: () => { dispatch('orion:compare-files'); onClose() }, group: 'Editor' },
    // Font size
    { id: 'font-increase', label: 'Editor: Increase Font Size', category: 'command' as const, icon: <Plus size={14} />, shortcut: 'Ctrl+=', action: () => { dispatch('orion:font-increase'); onClose() }, group: 'Editor' },
    { id: 'font-decrease', label: 'Editor: Decrease Font Size', category: 'command' as const, icon: <Minus size={14} />, shortcut: 'Ctrl+-', action: () => { dispatch('orion:font-decrease'); onClose() }, group: 'Editor' },
    { id: 'font-reset', label: 'Editor: Reset Font Size', category: 'command' as const, icon: <Type size={14} />, action: () => { dispatch('orion:font-reset'); onClose() }, group: 'Editor' },
    // Multi-cursor / Selection
    { id: 'add-selection-next', label: 'Editor: Add Selection to Next Find Match', category: 'command' as const, icon: <MousePointer size={14} />, shortcut: 'Ctrl+D', action: () => { dispatch('orion:add-selection-next-match'); onClose() }, group: 'Editor' },
    { id: 'select-all-occurrences', label: 'Editor: Select All Occurrences', category: 'command' as const, icon: <MousePointer size={14} />, shortcut: 'Ctrl+Shift+L', action: () => { dispatch('orion:select-all-occurrences'); onClose() }, group: 'Editor' },
    { id: 'add-cursor-above', label: 'Editor: Add Cursor Above', category: 'command' as const, icon: <MousePointer size={14} />, shortcut: 'Ctrl+Alt+Up', action: () => { dispatch('orion:add-cursor-above'); onClose() }, group: 'Editor' },
    { id: 'add-cursor-below', label: 'Editor: Add Cursor Below', category: 'command' as const, icon: <MousePointer size={14} />, shortcut: 'Ctrl+Alt+Down', action: () => { dispatch('orion:add-cursor-below'); onClose() }, group: 'Editor' },
    { id: 'cursors-to-line-ends', label: 'Editor: Add Cursors to Line Ends', category: 'command' as const, icon: <MousePointer size={14} />, shortcut: 'Shift+Alt+I', action: () => { dispatch('orion:cursors-to-line-ends'); onClose() }, group: 'Editor' },
    { id: 'column-select', label: 'Editor: Column Select Mode', category: 'command' as const, icon: <MousePointer size={14} />, action: () => { dispatch('orion:column-select'); onClose() }, group: 'Editor' },
    // Transform
    { id: 'transform-uppercase', label: 'Editor: Transform to Uppercase', category: 'command' as const, icon: <CaseSensitive size={14} />, action: () => { dispatch('orion:transform-uppercase'); onClose() }, group: 'Editor' },
    { id: 'transform-lowercase', label: 'Editor: Transform to Lowercase', category: 'command' as const, icon: <CaseSensitive size={14} />, action: () => { dispatch('orion:transform-lowercase'); onClose() }, group: 'Editor' },
    { id: 'transform-titlecase', label: 'Editor: Transform to Title Case', category: 'command' as const, icon: <CaseSensitive size={14} />, action: () => { dispatch('orion:transform-titlecase'); onClose() }, group: 'Editor' },
    // Find in Selection
    { id: 'find-in-selection', label: 'Edit: Find in Selection', category: 'command' as const, icon: <Search size={14} />, action: () => { dispatch('orion:find-in-selection'); onClose() }, group: 'Edit' },
    // Folding
    { id: 'fold-all', label: 'Editor: Fold All', category: 'command' as const, icon: <ChevronsDownUp size={14} />, shortcut: 'Ctrl+K Ctrl+0', action: () => { dispatch('orion:fold-all'); onClose() }, group: 'Editor' },
    { id: 'unfold-all', label: 'Editor: Unfold All', category: 'command' as const, icon: <ChevronsUpDown size={14} />, shortcut: 'Ctrl+K Ctrl+J', action: () => { dispatch('orion:unfold-all'); onClose() }, group: 'Editor' },

    // ── Terminal commands ───────────────────────────────────────────────
    { id: 'terminal-new', label: 'Terminal: New Terminal', category: 'command' as const, icon: <Terminal size={14} />, shortcut: 'Ctrl+Shift+`', action: () => { dispatch('orion:new-terminal'); onClose() }, group: 'Terminal' },
    { id: 'terminal-split', label: 'Terminal: Split Terminal', category: 'command' as const, icon: <SplitSquareVertical size={14} />, action: () => { dispatch('orion:split-terminal'); onClose() }, group: 'Terminal' },
    { id: 'terminal-clear', label: 'Terminal: Clear Terminal', category: 'command' as const, icon: <Eraser size={14} />, action: () => { dispatch('orion:clear-terminal'); onClose() }, group: 'Terminal' },
    { id: 'terminal-kill', label: 'Terminal: Kill Terminal', category: 'command' as const, icon: <XCircle size={14} />, action: () => { dispatch('orion:kill-terminal'); onClose() }, group: 'Terminal' },

    // ── Git commands ───────────────────────────────────────────────────
    { id: 'git-stage-all', label: 'Git: Stage All', category: 'command' as const, icon: <Plus size={14} />, action: () => { dispatch('orion:git-stage-all'); onClose() }, group: 'Git' },
    { id: 'git-unstage-all', label: 'Git: Unstage All', category: 'command' as const, icon: <Minus size={14} />, action: () => { dispatch('orion:git-unstage-all'); onClose() }, group: 'Git' },
    { id: 'git-commit', label: 'Git: Commit', category: 'command' as const, icon: <GitCommitHorizontal size={14} />, action: () => { dispatch('orion:git-commit'); onClose() }, group: 'Git' },
    { id: 'git-push', label: 'Git: Push', category: 'command' as const, icon: <Upload size={14} />, action: () => { dispatch('orion:git-push'); onClose() }, group: 'Git' },
    { id: 'git-pull', label: 'Git: Pull', category: 'command' as const, icon: <Download size={14} />, action: () => { dispatch('orion:git-pull'); onClose() }, group: 'Git' },
    { id: 'git-fetch', label: 'Git: Fetch', category: 'command' as const, icon: <RefreshCw size={14} />, action: () => { dispatch('orion:git-fetch'); onClose() }, group: 'Git' },
    { id: 'git-stash', label: 'Git: Stash', category: 'command' as const, icon: <Archive size={14} />, action: () => { dispatch('orion:git-stash'); onClose() }, group: 'Git' },
    { id: 'git-show-log', label: 'Git: Show Log', category: 'command' as const, icon: <GitBranch size={14} />, action: () => { dispatch('orion:show-git'); dispatch('orion:git-show-history'); onClose() }, group: 'Git' },
    { id: 'git-toggle-blame', label: 'Git: Toggle Blame Annotations', category: 'command' as const, icon: <GitBranch size={14} />, action: () => { dispatch('orion:git-toggle-blame'); onClose() }, group: 'Git' },

    // ── AI commands ────────────────────────────────────────────────────
    { id: 'ai-inline-edit', label: 'AI: Inline Edit', category: 'command' as const, icon: <Zap size={14} />, shortcut: 'Ctrl+K', action: () => { dispatch('orion:inline-edit'); onClose() }, group: 'AI' },
    { id: 'ai-explain', label: 'AI: Explain Selection', category: 'command' as const, icon: <Brain size={14} />, action: () => { dispatch('orion:ai-explain-selection'); onClose() }, group: 'AI' },
    { id: 'ai-fix-bugs', label: 'AI: Fix Bugs', category: 'command' as const, icon: <Bug size={14} />, action: () => { dispatch('orion:ai-fix-bugs'); onClose() }, group: 'AI' },
    { id: 'ai-gen-tests', label: 'AI: Generate Tests', category: 'command' as const, icon: <TestTube size={14} />, action: () => { dispatch('orion:ai-generate-tests'); onClose() }, group: 'AI' },
    { id: 'ai-refactor', label: 'AI: Refactor', category: 'command' as const, icon: <Wand2 size={14} />, action: () => { dispatch('orion:ai-refactor'); onClose() }, group: 'AI' },

    // ── Preferences commands ───────────────────────────────────────────
    { id: 'settings', label: 'Preferences: Open Settings', category: 'command' as const, icon: <Settings size={14} />, shortcut: 'Ctrl+,', action: () => { onClose(); onOpenSettings() }, group: 'Preferences' },
    { id: 'shortcuts', label: 'Preferences: Keyboard Shortcuts', category: 'command' as const, icon: <Keyboard size={14} />, shortcut: 'Ctrl+K Ctrl+S', action: () => { onClose(); onOpenSettings() }, group: 'Preferences' },
    { id: 'color-theme', label: 'Preferences: Color Theme', category: 'command' as const, icon: <Palette size={14} />, action: () => { setThemeMode(true); setQuery(''); setSelectedIndex(0) }, group: 'Preferences' },
    { id: 'change-language', label: 'Preferences: Change Language Mode', category: 'command' as const, icon: <Languages size={14} />, action: () => { dispatch('orion:change-language-mode'); onClose() }, group: 'Preferences' },
    { id: 'snippets', label: 'Preferences: Snippets', category: 'command' as const, icon: <Code size={14} />, action: () => { dispatch('orion:open-snippets'); onClose() }, group: 'Preferences' },

    // ── Developer ──────────────────────────────────────────────────────
    { id: 'reload-window', label: 'Developer: Reload Window', category: 'command' as const, icon: <RotateCw size={14} />, action: () => { window.location.reload() }, group: 'Developer' },
    { id: 'toggle-devtools', label: 'Developer: Toggle DevTools', category: 'command' as const, icon: <Bug size={14} />, action: () => { dispatch('orion:toggle-devtools'); onClose() }, group: 'Developer' },
  ], [onClose, onOpenSettings, setThemeMode])

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
  }, [fileTree, openFile, onClose, openFiles, recentFiles, pinnedTabs])

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
      setQuery('')
      setSelectedIndex(0)
      setThemeMode(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

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
