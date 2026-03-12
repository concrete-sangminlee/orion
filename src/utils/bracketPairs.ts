/**
 * Bracket pair colorization and matching.
 * Provides rainbow brackets, bracket matching,
 * auto-closing pairs, and bracket scope highlighting.
 */

/* ── Types ─────────────────────────────────────────────── */

export interface BracketPair {
  open: string
  close: string
  type: 'parenthesis' | 'bracket' | 'brace' | 'angle' | 'custom'
}

export interface BracketMatch {
  openLine: number
  openColumn: number
  closeLine: number
  closeColumn: number
  depth: number
  type: BracketPair['type']
  color: string
}

export interface BracketScope {
  startLine: number
  endLine: number
  depth: number
  pair: BracketPair
}

export interface BracketColorOptions {
  enabled: boolean
  maxDepth: number
  colors: string[]
  highlightActive: boolean
  showScopeGuides: boolean
  independentColorPoolPerType: boolean
}

/* ── Default Configuration ────────────────────────────── */

const DEFAULT_PAIRS: BracketPair[] = [
  { open: '(', close: ')', type: 'parenthesis' },
  { open: '[', close: ']', type: 'bracket' },
  { open: '{', close: '}', type: 'brace' },
]

const RAINBOW_COLORS = [
  '#ffd700', // gold
  '#da70d6', // orchid
  '#179fff', // blue
  '#00e68a', // green
  '#ff6b6b', // red
  '#87ceeb', // sky blue
  '#ffa07a', // light salmon
  '#98fb98', // pale green
  '#dda0dd', // plum
]

const DEFAULT_OPTIONS: BracketColorOptions = {
  enabled: true,
  maxDepth: 6,
  colors: RAINBOW_COLORS,
  highlightActive: true,
  showScopeGuides: true,
  independentColorPoolPerType: false,
}

/* ── Language-specific Pairs ──────────────────────────── */

const LANGUAGE_PAIRS: Record<string, BracketPair[]> = {
  html: [
    ...DEFAULT_PAIRS,
    { open: '<', close: '>', type: 'angle' },
  ],
  xml: [
    ...DEFAULT_PAIRS,
    { open: '<', close: '>', type: 'angle' },
  ],
  typescript: DEFAULT_PAIRS,
  typescriptreact: [
    ...DEFAULT_PAIRS,
    { open: '<', close: '>', type: 'angle' },
  ],
  javascript: DEFAULT_PAIRS,
  javascriptreact: [
    ...DEFAULT_PAIRS,
    { open: '<', close: '>', type: 'angle' },
  ],
  rust: DEFAULT_PAIRS,
  go: DEFAULT_PAIRS,
  python: DEFAULT_PAIRS,
  java: [
    ...DEFAULT_PAIRS,
    { open: '<', close: '>', type: 'angle' },
  ],
  cpp: [
    ...DEFAULT_PAIRS,
    { open: '<', close: '>', type: 'angle' },
  ],
}

export function getPairsForLanguage(language: string): BracketPair[] {
  return LANGUAGE_PAIRS[language] || DEFAULT_PAIRS
}

/* ── Bracket Tokenizer ────────────────────────────────── */

interface TokenState {
  inString: boolean
  stringChar: string
  inTemplateString: boolean
  inBlockComment: boolean
  inLineComment: boolean
}

function createTokenState(): TokenState {
  return {
    inString: false,
    stringChar: '',
    inTemplateString: false,
    inBlockComment: false,
    inLineComment: false,
  }
}

function isInStringOrComment(state: TokenState): boolean {
  return state.inString || state.inTemplateString || state.inBlockComment || state.inLineComment
}

