/** @vitest-environment jsdom */
/**
 * Emmet in JSX files: .tsx/.jsx models carry Monaco's 'typescript' /
 * 'javascript' ids, so only the file name says whether `class` must be
 * written `className`.
 */
import { cleanup, render } from '@testing-library/react'
import type { Monaco } from '@monaco-editor/react'
import type { languages } from 'monaco-editor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EmmetProvider from './EmmetProvider'

interface FakeAction {
  run: (editor: unknown) => void
}

let providers: Map<string, languages.CompletionItemProvider>
let actions: FakeAction[]

function fakeMonaco(): Monaco {
  providers = new Map()
  actions = []
  return {
    languages: {
      CompletionItemKind: { Snippet: 27 },
      registerCompletionItemProvider: (language: string, provider: languages.CompletionItemProvider) => {
        providers.set(language, provider)
        return { dispose() {} }
      },
    },
    editor: {
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      // Hands the wrap action to a fake editor right away.
      onDidCreateEditor: (listener: (editor: unknown) => void) => {
        listener({ addAction: (action: FakeAction) => { actions.push(action); return { dispose() {} } } })
        return { dispose() {} }
      },
    },
    KeyMod: { Shift: 0, Alt: 0 },
    KeyCode: { KeyA: 0 },
  } as unknown as Monaco
}

function model(path: string, language: string, line: string) {
  return {
    uri: { path },
    getLanguageId: () => language,
    getLineContent: () => line,
    getValueInRange: () => line,
  }
}

/** The Emmet completions offered after typing `line` at the end of a line of `path`. */
function expansions(path: string, language: string, line: string): string[] {
  const provider = providers.get(language)
  if (!provider) throw new Error(`no Emmet provider for ${language}`)
  const result = provider.provideCompletionItems(
    model(path, language, line) as never,
    { lineNumber: 1, column: line.length + 1 } as never,
    {} as never,
    {} as never,
  ) as languages.CompletionList
  return result.suggestions.map((s) => s.insertText)
}

beforeEach(() => {
  render(<EmmetProvider monaco={fakeMonaco()} />)
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('EmmetProvider', () => {
  it('writes className in .tsx and .jsx files', () => {
    expect(expansions('/w/src/App.tsx', 'typescript', 'div.card')).toContain('<div className="card">$0</div>')
    expect(expansions('/w/src/App.jsx', 'javascript', '.card')).toEqual(
      expect.arrayContaining([expect.stringContaining('className="card"')]),
    )
    expect(expansions('/w/src/App.tsx', 'typescript', 'div.card').join('\n')).not.toContain('class="card"')
  })

  it('keeps class in HTML and in plain .ts files', () => {
    expect(expansions('/w/index.html', 'html', 'div.card')).toContain('<div class="card">$0</div>')
    expect(expansions('/w/src/template.ts', 'typescript', 'div.card')).toContain('<div class="card">$0</div>')
  })

  it('registers only language ids Monaco has', () => {
    expect([...providers.keys()]).not.toContain('typescriptreact')
    expect([...providers.keys()]).not.toContain('javascriptreact')
  })

  it('wraps a selection in a .tsx file with className', () => {
    const executeEdits = vi.fn()
    const editor = {
      getSelection: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 }),
      getModel: () => model('/w/src/App.tsx', 'typescript', 'Hello'),
      executeEdits,
      focus: () => {},
    }
    expect(actions).toHaveLength(1)
    actions[0].run(editor)

    const input = document.querySelector('input')!
    input.value = 'div.box'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(executeEdits).toHaveBeenCalledWith('emmet-wrap', [expect.objectContaining({ text: expect.stringContaining('className="box"') })])
  })
})
