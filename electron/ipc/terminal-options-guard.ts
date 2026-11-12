import type { TerminalSize } from '../../shared/ipc-contract'
import type { ShellOptions } from '../terminal/manager'

const CONTROL_CHARACTER_RE = /[\x00-\x1F\x7F]/

export class UnsafeShellOptionsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeShellOptionsError'
  }
}

/**
 * Sanity-check renderer-supplied terminal launch options before they reach
 * `pty.spawn()`. The terminal IPC is intentionally permissive — users
 * configure their shell, so we cannot enforce a binary allowlist — but a
 * compromised renderer should not be able to spawn `\0/path/to/anything`
 * or pass a non-string in place of `shellPath`. We reject the obvious
 * shape violations and leave shell metacharacter handling to the OS,
 * which is the documented contract of a terminal session.
 */
export function validateShellOptions(options: unknown): ShellOptions {
  if (options === undefined || options === null) return {}

  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new UnsafeShellOptionsError('shellOptions must be an object')
  }

  const opts = options as { shellPath?: unknown; shellArgs?: unknown }
  const result: ShellOptions = {}

  if (opts.shellPath !== undefined) {
    if (typeof opts.shellPath !== 'string') {
      throw new UnsafeShellOptionsError('shellOptions.shellPath must be a string')
    }
    const trimmed = opts.shellPath.trim()
    if (!trimmed) {
      throw new UnsafeShellOptionsError('shellOptions.shellPath must not be empty')
    }
    if (CONTROL_CHARACTER_RE.test(trimmed)) {
      throw new UnsafeShellOptionsError('shellOptions.shellPath must not contain control characters')
    }
    result.shellPath = trimmed
  }

  if (opts.shellArgs !== undefined) {
    if (!Array.isArray(opts.shellArgs)) {
      throw new UnsafeShellOptionsError('shellOptions.shellArgs must be an array')
    }
    const safeArgs: string[] = []
    for (const arg of opts.shellArgs) {
      if (typeof arg !== 'string') {
        throw new UnsafeShellOptionsError('shellOptions.shellArgs entries must be strings')
      }
      // Only NUL is rejected here — other control characters can be
      // meaningful inside shell args (e.g. an arg literally containing a
      // tab/newline that the user wants the child process to receive).
      // NUL terminates the argv entry in the underlying execvp call, so
      // its only effect is hiding the rest of the argument from the OS.
      if (/\x00/.test(arg)) {
        throw new UnsafeShellOptionsError('shellOptions.shellArgs must not contain NUL bytes')
      }
      safeArgs.push(arg)
    }
    result.shellArgs = safeArgs
  }

  return result
}

// Far beyond any real screen; node-pty passes these straight to ioctl/ConPTY.
const MAX_TERMINAL_COLS = 2000
const MAX_TERMINAL_ROWS = 1000

function isGridDimension(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
}

/** A renderer-supplied cols/rows pair, or null when it is not a usable grid size. */
export function parseTerminalSize(cols: unknown, rows: unknown): TerminalSize | null {
  if (!isGridDimension(cols, MAX_TERMINAL_COLS) || !isGridDimension(rows, MAX_TERMINAL_ROWS)) return null
  return { cols, rows }
}

/** The optional initial size of term:create; undefined means "use the pty default". */
export function validateTerminalSize(size: unknown): TerminalSize | undefined {
  if (size === undefined || size === null) return undefined
  if (typeof size !== 'object' || Array.isArray(size)) {
    throw new UnsafeShellOptionsError('size must be an object')
  }
  const { cols, rows } = size as { cols?: unknown; rows?: unknown }
  const parsed = parseTerminalSize(cols, rows)
  if (!parsed) {
    throw new UnsafeShellOptionsError(
      `size must have integer cols (1-${MAX_TERMINAL_COLS}) and rows (1-${MAX_TERMINAL_ROWS})`,
    )
  }
  return parsed
}

/** Terminal ids are renderer-chosen map keys; anything else is ignored. */
export function isTerminalId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128
}
