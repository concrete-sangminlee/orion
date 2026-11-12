import { execFile } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
import { resolveGitCwd, resolveGitInternalPath } from './git-cwd-guard'
import {
  normalizeGitBranchName,
  normalizeGitCommitHash,
  normalizeGitConfigKey,
  normalizeGitPathspec,
  normalizeGitRefspec,
  normalizeWritableGitConfigKey,
  tryNormalizeGitCommitHash,
  buildRemoteArgs,
  normalizeGitRemote,
} from './git-ref-guard'
import {
  appendGitStashCreateArgs,
  GitStashCreateOptions,
  GitStashApplyOptions,
  resolveGitStashIndex,
} from './git-stash-guard'
import { appendGitSequencerOptions, GitSequencerOptions } from './git-sequencer-guard'
import { GIT_TAG_FORMAT, parseGitTagLine } from './git-tag-format'
import { parseGitPorcelainStatusZ } from './git-status-parse'
import { handle } from './typed-ipc'
import type { GitBranch, GitSubmodule } from '../../shared/ipc-contract'

const execFileAsync = promisify(execFile)

/**
 * Run git using execFile with an array of arguments.
 * Throws on non-zero exit so callers can report errors.
 *
 * NEVER goes through a shell — argv entries are passed directly to git, so
 * renderer-supplied values (file paths, branch names, commit messages, refs)
 * cannot inject commands via shell metacharacters.
 */
interface GitExecOptions {
  timeout?: number
  maxBuffer?: number
  /**
   * Return stdout untouched. Required for column-sensitive formats such as
   * `status --porcelain`, where trimming eats the first entry's leading space.
   */
  raw?: boolean
}

/** Read-only queries (status, log, diff) should answer quickly. */
const QUERY_TIMEOUT_MS = 10_000
/**
 * Commands that change the repository can run hooks (lint-staged, tests),
 * wait for a GPG pinentry, or rewrite a large worktree. Killing them at the
 * query timeout aborted commits while the hook's processes kept running.
 */
export const MUTATION_TIMEOUT_MS = 10 * 60_000

/**
 * Prepended to every git command. `ext::` remotes run an arbitrary command
 * when git talks to them (fetch, pull, push, ls-remote); a value written into
 * `remote.<name>.url` or `branch.<name>.remote` must never get that far.
 */
export const GIT_SAFETY_ARGS = ['-c', 'protocol.ext.allow=never'] as const

async function runGitExec(
  cwd: unknown,
  args: string[],
  options?: GitExecOptions
): Promise<string> {
  const safeCwd = await resolveGitCwd(cwd)
  const timeout = options?.timeout ?? QUERY_TIMEOUT_MS
  try {
    const { stdout } = await execFileAsync('git', [...GIT_SAFETY_ARGS, ...args], {
      cwd: safeCwd,
      timeout,
      maxBuffer: options?.maxBuffer ?? 1024 * 1024 * 5,
    })
    return options?.raw ? stdout : stdout.trim()
  } catch (err: any) {
    // execFile kills git at the timeout; the partial stderr it leaves (often
    // hook output) does not say why the command stopped.
    if (err?.killed) throw new Error(`git ${args[0]} timed out after ${Math.round(timeout / 1000)} s`)
    throw err
  }
}

/**
 * Same as runGitExec but returns '' instead of throwing on failure.
 * Use for handlers that should degrade gracefully (status checks, optional
 * upstream queries) rather than propagating errors to the renderer.
 */
async function runGitOrEmpty(
  cwd: unknown,
  args: string[],
  options?: GitExecOptions
): Promise<string> {
  try {
    return await runGitExec(cwd, args, options)
  } catch {
    return ''
  }
}

function gitErrorMessage(err: any): string {
  // Some failures (e.g. "nothing to commit") are reported on stdout only.
  return err?.stderr?.trim() || err?.stdout?.trim() || err?.message || 'Git operation failed'
}

/**
 * Run a state-changing git command and reject with git's own diagnostic when
 * it fails. The renderer awaits these inside try/catch and shows the message
 * in a toast; resolving with '' on failure made every push/pull/commit look
 * successful.
 */
async function runGitMutation(
  cwd: unknown,
  args: string[],
  options?: GitExecOptions
): Promise<string> {
  try {
    return await runGitExec(cwd, args, { timeout: MUTATION_TIMEOUT_MS, ...options })
  } catch (err: any) {
    throw new Error(gitErrorMessage(err))
  }
}

interface GitLogPageOptions {
  offset?: unknown
  limit?: unknown
  file?: unknown
  author?: unknown
  since?: unknown
  until?: unknown
  search?: unknown
}

interface ParsedLogCommit {
  fullHash: string
  hash: string
  author: string
  email: string
  date: string
  message: string
}

function normalizeGitLogOptions(
  options?: GitLogPageOptions,
): {
  offset: number
  limit: number
  file?: string
  author?: string
  since?: string
  until?: string
  search?: string
} {
  const opts = options ?? {}

  const toNonNegativeInt = (value: unknown, fallback: number): number => {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    if (!Number.isFinite(parsed) || parsed < 0) return fallback
    return parsed
  }

  const trimOrUndefined = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const safeLimit = Math.min(toNonNegativeInt(opts.limit, 50), 200)
  const safeOffset = toNonNegativeInt(opts.offset, 0)

  return {
    offset: safeOffset,
    limit: safeLimit,
    file: trimOrUndefined(opts.file),
    author: trimOrUndefined(opts.author),
    since: trimOrUndefined(opts.since),
    until: trimOrUndefined(opts.until),
    search: trimOrUndefined(opts.search),
  }
}

