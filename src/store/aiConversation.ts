/**
 * AI conversation management store.
 * Manages chat threads, message history, streaming state,
 * context management, and multi-model conversations.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/* ── Types ─────────────────────────────────────────────── */

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  model?: string
  tokenCount?: number
  codeBlocks?: CodeBlock[]
  attachments?: Attachment[]
  isStreaming?: boolean
  error?: string
  feedback?: 'positive' | 'negative'
  editedContent?: string
}

export interface CodeBlock {
  language: string
  code: string
  filePath?: string
  startLine?: number
  endLine?: number
  diff?: boolean
}

export interface Attachment {
  type: 'file' | 'image' | 'selection' | 'terminal' | 'error' | 'diff'
  name: string
  content: string
  language?: string
  filePath?: string
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  model: string
  systemPrompt?: string
  contextFiles: string[]
  pinned: boolean
  archived: boolean
  totalTokens: number
  tags: string[]
}

export interface ConversationContext {
  activeFile?: string
  selectedText?: string
  visibleFiles: string[]
  diagnostics: string[]
  gitDiff?: string
  terminalOutput?: string
}

/* ── Store ─────────────────────────────────────────────── */

interface AIConversationState {
  conversations: Conversation[]
  activeConversationId: string | null
  isStreaming: boolean
  currentStreamContent: string
  context: ConversationContext
  defaultModel: string
  defaultSystemPrompt: string

  // Conversation management
  createConversation: (title?: string, model?: string) => string
  deleteConversation: (id: string) => void
  archiveConversation: (id: string) => void
  setActiveConversation: (id: string | null) => void
  renameConversation: (id: string, title: string) => void
  duplicateConversation: (id: string) => string
  pinConversation: (id: string) => void
  unpinConversation: (id: string) => void
  tagConversation: (id: string, tags: string[]) => void
  clearAll: () => void

  // Messages
  addMessage: (conversationId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => string
  updateMessage: (conversationId: string, messageId: string, updates: Partial<ChatMessage>) => void
  deleteMessage: (conversationId: string, messageId: string) => void
  editMessage: (conversationId: string, messageId: string, newContent: string) => void
  setMessageFeedback: (conversationId: string, messageId: string, feedback: 'positive' | 'negative' | undefined) => void

  // Streaming
  startStreaming: (conversationId: string) => string
  appendStreamContent: (content: string) => void
  endStreaming: (conversationId: string, messageId: string) => void
  cancelStreaming: () => void

  // Context
  setContext: (context: Partial<ConversationContext>) => void
  addContextFile: (conversationId: string, filePath: string) => void
  removeContextFile: (conversationId: string, filePath: string) => void

  // Queries
  getActiveConversation: () => Conversation | undefined
  getConversationMessages: (id: string) => ChatMessage[]
  searchConversations: (query: string) => Conversation[]
  getRecentConversations: (limit?: number) => Conversation[]
  getPinnedConversations: () => Conversation[]
  getAllTags: () => string[]

  // Settings
  setDefaultModel: (model: string) => void
  setDefaultSystemPrompt: (prompt: string) => void
}

/* ── Store Implementation ──────────────────────────────── */

export const useAIConversationStore = create<AIConversationState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      isStreaming: false,
      currentStreamContent: '',
      context: { visibleFiles: [], diagnostics: [] },
      defaultModel: 'claude-3.5-sonnet',
      defaultSystemPrompt: 'You are an expert software engineer. Help the user with their coding tasks. Be concise and provide working code.',

      createConversation: (title, model) => {
        const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const conversation: Conversation = {
          id,
          title: title || 'New Chat',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          model: model || get().defaultModel,
          systemPrompt: get().defaultSystemPrompt,
          contextFiles: [],
          pinned: false,
          archived: false,
          totalTokens: 0,
          tags: [],
        }

        set(s => ({
          conversations: [conversation, ...s.conversations],
          activeConversationId: id,
        }))
        return id
      },

      deleteConversation: (id) => {
        set(s => ({
          conversations: s.conversations.filter(c => c.id !== id),
          activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
        }))
      },

