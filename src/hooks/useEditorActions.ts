/**
 * Editor action hooks for common operations.
 * Provides undo/redo history, clipboard operations, line operations,
 * multi-cursor commands, and text transformation utilities.
 */

import { useCallback, useRef, useEffect } from 'react'
import type { editor as MonacoEditor, IDisposable } from 'monaco-editor'

/* ── Types ─────────────────────────────────────────────── */

export interface EditorCommand {
  id: string
  label: string
  keybinding?: string
  handler: () => void
  when?: string
  category?: string
}

/* ── Line Operations Hook ──────────────────────────────── */

export function useLineOperations(
  editorRef: React.RefObject<MonacoEditor.IStandaloneCodeEditor | null>
) {
  const duplicateLine = useCallback((direction: 'up' | 'down' = 'down') => {
    const editor = editorRef.current
    if (!editor) return

    const action = direction === 'down'
      ? 'editor.action.copyLinesDownAction'
      : 'editor.action.copyLinesUpAction'
    editor.trigger('keyboard', action, {})
  }, [editorRef])

  const moveLine = useCallback((direction: 'up' | 'down') => {
    const editor = editorRef.current
    if (!editor) return

    const action = direction === 'up'
      ? 'editor.action.moveLinesUpAction'
      : 'editor.action.moveLinesDownAction'
    editor.trigger('keyboard', action, {})
  }, [editorRef])

  const deleteLine = useCallback(() => {
    editorRef.current?.trigger('keyboard', 'editor.action.deleteLines', {})
  }, [editorRef])

  const insertLineAbove = useCallback(() => {
    editorRef.current?.trigger('keyboard', 'editor.action.insertLineBefore', {})
  }, [editorRef])

  const insertLineBelow = useCallback(() => {
    editorRef.current?.trigger('keyboard', 'editor.action.insertLineAfter', {})
  }, [editorRef])

  const joinLines = useCallback(() => {
    editorRef.current?.trigger('keyboard', 'editor.action.joinLines', {})
  }, [editorRef])

  const sortLinesAscending = useCallback(() => {
    editorRef.current?.trigger('keyboard', 'editor.action.sortLinesAscending', {})
  }, [editorRef])

  const sortLinesDescending = useCallback(() => {
    editorRef.current?.trigger('keyboard', 'editor.action.sortLinesDescending', {})
  }, [editorRef])

  const trimTrailingWhitespace = useCallback(() => {
    editorRef.current?.trigger('keyboard', 'editor.action.trimTrailingWhitespace', {})
  }, [editorRef])

  const indentLine = useCallback(() => {
    editorRef.current?.trigger('keyboard', 'editor.action.indentLines', {})
  }, [editorRef])

  const outdentLine = useCallback(() => {
    editorRef.current?.trigger('keyboard', 'editor.action.outdentLines', {})
  }, [editorRef])

  const toggleWordWrap = useCallback(() => {
    editorRef.current?.trigger('keyboard', 'editor.action.toggleWordWrap', {})
  }, [editorRef])

  return {
    duplicateLine,
    moveLine,
    deleteLine,
    insertLineAbove,
    insertLineBelow,
    joinLines,
    sortLinesAscending,
    sortLinesDescending,
    trimTrailingWhitespace,
    indentLine,
    outdentLine,
    toggleWordWrap,
  }
}

/* ── Clipboard Operations Hook ─────────────────────────── */

export function useClipboardOperations(
  editorRef: React.RefObject<MonacoEditor.IStandaloneCodeEditor | null>
) {
  const clipboardHistory = useRef<string[]>([])
  const MAX_HISTORY = 20

  const copyLine = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return

    const model = editor.getModel()
    const selection = editor.getSelection()
    if (!model || !selection) return

    // If no selection, copy entire line
    if (selection.isEmpty()) {
      const lineContent = model.getLineContent(selection.startLineNumber)
      navigator.clipboard.writeText(lineContent + '\n')
      clipboardHistory.current.unshift(lineContent)
      if (clipboardHistory.current.length > MAX_HISTORY) clipboardHistory.current.pop()
    } else {
      const text = model.getValueInRange(selection)
      navigator.clipboard.writeText(text)
      clipboardHistory.current.unshift(text)
      if (clipboardHistory.current.length > MAX_HISTORY) clipboardHistory.current.pop()
    }
  }, [editorRef])

  const cutLine = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return

    const model = editor.getModel()
    const selection = editor.getSelection()
    if (!model || !selection) return

    if (selection.isEmpty()) {
      const lineContent = model.getLineContent(selection.startLineNumber)
      navigator.clipboard.writeText(lineContent + '\n')
      clipboardHistory.current.unshift(lineContent)
      if (clipboardHistory.current.length > MAX_HISTORY) clipboardHistory.current.pop()

      editor.executeEdits('cutLine', [{
        range: {
          startLineNumber: selection.startLineNumber,
          startColumn: 1,
          endLineNumber: selection.startLineNumber + 1,
          endColumn: 1,
        },
        text: '',
      }])
    } else {
      const text = model.getValueInRange(selection)
      navigator.clipboard.writeText(text)
      clipboardHistory.current.unshift(text)
      editor.executeEdits('cut', [{
        range: selection,
        text: '',
      }])
    }
  }, [editorRef])

  const pasteFromHistory = useCallback((index: number) => {
    const editor = editorRef.current
    if (!editor) return

    const text = clipboardHistory.current[index]
    if (!text) return

    const selection = editor.getSelection()
    if (!selection) return

    editor.executeEdits('pasteHistory', [{
      range: selection,
      text,
    }])
  }, [editorRef])

  const getClipboardHistory = useCallback(() => {
    return [...clipboardHistory.current]
  }, [])

  const clearClipboardHistory = useCallback(() => {
    clipboardHistory.current = []
  }, [])

  return {
    copyLine,
    cutLine,
    pasteFromHistory,
    getClipboardHistory,
    clearClipboardHistory,
  }
}

