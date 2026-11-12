import { useEffect } from 'react'
import { useAgentStore } from '@/store/agents'
import { useChatStore } from '@/store/chat'
import { useEditorStore } from '@/store/editor'
import { useOutputStore } from '@/store/output'
import { v4 as uuid } from 'uuid'
import type { Agent } from '@shared/types'

interface ChatEventPayload {
  requestId?: unknown
  status?: unknown
  content?: unknown
  agentName?: unknown
  model?: unknown
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/**
 * Route a chat-stream / chat-response event to the turn that asked for it.
 * Events without the pending turn's request id (a cancelled turn, another
 * window's or the inline-edit requests) never touch the conversation.
 * Returns whether the event belonged to the pending turn.
 */
export function applyChatEvent(type: 'chat-stream' | 'chat-response', raw: unknown): boolean {
  const payload: ChatEventPayload = raw && typeof raw === 'object' ? raw : {}
  const requestId = text(payload.requestId)
  const chat = useChatStore.getState()
  if (!requestId || chat.pendingTurn?.requestId !== requestId) return false

  if (type === 'chat-response') {
    chat.finishReply(requestId, { content: text(payload.content) ?? '', agentName: text(payload.agentName), model: text(payload.model) })
  } else if (payload.status === 'start') {
    chat.beginReply(requestId, text(payload.agentName))
  } else if (payload.status === 'chunk') {
    const chunk = text(payload.content)
    if (chunk) chat.appendReply(requestId, chunk)
  }
  return true
}

export function useOmo() {
  const { setAgents, addLog } = useAgentStore()
  const { setOllamaStatus } = useChatStore()
  const { markAiModified } = useEditorStore()
  const { appendOutput } = useOutputStore()

  useEffect(() => {
    if (!window.api) return

    // Startup info log to Main channel
    appendOutput('Orion', 'Orion IDE started', 'success')
    appendOutput('Orion', `Platform: ${navigator.platform}`, 'info')
    appendOutput('Orion', `User Agent: ${navigator.userAgent}`, 'info')
    appendOutput('Orion', 'Starting the AI assistant...', 'info')

    window.api.omoStart()

    const cleanup = window.api.onOmoMessage((raw: any) => {
      const event = raw as { type: string; payload: any }

      switch (event.type) {
        case 'agent-status': {
          const agents = event.payload.agents as Agent[]
          setAgents(agents)
          break
        }
        case 'agent-log': {
          addLog({
            id: uuid(),
            agentId: event.payload.agentId,
            timestamp: Date.now(),
            message: event.payload.message,
            type: event.payload.logType || 'info',
          })
          break
        }
        case 'chat-stream': {
          if (!applyChatEvent('chat-stream', event.payload)) break
          if (event.payload.status === 'start') {
            appendOutput('AI', `[stream] ${event.payload.agentName || 'AI Assistant'} is responding...`, 'info')
          } else if (event.payload.status === 'end') {
            appendOutput('AI', '[stream] Response complete', 'success')
          }
          break
        }
        case 'chat-response': {
          if (!applyChatEvent('chat-response', event.payload)) break
          // Log AI response to output
          const model = event.payload.model || 'unknown model'
          const agent = event.payload.agentName || 'AI'
          const preview = (event.payload.content || '').slice(0, 120).replace(/\n/g, ' ')
          appendOutput('AI', `[response] ${agent} (${model}): ${preview}${(event.payload.content || '').length > 120 ? '...' : ''}`, 'info')
          break
        }
        case 'file-edit': {
          markAiModified(event.payload.filePath)
          appendOutput('AI', `[file-edit] AI modified: ${event.payload.filePath}`, 'warn')
          break
        }
        case 'ollama-status': {
          setOllamaStatus(event.payload.available, event.payload.models || [])
          const status = event.payload.available ? 'available' : 'unavailable'
          const modelCount = (event.payload.models || []).length
          appendOutput('Orion', `[ollama] Ollama ${status}${modelCount > 0 ? ` (${modelCount} model${modelCount > 1 ? 's' : ''})` : ''}`, event.payload.available ? 'success' : 'warn')
          break
        }
        case 'error': {
          addLog({
            id: uuid(),
            agentId: 'system',
            timestamp: Date.now(),
            message: event.payload.message,
            type: 'error',
          })
          appendOutput('Orion', `[error] ${event.payload.message}`, 'error')
          break
        }
      }
    })

    return cleanup
  }, [setAgents, addLog, markAiModified, setOllamaStatus, appendOutput])
}
