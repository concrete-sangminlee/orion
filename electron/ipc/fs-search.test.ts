import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({ shell: {}, clipboard: {} }))
vi.mock('./typed-ipc', () => ({
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
  listen: () => {},
}))
vi.mock('../filesystem/watcher', () => ({ startWatching: () => {}, stopWatching: () => {}, recordKnownContent: () => {} }))

const { registerFilesystemHandlers } = await import('./filesystem')
const { setProjectPath } = await import('../workspace/project-path')

type SearchResult = { matches: { file: string; line: number; content: string }[]; truncated: boolean }

let root: string

function search(query: unknown, options?: unknown): Promise<SearchResult> {
  return handlers.get('fs:search')!({}, root, query, options) as Promise<SearchResult>
}

const rel = (result: SearchResult) => result.matches.map((m) => `${path.relative(root, m.file).split(path.sep).join('/')}:${m.line}`)

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-search-'))
  // Sorted first and with more matching lines than the limit, so a filter
  // applied after the limit would never see the other files.
  await fs.mkdir(path.join(root, 'a-many'))
  await fs.writeFile(path.join(root, 'a-many', 'big.ts'), Array.from({ length: 250 }, () => 'needle').join('\n'))
  await fs.mkdir(path.join(root, 'src', 'gen'), { recursive: true })
  await fs.writeFile(path.join(root, 'src', 'style.css'), 'body { color: needle }\n')
  await fs.writeFile(path.join(root, 'src', 'gen', 'out.ts'), 'needle\n')
  await fs.writeFile(path.join(root, 'src', 'words.txt'), 'needles\nneedle here\r\nneedle\r\n')
  await fs.mkdir(path.join(root, 'exact'))
  await fs.writeFile(path.join(root, 'exact', 'limit.md'), Array.from({ length: 200 }, () => 'haystack').join('\n'))
  setProjectPath(root)
  registerFilesystemHandlers(() => null)
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('fs:search', () => {
  it('stops at the limit and says so', async () => {
    const result = await search('needle')
    expect(result.matches).toHaveLength(200)
    expect(result.truncated).toBe(true)
  })

  it('does not claim more matches when there are exactly as many as the limit', async () => {
    const result = await search('haystack')
    expect(result.matches).toHaveLength(200)
    expect(result.truncated).toBe(false)
  })

  it('applies include patterns and type filters before the limit', async () => {
    expect(rel(await search('needle', { include: ['*.css'] }))).toEqual(['src/style.css:1'])
    expect(rel(await search('needle', { extensions: ['.css'] }))).toEqual(['src/style.css:1'])
    const underSrc = await search('needle', { include: ['src/**'], extensions: ['.ts'] })
    expect(rel(underSrc)).toEqual(['src/gen/out.ts:1'])
    expect(underSrc.truncated).toBe(false)
  })

  it('applies exclude patterns to folders and files', async () => {
    expect(rel(await search('needle', { exclude: ['a-many', 'src/gen', '*.txt'] }))).toEqual(['src/style.css:1'])
  })

  it('honours whole word and anchors ^/$ per line, CRLF included', async () => {
    expect(rel(await search('needle', { include: ['*.txt'], wholeWord: true }))).toEqual(['src/words.txt:2', 'src/words.txt:3'])
    expect(rel(await search('^needle$', { include: ['*.txt'], regex: true }))).toEqual(['src/words.txt:3'])
    // Whole word applies to the whole alternation, as in src/utils/searchReplace.ts: \bneed|xyz\b would match "needle".
    expect(rel(await search('need|xyz', { include: ['*.txt'], regex: true, wholeWord: true }))).toEqual([])
  })

  it('lists each line trimmed', async () => {
    const [match] = (await search('color', {})).matches
    expect(match.content).toBe('body { color: needle }')
  })

  it('rejects malformed options instead of searching with them', async () => {
    await expect(search('needle', { include: 'src/**' })).rejects.toThrow('Invalid search option include')
    await expect(search('needle', { wholeWord: 'yes' })).rejects.toThrow('Invalid search option wholeWord')
    await expect(search('needle', 'oops')).rejects.toThrow('Invalid search options')
    expect(await search({ not: 'a string' })).toEqual({ matches: [], truncated: false })
  })
})
