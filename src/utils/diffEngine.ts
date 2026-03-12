/**
 * Diff engine for computing and displaying text differences.
 * Supports line-by-line and character-level diffs with context.
 */

/* ── Types ─────────────────────────────────────────────── */

export type DiffType = 'add' | 'remove' | 'modify' | 'equal'

export interface DiffLine {
  type: DiffType
  content: string
  oldLineNumber?: number
  newLineNumber?: number
  charDiffs?: CharDiff[]
}

export interface CharDiff {
  type: 'add' | 'remove' | 'equal'
  value: string
}

export interface DiffHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
  header: string
}

export interface DiffResult {
  hunks: DiffHunk[]
  stats: DiffStats
  oldFile?: string
  newFile?: string
}

export interface DiffStats {
  additions: number
  deletions: number
  modifications: number
  unchanged: number
  totalOld: number
  totalNew: number
}

/* ── Myers Diff Algorithm ─────────────────────────────── */

export function computeDiff(oldText: string, newText: string, contextLines = 3): DiffResult {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  const changes = myersDiff(oldLines, newLines)
  const diffLines = buildDiffLines(changes, oldLines, newLines)
  const hunks = buildHunks(diffLines, contextLines)
  const stats = computeStats(diffLines)

  return { hunks, stats }
}

interface Edit {
  type: 'insert' | 'delete' | 'equal'
  oldIndex: number
  newIndex: number
}

function myersDiff(a: string[], b: string[]): Edit[] {
  const N = a.length
  const M = b.length
  const MAX = N + M
  const V: Map<number, number> = new Map()
  V.set(1, 0)

  const trace: Map<number, number>[] = []

  for (let d = 0; d <= MAX; d++) {
    const newV = new Map(V)

    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && (V.get(k - 1) || 0) < (V.get(k + 1) || 0))) {
        x = V.get(k + 1) || 0
      } else {
        x = (V.get(k - 1) || 0) + 1
      }

      let y = x - k

      while (x < N && y < M && a[x] === b[y]) {
        x++
        y++
      }

      newV.set(k, x)

      if (x >= N && y >= M) {
        trace.push(new Map(V))
        return backtrack(trace, a, b)
      }
    }

    trace.push(new Map(V))
    V.clear()
    for (const [key, val] of newV) V.set(key, val)
  }

  // Fallback: all deletes then all inserts
  const edits: Edit[] = []
  for (let i = 0; i < N; i++) edits.push({ type: 'delete', oldIndex: i, newIndex: -1 })
  for (let j = 0; j < M; j++) edits.push({ type: 'insert', oldIndex: -1, newIndex: j })
  return edits
}

function backtrack(trace: Map<number, number>[], a: string[], b: string[]): Edit[] {
  const edits: Edit[] = []
  let x = a.length
  let y = b.length

  for (let d = trace.length - 1; d >= 0; d--) {
    const V = trace[d]
    const k = x - y

    let prevK: number
    if (k === -d || (k !== d && (V.get(k - 1) || 0) < (V.get(k + 1) || 0))) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }

    const prevX = V.get(prevK) || 0
    const prevY = prevX - prevK

    // Diagonal (equal)
    while (x > prevX && y > prevY) {
      x--
      y--
      edits.unshift({ type: 'equal', oldIndex: x, newIndex: y })
    }

    if (d > 0) {
      if (x === prevX) {
        // Insert
        y--
        edits.unshift({ type: 'insert', oldIndex: -1, newIndex: y })
      } else {
        // Delete
        x--
        edits.unshift({ type: 'delete', oldIndex: x, newIndex: -1 })
      }
    }
  }

  return edits
}

function buildDiffLines(edits: Edit[], oldLines: string[], newLines: string[]): DiffLine[] {
  const result: DiffLine[] = []

  let i = 0
  while (i < edits.length) {
    const edit = edits[i]

    if (edit.type === 'equal') {
      result.push({
        type: 'equal',
        content: oldLines[edit.oldIndex],
        oldLineNumber: edit.oldIndex + 1,
        newLineNumber: edit.newIndex + 1,
      })
      i++
    } else if (edit.type === 'delete') {
      // Check if next edit is insert (modification)
      if (i + 1 < edits.length && edits[i + 1].type === 'insert') {
        const oldContent = oldLines[edit.oldIndex]
        const newContent = newLines[edits[i + 1].newIndex]
        const charDiffs = computeCharDiff(oldContent, newContent)

        result.push({
          type: 'remove',
          content: oldContent,
          oldLineNumber: edit.oldIndex + 1,
          charDiffs: charDiffs.filter(d => d.type !== 'add'),
        })
        result.push({
          type: 'add',
          content: newContent,
          newLineNumber: edits[i + 1].newIndex + 1,
          charDiffs: charDiffs.filter(d => d.type !== 'remove'),
        })
        i += 2
      } else {
        result.push({
          type: 'remove',
          content: oldLines[edit.oldIndex],
          oldLineNumber: edit.oldIndex + 1,
        })
        i++
      }
    } else {
      result.push({
        type: 'add',
        content: newLines[edit.newIndex],
        newLineNumber: edit.newIndex + 1,
      })
      i++
    }
  }

  return result
}

