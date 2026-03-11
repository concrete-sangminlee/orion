import { useEffect, useRef } from 'react'
import { useAgentStore } from '@/store/agents'
import { useChatStore } from '@/store/chat'
import { useEditorStore } from '@/store/editor'
import { v4 as uuid } from 'uuid'
import type { Agent } from '@shared/types'

export function useOmo() {
  const { setAgents, addLog } = useAgentStore()
  const { addMessage, updateLastAssistant, setStreaming, setOllamaStatus } = useChatStore()
  const { markAiModified } = useEditorStore()
  const streamingMsgId = useRef<string | null>(null)

  useEffect(() => {
    if (!window.api) return

    window.api.omoStart('.')

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
          const { status, content, agentName } = event.payload
          if (status === 'start') {
            // Create a placeholder message for streaming
            const id = uuid()
            streamingMsgId.current = id
            setStreaming(true)
            addMessage({
              id,
              role: 'assistant',
              content: '',
              agentName: agentName || 'AI Assistant',
              timestamp: Date.now(),
            })
          } else if (status === 'chunk' && content) {
            // Append chunk to the last assistant message
            updateLastAssistant(content)
          } else if (status === 'end') {
            setStreaming(false)
            streamingMsgId.current = null
          }
          break
        }
        case 'chat-response': {
          // Full response (non-streaming fallback or final)
          if (streamingMsgId.current) {
            // Already handled by streaming, just update with final content
            setStreaming(false)
            streamingMsgId.current = null
          }
          // Always add a proper message with model/task info
          const store = useChatStore.getState()
          const lastMsg = store.messages[store.messages.length - 1]
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content) {
            // Update the last message with metadata
            const updated = store.messages.map((m, i) =>
              i === store.messages.length - 1
                ? { ...m, model: event.payload.model, taskProgress: event.payload.taskProgress }
                : m
            )
            useChatStore.setState({ messages: updated })
          } else {
            addMessage({
              id: uuid(),
              role: 'assistant',
              content: event.payload.content,
              agentName: event.payload.agentName,
              model: event.payload.model,
              timestamp: Date.now(),
              taskProgress: event.payload.taskProgress,
            })
          }
          break
        }
        case 'file-edit': {
          markAiModified(event.payload.filePath)
          break
        }
        case 'ollama-status': {
          setOllamaStatus(event.payload.available, event.payload.models || [])
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
          break
        }
      }
    })

    return cleanup
  }, [setAgents, addLog, addMessage, updateLastAssistant, setStreaming, markAiModified, setOllamaStatus])
}
