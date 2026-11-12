/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { editor as MonacoEditor, IRange } from 'monaco-editor'
import {
  CONTEXT_EDIT_ACTIONS,
  INLINE_EDIT_COMMAND_EVENT,
  applyInlineEdit,
  buildInlineEditRequest,
  canApplyInlineEdit,
  createRequestGate,
  onInlineEditCommand,
  registerInlineEditActions,
  requestInlineEdit,
} from './inlineEdit'

/** A text model over `text`, with offsets the way Monaco counts them (1-based lines and columns). */
function fakeModel(text: string, languageId = 'typescript') {
  const lines = text.split('\n')
  const getOffsetAt = ({ lineNumber, column }: { lineNumber: number; column: number }) =>
    lines.slice(0, lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0) + column - 1
  return {
    getValue: () => text,
    getOffsetAt,
    getLanguageId: () => languageId,
    getValueInRange: (r: IRange) =>
      text.slice(getOffsetAt({ lineNumber: r.startLineNumber, column: r.startColumn }), getOffsetAt({ lineNumber: r.endLineNumber, column: r.endColumn })),
  }
}

const range = (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number): IRange => ({
  startLineNumber,
  startColumn,
  endLineNumber,
  endColumn,
})

type Action = Parameters<MonacoEditor.IStandaloneCodeEditor['addAction']>[0]

function registeredActions() {
  const actions = new Map<string, Action>()
  const handlers = { open: vi.fn(() => true), submit: vi.fn() }
  registerInlineEditActions({ addAction: (a: Action) => (actions.set(a.id, a), { dispose() {} }) } as never, 2089, handlers)
  return { actions, handlers }
}

/** A Monaco editor with `text` loaded and `sel` selected, as an action's `run` receives it. */
const fakeEd = (text: string, sel: IRange) => ({ getSelection: () => sel, getModel: () => fakeModel(text) }) as unknown as MonacoEditor.ICodeEditor

describe('registerInlineEditActions', () => {
  it('binds Ctrl+K to opening the widget without submitting anything', () => {
    const { actions, handlers } = registeredActions()
    const ctrlK = actions.get('orion-inline-edit')!
    expect(ctrlK.keybindings).toEqual([2089])
    ctrlK.run(fakeEd('let x = 1', range(1, 1, 1, 1)))
    expect(handlers.open).toHaveBeenCalledTimes(1)
    expect(handlers.submit).not.toHaveBeenCalled()
  })

  it('answers Refactor / Add Comments / Fix Issues in the editor widget with their instruction', () => {
    const { actions, handlers } = registeredActions()
    for (const { id, instruction } of CONTEXT_EDIT_ACTIONS) {
      const action = actions.get(id)!
      expect(action.contextMenuGroupId).toBe('9_ai')
      action.run(fakeEd('let x = 1', range(1, 1, 1, 10)))
      expect(handlers.submit).toHaveBeenLastCalledWith(instruction)
    }
    expect(handlers.open).toHaveBeenCalledTimes(3)
    expect(CONTEXT_EDIT_ACTIONS.map((a) => a.id)).toEqual(['orion-ai-refactor', 'orion-ai-add-comments', 'orion-ai-fix-issues'])
  })

  it('does nothing for a blank selection, or when the widget could not open', () => {
    const { actions, handlers } = registeredActions()
    actions.get('orion-ai-refactor')!.run(fakeEd('a\n   \nb', range(2, 1, 2, 4)))
    expect(handlers.open).not.toHaveBeenCalled()
    handlers.open.mockReturnValueOnce(false)
    actions.get('orion-ai-refactor')!.run(fakeEd('let x = 1', range(1, 1, 1, 10)))
    expect(handlers.submit).not.toHaveBeenCalled()
  })
})

