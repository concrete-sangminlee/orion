/**
 * AI Streaming Protocol - handles streaming responses from multiple AI providers.
 * Supports SSE, WebSocket, and chunked transfer protocols with unified interface.
 * Handles tool use, function calling, and structured output streaming.
 */

/* ── Types ─────────────────────────────────────────────── */

export type AIProvider = 'anthropic' | 'openai' | 'google' | 'ollama' | 'azure' | 'custom'

export interface StreamConfig {
  provider: AIProvider
  model: string
  apiKey?: string
  baseUrl?: string
  maxTokens?: number
  temperature?: number
  topP?: number
  stopSequences?: string[]
  systemPrompt?: string
  tools?: ToolDefinition[]
  responseFormat?: 'text' | 'json' | 'markdown'
  timeout?: number
  retryCount?: number
  retryDelay?: number
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
  status: 'pending' | 'running' | 'completed' | 'error'
  result?: string
  error?: string
}

export interface StreamMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  images?: Array<{ type: 'base64' | 'url'; data: string; mediaType: string }>
  metadata?: Record<string, unknown>
}

export type StreamEvent =
  | { type: 'start'; messageId: string }
  | { type: 'text'; text: string; accumulated: string }
  | { type: 'tool_use_start'; toolCall: ToolCall }
  | { type: 'tool_use_delta'; toolCallId: string; argumentsDelta: string }
  | { type: 'tool_use_end'; toolCallId: string }
  | { type: 'thinking'; text: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheRead?: number; cacheWrite?: number }
  | { type: 'stop'; reason: StopReason; totalText: string }
  | { type: 'error'; error: StreamError }
  | { type: 'retry'; attempt: number; maxAttempts: number; delay: number }

export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'cancelled'

export interface StreamError {
  code: string
  message: string
  status?: number
  retryable: boolean
  provider: AIProvider
}

export interface StreamStats {
  startTime: number
  firstTokenTime: number | null
  endTime: number | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalCharacters: number
  tokensPerSecond: number
  timeToFirstToken: number | null
  totalDuration: number | null
  toolCallCount: number
  retryCount: number
}

/* ── Event Emitter ─────────────────────────────────────── */

type EventHandler = (event: StreamEvent) => void

class StreamEventEmitter {
  private handlers: Set<EventHandler> = new Set()

