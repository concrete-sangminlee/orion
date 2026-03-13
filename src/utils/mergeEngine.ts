/**
 * 3-Way Merge Engine for Orion IDE.
 * Implements a production-quality 3-way merge algorithm with conflict detection,
 * multiple resolution strategies, line/word-level diffing, semantic awareness,
 * and merge preview generation. No external dependencies.
 */

/* ── Types ─────────────────────────────────────────────── */

export type ConflictResolutionStrategy =
  | 'auto'
  | 'ours'
  | 'theirs'
  | 'union'
  | 'smart-merge'

export type ChangeType = 'unchanged' | 'added' | 'removed' | 'modified'

export type MergeSectionKind =
  | 'unchanged'
  | 'auto-resolved'
  | 'conflict'
  | 'ours-only'
  | 'theirs-only'

export interface LineDiff {
  type: ChangeType
  lineNumber: number
  content: string
}

export interface WordDiff {
  type: 'equal' | 'added' | 'removed'
  value: string
}

export interface WordDiffResult {
  oursWords: WordDiff[]
  theirsWords: WordDiff[]
  hasConflict: boolean
}

export interface Change {
  type: ChangeType
  baseStart: number
  baseEnd: number
  modifiedStart: number
  modifiedEnd: number
  baseLines: string[]
  modifiedLines: string[]
}

export interface MergeConflict {
  id: string
  baseRange: LineRange
  oursRange: LineRange
  theirsRange: LineRange
  baseContent: string[]
  oursContent: string[]
  theirsContent: string[]
  wordDiff?: WordDiffResult
  resolution?: ConflictResolutionStrategy
  resolvedContent?: string[]
  isSemanticBlock: boolean
}

export interface LineRange {
  start: number
  end: number
}

export interface MergeSection {
  kind: MergeSectionKind
  lines: string[]
  conflict?: MergeConflict
  annotation?: string
}

export interface MergeStatistics {
  totalSections: number
  unchangedSections: number
  autoResolvedSections: number
  conflictSections: number
  oursOnlySections: number
  theirsOnlySections: number
  totalConflicts: number
  resolvedConflicts: number
  unresolvedConflicts: number
  linesFromBase: number
  linesFromOurs: number
  linesFromTheirs: number
  totalOutputLines: number
}

export interface MergeResult {
  success: boolean
  content: string
  lines: string[]
  sections: MergeSection[]
  conflicts: MergeConflict[]
  statistics: MergeStatistics
  hasUnresolvedConflicts: boolean
}

export interface MergePreviewSection {
  kind: MergeSectionKind
  lines: string[]
  sourceLabel: string
  lineRange: LineRange
  annotation: string
}

export interface MergePreview {
  sections: MergePreviewSection[]
  summary: string
  statistics: MergeStatistics
}

export interface ConflictMarkerOptions {
  oursLabel: string
  theirsLabel: string
  baseLabel?: string
  includeBase: boolean
}

export interface ParsedConflictRegion {
  oursContent: string[]
  baseContent: string[]
  theirsContent: string[]
  oursLabel: string
  theirsLabel: string
  startLine: number
  endLine: number
}

export interface MergeInput {
  base: string
  ours: string
  theirs: string
  oursLabel?: string
  theirsLabel?: string
  baseLabel?: string
}

export interface MergeOptions {
  strategy: ConflictResolutionStrategy
  includeBaseInMarkers: boolean
  semanticAware: boolean
  wordLevelDiff: boolean
  whitespaceNormalization: boolean
}

/* ── Constants ─────────────────────────────────────────── */

const CONFLICT_MARKER_OURS = '<<<<<<<'
const CONFLICT_MARKER_BASE = '|||||||'
const CONFLICT_MARKER_SEPARATOR = '======='
const CONFLICT_MARKER_THEIRS = '>>>>>>>'

const DEFAULT_OPTIONS: MergeOptions = {
  strategy: 'auto',
  includeBaseInMarkers: false,
  semanticAware: true,
  wordLevelDiff: true,
  whitespaceNormalization: false,
}

const DEFAULT_MARKER_OPTIONS: ConflictMarkerOptions = {
  oursLabel: 'HEAD',
  theirsLabel: 'incoming',
  baseLabel: 'base',
  includeBase: false,
}

/* ── LCS / Line-Level Diff ─────────────────────────────── */

/**
 * Compute the Longest Common Subsequence table for two arrays of lines.
 * Returns the DP table for backtracking.
 */
function computeLCSTable(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  )

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  return dp
}

/**
 * Backtrack through the LCS table to extract the actual subsequence indices.
 * Returns pairs of [indexInA, indexInB].
 */
function backtrackLCS(
  dp: number[][],
  a: string[],
  b: string[]
): Array<[number, number]> {
  const result: Array<[number, number]> = []
  let i = a.length
  let j = b.length

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.push([i - 1, j - 1])
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  result.reverse()
  return result
}

/**
 * Compute a list of Change objects between a base text and a modified text
 * using the LCS algorithm to identify matching and differing regions.
 */
