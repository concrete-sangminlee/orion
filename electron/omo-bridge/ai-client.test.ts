import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  anthropicCtor: vi.fn(),
  anthropicCreate: vi.fn(),
  anthropicStream: vi.fn(),
  openaiCtor: vi.fn(),
  openaiCreate: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: sdk.anthropicCreate, stream: sdk.anthropicStream }
    constructor(opts: unknown) { sdk.anthropicCtor(opts) }
  },
}))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: sdk.openaiCreate } }
    constructor(opts: unknown) { sdk.openaiCtor(opts) }
  },
}))

import {
  GEMINI_OPENAI_BASE_URL,
  MODEL_CATALOG,
  MOONSHOT_BASE_URL,
  NVIDIA_BASE_URL,
  callAI,
  callAIStreaming,
  clearConversationHistory,
  getConversationHistory,
  resolveModel,
} from './ai-client'

const ALL_KEYS = { anthropic: 'sk-ant', openai: 'sk-oai', kimi: 'sk-kimi', gemini: 'gm-key', nvidia: 'nv-key' }

/** Provider/platform words that may appear in a UI name without naming the model. */
const PROVIDER_WORDS = new Set(['nvidia', 'nim'])

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

/** Every word of a UI name (versions included) must appear in the model ID it calls. */
function nameMatchesModel(name: string, model: string): boolean {
  const id = normalize(model)
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(normalize)
    .filter(word => !PROVIDER_WORDS.has(word))
    .every(word => id.includes(word))
}

/** Fake MessageStream: emits `chunks` as text events, then resolves or fails. */
function fakeAnthropicStream(chunks: string[], failWith?: Error) {
  const listeners: Array<(text: string) => void> = []
  return {
    on(event: string, cb: (text: string) => void) {
      if (event === 'text') listeners.push(cb)
      return this
    },
    async finalMessage() {
      for (const chunk of chunks) listeners.forEach(l => l(chunk))
      if (failWith) throw failWith
      return {}
    },
  }
}

function anthropicReply(text: string) {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
}

function openaiReply(text: string) {
  return { choices: [{ message: { content: text } }] }
}

