import { describe, expect, it, vi } from 'vitest'
import {
  ANTHROPIC_COMPLETION_MODEL,
  cleanCompletion,
  createInlineCompleter,
  normalizeCompletionRequest,
  pickOllamaModel,
  type AnthropicLike,
} from './inline-completion'

const request = (overrides: Record<string, unknown> = {}) => ({
  provider: 'ollama',
  prefix: 'function add(a: number, b: number) {\n  return ',
  suffix: '\n}\n',
  language: 'typescript',
  fileName: 'math.ts',
  ...overrides,
})

type Route = (body: any) => { ok?: boolean; status?: number; json: unknown } | Promise<never>

function fakeFetch(routes: Record<string, Route>) {
  const calls: Array<{ path: string; body: any }> = []
  const fetch = vi.fn(async (url: string, init?: { body?: string; signal?: AbortSignal }) => {
    const path = new URL(url).pathname
    const body = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ path, body })
    const route = routes[path]
    if (!route) throw new Error(`unexpected request ${path}`)
    const result = await route(body)
    return { ok: result.ok ?? true, status: result.status ?? 200, json: async () => result.json }
  })
  return { fetch, calls }
}

const noAnthropic = { getAnthropicKey: () => undefined, createAnthropic: () => { throw new Error('must not be called') } }

describe('normalizeCompletionRequest', () => {
  it('keeps the text nearest the caret and clamps maxTokens', () => {
    const normalized = normalizeCompletionRequest(request({ prefix: 'x'.repeat(20_000) + 'END', suffix: 'START' + 'y'.repeat(20_000), maxTokens: 99_999 }))
    expect(normalized.prefix.endsWith('END')).toBe(true)
    expect(normalized.prefix.length).toBe(12_000)
    expect(normalized.suffix.startsWith('START')).toBe(true)
    expect(normalized.suffix.length).toBe(4_000)
    expect(normalized.maxTokens).toBe(512)
  })

  it.each([[null], ['text'], [request({ provider: 'openai' })], [request({ prefix: 42 })], [request({ suffix: undefined })]])(
    'rejects %j',
    (raw) => {
      expect(() => normalizeCompletionRequest(raw)).toThrow()
    },
  )
})

describe('pickOllamaModel', () => {
  it('prefers a code model over a general one', () => {
    expect(pickOllamaModel(['llama3.2:latest', 'qwen2.5-coder:7b'])).toBe('qwen2.5-coder:7b')
    expect(pickOllamaModel(['mistral:latest', 'codellama:code'])).toBe('codellama:code')
  })

  it('falls back to the first installed model, or null', () => {
    expect(pickOllamaModel(['llama3.2:latest'])).toBe('llama3.2:latest')
    expect(pickOllamaModel([])).toBeNull()
  })
})

describe('cleanCompletion', () => {
  const context = { prefix: 'const total = items', suffix: '\nconsole.log(total)\n' }

  it('unwraps a markdown fence and drops the caret marker', () => {
    expect(cleanCompletion('```ts\n.reduce((a, b) => a + b, 0)\n```', context)).toBe('.reduce((a, b) => a + b, 0)')
    expect(cleanCompletion('.length<CURSOR/>', context)).toBe('.length')
  })

  it('removes text repeated from before the caret', () => {
    expect(cleanCompletion('const total = items.length', context)).toBe('.length')
  })

  it('stops before text that already follows the caret', () => {
    expect(cleanCompletion('.length\nconsole.log(total)\nmore()', context)).toBe('.length')
  })

  it('returns an empty string for whitespace-only replies', () => {
    expect(cleanCompletion('  \n', context)).toBe('')
  })
})