  on(handler: EventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  emit(event: StreamEvent): void {
    for (const handler of this.handlers) {
      try { handler(event) } catch { /* ignore listener errors */ }
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}

/* ── Provider-specific parsers ─────────────────────────── */

interface ProviderParser {
  parseChunk(chunk: string, state: ParserState): StreamEvent[]
}

interface ParserState {
  buffer: string
  accumulated: string
  messageId: string
  currentToolCall: ToolCall | null
  toolCallArgs: string
  inputTokens: number
  outputTokens: number
}

function createParserState(): ParserState {
  return {
    buffer: '',
    accumulated: '',
    messageId: '',
    currentToolCall: null,
    toolCallArgs: '',
    inputTokens: 0,
    outputTokens: 0,
  }
}

/* ── Anthropic Parser ──────────────────────────────────── */

const anthropicParser: ProviderParser = {
  parseChunk(chunk: string, state: ParserState): StreamEvent[] {
    const events: StreamEvent[] = []
    state.buffer += chunk

    const lines = state.buffer.split('\n')
    state.buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue

      try {
        const event = JSON.parse(data)

        switch (event.type) {
          case 'message_start':
            state.messageId = event.message?.id || `msg-${Date.now()}`
            state.inputTokens = event.message?.usage?.input_tokens || 0
            events.push({ type: 'start', messageId: state.messageId })
            break

          case 'content_block_start':
            if (event.content_block?.type === 'tool_use') {
              const toolCall: ToolCall = {
                id: event.content_block.id,
                name: event.content_block.name,
                arguments: '',
                status: 'pending',
              }
              state.currentToolCall = toolCall
              state.toolCallArgs = ''
              events.push({ type: 'tool_use_start', toolCall })
            } else if (event.content_block?.type === 'thinking') {
              events.push({ type: 'thinking', text: '' })
            }
            break

          case 'content_block_delta':
            if (event.delta?.type === 'text_delta') {
              const text = event.delta.text || ''
              state.accumulated += text
              events.push({ type: 'text', text, accumulated: state.accumulated })
            } else if (event.delta?.type === 'input_json_delta') {
              const delta = event.delta.partial_json || ''
              state.toolCallArgs += delta
              if (state.currentToolCall) {
                events.push({ type: 'tool_use_delta', toolCallId: state.currentToolCall.id, argumentsDelta: delta })
              }
            } else if (event.delta?.type === 'thinking_delta') {
              events.push({ type: 'thinking', text: event.delta.thinking || '' })
            }
            break

          case 'content_block_stop':
            if (state.currentToolCall) {
              state.currentToolCall.arguments = state.toolCallArgs
              events.push({ type: 'tool_use_end', toolCallId: state.currentToolCall.id })
              state.currentToolCall = null
              state.toolCallArgs = ''
            }
            break

          case 'message_delta':
            if (event.usage) {
              state.outputTokens = event.usage.output_tokens || 0
              events.push({
                type: 'usage',
                inputTokens: state.inputTokens,
                outputTokens: state.outputTokens,
                cacheRead: event.usage.cache_read_input_tokens,
                cacheWrite: event.usage.cache_creation_input_tokens,
              })
            }
            if (event.delta?.stop_reason) {
              events.push({
                type: 'stop',
                reason: mapStopReason(event.delta.stop_reason, 'anthropic'),
                totalText: state.accumulated,
              })
            }
            break

          case 'message_stop':
            // Final event
            break

          case 'error':
            events.push({
              type: 'error',
              error: {
                code: event.error?.type || 'unknown',
                message: event.error?.message || 'Unknown error',
                retryable: isRetryable(event.error?.type),
                provider: 'anthropic',
              },
            })
            break
        }
      } catch { /* ignore parse errors */ }
    }

    return events
  },
}

/* ── OpenAI Parser ─────────────────────────────────────── */

const openaiParser: ProviderParser = {
  parseChunk(chunk: string, state: ParserState): StreamEvent[] {
    const events: StreamEvent[] = []
    state.buffer += chunk

    const lines = state.buffer.split('\n')
    state.buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') {
        events.push({ type: 'stop', reason: 'end_turn', totalText: state.accumulated })
        continue
      }

      try {
        const event = JSON.parse(data)
        const choice = event.choices?.[0]

        if (!state.messageId && event.id) {
          state.messageId = event.id
          events.push({ type: 'start', messageId: state.messageId })
        }

        if (choice?.delta?.content) {
          const text = choice.delta.content
          state.accumulated += text
          events.push({ type: 'text', text, accumulated: state.accumulated })
        }

        if (choice?.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            if (tc.function?.name) {
              const toolCall: ToolCall = {
                id: tc.id || `tc-${Date.now()}`,
                name: tc.function.name,
                arguments: '',
                status: 'pending',
              }
              state.currentToolCall = toolCall
              state.toolCallArgs = ''
              events.push({ type: 'tool_use_start', toolCall })
            }
            if (tc.function?.arguments) {
              state.toolCallArgs += tc.function.arguments
              if (state.currentToolCall) {
                events.push({ type: 'tool_use_delta', toolCallId: state.currentToolCall.id, argumentsDelta: tc.function.arguments })
              }
            }
          }
        }

        if (choice?.finish_reason) {
          if (state.currentToolCall) {
            state.currentToolCall.arguments = state.toolCallArgs
            events.push({ type: 'tool_use_end', toolCallId: state.currentToolCall.id })
            state.currentToolCall = null
          }
          events.push({
            type: 'stop',
            reason: mapStopReason(choice.finish_reason, 'openai'),
            totalText: state.accumulated,
          })
        }

        if (event.usage) {
          events.push({
            type: 'usage',
            inputTokens: event.usage.prompt_tokens || 0,
            outputTokens: event.usage.completion_tokens || 0,
          })
        }
      } catch { /* ignore */ }
    }

