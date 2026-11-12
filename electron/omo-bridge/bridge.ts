import type { OmoBridgeMessage, OmoEvent } from './protocol'
import type { Agent } from '../../shared/types'
import { ASSISTANT_AGENT_ID, callAI, callAIStreaming, canRespond, checkOllama, setCustomPrompts, type ChatMessage } from './ai-client'

let messageHandler: ((event: OmoEvent) => void) | null = null
let apiKeys: Record<string, string> = {}

// The chat assistant is the only agent: one provider request per turn, no
// planning or verification steps. Its status is real: working while a request
// is being handled, idle otherwise.
const ASSISTANT: Agent = { id: ASSISTANT_AGENT_ID, name: 'Orion AI', role: 'Chat assistant', status: 'idle' }

/** Abort controllers of the turns being handled, with the renderer's request id (if it sent one). */
const inFlight = new Map<AbortController, string | undefined>()

const NO_PROVIDER_TEXT = `**Ollama가 실행되지 않고 있습니다.**

로컬 AI를 사용하려면:

1. **Ollama 설치**: [ollama.com](https://ollama.com) 에서 다운로드
2. **모델 다운로드**: 터미널에서 \`ollama pull llama3.2\` 실행
3. **Ollama 실행**: \`ollama serve\` 또는 앱 실행

Ollama를 실행한 뒤 메시지를 다시 보내면 자동으로 감지됩니다.

또는 Settings(⚙️)에서 API 키를 입력할 수도 있습니다.`

function emit(event: OmoEvent) {
  try { messageHandler?.(event) } catch (err) { console.error('[OMO] emit error:', err) }
}

function emitAssistantStatus() {
  const working = inFlight.size > 0
  emit({
    type: 'agent-status',
    payload: { agents: [{ ...ASSISTANT, status: working ? 'working' : 'idle', ...(working && { currentTask: 'Generating a reply' }) }] },
  })
}

function log(message: string, logType: string = 'info') {
  emit({ type: 'agent-log', payload: { agentId: ASSISTANT_AGENT_ID, message, logType } })
}

/** Spread into a chat event so the renderer can route it; omitted for requests that sent no id. */
function tagged(requestId: string | undefined) {
  return requestId === undefined ? {} : { requestId }
}

function chatResponse(requestId: string | undefined, content: string, agentName: string, model: string) {
  emit({ type: 'chat-response', payload: { ...tagged(requestId), content, agentName, model } })
}

interface ChatRequest {
  message: string
  model: string
  requestId?: string
  /** Untrusted renderer data: the AI client validates and caps it. */
  history?: readonly ChatMessage[]
  systemPrompt?: string
}

async function handleWithAI({ message, model, requestId, history, systemPrompt }: ChatRequest) {
  const controller = new AbortController()
  const { signal } = controller
  inFlight.set(controller, requestId)
  emitAssistantStatus()
  try {
    log(`Received: "${message.slice(0, 80)}"`, 'info')

    if (!canRespond(model, apiKeys)) {
      // Ollama may have been started since the last probe; check again before saying it is not running.
      emit({ type: 'ollama-status', payload: await checkOllama() })
      signal.throwIfAborted()
    }
    if (!canRespond(model, apiKeys)) {
      chatResponse(requestId, NO_PROVIDER_TEXT, 'System', 'System')
      return
    }

    const options = { signal, history, systemPrompt }
    emit({ type: 'chat-stream', payload: { ...tagged(requestId), status: 'start', agentName: 'AI Assistant' } })
    let result: { content: string; model: string } | null
    try {
      result = await callAIStreaming(model, message, apiKeys, messageHandler, (chunk: string) => {
        emit({ type: 'chat-stream', payload: { ...tagged(requestId), status: 'chunk', content: chunk } })
      }, options)
    } catch (streamErr: any) {
      // A cancelled turn is not retried
      if (signal.aborted) throw streamErr
      console.log('[OMO] Streaming failed, falling back to non-streaming:', streamErr.message)
      result = await callAI(model, message, apiKeys, messageHandler, options)
    }
    emit({ type: 'chat-stream', payload: { ...tagged(requestId), status: 'end' } })
    chatResponse(requestId, result?.content || 'Failed to get response.', 'AI Assistant', result?.model || model)
  } catch (err: any) {
    // Cancelled: cancelInFlight() already ended the stream
    if (signal.aborted) return
    console.error('[OMO] error:', err)
    chatResponse(
      requestId,
      `**Error:** ${err.message || err}\n\nOllama가 실행 중인지 확인해주세요 (\`ollama serve\`).`,
      'System', model,
    )
  } finally {
    if (inFlight.delete(controller)) emitAssistantStatus()
  }
}

/** Abort the turn with this request id, or every turn when none is given. */
function cancelInFlight(requestId: string | undefined) {
  for (const [controller, id] of inFlight) {
    if (requestId !== undefined && id !== requestId) continue
    controller.abort()
    inFlight.delete(controller)
  }
  emit({ type: 'chat-stream', payload: { ...tagged(requestId), status: 'end' } })
  emitAssistantStatus()
  log('Request cancelled', 'info')
}

/** A string field of a renderer message, or undefined (the renderer may send anything). */
function stringField(value: unknown, maxLength = Infinity): string | undefined {
  return typeof value === 'string' && value.length <= maxLength ? value : undefined
}

export function setApiKeys(keys: Record<string, string>) {
  apiKeys = keys
  console.log('[OMO] API keys updated:', Object.keys(keys).filter((k) => !!keys[k]))
}

/** Untrusted renderer data: the AI client keeps only string prompts. */
export function setPrompts(prompts: unknown) {
  setCustomPrompts(prompts)
}

export async function startOmo(onMessage: (event: OmoEvent) => void): Promise<void> {
  console.log('[OMO] Starting...')
  messageHandler = onMessage

  emitAssistantStatus()

  // Check Ollama availability
  const ollama = await checkOllama()
  if (ollama.available) {
    log(`Ollama detected: ${ollama.models.length} model(s) available [${ollama.models.slice(0, 3).join(', ')}]`, 'info')
    emit({ type: 'ollama-status', payload: { available: true, models: ollama.models } })
  } else {
    log('Ollama not detected. Install from ollama.com for free local AI.', 'info')
    emit({ type: 'ollama-status', payload: { available: false, models: [] } })
  }
}

export function sendToOmo(message: OmoBridgeMessage): void {
  console.log('[OMO] sendToOmo:', message?.type)
  if (!messageHandler) return

  const payload: OmoBridgeMessage['payload'] = message?.payload && typeof message.payload === 'object' ? message.payload : {}
  const requestId = stringField(payload.requestId, 200)

  switch (message?.type) {
    case 'cancel':
      cancelInFlight(requestId)
      return
    case 'chat':
    case 'agent-command': {
      handleWithAI({
        message: stringField(payload.message) ?? '',
        model: stringField(payload.model, 200) ?? 'Ollama',
        requestId,
        history: payload.history,
        systemPrompt: stringField(payload.systemPrompt),
      })
      return
    }
    default:
      // Unknown message types are ignored
      return
  }
}

export function stopOmo(): void {
  messageHandler = null
}
