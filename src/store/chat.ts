import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { ChatMessage } from '@shared/types'
import type { OmoChatTurn } from '@shared/ipc-contract'
import { useChatHistoryStore } from './chatHistory'

/** Most recent messages sent as history with each turn (the main process caps it again). */
export const HISTORY_LIMIT = 20

/** The bridge labels its own notices (errors, "Ollama is not running") with this agent name. */
const NOTICE_AGENT = 'System'

/**
 * The visible conversation as the provider should see it: the user's words
 * and real replies, oldest first. Notices and empty placeholders are left out.
 */
export function toProviderHistory(messages: readonly ChatMessage[]): OmoChatTurn[] {
  return messages
    .filter((m) => m.content.trim() !== '' && m.agentName !== NOTICE_AGENT)
    .slice(-HISTORY_LIMIT)
    .map(({ role, content }) => ({ role, content }))
}

/** The turn waiting for a reply. Events carrying another request id are stale and ignored. */
interface PendingTurn {
  requestId: string
  /** The assistant message the reply streams into, once the stream starts. */
  replyId: string | null
}

export interface TurnRequest {
  /** What the user asked: shown in the chat and part of later turns' history. */
  text: string
  /** What the model receives for this turn when it differs from `text` (attached file contents). */
  prompt?: string
  /** Extra system instructions for this turn only (active-file context, custom instructions). */
  systemPrompt?: string
  /** Regenerate / edit: drop this message and everything after it before asking again. */
  replaceFrom?: string
}

export interface ReplyUpdate {
  content: string
  agentName?: string
  model?: string
}

interface ChatStore {
  messages: ChatMessage[]
  selectedModel: string
  /** Set from sending a turn until its reply finishes or it is cancelled. */
  pendingTurn: PendingTurn | null
  ollamaAvailable: boolean
  ollamaModels: string[]
  addMessage: (message: ChatMessage) => void
  setModel: (model: string) => void
  clearMessages: () => void
  setOllamaStatus: (available: boolean, models: string[]) => void
  loadMessages: (messages: ChatMessage[]) => void
  /** Send a turn with the conversation so far. Returns false (and changes nothing) while another turn is pending. */
  sendTurn: (request: TurnRequest) => boolean
  /** Stop waiting for the pending turn and tell the main process to abort it. */
  cancelTurn: () => void
  /** The reply to `requestId` started streaming. */
  beginReply: (requestId: string, agentName?: string) => void
  appendReply: (requestId: string, chunk: string) => void
  /** The final reply (or error notice) for `requestId`; ends the turn. */
  finishReply: (requestId: string, reply: ReplyUpdate) => void
  /** Record token usage for the current active conversation */
  recordUsage: (inputTokens: number, outputTokens: number) => void
  /** Fork the active conversation from a specific message, switching to the fork */
  forkFromMessage: (messageId: string) => string | null
}

/** Sync current messages to the active conversation in chatHistory store. */
function syncToHistory(messages: ChatMessage[]) {
  useChatHistoryStore.getState().syncMessages(messages)
}

