import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OmoBridgeMessage, OmoEvent } from './protocol'

const sdk = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  anthropicStream: vi.fn(),
  openaiCreate: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: sdk.anthropicCreate, stream: sdk.anthropicStream }
  },
}))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: sdk.openaiCreate } }
  },
}))

// The local Ollama probe (GET /api/tags); never reach a real server.
const httpGet = vi.hoisted(() => vi.fn())
vi.mock('http', () => ({ default: { get: httpGet }, get: httpGet }))

function ollamaServes(models: string[] | null) {
  httpGet.mockImplementation((_url: string, _opts: unknown, onResponse: (res: EventEmitter) => void) => {
    const req = new EventEmitter()
    queueMicrotask(() => {
      if (!models) return req.emit('error', new Error('ECONNREFUSED'))
      const res = new EventEmitter()
      onResponse(res)
      res.emit('data', JSON.stringify({ models: models.map(name => ({ name })) }))
      res.emit('end')
    })
    return Object.assign(req, { destroy() {} })
  })
}

import { sendToOmo, setApiKeys, startOmo, stopOmo } from './bridge'

const MODEL = 'Claude Opus 5.5'
let events: OmoEvent[] = []

type ChatPayload = { requestId?: string; status?: string; content?: string; model?: string; agentName?: string }
const of = (type: OmoEvent['type']) => events.filter(e => e.type === type)
const payloads = (type: OmoEvent['type']) => of(type).map(e => e.payload as ChatPayload)
const streamStatuses = () => payloads('chat-stream').map(p => p.status)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function chat(message: string, extra: Partial<OmoBridgeMessage['payload']> = {}) {
  sendToOmo({ type: 'chat', payload: { message, model: MODEL, ...extra } })
}

/** A stream that never finishes on its own and rejects once its signal aborts. */
function hangingStream(_req: unknown, opts: { signal: AbortSignal }) {
  return {
    on() { return this },
    finalMessage: () => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('Request was aborted.')))
    }),
  }
}

/** A stream that emits `chunks` and completes. */
function streamOf(chunks: string[]) {
  const listeners: Array<(text: string) => void> = []
  return {
    on(event: string, cb: (text: string) => void) {
      if (event === 'text') listeners.push(cb)
      return this
    },
    async finalMessage() {
      for (const chunk of chunks) listeners.forEach(l => l(chunk))
      return {}
    },
  }
}

function lastAgents() {
  return (of('agent-status').at(-1)?.payload as { agents: { id: string; status: string; currentTask?: string }[] }).agents
}

beforeEach(async () => {
  Object.values(sdk).forEach(fn => fn.mockReset())
  httpGet.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  ollamaServes(null)
  events = []
  setApiKeys({ anthropic: 'sk-ant' })
  await startOmo(e => events.push(e))
})

afterEach(() => {
  vi.useRealTimers()
  stopOmo()
})

