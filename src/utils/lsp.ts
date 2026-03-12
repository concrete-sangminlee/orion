/**
 * Language Server Protocol (LSP) client implementation.
 * Provides intellisense, diagnostics, and code intelligence features.
 */

/* ── LSP Types (subset of official spec) ──────────────── */

export interface Position {
  line: number
  character: number
}

export interface Range {
  start: Position
  end: Position
}

export interface Location {
  uri: string
  range: Range
}

export interface TextEdit {
  range: Range
  newText: string
}

export interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>
}

export type DiagnosticSeverity = 1 | 2 | 3 | 4 // Error, Warning, Info, Hint

export interface Diagnostic {
  range: Range
  severity: DiagnosticSeverity
  code?: string | number
  source?: string
  message: string
  relatedInformation?: DiagnosticRelatedInfo[]
  tags?: DiagnosticTag[]
}

export type DiagnosticTag = 1 | 2 // Unnecessary, Deprecated

export interface DiagnosticRelatedInfo {
  location: Location
  message: string
}

export interface CompletionItem {
  label: string
  kind: CompletionItemKind
  detail?: string
  documentation?: string | MarkupContent
  deprecated?: boolean
  sortText?: string
  filterText?: string
  insertText?: string
  insertTextFormat?: 1 | 2 // PlainText, Snippet
  textEdit?: TextEdit
  additionalTextEdits?: TextEdit[]
  commitCharacters?: string[]
  data?: any
}

export type CompletionItemKind =
  | 1  // Text
  | 2  // Method
  | 3  // Function
  | 4  // Constructor
  | 5  // Field
  | 6  // Variable
  | 7  // Class
  | 8  // Interface
  | 9  // Module
  | 10 // Property
  | 11 // Unit
  | 12 // Value
  | 13 // Enum
  | 14 // Keyword
  | 15 // Snippet
  | 16 // Color
  | 17 // File
  | 18 // Reference
  | 19 // Folder
  | 20 // EnumMember
  | 21 // Constant
  | 22 // Struct
  | 23 // Event
  | 24 // Operator
  | 25 // TypeParameter

export interface MarkupContent {
  kind: 'plaintext' | 'markdown'
  value: string
}

export interface Hover {
  contents: MarkupContent | string
  range?: Range
}

export interface SignatureHelp {
  signatures: SignatureInformation[]
  activeSignature: number
  activeParameter: number
}

export interface SignatureInformation {
  label: string
  documentation?: string | MarkupContent
  parameters?: ParameterInformation[]
}

export interface ParameterInformation {
  label: string | [number, number]
  documentation?: string | MarkupContent
}

export interface DocumentSymbol {
  name: string
  detail?: string
  kind: SymbolKind
  range: Range
  selectionRange: Range
  children?: DocumentSymbol[]
}

export type SymbolKind =
  | 1  // File
  | 2  // Module
  | 3  // Namespace
  | 4  // Package
  | 5  // Class
  | 6  // Method
  | 7  // Property
  | 8  // Field
  | 9  // Constructor
  | 10 // Enum
  | 11 // Interface
  | 12 // Function
  | 13 // Variable
  | 14 // Constant
  | 15 // String
  | 16 // Number
  | 17 // Boolean
  | 18 // Array
  | 19 // Object
  | 20 // Key
  | 21 // Null
  | 22 // EnumMember
  | 23 // Struct
  | 24 // Event
  | 25 // Operator
  | 26 // TypeParameter

export interface CodeAction {
  title: string
  kind?: string
  diagnostics?: Diagnostic[]
  isPreferred?: boolean
  edit?: WorkspaceEdit
  command?: Command
}

export interface Command {
  title: string
  command: string
  arguments?: any[]
}

export interface CodeLens {
  range: Range
  command?: Command
  data?: any
}

export interface FoldingRange {
  startLine: number
  startCharacter?: number
  endLine: number
  endCharacter?: number
  kind?: 'comment' | 'imports' | 'region'
}

export interface InlayHint {
  position: Position
  label: string | InlayHintLabelPart[]
  kind?: 1 | 2 // Type, Parameter
  paddingLeft?: boolean
  paddingRight?: boolean
}

export interface InlayHintLabelPart {
  value: string
  tooltip?: string
  location?: Location
  command?: Command
}

export interface SemanticTokens {
  resultId?: string
  data: number[]
}

/* ── LSP Message Types ────────────────────────────────── */

export interface LSPMessage {
  jsonrpc: '2.0'
  id?: number | string
}

export interface LSPRequest extends LSPMessage {
  id: number
  method: string
  params?: any
}

export interface LSPResponse extends LSPMessage {
  id: number
  result?: any
  error?: { code: number; message: string; data?: any }
}

