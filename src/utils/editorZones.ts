/**
 * Editor view zones and content widgets for the Monaco editor.
 * Provides inline widgets, code lens, inline suggestions, ghost text,
 * and embedded views within the editor.
 */

import type { editor as MonacoEditor, IDisposable } from 'monaco-editor'

/* ── Types ─────────────────────────────────────────────── */

export interface InlineWidget {
  id: string
  afterLineNumber: number
  heightInLines: number
  domNode: HTMLElement
  onComputedHeight?: (height: number) => void
  onDomNodeTop?: (top: number) => void
}

export interface ContentWidgetConfig {
  id: string
  domNode: HTMLElement
  position: {
    lineNumber: number
    column: number
  }
  preference: ('above' | 'below' | 'exact')[]
}

export interface OverlayWidgetConfig {
  id: string
  domNode: HTMLElement
  position: { preference: number } | null
}

export type ZoneType = 'inline-diff' | 'ai-suggestion' | 'code-review' | 'test-result' | 'documentation' | 'custom'

/* ── View Zone Manager ─────────────────────────────────── */

export class ViewZoneManager {
  private editor: MonacoEditor.IStandaloneCodeEditor
  private zones = new Map<string, string>() // id -> zoneId
  private domNodes = new Map<string, HTMLElement>()

  constructor(editor: MonacoEditor.IStandaloneCodeEditor) {
    this.editor = editor
  }

