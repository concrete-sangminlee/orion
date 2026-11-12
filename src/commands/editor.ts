/**
 * Commands that act on a Monaco editor. Monaco is loaded with the (lazy)
 * editor panel, so it is reached through the loader rather than imported:
 * importing it here would pull all of Monaco into the startup bundle.
 */
import { loader } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'

function info(message: string): void {
  useToastStore.getState().addToast({ type: 'info', message })
}

/**
 * The editor a command applies to: the one with focus, else the one showing
 * the active file. Commands run from the palette or a menu while focus is in
 * that UI, so "focused" alone would almost never find one.
 */
export function activeCodeEditor(): MonacoEditor.ICodeEditor | null {
  const monaco = loader.__getMonacoInstance()
  if (!monaco) return null
  const editors = monaco.editor.getEditors().filter((ed) => ed.getModel() && ed.getDomNode()?.isConnected)
  const focused = editors.find((ed) => ed.hasTextFocus()) ?? editors.find((ed) => ed.hasWidgetFocus())
  if (focused) return focused
  const activePath = useEditorStore.getState().activeFilePath
  if (!activePath) return null
  const uri = monaco.Uri.file(activePath).toString()
  return editors.find((ed) => ed.getModel()?.uri.toString() === uri) ?? null
}

/**
 * Run a Monaco editor action (`getAction(id)`) on the active editor. Tells
 * the user when there is no editor, or the action does not apply here (for
 * example an AI action with nothing selected), instead of doing nothing.
 */
export async function runEditorAction(actionId: string, title: string): Promise<void> {
  const editor = activeCodeEditor()
  if (!editor) {
    info(`${title}: open a file in the editor first`)
    return
  }
  const action = editor.getAction(actionId)
  if (!action || !action.isSupported()) {
    info(`${title} is not available here`)
    return
  }
  editor.focus()
  await action.run()
}

/**
 * Put the cursor on `name` in `line` of the active file, then run an action
 * there: the Outline panel's Peek References and Rename Symbol.
 */
export async function runEditorActionAtSymbol(actionId: string, title: string, name: string, line: number): Promise<void> {
  const editor = activeCodeEditor()
  const model = editor?.getModel()
  if (!editor || !model) {
    info(`${title}: open a file in the editor first`)
    return
  }
  const index = line >= 1 && line <= model.getLineCount() ? model.getLineContent(line).indexOf(name) : -1
  if (index < 0) {
    info(`${title}: ${name} is no longer on line ${line}`)
    return
  }
  const column = index + 1
  editor.setSelection({ startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column })
  editor.revealLineInCenter(line)
  await runEditorAction(actionId, title)
}

/** Run an editor command that is not an action (undo, paste, select all). */
function triggerEditorCommand(handlerId: string, title: string, payload?: unknown): void {
  const editor = activeCodeEditor()
  if (!editor) {
    info(`${title}: open a file in the editor first`)
    return
  }
  editor.focus()
  editor.trigger('orion.command', handlerId, payload ?? null)
}

export type EditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'

const EDIT_TITLES: Record<EditCommand, string> = {
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select All',
}

/** The clipboard text, read by the main process (the page has no clipboard permission). */
async function clipboardText(): Promise<string> {
  const result = await window.api.clipboardReadText()
  if (!result.success) throw new Error(result.error || 'could not read the clipboard')
  return result.text ?? ''
}

/** A text field (not Monaco's own hidden textarea) that has keyboard focus. */
function focusedTextField(): HTMLElement | null {
  const el = document.activeElement as HTMLElement | null
  if (!el || el.closest('.monaco-editor')) return null
  const editable = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable
  return editable ? el : null
}

/**
 * Edit > Undo/Redo/Cut/Copy/Paste/Select All: act on the focused text field
 * (the chat box, the search field), else on the active editor.
 */
export async function runEditCommand(command: EditCommand): Promise<void> {
  if (focusedTextField()) {
    if (command === 'paste') {
      document.execCommand('insertText', false, await clipboardText())
    } else {
      document.execCommand(command)
    }
    return
  }
  switch (command) {
    case 'paste':
      // Monaco's own paste action needs clipboard permission the page lacks.
      triggerEditorCommand('paste', EDIT_TITLES.paste, { text: await clipboardText() })
      return
    case 'cut':
      return runEditorAction('editor.action.clipboardCutAction', EDIT_TITLES.cut)
    case 'copy':
      return runEditorAction('editor.action.clipboardCopyAction', EDIT_TITLES.copy)
    case 'selectAll':
      triggerEditorCommand('editor.action.selectAll', EDIT_TITLES.selectAll)
      return
    default:
      triggerEditorCommand(command, EDIT_TITLES[command])
  }
}