export interface LSPNotification extends LSPMessage {
  method: string
  params?: any
}

/* ── Server Capabilities ──────────────────────────────── */

export interface ServerCapabilities {
  completionProvider?: { triggerCharacters?: string[]; resolveProvider?: boolean }
  hoverProvider?: boolean
  signatureHelpProvider?: { triggerCharacters?: string[] }
  definitionProvider?: boolean
  typeDefinitionProvider?: boolean
  implementationProvider?: boolean
  referencesProvider?: boolean
  documentHighlightProvider?: boolean
  documentSymbolProvider?: boolean
  workspaceSymbolProvider?: boolean
  codeActionProvider?: boolean | { codeActionKinds?: string[] }
  codeLensProvider?: { resolveProvider?: boolean }
  documentFormattingProvider?: boolean
  documentRangeFormattingProvider?: boolean
  renameProvider?: boolean | { prepareProvider?: boolean }
  foldingRangeProvider?: boolean
  semanticTokensProvider?: { full?: boolean; range?: boolean; legend: { tokenTypes: string[]; tokenModifiers: string[] } }
  inlayHintProvider?: boolean
  diagnosticProvider?: { interFileDependencies?: boolean; workspaceDiagnostics?: boolean }
}

/* ── LSP Client ───────────────────────────────────────── */

type MessageHandler = (message: LSPResponse | LSPNotification) => void