/* ── Character-level Diff ─────────────────────────────── */

export function computeCharDiff(oldStr: string, newStr: string): CharDiff[] {
  const result: CharDiff[] = []
  const oldChars = oldStr.split('')
  const newChars = newStr.split('')

  // Simple LCS-based char diff
  const dp: number[][] = Array(oldChars.length + 1).fill(null).map(() => Array(newChars.length + 1).fill(0))

  for (let i = 1; i <= oldChars.length; i++) {
    for (let j = 1; j <= newChars.length; j++) {
      if (oldChars[i - 1] === newChars[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack
  let i = oldChars.length
  let j = newChars.length
  const ops: CharDiff[] = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldChars[i - 1] === newChars[j - 1]) {
      ops.unshift({ type: 'equal', value: oldChars[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: 'add', value: newChars[j - 1] })
      j--
    } else {
      ops.unshift({ type: 'remove', value: oldChars[i - 1] })
      i--
    }
  }

  // Merge consecutive operations of the same type
  for (const op of ops) {
    if (result.length > 0 && result[result.length - 1].type === op.type) {
      result[result.length - 1].value += op.value
    } else {
      result.push({ ...op })
    }
  }

  return result
}

/* ── Hunk Builder ─────────────────────────────────────── */

function buildHunks(diffLines: DiffLine[], contextLines: number): DiffHunk[] {
  const hunks: DiffHunk[] = []
  const changeIndices: number[] = []

  for (let i = 0; i < diffLines.length; i++) {
    if (diffLines[i].type !== 'equal') {
      changeIndices.push(i)
    }
  }

  if (changeIndices.length === 0) return hunks

  let hunkStart = Math.max(0, changeIndices[0] - contextLines)
  let hunkEnd = Math.min(diffLines.length - 1, changeIndices[0] + contextLines)

  for (let ci = 1; ci < changeIndices.length; ci++) {
    const prevEnd = hunkEnd
    const nextStart = Math.max(0, changeIndices[ci] - contextLines)
    const nextEnd = Math.min(diffLines.length - 1, changeIndices[ci] + contextLines)

    if (nextStart <= prevEnd + 1) {
      // Merge with current hunk
      hunkEnd = nextEnd
    } else {
      // Emit current hunk and start new one
      hunks.push(createHunk(diffLines, hunkStart, hunkEnd))
      hunkStart = nextStart
      hunkEnd = nextEnd
    }
  }

  hunks.push(createHunk(diffLines, hunkStart, hunkEnd))
  return hunks
}

function createHunk(lines: DiffLine[], start: number, end: number): DiffHunk {
  const hunkLines = lines.slice(start, end + 1)

  let oldStart = Infinity
  let newStart = Infinity
  let oldCount = 0
  let newCount = 0

  for (const line of hunkLines) {
    if (line.oldLineNumber !== undefined) {
      oldStart = Math.min(oldStart, line.oldLineNumber)
      oldCount++
    }
    if (line.newLineNumber !== undefined) {
      newStart = Math.min(newStart, line.newLineNumber)
      newCount++
    }
  }

  if (oldStart === Infinity) oldStart = 1
  if (newStart === Infinity) newStart = 1

  return {
    oldStart,
    oldCount,
    newStart,
    newCount,
    lines: hunkLines,
    header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
  }
}

/* ── Stats ────────────────────────────────────────────── */

function computeStats(diffLines: DiffLine[]): DiffStats {
  let additions = 0
  let deletions = 0
  let unchanged = 0

  for (const line of diffLines) {
    if (line.type === 'add') additions++
    else if (line.type === 'remove') deletions++
    else unchanged++
  }

  return {
    additions,
    deletions,
    modifications: Math.min(additions, deletions),
    unchanged,
    totalOld: deletions + unchanged,
    totalNew: additions + unchanged,
  }
}

/* ── Unified Diff Format ──────────────────────────────── */

export function toUnifiedDiff(result: DiffResult, oldFile = 'a/file', newFile = 'b/file'): string {
  const lines: string[] = [
    `--- ${oldFile}`,
    `+++ ${newFile}`,
  ]

  for (const hunk of result.hunks) {
    lines.push(hunk.header)
    for (const line of hunk.lines) {
      switch (line.type) {
        case 'add':
          lines.push(`+${line.content}`)
          break
        case 'remove':
          lines.push(`-${line.content}`)
          break
        default:
          lines.push(` ${line.content}`)
      }
    }
  }

  return lines.join('\n')
}

/* ── Parse Unified Diff ───────────────────────────────── */

export function parseUnifiedDiff(patch: string): DiffResult {
  const lines = patch.split('\n')
  const hunks: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0
  let stats: DiffStats = { additions: 0, deletions: 0, modifications: 0, unchanged: 0, totalOld: 0, totalNew: 0 }

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/)
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk)
      oldLine = parseInt(hunkMatch[1])
      newLine = parseInt(hunkMatch[3])
      currentHunk = {
        oldStart: oldLine,
        oldCount: parseInt(hunkMatch[2] || '1'),
        newStart: newLine,
        newCount: parseInt(hunkMatch[4] || '1'),
        lines: [],
        header: line,
      }
      continue
    }

    if (!currentHunk) continue

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentHunk.lines.push({
        type: 'add',
        content: line.slice(1),
        newLineNumber: newLine++,
      })
      stats.additions++
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      currentHunk.lines.push({
        type: 'remove',
        content: line.slice(1),
        oldLineNumber: oldLine++,
      })
      stats.deletions++
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'equal',
        content: line.slice(1),
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
      })
      stats.unchanged++
    }
  }

  if (currentHunk) hunks.push(currentHunk)

  stats.modifications = Math.min(stats.additions, stats.deletions)
  stats.totalOld = stats.deletions + stats.unchanged
  stats.totalNew = stats.additions + stats.unchanged

  return { hunks, stats }
}

