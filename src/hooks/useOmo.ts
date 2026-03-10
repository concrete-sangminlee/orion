import { useEffect } from 'react'
import { useAgentStore } from '@/store/agents'
import { useChatStore } from '@/store/chat'
import { useEditorStore } from '@/store/editor'
import { v4 as uuid } from 'uuid'
import type { Agent } from '@shared/types'

export function useOmo() {
  const { setAgents, updateAgent, addLog } = useAgentStore()
  const { addMessage } = useChatStore()
  const { markAiModified } = useEditorStore()

  useEffect(() => {
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
        case 'chat-response': {
          addMessage({
            id: uuid(),
            role: 'assistant',
            content: event.payload.content,
            agentName: event.payload.agentName,
            model: event.payload.model,
            timestamp: Date.now(),
            taskProgress: event.payload.taskProgress,
          })
          break
        }
        case 'file-edit': {
          markAiModified(event.payload.filePath)
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
  }, [setAgents, updateAgent, addLog, addMessage, markAiModified])
}
