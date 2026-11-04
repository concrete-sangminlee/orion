import { describe, expect, it } from 'vitest'
import { parseGitPorcelainStatusZ } from './git-status-parse'

const z = (...entries: string[]) => entries.join('\0') + '\0'

describe('parseGitPorcelainStatusZ', () => {
  it('keeps the leading-space XY column of the first entry intact', () => {
    // Regression: stdout used to be trimmed, turning " M src/a.ts" into
    // "M src/a.ts" — reported as staged with path "rc/a.ts".
    const result = parseGitPorcelainStatusZ(z(' M src/a.ts', 'M  src/b.ts'))
    expect(result.unstaged).toEqual([{ path: 'src/a.ts', state: 'modified' }])
    expect(result.staged).toEqual([{ path: 'src/b.ts', state: 'modified' }])
    expect(result.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('classifies untracked, added, deleted entries', () => {
    const result = parseGitPorcelainStatusZ(z('?? new.txt', 'A  added.ts', ' D gone.ts', 'D  staged-gone.ts'))
    expect(result.files).toEqual([
      { path: 'new.txt', state: 'untracked' },
      { path: 'added.ts', state: 'added' },
      { path: 'gone.ts', state: 'deleted' },
      { path: 'staged-gone.ts', state: 'deleted' },
    ])
    expect(result.staged).toEqual([
      { path: 'added.ts', state: 'added' },
      { path: 'staged-gone.ts', state: 'deleted' },
    ])
    expect(result.unstaged).toEqual([
      { path: 'new.txt', state: 'untracked' },
      { path: 'gone.ts', state: 'deleted' },
    ])
  })

  it('reports a file modified in both index and worktree on both sides', () => {
    const result = parseGitPorcelainStatusZ(z('MM both.ts'))
    expect(result.staged).toEqual([{ path: 'both.ts', state: 'modified' }])
    expect(result.unstaged).toEqual([{ path: 'both.ts', state: 'modified' }])
  })

  it('consumes the original-path field of renames so it is not parsed as an entry', () => {
    const result = parseGitPorcelainStatusZ(z('R  new-name.ts', 'old-name.ts', ' M after.ts'))
    expect(result.files).toEqual([
      { path: 'new-name.ts', state: 'renamed' },
      { path: 'after.ts', state: 'modified' },
    ])
    expect(result.staged).toEqual([{ path: 'new-name.ts', state: 'renamed' }])
  })

  it('preserves paths with spaces, quotes, and non-ASCII characters verbatim', () => {
    const result = parseGitPorcelainStatusZ(z(' M dir with space/"quoted".ts', '?? 한글 파일.md'))
    expect(result.files.map((f) => f.path)).toEqual(['dir with space/"quoted".ts', '한글 파일.md'])
  })

  it('returns empty lists for a clean tree', () => {
    expect(parseGitPorcelainStatusZ('')).toEqual({ files: [], staged: [], unstaged: [] })
  })
})
