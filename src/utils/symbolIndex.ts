/**
 * Workspace-wide symbol index for code intelligence.
 * Powers "Go to Symbol in Workspace", definition lookup, and reference finding.
 */

import { fuzzyMatch, type FuzzyMatchResult } from './fuzzyMatch'

/* ── Types ─────────────────────────────────────────────── */

export type SymbolKind =
  | 'function' | 'class' | 'interface' | 'type' | 'enum'
  | 'variable' | 'const' | 'method' | 'property' | 'import'
  | 'namespace' | 'component' | 'hook'

export interface SymbolInfo {
  name: string
  kind: SymbolKind
  filePath: string
  line: number
  column: number
  endLine?: number
  containerName?: string
  exported: boolean
  signature?: string
}

export interface SymbolSearchResult {
  symbol: SymbolInfo
  score: number
  indices: number[]
}

/* ── Symbol Parser ─────────────────────────────────────── */

const PATTERNS: Array<{ regex: RegExp; kind: SymbolKind; exported: boolean; nameGroup: number }> = [
  // Exported function
  { regex: /^export\s+(?:async\s+)?function\s+(\w+)/gm, kind: 'function', exported: true, nameGroup: 1 },
  // Exported default function
  { regex: /^export\s+default\s+(?:async\s+)?function\s+(\w+)/gm, kind: 'function', exported: true, nameGroup: 1 },
  // Regular function
  { regex: /^(?:async\s+)?function\s+(\w+)/gm, kind: 'function', exported: false, nameGroup: 1 },
  // Exported class
  { regex: /^export\s+(?:default\s+)?class\s+(\w+)/gm, kind: 'class', exported: true, nameGroup: 1 },
  // Regular class
  { regex: /^class\s+(\w+)/gm, kind: 'class', exported: false, nameGroup: 1 },
  // Exported interface
  { regex: /^export\s+interface\s+(\w+)/gm, kind: 'interface', exported: true, nameGroup: 1 },
  // Regular interface
  { regex: /^interface\s+(\w+)/gm, kind: 'interface', exported: false, nameGroup: 1 },
  // Exported type alias
  { regex: /^export\s+type\s+(\w+)\s*=/gm, kind: 'type', exported: true, nameGroup: 1 },
  // Regular type alias
  { regex: /^type\s+(\w+)\s*=/gm, kind: 'type', exported: false, nameGroup: 1 },
  // Exported enum
  { regex: /^export\s+(?:const\s+)?enum\s+(\w+)/gm, kind: 'enum', exported: true, nameGroup: 1 },
  // Regular enum
  { regex: /^(?:const\s+)?enum\s+(\w+)/gm, kind: 'enum', exported: false, nameGroup: 1 },
  // Exported const/let/var
  { regex: /^export\s+(?:const|let|var)\s+(\w+)/gm, kind: 'const', exported: true, nameGroup: 1 },
  // Top-level const/let/var
  { regex: /^(?:const|let|var)\s+(\w+)/gm, kind: 'variable', exported: false, nameGroup: 1 },
  // Arrow function const
  { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/gm, kind: 'function', exported: false, nameGroup: 1 },
  // React component (PascalCase const with JSX return)
  { regex: /^(?:export\s+)?(?:const|function)\s+([A-Z]\w+)/gm, kind: 'component', exported: false, nameGroup: 1 },
  // React hooks
  { regex: /^(?:export\s+)?(?:const|function)\s+(use[A-Z]\w+)/gm, kind: 'hook', exported: false, nameGroup: 1 },
]