function tokenizeLine(line: string, state: TokenState, language: string): { brackets: { char: string; column: number }[]; state: TokenState } {
  const brackets: { char: string; column: number }[] = []
  const pairs = getPairsForLanguage(language)
  const allBrackets = new Set<string>()
  for (const p of pairs) {
    allBrackets.add(p.open)
    allBrackets.add(p.close)
  }

  const newState = { ...state, inLineComment: false }

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    const next = line[i + 1]
    const prev = i > 0 ? line[i - 1] : ''

    // Block comment end
    if (newState.inBlockComment) {
      if (ch === '*' && next === '/') {
        newState.inBlockComment = false
        i++
      }
      continue
    }

    // Line comment
    if (!newState.inString && !newState.inTemplateString) {
      if (ch === '/' && next === '/') {
        newState.inLineComment = true
        break
      }
      if (ch === '#' && (language === 'python' || language === 'ruby' || language === 'shell')) {
        newState.inLineComment = true
        break
      }
      if (ch === '-' && next === '-' && (language === 'lua' || language === 'haskell' || language === 'sql')) {
        newState.inLineComment = true
        break
      }
    }

    // Block comment start
    if (!newState.inString && !newState.inTemplateString && ch === '/' && next === '*') {
      newState.inBlockComment = true
      i++
      continue
    }

    // Template string
    if (ch === '`' && !newState.inString && (language.includes('script') || language.includes('typescript'))) {
      newState.inTemplateString = !newState.inTemplateString
      continue
    }

    // String
    if (!newState.inTemplateString && !newState.inLineComment) {
      if ((ch === '"' || ch === "'") && prev !== '\\') {
        if (newState.inString && ch === newState.stringChar) {
          newState.inString = false
        } else if (!newState.inString) {
          newState.inString = true
          newState.stringChar = ch
        }
        continue
      }
    }

    // Skip if in string/comment
    if (isInStringOrComment(newState)) continue

    // Bracket detection
    if (allBrackets.has(ch)) {
      brackets.push({ char: ch, column: i })
    }
  }

  return { brackets, state: newState }
}

/* ── Main API ─────────────────────────────────────────── */

export function computeBracketPairs(
  content: string,
  language: string,
  options: Partial<BracketColorOptions> = {}
): BracketMatch[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  if (!opts.enabled) return []

  const lines = content.split('\n')
  const pairs = getPairsForLanguage(language)
  const matches: BracketMatch[] = []

  // Stack per bracket type (if independent pools) or single stack
  const stacks: Map<string, { line: number; column: number; depth: number }[]> = new Map()
  const globalDepth: Map<string, number> = new Map()

  let tokenState = createTokenState()

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const result = tokenizeLine(lines[lineIdx], tokenState, language)
    tokenState = result.state

    for (const { char, column } of result.brackets) {
      // Check if it's an opening bracket
      const openPair = pairs.find(p => p.open === char)
      if (openPair) {
        const key = opts.independentColorPoolPerType ? openPair.type : 'all'
        if (!stacks.has(key)) stacks.set(key, [])
        if (!globalDepth.has(key)) globalDepth.set(key, 0)

        const depth = globalDepth.get(key)!
        stacks.get(key)!.push({ line: lineIdx, column, depth })
        globalDepth.set(key, depth + 1)
        continue
      }

      // Check if it's a closing bracket
      const closePair = pairs.find(p => p.close === char)
      if (closePair) {
        const key = opts.independentColorPoolPerType ? closePair.type : 'all'
        const stack = stacks.get(key)
        if (stack && stack.length > 0) {
          const open = stack.pop()!
          const depth = open.depth % opts.maxDepth
          const color = opts.colors[depth % opts.colors.length]

          globalDepth.set(key, Math.max(0, (globalDepth.get(key) || 1) - 1))

          matches.push({
            openLine: open.line,
            openColumn: open.column,
            closeLine: lineIdx,
            closeColumn: column,
            depth: open.depth,
            type: closePair.type,
            color,
          })
        }
      }
    }
  }

  return matches
}

/* ── Find Matching Bracket ────────────────────────────── */

export function findMatchingBracket(
  content: string,
  line: number,
  column: number,
  language: string
): { line: number; column: number } | null {
  const matches = computeBracketPairs(content, language)

  for (const match of matches) {
    if (match.openLine === line && match.openColumn === column) {
      return { line: match.closeLine, column: match.closeColumn }
    }
    if (match.closeLine === line && match.closeColumn === column) {
      return { line: match.openLine, column: match.openColumn }
    }
  }

  return null
}

/* ── Get Bracket at Cursor ────────────────────────────── */

