import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useEditorStore } from '@/store/editor'
import { ListTree, ChevronRight, ChevronDown, Hash, Braces, Type, Box, Variable, ArrowDownAZ, ArrowDown01, Search, Layers, Code2, Package, FileCode, Shield, Navigation, Eye, Copy, PenLine, FileText, Files, Circle, Diamond, Parentheses, SquareFunction, Minus } from 'lucide-react'

interface DocSymbol {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'method' | 'property' | 'enum' | 'import' | 'export' | 'namespace'
  line: number
  indent: number
  children?: DocSymbol[]
  exported?: boolean
  params?: string
  endLine?: number
  returnType?: string
}

// Comprehensive regex-based symbol extraction (multi-language)
function extractSymbols(content: string, language: string): DocSymbol[] {
  const symbols: DocSymbol[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    const indent = line.length - line.trimStart().length

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue

    // TypeScript/JavaScript patterns
    if (['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'tsx', 'jsx', 'ts', 'js'].includes(language)) {
      const isExported = /^export\s+/.test(trimmed)

      // Extract parameters from function signatures
      const extractParams = (str: string): string | undefined => {
        const pMatch = str.match(/\(([^)]*)\)/)
        if (pMatch && pMatch[1].trim()) return `(${pMatch[1].trim()})`
        return undefined
      }

      // Extract return type
      const extractReturnType = (str: string): string | undefined => {
        const rMatch = str.match(/\)\s*:\s*([^{=]+)/)
        if (rMatch && rMatch[1].trim()) {
          const rt = rMatch[1].trim().replace(/\s*\{?\s*$/, '')
          return rt || undefined
        }
        return undefined
      }

      // Export default function
      let match = trimmed.match(/^export\s+default\s+function\s+(\w+)/)
      if (match) { symbols.push({ name: match[1], kind: 'function', line: i + 1, indent, exported: true, params: extractParams(trimmed), returnType: extractReturnType(trimmed) }); continue }

      // Function declarations
      match = trimmed.match(/^(export\s+)?(async\s+)?function\s+(\w+)/)
      if (match) { symbols.push({ name: match[3], kind: 'function', line: i + 1, indent, exported: isExported, params: extractParams(trimmed), returnType: extractReturnType(trimmed) }); continue }

      // Arrow functions assigned to const/let/var
      if (/^(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(/.test(trimmed) ||
          /^(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\w+\s*=>/.test(trimmed) ||
          /^(export\s+)?(const|let|var)\s+(\w+)\s*:\s*\w.*=\s*(async\s+)?\(/.test(trimmed)) {
        match = trimmed.match(/^(export\s+)?(const|let|var)\s+(\w+)/)
        if (match) { symbols.push({ name: match[3], kind: 'function', line: i + 1, indent, exported: isExported, params: extractParams(trimmed), returnType: extractReturnType(trimmed) }); continue }
      }

      // Class declarations
      match = trimmed.match(/^(export\s+)?(abstract\s+)?class\s+(\w+)/)
      if (match) { symbols.push({ name: match[3], kind: 'class', line: i + 1, indent, exported: isExported }); continue }

      // Interface declarations
      match = trimmed.match(/^(export\s+)?interface\s+(\w+)/)
      if (match) { symbols.push({ name: match[2], kind: 'interface', line: i + 1, indent, exported: isExported }); continue }

      // Type declarations
      match = trimmed.match(/^(export\s+)?type\s+(\w+)/)
      if (match) { symbols.push({ name: match[2], kind: 'type', line: i + 1, indent, exported: isExported }); continue }

      // Enum declarations
      match = trimmed.match(/^(export\s+)?enum\s+(\w+)/)
      if (match) { symbols.push({ name: match[2], kind: 'enum', line: i + 1, indent, exported: isExported }); continue }

      // Namespace declarations
      match = trimmed.match(/^(export\s+)?namespace\s+(\w+)/)
      if (match) { symbols.push({ name: match[2], kind: 'namespace', line: i + 1, indent, exported: isExported }); continue }

      // Method definitions in class (indented, no keyword prefix)
      if (indent > 0) {
        // Skip control flow and common non-method patterns
        const skipPatterns = ['if', 'for', 'while', 'switch', 'return', 'case', 'break', 'continue', 'throw', 'try', 'catch', 'finally', 'else', 'import', 'export', 'const', 'let', 'var']
        const firstWord = trimmed.split(/[\s(]/)[0]
        if (!skipPatterns.includes(firstWord) && !trimmed.startsWith('{') && !trimmed.startsWith('}')) {
          // getter/setter
          match = trimmed.match(/^(get|set)\s+(\w+)\s*\(/)
          if (match) { symbols.push({ name: `${match[1]} ${match[2]}`, kind: 'property', line: i + 1, indent, params: extractParams(trimmed) }); continue }

          // constructor
          match = trimmed.match(/^constructor\s*\(/)
          if (match) { symbols.push({ name: 'constructor', kind: 'method', line: i + 1, indent, params: extractParams(trimmed) }); continue }

          // Property declarations (with type annotation, no parens before =)
          match = trimmed.match(/^(?:static\s+)?(?:readonly\s+)?(?:private\s+|protected\s+|public\s+)?(?:static\s+)?(?:readonly\s+)?(\w+)\s*[?!]?\s*:\s*[^(]/)
          if (match && !trimmed.includes('(') && match[1] !== 'new' && match[1] !== 'function' && match[1] !== 'class') {
            symbols.push({ name: match[1], kind: 'property', line: i + 1, indent })
            continue
          }

          // static/async/private methods
          match = trimmed.match(/^(?:static\s+)?(?:async\s+)?(?:readonly\s+)?(?:private\s+|protected\s+|public\s+)?(?:static\s+)?(?:async\s+)?(\w+)\s*[(<]/)
          if (match && match[1] !== 'new' && match[1] !== 'function' && match[1] !== 'class') {
            symbols.push({ name: match[1], kind: 'method', line: i + 1, indent, params: extractParams(trimmed), returnType: extractReturnType(trimmed) })
            continue
          }
        }
      }

      // Top-level constants/variables (not functions)
      if (indent === 0) {
        match = trimmed.match(/^(export\s+)?(const|let|var)\s+(\w+)\s*[=:]/)
        if (match && !trimmed.includes('=>') && !trimmed.includes('function')) {
          symbols.push({ name: match[3], kind: 'variable', line: i + 1, indent, exported: isExported })
          continue
        }
      }
    }

    // Python patterns
    else if (language === 'python' || language === 'py') {
      let match = trimmed.match(/^(async\s+)?def\s+(\w+)/)
      if (match) {
        const params = trimmed.match(/\(([^)]*)\)/)
        symbols.push({ name: match[2], kind: indent > 0 ? 'method' : 'function', line: i + 1, indent, params: params ? `(${params[1].trim()})` : undefined })
        continue
      }
      match = trimmed.match(/^class\s+(\w+)/)
      if (match) { symbols.push({ name: match[1], kind: 'class', line: i + 1, indent }); continue }
      // Module-level variables
      if (indent === 0) {
        match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=/)
        if (match) { symbols.push({ name: match[1], kind: 'variable', line: i + 1, indent }); continue }
      }
    }

    // Go patterns
    else if (language === 'go') {
      let match = trimmed.match(/^func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)/)
      if (match) { symbols.push({ name: `${match[2]}.${match[3]}`, kind: 'method', line: i + 1, indent }); continue }
      match = trimmed.match(/^func\s+(\w+)/)
      if (match) { symbols.push({ name: match[1], kind: 'function', line: i + 1, indent, exported: /^[A-Z]/.test(match[1]) }); continue }
      match = trimmed.match(/^type\s+(\w+)\s+struct/)
      if (match) { symbols.push({ name: match[1], kind: 'class', line: i + 1, indent, exported: /^[A-Z]/.test(match[1]) }); continue }
      match = trimmed.match(/^type\s+(\w+)\s+interface/)
      if (match) { symbols.push({ name: match[1], kind: 'interface', line: i + 1, indent, exported: /^[A-Z]/.test(match[1]) }); continue }
      match = trimmed.match(/^type\s+(\w+)/)
      if (match) { symbols.push({ name: match[1], kind: 'type', line: i + 1, indent, exported: /^[A-Z]/.test(match[1]) }); continue }
    }

    // Rust patterns
    else if (language === 'rust' || language === 'rs') {
      const isPub = /^pub\s+/.test(trimmed)
      let match = trimmed.match(/^(pub\s+)?(?:\(crate\)\s+)?(async\s+)?fn\s+(\w+)/)
      if (match) {
        symbols.push({ name: match[3], kind: indent > 0 ? 'method' : 'function', line: i + 1, indent, exported: isPub })
        continue
      }
      match = trimmed.match(/^(pub\s+)?struct\s+(\w+)/)
      if (match) { symbols.push({ name: match[2], kind: 'class', line: i + 1, indent, exported: isPub }); continue }
      match = trimmed.match(/^(pub\s+)?trait\s+(\w+)/)
      if (match) { symbols.push({ name: match[2], kind: 'interface', line: i + 1, indent, exported: isPub }); continue }
      match = trimmed.match(/^(pub\s+)?enum\s+(\w+)/)
      if (match) { symbols.push({ name: match[2], kind: 'enum', line: i + 1, indent, exported: isPub }); continue }
      match = trimmed.match(/^(pub\s+)?mod\s+(\w+)/)
      if (match) { symbols.push({ name: match[2], kind: 'namespace', line: i + 1, indent, exported: isPub }); continue }
      match = trimmed.match(/^(pub\s+)?type\s+(\w+)/)
      if (match) { symbols.push({ name: match[2], kind: 'type', line: i + 1, indent, exported: isPub }); continue }
      match = trimmed.match(/^impl\s+(?:<[^>]+>\s+)?(\w+)/)
      if (match) { symbols.push({ name: `impl ${match[1]}`, kind: 'class', line: i + 1, indent }); continue }
    }

    // Java/C# patterns
    else if (language === 'java' || language === 'csharp' || language === 'cs') {
      const isPub = /^public\s+/.test(trimmed)
      let match = trimmed.match(/^(?:public|private|protected|static|final|abstract|synchronized|native|\s)*\s+class\s+(\w+)/)
      if (match) { symbols.push({ name: match[1], kind: 'class', line: i + 1, indent, exported: isPub }); continue }
      match = trimmed.match(/^(?:public|private|protected|static|final|abstract|synchronized|native|\s)*\s+interface\s+(\w+)/)
      if (match) { symbols.push({ name: match[1], kind: 'interface', line: i + 1, indent, exported: isPub }); continue }
      match = trimmed.match(/^(?:public|private|protected|static|final|abstract|synchronized|native|\s)*\s+enum\s+(\w+)/)
      if (match) { symbols.push({ name: match[1], kind: 'enum', line: i + 1, indent, exported: isPub }); continue }
    }

    // C/C++ patterns
    else if (language === 'c' || language === 'cpp' || language === 'h' || language === 'hpp') {
      let match = trimmed.match(/^(?:static\s+)?(?:inline\s+)?(?:virtual\s+)?(?:const\s+)?(?:\w+[\s*&]+)+(\w+)\s*\(/)
      if (match && indent === 0) {
        const name = match[1]
        if (!['if', 'for', 'while', 'switch', 'return'].includes(name)) {
          symbols.push({ name, kind: 'function', line: i + 1, indent })
          continue
        }
      }
      match = trimmed.match(/^(?:class|struct)\s+(\w+)/)
      if (match) { symbols.push({ name: match[1], kind: 'class', line: i + 1, indent }); continue }
      match = trimmed.match(/^enum\s+(?:class\s+)?(\w+)/)
      if (match) { symbols.push({ name: match[1], kind: 'enum', line: i + 1, indent }); continue }
      match = trimmed.match(/^namespace\s+(\w+)/)
      if (match) { symbols.push({ name: match[1], kind: 'namespace', line: i + 1, indent }); continue }
    }
  }

  return buildHierarchy(symbols)
}

// Build a tree from flat symbols using indentation levels
function buildHierarchy(flatSymbols: DocSymbol[]): DocSymbol[] {
  if (flatSymbols.length === 0) return []

  const root: DocSymbol[] = []
  const stack: { symbol: DocSymbol; indent: number }[] = []

  for (const sym of flatSymbols) {
    const node = { ...sym, children: undefined as DocSymbol[] | undefined }

    // Pop stack until we find a parent with less indent
    while (stack.length > 0 && stack[stack.length - 1].indent >= sym.indent) {
      stack.pop()
    }

    if (stack.length === 0) {
      root.push(node)
    } else {
      const parent = stack[stack.length - 1].symbol
      if (!parent.children) parent.children = []
      parent.children.push(node)
    }

    // Only push container types onto the stack
    if (['class', 'interface', 'namespace', 'enum'].includes(sym.kind)) {
      stack.push({ symbol: node, indent: sym.indent })
    }
  }

  // Compute endLine for each symbol (used for "follow cursor")
  computeEndLines(root, Infinity)

  return root
}

// Estimate endLine for symbols based on the next sibling or parent's end
function computeEndLines(symbols: DocSymbol[], parentEnd: number) {
  for (let i = 0; i < symbols.length; i++) {
    const nextLine = i + 1 < symbols.length ? symbols[i + 1].line - 1 : parentEnd
    symbols[i].endLine = nextLine
    if (symbols[i].children && symbols[i].children!.length > 0) {
      computeEndLines(symbols[i].children!, nextLine)
    }
  }
}

// Flatten a symbol tree for flat list views
function flattenSymbols(symbols: DocSymbol[]): DocSymbol[] {
  const result: DocSymbol[] = []
  function walk(syms: DocSymbol[]) {
    for (const s of syms) {
      result.push(s)
      if (s.children) walk(s.children)
    }
  }
  walk(symbols)
  return result
}

// Find the deepest symbol containing a given line
function findSymbolAtLine(symbols: DocSymbol[], line: number): DocSymbol | null {
  let best: DocSymbol | null = null
  function walk(syms: DocSymbol[]) {
    for (const s of syms) {
      if (line >= s.line && line <= (s.endLine || s.line)) {
        best = s
        if (s.children) walk(s.children)
      }
    }
  }
  walk(symbols)
  return best
}

// Find the full ancestry path from root to symbol at line
function findSymbolPath(symbols: DocSymbol[], line: number): DocSymbol[] {
  const path: DocSymbol[] = []
  function walk(syms: DocSymbol[]): boolean {
    for (const s of syms) {
      if (line >= s.line && line <= (s.endLine || s.line)) {
        path.push(s)
        if (s.children) walk(s.children)
        return true
      }
    }
    return false
  }
  walk(symbols)
  return path
}

// Icon mapping per symbol kind - using lucide-react icons
const kindIcons: Record<DocSymbol['kind'], typeof Hash> = {
  function: SquareFunction,
  class: Box,
  interface: Braces,
  type: Type,
  variable: Variable,
  method: Parentheses,
  property: Diamond,
  enum: Layers,
  import: Package,
  export: Package,
  namespace: Shield,
}

// Color mapping per symbol kind - matching VS Code conventions
const kindColors: Record<DocSymbol['kind'], string> = {
  function: '#b48ead',   // purple
  class: '#d08770',      // orange
  interface: '#5e81ac',  // blue
  type: '#88c0d0',       // cyan
  variable: '#81d4fa',   // light blue
  method: '#c8a2d0',     // purple (lighter)
  property: '#a3be8c',   // green
  enum: '#ebcb8b',       // yellow
  import: '#c586c0',
  export: '#c586c0',
  namespace: '#81a1c1',
}

// Letter-based icon labels (VS Code-style short labels shown in icon badges)
const kindLetters: Record<DocSymbol['kind'], string> = {
  function: 'F',
  class: 'C',
  interface: 'I',
  type: 'T',
  variable: 'V',
  method: 'M',
  property: 'P',
  enum: 'E',
  import: 'Im',
  export: 'Ex',
  namespace: 'N',
}

const kindLabels: Record<DocSymbol['kind'], string> = {
  function: 'Function',
  class: 'Class',
  interface: 'Interface',
  type: 'Type alias',
  variable: 'Variable',
  method: 'Method',
  property: 'Property',
  enum: 'Enum',
  import: 'Import',
  export: 'Export',
  namespace: 'Namespace',
}

const groupLabels: Record<string, string> = {
  function: 'Functions',
  class: 'Classes',
  interface: 'Interfaces',
  type: 'Types',
  variable: 'Variables',
  method: 'Methods',
  property: 'Properties',
  enum: 'Enums',
  import: 'Imports',
  export: 'Exports',
  namespace: 'Namespaces',
}

const kindOrder: DocSymbol['kind'][] = ['namespace', 'class', 'interface', 'enum', 'type', 'function', 'method', 'property', 'variable', 'import', 'export']

type SortMode = 'position' | 'name' | 'kind'
type OutlineScope = 'active' | 'all'

// Highlight matching text in symbol name
function HighlightedName({ name, filter }: { name: string; filter: string }) {
  if (!filter.trim()) {
    return <>{name}</>
  }
  const lower = name.toLowerCase()
  const filterLower = filter.toLowerCase()
  const idx = lower.indexOf(filterLower)
  if (idx === -1) {
    return <>{name}</>
  }
  const before = name.slice(0, idx)
  const match = name.slice(idx, idx + filter.length)
  const after = name.slice(idx + filter.length)
  return (
    <>
      {before}
      <span style={{
        backgroundColor: 'var(--find-match-bg, rgba(234,179,8,0.35))',
        color: 'var(--find-match-fg, #fbbf24)',
        borderRadius: 2,
        padding: '0 1px',
      }}>
        {match}
      </span>
      {after}
    </>
  )
}

export default function OutlinePanel() {
  const { openFiles, activeFilePath } = useEditorStore()
  const activeFile = openFiles.find((f) => f.path === activeFilePath)

  const [filter, setFilter] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('position')
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())
  const [cursorLine, setCursorLine] = useState<number>(1)
  const [followCursor, setFollowCursor] = useState(true)
  const [outlineScope, setOutlineScope] = useState<OutlineScope>('active')
  const symbolListRef = useRef<HTMLDivElement>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)

  // Listen for cursor position changes
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.line) setCursorLine(detail.line)
    }
    window.addEventListener('orion:cursor-position', handler)
    return () => window.removeEventListener('orion:cursor-position', handler)
  }, [])

  // Extract symbols from the active file
  const symbols = useMemo(() => {
    if (!activeFile?.content) return []
    return extractSymbols(activeFile.content, activeFile.language || 'typescript')
  }, [activeFile?.content, activeFile?.language])

  // Multi-file symbols
  const allFileSymbols = useMemo(() => {
    if (outlineScope !== 'all') return null
    const result: { file: { name: string; path: string }; symbols: DocSymbol[]; flat: DocSymbol[] }[] = []
    for (const f of openFiles) {
      if (!f.content) continue
      const syms = extractSymbols(f.content, f.language || 'typescript')
      result.push({ file: { name: f.name, path: f.path }, symbols: syms, flat: flattenSymbols(syms) })
    }
    return result
  }, [openFiles, outlineScope])

  const allSymbolsFlat = useMemo(() => flattenSymbols(symbols), [symbols])

  // Find current symbol under cursor (deepest match)
  const currentSymbol = useMemo(() => {
    if (!followCursor) return null
    return findSymbolAtLine(symbols, cursorLine)
  }, [symbols, cursorLine, followCursor])

  // Find the path of ancestors for the current cursor position
  const currentSymbolPath = useMemo(() => {
    if (!followCursor) return []
    return findSymbolPath(symbols, cursorLine)
  }, [symbols, cursorLine, followCursor])

  // Auto-expand ancestors when following cursor
  useEffect(() => {
    if (!followCursor || currentSymbolPath.length === 0) return
    setCollapsedNodes((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const sym of currentSymbolPath) {
        const key = `${sym.name}-${sym.line}`
        if (next.has(key)) {
          next.delete(key)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [currentSymbolPath, followCursor])

  // Auto-scroll to current symbol
  useEffect(() => {
    if (!followCursor || !currentSymbol || !symbolListRef.current) return
    const key = `sym-${currentSymbol.name}-${currentSymbol.line}`
    // Small delay to let any expand animations complete
    const timer = setTimeout(() => {
      if (!symbolListRef.current) return
      const el = symbolListRef.current.querySelector(`[data-sym-key="${key}"]`)
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }, 60)
    return () => clearTimeout(timer)
  }, [currentSymbol, followCursor])

  // Filter symbols
  const filteredSymbols = useMemo(() => {
    if (!filter.trim()) return allSymbolsFlat
    const lower = filter.toLowerCase()
    return allSymbolsFlat.filter((s) => s.name.toLowerCase().includes(lower))
  }, [allSymbolsFlat, filter])

  // Sort symbols
  const sortedSymbols = useMemo(() => {
    const sorted = [...filteredSymbols]
    if (sortMode === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sortMode === 'kind') {
      sorted.sort((a, b) => {
        const ai = kindOrder.indexOf(a.kind)
        const bi = kindOrder.indexOf(b.kind)
        if (ai !== bi) return ai - bi
        return a.line - b.line
      })
    }
    // 'position' keeps original order (by line number)
    return sorted
  }, [filteredSymbols, sortMode])

  // Group symbols by kind (only for 'kind' sort mode)
  const groupedSymbols = useMemo(() => {
    if (sortMode !== 'kind') return null
    const groups = new Map<string, DocSymbol[]>()
    for (const sym of sortedSymbols) {
      const key = sym.kind
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(sym)
    }
    return groups
  }, [sortedSymbols, sortMode])

  const toggleNode = useCallback((key: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const cycleSortMode = useCallback(() => {
    setSortMode((m) => {
      if (m === 'position') return 'name'
      if (m === 'name') return 'kind'
      return 'position'
    })
  }, [])

  const goToLine = useCallback((line: number) => {
    window.dispatchEvent(
      new CustomEvent('orion:go-to-line', { detail: { line } })
    )
  }, [])

  const copySymbolName = useCallback((name: string) => {
    navigator.clipboard.writeText(name).catch(() => {})
  }, [])

  const peekReferences = useCallback((symbol: DocSymbol) => {
    window.dispatchEvent(
      new CustomEvent('orion:peek-references', { detail: { name: symbol.name, line: symbol.line } })
    )
  }, [])

  const renameSymbol = useCallback((symbol: DocSymbol) => {
    window.dispatchEvent(
      new CustomEvent('orion:rename-symbol', { detail: { name: symbol.name, line: symbol.line } })
    )
  }, [])

  const collapseAll = useCallback(() => {
    const keys = new Set<string>()
    function walk(syms: DocSymbol[]) {
      for (const s of syms) {
        if (s.children && s.children.length > 0) {
          keys.add(`${s.name}-${s.line}`)
          walk(s.children)
        }
      }
    }
    walk(symbols)
    setCollapsedNodes(keys)
  }, [symbols])

  const expandAll = useCallback(() => {
    setCollapsedNodes(new Set())
  }, [])

  const sortLabel = sortMode === 'position' ? 'By position' : sortMode === 'name' ? 'By name' : 'By kind'
  const sortTitle = `Sort: ${sortLabel} (click to cycle)`

  if (!activeFile && outlineScope === 'active') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 12,
          padding: 20,
          gap: 8,
        }}
      >
        <ListTree size={32} strokeWidth={1} />
        <span>No file open</span>
        <span style={{ fontSize: 11 }}>Open a file to see its outline</span>
      </div>
    )
  }

  // Render tree view (position mode, no filter)
  const renderTree = (syms: DocSymbol[], depth: number = 0) => {
    return syms.map((sym, i) => {
      const key = `${sym.name}-${sym.line}`
      const hasChildren = sym.children && sym.children.length > 0
      const isCollapsed = collapsedNodes.has(key)
      const isCurrent = currentSymbol && currentSymbol.name === sym.name && currentSymbol.line === sym.line
      const isInPath = currentSymbolPath.some(s => s.name === sym.name && s.line === sym.line)

      return (
        <div key={`${key}-${i}`} style={{ position: 'relative' }}>
          {/* Indentation guide lines */}
          {depth > 0 && (
            <div style={{
              position: 'absolute',
              left: 8 + (depth - 1) * 16 + 7,
              top: 0,
              bottom: 0,
              width: 1,
              background: isInPath ? 'var(--accent, #3b82f6)' : 'var(--border)',
              opacity: isInPath ? 0.5 : 0.3,
              pointerEvents: 'none',
              zIndex: 1,
            }} />
          )}
          <SymbolItem
            symbol={sym}
            depth={depth}
            hasChildren={hasChildren}
            isCollapsed={isCollapsed}
            isCurrent={!!isCurrent}
            isAncestorOfCurrent={!isCurrent && isInPath}
            filter={filter}
            onToggle={() => toggleNode(key)}
            onClick={() => goToLine(sym.line)}
            onCopyName={() => copySymbolName(sym.name)}
            onPeekReferences={() => peekReferences(sym)}
            onRename={() => renameSymbol(sym)}
          />
          <div style={{
            overflow: 'hidden',
            maxHeight: hasChildren && isCollapsed ? 0 : hasChildren ? '9999px' : 0,
            transition: 'max-height 0.2s ease',
            position: 'relative',
          }}>
            {hasChildren && !isCollapsed && (
              <>
                {/* Indentation guide line for this level */}
                <div style={{
                  position: 'absolute',
                  left: 8 + depth * 16 + 7,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: isInPath ? 'var(--accent, #3b82f6)' : 'var(--border)',
                  opacity: isInPath ? 0.5 : 0.25,
                  pointerEvents: 'none',
                  zIndex: 1,
                }} />
                {renderTree(sym.children!, depth + 1)}
              </>
            )}
          </div>
        </div>
      )
    })
  }

  const showTree = sortMode === 'position' && !filter.trim()

  // Multi-file outline rendering
  const renderMultiFile = () => {
    if (!allFileSymbols || allFileSymbols.length === 0) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 12, padding: 20, gap: 8 }}>
          <Files size={24} strokeWidth={1} />
          <span>No files open</span>
        </div>
      )
    }

    return allFileSymbols.map(({ file, symbols: fileSym, flat }) => {
      const groupKey = `file-group-${file.path}`
      const isCollapsed = collapsedNodes.has(groupKey)
      const matchedSymbols = filter.trim()
        ? flat.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()))
        : flat
      if (filter.trim() && matchedSymbols.length === 0) return null

      return (
        <div key={file.path}>
          <button
            onClick={() => toggleNode(groupKey)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              padding: '5px 8px',
              background: file.path === activeFilePath ? 'var(--bg-tertiary)' : 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              textAlign: 'left',
              userSelect: 'none',
              borderBottom: '1px solid var(--border)',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-tertiary)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = file.path === activeFilePath ? 'var(--bg-tertiary)' : 'none' }}
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <FileText size={12} style={{ color: 'var(--text-muted)' }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{flat.length}</span>
          </button>
          {!isCollapsed && (
            filter.trim() ? (
              matchedSymbols.map((sym, idx) => (
                <SymbolItem
                  key={`${sym.name}-${sym.line}-${idx}`}
                  symbol={sym}
                  depth={1}
                  isCurrent={false}
                  filter={filter}
                  onClick={() => {
                    // Switch to file first if needed
                    if (file.path !== activeFilePath) {
                      const f = openFiles.find(of => of.path === file.path)
                      if (f) {
                        useEditorStore.getState().openFile(f)
                      }
                    }
                    setTimeout(() => goToLine(sym.line), 50)
                  }}
                  onCopyName={() => copySymbolName(sym.name)}
                  onPeekReferences={() => peekReferences(sym)}
                  onRename={() => renameSymbol(sym)}
                />
              ))
            ) : (
              renderFileTreeSymbols(fileSym, 1, file.path)
            )
          )}
        </div>
      )
    })
  }

  const renderFileTreeSymbols = (syms: DocSymbol[], depth: number, filePath: string): React.ReactNode => {
    return syms.map((sym, i) => {
      const key = `${filePath}-${sym.name}-${sym.line}`
      const hasChildren = sym.children && sym.children.length > 0
      const isCollapsed = collapsedNodes.has(key)

      return (
        <div key={`${key}-${i}`} style={{ position: 'relative' }}>
          {depth > 1 && (
            <div style={{
              position: 'absolute',
              left: 8 + (depth - 1) * 16 + 7,
              top: 0,
              bottom: 0,
              width: 1,
              background: 'var(--border)',
              opacity: 0.25,
              pointerEvents: 'none',
            }} />
          )}
          <SymbolItem
            symbol={sym}
            depth={depth}
            hasChildren={hasChildren}
            isCollapsed={isCollapsed}
            isCurrent={false}
            filter={filter}
            onToggle={() => toggleNode(key)}
            onClick={() => {
              if (filePath !== activeFilePath) {
                const f = openFiles.find(of => of.path === filePath)
                if (f) useEditorStore.getState().openFile(f)
              }
              setTimeout(() => goToLine(sym.line), 50)
            }}
            onCopyName={() => copySymbolName(sym.name)}
            onPeekReferences={() => peekReferences(sym)}
            onRename={() => renameSymbol(sym)}
          />
          {hasChildren && !isCollapsed && (
            <div style={{ position: 'relative' }}>
              <div style={{
                position: 'absolute',
                left: 8 + depth * 16 + 7,
                top: 0,
                bottom: 0,
                width: 1,
                background: 'var(--border)',
                opacity: 0.25,
                pointerEvents: 'none',
              }} />
              {renderFileTreeSymbols(sym.children!, depth + 1, filePath)}
            </div>
          )}
        </div>
      )
    })
  }

  const totalSymbolCount = outlineScope === 'all'
    ? (allFileSymbols?.reduce((acc, f) => acc + f.flat.length, 0) || 0)
    : allSymbolsFlat.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header toolbar */}
      <div
        style={{
          padding: '6px 8px',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'var(--text-secondary)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
          userSelect: 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <ListTree size={13} style={{ opacity: 0.7 }} />
          Outline
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* Follow cursor toggle */}
          <ToolbarButton
            active={followCursor}
            title={followCursor ? 'Follow cursor: ON' : 'Follow cursor: OFF'}
            onClick={() => setFollowCursor(f => !f)}
          >
            <Navigation size={13} />
          </ToolbarButton>
          {/* Collapse all */}
          <ToolbarButton
            title="Collapse all"
            onClick={collapseAll}
          >
            <Minus size={13} />
          </ToolbarButton>
          {/* Expand all */}
          <ToolbarButton
            title="Expand all"
            onClick={expandAll}
          >
            <ListTree size={13} />
          </ToolbarButton>
          {/* Sort mode indicator + button */}
          <span style={{
            fontSize: 9,
            color: 'var(--text-muted)',
            marginRight: 1,
            marginLeft: 2,
            textTransform: 'none',
            fontWeight: 400,
            letterSpacing: 0,
          }}>
            {sortLabel}
          </span>
          <ToolbarButton
            title={sortTitle}
            onClick={cycleSortMode}
          >
            {sortMode === 'position' ? <ArrowDown01 size={13} /> : sortMode === 'name' ? <ArrowDownAZ size={13} /> : <Layers size={13} />}
          </ToolbarButton>
        </div>
      </div>

      {/* Scope selector + Search */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        {/* Scope tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '4px 8px 0' }}>
          <button
            onClick={() => setOutlineScope('active')}
            style={{
              flex: 1,
              padding: '3px 0',
              border: 'none',
              borderBottom: outlineScope === 'active' ? '2px solid var(--accent, #3b82f6)' : '2px solid transparent',
              background: 'none',
              color: outlineScope === 'active' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontSize: 11,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontWeight: outlineScope === 'active' ? 600 : 400,
              transition: 'all 0.15s ease',
            }}
            title="Show outline for active file"
          >
            <FileText size={11} />
            Active File
          </button>
          <button
            onClick={() => setOutlineScope('all')}
            style={{
              flex: 1,
              padding: '3px 0',
              border: 'none',
              borderBottom: outlineScope === 'all' ? '2px solid var(--accent, #3b82f6)' : '2px solid transparent',
              background: 'none',
              color: outlineScope === 'all' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontSize: 11,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontWeight: outlineScope === 'all' ? 600 : 400,
              transition: 'all 0.15s ease',
            }}
            title="Show outline for all open files"
          >
            <Files size={11} />
            All Files
          </button>
        </div>

        {/* Search/filter input */}
        <div style={{ padding: '6px 8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--bg-primary)',
              borderRadius: 4,
              border: '1px solid var(--border)',
              padding: '4px 8px',
              transition: 'border-color 0.15s ease',
            }}
            onFocus={() => {}}
          >
            <Search size={12} style={{ color: filter ? 'var(--accent, #3b82f6)' : 'var(--text-muted)', flexShrink: 0, transition: 'color 0.15s' }} />
            <input
              ref={filterInputRef}
              type="text"
              placeholder="Filter symbols..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text-primary)',
                fontSize: 12,
                fontFamily: 'inherit',
              }}
            />
            {filter && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4, whiteSpace: 'nowrap' }}>
                {filteredSymbols.length} found
              </span>
            )}
            {filter && (
              <button
                onClick={() => { setFilter(''); filterInputRef.current?.focus() }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '0 2px',
                  fontSize: 14,
                  lineHeight: 1,
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: 2,
                }}
                title="Clear filter"
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
              >
                x
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Breadcrumb: show current symbol ancestry */}
      {followCursor && currentSymbolPath.length > 0 && !filter.trim() && outlineScope === 'active' && (
        <div style={{
          padding: '3px 8px',
          fontSize: 10,
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          overflow: 'hidden',
          flexShrink: 0,
          userSelect: 'none',
        }}>
          {currentSymbolPath.map((sym, idx) => {
            const Icon = kindIcons[sym.kind] || Hash
            const color = kindColors[sym.kind] || 'var(--text-muted)'
            return (
              <span key={`${sym.name}-${sym.line}`} style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                {idx > 0 && (
                  <ChevronRight size={9} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                )}
                <Icon size={10} style={{ color, opacity: 0.8 }} />
                <span
                  style={{
                    cursor: 'pointer',
                    color: idx === currentSymbolPath.length - 1 ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontWeight: idx === currentSymbolPath.length - 1 ? 500 : 400,
                    maxWidth: 100,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => goToLine(sym.line)}
                  title={`${kindLabels[sym.kind]}: ${sym.name} (Ln ${sym.line})`}
                >
                  {sym.name}
                </span>
              </span>
            )
          })}
        </div>
      )}

      {/* Symbol list */}
      <div ref={symbolListRef} style={{ flex: 1, overflow: 'auto', padding: '2px 0' }}>
        {outlineScope === 'all' ? (
          renderMultiFile()
        ) : (showTree ? symbols.length === 0 : sortedSymbols.length === 0) ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--text-muted)',
              fontSize: 12,
              padding: 20,
              gap: 8,
            }}
          >
            <ListTree size={24} strokeWidth={1} />
            <span>{filter ? 'No matching symbols' : 'No symbols found'}</span>
          </div>
        ) : showTree ? (
          <div style={{ position: 'relative' }}>
            {renderTree(symbols)}
          </div>
        ) : groupedSymbols ? (
          // Grouped by kind
          Array.from(groupedSymbols.entries()).map(([kind, syms]) => {
            const groupKey = `group-${kind}`
            const isCollapsed = collapsedNodes.has(groupKey)
            const GroupIcon = kindIcons[kind as DocSymbol['kind']] || Hash
            const groupColor = kindColors[kind as DocSymbol['kind']] || 'var(--text-muted)'
            return (
              <div key={kind}>
                <button
                  onClick={() => toggleNode(groupKey)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    width: '100%',
                    padding: '5px 8px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 600,
                    textAlign: 'left',
                    userSelect: 'none',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-tertiary)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                >
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 16,
                    height: 16,
                    borderRadius: 3,
                    backgroundColor: `${groupColor}20`,
                    flexShrink: 0,
                  }}>
                    <GroupIcon size={11} style={{ color: groupColor }} />
                  </span>
                  <span>{groupLabels[kind] || kind}</span>
                  <span style={{
                    marginLeft: 'auto',
                    color: 'var(--text-muted)',
                    fontSize: 10,
                    padding: '0 4px',
                    borderRadius: 8,
                    background: 'var(--bg-tertiary)',
                    lineHeight: '16px',
                    minWidth: 18,
                    textAlign: 'center',
                  }}>
                    {syms.length}
                  </span>
                </button>
                <div style={{
                  overflow: 'hidden',
                  maxHeight: isCollapsed ? 0 : '9999px',
                  transition: 'max-height 0.2s ease',
                }}>
                  {!isCollapsed &&
                    syms.map((sym, idx) => (
                      <SymbolItem
                        key={`${sym.name}-${sym.line}-${idx}`}
                        symbol={sym}
                        depth={1}
                        isCurrent={!!(currentSymbol && currentSymbol.name === sym.name && currentSymbol.line === sym.line)}
                        filter={filter}
                        onClick={() => goToLine(sym.line)}
                        onCopyName={() => copySymbolName(sym.name)}
                        onPeekReferences={() => peekReferences(sym)}
                        onRename={() => renameSymbol(sym)}
                      />
                    ))}
                </div>
              </div>
            )
          })
        ) : (
          // Flat list (name sort or filtered)
          sortedSymbols.map((sym, idx) => (
            <SymbolItem
              key={`${sym.name}-${sym.line}-${idx}`}
              symbol={sym}
              depth={0}
              isCurrent={!!(currentSymbol && currentSymbol.name === sym.name && currentSymbol.line === sym.line)}
              filter={filter}
              onClick={() => goToLine(sym.line)}
              onCopyName={() => copySymbolName(sym.name)}
              onPeekReferences={() => peekReferences(sym)}
              onRename={() => renameSymbol(sym)}
            />
          ))
        )}
      </div>

      {/* Footer with file info */}
      <div
        style={{
          padding: '4px 10px',
          fontSize: 10,
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
          gap: 8,
        }}
      >
        <span>{totalSymbolCount} symbol{totalSymbolCount !== 1 ? 's' : ''}</span>
        {followCursor && currentSymbol && (
          <span style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            textAlign: 'center',
            color: 'var(--accent, #3b82f6)',
            fontSize: 10,
          }}>
            {currentSymbol.name}
          </span>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {outlineScope === 'all' ? `${openFiles.length} files` : activeFile?.name || ''}
        </span>
      </div>
    </div>
  )
}

