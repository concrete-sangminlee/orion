/**
 * Parser for `git status --porcelain=v1 -z` output.
 *
 * Why `-z`:
 *  - Entries are NUL-terminated, so paths containing spaces, quotes, or
 *    non-ASCII characters arrive verbatim instead of C-quoted.
 *  - Renames/copies carry the original path in a separate NUL field instead
 *    of an ambiguous `old -> new` string.
 *
 * Callers MUST pass the raw stdout. Trimming it strips the leading space of
 * the first entry (e.g. ` M src/a.ts`), which shifts the XY columns: the file
 * is then misreported as staged and its path loses its first character.
 */

import type { GitFileState, GitStatusFile } from '../../shared/ipc-contract'

export interface ParsedGitStatus {
  files: GitStatusFile[]
  staged: GitStatusFile[]
  unstaged: GitStatusFile[]
}

export function parseGitPorcelainStatusZ(raw: string): ParsedGitStatus {
  const files: GitStatusFile[] = []
  const staged: GitStatusFile[] = []
  const unstaged: GitStatusFile[] = []

  const fields = raw.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]
    // Minimum entry is "XY p". Anything shorter is the trailing empty field
    // after the final NUL (or garbage) and is skipped.
    if (entry.length < 4 || entry[2] !== ' ') continue

    const x = entry[0] // index (staging area) status
    const y = entry[1] // working tree status
    const path = entry.slice(3)

    // Renames and copies are followed by a field holding the source path.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++

    let state: GitFileState = 'modified'
    if (x === '?' && y === '?') state = 'untracked'
    else if (x === 'A' || y === 'A') state = 'added'
    else if (x === 'D' || y === 'D') state = 'deleted'
    else if (x === 'R' || y === 'R') state = 'renamed'
    files.push({ path, state })

    if (x !== ' ' && x !== '?') {
      let stagedState: GitFileState = 'modified'
      if (x === 'A') stagedState = 'added'
      else if (x === 'D') stagedState = 'deleted'
      else if (x === 'R') stagedState = 'renamed'
      staged.push({ path, state: stagedState })
    }

    if (y !== ' ') {
      let unstagedState: GitFileState = 'modified'
      if (x === '?' && y === '?') unstagedState = 'untracked'
      else if (y === 'D') unstagedState = 'deleted'
      unstaged.push({ path, state: unstagedState })
    }
  }

  return { files, staged, unstaged }
}