/* ── Three-Way Merge ──────────────────────────────────── */

export interface MergeResult {
  merged: string
  conflicts: MergeConflict[]
  hasConflicts: boolean
}

export interface MergeConflict {
  startLine: number
  endLine: number
  ours: string[]
  theirs: string[]
  base: string[]
}

export function threeWayMerge(base: string, ours: string, theirs: string): MergeResult {
  const baseLines = base.split('\n')
  const ourLines = ours.split('\n')
  const theirLines = theirs.split('\n')

  const ourDiff = myersDiff(baseLines, ourLines)
  const theirDiff = myersDiff(baseLines, theirLines)

  // Simple merge strategy: apply non-conflicting changes
  const result: string[] = []
  const conflicts: MergeConflict[] = []

  let bi = 0, oi = 0, ti = 0

  while (bi < baseLines.length || oi < ourLines.length || ti < theirLines.length) {
    const baseLine = bi < baseLines.length ? baseLines[bi] : undefined
    const ourLine = oi < ourLines.length ? ourLines[oi] : undefined
    const theirLine = ti < theirLines.length ? theirLines[ti] : undefined

    if (baseLine === ourLine && baseLine === theirLine) {
      // All three agree
      if (baseLine !== undefined) result.push(baseLine)
      bi++; oi++; ti++
    } else if (baseLine === ourLine && theirLine !== undefined) {
      // Only theirs changed
      result.push(theirLine)
      bi++; oi++; ti++
    } else if (baseLine === theirLine && ourLine !== undefined) {
      // Only ours changed
      result.push(ourLine)
      bi++; oi++; ti++
    } else if (ourLine === theirLine && ourLine !== undefined) {
      // Both changed to same thing
      result.push(ourLine)
      bi++; oi++; ti++
    } else {
      // Conflict
      const conflict: MergeConflict = {
        startLine: result.length,
        endLine: result.length,
        ours: ourLine !== undefined ? [ourLine] : [],
        theirs: theirLine !== undefined ? [theirLine] : [],
        base: baseLine !== undefined ? [baseLine] : [],
      }

      result.push(`<<<<<<< ours`)
      if (ourLine !== undefined) result.push(ourLine)
      result.push(`=======`)
      if (theirLine !== undefined) result.push(theirLine)
      result.push(`>>>>>>> theirs`)

      conflict.endLine = result.length
      conflicts.push(conflict)

      bi++; oi++; ti++
    }
  }

  return {
    merged: result.join('\n'),
    conflicts,
    hasConflicts: conflicts.length > 0,
  }
}
