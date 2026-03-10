import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'

const api = {
  // Filesystem
  readFile: (filePath: string) => ipcRenderer.invoke(IPC.FS_READ_FILE, filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke(IPC.FS_WRITE_FILE, filePath, content),
  deleteFile: (filePath: string) => ipcRenderer.invoke(IPC.FS_DELETE, filePath),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke(IPC.FS_RENAME, oldPath, newPath),
  readDir: (dirPath: string) => ipcRenderer.invoke(IPC.FS_READ_DIR, dirPath),
  openFolder: () => ipcRenderer.invoke(IPC.FS_OPEN_FOLDER),
  watchStart: (dirPath: string) => ipcRenderer.send(IPC.FS_WATCH_START, dirPath),
  watchStop: () => ipcRenderer.send(IPC.FS_WATCH_STOP),
  onFsChange: (callback: (event: string, filePath: string) => void) => {
    const handler = (_: unknown, event: string, filePath: string) => callback(event, filePath)
    ipcRenderer.on(IPC.FS_CHANGE, handler)
    return () => ipcRenderer.removeListener(IPC.FS_CHANGE, handler)
  },

  // Terminal
  termCreate: (id: string) => ipcRenderer.invoke(IPC.TERM_CREATE, id),
  termWrite: (id: string, data: string) => ipcRenderer.send(IPC.TERM_WRITE, id, data),
  termResize: (id: string, cols: number, rows: number) => ipcRenderer.send(IPC.TERM_RESIZE, id, cols, rows),
  termKill: (id: string) => ipcRenderer.send(IPC.TERM_KILL, id),
  onTermData: (callback: (id: string, data: string) => void) => {
    const handler = (_: unknown, id: string, data: string) => callback(id, data)
    ipcRenderer.on(IPC.TERM_DATA, handler)
    return () => ipcRenderer.removeListener(IPC.TERM_DATA, handler)
  },

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (settings: unknown) => ipcRenderer.invoke(IPC.SETTINGS_SET, settings),

  // OMO
  omoStart: (projectPath: string) => ipcRenderer.invoke(IPC.OMO_START, projectPath),
  omoStop: () => ipcRenderer.invoke(IPC.OMO_STOP),
  omoSend: (message: unknown) => ipcRenderer.send(IPC.OMO_SEND, message),
  omoSetApiKeys: (keys: Record<string, string>) => ipcRenderer.invoke('omo:set-api-keys', keys),
  omoSetPrompts: (prompts: { systemPrompt?: string; userPromptTemplate?: string }) => ipcRenderer.invoke('omo:set-prompts', prompts),
  onOmoMessage: (callback: (message: unknown) => void) => {
    const handler = (_: unknown, message: unknown) => callback(message)
    ipcRenderer.on(IPC.OMO_MESSAGE, handler)
    return () => ipcRenderer.removeListener(IPC.OMO_MESSAGE, handler)
  },

  // Window
  minimize: () => ipcRenderer.send(IPC.WIN_MINIMIZE),
  maximize: () => ipcRenderer.send(IPC.WIN_MAXIMIZE),
  close: () => ipcRenderer.send(IPC.WIN_CLOSE),
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
