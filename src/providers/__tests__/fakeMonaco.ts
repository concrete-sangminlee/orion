/**
 * A stand-in for the parts of Monaco the provider modules call: it records
 * every provider and command registration and serves text models built from
 * strings, so the tests can drive providers the way Monaco would.
 */
type Listener<T = unknown> = (arg: T) => void

export class FakeRange {
  constructor(
    public startLineNumber: number,
    public startColumn: number,
    public endLineNumber: number,
    public endColumn: number,
  ) {}
  isEmpty() {
    return this.startLineNumber === this.endLineNumber && this.startColumn === this.endColumn
  }
}

export interface FakeMarker {
  owner: string
  resource: { toString(): string }
  severity: number
  message: string
  source?: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export function fakeModel(path: string, text: string, languageId = 'typescript') {
  let value = text
  const contentListeners: Listener<{ changes: Array<{ range: { startLineNumber: number } }> }>[] = []
  const lines = () => value.split('\n')
  const offsetAt = (p: { lineNumber: number; column: number }) =>
    lines().slice(0, p.lineNumber - 1).reduce((n, l) => n + l.length + 1, 0) + p.column - 1
  const model = {
    uri: { scheme: 'file', path, toString: () => `file://${path}` },
    getValue: () => value,
    getLanguageId: () => languageId,
    getLineCount: () => lines().length,
    getLineContent: (n: number) => {
      // Monaco throws for a line outside the model.
      if (n < 1 || n > lines().length) throw new Error(`Illegal value for lineNumber: ${n}`)
      return lines()[n - 1]
    },
    getLineMaxColumn: (n: number) => lines()[n - 1].length + 1,
    getOffsetAt: offsetAt,
    getPositionAt: (offset: number) => {
      let rest = offset
      const all = lines()
      for (let i = 0; i < all.length; i++) {
        if (rest <= all[i].length) return { lineNumber: i + 1, column: rest + 1 }
        rest -= all[i].length + 1
      }
      return { lineNumber: all.length, column: all[all.length - 1].length + 1 }
    },
    getValueInRange: (r: FakeRange) => value.slice(
      offsetAt({ lineNumber: r.startLineNumber, column: r.startColumn }),
      offsetAt({ lineNumber: r.endLineNumber, column: r.endColumn }),
    ),
    getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1, word: '' }),
    getWordAtPosition: () => null,
    isDisposed: () => false,
    onDidChangeContent: (l: (typeof contentListeners)[number]) => { contentListeners.push(l); return { dispose() {} } },
    onDidChangeLanguage: () => ({ dispose() {} }),
    onWillDispose: () => ({ dispose() {} }),
    /** Replace the text, as a user edit on `line` would. */
    edit(newText: string, line: number) {
      value = newText
      for (const l of contentListeners) l({ changes: [{ range: { startLineNumber: line } }] })
    },
  }
  return model
}

export type FakeModel = ReturnType<typeof fakeModel>

export function createFakeMonaco() {
  const providers: Array<{ kind: string; language: string; provider: any }> = []
  const commands = new Map<string, (...args: unknown[]) => unknown>()
  const models: FakeModel[] = []
  const editors: unknown[] = []
  const markers: FakeMarker[] = []
  const markerListeners: Listener[] = []
  const modelListeners: Listener<FakeModel>[] = []

  const recorder = (kind: string) => (language: string, provider: unknown) => {
    providers.push({ kind, language, provider })
    return { dispose() {} }
  }

  const monaco = {
    Range: FakeRange,
    Uri: {
      file: (p: string) => ({ toString: () => `file://${p}` }),
      parse: (s: string) => ({ toString: () => s }),
    },
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    languages: {
      registerCompletionItemProvider: recorder('completion'),
      registerColorProvider: recorder('color'),
      registerCodeLensProvider: recorder('codeLens'),
      registerCodeActionProvider: recorder('codeAction'),
      registerLinkedEditingRangeProvider: recorder('linkedEditing'),
      registerFoldingRangeProvider: recorder('folding'),
      // What the TypeScript service already provides; recorded so tests can check nothing duplicates it.
      registerDefinitionProvider: recorder('definition'),
      registerTypeDefinitionProvider: recorder('typeDefinition'),
      registerReferenceProvider: recorder('reference'),
      registerDocumentHighlightProvider: recorder('documentHighlight'),
      registerHoverProvider: recorder('hover'),
      registerDocumentSymbolProvider: recorder('documentSymbol'),
      registerRenameProvider: recorder('rename'),
      CompletionItemKind: { Snippet: 27 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    },
    editor: {
      registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
        commands.set(id, handler)
        return { dispose() {} }
      },
      getModels: () => models,
      getModel: (uri: { toString(): string }) => models.find((m) => m.uri.toString() === uri.toString()) ?? null,
      getEditors: () => editors,
      onDidCreateModel: (l: Listener<FakeModel>) => { modelListeners.push(l); return { dispose() {} } },
      onDidChangeMarkers: (l: Listener) => { markerListeners.push(l); return { dispose() {} } },
      getModelMarkers: () => [...markers],
      setModelMarkers: (model: FakeModel, owner: string, data: Omit<FakeMarker, 'owner' | 'resource'>[]) => {
        for (let i = markers.length - 1; i >= 0; i--) {
          if (markers[i].owner === owner && markers[i].resource.toString() === model.uri.toString()) markers.splice(i, 1)
        }
        markers.push(...data.map((m) => ({ ...m, owner, resource: model.uri })))
        for (const l of markerListeners) l([model.uri])
      },
    },
  }

  return {
    monaco,
    providers,
    commands,
    models,
    editors,
    markers,
    providersOf: (kind: string) => providers.filter((p) => p.kind === kind),
    addModel(model: FakeModel) {
      models.push(model)
      for (const l of modelListeners) l(model)
    },
    /** Markers a language service (another owner) reports for a model. */
    report(model: FakeModel, owner: string, data: Omit<FakeMarker, 'owner' | 'resource'>[]) {
      monaco.editor.setModelMarkers(model, owner, data)
    },
  }
}