export function computeLineChanges(base: string[], modified: string[]): Change[] {
  const dp = computeLCSTable(base, modified)
  const lcs = backtrackLCS(dp, base, modified)

  const changes: Change[] = []
  let baseIdx = 0
  let modIdx = 0

  for (const [lcsBase, lcsMod] of lcs) {
    // Lines before this match are changes
    if (baseIdx < lcsBase || modIdx < lcsMod) {
      const baseLines = base.slice(baseIdx, lcsBase)
      const modLines = modified.slice(modIdx, lcsMod)

      if (baseLines.length > 0 && modLines.length > 0) {
        changes.push({
          type: 'modified',
          baseStart: baseIdx,
          baseEnd: lcsBase,
          modifiedStart: modIdx,
          modifiedEnd: lcsMod,
          baseLines,
          modifiedLines: modLines,
        })
      } else if (baseLines.length > 0) {
        changes.push({
          type: 'removed',
          baseStart: baseIdx,
          baseEnd: lcsBase,
          modifiedStart: modIdx,
          modifiedEnd: modIdx,
          baseLines,
          modifiedLines: [],
        })
      } else if (modLines.length > 0) {
        changes.push({
          type: 'added',
          baseStart: baseIdx,
          baseEnd: baseIdx,
          modifiedStart: modIdx,
          modifiedEnd: lcsMod,
          baseLines: [],
          modifiedLines: modLines,
        })
      }
    }

    // The matched line
    changes.push({
      type: 'unchanged',
      baseStart: lcsBase,
      baseEnd: lcsBase + 1,
      modifiedStart: lcsMod,
      modifiedEnd: lcsMod + 1,
      baseLines: [base[lcsBase]],
      modifiedLines: [modified[lcsMod]],
    })

    baseIdx = lcsBase + 1
    modIdx = lcsMod + 1
  }

  // Trailing changes after last LCS match
  if (baseIdx < base.length || modIdx < modified.length) {
    const baseLines = base.slice(baseIdx)
    const modLines = modified.slice(modIdx)

    if (baseLines.length > 0 && modLines.length > 0) {
      changes.push({
        type: 'modified',
        baseStart: baseIdx,
        baseEnd: base.length,
        modifiedStart: modIdx,
        modifiedEnd: modified.length,
        baseLines,
        modifiedLines: modLines,
      })
    } else if (baseLines.length > 0) {
      changes.push({
        type: 'removed',
        baseStart: baseIdx,
        baseEnd: base.length,
        modifiedStart: modIdx,
        modifiedEnd: modIdx,
        baseLines,
        modifiedLines: [],
      })
    } else if (modLines.length > 0) {
      changes.push({
        type: 'added',
        baseStart: baseIdx,
        baseEnd: baseIdx,
        modifiedStart: modIdx,
        modifiedEnd: modified.length,
        baseLines: [],
        modifiedLines: modLines,
      })
    }
  }

  return changes
}

/* ── Word-Level Diff ───────────────────────────────────── */

/**
 * Tokenize a line into words, preserving whitespace tokens for faithful
 * reconstruction of the original text.
 */
function tokenizeWords(line: string): string[] {
  const tokens: string[] = []
  const regex = /(\s+|[^\s]+)/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(line)) !== null) {
    tokens.push(match[0])
  }

  return tokens
}

/**
 * Compute word-level diff between two lines using LCS on word tokens.
 */
export function computeWordDiff(oursLine: string, theirsLine: string): WordDiff[] {
  const oursTokens = tokenizeWords(oursLine)
  const theirsTokens = tokenizeWords(theirsLine)

  const dp = computeLCSTable(oursTokens, theirsTokens)
  const lcs = backtrackLCS(dp, oursTokens, theirsTokens)

  const result: WordDiff[] = []
  let oi = 0
  let ti = 0

  for (const [lcsOurs, lcsTheirs] of lcs) {
    // Removed words from ours
    while (oi < lcsOurs) {
      result.push({ type: 'removed', value: oursTokens[oi] })
      oi++
    }
    // Added words from theirs
    while (ti < lcsTheirs) {
      result.push({ type: 'added', value: theirsTokens[ti] })
      ti++
    }
    // Matching word
    result.push({ type: 'equal', value: oursTokens[oi] })
    oi++
    ti++
  }

  // Remaining tokens
  while (oi < oursTokens.length) {
    result.push({ type: 'removed', value: oursTokens[oi] })
    oi++
  }
  while (ti < theirsTokens.length) {
    result.push({ type: 'added', value: theirsTokens[ti] })
    ti++
  }

  return result
}

/**
 * Compute a full word-level diff result between ours and theirs content blocks,
 * matching lines pairwise.
 */
export function computeWordDiffResult(
  oursLines: string[],
  theirsLines: string[]
): WordDiffResult {
  const oursWords: WordDiff[] = []
  const theirsWords: WordDiff[] = []
  let hasConflict = false

  const maxLen = Math.max(oursLines.length, theirsLines.length)

  for (let i = 0; i < maxLen; i++) {
    const oursLine = i < oursLines.length ? oursLines[i] : ''
    const theirsLine = i < theirsLines.length ? theirsLines[i] : ''

    if (oursLine === theirsLine) {
      oursWords.push({ type: 'equal', value: oursLine })
      theirsWords.push({ type: 'equal', value: theirsLine })
    } else {
      hasConflict = true
      const wordDiffs = computeWordDiff(oursLine, theirsLine)

      for (const wd of wordDiffs) {
        if (wd.type === 'removed') {
          oursWords.push({ type: 'removed', value: wd.value })
        } else if (wd.type === 'added') {
          theirsWords.push({ type: 'added', value: wd.value })
        } else {
          oursWords.push({ type: 'equal', value: wd.value })
          theirsWords.push({ type: 'equal', value: wd.value })
        }
      }
    }

    // Add newline separators between lines (except last)
    if (i < maxLen - 1) {
      oursWords.push({ type: 'equal', value: '\n' })
      theirsWords.push({ type: 'equal', value: '\n' })
    }
  }

  return { oursWords, theirsWords, hasConflict }
}

/* ── Semantic Block Detection ──────────────────────────── */

/**
 * Patterns that indicate the start of a semantic code block
 * (function, class, method, etc.) across common languages.
 */
