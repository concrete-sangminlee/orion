/**
 * Indentation detection and management.
 * Auto-detects indent style from file content,
 * provides indent conversion and smart indent operations.
 */

/* ── Types ─────────────────────────────────────────────── */

export type IndentStyle = 'spaces' | 'tabs'

export interface IndentInfo {
  style: IndentStyle
  size: number
  confidence: number // 0-1
  mixed: boolean
  tabCount: number
  spaceCount: number
  dominantSpaceSize: number
}

export interface IndentOptions {
  style: IndentStyle
  size: number
  detectFromContent: boolean
  trimAutoWhitespace: boolean
}

/* ── Detection ────────────────────────────────────────── */

export function detectIndentation(content: string, defaultSize: number = 2): IndentInfo {
  const lines = content.split('\n')
  let tabCount = 0
  let spaceCount = 0
  const spaceSizes: Record<number, number> = {}
  let prevIndent = 0

  for (const line of lines) {
    if (line.trim() === '') continue

    const match = line.match(/^(\s+)/)
    if (!match) {
      prevIndent = 0
      continue
    }

    const ws = match[1]

    if (ws.includes('\t')) {
      tabCount++
    } else {
      spaceCount++
      const size = ws.length
      const diff = Math.abs(size - prevIndent)
      if (diff > 0 && diff <= 8) {
        spaceSizes[diff] = (spaceSizes[diff] || 0) + 1
      }
    }

    prevIndent = ws.length
  }

  // Find most common space indent size
  let dominantSpaceSize = defaultSize
  let maxFreq = 0
  for (const [size, freq] of Object.entries(spaceSizes)) {
    if (freq > maxFreq) {
      maxFreq = freq
      dominantSpaceSize = parseInt(size)
    }
  }

  const total = tabCount + spaceCount
  if (total === 0) {
    return {
      style: 'spaces',
      size: defaultSize,
      confidence: 0,
      mixed: false,
      tabCount: 0,
      spaceCount: 0,
      dominantSpaceSize: defaultSize,
    }
  }

  const useTabs = tabCount > spaceCount
  const confidence = Math.abs(tabCount - spaceCount) / total
  const mixed = tabCount > 0 && spaceCount > 0 && Math.min(tabCount, spaceCount) / total > 0.1

  return {
    style: useTabs ? 'tabs' : 'spaces',
    size: useTabs ? 4 : dominantSpaceSize,
    confidence: Math.min(confidence + 0.3, 1),
    mixed,
    tabCount,
    spaceCount,
    dominantSpaceSize,
  }
}

/* ── Conversion ───────────────────────────────────────── */

export function convertIndentation(
  content: string,
  fromStyle: IndentStyle,
  fromSize: number,
  toStyle: IndentStyle,
  toSize: number
): string {
  const lines = content.split('\n')

  return lines.map(line => {
    const match = line.match(/^(\s*)(.*)$/)
    if (!match) return line

    const [, whitespace, rest] = match
    if (!whitespace) return line

    // Count indent level
    let level: number
    if (fromStyle === 'tabs') {
      level = 0
      for (const ch of whitespace) {
        if (ch === '\t') level++
        else level += 1 / fromSize
      }
      level = Math.round(level)
    } else {
      level = Math.round(whitespace.length / fromSize)
    }

    // Generate new indentation
    const newIndent = toStyle === 'tabs'
      ? '\t'.repeat(level)
      : ' '.repeat(level * toSize)

    return newIndent + rest
  }).join('\n')
}

export function tabsToSpaces(content: string, tabSize: number): string {
  return convertIndentation(content, 'tabs', tabSize, 'spaces', tabSize)
}

export function spacesToTabs(content: string, spaceSize: number): string {
  return convertIndentation(content, 'spaces', spaceSize, 'tabs', spaceSize)
}

/* ── Smart Indent ─────────────────────────────────────── */

export interface SmartIndentResult {
  indent: string
  shouldIndent: boolean
  shouldDedent: boolean
}

