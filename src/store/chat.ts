import { create } from 'zustand'
import type { ChatMessage, ChatMode } from '@shared/types'

interface ChatStore {
  messages: ChatMessage[]
  mode: ChatMode
  selectedModel: string
  isStreaming: boolean
  ollamaAvailable: boolean
  ollamaModels: string[]
  addMessage: (message: ChatMessage) => void
  updateLastAssistant: (content: string) => void
  setMode: (mode: ChatMode) => void
  setModel: (model: string) => void
  setStreaming: (streaming: boolean) => void
  clearMessages: () => void
  setOllamaStatus: (available: boolean, models: string[]) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  mode: 'agent',
  selectedModel: 'Ollama',
  isStreaming: false,
  ollamaAvailable: false,
  ollamaModels: [],

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateLastAssistant: (content) =>
    set((state) => {
      const msgs = [...state.messages]
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          msgs[i] = { ...msgs[i], content }
          break
        }
      }
      return { messages: msgs }
    }),

  setMode: (mode) => set({ mode }),
  setModel: (model) => set({ selectedModel: model }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  clearMessages: () => set({ messages: [] }),
  setOllamaStatus: (available, models) => set({ ollamaAvailable: available, ollamaModels: models }),
}))
