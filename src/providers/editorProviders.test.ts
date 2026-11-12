/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/store/editor'
import { createFakeMonaco, fakeModel, FakeRange } from './__tests__/fakeMonaco'
import { EXPLAIN_COMMAND, SHOW_REFERENCES_COMMAND, registerEditorProviders } from './editorProviders'

const longFunction = [
  'export function run(a: number) {',
  ...Array.from({ length: 22 }, (_, i) => `  const v${i} = a + ${i}`),
  '  return a',
  '}',
].join('\n')

afterEach(() => {
  useEditorStore.setState({ openFiles: [], activeFilePath: null })
})

describe('registerEditorProviders', () => {
  it('registers each provider and command once per Monaco instance, however often the editor mounts', () => {
    const fake = createFakeMonaco()
    registerEditorProviders(fake.monaco as never)
    const first = fake.providers.length
    registerEditorProviders(fake.monaco as never)
    registerEditorProviders(fake.monaco as never)

    expect(first).toBeGreaterThan(0)
    expect(fake.providers.length).toBe(first)
    expect(fake.providersOf('codeLens').map((p) => p.language)).toEqual(['typescript', 'javascript'])
    expect(fake.providersOf('codeAction').map((p) => p.language)).toEqual(['typescript', 'javascript'])
  })

  it('leaves definitions, references, hover, symbols and rename to the TypeScript service', () => {
    const fake = createFakeMonaco()
    registerEditorProviders(fake.monaco as never)
    const kinds = new Set(fake.providers.map((p) => p.kind))
    for (const kind of ['definition', 'typeDefinition', 'reference', 'documentHighlight', 'hover', 'documentSymbol', 'rename']) {
      expect(kinds.has(kind)).toBe(false)
    }
  })

  it('only uses language ids Monaco has (no typescriptreact/javascriptreact)', () => {
    const fake = createFakeMonaco()
    registerEditorProviders(fake.monaco as never)
    expect(fake.providers.map((p) => p.language).filter((l) => /react/.test(l))).toEqual([])
  })
})

