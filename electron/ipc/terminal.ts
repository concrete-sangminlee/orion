import type { WebContents } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import {
  createTerminal,
  writeToTerminal,
  resizeTerminal,
  killTerminal,
  killTerminalsOwnedBy,
} from '../terminal/manager'
import { isTerminalId, parseTerminalSize, validateShellOptions, validateTerminalSize } from './terminal-options-guard'
import { handle, listen, emit } from './typed-ipc'

// Windows whose 'destroyed' hook is already installed (one listener each).
const watchedSenders = new Set<number>()

/** Kill a window's shells when it closes, instead of leaving them running headless. */
function killTerminalsWhenDestroyed(sender: WebContents) {
  if (watchedSenders.has(sender.id)) return
  watchedSenders.add(sender.id)
  const ownerId = sender.id
  sender.once('destroyed', () => {
    watchedSenders.delete(ownerId)
    killTerminalsOwnedBy(ownerId)
  })
}

export function registerTerminalHandlers() {
  handle(IPC.TERM_CREATE, async (event, id: unknown, shellOptions?: unknown, size?: unknown) => {
    if (!isTerminalId(id)) return { success: false, error: 'Invalid terminal id' }
    let safeOptions
    let safeSize
    try {
      safeOptions = validateShellOptions(shellOptions)
      safeSize = validateTerminalSize(size)
    } catch (err: any) {
      return { success: false, error: err.message }
    }
    killTerminalsWhenDestroyed(event.sender)
    // Output goes to the window that created the shell.
    const owner = event.sender
    return await createTerminal(id, {
      onData: (data) => emit(owner, IPC.TERM_DATA, id, data),
      onExit: (exitCode) => emit(owner, IPC.TERM_EXIT, id, exitCode),
    }, safeOptions, safeSize, owner.id)
  })

  listen(IPC.TERM_WRITE, (_event, id: unknown, data: unknown) => {
    if (isTerminalId(id) && typeof data === 'string') writeToTerminal(id, data)
  })

  listen(IPC.TERM_RESIZE, (_event, id: unknown, cols: unknown, rows: unknown) => {
    const size = parseTerminalSize(cols, rows)
    if (isTerminalId(id) && size) resizeTerminal(id, size.cols, size.rows)
  })

  listen(IPC.TERM_KILL, (_event, id: unknown) => {
    if (isTerminalId(id)) killTerminal(id)
  })
}
