/**
 * Editor decoration management system for the Monaco editor.
 * Provides decoration lifecycle, owner-based management, priority rendering,
 * animation support, and factory functions for common decoration patterns
 * such as diagnostics, git gutter, search highlights, and AI suggestions.
 */

import type { editor as MonacoEditor, IRange } from 'monaco-editor'

/* ── Enums & Constants ────────────────────────────────── */

export enum DecorationType {
  LineHighlight = 'line-highlight',
  GutterIcon = 'gutter-icon',
  InlineText = 'inline-text',
  AfterLineText = 'after-line-text',
  LineClass = 'line-class',
  WordHighlight = 'word-highlight',
  BracketMatch = 'bracket-match',
  IndentGuide = 'indent-guide',
  WhitespaceRendering = 'whitespace-rendering',
  TrailingWhitespace = 'trailing-whitespace',
  CurrentLine = 'current-line',
  SelectionHighlight = 'selection-highlight',
}

export enum DecorationPriority {
  Background = 0,
  IndentGuide = 10,
  Whitespace = 15,
  GitGutter = 20,
  Coverage = 25,
  MergeConflict = 30,
  Diagnostic = 40,
  SearchMatch = 50,
  WordHighlight = 55,
  BracketMatch = 60,
  Breakpoint = 70,
  CurrentLine = 75,
  Selection = 80,
  AISuggestion = 90,
  InlineBlame = 95,
}

export enum DiagnosticSeverity {
  Error = 'error',
  Warning = 'warning',
  Info = 'info',
  Hint = 'hint',
}

export enum GitChangeType {
  Added = 'added',
  Modified = 'modified',
  Deleted = 'deleted',
}

export enum AnimationType {
  None = 'none',
  FadeIn = 'fade-in',
  FadeOut = 'fade-out',
  Pulse = 'pulse',
}

export type DecorationOwner =
  | 'git-blame'
  | 'ai-suggestion'
  | 'search-highlight'
  | 'diagnostics'
  | 'breakpoint'
  | 'bracket-match'
  | 'word-highlight'
  | 'indent-guide'
  | 'whitespace'
  | 'coverage'
  | 'merge-conflict'
  | 'current-line'
  | 'selection-highlight'
  | string

/* ── CSS Variable Colors ──────────────────────────────── */

const CSS_VAR_MAP: Record<string, string> = {
  'error-foreground': 'var(--vscode-editorError-foreground, #f85149)',
  'warning-foreground': 'var(--vscode-editorWarning-foreground, #d29922)',
  'info-foreground': 'var(--vscode-editorInfo-foreground, #58a6ff)',
  'hint-foreground': 'var(--vscode-editorHint-foreground, #6e7681)',
  'git-added': 'var(--vscode-gitDecoration-addedResourceForeground, #2ea043)',
  'git-modified': 'var(--vscode-gitDecoration-modifiedResourceForeground, #d29922)',
  'git-deleted': 'var(--vscode-gitDecoration-deletedResourceForeground, #f85149)',
  'search-match': 'var(--vscode-editor-findMatchHighlightBackground, #f8e45c44)',
  'search-match-active': 'var(--vscode-editor-findMatchBackground, #f8e45c88)',
  'selection-highlight': 'var(--vscode-editor-selectionHighlightBackground, #add6ff26)',
  'word-highlight': 'var(--vscode-editor-wordHighlightBackground, #575757b8)',
  'word-highlight-strong': 'var(--vscode-editor-wordHighlightStrongBackground, #004972b8)',
  'bracket-1': 'var(--vscode-editorBracketHighlight-foreground1, #ffd700)',
  'bracket-2': 'var(--vscode-editorBracketHighlight-foreground2, #da70d6)',
  'bracket-3': 'var(--vscode-editorBracketHighlight-foreground3, #179fff)',
  'current-line': 'var(--vscode-editor-lineHighlightBackground, #ffffff0a)',
  'indent-active': 'var(--vscode-editorIndentGuide-activeBackground, #e0e0e0)',
  'indent-inactive': 'var(--vscode-editorIndentGuide-background, #404040)',
  'whitespace': 'var(--vscode-editorWhitespace-foreground, #3b3b3b)',
  'trailing-whitespace': 'var(--vscode-editorUnnecessaryCode-opacity, #00000077)',
  'coverage-covered': 'var(--vscode-testing-coveredBackground, #2ea04340)',
  'coverage-uncovered': 'var(--vscode-testing-uncoveredBackground, #f8514940)',
  'merge-current': 'var(--vscode-merge-currentHeaderBackground, #40c8ae80)',
  'merge-incoming': 'var(--vscode-merge-incomingHeaderBackground, #40a6ff80)',
  'merge-common': 'var(--vscode-merge-commonHeaderBackground, #60606080)',
  'ai-ghost': 'var(--vscode-editorGhostText-foreground, #6e768180)',
  'breakpoint': 'var(--vscode-debugIcon-breakpointForeground, #e51400)',
}

export function resolveColor(key: string): string {
  return CSS_VAR_MAP[key] ?? key
}

/* ── Core Types ───────────────────────────────────────── */

export interface DecorationRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface DecorationStyle {
  className?: string
  inlineClassName?: string
  glyphMarginClassName?: string
  afterContentClassName?: string
  beforeContentClassName?: string
  backgroundColor?: string
  color?: string
  border?: string
  outline?: string
  fontStyle?: string
  fontWeight?: string
  opacity?: string
  letterSpacing?: string
  cursor?: string
  textDecoration?: string
  overviewRulerColor?: string
  overviewRulerLane?: 'left' | 'center' | 'right' | 'full'
  minimapColor?: string
  isWholeLine?: boolean
  zIndex?: number
}