const BLOCK_START_PATTERNS: RegExp[] = [
  /^\s*(export\s+)?(default\s+)?(async\s+)?function\s+/,
  /^\s*(export\s+)?(default\s+)?class\s+/,
  /^\s*(public|private|protected|static|async|abstract|override)\s+\w+\s*\(/,
  /^\s*(const|let|var)\s+\w+\s*=\s*(async\s+)?\(.*\)\s*=>/,
  /^\s*(const|let|var)\s+\w+\s*=\s*function/,
  /^\s*interface\s+\w+/,
  /^\s*type\s+\w+\s*=/,
  /^\s*enum\s+\w+/,
  /^\s*namespace\s+\w+/,
  /^\s*module\s+\w+/,
  /^\s*def\s+\w+/,           // Python
  /^\s*class\s+\w+.*:/,      // Python
  /^\s*fn\s+\w+/,            // Rust
  /^\s*impl\s+/,             // Rust
  /^\s*struct\s+\w+/,        // Rust / Go / C
  /^\s*func\s+/,             // Go
]

/**
 * Detect whether a given range of lines forms part of a semantic code block
 * that should not be split during merge. Returns the expanded range if the
 * change sits inside a block, or the original range otherwise.
 */
function detectSemanticBlock(
  lines: string[],
  start: number,
  end: number
): { isBlock: boolean; expandedStart: number; expandedEnd: number } {
  // Look backwards from start to find a block opener
  let blockStart = start
  let braceDepth = 0
  let foundBlockStart = false

  for (let i = start; i >= Math.max(0, start - 50); i--) {
    const line = lines[i]
    if (!line) continue

    // Count braces going backwards
    for (let c = line.length - 1; c >= 0; c--) {
      if (line[c] === '}') braceDepth++
      if (line[c] === '{') braceDepth--
    }

    // Check for block start pattern
    for (const pattern of BLOCK_START_PATTERNS) {
      if (pattern.test(line)) {
        if (braceDepth <= 0) {
          blockStart = i
          foundBlockStart = true
          break
        }
      }
    }
    if (foundBlockStart) break
  }

  if (!foundBlockStart) {
    return { isBlock: false, expandedStart: start, expandedEnd: end }
  }

  // Look forwards from end to find the matching closing brace
  let blockEnd = end
  braceDepth = 0
  let passedOpener = false

  for (let i = blockStart; i < Math.min(lines.length, end + 100); i++) {
    const line = lines[i]
    if (!line) continue

    for (const ch of line) {
      if (ch === '{') {
        braceDepth++
        passedOpener = true
      }
      if (ch === '}') braceDepth--
    }

    if (passedOpener && braceDepth === 0) {
      blockEnd = i + 1
      break
    }
  }

  return {
    isBlock: true,
    expandedStart: blockStart,
    expandedEnd: Math.max(end, blockEnd),
  }
}

/**
 * Check if a change touches lines within a semantic block and mark it
 * so the merge engine avoids splitting the block across conflict markers.
 */
function isChangeInSemanticBlock(lines: string[], change: Change): boolean {
  const { isBlock } = detectSemanticBlock(
    lines,
    change.baseStart,
    change.baseEnd
  )
  return isBlock
}

/* ── 3-Way Change Alignment ────────────────────────────── */

interface AlignedRegion {
  kind: 'unchanged' | 'ours-only' | 'theirs-only' | 'both-same' | 'conflict'
  baseRange: LineRange
  oursLines: string[]
  theirsLines: string[]
  baseLines: string[]
}

/**
 * Collapse consecutive unchanged Change entries into contiguous ranges
 * to reduce the number of regions the merge must process.
 */
function collapseUnchanged(changes: Change[]): Change[] {
  if (changes.length === 0) return []

  const collapsed: Change[] = []
  let current = { ...changes[0] }

  for (let i = 1; i < changes.length; i++) {
    const next = changes[i]
    if (current.type === 'unchanged' && next.type === 'unchanged') {
      current = {
        ...current,
        baseEnd: next.baseEnd,
        modifiedEnd: next.modifiedEnd,
        baseLines: [...current.baseLines, ...next.baseLines],
        modifiedLines: [...current.modifiedLines, ...next.modifiedLines],
      }
    } else {
      collapsed.push(current)
      current = { ...next }
    }
  }
  collapsed.push(current)
  return collapsed
}

/**
 * Align changes from base->ours and base->theirs into a single stream
 * of AlignedRegion entries. This is the heart of the 3-way merge:
 * it walks both change lists in parallel using base-line offsets.
 */
function alignChanges(
  baseLines: string[],
  oursChanges: Change[],
  theirsChanges: Change[]
): AlignedRegion[] {
  const oursCollapsed = collapseUnchanged(oursChanges)
  const theirsCollapsed = collapseUnchanged(theirsChanges)

  // Build maps: baseStart -> Change for non-unchanged entries
  const oursMap = new Map<number, Change>()
  const theirsMap = new Map<number, Change>()

  for (const c of oursCollapsed) {
    if (c.type !== 'unchanged') oursMap.set(c.baseStart, c)
  }
  for (const c of theirsCollapsed) {
    if (c.type !== 'unchanged') theirsMap.set(c.baseStart, c)
  }

  // Gather all unique base positions where a change starts
  const changePoints = new Set<number>()
  for (const c of oursCollapsed) changePoints.add(c.baseStart)
  for (const c of theirsCollapsed) changePoints.add(c.baseStart)
  const sortedPoints = Array.from(changePoints).sort((a, b) => a - b)

  const regions: AlignedRegion[] = []
  let basePos = 0

  for (const point of sortedPoints) {
    // Emit unchanged region before this point
    if (point > basePos) {
      regions.push({
        kind: 'unchanged',
        baseRange: { start: basePos, end: point },
        oursLines: baseLines.slice(basePos, point),
        theirsLines: baseLines.slice(basePos, point),
        baseLines: baseLines.slice(basePos, point),
      })
    }

    const oursChange = oursMap.get(point)
    const theirsChange = theirsMap.get(point)

    if (oursChange && theirsChange) {
      // Both sides changed the same base region
      const baseEnd = Math.max(oursChange.baseEnd, theirsChange.baseEnd)
      const bLines = baseLines.slice(point, baseEnd)

      if (arraysEqual(oursChange.modifiedLines, theirsChange.modifiedLines)) {
        // Both made identical changes
        regions.push({
          kind: 'both-same',
          baseRange: { start: point, end: baseEnd },
          oursLines: oursChange.modifiedLines,
          theirsLines: theirsChange.modifiedLines,
          baseLines: bLines,
        })
      } else {
        // Genuine conflict
        regions.push({
          kind: 'conflict',
          baseRange: { start: point, end: baseEnd },
          oursLines: oursChange.modifiedLines,
          theirsLines: theirsChange.modifiedLines,
          baseLines: bLines,
        })
      }

      basePos = baseEnd
    } else if (oursChange) {
      regions.push({
        kind: 'ours-only',
        baseRange: { start: point, end: oursChange.baseEnd },
        oursLines: oursChange.modifiedLines,
        theirsLines: baseLines.slice(point, oursChange.baseEnd),
        baseLines: baseLines.slice(point, oursChange.baseEnd),
      })
      basePos = oursChange.baseEnd
    } else if (theirsChange) {
      regions.push({
        kind: 'theirs-only',
        baseRange: { start: point, end: theirsChange.baseEnd },
        oursLines: baseLines.slice(point, theirsChange.baseEnd),
        theirsLines: theirsChange.modifiedLines,
        baseLines: baseLines.slice(point, theirsChange.baseEnd),
      })
      basePos = theirsChange.baseEnd
    } else {
      // Point is from an unchanged change -- advance if needed
      const oursUnch = oursCollapsed.find(
        (c) => c.type === 'unchanged' && c.baseStart === point
      )
      const theirsUnch = theirsCollapsed.find(
        (c) => c.type === 'unchanged' && c.baseStart === point
      )
      const endPoint = Math.max(
        oursUnch?.baseEnd ?? point,
        theirsUnch?.baseEnd ?? point
      )
      if (endPoint > basePos) {
        regions.push({
          kind: 'unchanged',
          baseRange: { start: basePos, end: endPoint },
          oursLines: baseLines.slice(basePos, endPoint),
          theirsLines: baseLines.slice(basePos, endPoint),
          baseLines: baseLines.slice(basePos, endPoint),
        })
        basePos = endPoint
      }
    }

    // Ensure we advance past the current point at minimum
    if (basePos <= point) {
      basePos = point + 1
    }
  }

  // Trailing unchanged lines
  if (basePos < baseLines.length) {
    regions.push({
      kind: 'unchanged',
      baseRange: { start: basePos, end: baseLines.length },
      oursLines: baseLines.slice(basePos),
      theirsLines: baseLines.slice(basePos),
      baseLines: baseLines.slice(basePos),
    })
  }

  return regions
}

/* ── Conflict Resolution ───────────────────────────────── */

/**
 * Check whether two base-range regions overlap or are immediately adjacent,
 * which would escalate both into a single conflict.
 */
function rangesOverlapOrAdjacent(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && b.start <= a.end
}

/**
 * Merge overlapping/adjacent conflict regions into a single larger conflict.
 */
function mergeAdjacentConflicts(conflicts: MergeConflict[]): MergeConflict[] {
  if (conflicts.length <= 1) return conflicts

  const sorted = [...conflicts].sort((a, b) => a.baseRange.start - b.baseRange.start)
  const merged: MergeConflict[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1]
    const curr = sorted[i]

    if (rangesOverlapOrAdjacent(prev.baseRange, curr.baseRange)) {
      // Merge into previous
      prev.baseRange.end = Math.max(prev.baseRange.end, curr.baseRange.end)
      prev.oursRange.end = Math.max(prev.oursRange.end, curr.oursRange.end)
      prev.theirsRange.end = Math.max(prev.theirsRange.end, curr.theirsRange.end)
      prev.baseContent = [...prev.baseContent, ...curr.baseContent]
      prev.oursContent = [...prev.oursContent, ...curr.oursContent]
      prev.theirsContent = [...prev.theirsContent, ...curr.theirsContent]
    } else {
      merged.push(curr)
    }
  }

  return merged
}

