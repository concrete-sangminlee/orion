/**
 * Orion IDE Extension Host System.
 *
 * Provides a comprehensive VS Code-compatible extension runtime including
 * manifest parsing, lifecycle management, sandboxed execution, marketplace
 * integration, and full API surface for commands, providers, themes,
 * keybindings, menus, and settings contributions.
 */

import type {
  Disposable,
  ExtensionManifest,
  ExtensionContext,
  StateStorage,
  SecretStorage,
  TextDocument,
  TextLine,
  Position,
  Range,
  Selection,
  TextEdit,
  TextEditor,
  TextEditorEdit,
  TextEditorDecorationType,
  CompletionItem,
  CompletionProvider,
  HoverProvider,
  Hover,
  DefinitionProvider,
  Location,
  CodeAction,
  CodeActionProvider,
  CodeLens,
  CodeLensProvider,
  WorkspaceEdit,
  Diagnostic,
  DiagnosticSeverity,
  OutputChannel,
  StatusBarItem,
  StatusBarAlignment,
  QuickPickItem,
  Event,
  OrionExtensionAPI,
  ExtensionInstance,
} from '../extensions/api'

import { disposable } from '../extensions/api'

/* ══════════════════════════════════════════════════════════
   Event Emitter
   ══════════════════════════════════════════════════════════ */

export class EventEmitter<T> {
  private listeners = new Set<(e: T) => void>()

  /** The event that external consumers subscribe to. */
  readonly event: Event<T> = (listener: (e: T) => void): Disposable => {
    this.listeners.add(listener)
    return disposable(() => this.listeners.delete(listener))
  }

  /** Fire the event, notifying all registered listeners. */
  fire(data: T): void {
    for (const listener of this.listeners) {
      try {
        listener(data)
      } catch (err) {
        console.error('[ExtensionHost] Event listener threw:', err)
      }
    }
  }

  /** Remove all listeners. */
  dispose(): void {
    this.listeners.clear()
  }
}

/* ══════════════════════════════════════════════════════════
   Extension Manifest Parsing
   ══════════════════════════════════════════════════════════ */