export interface DecorationAnimation {
  type: AnimationType
  duration: number
  delay?: number
  iterationCount?: number | 'infinite'
}

export interface Decoration {
  id: string
  owner: DecorationOwner
  type: DecorationType
  range: DecorationRange
  style: DecorationStyle
  priority: number
  animation?: DecorationAnimation
  hoverMessage?: string | { value: string }[]
  stickiness?: 'AlwaysGrowsWhenTypingAtEdges' | 'NeverGrowsWhenTypingAtEdges' | 'GrowsOnlyWhenTypingBefore' | 'GrowsOnlyWhenTypingAfter'
  metadata?: Record<string, unknown>
}

export interface DecorationDelta {
  added?: Decoration[]
  removed?: string[]
  changed?: Array<{ id: string; range?: DecorationRange; style?: Partial<DecorationStyle> }>
}

export interface BatchOperation {
  owner: DecorationOwner
  delta: DecorationDelta
}

/* ── Animation CSS Generation ─────────────────────────── */

const ANIMATION_KEYFRAMES = new Map<AnimationType, string>()

function ensureAnimationStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('orion-decoration-animations')) return

  const style = document.createElement('style')
  style.id = 'orion-decoration-animations'
  style.textContent = `
    @keyframes orion-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes orion-fade-out {
      from { opacity: 1; }
      to { opacity: 0; }
    }
    @keyframes orion-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `
  document.head.appendChild(style)

  ANIMATION_KEYFRAMES.set(AnimationType.FadeIn, 'orion-fade-in')
  ANIMATION_KEYFRAMES.set(AnimationType.FadeOut, 'orion-fade-out')
  ANIMATION_KEYFRAMES.set(AnimationType.Pulse, 'orion-pulse')
}

function buildAnimationCSS(animation: DecorationAnimation): string {
  const keyframe = ANIMATION_KEYFRAMES.get(animation.type)
  if (!keyframe) return ''
  const iterations = animation.iterationCount === 'infinite' ? 'infinite' : (animation.iterationCount ?? 1)
  const delay = animation.delay ?? 0
  return `animation: ${keyframe} ${animation.duration}ms ease ${delay}ms ${iterations}`
}

/* ── Monaco Conversion ────────────────────────────────── */

const STICKINESS_MAP: Record<string, number> = {
  AlwaysGrowsWhenTypingAtEdges: 0,
  NeverGrowsWhenTypingAtEdges: 1,
  GrowsOnlyWhenTypingBefore: 2,
  GrowsOnlyWhenTypingAfter: 3,
}

const OVERVIEW_LANE_MAP: Record<string, number> = {
  left: 1,
  center: 2,
  right: 4,
  full: 7,
}

function toMonacoRange(range: DecorationRange): IRange {
  return {
    startLineNumber: range.startLineNumber,
    startColumn: range.startColumn,
    endLineNumber: range.endLineNumber,
    endColumn: range.endColumn,
  }
}

export function decorationToMonaco(
  dec: Decoration
): MonacoEditor.IModelDeltaDecoration {
  const options: MonacoEditor.IModelDecorationOptions = {
    className: dec.style.className,
    inlineClassName: dec.style.inlineClassName,
    glyphMarginClassName: dec.style.glyphMarginClassName,
    afterContentClassName: dec.style.afterContentClassName,
    beforeContentClassName: dec.style.beforeContentClassName,
    isWholeLine: dec.style.isWholeLine ?? false,
    zIndex: dec.style.zIndex ?? dec.priority,
    stickiness: dec.stickiness ? STICKINESS_MAP[dec.stickiness] : undefined,
    hoverMessage: dec.hoverMessage
      ? Array.isArray(dec.hoverMessage)
        ? dec.hoverMessage
        : { value: dec.hoverMessage }
      : undefined,
  }

  if (dec.style.overviewRulerColor) {
    options.overviewRuler = {
      color: dec.style.overviewRulerColor,
      position: OVERVIEW_LANE_MAP[dec.style.overviewRulerLane ?? 'center'],
    }
  }

  if (dec.style.minimapColor) {
    options.minimap = {
      color: dec.style.minimapColor,
      position: 2, // Gutter
    }
  }

  return {
    range: toMonacoRange(dec.range),
    options,
  }
}

export function decorationsToMonacoDelta(
  decorations: Decoration[]
): MonacoEditor.IModelDeltaDecoration[] {
  return [...decorations]
    .sort((a, b) => a.priority - b.priority)
    .map(decorationToMonaco)
}

/* ── ID Generator ─────────────────────────────────────── */

let decorationCounter = 0

function generateId(owner: DecorationOwner): string {
  return `${owner}-${++decorationCounter}-${Date.now().toString(36)}`
}

/* ── Decoration Manager ───────────────────────────────── */

export class DecorationManager {
  private decorations = new Map<string, Decoration>()
  private ownerIndex = new Map<DecorationOwner, Set<string>>()
  private monacoIds = new Map<string, string[]>()
  private editor: MonacoEditor.IStandaloneCodeEditor | null = null
  private pendingBatch: BatchOperation[] = []
  private batchScheduled = false
  private listeners = new Map<string, Set<(delta: DecorationDelta) => void>>()

  constructor(editor?: MonacoEditor.IStandaloneCodeEditor) {
    this.editor = editor ?? null
    ensureAnimationStyles()
  }