    return events
  },
}

/* ── Ollama Parser ─────────────────────────────────────── */

const ollamaParser: ProviderParser = {
  parseChunk(chunk: string, state: ParserState): StreamEvent[] {
    const events: StreamEvent[] = []
    state.buffer += chunk

    const lines = state.buffer.split('\n')
    state.buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const event = JSON.parse(line)

        if (!state.messageId) {
          state.messageId = `ollama-${Date.now()}`
          events.push({ type: 'start', messageId: state.messageId })
        }

        if (event.message?.content) {
          const text = event.message.content
          state.accumulated += text
          events.push({ type: 'text', text, accumulated: state.accumulated })
        }

        if (event.done) {
          if (event.prompt_eval_count || event.eval_count) {
            events.push({
              type: 'usage',
              inputTokens: event.prompt_eval_count || 0,
              outputTokens: event.eval_count || 0,
            })
          }
          events.push({ type: 'stop', reason: 'end_turn', totalText: state.accumulated })
        }
      } catch { /* ignore */ }
    }

    return events
  },
}

/* ── Google (Gemini) Parser ────────────────────────────── */

const googleParser: ProviderParser = {
  parseChunk(chunk: string, state: ParserState): StreamEvent[] {
    const events: StreamEvent[] = []
    state.buffer += chunk

    const lines = state.buffer.split('\n')
    state.buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (!data) continue

      try {
        const event = JSON.parse(data)

        if (!state.messageId) {
          state.messageId = `gemini-${Date.now()}`
          events.push({ type: 'start', messageId: state.messageId })
        }

        const parts = event.candidates?.[0]?.content?.parts
        if (parts) {
          for (const part of parts) {
            if (part.text) {
              state.accumulated += part.text
              events.push({ type: 'text', text: part.text, accumulated: state.accumulated })
            }
            if (part.functionCall) {
              const toolCall: ToolCall = {
                id: `fc-${Date.now()}`,
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args || {}),
                status: 'pending',
              }
              events.push({ type: 'tool_use_start', toolCall })
              events.push({ type: 'tool_use_end', toolCallId: toolCall.id })
            }
          }
        }

        if (event.usageMetadata) {
          events.push({
            type: 'usage',
            inputTokens: event.usageMetadata.promptTokenCount || 0,
            outputTokens: event.usageMetadata.candidatesTokenCount || 0,
          })
        }

        const finishReason = event.candidates?.[0]?.finishReason
        if (finishReason && finishReason !== 'FINISH_REASON_UNSPECIFIED') {
          events.push({ type: 'stop', reason: mapStopReason(finishReason, 'google'), totalText: state.accumulated })
        }
      } catch { /* ignore */ }
    }

    return events
  },
}

/* ── Provider Registry ─────────────────────────────────── */

function getParser(provider: AIProvider): ProviderParser {
  switch (provider) {
    case 'anthropic': return anthropicParser
    case 'openai': case 'azure': return openaiParser
    case 'ollama': return ollamaParser
    case 'google': return googleParser
    case 'custom': return openaiParser  // Default to OpenAI-compatible
  }
}

function getDefaultBaseUrl(provider: AIProvider): string {
  switch (provider) {
    case 'anthropic': return 'https://api.anthropic.com'
    case 'openai': return 'https://api.openai.com'
    case 'google': return 'https://generativelanguage.googleapis.com'
    case 'ollama': return 'http://localhost:11434'
    case 'azure': return ''
    case 'custom': return ''
  }
}