/**
 * Resolve a single conflict using the specified strategy.
 * Returns the resolved lines or null if the conflict cannot be auto-resolved.
 */
function resolveConflict(
  conflict: MergeConflict,
  strategy: ConflictResolutionStrategy
): string[] | null {
  switch (strategy) {
    case 'ours':
      return conflict.oursContent

    case 'theirs':
      return conflict.theirsContent

    case 'union':
      return resolveUnion(conflict)

    case 'smart-merge':
      return resolveSmartMerge(conflict)

    case 'auto':
      return resolveAuto(conflict)

    default:
      return null
  }
}

/**
 * Union resolution: include both sides, ours first then theirs,
 * deduplicating identical lines.
 */
function resolveUnion(conflict: MergeConflict): string[] {
  const result: string[] = [...conflict.oursContent]
  const oursSet = new Set(conflict.oursContent)

  for (const line of conflict.theirsContent) {
    if (!oursSet.has(line)) {
      result.push(line)
    }
  }

  return result
}

/**
 * Auto resolution: attempt to resolve non-conflicting changes automatically.
 * Only succeeds when one side is unchanged from base (the other side's
 * change can be accepted cleanly).
 */
function resolveAuto(conflict: MergeConflict): string[] | null {
  const oursMatchesBase = arraysEqual(conflict.oursContent, conflict.baseContent)
  const theirsMatchesBase = arraysEqual(conflict.theirsContent, conflict.baseContent)

  if (oursMatchesBase && theirsMatchesBase) {
    // Neither side changed -- use base
    return conflict.baseContent
  }
  if (oursMatchesBase) {
    // Only theirs changed -- accept theirs
    return conflict.theirsContent
  }
  if (theirsMatchesBase) {
    // Only ours changed -- accept ours
    return conflict.oursContent
  }

  // Both sides changed differently -- cannot auto-resolve
  return null
}

/**
 * Smart merge: try increasingly aggressive strategies.
 * 1. If one side matches base, accept the other.
 * 2. If changes are on different lines within the region, interleave.
 * 3. If one side only adds lines, merge additions with the other.
 * 4. Otherwise, fall back to null (unresolved).
 */
function resolveSmartMerge(conflict: MergeConflict): string[] | null {
  // Step 1: check if one side is unchanged
  const autoResult = resolveAuto(conflict)
  if (autoResult !== null) return autoResult

  // Step 2: non-overlapping line-level edits
  const interleavedResult = tryInterleaveChanges(conflict)
  if (interleavedResult !== null) return interleavedResult

  // Step 3: additive merge -- if one side only added lines
  const additiveResult = tryAdditiveMerge(conflict)
  if (additiveResult !== null) return additiveResult

  return null
}

/**
 * Attempt to interleave changes when ours and theirs modify different
 * lines within the same base region. If edits don't overlap at the
 * individual line level, we can combine them.
 */