  /** Attach or replace the Monaco editor instance */
  setEditor(editor: MonacoEditor.IStandaloneCodeEditor): void {
    this.editor = editor
    this.syncAllToEditor()
  }

  /** Get the current editor instance */
  getEditor(): MonacoEditor.IStandaloneCodeEditor | null {
    return this.editor
  }

  /* ── CRUD Operations ─────────────────────────────── */

  /** Create a new decoration and return its id */
  create(decoration: Omit<Decoration, 'id'>): string {
    const id = generateId(decoration.owner)
    const full: Decoration = { ...decoration, id }

    this.decorations.set(id, full)
    this.indexByOwner(decoration.owner, id)
    this.applyToEditor([full], [])
    this.notifyListeners(decoration.owner, { added: [full] })
    return id
  }

  /** Create multiple decorations at once */
  createMany(decorations: Omit<Decoration, 'id'>[]): string[] {
    const ids: string[] = []
    const created: Decoration[] = []

    for (const dec of decorations) {
      const id = generateId(dec.owner)
      const full: Decoration = { ...dec, id }
      this.decorations.set(id, full)
      this.indexByOwner(dec.owner, id)
      ids.push(id)
      created.push(full)
    }

    this.applyToEditor(created, [])

    // Group by owner for notifications
    const byOwner = new Map<DecorationOwner, Decoration[]>()
    for (const d of created) {
      const list = byOwner.get(d.owner) ?? []
      list.push(d)
      byOwner.set(d.owner, list)
    }
    for (const [owner, decs] of byOwner) {
      this.notifyListeners(owner, { added: decs })
    }

    return ids
  }

  /** Update an existing decoration */
  update(id: string, changes: { range?: DecorationRange; style?: Partial<DecorationStyle>; hoverMessage?: string | { value: string }[] }): boolean {
    const existing = this.decorations.get(id)
    if (!existing) return false

    const updated: Decoration = {
      ...existing,
      range: changes.range ?? existing.range,
      style: changes.style ? { ...existing.style, ...changes.style } : existing.style,
      hoverMessage: changes.hoverMessage ?? existing.hoverMessage,
    }

    this.decorations.set(id, updated)
    this.syncOwnerToEditor(existing.owner)
    this.notifyListeners(existing.owner, { changed: [{ id, range: changes.range, style: changes.style }] })
    return true
  }

  /** Remove a decoration by id */
  remove(id: string): boolean {
    const dec = this.decorations.get(id)
    if (!dec) return false

    this.decorations.delete(id)
    this.ownerIndex.get(dec.owner)?.delete(id)
    this.syncOwnerToEditor(dec.owner)
    this.notifyListeners(dec.owner, { removed: [id] })
    return true
  }

  /** Remove multiple decorations by ids */
  removeMany(ids: string[]): number {
    let count = 0
    const affectedOwners = new Set<DecorationOwner>()
    const removedByOwner = new Map<DecorationOwner, string[]>()

    for (const id of ids) {
      const dec = this.decorations.get(id)
      if (!dec) continue
      this.decorations.delete(id)
      this.ownerIndex.get(dec.owner)?.delete(id)
      affectedOwners.add(dec.owner)
      const list = removedByOwner.get(dec.owner) ?? []
      list.push(id)
      removedByOwner.set(dec.owner, list)
      count++
    }

    for (const owner of affectedOwners) {
      this.syncOwnerToEditor(owner)
    }
    for (const [owner, removed] of removedByOwner) {
      this.notifyListeners(owner, { removed })
    }
    return count
  }

  /** Clear all decorations for a given owner */
  clearByOwner(owner: DecorationOwner): number {
    const ids = this.ownerIndex.get(owner)
    if (!ids || ids.size === 0) return 0

    const removed = [...ids]
    for (const id of removed) {
      this.decorations.delete(id)
    }
    ids.clear()
    this.syncOwnerToEditor(owner)
    this.notifyListeners(owner, { removed })
    return removed.length
  }

  /** Clear all decorations */
  clearAll(): void {
    const allOwners = [...this.ownerIndex.keys()]
    this.decorations.clear()
    this.ownerIndex.clear()

    if (this.editor) {
      const model = this.editor.getModel()
      if (model) {
        for (const [key, oldIds] of this.monacoIds) {
          if (oldIds.length > 0) {
            model.deltaDecorations(oldIds, [])
          }
        }
        this.monacoIds.clear()
      }
    }

    for (const owner of allOwners) {
      this.notifyListeners(owner, { removed: [] })
    }
  }

  /* ── Query Operations ────────────────────────────── */

  /** Get a decoration by id */
  get(id: string): Decoration | undefined {
    return this.decorations.get(id)
  }

  /** Get all decorations for an owner */
  getByOwner(owner: DecorationOwner): Decoration[] {
    const ids = this.ownerIndex.get(owner)
    if (!ids) return []
    const result: Decoration[] = []
    for (const id of ids) {
      const d = this.decorations.get(id)
      if (d) result.push(d)
    }
    return result
  }

  /** Get all decorations touching a specific line */
  getByLine(lineNumber: number): Decoration[] {
    const result: Decoration[] = []
    for (const dec of this.decorations.values()) {
      if (dec.range.startLineNumber <= lineNumber && dec.range.endLineNumber >= lineNumber) {
        result.push(dec)
      }
    }
    return result.sort((a, b) => a.priority - b.priority)
  }

