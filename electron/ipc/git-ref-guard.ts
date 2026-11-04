const CONTROL_CHARACTER_RE = /[\x00-\x1F\x7F]/

export class UnsafeGitRefError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeGitRefError'
  }
}

export function normalizeGitBranchName(value: unknown, label = 'branch name'): string {
  if (typeof value !== 'string') {
    throw new UnsafeGitRefError(`Invalid ${label}: expected a string`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw new UnsafeGitRefError(`Invalid ${label}: empty value`)
  }

  if (CONTROL_CHARACTER_RE.test(trimmed)) {
    throw new UnsafeGitRefError(`Invalid ${label}: control characters are not allowed`)
  }

  if (trimmed.startsWith('-')) {
    throw new UnsafeGitRefError(`Invalid ${label}: must not start with '-'`)
  }

  return trimmed
}

export function normalizeGitCommitHash(value: unknown, label = 'commit hash'): string {
  if (typeof value !== 'string') {
    throw new UnsafeGitRefError(`Invalid ${label}: expected a string`)
  }

  const trimmed = value.trim()
  if (!/^[0-9a-fA-F]{7,40}$/.test(trimmed)) {
    throw new UnsafeGitRefError(`Invalid ${label}`)
  }

  return trimmed
}

export function tryNormalizeGitCommitHash(value: unknown): string | null {
  try {
    return normalizeGitCommitHash(value)
  } catch {
    return null
  }
}

const WHITESPACE_RE = /\s/

function normalizeGitToken(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new UnsafeGitRefError(`Invalid ${label}: expected a string`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new UnsafeGitRefError(`Invalid ${label}: empty value`)
  }
  if (CONTROL_CHARACTER_RE.test(trimmed)) {
    throw new UnsafeGitRefError(`Invalid ${label}: control characters are not allowed`)
  }
  if (trimmed.startsWith('-')) {
    // A leading '-' would be parsed as an option, e.g. `--upload-pack=<cmd>`
    // or `--receive-pack=<cmd>`, which git executes.
    throw new UnsafeGitRefError(`Invalid ${label}: must not start with '-'`)
  }
  return trimmed
}

/**
 * Remote name or URL for push/pull/fetch/remote-add.
 *
 * Rejects option-like values and the `ext::` / `fd::` transports, which run
 * arbitrary commands or touch raw file descriptors.
 */
export function normalizeGitRemote(value: unknown, label = 'remote'): string {
  const remote = normalizeGitToken(value, label)
  if (WHITESPACE_RE.test(remote)) {
    throw new UnsafeGitRefError(`Invalid ${label}: whitespace is not allowed`)
  }
  if (/^(ext|fd)::/i.test(remote)) {
    throw new UnsafeGitRefError(`Invalid ${label}: transport is not allowed`)
  }
  return remote
}

/** Ref or refspec such as `main`, `HEAD~2`, or `+HEAD:refs/heads/main`. */
export function normalizeGitRefspec(value: unknown, label = 'refspec'): string {
  const refspec = normalizeGitToken(value, label)
  if (WHITESPACE_RE.test(refspec)) {
    throw new UnsafeGitRefError(`Invalid ${label}: whitespace is not allowed`)
  }
  return refspec
}

/** Pathspec passed after `--`. Option-like names are fine there; NUL is not. */
export function normalizeGitPathspec(value: unknown, label = 'path'): string {
  if (typeof value !== 'string' || !value) {
    throw new UnsafeGitRefError(`Invalid ${label}: expected a non-empty string`)
  }
  if (value.includes('\0')) {
    throw new UnsafeGitRefError(`Invalid ${label}: NUL bytes are not allowed`)
  }
  return value
}

/**
 * Keys the renderer may write with `git config`.
 *
 * Many config keys make git execute programs (`core.fsmonitor`,
 * `core.sshCommand`, `core.pager`, `alias.*`, `filter.*`, `credential.helper`,
 * `gpg.program`, …), so writes are limited to an allowlist instead of a
 * blocklist that would have to track every new git release.
 */
const WRITABLE_GIT_CONFIG_KEYS = new Set([
  'user.name',
  'user.email',
  'user.signingkey',
  'commit.gpgsign',
  'tag.gpgsign',
  'pull.rebase',
  'pull.ff',
  'push.default',
  'push.autosetupremote',
  'fetch.prune',
  'merge.ff',
  'rebase.autostash',
  'init.defaultbranch',
  'core.autocrlf',
  'core.eol',
  'core.ignorecase',
  'core.filemode',
  'color.ui',
])

const WRITABLE_BRANCH_CONFIG_RE = /^branch\.[^\s]+\.(remote|merge|rebase)$/i

/** Validates a config key for reading. */
export function normalizeGitConfigKey(value: unknown): string {
  const key = normalizeGitToken(value, 'config key')
  if (WHITESPACE_RE.test(key) || !/^[A-Za-z0-9][\w.-]*$/.test(key.split('.')[0])) {
    throw new UnsafeGitRefError('Invalid config key')
  }
  return key
}

/** Validates a config key for writing against the allowlist. */
export function normalizeWritableGitConfigKey(value: unknown): string {
  const key = normalizeGitConfigKey(value)
  if (!WRITABLE_GIT_CONFIG_KEYS.has(key.toLowerCase()) && !WRITABLE_BRANCH_CONFIG_RE.test(key)) {
    throw new UnsafeGitRefError(`Refused to write git config key: ${key}`)
  }
  return key
}

/** `-- <remote> [<refspec>]` with both values validated as non-options. */
export function buildRemoteArgs(remote: unknown, refspec?: unknown): string[] {
  const args = ['--']
  const hasRemote = !(remote === undefined || remote === null || (typeof remote === 'string' && remote.trim() === ''))
  const hasRefspec = !(refspec === undefined || refspec === null || (typeof refspec === 'string' && refspec.trim() === ''))
  if (!hasRemote) {
    if (hasRefspec) throw new UnsafeGitRefError('A refspec requires a remote')
    return []
  }
  args.push(normalizeGitRemote(remote))
  if (hasRefspec) args.push(normalizeGitRefspec(refspec))
  return args
}