describe('createInlineCompleter — Ollama', () => {
  it('uses fill-in-the-middle with a code model', async () => {
    const { fetch, calls } = fakeFetch({
      '/api/tags': () => ({ json: { models: [{ name: 'llama3.2:latest' }, { name: 'qwen2.5-coder:7b' }] } }),
      '/api/generate': () => ({ json: { response: 'a + b' } }),
    })
    const completer = createInlineCompleter({ fetch, ...noAnthropic })
    await expect(completer.complete(request())).resolves.toEqual({ text: 'a + b', model: 'qwen2.5-coder:7b' })
    const generate = calls.find((call) => call.path === '/api/generate')!
    expect(generate.body).toMatchObject({ model: 'qwen2.5-coder:7b', prompt: request().prefix, suffix: request().suffix, stream: false })
  })

  it('falls back to a chat prompt when the model does not support insert', async () => {
    const { fetch, calls } = fakeFetch({
      '/api/tags': () => ({ json: { models: [{ name: 'llama3.2:latest' }] } }),
      '/api/generate': () => ({ ok: false, status: 400, json: { error: 'llama3.2 does not support insert' } }),
      '/api/chat': () => ({ json: { message: { content: '```ts\na + b\n```' } } }),
    })
    const completer = createInlineCompleter({ fetch, ...noAnthropic })
    await expect(completer.complete(request())).resolves.toEqual({ text: 'a + b', model: 'llama3.2:latest' })
    const chat = calls.find((call) => call.path === '/api/chat')!
    expect(chat.body.messages[1].content).toContain('return <CURSOR/>\n}')
  })

  it('reports why there is no suggestion when Ollama is not running, and does not re-probe on every request', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const completer = createInlineCompleter({ fetch, ...noAnthropic, now: () => 1_000 })
    const first = await completer.complete(request())
    await completer.complete(request())
    expect(first).toEqual({ text: '', reason: 'Ollama is not running or has no models installed' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('cancels the request in flight when a newer one arrives', async () => {
    let firstSignal: AbortSignal | undefined
    let generateCalls = 0
    const fetch = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
      const path = new URL(url).pathname
      if (path === '/api/tags') return { ok: true, status: 200, json: async () => ({ models: [{ name: 'codellama:code' }] }) }
      generateCalls++
      if (generateCalls === 1) {
        firstSignal = init?.signal
        // Never resolves on its own: only the abort ends it.
        return new Promise<never>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
      }
      return { ok: true, status: 200, json: async () => ({ response: 'second' }) }
    })
    const completer = createInlineCompleter({ fetch, ...noAnthropic })
    const first = completer.complete(request())
    await vi.waitFor(() => expect(generateCalls).toBe(1))
    const second = completer.complete(request())
    await expect(first).resolves.toEqual({ text: '', reason: 'cancelled' })
    await expect(second).resolves.toMatchObject({ text: 'second' })
    expect(firstSignal?.aborted).toBe(true)
  })

  it('returns a reason instead of throwing for a malformed request', async () => {
    const { fetch } = fakeFetch({})
    const completer = createInlineCompleter({ fetch, ...noAnthropic })
    await expect(completer.complete({ provider: 'openai' })).resolves.toEqual({ text: '', reason: 'Unknown completion provider' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('createInlineCompleter — Anthropic', () => {
  function fakeAnthropic(reply: { stop_reason: string | null; content: Array<{ type: string; text?: string }> }) {
    const create = vi.fn(async () => reply)
    const client: AnthropicLike = { messages: { create } }
    return { client, create }
  }

  it('never calls the API without a stored key', async () => {
    const createAnthropic = vi.fn()
    const completer = createInlineCompleter({ fetch: vi.fn(), getAnthropicKey: () => undefined, createAnthropic })
    await expect(completer.complete(request({ provider: 'anthropic' }))).resolves.toEqual({ text: '', reason: 'No Anthropic API key is configured' })
    expect(createAnthropic).not.toHaveBeenCalled()
  })

  it('asks Claude Haiku 5.5 with thinking disabled and no sampling parameters', async () => {
    const { client, create } = fakeAnthropic({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'a + b' }] })
    const fetch = vi.fn()
    const completer = createInlineCompleter({ fetch, getAnthropicKey: () => 'sk-ant-EXAMPLE', createAnthropic: () => client })
    await expect(completer.complete(request({ provider: 'anthropic', maxTokens: 64 }))).resolves.toEqual({ text: 'a + b', model: ANTHROPIC_COMPLETION_MODEL })

    const [body, options] = create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>]
    expect(body.model).toBe('claude-haiku-5-5')
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.max_tokens).toBe(64)
    // Sampling parameters are rejected by current models.
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(options.maxRetries).toBe(0)
    // The local provider is not contacted when the user chose the cloud one.
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns no suggestion when the model declines', async () => {
    const { client } = fakeAnthropic({ stop_reason: 'refusal', content: [] })
    const completer = createInlineCompleter({ fetch: vi.fn(), getAnthropicKey: () => 'sk-ant-EXAMPLE', createAnthropic: () => client })
    await expect(completer.complete(request({ provider: 'anthropic' }))).resolves.toMatchObject({ text: '', reason: 'The model declined this request' })
  })

  it('turns an API error into a reason', async () => {
    const client: AnthropicLike = { messages: { create: vi.fn(async () => { throw new Error('401 invalid x-api-key') }) } }
    const completer = createInlineCompleter({ fetch: vi.fn(), getAnthropicKey: () => 'sk-ant-EXAMPLE', createAnthropic: () => client })
    await expect(completer.complete(request({ provider: 'anthropic' }))).resolves.toEqual({ text: '', reason: '401 invalid x-api-key' })
  })
})