  /** Get all decorations intersecting a range */
  getByRange(range: DecorationRange): Decoration[] {
    const result: Decoration[] = []
    for (const dec of this.decorations.values()) {
      if (rangesIntersect(dec.range, range)) {
        result.push(dec)
      }
    }
    return result.sort((a, b) => a.priority - b.priority)
  }

  /** Get all decoration owners currently active */
  getActiveOwners(): DecorationOwner[] {
    const owners: DecorationOwner[] = []
    for (const [owner, ids] of this.ownerIndex) {
      if (ids.size > 0) owners.push(owner)
    }
    return owners
  }

  /** Count decorations, optionally filtered by owner */
  count(owner?: DecorationOwner): number {
    if (owner) return this.ownerIndex.get(owner)?.size ?? 0
    return this.decorations.size
  }

  /* ── Batch Operations ────────────────────────────── */

  /** Queue a batch operation. It will be flushed on the next microtask */
  batch(operation: BatchOperation): void {
    this.pendingBatch.push(operation)
    if (!this.batchScheduled) {
      this.batchScheduled = true
      queueMicrotask(() => this.flushBatch())
    }
  }

  /** Immediately flush all pending batch operations */
  flushBatch(): void {
    this.batchScheduled = false
    const ops = this.pendingBatch.splice(0)
    if (ops.length === 0) return

    const affectedOwners = new Set<DecorationOwner>()

    for (const op of ops) {
      affectedOwners.add(op.owner)

      if (op.delta.removed) {
        for (const id of op.delta.removed) {
          this.decorations.delete(id)
          this.ownerIndex.get(op.owner)?.delete(id)
        }
      }

      if (op.delta.changed) {
        for (const change of op.delta.changed) {
          const existing = this.decorations.get(change.id)
          if (!existing) continue
          const updated: Decoration = {
            ...existing,
            range: change.range ?? existing.range,
            style: change.style ? { ...existing.style, ...change.style } : existing.style,
          }
          this.decorations.set(change.id, updated)
        }
      }

      if (op.delta.added) {
        for (const dec of op.delta.added) {
          const id = dec.id || generateId(dec.owner)
          const full: Decoration = { ...dec, id }
          this.decorations.set(id, full)
          this.indexByOwner(op.owner, id)
        }
      }
    }

    for (const owner of affectedOwners) {
      this.syncOwnerToEditor(owner)
    }
  }

  /* ── Event Listeners ─────────────────────────────── */

  /** Subscribe to decoration changes for a given owner */
  onChange(owner: DecorationOwner, callback: (delta: DecorationDelta) => void): () => void {
    let set = this.listeners.get(owner)
    if (!set) {
      set = new Set()
      this.listeners.set(owner, set)
    }
    set.add(callback)
    return () => { set!.delete(callback) }
  }

  /* ── Internal Helpers ────────────────────────────── */

  private indexByOwner(owner: DecorationOwner, id: string): void {
    let set = this.ownerIndex.get(owner)
    if (!set) {
      set = new Set()
      this.ownerIndex.set(owner, set)
    }
    set.add(id)
  }

  private notifyListeners(owner: DecorationOwner, delta: DecorationDelta): void {
    const set = this.listeners.get(owner)
    if (!set) return
    for (const cb of set) {
      try { cb(delta) } catch { /* swallow listener errors */ }
    }
  }

  private applyToEditor(added: Decoration[], _removed: string[]): void {
    if (!this.editor) return
    // We sync by owner for simplicity and correctness
    const owners = new Set(added.map(d => d.owner))
    for (const owner of owners) {
      this.syncOwnerToEditor(owner)
    }
  }

  private syncOwnerToEditor(owner: DecorationOwner): void {
    if (!this.editor) return
    const model = this.editor.getModel()
    if (!model) return

    const decorations = this.getByOwner(owner)
    const monacoDecorations = decorationsToMonacoDelta(decorations)
    const oldIds = this.monacoIds.get(owner) ?? []
    const newIds = model.deltaDecorations(oldIds, monacoDecorations)
    this.monacoIds.set(owner, newIds)
  }

  private syncAllToEditor(): void {
    for (const owner of this.ownerIndex.keys()) {
      this.syncOwnerToEditor(owner)
    }
  }

  /** Dispose and clean up all decorations */
  dispose(): void {
    this.clearAll()
    this.listeners.clear()
    this.editor = null
  }
}

/* ── Range Utilities ──────────────────────────────────── */

function rangesIntersect(a: DecorationRange, b: DecorationRange): boolean {
  if (a.endLineNumber < b.startLineNumber) return false
  if (b.endLineNumber < a.startLineNumber) return false
  if (a.endLineNumber === b.startLineNumber && a.endColumn < b.startColumn) return false
  if (b.endLineNumber === a.startLineNumber && b.endColumn < a.startColumn) return false
  return true
}

function lineRange(line: number): DecorationRange {
  return { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: Number.MAX_SAFE_INTEGER }
}

function wordRange(line: number, startCol: number, endCol: number): DecorationRange {
  return { startLineNumber: line, startColumn: startCol, endLineNumber: line, endColumn: endCol }
}

function multiLineRange(startLine: number, endLine: number): DecorationRange {
  return { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: Number.MAX_SAFE_INTEGER }
}

/* ── Factory: Diagnostic Squiggles ────────────────────── */