/* ── Text Transform Hook ──────────────────────────────── */

export function useTextTransform(
  editorRef: React.RefObject<MonacoEditor.IStandaloneCodeEditor | null>
) {
  const applyTransform = useCallback((transform: (text: string) => string) => {
    const editor = editorRef.current
    if (!editor) return

    const model = editor.getModel()
    const selections = editor.getSelections()
    if (!model || !selections) return

    const edits = selections
      .filter(s => !s.isEmpty())
      .map(selection => ({
        range: selection,
        text: transform(model.getValueInRange(selection)),
      }))

    if (edits.length > 0) {
      editor.executeEdits('textTransform', edits)
    }
  }, [editorRef])

  const toUpperCase = useCallback(() => applyTransform(s => s.toUpperCase()), [applyTransform])
  const toLowerCase = useCallback(() => applyTransform(s => s.toLowerCase()), [applyTransform])

  const toTitleCase = useCallback(() => {
    applyTransform(s => s.replace(/\b\w/g, c => c.toUpperCase()))
  }, [applyTransform])

  const toCamelCase = useCallback(() => {
    applyTransform(s => {
      return s.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '')
        .replace(/^[A-Z]/, c => c.toLowerCase())
    })
  }, [applyTransform])

  const toPascalCase = useCallback(() => {
    applyTransform(s => {
      return s.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '')
        .replace(/^[a-z]/, c => c.toUpperCase())
    })
  }, [applyTransform])

  const toSnakeCase = useCallback(() => {
    applyTransform(s => {
      return s
        .replace(/([A-Z])/g, '_$1')
        .replace(/[-\s]+/g, '_')
        .replace(/^_/, '')
        .toLowerCase()
    })
  }, [applyTransform])

  const toKebabCase = useCallback(() => {
    applyTransform(s => {
      return s
        .replace(/([A-Z])/g, '-$1')
        .replace(/[_\s]+/g, '-')
        .replace(/^-/, '')
        .toLowerCase()
    })
  }, [applyTransform])

  const toConstantCase = useCallback(() => {
    applyTransform(s => {
      return s
        .replace(/([A-Z])/g, '_$1')
        .replace(/[-\s]+/g, '_')
        .replace(/^_/, '')
        .toUpperCase()
    })
  }, [applyTransform])

  const reverseText = useCallback(() => {
    applyTransform(s => s.split('').reverse().join(''))
  }, [applyTransform])

  const encodeBase64 = useCallback(() => {
    applyTransform(s => btoa(s))
  }, [applyTransform])

  const decodeBase64 = useCallback(() => {
    applyTransform(s => { try { return atob(s) } catch { return s } })
  }, [applyTransform])

  const encodeUrl = useCallback(() => {
    applyTransform(s => encodeURIComponent(s))
  }, [applyTransform])

  const decodeUrl = useCallback(() => {
    applyTransform(s => { try { return decodeURIComponent(s) } catch { return s } })
  }, [applyTransform])

  const escapeHtml = useCallback(() => {
    applyTransform(s => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'))
  }, [applyTransform])

  const unescapeHtml = useCallback(() => {
    applyTransform(s => s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"))
  }, [applyTransform])

  return {
    toUpperCase,
    toLowerCase,
    toTitleCase,
    toCamelCase,
    toPascalCase,
    toSnakeCase,
    toKebabCase,
    toConstantCase,
    reverseText,
    encodeBase64,
    decodeBase64,
    encodeUrl,
    decodeUrl,
    escapeHtml,
    unescapeHtml,
    applyTransform,
  }
}

/* ── Go To Line Hook ───────────────────────────────────── */

export function useGoToLine(
  editorRef: React.RefObject<MonacoEditor.IStandaloneCodeEditor | null>
) {
  const goToLine = useCallback((line: number, column = 1) => {
    const editor = editorRef.current
    if (!editor) return

    editor.setPosition({ lineNumber: line, column })
    editor.revealLineInCenter(line)
    editor.focus()
  }, [editorRef])

  const goToPosition = useCallback((line: number, column: number) => {
    const editor = editorRef.current
    if (!editor) return

    editor.setPosition({ lineNumber: line, column })
    editor.revealPositionInCenter({ lineNumber: line, column })
    editor.focus()
  }, [editorRef])

  const revealRange = useCallback((startLine: number, endLine: number) => {
    const editor = editorRef.current
    if (!editor) return

    editor.revealRangeInCenter({
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: endLine,
      endColumn: 1,
    })
  }, [editorRef])

  const selectRange = useCallback((startLine: number, startCol: number, endLine: number, endCol: number) => {
    const editor = editorRef.current
    if (!editor) return

    editor.setSelection({
      startLineNumber: startLine,
      startColumn: startCol,
      endLineNumber: endLine,
      endColumn: endCol,
    })
    editor.revealRangeInCenter({
      startLineNumber: startLine,
      startColumn: startCol,
      endLineNumber: endLine,
      endColumn: endCol,
    })
    editor.focus()
  }, [editorRef])

  return { goToLine, goToPosition, revealRange, selectRange }
}

/* ── Scroll Operations Hook ────────────────────────────── */

export function useScrollOperations(
  editorRef: React.RefObject<MonacoEditor.IStandaloneCodeEditor | null>
) {
  const scrollToTop = useCallback(() => {
    editorRef.current?.setScrollTop(0)
  }, [editorRef])

  const scrollToBottom = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    editor.revealLine(model.getLineCount())
  }, [editorRef])

  const scrollLineUp = useCallback(() => {
    editorRef.current?.trigger('keyboard', 'scrollLineUp', {})
  }, [editorRef])

  const scrollLineDown = useCallback(() => {
    editorRef.current?.trigger('keyboard', 'scrollLineDown', {})
  }, [editorRef])

  const scrollPageUp = useCallback(() => {
    editorRef.current?.trigger('keyboard', 'scrollPageUp', {})
  }, [editorRef])

  const scrollPageDown = useCallback(() => {
    editorRef.current?.trigger('keyboard', 'scrollPageDown', {})
  }, [editorRef])

  const centerCursor = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const position = editor.getPosition()
    if (position) {
      editor.revealLineInCenter(position.lineNumber)
    }
  }, [editorRef])

  return {
    scrollToTop,
    scrollToBottom,
    scrollLineUp,
    scrollLineDown,
    scrollPageUp,
    scrollPageDown,
    centerCursor,
  }
}