export interface ExtensionManifestValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/** Validate a VS Code-compatible extension manifest (package.json). */
export function validateManifest(raw: Record<string, unknown>): ExtensionManifestValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (typeof raw.name !== 'string' || raw.name.length === 0) {
    errors.push('Manifest must include a non-empty "name" field.')
  }
  if (typeof raw.version !== 'string' || !/^\d+\.\d+\.\d+/.test(raw.version)) {
    errors.push('Manifest must include a valid semver "version" field.')
  }
  if (typeof raw.publisher !== 'string' || raw.publisher.length === 0) {
    errors.push('Manifest must include a non-empty "publisher" field.')
  }
  if (!raw.displayName) {
    warnings.push('Missing "displayName"; falling back to "name".')
  }
  if (!raw.description) {
    warnings.push('Missing "description".')
  }
  if (raw.main && typeof raw.main !== 'string') {
    errors.push('"main" must be a string path if provided.')
  }
  if (raw.activationEvents && !Array.isArray(raw.activationEvents)) {
    errors.push('"activationEvents" must be an array if provided.')
  }

  const contributes = raw.contributes as Record<string, unknown> | undefined
  if (contributes) {
    if (contributes.commands && !Array.isArray(contributes.commands)) {
      errors.push('"contributes.commands" must be an array.')
    }
    if (contributes.keybindings && !Array.isArray(contributes.keybindings)) {
      errors.push('"contributes.keybindings" must be an array.')
    }
    if (contributes.themes && !Array.isArray(contributes.themes)) {
      errors.push('"contributes.themes" must be an array.')
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/** Parse a raw JSON object into a typed ExtensionManifest. */
export function parseManifest(raw: Record<string, unknown>): ExtensionManifest {
  const validation = validateManifest(raw)
  if (!validation.valid) {
    throw new Error(`Invalid extension manifest:\n${validation.errors.join('\n')}`)
  }

  return {
    name: raw.name as string,
    displayName: (raw.displayName as string) || (raw.name as string),
    version: raw.version as string,
    description: (raw.description as string) || '',
    publisher: raw.publisher as string,
    categories: (raw.categories as string[]) || [],
    activationEvents: (raw.activationEvents as string[]) || [],
    main: raw.main as string | undefined,
    contributes: raw.contributes as ExtensionManifest['contributes'],
  }
}

/* ══════════════════════════════════════════════════════════
   Extension Status & Metadata
   ══════════════════════════════════════════════════════════ */

export type ExtensionStatus =
  | 'installed'
  | 'active'
  | 'inactive'
  | 'disabled'
  | 'error'
  | 'uninstalling'

export interface ExtensionMetadata {
  id: string
  manifest: ExtensionManifest
  status: ExtensionStatus
  activationTime?: number
  error?: string
  isBuiltin: boolean
  installTimestamp: number
  enabledGlobally: boolean
  enabledWorkspace: boolean
}

export interface ExtensionActivationEvent {
  extensionId: string
  status: ExtensionStatus
  duration?: number
  error?: string
}

/* ══════════════════════════════════════════════════════════
   Marketplace Types
   ══════════════════════════════════════════════════════════ */

export interface MarketplaceExtension {
  id: string
  name: string
  displayName: string
  publisher: string
  version: string
  description: string
  categories: string[]
  downloadCount: number
  rating: number
  ratingCount: number
  icon?: string
  repository?: string
  license?: string
  lastUpdated: string
  versions: MarketplaceVersion[]
}

export interface MarketplaceVersion {
  version: string
  releaseDate: string
  engineVersion: string
  changelog?: string
  assetUrl: string
}

export interface MarketplaceSearchOptions {
  query: string
  category?: string
  sortBy?: 'relevance' | 'downloads' | 'rating' | 'updated'
  page?: number
  pageSize?: number
}

export interface MarketplaceSearchResult {
  extensions: MarketplaceExtension[]
  totalCount: number
  page: number
  pageSize: number
}

/* ══════════════════════════════════════════════════════════
   Theme Contribution Types
   ══════════════════════════════════════════════════════════ */

export interface ThemeContribution {
  id: string
  extensionId: string
  label: string
  uiTheme: 'vs-dark' | 'vs-light' | 'hc-black' | 'hc-light'
  path: string
  colors?: Record<string, string>
  tokenColors?: TokenColorRule[]
}

export interface TokenColorRule {
  name?: string
  scope: string | string[]
  settings: {
    foreground?: string
    background?: string
    fontStyle?: string
  }
}

export interface IconThemeContribution {
  id: string
  extensionId: string
  label: string
  path: string
  fileNames?: Record<string, string>
  folderNames?: Record<string, string>
  fileExtensions?: Record<string, string>
  languageIds?: Record<string, string>
}

/* ══════════════════════════════════════════════════════════
   Keybinding & Menu Contribution Types
   ══════════════════════════════════════════════════════════ */

export interface KeybindingContribution {
  extensionId: string
  command: string
  key: string
  mac?: string
  linux?: string
  win?: string
  when?: string
  weight: number
}

export interface MenuContribution {
  extensionId: string
  menuId: string
  command: string
  group?: string
  when?: string
  order?: number
}

export interface SettingsContribution {
  extensionId: string
  title: string
  properties: Record<string, SettingsPropertyContribution>
}

export interface SettingsPropertyContribution {
  type: string
  default?: unknown
  description?: string
  enum?: string[]
  enumDescriptions?: string[]
  minimum?: number
  maximum?: number
  scope?: 'application' | 'machine' | 'window' | 'resource' | 'language-overridable'
  order?: number
  deprecationMessage?: string
  markdownDescription?: string
}

/* ══════════════════════════════════════════════════════════
   Sandboxed Extension Worker
   ══════════════════════════════════════════════════════════ */

export interface ExtensionWorkerMessage {
  type: 'activate' | 'deactivate' | 'api-call' | 'api-response' | 'event' | 'error' | 'ready'
  requestId?: string
  extensionId?: string
  method?: string
  args?: unknown[]
  result?: unknown
  error?: string
}

export class ExtensionWorkerHost {
  private worker: Worker | null = null
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void
    reject: (err: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }>()
  private requestCounter = 0
  private ready = false
  private readyPromise: Promise<void>
  private readyResolve!: () => void

  constructor(
    private extensionId: string,
    private apiProxy: (method: string, args: unknown[]) => Promise<unknown>,
  ) {
    this.readyPromise = new Promise(resolve => {
      this.readyResolve = resolve
    })
  }

  /** Start the worker from a blob URL containing the extension code. */
  start(code: string): void {
    const workerScript = `
      'use strict';
      const __extensionExports = {};
      const __extensionModule = { exports: __extensionExports };

      // Restricted globals
      const disallowed = ['fetch', 'XMLHttpRequest', 'WebSocket', 'eval'];
      for (const name of disallowed) {
        Object.defineProperty(self, name, {
          get() { throw new Error(name + ' is not allowed in extension sandbox'); }
        });
      }

      // API proxy
      function __callAPI(method, ...args) {
        const requestId = 'req_' + (++self.__reqCounter);
        self.postMessage({ type: 'api-call', requestId, method, args });
        return new Promise((resolve, reject) => {
          self.__pending.set(requestId, { resolve, reject });
        });
      }
      self.__reqCounter = 0;
      self.__pending = new Map();

      self.addEventListener('message', (e) => {
        const msg = e.data;
        if (msg.type === 'api-response' && self.__pending.has(msg.requestId)) {
          const { resolve, reject } = self.__pending.get(msg.requestId);
          self.__pending.delete(msg.requestId);
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        } else if (msg.type === 'activate') {
          if (typeof __extensionExports.activate === 'function') {
            Promise.resolve(__extensionExports.activate(msg.args[0]))
              .then(() => self.postMessage({ type: 'activate', result: 'ok' }))
              .catch(err => self.postMessage({ type: 'error', error: String(err) }));
          } else {
            self.postMessage({ type: 'activate', result: 'ok' });
          }
        } else if (msg.type === 'deactivate') {
          if (typeof __extensionExports.deactivate === 'function') {
            Promise.resolve(__extensionExports.deactivate())
              .then(() => self.postMessage({ type: 'deactivate', result: 'ok' }))
              .catch(err => self.postMessage({ type: 'error', error: String(err) }));
          } else {
            self.postMessage({ type: 'deactivate', result: 'ok' });
          }
        }
      });

      // Load extension code
      try {
        (function(module, exports, require) {
          ${code}
        })(__extensionModule, __extensionExports, function require(mod) {
          if (mod === 'orion') return { callAPI: __callAPI };
          throw new Error('Cannot require module: ' + mod);
        });
        self.postMessage({ type: 'ready' });
      } catch(err) {
        self.postMessage({ type: 'error', error: 'Extension load failed: ' + String(err) });
      }
    `

    const blob = new Blob([workerScript], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    this.worker = new Worker(url)
    URL.revokeObjectURL(url)

    this.worker.addEventListener('message', (e: MessageEvent<ExtensionWorkerMessage>) => {
      this.handleMessage(e.data)
    })

    this.worker.addEventListener('error', (e) => {
      console.error(`[ExtensionWorker:${this.extensionId}] Worker error:`, e.message)
    })
  }

  /** Wait until the worker has loaded and is ready. */
  async waitReady(): Promise<void> {
    return this.readyPromise
  }

  /** Send activate message to the worker. */
  async activate(context: Record<string, unknown>): Promise<void> {
    await this.readyPromise
    return this.sendAndWait('activate', [context])
  }

  /** Send deactivate message to the worker. */
  async deactivate(): Promise<void> {
    if (!this.ready) return
    return this.sendAndWait('deactivate', [])
  }

  /** Terminate the worker. */
  terminate(): void {
    for (const { reject, timeout } of this.pendingRequests.values()) {
      clearTimeout(timeout)
      reject(new Error('Worker terminated'))
    }
    this.pendingRequests.clear()
    this.worker?.terminate()
    this.worker = null
    this.ready = false
  }

  private async sendAndWait(type: string, args: unknown[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const handler = (e: MessageEvent<ExtensionWorkerMessage>) => {
        if (e.data.type === type) {
          this.worker?.removeEventListener('message', handler)
          if (e.data.error) reject(new Error(e.data.error))
          else resolve()
        }
      }
      this.worker?.addEventListener('message', handler)
      this.worker?.postMessage({ type, args })
    })
  }

  private handleMessage(msg: ExtensionWorkerMessage): void {
    switch (msg.type) {
      case 'ready':
        this.ready = true
        this.readyResolve()
        break

      case 'api-call':
        if (msg.method && msg.requestId) {
          this.apiProxy(msg.method, msg.args || [])
            .then(result => {
              this.worker?.postMessage({
                type: 'api-response',
                requestId: msg.requestId,
                result,
              })
            })
            .catch(err => {
              this.worker?.postMessage({
                type: 'api-response',
                requestId: msg.requestId,
                error: String(err),
              })
            })
        }
        break

      case 'error':
        console.error(`[ExtensionWorker:${this.extensionId}]`, msg.error)
        break
    }
  }
}

/* ══════════════════════════════════════════════════════════
   Extension Registry
   ══════════════════════════════════════════════════════════ */

export class ExtensionRegistry {
  private extensions = new Map<string, ExtensionMetadata>()
  private disabledExtensions = new Set<string>()

  private readonly _onDidInstall = new EventEmitter<ExtensionMetadata>()
  private readonly _onDidUninstall = new EventEmitter<string>()
  private readonly _onDidEnable = new EventEmitter<string>()
  private readonly _onDidDisable = new EventEmitter<string>()
  private readonly _onDidChangeStatus = new EventEmitter<ExtensionActivationEvent>()

  readonly onDidInstall: Event<ExtensionMetadata> = this._onDidInstall.event
  readonly onDidUninstall: Event<string> = this._onDidUninstall.event
  readonly onDidEnable: Event<string> = this._onDidEnable.event
  readonly onDidDisable: Event<string> = this._onDidDisable.event
  readonly onDidChangeStatus: Event<ExtensionActivationEvent> = this._onDidChangeStatus.event

  /** Register an extension in the registry. */
  register(id: string, manifest: ExtensionManifest, isBuiltin = false): ExtensionMetadata {
    const meta: ExtensionMetadata = {
      id,
      manifest,
      status: 'installed',
      isBuiltin,
      installTimestamp: Date.now(),
      enabledGlobally: true,
      enabledWorkspace: true,
    }
    this.extensions.set(id, meta)
    this._onDidInstall.fire(meta)
    return meta
  }

  /** Remove an extension from the registry. */
  unregister(id: string): boolean {
    const ext = this.extensions.get(id)
    if (!ext) return false
    if (ext.isBuiltin) {
      throw new Error(`Cannot uninstall built-in extension: ${id}`)
    }
    ext.status = 'uninstalling'
    this.extensions.delete(id)
    this.disabledExtensions.delete(id)
    this._onDidUninstall.fire(id)
    return true
  }

  /** Get extension metadata by ID. */
  get(id: string): ExtensionMetadata | undefined {
    return this.extensions.get(id)
  }

  /** Get all registered extensions. */
  getAll(): ExtensionMetadata[] {
    return Array.from(this.extensions.values())
  }

  /** Get only enabled extensions. */
  getEnabled(): ExtensionMetadata[] {
    return this.getAll().filter(e => e.enabledGlobally && e.enabledWorkspace)
  }

  /** Get extensions by category. */
  getByCategory(category: string): ExtensionMetadata[] {
    return this.getAll().filter(e =>
      e.manifest.categories?.includes(category)
    )
  }

  /** Get extensions matching an activation event. */
  getByActivationEvent(event: string): ExtensionMetadata[] {
    return this.getEnabled().filter(e =>
      e.manifest.activationEvents?.includes('*') ||
      e.manifest.activationEvents?.includes(event)
    )
  }

  /** Enable an extension globally. */
  enable(id: string): void {
    const ext = this.extensions.get(id)
    if (!ext) return
    ext.enabledGlobally = true
    this.disabledExtensions.delete(id)
    this._onDidEnable.fire(id)
  }

  /** Disable an extension globally. */
  disable(id: string): void {
    const ext = this.extensions.get(id)
    if (!ext) return
    if (ext.isBuiltin) {
      throw new Error(`Cannot disable built-in extension: ${id}`)
    }
    ext.enabledGlobally = false
    this.disabledExtensions.add(id)
    this._onDidDisable.fire(id)
  }

  /** Enable an extension for the current workspace. */
  enableWorkspace(id: string): void {
    const ext = this.extensions.get(id)
    if (ext) ext.enabledWorkspace = true
  }

  /** Disable an extension for the current workspace. */
  disableWorkspace(id: string): void {
    const ext = this.extensions.get(id)
    if (ext) ext.enabledWorkspace = false
  }

  /** Update status and fire event. */
  setStatus(id: string, status: ExtensionStatus, duration?: number, error?: string): void {
    const ext = this.extensions.get(id)
    if (!ext) return
    ext.status = status
    ext.activationTime = duration
    ext.error = error
    this._onDidChangeStatus.fire({ extensionId: id, status, duration, error })
  }

  /** Check if an extension is installed. */
  has(id: string): boolean {
    return this.extensions.has(id)
  }

  /** Serialize registry state for persistence. */
  serialize(): string {
    const data: Record<string, { manifest: ExtensionManifest; disabled: boolean; isBuiltin: boolean }> = {}
    for (const [id, meta] of this.extensions) {
      data[id] = {
        manifest: meta.manifest,
        disabled: !meta.enabledGlobally,
        isBuiltin: meta.isBuiltin,
      }
    }
    return JSON.stringify(data)
  }

  /** Restore registry state from persisted data. */
  deserialize(json: string): void {
    try {
      const data = JSON.parse(json) as Record<string, {
        manifest: ExtensionManifest
        disabled: boolean
        isBuiltin: boolean
      }>
      for (const [id, entry] of Object.entries(data)) {
        this.register(id, entry.manifest, entry.isBuiltin)
        if (entry.disabled) this.disable(id)
      }
    } catch {
      console.error('[ExtensionRegistry] Failed to deserialize registry state.')
    }
  }

  dispose(): void {
    this._onDidInstall.dispose()
    this._onDidUninstall.dispose()
    this._onDidEnable.dispose()
    this._onDidDisable.dispose()
    this._onDidChangeStatus.dispose()
  }
}

/* ══════════════════════════════════════════════════════════
   Extension Marketplace Client
   ══════════════════════════════════════════════════════════ */

export class ExtensionMarketplace {
  private baseUrl: string

  constructor(baseUrl = 'https://marketplace.orion-ide.dev/api/v1') {
    this.baseUrl = baseUrl
  }

  /** Search extensions in the marketplace. */
  async search(options: MarketplaceSearchOptions): Promise<MarketplaceSearchResult> {
    const params = new URLSearchParams({
      q: options.query,
      ...(options.category && { category: options.category }),
      ...(options.sortBy && { sortBy: options.sortBy }),
      ...(options.page !== undefined && { page: String(options.page) }),
      ...(options.pageSize !== undefined && { pageSize: String(options.pageSize) }),
    })

    try {
      const response = await fetch(`${this.baseUrl}/extensions?${params}`)
      if (!response.ok) throw new Error(`Marketplace search failed: ${response.statusText}`)
      return response.json()
    } catch (err) {
      console.error('[Marketplace] Search error:', err)
      return { extensions: [], totalCount: 0, page: 0, pageSize: 0 }
    }
  }

  /** Get full details for a specific extension. */
  async getExtension(publisherDotName: string): Promise<MarketplaceExtension | null> {
    try {
      const response = await fetch(`${this.baseUrl}/extensions/${publisherDotName}`)
      if (!response.ok) return null
      return response.json()
    } catch {
      return null
    }
  }

  /** Download an extension VSIX package as an ArrayBuffer. */
  async downloadVsix(publisherDotName: string, version?: string): Promise<ArrayBuffer> {
    const versionPath = version ? `/${version}` : '/latest'
    const response = await fetch(
      `${this.baseUrl}/extensions/${publisherDotName}${versionPath}/download`
    )
    if (!response.ok) throw new Error(`Download failed: ${response.statusText}`)
    return response.arrayBuffer()
  }

  /** Get available versions for an extension. */
  async getVersions(publisherDotName: string): Promise<MarketplaceVersion[]> {
    try {
      const response = await fetch(`${this.baseUrl}/extensions/${publisherDotName}/versions`)
      if (!response.ok) return []
      return response.json()
    } catch {
      return []
    }
  }

  /** Install an extension from a VSIX file (as ArrayBuffer). */
  async installFromVsix(vsixData: ArrayBuffer): Promise<ExtensionManifest> {
    // In a real implementation this would unzip the VSIX, validate it, and
    // extract the package.json. For now we simulate by treating the first
    // portion as a JSON manifest for demonstration purposes.
    try {
      const decoder = new TextDecoder()
      const text = decoder.decode(vsixData)
      const raw = JSON.parse(text)
      return parseManifest(raw)
    } catch {
      throw new Error('Failed to parse VSIX package. Invalid format.')
    }
  }
}

/* ══════════════════════════════════════════════════════════
   Contribution Managers
   ══════════════════════════════════════════════════════════ */

export class ThemeContributionManager {
  private themes = new Map<string, ThemeContribution>()
  private iconThemes = new Map<string, IconThemeContribution>()
  private activeThemeId: string | null = null
  private activeIconThemeId: string | null = null

  private readonly _onDidChangeTheme = new EventEmitter<ThemeContribution | null>()
  readonly onDidChangeTheme: Event<ThemeContribution | null> = this._onDidChangeTheme.event

  /** Register a color theme contributed by an extension. */
  registerTheme(theme: ThemeContribution): Disposable {
    this.themes.set(theme.id, theme)
    return disposable(() => {
      this.themes.delete(theme.id)
      if (this.activeThemeId === theme.id) {
        this.activeThemeId = null
        this._onDidChangeTheme.fire(null)
      }
    })
  }

  /** Register an icon theme contributed by an extension. */
  registerIconTheme(theme: IconThemeContribution): Disposable {
    this.iconThemes.set(theme.id, theme)
    return disposable(() => {
      this.iconThemes.delete(theme.id)
      if (this.activeIconThemeId === theme.id) {
        this.activeIconThemeId = null
      }
    })
  }

  /** Activate a color theme by ID. */
  activateTheme(id: string): boolean {
    const theme = this.themes.get(id)
    if (!theme) return false
    this.activeThemeId = id
    this._onDidChangeTheme.fire(theme)
    this.applyThemeColors(theme)
    return true
  }

  /** Activate an icon theme by ID. */
  activateIconTheme(id: string): boolean {
    if (!this.iconThemes.has(id)) return false
    this.activeIconThemeId = id
    return true
  }

  /** Get all registered color themes. */
  getThemes(): ThemeContribution[] {
    return Array.from(this.themes.values())
  }

  /** Get all registered icon themes. */
  getIconThemes(): IconThemeContribution[] {
    return Array.from(this.iconThemes.values())
  }

  /** Get the active theme. */
  getActiveTheme(): ThemeContribution | null {
    return this.activeThemeId ? this.themes.get(this.activeThemeId) || null : null
  }

  /** Get themes contributed by a specific extension. */
  getThemesByExtension(extensionId: string): ThemeContribution[] {
    return Array.from(this.themes.values()).filter(t => t.extensionId === extensionId)
  }

  private applyThemeColors(theme: ThemeContribution): void {
    if (!theme.colors) return
    const root = document.documentElement
    for (const [key, value] of Object.entries(theme.colors)) {
      root.style.setProperty(`--orion-${key.replace(/\./g, '-')}`, value)
    }
  }

  dispose(): void {
    this._onDidChangeTheme.dispose()
  }
}

export class KeybindingContributionManager {
  private keybindings: KeybindingContribution[] = []

  private readonly _onDidChange = new EventEmitter<void>()
  readonly onDidChange: Event<void> = this._onDidChange.event

  /** Register keybindings contributed by an extension. */
  register(extensionId: string, bindings: Array<{
    command: string
    key: string
    mac?: string
    linux?: string
    win?: string
    when?: string
  }>): Disposable {
    const contributions = bindings.map((b, i) => ({
      extensionId,
      command: b.command,
      key: b.key,
      mac: b.mac,
      linux: b.linux,
      win: b.win,
      when: b.when,
      weight: 100 + i,
    }))
    this.keybindings.push(...contributions)
    this._onDidChange.fire()

    return disposable(() => {
      this.keybindings = this.keybindings.filter(k => k.extensionId !== extensionId)
      this._onDidChange.fire()
    })
  }

  /** Get all keybindings, optionally filtered by extension. */
  getAll(extensionId?: string): KeybindingContribution[] {
    if (extensionId) {
      return this.keybindings.filter(k => k.extensionId === extensionId)
    }
    return [...this.keybindings]
  }

  /** Resolve the key for the current platform. */
  resolveKey(binding: KeybindingContribution): string {
    const platform = navigator.platform.toLowerCase()
    if (platform.includes('mac') && binding.mac) return binding.mac
    if (platform.includes('linux') && binding.linux) return binding.linux
    if (platform.includes('win') && binding.win) return binding.win
    return binding.key
  }

  /** Find keybindings for a given command. */
  findByCommand(command: string): KeybindingContribution[] {
    return this.keybindings.filter(k => k.command === command)
  }

  dispose(): void {
    this._onDidChange.dispose()
  }
}

export class MenuContributionManager {
  private menus = new Map<string, MenuContribution[]>()

  private readonly _onDidChange = new EventEmitter<string>()
  readonly onDidChange: Event<string> = this._onDidChange.event

  /** Register menu contributions from an extension. */
  register(
    extensionId: string,
    menuContributions: Record<string, Array<{ command: string; when?: string; group?: string }>>,
  ): Disposable {
    for (const [menuId, items] of Object.entries(menuContributions)) {
      const existing = this.menus.get(menuId) || []
      const contributions = items.map((item, i) => ({
        extensionId,
        menuId,
        command: item.command,
        group: item.group,
        when: item.when,
        order: i,
      }))
      this.menus.set(menuId, [...existing, ...contributions])
      this._onDidChange.fire(menuId)
    }

    return disposable(() => {
      for (const [menuId, items] of this.menus) {
        const filtered = items.filter(i => i.extensionId !== extensionId)
        if (filtered.length > 0) this.menus.set(menuId, filtered)
        else this.menus.delete(menuId)
        this._onDidChange.fire(menuId)
      }
    })
  }

  /** Get menu items for a specific menu, sorted by group and order. */
  getMenuItems(menuId: string): MenuContribution[] {
    const items = this.menus.get(menuId) || []
    return [...items].sort((a, b) => {
      const groupCompare = (a.group || '').localeCompare(b.group || '')
      if (groupCompare !== 0) return groupCompare
      return (a.order ?? 0) - (b.order ?? 0)
    })
  }

  /** Get all menu IDs that have contributions. */
  getMenuIds(): string[] {
    return Array.from(this.menus.keys())
  }

  dispose(): void {
    this._onDidChange.dispose()
  }
}

export class SettingsContributionManager {
  private contributions = new Map<string, SettingsContribution>()

  private readonly _onDidChange = new EventEmitter<void>()
  readonly onDidChange: Event<void> = this._onDidChange.event

  /** Register settings contributed by an extension. */
  register(extensionId: string, config: {
    title: string
    properties: Record<string, SettingsPropertyContribution>
  }): Disposable {
    this.contributions.set(extensionId, {
      extensionId,
      title: config.title,
      properties: config.properties,
    })
    this._onDidChange.fire()

    return disposable(() => {
      this.contributions.delete(extensionId)
      this._onDidChange.fire()
    })
  }

  /** Get all contributed settings. */
  getAll(): SettingsContribution[] {
    return Array.from(this.contributions.values())
  }

  /** Get the default value for a contributed setting. */
  getDefault(key: string): unknown {
    for (const contribution of this.contributions.values()) {
      if (key in contribution.properties) {
        return contribution.properties[key].default
      }
    }
    return undefined
  }

  /** Get the full property definition for a contributed setting. */
  getPropertyDefinition(key: string): SettingsPropertyContribution | undefined {
    for (const contribution of this.contributions.values()) {
      if (key in contribution.properties) {
        return contribution.properties[key]
      }
    }
    return undefined
  }

  /** Get all property keys contributed by all extensions. */
  getAllPropertyKeys(): string[] {
    const keys: string[] = []
    for (const contribution of this.contributions.values()) {
      keys.push(...Object.keys(contribution.properties))
    }
    return keys
  }

  dispose(): void {
    this._onDidChange.dispose()
  }
}

/* ══════════════════════════════════════════════════════════
   Extension Host — Main Orchestrator
   ══════════════════════════════════════════════════════════ */

export class ExtensionHost {
  readonly registry = new ExtensionRegistry()
  readonly marketplace = new ExtensionMarketplace()
  readonly themes = new ThemeContributionManager()
  readonly keybindings = new KeybindingContributionManager()
  readonly menus = new MenuContributionManager()
  readonly settings = new SettingsContributionManager()

  private instances = new Map<string, ExtensionInstance>()
  private workers = new Map<string, ExtensionWorkerHost>()
  private commands = new Map<string, (...args: any[]) => any>()
  private diagnostics = new Map<string, Diagnostic[]>()
  private outputChannels = new Map<string, string[]>()
  private statusBarItems: StatusBarItem[] = []
  private configStore = new Map<string, unknown>()
  private extensionDisposables = new Map<string, Disposable[]>()

  /* ── Event emitters ───────────────────────────────────── */

  private readonly _onDidActivateExtension = new EventEmitter<ExtensionActivationEvent>()
  private readonly _onDidDeactivateExtension = new EventEmitter<string>()
  private readonly _onDidChangeConfiguration = new EventEmitter<{ affectsConfiguration(section: string): boolean }>()
  private readonly _onDidOpenTextDocument = new EventEmitter<TextDocument>()
  private readonly _onDidCloseTextDocument = new EventEmitter<TextDocument>()
  private readonly _onDidSaveTextDocument = new EventEmitter<TextDocument>()
  private readonly _onDidChangeActiveTextEditor = new EventEmitter<TextEditor | undefined>()
  private readonly _onDidExecuteCommand = new EventEmitter<{ command: string; args: any[] }>()

  readonly onDidActivateExtension: Event<ExtensionActivationEvent> = this._onDidActivateExtension.event
  readonly onDidDeactivateExtension: Event<string> = this._onDidDeactivateExtension.event
  readonly onDidChangeConfiguration: Event<{ affectsConfiguration(section: string): boolean }> = this._onDidChangeConfiguration.event
  readonly onDidOpenTextDocument: Event<TextDocument> = this._onDidOpenTextDocument.event
  readonly onDidCloseTextDocument: Event<TextDocument> = this._onDidCloseTextDocument.event
  readonly onDidSaveTextDocument: Event<TextDocument> = this._onDidSaveTextDocument.event
  readonly onDidChangeActiveTextEditor: Event<TextEditor | undefined> = this._onDidChangeActiveTextEditor.event
  readonly onDidExecuteCommand: Event<{ command: string; args: any[] }> = this._onDidExecuteCommand.event

  private activeTextEditor: TextEditor | undefined = undefined

  /* ── Extension Lifecycle ──────────────────────────────── */

  /** Register and optionally activate an extension. */
  async install(
    manifest: ExtensionManifest,
    activateModule?: { activate?: (ctx: ExtensionContext) => void | Promise<void>; deactivate?: () => void | Promise<void> },
    options: { activate?: boolean; builtin?: boolean } = {},
  ): Promise<string> {
    const id = `${manifest.publisher}.${manifest.name}`

    if (this.registry.has(id)) {
      throw new Error(`Extension already installed: ${id}`)
    }

    const meta = this.registry.register(id, manifest, options.builtin ?? false)

    const instance: ExtensionInstance = {
      id,
      manifest,
      isActive: false,
      activate: activateModule?.activate,
      deactivate: activateModule?.deactivate,
    }
    this.instances.set(id, instance)

    // Process contributions from manifest
    this.processContributions(id, manifest)

    if (options.activate) {
      await this.activate(id)
    }

    return id
  }

  /** Uninstall an extension, deactivating it first if needed. */
  async uninstall(id: string): Promise<void> {
    const meta = this.registry.get(id)
    if (!meta) throw new Error(`Extension not found: ${id}`)
    if (meta.isBuiltin) throw new Error(`Cannot uninstall built-in extension: ${id}`)

    if (meta.status === 'active') {
      await this.deactivate(id)
    }

    // Clean up contribution disposables
    const extDisposables = this.extensionDisposables.get(id)
    if (extDisposables) {
      for (const d of extDisposables) d.dispose()
      this.extensionDisposables.delete(id)
    }

    this.instances.delete(id)
    this.registry.unregister(id)
  }

  /** Activate an extension by ID. */
  async activate(id: string): Promise<void> {
    const instance = this.instances.get(id)
    const meta = this.registry.get(id)
    if (!instance || !meta) throw new Error(`Extension not found: ${id}`)
    if (instance.isActive) return
    if (!meta.enabledGlobally || !meta.enabledWorkspace) {
      throw new Error(`Extension is disabled: ${id}`)
    }

    const startTime = performance.now()

    try {
      const context = this.createExtensionContext(id)
      await instance.activate?.(context)
      instance.isActive = true

      const duration = Math.round(performance.now() - startTime)
      this.registry.setStatus(id, 'active', duration)
      this._onDidActivateExtension.fire({ extensionId: id, status: 'active', duration })

      window.dispatchEvent(new CustomEvent('orion:extension-activated', {
        detail: { id, duration },
      }))
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      this.registry.setStatus(id, 'error', undefined, errorMessage)
      this._onDidActivateExtension.fire({
        extensionId: id,
        status: 'error',
        error: errorMessage,
      })
      throw err
    }
  }

  /** Activate an extension in a sandboxed Web Worker. */
  async activateSandboxed(id: string, code: string): Promise<void> {
    const meta = this.registry.get(id)
    if (!meta) throw new Error(`Extension not found: ${id}`)

    const worker = new ExtensionWorkerHost(id, (method, args) => {
      return this.handleWorkerAPICall(id, method, args)
    })

    worker.start(code)
    await worker.waitReady()
    this.workers.set(id, worker)

    const startTime = performance.now()
    try {
      const contextData = {
        extensionPath: `/extensions/${id}`,
        extensionUri: `orion-ext://${id}`,
      }
      await worker.activate(contextData)

      const duration = Math.round(performance.now() - startTime)
      this.registry.setStatus(id, 'active', duration)
      this._onDidActivateExtension.fire({ extensionId: id, status: 'active', duration })
    } catch (err) {
      worker.terminate()
      this.workers.delete(id)
      const errorMessage = err instanceof Error ? err.message : String(err)
      this.registry.setStatus(id, 'error', undefined, errorMessage)
      throw err
    }
  }

  /** Deactivate an extension by ID. */
  async deactivate(id: string): Promise<void> {
    // Handle worker-based extensions
    const worker = this.workers.get(id)
    if (worker) {
      await worker.deactivate()
      worker.terminate()
      this.workers.delete(id)
    }

    const instance = this.instances.get(id)
    if (instance?.isActive) {
      await instance.deactivate?.()
      instance.isActive = false
    }

    this.registry.setStatus(id, 'inactive')
    this._onDidDeactivateExtension.fire(id)

    // Clean up commands registered by this extension
    for (const [cmd, _] of this.commands) {
      if (cmd.startsWith(id + '.')) {
        this.commands.delete(cmd)
      }
    }
  }

  /** Enable a previously disabled extension. */
  async enable(id: string): Promise<void> {
    this.registry.enable(id)
    await this.activate(id)
  }

  /** Disable an active extension. */
  async disable(id: string): Promise<void> {
    if (this.instances.get(id)?.isActive) {
      await this.deactivate(id)
    }
    this.registry.disable(id)
  }

  /** Activate all extensions matching a given activation event. */
  async activateByEvent(event: string): Promise<void> {
    const candidates = this.registry.getByActivationEvent(event)
    const activations = candidates
      .filter(m => m.status !== 'active')
      .map(m => this.activate(m.id).catch(err => {
        console.error(`[ExtensionHost] Failed to activate ${m.id} for event "${event}":`, err)
      }))
    await Promise.all(activations)
  }

  /* ── Install from marketplace ─────────────────────────── */

  /** Install an extension from the marketplace by ID (e.g. "publisher.name"). */
  async installFromMarketplace(publisherDotName: string, version?: string): Promise<string> {
    const existing = this.registry.get(publisherDotName)
    if (existing) throw new Error(`Extension already installed: ${publisherDotName}`)

    const marketplaceExt = await this.marketplace.getExtension(publisherDotName)
    if (!marketplaceExt) throw new Error(`Extension not found in marketplace: ${publisherDotName}`)

    const vsixData = await this.marketplace.downloadVsix(publisherDotName, version)
    const manifest = await this.marketplace.installFromVsix(vsixData)

    return this.install(manifest, undefined, { activate: true })
  }

  /** Update an extension to a specific version or latest. */
  async updateExtension(id: string, targetVersion?: string): Promise<void> {
    const meta = this.registry.get(id)
    if (!meta) throw new Error(`Extension not found: ${id}`)

    const versions = await this.marketplace.getVersions(id)
    const target = targetVersion
      ? versions.find(v => v.version === targetVersion)
      : versions[0]

    if (!target) throw new Error(`Version not found for ${id}: ${targetVersion || 'latest'}`)
    if (target.version === meta.manifest.version) return

    const wasActive = meta.status === 'active'
    if (wasActive) await this.deactivate(id)
    await this.uninstall(id)

    const vsixData = await this.marketplace.downloadVsix(id, target.version)
    const manifest = await this.marketplace.installFromVsix(vsixData)
    await this.install(manifest, undefined, { activate: wasActive })
  }

  /* ── Command Registry ─────────────────────────────────── */

  /** Register a command handler. */
  registerCommand(command: string, callback: (...args: any[]) => any): Disposable {
    if (this.commands.has(command)) {
      console.warn(`[ExtensionHost] Command "${command}" is already registered. Overwriting.`)
    }
    this.commands.set(command, callback)
    return disposable(() => this.commands.delete(command))
  }

  /** Execute a command by name. */
  async executeCommand(command: string, ...args: any[]): Promise<any> {
    const handler = this.commands.get(command)
    if (!handler) throw new Error(`Command not found: ${command}`)
    this._onDidExecuteCommand.fire({ command, args })
    return handler(...args)
  }

  /** Get a list of all registered commands. */
  getCommands(): string[] {
    return Array.from(this.commands.keys())
  }

  /* ── Diagnostics ──────────────────────────────────────── */

  /** Set diagnostics for a given file URI. */
  setDiagnostics(uri: string, diagnostics: Diagnostic[]): void {
    this.diagnostics.set(uri, diagnostics)
    window.dispatchEvent(new CustomEvent('orion:diagnostics-changed', {
      detail: { uri, diagnostics },
    }))
  }

  /** Get diagnostics for a file or all files. */
  getDiagnostics(uri?: string): Diagnostic[] {
    if (uri) return this.diagnostics.get(uri) || []
    const all: Diagnostic[] = []
    for (const diags of this.diagnostics.values()) all.push(...diags)
    return all
  }

  /* ── Configuration ────────────────────────────────────── */

  /** Get a configuration reader for a given section. */
  getConfiguration(section?: string) {
    const self = this
    return {
      get<T>(key: string, defaultValue?: T): T | undefined {
        const fullKey = section ? `${section}.${key}` : key
        const value = self.configStore.get(fullKey)
        if (value !== undefined) return value as T
        // Check contributed setting defaults
        const contributed = self.settings.getDefault(fullKey)
        if (contributed !== undefined) return contributed as T
        return defaultValue
      },
      update(key: string, value: unknown): void {
        const fullKey = section ? `${section}.${key}` : key
        self.configStore.set(fullKey, value)
        self._onDidChangeConfiguration.fire({
          affectsConfiguration(s: string) {
            return fullKey.startsWith(s)
          },
        })
      },
      has(key: string): boolean {
        const fullKey = section ? `${section}.${key}` : key
        return self.configStore.has(fullKey) || self.settings.getDefault(fullKey) !== undefined
      },
    }
  }

  /* ── UI Factories ─────────────────────────────────────── */

  /** Create an output channel. */
  createOutputChannel(name: string): OutputChannel {
    const lines: string[] = []
    this.outputChannels.set(name, lines)
    let visible = false

    return {
      name,
      append(value: string) {
        if (lines.length === 0) lines.push(value)
        else lines[lines.length - 1] += value
      },
      appendLine(value: string) {
        lines.push(value)
        window.dispatchEvent(new CustomEvent('orion:output-channel', {
          detail: { name, line: value },
        }))
      },
      clear() { lines.length = 0 },
      show() {
        visible = true
        window.dispatchEvent(new CustomEvent('orion:show-output', { detail: { name } }))
      },
      hide() { visible = false },
      dispose() {
        lines.length = 0
        visible = false
      },
    }
  }

  /** Create a status bar item. */
  createStatusBarItem(alignment: StatusBarAlignment = 1, priority = 0): StatusBarItem {
    let text = ''
    let tooltip: string | undefined
    let command: string | undefined
    let visible = false

    const item: StatusBarItem = {
      get text() { return text },
      set text(v) {
        text = v
        if (visible) fireUpdate()
      },
      get tooltip() { return tooltip },
      set tooltip(v) { tooltip = v },
      get command() { return command },
      set command(v) { command = v },
      alignment,
      priority,
      show() {
        visible = true
        fireUpdate()
      },
      hide() {
        visible = false
        fireUpdate()
      },
      dispose() {
        visible = false
        const idx = self.statusBarItems.indexOf(item)
        if (idx >= 0) self.statusBarItems.splice(idx, 1)
        fireUpdate()
      },
    }

    const self = this
    this.statusBarItems.push(item)

    function fireUpdate() {
      window.dispatchEvent(new CustomEvent('orion:statusbar-update', {
        detail: { items: self.getStatusBarItems() },
      }))
    }

    return item
  }

  /** Get all visible status bar items. */
  getStatusBarItems(): StatusBarItem[] {
    return this.statusBarItems.filter(i => {
      // Only return items that have been show()n - we check by attempting to read text
      // since visible is captured in closure, we rely on the item being in the list
      return i.text.length > 0
    })
  }

  /** Create a pseudo-terminal for an extension. */
  createTerminal(options: {
    name: string
    shellPath?: string
    shellArgs?: string[]
    cwd?: string
    env?: Record<string, string>
  }): { name: string; processId: Promise<number>; show(): void; hide(): void; dispose(): void; sendText(text: string): void } {
    const terminalId = `ext-terminal-${Date.now()}`

    window.dispatchEvent(new CustomEvent('orion:create-terminal', {
      detail: { id: terminalId, ...options },
    }))

    return {
      name: options.name,
      processId: Promise.resolve(-1),
      show() {
        window.dispatchEvent(new CustomEvent('orion:show-terminal', { detail: { id: terminalId } }))
      },
      hide() {
        window.dispatchEvent(new CustomEvent('orion:hide-terminal', { detail: { id: terminalId } }))
      },
      dispose() {
        window.dispatchEvent(new CustomEvent('orion:dispose-terminal', { detail: { id: terminalId } }))
      },
      sendText(text: string) {
        window.dispatchEvent(new CustomEvent('orion:terminal-input', {
          detail: { id: terminalId, text },
        }))
      },
    }
  }

  /* ── Message Dialogs ──────────────────────────────────── */

  /** Show an information message to the user. */
  async showInformationMessage(message: string, ...items: string[]): Promise<string | undefined> {
    return this.showMessage('info', message, items)
  }

  /** Show a warning message to the user. */
  async showWarningMessage(message: string, ...items: string[]): Promise<string | undefined> {
    return this.showMessage('warning', message, items)
  }

  /** Show an error message to the user. */
  async showErrorMessage(message: string, ...items: string[]): Promise<string | undefined> {
    return this.showMessage('error', message, items)
  }

  private showMessage(level: 'info' | 'warning' | 'error', message: string, items: string[]): Promise<string | undefined> {
    return new Promise(resolve => {
      window.dispatchEvent(new CustomEvent('orion:show-message', {
        detail: {
          level,
          message,
          items,
          onSelect: (selected: string | undefined) => resolve(selected),
        },
      }))

      // If no items provided, auto-resolve after dispatching
      if (items.length === 0) {
        resolve(undefined)
      }
    })
  }

  /* ── Quick Pick & Input Box ───────────────────────────── */

  /** Show a quick pick selection dialog. */
  async showQuickPick(
    items: QuickPickItem[] | string[],
    options?: { placeHolder?: string; canPickMany?: boolean },
  ): Promise<QuickPickItem | string | undefined> {
    return new Promise(resolve => {
      window.dispatchEvent(new CustomEvent('orion:show-quick-pick', {
        detail: {
          items,
          options,
          onSelect: (selected: QuickPickItem | string | undefined) => resolve(selected),
        },
      }))
    })
  }

  /** Show an input box dialog. */
  async showInputBox(options?: {
    prompt?: string
    value?: string
    placeHolder?: string
    password?: boolean
    validateInput?: (value: string) => string | undefined
  }): Promise<string | undefined> {
    return new Promise(resolve => {
      window.dispatchEvent(new CustomEvent('orion:show-input-box', {
        detail: {
          options,
          onSubmit: (value: string | undefined) => resolve(value),
        },
      }))
    })
  }

  /* ── Text Document ────────────────────────────────────── */

  /** Open a text document by URI. */
  async openTextDocument(uri: string): Promise<TextDocument> {
    // Dispatch request to the editor system and return a minimal TextDocument
    const doc = await new Promise<TextDocument>((resolve) => {
      window.dispatchEvent(new CustomEvent('orion:open-document', {
        detail: {
          uri,
          onOpen: (document: TextDocument) => resolve(document),
        },
      }))

      // Fallback: create a stub document if the editor does not respond
      setTimeout(() => {
        resolve(this.createStubDocument(uri))
      }, 1000)
    })

    this._onDidOpenTextDocument.fire(doc)
    return doc
  }

  /** Set the currently active text editor. */
  setActiveTextEditor(editor: TextEditor | undefined): void {
    this.activeTextEditor = editor
    this._onDidChangeActiveTextEditor.fire(editor)
  }

  /** Get the currently active text editor. */
  getActiveTextEditor(): TextEditor | undefined {
    return this.activeTextEditor
  }

  /** Notify the host that a document was saved. */
  fireDidSaveTextDocument(doc: TextDocument): void {
    this._onDidSaveTextDocument.fire(doc)
  }

  /** Notify the host that a document was closed. */
  fireDidCloseTextDocument(doc: TextDocument): void {
    this._onDidCloseTextDocument.fire(doc)
  }

  /* ── Language Provider Registry ───────────────────────── */

  private completionProviders = new Map<string, Array<{ provider: CompletionProvider; triggerChars: string[] }>>()
  private hoverProviders = new Map<string, HoverProvider[]>()
  private definitionProviders = new Map<string, DefinitionProvider[]>()
  private codeActionProviders = new Map<string, CodeActionProvider[]>()
  private codeLensProviders = new Map<string, CodeLensProvider[]>()

  /** Register a completion item provider. */
  registerCompletionItemProvider(
    selector: string,
    provider: CompletionProvider,
    ...triggerChars: string[]
  ): Disposable {
    const list = this.completionProviders.get(selector) || []
    const entry = { provider, triggerChars }
    list.push(entry)
    this.completionProviders.set(selector, list)
    return disposable(() => {
      const idx = list.indexOf(entry)
      if (idx >= 0) list.splice(idx, 1)
    })
  }

  /** Register a hover provider. */
  registerHoverProvider(selector: string, provider: HoverProvider): Disposable {
    const list = this.hoverProviders.get(selector) || []
    list.push(provider)
    this.hoverProviders.set(selector, list)
    return disposable(() => {
      const idx = list.indexOf(provider)
      if (idx >= 0) list.splice(idx, 1)
    })
  }

  /** Register a definition provider. */
  registerDefinitionProvider(selector: string, provider: DefinitionProvider): Disposable {
    const list = this.definitionProviders.get(selector) || []
    list.push(provider)
    this.definitionProviders.set(selector, list)
    return disposable(() => {
      const idx = list.indexOf(provider)
      if (idx >= 0) list.splice(idx, 1)
    })
  }

  /** Register a code action provider. */
  registerCodeActionsProvider(selector: string, provider: CodeActionProvider): Disposable {
    const list = this.codeActionProviders.get(selector) || []
    list.push(provider)
    this.codeActionProviders.set(selector, list)
    return disposable(() => {
      const idx = list.indexOf(provider)
      if (idx >= 0) list.splice(idx, 1)
    })
  }

  /** Register a code lens provider. */
  registerCodeLensProvider(selector: string, provider: CodeLensProvider): Disposable {
    const list = this.codeLensProviders.get(selector) || []
    list.push(provider)
    this.codeLensProviders.set(selector, list)
    return disposable(() => {
      const idx = list.indexOf(provider)
      if (idx >= 0) list.splice(idx, 1)
    })
  }

  /** Request completions from all matching providers. */
  async provideCompletionItems(languageId: string, document: TextDocument, position: Position): Promise<CompletionItem[]> {
    const results: CompletionItem[] = []
    const providers = this.completionProviders.get(languageId) || []
    for (const { provider } of providers) {
      try {
        const items = await provider.provideCompletionItems(document, position)
        results.push(...items)
      } catch (err) {
        console.error('[ExtensionHost] Completion provider error:', err)
      }
    }
    return results
  }

  /** Request hover information from all matching providers. */
  async provideHover(languageId: string, document: TextDocument, position: Position): Promise<Hover | null> {
    const providers = this.hoverProviders.get(languageId) || []
    for (const provider of providers) {
      try {
        const hover = await provider.provideHover(document, position)
        if (hover) return hover
      } catch (err) {
        console.error('[ExtensionHost] Hover provider error:', err)
      }
    }
    return null
  }

  /** Request definitions from all matching providers. */
  async provideDefinition(languageId: string, document: TextDocument, position: Position): Promise<Location[]> {
    const results: Location[] = []
    const providers = this.definitionProviders.get(languageId) || []
    for (const provider of providers) {
      try {
        const defs = provider.provideDefinition(document, position)
        if (defs) {
          if (Array.isArray(defs)) results.push(...defs)
          else results.push(defs)
        }
      } catch (err) {
        console.error('[ExtensionHost] Definition provider error:', err)
      }
    }
    return results
  }

  /** Request code actions from all matching providers. */
  async provideCodeActions(languageId: string, document: TextDocument, range: Range): Promise<CodeAction[]> {
    const results: CodeAction[] = []
    const providers = this.codeActionProviders.get(languageId) || []
    for (const provider of providers) {
      try {
        const actions = await provider.provideCodeActions(document, range)
        results.push(...actions)
      } catch (err) {
        console.error('[ExtensionHost] Code action provider error:', err)
      }
    }
    return results
  }

  /** Request code lenses from all matching providers. */
  async provideCodeLenses(languageId: string, document: TextDocument): Promise<CodeLens[]> {
    const results: CodeLens[] = []
    const providers = this.codeLensProviders.get(languageId) || []
    for (const provider of providers) {
      try {
        const lenses = await provider.provideCodeLenses(document)
        results.push(...lenses)
      } catch (err) {
        console.error('[ExtensionHost] Code lens provider error:', err)
      }
    }
    return results
  }

  /* ── Build Extension API ──────────────────────────────── */

  /** Create the VS Code-compatible API surface for a specific extension. */
  createExtensionAPI(extensionId: string): OrionExtensionAPI {
    const host = this

    return {
      commands: {
        registerCommand(command: string, callback: (...args: any[]) => any): Disposable {
          return host.registerCommand(command, callback)
        },
        executeCommand(command: string, ...args: any[]): Promise<any> {
          return host.executeCommand(command, ...args)
        },
        async getCommands(): Promise<string[]> {
          return host.getCommands()
        },
      },

      window: {
        showInformationMessage(message: string, ...items: string[]): Promise<string | undefined> {
          return host.showInformationMessage(message, ...items)
        },
        showWarningMessage(message: string, ...items: string[]): Promise<string | undefined> {
          return host.showWarningMessage(message, ...items)
        },
        showErrorMessage(message: string, ...items: string[]): Promise<string | undefined> {
          return host.showErrorMessage(message, ...items)
        },
        showQuickPick(items: QuickPickItem[] | string[], options?: { placeHolder?: string }): Promise<QuickPickItem | string | undefined> {
          return host.showQuickPick(items, options)
        },
        showInputBox(options?: { prompt?: string; value?: string; placeHolder?: string }): Promise<string | undefined> {
          return host.showInputBox(options)
        },
        createOutputChannel(name: string): OutputChannel {
          return host.createOutputChannel(name)
        },
        createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem {
          return host.createStatusBarItem(alignment, priority)
        },
        get activeTextEditor(): TextEditor | undefined {
          return host.getActiveTextEditor()
        },
        onDidChangeActiveTextEditor: host.onDidChangeActiveTextEditor,
      },

      workspace: {
        getConfiguration(section?: string) {
          return host.getConfiguration(section)
        },
        onDidChangeConfiguration: host.onDidChangeConfiguration,
        openTextDocument(uri: string): Promise<TextDocument> {
          return host.openTextDocument(uri)
        },
        onDidOpenTextDocument: host.onDidOpenTextDocument,
        onDidCloseTextDocument: host.onDidCloseTextDocument,
        onDidSaveTextDocument: host.onDidSaveTextDocument,
        rootPath: undefined,
      },

      languages: {
        registerCompletionItemProvider(selector: string, provider: CompletionProvider, ...triggerChars: string[]): Disposable {
          return host.registerCompletionItemProvider(selector, provider, ...triggerChars)
        },
        registerHoverProvider(selector: string, provider: HoverProvider): Disposable {
          return host.registerHoverProvider(selector, provider)
        },
        registerDefinitionProvider(selector: string, provider: DefinitionProvider): Disposable {
          return host.registerDefinitionProvider(selector, provider)
        },
        registerCodeActionsProvider(selector: string, provider: CodeActionProvider): Disposable {
          return host.registerCodeActionsProvider(selector, provider)
        },
        registerCodeLensProvider(selector: string, provider: CodeLensProvider): Disposable {
          return host.registerCodeLensProvider(selector, provider)
        },
        setDiagnostics(uri: string, diagnostics: Diagnostic[]): void {
          host.setDiagnostics(uri, diagnostics)
        },
        getDiagnostics(uri?: string): Diagnostic[] {
          return host.getDiagnostics(uri)
        },
      },
    }
  }

  /* ── Private Helpers ──────────────────────────────────── */

  /** Create an ExtensionContext for a given extension. */
  private createExtensionContext(extensionId: string): ExtensionContext {
    return {
      subscriptions: [],
      workspaceState: this.createStateStorage(`ext:${extensionId}:workspace`),
      globalState: this.createStateStorage(`ext:${extensionId}:global`),
      extensionPath: `/extensions/${extensionId}`,
      extensionUri: `orion-ext://${extensionId}`,
      secrets: this.createSecretStorage(extensionId),
    }
  }

  /** Create a StateStorage backed by localStorage. */
  private createStateStorage(prefix: string): StateStorage {
    return {
      get<T>(key: string, defaultValue?: T): T | undefined {
        try {
          const v = localStorage.getItem(`${prefix}:${key}`)
          return v !== null ? JSON.parse(v) : defaultValue
        } catch {
          return defaultValue
        }
      },
      update(key: string, value: unknown): void {
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

  /** Create a SecretStorage backed by localStorage (in production, use a secure store). */
  private createSecretStorage(extensionId: string): SecretStorage {
    const prefix = `ext-secret:${extensionId}`
    return {
      async get(key: string): Promise<string | undefined> {
        return localStorage.getItem(`${prefix}:${key}`) || undefined
      },
      async store(key: string, value: string): Promise<void> {
        localStorage.setItem(`${prefix}:${key}`, value)
      },
      async delete(key: string): Promise<void> {
        localStorage.removeItem(`${prefix}:${key}`)
      },
    }
  }

  /** Process contributions declared in an extension manifest. */
  private processContributions(extensionId: string, manifest: ExtensionManifest): void {
    const contribs = manifest.contributes
    if (!contribs) return

    const extDisposables: Disposable[] = []

    // Keybindings
    if (contribs.keybindings) {
      const d = this.keybindings.register(extensionId, contribs.keybindings)
      extDisposables.push(d)
    }

    // Menus
    if (contribs.menus) {
      const d = this.menus.register(extensionId, contribs.menus)
      extDisposables.push(d)
    }

    // Themes
    if (contribs.themes) {
      for (const theme of contribs.themes) {
        const d = this.themes.registerTheme({
          id: `${extensionId}.${theme.label.toLowerCase().replace(/\s+/g, '-')}`,
          extensionId,
          label: theme.label,
          uiTheme: theme.uiTheme as ThemeContribution['uiTheme'],
          path: theme.path,
        })
        extDisposables.push(d)
      }
    }

    // Configuration / settings
    if (contribs.configuration) {
      const d = this.settings.register(extensionId, {
        title: contribs.configuration.title,
        properties: contribs.configuration.properties as Record<string, SettingsPropertyContribution>,
      })
      extDisposables.push(d)
    }

    // Commands (register stubs that extensions will fill in during activate)
    if (contribs.commands) {
      for (const cmd of contribs.commands) {
        if (!this.commands.has(cmd.command)) {
          this.commands.set(cmd.command, () => {
            console.warn(`[ExtensionHost] Command "${cmd.command}" invoked but has no handler yet.`)
          })
        }
      }
    }

    this.extensionDisposables.set(extensionId, extDisposables)
  }

  /** Create a stub TextDocument for URIs that cannot be resolved by the editor. */
  private createStubDocument(uri: string): TextDocument {
    const fileName = uri.split('/').pop() || uri
    const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : ''
    const languageMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescriptreact',
      js: 'javascript', jsx: 'javascriptreact',
      py: 'python', rs: 'rust', go: 'go',
      java: 'java', c: 'c', cpp: 'cpp', h: 'c',
      css: 'css', html: 'html', json: 'json',
      md: 'markdown', yaml: 'yaml', yml: 'yaml',
      sh: 'shellscript', bash: 'shellscript',
    }
    const languageId = languageMap[ext] || 'plaintext'

    return {
      uri,
      fileName,
      languageId,
      version: 1,
      lineCount: 0,
      isDirty: false,
      getText() { return '' },
      lineAt(line: number) {
        return {
          lineNumber: line,
          text: '',
          range: { start: { line, character: 0 }, end: { line, character: 0 } },
          firstNonWhitespaceCharacterIndex: 0,
          isEmptyOrWhitespace: true,
        }
      },
      positionAt(_offset: number) { return { line: 0, character: 0 } },
      offsetAt(_position: Position) { return 0 },
    }
  }

  /** Handle API calls from a sandboxed worker extension. */
  private async handleWorkerAPICall(extensionId: string, method: string, args: unknown[]): Promise<unknown> {
    const parts = method.split('.')
    if (parts.length !== 2) throw new Error(`Invalid API method: ${method}`)

    const [namespace, fn] = parts
    const api = this.createExtensionAPI(extensionId)

    const ns = (api as any)[namespace]
    if (!ns || typeof ns[fn] !== 'function') {
      throw new Error(`Unknown API method: ${method}`)
    }

    return ns[fn](...args)
  }

  /* ── Lifecycle ────────────────────────────────────────── */

  /** Activate all installed extensions that should auto-activate. */
  async activateAll(): Promise<void> {
    await this.activateByEvent('*')
  }

  /** Deactivate all extensions and clean up. */
  async deactivateAll(): Promise<void> {
    const ids = Array.from(this.instances.keys())
    for (const id of ids) {
      try {
        await this.deactivate(id)
      } catch (err) {
        console.error(`[ExtensionHost] Error deactivating ${id}:`, err)
      }
    }
  }

  /** Full shutdown: deactivate everything, dispose resources. */
  async dispose(): Promise<void> {
    await this.deactivateAll()

    for (const disposables of this.extensionDisposables.values()) {
      for (const d of disposables) d.dispose()
    }
    this.extensionDisposables.clear()

    this.commands.clear()
    this.diagnostics.clear()
    this.outputChannels.clear()
    this.statusBarItems.length = 0
    this.configStore.clear()
    this.completionProviders.clear()
    this.hoverProviders.clear()
    this.definitionProviders.clear()
    this.codeActionProviders.clear()
    this.codeLensProviders.clear()

    this._onDidActivateExtension.dispose()
    this._onDidDeactivateExtension.dispose()
    this._onDidChangeConfiguration.dispose()
    this._onDidOpenTextDocument.dispose()
    this._onDidCloseTextDocument.dispose()
    this._onDidSaveTextDocument.dispose()
    this._onDidChangeActiveTextEditor.dispose()
    this._onDidExecuteCommand.dispose()

    this.registry.dispose()
    this.themes.dispose()
    this.keybindings.dispose()
    this.menus.dispose()
    this.settings.dispose()
  }
}

/* ══════════════════════════════════════════════════════════
   Singleton Export
   ══════════════════════════════════════════════════════════ */

export const extensionHost = new ExtensionHost()