export function createDiagnosticDecoration(
  line: number,
  startCol: number,
  endCol: number,
  severity: DiagnosticSeverity,
  message: string,
  source?: string
): Omit<Decoration, 'id'> {
  const colorKey: Record<DiagnosticSeverity, string> = {
    [DiagnosticSeverity.Error]: 'error-foreground',
    [DiagnosticSeverity.Warning]: 'warning-foreground',
    [DiagnosticSeverity.Info]: 'info-foreground',
    [DiagnosticSeverity.Hint]: 'hint-foreground',
  }

  const classMap: Record<DiagnosticSeverity, string> = {
    [DiagnosticSeverity.Error]: 'squiggly-error',
    [DiagnosticSeverity.Warning]: 'squiggly-warning',
    [DiagnosticSeverity.Info]: 'squiggly-info',
    [DiagnosticSeverity.Hint]: 'squiggly-hint',
  }

  const hoverValue = source ? `[${source}] ${message}` : message

  return {
    owner: 'diagnostics',
    type: DecorationType.WordHighlight,
    range: wordRange(line, startCol, endCol),
    style: {
      inlineClassName: classMap[severity],
      overviewRulerColor: resolveColor(colorKey[severity]),
      overviewRulerLane: 'right',
      minimapColor: resolveColor(colorKey[severity]),
    },
    priority: DecorationPriority.Diagnostic,
    hoverMessage: [{ value: hoverValue }],
    stickiness: 'GrowsOnlyWhenTypingAfter',
    metadata: { severity, source },
  }
}

export function createDiagnosticDecorations(
  diagnostics: Array<{ line: number; startCol: number; endCol: number; severity: DiagnosticSeverity; message: string; source?: string }>
): Omit<Decoration, 'id'>[] {
  return diagnostics.map(d => createDiagnosticDecoration(d.line, d.startCol, d.endCol, d.severity, d.message, d.source))
}

/* ── Factory: Git Gutter Decorations ──────────────────── */

export function createGitGutterDecoration(
  line: number,
  changeType: GitChangeType,
  endLine?: number
): Omit<Decoration, 'id'> {
  const classMap: Record<GitChangeType, string> = {
    [GitChangeType.Added]: 'git-gutter-added',
    [GitChangeType.Modified]: 'git-gutter-modified',
    [GitChangeType.Deleted]: 'git-gutter-deleted',
  }

  const colorKey: Record<GitChangeType, string> = {
    [GitChangeType.Added]: 'git-added',
    [GitChangeType.Modified]: 'git-modified',
    [GitChangeType.Deleted]: 'git-deleted',
  }

  const range = changeType === GitChangeType.Deleted
    ? lineRange(line)
    : endLine ? multiLineRange(line, endLine) : lineRange(line)

  return {
    owner: 'git-blame',
    type: DecorationType.GutterIcon,
    range,
    style: {
      glyphMarginClassName: classMap[changeType],
      isWholeLine: true,
      overviewRulerColor: resolveColor(colorKey[changeType]),
      overviewRulerLane: 'left',
      minimapColor: resolveColor(colorKey[changeType]),
    },
    priority: DecorationPriority.GitGutter,
    metadata: { changeType },
  }
}

export function createGitGutterDecorations(
  changes: Array<{ line: number; endLine?: number; type: GitChangeType }>
): Omit<Decoration, 'id'>[] {
  return changes.map(c => createGitGutterDecoration(c.line, c.type, c.endLine))
}

/* ── Factory: Search Match Highlighting ───────────────── */

export function createSearchMatchDecoration(
  line: number,
  startCol: number,
  endCol: number,
  isActive: boolean = false
): Omit<Decoration, 'id'> {
  return {
    owner: 'search-highlight',
    type: DecorationType.WordHighlight,
    range: wordRange(line, startCol, endCol),
    style: {
      className: isActive ? 'findMatch-active' : 'findMatch',
      backgroundColor: resolveColor(isActive ? 'search-match-active' : 'search-match'),
      overviewRulerColor: resolveColor('search-match'),
      overviewRulerLane: 'center',
      minimapColor: resolveColor('search-match'),
      isWholeLine: false,
    },
    priority: DecorationPriority.SearchMatch,
    metadata: { isActive },
  }
}

export function createSearchMatchDecorations(
  matches: Array<{ line: number; startCol: number; endCol: number }>,
  activeIndex?: number
): Omit<Decoration, 'id'>[] {
  return matches.map((m, i) => createSearchMatchDecoration(m.line, m.startCol, m.endCol, i === activeIndex))
}

/* ── Factory: Bracket Pair Colorization ───────────────── */

export function createBracketMatchDecoration(
  openLine: number,
  openCol: number,
  closeLine: number,
  closeCol: number,
  nestingLevel: number = 0
): Omit<Decoration, 'id'>[] {
  const bracketColors = ['bracket-1', 'bracket-2', 'bracket-3']
  const colorKey = bracketColors[nestingLevel % bracketColors.length]
  const color = resolveColor(colorKey)

  const baseStyle: DecorationStyle = {
    inlineClassName: `bracket-match-${nestingLevel % 3}`,
    color,
    fontWeight: 'bold',
  }

  return [
    {
      owner: 'bracket-match',
      type: DecorationType.BracketMatch,
      range: wordRange(openLine, openCol, openCol + 1),
      style: { ...baseStyle, border: `1px solid ${color}` },
      priority: DecorationPriority.BracketMatch,
      metadata: { nestingLevel, position: 'open' },
    },
    {
      owner: 'bracket-match',
      type: DecorationType.BracketMatch,
      range: wordRange(closeLine, closeCol, closeCol + 1),
      style: { ...baseStyle, border: `1px solid ${color}` },
      priority: DecorationPriority.BracketMatch,
      metadata: { nestingLevel, position: 'close' },
    },
  ]
}

