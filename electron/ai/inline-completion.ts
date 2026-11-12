/**
 * Inline ("ghost text") code completion.
 *
 * The editor asks for the text to insert at the caret, given what is before
 * and after it. Two providers:
 *
 *  - `ollama` (default): a local model, free. Uses Ollama's fill-in-the-middle
 *    endpoint when the model supports it and falls back to a chat prompt.
 *  - `anthropic`: Claude Haiku 5.5 with the user's stored API key. Only used
 *    when the user selects it in Settings, because every typing pause is a
 *    billed request.
 *
 * A new request cancels the one in flight, so a fast typist never has more
 * than one request running. Pure module: network and SDK access are injected.
 */
import type { InlineCompletionRequest, InlineCompletionResult } from '../../shared/ipc-contract'

/** The cloud model for inline completion; chosen by the user in Settings. */
export const ANTHROPIC_COMPLETION_MODEL = 'claude-haiku-5-5'

const MAX_PREFIX_CHARS = 12_000
const MAX_SUFFIX_CHARS = 4_000
const DEFAULT_MAX_TOKENS = 128
const MIN_MAX_TOKENS = 16
const MAX_MAX_TOKENS = 512
const REQUEST_TIMEOUT_MS = 12_000
const OLLAMA_TAGS_TTL_MS = 30_000
const CURSOR = '<CURSOR/>'

export class InvalidCompletionRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidCompletionRequestError'
  }
}

/** Validate an untrusted request from the renderer and bound its size. */
export function normalizeCompletionRequest(raw: unknown): InlineCompletionRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvalidCompletionRequestError('Completion request must be an object')
  }
  const { provider, prefix, suffix, language, fileName, maxTokens } = raw as Record<string, unknown>
  if (provider !== 'ollama' && provider !== 'anthropic') {
    throw new InvalidCompletionRequestError('Unknown completion provider')
  }
  if (typeof prefix !== 'string' || typeof suffix !== 'string') {
    throw new InvalidCompletionRequestError('Completion prefix and suffix must be strings')
  }
  const tokens = typeof maxTokens === 'number' && Number.isFinite(maxTokens) ? Math.floor(maxTokens) : DEFAULT_MAX_TOKENS
  return {
    provider,
    // Keep the text nearest the caret.
    prefix: prefix.slice(-MAX_PREFIX_CHARS),
    suffix: suffix.slice(0, MAX_SUFFIX_CHARS),
    language: typeof language === 'string' ? language.slice(0, 40) : 'plaintext',
    fileName: typeof fileName === 'string' ? fileName.replace(/[\r\n]/g, ' ').slice(0, 200) : 'untitled',
    maxTokens: Math.min(MAX_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, tokens)),
  }
}

const CODE_MODEL_HINTS = ['qwen2.5-coder', 'qwen3-coder', 'codellama', 'deepseek-coder', 'starcoder', 'codegemma', 'codestral', 'coder', 'code']

/** Prefer an installed code model; otherwise the first installed model. */
export function pickOllamaModel(installed: readonly string[]): string | null {
  for (const hint of CODE_MODEL_HINTS) {
    const match = installed.find((name) => name.toLowerCase().includes(hint))
    if (match) return match
  }
  return installed[0] ?? null
}

export const COMPLETION_SYSTEM_PROMPT = `You are a code completion engine inside an editor. The user message is a source file in which ${CURSOR} marks the caret. Reply with ONLY the text to insert at the caret: no explanation, no markdown fences, and nothing that is already present before or after the caret. Keep it short: finish the current statement or block. If nothing should be inserted, reply with an empty message.`

export function buildCompletionUserMessage(request: InlineCompletionRequest): string {
  return `File: ${request.fileName} (${request.language})\n\n${request.prefix}${CURSOR}${request.suffix}`
}

/**
 * Turn a raw model reply into insertable text: unwrap a markdown fence, drop
 * an echoed caret marker, and remove text the model repeated from around the
 * caret.
 */
export function cleanCompletion(raw: string, context: Pick<InlineCompletionRequest, 'prefix' | 'suffix'>): string {
  let text = raw.replace(/\r\n/g, '\n')

  const fenced = /^\s*```[\w+-]*\n([\s\S]*?)\n?```\s*$/.exec(text)
  if (fenced) text = fenced[1]

  text = text.split(CURSOR).join('').split('<CURSOR>').join('')

  // The model repeated what is already on the caret's line.
  const linePrefix = context.prefix.slice(context.prefix.lastIndexOf('\n') + 1)
  if (linePrefix.trim().length >= 3 && text.startsWith(linePrefix)) text = text.slice(linePrefix.length)

  // The model continued into text that already follows the caret.
  const nextLine = context.suffix
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length >= 6)
  if (nextLine) {
    const lines = text.split('\n')
    const at = lines.findIndex((line) => line.trim() === nextLine)
    if (at >= 0) text = lines.slice(0, at).join('\n')
  }

  return text.replace(/\s+$/, '')
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

