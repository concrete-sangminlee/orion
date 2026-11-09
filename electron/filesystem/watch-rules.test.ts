import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isIgnoredWatchPath, OwnWriteTracker } from './watch-rules'

const root = path.resolve('/work/project')
const at = (...segments: string[]) => path.join(root, ...segments)

describe('isIgnoredWatchPath', () => {
  it('ignores build output, dependencies and VCS internals by whole segment', () => {
    expect(isIgnoredWatchPath(root, at('node_modules', 'react', 'index.js'))).toBe(true)
    expect(isIgnoredWatchPath(root, at('.git', 'HEAD'))).toBe(true)
    expect(isIgnoredWatchPath(root, at('dist', 'index.html'))).toBe(true)
    expect(isIgnoredWatchPath(root, at('packages', 'app', 'dist-electron', 'main.js'))).toBe(true)
  })

  it('watches files whose names merely contain an ignored word', () => {
    // The old regex /(node_modules|\.git|dist|...)/ matched these substrings.
    expect(isIgnoredWatchPath(root, at('src', 'distance.ts'))).toBe(false)
    expect(isIgnoredWatchPath(root, at('redistribute', 'a.ts'))).toBe(false)
    expect(isIgnoredWatchPath(root, at('.github', 'workflows', 'ci.yml'))).toBe(false)
    expect(isIgnoredWatchPath(root, at('.gitignore'))).toBe(false)
  })

  it('does not look at segments above the workspace root', () => {
    const nested = path.resolve('/home/me/dist/project')
    expect(isIgnoredWatchPath(nested, path.join(nested, 'src', 'a.ts'))).toBe(false)
  })

  it('never ignores the root itself or paths outside it', () => {
    expect(isIgnoredWatchPath(root, root)).toBe(false)
    expect(isIgnoredWatchPath(root, path.resolve('/elsewhere/node_modules/x'))).toBe(false)
  })
})

describe('OwnWriteTracker', () => {
  it('recognises the content the app wrote, regardless of path spelling', () => {
    const tracker = new OwnWriteTracker()
    tracker.record(at('a.ts'), 'const a = 1\n')
    expect(tracker.isOwnWrite(at('src', '..', 'a.ts'), 'const a = 1\n')).toBe(true)
    expect(tracker.isOwnWrite(at('a.ts'), Buffer.from('const a = 1\n'))).toBe(true)
  })

  it('reports any other content as an external change, however soon it lands', () => {
    const tracker = new OwnWriteTracker()
    tracker.record(at('a.ts'), 'const a = 1\n')
    expect(tracker.isOwnWrite(at('a.ts'), 'const a = 1 // formatted on save\n')).toBe(false)
    expect(tracker.isOwnWrite(at('b.ts'), 'const a = 1\n')).toBe(false)
  })

  it('tracks only the latest write per file', () => {
    const tracker = new OwnWriteTracker()
    tracker.record(at('a.ts'), 'v1')
    tracker.record(at('a.ts'), 'v2')
    expect(tracker.isOwnWrite(at('a.ts'), 'v1')).toBe(false)
    expect(tracker.isOwnWrite(at('a.ts'), 'v2')).toBe(true)
    tracker.forget(at('a.ts'))
    expect(tracker.isOwnWrite(at('a.ts'), 'v2')).toBe(false)
  })
})