/* ── Factory: Indent Guide Rendering ──────────────────── */

export function createIndentGuideDecoration(
  line: number,
  column: number,
  isActive: boolean = false
): Omit<Decoration, 'id'> {
  return {
    owner: 'indent-guide',
    type: DecorationType.IndentGuide,
    range: wordRange(line, column, column + 1),
    style: {
      inlineClassName: isActive ? 'indent-guide-active' : 'indent-guide',
      color: resolveColor(isActive ? 'indent-active' : 'indent-inactive'),
      border: isActive
        ? `1px solid ${resolveColor('indent-active')}`
        : `1px solid ${resolveColor('indent-inactive')}`,
    },
    priority: isActive ? DecorationPriority.IndentGuide + 5 : DecorationPriority.IndentGuide,
    metadata: { isActive },
  }
}

export function createIndentGuideDecorations(
  guides: Array<{ line: number; column: number; isActive?: boolean }>
): Omit<Decoration, 'id'>[] {
  return guides.map(g => createIndentGuideDecoration(g.line, g.column, g.isActive ?? false))
}

/* ── Factory: Word Occurrence Highlights ──────────────── */

export function createWordHighlightDecoration(
  line: number,
  startCol: number,
  endCol: number,
  isStrong: boolean = false
): Omit<Decoration, 'id'> {
  return {
    owner: 'word-highlight',
    type: DecorationType.WordHighlight,
    range: wordRange(line, startCol, endCol),
    style: {
      className: isStrong ? 'wordHighlight-strong' : 'wordHighlight',
      backgroundColor: resolveColor(isStrong ? 'word-highlight-strong' : 'word-highlight'),
      overviewRulerColor: resolveColor('word-highlight'),
      overviewRulerLane: 'center',
      isWholeLine: false,
    },
    priority: DecorationPriority.WordHighlight,
    metadata: { isStrong },
  }
}

export function createWordHighlightDecorations(
  occurrences: Array<{ line: number; startCol: number; endCol: number; isStrong?: boolean }>
): Omit<Decoration, 'id'>[] {
  return occurrences.map(o => createWordHighlightDecoration(o.line, o.startCol, o.endCol, o.isStrong ?? false))
}

/* ── Factory: Inline Blame Annotations ────────────────── */

export function createInlineBlameDecoration(
  line: number,
  text: string,
  author?: string,
  date?: string
): Omit<Decoration, 'id'> {
  const tooltip = [author, date].filter(Boolean).join(' | ')

  return {
    owner: 'git-blame',
    type: DecorationType.AfterLineText,
    range: lineRange(line),
    style: {
      afterContentClassName: 'inline-blame-annotation',
      opacity: '0.5',
      fontStyle: 'italic',
      color: resolveColor('hint-foreground'),
      isWholeLine: true,
    },
    priority: DecorationPriority.InlineBlame,
    hoverMessage: tooltip ? [{ value: tooltip }] : undefined,
    metadata: { blameText: text, author, date },
  }
}

/* ── Factory: AI Suggestion Ghost Text ────────────────── */

export function createAISuggestionDecoration(
  line: number,
  column: number,
  suggestionText: string,
  provider: string = 'ai'
): Omit<Decoration, 'id'> {
  return {
    owner: 'ai-suggestion',
    type: DecorationType.AfterLineText,
    range: wordRange(line, column, column),
    style: {
      afterContentClassName: 'ai-ghost-text',
      color: resolveColor('ai-ghost'),
      fontStyle: 'italic',
      opacity: '0.6',
      cursor: 'pointer',
    },
    priority: DecorationPriority.AISuggestion,
    animation: {
      type: AnimationType.FadeIn,
      duration: 200,
    },
    hoverMessage: [{ value: `AI Suggestion (${provider}): Press Tab to accept` }],
    stickiness: 'NeverGrowsWhenTypingAtEdges',
    metadata: { suggestionText, provider },
  }
}

/* ── Factory: Breakpoint Gutter Icons ─────────────────── */

export type BreakpointKind = 'normal' | 'conditional' | 'logpoint' | 'disabled' | 'unverified'

export function createBreakpointDecoration(
  line: number,
  kind: BreakpointKind = 'normal',
  condition?: string
): Omit<Decoration, 'id'> {
  const classMap: Record<BreakpointKind, string> = {
    normal: 'breakpoint-glyph',
    conditional: 'breakpoint-conditional-glyph',
    logpoint: 'breakpoint-logpoint-glyph',
    disabled: 'breakpoint-disabled-glyph',
    unverified: 'breakpoint-unverified-glyph',
  }

  const hoverMessages: { value: string }[] = [{ value: `Breakpoint (${kind})` }]
  if (condition) hoverMessages.push({ value: `Condition: ${condition}` })

  return {
    owner: 'breakpoint',
    type: DecorationType.GutterIcon,
    range: lineRange(line),
    style: {
      glyphMarginClassName: classMap[kind],
      isWholeLine: true,
      overviewRulerColor: resolveColor('breakpoint'),
      overviewRulerLane: 'left',
    },
    priority: DecorationPriority.Breakpoint,
    hoverMessage: hoverMessages,
    stickiness: 'NeverGrowsWhenTypingAtEdges',
    metadata: { kind, condition },
  }
}

/* ── Factory: Code Coverage Indicators ────────────────── */

export type CoverageStatus = 'covered' | 'uncovered' | 'partial'