function tryInterleaveChanges(conflict: MergeConflict): string[] | null {
  const base = conflict.baseContent
  const ours = conflict.oursContent
  const theirs = conflict.theirsContent

  if (base.length === 0) return null

  // Compute per-line changes from base to each side
  const oursChanges = computeLineChanges(base, ours)
  const theirsChanges = computeLineChanges(base, theirs)

  // Identify which base lines were modified by each side
  const oursModifiedBaseLines = new Set<number>()
  const theirsModifiedBaseLines = new Set<number>()

  for (const c of oursChanges) {
    if (c.type !== 'unchanged') {
      for (let i = c.baseStart; i < c.baseEnd; i++) {
        oursModifiedBaseLines.add(i)
      }
    }
  }
  for (const c of theirsChanges) {
    if (c.type !== 'unchanged') {
      for (let i = c.baseStart; i < c.baseEnd; i++) {
        theirsModifiedBaseLines.add(i)
      }
    }
  }

  // Check for overlap
  for (const line of oursModifiedBaseLines) {
    if (theirsModifiedBaseLines.has(line)) {
      return null // Overlapping edits -- cannot interleave
    }
  }

  // Build result by applying ours changes, then theirs changes to untouched lines
  const result: string[] = []
  const oursChangeMap = new Map<number, Change>()
  const theirsChangeMap = new Map<number, Change>()

  for (const c of oursChanges) {
    if (c.type !== 'unchanged') oursChangeMap.set(c.baseStart, c)
  }
  for (const c of theirsChanges) {
    if (c.type !== 'unchanged') theirsChangeMap.set(c.baseStart, c)
  }

  let i = 0
  while (i < base.length) {
    if (oursChangeMap.has(i)) {
      const c = oursChangeMap.get(i)!
      result.push(...c.modifiedLines)
      i = c.baseEnd
    } else if (theirsChangeMap.has(i)) {
      const c = theirsChangeMap.get(i)!
      result.push(...c.modifiedLines)
      i = c.baseEnd
    } else {
      result.push(base[i])
      i++
    }
  }

  return result
}

/**
 * Attempt additive merge: if one side's content is a superset of base
 * (only added lines), merge the additions into the other side.
 */
function tryAdditiveMerge(conflict: MergeConflict): string[] | null {
  const base = conflict.baseContent
  const ours = conflict.oursContent
  const theirs = conflict.theirsContent

  const oursOnlyAdds = isStrictSuperset(base, ours)
  const theirsOnlyAdds = isStrictSuperset(base, theirs)

  if (oursOnlyAdds && theirsOnlyAdds) {
    // Both sides only added lines -- union them
    return resolveUnion(conflict)
  }

  return null
}

/**
 * Check if `superset` contains all lines of `subset` in order,
 * with only additional lines interspersed.
 */
function isStrictSuperset(subset: string[], superset: string[]): boolean {
  let si = 0
  for (let i = 0; i < superset.length && si < subset.length; i++) {
    if (superset[i] === subset[si]) si++
  }
  return si === subset.length && superset.length > subset.length
}

/* ── Conflict Markers ──────────────────────────────────── */

/**
 * Generate standard Git conflict markers for a single conflict.
 */
export function generateConflictMarkers(
  conflict: MergeConflict,
  options: ConflictMarkerOptions = DEFAULT_MARKER_OPTIONS
): string[] {
  const lines: string[] = []

  lines.push(`${CONFLICT_MARKER_OURS} ${options.oursLabel}`)
  lines.push(...conflict.oursContent)

  if (options.includeBase && conflict.baseContent.length > 0) {
    lines.push(`${CONFLICT_MARKER_BASE} ${options.baseLabel ?? 'base'}`)
    lines.push(...conflict.baseContent)
  }

  lines.push(CONFLICT_MARKER_SEPARATOR)
  lines.push(...conflict.theirsContent)
  lines.push(`${CONFLICT_MARKER_THEIRS} ${options.theirsLabel}`)

  return lines
}

/**
 * Parse a text containing Git conflict markers into structured conflict regions.
 */
export function parseConflictMarkers(text: string): ParsedConflictRegion[] {
  const lines = text.split('\n')
  const regions: ParsedConflictRegion[] = []

  let i = 0
  while (i < lines.length) {
    if (lines[i].startsWith(CONFLICT_MARKER_OURS)) {
      const oursLabel = lines[i].slice(CONFLICT_MARKER_OURS.length).trim()
      const startLine = i
      i++

      const oursContent: string[] = []
      const baseContent: string[] = []
      const theirsContent: string[] = []

      let phase: 'ours' | 'base' | 'theirs' = 'ours'

      while (i < lines.length) {
        if (lines[i].startsWith(CONFLICT_MARKER_BASE)) {
          phase = 'base'
          i++
          continue
        }
        if (lines[i].startsWith(CONFLICT_MARKER_SEPARATOR)) {
          phase = 'theirs'
          i++
          continue
        }
        if (lines[i].startsWith(CONFLICT_MARKER_THEIRS)) {
          const theirsLabel = lines[i].slice(CONFLICT_MARKER_THEIRS.length).trim()
          regions.push({
            oursContent,
            baseContent,
            theirsContent,
            oursLabel,
            theirsLabel,
            startLine,
            endLine: i,
          })
          i++
          break
        }

        switch (phase) {
          case 'ours':
            oursContent.push(lines[i])
            break
          case 'base':
            baseContent.push(lines[i])
            break
          case 'theirs':
            theirsContent.push(lines[i])
            break
        }
        i++
      }
    } else {
      i++
    }
  }

  return regions
}

/**
 * Remove all conflict markers from text, keeping the specified side.
 */
export function stripConflictMarkers(
  text: string,
  keepSide: 'ours' | 'theirs' | 'base' = 'ours'
): string {
  const regions = parseConflictMarkers(text)
  if (regions.length === 0) return text

  const lines = text.split('\n')
  const resultLines: string[] = []
  let lineIdx = 0

  for (const region of regions) {
    // Add lines before this conflict region
    while (lineIdx < region.startLine) {
      resultLines.push(lines[lineIdx])
      lineIdx++
    }

    // Add the chosen side
    switch (keepSide) {
      case 'ours':
        resultLines.push(...region.oursContent)
        break
      case 'theirs':
        resultLines.push(...region.theirsContent)
        break
      case 'base':
        resultLines.push(...region.baseContent)
        break
    }

    lineIdx = region.endLine + 1
  }

  // Add remaining lines after last conflict
  while (lineIdx < lines.length) {
    resultLines.push(lines[lineIdx])
    lineIdx++
  }

  return resultLines.join('\n')
}

