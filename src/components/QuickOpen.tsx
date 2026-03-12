import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  File, Hash, Terminal, ArrowRight, Clock, Pin, Search, Code, Zap,
  ChevronRight, Star, Command, AtSign, Navigation, FileText, Folder,
  X, CornerDownLeft, ArrowUp, ArrowDown, Minus,
} from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { useRecentFilesStore } from '@/store/recentFiles'
import FileIcon from '@/components/FileIcon'
import type { FileNode } from '@shared/types'

// ─── Injected Styles ──────────────────────────────────────────────────────────

const QUICK_OPEN_STYLES = `
@keyframes quickopen-fade-in {
  from { opacity: 0; transform: translateY(-8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes quickopen-backdrop-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes quickopen-fade-out {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to   { opacity: 0; transform: translateY(-6px) scale(0.98); }
}
.quickopen-highlight-char {
  color: #2aaaff;
  font-weight: 600;
}
.quickopen-result-list::-webkit-scrollbar { width: 6px; }
.quickopen-result-list::-webkit-scrollbar-track { background: transparent; }
.quickopen-result-list::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.08);
  border-radius: 3px;
}
.quickopen-result-list::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,0.15);
}
`

let stylesInjected = false
function injectStyles() {
  if (stylesInjected) return
  stylesInjected = true
  const style = document.createElement('style')
  style.textContent = QUICK_OPEN_STYLES
  document.head.appendChild(style)
}

// ─── Types ────────────────────────────────────────────────────────────────────

type QuickOpenMode = 'files' | 'commands' | 'goto-line' | 'symbol' | 'workspace-symbol'

interface QuickOpenItem {
  id: string
  label: string
  description?: string
  detail?: string
  icon?: React.ReactNode
  handler?: () => void
  category?: string
  filePath?: string
  matchIndices?: number[]
  isPinned?: boolean
  score?: number
  symbolKind?: string
  lineNumber?: number
}

interface QuickOpenGroup {
  label: string
  items: QuickOpenItem[]
}

