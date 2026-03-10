import type { IpcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type { AppSettings } from '../../shared/types'

let store: any = null

async function getStore() {
  if (!store) {
    const Store = (await import('electron-store')).default
    store = new Store<AppSettings>({
      name: 'orion-settings',
      defaults: {
        theme: 'dark',
        fontSize: 14,
        fontFamily: 'Cascadia Code, Fira Code, Consolas, monospace',
        models: [],
        activeModelId: '',
        agentModelMapping: {},
      },
    })
  }
  return store
}

export function registerSettingsHandlers(ipcMain: IpcMain) {
  ipcMain.handle(IPC.SETTINGS_GET, async () => {
    const s = await getStore()
    return s.store
  })

  ipcMain.handle(IPC.SETTINGS_SET, async (_event, settings: Partial<AppSettings>) => {
    const s = await getStore()
    for (const [key, value] of Object.entries(settings)) {
      s.set(key, value)
    }
    return s.store
  })
}
