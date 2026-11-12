import { describe, expect, it } from 'vitest'
import {
  buildSearchPattern,
  createPathFilter,
  listedLineText,
  replaceListedLines,
  searchOpenBuffers,
  splitPatterns,
  type SearchFlags,
} from './searchReplace'

const literal: SearchFlags = { caseSensitive: false, regex: false, wholeWord: false }
const regex: SearchFlags = { caseSensitive: false, regex: true, wholeWord: false }

/** The listed entry for a line of `content`, as the results list holds it. */
function listed(content: string, line: number) {
  return { line, text: listedLineText(content.split(/\r?\n/)[line - 1]) }
}

describe('buildSearchPattern', () => {
  it('escapes a literal query and honours case', () => {
    expect(buildSearchPattern('a.b', literal).test('aXb')).toBe(false)
    expect(buildSearchPattern('a.b', literal).test('A.B')).toBe(true)
    expect(buildSearchPattern('a.b', { ...literal, caseSensitive: true }).test('A.B')).toBe(false)
  })

  it('applies whole word to a whole alternation', () => {
    const pattern = buildSearchPattern('foo|bar', { ...regex, wholeWord: true })
    expect(pattern.test('foobar')).toBe(false)
    expect(pattern.test('a bar b')).toBe(true)
  })
})

describe('replaceListedLines', () => {
  it('replaces only the listed lines, leaving dismissed or unlisted matches alone', () => {
    const content = 'foo 1\nfoo 2\nfoo 3\n'
    const out = replaceListedLines(content, [listed(content, 1), listed(content, 3)], 'foo', literal, 'bar')
    expect(out).toEqual({ ok: true, content: 'bar 1\nfoo 2\nbar 3\n', count: 2 })
  })

  it('keeps $ patterns literal outside regex mode', () => {
    const content = 'price: x'
    const out = replaceListedLines(content, [listed(content, 1)], 'x', literal, "$& $1 $$ $` $'")
    expect(out).toMatchObject({ ok: true, content: "price: $& $1 $$ $` $'" })
  })

  it('expands groups in regex mode', () => {
    const content = 'let a = 1'
    const out = replaceListedLines(content, [listed(content, 1)], '(\\w+) = (\\d)', regex, '$2 = $1')
    expect(out).toMatchObject({ ok: true, content: 'let 1 = a' })
  })

  it('matches within a line, like the search, so a pattern never eats line breaks', () => {
    const content = 'a;\nb;\nc'
    const out = replaceListedLines(content, [listed(content, 1)], ';\\s*', regex, ',')
    expect(out).toMatchObject({ ok: true, content: 'a,\nb;\nc' })
  })

  it('anchors ^ and $ to each line and keeps CRLF endings', () => {
    const content = 'end\r\nend\r\n'
    const out = replaceListedLines(content, [listed(content, 1), listed(content, 2)], '^end$', regex, 'END')
    expect(out).toEqual({ ok: true, content: 'END\r\nEND\r\n', count: 2 })
  })

  it('refuses when a listed line no longer holds what the search listed', () => {
    const searched = 'keep\nfoo here\n'
    const entry = listed(searched, 2)
    expect(replaceListedLines('inserted\nkeep\nfoo here\n', [entry], 'foo', literal, 'bar')).toEqual({
      ok: false,
      reason: 'line 2 changed since the search',
    })
    expect(replaceListedLines('keep\n', [entry], 'foo', literal, 'bar').ok).toBe(false)
  })

  it('refuses a line that still matches but holds other text than was listed', () => {
    // A matching line was inserted above: line 1 is now one the user never saw.
    const entry = listed('foo listed\n', 1)
    expect(replaceListedLines('foo inserted\nfoo listed\n', [entry], 'foo', literal, 'bar')).toEqual({
      ok: false,
      reason: 'line 1 changed since the search',
    })
  })

  it('refuses a line whose listed text still matches but which no longer matches the pattern', () => {
    // Listed text is trimmed, so a change in leading whitespace alone is caught by the pattern.
    const out = replaceListedLines('foo', [{ line: 1, text: 'foo' }], '^\\s+foo', regex, 'bar')
    expect(out.ok).toBe(false)
  })
})

describe('createPathFilter', () => {
  const filter = (include: string[], exclude: string[] = [], extensions: string[] = []) =>
    createPathFilter({ include, exclude, extensions })

  it('matches a pattern without a slash against any one path segment', () => {
    expect(filter(['*.css'])('src/styles/app.css')).toBe(true)
    expect(filter(['*.css'])('src/app.ts')).toBe(false)
    expect(filter([], ['node_modules'])('pkg/node_modules/x.js')).toBe(false)
    // Not a substring match: "dist" must not exclude distance.ts.
    expect(filter([], ['dist'])('src/distance.ts')).toBe(true)
  })

  it('matches a pattern with a slash from the workspace root', () => {
    expect(filter(['src/**'])('src/a/b.ts')).toBe(true)
    expect(filter(['src/**'])('lib/src/b.ts')).toBe(false)
    expect(filter(['./lib'])('lib/x.ts')).toBe(true)
    expect(filter(['**/*.test.ts'])('a.test.ts')).toBe(true)
    expect(filter(['**/*.test.ts'])('src/deep/a.test.ts')).toBe(true)
    expect(filter(['src/*.ts'])('src/deep/a.ts')).toBe(false)
  })

  it('combines include, exclude and extensions', () => {
    const f = filter(['src/**'], ['*.test.ts'], ['.ts'])
    expect(f('src/a.ts')).toBe(true)
    expect(f('src/a.test.ts')).toBe(false)
    expect(f('src/a.css')).toBe(false)
    expect(f('lib/a.ts')).toBe(false)
  })

  it('treats pattern text as literal, including names of object properties', () => {
    expect(filter(['constructor'])('constructor/x')).toBe(true)
    expect(filter(['a+b'])('a+b/x')).toBe(true)
    expect(filter(['a+b'])('aab/x')).toBe(false)
  })

  it('splits the comma-separated input', () => {
    expect(splitPatterns(' *.ts, src/** ,,')).toEqual(['*.ts', 'src/**'])
  })
})

describe('searchOpenBuffers', () => {
  it('lists matching lines of the open buffers that pass the filters', () => {
    const files = [
      { path: '/w/src/a.ts', content: '  foo()\nbar\r\nfoo\r\n' },
      { path: '/w/src/a.css', content: 'foo {}' },
    ]
    expect(searchOpenBuffers(files, '/w', 'foo', literal, { include: ['*.ts'], exclude: [], extensions: [] })).toEqual([
      { file: '/w/src/a.ts', line: 1, content: 'foo()' },
      { file: '/w/src/a.ts', line: 3, content: 'foo' },
    ])
  })
})