interface Props {
  isOpen: boolean
  onClose: () => void
  mode?: string
  onOpenFile?: (path: string, name: string) => void
  onGotoLine?: (line: number) => void
  onExecuteCommand?: (commandId: string) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RESULTS = 50
const MAX_RECENT = 15
const SEARCH_HISTORY_KEY = 'orion-quickopen-history'
const PINNED_ITEMS_KEY = 'orion-quickopen-pinned'
const MAX_HISTORY = 30

const MODE_PREFIXES: Record<string, QuickOpenMode> = {
  '>': 'commands',
  ':': 'goto-line',
  '@': 'symbol',
  '#': 'workspace-symbol',
}

// ─── Symbol Definitions ───────────────────────────────────────────────────────

interface SymbolInfo {
  name: string
  kind: string
  line: number
  detail?: string
  containerName?: string
}

const SYMBOL_ICONS: Record<string, React.ReactNode> = {
  function: <Code size={14} style={{ color: '#b48ead' }} />,
  method: <Code size={14} style={{ color: '#b48ead' }} />,
  class: <Navigation size={14} style={{ color: '#ebcb8b' }} />,
  interface: <Navigation size={14} style={{ color: '#8fbcbb' }} />,
  variable: <Minus size={14} style={{ color: '#81a1c1' }} />,
  constant: <Minus size={14} style={{ color: '#d08770' }} />,
  property: <Minus size={14} style={{ color: '#a3be8c' }} />,
  type: <Navigation size={14} style={{ color: '#88c0d0' }} />,
  enum: <Hash size={14} style={{ color: '#d08770' }} />,
  module: <Folder size={14} style={{ color: '#dcb67a' }} />,
  namespace: <Folder size={14} style={{ color: '#dcb67a' }} />,
  import: <ArrowRight size={14} style={{ color: '#8b949e' }} />,
  export: <ArrowRight size={14} style={{ color: '#a3be8c' }} />,
}

// ─── Command Definitions ──────────────────────────────────────────────────────

interface CommandDef {
  id: string
  label: string
  category: string
  shortcut?: string
  icon?: React.ReactNode
}

const BUILT_IN_COMMANDS: CommandDef[] = [
  { id: 'file.newFile', label: 'New File', category: 'File', shortcut: 'Ctrl+N', icon: <File size={14} /> },
  { id: 'file.openFile', label: 'Open File...', category: 'File', shortcut: 'Ctrl+O', icon: <Folder size={14} /> },
  { id: 'file.save', label: 'Save', category: 'File', shortcut: 'Ctrl+S', icon: <File size={14} /> },
  { id: 'file.saveAll', label: 'Save All', category: 'File', shortcut: 'Ctrl+K S', icon: <File size={14} /> },
  { id: 'file.closeEditor', label: 'Close Editor', category: 'File', shortcut: 'Ctrl+W', icon: <X size={14} /> },
  { id: 'file.closeAll', label: 'Close All Editors', category: 'File', icon: <X size={14} /> },
  { id: 'edit.undo', label: 'Undo', category: 'Edit', shortcut: 'Ctrl+Z' },
  { id: 'edit.redo', label: 'Redo', category: 'Edit', shortcut: 'Ctrl+Shift+Z' },
  { id: 'edit.cut', label: 'Cut', category: 'Edit', shortcut: 'Ctrl+X' },
  { id: 'edit.copy', label: 'Copy', category: 'Edit', shortcut: 'Ctrl+C' },
  { id: 'edit.paste', label: 'Paste', category: 'Edit', shortcut: 'Ctrl+V' },
  { id: 'edit.find', label: 'Find', category: 'Edit', shortcut: 'Ctrl+F', icon: <Search size={14} /> },
  { id: 'edit.replace', label: 'Find and Replace', category: 'Edit', shortcut: 'Ctrl+H', icon: <Search size={14} /> },
  { id: 'edit.selectAll', label: 'Select All', category: 'Edit', shortcut: 'Ctrl+A' },
  { id: 'view.commandPalette', label: 'Command Palette', category: 'View', shortcut: 'Ctrl+Shift+P', icon: <Command size={14} /> },
  { id: 'view.quickOpen', label: 'Quick Open', category: 'View', shortcut: 'Ctrl+P', icon: <Search size={14} /> },
  { id: 'view.explorer', label: 'Show Explorer', category: 'View', shortcut: 'Ctrl+Shift+E', icon: <Folder size={14} /> },
  { id: 'view.search', label: 'Show Search', category: 'View', shortcut: 'Ctrl+Shift+F', icon: <Search size={14} /> },
  { id: 'view.terminal', label: 'Toggle Terminal', category: 'View', shortcut: 'Ctrl+`', icon: <Terminal size={14} /> },
  { id: 'view.problems', label: 'Show Problems', category: 'View', shortcut: 'Ctrl+Shift+M' },
  { id: 'view.output', label: 'Show Output', category: 'View' },
  { id: 'view.splitEditor', label: 'Split Editor Right', category: 'View', shortcut: 'Ctrl+\\' },
  { id: 'view.toggleSidebar', label: 'Toggle Sidebar', category: 'View', shortcut: 'Ctrl+B' },
  { id: 'view.zoomIn', label: 'Zoom In', category: 'View', shortcut: 'Ctrl+=' },
  { id: 'view.zoomOut', label: 'Zoom Out', category: 'View', shortcut: 'Ctrl+-' },
  { id: 'view.resetZoom', label: 'Reset Zoom', category: 'View', shortcut: 'Ctrl+0' },
  { id: 'editor.formatDocument', label: 'Format Document', category: 'Editor', shortcut: 'Shift+Alt+F', icon: <Code size={14} /> },
  { id: 'editor.toggleWordWrap', label: 'Toggle Word Wrap', category: 'Editor', shortcut: 'Alt+Z' },
  { id: 'editor.toggleMinimap', label: 'Toggle Minimap', category: 'Editor' },
  { id: 'editor.gotoLine', label: 'Go to Line...', category: 'Editor', shortcut: 'Ctrl+G', icon: <Hash size={14} /> },
  { id: 'editor.gotoSymbol', label: 'Go to Symbol in File...', category: 'Editor', shortcut: 'Ctrl+Shift+O', icon: <AtSign size={14} /> },
  { id: 'editor.gotoDefinition', label: 'Go to Definition', category: 'Editor', shortcut: 'F12' },
  { id: 'editor.peekDefinition', label: 'Peek Definition', category: 'Editor', shortcut: 'Alt+F12' },
  { id: 'editor.foldAll', label: 'Fold All', category: 'Editor', shortcut: 'Ctrl+K Ctrl+0' },
  { id: 'editor.unfoldAll', label: 'Unfold All', category: 'Editor', shortcut: 'Ctrl+K Ctrl+J' },
  { id: 'editor.toggleLineComment', label: 'Toggle Line Comment', category: 'Editor', shortcut: 'Ctrl+/' },
  { id: 'editor.toggleBlockComment', label: 'Toggle Block Comment', category: 'Editor', shortcut: 'Shift+Alt+A' },
  { id: 'editor.indentLine', label: 'Indent Line', category: 'Editor', shortcut: 'Ctrl+]' },
  { id: 'editor.outdentLine', label: 'Outdent Line', category: 'Editor', shortcut: 'Ctrl+[' },
  { id: 'editor.moveLinesUp', label: 'Move Lines Up', category: 'Editor', shortcut: 'Alt+Up' },
  { id: 'editor.moveLinesDown', label: 'Move Lines Down', category: 'Editor', shortcut: 'Alt+Down' },
  { id: 'editor.copyLinesUp', label: 'Copy Lines Up', category: 'Editor', shortcut: 'Shift+Alt+Up' },
  { id: 'editor.copyLinesDown', label: 'Copy Lines Down', category: 'Editor', shortcut: 'Shift+Alt+Down' },
  { id: 'editor.transformUppercase', label: 'Transform to Uppercase', category: 'Editor' },
  { id: 'editor.transformLowercase', label: 'Transform to Lowercase', category: 'Editor' },
  { id: 'editor.trimWhitespace', label: 'Trim Trailing Whitespace', category: 'Editor' },
  { id: 'editor.sortLinesAsc', label: 'Sort Lines Ascending', category: 'Editor' },
  { id: 'editor.sortLinesDesc', label: 'Sort Lines Descending', category: 'Editor' },
  { id: 'git.init', label: 'Initialize Repository', category: 'Git' },
  { id: 'git.clone', label: 'Clone Repository...', category: 'Git' },
  { id: 'git.commit', label: 'Commit', category: 'Git' },
  { id: 'git.push', label: 'Push', category: 'Git' },
  { id: 'git.pull', label: 'Pull', category: 'Git' },
  { id: 'git.checkout', label: 'Checkout to...', category: 'Git' },
  { id: 'git.createBranch', label: 'Create Branch...', category: 'Git' },
  { id: 'git.stash', label: 'Stash Changes', category: 'Git' },
  { id: 'git.stashPop', label: 'Pop Stash', category: 'Git' },
  { id: 'terminal.new', label: 'New Terminal', category: 'Terminal', shortcut: 'Ctrl+Shift+`', icon: <Terminal size={14} /> },
  { id: 'terminal.clear', label: 'Clear Terminal', category: 'Terminal' },
  { id: 'terminal.split', label: 'Split Terminal', category: 'Terminal' },
  { id: 'preferences.openSettings', label: 'Open Settings', category: 'Preferences', shortcut: 'Ctrl+,', icon: <Zap size={14} /> },
  { id: 'preferences.keyboardShortcuts', label: 'Keyboard Shortcuts', category: 'Preferences', shortcut: 'Ctrl+K Ctrl+S' },
  { id: 'preferences.colorTheme', label: 'Color Theme', category: 'Preferences' },
  { id: 'preferences.fileIcon', label: 'File Icon Theme', category: 'Preferences' },
  { id: 'debug.start', label: 'Start Debugging', category: 'Debug', shortcut: 'F5' },
  { id: 'debug.stop', label: 'Stop Debugging', category: 'Debug', shortcut: 'Shift+F5' },
  { id: 'debug.restart', label: 'Restart Debugging', category: 'Debug', shortcut: 'Ctrl+Shift+F5' },
  { id: 'debug.toggleBreakpoint', label: 'Toggle Breakpoint', category: 'Debug', shortcut: 'F9' },
  { id: 'debug.stepOver', label: 'Step Over', category: 'Debug', shortcut: 'F10' },
  { id: 'debug.stepInto', label: 'Step Into', category: 'Debug', shortcut: 'F11' },
]

// ─── Fuzzy Matching ───────────────────────────────────────────────────────────

interface FuzzyResult {
  score: number
  indices: number[]
}

function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  if (q.length === 0) return { score: 0, indices: [] }
  if (q.length > t.length) return null

