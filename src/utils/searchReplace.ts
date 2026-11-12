import type { FileSearchMatch } from '@shared/ipc-contract'

/**
 * The rules Find/Replace in Files lists and replaces matches by, so that a
 * replace changes exactly what the results list shows.
 *
 * fs:search (electron/ipc/filesystem.ts) builds the same line pattern, splits
 * lines and lists them the same way and applies the same path filters. The
 * main process cannot import renderer modules, so keep the two in step.
 */

export interface SearchFlags {
  caseSensitive: boolean
  regex: boolean
  wholeWord: boolean
}

export interface SearchPathFilters {
  include: readonly string[]
  exclude: readonly string[]
  /** File name endings such as `.ts` (the type chips). */
  extensions: readonly string[]
}

/** The pattern each line is tested with; `global` finds every occurrence on it. */
export function buildSearchPattern(query: string, flags: SearchFlags, global = false): RegExp {
  let source = flags.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Grouped so that \b applies to a whole alternation like `a|b`.
  if (flags.wholeWord) source = `\\b(?:${source})\\b`
  return new RegExp(source, `${global ? 'g' : ''}${flags.caseSensitive ? '' : 'i'}`)
}

/** Lines are numbered by `\n`; the `\r` of a CRLF ending is not part of the line. */
const LINE_BREAK = /\r?\n/

/** How a matching line is listed: trimmed and cut to 200 characters. */
export function listedLineText(line: string): string {
  return line.trim().substring(0, 200)
}

/** Replace every match. Outside regex mode the replacement is literal, so `$&` or `$1` stay as typed. */
export function replaceMatches(text: string, pattern: RegExp, replacement: string, literal: boolean): string {
  return literal ? text.replace(pattern, () => replacement) : text.replace(pattern, replacement)
}

export interface ListedLine {
  line: number
  text: string
}

export type ListedReplaceResult =
  | { ok: true; content: string; count: number }
  | { ok: false; reason: string }

/**
 * Replace the matches on exactly the listed lines of `content`, with the
 * per-line rules they were listed by. Refuses when a listed line no longer
 * holds what the search listed: the text changed since, so its line numbers
 * cannot be trusted.
 */
export function replaceListedLines(
  content: string,
  listed: readonly ListedLine[],
  query: string,
  flags: SearchFlags,
  replacement: string,
): ListedReplaceResult {
  const test = buildSearchPattern(query, flags)
  const every = buildSearchPattern(query, flags, true)
  // Even entries are lines, odd entries the line breaks between them, kept as they were.
  const parts = content.split(/(\r?\n)/)
  let count = 0
  for (const { line, text } of listed) {
    const index = (line - 1) * 2
    const current = Number.isInteger(line) && line >= 1 ? parts[index] : undefined
    if (current === undefined || listedLineText(current) !== text || !test.test(current)) {
      return { ok: false, reason: `line ${line} changed since the search` }
    }
    count += current.match(every)?.length ?? 0
    parts[index] = replaceMatches(current, every, replacement, !flags.regex)
  }
  return { ok: true, content: parts.join(''), count }
}

const GLOB_TOKENS = new Map([
  ['**/', '(?:.*/)?'],
  ['**', '.*'],
  ['*', '[^/]*'],
  ['?', '[^/]'],
])

/**
 * One include/exclude pattern. Without a slash it matches any single path
 * segment (`*.ts`, `node_modules`); with one it matches from the workspace
 * root, and a matched folder covers everything inside it (`src/**`, `./lib`).
 */
function pathGlob(pattern: string): ((relPath: string) => boolean) | null {
  let glob = pattern.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const anchored = glob.includes('/')
  glob = glob.replace(/^\.?\//, '')
  if (!glob) return null
  const source = glob
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) => GLOB_TOKENS.get(part) ?? part.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
    .join('')
  if (!anchored) {
    const segment = new RegExp(`^${source}$`)
    return (relPath) => relPath.split('/').some((name) => segment.test(name))
  }
  const fromRoot = new RegExp(`^${source}(?:/|$)`)
  return (relPath) => fromRoot.test(relPath)
}

/** Whether a file (by workspace-relative path, `/`-separated) passes the filters. */
export function createPathFilter(filters: SearchPathFilters): (relPath: string) => boolean {
  const include = filters.include.map(pathGlob).filter((m) => m !== null)
  const exclude = filters.exclude.map(pathGlob).filter((m) => m !== null)
  return (relPath) =>
    !exclude.some((matches) => matches(relPath)) &&
    (include.length === 0 || include.some((matches) => matches(relPath))) &&
    (filters.extensions.length === 0 || filters.extensions.some((ext) => relPath.endsWith(ext)))
}

/** Comma-separated patterns as typed in the include/exclude boxes. */
export function splitPatterns(value: string): string[] {
  return value.split(',').map((p) => p.trim()).filter(Boolean)
}

function workspaceRelativePath(rootPath: string, filePath: string): string {
  const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const file = filePath.replace(/\\/g, '/')
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file
}

/** "Open Only" search: the open buffers, unsaved edits included, by the same rules as fs:search. */
export function searchOpenBuffers(
  files: readonly { path: string; content: string }[],
  rootPath: string,
  query: string,
  flags: SearchFlags,
  filters: SearchPathFilters,
): FileSearchMatch[] {
  const pattern = buildSearchPattern(query, flags)
  const passes = createPathFilter(filters)
  const matches: FileSearchMatch[] = []
  for (const file of files) {
    if (!passes(workspaceRelativePath(rootPath, file.path))) continue
    file.content.split(LINE_BREAK).forEach((line, i) => {
      if (pattern.test(line)) matches.push({ file: file.path, line: i + 1, content: listedLineText(line) })
    })
  }
  return matches
}
