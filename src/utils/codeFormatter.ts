/**
 * Code formatting engine with built-in formatters for common languages.
 * Provides configurable formatting options and language-specific rules.
 */

/* ── Types ─────────────────────────────────────────────── */

export interface FormatOptions {
  tabSize: number
  insertSpaces: boolean
  trimTrailingWhitespace: boolean
  insertFinalNewline: boolean
  trimFinalNewlines: boolean
  maxLineLength: number
  endOfLine: 'lf' | 'crlf' | 'auto'
  semicolons: boolean
  singleQuote: boolean
  trailingComma: 'none' | 'es5' | 'all'
  bracketSpacing: boolean
  arrowParens: 'always' | 'avoid'
  printWidth: number
  jsxSingleQuote: boolean
}

export interface FormatResult {
  formatted: string
  changed: boolean
  errors: FormatError[]
}

export interface FormatError {
  line: number
  column: number
  message: string
  severity: 'error' | 'warning'
}

export interface FormatRange {
  startLine: number
  endLine: number
}

/* ── Default Options ──────────────────────────────────── */

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  tabSize: 2,
  insertSpaces: true,
  trimTrailingWhitespace: true,
  insertFinalNewline: true,
  trimFinalNewlines: true,
  maxLineLength: 120,
  endOfLine: 'lf',
  semicolons: true,
  singleQuote: true,
  trailingComma: 'es5',
  bracketSpacing: true,
  arrowParens: 'always',
  printWidth: 80,
  jsxSingleQuote: false,
}

/* ── Indent Helpers ───────────────────────────────────── */

function getIndent(options: FormatOptions): string {
  return options.insertSpaces ? ' '.repeat(options.tabSize) : '\t'
}

function getLineIndentLevel(line: string, tabSize: number): number {
  let spaces = 0
  for (const ch of line) {
    if (ch === ' ') spaces++
    else if (ch === '\t') spaces += tabSize
    else break
  }
  return Math.floor(spaces / tabSize)
}

function setLineIndent(line: string, level: number, options: FormatOptions): string {
  const trimmed = line.replace(/^[\t ]+/, '')
  if (!trimmed) return ''
  return getIndent(options).repeat(level) + trimmed
}

/* ── EOL Handling ─────────────────────────────────────── */

function normalizeEOL(text: string, eol: 'lf' | 'crlf' | 'auto'): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (eol === 'crlf') return normalized.replace(/\n/g, '\r\n')
  return normalized
}

/* ── Whitespace Trimming ──────────────────────────────── */

function trimTrailingWhitespace(lines: string[]): string[] {
  return lines.map(l => l.replace(/[\t ]+$/, ''))
}

function trimFinalNewlines(text: string): string {
  return text.replace(/\n+$/, '\n')
}

/* ── JavaScript/TypeScript Formatter ──────────────────── */

function formatJavaScript(code: string, options: FormatOptions): FormatResult {
  const errors: FormatError[] = []
  let lines = code.split('\n')

  // Trim trailing whitespace
  if (options.trimTrailingWhitespace) {
    lines = trimTrailingWhitespace(lines)
  }

  // Fix indentation based on brace counting
  let indentLevel = 0
  const formatted: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) {
      formatted.push('')
      continue
    }

    // Decrease indent for closing braces/brackets
    const startsWithClose = /^[}\])]/.test(line)
    if (startsWithClose && indentLevel > 0) indentLevel--

    // Handle case/default in switch
    const isCase = /^(case\s|default:)/.test(line)
    const caseAdjust = isCase ? -1 : 0
    const effectiveLevel = Math.max(0, indentLevel + caseAdjust)

    formatted.push(setLineIndent(line, effectiveLevel, options))

    // Count brace changes (ignoring strings and comments)
    const stripped = stripStringsAndComments(line)
    const opens = (stripped.match(/[{(\[]/g) || []).length
    const closes = (stripped.match(/[})\]]/g) || []).length
    indentLevel += opens - closes
    if (!startsWithClose) indentLevel = Math.max(0, indentLevel)

    // Warn about long lines
    if (formatted[formatted.length - 1].length > options.maxLineLength) {
      errors.push({
        line: i + 1,
        column: options.maxLineLength,
        message: `Line exceeds ${options.maxLineLength} characters`,
        severity: 'warning',
      })
    }
  }

  // Quote style
  let result = formatted.join('\n')
  if (options.singleQuote) {
    result = convertQuotes(result, 'single')
  }

  // Semicolons
  if (!options.semicolons) {
    result = removeSemicolons(result)
  }

  // Bracket spacing
  if (options.bracketSpacing) {
    result = addBracketSpacing(result)
  }

  // Final newline
  if (options.insertFinalNewline && !result.endsWith('\n')) {
    result += '\n'
  }
  if (options.trimFinalNewlines) {
    result = trimFinalNewlines(result)
  }

  // EOL
  result = normalizeEOL(result, options.endOfLine)

  return { formatted: result, changed: result !== code, errors }
}

