import { describe, expect, it } from 'vitest'
import { createApiKeyStore, InvalidApiKeyPatchError, normalizeApiKeyPatch, type SecretCipher } from './api-key-store'

const fakeEncrypt = (plain: string) => Buffer.from(`enc:${Buffer.from(plain).toString('hex')}`)

/** Reversible stand-in for safeStorage's async API that makes plaintext leaks visible. */
function fakeCipher(available = true, { rotated = false } = {}): SecretCipher & { encrypted: string[] } {
  const encrypted: string[] = []
  return {
    encrypted,
    isAvailable: async () => available,
    encrypt: async (plain) => {
      encrypted.push(plain)
      return fakeEncrypt(plain)
    },
    decrypt: async (data) => {
      const text = data.toString()
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext')
      return { result: Buffer.from(text.slice(4), 'hex').toString(), shouldReEncrypt: rotated }
    },
  }
}

/** A store that has decrypted its file, as the app awaits at startup. */
async function openStore(options: Parameters<typeof createApiKeyStore>[0]) {
  const store = createApiKeyStore(options)
  await store.ready()
  return store
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
  it('persists keys encrypted, never in plaintext', async () => {
    const file = memoryFile()
    const store = await openStore({ cipher: fakeCipher(), io: file })
    expect(await store.update({ anthropic: ANTHROPIC, openai: OPENAI })).toEqual({ persisted: true })
    const written = file.get()!
    expect(written).not.toContain(ANTHROPIC)
    expect(written).not.toContain(OPENAI)
    expect(JSON.parse(written).version).toBe(1)
  })

  it('round-trips through a fresh store (next app start)', async () => {
    const file = memoryFile()
    await (await openStore({ cipher: fakeCipher(), io: file })).update({ anthropic: ANTHROPIC })
    const reopened = await openStore({ cipher: fakeCipher(), io: file })
    expect(reopened.keys()).toEqual({ anthropic: ANTHROPIC })
    expect(reopened.configured()).toEqual({ anthropic: true, openai: false, kimi: false, gemini: false, nvidia: false, custom: false })
  })

  it('merges patches: omitted providers stay, null removes', async () => {
    const file = memoryFile()
    const store = await openStore({ cipher: fakeCipher(), io: file })
    await store.update({ anthropic: ANTHROPIC, openai: OPENAI })
    await store.update({ openai: null })
    await store.update({ kimi: 'kimi-EXAMPLE' })
    expect((await openStore({ cipher: fakeCipher(), io: file })).keys()).toEqual({ anthropic: ANTHROPIC, kimi: 'kimi-EXAMPLE' })
  })

  it('writes updates in the order they were made, so an older key set never lands last', async () => {
    const file = memoryFile()
    const cipher = fakeCipher()
    const encryptNow = cipher.encrypt
    // The first key set takes longer to encrypt than the second.
    cipher.encrypt = async (plain) => {
      if (plain === ANTHROPIC) await new Promise((resolve) => setTimeout(resolve, 20))
      return encryptNow(plain)
    }
    const store = await openStore({ cipher, io: file })
    await Promise.all([store.update({ anthropic: ANTHROPIC }), store.update({ anthropic: null, openai: OPENAI })])
    expect((await openStore({ cipher: fakeCipher(), io: file })).keys()).toEqual({ openai: OPENAI })
  })

  it('re-encrypts the stored keys when the OS rotated its key', async () => {
    const file = memoryFile(JSON.stringify({ version: 1, keys: { anthropic: fakeEncrypt(ANTHROPIC).toString('base64') } }))
    const cipher = fakeCipher(true, { rotated: true })
    const store = await openStore({ cipher, io: file })
    expect(store.keys()).toEqual({ anthropic: ANTHROPIC })
    expect(cipher.encrypted).toEqual([ANTHROPIC])
  })

  it('keeps keys only in memory when OS encryption is unavailable', async () => {
    const file = memoryFile()
    const store = await openStore({ cipher: fakeCipher(false), io: file })
    expect(await store.update({ anthropic: ANTHROPIC })).toEqual({ persisted: false })
    expect(store.keys()).toEqual({ anthropic: ANTHROPIC })
    expect(file.get()).toBeNull()
  })

  it('ignores a corrupted file or entry instead of crashing startup', async () => {
    const warnings: string[] = []
    const corruptJson = await openStore({ cipher: fakeCipher(), io: memoryFile('{not json'), onWarning: (m) => warnings.push(m) })
    expect(corruptJson.keys()).toEqual({})

    const badEntry = memoryFile(JSON.stringify({ version: 1, keys: { anthropic: Buffer.from('garbage').toString('base64') } }))
    const store = await openStore({ cipher: fakeCipher(), io: badEntry, onWarning: (m) => warnings.push(m) })
    expect(store.keys()).toEqual({})
    expect(warnings.length).toBe(2)
  })

  it('ignores providers in the file that are not on the allowlist', async () => {
    const file = memoryFile(
      JSON.stringify({ version: 1, keys: { evil: fakeEncrypt('x').toString('base64'), anthropic: fakeEncrypt(ANTHROPIC).toString('base64') } }),
    )
    expect((await openStore({ cipher: fakeCipher(), io: file })).keys()).toEqual({ anthropic: ANTHROPIC })
  })
})
