/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@shared/types'
import type { OmoBridgeMessage } from '@shared/ipc-contract'
import { HISTORY_LIMIT, toProviderHistory, useChatStore } from './chat'
import { useChatHistoryStore } from './chatHistory'

const omoSend = vi.fn<(message: OmoBridgeMessage) => void>()

const msg = (id: string, role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role, content, timestamp: 1, ...extra })

const sentChats = () => omoSend.mock.calls.map(([m]) => m).filter((m) => m.type === 'chat')
const lastChat = () => sentChats().at(-1)!.payload

beforeEach(() => {
  localStorage.clear()
  omoSend.mockReset()
  window.api = { omoSend } as unknown as typeof window.api
  useChatHistoryStore.setState({ conversations: [], activeConversationId: null })
  useChatHistoryStore.getState().createConversation()
  useChatStore.setState({ messages: [], pendingTurn: null, selectedModel: 'Claude Opus 5.5' })
})

describe('toProviderHistory', () => {
  it('keeps the visible conversation without notices or empty placeholders', () => {
    expect(toProviderHistory([
      msg('1', 'user', 'q1'),
      msg('2', 'assistant', '**Error:** overloaded', { agentName: 'System' }),
      msg('3', 'user', 'q2'),
      msg('4', 'assistant', 'a2', { agentName: 'AI Assistant', model: 'claude-opus-5-5' }),
      msg('5', 'assistant', ''),
    ])).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ])
  })

  it('sends only the most recent messages', () => {
    const many = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => msg(String(i), i % 2 ? 'assistant' : 'user', `m${i}`))
    const history = toProviderHistory(many)
    expect(history).toHaveLength(HISTORY_LIMIT)
    expect(history[0].content).toBe('m5')
    expect(history.at(-1)!.content).toBe(`m${HISTORY_LIMIT + 4}`)
  })
})

describe('sendTurn', () => {
  it("sends the active conversation's history, a request id and the turn's system prompt", () => {
    useChatStore.setState({ messages: [msg('1', 'user', 'q1'), msg('2', 'assistant', 'a1')] })

    expect(useChatStore.getState().sendTurn({ text: 'q2', prompt: '[File: a.ts]\n\nUser question: q2', systemPrompt: 'Current file: a.ts' })).toBe(true)

    const payload = lastChat()
    expect(payload).toEqual({
      message: '[File: a.ts]\n\nUser question: q2',
      model: 'Claude Opus 5.5',
      requestId: useChatStore.getState().pendingTurn!.requestId,
      history: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }],
      systemPrompt: 'Current file: a.ts',
    })
    // The chat shows what the user typed, not the prompt with file contents.
    expect(useChatStore.getState().messages.at(-1)).toMatchObject({ role: 'user', content: 'q2' })
  })

  it('does nothing while a turn is still waiting for its reply', () => {
    useChatStore.getState().sendTurn({ text: 'first' })
    expect(useChatStore.getState().sendTurn({ text: 'second' })).toBe(false)
    expect(sentChats()).toHaveLength(1)
    expect(useChatStore.getState().messages.map((m) => m.content)).toEqual(['first'])
  })

  it('regenerates from a message without the old question and answer in the history', () => {
    useChatStore.setState({ messages: [msg('1', 'user', 'q1'), msg('2', 'assistant', 'a1'), msg('3', 'user', 'q2'), msg('4', 'assistant', 'bad')] })

    useChatStore.getState().sendTurn({ text: 'q2', replaceFrom: '3' })

    expect(lastChat().history).toEqual([{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }])
    expect(useChatStore.getState().messages.map((m) => m.content)).toEqual(['q1', 'a1', 'q2'])
  })
})

describe('reply routing', () => {
  const start = () => {
    useChatStore.getState().sendTurn({ text: 'question' })
    return useChatStore.getState().pendingTurn!.requestId
  }

  it('streams into the reply of the turn that asked, by request id', () => {
    const id = start()
    const { beginReply, appendReply, finishReply } = useChatStore.getState()
    beginReply(id, 'AI Assistant')
    appendReply(id, 'Hel')
    appendReply('someone-else', 'NOPE')
    appendReply(id, 'lo')

    expect(useChatStore.getState().messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Hello' })

    finishReply(id, { content: 'Hello', agentName: 'AI Assistant', model: 'claude-opus-5-5' })
    expect(useChatStore.getState().pendingTurn).toBeNull()
    expect(useChatStore.getState().messages.at(-1)).toMatchObject({ content: 'Hello', model: 'claude-opus-5-5' })
  })

  it('takes the final text over the partial stream (fallback answer or error)', () => {
    const id = start()
    useChatStore.getState().beginReply(id)
    useChatStore.getState().appendReply(id, 'partial')
    useChatStore.getState().finishReply(id, { content: 'full answer', model: 'm' })

    const assistant = useChatStore.getState().messages.filter((m) => m.role === 'assistant')
    expect(assistant).toEqual([expect.objectContaining({ content: 'full answer' })])
  })

  it('adds a reply that arrives without a stream (e.g. "Ollama is not running")', () => {
    const id = start()
    useChatStore.getState().finishReply(id, { content: 'Ollama가 실행되지 않고 있습니다.', agentName: 'System', model: 'System' })
    expect(useChatStore.getState().messages.at(-1)).toMatchObject({ role: 'assistant', agentName: 'System' })
  })

  it('ends the turn when the user switches conversation, so the rest never lands in the other chat', () => {
    const id = start()
    useChatStore.getState().beginReply(id)
    useChatStore.getState().appendReply(id, 'first part')
    const original = useChatHistoryStore.getState().activeConversationId!

    useChatHistoryStore.getState().createConversation()
    useChatStore.getState().loadMessages([msg('x', 'user', 'other chat'), msg('y', 'assistant', 'other answer')])

    expect(omoSend).toHaveBeenLastCalledWith({ type: 'cancel', payload: { requestId: id } })
    expect(useChatStore.getState().pendingTurn).toBeNull()

    useChatStore.getState().appendReply(id, ' LATE')
    useChatStore.getState().finishReply(id, { content: 'first part LATE' })
    expect(useChatStore.getState().messages.map((m) => m.content)).toEqual(['other chat', 'other answer'])
    const saved = useChatHistoryStore.getState().conversations.find((c) => c.id === original)!
    expect(saved.messages.map((m) => m.content)).toEqual(['question', 'first part'])
  })

  it('ends the turn when the chat is cleared', () => {
    const id = start()
    useChatStore.getState().clearMessages()
    expect(omoSend).toHaveBeenLastCalledWith({ type: 'cancel', payload: { requestId: id } })
    useChatStore.getState().finishReply(id, { content: 'late' })
    expect(useChatStore.getState().messages).toEqual([])
  })
})