function buildRequestUrl(config: StreamConfig): string {
  const base = config.baseUrl || getDefaultBaseUrl(config.provider)

  switch (config.provider) {
    case 'anthropic':
      return `${base}/v1/messages`
    case 'openai':
    case 'azure':
      return `${base}/v1/chat/completions`
    case 'google':
      return `${base}/v1beta/models/${config.model}:streamGenerateContent?alt=sse`
    case 'ollama':
      return `${base}/api/chat`
    case 'custom':
      return base
  }
}

function buildRequestHeaders(config: StreamConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  switch (config.provider) {
    case 'anthropic':
      headers['x-api-key'] = config.apiKey || ''
      headers['anthropic-version'] = '2023-06-01'
      headers['anthropic-beta'] = 'prompt-caching-2024-07-31'
      break
    case 'openai':
    case 'azure':
      headers['Authorization'] = `Bearer ${config.apiKey || ''}`
      break
    case 'google':
      headers['x-goog-api-key'] = config.apiKey || ''
      break
    // Ollama doesn't need auth
  }

  return headers
}

function buildRequestBody(config: StreamConfig, messages: StreamMessage[]): string {
  switch (config.provider) {
    case 'anthropic':
      return JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens || 4096,
        temperature: config.temperature,
        top_p: config.topP,
        stop_sequences: config.stopSequences,
        system: config.systemPrompt,
        stream: true,
        messages: messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'tool' ? 'user' : m.role,
          content: m.images?.length
            ? [
                ...m.images.map(img => ({
                  type: 'image' as const,
                  source: img.type === 'base64'
                    ? { type: 'base64', media_type: img.mediaType, data: img.data }
                    : { type: 'url', url: img.data },
                })),
                { type: 'text' as const, text: m.content },
              ]
            : m.content,
        })),
        ...(config.tools?.length ? {
          tools: config.tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        } : {}),
      })

    case 'openai':
    case 'azure':
      return JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens || 4096,
        temperature: config.temperature,
        top_p: config.topP,
        stop: config.stopSequences,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          ...(config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : []),
          ...messages.map(m => ({
            role: m.role,
            content: m.images?.length
              ? [
                  { type: 'text', text: m.content },
                  ...m.images.map(img => ({
                    type: 'image_url',
                    image_url: { url: img.type === 'base64' ? `data:${img.mediaType};base64,${img.data}` : img.data },
                  })),
                ]
              : m.content,
          })),
        ],
        ...(config.tools?.length ? {
          tools: config.tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        } : {}),
      })

    case 'google':
      return JSON.stringify({
        contents: messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          maxOutputTokens: config.maxTokens || 4096,
          temperature: config.temperature,
          topP: config.topP,
          stopSequences: config.stopSequences,
        },
        ...(config.systemPrompt ? {
          systemInstruction: { parts: [{ text: config.systemPrompt }] },
        } : {}),
      })

    case 'ollama':
      return JSON.stringify({
        model: config.model,
        messages: [
          ...(config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : []),
          ...messages.map(m => ({
            role: m.role,
            content: m.content,
            ...(m.images?.length ? { images: m.images.filter(i => i.type === 'base64').map(i => i.data) } : {}),
          })),
        ],
        stream: true,
        options: {
          num_predict: config.maxTokens || 4096,
          temperature: config.temperature,
          top_p: config.topP,
          stop: config.stopSequences,
        },
      })

    default:
      return '{}'
  }
}

/* ── Helpers ───────────────────────────────────────────── */

function mapStopReason(reason: string, provider: AIProvider): StopReason {
  const mapping: Record<string, StopReason> = {
    // Anthropic
    'end_turn': 'end_turn',
    'max_tokens': 'max_tokens',
    'stop_sequence': 'stop_sequence',
    'tool_use': 'tool_use',
    // OpenAI
    'stop': 'end_turn',
    'length': 'max_tokens',
    'tool_calls': 'tool_use',
    'function_call': 'tool_use',
    // Google
    'STOP': 'end_turn',
    'MAX_TOKENS': 'max_tokens',
    'SAFETY': 'end_turn',
  }
  return mapping[reason] || 'end_turn'
}

