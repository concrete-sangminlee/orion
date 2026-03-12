/* ── Fuzzy Match ─────────────────────────────────────── */

/**
 * Result of a fuzzy match attempt.
 * `score` is 0 when there is no match; higher is better.
 * `indices` lists the positions in `target` that were matched.
 */
export interface FuzzyMatchResult {
  score: number
  indices: number[]
}

/** Internal bonus / penalty constants (exported for tests) */
export const SCORE = {
  /** Exact case match on a character */
  CASE_MATCH: 1,
  /** Case-insensitive match */
  CASE_MISMATCH: 0.8,
  /** Bonus when matched char follows immediately after previous match */
  CONSECUTIVE: 5,
  /** Bonus when matched char is at the start of a camelCase word */
  CAMEL_BOUNDARY: 4,
  /** Bonus when matched char follows a separator (/ . - _) */
  SEPARATOR_BOUNDARY: 6,
  /** Bonus when matched char is the first character of the string */
  START_OF_STRING: 8,
  /** Penalty per gap character between two consecutive matches */
  GAP_PENALTY: -0.5,
  /** Extra penalty for the very first gap (before the first match) */
  LEADING_GAP_PENALTY: -0.2,
} as const

const SEPARATORS = new Set(['/', '\\', '.', '-', '_', ' '])

/**
 * Returns true when `ch` is uppercase and `prev` is lowercase,
 * indicating a camelCase word boundary.
 */
function isCamelBoundary(target: string, index: number): boolean {
  if (index === 0) return true
  const ch = target[index]
  const prev = target[index - 1]
  // Uppercase after lowercase  e.g. "getUser" → 'U'
  if (ch >= 'A' && ch <= 'Z' && prev >= 'a' && prev <= 'z') return true
  // First letter after separator
  if (SEPARATORS.has(prev)) return true
  return false
}

/**
 * Core fuzzy-match algorithm.
 *
 * Matches every character of `pattern` (in order) against `target`.
 * Supports:
 *  - camelCase matching ("gUC" → "getUserConfig")
 *  - path matching ("src/comp" → "src/components/Button.tsx")
 *  - consecutive-character bonus and gap penalty
 *
 * Returns `{ score: 0, indices: [] }` when there is no match.
 */
export function fuzzyMatch(pattern: string, target: string): FuzzyMatchResult {
  if (pattern.length === 0) return { score: 0, indices: [] }
  if (target.length === 0) return { score: 0, indices: [] }
  if (pattern.length > target.length) return { score: 0, indices: [] }

  const pLower = pattern.toLowerCase()
  const tLower = target.toLowerCase()

  // Quick reject: every pattern char must exist somewhere in target
  {
    let ti = 0
    for (let pi = 0; pi < pLower.length; pi++) {
      const found = tLower.indexOf(pLower[pi], ti)
      if (found === -1) return { score: 0, indices: [] }
      ti = found + 1
    }
  }

  // DP-style best-path search using two strategies:
  //   1. greedy camelCase-boundary preference
  //   2. simple left-to-right scan
  // We run both and keep the higher-scoring result.

  const bestResult = greedyMatch(pattern, target, pLower, tLower)
  const camelResult = camelPreferMatch(pattern, target, pLower, tLower)

  if (camelResult.score > bestResult.score) return camelResult
  return bestResult
}

