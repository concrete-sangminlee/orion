import type Anthropic from '@anthropic-ai/sdk'
import type { OmoEvent } from './protocol'

type EventHandler = ((event: OmoEvent) => void) | null

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AIConfig {
  provider: string
  apiKey: string
  model: string
  baseURL?: string
}

function emit(handler: EventHandler, event: OmoEvent) {
  try { handler?.(event) } catch (err) { console.error('[AI Client] emit error:', err) }
}

function log(handler: EventHandler, agentId: string, message: string, logType: string = 'info') {
  emit(handler, { type: 'agent-log', payload: { agentId, message, logType } })
}

// ─── Model catalog ───────────────────────────────────────────────────────────

export const OLLAMA_BASE_URL = 'http://localhost:11434/v1'
export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'
/** Moonshot AI (Kimi) OpenAI-compatible endpoint, international region. */
export const MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1'
/** Google Gemini API OpenAI-compatibility endpoint. */
export const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'

interface ModelEntry {
  provider: 'anthropic' | 'openai' | 'openai-compat' | 'nvidia'
  model: string
  /** Key in the API-key map the renderer sends via omoSetApiKeys. */
  keyName: string
  baseURL?: string
}

/**
 * UI model names (as sent by the renderer's model selector) mapped to the API
 * model they call. A name must describe the model it calls; every
 * non-OpenAI provider needs its own baseURL, or the OpenAI SDK sends the
 * request (and that provider's key) to api.openai.com.
 */
export const MODEL_CATALOG: Readonly<Record<string, ModelEntry>> = {
  'Claude Opus 5.5': { provider: 'anthropic', model: 'claude-opus-5-5', keyName: 'anthropic' },
  'GPT-6.1 Sol': { provider: 'openai', model: 'gpt-6.1-sol', keyName: 'openai' },
  'Kimi K3.1 Pro': { provider: 'openai-compat', model: 'kimi-k3.1-pro', keyName: 'kimi', baseURL: MOONSHOT_BASE_URL },
  'Gemini 3.6 Flash': { provider: 'openai-compat', model: 'gemini-3.6-flash', keyName: 'gemini', baseURL: GEMINI_OPENAI_BASE_URL },
  // NVIDIA NIM models (build.nvidia.com)
  'NVIDIA Llama': { provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct', keyName: 'nvidia', baseURL: NVIDIA_BASE_URL },
  'NVIDIA Nemotron': { provider: 'nvidia', model: 'nvidia/llama-3.1-nemotron-70b-instruct', keyName: 'nvidia', baseURL: NVIDIA_BASE_URL },
  'DeepSeek R1': { provider: 'nvidia', model: 'deepseek-ai/deepseek-r1', keyName: 'nvidia', baseURL: NVIDIA_BASE_URL },
  'Qwen 2.5': { provider: 'nvidia', model: 'qwen/qwen2.5-72b-instruct', keyName: 'nvidia', baseURL: NVIDIA_BASE_URL },
}

// Map UI model names to actual API configs
export function resolveModel(selectedModel: string, apiKeys: Record<string, string>): AIConfig | null {
  // Ollama - no API key needed
  if (selectedModel === 'Ollama') {
    return { provider: 'ollama', apiKey: 'ollama', model: 'llama3.2', baseURL: OLLAMA_BASE_URL }
  }

  if (!Object.prototype.hasOwnProperty.call(MODEL_CATALOG, selectedModel)) return null
  const cfg = MODEL_CATALOG[selectedModel]

  const apiKey = apiKeys[cfg.keyName]
  if (!apiKey) return null

  return { provider: cfg.provider, apiKey, model: cfg.model, ...(cfg.baseURL && { baseURL: cfg.baseURL }) }
}

// ─── Provider calls ──────────────────────────────────────────────────────────

/**
 * Output cap for Claude. Thinking is always on for Claude Opus 5.5 and its
 * tokens count toward max_tokens, so leave room beyond the visible answer.
 */
const ANTHROPIC_MAX_TOKENS = 16000
/**
 * Output cap for OpenAI. GPT-6.x are reasoning models: they reject
 * `max_tokens` (use `max_completion_tokens`), and reasoning tokens count
 * toward the cap.
 */
const OPENAI_MAX_COMPLETION_TOKENS = 16000
/** Output cap for the other OpenAI-compatible providers (NVIDIA NIM, Moonshot, Gemini). */
const COMPAT_MAX_TOKENS = 4096

type OnChunk = (text: string) => void

function toAnthropicRequest(config: AIConfig, messages: ChatMessage[]): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: config.model,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    system: messages.find(m => m.role === 'system')?.content || '',
  }
}