export class LSPClient {
  private nextId = 1
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: any) => void; method: string }>()
  private handlers = new Map<string, Set<(params: any) => void>>()
  private capabilities: ServerCapabilities | null = null
  private _initialized = false
  private sendFn: ((message: string) => void) | null = null

  get initialized(): boolean { return this._initialized }
  get serverCapabilities(): ServerCapabilities | null { return this.capabilities }

  /** Connect to a transport (IPC, stdio, websocket) */
  connect(send: (message: string) => void): void {
    this.sendFn = send
  }

  /** Handle incoming message from server */
  onMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw)
      if ('id' in msg && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        if (msg.error) reject(new LSPError(msg.error.code, msg.error.message, msg.error.data))
        else resolve(msg.result)
      } else if ('method' in msg) {
        this.emit(msg.method, msg.params)
      }
    } catch {
      // Ignore malformed messages
    }
  }

  /** Send a request and wait for response */
  async request<T = any>(method: string, params?: any): Promise<T> {
    const id = this.nextId++
    const message: LSPRequest = { jsonrpc: '2.0', id, method, params }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.send(message)

      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`LSP request ${method} timed out`))
        }
      }, 30000)
    })
  }

  /** Send a notification (no response expected) */
  notify(method: string, params?: any): void {
    const message: LSPNotification = { jsonrpc: '2.0', method, params }
    this.send(message)
  }

  /** Subscribe to server notifications */
  on(method: string, handler: (params: any) => void): () => void {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set())
    this.handlers.get(method)!.add(handler)
    return () => this.handlers.get(method)?.delete(handler)
  }

  private emit(method: string, params: any): void {
    this.handlers.get(method)?.forEach(h => h(params))
  }

  private send(message: any): void {
    if (!this.sendFn) throw new Error('LSP client not connected')
    this.sendFn(JSON.stringify(message))
  }

  /* ── Lifecycle ─────────────────────────────────────── */

  async initialize(rootUri: string, capabilities: any = {}): Promise<ServerCapabilities> {
    const result = await this.request('initialize', {
      processId: null,
      rootUri,
      capabilities: {
        textDocument: {
          completion: { completionItem: { snippetSupport: true, commitCharactersSupport: true } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: { signatureInformation: { parameterInformation: { labelOffsetSupport: true } } },
          codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] } } },
          publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
          semanticTokens: { tokenTypes: [], tokenModifiers: [] },
          inlayHint: {},
          foldingRange: {},
          ...capabilities.textDocument,
        },
        workspace: {
          workspaceFolders: true,
          didChangeConfiguration: {},
          ...capabilities.workspace,
        },
      },
    })

    this.capabilities = result.capabilities
    this.notify('initialized', {})
    this._initialized = true

    return result.capabilities
  }

  async shutdown(): Promise<void> {
    await this.request('shutdown')
    this.notify('exit')
    this._initialized = false
    this.capabilities = null
  }

  /* ── Document Sync ──────────────────────────────────── */

  didOpen(uri: string, languageId: string, version: number, text: string): void {
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version, text },
    })
  }

  didChange(uri: string, version: number, changes: Array<{ range?: Range; text: string }>): void {
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: changes,
    })
  }

  didSave(uri: string, text?: string): void {
    this.notify('textDocument/didSave', {
      textDocument: { uri },
      text,
    })
  }

  didClose(uri: string): void {
    this.notify('textDocument/didClose', {
      textDocument: { uri },
    })
  }

  /* ── Language Features ──────────────────────────────── */

  async completion(uri: string, position: Position): Promise<CompletionItem[]> {
    const result = await this.request('textDocument/completion', {
      textDocument: { uri },
      position,
    })
    return Array.isArray(result) ? result : result?.items || []
  }

  async completionResolve(item: CompletionItem): Promise<CompletionItem> {
    return this.request('completionItem/resolve', item)
  }

  async hover(uri: string, position: Position): Promise<Hover | null> {
    return this.request('textDocument/hover', {
      textDocument: { uri },
      position,
    })
  }

  async signatureHelp(uri: string, position: Position): Promise<SignatureHelp | null> {
    return this.request('textDocument/signatureHelp', {
      textDocument: { uri },
      position,
    })
  }

  async definition(uri: string, position: Position): Promise<Location | Location[] | null> {
    return this.request('textDocument/definition', {
      textDocument: { uri },
      position,
    })
  }

  async typeDefinition(uri: string, position: Position): Promise<Location | Location[] | null> {
    return this.request('textDocument/typeDefinition', {
      textDocument: { uri },
      position,
    })
  }

  async implementation(uri: string, position: Position): Promise<Location | Location[] | null> {
    return this.request('textDocument/implementation', {
      textDocument: { uri },
      position,
    })
  }

  async references(uri: string, position: Position, includeDeclaration = true): Promise<Location[]> {
    return this.request('textDocument/references', {
      textDocument: { uri },
      position,
      context: { includeDeclaration },
    }) || []
  }

  async documentSymbols(uri: string): Promise<DocumentSymbol[]> {
    return this.request('textDocument/documentSymbol', {
      textDocument: { uri },
    }) || []
  }

  async workspaceSymbols(query: string): Promise<DocumentSymbol[]> {
    return this.request('workspace/symbol', { query }) || []
  }

  async codeAction(uri: string, range: Range, diagnostics: Diagnostic[] = []): Promise<CodeAction[]> {
    return this.request('textDocument/codeAction', {
      textDocument: { uri },
      range,
      context: { diagnostics },
    }) || []
  }

  async codeLens(uri: string): Promise<CodeLens[]> {
    return this.request('textDocument/codeLens', {
      textDocument: { uri },
    }) || []
  }

  async formatting(uri: string, tabSize: number, insertSpaces: boolean): Promise<TextEdit[]> {
    return this.request('textDocument/formatting', {
      textDocument: { uri },
      options: { tabSize, insertSpaces },
    }) || []
  }

  async rangeFormatting(uri: string, range: Range, tabSize: number, insertSpaces: boolean): Promise<TextEdit[]> {
    return this.request('textDocument/rangeFormatting', {
      textDocument: { uri },
      range,
      options: { tabSize, insertSpaces },
    }) || []
  }

  async rename(uri: string, position: Position, newName: string): Promise<WorkspaceEdit | null> {
    return this.request('textDocument/rename', {
      textDocument: { uri },
      position,
      newName,
    })
  }

  async prepareRename(uri: string, position: Position): Promise<Range | null> {
    return this.request('textDocument/prepareRename', {
      textDocument: { uri },
      position,
    })
  }

  async foldingRanges(uri: string): Promise<FoldingRange[]> {
    return this.request('textDocument/foldingRange', {
      textDocument: { uri },
    }) || []
  }

  async semanticTokens(uri: string): Promise<SemanticTokens | null> {
    return this.request('textDocument/semanticTokens/full', {
      textDocument: { uri },
    })
  }

  async inlayHints(uri: string, range: Range): Promise<InlayHint[]> {
    return this.request('textDocument/inlayHint', {
      textDocument: { uri },
      range,
    }) || []
  }

  /** Cancel pending requests */
  cancelAll(): void {
    for (const [id, { reject }] of this.pending) {
      reject(new Error('Request cancelled'))
    }
    this.pending.clear()
  }
}

/* ── LSP Error ────────────────────────────────────────── */

export class LSPError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: any,
  ) {
    super(message)
    this.name = 'LSPError'
  }
}

/* ── Language Server Registry ─────────────────────────── */

export interface LanguageServerConfig {
  id: string
  name: string
  languages: string[]
  command: string
  args: string[]
  rootPatterns?: string[]
  initializationOptions?: any
}

