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

// Real AI client, but never probe a local Ollama server
vi.mock('./ai-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ai-client')>()),
  checkOllama: vi.fn().mockResolvedValue({ available: false, models: [] }),
}))

import { clearConversationHistory, getConversationHistory } from './ai-client'
import { sendToOmo, setApiKeys, startOmo, stopOmo } from './bridge'

const MODEL = 'Claude Opus 5.5'
let events: OmoEvent[] = []

const of = (type: OmoEvent['type']) => events.filter(e => e.type === type)
const streamStatuses = () => of('chat-stream').map(e => (e.payload as { status: string }).status)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function chat(message: string, mode: 'chat' | 'agent' = 'chat') {
  sendToOmo({ type: 'chat', payload: { message, model: MODEL, mode } })
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

beforeEach(async () => {
  Object.values(sdk).forEach(fn => fn.mockReset())
  clearConversationHistory()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  events = []
  setApiKeys({ anthropic: 'sk-ant' })
  await startOmo(e => events.push(e))
})

afterEach(() => {
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

  it('aborts a stream on cancel without retrying or touching history', async () => {
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
    expect(getConversationHistory()).toEqual([])

    const lastStatus = of('agent-status').at(-1)?.payload as { agents: { id: string; status: string; currentTask?: string }[] }
    expect(lastStatus.agents.find(a => a.id === 'sisyphus')).toMatchObject({ status: 'active', currentTask: undefined })
    expect(lastStatus.agents.filter(a => a.id !== 'sisyphus').every(a => a.status === 'idle')).toBe(true)
  })

  it('stops an agent-mode turn cancelled before the AI call starts', async () => {
    chat('plan something', 'agent')
    sendToOmo({ type: 'cancel', payload: {} })
    await sleep(700) // past both planning delays (200ms + 400ms), when the AI call would start

    expect(sdk.anthropicStream).not.toHaveBeenCalled()
    expect(sdk.anthropicCreate).not.toHaveBeenCalled()
    expect(of('chat-response')).toEqual([])
  })

  it('falls back to non-streaming after a stream error and records the turn once', async () => {
    sdk.anthropicStream.mockReturnValue({
      on() { return this },
      finalMessage: () => Promise.reject(new Error('stream dropped')),
    })
    sdk.anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: '답변' }], stop_reason: 'end_turn' })

    chat('question')
    await vi.waitFor(() => expect(of('chat-response')).toHaveLength(1))

    expect(of('chat-response')[0].payload).toMatchObject({ content: '답변', model: 'claude-opus-5-5' })
    expect(sdk.anthropicCreate.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'question' }])
    expect(getConversationHistory()).toEqual([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: '답변' },
    ])
  })

  it('still handles agent-command messages as AI turns', async () => {
    sdk.anthropicStream.mockReturnValue({
      on() { return this },
      finalMessage: () => Promise.resolve({}),
    })
    sendToOmo({ type: 'agent-command', payload: { message: 'do it', model: MODEL, mode: 'chat' } })
    await vi.waitFor(() => expect(sdk.anthropicStream).toHaveBeenCalledTimes(1))
  })
})