// Call Anthropic API; streams through onChunk when it is given
async function callAnthropic(config: AIConfig, messages: ChatMessage[], handler: EventHandler, onChunk?: OnChunk): Promise<string> {
  const AnthropicSDK = (await import('@anthropic-ai/sdk')).default
  const client = new AnthropicSDK({ apiKey: config.apiKey })
  const request = toAnthropicRequest(config, messages)

  if (!onChunk) {
    log(handler, 'hephaestus', 'Calling Claude API...', 'action')
    const response = await client.messages.create(request)
    return response.content.map(b => (b.type === 'text' ? b.text : '')).join('')
  }

  log(handler, 'hephaestus', 'Calling Claude API (streaming)...', 'action')
  const stream = client.messages.stream(request)

  let fullText = ''
  stream.on('text', (text) => {
    fullText += text
    onChunk(text)
  })

  await stream.finalMessage()
  return fullText
}

function outputTokenLimit(config: AIConfig): { max_tokens?: number; max_completion_tokens?: number } {
  if (config.provider === 'ollama') return {}
  if (config.provider === 'openai') return { max_completion_tokens: OPENAI_MAX_COMPLETION_TOKENS }
  return { max_tokens: COMPAT_MAX_TOKENS }
}

// Call OpenAI-compatible API (OpenAI, Moonshot, Gemini, NVIDIA NIM, Ollama); streams through onChunk when it is given
async function callOpenAICompat(config: AIConfig, messages: ChatMessage[], handler: EventHandler, onChunk?: OnChunk): Promise<string> {
  const OpenAI = (await import('openai')).default
  const client = new OpenAI({ apiKey: config.apiKey, ...(config.baseURL ? { baseURL: config.baseURL } : {}) })

  const label = config.provider === 'ollama' ? 'Ollama (local)' : config.provider === 'nvidia' ? `NVIDIA NIM (${config.model})` : config.provider
  const request = {
    model: config.model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    ...outputTokenLimit(config),
  }

  if (!onChunk) {
    log(handler, 'hephaestus', `Calling ${label}...`, 'action')
    const response = await client.chat.completions.create(request)
    return response.choices[0]?.message?.content || 'No response generated.'
  }

  log(handler, 'hephaestus', `Calling ${label} (streaming)...`, 'action')
  const stream = await client.chat.completions.create({ ...request, stream: true })

  let fullText = ''
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || ''
    if (text) {
      fullText += text
      onChunk(text)
    }
  }

  return fullText || 'No response generated.'
}

// Check if Ollama is running
let ollamaAvailable: boolean | null = null
let ollamaModels: string[] = []

export async function checkOllama(): Promise<{ available: boolean; models: string[] }> {
  try {
    const http = await import('http')
    return new Promise((resolve) => {
      const req = http.get('http://localhost:11434/api/tags', { timeout: 2000 }, (res) => {
        let data = ''
        res.on('data', (chunk: string) => { data += chunk })
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            const models = (json.models || []).map((m: any) => m.name || m.model)
            ollamaAvailable = true
            ollamaModels = models
            console.log('[AI Client] Ollama available, models:', models)
            resolve({ available: true, models })
          } catch {
            ollamaAvailable = false
            resolve({ available: false, models: [] })
          }
        })
      })
      req.on('error', () => {
        ollamaAvailable = false
        resolve({ available: false, models: [] })
      })
      req.on('timeout', () => {
        req.destroy()
        ollamaAvailable = false
        resolve({ available: false, models: [] })
      })
    })
  } catch {
    ollamaAvailable = false
    return { available: false, models: [] }
  }
}

export function getOllamaStatus() {
  return { available: ollamaAvailable, models: ollamaModels }
}

const DEFAULT_SYSTEM_PROMPT = `You are Orion AI by Bebut, an expert coding assistant integrated into a code editor IDE. You help with code analysis, debugging, feature implementation, and code explanations. Be concise and helpful. Use markdown formatting for code blocks.

IMPORTANT: You MUST always respond in Korean (한국어). All explanations, comments, and descriptions must be written in Korean. Only code itself (variable names, syntax, etc.) should remain in English.`

let customSystemPrompt: string = ''
let customUserTemplate: string = ''