/* ── CSS Formatter ────────────────────────────────────── */

function formatCSS(code: string, options: FormatOptions): FormatResult {
  const errors: FormatError[] = []
  let lines = code.split('\n')

  if (options.trimTrailingWhitespace) {
    lines = trimTrailingWhitespace(lines)
  }

  let indentLevel = 0
  const formatted: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      formatted.push('')
      continue
    }

    if (trimmed.startsWith('}')) {
      indentLevel = Math.max(0, indentLevel - 1)
    }

    formatted.push(setLineIndent(trimmed, indentLevel, options))

    if (trimmed.endsWith('{')) {
      indentLevel++
    }
  }

  let result = formatted.join('\n')

  // Ensure space before opening brace
  result = result.replace(/\s*\{/g, ' {')

  // Ensure newline after opening brace
  result = result.replace(/\{\s*([^\s}])/g, '{\n$1')

  // Ensure space after colons in properties
  result = result.replace(/:\s*/g, ': ').replace(/: \s+/g, ': ')

  // Ensure semicolons at end of declarations
  result = result.replace(/([^;{}\s])\s*\n\s*}/g, '$1;\n}')

  if (options.insertFinalNewline && !result.endsWith('\n')) result += '\n'
  if (options.trimFinalNewlines) result = trimFinalNewlines(result)
  result = normalizeEOL(result, options.endOfLine)

  return { formatted: result, changed: result !== code, errors }
}

/* ── JSON Formatter ───────────────────────────────────── */

function formatJSON(code: string, options: FormatOptions): FormatResult {
  const errors: FormatError[] = []
  try {
    const parsed = JSON.parse(code)
    const indent = options.insertSpaces ? options.tabSize : '\t'
    let result = JSON.stringify(parsed, null, indent)

    if (options.insertFinalNewline && !result.endsWith('\n')) result += '\n'
    result = normalizeEOL(result, options.endOfLine)

    return { formatted: result, changed: result !== code, errors }
  } catch (e: any) {
    const match = e.message?.match(/position (\d+)/)
    const pos = match ? parseInt(match[1]) : 0
    const beforeError = code.slice(0, pos)
    const line = (beforeError.match(/\n/g) || []).length + 1
    const column = pos - beforeError.lastIndexOf('\n')

    errors.push({ line, column, message: e.message || 'Invalid JSON', severity: 'error' })
    return { formatted: code, changed: false, errors }
  }
}

/* ── HTML Formatter ───────────────────────────────────── */

function formatHTML(code: string, options: FormatOptions): FormatResult {
  const errors: FormatError[] = []
  const lines = code.split('\n')
  const formatted: string[] = []
  let indentLevel = 0

  const voidElements = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
  ])

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      formatted.push('')
      continue
    }

    // Closing tag decreases indent
    const closingMatch = trimmed.match(/^<\/(\w+)/)
    if (closingMatch) {
      indentLevel = Math.max(0, indentLevel - 1)
    }

    formatted.push(setLineIndent(trimmed, indentLevel, options))

    // Opening tag increases indent (unless self-closing or void)
    const openingMatch = trimmed.match(/^<(\w+)/)
    if (openingMatch && !voidElements.has(openingMatch[1].toLowerCase())) {
      if (!trimmed.includes('/>') && !trimmed.includes(`</${openingMatch[1]}`)) {
        indentLevel++
      }
    }
  }

  let result = formatted.join('\n')
  if (options.insertFinalNewline && !result.endsWith('\n')) result += '\n'
  if (options.trimFinalNewlines) result = trimFinalNewlines(result)
  result = normalizeEOL(result, options.endOfLine)

  return { formatted: result, changed: result !== code, errors }
}

/* ── Python Formatter ─────────────────────────────────── */

function formatPython(code: string, options: FormatOptions): FormatResult {
  const errors: FormatError[] = []
  let lines = code.split('\n')

  if (options.trimTrailingWhitespace) {
    lines = trimTrailingWhitespace(lines)
  }

  // PEP 8: ensure two blank lines before top-level definitions
  const formatted: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Check for top-level class/function definitions
    if (/^(class |def |async def )/.test(trimmed) && i > 0) {
      const prevNonEmpty = findPrevNonEmpty(formatted)
      if (prevNonEmpty !== -1 && !formatted[prevNonEmpty].trim().startsWith('#')) {
        // Ensure two blank lines
        let blanks = 0
        for (let j = formatted.length - 1; j >= 0; j--) {
          if (formatted[j].trim() === '') blanks++
          else break
        }
        while (blanks < 2) {
          formatted.push('')
          blanks++
        }
      }
    }

    formatted.push(line)

    // Warn about lines > 79 chars (PEP 8)
    if (line.length > 79) {
      errors.push({
        line: i + 1,
        column: 79,
        message: 'Line exceeds 79 characters (PEP 8)',
        severity: 'warning',
      })
    }
  }

  let result = formatted.join('\n')
  if (options.insertFinalNewline && !result.endsWith('\n')) result += '\n'
  result = normalizeEOL(result, options.endOfLine)

  return { formatted: result, changed: result !== code, errors }
}