function parseGitLogOutput(raw: string): ParsedLogCommit[] {
  if (!raw) return []
  const SEP = '\x1f'
  const REC = '\x1e'
  const rawEntries = raw.split(REC).filter(Boolean)
  return rawEntries.map((record) => {
    const parts = record.trim().split(SEP)
    return {
      fullHash: parts[0] || '',
      hash: parts[1] || '',
      author: parts[2] || '',
      email: parts[3] || '',
      date: parts[4] || '',
      message: parts[5] || '',
    }
  })
}

async function getGitLogPage(cwd: string, options?: GitLogPageOptions) {
  const { offset, limit, file, author, since, until, search } = normalizeGitLogOptions(options)

  const SEP = '\x1f'
  const REC = '\x1e'
  const format = `%H${SEP}%h${SEP}%an${SEP}%ae${SEP}%ai${SEP}%s${REC}`

  const args = ['log', `--pretty=format:${format}`, `--skip=${offset}`, `--max-count=${Math.min(limit + 1, 201)}`]
  if (author) args.push(`--author=${author}`)
  if (since) args.push(`--since=${since}`)
  if (until) args.push(`--until=${until}`)
  if (search) {
    args.push(`--grep=${search}`, '--regexp-ignore-case')
  }
  if (file) {
    args.push('--', file)
  }

  const raw = await runGitOrEmpty(cwd, args)
  const parsed = parseGitLogOutput(raw)
  const hasMore = parsed.length > limit

  return {
    commits: parsed.slice(0, limit),
    hasMore,
  }
}


const NETWORK_TIMEOUT_MS = 120_000

/** An untracked folder is one status row; diffing every file in it could take long. */
const MAX_UNTRACKED_DIFF_FILES = 20

/**
 * `git diff` ignores untracked files, so show them as added: each one diffed
 * against an empty file. The paths come from `git ls-files`, so they are inside
 * the repository even though `--no-index` would accept any path.
 */
async function diffUntracked(cwd: unknown, pathspec: string): Promise<string> {
  const listed = await runGitOrEmpty(cwd, ['ls-files', '-z', '--others', '--exclude-standard', '--', pathspec], { raw: true })
  const files = listed.split('\0').filter(Boolean)
  const diffs: string[] = []
  for (const file of files.slice(0, MAX_UNTRACKED_DIFF_FILES)) {
    try {
      diffs.push(await runGitExec(cwd, ['diff', '--no-index', '--', '/dev/null', file]))
    } catch (err: any) {
      // --no-index exits 1 when the inputs differ, which is always the case here.
      if (err?.code === 1 && typeof err.stdout === 'string') diffs.push(err.stdout.trim())
    }
  }
  const omitted = files.length - MAX_UNTRACKED_DIFF_FILES
  if (omitted > 0) diffs.push(`${omitted} more untracked file${omitted === 1 ? '' : 's'} not shown`)
  return diffs.filter(Boolean).join('\n')
}

