/**
 * Feed the Problems store from Monaco's markers, so the Problems panel, tab
 * badges and error lens show what the language services report (TypeScript,
 * JSON, CSS, ...) plus the JS/TS lint hints published here.
 */
import type { Monaco } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useEditorStore } from '@/store/editor'
import { scanLintHints, useProblemsStore, type Problem, type ProblemSeverity } from '@/store/problems'

export const LINT_HINT_OWNER = 'orion-lint-hints'
const HINT_LANGUAGES = new Set(['typescript', 'javascript'])

const synced = new WeakSet<object>()

export function syncProblemsWithMonaco(monaco: Monaco): void {
  if (synced.has(monaco)) return
  synced.add(monaco)

  const publishHints = (model: MonacoEditor.ITextModel) => {
    const hints = model.uri.scheme === 'file' && HINT_LANGUAGES.has(model.getLanguageId())
      ? scanLintHints(model.getValue())
      : []
    monaco.editor.setModelMarkers(model, LINT_HINT_OWNER, hints.map((h) => ({
      severity: h.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
      message: h.message,
      source: h.source,
      startLineNumber: h.line,
      startColumn: h.column,
      endLineNumber: h.line,
      endColumn: h.endColumn,
    })))
  }
  const watch = (model: MonacoEditor.ITextModel) => {
    publishHints(model)
    model.onDidChangeContent(() => publishHints(model))
    model.onDidChangeLanguage(() => publishHints(model))
    model.onWillDispose(() => monaco.editor.setModelMarkers(model, LINT_HINT_OWNER, []))
  }
  monaco.editor.getModels().forEach(watch)
  monaco.editor.onDidCreateModel(watch)

  const severityOf = (s: number): ProblemSeverity | null =>
    s >= monaco.MarkerSeverity.Error ? 'error'
      : s >= monaco.MarkerSeverity.Warning ? 'warning'
        : s >= monaco.MarkerSeverity.Info ? 'info'
          : null // Hint: suggestions such as faded unused code, not problems

  // Problems are listed for the open files, keyed by their store path.
  const publishProblems = () => {
    const byUri = new Map<string, MonacoEditor.IMarker[]>()
    for (const marker of monaco.editor.getModelMarkers({})) {
      const key = marker.resource.toString()
      const list = byUri.get(key)
      if (list) list.push(marker)
      else byUri.set(key, [marker])
    }
    const problems: Problem[] = []
    for (const file of useEditorStore.getState().openFiles) {
      ;(byUri.get(monaco.Uri.file(file.path).toString()) ?? []).forEach((marker, i) => {
        const severity = severityOf(marker.severity)
        if (!severity) return
        problems.push({
          id: `${file.path}#${i}`,
          severity,
          message: marker.message,
          file: file.path,
          line: marker.startLineNumber,
          column: marker.startColumn,
          endLine: marker.endLineNumber,
          endColumn: marker.endColumn,
          source: marker.source || marker.owner,
        })
      })
    }
    useProblemsStore.getState().setProblems(problems)
  }
  monaco.editor.onDidChangeMarkers(publishProblems)
  // Opening, closing or renaming a tab changes which markers are listed.
  const pathsKey = () => useEditorStore.getState().openFiles.map((f) => f.path).join('\0')
  let openPaths = pathsKey()
  useEditorStore.subscribe(() => {
    const paths = pathsKey()
    if (paths === openPaths) return
    openPaths = paths
    publishProblems()
  })
  publishProblems()
}
