/**
 * Renderer side of inline AI edits: the editor's Ctrl+K widget and its
 * Refactor / Add Comments / Fix Issues actions. The edit itself comes from the
 * main process over `ai:edit` (electron/ai/inline-edit.ts).
 */
import type { editor as MonacoEditor, IRange } from 'monaco-editor'
import type { InlineEditRequest, InlineEditResult } from '@shared/ipc-contract'
import { ipcErrorMessage } from './ipcResult'

/** The editor's AI context-menu edits; each opens the Ctrl+K widget with its instruction. */
export const CONTEXT_EDIT_ACTIONS = [
  {
    id: 'orion-ai-refactor',
    label: 'AI: Refactor Selection',
    instruction: 'Refactor this code for readability, performance and best practices without changing what it does.',
  },
  {
    id: 'orion-ai-add-comments',
    label: 'AI: Add Comments',
    instruction: 'Add clear, helpful comments to this code. Do not change the code itself.',
  },
  {
    id: 'orion-ai-fix-issues',
    label: 'AI: Fix Issues',
    instruction: 'Find bugs, potential issues and anti-patterns in this code and fix them.',
  },
] as const

export interface InlineEditHandlers {
  /** Open the widget on `ed`'s selection; false when there is nothing to edit. */
  open: (ed: MonacoEditor.ICodeEditor) => boolean
  /** Ask for the edit of the selection the widget was opened on. */
  submit: (instruction: string) => void
}

/** Register Ctrl+K and the context-menu edits on a Monaco editor. */
export function registerInlineEditActions(
  editor: Pick<MonacoEditor.IStandaloneCodeEditor, 'addAction'>,
  shortcut: number,
  handlers: InlineEditHandlers,
): void {
  editor.addAction({
    id: 'orion-inline-edit',
    label: 'Edit with AI (Ctrl+I)',
    keybindings: [shortcut],
    run: (ed) => {
      handlers.open(ed)
    },
  })
  CONTEXT_EDIT_ACTIONS.forEach(({ id, label, instruction }, index) => {
    editor.addAction({
      id,
      label,
      contextMenuGroupId: '9_ai',
      contextMenuOrder: 2 + index,
      precondition: 'editorHasSelection',
      run: (ed) => {
        const selection = ed.getSelection()
        if (!selection || !ed.getModel()?.getValueInRange(selection).trim()) return
        if (handlers.open(ed)) handlers.submit(instruction)
      },
    })
  })
}

/** The command palette's "AI: Inline Edit" entry dispatches this. */
export const INLINE_EDIT_COMMAND_EVENT = 'orion:inline-edit'

export function onInlineEditCommand(handler: () => void): () => void {
  window.addEventListener(INLINE_EDIT_COMMAND_EVENT, handler)
  return () => window.removeEventListener(INLINE_EDIT_COMMAND_EVENT, handler)
}

/** File text sent on each side of the selection, for reference. */
const CONTEXT_CHARS = 8_000

type TextModelLike = Pick<MonacoEditor.ITextModel, 'getValue' | 'getOffsetAt' | 'getLanguageId'>

export function buildInlineEditRequest(
  model: TextModelLike,
  range: IRange,
  { instruction, filePath, chatModel }: { instruction: string; filePath: string; chatModel: string },
): InlineEditRequest {
  const text = model.getValue()
  const start = model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn })
  const end = model.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn })
  return {
    instruction,
    code: text.slice(start, end),
    language: model.getLanguageId(),
    fileName: filePath.replace(/\\/g, '/').split('/').pop() || 'untitled',
    before: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    after: text.slice(end, end + CONTEXT_CHARS),
    model: chatModel,
  }
}

/** Ask the main process for the edit; a failed IPC call comes back as `{ error }` too. */
export async function requestInlineEdit(request: InlineEditRequest): Promise<InlineEditResult> {
  try {
    return await window.api.aiEdit(request)
  } catch (err) {
    return { error: ipcErrorMessage(err) }
  }
}

/**
 * Numbers requests so a reply that arrives after the widget was closed,
 * reopened or resubmitted is dropped instead of shown.
 */
export function createRequestGate() {
  let current = 0
  return {
    start: () => ++current,
    isCurrent: (id: number) => id === current,
    cancel: () => {
      current++
    },
  }
}

/**
 * Whether an edit may still replace the text it was made from: the editor
 * still shows that model and the selected text is unchanged. Otherwise
 * accepting would overwrite other code (another tab, or text typed meanwhile).
 */
export function canApplyInlineEdit(
  shown: MonacoEditor.ITextModel | null,
  editedModel: Pick<MonacoEditor.ITextModel, 'getValueInRange'> | null,
  range: IRange | null,
  originalText: string,
): boolean {
  return !!editedModel && !!range && shown === editedModel && editedModel.getValueInRange(range) === originalText
}

/**
 * Replace `range` with the accepted edit as its own undo step. executeEdits
 * alone appends to the open undo element, so one Ctrl+Z would also take back
 * the typing just before (or after) the edit.
 */
export function applyInlineEdit(
  editor: Pick<MonacoEditor.ICodeEditor, 'executeEdits' | 'pushUndoStop'>,
  range: IRange,
  text: string,
): void {
  editor.pushUndoStop()
  editor.executeEdits('orion-inline-edit', [{ range, text }])
  editor.pushUndoStop()
}
