import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  keys: vi.fn((): Record<string, string> => ({})),
  anthropicCreate: vi.fn(),
  openaiCreate: vi.fn(),
}))

vi.mock('../ipc/typed-ipc', () => ({ handle: mocks.handle }))
vi.mock('../secrets', () => ({ getApiKeyStore: () => ({ keys: mocks.keys }) }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.anthropicCreate }
  },
}))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.openaiCreate } }
  },
}))

import {
  INLINE_EDIT_SYSTEM_PROMPT,
  MAX_CODE_CHARS,
  MAX_CONTEXT_CHARS,
  buildInlineEditUserMessage,
  cleanInlineEditReply,
  createInlineEditor,
  normalizeInlineEditRequest,
  registerInlineEditHandlers,
  type CallModel,
} from './inline-edit'

const request = (overrides: Record<string, unknown> = {}) => ({
  instruction: 'Rename x to count',
  code: 'let x = 1\n',
  language: 'typescript',
  fileName: 'a.ts',
  before: 'const a = 0\n',
  after: 'export {}\n',
  model: 'Claude Opus 5.5',
  ...overrides,
})

const replying = (content: string | null) => vi.fn<CallModel>(async () => (content === null ? null : { content }))

/** A model call that only ends when its signal aborts. */
const hanging = () =>
  vi.fn<CallModel>((_model, _message, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))))

describe('normalizeInlineEditRequest', () => {
  it('rejects requests that are not objects or lack an instruction or code', () => {
    expect(() => normalizeInlineEditRequest(null)).toThrow(/object/)
    expect(() => normalizeInlineEditRequest(['x'])).toThrow(/object/)
    expect(() => normalizeInlineEditRequest(request({ instruction: '   ' }))).toThrow(/instruction/)
    expect(() => normalizeInlineEditRequest(request({ instruction: 42 }))).toThrow(/instruction/)
    expect(() => normalizeInlineEditRequest(request({ code: { evil: true } }))).toThrow(/Code/)
  })

  it('refuses an oversized selection instead of truncating it', () => {
    expect(() => normalizeInlineEditRequest(request({ code: 'x'.repeat(MAX_CODE_CHARS + 1) }))).toThrow(/too large/)
    expect(normalizeInlineEditRequest(request({ code: 'x'.repeat(MAX_CODE_CHARS) })).code).toHaveLength(MAX_CODE_CHARS)
  })

  it('keeps the context nearest the selection and sanitises the rest', () => {
    const normalized = normalizeInlineEditRequest(
      request({ before: 'A'.repeat(10) + 'b'.repeat(MAX_CONTEXT_CHARS), after: 'c'.repeat(MAX_CONTEXT_CHARS) + 'Z', fileName: 'a\nb.ts', model: undefined, language: 7 }),
    )
    expect(normalized.before).toBe('b'.repeat(MAX_CONTEXT_CHARS))
    expect(normalized.after).toBe('c'.repeat(MAX_CONTEXT_CHARS))
    expect(normalized.fileName).toBe('a b.ts')
    expect(normalized.model).toBe('Ollama')
    expect(normalized.language).toBe('plaintext')
  })
})

describe('prompt and reply', () => {
  it('marks the selection, or the cursor when nothing is selected', () => {
    const withSelection = buildInlineEditUserMessage(normalizeInlineEditRequest(request()))
    expect(withSelection).toContain('const a = 0\n<selection>let x = 1\n</selection>export {}\n')
    expect(withSelection).toMatch(/Instruction: Rename x to count$/)
    expect(buildInlineEditUserMessage(normalizeInlineEditRequest(request({ code: '' })))).toContain('const a = 0\n<cursor/>export {}\n')
  })

  it('unwraps fences and markers and keeps the selection\'s trailing line break', () => {
    expect(cleanInlineEditReply('```ts\nlet count = 1\n```', 'let x = 1\n')).toBe('let count = 1\n')
    expect(cleanInlineEditReply('<selection>let count = 1</selection>', 'let x = 1')).toBe('let count = 1')
    expect(cleanInlineEditReply('  let count = 1\n\n', '  let x = 1')).toBe('  let count = 1')
    expect(cleanInlineEditReply('\n  \n', 'let x = 1\n')).toBe('')
  })

  it('keeps only the code when the model puts prose around one code block', () => {
    const chatty = '다음은 수정된 코드입니다:\n\n```ts\nlet count = 1\n```\n\n`x`를 `count`로 바꿨습니다.'
    expect(cleanInlineEditReply(chatty, 'let x = 1\n')).toBe('let count = 1\n')
    // Two blocks: no telling which is the edit, so the preview shows it all.
    const two = 'A:\n```ts\na\n```\nB:\n```ts\nb\n```'
    expect(cleanInlineEditReply(two, 'x')).toBe(two)
    // A markdown selection with fences of its own is replaced as written.
    const markdown = 'Install:\n\n```sh\nnpm i\n```\n'
    expect(cleanInlineEditReply(markdown, 'Setup:\n\n```sh\nnpm ci\n```\n')).toBe(markdown)
  })
})