export function createCoverageDecoration(
  line: number,
  status: CoverageStatus,
  hitCount?: number,
  endLine?: number
): Omit<Decoration, 'id'> {
  const classMap: Record<CoverageStatus, string> = {
    covered: 'coverage-covered',
    uncovered: 'coverage-uncovered',
    partial: 'coverage-partial',
  }

  const colorMap: Record<CoverageStatus, string> = {
    covered: 'coverage-covered',
    uncovered: 'coverage-uncovered',
    partial: 'warning-foreground',
  }

  const range = endLine ? multiLineRange(line, endLine) : lineRange(line)
  const hover = hitCount !== undefined ? `Coverage: ${status} (${hitCount} hits)` : `Coverage: ${status}`

  return {
    owner: 'coverage',
    type: DecorationType.LineHighlight,
    range,
    style: {
      className: classMap[status],
      backgroundColor: resolveColor(colorMap[status]),
      isWholeLine: true,
      overviewRulerColor: resolveColor(colorMap[status]),
      overviewRulerLane: 'left',
    },
    priority: DecorationPriority.Coverage,
    hoverMessage: [{ value: hover }],
    metadata: { status, hitCount },
  }
}

export function createCoverageDecorations(
  lines: Array<{ line: number; endLine?: number; status: CoverageStatus; hitCount?: number }>
): Omit<Decoration, 'id'>[] {
  return lines.map(l => createCoverageDecoration(l.line, l.status, l.hitCount, l.endLine))
}

/* ── Factory: Merge Conflict Markers ──────────────────── */

export type MergeConflictRegion = 'current' | 'incoming' | 'common'

export function createMergeConflictDecoration(
  startLine: number,
  endLine: number,
  region: MergeConflictRegion,
  headerText?: string
): Omit<Decoration, 'id'> {
  const colorMap: Record<MergeConflictRegion, string> = {
    current: 'merge-current',
    incoming: 'merge-incoming',
    common: 'merge-common',
  }

  const classMap: Record<MergeConflictRegion, string> = {
    current: 'merge-conflict-current',
    incoming: 'merge-conflict-incoming',
    common: 'merge-conflict-common',
  }

  const labelMap: Record<MergeConflictRegion, string> = {
    current: 'Current Change',
    incoming: 'Incoming Change',
    common: 'Common Ancestor',
  }

  return {
    owner: 'merge-conflict',
    type: DecorationType.LineHighlight,
    range: multiLineRange(startLine, endLine),
    style: {
      className: classMap[region],
      backgroundColor: resolveColor(colorMap[region]),
      isWholeLine: true,
      overviewRulerColor: resolveColor(colorMap[region]),
      overviewRulerLane: 'full',
      minimapColor: resolveColor(colorMap[region]),
    },
    priority: DecorationPriority.MergeConflict,
    hoverMessage: [{ value: headerText ?? labelMap[region] }],
    metadata: { region },
  }
}

export function createMergeConflictDecorations(
  conflict: { currentStart: number; currentEnd: number; incomingStart: number; incomingEnd: number; commonStart?: number; commonEnd?: number }
): Omit<Decoration, 'id'>[] {
  const result: Omit<Decoration, 'id'>[] = [
    createMergeConflictDecoration(conflict.currentStart, conflict.currentEnd, 'current'),
    createMergeConflictDecoration(conflict.incomingStart, conflict.incomingEnd, 'incoming'),
  ]

  if (conflict.commonStart !== undefined && conflict.commonEnd !== undefined) {
    result.push(createMergeConflictDecoration(conflict.commonStart, conflict.commonEnd, 'common'))
  }

  return result
}

/* ── Factory: Active Indent Guide ─────────────────────── */

export function createActiveIndentGuideDecoration(
  startLine: number,
  endLine: number,
  column: number
): Omit<Decoration, 'id'> {
  return {
    owner: 'indent-guide',
    type: DecorationType.IndentGuide,
    range: {
      startLineNumber: startLine,
      startColumn: column,
      endLineNumber: endLine,
      endColumn: column + 1,
    },
    style: {
      inlineClassName: 'indent-guide-active',
      border: `1px solid ${resolveColor('indent-active')}`,
    },
    priority: DecorationPriority.IndentGuide + 5,
    metadata: { isActive: true },
  }
}

/* ── Factory: Whitespace Rendering ────────────────────── */

export type WhitespaceKind = 'space' | 'tab'

export function createWhitespaceDecoration(
  line: number,
  startCol: number,
  endCol: number,
  kind: WhitespaceKind
): Omit<Decoration, 'id'> {
  return {
    owner: 'whitespace',
    type: DecorationType.WhitespaceRendering,
    range: wordRange(line, startCol, endCol),
    style: {
      inlineClassName: kind === 'space' ? 'whitespace-space' : 'whitespace-tab',
      color: resolveColor('whitespace'),
      opacity: '0.3',
    },
    priority: DecorationPriority.Whitespace,
    metadata: { kind },
  }
}

export function createTrailingWhitespaceDecoration(
  line: number,
  startCol: number,
  endCol: number
): Omit<Decoration, 'id'> {
  return {
    owner: 'whitespace',
    type: DecorationType.TrailingWhitespace,
    range: wordRange(line, startCol, endCol),
    style: {
      inlineClassName: 'trailing-whitespace',
      backgroundColor: resolveColor('trailing-whitespace'),
      opacity: '0.6',
    },
    priority: DecorationPriority.Whitespace + 1,
    hoverMessage: [{ value: 'Trailing whitespace' }],
    metadata: { isTrailing: true },
  }
}

