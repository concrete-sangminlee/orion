/// <reference types="vite/client" />
/**
 * Serve Monaco from the app bundle.
 *
 * Without this, @monaco-editor/react's loader fetched Monaco at runtime from
 * cdn.jsdelivr.net (a different version than the one in package.json). The
 * editor then failed offline, and remote script ran in a renderer that has
 * window.api (filesystem, git, terminal). Import this module, for its side
 * effect, before any <Editor>/<DiffEditor> mounts.
 */
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

type WorkerFactory = new () => Worker

const WORKERS_BY_LABEL: Record<string, WorkerFactory> = {
  json: JsonWorker,
  css: CssWorker,
  scss: CssWorker,
  less: CssWorker,
  html: HtmlWorker,
  handlebars: HtmlWorker,
  razor: HtmlWorker,
  typescript: TsWorker,
  javascript: TsWorker,
}

/** Which bundled worker serves a Monaco language label. */
export function workerForLabel(label: string): WorkerFactory {
  return WORKERS_BY_LABEL[label] ?? EditorWorker
}

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    const Worker = workerForLabel(label)
    return new Worker()
  },
}

loader.config({ monaco })

/**
 * Monaco model URI for a file. Each open file gets its own model, so undo
 * history, view state and TypeScript diagnostics stay per file.
 */
export function modelPathFor(filePath: string): string {
  return monaco.Uri.file(filePath).toString()
}

/**
 * Dispose file models that no open editor uses any more. Without this every
 * file ever opened stays in memory and in the TypeScript program.
 */
export function disposeModelsExcept(keepFilePaths: Iterable<string>): void {
  const keep = new Set([...keepFilePaths].map(modelPathFor))
  for (const model of monaco.editor.getModels()) {
    if (model.uri.scheme === 'file' && !keep.has(model.uri.toString()) && !model.isAttachedToEditor()) {
      model.dispose()
    }
  }
}

export { monaco }