function isRetryable(errorType: string): boolean {
  return ['overloaded_error', 'rate_limit_error', 'api_error', 'timeout'].includes(errorType)
}

/* ── Stream Controller ─────────────────────────────────── */

export class AIStreamController {
  private abortController: AbortController | null = null
  private emitter = new StreamEventEmitter()
  private stats: StreamStats = createStats()
  private _isStreaming = false

  get isStreaming(): boolean { return this._isStreaming }

  on(handler: EventHandler): () => void {
    return this.emitter.on(handler)
  }

  getStats(): StreamStats {
    return { ...this.stats }
  }

  cancel(): void {
    this.abortController?.abort()
    this._isStreaming = false
    this.emitter.emit({ type: 'stop', reason: 'cancelled', totalText: '' })
  }

  async stream(config: StreamConfig, messages: StreamMessage[]): Promise<string> {
    this._isStreaming = true
    this.stats = createStats()
    this.stats.startTime = performance.now()

    const parser = getParser(config.provider)
    const state = createParserState()
    const maxRetries = config.retryCount || 2
    let lastError: StreamError | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = (config.retryDelay || 1000) * Math.pow(2, attempt - 1)
        this.emitter.emit({ type: 'retry', attempt, maxAttempts: maxRetries + 1, delay })
        this.stats.retryCount++
        await sleep(delay)
      }

      this.abortController = new AbortController()
      const timeout = config.timeout || 120000

      const timeoutId = setTimeout(() => {
        this.abortController?.abort()
      }, timeout)

      try {
        const response = await fetch(buildRequestUrl(config), {
          method: 'POST',
          headers: buildRequestHeaders(config),
          body: buildRequestBody(config, messages),
          signal: this.abortController.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '')
          const error: StreamError = {
            code: `http_${response.status}`,
            message: errorBody || response.statusText,
            status: response.status,
            retryable: response.status === 429 || response.status >= 500,
            provider: config.provider,
          }

          if (error.retryable && attempt < maxRetries) {
            lastError = error
            continue
          }

          this.emitter.emit({ type: 'error', error })
          this._isStreaming = false
          throw new Error(error.message)
        }

        if (!response.body) {
          throw new Error('No response body')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          const events = parser.parseChunk(chunk, state)

          for (const event of events) {
            // Update stats
            if (event.type === 'text' && this.stats.firstTokenTime === null) {
              this.stats.firstTokenTime = performance.now()
              this.stats.timeToFirstToken = this.stats.firstTokenTime - this.stats.startTime
            }
            if (event.type === 'text') {
              this.stats.totalCharacters += event.text.length
            }
            if (event.type === 'usage') {
              this.stats.inputTokens = event.inputTokens
              this.stats.outputTokens = event.outputTokens
              this.stats.cacheReadTokens = event.cacheRead || 0
              this.stats.cacheWriteTokens = event.cacheWrite || 0
            }
            if (event.type === 'tool_use_start') {
              this.stats.toolCallCount++
            }

            this.emitter.emit(event)
          }
        }

        // Finalize stats
        this.stats.endTime = performance.now()
        this.stats.totalDuration = this.stats.endTime - this.stats.startTime
        if (this.stats.totalDuration > 0 && this.stats.outputTokens > 0) {
          this.stats.tokensPerSecond = (this.stats.outputTokens / this.stats.totalDuration) * 1000
        }

        this._isStreaming = false
        return state.accumulated

      } catch (err) {
        clearTimeout(timeoutId)

        if ((err as Error).name === 'AbortError') {
          this._isStreaming = false
          return state.accumulated
        }

        if (attempt < maxRetries) {
          lastError = {
            code: 'network_error',
            message: (err as Error).message,
            retryable: true,
            provider: config.provider,
          }
          continue
        }

        this.emitter.emit({
          type: 'error',
          error: lastError || {
            code: 'unknown',
            message: (err as Error).message,
            retryable: false,
            provider: config.provider,
          },
        })
        this._isStreaming = false
        throw err
      }
    }

    this._isStreaming = false
    return state.accumulated
  }

  destroy(): void {
    this.cancel()
    this.emitter.clear()
  }
}

