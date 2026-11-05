import { afterEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_API_KEYS_STORAGE_KEY, legacyKeysToPatch, migrateLegacyApiKeys } from './apiKeys'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key) },
    setItem: (key, value) => { data.set(key, String(value)) },
  }
}

function stubApi(result: unknown) {
  const omoSetApiKeys = vi.fn(async () => result)
  vi.stubGlobal('window', { api: { omoSetApiKeys } })
  return omoSetApiKeys
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('legacyKeysToPatch', () => {
  it('keeps only non-empty string keys, trimmed', () => {
    expect(legacyKeysToPatch({ anthropic: ' sk-ant-EXAMPLE ', openai: '', kimi: 42, gemini: null })).toEqual({
      anthropic: 'sk-ant-EXAMPLE',
    })
  })

  it('drops unknown providers so they cannot block the migration', () => {
    expect(legacyKeysToPatch({ anthropic: 'sk-ant-EXAMPLE', custom: 'c-EXAMPLE', someday: 'x' })).toEqual({
      anthropic: 'sk-ant-EXAMPLE',
      custom: 'c-EXAMPLE',
    })
  })

  it('ignores non-object input', () => {
    expect(legacyKeysToPatch('sk-ant')).toEqual({})
    expect(legacyKeysToPatch(['x'])).toEqual({})
  })
})

describe('migrateLegacyApiKeys', () => {
  it('hands plaintext keys to the main process and deletes them once persisted', async () => {
    const storage = memoryStorage({ [LEGACY_API_KEYS_STORAGE_KEY]: JSON.stringify({ anthropic: 'sk-ant-EXAMPLE', openai: '' }) })
    const setKeys = stubApi({ success: true, persisted: true })
    await expect(migrateLegacyApiKeys(storage)).resolves.toBe('migrated')
    // Empty legacy entries must not be sent: they would be no-ops at best.
    expect(setKeys).toHaveBeenCalledWith({ anthropic: 'sk-ant-EXAMPLE' })
    expect(storage.getItem(LEGACY_API_KEYS_STORAGE_KEY)).toBeNull()
  })

  it('keeps the plaintext copy when the main process could not persist (no OS encryption)', async () => {
    const storage = memoryStorage({ [LEGACY_API_KEYS_STORAGE_KEY]: JSON.stringify({ anthropic: 'sk-ant-EXAMPLE' }) })
    stubApi({ success: true, persisted: false })
    await expect(migrateLegacyApiKeys(storage)).resolves.toBe('kept')
    expect(storage.getItem(LEGACY_API_KEYS_STORAGE_KEY)).not.toBeNull()
  })

  it('keeps the plaintext copy when the IPC call fails', async () => {
    const storage = memoryStorage({ [LEGACY_API_KEYS_STORAGE_KEY]: JSON.stringify({ anthropic: 'sk-ant-EXAMPLE' }) })
    vi.stubGlobal('window', { api: { omoSetApiKeys: vi.fn(async () => { throw new Error('ipc down') }) } })
    await expect(migrateLegacyApiKeys(storage)).resolves.toBe('kept')
    expect(storage.getItem(LEGACY_API_KEYS_STORAGE_KEY)).not.toBeNull()
  })

  it('drops an entry that holds no keys or is unreadable', async () => {
    const setKeys = stubApi({ success: true, persisted: true })
    const empty = memoryStorage({ [LEGACY_API_KEYS_STORAGE_KEY]: JSON.stringify({ anthropic: '', openai: '' }) })
    await expect(migrateLegacyApiKeys(empty)).resolves.toBe('migrated')
    const corrupt = memoryStorage({ [LEGACY_API_KEYS_STORAGE_KEY]: '{not json' })
    await expect(migrateLegacyApiKeys(corrupt)).resolves.toBe('migrated')
    expect(setKeys).not.toHaveBeenCalled()
    expect(empty.getItem(LEGACY_API_KEYS_STORAGE_KEY)).toBeNull()
    expect(corrupt.getItem(LEGACY_API_KEYS_STORAGE_KEY)).toBeNull()
  })

  it('does nothing when there is no legacy entry', async () => {
    const setKeys = stubApi({ success: true, persisted: true })
    await expect(migrateLegacyApiKeys(memoryStorage())).resolves.toBe('none')
    expect(setKeys).not.toHaveBeenCalled()
  })
})