/* ── Markdown Formatter ───────────────────────────────── */

function formatMarkdown(code: string, options: FormatOptions): FormatResult {
  let lines = code.split('\n')

  if (options.trimTrailingWhitespace) {
    // In markdown, trailing spaces can mean <br>, so only trim if > 2 spaces
    lines = lines.map(l => {
      const trailing = l.match(/(\s+)$/)?.[1] || ''
      if (trailing.length === 2 && trailing === '  ') return l // Intentional <br>
      return l.replace(/[\t ]+$/, '')
    })
  }

  // Ensure blank line before headings
  const formatted: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^#{1,6}\s/.test(line) && i > 0 && formatted[formatted.length - 1]?.trim() !== '') {
      formatted.push('')
    }
    formatted.push(line)
  }

  let result = formatted.join('\n')
  if (options.insertFinalNewline && !result.endsWith('\n')) result += '\n'
  if (options.trimFinalNewlines) result = trimFinalNewlines(result)
  result = normalizeEOL(result, options.endOfLine)

  return { formatted: result, changed: result !== code, errors: [] }
}

/* ── String Helpers ───────────────────────────────────── */

function stripStringsAndComments(line: string): string {
  let result = ''
  let inString: string | null = null
  let escaped = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\') {
      escaped = true
      continue
    }

    if (inString) {
      if (ch === inString) inString = null
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch
      continue
    }

    if (ch === '/' && line[i + 1] === '/') break
    if (ch === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2)
      if (end >= 0) { i = end + 1; continue }
      break
    }

    result += ch
  }

  return result
}

function convertQuotes(code: string, style: 'single' | 'double'): string {
  const from = style === 'single' ? '"' : "'"
  const to = style === 'single' ? "'" : '"'

  return code.replace(new RegExp(`(?<!\\\\)${from === '"' ? '"' : "'"}([^${from}\\\\]*(?:\\\\.[^${from}\\\\]*)*)${from === '"' ? '"' : "'"}`, 'g'), (match) => {
    // Don't convert if the string contains the target quote
    const inner = match.slice(1, -1)
    if (inner.includes(to)) return match
    return to + inner + to
  })
}

function removeSemicolons(code: string): string {
  const lines = code.split('\n')
  return lines.map(line => {
    const trimmed = line.trimEnd()
    if (trimmed.endsWith(';')) {
      // Don't remove semicolons in for loops
      if (/\bfor\s*\(/.test(trimmed)) return line
      return line.slice(0, line.lastIndexOf(';')) + line.slice(line.lastIndexOf(';') + 1)
    }
    return line
  }).join('\n')
}

function addBracketSpacing(code: string): string {
  // Add spaces inside object braces: {a} → { a }
  return code
    .replace(/\{(\S)/g, (m, c) => c === '}' ? m : `{ ${c}`)
    .replace(/(\S)\}/g, (m, c) => c === '{' ? m : `${c} }`)
}

function findPrevNonEmpty(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== '') return i
  }
  return -1
}

/* ── Format Range ─────────────────────────────────────── */

export function formatRange(code: string, range: FormatRange, language: string, options?: Partial<FormatOptions>): FormatResult {
  const lines = code.split('\n')
  const selectedLines = lines.slice(range.startLine, range.endLine + 1)
  const selectedCode = selectedLines.join('\n')

  const fullOptions = { ...DEFAULT_FORMAT_OPTIONS, ...options }
  const result = formatCode(selectedCode, language, fullOptions)

  if (!result.changed) return { formatted: code, changed: false, errors: result.errors }

  const formattedLines = result.formatted.split('\n')
  const newLines = [
    ...lines.slice(0, range.startLine),
    ...formattedLines,
    ...lines.slice(range.endLine + 1),
  ]

  return {
    formatted: newLines.join('\n'),
    changed: true,
    errors: result.errors.map(e => ({ ...e, line: e.line + range.startLine })),
  }
}

/* ── Main Entry Point ─────────────────────────────────── */

