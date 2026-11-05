import { describe, expect, it } from 'vitest'
import { createApiKeyStore, InvalidApiKeyPatchError, normalizeApiKeyPatch, type SecretCipher } from './api-key-store'

/** Reversible stand-in for safeStorage that makes plaintext leaks visible. */
function fakeCipher(available = true): SecretCipher & { encrypted: string[] } {
  const encrypted: string[] = []
  return {
    encrypted,
    isAvailable: () => available,
    encrypt: (plain) => {
      encrypted.push(plain)
      return Buffer.from(`enc:${Buffer.from(plain).toString('hex')}`)
    },
    decrypt: (data) => {
      const text = data.toString()
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext')
      return Buffer.from(text.slice(4), 'hex').toString()
    },
  }
}

function memoryFile(initial: string | null = null) {
  let contents = initial
  return { read: () => contents, write: (next: string) => { contents = next }, get: () => contents }
}

const ANTHROPIC = 'sk-ant-api03-EXAMPLE-not-a-real-key'
const OPENAI = 'sk-proj-EXAMPLE-not-a-real-key'

describe('normalizeApiKeyPatch', () => {
  it('trims keys, keeps null as removal, and treats empty strings as unchanged', () => {
    expect(normalizeApiKeyPatch({ anthropic: `  ${ANTHROPIC}\n`, openai: null, kimi: '' })).toEqual({
      anthropic: ANTHROPIC,
      openai: null,
    })
  })

  it.each([
    [null],
    [[]],
    ['sk-ant'],
    [{ unknown: 'x' }],
    [{ anthropic: 42 }],
    [{ anthropic: 'has space inside' }],
    [{ anthropic: 'nul\u0000byte' }],
    [{ anthropic: 'x'.repeat(5000) }],
  ])('rejects %j', (raw) => {
    expect(() => normalizeApiKeyPatch(raw)).toThrow(InvalidApiKeyPatchError)
  })
})

describe('createApiKeyStore', () => {
  it('persists keys encrypted, never in plaintext', () => {
    const file = memoryFile()
    const store = createApiKeyStore({ cipher: fakeCipher(), io: file })
    expect(store.update({ anthropic: ANTHROPIC, openai: OPENAI })).toEqual({ persisted: true })
    const written = file.get()!
    expect(written).not.toContain(ANTHROPIC)
    expect(written).not.toContain(OPENAI)
    expect(JSON.parse(written).version).toBe(1)
  })

  it('round-trips through a fresh store (next app start)', () => {
    const file = memoryFile()
    createApiKeyStore({ cipher: fakeCipher(), io: file }).update({ anthropic: ANTHROPIC })
    const reopened = createApiKeyStore({ cipher: fakeCipher(), io: file })
    expect(reopened.keys()).toEqual({ anthropic: ANTHROPIC })
    expect(reopened.configured()).toEqual({ anthropic: true, openai: false, kimi: false, gemini: false, nvidia: false, custom: false })
  })

  it('merges patches: omitted providers stay, null removes', () => {
    const file = memoryFile()
    const store = createApiKeyStore({ cipher: fakeCipher(), io: file })
    store.update({ anthropic: ANTHROPIC, openai: OPENAI })
    store.update({ openai: null })
    store.update({ kimi: 'kimi-EXAMPLE' })
    expect(createApiKeyStore({ cipher: fakeCipher(), io: file }).keys()).toEqual({ anthropic: ANTHROPIC, kimi: 'kimi-EXAMPLE' })
  })

  it('keeps keys only in memory when OS encryption is unavailable', () => {
    const file = memoryFile()
    const store = createApiKeyStore({ cipher: fakeCipher(false), io: file })
    expect(store.update({ anthropic: ANTHROPIC })).toEqual({ persisted: false })
    expect(store.keys()).toEqual({ anthropic: ANTHROPIC })
    expect(file.get()).toBeNull()
  })

  it('ignores a corrupted file or entry instead of crashing startup', () => {
    const warnings: string[] = []
    const corruptJson = createApiKeyStore({ cipher: fakeCipher(), io: memoryFile('{not json'), onWarning: (m) => warnings.push(m) })
    expect(corruptJson.keys()).toEqual({})

    const badEntry = memoryFile(JSON.stringify({ version: 1, keys: { anthropic: Buffer.from('garbage').toString('base64') } }))
    const store = createApiKeyStore({ cipher: fakeCipher(), io: badEntry, onWarning: (m) => warnings.push(m) })
    expect(store.keys()).toEqual({})
    expect(warnings.length).toBe(2)
  })

  it('ignores providers in the file that are not on the allowlist', () => {
    const cipher = fakeCipher()
    const file = memoryFile(
      JSON.stringify({ version: 1, keys: { evil: cipher.encrypt('x').toString('base64'), anthropic: cipher.encrypt(ANTHROPIC).toString('base64') } }),
    )
    expect(createApiKeyStore({ cipher, io: file }).keys()).toEqual({ anthropic: ANTHROPIC })
  })
})