/** CSS symbol patterns */
const CSS_PATTERNS: Array<{ regex: RegExp; kind: SymbolKind }> = [
  { regex: /^\.([a-zA-Z_][\w-]*)\s*\{/gm, kind: 'class' },
  { regex: /^#([a-zA-Z_][\w-]*)\s*\{/gm, kind: 'variable' },
  { regex: /^@keyframes\s+([\w-]+)/gm, kind: 'function' },
  { regex: /^@mixin\s+([\w-]+)/gm, kind: 'function' },
]

function getLineNumber(content: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') line++
  }
  return line
}

function getColumn(content: string, index: number): number {
  let col = 1
  for (let i = index - 1; i >= 0 && content[i] !== '\n'; i--) {
    col++
  }
  return col
}

export function parseSymbols(filePath: string, content: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = []
  const seen = new Set<string>() // Deduplicate by "name:line"

  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const isCSS = ['css', 'scss', 'sass', 'less'].includes(ext)
  const isJSLike = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext)

  const patterns = isCSS ? CSS_PATTERNS.map(p => ({ ...p, exported: false, nameGroup: 1 })) : isJSLike ? PATTERNS : []

  for (const { regex, kind, exported, nameGroup } of patterns) {
    // Reset regex state
    const re = new RegExp(regex.source, regex.flags)
    let match: RegExpExecArray | null

    while ((match = re.exec(content)) !== null) {
      const name = match[nameGroup]
      if (!name) continue
      const line = getLineNumber(content, match.index)
      const key = `${name}:${line}`
      if (seen.has(key)) continue
      seen.add(key)

      symbols.push({
        name,
        kind,
        filePath,
        line,
        column: getColumn(content, match.index),
        exported: exported || match[0].startsWith('export'),
        signature: match[0].trim().slice(0, 100),
      })
    }
  }

  // Detect methods inside classes (indent-based heuristic)
  if (isJSLike) {
    const methodRegex = /^  (?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?(\w+)\s*\(/gm
    let match: RegExpExecArray | null
    let currentClass = ''

    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const classMatch = lines[i].match(/^(?:export\s+)?class\s+(\w+)/)
      if (classMatch) currentClass = classMatch[1]

      const methodMatch = lines[i].match(/^  (?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?(\w+)\s*\(/)
      if (methodMatch && currentClass) {
        const name = methodMatch[1]
        if (name === 'constructor' || name === 'if' || name === 'for' || name === 'while') continue
        const key = `${name}:${i + 1}`
        if (!seen.has(key)) {
          seen.add(key)
          symbols.push({
            name,
            kind: 'method',
            filePath,
            line: i + 1,
            column: lines[i].indexOf(name) + 1,
            containerName: currentClass,
            exported: false,
          })
        }
      }

      // Reset class context at top-level close brace
      if (/^\}/.test(lines[i])) currentClass = ''
    }
  }

  return symbols
}

/* ── Symbol Index ──────────────────────────────────────── */

class SymbolIndexImpl {
  private fileSymbols = new Map<string, SymbolInfo[]>()
  private nameIndex = new Map<string, SymbolInfo[]>() // name -> symbols[]

  /** Index or re-index a file */
  indexFile(filePath: string, content: string): void {
    // Remove old entries
    this.removeFile(filePath)

    // Parse and store
    const symbols = parseSymbols(filePath, content)
    this.fileSymbols.set(filePath, symbols)

    // Update name index
    for (const sym of symbols) {
      const nameLower = sym.name.toLowerCase()
      const existing = this.nameIndex.get(nameLower) || []
      existing.push(sym)
      this.nameIndex.set(nameLower, existing)
    }
  }

  /** Remove a file from the index */
  removeFile(filePath: string): void {
    const old = this.fileSymbols.get(filePath)
    if (old) {
      for (const sym of old) {
        const nameLower = sym.name.toLowerCase()
        const arr = this.nameIndex.get(nameLower)
        if (arr) {
          const filtered = arr.filter(s => s.filePath !== filePath)
          if (filtered.length === 0) this.nameIndex.delete(nameLower)
          else this.nameIndex.set(nameLower, filtered)
        }
      }
      this.fileSymbols.delete(filePath)
    }
  }

  /** Get all symbols for a specific file */
  getSymbolsForFile(filePath: string): SymbolInfo[] {
    return this.fileSymbols.get(filePath) || []
  }

  /** Fuzzy search across all indexed symbols */
  searchSymbols(query: string, limit = 50): SymbolSearchResult[] {
    if (!query) return []

    const results: SymbolSearchResult[] = []

    for (const [, symbols] of this.fileSymbols) {
      for (const sym of symbols) {
        const match = fuzzyMatch(query, sym.name)
        if (match.score > 0) {
          results.push({ symbol: sym, score: match.score, indices: match.indices })
        }
      }
    }

    results.sort((a, b) => {
      // Exported symbols get priority
      if (a.symbol.exported !== b.symbol.exported) return a.symbol.exported ? -1 : 1
      return b.score - a.score
    })

    return results.slice(0, limit)
  }

  /** Find where a symbol is defined */
  getDefinition(name: string): SymbolInfo | undefined {
    const nameLower = name.toLowerCase()
    const symbols = this.nameIndex.get(nameLower)
    if (!symbols || symbols.length === 0) return undefined

    // Prefer exported definitions
    const exported = symbols.find(s => s.exported)
    if (exported) return exported
    return symbols[0]
  }

  /** Find all files that reference a symbol name */
  getReferences(name: string): SymbolInfo[] {
    const nameLower = name.toLowerCase()
    return this.nameIndex.get(nameLower) || []
  }

  /** Get all indexed symbols count */
  get totalSymbols(): number {
    let count = 0
    for (const [, syms] of this.fileSymbols) count += syms.length
    return count
  }

  get indexedFiles(): number {
    return this.fileSymbols.size
  }

  /** Clear entire index */
  clear(): void {
    this.fileSymbols.clear()
    this.nameIndex.clear()
  }
}

export const symbolIndex = new SymbolIndexImpl()