export function formatCode(code: string, language: string, options?: Partial<FormatOptions>): FormatResult {
  const fullOptions = { ...DEFAULT_FORMAT_OPTIONS, ...options }

  switch (language) {
    case 'javascript':
    case 'javascriptreact':
    case 'typescript':
    case 'typescriptreact':
      return formatJavaScript(code, fullOptions)

    case 'css':
    case 'scss':
    case 'less':
      return formatCSS(code, fullOptions)

    case 'json':
    case 'jsonc':
      return formatJSON(code, fullOptions)

    case 'html':
      return formatHTML(code, fullOptions)

    case 'python':
      return formatPython(code, fullOptions)

    case 'markdown':
      return formatMarkdown(code, fullOptions)

    default:
      return formatGeneric(code, fullOptions)
  }
}

function formatGeneric(code: string, options: FormatOptions): FormatResult {
  let lines = code.split('\n')

  if (options.trimTrailingWhitespace) {
    lines = trimTrailingWhitespace(lines)
  }

  let result = lines.join('\n')
  if (options.insertFinalNewline && !result.endsWith('\n')) result += '\n'
  if (options.trimFinalNewlines) result = trimFinalNewlines(result)
  result = normalizeEOL(result, options.endOfLine)

  return { formatted: result, changed: result !== code, errors: [] }
}

/* ── EditorConfig Parser ──────────────────────────────── */

export function parseEditorConfig(content: string): Partial<FormatOptions> {
  const options: Partial<FormatOptions> = {}
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue

    const [key, value] = trimmed.split('=').map(s => s.trim().toLowerCase())

    switch (key) {
      case 'indent_style':
        options.insertSpaces = value === 'space'
        break
      case 'indent_size':
        if (value !== 'tab') options.tabSize = parseInt(value)
        break
      case 'tab_width':
        options.tabSize = parseInt(value)
        break
      case 'end_of_line':
        if (value === 'lf' || value === 'crlf') options.endOfLine = value
        break
      case 'trim_trailing_whitespace':
        options.trimTrailingWhitespace = value === 'true'
        break
      case 'insert_final_newline':
        options.insertFinalNewline = value === 'true'
        break
      case 'max_line_length':
        if (value !== 'off') options.maxLineLength = parseInt(value)
        break
    }
  }

  return options
}

/* ── Prettier Config Parser ───────────────────────────── */

export function parsePrettierConfig(config: Record<string, any>): Partial<FormatOptions> {
  const options: Partial<FormatOptions> = {}

  if (config.tabWidth !== undefined) options.tabSize = config.tabWidth
  if (config.useTabs !== undefined) options.insertSpaces = !config.useTabs
  if (config.semi !== undefined) options.semicolons = config.semi
  if (config.singleQuote !== undefined) options.singleQuote = config.singleQuote
  if (config.trailingComma !== undefined) options.trailingComma = config.trailingComma
  if (config.bracketSpacing !== undefined) options.bracketSpacing = config.bracketSpacing
  if (config.arrowParens !== undefined) options.arrowParens = config.arrowParens
  if (config.printWidth !== undefined) options.printWidth = config.printWidth
  if (config.jsxSingleQuote !== undefined) options.jsxSingleQuote = config.jsxSingleQuote
  if (config.endOfLine !== undefined) {
    if (config.endOfLine === 'lf' || config.endOfLine === 'crlf') {
      options.endOfLine = config.endOfLine
    }
  }

  return options
}

/* ── Detect Indent Style ──────────────────────────────── */

export function detectIndentStyle(code: string): { spaces: boolean; size: number } {
  const lines = code.split('\n').filter(l => l.match(/^\s+\S/))
  let tabCount = 0
  let spaceCount = 0
  const spaceSizes: Record<number, number> = {}

  for (const line of lines.slice(0, 100)) {
    if (line.startsWith('\t')) {
      tabCount++
    } else {
      const match = line.match(/^( +)/)
      if (match) {
        spaceCount++
        const len = match[1].length
        spaceSizes[len] = (spaceSizes[len] || 0) + 1
      }
    }
  }

  const usesSpaces = spaceCount >= tabCount
  let size = 2

  if (usesSpaces) {
    // Find most common indent size (GCD of common indent widths)
    const sorted = Object.entries(spaceSizes)
      .sort(([, a], [, b]) => b - a)
      .map(([k]) => parseInt(k))

    if (sorted.length > 0) {
      const candidates = [2, 4, 8]
      const best = candidates.reduce((prev, curr) => {
        const prevScore = sorted.filter(s => s % prev === 0).length
        const currScore = sorted.filter(s => s % curr === 0).length
        return currScore > prevScore ? curr : prev
      })
      size = best
    }
  }

  return { spaces: usesSpaces, size }
}
