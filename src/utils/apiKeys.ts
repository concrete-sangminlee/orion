import type { ApiKeyPatch, ApiKeyProvider } from '@shared/ipc-contract'
import { isApiKeyProvider } from '@shared/api-key-providers'
import { ipcErrorMessage } from './ipcResult'

/** Where versions before encrypted storage kept provider keys in plaintext. */
export const LEGACY_API_KEYS_STORAGE_KEY = 'orion-api-keys'

/**
 * Non-empty string entries of a parsed legacy key object, for known providers
 * only: one unknown name would make the main process reject the whole patch,
 * leaving every plaintext key behind.
 */
export function legacyKeysToPatch(raw: unknown): ApiKeyPatch {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const patch: ApiKeyPatch = {}
  for (const [provider, value] of Object.entries(raw)) {
    if (isApiKeyProvider(provider) && typeof value === 'string' && value.trim()) patch[provider] = value.trim()
  }
  return patch
}

/**
 * Move plaintext keys from localStorage into the main process's encrypted
 * store, then delete the plaintext copy. When the main process could only
 * keep them in memory (no OS encryption), the copy is left so the keys still
 * work after a restart, exactly as before.
 */
export async function migrateLegacyApiKeys(storage: Storage = localStorage): Promise<'none' | 'migrated' | 'kept'> {
  let raw: string | null
  try {
    raw = storage.getItem(LEGACY_API_KEYS_STORAGE_KEY)
  } catch {
    return 'none'
  }
  if (!raw) return 'none'

  let patch: ApiKeyPatch = {}
  try {
    patch = legacyKeysToPatch(JSON.parse(raw))
  } catch {
    // Unreadable leftovers are dropped below.
  }

  if (Object.keys(patch).length > 0) {
    const result = await window.api.omoSetApiKeys(patch).catch(() => null)
    if (!result?.success || !result.persisted) return 'kept'
  }
  storage.removeItem(LEGACY_API_KEYS_STORAGE_KEY)
  return 'migrated'
}

/** Invisible characters a key copied from a web page or PDF can carry; no key contains them. */
const INVISIBLE_KEY_CHARS = /[\u00A0\u200B-\u200D\u2060\uFEFF]/g

/** A pasted key without surrounding whitespace or invisible characters. */
export function cleanApiKeyInput(value: string): string {
  return value.replace(INVISIBLE_KEY_CHARS, '').trim()
}

/**
 * Save each typed key in its own request: the main process rejects a whole
 * patch for one bad key, which would drop every other key typed with it.
 * Resolves to the reason for each provider whose key was not saved.
 */
export async function saveApiKeys(keys: Record<string, string>): Promise<Partial<Record<ApiKeyProvider, string>>> {
  const errors: Partial<Record<ApiKeyProvider, string>> = {}
  for (const [provider, value] of Object.entries(keys)) {
    const key = cleanApiKeyInput(value)
    if (!key || !isApiKeyProvider(provider)) continue
    try {
      const result = await window.api.omoSetApiKeys({ [provider]: key })
      if (!result?.success) errors[provider] = result?.error || 'The key was not saved'
    } catch (err) {
      errors[provider] = ipcErrorMessage(err)
    }
  }
  return errors
}
