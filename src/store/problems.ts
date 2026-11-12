import { create } from 'zustand'

export type ProblemSeverity = 'error' | 'warning' | 'info'

export interface Problem {
  id: string
  severity: ProblemSeverity
  message: string
  file: string
  line: number
  column?: number
  endLine?: number
  endColumn?: number
  source: string
}

export interface ProblemsCount {
  errors: number
  warnings: number
  info: number
}

interface ProblemsStore {
  /** What Monaco currently reports for the open files (see providers/diagnostics). */
  problems: Problem[]
  setProblems: (problems: Problem[]) => void
}

export const useProblemsStore = create<ProblemsStore>((set) => ({
  problems: [],
  setProblems: (problems) => set({ problems }),
}))

/* ── Lint hints ────────────────────────────────────────── */

/** A hint found in one line of JS/TS source, in Monaco's 1-based coordinates. */
export interface LintHint {
  severity: 'warning' | 'info'
  message: string
  source: 'todo' | 'lint-hint'
  line: number
  column: number
  endColumn: number
}

const TODO_RE = /\/\/\s*(TODO|FIXME|HACK|BUG|XXX)[\s:]+(.+)/i
const CONSOLE_RE = /console\.(log|debug|warn|error|info)\s*\(/
const TS_SUPPRESS_RE = /@ts-(ignore|nocheck|expect-error)/
const ESLINT_DISABLE_RE = /eslint-disable[\w-]*/
const EMPTY_CATCH_RE = /catch\s*\([^)]*\)\s*\{\s*\}/
const DEBUGGER_RE = /(?<=^\s*)debugger(?=\s*;?\s*$)/

/**
 * Line-based hints for JS/TS files: TODO comments and code that is easy to
 * leave in by accident. Real errors come from the language services; these
 * are only hints, so none of them is an error.
 */
export function scanLintHints(content: string): LintHint[] {
  const hints: LintHint[] = []
  content.split('\n').forEach((line, idx) => {
    const lineNum = idx + 1
    const trimmed = line.trim()
    const add = (hint: Omit<LintHint, 'line'>) => hints.push({ ...hint, line: lineNum })
    const at = (match: RegExpMatchArray) => {
      const column = (match.index ?? 0) + 1
      return { column, endColumn: column + match[0].length }
    }

    const todo = line.match(TODO_RE)
    if (todo) {
      const tag = todo[1].toUpperCase()
      add({ severity: tag === 'FIXME' || tag === 'BUG' ? 'warning' : 'info', message: `${tag}: ${todo[2].trim()}`, source: 'todo', ...at(todo) })
    }
    // Code hints skip comment lines; the suppression comments below are the exception.
    if (!trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      const consoleCall = line.match(CONSOLE_RE)
      if (consoleCall) add({ severity: 'info', message: `console.${consoleCall[1]} statement`, source: 'lint-hint', ...at(consoleCall) })
      const debuggerStmt = line.match(DEBUGGER_RE)
      if (debuggerStmt) add({ severity: 'warning', message: 'debugger statement', source: 'lint-hint', ...at(debuggerStmt) })
      const emptyCatch = line.match(EMPTY_CATCH_RE)
      if (emptyCatch) add({ severity: 'warning', message: 'Empty catch block', source: 'lint-hint', ...at(emptyCatch) })
    }
    const suppress = line.match(TS_SUPPRESS_RE)
    if (suppress) add({ severity: 'warning', message: `Type checking suppressed with @ts-${suppress[1]}`, source: 'lint-hint', ...at(suppress) })
    const eslint = line.match(ESLINT_DISABLE_RE)
    if (eslint) add({ severity: 'info', message: `Lint rule disabled (${eslint[0]})`, source: 'lint-hint', ...at(eslint) })
  })
  return hints
}

/* ── Selectors ─────────────────────────────────────────── */

export function getProblemsCount(problems: Problem[]): ProblemsCount {
  let errors = 0
  let warnings = 0
  let info = 0
  for (const p of problems) {
    if (p.severity === 'error') errors++
    else if (p.severity === 'warning') warnings++
    else info++
  }
  return { errors, warnings, info }
}

export function getProblemsForFile(problems: Problem[], path: string): Problem[] {
  return problems.filter((p) => p.file === path)
}
