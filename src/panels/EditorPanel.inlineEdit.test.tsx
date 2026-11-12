/** @vitest-environment jsdom */
/**
 * Ctrl+I inline edit and the editor's AI edit actions, driven through
 * EditorPanel and the real widget against a fake Monaco: one text model per
 * path (kept across tab switches, like keepCurrentModel), the actions the
 * panel registers, and the edits it applies.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IRange } from 'monaco-editor'
import type { InlineEditResult } from '@shared/ipc-contract'
import type { OpenFile } from '@shared/types'
import { useChatStore } from '@/store/chat'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { CONTEXT_EDIT_ACTIONS } from '@/utils/inlineEdit'

interface FakeAction {
  id: string
  run: (editor: unknown) => unknown
}

interface FakeTextModel {
  getValue(): string
}

const fake = vi.hoisted(() => ({
  models: new Map<string, unknown>(),
  actions: new Map<string, { id: string; run: (editor: unknown) => unknown }>(),
  editor: null as unknown,
  selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
  undoStops: 0,
}))

vi.mock('@/monaco/setup', () => ({
  disposeModelsExcept: vi.fn(),
  modelPathFor: (p: string) => `file://${p}`,
}))

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react')

  // Stands in for every Monaco API the panel touches that these tests do not inspect.
  const anything: unknown = new Proxy(function () {}, {
    get: (_target, prop) => {
      if (prop === 'then') return undefined
      if (prop === Symbol.iterator) return function* () {}
      if (prop === Symbol.toPrimitive) return () => 0
      return anything
    },
    apply: () => anything,
    construct: () => anything as object,
  })
  const withFallback = <T extends object>(target: T): T =>
    new Proxy(target, { get: (t, prop) => (prop in t ? (t as Record<PropertyKey, unknown>)[prop] : anything) })

  type Pos = { lineNumber: number; column: number }
  const createModel = (uri: string, initial: string) => {
    let text = initial
    const offsetAt = ({ lineNumber, column }: Pos) =>
      text.split('\n').slice(0, lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0) + column - 1
    const start = (r: IRange) => offsetAt({ lineNumber: r.startLineNumber, column: r.startColumn })
    const end = (r: IRange) => offsetAt({ lineNumber: r.endLineNumber, column: r.endColumn })
    const model = withFallback({
      uri: { path: uri.replace(/^file:\/\//, ''), toString: () => uri },
      getValue: () => text,
      setValue: (v: string) => { text = v },
      getOffsetAt: offsetAt,
      getLanguageId: () => 'typescript',
      getValueInRange: (r: IRange) => text.slice(start(r), end(r)),
      applyEdit: (r: IRange, t: string) => { text = text.slice(0, start(r)) + t + text.slice(end(r)) },
      getFullModelRange: () => ({}),
    })
    fake.models.set(uri, model)
    return model
  }
  const textModel = (uri: string, initial: string) =>
    (fake.models.get(uri) as ReturnType<typeof createModel> | undefined) ?? createModel(uri, initial)

  function Editor(props: { path?: string; value?: string; onMount?: (editor: unknown, monaco: unknown) => void }) {
    const [, rerender] = React.useReducer((n: number) => n + 1, 0)
    const ref = React.useRef<{ model: ReturnType<typeof textModel> | null; api: unknown } | null>(null)
    if (!ref.current) {
      const state: { model: ReturnType<typeof textModel> | null; api: unknown } = { model: null, api: null }
      const api: unknown = withFallback({
        getModel: () => state.model,
        getSelection: () => ({
          ...fake.selection,
          getStartPosition: () => ({ lineNumber: fake.selection.startLineNumber, column: fake.selection.startColumn }),
        }),
        addAction: (action: FakeAction) => {
          fake.actions.set(action.id, action)
          return { dispose() {} }
        },
        getAction: (id: string) => {
          const action = fake.actions.get(id)
          return action ? { run: async () => action.run(api) } : null
        },
        executeEdits: (_source: string, edits: Array<{ range: IRange; text: string }>) => {
          for (const edit of edits) (state.model as unknown as { applyEdit: (r: IRange, t: string) => void }).applyEdit(edit.range, edit.text)
          return true
        },
        pushUndoStop: () => { fake.undoStops++; return true },
        getScrolledVisiblePosition: () => null,
        getDomNode: () => null,
        focus: () => {},
        hasTextFocus: () => false,
      })
      state.api = api
      ref.current = state
    }
    const state = ref.current

    React.useEffect(() => {
      state.model = textModel(props.path ?? '', props.value ?? '')
      fake.editor = state.api
      rerender()
      try {
        props.onMount?.(state.api, anything)
      } catch {
        // The panel's other provider registrations are not under test.
      }
    }, [])

    // A tab switch keeps the editor and swaps its model.
    React.useEffect(() => {
      if (state.model && state.model.uri.toString() !== props.path) {
        state.model = textModel(props.path ?? '', props.value ?? '')
        rerender()
      }
    }, [props.path])

    return React.createElement('div', { 'data-testid': 'monaco', 'data-path': props.path })
  }

  return { default: Editor, Editor, DiffEditor: () => null }
})

// Not under test, and they need layout APIs jsdom lacks or a live Monaco.
vi.mock('@/components/TabBar', () => ({ default: () => null }))
vi.mock('@/components/GhostTextProvider', () => ({ default: () => null }))
vi.mock('@/components/EmmetProvider', () => ({ default: () => null }))

import EditorPanel from './EditorPanel'

const file = (path: string, content: string): OpenFile => ({
  path,
  name: path.split('/').pop()!,
  content,
  language: 'typescript',
  isModified: false,
  aiModified: false,
})

function openFiles(files: OpenFile[], activeFilePath = files[0]?.path ?? null) {
  useEditorStore.setState({ openFiles: files, activeFilePath, previewPath: null, pinnedTabs: [], tabHistory: [] })
}

let aiEdit: ReturnType<typeof vi.fn<(request: unknown) => Promise<InlineEditResult>>>

async function renderPanel() {
  await act(async () => {
    render(<EditorPanel />)
  })
}

async function runAction(id: string) {
  const action = fake.actions.get(id)
  if (!action) throw new Error(`the panel did not register ${id}`)
  await act(async () => {
    await action.run(fake.editor)
  })
}

const modelText = (path: string) => (fake.models.get(`file://${path}`) as FakeTextModel).getValue()
const toastMessages = () => useToastStore.getState().toasts.map((t) => t.message)

beforeEach(() => {
  fake.models.clear()
  fake.actions.clear()
  fake.editor = null
  fake.undoStops = 0
  localStorage.clear()
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  aiEdit = vi.fn()
  ;(window as unknown as { api: unknown }).api = {
    aiEdit,
    writeFile: vi.fn().mockResolvedValue({ success: true }),
    readFile: vi.fn(),
    saveFileDialog: vi.fn().mockResolvedValue(null),
  }
  useToastStore.setState({ toasts: [] })
  useChatStore.setState({ selectedModel: 'Claude Opus 5.5' })
})

afterEach(() => {
  cleanup()
})

describe('EditorPanel inline AI edits', () => {
  it('answers "AI: Refactor Selection" in the editor and applies the accepted edit', async () => {
    openFiles([file('/w/a.ts', 'let x = 1\nexport {}\n')])
    await renderPanel()
    fake.selection = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 }
    aiEdit.mockResolvedValue({ text: 'const x = 1' })

    await runAction('orion-ai-refactor')

    expect(aiEdit).toHaveBeenCalledWith(expect.objectContaining({
      instruction: CONTEXT_EDIT_ACTIONS[0].instruction,
      code: 'let x = 1',
      fileName: 'a.ts',
      model: 'Claude Opus 5.5',
    }))
    expect(screen.getByText('AI Edit Preview')).toBeTruthy()

    fake.undoStops = 0
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    })

    expect(modelText('/w/a.ts')).toBe('const x = 1\nexport {}\n')
    expect(fake.undoStops).toBe(2)
    expect(toastMessages()).toContain('AI edit applied')
    expect(screen.queryByText('AI Edit Preview')).toBeNull()
  })

  it('refuses to apply the edit once the selected code was changed meanwhile', async () => {
    openFiles([file('/w/a.ts', 'let x = 1\n')])
    await renderPanel()
    fake.selection = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 }
    aiEdit.mockResolvedValue({ text: 'const x = 1' })
    await runAction('orion-ai-refactor')

    // The user edits the selected line while the preview is shown.
    ;(fake.models.get('file:///w/a.ts') as { setValue(v: string): void }).setValue('let z = 9\n')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    })

    expect(modelText('/w/a.ts')).toBe('let z = 9\n')
    expect(toastMessages()).toContain('The code changed after the edit was requested, so it was not applied')
  })

  it('closes the widget on a tab switch and drops the reply that arrives afterwards', async () => {
    openFiles([file('/w/a.ts', 'let x = 1\n'), file('/w/b.ts', 'let y = 2\n')])
    await renderPanel()
    fake.selection = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 }
    let answer: (result: InlineEditResult) => void = () => {}
    aiEdit.mockImplementation(() => new Promise((resolve) => { answer = resolve }))

    await runAction('orion-ai-fix-issues')
    expect(screen.getByText('Generating...')).toBeTruthy()

    await act(async () => {
      useEditorStore.setState({ activeFilePath: '/w/b.ts' })
    })
    expect(screen.queryByText('Generating...')).toBeNull()

    await act(async () => {
      answer({ text: 'const x = 1' })
    })
    expect(screen.queryByText('AI Edit Preview')).toBeNull()
    expect(modelText('/w/a.ts')).toBe('let x = 1\n')
    expect(modelText('/w/b.ts')).toBe('let y = 2\n')
  })

  it('does not offer a reply to an earlier opening for the code the widget was reopened on', async () => {
    openFiles([file('/w/a.ts', 'let x = 1\nlet y = 2\n')])
    await renderPanel()
    let answer: (result: InlineEditResult) => void = () => {}
    aiEdit.mockImplementation(() => new Promise((resolve) => { answer = resolve }))
    fake.selection = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 }
    await runAction('orion-ai-add-comments')

    // Ctrl+I on the next line while the first reply is still out.
    fake.selection = { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 10 }
    await runAction('orion-inline-edit')
    await act(async () => {
      answer({ text: '// x\nlet x = 1' })
    })

    expect(screen.getByText('Edit with AI')).toBeTruthy()
    expect(screen.queryByText('AI Edit Preview')).toBeNull()
  })

  it('offers no model choice or Refine step that the edit would ignore', async () => {
    openFiles([file('/w/a.ts', 'let x = 1\n')])
    await renderPanel()
    fake.selection = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 }
    await runAction('orion-inline-edit')

    // The edit runs on the chat's model, so the widget names no other.
    const buttonTexts = () => screen.getAllByRole('button').map((b) => b.textContent ?? '')
    expect(buttonTexts().filter((t) => /GPT|Claude|Sonnet|Opus/.test(t))).toEqual([])

    let answer: (result: InlineEditResult) => void = () => {}
    aiEdit.mockImplementation(() => new Promise((resolve) => { answer = resolve }))
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Use const' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    })
    expect(screen.getByText('Editing 1 line')).toBeTruthy()

    await act(async () => {
      answer({ text: 'const x = 1' })
    })
    expect(screen.getByText('AI Edit Preview')).toBeTruthy()
    // Refine left the widget empty; Accept and Reject are the choices.
    expect(screen.queryByRole('button', { name: /Refine/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy()
  })

  it('opens the inline edit widget from the command palette', async () => {
    openFiles([file('/w/a.ts', 'let x = 1\n')])
    await renderPanel()

    await act(async () => {
      window.dispatchEvent(new Event('orion:inline-edit'))
    })

    expect(screen.getByText('Edit with AI')).toBeTruthy()
    expect(aiEdit).not.toHaveBeenCalled()
  })
})