export function getBracketAtCursor(
  content: string,
  line: number,
  column: number,
  language: string
): BracketMatch | null {
  const matches = computeBracketPairs(content, language)

  // Find the innermost bracket pair that contains the cursor
  let best: BracketMatch | null = null

  for (const match of matches) {
    const containsCursor =
      (match.openLine < line || (match.openLine === line && match.openColumn <= column)) &&
      (match.closeLine > line || (match.closeLine === line && match.closeColumn >= column))

    if (containsCursor) {
      if (!best || match.depth > best.depth) {
        best = match
      }
    }
  }

  return best
}

/* ── Get Bracket Scope Guides ─────────────────────────── */

export function getBracketScopes(
  content: string,
  language: string,
  options: Partial<BracketColorOptions> = {}
): BracketScope[] {
  const matches = computeBracketPairs(content, language, options)
  const pairs = getPairsForLanguage(language)

  return matches
    .filter(m => m.closeLine - m.openLine > 0)
    .map(m => ({
      startLine: m.openLine,
      endLine: m.closeLine,
      depth: m.depth,
      pair: pairs.find(p =>
        content.split('\n')[m.openLine]?.[m.openColumn] === p.open
      ) || DEFAULT_PAIRS[0],
    }))
}

/* ── Auto-close Pairs ─────────────────────────────────── */

export interface AutoClosePairResult {
  insert: string
  cursorOffset: number
}

export function shouldAutoClose(
  char: string,
  language: string,
  beforeCursor: string,
  afterCursor: string,
): AutoClosePairResult | null {
  const pairs = getPairsForLanguage(language)
  const pair = pairs.find(p => p.open === char)

  if (!pair) return null

  // Don't auto-close if next char is alphanumeric (completing a word)
  const nextChar = afterCursor[0]
  if (nextChar && /\w/.test(nextChar)) return null

  // Don't auto-close quotes if we're inside a word
  if ((char === '"' || char === "'" || char === '`') && /\w/.test(beforeCursor.slice(-1))) return null

  return {
    insert: pair.close,
    cursorOffset: 0,
  }
}

export function shouldSkipClosing(
  char: string,
  language: string,
  afterCursor: string,
): boolean {
  const pairs = getPairsForLanguage(language)
  const pair = pairs.find(p => p.close === char)

  if (!pair) return false

  // If the next character is the closing bracket we're about to type, skip it
  return afterCursor.startsWith(char)
}

/* ── Surround Selection ───────────────────────────────── */

export function getSurroundPair(char: string, language: string): BracketPair | null {
  const pairs = getPairsForLanguage(language)
  return pairs.find(p => p.open === char) || null
}

export function surroundWithBrackets(text: string, pair: BracketPair): string {
  return `${pair.open}${text}${pair.close}`
}

/* ── Color Resolution ─────────────────────────────────── */

export function getBracketColor(depth: number, options: Partial<BracketColorOptions> = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  return opts.colors[depth % opts.colors.length]
}

export function getUnmatchedBracketColor(): string {
  return '#ff0000'
}

/* ── Monaco Decoration Conversion ─────────────────────── */

export interface BracketDecoration {
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  options: {
    inlineClassName: string
    stickiness: number
  }
}

export function toBracketDecorations(matches: BracketMatch[]): BracketDecoration[] {
  const decorations: BracketDecoration[] = []

  for (const match of matches) {
    // Opening bracket
    decorations.push({
      range: {
        startLineNumber: match.openLine + 1,
        startColumn: match.openColumn + 1,
        endLineNumber: match.openLine + 1,
        endColumn: match.openColumn + 2,
      },
      options: {
        inlineClassName: `bracket-color-${match.depth % 9}`,
        stickiness: 1,
      },
    })

    // Closing bracket
    decorations.push({
      range: {
        startLineNumber: match.closeLine + 1,
        startColumn: match.closeColumn + 1,
        endLineNumber: match.closeLine + 1,
        endColumn: match.closeColumn + 2,
      },
      options: {
        inlineClassName: `bracket-color-${match.depth % 9}`,
        stickiness: 1,
      },
    })
  }

  return decorations
}

/* ── Generate CSS for Bracket Colors ──────────────────── */

export function generateBracketCSS(options: Partial<BracketColorOptions> = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  return opts.colors
    .map((color, i) => `.bracket-color-${i} { color: ${color} !important; }`)
    .join('\n')
}