export function registerGitHandlers() {
  handle('git:status', async (_, cwd: string) => {
    const branch = await runGitOrEmpty(cwd, ['branch', '--show-current'])
    const statusRaw = await runGitOrEmpty(cwd, ['status', '--porcelain=v1', '-z'], { raw: true })
    const isRepo = branch !== '' || statusRaw !== ''

    if (!isRepo) {
      const check = await runGitOrEmpty(cwd, ['rev-parse', '--is-inside-work-tree'])
      if (check !== 'true') {
        return { isRepo: false, branch: '', detached: false, head: '', upstream: '', files: [], staged: [], unstaged: [], ahead: 0, behind: 0 }
      }
    }

    const { files, staged, unstaged } = parseGitPorcelainStatusZ(statusRaw)

    // `branch --show-current` prints nothing on a detached HEAD (it does name
    // an unborn branch). Reporting 'main' there hid that new commits would be
    // on no branch at all.
    const detached = branch === ''
    const head = detached ? await runGitOrEmpty(cwd, ['rev-parse', '--short', 'HEAD']) : ''
    const upstream = detached
      ? ''
      : await runGitOrEmpty(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])

    let ahead = 0, behind = 0
    if (upstream) {
      const ab = await runGitOrEmpty(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
      if (ab) {
        const [a, b] = ab.split('\t').map(Number)
        ahead = a || 0
        behind = b || 0
      }
    }

    return { isRepo: true, branch: detached ? 'HEAD' : branch, detached, head, upstream, files, staged, unstaged, ahead, behind }
  })

  handle('git:diff', async (_, cwd: string, rawFilePath?: unknown, staged?: unknown) => {
    const cached = staged === true ? ['--cached'] : []
    if (rawFilePath === undefined || rawFilePath === '') return await runGitOrEmpty(cwd, ['diff', ...cached])
    const filePath = normalizeGitPathspec(rawFilePath)
    const diff = await runGitOrEmpty(cwd, ['diff', ...cached, '--', filePath])
    if (diff || staged === true) return diff
    return await diffUntracked(cwd, filePath)
  })

  handle('git:log', async (_, cwd: string, count: number = 50) => {
    // Use ASCII record/unit separators to avoid conflicts with commit message content
    const SEP = '\x1f' // unit separator
    const REC = '\x1e' // record separator
    const format = `%H${SEP}%h${SEP}%an${SEP}%ae${SEP}%ai${SEP}%s${REC}`
    const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 50
    const raw = await runGitOrEmpty(cwd, ['log', `--pretty=format:${format}`, `-${safeCount}`])
    if (!raw) return []
    return raw.split(REC).filter(s => s.trim()).map((record) => {
      const parts = record.trim().split(SEP)
      return {
        fullHash: parts[0] || '',
        hash: parts[1] || '',
        author: parts[2] || '',
        email: parts[3] || '',
        date: parts[4] || '',
        message: parts[5] || '',
      }
    })
  })

  handle('git:log-page', async (_, cwd: string, options?: GitLogPageOptions) => {
    return getGitLogPage(cwd, options)
  })

  handle('git:file-log', async (_, cwd: string, options?: GitLogPageOptions) => {
    return getGitLogPage(cwd, options)
  })

  handle('git:diff-commits', async (_, cwd: string, commitA: string, commitB: string) => {
    const safeA = tryNormalizeGitCommitHash(commitA)
    const safeB = tryNormalizeGitCommitHash(commitB)
    if (!safeA || !safeB) return { diff: '', filesChanged: 0 }
    const output = await runGitOrEmpty(cwd, ['diff', `${safeA}..${safeB}`])
    return { diff: output, filesChanged: output ? output.split('\n').filter(Boolean).length : 0 }
  })

  handle('git:blame', async (_, cwd: string, filePath: string) => {
    const raw = await runGitOrEmpty(cwd, ['blame', '--porcelain', '--', normalizeGitPathspec(filePath)], { timeout: 30000, maxBuffer: 1024 * 1024 * 10 })
    if (!raw) return []

    const lines = raw.split('\n')
    const result: { hash: string; author: string; date: string; line: number; content: string }[] = []
    let currentHash = ''
    let currentAuthor = ''
    let currentDate = ''
    let currentLine = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Header line: <hash> <orig-line> <final-line> [<num-lines>]
      const headerMatch = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/)
      if (headerMatch) {
        currentHash = headerMatch[1]
        currentLine = parseInt(headerMatch[2], 10)
        continue
      }
      if (line.startsWith('author ')) {
        currentAuthor = line.substring(7)
        continue
      }
      if (line.startsWith('author-time ')) {
        const timestamp = parseInt(line.substring(12), 10)
        currentDate = new Date(timestamp * 1000).toISOString()
        continue
      }
      // Content line starts with a tab
      if (line.startsWith('\t')) {
        result.push({
          hash: currentHash.substring(0, 8),
          author: currentAuthor,
          date: currentDate,
          line: currentLine,
          content: line.substring(1),
        })
      }
    }
    return result
  })

  handle('git:show', async (_, cwd: string, hash: string) => {
    const safeHash = tryNormalizeGitCommitHash(hash)
    if (!safeHash) return null

    const SEP = '\x1f'
    const format = `%H${SEP}%h${SEP}%an${SEP}%ae${SEP}%ai${SEP}%s`
    const headerRaw = await runGitOrEmpty(cwd, ['show', safeHash, '--quiet', `--pretty=format:${format}`])
    const statRaw = await runGitOrEmpty(cwd, ['show', safeHash, '--stat', '--format='])

    if (!headerRaw) return null

    const parts = headerRaw.trim().split(SEP)
    const filesChanged: { file: string; changes: string }[] = []
    let summary = ''

    if (statRaw) {
      const statLines = statRaw.trim().split('\n')
      for (const sl of statLines) {
        // Match file stat lines like: " src/file.ts | 10 ++++----"
        const fileMatch = sl.match(/^\s*(.+?)\s+\|\s+(.+)$/)
        if (fileMatch) {
          filesChanged.push({ file: fileMatch[1].trim(), changes: fileMatch[2].trim() })
        }
        // Match summary line like: " 3 files changed, 10 insertions(+), 5 deletions(-)"
        if (sl.match(/\d+\s+file/)) {
          summary = sl.trim()
        }
      }
    }

    return {
      fullHash: parts[0] || '',
      hash: parts[1] || '',
      author: parts[2] || '',
      email: parts[3] || '',
      date: parts[4] || '',
      message: parts[5] || '',
      filesChanged,
      summary,
    }
  })

  handle('git:stage', async (_, cwd: string, filePath: unknown) => {
    await runGitMutation(cwd, ['add', '--', normalizeGitPathspec(filePath)])
    return true
  })

  handle('git:unstage', async (_, cwd: string, filePath: unknown) => {
    await runGitMutation(cwd, ['reset', '-q', 'HEAD', '--', normalizeGitPathspec(filePath)])
    return true
  })

  handle('git:commit', async (_, cwd: string, message: string, amend = false) => {
    // The message is a single argv entry (execFile, no shell) — no quoting needed.
    const args = ['commit']
    if (amend) {
      args.push('--amend')
      if (message) {
        args.push('-m', message)
      } else {
        args.push('--no-edit')
      }
    } else {
      args.push('-m', message)
    }
    await runGitMutation(cwd, args)
    return true
  })

  handle('git:checkout', async (_, cwd: string, branch: unknown, track?: unknown) => {
    // The trailing `--` forces `branch` to be read as a ref. Without it a
    // value that is not a ref but matches a file (e.g. "README.md") makes git
    // check out that path instead, silently discarding local edits.
    if (track === undefined) {
      return await runGitMutation(cwd, ['checkout', normalizeGitRefspec(branch, 'branch'), '--'])
    }
    // Checking out a remote-tracking ref itself detaches HEAD, and git's
    // by-name guess fails when several remotes have the branch.
    const startPoint = normalizeGitRefspec(track, 'remote branch')
    return await runGitMutation(cwd, ['checkout', '-b', normalizeGitBranchName(branch), '--track', startPoint, '--'])
  })

  handle('git:discard', async (_, cwd: string, rawFilePath: unknown) => {
    const filePath = normalizeGitPathspec(rawFilePath)
    const tracked = await runGitOrEmpty(cwd, ['ls-files', '--', filePath])
    if (tracked) {
      await runGitMutation(cwd, ['checkout', '--', filePath])
    } else {
      await runGitMutation(cwd, ['clean', '-f', '--', filePath])
    }
    return true
  })

  handle('git:branches', async (_, cwd: string) => {
    // Full ref names tell local branches from remote-tracking ones, which
    // check out as a detached HEAD. TAB cannot occur in a ref name; '|' can.
    const raw = await runGitOrEmpty(cwd, ['branch', '-a', '--format=%(refname)%09%(HEAD)%09%(symref)'], { raw: true })
    if (!raw) return []
    // Longest first, so remote "a/b" wins over "a" for refs/remotes/a/b/x.
    const remotes = (await runGitOrEmpty(cwd, ['remote'])).split('\n').filter(Boolean).sort((a, b) => b.length - a.length)
    const branches: GitBranch[] = []
    for (const line of raw.split('\n')) {
      const [ref, head, symref] = line.split('\t')
      if (ref.startsWith('refs/heads/')) {
        branches.push({ name: ref.slice('refs/heads/'.length), current: head === '*' })
      } else if (ref.startsWith('refs/remotes/') && !symref) {
        // Symbolic refs such as origin/HEAD are skipped, and so is the
        // "(HEAD detached at …)" pseudo-entry, which is no ref at all.
        const name = ref.slice('refs/remotes/'.length)
        const remote = remotes.find((r) => name.startsWith(`${r}/`)) ?? name.split('/')[0]
        branches.push({ name, current: false, remote })
      }
    }
    return branches
  })

  // Return parsed diff hunks for a specific file (used for git gutter decorations)
  handle('git:file-diff', async (_, cwd: string, filePath: string) => {
    const raw = await runGitOrEmpty(cwd, ['diff', '-U0', '--', filePath])
    if (!raw) return []

    const hunks: { type: 'added' | 'modified' | 'deleted'; startLine: number; count: number }[] = []
    const lines = raw.split('\n')
    for (const line of lines) {
      // Parse hunk headers like @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (match) {
        const oldStart = parseInt(match[1], 10)
        const oldCount = parseInt(match[2] ?? '1', 10)
        const newStart = parseInt(match[3], 10)
        const newCount = parseInt(match[4] ?? '1', 10)

        if (oldCount === 0 && newCount > 0) {
          // Pure addition
          hunks.push({ type: 'added', startLine: newStart, count: newCount })
        } else if (newCount === 0 && oldCount > 0) {
          // Pure deletion
          hunks.push({ type: 'deleted', startLine: newStart, count: 1 })
        } else {
          // Modification (changed lines)
          hunks.push({ type: 'modified', startLine: newStart, count: newCount })
        }
      }
    }
    return hunks
  })

  // Return combined unified diff (staged + unstaged) for a specific file
  handle('git:diff-file', async (_, cwd: string, filePath: string) => {
    // Get unstaged changes
    const unstaged = await runGitOrEmpty(cwd, ['diff', '-U0', '--', filePath])
    // Get staged (cached) changes
    const staged = await runGitOrEmpty(cwd, ['diff', '--cached', '-U0', '--', filePath])

    // Combine both diffs and parse hunks
    const combined = [unstaged, staged].filter(Boolean).join('\n')
    if (!combined) return []

    const hunks: { type: 'added' | 'modified' | 'deleted'; startLine: number; count: number }[] = []
    const lines = combined.split('\n')
    for (const line of lines) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (match) {
        const oldCount = parseInt(match[2] ?? '1', 10)
        const newStart = parseInt(match[3], 10)
        const newCount = parseInt(match[4] ?? '1', 10)

        if (oldCount === 0 && newCount > 0) {
          hunks.push({ type: 'added', startLine: newStart, count: newCount })
        } else if (newCount === 0 && oldCount > 0) {
          hunks.push({ type: 'deleted', startLine: newStart, count: 1 })
        } else {
          hunks.push({ type: 'modified', startLine: newStart, count: newCount })
        }
      }
    }

    // Deduplicate overlapping hunks (same line ranges from staged + unstaged)
    const seen = new Set<string>()
    return hunks.filter((h) => {
      const key = `${h.type}:${h.startLine}:${h.count}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })

  // push/pull: the remote and refspec are validated (no leading '-') AND
  // placed after `--`. Previously a renderer-supplied remote such as
  // `--upload-pack=<cmd>` (pull) or `--receive-pack=<cmd>` (push) followed by
  // `.` made git execute <cmd> locally.
  // Without a remote these run plain `git push` / `git pull`, which follow the
  // branch's configured upstream instead of assuming it lives on 'origin'.
  handle('git:push', async (_, cwd: string, remote?: unknown, branch?: unknown, force = false, setUpstream = false) => {
    const args = ['push']
    if (force === true) {
      args.push('--force-with-lease')
    }
    if (setUpstream === true) {
      args.push('--set-upstream')
    }
    args.push(...buildRemoteArgs(remote, branch))
    return await runGitMutation(cwd, args, { timeout: NETWORK_TIMEOUT_MS })
  })

  handle('git:pull', async (_, cwd: string, remote?: unknown, branch?: unknown) => {
    return await runGitMutation(cwd, ['pull', ...buildRemoteArgs(remote, branch)], { timeout: NETWORK_TIMEOUT_MS })
  })

  handle('git:fetch', async (_, cwd: string) => {
    return await runGitMutation(cwd, ['fetch', '--all'], { timeout: NETWORK_TIMEOUT_MS })
  })

  handle('git:stash', async (_, cwd: string) => {
    return await runGitMutation(cwd, ['stash'])
  })

  handle('git:stash-pop', async (_, cwd: string, rawIndex: unknown) => {
    const safeIndex = resolveGitStashIndex(rawIndex)
    return await runGitMutation(cwd, ['stash', 'pop', `stash@{${safeIndex}}`])
  })

  handle('git:create-branch', async (_, cwd: string, branchName: unknown) => {
    return await runGitMutation(cwd, ['checkout', '-b', normalizeGitBranchName(branchName)])
  })

  handle('git:stage-all', async (_, cwd: string) => {
    await runGitMutation(cwd, ['add', '-A'])
    return true
  })

  handle('git:unstage-all', async (_, cwd: string) => {
    await runGitMutation(cwd, ['reset', '-q', 'HEAD'])
    return true
  })

  handle('git:stash-list', async (_, cwd: string) => {
    const SEP = '\x1f'
    const raw = await runGitOrEmpty(cwd, ['stash', 'list', `--pretty=format:%H${SEP}%s${SEP}%an${SEP}%at${SEP}%gd`])
    if (!raw) return []
    return raw.split('\n').filter(Boolean).map((line, index) => {
      const parts = line.split(SEP)
      const message = parts[1] || `stash@{${index}}`
      const branchMatch = message.match(/^On (.+):/)
      return {
        index,
        hash: (parts[0] || '').substring(0, 8),
        message,
        branch: branchMatch ? branchMatch[1] : '',
        date: parts[3] ? new Date(Number(parts[3]) * 1000).toISOString() : '',
        author: parts[2] || '',
        untracked: false,
      }
    })
  })

  handle('git:stash-drop', async (_, cwd: string, rawIndex: unknown) => {
    const safeIndex = resolveGitStashIndex(rawIndex)
    return await runGitMutation(cwd, ['stash', 'drop', `stash@{${safeIndex}}`])
  })

  handle(
    'git:stash-apply',
    async (_, cwd: string, rawIndex: unknown, rawOptions: unknown) => {
      const options: GitStashApplyOptions =
        rawIndex && typeof rawIndex === 'object' && !Array.isArray(rawIndex) && 'index' in rawIndex && typeof rawOptions !== 'object'
          ? (rawIndex as GitStashApplyOptions)
          : typeof rawOptions === 'object' && rawOptions !== null
            ? (rawOptions as GitStashApplyOptions)
            : {}

      const safeIndexSource = rawIndex && typeof rawIndex === 'object' && !Array.isArray(rawIndex) && 'index' in rawIndex
        ? (rawIndex as { index?: unknown }).index
        : rawIndex

      const safeIndex = resolveGitStashIndex(safeIndexSource)
      const command = options.drop ? 'pop' : 'apply'
      return await runGitMutation(cwd, ['stash', command, `stash@{${safeIndex}}`])
  })

  handle('git:stash-save', async (_, cwd: string, rawMessageOrOptions?: string | GitStashCreateOptions) => {
    const options: GitStashCreateOptions = typeof rawMessageOrOptions === 'object'
      ? rawMessageOrOptions ?? {}
      : { message: rawMessageOrOptions }

    const args = ['stash', 'push']
    appendGitStashCreateArgs(args, options)
    return await runGitMutation(cwd, args)
  })

  handle('git:stash-clear', async (_, cwd: string) => {
    return await runGitMutation(cwd, ['stash', 'clear'])
  })

  handle('git:stash-show', async (_, cwd: string, rawIndex: unknown) => {
    const safeIndex = resolveGitStashIndex(rawIndex)
    const raw = await runGitOrEmpty(cwd, ['stash', 'show', `stash@{${safeIndex}}`, '--name-only', '--patch', '--no-color'])
    if (!raw) return null

    const files: Array<{ path: string; status: 'modified' | 'added' | 'deleted' | 'renamed'; insertions: number; deletions: number }> = []
    const hunks: Array<{ header: string; lines: Array<{ type: 'context' | 'addition' | 'deletion' | 'header'; content: string; oldLineNumber?: number; newLineNumber?: number }> }> = []

    let currentHunk: typeof hunks[number] | null = null
    const lines = raw.split('\n')
    for (const line of lines) {
      if (line.startsWith('diff --git ')) {
        const parts = line.split(' ')
        const right = parts[parts.length - 1] || ''
        const filePath = right.startsWith('b/') ? right.slice(2) : right
        if (filePath) {
          files.push({ path: filePath, status: 'modified', insertions: 0, deletions: 0 })
        }
      } else if (line.startsWith('@@ ')) {
        if (currentHunk) {
          hunks.push(currentHunk)
        }
        currentHunk = { header: line, lines: [] }
      } else if (currentHunk) {
        const type = line.startsWith('+')
          ? 'addition'
          : line.startsWith('-')
            ? 'deletion'
            : line.startsWith('\\')
              ? 'context'
              : 'context'

        currentHunk.lines.push({
          type,
          content: line,
        })
      }
    }
    if (currentHunk) {
      hunks.push(currentHunk)
    }

    return {
      stashId: `stash@{${safeIndex}}`,
      files,
      hunks,
      rawDiff: raw,
    }
  })

  handle('git:stash-branch', async (_, cwd: string, rawIndex: unknown, rawBranch: unknown) => {
    const safeIndex = resolveGitStashIndex(rawIndex)
    const branchName = normalizeGitBranchName(rawBranch as string | undefined)
    return await runGitMutation(cwd, ['stash', 'branch', branchName, `stash@{${safeIndex}}`])
  })

  handle('git:merge-status', async (_, cwd: string) => {
    try {
      // rev-parse --verify MERGE_HEAD exits 0 and prints the hash when a merge
      // is in progress, non-zero (empty) otherwise — no gitDir path needed.
      const mergeHead = await runGitOrEmpty(cwd, ['rev-parse', '--verify', 'MERGE_HEAD'])
      return { merging: mergeHead !== '' }
    } catch {
      return { merging: false }
    }
  })

  handle('git:conflict-files', async (_, cwd: string) => {
    const raw = await runGitOrEmpty(cwd, ['diff', '--name-only', '--diff-filter=U'])
    if (!raw) return []
    return raw.split('\n').filter(Boolean)
  })

  handle('git:merge-abort', async (_, cwd: string) => {
    return await runGitMutation(cwd, ['merge', '--abort'])
  })

  // ── Cherry-pick ──────────────────────────────────────────────────────

  handle('git:merge', async (_, cwd: string, branchName: string) => {
    return await runGitMutation(cwd, ['merge', normalizeGitBranchName(branchName)])
  })

  handle('git:delete-branch', async (_, cwd: string, branchName: string) => {
    return await runGitMutation(cwd, ['branch', '-d', normalizeGitBranchName(branchName)])
  })

  handle('git:cherry-pick', async (_, cwd: string, commitHash: string, options?: GitSequencerOptions) => {
    const safeHash = normalizeGitCommitHash(commitHash)
    const args = ['cherry-pick']
    appendGitSequencerOptions(args, options)
    args.push(safeHash)
    return await runGitMutation(cwd, args)
  })

  // ── Revert ───────────────────────────────────────────────────────────

  handle('git:revert', async (_, cwd: string, commitHash: string, options?: GitSequencerOptions) => {
    try {
      const safeHash = normalizeGitCommitHash(commitHash)
      const args = ['revert']
      if (!options?.noCommit) {
        args.push('--no-edit')
      }
      appendGitSequencerOptions(args, options)
      args.push(safeHash)
      const result = await runGitExec(cwd, args, { timeout: MUTATION_TIMEOUT_MS })
      return { success: true, output: result }
    } catch (err: any) {
      return { success: false, error: gitErrorMessage(err) }
    }
  })

  // ── Interactive rebase status ────────────────────────────────────────

  handle('git:rebase-status', async (_, cwd: string) => {
    try {
      const gitDir = await runGitExec(cwd, ['rev-parse', '--git-dir'])
      if (!gitDir) return { rebasing: false }

      // Validate that the resolved gitDir is inside the workspace before any
      // filesystem reads. git rev-parse --git-dir returns an absolute path for
      // linked worktrees, which would otherwise silently escape the workspace.
      let rebaseMergePath: string
      let rebaseApplyPath: string
      try {
        rebaseMergePath = await resolveGitInternalPath(cwd, gitDir, 'rebase-merge')
        rebaseApplyPath = await resolveGitInternalPath(cwd, gitDir, 'rebase-apply')
      } catch {
        // gitDir resolves outside the workspace (linked worktree). Fall back to
        // a pure git command for detection without step-count detail.
        const rebaseHead = await runGitOrEmpty(cwd, ['rev-parse', '--verify', 'REBASE_HEAD'])
        return { rebasing: rebaseHead !== '', currentStep: 0, totalSteps: 0, headName: '' }
      }

      const isRebasing = fs.existsSync(rebaseMergePath) || fs.existsSync(rebaseApplyPath)
      if (!isRebasing) return { rebasing: false }

      const activeDir = fs.existsSync(rebaseMergePath) ? rebaseMergePath : rebaseApplyPath

      let currentStep = 0
      let totalSteps = 0
      let headName = ''

      const msgNumPath = path.join(activeDir, 'msgnum')
      const endPath = path.join(activeDir, 'end')
      const headNamePath = path.join(activeDir, 'head-name')

      if (fs.existsSync(msgNumPath)) {
        currentStep = parseInt(fs.readFileSync(msgNumPath, 'utf-8').trim(), 10) || 0
      }
      if (fs.existsSync(endPath)) {
        totalSteps = parseInt(fs.readFileSync(endPath, 'utf-8').trim(), 10) || 0
      }
      if (fs.existsSync(headNamePath)) {
        headName = fs.readFileSync(headNamePath, 'utf-8').trim().replace(/^refs\/heads\//, '')
      }

      return { rebasing: true, currentStep, totalSteps, headName }
    } catch {
      return { rebasing: false }
    }
  })

  // ── Tags ─────────────────────────────────────────────────────────────

  handle('git:tags', async (_, cwd: string) => {
    try {
      const raw = await runGitExec(cwd, ['tag', '--sort=-creatordate', `--format=${GIT_TAG_FORMAT}`])
      if (!raw) return []
      return raw.split('\n').filter(Boolean).map(parseGitTagLine)
    } catch {
      return []
    }
  })

  handle('git:create-tag', async (_, cwd: string, rawTagName: unknown, message?: string, commitHash?: string, force?: boolean) => {
    try {
      const tagName = normalizeGitBranchName(rawTagName, 'tag name')
      const args = ['tag']
      if (force === true) {
        args.push('-f')
      }
      if (message) {
        args.push('-a', tagName, '-m', message)
      } else {
        args.push(tagName)
      }
      if (commitHash) {
        // An invalid target used to be dropped silently, tagging HEAD instead
        // of the commit the user picked.
        args.push(normalizeGitCommitHash(commitHash))
      }
      await runGitExec(cwd, args, { timeout: MUTATION_TIMEOUT_MS })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: gitErrorMessage(err) }
    }
  })

  handle('git:delete-tag', async (_, cwd: string, rawTagName: unknown) => {
    try {
      await runGitExec(cwd, ['tag', '-d', normalizeGitBranchName(rawTagName, 'tag name')])
      return { success: true }
    } catch (err: any) {
      return { success: false, error: gitErrorMessage(err) }
    }
  })

  // ── Remote management ────────────────────────────────────────────────

  handle('git:remotes', async (_, cwd: string) => {
    try {
      const raw = await runGitExec(cwd, ['remote', '-v'])
      if (!raw) return []
      const remotes = new Map<string, { name: string; fetchUrl: string; pushUrl: string }>()
      raw.split('\n').filter(Boolean).forEach((line) => {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
        if (match) {
          const [, name, url, type] = match
          if (!remotes.has(name)) {
            remotes.set(name, { name, fetchUrl: '', pushUrl: '' })
          }
          const entry = remotes.get(name)!
          if (type === 'fetch') entry.fetchUrl = url
          else entry.pushUrl = url
        }
      })
      return Array.from(remotes.values())
    } catch {
      return []
    }
  })

  handle('git:add-remote', async (_, cwd: string, name: unknown, url: unknown) => {
    try {
      await runGitExec(cwd, ['remote', 'add', '--', normalizeGitBranchName(name, 'remote name'), normalizeGitRemote(url, 'remote URL')])
      return { success: true }
    } catch (err: any) {
      return { success: false, error: gitErrorMessage(err) }
    }
  })

  handle('git:remove-remote', async (_, cwd: string, name: unknown) => {
    try {
      await runGitExec(cwd, ['remote', 'remove', '--', normalizeGitBranchName(name, 'remote name')])
      return { success: true }
    } catch (err: any) {
      return { success: false, error: gitErrorMessage(err) }
    }
  })

  // ── Git config ───────────────────────────────────────────────────────

  handle('git:config-get', async (_, cwd: string, rawKey: unknown, scope?: unknown) => {
    try {
      const key = normalizeGitConfigKey(rawKey)
      const args = ['config']
      if (scope === 'local' || scope === 'global' || scope === 'system') args.push(`--${scope}`)
      args.push('--get', '--', key)
      const value = await runGitExec(cwd, args)
      return { success: true, value }
    } catch (err: any) {
      // Exit code 1 means key not found, which is not really an error
      return { success: false, value: null, error: gitErrorMessage(err) }
    }
  })

  handle('git:config-set', async (_, cwd: string, rawKey: unknown, value: unknown, scope?: unknown) => {
    try {
      // Arbitrary keys would let the renderer plant commands that git runs
      // later (core.fsmonitor, core.sshCommand, alias.*, …).
      const key = normalizeWritableGitConfigKey(rawKey)
      if (typeof value !== 'string' || value.includes('\0')) {
        return { success: false, error: 'Invalid config value' }
      }
      // A branch's remote is used by a plain `git pull`/`git push`; an option
      // or an ext:: URL there would run as part of the next sync.
      const configValue = /^branch\..+\.remote$/i.test(key) ? normalizeGitRemote(value, 'branch remote') : value
      const args = ['config']
      if (scope === 'local' || scope === 'global') args.push(`--${scope}`)
      args.push('--', key, configValue)
      await runGitExec(cwd, args)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: gitErrorMessage(err) }
    }
  })

  // ── Worktree ─────────────────────────────────────────────────────────

  handle('git:worktree-list', async (_, cwd: string) => {
    try {
      const raw = await runGitExec(cwd, ['worktree', 'list', '--porcelain'])
      if (!raw) return []

      const worktrees: { path: string; head: string; branch: string; bare: boolean }[] = []
      let current: { path: string; head: string; branch: string; bare: boolean } = { path: '', head: '', branch: '', bare: false }

      for (const line of raw.split('\n')) {
        if (line.startsWith('worktree ')) {
          current = { path: line.substring(9), head: '', branch: '', bare: false }
        } else if (line.startsWith('HEAD ')) {
          current.head = line.substring(5)
        } else if (line.startsWith('branch ')) {
          current.branch = line.substring(7).replace(/^refs\/heads\//, '')
        } else if (line === 'bare') {
          current.bare = true
        } else if (line === '') {
          if (current.path) worktrees.push({ ...current })
        }
      }
      // Push last entry if file doesn't end with blank line
      if (current.path && !worktrees.find((w) => w.path === current.path)) {
        worktrees.push({ ...current })
      }

      return worktrees
    } catch {
      return []
    }
  })

  // ── Submodules ───────────────────────────────────────────────────────

  handle('git:submodule-status', async (_, cwd: string) => {
    try {
      const raw = await runGitExec(cwd, ['submodule', 'status'])
      if (!raw) return []

      const submodules: GitSubmodule[] = []
      for (const line of raw.split('\n')) {
        // Format: [+-U ]<sha1> <path> [(describe)]
        const match = line.match(/^([+-U ]?)([0-9a-f]+)\s+(\S+)(?:\s+\((.+)\))?$/)
        if (!match) continue
        const [, statusChar, hash, subPath, describe] = match
        let status: GitSubmodule['status'] = 'initialized'
        if (statusChar === '-') status = 'uninitialized'
        else if (statusChar === '+') status = 'out-of-date'
        else if (statusChar === 'U') status = 'merge-conflict'
        submodules.push({ path: subPath, hash: hash.substring(0, 8), status, describe: describe || '' })
      }
      return submodules
    } catch {
      return []
    }
  })

  // ── Git ignore ───────────────────────────────────────────────────────

  handle('git:check-ignored', async (_, cwd: string, filePaths: unknown) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return []
    try {
      const paths = filePaths.map((filePath) => normalizeGitPathspec(filePath))
      const result = await runGitExec(cwd, ['check-ignore', '--', ...paths])
      return result.split('\n').filter(Boolean)
    } catch {
      // Exit code 1 means no files are ignored, which is expected
      return []
    }
  })

  // ── Commit amend ─────────────────────────────────────────────────────

  handle('git:commit-amend', async (_, cwd: string, message?: string) => {
    try {
      const args = ['commit', '--amend']
      if (message) {
        args.push('-m', message)
      } else {
        args.push('--no-edit')
      }
      const result = await runGitExec(cwd, args, { timeout: MUTATION_TIMEOUT_MS })
      return { success: true, output: result }
    } catch (err: any) {
      return { success: false, error: gitErrorMessage(err) }
    }
  })

  // ── Reset ────────────────────────────────────────────────────────────

  handle('git:reset', async (_, cwd: string, mode: unknown, ref?: unknown) => {
    if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') {
      return { success: false, error: `Invalid reset mode: ${String(mode)}` }
    }
    try {
      const args = ['reset', `--${mode}`]
      if (ref !== undefined && ref !== '') {
        // execFile never involves a shell, so the old metacharacter stripping
        // protected nothing; what matters is that the ref cannot be an option.
        args.push(normalizeGitRefspec(ref, 'reset target'))
      }
      args.push('--')
      const result = await runGitExec(cwd, args, { timeout: MUTATION_TIMEOUT_MS })
      return { success: true, output: result }
    } catch (err: any) {
      return { success: false, error: gitErrorMessage(err) }
    }
  })

  // ── Clean ────────────────────────────────────────────────────────────

  handle('git:clean', async (_, cwd: string, options?: { directories?: boolean; force?: boolean; dryRun?: boolean; ignored?: boolean }) => {
    try {
      const args = ['clean']
      if (options?.dryRun) {
        args.push('-n')
      } else {
        if (options?.force === false) {
          return { success: true, removedFiles: [] }
        }
        args.push('-f')
      }
      if (options?.directories) {
        args.push('-d')
      }
      if (options?.ignored) {
        args.push('-x')
      }
      const result = await runGitExec(cwd, args, { timeout: MUTATION_TIMEOUT_MS })
      const removedFiles = result.split('\n').filter(Boolean).map((line) => {
        // Lines look like "Removing path/to/file" or "Would remove path/to/file"
        return line.replace(/^(Removing|Would remove)\s+/, '')
      })
      return { success: true, removedFiles }
    } catch (err: any) {
      return { success: false, error: gitErrorMessage(err), removedFiles: [] }
    }
  })
}
