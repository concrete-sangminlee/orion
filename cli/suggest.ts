/**
 * "Did you mean …?" for mistyped CLI commands.
 */

/** Optimal string alignment distance (Levenshtein plus adjacent swaps). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[a.length][b.length]
}

/**
 * Up to `limit` known commands close to `input`: small edit distance, or
 * `input` being a prefix of the command (`orion rev` → `review`).
 */
export function suggestCommands(input: string, commands: readonly string[], limit = 2): string[] {
  const typed = input.toLowerCase()
  if (!typed) return []
  const maxDistance = typed.length <= 3 ? 1 : 2
  const scored = [...new Set(commands)]
    .filter((name) => name && name !== '*' && name !== typed)
    .map((name) => ({ name, distance: editDistance(typed, name.toLowerCase()) }))
    .filter(({ name, distance }) => distance <= maxDistance || (typed.length >= 2 && name.toLowerCase().startsWith(typed)))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
  return scored.slice(0, limit).map(({ name }) => name)
}