// Toolbar button component
function ToolbarButton({
  title,
  onClick,
  active,
  children,
}: {
  title: string
  onClick: () => void
  active?: boolean
  children: React.ReactNode
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: active ? 'var(--accent-bg, rgba(59,130,246,0.15))' : hovered ? 'var(--bg-tertiary)' : 'none',
        border: active ? '1px solid var(--accent, #3b82f6)' : '1px solid transparent',
        color: active ? 'var(--accent, #3b82f6)' : hovered ? 'var(--text-primary)' : 'var(--text-muted)',
        cursor: 'pointer',
        padding: 3,
        display: 'flex',
        alignItems: 'center',
        borderRadius: 3,
        transition: 'all 0.1s ease',
      }}
    >
      {children}
    </button>
  )
}

function SymbolItem({
  symbol,
  depth = 0,
  hasChildren,
  isCollapsed,
  isCurrent,
  isAncestorOfCurrent,
  filter = '',
  onToggle,
  onClick,
  onCopyName,
  onPeekReferences,
  onRename,
}: {
  symbol: DocSymbol
  depth?: number
  hasChildren?: boolean
  isCollapsed?: boolean
  isCurrent: boolean
  isAncestorOfCurrent?: boolean
  filter?: string
  onToggle?: () => void
  onClick: () => void
  onCopyName?: () => void
  onPeekReferences?: () => void
  onRename?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const Icon = kindIcons[symbol.kind] || Hash
  const color = kindColors[symbol.kind] || 'var(--text-muted)'
  const leftPad = 8 + depth * 16
  const symKey = `sym-${symbol.name}-${symbol.line}`

  // Show tooltip after a short hover delay
  useEffect(() => {
    if (hovered) {
      hoverTimerRef.current = setTimeout(() => setTooltipVisible(true), 600)
    } else {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      setTooltipVisible(false)
    }
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [hovered])

  return (
    <div style={{ position: 'relative' }}>
      <button
        data-sym-key={symKey}
        onClick={(e) => {
          // If clicking on the chevron area and has children, toggle
          if (hasChildren && onToggle) {
            const rect = e.currentTarget.getBoundingClientRect()
            const clickX = e.clientX - rect.left
            if (clickX < leftPad + 16) {
              onToggle()
              return
            }
          }
          onClick()
        }}
        onDoubleClick={() => {
          // Double-click to navigate and expand/collapse
          if (hasChildren && onToggle) {
            onToggle()
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          width: '100%',
          padding: `2px 8px 2px ${leftPad}px`,
          background: isCurrent
            ? 'var(--accent-bg, rgba(59,130,246,0.12))'
            : isAncestorOfCurrent
              ? 'var(--accent-bg, rgba(59,130,246,0.05))'
              : hovered
                ? 'var(--bg-tertiary)'
                : 'transparent',
          border: 'none',
          borderLeft: isCurrent
            ? '2px solid var(--accent, #3b82f6)'
            : isAncestorOfCurrent
              ? '2px solid var(--accent-dim, rgba(59,130,246,0.3))'
              : '2px solid transparent',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
          textAlign: 'left',
          userSelect: 'none',
          transition: 'background 0.1s ease, border-left-color 0.1s ease',
          position: 'relative',
          minHeight: 24,
        }}
      >
        {/* Collapse/expand chevron */}
        {hasChildren ? (
          <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, width: 12 }}>
            {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          </span>
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}

        {/* Symbol icon with kind-colored background badge */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 16,
            height: 16,
            borderRadius: 3,
            backgroundColor: `${color}22`,
            border: `1px solid ${color}33`,
            flexShrink: 0,
            position: 'relative',
          }}
        >
          <Icon size={10} style={{ color }} />
        </span>

        {/* Symbol name + params + export badge */}
        <span style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          lineHeight: '20px',
        }}>
          <span style={{ fontWeight: isCurrent ? 500 : 400 }}>
            <HighlightedName name={symbol.name} filter={filter} />
          </span>
          {/* Show parameters inline for functions/methods */}
          {symbol.params && (
            <span style={{
              color: 'var(--text-muted)',
              fontSize: 10,
              opacity: 0.75,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '40%',
              fontWeight: 400,
            }}>
              {symbol.params}
            </span>
          )}
          {/* Return type */}
          {symbol.returnType && (
            <span style={{
              color: 'var(--text-muted)',
              fontSize: 10,
              opacity: 0.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: 400,
            }}>
              : {symbol.returnType}
            </span>
          )}
          {/* Export badge */}
          {symbol.exported && (
            <span style={{
              fontSize: 8,
              padding: '0 3px',
              borderRadius: 2,
              background: 'rgba(163,190,140,0.15)',
              color: '#a3be8c',
              fontWeight: 600,
              letterSpacing: '0.3px',
              lineHeight: '14px',
              flexShrink: 0,
            }}>
              export
            </span>
          )}
        </span>

        {/* Line number (always visible but faded) */}
        <span style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          flexShrink: 0,
          opacity: hovered ? 0.9 : 0.35,
          fontFamily: 'monospace',
          minWidth: 24,
          textAlign: 'right',
          transition: 'opacity 0.1s',
        }}>
          {symbol.line}
        </span>

        {/* Inline action buttons - visible on hover */}
        {hovered && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 0,
              marginLeft: 1,
              flexShrink: 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <InlineActionButton title="Go to symbol" onClick={onClick}>
              <Navigation size={10} />
            </InlineActionButton>
            <InlineActionButton title="Peek references" onClick={onPeekReferences}>
              <Eye size={10} />
            </InlineActionButton>
            <InlineActionButton title="Copy name" onClick={onCopyName}>
              <Copy size={10} />
            </InlineActionButton>
            <InlineActionButton title="Rename symbol" onClick={onRename}>
              <PenLine size={10} />
            </InlineActionButton>
          </span>
        )}
      </button>

      {/* Hover tooltip with symbol details */}
      {tooltipVisible && (
        <div
          style={{
            position: 'absolute',
            left: leftPad + 30,
            top: '100%',
            zIndex: 1000,
            background: 'var(--bg-secondary, #1e1e2e)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 11,
            color: 'var(--text-primary)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
            minWidth: 180,
            maxWidth: 320,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {/* Symbol name with icon */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              borderRadius: 3,
              backgroundColor: `${color}22`,
              border: `1px solid ${color}33`,
              flexShrink: 0,
            }}>
              <Icon size={11} style={{ color }} />
            </span>
            <span>{symbol.name}</span>
          </div>
          {/* Kind badge + line info */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10, color: 'var(--text-muted)' }}>
            <span style={{
              padding: '1px 5px',
              borderRadius: 3,
              background: `${color}15`,
              color,
              fontWeight: 500,
            }}>
              {kindLabels[symbol.kind] || symbol.kind}
            </span>
            <span>Line {symbol.line}{symbol.endLine && symbol.endLine !== Infinity ? `-${symbol.endLine}` : ''}</span>
            {symbol.exported && (
              <span style={{
                padding: '1px 5px',
                borderRadius: 3,
                background: 'rgba(163,190,140,0.15)',
                color: '#a3be8c',
                fontWeight: 500,
              }}>
                exported
              </span>
            )}
          </div>
          {/* Parameters */}
          {symbol.params && (
            <div style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              fontFamily: "'Cascadia Code', 'Fira Code', monospace",
              marginTop: 2,
              wordBreak: 'break-all',
              padding: '3px 6px',
              borderRadius: 3,
              background: 'var(--bg-primary)',
            }}>
              {symbol.name}{symbol.params}{symbol.returnType ? `: ${symbol.returnType}` : ''}
            </div>
          )}
          {/* Children count */}
          {symbol.children && symbol.children.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
              {symbol.children.length} member{symbol.children.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function InlineActionButton({ title, onClick, children }: { title: string; onClick?: () => void; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onClick?.()
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'var(--bg-quaternary, rgba(255,255,255,0.1))' : 'none',
        border: 'none',
        color: hovered ? 'var(--text-primary)' : 'var(--text-muted)',
        cursor: 'pointer',
        padding: 2,
        display: 'flex',
        alignItems: 'center',
        borderRadius: 3,
        transition: 'all 0.1s ease',
      }}
    >
      {children}
    </button>
  )
}