describe('onInlineEditCommand', () => {
  it('runs the handler for the command palette event until unsubscribed', () => {
    const handler = vi.fn()
    const off = onInlineEditCommand(handler)
    window.dispatchEvent(new CustomEvent(INLINE_EDIT_COMMAND_EVENT))
    off()
    window.dispatchEvent(new CustomEvent(INLINE_EDIT_COMMAND_EVENT))
    expect(INLINE_EDIT_COMMAND_EVENT).toBe('orion:inline-edit')
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe('buildInlineEditRequest', () => {
  it('sends the selection, the text around it and the chat-selected model', () => {
    const model = fakeModel('import a\nlet x = 1\nexport {}\n')
    expect(buildInlineEditRequest(model, range(2, 5, 2, 6), { instruction: 'rename', filePath: '/ws/src/a.ts', chatModel: 'Claude Opus 5.5' })).toEqual({
      instruction: 'rename',
      code: 'x',
      language: 'typescript',
      fileName: 'a.ts',
      before: 'import a\nlet ',
      after: ' = 1\nexport {}\n',
      model: 'Claude Opus 5.5',
    })
  })

  it('sends an empty selection (generate at the cursor) and bounds the context', () => {
    const model = fakeModel('a'.repeat(9_000) + 'b'.repeat(9_000), 'python')
    const request = buildInlineEditRequest(model, range(1, 9_001, 1, 9_001), { instruction: 'gen', filePath: 'C:\\ws\\m.py', chatModel: 'Ollama' })
    expect(request.code).toBe('')
    expect(request.fileName).toBe('m.py')
    expect(request.before).toBe('a'.repeat(8_000))
    expect(request.after).toBe('b'.repeat(8_000))
  })
})

describe('requestInlineEdit', () => {
  afterEach(() => {
    delete (window as { api?: unknown }).api
  })

  it('returns the main process answer from ai:edit', async () => {
    const aiEdit = vi.fn(async () => ({ text: 'let count = 1' }))
    Object.assign(window, { api: { aiEdit } })
    const request = { instruction: 'rename', code: 'let x = 1', language: 'typescript', fileName: 'a.ts' }
    await expect(requestInlineEdit(request)).resolves.toEqual({ text: 'let count = 1' })
    expect(aiEdit).toHaveBeenCalledWith(request)
  })

  it('turns a failed IPC call into an error result instead of throwing', async () => {
    Object.assign(window, { api: { aiEdit: vi.fn(async () => { throw new Error("Error invoking remote method 'ai:edit': Error: No handler registered") }) } })
    await expect(requestInlineEdit({ instruction: 'x', code: '', language: 'ts', fileName: 'a.ts' })).resolves.toEqual({ error: 'No handler registered' })
  })
})

describe('createRequestGate', () => {
  it('treats only the newest request as current, and none after cancel', () => {
    const gate = createRequestGate()
    const first = gate.start()
    const second = gate.start()
    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(second)).toBe(true)
    gate.cancel()
    expect(gate.isCurrent(second)).toBe(false)
  })
})

describe('canApplyInlineEdit', () => {
  const model = fakeModel('let x = 1\n') as unknown as MonacoEditor.ITextModel
  const sel = range(1, 1, 1, 10)

  it('allows the edit while the same model shows the original text', () => {
    expect(canApplyInlineEdit(model, model, sel, 'let x = 1')).toBe(true)
  })

  it('refuses after a tab switch or when the selected code changed', () => {
    const other = fakeModel('let x = 1\n') as unknown as MonacoEditor.ITextModel
    expect(canApplyInlineEdit(other, model, sel, 'let x = 1')).toBe(false)
    expect(canApplyInlineEdit(model, model, sel, 'let y = 2')).toBe(false)
    expect(canApplyInlineEdit(model, null, sel, 'let x = 1')).toBe(false)
    expect(canApplyInlineEdit(model, model, null, 'let x = 1')).toBe(false)
  })
})

describe('applyInlineEdit', () => {
  it('applies the edit as its own undo step', () => {
    const calls: string[] = []
    const editor = {
      pushUndoStop: () => (calls.push('stop'), true),
      executeEdits: (source: string, edits: Array<{ range: IRange; text: string }>) => (calls.push(`${source}:${edits[0].text}`), true),
    }
    applyInlineEdit(editor, range(1, 1, 1, 10), 'let count = 1')
    expect(calls).toEqual(['stop', 'orion-inline-edit:let count = 1', 'stop'])
  })
})
