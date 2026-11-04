import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { startOmo, sendToOmo, stopOmo, setApiKeys, setPrompts } from '../omo-bridge/bridge'
import { handle, listen, emit } from './typed-ipc'

export function registerOmoHandlers(getWindow: () => BrowserWindow | null) {
  handle(IPC.OMO_START, async () => {
    await startOmo((event) => {
      emit(getWindow(), IPC.OMO_MESSAGE, event)
    })
  })

  handle(IPC.OMO_STOP, async () => {
    stopOmo()
  })

  listen(IPC.OMO_SEND, (_event, message) => {
    sendToOmo(message)
  })

  // API keys management
  handle('omo:set-api-keys', async (_event, keys: Record<string, string>) => {
    setApiKeys(keys)
    return { success: true }
  })

  handle('omo:set-prompts', async (_event, prompts: { systemPrompt?: string; userPromptTemplate?: string }) => {
    setPrompts(prompts)
    return { success: true }
  })
}