  const indices: number[] = []
  let qi = 0
  let score = 0
  let consecutive = 0
  let lastMatchIndex = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti)

      // Consecutive bonus
      if (ti === lastMatchIndex + 1) {
        consecutive++
        score += consecutive * 3
      } else {
        consecutive = 0
        score += 1
      }

      // Word boundary bonus
      if (
        ti === 0 ||
        t[ti - 1] === '/' ||
        t[ti - 1] === '\\' ||
        t[ti - 1] === '.' ||
        t[ti - 1] === '-' ||
        t[ti - 1] === '_' ||
        t[ti - 1] === ' ' ||
        (t[ti] >= 'A' && t[ti] <= 'Z' && t[ti - 1] >= 'a' && t[ti - 1] <= 'z')
      ) {
        score += 7
      }

      // Prefix match bonus
      if (ti === 0) {
        score += 10
      }

      lastMatchIndex = ti
      qi++
    }
  }

  if (qi < q.length) return null

  // Penalize long targets so shorter matches rank higher
  score -= target.length * 0.05

  // Bonus for exact substring match
  if (t.includes(q)) {
    score += q.length * 5
  }

  return { score, indices }
}

function fuzzyMatchPath(query: string, filePath: string, fileName: string): FuzzyResult | null {
  // Try matching against filename first (higher priority)
  const nameResult = fuzzyMatch(query, fileName)
  const pathResult = fuzzyMatch(query, filePath)

  if (nameResult && pathResult) {
    // Prefer filename match, but combine scores
    return nameResult.score >= pathResult.score
      ? { score: nameResult.score + 5, indices: nameResult.indices }
      : pathResult
  }

  return nameResult || pathResult
}

// ─── File Tree Helpers ────────────────────────────────────────────────────────

function collectAllFiles(tree: FileNode[]): Array<{ name: string; path: string }> {
  const files: Array<{ name: string; path: string }> = []
  const walk = (nodes: FileNode[]) => {
    for (const node of nodes) {
      if (node.type === 'file') {
        files.push({ name: node.name, path: node.path })
      }
      if (node.children) walk(node.children)
    }
  }
  walk(tree)
  return files
}

function getRelativePath(fullPath: string, rootPath: string | null): string {
  if (!rootPath) return fullPath
  const normalized = fullPath.replace(/\\/g, '/')
  const normalizedRoot = rootPath.replace(/\\/g, '/')
  if (normalized.startsWith(normalizedRoot)) {
    return normalized.slice(normalizedRoot.length).replace(/^\//, '')
  }
  return normalized
}

function getFileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

function getDirectory(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : ''
}

// ─── Symbol Extraction (naive heuristic from file content) ────────────────────

function extractSymbols(content: string, language: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // TypeScript / JavaScript patterns
    if (['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'ts', 'tsx', 'js', 'jsx'].includes(language)) {
      // Function declarations
      let m = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/)
      if (m) { symbols.push({ name: m[1], kind: 'function', line: i + 1 }); continue }

      // Arrow functions assigned to const/let/var
      m = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/)
      if (m) { symbols.push({ name: m[1], kind: 'function', line: i + 1 }); continue }

      // Class declarations
      m = trimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/)
      if (m) { symbols.push({ name: m[1], kind: 'class', line: i + 1 }); continue }

      // Interface declarations
      m = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/)
      if (m) { symbols.push({ name: m[1], kind: 'interface', line: i + 1 }); continue }

      // Type alias
      m = trimmed.match(/^(?:export\s+)?type\s+(\w+)\s*=/)
      if (m) { symbols.push({ name: m[1], kind: 'type', line: i + 1 }); continue }

      // Enum declarations
      m = trimmed.match(/^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/)
      if (m) { symbols.push({ name: m[1], kind: 'enum', line: i + 1 }); continue }

      // Namespace / module
      m = trimmed.match(/^(?:export\s+)?(?:namespace|module)\s+(\w+)/)
      if (m) { symbols.push({ name: m[1], kind: 'namespace', line: i + 1 }); continue }

      // Export default
      m = trimmed.match(/^export\s+default\s+(?:function|class|abstract\s+class)\s+(\w+)/)
      if (m) { symbols.push({ name: m[1], kind: 'export', line: i + 1 }); continue }

      // Simple const/let/var at top level (only if line starts at column 0)
      if (!line.startsWith(' ') && !line.startsWith('\t')) {
        m = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/)
        if (m && !trimmed.includes('=>')) {
          symbols.push({ name: m[1], kind: 'variable', line: i + 1 })
          continue
        }
      }
    }

    // Python patterns
    if (['python', 'py'].includes(language)) {
      let m = trimmed.match(/^(?:async\s+)?def\s+(\w+)/)
      if (m) { symbols.push({ name: m[1], kind: 'function', line: i + 1 }); continue }
      m = trimmed.match(/^class\s+(\w+)/)
      if (m) { symbols.push({ name: m[1], kind: 'class', line: i + 1 }); continue }
    }

    // Go patterns
    if (['go'].includes(language)) {
      let m = trimmed.match(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/)
      if (m) { symbols.push({ name: m[1], kind: 'function', line: i + 1 }); continue }
      m = trimmed.match(/^type\s+(\w+)\s+struct/)
      if (m) { symbols.push({ name: m[1], kind: 'class', line: i + 1 }); continue }
      m = trimmed.match(/^type\s+(\w+)\s+interface/)
      if (m) { symbols.push({ name: m[1], kind: 'interface', line: i + 1 }); continue }
    }

    // Rust patterns
    if (['rust', 'rs'].includes(language)) {
      let m = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/)
      if (m) { symbols.push({ name: m[1], kind: 'function', line: i + 1 }); continue }
      m = trimmed.match(/^(?:pub\s+)?struct\s+(\w+)/)
      if (m) { symbols.push({ name: m[1], kind: 'class', line: i + 1 }); continue }
      m = trimmed.match(/^(?:pub\s+)?trait\s+(\w+)/)
      if (m) { symbols.push({ name: m[1], kind: 'interface', line: i + 1 }); continue }
      m = trimmed.match(/^(?:pub\s+)?enum\s+(\w+)/)
      if (m) { symbols.push({ name: m[1], kind: 'enum', line: i + 1 }); continue }
    }
  }

  return symbols
}