export const useChatStore = create<ChatStore>((set, get) => {
  const setMessages = (messages: ChatMessage[]) => {
    set({ messages })
    syncToHistory(messages)
  }

  /** Apply `update` to the pending turn's reply message, if the user has not deleted it. */
  const updateReply = (replyId: string, update: (message: ChatMessage) => ChatMessage) => {
    const { messages } = get()
    if (!messages.some((m) => m.id === replyId)) return
    setMessages(messages.map((m) => (m.id === replyId ? update(m) : m)))
  }

  return {
    messages: [],
    selectedModel: 'Ollama',
    pendingTurn: null,
    ollamaAvailable: false,
    ollamaModels: [],

    addMessage: (message) => setMessages([...get().messages, message]),

    setModel: (model) => set({ selectedModel: model }),

    clearMessages: () => {
      get().cancelTurn()
      setMessages([])
    },

    setOllamaStatus: (available, models) =>
      set({ ollamaAvailable: available, ollamaModels: models }),

    loadMessages: (messages) => set({ messages }),

    sendTurn: ({ text, prompt, systemPrompt, replaceFrom }) => {
      const { pendingTurn, messages, selectedModel } = get()
      if (pendingTurn || !text.trim() || !window.api) return false

      let earlier = messages
      if (replaceFrom !== undefined) {
        const index = messages.findIndex((m) => m.id === replaceFrom)
        if (index === -1) return false
        earlier = messages.slice(0, index)
      }

      const requestId = uuid()
      const updated: ChatMessage[] = [...earlier, { id: uuid(), role: 'user', content: text, timestamp: Date.now() }]
      set({ messages: updated, pendingTurn: { requestId, replyId: null } })
      syncToHistory(updated)
      window.api.omoSend({
        type: 'chat',
        payload: {
          message: prompt ?? text,
          model: selectedModel,
          requestId,
          history: toProviderHistory(earlier),
          ...(systemPrompt ? { systemPrompt } : {}),
        },
      })
      return true
    },

    cancelTurn: () => {
      const turn = get().pendingTurn
      if (!turn) return
      set({ pendingTurn: null })
      window.api?.omoSend({ type: 'cancel', payload: { requestId: turn.requestId } })
    },

    beginReply: (requestId, agentName) => {
      const turn = get().pendingTurn
      if (turn?.requestId !== requestId || turn.replyId) return
      const replyId = uuid()
      set({ pendingTurn: { ...turn, replyId } })
      get().addMessage({ id: replyId, role: 'assistant', content: '', agentName, timestamp: Date.now() })
    },

    appendReply: (requestId, chunk) => {
      const turn = get().pendingTurn
      if (turn?.requestId !== requestId || !turn.replyId) return
      updateReply(turn.replyId, (m) => ({ ...m, content: m.content + chunk }))
    },

    finishReply: (requestId, { content, agentName, model }) => {
      const turn = get().pendingTurn
      if (turn?.requestId !== requestId) return
      set({ pendingTurn: null })
      // The final text is authoritative: after a failed stream it is the full
      // non-streamed answer (or the error), not the partial chunks.
      const reply = { content, agentName, model }
      if (turn.replyId) updateReply(turn.replyId, (m) => ({ ...m, ...reply }))
      else get().addMessage({ id: uuid(), role: 'assistant', timestamp: Date.now(), ...reply })
    },

    recordUsage: (inputTokens: number, outputTokens: number) => {
      const historyStore = useChatHistoryStore.getState()
      const activeId = historyStore.activeConversationId
      if (!activeId) return
      historyStore.recordTokenUsage(activeId, inputTokens, outputTokens, get().selectedModel)
    },

    forkFromMessage: (messageId: string): string | null => {
      const historyStore = useChatHistoryStore.getState()
      const activeId = historyStore.activeConversationId
      if (!activeId) return null

      const convo = historyStore.conversations.find((c) => c.id === activeId)
      if (!convo) return null

      const msgIndex = convo.messages.findIndex((m) => m.id === messageId)
      if (msgIndex === -1) return null

      const forkedId = historyStore.forkConversation(activeId, msgIndex)
      if (forkedId) {
        // Load the forked messages into the chat store
        const forkedConvo = useChatHistoryStore.getState().conversations.find((c) => c.id === forkedId)
        if (forkedConvo) {
          set({ messages: forkedConvo.messages })
        }
      }
      return forkedId
    },
  }
})

// A reply belongs to the conversation that asked for it, so leaving that
// conversation (new chat, switch, fork, delete) ends the turn instead of
// streaming the rest into whichever chat is shown.
useChatHistoryStore.subscribe((state, previous) => {
  if (state.activeConversationId !== previous.activeConversationId) useChatStore.getState().cancelTurn()
})
