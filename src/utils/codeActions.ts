/**
 * Code action provider system.
 * Provides quick fixes, refactorings, and source actions
 * with Monaco editor integration.
 */

import type { editor as MonacoEditor, languages, IDisposable } from 'monaco-editor'

/* ── Types ─────────────────────────────────────────────── */

export type CodeActionKind =
  | 'quickfix'
  | 'refactor'
  | 'refactor.extract'
  | 'refactor.inline'
  | 'refactor.rewrite'
  | 'source'
  | 'source.organizeImports'
  | 'source.fixAll'

export interface CodeAction {
  title: string
  kind: CodeActionKind
  diagnostics?: DiagnosticInfo[]
  edit?: WorkspaceEdit
  command?: CodeActionCommand
  isPreferred?: boolean
  disabled?: string
}

export interface DiagnosticInfo {
  message: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  range: LineRange
  source?: string
  code?: string | number
}

export interface LineRange {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export interface WorkspaceEdit {
  changes: FileEdit[]
}

export interface FileEdit {
  filePath: string
  edits: TextEdit[]
}

export interface TextEdit {
  range: LineRange
  newText: string
}

export interface CodeActionCommand {
  id: string
  title: string
  arguments?: any[]
}

export interface CodeActionContext {
  diagnostics: DiagnosticInfo[]
  triggerKind: 'invoke' | 'auto'
  only?: CodeActionKind[]
}

export interface CodeActionProvider {
  languages: string[]
  provideCodeActions(
    filePath: string,
    range: LineRange,
    context: CodeActionContext
  ): Promise<CodeAction[]>
}

/* ── Built-in Quick Fixes ──────────────────────────────── */

const COMMON_QUICK_FIXES: Record<string, (diag: DiagnosticInfo) => CodeAction | null> = {
  'missing-semicolon': (diag) => ({
    title: 'Add missing semicolon',
    kind: 'quickfix',
    isPreferred: true,
    edit: {
      changes: [{
        filePath: '',
        edits: [{
          range: { startLine: diag.range.endLine, startColumn: diag.range.endColumn, endLine: diag.range.endLine, endColumn: diag.range.endColumn },
          newText: ';',
        }],
      }],
    },
  }),

  'unused-import': (diag) => ({
    title: 'Remove unused import',
    kind: 'quickfix',
    isPreferred: true,
    edit: {
      changes: [{
        filePath: '',
        edits: [{
          range: { startLine: diag.range.startLine, startColumn: 1, endLine: diag.range.startLine + 1, endColumn: 1 },
          newText: '',
        }],
      }],
    },
  }),

  'missing-return-type': (diag) => ({
    title: 'Add return type annotation',
    kind: 'quickfix',
    command: { id: 'editor.action.addReturnType', title: 'Add return type' },
  }),

  'no-unused-vars': (diag) => ({
    title: `Remove unused variable`,
    kind: 'quickfix',
    edit: {
      changes: [{
        filePath: '',
        edits: [{
          range: diag.range,
          newText: '',
        }],
      }],
    },
  }),

  'missing-await': (diag) => ({
    title: 'Add missing await',
    kind: 'quickfix',
    isPreferred: true,
    edit: {
      changes: [{
        filePath: '',
        edits: [{
          range: { startLine: diag.range.startLine, startColumn: diag.range.startColumn, endLine: diag.range.startLine, endColumn: diag.range.startColumn },
          newText: 'await ',
        }],
      }],
    },
  }),
}

/* ── Common Refactorings ───────────────────────────────── */

export function getRefactorActions(
  selectedText: string,
  range: LineRange,
  languageId: string
): CodeAction[] {
  const actions: CodeAction[] = []

  if (selectedText.length > 0) {
    // Extract to variable
    actions.push({
      title: 'Extract to variable',
      kind: 'refactor.extract',
      command: {
        id: 'refactor.extractVariable',
        title: 'Extract to variable',
        arguments: [{ range, text: selectedText }],
      },
    })

    // Extract to function
    if (selectedText.includes('\n') || selectedText.length > 20) {
      actions.push({
        title: 'Extract to function',
        kind: 'refactor.extract',
        command: {
          id: 'refactor.extractFunction',
          title: 'Extract to function',
          arguments: [{ range, text: selectedText }],
        },
      })
    }

    // Extract to constant
    actions.push({
      title: 'Extract to constant',
      kind: 'refactor.extract',
      command: {
        id: 'refactor.extractConstant',
        title: 'Extract to constant',
        arguments: [{ range, text: selectedText }],
      },
    })

    // Convert string template
    if (languageId === 'typescript' || languageId === 'javascript' ||
        languageId === 'typescriptreact' || languageId === 'javascriptreact') {
      if (selectedText.includes("'") || selectedText.includes('"')) {
        actions.push({
          title: 'Convert to template literal',
          kind: 'refactor.rewrite',
          command: {
            id: 'refactor.convertToTemplateLiteral',
            title: 'Convert to template literal',
            arguments: [{ range, text: selectedText }],
          },
        })
      }
    }

    // Wrap in try/catch
    actions.push({
      title: 'Wrap in try/catch',
      kind: 'refactor.rewrite',
      command: {
        id: 'refactor.wrapTryCatch',
        title: 'Wrap in try/catch',
        arguments: [{ range, text: selectedText }],
      },
    })

    // Wrap in if condition
    actions.push({
      title: 'Wrap in if condition',
      kind: 'refactor.rewrite',
      command: {
        id: 'refactor.wrapIfCondition',
        title: 'Wrap in if condition',
        arguments: [{ range, text: selectedText }],
      },
    })
  }

  // Source actions (always available)
  actions.push({
    title: 'Organize imports',
    kind: 'source.organizeImports',
    command: { id: 'editor.action.organizeImports', title: 'Organize imports' },
  })

  actions.push({
    title: 'Fix all auto-fixable problems',
    kind: 'source.fixAll',
    command: { id: 'editor.action.fixAll', title: 'Fix all' },
  })

  return actions
}

/* ── Code Action Provider Registry ─────────────────────── */

class CodeActionRegistryImpl {
  private providers: CodeActionProvider[] = []
  private disposables: IDisposable[] = []

