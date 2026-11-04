import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { createTerminal, writeToTerminal, resizeTerminal, killTerminal } from '../terminal/manager'
import { validateShellOptions } from './terminal-options-guard'
import { handle, listen, emit } from './typed-ipc'

export function registerTerminalHandlers(getWindow: () => BrowserWindow | null) {
  handle(IPC.TERM_CREATE, async (_event, id: string, shellOptions?: unknown) => {
    let safeOptions
    try {
      safeOptions = validateShellOptions(shellOptions)
    } catch (err: any) {
      return { success: false, error: err.message }
    }
    return await createTerminal(id, (data) => {
      emit(getWindow(), IPC.TERM_DATA, id, data)
    }, safeOptions)
  })

  listen(IPC.TERM_WRITE, (_event, id: string, data: string) => {
    writeToTerminal(id, data)
  })

  listen(IPC.TERM_RESIZE, (_event, id: string, cols: number, rows: number) => {
    resizeTerminal(id, cols, rows)
  })

  listen(IPC.TERM_KILL, (_event, id: string) => {
    killTerminal(id)
  })
}