/** Simple greedy left-to-right scan. */
function greedyMatch(
  pattern: string,
  target: string,
  pLower: string,
  tLower: string,
): FuzzyMatchResult {
  const indices: number[] = []
  let pi = 0
  let lastMatchIndex = -1
  let score = 0

  for (let ti = 0; ti < target.length && pi < pLower.length; ti++) {
    if (tLower[ti] === pLower[pi]) {
      // Base score
      score += pattern[pi] === target[ti] ? SCORE.CASE_MATCH : SCORE.CASE_MISMATCH

      if (indices.length === 0) {
        // Leading gap
        score += ti * SCORE.LEADING_GAP_PENALTY
        if (ti === 0) score += SCORE.START_OF_STRING
      } else {
        const gap = ti - lastMatchIndex - 1
        if (gap === 0) {
          score += SCORE.CONSECUTIVE
        } else {
          score += gap * SCORE.GAP_PENALTY
        }
      }

      if (isCamelBoundary(target, ti)) score += SCORE.CAMEL_BOUNDARY
      if (ti > 0 && SEPARATORS.has(target[ti - 1])) score += SCORE.SEPARATOR_BOUNDARY

      indices.push(ti)
      lastMatchIndex = ti
      pi++
    }
  }

  if (pi < pLower.length) return { score: 0, indices: [] }

  // Normalise: longer targets get a small penalty so shorter matches win ties
  score -= target.length * 0.05

  return { score: Math.max(score, 0.001), indices }
}

/** Prefer matching at camelCase boundaries when possible. */
function camelPreferMatch(
  pattern: string,
  target: string,
  pLower: string,
  tLower: string,
): FuzzyMatchResult {
  const indices: number[] = []
  let pi = 0
  let searchFrom = 0
  let lastMatchIndex = -1
  let score = 0

  for (let pi2 = 0; pi2 < pLower.length; pi2++) {
    const ch = pLower[pi2]

    // First, try to find a camelCase boundary match
    let bestIdx = -1
    for (let ti = searchFrom; ti < target.length; ti++) {
      if (tLower[ti] !== ch) continue
      if (isCamelBoundary(target, ti)) {
        bestIdx = ti
        break
      }
      if (bestIdx === -1) bestIdx = ti // fallback to first occurrence
    }

    if (bestIdx === -1) return { score: 0, indices: [] }

    const ti = bestIdx
    score += pattern[pi2] === target[ti] ? SCORE.CASE_MATCH : SCORE.CASE_MISMATCH

    if (indices.length === 0) {
      score += ti * SCORE.LEADING_GAP_PENALTY
      if (ti === 0) score += SCORE.START_OF_STRING
    } else {
      const gap = ti - lastMatchIndex - 1
      if (gap === 0) {
        score += SCORE.CONSECUTIVE
      } else {
        score += gap * SCORE.GAP_PENALTY
      }
    }

    if (isCamelBoundary(target, ti)) score += SCORE.CAMEL_BOUNDARY
    if (ti > 0 && SEPARATORS.has(target[ti - 1])) score += SCORE.SEPARATOR_BOUNDARY

    indices.push(ti)
    lastMatchIndex = ti
    searchFrom = ti + 1
    pi++
  }

  if (pi < pLower.length) return { score: 0, indices: [] }

  score -= target.length * 0.05

  return { score: Math.max(score, 0.001), indices }
}

/**
 * Convenience: returns true/false for quick filtering.
 */
export function fuzzyTest(pattern: string, target: string): boolean {
  if (pattern.length === 0) return true
  const pLower = pattern.toLowerCase()
  const tLower = target.toLowerCase()
  let ti = 0
  for (let pi = 0; pi < pLower.length; pi++) {
    const found = tLower.indexOf(pLower[pi], ti)
    if (found === -1) return false
    ti = found + 1
  }
  return true
}

/**
 * Batch-filter and sort an array of strings by fuzzy match quality.
 * Returns items that match, sorted best-first, with their scores and indices.
 */
export function fuzzyFilter<T>(
  pattern: string,
  items: T[],
  getText: (item: T) => string,
): Array<{ item: T; result: FuzzyMatchResult }> {
  if (pattern.length === 0) return items.map(item => ({ item, result: { score: 0, indices: [] } }))

  const scored: Array<{ item: T; result: FuzzyMatchResult }> = []

  for (const item of items) {
    const result = fuzzyMatch(pattern, getText(item))
    if (result.score > 0) {
      scored.push({ item, result })
    }
  }

  scored.sort((a, b) => b.result.score - a.result.score)
  return scored
}