/* ── Core Merge Engine ─────────────────────────────────── */

let conflictIdCounter = 0

function generateConflictId(): string {
  return `conflict-${++conflictIdCounter}`
}

/**
 * Reset the conflict ID counter (useful for testing).
 */
export function resetConflictIdCounter(): void {
  conflictIdCounter = 0
}

/**
 * Perform a 3-way merge of base, ours, and theirs content.
 * This is the main entry point for the merge engine.
 */
export function merge3Way(
  input: MergeInput,
  options: Partial<MergeOptions> = {}
): MergeResult {
  const opts: MergeOptions = { ...DEFAULT_OPTIONS, ...options }

  const baseLines = input.base.split('\n')
  const oursLines = input.ours.split('\n')
  const theirsLines = input.theirs.split('\n')

  // Optionally normalize whitespace
  const normBase = opts.whitespaceNormalization ? normalizeWhitespace(baseLines) : baseLines
  const normOurs = opts.whitespaceNormalization ? normalizeWhitespace(oursLines) : oursLines
  const normTheirs = opts.whitespaceNormalization ? normalizeWhitespace(theirsLines) : theirsLines

  // Compute line changes from base to each side
  const oursChanges = computeLineChanges(normBase, normOurs)
  const theirsChanges = computeLineChanges(normBase, normTheirs)

  // Align changes into a unified region stream
  const aligned = alignChanges(normBase, oursChanges, theirsChanges)

  // Build merge sections and detect conflicts
  const sections: MergeSection[] = []
  const conflicts: MergeConflict[] = []

  const markerOptions: ConflictMarkerOptions = {
    oursLabel: input.oursLabel ?? 'HEAD',
    theirsLabel: input.theirsLabel ?? 'incoming',
    baseLabel: input.baseLabel ?? 'base',
    includeBase: opts.includeBaseInMarkers,
  }

  for (const region of aligned) {
    switch (region.kind) {
      case 'unchanged': {
        sections.push({
          kind: 'unchanged',
          lines: region.baseLines,
          annotation: 'Unchanged from all three versions',
        })
        break
      }

      case 'both-same': {
        sections.push({
          kind: 'auto-resolved',
          lines: region.oursLines,
          annotation: 'Both sides made identical changes',
        })
        break
      }

      case 'ours-only': {
        sections.push({
          kind: 'ours-only',
          lines: region.oursLines,
          annotation: 'Changed only in ours',
        })
        break
      }

      case 'theirs-only': {
        sections.push({
          kind: 'theirs-only',
          lines: region.theirsLines,
          annotation: 'Changed only in theirs',
        })
        break
      }

      case 'conflict': {
        const isSemanticBlock = opts.semanticAware
          ? isChangeInSemanticBlock(normBase, {
              type: 'modified',
              baseStart: region.baseRange.start,
              baseEnd: region.baseRange.end,
              modifiedStart: 0,
              modifiedEnd: 0,
              baseLines: region.baseLines,
              modifiedLines: [],
            })
          : false

        const conflict: MergeConflict = {
          id: generateConflictId(),
          baseRange: region.baseRange,
          oursRange: { start: 0, end: region.oursLines.length },
          theirsRange: { start: 0, end: region.theirsLines.length },
          baseContent: region.baseLines,
          oursContent: region.oursLines,
          theirsContent: region.theirsLines,
          isSemanticBlock,
        }

        // Compute word-level diff if enabled
        if (opts.wordLevelDiff) {
          conflict.wordDiff = computeWordDiffResult(
            region.oursLines,
            region.theirsLines
          )
        }

        // Try to resolve based on strategy
        const resolved = resolveConflict(conflict, opts.strategy)

        if (resolved !== null) {
          conflict.resolution = opts.strategy
          conflict.resolvedContent = resolved
          sections.push({
            kind: 'auto-resolved',
            lines: resolved,
            conflict,
            annotation: `Auto-resolved using '${opts.strategy}' strategy`,
          })
        } else {
          // Unresolved conflict -- emit conflict markers
          const markerLines = generateConflictMarkers(conflict, markerOptions)
          sections.push({
            kind: 'conflict',
            lines: markerLines,
            conflict,
            annotation: isSemanticBlock
              ? 'Conflict within a semantic code block'
              : 'Conflicting changes from both sides',
          })
        }

        conflicts.push(conflict)
        break
      }
    }
  }

  // Merge adjacent conflicts
  const mergedConflicts = mergeAdjacentConflicts(conflicts)

  // Assemble final content
  const outputLines: string[] = []
  for (const section of sections) {
    outputLines.push(...section.lines)
  }

  const hasUnresolved = mergedConflicts.some((c) => !c.resolvedContent)

  const statistics = computeStatistics(sections, mergedConflicts, outputLines)

  return {
    success: !hasUnresolved,
    content: outputLines.join('\n'),
    lines: outputLines,
    sections,
    conflicts: mergedConflicts,
    statistics,
    hasUnresolvedConflicts: hasUnresolved,
  }
}

/* ── Statistics ────────────────────────────────────────── */

