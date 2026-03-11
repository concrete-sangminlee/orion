import type { OmoBridgeMessage, OmoEvent } from './protocol'
import type { Agent } from '../../shared/types'
import { callAI, callAIStreaming, canRespond, checkOllama, getOllamaStatus, setCustomPrompts } from './ai-client'

let messageHandler: ((event: OmoEvent) => void) | null = null
let apiKeys: Record<string, string> = {}

const defaultAgents: Agent[] = [
  { id: 'sisyphus', name: 'Sisyphus', role: 'Orchestrator', status: 'active' },
  { id: 'hephaestus', name: 'Hephaestus', role: 'Deep Worker', status: 'idle' },
  { id: 'prometheus', name: 'Prometheus', role: 'Planner', status: 'idle' },
  { id: 'oracle', name: 'Oracle', role: 'Debugger', status: 'idle' },
]

let agents: Agent[] = []

function emit(event: OmoEvent) {
  try { messageHandler?.(event) } catch (err) { console.error('[OMO] emit error:', err) }
}

function updateAgent(id: string, update: Partial<Agent>) {
  agents = agents.map((a) => (a.id === id ? { ...a, ...update } : a))
  emit({ type: 'agent-status', payload: { agents: [...agents] } })
}

function log(agentId: string, message: string, logType: string = 'info') {
  emit({ type: 'agent-log', payload: { agentId, message, logType } })
}

function chatResponse(content: string, agentName: string, model: string, taskProgress?: any[]) {
  emit({ type: 'chat-response', payload: { content, agentName, model, taskProgress } })
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function handleWithAI(message: string, model: string, mode: string) {
  try {
    const isAgent = mode === 'agent'
    const canCall = canRespond(model, apiKeys)

    // Phase 1: Start
    updateAgent('sisyphus', { status: 'working', currentTask: 'Analyzing request...', progress: 10 })
    log('sisyphus', `Received: "${message.slice(0, 80)}"`, 'info')

    if (isAgent) {
      await delay(200)
      updateAgent('prometheus', { status: 'working', currentTask: 'Planning...' })
      log('sisyphus', 'Delegating to Prometheus for planning', 'delegation')
      updateAgent('sisyphus', { progress: 25 })
      await delay(400)
      log('prometheus', 'Plan ready', 'action')
      updateAgent('prometheus', { status: 'idle', currentTask: undefined })

      updateAgent('hephaestus', { status: 'working', currentTask: 'Executing...' })
      log('sisyphus', 'Delegating to Hephaestus', 'delegation')
      updateAgent('sisyphus', { progress: 40 })
    }

    // Phase 2: Call AI
    let responseText: string
    let responseModel: string

    if (canCall) {
      updateAgent('sisyphus', { progress: 60 })
      // Use streaming for real-time response
      emit({ type: 'chat-stream', payload: { status: 'start', agentName: isAgent ? 'Sisyphus' : 'AI Assistant' } })
      try {
        const result = await callAIStreaming(model, message, apiKeys, messageHandler, (chunk: string) => {
          emit({ type: 'chat-stream', payload: { status: 'chunk', content: chunk } })
        })
        responseText = result?.content || 'Failed to get response.'
        responseModel = result?.model || model
      } catch (streamErr: any) {
        // Fallback to non-streaming
        console.log('[OMO] Streaming failed, falling back to non-streaming:', streamErr.message)
        const result = await callAI(model, message, apiKeys, messageHandler)
        responseText = result?.content || 'Failed to get response.'
        responseModel = result?.model || model
      }
      emit({ type: 'chat-stream', payload: { status: 'end' } })
    } else {
      // No AI available
      updateAgent('sisyphus', { progress: 60 })
      await delay(500)

      const { available } = getOllamaStatus()
      if (!available) {
        responseText = `**Ollama가 실행되지 않고 있습니다.**

로컬 AI를 사용하려면:

1. **Ollama 설치**: [ollama.com](https://ollama.com) 에서 다운로드
2. **모델 다운로드**: 터미널에서 \`ollama pull llama3.2\` 실행
3. **Ollama 실행**: \`ollama serve\` 또는 앱 실행
4. **재시작**: Orion을 다시 시작하면 자동 감지됩니다

또는 Settings(⚙️)에서 API 키를 입력할 수도 있습니다.`
      } else {
        responseText = `Ollama가 감지되었지만 응답 생성에 실패했습니다. 터미널에서 Ollama 상태를 확인해주세요.`
      }
      responseModel = 'System'
    }

    if (isAgent) {
      updateAgent('hephaestus', { status: 'idle', currentTask: undefined })
      updateAgent('oracle', { status: 'working', currentTask: 'Verifying...' })
      log('sisyphus', 'Delegating to Oracle', 'delegation')
      updateAgent('sisyphus', { progress: 90 })
      await delay(300)
      log('oracle', 'Done', 'action')
      updateAgent('oracle', { status: 'idle', currentTask: undefined })
    }

    updateAgent('sisyphus', { progress: 100 })
    chatResponse(
      responseText,
      isAgent ? 'Sisyphus' : 'AI Assistant',
      responseModel,
      isAgent ? [
        { name: 'Analyze', status: 'done' },
        { name: 'Execute', status: 'done' },
        { name: 'Verify', status: 'done' },
      ] : undefined,
    )

    updateAgent('sisyphus', { status: 'active', currentTask: undefined, progress: undefined })

  } catch (err: any) {
    console.error('[OMO] error:', err)
    chatResponse(
      `**Error:** ${err.message || err}\n\nOllama가 실행 중인지 확인해주세요 (\`ollama serve\`).`,
      'System', model,
    )
    agents.forEach((a) => updateAgent(a.id, { status: a.id === 'sisyphus' ? 'active' : 'idle', currentTask: undefined, progress: undefined }))
  }
}

export function setApiKeys(keys: Record<string, string>) {
  apiKeys = keys
  console.log('[OMO] API keys updated:', Object.keys(keys).filter((k) => !!keys[k]))
}

export function setPrompts(prompts: { systemPrompt?: string; userPromptTemplate?: string }) {
  setCustomPrompts(prompts)
}

export async function startOmo(path: string, onMessage: (event: OmoEvent) => void): Promise<void> {
  console.log('[OMO] Starting...')
  messageHandler = onMessage
  agents = defaultAgents.map((a) => ({ ...a }))

  emit({ type: 'agent-status', payload: { agents: [...agents] } })

  // Check Ollama availability
  const ollama = await checkOllama()
  if (ollama.available) {
    log('system', `Ollama detected: ${ollama.models.length} model(s) available [${ollama.models.slice(0, 3).join(', ')}]`, 'info')
    emit({ type: 'ollama-status', payload: { available: true, models: ollama.models } })
  } else {
    log('system', 'Ollama not detected. Install from ollama.com for free local AI.', 'info')
    emit({ type: 'ollama-status', payload: { available: false, models: [] } })
  }

  log('sisyphus', 'Orchestrator ready', 'info')
}

export function sendToOmo(message: OmoBridgeMessage): void {
  console.log('[OMO] sendToOmo:', message?.type)
  if (!messageHandler) return

  const userMessage = message?.payload?.message || ''
  const model = message?.payload?.model || 'Ollama'
  const mode = message?.payload?.mode || 'agent'

  handleWithAI(userMessage, model, mode)
}

export function stopOmo(): void {
  messageHandler = null
  agents = []
}
