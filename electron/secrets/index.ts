import { app, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import { createApiKeyStore, type ApiKeyStore } from './api-key-store'

let store: ApiKeyStore | null = null

/**
 * The process-wide API key store, backed by Electron safeStorage (macOS
 * Keychain, Windows DPAPI, libsecret/kwallet on Linux). On Linux without a
 * keyring, safeStorage falls back to its "basic_text" backend, which only
 * obfuscates; keys still never reach the renderer.
 *
 * Call after app 'ready' (safeStorage is unavailable before it).
 */
export function getApiKeyStore(): ApiKeyStore {
  if (store) return store
  const file = path.join(app.getPath('userData'), 'api-keys.json')
  store = createApiKeyStore({
    cipher: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plainText) => safeStorage.encryptString(plainText),
      decrypt: (cipherText) => safeStorage.decryptString(cipherText),
    },
    io: {
      read: () => {
        try {
          return fs.readFileSync(file, 'utf8')
        } catch (err: any) {
          if (err?.code === 'ENOENT') return null
          throw err
        }
      },
      write: (contents) => {
        // Write-then-rename so a crash never leaves a truncated key file.
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const temp = `${file}.${process.pid}.tmp`
        fs.writeFileSync(temp, contents, { mode: 0o600 })
        fs.renameSync(temp, file)
      },
    },
    onWarning: (message) => console.warn('[Secrets]', message),
  })
  return store
}
