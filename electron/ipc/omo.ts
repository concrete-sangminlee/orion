import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { startOmo, sendToOmo, stopOmo, setApiKeys, setPrompts } from '../omo-bridge/bridge'
import { handle, listen, emit } from './typed-ipc'
import { getApiKeyStore } from '../secrets'
import { normalizeApiKeyPatch } from '../secrets/api-key-store'
import { createInlineCompleter } from '../ai/inline-completion'

/** Ollama's own OLLAMA_HOST variable: "host:port" or a full URL. */
export function ollamaHostFromEnv(value: string | undefined): string | undefined {
  const host = value?.trim()
  if (!host) return undefined
  return /^https?:\/\//i.test(host) ? host : `http://${host}`
}

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

  // Inline (ghost text) completion. The renderer names the provider the user
  // chose in Settings; the Anthropic key never leaves the main process.
  const completer = createInlineCompleter({
    fetch: (url, init) => fetch(url, init),
    ollamaHost: ollamaHostFromEnv(process.env.OLLAMA_HOST),
    getAnthropicKey: () => getApiKeyStore().keys().anthropic,
    createAnthropic: async (apiKey) => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      return new Anthropic({ apiKey })
    },
  })
  handle('ai:complete', (_event, request: unknown) => completer.complete(request))

  handle('omo:set-prompts', async (_event, prompts: { systemPrompt?: string; userPromptTemplate?: string }) => {
    setPrompts(prompts)
    return { success: true }
  })
}
