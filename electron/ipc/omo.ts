import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { startOmo, sendToOmo, stopOmo, setApiKeys, setPrompts } from '../omo-bridge/bridge'
import { handle, listen, emit } from './typed-ipc'
import { getApiKeyStore } from '../secrets'
import { normalizeApiKeyPatch } from '../secrets/api-key-store'

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

  // API keys live encrypted in the main process (see secrets/api-key-store).
  // Load the persisted ones into the bridge now; the app is ready here.
  setApiKeys(getApiKeyStore().keys() as Record<string, string>)

  handle('omo:set-api-keys', async (_event, rawPatch: unknown) => {
    try {
      const store = getApiKeyStore()
      const { persisted } = store.update(normalizeApiKeyPatch(rawPatch))
      setApiKeys(store.keys() as Record<string, string>)
      return { success: true, persisted, configured: store.configured(), encryptionAvailable: store.encryptionAvailable() }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // The renderer only ever learns which providers are configured.
  handle('omo:get-api-key-status', () => {
    const store = getApiKeyStore()
    return { configured: store.configured(), encryptionAvailable: store.encryptionAvailable() }
  })

  handle('omo:set-prompts', async (_event, prompts: { systemPrompt?: string; userPromptTemplate?: string }) => {
    setPrompts(prompts)
    return { success: true }
  })
}
