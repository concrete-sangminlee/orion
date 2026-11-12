/**
 * Monaco providers and commands the editor panel adds. They are global to the
 * Monaco instance, not tied to an editor, while the panel's <Editor> remounts
 * often (last tab closed, image tab, JSON/CSV/compare views). Registering on
 * every mount stacked duplicate providers, so they are registered once per
 * Monaco instance here.
 */
import type { Monaco } from '@monaco-editor/react'
import type { editor as MonacoEditor, languages } from 'monaco-editor'
import { useEditorStore } from '@/store/editor'
import { registerSnippetCompletionProvider } from '@/store/snippets'
import { registerCodeActionProviders } from './codeActions'
import { registerColorProviders } from './colors'

/** Monaco has no 'typescriptreact'/'javascriptreact' ids: .tsx/.jsx models are typescript/javascript. */
const JS_TS_LANGUAGES = ['typescript', 'javascript']
const JSX_FILE = /\.[jt]sx$/i

export const SHOW_REFERENCES_COMMAND = 'orion.codeLens.showReferences'
export const EXPLAIN_COMMAND = 'orion.codeLens.explain'

const registered = new WeakSet<object>()

export function registerEditorProviders(monaco: Monaco): void {
  if (registered.has(monaco)) return
  registered.add(monaco)
  registerReactSnippets(monaco)
  registerSnippetCompletionProvider(monaco)
  registerColorProviders(monaco)
  registerCodeLens(monaco)
  registerCodeActionProviders(monaco)
  registerJsxLinkedEditing(monaco)
  // No folding provider: once one exists for a language Monaco uses only its
  // ranges, so an import-block provider took away the indentation folding of
  // every function and block in TS/JS, Python, Go, Rust and Java.
}

/* ── React snippets ─────────────────────────────────────── */

function registerReactSnippets(monaco: Monaco): void {
  for (const lang of JS_TS_LANGUAGES) {
    monaco.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }
        const snippet = (label: string, insertText: string, documentation: string) => ({
          label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation,
          range,
        })
        return {
          suggestions: [
            snippet('useState', 'const [${1:state}, set${1/(.*)/${1:/capitalize}/}] = useState(${2:initialValue})', 'React useState hook'),
            snippet('useEffect', 'useEffect(() => {\n\t${1}\n}, [${2}])', 'React useEffect hook'),
            snippet('comp', 'export default function ${1:Component}() {\n\treturn (\n\t\t<div>\n\t\t\t${2}\n\t\t</div>\n\t)\n}', 'React functional component'),
          ],
        }
      },
    })
  }
}

/* ── CodeLens: references, implementations, Explain, recent edits ── */

const CL_FUNC_DEF = /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|(?:\w+)\s*=>)|class\s+(\w+))/
const CL_IFACE = /^[ \t]*(?:export\s+)?(?:interface|type)\s+(\w+)/
const CL_EXPORT = /^[ \t]*export\s+(?:default\s+)?(?:function|const|let|var|class|interface|type|enum|abstract)\s+(\w+)/

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `${model uri}:${definition name}` -> when it was last edited. */
const recentEdits = new Map<string, number>()

/** Last line of the brace block that starts at startLine. */
function findBlockEnd(model: MonacoEditor.ITextModel, startLine: number): number {
  const lineCount = model.getLineCount()
  let depth = 0
  let opened = false
  for (let ln = startLine; ln <= lineCount; ln++) {
    for (const ch of model.getLineContent(ln)) {
      if (ch === '{') { depth++; opened = true } else if (ch === '}') { depth-- }
      if (opened && depth === 0) return ln
    }
  }
  return startLine
}

const defName = (match: RegExpExecArray | null) => (match ? match[1] || match[2] || match[3] : undefined)

/** The function or class whose definition line, or block, contains `line`. */
function enclosingDefinition(model: MonacoEditor.ITextModel, line: number): string | undefined {
  const own = defName(CL_FUNC_DEF.exec(model.getLineContent(line)))
  if (own) return own
  for (let ln = line - 1; ln >= Math.max(1, line - 30); ln--) {
    const name = defName(CL_FUNC_DEF.exec(model.getLineContent(ln)))
    if (name) return line <= findBlockEnd(model, ln) ? name : undefined
  }
  return undefined
}