/* ── Custom Action Registration Hook ───────────────────── */

export function useEditorCommandRegistration(
  editorRef: React.RefObject<MonacoEditor.IStandaloneCodeEditor | null>
) {
  const disposablesRef = useRef<IDisposable[]>([])

  const registerCommand = useCallback((command: EditorCommand): (() => void) => {
    const editor = editorRef.current
    if (!editor) return () => {}

    const disposable = editor.addAction({
      id: command.id,
      label: command.label,
      precondition: command.when,
      contextMenuGroupId: command.category || 'navigation',
      run: command.handler,
    })

    disposablesRef.current.push(disposable)
    return () => disposable.dispose()
  }, [editorRef])

  const registerCommands = useCallback((commands: EditorCommand[]): (() => void) => {
    const disposers = commands.map(cmd => registerCommand(cmd))
    return () => disposers.forEach(d => d())
  }, [registerCommand])

  useEffect(() => {
    return () => {
      disposablesRef.current.forEach(d => d.dispose())
      disposablesRef.current = []
    }
  }, [])

  return { registerCommand, registerCommands }
}

/* ── Editor State Hook ─────────────────────────────────── */

export function useEditorState(
  editorRef: React.RefObject<MonacoEditor.IStandaloneCodeEditor | null>
) {
  const getState = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return null

    const model = editor.getModel()
    const position = editor.getPosition()
    const selection = editor.getSelection()

    return {
      lineCount: model?.getLineCount() || 0,
      cursorLine: position?.lineNumber || 0,
      cursorColumn: position?.column || 0,
      selectionLength: selection && !selection.isEmpty()
        ? model?.getValueInRange(selection).length || 0
        : 0,
      selectedLineCount: selection
        ? selection.endLineNumber - selection.startLineNumber + 1
        : 0,
      language: model?.getLanguageId() || 'plaintext',
      encoding: 'UTF-8',
      eol: model?.getEOL() === '\r\n' ? 'CRLF' : 'LF',
      tabSize: model?.getOptions().tabSize || 4,
      insertSpaces: model?.getOptions().insertSpaces || true,
      wordCount: model?.getValue().split(/\s+/).filter(Boolean).length || 0,
      charCount: model?.getValue().length || 0,
    }
  }, [editorRef])

  return { getState }
}