  /** Add a view zone (inline widget that pushes content down) */
  addZone(config: InlineWidget): string {
    const id = config.id || `zone-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    this.editor.changeViewZones(accessor => {
      const zoneId = accessor.addZone({
        afterLineNumber: config.afterLineNumber,
        heightInPx: config.heightInLines * this.getLineHeight(),
        domNode: config.domNode,
        onComputedHeight: config.onComputedHeight,
        onDomNodeTop: config.onDomNodeTop,
        suppressMouseDown: false,
      })
      this.zones.set(id, zoneId)
      this.domNodes.set(id, config.domNode)
    })

    return id
  }

  /** Remove a view zone */
  removeZone(id: string): void {
    const zoneId = this.zones.get(id)
    if (zoneId) {
      this.editor.changeViewZones(accessor => {
        accessor.removeZone(zoneId)
      })
      this.zones.delete(id)
      this.domNodes.delete(id)
    }
  }

  /** Update a view zone's content */
  updateZone(id: string, update: Partial<InlineWidget>): void {
    const zoneId = this.zones.get(id)
    if (!zoneId) return

    this.editor.changeViewZones(accessor => {
      accessor.removeZone(zoneId)

      const domNode = update.domNode || this.domNodes.get(id)!
      const newZoneId = accessor.addZone({
        afterLineNumber: update.afterLineNumber || 0,
        heightInPx: (update.heightInLines || 1) * this.getLineHeight(),
        domNode,
        suppressMouseDown: false,
      })
      this.zones.set(id, newZoneId)
      if (update.domNode) {
        this.domNodes.set(id, update.domNode)
      }
    })
  }

  /** Check if a zone exists */
  hasZone(id: string): boolean {
    return this.zones.has(id)
  }

  /** Clear all zones */
  clearAll(): void {
    this.editor.changeViewZones(accessor => {
      for (const [, zoneId] of this.zones) {
        accessor.removeZone(zoneId)
      }
    })
    this.zones.clear()
    this.domNodes.clear()
  }

  /** Get count of active zones */
  get count(): number {
    return this.zones.size
  }

  private getLineHeight(): number {
    return this.editor.getOption(66 /* EditorOption.lineHeight */) || 20
  }

  dispose(): void {
    this.clearAll()
  }
}

/* ── Content Widget Manager ────────────────────────────── */

export class ContentWidgetManager {
  private editor: MonacoEditor.IStandaloneCodeEditor
  private widgets = new Map<string, MonacoEditor.IContentWidget>()

  constructor(editor: MonacoEditor.IStandaloneCodeEditor) {
    this.editor = editor
  }

  /** Add a content widget (positioned relative to text) */
  addWidget(config: ContentWidgetConfig): void {
    if (this.widgets.has(config.id)) {
      this.removeWidget(config.id)
    }

    const preferenceMap: Record<string, number> = {
      above: 1,  // ContentWidgetPositionPreference.ABOVE
      below: 2,  // ContentWidgetPositionPreference.BELOW
      exact: 0,  // ContentWidgetPositionPreference.EXACT
    }

    const widget: MonacoEditor.IContentWidget = {
      getId: () => config.id,
      getDomNode: () => config.domNode,
      getPosition: () => ({
        position: {
          lineNumber: config.position.lineNumber,
          column: config.position.column,
        },
        preference: config.preference.map(p => preferenceMap[p] || 0),
      }),
    }

    this.editor.addContentWidget(widget)
    this.widgets.set(config.id, widget)
  }

  /** Remove a content widget */
  removeWidget(id: string): void {
    const widget = this.widgets.get(id)
    if (widget) {
      this.editor.removeContentWidget(widget)
      this.widgets.delete(id)
    }
  }

  /** Update widget position */
  updatePosition(id: string, lineNumber: number, column: number): void {
    const widget = this.widgets.get(id)
    if (widget) {
      this.editor.layoutContentWidget(widget)
    }
  }

  /** Clear all widgets */
  clearAll(): void {
    for (const [, widget] of this.widgets) {
      this.editor.removeContentWidget(widget)
    }
    this.widgets.clear()
  }

  dispose(): void {
    this.clearAll()
  }
}

/* ── Overlay Widget Manager ────────────────────────────── */

export class OverlayWidgetManager {
  private editor: MonacoEditor.IStandaloneCodeEditor
  private widgets = new Map<string, MonacoEditor.IOverlayWidget>()

  constructor(editor: MonacoEditor.IStandaloneCodeEditor) {
    this.editor = editor
  }

  /** Add an overlay widget (fixed position over editor) */
  addWidget(config: OverlayWidgetConfig): void {
    if (this.widgets.has(config.id)) {
      this.removeWidget(config.id)
    }

    const widget: MonacoEditor.IOverlayWidget = {
      getId: () => config.id,
      getDomNode: () => config.domNode,
      getPosition: () => config.position,
    }

    this.editor.addOverlayWidget(widget)
    this.widgets.set(config.id, widget)
  }

  /** Remove an overlay widget */
  removeWidget(id: string): void {
    const widget = this.widgets.get(id)
    if (widget) {
      this.editor.removeOverlayWidget(widget)
      this.widgets.delete(id)
    }
  }

  /** Clear all widgets */
  clearAll(): void {
    for (const [, widget] of this.widgets) {
      this.editor.removeOverlayWidget(widget)
    }
    this.widgets.clear()
  }

  dispose(): void {
    this.clearAll()
  }
}

/* ── Inline Diff Zone ──────────────────────────────────── */

export interface InlineDiffConfig {
  afterLine: number
  oldContent: string
  newContent: string
  onAccept?: () => void
  onReject?: () => void
}

export function createInlineDiffZone(config: InlineDiffConfig): InlineWidget {
  const container = document.createElement('div')
  container.style.cssText = `
    padding: 4px 12px;
    background: var(--bg-secondary, #1e1e1e);
    border-left: 3px solid var(--accent-primary, #007acc);
    font-family: var(--font-mono, 'Cascadia Code', monospace);
    font-size: 13px;
    line-height: 20px;
    overflow: hidden;
  `

  const oldLines = config.oldContent.split('\n')
  const newLines = config.newContent.split('\n')

  // Build diff display
  const diffHtml = buildSimpleDiffHtml(oldLines, newLines)
  const diffDiv = document.createElement('div')
  diffDiv.innerHTML = diffHtml

  // Action buttons
  const actions = document.createElement('div')
  actions.style.cssText = `
    display: flex; gap: 8px; margin-top: 4px; padding: 4px 0;
    border-top: 1px solid var(--border-primary, #333);
  `

  if (config.onAccept) {
    const acceptBtn = createActionButton('Accept', '#2ea043', config.onAccept)
    actions.appendChild(acceptBtn)
  }

  if (config.onReject) {
    const rejectBtn = createActionButton('Reject', '#f85149', config.onReject)
    actions.appendChild(rejectBtn)
  }

  container.appendChild(diffDiv)
  container.appendChild(actions)

  const heightInLines = Math.max(oldLines.length, newLines.length) + 3

  return {
    id: `diff-zone-${config.afterLine}-${Date.now()}`,
    afterLineNumber: config.afterLine,
    heightInLines,
    domNode: container,
  }
}

/* ── AI Suggestion Zone ────────────────────────────────── */

export interface AISuggestionConfig {
  afterLine: number
  suggestion: string
  model?: string
  onAccept?: () => void
  onReject?: () => void
  onModify?: () => void
}

export function createAISuggestionZone(config: AISuggestionConfig): InlineWidget {
  const container = document.createElement('div')
  container.style.cssText = `
    padding: 8px 12px;
    background: linear-gradient(135deg, rgba(88, 166, 255, 0.05), rgba(163, 113, 247, 0.05));
    border-left: 3px solid #a371f7;
    font-family: var(--font-mono, 'Cascadia Code', monospace);
    font-size: 13px;
    line-height: 20px;
    position: relative;
  `

  // AI badge
  const badge = document.createElement('div')
  badge.style.cssText = `
    position: absolute; top: 4px; right: 8px;
    font-size: 10px; color: #a371f7; font-family: system-ui;
    display: flex; align-items: center; gap: 4px;
  `
  badge.innerHTML = `<span style="font-size: 12px">✦</span> ${config.model || 'AI'}`

  // Code content
  const code = document.createElement('pre')
  code.style.cssText = `
    margin: 0; color: var(--text-secondary, #8b949e);
    white-space: pre-wrap; word-break: break-all;
  `
  code.textContent = config.suggestion

  // Actions
  const actions = document.createElement('div')
  actions.style.cssText = `
    display: flex; gap: 6px; margin-top: 8px; font-family: system-ui; font-size: 12px;
  `

  if (config.onAccept) {
    actions.appendChild(createActionButton('Accept (Tab)', '#2ea043', config.onAccept))
  }
  if (config.onReject) {
    actions.appendChild(createActionButton('Dismiss (Esc)', '#8b949e', config.onReject))
  }
  if (config.onModify) {
    actions.appendChild(createActionButton('Modify', '#58a6ff', config.onModify))
  }

  container.appendChild(badge)
  container.appendChild(code)
  container.appendChild(actions)

  const lines = config.suggestion.split('\n').length
  return {
    id: `ai-suggestion-${config.afterLine}-${Date.now()}`,
    afterLineNumber: config.afterLine,
    heightInLines: lines + 3,
    domNode: container,
  }
}

/* ── Test Result Zone ──────────────────────────────────── */

export interface TestResultConfig {
  afterLine: number
  testName: string
  status: 'passed' | 'failed' | 'skipped' | 'running'
  duration?: number
  error?: string
  onRerun?: () => void
  onDebug?: () => void
}

export function createTestResultZone(config: TestResultConfig): InlineWidget {
  const container = document.createElement('div')

  const statusColors = {
    passed: '#2ea043',
    failed: '#f85149',
    skipped: '#d29922',
    running: '#58a6ff',
  }

  const statusIcons = {
    passed: '✓',
    failed: '✗',
    skipped: '○',
    running: '⟳',
  }

  const color = statusColors[config.status]

  container.style.cssText = `
    padding: 4px 12px;
    background: ${color}10;
    border-left: 3px solid ${color};
    font-family: system-ui, sans-serif;
    font-size: 12px;
    line-height: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
  `

  const icon = document.createElement('span')
  icon.style.cssText = `color: ${color}; font-weight: bold; font-size: 14px;`
  icon.textContent = statusIcons[config.status]

  const name = document.createElement('span')
  name.style.color = 'var(--text-primary, #e6edf3)'
  name.textContent = config.testName

  const duration = document.createElement('span')
  duration.style.color = 'var(--text-muted, #8b949e)'
  duration.textContent = config.duration ? `(${config.duration}ms)` : ''

  container.appendChild(icon)
  container.appendChild(name)
  container.appendChild(duration)

  if (config.error) {
    const errorDiv = document.createElement('div')
    errorDiv.style.cssText = `
      margin-left: auto; color: ${statusColors.failed};
      font-family: var(--font-mono, monospace); font-size: 11px;
      max-width: 400px; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap;
    `
    errorDiv.textContent = config.error
    errorDiv.title = config.error
    container.appendChild(errorDiv)
  }

  // Action buttons
  const actions = document.createElement('div')
  actions.style.cssText = 'display: flex; gap: 4px; margin-left: auto;'

  if (config.onRerun) {
    const btn = createSmallButton('Re-run', config.onRerun)
    actions.appendChild(btn)
  }
  if (config.onDebug && config.status === 'failed') {
    const btn = createSmallButton('Debug', config.onDebug)
    actions.appendChild(btn)
  }

  container.appendChild(actions)

  let heightInLines = 1
  if (config.error) heightInLines += Math.ceil(config.error.length / 80)

  return {
    id: `test-result-${config.afterLine}-${Date.now()}`,
    afterLineNumber: config.afterLine,
    heightInLines,
    domNode: container,
  }
}

/* ── Code Review Comment Zone ──────────────────────────── */

export interface CodeReviewConfig {
  afterLine: number
  author: string
  avatar?: string
  comment: string
  timestamp: number
  resolved?: boolean
  onReply?: (text: string) => void
  onResolve?: () => void
}

export function createCodeReviewZone(config: CodeReviewConfig): InlineWidget {
  const container = document.createElement('div')
  container.style.cssText = `
    padding: 8px 12px;
    background: var(--bg-tertiary, #161b22);
    border-left: 3px solid #58a6ff;
    border-radius: 0 6px 6px 0;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.5;
  `

  // Header
  const header = document.createElement('div')
  header.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 4px;'

  const avatar = document.createElement('div')
  avatar.style.cssText = `
    width: 24px; height: 24px; border-radius: 50%;
    background: #30363d; display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: bold; color: #58a6ff;
  `
  avatar.textContent = config.author.slice(0, 2).toUpperCase()

  const authorName = document.createElement('span')
  authorName.style.cssText = 'font-weight: 600; color: var(--text-primary, #e6edf3);'
  authorName.textContent = config.author

  const time = document.createElement('span')
  time.style.cssText = 'font-size: 11px; color: var(--text-muted, #8b949e);'
  time.textContent = formatTimeAgo(config.timestamp)

  if (config.resolved) {
    const resolved = document.createElement('span')
    resolved.style.cssText = 'font-size: 11px; color: #2ea043; margin-left: auto;'
    resolved.textContent = '✓ Resolved'
    header.appendChild(resolved)
  }

  header.appendChild(avatar)
  header.appendChild(authorName)
  header.appendChild(time)

  // Comment body
  const body = document.createElement('div')
  body.style.cssText = 'color: var(--text-secondary, #c9d1d9); margin-left: 32px;'
  body.textContent = config.comment

  // Actions
  const actions = document.createElement('div')
  actions.style.cssText = 'display: flex; gap: 8px; margin-left: 32px; margin-top: 6px;'

  if (config.onReply) {
    actions.appendChild(createSmallButton('Reply', () => config.onReply?.('')))
  }
  if (config.onResolve && !config.resolved) {
    actions.appendChild(createSmallButton('Resolve', config.onResolve))
  }

  container.appendChild(header)
  container.appendChild(body)
  container.appendChild(actions)

  const commentLines = Math.ceil(config.comment.length / 60)
  return {
    id: `review-${config.afterLine}-${Date.now()}`,
    afterLineNumber: config.afterLine,
    heightInLines: commentLines + 3,
    domNode: container,
  }
}

/* ── Helpers ───────────────────────────────────────────── */

function createActionButton(label: string, color: string, onClick: () => void): HTMLElement {
  const btn = document.createElement('button')
  btn.style.cssText = `
    padding: 3px 10px; border: 1px solid ${color}40; border-radius: 4px;
    background: ${color}15; color: ${color}; font-size: 12px; cursor: pointer;
    font-family: system-ui; transition: background 0.15s;
  `
  btn.textContent = label
  btn.onmouseenter = () => { btn.style.background = `${color}30` }
  btn.onmouseleave = () => { btn.style.background = `${color}15` }
  btn.onclick = (e) => { e.stopPropagation(); onClick() }
  return btn
}

function createSmallButton(label: string, onClick: () => void): HTMLElement {
  const btn = document.createElement('button')
  btn.style.cssText = `
    padding: 2px 8px; border: 1px solid var(--border-primary, #30363d);
    border-radius: 3px; background: transparent; color: var(--text-secondary, #8b949e);
    font-size: 11px; cursor: pointer; font-family: system-ui;
    transition: background 0.15s, color 0.15s;
  `
  btn.textContent = label
  btn.onmouseenter = () => {
    btn.style.background = 'var(--bg-hover, #30363d)'
    btn.style.color = 'var(--text-primary, #e6edf3)'
  }
  btn.onmouseleave = () => {
    btn.style.background = 'transparent'
    btn.style.color = 'var(--text-secondary, #8b949e)'
  }
  btn.onclick = (e) => { e.stopPropagation(); onClick() }
  return btn
}

function buildSimpleDiffHtml(oldLines: string[], newLines: string[]): string {
  const html: string[] = []

  const maxLen = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : null
    const newLine = i < newLines.length ? newLines[i] : null

    if (oldLine === newLine) {
      html.push(`<div style="color: var(--text-muted, #8b949e);">&nbsp;${escapeHtml(oldLine || '')}</div>`)
    } else {
      if (oldLine !== null) {
        html.push(`<div style="background: rgba(248,81,73,0.1); color: #f85149;">-${escapeHtml(oldLine)}</div>`)
      }
      if (newLine !== null) {
        html.push(`<div style="background: rgba(46,160,67,0.1); color: #2ea043;">+${escapeHtml(newLine)}</div>`)
      }
    }
  }

  return html.join('')
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return new Date(timestamp).toLocaleDateString()
}

/* ── Composite Manager ─────────────────────────────────── */

export class EditorZoneManager {
  readonly viewZones: ViewZoneManager
  readonly contentWidgets: ContentWidgetManager
  readonly overlayWidgets: OverlayWidgetManager
  private editor: MonacoEditor.IStandaloneCodeEditor

  constructor(editor: MonacoEditor.IStandaloneCodeEditor) {
    this.editor = editor
    this.viewZones = new ViewZoneManager(editor)
    this.contentWidgets = new ContentWidgetManager(editor)
    this.overlayWidgets = new OverlayWidgetManager(editor)
  }

  /** Add an inline diff zone */
  addInlineDiff(config: InlineDiffConfig): string {
    const zone = createInlineDiffZone(config)
    return this.viewZones.addZone(zone)
  }

  /** Add an AI suggestion zone */
  addAISuggestion(config: AISuggestionConfig): string {
    const zone = createAISuggestionZone(config)
    return this.viewZones.addZone(zone)
  }

  /** Add a test result zone */
  addTestResult(config: TestResultConfig): string {
    const zone = createTestResultZone(config)
    return this.viewZones.addZone(zone)
  }

  /** Add a code review comment zone */
  addCodeReview(config: CodeReviewConfig): string {
    const zone = createCodeReviewZone(config)
    return this.viewZones.addZone(zone)
  }

  /** Clear everything */
  clearAll(): void {
    this.viewZones.clearAll()
    this.contentWidgets.clearAll()
    this.overlayWidgets.clearAll()
  }

  dispose(): void {
    this.viewZones.dispose()
    this.contentWidgets.dispose()
    this.overlayWidgets.dispose()
  }
}
