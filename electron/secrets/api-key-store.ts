/**
 * Provider API keys, kept in the main process and encrypted at rest.
 *
 * Previously the renderer stored every key in plaintext localStorage and sent
 * them to the main process on each start, so any script running in the
 * renderer (or anything that can read the profile directory) could read them.
 * Now:
 *  - keys are encrypted with the OS keychain (Electron `safeStorage`) and
 *    written to `<userData>/api-keys.json`;
 *  - the renderer can set, replace, or remove a key but only ever reads back
 *    whether each provider is configured;
 *  - when OS encryption is unavailable, keys are kept in memory for the
 *    session and never written in plaintext.
 *
 * This module is pure (cipher and file I/O are injected) so it is unit-tested
 * without Electron.
 */

import type { ApiKeyPatch, ApiKeyProvider } from '../../shared/ipc-contract'

export type { ApiKeyPatch, ApiKeyProvider }
export type ApiKeyConfigured = Record<ApiKeyProvider, boolean>

import { API_KEY_PROVIDERS } from '../../shared/api-key-providers'

export { API_KEY_PROVIDERS }

/**
 * Asynchronous OS encryption (Electron safeStorage's async API: the
 * synchronous methods are deprecated in Electron 45 and removed in 46).
 */
export interface SecretCipher {
  isAvailable(): Promise<boolean>
  encrypt(plainText: string): Promise<Buffer>
  /** `shouldReEncrypt`: the OS rotated the key or offers a stronger one. */
  decrypt(cipherText: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

export interface KeyFileIO {
  /** Returns the file contents, or null when it does not exist. */
  read(): string | null
  write(contents: string): void
}

export class InvalidApiKeyPatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidApiKeyPatchError'
  }
}

const MAX_KEY_LENGTH = 4096
const PROVIDERS = new Set<string>(API_KEY_PROVIDERS)

/** Validate an untrusted patch from the renderer. Empty strings mean "unchanged". */
export function normalizeApiKeyPatch(raw: unknown): ApiKeyPatch {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvalidApiKeyPatchError('API keys must be an object')
  }
  const patch: ApiKeyPatch = {}
  for (const [provider, value] of Object.entries(raw)) {
    if (!PROVIDERS.has(provider)) {
      throw new InvalidApiKeyPatchError(`Unknown API key provider: ${provider}`)
    }
    if (value === null) {
      patch[provider as ApiKeyProvider] = null
      continue
    }
    if (typeof value !== 'string') {
      throw new InvalidApiKeyPatchError(`API key for ${provider} must be a string or null`)
    }
    const key = value.trim()
    if (!key) continue
    if (key.length > MAX_KEY_LENGTH || /[\s\x00-\x1F\x7F]/.test(key)) {
      throw new InvalidApiKeyPatchError(`API key for ${provider} contains invalid characters`)
    }
    patch[provider as ApiKeyProvider] = key
  }
  return patch
}

interface KeyFile {
  version: 1
  keys: Partial<Record<ApiKeyProvider, string>>
}

export interface ApiKeyStore {
  /** Decrypt the stored keys. Await once before anything reads them. */
  ready(): Promise<void>
  /** Decrypted keys for the AI bridge. Never send this to the renderer. */
  keys(): Partial<Record<ApiKeyProvider, string>>
  configured(): ApiKeyConfigured
  encryptionAvailable(): boolean
  /** Apply a validated patch; `persisted` is false when only kept in memory. */
  update(patch: ApiKeyPatch): Promise<{ persisted: boolean }>
}

export function createApiKeyStore({ cipher, io, onWarning = () => {} }: {
  cipher: SecretCipher
  io: KeyFileIO
  onWarning?: (message: string) => void
}): ApiKeyStore {
  let cache: Partial<Record<ApiKeyProvider, string>> = {}
  let available = false
  let loading: Promise<void> | null = null
  // Writes run one after another, so an older key set never lands last.
  let writes: Promise<unknown> = Promise.resolve()

  const persist = async (keys: Partial<Record<ApiKeyProvider, string>>): Promise<boolean> => {
    if (!available) return false
    const file: KeyFile = { version: 1, keys: {} }
    for (const provider of API_KEY_PROVIDERS) {
      const key = keys[provider]
      if (key) file.keys[provider] = (await cipher.encrypt(key)).toString('base64')
    }
    io.write(JSON.stringify(file, null, 2))
    return true
  }
  const queuePersist = (keys: Partial<Record<ApiKeyProvider, string>>): Promise<boolean> => {
    const run = writes.then(() => persist(keys))
    writes = run.catch(() => {})
    return run
  }

  const load = async (): Promise<void> => {
    available = await cipher.isAvailable().catch(() => false)
    let contents: string | null = null
    try {
      contents = io.read()
    } catch (err) {
      onWarning(`Could not read stored API keys: ${(err as Error).message}`)
    }
    if (!contents) return
    let parsed: KeyFile
    try {
      parsed = JSON.parse(contents)
    } catch {
      onWarning('Stored API keys are not valid JSON; ignoring them')
      return
    }
    if (!available) {
      onWarning('OS encryption is unavailable; stored API keys cannot be decrypted this session')
      return
    }
    let reEncrypt = false
    for (const provider of API_KEY_PROVIDERS) {
      const encoded = parsed?.keys?.[provider]
      if (typeof encoded !== 'string') continue
      try {
        const { result, shouldReEncrypt } = await cipher.decrypt(Buffer.from(encoded, 'base64'))
        cache[provider] = result
        reEncrypt ||= shouldReEncrypt
      } catch {
        onWarning(`Stored ${provider} API key could not be decrypted; ignoring it`)
      }
    }
    if (reEncrypt) {
      await queuePersist({ ...cache }).catch((err) => onWarning(`Could not re-encrypt stored API keys: ${(err as Error).message}`))
    }
  }

  return {
    ready: () => (loading ??= load()),
    keys: () => ({ ...cache }),
    configured: () =>
      Object.fromEntries(API_KEY_PROVIDERS.map((provider) => [provider, Boolean(cache[provider])])) as ApiKeyConfigured,
    encryptionAvailable: () => available,
    update: async (patch) => {
      await (loading ??= load())
      const next = { ...cache }
      for (const provider of API_KEY_PROVIDERS) {
        if (!(provider in patch)) continue
        const value = patch[provider]
        if (value === null || value === undefined) delete next[provider]
        else next[provider] = value
      }
      cache = next
      return { persisted: await queuePersist(next) }
    },
  }
}
