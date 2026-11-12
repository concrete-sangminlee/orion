/**
 * The Settings > Editor values (saved under 'orion-editor-settings' and sent
 * as 'orion:editor-config') and the Monaco options they turn into.
 */
import type { editor as MonacoEditor } from 'monaco-editor'

type CursorStyle = 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin'
type CursorBlinking = 'blink' | 'smooth' | 'phase' | 'expand' | 'solid'
type RenderWhitespace = 'none' | 'boundary' | 'selection' | 'trailing' | 'all'
type WordWrapMode = 'off' | 'on' | 'wordWrapColumn' | 'bounded'
type LineNumbersMode = 'on' | 'off' | 'relative' | 'interval'

export interface EditorConfig {
  fontSize: number
  fontFamily: string
  lineHeight: number
  fontLigatures: boolean
  letterSpacing: number
  cursorStyle: CursorStyle
  cursorBlinking: CursorBlinking
  renderWhitespace: RenderWhitespace
  minimap: boolean
  minimapSide: 'right' | 'left'
  minimapMaxColumn: number
  /** On/off (the View menu toggle); wordWrapMode says how when on. */
  wordWrap: boolean
  wordWrapMode: WordWrapMode
  wordWrapColumn: number
  tabSize: number
  insertSpaces: boolean
  lineNumbersMode: LineNumbersMode
  rulers: number[]
  stickyScroll: boolean
  smoothScrolling: boolean
  bracketPairColorization: boolean
  formatOnPaste: boolean
  formatOnSave: boolean
  trimTrailingWhitespace: boolean
  insertFinalNewline: boolean
}

// For keys the user has not saved; matches what Settings > Editor shows except
// the cursor, which the editor has always started as 'line-thin'.
export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  fontSize: 14, fontFamily: 'Cascadia Code', lineHeight: 1.5,
  fontLigatures: true, letterSpacing: 0,
  cursorStyle: 'line-thin', cursorBlinking: 'blink', renderWhitespace: 'selection',
  minimap: true, minimapSide: 'right', minimapMaxColumn: 120,
  wordWrap: false, wordWrapMode: 'off', wordWrapColumn: 80,
  tabSize: 2, insertSpaces: true, lineNumbersMode: 'on', rulers: [],
  stickyScroll: true, smoothScrolling: true, bracketPairColorization: true,
  formatOnPaste: false,
  formatOnSave: false, trimTrailingWhitespace: true, insertFinalNewline: true,
}

export function loadEditorConfig(): EditorConfig {
  try {
    const stored = localStorage.getItem('orion-editor-settings')
    if (stored) {
      const parsed = JSON.parse(stored)
      // Settings saved before lineNumbersMode existed kept a boolean.
      if (parsed.lineNumbers === false && !parsed.lineNumbersMode) parsed.lineNumbersMode = 'off'
      return { ...DEFAULT_EDITOR_CONFIG, ...parsed }
    }
  } catch { /* unreadable settings: use the defaults */ }
  return DEFAULT_EDITOR_CONFIG
}

/** Monaco options for the settings; every Settings > Editor control maps to one here. */
export function monacoOptionsFor(c: EditorConfig): MonacoEditor.IStandaloneEditorConstructionOptions {
  return {
    fontSize: c.fontSize,
    fontFamily: `'${c.fontFamily}', monospace`,
    fontLigatures: c.fontLigatures,
    lineHeight: Math.round(c.fontSize * (c.lineHeight || 1.5)),
    letterSpacing: c.letterSpacing ?? 0.3,
    cursorStyle: c.cursorStyle,
    cursorBlinking: c.cursorBlinking,
    renderWhitespace: c.renderWhitespace || 'selection',
    minimap: {
      enabled: c.minimap,
      side: c.minimapSide,
      maxColumn: c.minimapMaxColumn,
      renderCharacters: true,
      showSlider: 'mouseover',
      scale: 1,
    },
    wordWrap: !c.wordWrap ? 'off' : c.wordWrapMode === 'off' ? 'on' : c.wordWrapMode,
    wordWrapColumn: c.wordWrapColumn,
    tabSize: c.tabSize,
    insertSpaces: c.insertSpaces,
    lineNumbers: c.lineNumbersMode,
    rulers: Array.isArray(c.rulers) ? c.rulers : [],
    stickyScroll: { enabled: c.stickyScroll, maxLineCount: 5 },
    smoothScrolling: c.smoothScrolling,
    bracketPairColorization: { enabled: c.bracketPairColorization, independentColorPoolPerBracketType: true },
    formatOnPaste: c.formatOnPaste,
  }
}