  /** Register a code action provider */
  register(provider: CodeActionProvider): () => void {
    this.providers.push(provider)
    return () => {
      this.providers = this.providers.filter(p => p !== provider)
    }
  }

  /** Get code actions for a given context */
  async getCodeActions(
    filePath: string,
    languageId: string,
    range: LineRange,
    context: CodeActionContext
  ): Promise<CodeAction[]> {
    const allActions: CodeAction[] = []

    // Get actions from registered providers
    const applicable = this.providers.filter(
      p => p.languages.includes(languageId) || p.languages.includes('*')
    )

    const results = await Promise.allSettled(
      applicable.map(p => p.provideCodeActions(filePath, range, context))
    )

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        allActions.push(...result.value)
      }
    }

    // Add built-in quick fixes for diagnostics
    for (const diag of context.diagnostics) {
      const code = String(diag.code || '').toLowerCase()
      for (const [pattern, factory] of Object.entries(COMMON_QUICK_FIXES)) {
        if (code.includes(pattern) || diag.message.toLowerCase().includes(pattern.replace(/-/g, ' '))) {
          const action = factory(diag)
          if (action) {
            action.diagnostics = [diag]
            allActions.push(action)
          }
        }
      }
    }

    // Filter by requested kinds
    if (context.only && context.only.length > 0) {
      return allActions.filter(a => context.only!.some(k => a.kind.startsWith(k)))
    }

    // Sort: preferred first, then by kind
    return allActions.sort((a, b) => {
      if (a.isPreferred && !b.isPreferred) return -1
      if (!a.isPreferred && b.isPreferred) return 1
      return a.kind.localeCompare(b.kind)
    })
  }

  /** Clear all providers */
  clear(): void {
    this.providers = []
    this.disposables.forEach(d => d.dispose())
    this.disposables = []
  }
}

export const codeActionRegistry = new CodeActionRegistryImpl()

/* ── Light Bulb Widget ─────────────────────────────────── */

export interface LightBulbState {
  visible: boolean
  position: { lineNumber: number; column: number }
  actions: CodeAction[]
  isAutoFix: boolean
}

export function shouldShowLightBulb(
  actions: CodeAction[],
  context: CodeActionContext
): LightBulbState | null {
  if (actions.length === 0) return null

  const hasQuickFix = actions.some(a => a.kind === 'quickfix')
  const hasPreferred = actions.some(a => a.isPreferred)
  const firstDiag = context.diagnostics[0]

  return {
    visible: true,
    position: firstDiag
      ? { lineNumber: firstDiag.range.startLine, column: 1 }
      : { lineNumber: 1, column: 1 },
    actions,
    isAutoFix: hasPreferred && hasQuickFix,
  }
}

/* ── Apply Edit Helper ─────────────────────────────────── */

export function applyWorkspaceEdit(
  editor: MonacoEditor.IStandaloneCodeEditor,
  edit: WorkspaceEdit
): void {
  const model = editor.getModel()
  if (!model) return

  for (const fileEdit of edit.changes) {
    const edits = fileEdit.edits.map(e => ({
      range: {
        startLineNumber: e.range.startLine,
        startColumn: e.range.startColumn,
        endLineNumber: e.range.endLine,
        endColumn: e.range.endColumn,
      },
      text: e.newText,
    }))

    editor.executeEdits('codeAction', edits)
  }
}

/* ── Diagnostic Quick Fix Suggestions ──────────────────── */

export function getSuggestedFixes(diagnostic: DiagnosticInfo): string[] {
  const suggestions: string[] = []
  const msg = diagnostic.message.toLowerCase()

  if (msg.includes('is not defined') || msg.includes('cannot find name')) {
    suggestions.push('Did you forget to import this?')
    suggestions.push('Check for typos in the identifier name')
  }

  if (msg.includes('type') && msg.includes('is not assignable')) {
    suggestions.push('Check the expected type')
    suggestions.push('Add a type assertion')
    suggestions.push('Update the function signature')
  }

  if (msg.includes('unused')) {
    suggestions.push('Remove the unused declaration')
    suggestions.push('Prefix with underscore to acknowledge')
  }

  if (msg.includes('missing')) {
    suggestions.push('Add the missing element')
  }

  if (msg.includes('deprecated')) {
    suggestions.push('Replace with the recommended alternative')
  }

  return suggestions
}
