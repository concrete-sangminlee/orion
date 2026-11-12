/**
 * Inline AI edits: the editor's Ctrl+K widget and its Refactor / Add Comments /
 * Fix Issues actions.
 *
 * One request/response call per edit, through the chat's provider layer
 * (ai-client.ts callAI) with the model picked in the chat and no chat history.
 */
import type { InlineEditRequest, InlineEditResult } from '../../shared/ipc-contract'
import { callAI } from '../omo-bridge/ai-client'
import { handle } from '../ipc/typed-ipc'
import { getApiKeyStore } from '../secrets'

export const MAX_INSTRUCTION_CHARS = 4_000
/** The selection is never truncated: a reply to part of it would replace all of it. */
export const MAX_CODE_CHARS = 60_000
/** File text kept on each side of the selection. */
export const MAX_CONTEXT_CHARS = 8_000
/** Ends the spinner if the provider never answers; thinking models can take minutes. */
export const INLINE_EDIT_TIMEOUT_MS = 180_000

export class InvalidInlineEditRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidInlineEditRequestError'
  }
}

/** Validate an untrusted request from the renderer and bound its size. */
export function normalizeInlineEditRequest(raw: unknown): Required<InlineEditRequest> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvalidInlineEditRequestError('Inline edit request must be an object')
  }
  const { instruction, code, language, fileName, before, after, model } = raw as Record<string, unknown>
  if (typeof instruction !== 'string' || !instruction.trim()) {
    throw new InvalidInlineEditRequestError('An instruction is required')
  }
  if (instruction.length > MAX_INSTRUCTION_CHARS) {
    throw new InvalidInlineEditRequestError(`The instruction is longer than ${MAX_INSTRUCTION_CHARS} characters`)
  }
  if (typeof code !== 'string') throw new InvalidInlineEditRequestError('Code must be a string')
  if (code.length > MAX_CODE_CHARS) {
    throw new InvalidInlineEditRequestError(`The selection is too large for an inline edit (over ${MAX_CODE_CHARS} characters)`)
  }
  return {
    instruction: instruction.trim(),
    code,
    language: typeof language === 'string' && language ? language.slice(0, 40) : 'plaintext',
    fileName: typeof fileName === 'string' && fileName ? fileName.replace(/[\r\n]/g, ' ').slice(0, 200) : 'untitled',
    // Keep the text nearest the selection.
    before: typeof before === 'string' ? before.slice(-MAX_CONTEXT_CHARS) : '',
    after: typeof after === 'string' ? after.slice(0, MAX_CONTEXT_CHARS) : '',
    model: typeof model === 'string' && model ? model.slice(0, 100) : 'Ollama',
  }
}

/** Appended to the chat's system prompt for this call only. */
export const INLINE_EDIT_SYSTEM_PROMPT = `This request comes from the editor's inline edit, not the chat. The user message is a file in which <selection> and </selection> mark the code to change, or <cursor/> marks where new code goes, followed by an instruction. Reply with ONLY the code that replaces the selection (or is inserted at the cursor), exactly as it should appear in the file: no explanation, no markdown fences, and nothing from outside the selection. Keep the surrounding indentation and code style.`

export function buildInlineEditUserMessage(request: Required<InlineEditRequest>): string {
  const marked = request.code ? `<selection>${request.code}</selection>` : '<cursor/>'
  return `File: ${request.fileName} (${request.language})\n<file>\n${request.before}${marked}${request.after}\n</file>\n\nInstruction: ${request.instruction}`
}

/**
 * Turn the model's reply into the replacement text: unwrap a markdown fence or
 * echoed markers, and end it with the selection's own trailing whitespace so
 * accepting neither adds nor removes a line break.
 */
export function cleanInlineEditReply(raw: string, original: string): string {
  let text = raw.replace(/\r\n/g, '\n')
  const fenced = /^\s*```[\w+-]*\n([\s\S]*?)\n?```\s*$/.exec(text)
  if (fenced) text = fenced[1]
  else if (!original.includes('```')) {
    // The chat's base system prompt asks for markdown and explanations, so a
    // model may put prose around the code. With one code block, that block is
    // the edit. (Skipped when the selection has fences of its own: markdown.)
    const blocks = [...text.matchAll(/^```[\w+-]*\n([\s\S]*?)\n?^```[ \t]*$/gm)]
    if (blocks.length === 1) text = blocks[0][1]
  }
  const marked = /^\s*<selection>([\s\S]*)<\/selection>\s*$/.exec(text)
  if (marked) text = marked[1]
  const body = text.replace(/\s+$/, '')
  if (!body) return ''
  return body + original.slice(original.replace(/\s+$/, '').length)
}

/** One request to the model named in the chat's picker; null when no model can answer. */
export type CallModel = (
  model: string,
  message: string,
  options: { signal: AbortSignal; systemPrompt: string },
) => Promise<{ content: string } | null>

export interface InlineEditorDeps {
  callModel: CallModel
  timeoutMs?: number
}

export interface InlineEditor {
  /** `key` identifies the caller (a window): its newer request cancels its older one. */
  edit(rawRequest: unknown, key?: string | number): Promise<InlineEditResult>
}

export function createInlineEditor(deps: InlineEditorDeps): InlineEditor {
  const timeoutMs = deps.timeoutMs ?? INLINE_EDIT_TIMEOUT_MS
  const inFlight = new Map<string | number, AbortController>()

  return {
    async edit(rawRequest, key = 'default') {
      let request: Required<InlineEditRequest>
      try {
        request = normalizeInlineEditRequest(rawRequest)
      } catch (err) {
        return { error: (err as Error).message }
      }

      inFlight.get(key)?.abort()
      const controller = new AbortController()
      inFlight.set(key, controller)
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      try {
        const reply = await deps.callModel(request.model, buildInlineEditUserMessage(request), {
          signal: controller.signal,
          systemPrompt: INLINE_EDIT_SYSTEM_PROMPT,
        })
        controller.signal.throwIfAborted()
        if (!reply) {
          return { error: `No API key for ${request.model}. Add one in Settings, or run Ollama for a free local model.` }
        }
        const text = cleanInlineEditReply(reply.content, request.code)
        return text ? { text } : { error: 'The model returned no code' }
      } catch (err) {
        if (timedOut) return { error: `The AI did not answer within ${Math.round(timeoutMs / 1000)} seconds` }
        if (controller.signal.aborted) return { error: 'Cancelled by a newer inline edit' }
        return { error: `AI request failed: ${err instanceof Error ? err.message : String(err)}` }
      } finally {
        clearTimeout(timer)
        if (inFlight.get(key) === controller) inFlight.delete(key)
      }
    },
  }
}

/** What callAI returns for an empty OpenAI-compatible completion: a notice for the chat, not code. */
const EMPTY_COMPLETION_NOTICE = 'No response generated.'

/** Register `ai:edit`. Call once, after app 'ready' (the key store needs safeStorage). */
export function registerInlineEditHandlers(): void {
  const editor = createInlineEditor({
    // No `history`: an edit neither sees the chat nor becomes part of it.
    callModel: async (model, message, options) => {
      const reply = await callAI(model, message, getApiKeyStore().keys() as Record<string, string>, null, options)
      // Offered as an edit, the notice would replace the user's code.
      return reply?.content === EMPTY_COMPLETION_NOTICE ? { content: '' } : reply
    },
  })
  handle('ai:edit', (event, request: unknown) => editor.edit(request, event.sender.id))
}
