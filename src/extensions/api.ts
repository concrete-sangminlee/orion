/**
 * Orion IDE Extension API.
 * Provides VS Code-compatible extension surface for plugins.
 */

/* ── Disposable ────────────────────────────────────────── */

export interface Disposable {
  dispose(): void
}

export function disposable(fn: () => void): Disposable {
  return { dispose: fn }
}

/* ── Extension Manifest ────────────────────────────────── */

export interface ExtensionManifest {
  name: string
  displayName: string
  version: string
  description: string
  publisher: string
  categories?: string[]
  activationEvents?: string[]
  main?: string
  contributes?: {
    commands?: Array<{ command: string; title: string; icon?: string }>
    menus?: Record<string, Array<{ command: string; when?: string; group?: string }>>
    keybindings?: Array<{ command: string; key: string; when?: string }>
    themes?: Array<{ label: string; uiTheme: string; path: string }>
    languages?: Array<{ id: string; extensions: string[]; aliases?: string[] }>
    snippets?: Array<{ language: string; path: string }>
    views?: Record<string, Array<{ id: string; name: string }>>
    configuration?: {
      title: string
      properties: Record<string, {
        type: string
        default?: any
        description?: string
        enum?: string[]
      }>
    }
  }
}

/* ── Extension Context ─────────────────────────────────── */

export interface ExtensionContext {
  subscriptions: Disposable[]
  workspaceState: StateStorage
  globalState: StateStorage
  extensionPath: string
  extensionUri: string
  secrets: SecretStorage
}

export interface StateStorage {
  get<T>(key: string, defaultValue?: T): T | undefined
  update(key: string, value: any): void
  keys(): readonly string[]
}

