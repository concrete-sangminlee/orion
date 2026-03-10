import type { OmoEvent } from './protocol'

interface AIConfig {
  provider: string
  apiKey: string
  model: string
  baseURL?: string
}

function emit(handler: ((event: OmoEvent) => void) | null, event: OmoEvent) {
  try { handler?.(event) } catch (err) { console.error('[AI Client] emit error:', err) }
}

function log(handler: ((event: OmoEvent) => void) | null, agentId: string, message: string, logType: string = 'info') {
  emit(handler, { type: 'agent-log', payload: { agentId, message, logType } })
}

// Map UI model names to actual API configs
function resolveModel(selectedModel: string, apiKeys: Record<string, string>): AIConfig | null {
  // Ollama - no API key needed
  if (selectedModel === 'Ollama') {
    return { provider: 'ollama', apiKey: 'ollama', model: 'llama3.2', baseURL: 'http://localhost:11434/v1' }
  }

  const map: Record<string, { provider: string; model: string; keyName: string; baseURL?: string }> = {
    'Claude Opus': { provider: 'anthropic', model: 'claude-sonnet-4-20250514', keyName: 'anthropic' },
    'GPT-5.3': { provider: 'openai', model: 'gpt-4o', keyName: 'openai' },
    'Kimi K2.5': { provider: 'openai-compat', model: 'kimi', keyName: 'kimi' },
    'Gemini': { provider: 'openai-compat', model: 'gemini-2.0-flash', keyName: 'gemini' },
    // NVIDIA NIM models (build.nvidia.com)
    'NVIDIA Llama': { provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct', keyName: 'nvidia', baseURL: 'https://integrate.api.nvidia.com/v1' },
    'NVIDIA Nemotron': { provider: 'nvidia', model: 'nvidia/llama-3.1-nemotron-70b-instruct', keyName: 'nvidia', baseURL: 'https://integrate.api.nvidia.com/v1' },
    'DeepSeek R1': { provider: 'nvidia', model: 'deepseek-ai/deepseek-r1', keyName: 'nvidia', baseURL: 'https://integrate.api.nvidia.com/v1' },
    'Qwen 2.5': { provider: 'nvidia', model: 'qwen/qwen2.5-72b-instruct', keyName: 'nvidia', baseURL: 'https://integrate.api.nvidia.com/v1' },
  }

  const cfg = map[selectedModel]
  if (!cfg) return null

  const apiKey = apiKeys[cfg.keyName]
  if (!apiKey) return null

  return { provider: cfg.provider, apiKey, model: cfg.model, ...(cfg.baseURL && { baseURL: cfg.baseURL }) }
}

// Call Anthropic API
async function callAnthropic(config: AIConfig, messages: { role: string; content: string }[], handler: ((event: OmoEvent) => void) | null): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: config.apiKey })

  log(handler, 'hephaestus', 'Calling Claude API...', 'action')

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 2048,
    messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    system: messages.find(m => m.role === 'system')?.content || '',
  })

  return response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
}

// Call OpenAI-compatible API (OpenAI, Ollama, etc.)
async function callOpenAICompat(config: AIConfig, messages: { role: string; content: string }[], handler: ((event: OmoEvent) => void) | null): Promise<string> {
  const OpenAI = (await import('openai')).default

  const clientOpts: any = { apiKey: config.apiKey }
  if (config.baseURL) clientOpts.baseURL = config.baseURL

  const client = new OpenAI(clientOpts)

  const label = config.provider === 'ollama' ? 'Ollama (local)' : config.provider === 'nvidia' ? `NVIDIA NIM (${config.model})` : config.provider
  log(handler, 'hephaestus', `Calling ${label}...`, 'action')

  const response = await client.chat.completions.create({
    model: config.model,
    messages: messages.map(m => ({ role: m.role as any, content: m.content })),
    ...(config.provider !== 'ollama' ? { max_tokens: 2048 } : {}),
  })

  return response.choices[0]?.message?.content || 'No response generated.'
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

const DEFAULT_SYSTEM_PROMPT = `You are Orion AI by Bebut, an expert coding assistant integrated into a code editor IDE. You help with code analysis, debugging, feature implementation, and code explanations. Be concise and helpful. Use markdown formatting for code blocks. Respond in the same language the user uses.`

let customSystemPrompt: string = ''
let customUserTemplate: string = ''

export function setCustomPrompts(prompts: { systemPrompt?: string; userPromptTemplate?: string }) {
  customSystemPrompt = prompts.systemPrompt || ''
  customUserTemplate = prompts.userPromptTemplate || ''
  console.log('[AI Client] Custom prompts updated')
}

// Conversation history for context
let conversationHistory: { role: string; content: string }[] = []

export async function callAI(
  selectedModel: string,
  message: string,
  apiKeys: Record<string, string>,
  handler: ((event: OmoEvent) => void) | null,
): Promise<{ content: string; model: string } | null> {
  let config = resolveModel(selectedModel, apiKeys)

  // Fallback to Ollama if no API key
  if (!config && ollamaAvailable) {
    const model = ollamaModels[0] || 'llama3.2'
    config = { provider: 'ollama', apiKey: 'ollama', model, baseURL: 'http://localhost:11434/v1' }
    log(handler, 'sisyphus', `No API key for ${selectedModel}, using Ollama (${model})`, 'info')
  }

  if (!config) return null

  console.log(`[AI Client] Calling ${config.provider} / ${config.model}`)

  // Apply user template if set
  let processedMessage = message
  if (customUserTemplate && customUserTemplate !== '{message}') {
    processedMessage = customUserTemplate.replace('{message}', message)
  }

  // Build messages with history
  conversationHistory.push({ role: 'user', content: processedMessage })
  // Keep last 10 exchanges
  if (conversationHistory.length > 20) {
    conversationHistory = conversationHistory.slice(-20)
  }

  const systemPrompt = customSystemPrompt || DEFAULT_SYSTEM_PROMPT

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
  ]

  let content: string

  if (config.provider === 'anthropic') {
    content = await callAnthropic(config, messages, handler)
  } else {
    content = await callOpenAICompat(config, messages, handler)
  }

  // Save assistant response to history
  conversationHistory.push({ role: 'assistant', content })

  return { content, model: config.model }
}

export function hasApiKey(selectedModel: string, apiKeys: Record<string, string>): boolean {
  if (selectedModel === 'Ollama') return ollamaAvailable === true
  return resolveModel(selectedModel, apiKeys) !== null
}

export function canRespond(selectedModel: string, apiKeys: Record<string, string>): boolean {
  return hasApiKey(selectedModel, apiKeys) || ollamaAvailable === true
}
