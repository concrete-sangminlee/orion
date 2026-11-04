import { contextBridge, ipcRenderer } from 'electron'
import { createElectronApi } from './preload-api'

// The API surface lives in ./preload-api so it can be unit-tested with a fake
// ipcRenderer and so the renderer can derive `window.api`'s type from it.
contextBridge.exposeInMainWorld('api', createElectronApi(ipcRenderer))

export type { ElectronAPI } from './preload-api'