beforeEach(() => {
  Object.values(sdk).forEach(fn => fn.mockReset())
  clearConversationHistory()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

// ─── Label → model honesty ───────────────────────────────────────────────────

describe('resolveModel', () => {
  it.each(Object.entries(MODEL_CATALOG))('"%s" names the model it calls', (name, entry) => {
    expect(nameMatchesModel(name, entry.model), `${name} -> ${entry.model}`).toBe(true)
  })

  it.each([
    ['Claude Opus 5.5', 'anthropic', 'claude-opus-5-5', undefined],
    ['GPT-6.1 Sol', 'openai', 'gpt-6.1-sol', undefined],
    ['Kimi K3.1 Pro', 'openai-compat', 'kimi-k3.1-pro', 'https://api.moonshot.ai/v1'],
    ['Gemini 3.6 Flash', 'openai-compat', 'gemini-3.6-flash', 'https://generativelanguage.googleapis.com/v1beta/openai/'],
  ])('maps "%s" to %s / %s', (name, provider, model, baseURL) => {
    const cfg = resolveModel(name, ALL_KEYS)
    expect(cfg).toMatchObject({ provider, model })
    expect(cfg?.baseURL).toBe(baseURL)
  })

  it('uses the Kimi and Gemini keys with their own endpoints', () => {
    expect(resolveModel('Kimi K3.1 Pro', ALL_KEYS)).toEqual({
      provider: 'openai-compat', apiKey: 'sk-kimi', model: 'kimi-k3.1-pro', baseURL: MOONSHOT_BASE_URL,
    })
    expect(resolveModel('Gemini 3.6 Flash', ALL_KEYS)).toEqual({
      provider: 'openai-compat', apiKey: 'gm-key', model: 'gemini-3.6-flash', baseURL: GEMINI_OPENAI_BASE_URL,
    })
  })

  it('gives every non-OpenAI OpenAI-compatible provider a base URL', () => {
    for (const [name, entry] of Object.entries(MODEL_CATALOG)) {
      if (entry.provider === 'openai-compat' || entry.provider === 'nvidia') {
        expect(entry.baseURL, name).toMatch(/^https:\/\//)
        expect(entry.baseURL, name).not.toContain('api.openai.com')
      }
    }
    expect(MODEL_CATALOG['NVIDIA Llama'].baseURL).toBe(NVIDIA_BASE_URL)
  })

  it('no longer accepts the old mislabeled names', () => {
    expect(resolveModel('Claude Opus', ALL_KEYS)).toBeNull()
    expect(resolveModel('GPT-5.3', ALL_KEYS)).toBeNull()
    expect(resolveModel('Kimi K2.5', ALL_KEYS)).toBeNull()
  })

  it('returns null without the provider key or for unknown names', () => {
    expect(resolveModel('Claude Opus 5.5', {})).toBeNull()
    expect(resolveModel('Gemini 3.6 Flash', { kimi: 'x' })).toBeNull()
    expect(resolveModel('toString', ALL_KEYS)).toBeNull()
  })

  it('maps Ollama to the local endpoint without a key', () => {
    expect(resolveModel('Ollama', {})).toEqual({
      provider: 'ollama', apiKey: 'ollama', model: 'llama3.2', baseURL: 'http://localhost:11434/v1',
    })
  })
})

describe('renderer model selector', () => {
  const source = readFileSync(new URL('../../src/panels/ChatPanel.tsx', import.meta.url), 'utf-8')
  const listBody = (name: string) => {
    const match = new RegExp(`const ${name}: ModelDef\\[\\] = \\[([\\s\\S]*?)\\n\\]`).exec(source)
    if (!match) throw new Error(`${name} not found in ChatPanel.tsx`)
    return match[1]
  }
  const entries = (name: string) =>
    [...listBody(name).matchAll(/\{\s*id: '([^']+)', label: '([^']+)',[^}]*?badge: '([^']+)'/g)]
      .map(([, id, label, badge]) => ({ id, label, badge }))

  it('only offers names the bridge can resolve', () => {
    const ids = [...entries('apiModels'), ...entries('nvidiaModels')].map(e => e.id)
    expect(ids.length).toBeGreaterThanOrEqual(8)
    for (const id of ids) expect(MODEL_CATALOG, id).toHaveProperty([id])
  })

  it('shows a label and badge that match the model called', () => {
    for (const { id, label, badge } of entries('apiModels')) {
      expect(nameMatchesModel(`${label} ${badge}`, MODEL_CATALOG[id].model), `${label} ${badge}`).toBe(true)
    }
  })
})

// ─── Provider requests ───────────────────────────────────────────────────────

describe('provider requests', () => {
  it('sends Kimi to Moonshot with max_tokens', async () => {
    sdk.openaiCreate.mockResolvedValue(openaiReply('ok'))
    await callAI('Kimi K3.1 Pro', 'hi', ALL_KEYS, null)
    expect(sdk.openaiCtor).toHaveBeenCalledWith({ apiKey: 'sk-kimi', baseURL: MOONSHOT_BASE_URL })
    const [request] = sdk.openaiCreate.mock.calls[0]
    expect(request).toMatchObject({ model: 'kimi-k3.1-pro', max_tokens: 4096 })
  })

  it('sends Gemini to the Gemini OpenAI-compatible endpoint', async () => {
    sdk.openaiCreate.mockResolvedValue(openaiReply('ok'))
    await callAI('Gemini 3.6 Flash', 'hi', ALL_KEYS, null)
    expect(sdk.openaiCtor).toHaveBeenCalledWith({ apiKey: 'gm-key', baseURL: GEMINI_OPENAI_BASE_URL })
    expect(sdk.openaiCreate.mock.calls[0][0]).toMatchObject({ model: 'gemini-3.6-flash' })
  })

  it('sends OpenAI requests to the default endpoint with max_completion_tokens', async () => {
    sdk.openaiCreate.mockResolvedValue(openaiReply('ok'))
    await callAI('GPT-6.1 Sol', 'hi', ALL_KEYS, null)
    expect(sdk.openaiCtor).toHaveBeenCalledWith({ apiKey: 'sk-oai' })
    const [request] = sdk.openaiCreate.mock.calls[0]
    expect(request).toMatchObject({ model: 'gpt-6.1-sol', max_completion_tokens: 16000 })
    expect(request).not.toHaveProperty('max_tokens')
    expect(request).not.toHaveProperty('temperature')
  })

  it('calls Claude Opus 5.5 without sampling parameters and keeps the Korean system prompt', async () => {
    sdk.anthropicCreate.mockResolvedValue(anthropicReply('ok'))
    const result = await callAI('Claude Opus 5.5', 'hi', ALL_KEYS, null)
    expect(result).toEqual({ content: 'ok', model: 'claude-opus-5-5' })
    const [request] = sdk.anthropicCreate.mock.calls[0]
    expect(request).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 16000, messages: [{ role: 'user', content: 'hi' }] })
    expect(request).not.toHaveProperty('temperature')
    expect(request.system).toContain('한국어')
  })

  it('streams Claude chunks through onChunk', async () => {
    sdk.anthropicStream.mockReturnValue(fakeAnthropicStream(['안녕', '하세요']))
    const chunks: string[] = []
    const result = await callAIStreaming('Claude Opus 5.5', 'hi', ALL_KEYS, null, c => chunks.push(c))
    expect(chunks).toEqual(['안녕', '하세요'])
    expect(result).toEqual({ content: '안녕하세요', model: 'claude-opus-5-5' })
  })
})

// ─── Conversation history ────────────────────────────────────────────────────

describe('conversation history', () => {
  it('is not polluted by a failed call', async () => {
    sdk.anthropicCreate
      .mockRejectedValueOnce(new Error('overloaded'))
      .mockResolvedValueOnce(anthropicReply('second answer'))

    await expect(callAI('Claude Opus 5.5', 'first', ALL_KEYS, null)).rejects.toThrow('overloaded')
    expect(getConversationHistory()).toEqual([])

    await callAI('Claude Opus 5.5', 'second', ALL_KEYS, null)
    const [request] = sdk.anthropicCreate.mock.calls[1]
    expect(request.messages).toEqual([{ role: 'user', content: 'second' }])
    expect(getConversationHistory()).toEqual([
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'second answer' },
    ])
  })

  it('records a failed stream retried without streaming only once', async () => {
    sdk.anthropicStream.mockReturnValue(fakeAnthropicStream(['partial'], new Error('stream dropped')))
    sdk.anthropicCreate.mockResolvedValue(anthropicReply('full answer'))

    await expect(callAIStreaming('Claude Opus 5.5', 'q', ALL_KEYS, null, () => {})).rejects.toThrow('stream dropped')
    await callAI('Claude Opus 5.5', 'q', ALL_KEYS, null)

    expect(sdk.anthropicCreate.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'q' }])
    expect(getConversationHistory()).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'full answer' },
    ])
  })

  it('is not polluted by a failed OpenAI-compatible stream', async () => {
    sdk.openaiCreate.mockRejectedValue(new Error('401'))
    await expect(callAIStreaming('Kimi K3.1 Pro', 'q', ALL_KEYS, null, () => {})).rejects.toThrow('401')
    expect(getConversationHistory()).toEqual([])
  })

  it('does not store an empty reply', async () => {
    sdk.anthropicCreate.mockResolvedValue({ content: [], stop_reason: 'refusal' })
    await callAI('Claude Opus 5.5', 'q', ALL_KEYS, null)
    expect(getConversationHistory()).toEqual([])
  })

  it('keeps the last 10 exchanges and always starts with a user turn', async () => {
    sdk.anthropicCreate.mockImplementation(async (req: { messages: { content: string }[] }) =>
      anthropicReply(`re: ${req.messages[req.messages.length - 1].content}`))

    for (let i = 1; i <= 12; i++) await callAI('Claude Opus 5.5', `m${i}`, ALL_KEYS, null)

    const history = getConversationHistory()
    expect(history).toHaveLength(20)
    expect(history[0]).toEqual({ role: 'user', content: 'm3' })
    expect(history[19]).toEqual({ role: 'assistant', content: 're: m12' })

    const lastRequest = sdk.anthropicCreate.mock.calls[11][0]
    expect(lastRequest.messages[0]).toEqual({ role: 'user', content: 'm2' })
    expect(lastRequest.messages.at(-1)).toEqual({ role: 'user', content: 'm12' })
  })
})