describe('createInlineEditor', () => {
  afterEach(() => vi.useRealTimers())

  it('answers with the replacement from the chat-selected model', async () => {
    const callModel = replying('```ts\nlet count = 1\n```')
    const result = await createInlineEditor({ callModel }).edit(request())

    expect(result).toEqual({ text: 'let count = 1\n' })
    expect(callModel).toHaveBeenCalledTimes(1)
    const [model, message, options] = callModel.mock.calls[0]
    expect(model).toBe('Claude Opus 5.5')
    expect(message).toContain('<selection>let x = 1\n</selection>')
    expect(options.systemPrompt).toBe(INLINE_EDIT_SYSTEM_PROMPT)
  })

  it('returns validation errors without calling a model', async () => {
    const callModel = replying('x')
    await expect(createInlineEditor({ callModel }).edit({ code: 'x' })).resolves.toEqual({ error: 'An instruction is required' })
    expect(callModel).not.toHaveBeenCalled()
  })

  it('says why when no model can answer, or the reply holds no code', async () => {
    await expect(createInlineEditor({ callModel: replying(null) }).edit(request())).resolves.toEqual({
      error: expect.stringMatching(/No API key for Claude Opus 5\.5/),
    })
    await expect(createInlineEditor({ callModel: replying(' \n') }).edit(request())).resolves.toEqual({ error: 'The model returned no code' })
  })

  it('reports provider failures', async () => {
    const callModel = vi.fn<CallModel>(async () => { throw new Error('401 invalid x-api-key') })
    await expect(createInlineEditor({ callModel }).edit(request())).resolves.toEqual({ error: 'AI request failed: 401 invalid x-api-key' })
  })

  it('times out a model that never answers and aborts its request', async () => {
    vi.useFakeTimers()
    const callModel = hanging()
    const pending = createInlineEditor({ callModel, timeoutMs: 5_000 }).edit(request())
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(pending).resolves.toEqual({ error: 'The AI did not answer within 5 seconds' })
    expect(callModel.mock.calls[0][2].signal.aborted).toBe(true)
  })

  it('cancels a caller\'s older request when it sends a newer one, but not other callers\'', async () => {
    const slow = hanging()
    const callModel = vi.fn<CallModel>((model, message, options) => (message.includes('first') ? slow(model, message, options) : Promise.resolve({ content: 'done' })))
    const editor = createInlineEditor({ callModel })
    const first = editor.edit(request({ instruction: 'first' }), 1)
    await expect(editor.edit(request({ instruction: 'other window' }), 2)).resolves.toEqual({ text: 'done\n' })
    expect(slow.mock.calls[0][2].signal.aborted).toBe(false)
    await expect(editor.edit(request({ instruction: 'second' }), 1)).resolves.toEqual({ text: 'done\n' })
    await expect(first).resolves.toEqual({ error: 'Cancelled by a newer inline edit' })
  })
})

describe('registerInlineEditHandlers', () => {
  beforeEach(() => {
    mocks.handle.mockReset()
    mocks.anthropicCreate.mockReset()
    mocks.openaiCreate.mockReset()
  })

  function registeredHandler() {
    registerInlineEditHandlers()
    expect(mocks.handle).toHaveBeenCalledWith('ai:edit', expect.any(Function))
    return mocks.handle.mock.calls[0][1] as (event: unknown, request: unknown) => Promise<unknown>
  }

  it('validates what the renderer sends', async () => {
    await expect(registeredHandler()({ sender: { id: 7 } }, 'not a request')).resolves.toEqual({ error: 'Inline edit request must be an object' })
  })

  it('calls the chat-selected model with the stored key and no chat history', async () => {
    mocks.keys.mockReturnValue({ anthropic: 'sk-ant' })
    mocks.anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: 'let count = 1' }] })

    await expect(registeredHandler()({ sender: { id: 7 } }, request())).resolves.toEqual({ text: 'let count = 1\n' })
    const [body] = mocks.anthropicCreate.mock.calls[0]
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.system).toContain(INLINE_EDIT_SYSTEM_PROMPT)
    expect(body.messages).toEqual([{ role: 'user', content: expect.stringContaining('<selection>let x = 1\n</selection>') }])
  })

  it('reports an empty completion instead of offering the chat\'s placeholder as code', async () => {
    mocks.keys.mockReturnValue({ openai: 'sk-test' })
    mocks.openaiCreate.mockResolvedValue({ choices: [{ message: { content: '' }, finish_reason: 'length' }] })

    await expect(registeredHandler()({ sender: { id: 7 } }, request({ model: 'GPT-6.1 Sol' }))).resolves.toEqual({
      error: 'The model returned no code',
    })
    expect(mocks.openaiCreate).toHaveBeenCalledTimes(1)
  })

  it('reports a model without a key instead of answering', async () => {
    mocks.keys.mockReturnValue({})
    await expect(registeredHandler()({ sender: { id: 7 } }, request())).resolves.toEqual({ error: expect.stringMatching(/No API key/) })
    expect(mocks.anthropicCreate).not.toHaveBeenCalled()
  })
})