const INCREASE_INDENT_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    /\{[^}]*$/,
    /\([^)]*$/,
    /\[[^\]]*$/,
    /=>\s*$/,
    /:\s*$/,
    /\b(if|else|for|while|do|switch|try|catch|finally)\b.*[^;{]$/,
  ],
  python: [
    /:\s*(#.*)?$/,
  ],
  rust: [
    /\{[^}]*$/,
    /\([^)]*$/,
    /\[[^\]]*$/,
    /=>\s*\{?\s*$/,
  ],
  go: [
    /\{[^}]*$/,
    /\([^)]*$/,
    /\[[^\]]*$/,
  ],
  html: [
    /<[a-zA-Z][^/]*>$/,
  ],
}

const DECREASE_INDENT_PATTERNS: Record<string, RegExp[]> = {
  typescript: [/^\s*\}/, /^\s*\)/, /^\s*\]/, /^\s*case\b/, /^\s*default:/],
  python: [/^\s*(return|break|continue|pass|raise)\b/, /^\s*(elif|else|except|finally)\b/],
  rust: [/^\s*\}/, /^\s*\)/, /^\s*\]/],
  go: [/^\s*\}/, /^\s*\)/, /^\s*\]/],
  html: [/^\s*<\//],
}

export function computeSmartIndent(
  currentLine: string,
  previousLine: string,
  language: string,
  indentStr: string
): SmartIndentResult {
  const prevTrimmed = previousLine.trimEnd()
  const currentTrimmed = currentLine.trim()

  // Get previous line's indentation
  const prevMatch = previousLine.match(/^(\s*)/)
  const prevIndent = prevMatch ? prevMatch[1] : ''

  // Check if we should increase indent
  const increasePatterns = INCREASE_INDENT_PATTERNS[language] || INCREASE_INDENT_PATTERNS.typescript || []
  const shouldIndent = increasePatterns.some(p => p.test(prevTrimmed))

  // Check if current line should decrease indent
  const decreasePatterns = DECREASE_INDENT_PATTERNS[language] || DECREASE_INDENT_PATTERNS.typescript || []
  const shouldDedent = decreasePatterns.some(p => p.test(currentLine))

  let indent = prevIndent
  if (shouldIndent) {
    indent = prevIndent + indentStr
  }
  if (shouldDedent && indent.length >= indentStr.length) {
    indent = indent.slice(0, -indentStr.length)
  }

  return { indent, shouldIndent, shouldDedent }
}

/* ── Line Operations ──────────────────────────────────── */

export function indentLines(
  content: string,
  startLine: number,
  endLine: number,
  indentStr: string
): string {
  const lines = content.split('\n')
  for (let i = startLine; i <= endLine && i < lines.length; i++) {
    if (lines[i].trim() !== '') {
      lines[i] = indentStr + lines[i]
    }
  }
  return lines.join('\n')
}

export function outdentLines(
  content: string,
  startLine: number,
  endLine: number,
  indentStr: string
): string {
  const lines = content.split('\n')
  for (let i = startLine; i <= endLine && i < lines.length; i++) {
    if (lines[i].startsWith(indentStr)) {
      lines[i] = lines[i].slice(indentStr.length)
    } else if (lines[i].startsWith('\t')) {
      lines[i] = lines[i].slice(1)
    } else {
      // Remove leading spaces up to indent size
      const match = lines[i].match(/^(\s+)/)
      if (match && match[1].length <= indentStr.length) {
        lines[i] = lines[i].slice(match[1].length)
      }
    }
  }
  return lines.join('\n')
}

export function getIndentString(style: IndentStyle, size: number): string {
  return style === 'tabs' ? '\t' : ' '.repeat(size)
}

export function getLineIndentLevel(line: string, tabSize: number): number {
  const match = line.match(/^(\s*)/)
  if (!match) return 0
  let count = 0
  for (const ch of match[1]) {
    count += ch === '\t' ? tabSize : 1
  }
  return Math.floor(count / tabSize)
}

/* ── Trimming ─────────────────────────────────────────── */

export function trimTrailingWhitespace(content: string, preserveCursorLine?: number): string {
  return content.split('\n').map((line, i) => {
    if (i === preserveCursorLine) return line
    return line.replace(/\s+$/, '')
  }).join('\n')
}

export function ensureFinalNewline(content: string): string {
  if (content.length === 0) return '\n'
  if (!content.endsWith('\n')) return content + '\n'
  return content
}

export function trimFinalNewlines(content: string): string {
  return content.replace(/\n+$/, '\n')
}