function computeStatistics(
  sections: MergeSection[],
  conflicts: MergeConflict[],
  outputLines: string[]
): MergeStatistics {
  let unchangedSections = 0
  let autoResolvedSections = 0
  let conflictSections = 0
  let oursOnlySections = 0
  let theirsOnlySections = 0
  let linesFromBase = 0
  let linesFromOurs = 0
  let linesFromTheirs = 0

  for (const section of sections) {
    switch (section.kind) {
      case 'unchanged':
        unchangedSections++
        linesFromBase += section.lines.length
        break
      case 'auto-resolved':
        autoResolvedSections++
        break
      case 'conflict':
        conflictSections++
        break
      case 'ours-only':
        oursOnlySections++
        linesFromOurs += section.lines.length
        break
      case 'theirs-only':
        theirsOnlySections++
        linesFromTheirs += section.lines.length
        break
    }
  }

  const resolvedConflicts = conflicts.filter((c) => c.resolvedContent).length
  const unresolvedConflicts = conflicts.length - resolvedConflicts

  return {
    totalSections: sections.length,
    unchangedSections,
    autoResolvedSections,
    conflictSections,
    oursOnlySections,
    theirsOnlySections,
    totalConflicts: conflicts.length,
    resolvedConflicts,
    unresolvedConflicts,
    linesFromBase,
    linesFromOurs,
    linesFromTheirs,
    totalOutputLines: outputLines.length,
  }
}

/* ── Merge Preview ─────────────────────────────────────── */

/**
 * Generate a detailed merge preview with annotations for each section,
 * suitable for display in a merge preview UI.
 */
export function generateMergePreview(
  input: MergeInput,
  options: Partial<MergeOptions> = {}
): MergePreview {
  const result = merge3Way(input, options)
  const previewSections: MergePreviewSection[] = []

  let currentLine = 0

  for (const section of result.sections) {
    const lineCount = section.lines.length
    const lineRange: LineRange = {
      start: currentLine,
      end: currentLine + lineCount,
    }

    let sourceLabel: string
    switch (section.kind) {
      case 'unchanged':
        sourceLabel = 'base (unchanged)'
        break
      case 'auto-resolved':
        sourceLabel = section.conflict?.resolution
          ? `auto-resolved (${section.conflict.resolution})`
          : 'auto-resolved (identical changes)'
        break
      case 'conflict':
        sourceLabel = 'CONFLICT'
        break
      case 'ours-only':
        sourceLabel = input.oursLabel ?? 'ours'
        break
      case 'theirs-only':
        sourceLabel = input.theirsLabel ?? 'theirs'
        break
      default:
        sourceLabel = 'unknown'
    }

    previewSections.push({
      kind: section.kind,
      lines: section.lines,
      sourceLabel,
      lineRange,
      annotation: section.annotation ?? '',
    })

    currentLine += lineCount
  }

  const summary = buildPreviewSummary(result.statistics)

  return {
    sections: previewSections,
    summary,
    statistics: result.statistics,
  }
}

function buildPreviewSummary(stats: MergeStatistics): string {
  const parts: string[] = []

  if (stats.unchangedSections > 0) {
    parts.push(`${stats.unchangedSections} unchanged`)
  }
  if (stats.autoResolvedSections > 0) {
    parts.push(`${stats.autoResolvedSections} auto-resolved`)
  }
  if (stats.oursOnlySections > 0) {
    parts.push(`${stats.oursOnlySections} ours-only`)
  }
  if (stats.theirsOnlySections > 0) {
    parts.push(`${stats.theirsOnlySections} theirs-only`)
  }
  if (stats.unresolvedConflicts > 0) {
    parts.push(`${stats.unresolvedConflicts} unresolved conflicts`)
  }

  return `Merge: ${parts.join(', ')} | ${stats.totalOutputLines} output lines`
}

/* ── Batch and Utility Operations ──────────────────────── */

/**
 * Resolve all remaining conflicts in a merge result with a given strategy.
 */
export function resolveAllConflicts(
  result: MergeResult,
  strategy: ConflictResolutionStrategy
): MergeResult {
  const updatedSections: MergeSection[] = []
  const updatedConflicts: MergeConflict[] = []

  for (const section of result.sections) {
    if (section.kind === 'conflict' && section.conflict) {
      const resolved = resolveConflict(section.conflict, strategy)
      const conflict = { ...section.conflict }

      if (resolved !== null) {
        conflict.resolution = strategy
        conflict.resolvedContent = resolved
        updatedSections.push({
          kind: 'auto-resolved',
          lines: resolved,
          conflict,
          annotation: `Resolved using '${strategy}' strategy`,
        })
      } else {
        updatedSections.push(section)
      }

      updatedConflicts.push(conflict)
    } else {
      updatedSections.push(section)
      if (section.conflict) updatedConflicts.push(section.conflict)
    }
  }

  const outputLines: string[] = []
  for (const section of updatedSections) {
    outputLines.push(...section.lines)
  }

  const hasUnresolved = updatedConflicts.some((c) => !c.resolvedContent)
  const statistics = computeStatistics(
    updatedSections,
    updatedConflicts,
    outputLines
  )

  return {
    success: !hasUnresolved,
    content: outputLines.join('\n'),
    lines: outputLines,
    sections: updatedSections,
    conflicts: updatedConflicts,
    statistics,
    hasUnresolvedConflicts: hasUnresolved,
  }
}

/**
 * Resolve a single conflict by its ID with the given content.
 */
export function resolveConflictById(
  result: MergeResult,
  conflictId: string,
  resolvedContent: string[]
): MergeResult {
  const updatedSections: MergeSection[] = []
  const updatedConflicts: MergeConflict[] = []

  for (const section of result.sections) {
    if (section.conflict?.id === conflictId && section.kind === 'conflict') {
      const conflict = { ...section.conflict }
      conflict.resolution = 'ours' // manual
      conflict.resolvedContent = resolvedContent
      updatedSections.push({
        kind: 'auto-resolved',
        lines: resolvedContent,
        conflict,
        annotation: 'Manually resolved',
      })
      updatedConflicts.push(conflict)
    } else {
      updatedSections.push(section)
      if (section.conflict) updatedConflicts.push(section.conflict)
    }
  }

  const outputLines: string[] = []
  for (const section of updatedSections) {
    outputLines.push(...section.lines)
  }

  const hasUnresolved = updatedConflicts.some((c) => !c.resolvedContent)
  const statistics = computeStatistics(
    updatedSections,
    updatedConflicts,
    outputLines
  )

  return {
    success: !hasUnresolved,
    content: outputLines.join('\n'),
    lines: outputLines,
    sections: updatedSections,
    conflicts: updatedConflicts,
    statistics,
    hasUnresolvedConflicts: hasUnresolved,
  }
}