function trackRecentEdits(monaco: Monaco): void {
  const watch = (model: MonacoEditor.ITextModel) => {
    model.onDidChangeContent((e) => {
      for (const change of e.changes) {
        // Ranges are in pre-edit lines: one past lines a multi-cursor edit
        // deleted would make getLineContent throw.
        const name = enclosingDefinition(model, Math.min(change.range.startLineNumber, model.getLineCount()))
        if (name) recentEdits.set(`${model.uri.toString()}:${name}`, Date.now())
      }
    })
  }
  monaco.editor.getModels().forEach(watch)
  monaco.editor.onDidCreateModel(watch)
}

/** Occurrences of the word in every open model (a text count, not a semantic one). */
function countAcrossModels(monaco: Monaco, pattern: RegExp): number {
  let n = 0
  for (const m of monaco.editor.getModels()) n += m.getValue().match(pattern)?.length ?? 0
  return n
}

/** Run Monaco's reference search (the TypeScript service's) on the definition the lens belongs to. */
function showReferences(monaco: Monaco, uri: string, line: number, name: string): void {
  const editors = monaco.editor.getEditors().filter((e) => e.getModel()?.uri.toString() === uri)
  const editor = editors.find((e) => e.hasTextFocus()) ?? editors[0]
  const model = editor?.getModel()
  if (!editor || !model || line > model.getLineCount()) return
  const at = new RegExp(`\\b${escapeRegExp(name)}\\b`).exec(model.getLineContent(line))
  editor.setPosition({ lineNumber: line, column: at ? at.index + 1 : 1 })
  editor.focus()
  void editor.getAction('editor.action.referenceSearch.trigger')?.run()
}

/** Send the definition's code to the chat panel's Explain action. */
function explain(monaco: Monaco, uri: string, startLine: number, endLine: number): void {
  const model = monaco.editor.getModel(monaco.Uri.parse(uri))
  if (!model || endLine > model.getLineCount()) return
  const file = useEditorStore.getState().openFiles.find((f) => monaco.Uri.file(f.path).toString() === uri)
  const selectedText = model.getValueInRange(new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)))
  window.dispatchEvent(new CustomEvent('orion:ai-context-action', {
    detail: { action: 'explain', selectedText, filePath: file?.path ?? model.uri.path, language: model.getLanguageId() },
  }))
}

function registerCodeLens(monaco: Monaco): void {
  // Lens commands go through Monaco's command registry: editor.addAction ids
  // are prefixed with the editor id, so a lens naming one ran nothing.
  monaco.editor.registerCommand(SHOW_REFERENCES_COMMAND, (_accessor, uri: string, line: number, name: string) =>
    showReferences(monaco, uri, line, name))
  monaco.editor.registerCommand(EXPLAIN_COMMAND, (_accessor, uri: string, startLine: number, endLine: number) =>
    explain(monaco, uri, startLine, endLine))
  trackRecentEdits(monaco)

  for (const lang of JS_TS_LANGUAGES) {
    monaco.languages.registerCodeLensProvider(lang, {
      provideCodeLenses: (model) => {
        const lenses: languages.CodeLens[] = []
        const uri = model.uri.toString()
        const definitions: { name: string; line: number; kind: 'function' | 'class' | 'interface' | 'type' | 'export' }[] = []

        for (let lineNum = 1; lineNum <= model.getLineCount(); lineNum++) {
          const lineContent = model.getLineContent(lineNum)
          const ifaceMatch = CL_IFACE.exec(lineContent)
          if (ifaceMatch?.[1]) {
            definitions.push({ name: ifaceMatch[1], line: lineNum, kind: lineContent.includes('interface') ? 'interface' : 'type' })
            continue
          }
          const funcMatch = CL_FUNC_DEF.exec(lineContent)
          const name = defName(funcMatch)
          if (funcMatch && name) {
            definitions.push({ name, line: lineNum, kind: CL_EXPORT.test(lineContent) ? 'export' : funcMatch[3] ? 'class' : 'function' })
          }
        }

        for (const def of definitions) {
          const range = new monaco.Range(def.line, 1, def.line, 1)
          const word = escapeRegExp(def.name)

          const refCount = Math.max(0, countAcrossModels(monaco, new RegExp(`\\b${word}\\b`, 'g')) - 1)
          lenses.push({
            range,
            id: `codelens-ref-${def.name}-${def.line}`,
            command: { id: SHOW_REFERENCES_COMMAND, title: `${refCount} reference${refCount !== 1 ? 's' : ''}`, arguments: [uri, def.line, def.name] },
          })

          if (def.kind === 'interface' || def.kind === 'type') {
            const implCount = countAcrossModels(monaco, new RegExp(`\\b(?:implements|extends)\\s+(?:[\\w,\\s]*\\b)?${word}\\b`, 'g'))
            lenses.push({
              range,
              id: `codelens-impl-${def.name}-${def.line}`,
              command: { id: SHOW_REFERENCES_COMMAND, title: `${implCount} implementation${implCount !== 1 ? 's' : ''}`, arguments: [uri, def.line, def.name] },
            })
          } else {
            // Explain is offered on longer functions and classes only.
            const endLine = findBlockEnd(model, def.line)
            if (endLine - def.line + 1 > 20) {
              lenses.push({
                range,
                id: `codelens-explain-${def.name}-${def.line}`,
                command: { id: EXPLAIN_COMMAND, title: 'Explain', arguments: [uri, def.line, endLine] },
              })
            }
          }

          const lastEdit = recentEdits.get(`${uri}:${def.name}`)
          const minsAgo = lastEdit === undefined ? Infinity : Math.round((Date.now() - lastEdit) / 60000)
          if (minsAgo < 60) {
            const label = minsAgo < 1 ? 'just now' : `${minsAgo} minute${minsAgo !== 1 ? 's' : ''} ago`
            // No command id: a label, not a link.
            lenses.push({ range, id: `codelens-recent-${def.name}-${def.line}`, command: { id: '', title: `Modified ${label}` } })
          }
        }

        return { lenses, dispose: () => {} }
      },
      resolveCodeLens: (_model, codeLens) => codeLens,
    })
  }
}