describe('sendToOmo', () => {
  it('never starts an AI call for a cancel message', async () => {
    sendToOmo({ type: 'cancel', payload: {} })
    await sleep(20)

    expect(sdk.anthropicStream).not.toHaveBeenCalled()
    expect(sdk.anthropicCreate).not.toHaveBeenCalled()
    expect(of('chat-response')).toEqual([])
    expect(streamStatuses()).toEqual(['end'])
  })

  it('ignores unknown message types', async () => {
    const before = events.length
    sendToOmo({ type: 'stop', payload: {} } as unknown as OmoBridgeMessage)
    await sleep(20)

    expect(sdk.anthropicStream).not.toHaveBeenCalled()
    expect(sdk.anthropicCreate).not.toHaveBeenCalled()
    expect(events.length).toBe(before)
  })

  it('aborts a stream on cancel without retrying', async () => {
    sdk.anthropicStream.mockImplementation(hangingStream)

    chat('long question')
    await vi.waitFor(() => expect(sdk.anthropicStream).toHaveBeenCalledTimes(1))
    const { signal } = sdk.anthropicStream.mock.calls[0][1] as { signal: AbortSignal }

    sendToOmo({ type: 'cancel', payload: {} })
    expect(signal.aborted).toBe(true)
    await sleep(20)

    expect(sdk.anthropicCreate).not.toHaveBeenCalled() // no non-streaming fallback
    expect(of('chat-response')).toEqual([])
    expect(streamStatuses()).toEqual(['start', 'end'])
    expect(lastAgents()).toEqual([expect.objectContaining({ id: 'assistant', status: 'idle' })])
  })

  it('cancels only the turn named by the request id', async () => {
    sdk.anthropicStream.mockImplementation(hangingStream)

    chat('first', { requestId: 'r1' })
    chat('second', { requestId: 'r2' })
    await vi.waitFor(() => expect(sdk.anthropicStream).toHaveBeenCalledTimes(2))
    const [first, second] = sdk.anthropicStream.mock.calls.map(c => (c[1] as { signal: AbortSignal }).signal)

    sendToOmo({ type: 'cancel', payload: { requestId: 'r2' } })
    expect(second.aborted).toBe(true)
    expect(first.aborted).toBe(false)
    expect(lastAgents()[0].status).toBe('working')

    sendToOmo({ type: 'cancel', payload: {} })
    expect(first.aborted).toBe(true)
  })

  it('falls back to non-streaming after a stream error', async () => {
    sdk.anthropicStream.mockReturnValue({
      on() { return this },
      finalMessage: () => Promise.reject(new Error('stream dropped')),
    })
    sdk.anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: '답변' }], stop_reason: 'end_turn' })

    chat('question')
    await vi.waitFor(() => expect(of('chat-response')).toHaveLength(1))

    expect(of('chat-response')[0].payload).toMatchObject({ content: '답변', model: 'claude-opus-5-5' })
    expect(sdk.anthropicCreate.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'question' }])
  })

  it('still handles agent-command messages as AI turns', async () => {
    sdk.anthropicStream.mockReturnValue(streamOf([]))
    sendToOmo({ type: 'agent-command', payload: { message: 'do it', model: MODEL } })
    await vi.waitFor(() => expect(sdk.anthropicStream).toHaveBeenCalledTimes(1))
  })

  it('tags every stream event and the reply with the request id', async () => {
    sdk.anthropicStream.mockReturnValue(streamOf(['안녕', '하세요']))

    chat('hi', { requestId: 'req-7' })
    await vi.waitFor(() => expect(of('chat-response')).toHaveLength(1))

    expect(payloads('chat-stream')).toEqual([
      expect.objectContaining({ requestId: 'req-7', status: 'start' }),
      { requestId: 'req-7', status: 'chunk', content: '안녕' },
      { requestId: 'req-7', status: 'chunk', content: '하세요' },
      { requestId: 'req-7', status: 'end' },
    ])
    expect(payloads('chat-response')[0]).toMatchObject({ requestId: 'req-7', content: '안녕하세요', model: 'claude-opus-5-5' })
  })

  it("sends the renderer's history and system prompt, and keeps nothing for the next request", async () => {
    sdk.anthropicStream.mockReturnValue(streamOf(['ok']))
    const history = [{ role: 'user' as const, content: 'q1' }, { role: 'assistant' as const, content: 'a1' }]

    chat('q2', { requestId: 'a', history, systemPrompt: 'Current file: /w/app.ts' })
    await vi.waitFor(() => expect(of('chat-response')).toHaveLength(1))
    const [request] = sdk.anthropicStream.mock.calls[0]
    expect(request.messages).toEqual([...history, { role: 'user', content: 'q2' }])
    expect(request.system).toContain('Current file: /w/app.ts')

    // New chat: nothing from the previous conversation reaches the model.
    chat('fresh', { requestId: 'b' })
    await vi.waitFor(() => expect(of('chat-response')).toHaveLength(2))
    const [next] = sdk.anthropicStream.mock.calls[1]
    expect(next.messages).toEqual([{ role: 'user', content: 'fresh' }])
    expect(next.system).not.toContain('Current file')
  })

  it('reports one real assistant state and no scripted agents or delays', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] }) // a simulated delay would never fire
    sdk.anthropicStream.mockReturnValue(streamOf(['done']))

    // An old renderer asking for "agent" mode still gets one plain request.
    chat('build it', { requestId: 'x', ...({ mode: 'agent' } as object) })
    for (let i = 0; i < 50 && of('chat-response').length === 0; i++) await new Promise(r => setImmediate(r))

    expect(of('chat-response')).toHaveLength(1)
    expect(payloads('chat-response')[0]).not.toHaveProperty('taskProgress')
    const statuses = of('agent-status').map(e => (e.payload as { agents: { id: string; status: string }[] }).agents)
    expect(statuses.every(agents => agents.length === 1 && agents[0].id === 'assistant')).toBe(true)
    expect(statuses.map(agents => agents[0].status)).toEqual(['idle', 'working', 'idle'])
    expect(of('agent-log').map(e => (e.payload as { logType: string }).logType)).not.toContain('delegation')
  })

  it('probes Ollama again before answering that no provider is available, then uses its model', async () => {
    setApiKeys({})
    ollamaServes(['qwen2.5-coder:7b'])
    sdk.openaiCreate.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: '로컬 답변' } }] }
    })())

    sendToOmo({ type: 'chat', payload: { message: 'hi', model: 'Ollama', requestId: 'o' } })
    await vi.waitFor(() => expect(of('chat-response')).toHaveLength(1))

    expect(of('ollama-status').at(-1)?.payload).toEqual({ available: true, models: ['qwen2.5-coder:7b'] })
    expect(sdk.openaiCreate.mock.calls[0][0]).toMatchObject({ model: 'qwen2.5-coder:7b', stream: true })
    expect(payloads('chat-response')[0]).toMatchObject({ requestId: 'o', content: '로컬 답변', model: 'qwen2.5-coder:7b' })
  })

  it('says Ollama is not running only after the new probe fails', async () => {
    setApiKeys({})

    sendToOmo({ type: 'chat', payload: { message: 'hi', model: 'Ollama', requestId: 'n' } })
    await vi.waitFor(() => expect(of('chat-response')).toHaveLength(1))

    expect(httpGet).toHaveBeenCalledTimes(2) // startup + this request
    expect(payloads('chat-response')[0]).toMatchObject({ requestId: 'n', agentName: 'System', content: expect.stringContaining('Ollama') })
    expect(sdk.openaiCreate).not.toHaveBeenCalled()
  })
})