/**
 * Check if a text contains Git conflict markers.
 */
export function hasConflictMarkers(text: string): boolean {
  return (
    text.includes(CONFLICT_MARKER_OURS) &&
    text.includes(CONFLICT_MARKER_SEPARATOR) &&
    text.includes(CONFLICT_MARKER_THEIRS)
  )
}

/**
 * Count the number of conflict regions in a text.
 */
export function countConflictMarkers(text: string): number {
  return parseConflictMarkers(text).length
}

/* ── Whitespace Normalization ──────────────────────────── */

function normalizeWhitespace(lines: string[]): string[] {
  return lines.map((line) => line.replace(/\s+$/, ''))
}

/* ── Array Helpers ─────────────────────────────────────── */

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/* ── MergeEngine Class ─────────────────────────────────── */

/**
 * Stateful merge engine that can manage multiple merge sessions
 * and track conflict resolution progress.
 */
export class MergeEngine {
  private options: MergeOptions
  private currentResult: MergeResult | null = null
  private history: MergeResult[] = []

  constructor(options: Partial<MergeOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Start a new merge session.
   */
  merge(input: MergeInput): MergeResult {
    resetConflictIdCounter()
    this.currentResult = merge3Way(input, this.options)
    this.history = [this.currentResult]
    return this.currentResult
  }

  /**
   * Get the current merge result.
   */
  getResult(): MergeResult | null {
    return this.currentResult
  }

  /**
   * Resolve a specific conflict by ID.
   */
  resolveConflict(conflictId: string, content: string[]): MergeResult {
    if (!this.currentResult) {
      throw new Error('No active merge session')
    }

    this.currentResult = resolveConflictById(
      this.currentResult,
      conflictId,
      content
    )
    this.history.push(this.currentResult)
    return this.currentResult
  }

  /**
   * Resolve a conflict by ID using a named strategy.
   */
  resolveConflictWithStrategy(
    conflictId: string,
    strategy: ConflictResolutionStrategy
  ): MergeResult {
    if (!this.currentResult) {
      throw new Error('No active merge session')
    }

    const conflict = this.currentResult.conflicts.find(
      (c) => c.id === conflictId
    )
    if (!conflict) {
      throw new Error(`Conflict not found: ${conflictId}`)
    }

    const resolved = resolveConflict(conflict, strategy)
    if (resolved === null) {
      throw new Error(
        `Strategy '${strategy}' could not resolve conflict ${conflictId}`
      )
    }

    return this.resolveConflict(conflictId, resolved)
  }

  /**
   * Resolve all remaining conflicts with the given strategy.
   */
  resolveAll(strategy: ConflictResolutionStrategy): MergeResult {
    if (!this.currentResult) {
      throw new Error('No active merge session')
    }

    this.currentResult = resolveAllConflicts(this.currentResult, strategy)
    this.history.push(this.currentResult)
    return this.currentResult
  }

  /**
   * Undo the last resolution step.
   */
  undo(): MergeResult | null {
    if (this.history.length <= 1) return null

    this.history.pop()
    this.currentResult = this.history[this.history.length - 1]
    return this.currentResult
  }

  /**
   * Get the number of remaining unresolved conflicts.
   */
  getUnresolvedCount(): number {
    if (!this.currentResult) return 0
    return this.currentResult.conflicts.filter((c) => !c.resolvedContent).length
  }

  /**
   * Get all unresolved conflicts.
   */
  getUnresolvedConflicts(): MergeConflict[] {
    if (!this.currentResult) return []
    return this.currentResult.conflicts.filter((c) => !c.resolvedContent)
  }

  /**
   * Check if the merge is fully resolved.
   */
  isResolved(): boolean {
    return this.currentResult !== null && !this.currentResult.hasUnresolvedConflicts
  }

  /**
   * Get the final merged content. Throws if there are unresolved conflicts.
   */
  getFinalContent(): string {
    if (!this.currentResult) {
      throw new Error('No active merge session')
    }
    if (this.currentResult.hasUnresolvedConflicts) {
      throw new Error(
        `Cannot get final content: ${this.getUnresolvedCount()} unresolved conflicts remain`
      )
    }
    return this.currentResult.content
  }

  /**
   * Get the merged content even if conflicts remain (with markers).
   */
  getContentWithMarkers(): string {
    if (!this.currentResult) {
      throw new Error('No active merge session')
    }
    return this.currentResult.content
  }

  /**
   * Generate a merge preview.
   */
  getPreview(input: MergeInput): MergePreview {
    return generateMergePreview(input, this.options)
  }

  /**
   * Get merge statistics.
   */
  getStatistics(): MergeStatistics | null {
    return this.currentResult?.statistics ?? null
  }

  /**
   * Update merge options for future operations.
   */
  setOptions(options: Partial<MergeOptions>): void {
    this.options = { ...this.options, ...options }
  }

  /**
   * Get current merge options.
   */
  getOptions(): MergeOptions {
    return { ...this.options }
  }

  /**
   * Get the history of merge results (for undo support).
   */
  getHistory(): MergeResult[] {
    return [...this.history]
  }

  /**
   * Reset the engine, clearing all state.
   */
  reset(): void {
    this.currentResult = null
    this.history = []
    resetConflictIdCounter()
  }
}

/* ── Convenience Exports ───────────────────────────────── */

/**
 * Quick merge with default options. Returns the merged content string.
 */
export function quickMerge(base: string, ours: string, theirs: string): string {
  const result = merge3Way({ base, ours, theirs })
  return result.content
}

/**
 * Quick merge that throws on unresolved conflicts.
 */
export function strictMerge(base: string, ours: string, theirs: string): string {
  const result = merge3Way({ base, ours, theirs })
  if (result.hasUnresolvedConflicts) {
    throw new Error(
      `Merge has ${result.statistics.unresolvedConflicts} unresolved conflicts`
    )
  }
  return result.content
}

/**
 * Merge using a specific strategy for all conflicts.
 */
export function mergeWithStrategy(
  base: string,
  ours: string,
  theirs: string,
  strategy: ConflictResolutionStrategy
): MergeResult {
  return merge3Way({ base, ours, theirs }, { strategy })
}
