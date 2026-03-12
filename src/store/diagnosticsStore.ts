/**
 * Diagnostics store.
 * Centralized management of code diagnostics from
 * TypeScript, ESLint, LSP servers, and custom linters.
 */

import { create } from 'zustand'

/* ── Types ─────────────────────────────────────────────── */

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint'
export type DiagnosticTag = 'unnecessary' | 'deprecated'

export interface DiagnosticRange {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export interface Diagnostic {
  id: string
  filePath: string
  range: DiagnosticRange
  severity: DiagnosticSeverity
  message: string
  source: string
  code?: string | number
  codeDescription?: string
  tags?: DiagnosticTag[]
  relatedInformation?: RelatedInformation[]
  quickFixes?: QuickFix[]
}

export interface RelatedInformation {
  filePath: string
  range: DiagnosticRange
  message: string
}

export interface QuickFix {
  title: string
  isPreferred?: boolean
  edits: QuickFixEdit[]
}

export interface QuickFixEdit {
  filePath: string
  range: DiagnosticRange
  newText: string
}

export interface DiagnosticSummary {
  errors: number
  warnings: number
  infos: number
  hints: number
  total: number
}

export interface FileDiagnostics {
  filePath: string
  diagnostics: Diagnostic[]
  summary: DiagnosticSummary
  lastUpdated: number
}

/* ── Store ─────────────────────────────────────────────── */

interface DiagnosticsState {
  diagnosticsByFile: Map<string, Diagnostic[]>
  diagnosticsBySource: Map<string, Set<string>>
  lastUpdateTimestamp: number

  // CRUD
  setDiagnostics: (filePath: string, source: string, diagnostics: Omit<Diagnostic, 'id'>[]) => void
  clearDiagnostics: (filePath: string, source?: string) => void
  clearAllDiagnostics: (source?: string) => void
  addDiagnostic: (diagnostic: Omit<Diagnostic, 'id'>) => string
  removeDiagnostic: (id: string) => void

  // Queries
  getDiagnosticsForFile: (filePath: string) => Diagnostic[]
  getDiagnosticsForFileBySource: (filePath: string, source: string) => Diagnostic[]
  getDiagnosticsAtLine: (filePath: string, line: number) => Diagnostic[]
  getDiagnosticsInRange: (filePath: string, startLine: number, endLine: number) => Diagnostic[]
  getAllDiagnostics: () => Diagnostic[]
  getFilesWithErrors: () => string[]
  getFilesWithDiagnostics: () => string[]

  // Summaries
  getFileSummary: (filePath: string) => DiagnosticSummary
  getGlobalSummary: () => DiagnosticSummary
  getSourceSummary: (source: string) => DiagnosticSummary

  // Navigation
  getNextDiagnostic: (filePath: string, line: number, severity?: DiagnosticSeverity) => Diagnostic | undefined
  getPrevDiagnostic: (filePath: string, line: number, severity?: DiagnosticSeverity) => Diagnostic | undefined
  getFirstError: () => Diagnostic | undefined

