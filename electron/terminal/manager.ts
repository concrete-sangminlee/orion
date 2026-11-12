import os from 'os'
import { createRequire } from 'module'
import path from 'path'
import type { TerminalSize } from '../../shared/ipc-contract'
import { getProjectPath } from '../workspace/project-path'

interface PtyProcess {
  onData: (callback: (data: string) => void) => void
  onExit: (callback: (event: { exitCode: number; signal?: number }) => void) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
}

export interface ShellOptions {
  shellPath?: string
  shellArgs?: string[]
}

export interface TerminalCallbacks {
  onData: (data: string) => void
  /** The shell exited by itself. Not called for killTerminal/killAllTerminals. */
  onExit: (exitCode: number) => void
}

interface TerminalEntry {
  pty: PtyProcess
  /** webContents id of the window that created the terminal. */
  ownerId?: number
}

const terminals = new Map<string, TerminalEntry>()

function detectShell(): string {
  if (process.platform === 'win32') {
    return 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

// node-pty is a native CommonJS addon kept external to the ES-module main
// bundle, where a bare `require` is not defined.
const require = createRequire(import.meta.url)

function loadNodePty() {
  try {
    return require('node-pty')
  } catch {
    const modulePath = path.join(process.cwd(), 'node_modules', 'node-pty')
    return require(modulePath)
  }
}

export async function createTerminal(
  id: string,
  callbacks: TerminalCallbacks,
  shellOptions?: ShellOptions,
  size?: TerminalSize,
  ownerId?: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const pty = loadNodePty()

    const shell = shellOptions?.shellPath || detectShell()
    const args = shellOptions?.shellArgs || []
    const cwd = getProjectPath() || os.homedir()
    const term: PtyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      // Start at the size of the view so the shell does not lay out its
      // first prompt for 80x24 while xterm shows something else.
      cols: size?.cols ?? 80,
      rows: size?.rows ?? 24,
      cwd,
      env: process.env as Record<string, string>,
      useConpty: false,
    })

    // Re-creating an id (a remounted view) must not orphan the old shell.
    killTerminal(id)

    term.onData(callbacks.onData)
    term.onExit(({ exitCode }) => {
      // A killed or replaced pty is no longer in the map: stay silent so the
      // view now using this id is not told its shell died.
      if (terminals.get(id)?.pty !== term) return
      terminals.delete(id)
      callbacks.onExit(exitCode)
    })
    terminals.set(id, { pty: term, ownerId })
    return { success: true }
  } catch (err: any) {
    console.error('Failed to create terminal:', err.message)
    return { success: false, error: err.message }
  }
}

export function writeToTerminal(id: string, data: string) {
  terminals.get(id)?.pty.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number) {
  try {
    terminals.get(id)?.pty.resize(cols, rows)
  } catch (err: any) {
    // The shell can exit between the renderer's resize and this call.
    console.warn(`Failed to resize terminal ${id}:`, err.message)
  }
}

export function killTerminal(id: string) {
  const entry = terminals.get(id)
  if (!entry) return
  // Remove first so the pty's exit callback sees it was killed on purpose.
  terminals.delete(id)
  entry.pty.kill()
}

/** Kill the terminals a window created, when that window goes away. */
export function killTerminalsOwnedBy(ownerId: number) {
  for (const [id, entry] of terminals) {
    if (entry.ownerId === ownerId) killTerminal(id)
  }
}

/** Kill every shell; call before the app quits so none outlive it. */
export function killAllTerminals() {
  for (const id of [...terminals.keys()]) killTerminal(id)
}
