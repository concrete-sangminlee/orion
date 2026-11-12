/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { monaco } = vi.hoisted(() => ({ monaco: { current: null as unknown } }))
vi.mock('@monaco-editor/react', () => ({ loader: { __getMonacoInstance: () => monaco.current } }))

import { activeCodeEditor, runEditCommand, runEditorAction, runEditorActionAtSymbol } from './editor'
import { listenForSymbolRequests } from './useCommandBridges'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'

function fakeEditor(filePath: string, { focused = false, lines = ['const answer = 42'] } = {}) {
  const node = document.createElement('div')
  document.body.appendChild(node)
  const action = { isSupported: vi.fn(() => true), run: vi.fn(async () => {}) }
  return {
    action,
    getModel: () => ({
      uri: { toString: () => `file://${filePath}` },
      getLineCount: () => lines.length,
      getLineContent: (n: number) => lines[n - 1],
    }),
    getDomNode: () => node,
    hasTextFocus: () => focused,
    hasWidgetFocus: () => false,
    getAction: vi.fn((_id: string) => action as typeof action | null),
    focus: vi.fn(),
    trigger: vi.fn(),
    setSelection: vi.fn(),
    revealLineInCenter: vi.fn(),
  }
}

function useEditors(...editors: ReturnType<typeof fakeEditor>[]) {
  monaco.current = {
    editor: { getEditors: () => editors },
    Uri: { file: (p: string) => ({ toString: () => `file://${p}` }) },
  }
}

const lastToast = () => useToastStore.getState().notifications[0]?.message

beforeEach(() => {
  document.body.innerHTML = ''
  useToastStore.setState({ toasts: [], queuedToasts: [], notifications: [] })
  useEditorStore.setState({ activeFilePath: '/ws/b.ts' })
  monaco.current = null
})

describe('activeCodeEditor', () => {
  it('prefers the focused editor, else the one showing the active file', () => {
    const a = fakeEditor('/ws/a.ts')
    const b = fakeEditor('/ws/b.ts')
    useEditors(a, b)
    expect(activeCodeEditor()).toBe(b)
    const focusedA = fakeEditor('/ws/a.ts', { focused: true })
    useEditors(focusedA, b)
    expect(activeCodeEditor()).toBe(focusedA)
  })

  it('is null before Monaco has loaded', () => {
    expect(activeCodeEditor()).toBeNull()
  })
})

describe('runEditorAction', () => {
  it('runs the Monaco action on the active editor', async () => {
    const b = fakeEditor('/ws/b.ts')
    useEditors(b)
    await runEditorAction('editor.action.deleteLines', 'Delete Line')
    expect(b.getAction).toHaveBeenCalledWith('editor.action.deleteLines')
    expect(b.action.run).toHaveBeenCalledTimes(1)
  })

  it('says so when there is no editor or the action does not apply', async () => {
    await runEditorAction('editor.action.deleteLines', 'Delete Line')
    expect(lastToast()).toBe('Delete Line: open a file in the editor first')

    const b = fakeEditor('/ws/b.ts')
    b.action.isSupported.mockReturnValue(false)
    useEditors(b)
    await runEditorAction('orion-ai-explain', 'Explain Selection')
    expect(b.action.run).not.toHaveBeenCalled()
    expect(lastToast()).toBe('Explain Selection is not available here')
  })
})

describe('runEditCommand', () => {
  afterEach(() => vi.restoreAllMocks())

  it('acts on a focused text field, not the editor', async () => {
    const b = fakeEditor('/ws/b.ts')
    useEditors(b)
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()
    const exec = vi.fn(() => true)
    document.execCommand = exec
    await runEditCommand('undo')
    expect(exec).toHaveBeenCalledWith('undo')
    expect(b.trigger).not.toHaveBeenCalled()
  })

  it('pastes the clipboard the main process read into the editor', async () => {
    const b = fakeEditor('/ws/b.ts')
    useEditors(b)
    ;(window as unknown as { api: unknown }).api = { clipboardReadText: async () => ({ success: true, text: 'hello' }) }
    await runEditCommand('paste')
    expect(b.trigger).toHaveBeenCalledWith('orion.command', 'paste', { text: 'hello' })
    await runEditCommand('redo')
    expect(b.trigger).toHaveBeenCalledWith('orion.command', 'redo', null)
  })
})

describe('symbol actions from the Outline panel', () => {
  it('puts the cursor on the symbol, then runs the action', async () => {
    const b = fakeEditor('/ws/b.ts', { lines: ['', 'export function answer() {}'] })
    useEditors(b)
    await runEditorActionAtSymbol('editor.action.rename', 'Rename Symbol', 'answer', 2)
    expect(b.setSelection).toHaveBeenCalledWith({ startLineNumber: 2, startColumn: 17, endLineNumber: 2, endColumn: 17 })
    expect(b.getAction).toHaveBeenCalledWith('editor.action.rename')
    expect(b.action.run).toHaveBeenCalledTimes(1)
  })

  it('does not rename whatever is at column 1 when the symbol moved', async () => {
    const b = fakeEditor('/ws/b.ts', { lines: ['const other = 1'] })
    useEditors(b)
    await runEditorActionAtSymbol('editor.action.rename', 'Rename Symbol', 'answer', 1)
    expect(b.action.run).not.toHaveBeenCalled()
    expect(lastToast()).toBe('Rename Symbol: answer is no longer on line 1')
  })

  it('handles the orion:peek-references and orion:rename-symbol events', async () => {
    const b = fakeEditor('/ws/b.ts')
    useEditors(b)
    const stop = listenForSymbolRequests()
    window.dispatchEvent(new CustomEvent('orion:peek-references', { detail: { name: 'answer', line: 1 } }))
    window.dispatchEvent(new CustomEvent('orion:rename-symbol', { detail: { name: 'answer', line: 1 } }))
    window.dispatchEvent(new CustomEvent('orion:rename-symbol', { detail: { name: 42 } }))
    stop()
    await vi.waitFor(() => expect(b.action.run).toHaveBeenCalledTimes(2))
    expect(b.getAction.mock.calls.map(([id]) => id)).toEqual(['editor.action.referenceSearch.trigger', 'editor.action.rename'])
  })
})