export function createWhitespaceDecorations(
  tokens: Array<{ line: number; startCol: number; endCol: number; kind: WhitespaceKind; isTrailing?: boolean }>
): Omit<Decoration, 'id'>[] {
  return tokens.map(t =>
    t.isTrailing
      ? createTrailingWhitespaceDecoration(t.line, t.startCol, t.endCol)
      : createWhitespaceDecoration(t.line, t.startCol, t.endCol, t.kind)
  )
}

/* ── Factory: Current Line Highlight ──────────────────── */

export function createCurrentLineDecoration(
  line: number
): Omit<Decoration, 'id'> {
  return {
    owner: 'current-line',
    type: DecorationType.CurrentLine,
    range: lineRange(line),
    style: {
      className: 'current-line-highlight',
      backgroundColor: resolveColor('current-line'),
      isWholeLine: true,
    },
    priority: DecorationPriority.CurrentLine,
    stickiness: 'NeverGrowsWhenTypingAtEdges',
  }
}

/* ── Factory: Selection Highlight ─────────────────────── */

export function createSelectionHighlightDecoration(
  line: number,
  startCol: number,
  endCol: number
): Omit<Decoration, 'id'> {
  return {
    owner: 'selection-highlight',
    type: DecorationType.SelectionHighlight,
    range: wordRange(line, startCol, endCol),
    style: {
      className: 'selection-highlight',
      backgroundColor: resolveColor('selection-highlight'),
      overviewRulerColor: resolveColor('selection-highlight'),
      overviewRulerLane: 'center',
      isWholeLine: false,
    },
    priority: DecorationPriority.Selection,
  }
}

export function createSelectionHighlightDecorations(
  matches: Array<{ line: number; startCol: number; endCol: number }>
): Omit<Decoration, 'id'>[] {
  return matches.map(m => createSelectionHighlightDecoration(m.line, m.startCol, m.endCol))
}

/* ── Convenience: Apply Factories to Manager ──────────── */

/**
 * Replaces all decorations for an owner with new ones from a factory result.
 * Useful for updating search highlights, diagnostics, etc. in one call.
 */
export function replaceOwnerDecorations(
  manager: DecorationManager,
  owner: DecorationOwner,
  decorations: Omit<Decoration, 'id'>[]
): string[] {
  manager.clearByOwner(owner)
  return manager.createMany(decorations)
}

/**
 * Batch-replace decorations for multiple owners at once.
 * Each entry clears the owner first, then adds the new decorations.
 */
export function batchReplaceDecorations(
  manager: DecorationManager,
  entries: Array<{ owner: DecorationOwner; decorations: Omit<Decoration, 'id'>[] }>
): void {
  for (const entry of entries) {
    const existing = manager.getByOwner(entry.owner)
    const removedIds = existing.map(d => d.id)

    manager.batch({
      owner: entry.owner,
      delta: {
        removed: removedIds,
        added: entry.decorations.map(d => ({
          ...d,
          id: '',
          owner: entry.owner,
        })) as Decoration[],
      },
    })
  }
}

/* ── Composite Factory: Full Diagnostic Set ───────────── */

/**
 * Creates a complete set of diagnostic decorations from an array of
 * diagnostic messages, grouped by severity for easy management.
 */
export function createFullDiagnosticSet(
  diagnostics: Array<{
    line: number
    startCol: number
    endCol: number
    severity: DiagnosticSeverity
    message: string
    source?: string
    relatedInfo?: Array<{ line: number; col: number; message: string }>
  }>
): Omit<Decoration, 'id'>[] {
  const result: Omit<Decoration, 'id'>[] = []

  for (const diag of diagnostics) {
    const dec = createDiagnosticDecoration(
      diag.line, diag.startCol, diag.endCol,
      diag.severity, diag.message, diag.source
    )

    if (diag.relatedInfo && diag.relatedInfo.length > 0) {
      const relatedHover = diag.relatedInfo.map(r => `  Line ${r.line}: ${r.message}`).join('\n')
      const existingHover = Array.isArray(dec.hoverMessage) ? dec.hoverMessage : []
      dec.hoverMessage = [...existingHover, { value: `Related:\n${relatedHover}` }]
    }

    result.push(dec)
  }

  return result
}

/* ── Composite Factory: Full Git Diff Set ─────────────── */

/**
 * Creates gutter + inline-blame decorations for a complete git diff.
 */
export function createGitDiffDecorationSet(
  changes: Array<{ line: number; endLine?: number; type: GitChangeType }>,
  blameInfo?: Array<{ line: number; text: string; author?: string; date?: string }>
): Omit<Decoration, 'id'>[] {
  const result: Omit<Decoration, 'id'>[] = createGitGutterDecorations(changes)

  if (blameInfo) {
    for (const blame of blameInfo) {
      result.push(createInlineBlameDecoration(blame.line, blame.text, blame.author, blame.date))
    }
  }

  return result
}

/* ── Export singleton helper ───────────────────────────── */

let defaultManager: DecorationManager | null = null

/**
 * Get or create the global decoration manager instance.
 * Optionally attach a Monaco editor on first call.
 */
export function getDecorationManager(editor?: MonacoEditor.IStandaloneCodeEditor): DecorationManager {
  if (!defaultManager) {
    defaultManager = new DecorationManager(editor)
  } else if (editor) {
    defaultManager.setEditor(editor)
  }
  return defaultManager
}

/**
 * Reset the global decoration manager (useful for testing or editor teardown).
 */
export function resetDecorationManager(): void {
  if (defaultManager) {
    defaultManager.dispose()
    defaultManager = null
  }
}
