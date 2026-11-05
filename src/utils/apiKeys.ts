import type { ApiKeyPatch } from '@shared/ipc-contract'
import { isApiKeyProvider } from '@shared/api-key-providers'

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