/** The slice of the Anthropic SDK client this module uses. */
export interface AnthropicLike {
  messages: {
    create(
      body: {
        model: string
        max_tokens: number
        thinking: { type: 'disabled' }
        system: string
        messages: Array<{ role: 'user'; content: string }>
      },
      options?: { signal?: AbortSignal; timeout?: number; maxRetries?: number },
    ): Promise<{ stop_reason: string | null; content: Array<{ type: string; text?: string }> }>
  }
}

export interface InlineCompleterDeps {
  fetch: FetchLike
  ollamaHost?: string
  /** The stored Anthropic key, if the user configured one. */
  getAnthropicKey: () => string | undefined
  createAnthropic: (apiKey: string) => Promise<AnthropicLike> | AnthropicLike
  now?: () => number
}

export interface InlineCompleter {
  complete(rawRequest: unknown): Promise<InlineCompletionResult>
  cancel(): void
}

export function createInlineCompleter(deps: InlineCompleterDeps): InlineCompleter {
  const host = (deps.ollamaHost ?? 'http://localhost:11434').replace(/\/+$/, '')
  const now = deps.now ?? (() => Date.now())
  let inFlight: AbortController | null = null
  let ollamaTags: { at: number; models: string[] } | null = null

  async function installedOllamaModels(signal: AbortSignal): Promise<string[]> {
    if (ollamaTags && now() - ollamaTags.at < OLLAMA_TAGS_TTL_MS) return ollamaTags.models
    let models: string[] = []
    try {
      const response = await deps.fetch(`${host}/api/tags`, { signal })
      if (response.ok) {
        const body = (await response.json()) as { models?: Array<{ name?: string }> }
        models = (body.models ?? []).map((model) => model.name).filter((name): name is string => typeof name === 'string')
      }
    } catch {
      // Not running: remembered below so we do not probe on every keystroke.
    }
    ollamaTags = { at: now(), models }
    return models
  }

  async function postJson(path: string, body: unknown, signal: AbortSignal) {
    const response = await deps.fetch(`${host}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    return { ok: response.ok, status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> }
  }

  async function completeWithOllama(request: InlineCompletionRequest, signal: AbortSignal): Promise<InlineCompletionResult> {
    const model = pickOllamaModel(await installedOllamaModels(signal))
    if (!model) return { text: '', reason: 'Ollama is not running or has no models installed' }
    const options = { temperature: 0.2, num_predict: request.maxTokens }

    // Fill-in-the-middle: supported by code models (qwen2.5-coder, codellama:code, ...).
    const fim = await postJson('/api/generate', { model, prompt: request.prefix, suffix: request.suffix, stream: false, options }, signal)
    if (fim.ok && typeof fim.body.response === 'string') {
      return { text: cleanCompletion(fim.body.response, request), model }
    }

    // Chat models reject `suffix`; ask the same question as a chat prompt.
    const chat = await postJson(
      '/api/chat',
      {
        model,
        stream: false,
        options,
        messages: [
          { role: 'system', content: COMPLETION_SYSTEM_PROMPT },
          { role: 'user', content: buildCompletionUserMessage(request) },
        ],
      },
      signal,
    )
    const content = (chat.body.message as { content?: unknown } | undefined)?.content
    if (chat.ok && typeof content === 'string') return { text: cleanCompletion(content, request), model }
    return { text: '', model, reason: `Ollama request failed (${chat.status})` }
  }

  async function completeWithAnthropic(request: InlineCompletionRequest, signal: AbortSignal): Promise<InlineCompletionResult> {
    const apiKey = deps.getAnthropicKey()
    if (!apiKey) return { text: '', reason: 'No Anthropic API key is configured' }
    const client = await deps.createAnthropic(apiKey)
    const response = await client.messages.create(
      {
        model: ANTHROPIC_COMPLETION_MODEL,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        // Latency matters more than depth here; Haiku 5.5 thinks by default.
        thinking: { type: 'disabled' },
        system: COMPLETION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildCompletionUserMessage(request) }],
      },
      { signal, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 },
    )
    if (response.stop_reason === 'refusal') return { text: '', model: ANTHROPIC_COMPLETION_MODEL, reason: 'The model declined this request' }
    const text = response.content.map((block) => (block.type === 'text' && block.text ? block.text : '')).join('')
    return { text: cleanCompletion(text, request), model: ANTHROPIC_COMPLETION_MODEL }
  }

  return {
    async complete(rawRequest) {
      let request: InlineCompletionRequest
      try {
        request = normalizeCompletionRequest(rawRequest)
      } catch (err) {
        return { text: '', reason: (err as Error).message }
      }

      inFlight?.abort()
      const controller = new AbortController()
      inFlight = controller
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const result =
          request.provider === 'anthropic'
            ? await completeWithAnthropic(request, controller.signal)
            : await completeWithOllama(request, controller.signal)
        // A newer request superseded this one while it was finishing.
        return controller.signal.aborted ? { text: '', reason: 'cancelled' } : result
      } catch (err) {
        if (controller.signal.aborted) return { text: '', reason: 'cancelled' }
        return { text: '', reason: err instanceof Error ? err.message : String(err) }
      } finally {
        clearTimeout(timer)
        if (inFlight === controller) inFlight = null
      }
    },
    cancel() {
      inFlight?.abort()
    },
  }
}