describe('CodeLens', () => {
  function lensesFor(path: string, text: string) {
    const fake = createFakeMonaco()
    registerEditorProviders(fake.monaco as never)
    const model = fakeModel(path, text)
    fake.addModel(model)
    const provider = fake.providersOf('codeLens')[0].provider
    return { fake, model, lenses: provider.provideCodeLenses(model).lenses as Array<{ command: { id: string; title: string; arguments?: unknown[] } }> }
  }

  it('points every clickable lens at a command registered with Monaco', () => {
    const { fake, lenses } = lensesFor('/w/a.ts', longFunction)
    const clickable = lenses.filter((l) => l.command.id)
    expect(clickable.map((l) => l.command.title)).toEqual(['0 references', 'Explain'])
    for (const lens of clickable) expect(fake.commands.has(lens.command.id)).toBe(true)
  })

  it('offers no Run Test / Debug Test lenses, which nothing could run', () => {
    const { lenses } = lensesFor('/w/a.test.ts', "describe('suite', () => {\n  it('works', () => {})\n})")
    expect(lenses.map((l) => l.command.title).join(' ')).not.toMatch(/Run Test|Debug Test/)
  })

  it('Explain sends the function body to the chat panel', () => {
    useEditorStore.setState({ openFiles: [{ path: '/w/a.ts', name: 'a.ts', content: longFunction, language: 'typescript', isModified: false, aiModified: false }] })
    const { fake, lenses } = lensesFor('/w/a.ts', longFunction)
    const explain = lenses.find((l) => l.command.id === EXPLAIN_COMMAND)!
    const seen = vi.fn()
    window.addEventListener('orion:ai-context-action', seen)
    fake.commands.get(EXPLAIN_COMMAND)!(null, ...explain.command.arguments!)
    window.removeEventListener('orion:ai-context-action', seen)

    const detail = (seen.mock.calls[0][0] as CustomEvent).detail
    expect(detail).toMatchObject({ action: 'explain', filePath: '/w/a.ts', language: 'typescript' })
    expect(detail.selectedText).toBe(longFunction)
  })

  it('references runs the reference search on the definition in the editor showing the file', () => {
    const { fake, model, lenses } = lensesFor('/w/a.ts', 'const x = 1\nexport function helper() {}\nhelper()')
    const run = vi.fn()
    const editor = {
      getModel: () => model,
      hasTextFocus: () => false,
      setPosition: vi.fn(),
      focus: vi.fn(),
      getAction: (id: string) => (id === 'editor.action.referenceSearch.trigger' ? { run } : null),
    }
    fake.editors.push(editor)
    const refs = lenses.find((l) => l.command.id === SHOW_REFERENCES_COMMAND && l.command.title === '1 reference')!
    fake.commands.get(SHOW_REFERENCES_COMMAND)!(null, ...refs.command.arguments!)

    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 17 })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('labels a function edited in this session', () => {
    const fake = createFakeMonaco()
    registerEditorProviders(fake.monaco as never)
    const model = fakeModel('/w/a.ts', 'function f() {\n  return 1\n}')
    fake.addModel(model)
    model.edit('function f() {\n  return 2\n}', 2)
    const lenses = fake.providersOf('codeLens')[0].provider.provideCodeLenses(model).lenses
    expect(lenses.map((l: { command: { title: string } }) => l.command.title)).toContain('Modified just now')
  })

  it('tracks an edit whose range starts on a line the edit removed', () => {
    const fake = createFakeMonaco()
    registerEditorProviders(fake.monaco as never)
    const model = fakeModel('/w/a.ts', 'function f() {\n  return 1\n}')
    fake.addModel(model)
    // Change ranges are in pre-edit lines (multi-cursor line deletes): line 3 is gone.
    expect(() => model.edit('function f() { return 2 }', 3)).not.toThrow()
    const lenses = fake.providersOf('codeLens')[0].provider.provideCodeLenses(model).lenses
    expect(lenses.map((l: { command: { title: string } }) => l.command.title)).toContain('Modified just now')
  })
})

describe('code actions', () => {
  it('offers no "Fix with AI" entry (no handler exists) and takes the selection from the range Monaco passes', () => {
    const fake = createFakeMonaco()
    registerEditorProviders(fake.monaco as never)
    const model = fakeModel('/w/a.ts', "const s = 'hi'")
    const provider = fake.providersOf('codeAction')[0].provider
    const titles = provider.provideCodeActions(model, new FakeRange(1, 11, 1, 15)).actions.map((a: { title: string }) => a.title)

    expect(titles.join(' ')).not.toMatch(/Fix with AI/)
    expect(titles).toContain('Convert to template literal')
  })
})

describe('linked editing', () => {
  it('pairs JSX tags in .tsx files but leaves comparisons in .ts files alone', () => {
    const fake = createFakeMonaco()
    registerEditorProviders(fake.monaco as never)
    const provider = fake.providersOf('linkedEditing').find((p) => p.language === 'typescript')!.provider
    const text = 'const a = <div>x</div>'
    const at = { lineNumber: 1, column: 13 }

    expect(provider.provideLinkedEditingRanges(fakeModel('/w/a.tsx', text), at)?.ranges).toEqual([
      { startLineNumber: 1, startColumn: 12, endLineNumber: 1, endColumn: 15 },
      { startLineNumber: 1, startColumn: 19, endLineNumber: 1, endColumn: 22 },
    ])
    expect(provider.provideLinkedEditingRanges(fakeModel('/w/a.ts', text), at)).toBeNull()
  })
})

describe('folding', () => {
  it("adds no folding provider, which would replace Monaco's indentation folding of every block", () => {
    const fake = createFakeMonaco()
    registerEditorProviders(fake.monaco as never)
    expect(fake.providersOf('folding')).toEqual([])
  })
})