  // Filtering
  getDiagnosticsBySeverity: (severity: DiagnosticSeverity) => Diagnostic[]
  searchDiagnostics: (query: string) => Diagnostic[]
  getSources: () => string[]
}

/* ── Helper ───────────────────────────────────────────── */

function makeSummary(diagnostics: Diagnostic[]): DiagnosticSummary {
  const summary: DiagnosticSummary = { errors: 0, warnings: 0, infos: 0, hints: 0, total: diagnostics.length }
  for (const d of diagnostics) {
    switch (d.severity) {
      case 'error': summary.errors++; break
      case 'warning': summary.warnings++; break
      case 'info': summary.infos++; break
      case 'hint': summary.hints++; break
    }
  }
  return summary
}

function genId(): string {
  return `diag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/* ── Store Implementation ──────────────────────────────── */

export const useDiagnosticsStore = create<DiagnosticsState>()((set, get) => ({
  diagnosticsByFile: new Map(),
  diagnosticsBySource: new Map(),
  lastUpdateTimestamp: 0,

  setDiagnostics: (filePath, source, diagnostics) => {
    set(s => {
      const byFile = new Map(s.diagnosticsByFile)
      const existing = byFile.get(filePath) || []

      // Remove old diagnostics from this source
      const kept = existing.filter(d => d.source !== source)

      // Add new diagnostics
      const newDiags: Diagnostic[] = diagnostics.map(d => ({
        ...d,
        id: genId(),
        filePath,
        source,
      }))

      const all = [...kept, ...newDiags]
      if (all.length > 0) {
        byFile.set(filePath, all)
      } else {
        byFile.delete(filePath)
      }

      // Track sources
      const bySource = new Map(s.diagnosticsBySource)
      if (!bySource.has(source)) bySource.set(source, new Set())
      bySource.get(source)!.add(filePath)

      return { diagnosticsByFile: byFile, diagnosticsBySource: bySource, lastUpdateTimestamp: Date.now() }
    })
  },

  clearDiagnostics: (filePath, source) => {
    set(s => {
      const byFile = new Map(s.diagnosticsByFile)
      if (source) {
        const existing = byFile.get(filePath) || []
        const filtered = existing.filter(d => d.source !== source)
        if (filtered.length > 0) {
          byFile.set(filePath, filtered)
        } else {
          byFile.delete(filePath)
        }
      } else {
        byFile.delete(filePath)
      }
      return { diagnosticsByFile: byFile, lastUpdateTimestamp: Date.now() }
    })
  },

  clearAllDiagnostics: (source) => {
    if (source) {
      set(s => {
        const byFile = new Map(s.diagnosticsByFile)
        for (const [filePath, diags] of byFile) {
          const filtered = diags.filter(d => d.source !== source)
          if (filtered.length > 0) {
            byFile.set(filePath, filtered)
          } else {
            byFile.delete(filePath)
          }
        }
        const bySource = new Map(s.diagnosticsBySource)
        bySource.delete(source)
        return { diagnosticsByFile: byFile, diagnosticsBySource: bySource, lastUpdateTimestamp: Date.now() }
      })
    } else {
      set({ diagnosticsByFile: new Map(), diagnosticsBySource: new Map(), lastUpdateTimestamp: Date.now() })
    }
  },

  addDiagnostic: (diagnostic) => {
    const id = genId()
    set(s => {
      const byFile = new Map(s.diagnosticsByFile)
      const existing = byFile.get(diagnostic.filePath) || []
      byFile.set(diagnostic.filePath, [...existing, { ...diagnostic, id }])
      return { diagnosticsByFile: byFile, lastUpdateTimestamp: Date.now() }
    })
    return id
  },

  removeDiagnostic: (id) => {
    set(s => {
      const byFile = new Map(s.diagnosticsByFile)
      for (const [filePath, diags] of byFile) {
        const filtered = diags.filter(d => d.id !== id)
        if (filtered.length !== diags.length) {
          if (filtered.length > 0) {
            byFile.set(filePath, filtered)
          } else {
            byFile.delete(filePath)
          }
          break
        }
      }
      return { diagnosticsByFile: byFile, lastUpdateTimestamp: Date.now() }
    })
  },

  // Queries
  getDiagnosticsForFile: (filePath) => get().diagnosticsByFile.get(filePath) || [],

  getDiagnosticsForFileBySource: (filePath, source) =>
    (get().diagnosticsByFile.get(filePath) || []).filter(d => d.source === source),

  getDiagnosticsAtLine: (filePath, line) =>
    (get().diagnosticsByFile.get(filePath) || []).filter(d =>
      d.range.startLine <= line && d.range.endLine >= line
    ),

  getDiagnosticsInRange: (filePath, startLine, endLine) =>
    (get().diagnosticsByFile.get(filePath) || []).filter(d =>
      d.range.startLine <= endLine && d.range.endLine >= startLine
    ),

  getAllDiagnostics: () => {
    const all: Diagnostic[] = []
    for (const diags of get().diagnosticsByFile.values()) {
      all.push(...diags)
    }
    return all
  },

  getFilesWithErrors: () => {
    const files: string[] = []
    for (const [filePath, diags] of get().diagnosticsByFile) {
      if (diags.some(d => d.severity === 'error')) {
        files.push(filePath)
      }
    }
    return files
  },

  getFilesWithDiagnostics: () => [...get().diagnosticsByFile.keys()],

  // Summaries
  getFileSummary: (filePath) => makeSummary(get().diagnosticsByFile.get(filePath) || []),

  getGlobalSummary: () => makeSummary(get().getAllDiagnostics()),

  getSourceSummary: (source) => {
    const all: Diagnostic[] = []
    for (const diags of get().diagnosticsByFile.values()) {
      all.push(...diags.filter(d => d.source === source))
    }
    return makeSummary(all)
  },

  // Navigation
  getNextDiagnostic: (filePath, line, severity) => {
    const diags = get().getDiagnosticsForFile(filePath)
      .filter(d => !severity || d.severity === severity)
      .sort((a, b) => a.range.startLine - b.range.startLine)

    return diags.find(d => d.range.startLine > line) || diags[0]
  },

  getPrevDiagnostic: (filePath, line, severity) => {
    const diags = get().getDiagnosticsForFile(filePath)
      .filter(d => !severity || d.severity === severity)
      .sort((a, b) => b.range.startLine - a.range.startLine)

    return diags.find(d => d.range.startLine < line) || diags[0]
  },

  getFirstError: () => {
    for (const diags of get().diagnosticsByFile.values()) {
      const error = diags.find(d => d.severity === 'error')
      if (error) return error
    }
    return undefined
  },

  // Filtering
  getDiagnosticsBySeverity: (severity) =>
    get().getAllDiagnostics().filter(d => d.severity === severity),

  searchDiagnostics: (query) => {
    const lower = query.toLowerCase()
    return get().getAllDiagnostics().filter(d =>
      d.message.toLowerCase().includes(lower) ||
      d.filePath.toLowerCase().includes(lower) ||
      d.source.toLowerCase().includes(lower) ||
      String(d.code || '').toLowerCase().includes(lower)
    )
  },

  getSources: () => [...get().diagnosticsBySource.keys()],
}))