export function setCustomPrompts(prompts: { systemPrompt?: string; userPromptTemplate?: string }) {
  customSystemPrompt = prompts.systemPrompt || ''
  customUserTemplate = prompts.userPromptTemplate || ''
  console.log('[AI Client] Custom prompts updated')
}

// ─── Conversation history ────────────────────────────────────────────────────

/** Keep the last 10 exchanges (user + assistant pairs). */
const MAX_HISTORY_MESSAGES = 20

// Conversation history for context. Only completed exchanges are stored, so it
// always holds whole user/assistant pairs and starts with a user turn.
let conversationHistory: ChatMessage[] = []

/** Snapshot of the stored conversation history. */
export function getConversationHistory(): ChatMessage[] {
  return conversationHistory.map(m => ({ ...m }))
}

export function clearConversationHistory(): void {
  conversationHistory = []
}

interface PreparedCall {
  config: AIConfig
  userTurn: ChatMessage
  messages: ChatMessage[]
}

/** Resolve the model and build the request without touching the stored history. */
function prepareCall(
  selectedModel: string,
  message: string,
  apiKeys: Record<string, string>,
  handler: EventHandler,
  streaming: boolean,
): PreparedCall | null {
  let config = resolveModel(selectedModel, apiKeys)

  // Fallback to Ollama if no API key
  if (!config && ollamaAvailable) {
    const model = ollamaModels[0] || 'llama3.2'
    config = { provider: 'ollama', apiKey: 'ollama', model, baseURL: OLLAMA_BASE_URL }
    log(handler, 'sisyphus', `No API key for ${selectedModel}, using Ollama (${model})`, 'info')
  }

  if (!config) return null

  console.log(`[AI Client] Calling ${config.provider} / ${config.model}${streaming ? ' (streaming)' : ''}`)

  // Apply user template if set
  let processedMessage = message
  if (customUserTemplate && customUserTemplate !== '{message}') {
    processedMessage = customUserTemplate.replace('{message}', message)
  }

  // For small local models, prepend Korean instruction directly to user message
  if (config.provider === 'ollama') {
    processedMessage = `(반드시 한국어로 답변하세요. Answer in Korean only.)\n\n${processedMessage}`
  }

  const userTurn: ChatMessage = { role: 'user', content: processedMessage }
  const systemPrompt = customSystemPrompt || DEFAULT_SYSTEM_PROMPT

  return {
    config,
    userTurn,
    messages: [{ role: 'system', content: systemPrompt }, ...conversationHistory, userTurn],
  }
}

/**
 * Record a completed exchange. Called only after the provider call succeeds, so
 * a failed request (or a failed stream retried without streaming) never leaves
 * a dangling user turn behind. An empty reply is not stored either: Claude
 * rejects empty assistant messages in later requests.
 */
function commitExchange(userTurn: ChatMessage, content: string): void {
  if (!content.trim()) return
  conversationHistory = [...conversationHistory, userTurn, { role: 'assistant' as const, content }].slice(-MAX_HISTORY_MESSAGES)
}

async function runCall(
  selectedModel: string,
  message: string,
  apiKeys: Record<string, string>,
  handler: EventHandler,
  onChunk?: OnChunk,
): Promise<{ content: string; model: string } | null> {
  const prepared = prepareCall(selectedModel, message, apiKeys, handler, onChunk !== undefined)
  if (!prepared) return null

  const { config, userTurn, messages } = prepared
  const content = config.provider === 'anthropic'
    ? await callAnthropic(config, messages, handler, onChunk)
    : await callOpenAICompat(config, messages, handler, onChunk)

  commitExchange(userTurn, content)
  return { content, model: config.model }
}

export async function callAI(
  selectedModel: string,
  message: string,
  apiKeys: Record<string, string>,
  handler: EventHandler,
): Promise<{ content: string; model: string } | null> {
  return runCall(selectedModel, message, apiKeys, handler)
}

export async function callAIStreaming(
  selectedModel: string,
  message: string,
  apiKeys: Record<string, string>,
  handler: EventHandler,
  onChunk: (text: string) => void,
): Promise<{ content: string; model: string } | null> {
  return runCall(selectedModel, message, apiKeys, handler, onChunk)
}

export function hasApiKey(selectedModel: string, apiKeys: Record<string, string>): boolean {
  if (selectedModel === 'Ollama') return ollamaAvailable === true
  return resolveModel(selectedModel, apiKeys) !== null
}

export function canRespond(selectedModel: string, apiKeys: Record<string, string>): boolean {
  return hasApiKey(selectedModel, apiKeys) || ollamaAvailable === true
}
