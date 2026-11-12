/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const monacoState = vi.hoisted(() => ({ instance: null as unknown }))

vi.mock('@monaco-editor/react', () => ({
  loader: { __getMonacoInstance: () => monacoState.instance },
}))

import { registerSnippetCompletionProvider, useSnippetStore, type Snippet } from './snippets'
import { useEditorStore } from './editor'

const READ_ONLY_OPTION = 91

function fakeEditor(path: string, { readOnly = false } = {}) {
  const controller = { insert: vi.fn(), dispose: vi.fn() }
  const editor = {
    getModel: () => ({ uri: { toString: () => `file://${path}` } }),
    getOption: (id: number) => (id === READ_ONLY_OPTION ? readOnly : undefined),
    getContribution: (id: string) => (id === 'snippetController2' ? controller : null),
    focus: vi.fn(),
  }
  return { editor, controller }
}

function fakeMonaco(editors: unknown[]) {
  return {
    Uri: { file: (p: string) => ({ toString: () => `file://${p}` }) },
    editor: { getEditors: () => editors, EditorOption: { readOnly: READ_ONLY_OPTION } },
  }
}

const snippet: Snippet = {
  id: 's1', name: 'Log', prefix: 'log', body: 'console.log(${1:value})$0',
  description: 'Log', language: 'javascript', isBuiltin: false,
}

describe('insertSnippetAtCursor', () => {
  beforeEach(() => {
    useEditorStore.setState({ activeFilePath: '/w/a.ts' })
  })

  it('expands the snippet in the editor that shows the active file', () => {
    const other = fakeEditor('/w/b.ts')
    const active = fakeEditor('/w/a.ts')
    monacoState.instance = fakeMonaco([other.editor, active.editor])

    expect(useSnippetStore.getState().insertSnippetAtCursor(snippet)).toBe(true)
    expect(active.controller.insert).toHaveBeenCalledWith('console.log(${1:value})$0')
    expect(active.editor.focus).toHaveBeenCalled()
    expect(other.controller.insert).not.toHaveBeenCalled()
  })

  it('reports false instead of pretending when no writable editor shows the active file', () => {
    const readOnly = fakeEditor('/w/a.ts', { readOnly: true })
    monacoState.instance = fakeMonaco([readOnly.editor, fakeEditor('/w/b.ts').editor])
    expect(useSnippetStore.getState().insertSnippetAtCursor(snippet)).toBe(false)
    expect(readOnly.controller.insert).not.toHaveBeenCalled()

    monacoState.instance = null
    expect(useSnippetStore.getState().insertSnippetAtCursor(snippet)).toBe(false)
  })
})

describe('importSnippets', () => {
  beforeEach(() => {
    localStorage.clear()
    useSnippetStore.setState((s) => ({ userSnippets: [], snippets: s.snippets.filter((x) => x.isBuiltin) }))
  })

  it('keeps well-formed entries, skips the rest and never persists a snippet without a string prefix/body', () => {
    const result = useSnippetStore.getState().importSnippets([
      { trigger: 'log', content: 'console.log()' },
      { prefix: 42, body: 'x' },
      { prefix: 'p', body: ['not', 'a', 'string'] },
      null,
      'text',
      { prefix: 'ok', body: 'fine', name: 7, language: { bad: true } },
    ])

    expect(result).toEqual({ imported: 1, skipped: 5 })
    const [added] = useSnippetStore.getState().userSnippets
    expect(added).toMatchObject({ prefix: 'ok', body: 'fine', name: 'ok', language: 'global', description: 'ok' })
    const stored = JSON.parse(localStorage.getItem('orion-user-snippets') || '[]')
    expect(stored).toHaveLength(1)
    expect(stored.every((s: Snippet) => typeof s.prefix === 'string' && typeof s.body === 'string')).toBe(true)
  })
})

describe('importVSCodeSnippets', () => {
  it('skips entries whose prefix, body or scope are not text', () => {
    const count = useSnippetStore.getState().importVSCodeSnippets({
      bad1: { prefix: 5 as unknown as string, body: 'x' },
      bad2: { prefix: 'b', body: [1, 2] as unknown as string[] },
      good: { prefix: 'g', body: ['a', 'b'], scope: 42 as unknown as string },
    })
    expect(count).toBe(1)
    expect(useSnippetStore.getState().userSnippets.at(-1)).toMatchObject({ prefix: 'g', body: 'a\nb', language: 'global' })
  })
})

describe('stored user snippets', () => {
  it('drops corrupt entries on load so the manager can always open', async () => {
    localStorage.setItem('orion-user-snippets', JSON.stringify([
      { id: 'u1', prefix: 'keep', body: 'b', name: 'Keep', description: 'd', language: 'go' },
      { id: 'u2', trigger: 'log', content: 'x' },
    ]))
    vi.resetModules()
    const fresh = await import('./snippets')
    const users = fresh.useSnippetStore.getState().userSnippets
    expect(users.map((s) => s.id)).toEqual(['u1'])
  })
})

describe('registerSnippetCompletionProvider', () => {
  type Provider = {
    provideCompletionItems: (model: unknown, position: unknown) => { suggestions: Array<{ label: string }> }
  }

  function register() {
    let selector: unknown
    let provider: Provider | undefined
    const monaco = {
      languages: {
        registerCompletionItemProvider: (sel: unknown, p: Provider) => {
          selector = sel
          provider = p
          return { dispose() {} }
        },
        CompletionItemKind: { Snippet: 27 },
        CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      },
    }
    registerSnippetCompletionProvider(monaco as never)
    const labelsFor = (languageId: string) => provider!.provideCompletionItems(
      { getLanguageId: () => languageId, getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }) },
      { lineNumber: 1, column: 1 },
    ).suggestions.map((s) => s.label)
    return { selector, labelsFor }
  }

  beforeEach(() => {
    localStorage.clear()
    useSnippetStore.setState((s) => ({ userSnippets: [], snippets: s.snippets.filter((x) => x.isBuiltin) }))
  })

  it('serves every language from one provider, using the model language', () => {
    useSnippetStore.getState().createSnippet({ name: 'Shebang', prefix: 'shebang', body: '#!/bin/sh', description: 'd', language: 'shell' })
    useSnippetStore.getState().createSnippet({ name: 'Any', prefix: 'todoany', body: 'TODO', description: 'd', language: 'global' })
    const { selector, labelsFor } = register()

    expect(selector).toBe('*')
    const html = useSnippetStore.getState().snippets.find((s) => s.language === 'html')!
    expect(labelsFor('html')).toContain(html.prefix)
    expect(labelsFor('shell')).toEqual(expect.arrayContaining(['shebang', 'todoany']))
    expect(labelsFor('go')).toContain('todoany')
    expect(labelsFor('go')).not.toContain('shebang')
  })

  it('maps Monaco ids onto the languages the manager offers', () => {
    const css = useSnippetStore.getState().snippets.find((s) => s.language === 'css')!
    const { labelsFor } = register()
    expect(labelsFor('scss')).toContain(css.prefix)
    expect(labelsFor('less')).toContain(css.prefix)
  })
})
