import type { IpcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { startOmo, sendToOmo, stopOmo, setApiKeys, setPrompts } from '../omo-bridge/bridge'

export function registerOmoHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null) {
  ipcMain.handle(IPC.OMO_START, async (_event, projectPath: string) => {
    await startOmo(projectPath, (event) => {
      getWindow()?.webContents.send(IPC.OMO_MESSAGE, event)
    })
  })

  ipcMain.handle(IPC.OMO_STOP, async () => {
    stopOmo()
  })

  ipcMain.on(IPC.OMO_SEND, (_event, message) => {
    sendToOmo(message)
  })

  // API keys management
  ipcMain.handle('omo:set-api-keys', async (_event, keys: Record<string, string>) => {
    setApiKeys(keys)
    return { success: true }
  })

  ipcMain.handle('omo:set-prompts', async (_event, prompts: { systemPrompt?: string; userPromptTemplate?: string }) => {
    setPrompts(prompts)
    return { success: true }
  })
}