const BUILTIN_SERVERS: LanguageServerConfig[] = [
  {
    id: 'typescript',
    name: 'TypeScript Language Server',
    languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    command: 'typescript-language-server',
    args: ['--stdio'],
    rootPatterns: ['tsconfig.json', 'jsconfig.json', 'package.json'],
  },
  {
    id: 'css',
    name: 'CSS Language Server',
    languages: ['css', 'scss', 'less'],
    command: 'vscode-css-language-server',
    args: ['--stdio'],
  },
  {
    id: 'html',
    name: 'HTML Language Server',
    languages: ['html'],
    command: 'vscode-html-language-server',
    args: ['--stdio'],
  },
  {
    id: 'json',
    name: 'JSON Language Server',
    languages: ['json', 'jsonc'],
    command: 'vscode-json-language-server',
    args: ['--stdio'],
  },
  {
    id: 'python',
    name: 'Pyright',
    languages: ['python'],
    command: 'pyright-langserver',
    args: ['--stdio'],
    rootPatterns: ['pyproject.toml', 'setup.py', 'requirements.txt'],
  },
  {
    id: 'rust',
    name: 'rust-analyzer',
    languages: ['rust'],
    command: 'rust-analyzer',
    args: [],
    rootPatterns: ['Cargo.toml'],
  },
  {
    id: 'go',
    name: 'gopls',
    languages: ['go'],
    command: 'gopls',
    args: ['serve'],
    rootPatterns: ['go.mod'],
  },
  {
    id: 'lua',
    name: 'Lua Language Server',
    languages: ['lua'],
    command: 'lua-language-server',
    args: [],
  },
  {
    id: 'yaml',
    name: 'YAML Language Server',
    languages: ['yaml'],
    command: 'yaml-language-server',
    args: ['--stdio'],
  },
  {
    id: 'svelte',
    name: 'Svelte Language Server',
    languages: ['svelte'],
    command: 'svelteserver',
    args: ['--stdio'],
    rootPatterns: ['svelte.config.js'],
  },
  {
    id: 'vue',
    name: 'Vue Language Server',
    languages: ['vue'],
    command: 'vue-language-server',
    args: ['--stdio'],
    rootPatterns: ['vue.config.js', 'nuxt.config.ts'],
  },
  {
    id: 'tailwind',
    name: 'Tailwind CSS IntelliSense',
    languages: ['html', 'css', 'javascriptreact', 'typescriptreact', 'vue', 'svelte'],
    command: 'tailwindcss-language-server',
    args: ['--stdio'],
    rootPatterns: ['tailwind.config.js', 'tailwind.config.ts'],
  },
]

export function getBuiltinServers(): LanguageServerConfig[] {
  return [...BUILTIN_SERVERS]
}

export function findServerForLanguage(languageId: string): LanguageServerConfig | undefined {
  return BUILTIN_SERVERS.find(s => s.languages.includes(languageId))
}

export function findServersByRootPattern(files: string[]): LanguageServerConfig[] {
  return BUILTIN_SERVERS.filter(s =>
    s.rootPatterns?.some(p => files.some(f => f.endsWith(p)))
  )
}

/* ── URI Helpers ──────────────────────────────────────── */

export function pathToUri(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.startsWith('/')) return `file://${normalized}`
  return `file:///${normalized}`
}

export function uriToPath(uri: string): string {
  const path = uri.replace(/^file:\/\/\/?/, '')
  return decodeURIComponent(path)
}

/* ── Diagnostic Helpers ───────────────────────────────── */

export function severityToString(severity: DiagnosticSeverity): string {
  switch (severity) {
    case 1: return 'error'
    case 2: return 'warning'
    case 3: return 'info'
    case 4: return 'hint'
    default: return 'unknown'
  }
}

export function completionKindToString(kind: CompletionItemKind): string {
  const map: Record<number, string> = {
    1: 'text', 2: 'method', 3: 'function', 4: 'constructor', 5: 'field',
    6: 'variable', 7: 'class', 8: 'interface', 9: 'module', 10: 'property',
    11: 'unit', 12: 'value', 13: 'enum', 14: 'keyword', 15: 'snippet',
    16: 'color', 17: 'file', 18: 'reference', 19: 'folder', 20: 'enumMember',
    21: 'constant', 22: 'struct', 23: 'event', 24: 'operator', 25: 'typeParameter',
  }
  return map[kind] || 'text'
}

export function symbolKindToIcon(kind: SymbolKind): string {
  const map: Record<number, string> = {
    1: '📄', 2: '📦', 3: '📁', 4: '📦', 5: '🔷', 6: '🔶', 7: '🟢',
    8: '🔵', 9: '🔸', 10: '🟡', 11: '🔹', 12: '⚡', 13: '📌', 14: '🔒',
    15: '📝', 16: '🔢', 17: '✅', 18: '📋', 19: '🗂️', 20: '🔑',
    21: '⬛', 22: '🟠', 23: '🏗️', 24: '⚙️', 25: '🔧', 26: '💠',
  }
  return map[kind] || '📄'
}
