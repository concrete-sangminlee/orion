/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyChatEvent } from './useOmo'
import { useChatStore } from '@/store/chat'
import { useChatHistoryStore } from '@/store/chatHistory'

beforeEach(() => {
  localStorage.clear()
  window.api = { omoSend: vi.fn() } as unknown as typeof window.api
  useChatHistoryStore.setState({ conversations: [], activeConversationId: null })
  useChatHistoryStore.getState().createConversation()
  useChatStore.setState({ messages: [], pendingTurn: null })
})

const contents = () => useChatStore.getState().messages.map((m) => `${m.role}:${m.content}`)

describe('applyChatEvent', () => {
  it('appends stream chunks to the message that started the turn, not the last assistant message', () => {
    useChatStore.setState({ messages: [{ id: 'old', role: 'assistant', content: 'earlier answer', timestamp: 1 }] })
    useChatStore.getState().sendTurn({ text: 'q' })
    const { requestId } = useChatStore.getState().pendingTurn!

    applyChatEvent('chat-stream', { requestId, status: 'start', agentName: 'AI Assistant' })
    applyChatEvent('chat-stream', { requestId, status: 'chunk', content: 'new ' })
    applyChatEvent('chat-stream', { requestId, status: 'chunk', content: 'answer' })
    applyChatEvent('chat-response', { requestId, content: 'new answer', model: 'claude-opus-5-5', agentName: 'AI Assistant' })

    expect(contents()).toEqual(['assistant:earlier answer', 'user:q', 'assistant:new answer'])
    expect(useChatStore.getState().messages.at(-1)!.model).toBe('claude-opus-5-5')
  })

  it('ignores events without the pending request id (cancelled turns, inline edits, other windows)', () => {
    useChatStore.getState().sendTurn({ text: 'q' })
    const { requestId } = useChatStore.getState().pendingTurn!

    expect(applyChatEvent('chat-stream', { status: 'start' })).toBe(false)
    expect(applyChatEvent('chat-stream', { requestId: 'stale', status: 'chunk', content: 'x' })).toBe(false)
    expect(applyChatEvent('chat-response', { content: 'unrouted reply' })).toBe(false)
    expect(applyChatEvent('chat-response', null)).toBe(false)

    expect(contents()).toEqual(['user:q'])
    expect(useChatStore.getState().pendingTurn?.requestId).toBe(requestId)
  })
})