/* ── Stats factory ─────────────────────────────────────── */

function createStats(): StreamStats {
  return {
    startTime: 0,
    firstTokenTime: null,
    endTime: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCharacters: 0,
    tokensPerSecond: 0,
    timeToFirstToken: null,
    totalDuration: null,
    toolCallCount: 0,
    retryCount: 0,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/* ── Cost Estimation ───────────────────────────────────── */

interface ModelPricing {
  inputPer1M: number
  outputPer1M: number
  cacheReadPer1M?: number
  cacheWritePer1M?: number
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  'claude-haiku-4-5': { inputPer1M: 0.8, outputPer1M: 4, cacheReadPer1M: 0.08, cacheWritePer1M: 1 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10 },
  'gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.6 },
}

export function estimateCost(model: string, stats: StreamStats): number {
  const pricing = MODEL_PRICING[model]
  if (!pricing) return 0

  let cost = 0
  cost += (stats.inputTokens / 1_000_000) * pricing.inputPer1M
  cost += (stats.outputTokens / 1_000_000) * pricing.outputPer1M

  if (pricing.cacheReadPer1M && stats.cacheReadTokens > 0) {
    cost += (stats.cacheReadTokens / 1_000_000) * pricing.cacheReadPer1M
  }
  if (pricing.cacheWritePer1M && stats.cacheWriteTokens > 0) {
    cost += (stats.cacheWriteTokens / 1_000_000) * pricing.cacheWritePer1M
  }

  return cost
}

export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${(cost * 100).toFixed(2)}¢`
  return `$${cost.toFixed(4)}`
}

export function formatTokenRate(tokensPerSecond: number): string {
  return `${tokensPerSecond.toFixed(1)} tok/s`
}

/* ── Multi-provider manager ────────────────────────────── */

export class AIProviderManager {
  private configs: Map<string, StreamConfig> = new Map()
  private activeStreams: Map<string, AIStreamController> = new Map()

  registerProvider(id: string, config: StreamConfig): void {
    this.configs.set(id, config)
  }

  removeProvider(id: string): void {
    this.configs.delete(id)
    this.activeStreams.get(id)?.destroy()
    this.activeStreams.delete(id)
  }

  getProvider(id: string): StreamConfig | undefined {
    return this.configs.get(id)
  }

  listProviders(): Array<{ id: string; provider: AIProvider; model: string }> {
    return [...this.configs.entries()].map(([id, config]) => ({
      id,
      provider: config.provider,
      model: config.model,
    }))
  }

  async stream(providerId: string, messages: StreamMessage[], handler: EventHandler): Promise<string> {
    const config = this.configs.get(providerId)
    if (!config) throw new Error(`Provider ${providerId} not registered`)

    const controller = new AIStreamController()
    this.activeStreams.set(providerId, controller)
    controller.on(handler)

    try {
      return await controller.stream(config, messages)
    } finally {
      this.activeStreams.delete(providerId)
    }
  }

  cancelStream(providerId: string): void {
    this.activeStreams.get(providerId)?.cancel()
  }

  cancelAll(): void {
    for (const controller of this.activeStreams.values()) {
      controller.cancel()
    }
  }

  clear(): void {
    this.cancelAll()
    this.configs.clear()
    this.activeStreams.clear()
  }
}

/* ── Singleton ─────────────────────────────────────────── */

let _instance: AIProviderManager | null = null

export function getAIProviderManager(): AIProviderManager {
  if (!_instance) _instance = new AIProviderManager()
  return _instance
}