      archiveConversation: (id) => {
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === id ? { ...c, archived: !c.archived } : c
          ),
        }))
      },

      setActiveConversation: (id) => set({ activeConversationId: id }),

      renameConversation: (id, title) => {
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === id ? { ...c, title, updatedAt: Date.now() } : c
          ),
        }))
      },

      duplicateConversation: (id) => {
        const conv = get().conversations.find(c => c.id === id)
        if (!conv) return ''

        const newId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const duplicate: Conversation = {
          ...conv,
          id: newId,
          title: `${conv.title} (copy)`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          pinned: false,
        }

        set(s => ({
          conversations: [duplicate, ...s.conversations],
          activeConversationId: newId,
        }))
        return newId
      },

      pinConversation: (id) => {
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === id ? { ...c, pinned: true } : c
          ),
        }))
      },

      unpinConversation: (id) => {
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === id ? { ...c, pinned: false } : c
          ),
        }))
      },

      tagConversation: (id, tags) => {
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === id ? { ...c, tags } : c
          ),
        }))
      },

      clearAll: () => set({ conversations: [], activeConversationId: null }),

      // Messages
      addMessage: (conversationId, message) => {
        const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const chatMessage: ChatMessage = {
          ...message,
          id: msgId,
          timestamp: Date.now(),
        }

        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === conversationId
              ? {
                  ...c,
                  messages: [...c.messages, chatMessage],
                  updatedAt: Date.now(),
                  totalTokens: c.totalTokens + (message.tokenCount || 0),
                  // Auto-title from first user message
                  title: c.messages.length === 0 && message.role === 'user'
                    ? message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '')
                    : c.title,
                }
              : c
          ),
        }))
        return msgId
      },

      updateMessage: (conversationId, messageId, updates) => {
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === conversationId
              ? {
                  ...c,
                  messages: c.messages.map(m =>
                    m.id === messageId ? { ...m, ...updates } : m
                  ),
                  updatedAt: Date.now(),
                }
              : c
          ),
        }))
      },

      deleteMessage: (conversationId, messageId) => {
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === conversationId
              ? { ...c, messages: c.messages.filter(m => m.id !== messageId), updatedAt: Date.now() }
              : c
          ),
        }))
      },

      editMessage: (conversationId, messageId, newContent) => {
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === conversationId
              ? {
                  ...c,
                  messages: c.messages.map(m =>
                    m.id === messageId
                      ? { ...m, editedContent: newContent }
                      : m
                  ),
                  updatedAt: Date.now(),
                }
              : c
          ),
        }))
      },

      setMessageFeedback: (conversationId, messageId, feedback) => {
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === conversationId
              ? {
                  ...c,
                  messages: c.messages.map(m =>
                    m.id === messageId ? { ...m, feedback } : m
                  ),
                }
              : c
          ),
        }))
      },

      // Streaming
      startStreaming: (conversationId) => {
        const msgId = get().addMessage(conversationId, {
          role: 'assistant',
          content: '',
          isStreaming: true,
        })
        set({ isStreaming: true, currentStreamContent: '' })
        return msgId
      },

      appendStreamContent: (content) => {
        set(s => ({
          currentStreamContent: s.currentStreamContent + content,
        }))
      },

      endStreaming: (conversationId, messageId) => {
        const finalContent = get().currentStreamContent
        get().updateMessage(conversationId, messageId, {
          content: finalContent,
          isStreaming: false,
        })
        set({ isStreaming: false, currentStreamContent: '' })
      },

      cancelStreaming: () => {
        set({ isStreaming: false, currentStreamContent: '' })
      },

      // Context
      setContext: (context) => {
        set(s => ({ context: { ...s.context, ...context } }))
      },

      addContextFile: (conversationId, filePath) => {
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === conversationId
              ? { ...c, contextFiles: [...new Set([...c.contextFiles, filePath])] }
              : c
          ),
        }))
      },

      removeContextFile: (conversationId, filePath) => {
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === conversationId
              ? { ...c, contextFiles: c.contextFiles.filter(f => f !== filePath) }
              : c
          ),
        }))
      },

      // Queries
      getActiveConversation: () => {
        const { conversations, activeConversationId } = get()
        return conversations.find(c => c.id === activeConversationId)
      },

      getConversationMessages: (id) => {
        return get().conversations.find(c => c.id === id)?.messages || []
      },

      searchConversations: (query) => {
        const lower = query.toLowerCase()
        return get().conversations.filter(c =>
          !c.archived && (
            c.title.toLowerCase().includes(lower) ||
            c.messages.some(m => m.content.toLowerCase().includes(lower)) ||
            c.tags.some(t => t.toLowerCase().includes(lower))
          )
        )
      },

      getRecentConversations: (limit = 20) => {
        return get().conversations
          .filter(c => !c.archived)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, limit)
      },

      getPinnedConversations: () => {
        return get().conversations.filter(c => c.pinned && !c.archived)
      },

      getAllTags: () => {
        const tags = new Set<string>()
        get().conversations.forEach(c => c.tags.forEach(t => tags.add(t)))
        return [...tags].sort()
      },

      // Settings
      setDefaultModel: (model) => set({ defaultModel: model }),
      setDefaultSystemPrompt: (prompt) => set({ defaultSystemPrompt: prompt }),
    }),
    {
      name: 'orion-ai-conversations',
      partialize: (state) => ({
        conversations: state.conversations.map(c => ({
          ...c,
          messages: c.messages.map(m => ({ ...m, isStreaming: false })),
        })),
        defaultModel: state.defaultModel,
        defaultSystemPrompt: state.defaultSystemPrompt,
      }),
    }
  )
)