export interface SecretStorage {
  get(key: string): Promise<string | undefined>
  store(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/* ── Text Document ─────────────────────────────────────── */

export interface TextDocument {
  uri: string
  fileName: string
  languageId: string
  version: number
  lineCount: number
  isDirty: boolean
  getText(range?: Range): string
  lineAt(line: number): TextLine
  positionAt(offset: number): Position
  offsetAt(position: Position): number
}

export interface TextLine {
  lineNumber: number
  text: string
  range: Range
  firstNonWhitespaceCharacterIndex: number
  isEmptyOrWhitespace: boolean
}

export interface Position {
  line: number
  character: number
}

export interface Range {
  start: Position
  end: Position
}

export interface Selection extends Range {
  anchor: Position
  active: Position
  isReversed: boolean
}

export interface TextEdit {
  range: Range
  newText: string
}

/* ── Editor ────────────────────────────────────────────── */

export interface TextEditor {
  document: TextDocument
  selection: Selection
  selections: Selection[]
  edit(callback: (editBuilder: TextEditorEdit) => void): Promise<boolean>
  setDecorations(decorationType: TextEditorDecorationType, ranges: Range[]): void
  revealRange(range: Range): void
}

export interface TextEditorEdit {
  insert(location: Position, value: string): void
  delete(location: Range): void
  replace(location: Range, value: string): void
}

export interface TextEditorDecorationType extends Disposable {
  key: string
}

/* ── Providers ─────────────────────────────────────────── */

export interface CompletionItem {
  label: string
  kind?: CompletionItemKind
  detail?: string
  documentation?: string
  insertText?: string
  sortText?: string
  filterText?: string
  range?: Range
}

export enum CompletionItemKind {
  Text = 0, Method = 1, Function = 2, Constructor = 3, Field = 4,
  Variable = 5, Class = 6, Interface = 7, Module = 8, Property = 9,
  Unit = 10, Value = 11, Enum = 12, Keyword = 13, Snippet = 14,
  Color = 15, File = 16, Reference = 17, Folder = 18, EnumMember = 19,
  Constant = 20, Struct = 21, Event = 22, Operator = 23, TypeParameter = 24,
}

export interface CompletionProvider {
  provideCompletionItems(document: TextDocument, position: Position): CompletionItem[] | Promise<CompletionItem[]>
}

export interface HoverProvider {
  provideHover(document: TextDocument, position: Position): Hover | null | Promise<Hover | null>
}

export interface Hover {
  contents: string[]
  range?: Range
}

export interface DefinitionProvider {
  provideDefinition(document: TextDocument, position: Position): Location | Location[] | null
}

export interface Location {
  uri: string
  range: Range
}

export interface CodeAction {
  title: string
  kind?: string
  edit?: WorkspaceEdit
  command?: { command: string; arguments?: any[] }
  isPreferred?: boolean
}

export interface CodeActionProvider {
  provideCodeActions(document: TextDocument, range: Range): CodeAction[] | Promise<CodeAction[]>
}

export interface CodeLens {
  range: Range
  command?: { title: string; command: string; arguments?: any[] }
}

export interface CodeLensProvider {
  provideCodeLenses(document: TextDocument): CodeLens[] | Promise<CodeLens[]>
}

export interface WorkspaceEdit {
  entries: Array<{ uri: string; edits: TextEdit[] }>
}

export interface Diagnostic {
  range: Range
  message: string
  severity: DiagnosticSeverity
  source?: string
  code?: string | number
}

export enum DiagnosticSeverity {
  Error = 0, Warning = 1, Information = 2, Hint = 3,
}

/* ── Output & UI ───────────────────────────────────────── */

export interface OutputChannel extends Disposable {
  name: string
  append(value: string): void
  appendLine(value: string): void
  clear(): void
  show(): void
  hide(): void
}

export interface StatusBarItem extends Disposable {
  text: string
  tooltip?: string
  command?: string
  alignment: StatusBarAlignment
  priority?: number
  show(): void
  hide(): void
}

export enum StatusBarAlignment { Left = 1, Right = 2 }

export interface QuickPickItem {
  label: string
  description?: string
  detail?: string
  picked?: boolean
}

/* ── Events ────────────────────────────────────────────── */

export interface Event<T> {
  (listener: (e: T) => void): Disposable
}

/* ── API Surface ───────────────────────────────────────── */

export interface OrionExtensionAPI {
  window: {
    showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>
    showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>
    showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>
    showQuickPick(items: QuickPickItem[] | string[], options?: { placeHolder?: string }): Promise<QuickPickItem | string | undefined>
    showInputBox(options?: { prompt?: string; value?: string; placeHolder?: string }): Promise<string | undefined>
    createOutputChannel(name: string): OutputChannel
    createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem
    activeTextEditor: TextEditor | undefined
    onDidChangeActiveTextEditor: Event<TextEditor | undefined>
  }

  workspace: {
    getConfiguration(section?: string): {
      get<T>(key: string, defaultValue?: T): T | undefined
      update(key: string, value: any): void
    }
    onDidChangeConfiguration: Event<{ affectsConfiguration(section: string): boolean }>
    openTextDocument(uri: string): Promise<TextDocument>
    onDidOpenTextDocument: Event<TextDocument>
    onDidCloseTextDocument: Event<TextDocument>
    onDidSaveTextDocument: Event<TextDocument>
    rootPath: string | undefined
  }

  commands: {
    registerCommand(command: string, callback: (...args: any[]) => any): Disposable
    executeCommand(command: string, ...args: any[]): Promise<any>
    getCommands(): Promise<string[]>
  }

  languages: {
    registerCompletionItemProvider(selector: string, provider: CompletionProvider, ...triggerChars: string[]): Disposable
    registerHoverProvider(selector: string, provider: HoverProvider): Disposable
    registerDefinitionProvider(selector: string, provider: DefinitionProvider): Disposable
    registerCodeActionsProvider(selector: string, provider: CodeActionProvider): Disposable
    registerCodeLensProvider(selector: string, provider: CodeLensProvider): Disposable
    setDiagnostics(uri: string, diagnostics: Diagnostic[]): void
    getDiagnostics(uri?: string): Diagnostic[]
  }
}

/* ── Extension Host ────────────────────────────────────── */

export interface ExtensionInstance {
  id: string
  manifest: ExtensionManifest
  isActive: boolean
  activate?: (context: ExtensionContext) => void | Promise<void>
  deactivate?: () => void | Promise<void>
  exports?: any
}

class ExtensionHostImpl {
  private extensions = new Map<string, ExtensionInstance>()
  private commands = new Map<string, (...args: any[]) => any>()
  private diagnostics = new Map<string, Diagnostic[]>()
  private outputChannels = new Map<string, string[]>()
  private statusBarItems: StatusBarItem[] = []

  /** Register a built-in extension */
  register(ext: ExtensionInstance): void {
    this.extensions.set(ext.id, ext)
  }

  /** Activate an extension */
  async activate(id: string): Promise<void> {
    const ext = this.extensions.get(id)
    if (!ext || ext.isActive) return

    const context: ExtensionContext = {
      subscriptions: [],
      workspaceState: this.createStateStorage(`ext:${id}:workspace`),
      globalState: this.createStateStorage(`ext:${id}:global`),
      extensionPath: `/extensions/${id}`,
      extensionUri: `orion-ext://${id}`,
      secrets: {
        async get(key) { return localStorage.getItem(`ext-secret:${id}:${key}`) || undefined },
        async store(key, value) { localStorage.setItem(`ext-secret:${id}:${key}`, value) },
        async delete(key) { localStorage.removeItem(`ext-secret:${id}:${key}`) },
      },
    }

    await ext.activate?.(context)
    ext.isActive = true
  }

  /** Deactivate an extension */
  async deactivate(id: string): Promise<void> {
    const ext = this.extensions.get(id)
    if (!ext || !ext.isActive) return
    await ext.deactivate?.()
    ext.isActive = false
  }

  /** Get all registered extensions */
  getAll(): ExtensionInstance[] {
    return Array.from(this.extensions.values())
  }

  /** Register a command */
  registerCommand(command: string, callback: (...args: any[]) => any): Disposable {
    this.commands.set(command, callback)
    return disposable(() => this.commands.delete(command))
  }

  /** Execute a command */
  async executeCommand(command: string, ...args: any[]): Promise<any> {
    const handler = this.commands.get(command)
    if (!handler) throw new Error(`Command not found: ${command}`)
    return handler(...args)
  }

  /** Set diagnostics for a file */
  setDiagnostics(uri: string, diagnostics: Diagnostic[]): void {
    this.diagnostics.set(uri, diagnostics)
    window.dispatchEvent(new CustomEvent('orion:diagnostics-changed', { detail: { uri, diagnostics } }))
  }

  getDiagnostics(uri?: string): Diagnostic[] {
    if (uri) return this.diagnostics.get(uri) || []
    const all: Diagnostic[] = []
    for (const diags of this.diagnostics.values()) all.push(...diags)
    return all
  }

  private createStateStorage(prefix: string): StateStorage {
    return {
      get<T>(key: string, defaultValue?: T): T | undefined {
        try {
          const v = localStorage.getItem(`${prefix}:${key}`)
          return v !== null ? JSON.parse(v) : defaultValue
        } catch { return defaultValue }
      },
      update(key: string, value: any): void {
        if (value === undefined) localStorage.removeItem(`${prefix}:${key}`)
        else localStorage.setItem(`${prefix}:${key}`, JSON.stringify(value))
      },
      keys(): readonly string[] {
        const result: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k?.startsWith(prefix + ':')) result.push(k.slice(prefix.length + 1))
        }
        return result
      },
    }
  }
}

export const extensionHost = new ExtensionHostImpl()