/* ── Linked editing of HTML / JSX tag pairs ────────────── */

function registerJsxLinkedEditing(monaco: Monaco): void {
  for (const lang of ['html', ...JS_TS_LANGUAGES]) {
    monaco.languages.registerLinkedEditingRangeProvider(lang, {
      provideLinkedEditingRanges(model, position) {
        // Tags only exist in .tsx/.jsx among the JS/TS files.
        if (lang !== 'html' && !JSX_FILE.test(model.uri.path)) return null
        const line = model.getLineContent(position.lineNumber)
        const offset = position.column - 1

        // Match opening tag: <TagName or closing tag: </TagName
        const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9._-]*)/g
        let match: RegExpExecArray | null
        while ((match = tagPattern.exec(line)) !== null) {
          const tagStart = match.index + match[0].length - match[1].length
          const tagEnd = tagStart + match[1].length
          if (offset < tagStart || offset > tagEnd) continue

          const tagName = match[1]
          const fullText = model.getValue()
          const sameTag = () => new RegExp(`</?${escapeRegExp(tagName)}(?=[\\s>/])`, 'g')
          const cursorRange = {
            startLineNumber: position.lineNumber,
            startColumn: tagStart + 1,
            endLineNumber: position.lineNumber,
            endColumn: tagEnd + 1,
          }
          const rangeAt = (offsetInText: number) => {
            const pos = model.getPositionAt(offsetInText)
            return { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column + tagName.length }
          }
          const wordPattern = /[a-zA-Z][a-zA-Z0-9._-]*/

          if (match[0].startsWith('</')) {
            // Closing tag: walk back over the tags before it to its opener.
            const closingTagPos = model.getPositionAt(fullText.lastIndexOf(match[0], model.getOffsetAt(position)))
            const beforeClosing = fullText.substring(0, model.getOffsetAt(closingTagPos))
            const tags: { index: number; isClose: boolean }[] = []
            const pattern = sameTag()
            let m2: RegExpExecArray | null
            while ((m2 = pattern.exec(beforeClosing)) !== null) tags.push({ index: m2.index, isClose: m2[0].startsWith('</') })
            let depth = 0
            for (let i = tags.length - 1; i >= 0; i--) {
              if (tags[i].isClose) depth++
              else if (depth === 0) return { ranges: [rangeAt(tags[i].index + 1), cursorRange], wordPattern }
              else depth--
            }
          } else {
            // Opening tag: walk forward to its closer.
            const openOffset = model.getOffsetAt(position)
            const afterOpen = fullText.substring(openOffset)
            const pattern = sameTag()
            let depth = 0
            let m2: RegExpExecArray | null
            while ((m2 = pattern.exec(afterOpen)) !== null) {
              if (!m2[0].startsWith('</')) depth++
              else if (depth === 0) return { ranges: [cursorRange, rangeAt(openOffset + m2.index + 2)], wordPattern }
              else depth--
            }
          }
          break
        }
        return null
      },
    })
  }
}