function languageFromExtension(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
    py: 'python', go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp',
    cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
    html: 'html', css: 'css', scss: 'scss', json: 'json', md: 'markdown',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'shellscript',
  }
  return map[ext] || ext
}

// ─── Persistence Helpers ──────────────────────────────────────────────────────

function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveSearchHistory(history: string[]) {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
  } catch { /* ignore */ }
}

function loadPinnedItems(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_ITEMS_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}

function savePinnedItems(pinned: Set<string>) {
  try {
    localStorage.setItem(PINNED_ITEMS_KEY, JSON.stringify([...pinned]))
  } catch { /* ignore */ }
}

// ─── Highlighted Label Renderer ───────────────────────────────────────────────

function HighlightedText({ text, indices }: { text: string; indices?: number[] }) {
  if (!indices || indices.length === 0) {
    return <span>{text}</span>
  }

  const indexSet = new Set(indices)
  const parts: React.ReactNode[] = []
  let i = 0

  while (i < text.length) {
    if (indexSet.has(i)) {
      // Collect consecutive highlighted chars
      let end = i
      while (end < text.length && indexSet.has(end)) end++
      parts.push(
        <span key={i} className="quickopen-highlight-char">
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

  return <>{parts}</>
}

// ─── Mode Badge ───────────────────────────────────────────────────────────────

function ModeBadge({ mode }: { mode: QuickOpenMode }) {
  const configs: Record<QuickOpenMode, { label: string; color: string }> = {
    files: { label: 'Files', color: '#3178c6' },
    commands: { label: 'Commands', color: '#b48ead' },
    'goto-line': { label: 'Go to Line', color: '#a3be8c' },
    symbol: { label: 'Symbols', color: '#ebcb8b' },
    'workspace-symbol': { label: 'Workspace Symbols', color: '#d08770' },
  }
  const cfg = configs[mode]

  return (
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      padding: '1px 6px',
      borderRadius: 3,
      background: cfg.color + '22',
      color: cfg.color,
      marginLeft: 6,
      letterSpacing: 0.3,
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function QuickOpen({ isOpen, onClose, mode: initialMode, onOpenFile, onGotoLine, onExecuteCommand }: Props) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [closing, setClosing] = useState(false)
  const [pinnedItems, setPinnedItems] = useState<Set<string>>(() => loadPinnedItems())
  const [searchHistory] = useState<string[]>(() => loadSearchHistory())
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Store access
  const fileTree = useFileStore((s) => s.fileTree)
  const rootPath = useFileStore((s) => s.rootPath)
  const recentFiles = useRecentFilesStore((s) => s.recentFiles)
  const openFiles = useEditorStore((s) => s.openFiles)
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  const openFile = useEditorStore((s) => s.openFile)
  const recordFileAccess = useFileStore((s) => s.recordFileAccess)

  // Inject CSS once
  useEffect(() => { injectStyles() }, [])

  // Determine active mode from query prefix
  const activeMode = useMemo<QuickOpenMode>(() => {
    if (initialMode) {
      const modeMap: Record<string, QuickOpenMode> = {
        files: 'files', commands: 'commands',
        'goto-line': 'goto-line', symbol: 'symbol',
        'workspace-symbol': 'workspace-symbol',
        '>': 'commands', ':': 'goto-line', '@': 'symbol', '#': 'workspace-symbol',
      }
      if (modeMap[initialMode]) return modeMap[initialMode]
    }
    const firstChar = query.charAt(0)
    return MODE_PREFIXES[firstChar] || 'files'
  }, [query, initialMode])

  // Get the effective search query (strip mode prefix)
  const effectiveQuery = useMemo(() => {
    const firstChar = query.charAt(0)
    if (MODE_PREFIXES[firstChar]) return query.slice(1).trim()
    return query.trim()
  }, [query])

  // Collect all files from tree
  const allFiles = useMemo(() => collectAllFiles(fileTree), [fileTree])

  // Extract symbols from the active file
  const activeFileSymbols = useMemo<SymbolInfo[]>(() => {
    if (activeMode !== 'symbol') return []
    if (!activeFilePath) return []
    const file = openFiles.find((f) => f.path === activeFilePath)
    if (!file) return []
    return extractSymbols(file.content, file.language || languageFromExtension(file.path))
  }, [activeMode, activeFilePath, openFiles])

  // Extract symbols from all open files (workspace symbols)
  const workspaceSymbols = useMemo<Array<SymbolInfo & { filePath: string; fileName: string }>>(() => {
    if (activeMode !== 'workspace-symbol') return []
    const syms: Array<SymbolInfo & { filePath: string; fileName: string }> = []
    for (const file of openFiles) {
      const lang = file.language || languageFromExtension(file.path)
      const fileSyms = extractSymbols(file.content, lang)
      for (const sym of fileSyms) {
        syms.push({ ...sym, filePath: file.path, fileName: file.name })
      }
    }
    return syms
  }, [activeMode, openFiles])

  // ─── Build result items ─────────────────────────────────────────────────────

  const groups = useMemo<QuickOpenGroup[]>(() => {
    switch (activeMode) {
      // ── Files Mode ──────────────────────────────────────────────────────────
      case 'files': {
        const pinnedGroup: QuickOpenItem[] = []
        const recentGroup: QuickOpenItem[] = []
        const fileGroup: QuickOpenItem[] = []

        if (!effectiveQuery) {
          // Show pinned items first
          for (const filePath of pinnedItems) {
            const name = getFileName(filePath)
            const relPath = getRelativePath(filePath, rootPath)
            pinnedGroup.push({
              id: `pinned-${filePath}`,
              label: name,
              description: getDirectory(relPath),
              filePath,
              icon: <FileIcon fileName={name} size={16} />,
              isPinned: true,
              category: 'pinned',
            })
          }

          // Then recent files
          const recentPaths = new Set(pinnedItems)
          for (const rf of recentFiles.slice(0, MAX_RECENT)) {
            if (recentPaths.has(rf.path)) continue
            recentPaths.add(rf.path)
            const relPath = getRelativePath(rf.path, rootPath)
            recentGroup.push({
              id: `recent-${rf.path}`,
              label: rf.name,
              description: getDirectory(relPath),
              filePath: rf.path,
              icon: <FileIcon fileName={rf.name} size={16} />,
              category: 'recent',
            })
          }

          const result: QuickOpenGroup[] = []
          if (pinnedGroup.length > 0) result.push({ label: 'Pinned', items: pinnedGroup })
          if (recentGroup.length > 0) result.push({ label: 'Recently Opened', items: recentGroup })
          if (result.length === 0) {
            result.push({ label: 'No recent files', items: [{
              id: 'no-results',
              label: 'Type to search for files...',
              description: 'Use > for commands, : for go to line, @ for symbols',
              icon: <Search size={16} style={{ color: '#6e7681' }} />,
            }]})
          }
          return result
        }

        // Fuzzy search across all files
        const scored: Array<QuickOpenItem & { score: number }> = []
        for (const file of allFiles) {
          const relPath = getRelativePath(file.path, rootPath)
          const result = fuzzyMatchPath(effectiveQuery, relPath, file.name)
          if (!result) continue

          const isPinned = pinnedItems.has(file.path)
          // Boost pinned items
          const finalScore = result.score + (isPinned ? 100 : 0)

          // Boost recently accessed files
          const recentIdx = recentFiles.findIndex((r) => r.path === file.path)
          const recentBoost = recentIdx >= 0 ? (MAX_RECENT - recentIdx) * 2 : 0

          scored.push({
            id: `file-${file.path}`,
            label: file.name,
            description: getDirectory(relPath),
            filePath: file.path,
            icon: <FileIcon fileName={file.name} size={16} />,
            matchIndices: result.indices,
            isPinned,
            score: finalScore + recentBoost,
            category: 'file',
          })
        }

        scored.sort((a, b) => b.score - a.score)
        const items = scored.slice(0, MAX_RESULTS)
        if (items.length > 0) {
          fileGroup.push(...items)
        }

        if (fileGroup.length === 0) {
          return [{ label: 'No matching files', items: [{
            id: 'no-results',
            label: `No files matching "${effectiveQuery}"`,
            icon: <Search size={16} style={{ color: '#6e7681' }} />,
          }]}]
        }

        return [{ label: `Files matching "${effectiveQuery}"`, items: fileGroup }]
      }

      // ── Commands Mode ───────────────────────────────────────────────────────
      case 'commands': {
        let commands = BUILT_IN_COMMANDS

        if (effectiveQuery) {
          const scored = commands
            .map((cmd) => {
              const labelResult = fuzzyMatch(effectiveQuery, cmd.label)
              const catResult = fuzzyMatch(effectiveQuery, `${cmd.category}: ${cmd.label}`)
              const best = (labelResult && catResult)
                ? (labelResult.score >= catResult.score ? labelResult : catResult)
                : (labelResult || catResult)
              return best ? { cmd, score: best.score, indices: best.indices } : null
            })
            .filter(Boolean) as Array<{ cmd: CommandDef; score: number; indices: number[] }>

          scored.sort((a, b) => b.score - a.score)
          commands = scored.map((s) => s.cmd)

          const items: QuickOpenItem[] = scored.slice(0, MAX_RESULTS).map((s) => ({
            id: `cmd-${s.cmd.id}`,
            label: s.cmd.label,
            description: s.cmd.category,
            detail: s.cmd.shortcut,
            icon: s.cmd.icon || <Command size={14} style={{ color: '#8b949e' }} />,
            matchIndices: s.indices,
            handler: () => onExecuteCommand?.(s.cmd.id),
            category: 'command',
          }))

          if (items.length === 0) {
            return [{ label: 'No matching commands', items: [{
              id: 'no-results',
              label: `No commands matching "${effectiveQuery}"`,
              icon: <Search size={16} style={{ color: '#6e7681' }} />,
            }]}]
          }
          return [{ label: 'Commands', items }]
        }

        // Group by category when no query
        const byCategory = new Map<string, QuickOpenItem[]>()
        for (const cmd of commands) {
          const cat = cmd.category
          if (!byCategory.has(cat)) byCategory.set(cat, [])
          byCategory.get(cat)!.push({
            id: `cmd-${cmd.id}`,
            label: cmd.label,
            description: cat,
            detail: cmd.shortcut,
            icon: cmd.icon || <Command size={14} style={{ color: '#8b949e' }} />,
            handler: () => onExecuteCommand?.(cmd.id),
            category: 'command',
          })
        }

        const groups: QuickOpenGroup[] = []
        for (const [cat, items] of byCategory) {
          groups.push({ label: cat, items })
        }
        return groups
      }

      // ── Go to Line Mode ─────────────────────────────────────────────────────
      case 'goto-line': {
        const lineStr = effectiveQuery
        const activeFile = activeFilePath ? openFiles.find((f) => f.path === activeFilePath) : null
        const totalLines = activeFile ? activeFile.content.split('\n').length : 0

        if (!lineStr) {
          return [{ label: 'Go to Line', items: [{
            id: 'goto-line-prompt',
            label: `Type a line number (1-${totalLines || '?'})`,
            description: activeFile ? getFileName(activeFile.path) : 'No file open',
            icon: <Hash size={16} style={{ color: '#a3be8c' }} />,
          }]}]
        }

        // Parse line:column
        const parts = lineStr.split(':').map((s) => parseInt(s.trim(), 10))
        const line = parts[0]
        const column = parts[1] || 1

        if (isNaN(line) || line < 1) {
          return [{ label: 'Go to Line', items: [{
            id: 'goto-line-invalid',
            label: 'Enter a valid line number',
            icon: <Hash size={16} style={{ color: '#f85149' }} />,
          }]}]
        }

        const clampedLine = Math.min(line, totalLines || line)

        // Show a preview of the line content
        let linePreview = ''
        if (activeFile) {
          const lines = activeFile.content.split('\n')
          if (clampedLine <= lines.length) {
            linePreview = lines[clampedLine - 1]?.trim().slice(0, 80) || '(empty line)'
          }
        }

        return [{ label: 'Go to Line', items: [{
          id: `goto-${clampedLine}:${column}`,
          label: `Go to Line ${clampedLine}${column > 1 ? `, Column ${column}` : ''}`,
          description: linePreview,
          detail: activeFile ? getFileName(activeFile.path) : undefined,
          icon: <Hash size={16} style={{ color: '#a3be8c' }} />,
          lineNumber: clampedLine,
          handler: () => onGotoLine?.(clampedLine),
        }]}]
      }

      // ── Symbol Mode (current file) ──────────────────────────────────────────
      case 'symbol': {
        if (!activeFilePath) {
          return [{ label: 'Symbols', items: [{
            id: 'no-file',
            label: 'No active file',
            icon: <AtSign size={16} style={{ color: '#6e7681' }} />,
          }]}]
        }

        let symbols = activeFileSymbols

        if (effectiveQuery) {
          const scored = symbols
            .map((sym) => {
              const result = fuzzyMatch(effectiveQuery, sym.name)
              return result ? { sym, score: result.score, indices: result.indices } : null
            })
            .filter(Boolean) as Array<{ sym: SymbolInfo; score: number; indices: number[] }>

          scored.sort((a, b) => b.score - a.score)
          symbols = scored.map((s) => s.sym)

          const items: QuickOpenItem[] = scored.slice(0, MAX_RESULTS).map((s) => ({
            id: `sym-${s.sym.name}-${s.sym.line}`,
            label: s.sym.name,
            description: `Line ${s.sym.line}`,
            detail: s.sym.kind,
            icon: SYMBOL_ICONS[s.sym.kind] || <Code size={14} style={{ color: '#8b949e' }} />,
            matchIndices: s.indices,
            symbolKind: s.sym.kind,
            lineNumber: s.sym.line,
            handler: () => onGotoLine?.(s.sym.line),
          }))

          if (items.length === 0) {
            return [{ label: 'Symbols', items: [{
              id: 'no-symbols',
              label: `No symbols matching "${effectiveQuery}"`,
              icon: <AtSign size={16} style={{ color: '#6e7681' }} />,
            }]}]
          }
          return [{ label: `Symbols in ${getFileName(activeFilePath)}`, items }]
        }

        // Group symbols by kind
        const byKind = new Map<string, QuickOpenItem[]>()
        for (const sym of symbols) {
          const kind = sym.kind
          if (!byKind.has(kind)) byKind.set(kind, [])
          byKind.get(kind)!.push({
            id: `sym-${sym.name}-${sym.line}`,
            label: sym.name,
            description: `Line ${sym.line}`,
            detail: sym.kind,
            icon: SYMBOL_ICONS[sym.kind] || <Code size={14} style={{ color: '#8b949e' }} />,
            symbolKind: sym.kind,
            lineNumber: sym.line,
            handler: () => onGotoLine?.(sym.line),
          })
        }

        if (byKind.size === 0) {
          return [{ label: 'Symbols', items: [{
            id: 'no-symbols',
            label: 'No symbols found in this file',
            icon: <AtSign size={16} style={{ color: '#6e7681' }} />,
          }]}]
        }

        // Sort kind groups: functions, classes, interfaces, types, enums, variables, rest
        const kindOrder = ['function', 'method', 'class', 'interface', 'type', 'enum', 'variable', 'constant', 'property', 'namespace', 'module']
        const groups: QuickOpenGroup[] = []
        for (const kind of kindOrder) {
          if (byKind.has(kind)) {
            groups.push({ label: kind.charAt(0).toUpperCase() + kind.slice(1) + 's', items: byKind.get(kind)! })
            byKind.delete(kind)
          }
        }
        // Remaining kinds
        for (const [kind, items] of byKind) {
          groups.push({ label: kind.charAt(0).toUpperCase() + kind.slice(1) + 's', items })
        }

        return groups
      }

      // ── Workspace Symbol Mode ───────────────────────────────────────────────
      case 'workspace-symbol': {
        if (workspaceSymbols.length === 0) {
          return [{ label: 'Workspace Symbols', items: [{
            id: 'no-ws-symbols',
            label: effectiveQuery ? `No symbols matching "${effectiveQuery}"` : 'Type to search symbols across open files',
            icon: <Hash size={16} style={{ color: '#6e7681' }} />,
          }]}]
        }

        let filtered = workspaceSymbols

        if (effectiveQuery) {
          const scored = filtered
            .map((sym) => {
              const result = fuzzyMatch(effectiveQuery, sym.name)
              return result ? { sym, score: result.score, indices: result.indices } : null
            })
            .filter(Boolean) as Array<{ sym: typeof workspaceSymbols[0]; score: number; indices: number[] }>

          scored.sort((a, b) => b.score - a.score)

          const items: QuickOpenItem[] = scored.slice(0, MAX_RESULTS).map((s) => ({
            id: `wsym-${s.sym.filePath}-${s.sym.name}-${s.sym.line}`,
            label: s.sym.name,
            description: `${s.sym.fileName}:${s.sym.line}`,
            detail: s.sym.kind,
            filePath: s.sym.filePath,
            icon: SYMBOL_ICONS[s.sym.kind] || <Code size={14} style={{ color: '#8b949e' }} />,
            matchIndices: s.indices,
            symbolKind: s.sym.kind,
            lineNumber: s.sym.line,
            handler: () => {
              onOpenFile?.(s.sym.filePath, s.sym.fileName)
              setTimeout(() => onGotoLine?.(s.sym.line), 100)
            },
          }))

          if (items.length === 0) {
            return [{ label: 'Workspace Symbols', items: [{
              id: 'no-ws-results',
              label: `No symbols matching "${effectiveQuery}"`,
              icon: <Hash size={16} style={{ color: '#6e7681' }} />,
            }]}]
          }
          return [{ label: 'Workspace Symbols', items }]
        }

        // Show all symbols grouped by file
        const byFile = new Map<string, QuickOpenItem[]>()
        for (const sym of filtered) {
          if (!byFile.has(sym.filePath)) byFile.set(sym.filePath, [])
          byFile.get(sym.filePath)!.push({
            id: `wsym-${sym.filePath}-${sym.name}-${sym.line}`,
            label: sym.name,
            description: `Line ${sym.line}`,
            detail: sym.kind,
            filePath: sym.filePath,
            icon: SYMBOL_ICONS[sym.kind] || <Code size={14} style={{ color: '#8b949e' }} />,
            symbolKind: sym.kind,
            lineNumber: sym.line,
            handler: () => {
              onOpenFile?.(sym.filePath, sym.fileName)
              setTimeout(() => onGotoLine?.(sym.line), 100)
            },
          })
        }

        const groups: QuickOpenGroup[] = []
        for (const [filePath, items] of byFile) {
          groups.push({ label: getFileName(filePath), items })
        }
        return groups
      }

      default:
        return []
    }
  }, [activeMode, effectiveQuery, allFiles, rootPath, pinnedItems, recentFiles,
      activeFilePath, openFiles, activeFileSymbols, workspaceSymbols,
      onOpenFile, onGotoLine, onExecuteCommand])

  // Flatten groups for keyboard navigation
  const flatItems = useMemo(() => {
    const items: Array<QuickOpenItem & { groupIndex: number; itemIndex: number }> = []
    for (let gi = 0; gi < groups.length; gi++) {
      for (let ii = 0; ii < groups[gi].items.length; ii++) {
        items.push({ ...groups[gi].items[ii], groupIndex: gi, itemIndex: ii })
      }
    }
    return items
  }, [groups])

  // Reset selection on query change
  useEffect(() => {
    setSelectedIndex(0)
  }, [query, activeMode])

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery(initialMode && MODE_PREFIXES[initialMode] ? initialMode : '')
      setSelectedIndex(0)
      setClosing(false)
      setPreviewPath(null)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [isOpen, initialMode])

  // Scroll selected item into view
  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex)
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedIndex])

  // Preview on focus (update preview path when selection changes in files mode)
  useEffect(() => {
    if (activeMode === 'files' && flatItems[selectedIndex]?.filePath) {
      setPreviewPath(flatItems[selectedIndex].filePath!)
    }
  }, [selectedIndex, activeMode, flatItems])

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    // Save search to history
    if (effectiveQuery && activeMode === 'files') {
      const history = loadSearchHistory()
      const updated = [effectiveQuery, ...history.filter((h) => h !== effectiveQuery)].slice(0, MAX_HISTORY)
      saveSearchHistory(updated)
    }

    setClosing(true)
    closingTimerRef.current = setTimeout(() => {
      setClosing(false)
      setQuery('')
      setSelectedIndex(0)
      setPreviewPath(null)
      onClose()
    }, 150)
  }, [onClose, effectiveQuery, activeMode])

  useEffect(() => {
    return () => {
      if (closingTimerRef.current) clearTimeout(closingTimerRef.current)
    }
  }, [])

  const handleSelect = useCallback((item: QuickOpenItem) => {
    if (item.id === 'no-results' || item.id === 'no-file' || item.id === 'no-symbols'
        || item.id === 'no-ws-symbols' || item.id === 'no-ws-results'
        || item.id === 'goto-line-prompt' || item.id === 'goto-line-invalid') {
      return
    }

    if (item.handler) {
      item.handler()
      handleClose()
      return
    }

    if (item.filePath) {
      const name = getFileName(item.filePath)
      recordFileAccess(item.filePath, name)

      if (onOpenFile) {
        onOpenFile(item.filePath, name)
      } else {
        openFile({
          path: item.filePath,
          name,
          content: '',
          language: languageFromExtension(item.filePath),
          isModified: false,
          aiModified: false,
        })
      }
      handleClose()
      return
    }

    if (item.lineNumber) {
      onGotoLine?.(item.lineNumber)
      handleClose()
    }
  }, [handleClose, onOpenFile, onGotoLine, openFile, recordFileAccess])

  const handleTogglePin = useCallback((e: React.MouseEvent, filePath: string) => {
    e.stopPropagation()
    e.preventDefault()
    const next = new Set(pinnedItems)
    if (next.has(filePath)) {
      next.delete(filePath)
    } else {
      next.add(filePath)
    }
    setPinnedItems(next)
    savePinnedItems(next)
  }, [pinnedItems])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, flatItems.length - 1))
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
        break
      }
      case 'Enter': {
        e.preventDefault()
        const item = flatItems[selectedIndex]
        if (item) handleSelect(item)
        break
      }
      case 'Escape': {
        e.preventDefault()
        handleClose()
        break
      }
      case 'Home': {
        if (e.ctrlKey) {
          e.preventDefault()
          setSelectedIndex(0)
        }
        break
      }
      case 'End': {
        if (e.ctrlKey) {
          e.preventDefault()
          setSelectedIndex(flatItems.length - 1)
        }
        break
      }
      case 'PageDown': {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 10, flatItems.length - 1))
        break
      }
      case 'PageUp': {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 10, 0))
        break
      }
      case 'Backspace': {
        // If the query is just a mode prefix, go back to files mode
        if (query.length === 1 && MODE_PREFIXES[query]) {
          e.preventDefault()
          setQuery('')
        }
        break
      }
    }
  }, [flatItems, selectedIndex, handleSelect, handleClose, query])

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (!isOpen && !closing) return null

  let flatIndex = -1

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9998,
          background: 'rgba(0,0,0,0.35)',
          animation: closing ? 'quickopen-backdrop-in 150ms ease reverse forwards' : 'quickopen-backdrop-in 150ms ease',
        }}
      />

      {/* Dialog */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          width: '100%',
          maxWidth: 640,
          padding: '0 16px',
          paddingTop: 48,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            pointerEvents: 'auto',
            background: '#1e1e1e',
            border: '1px solid #3c3c3c',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
            overflow: 'hidden',
            animation: closing
              ? 'quickopen-fade-out 150ms ease forwards'
              : 'quickopen-fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 'calc(100vh - 120px)',
          }}
        >
          {/* Input area */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '8px 12px',
            borderBottom: '1px solid #2d2d2d',
            gap: 8,
          }}>
            <Search size={16} style={{ color: '#6e7681', flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                activeMode === 'commands' ? 'Type a command...'
                : activeMode === 'goto-line' ? 'Type a line number and press Enter...'
                : activeMode === 'symbol' ? 'Type to filter symbols (@)...'
                : activeMode === 'workspace-symbol' ? 'Type to search workspace symbols (#)...'
                : 'Search files by name (type > for commands, : for line, @ for symbols)'
              }
              spellCheck={false}
              autoComplete="off"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#cccccc',
                fontSize: 14,
                fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
                lineHeight: '22px',
                padding: 0,
              }}
            />
            <ModeBadge mode={activeMode} />
          </div>

          {/* Results list */}
          <div
            ref={listRef}
            className="quickopen-result-list"
            style={{
              overflowY: 'auto',
              maxHeight: 408,
              padding: '4px 0',
            }}
          >
            {groups.map((group, gi) => (
              <div key={`group-${gi}-${group.label}`}>
                {/* Group header */}
                {groups.length > 1 && (
                  <div style={{
                    padding: '6px 14px 2px',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#6e7681',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    {group.label === 'Pinned' && <Pin size={10} style={{ color: '#6e7681' }} />}
                    {group.label === 'Recently Opened' && <Clock size={10} style={{ color: '#6e7681' }} />}
                    {group.label}
                    <span style={{ color: '#484f58', fontWeight: 400 }}>
                      ({group.items.length})
                    </span>
                  </div>
                )}

                {/* Items */}
                {group.items.map((item, ii) => {
                  flatIndex++
                  const currentFlatIndex = flatIndex
                  const isSelected = currentFlatIndex === selectedIndex
                  const isNonInteractive = item.id === 'no-results' || item.id === 'no-file'
                    || item.id === 'no-symbols' || item.id === 'no-ws-symbols'
                    || item.id === 'no-ws-results' || item.id === 'goto-line-prompt'
                    || item.id === 'goto-line-invalid'

                  return (
                    <div
                      key={item.id}
                      ref={(el) => {
                        if (el) itemRefs.current.set(currentFlatIndex, el)
                        else itemRefs.current.delete(currentFlatIndex)
                      }}
                      onClick={() => !isNonInteractive && handleSelect(item)}
                      onMouseEnter={() => setSelectedIndex(currentFlatIndex)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '6px 14px',
                        cursor: isNonInteractive ? 'default' : 'pointer',
                        background: isSelected && !isNonInteractive
                          ? 'rgba(4, 57, 94, 0.6)'
                          : 'transparent',
                        borderLeft: isSelected && !isNonInteractive
                          ? '2px solid #007acc'
                          : '2px solid transparent',
                        transition: 'background 80ms ease',
                        gap: 10,
                        minHeight: 32,
                        opacity: isNonInteractive ? 0.6 : 1,
                      }}
                    >
                      {/* Icon */}
                      <div style={{
                        flexShrink: 0,
                        width: 20,
                        height: 20,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        {item.icon}
                      </div>

                      {/* Label & description */}
                      <div style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                      }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}>
                          <span style={{
                            fontSize: 13,
                            color: isSelected ? '#ffffff' : '#cccccc',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            fontWeight: item.isPinned ? 500 : 400,
                          }}>
                            <HighlightedText
                              text={item.label}
                              indices={item.matchIndices}
                            />
                          </span>

                          {item.symbolKind && (
                            <span style={{
                              fontSize: 10,
                              padding: '0px 4px',
                              borderRadius: 3,
                              background: 'rgba(255,255,255,0.06)',
                              color: '#8b949e',
                              whiteSpace: 'nowrap',
                            }}>
                              {item.symbolKind}
                            </span>
                          )}

                          {item.description && (
                            <span style={{
                              fontSize: 12,
                              color: '#6e7681',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              minWidth: 0,
                            }}>
                              {item.description}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right side: shortcut / pin / arrow */}
                      <div style={{
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}>
                        {/* Keyboard shortcut badge */}
                        {item.detail && activeMode === 'commands' && (
                          <span style={{
                            fontSize: 11,
                            color: '#6e7681',
                            padding: '1px 6px',
                            borderRadius: 3,
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
                            whiteSpace: 'nowrap',
                          }}>
                            {item.detail}
                          </span>
                        )}

                        {/* Pin toggle for file items */}
                        {item.filePath && activeMode === 'files' && !isNonInteractive && (
                          <button
                            onClick={(e) => handleTogglePin(e, item.filePath!)}
                            title={item.isPinned ? 'Unpin' : 'Pin'}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 2,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              opacity: item.isPinned ? 0.9 : 0,
                              color: item.isPinned ? '#e3b341' : '#6e7681',
                              transition: 'opacity 120ms ease',
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.opacity = '1'
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.opacity = item.isPinned ? '0.9' : '0'
                            }}
                          >
                            <Pin size={12} />
                          </button>
                        )}

                        {/* Selection indicator */}
                        {isSelected && !isNonInteractive && (
                          <CornerDownLeft size={12} style={{ color: '#6e7681' }} />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}

            {/* Empty state */}
            {flatItems.length === 0 && (
              <div style={{
                padding: '24px 14px',
                textAlign: 'center',
                color: '#6e7681',
                fontSize: 13,
              }}>
                No results
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 14px',
            borderTop: '1px solid #2d2d2d',
            fontSize: 11,
            color: '#6e7681',
            userSelect: 'none',
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <kbd style={{
                  padding: '0px 4px',
                  borderRadius: 3,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  fontSize: 10,
                  fontFamily: "'SF Mono', monospace",
                  lineHeight: '16px',
                }}>
                  <ArrowUp size={8} />
                </kbd>
                <kbd style={{
                  padding: '0px 4px',
                  borderRadius: 3,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  fontSize: 10,
                  fontFamily: "'SF Mono', monospace",
                  lineHeight: '16px',
                }}>
                  <ArrowDown size={8} />
                </kbd>
                <span style={{ marginLeft: 2 }}>navigate</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <kbd style={{
                  padding: '0px 4px',
                  borderRadius: 3,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  fontSize: 10,
                  fontFamily: "'SF Mono', monospace",
                  lineHeight: '16px',
                }}>
                  <CornerDownLeft size={8} />
                </kbd>
                <span style={{ marginLeft: 2 }}>open</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <kbd style={{
                  padding: '0px 4px',
                  borderRadius: 3,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  fontSize: 10,
                  fontFamily: "'SF Mono', monospace",
                  lineHeight: '16px',
                }}>
                  esc
                </kbd>
                <span style={{ marginLeft: 2 }}>close</span>
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {flatItems.length > 0 && (
                <span>{flatItems.length} result{flatItems.length !== 1 ? 's' : ''}</span>
              )}
              {previewPath && activeMode === 'files' && (
                <span style={{
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: '#484f58',
                }}>
                  {getFileName(previewPath)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
