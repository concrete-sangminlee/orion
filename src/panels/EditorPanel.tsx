import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import Editor, { type Monaco } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { useProblemsStore } from '@/store/problems'
import { useThemeStore } from '@/store/theme'
import { useSnippetStore } from '@/store/snippets'
import TabBar from '@/components/TabBar'
import InlineEdit from '@/components/InlineEdit'
import InlineDiff from '@/components/InlineDiff'
import {
  Zap, FolderOpen, MessageSquare, Terminal, Command,
  ChevronRight, ChevronDown, FilePlus, Loader2, Keyboard, Clock,
  Search, Settings, GitBranch, Columns, Sparkles,
  FileText, ZoomIn, ZoomOut, Maximize2, Minimize2,
  Image as ImageIcon, Folder, File, Hash, Box, Braces, Type as TypeIcon,
  Upload,
} from 'lucide-react'
import { useEditorStore as useBreadcrumbEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'

// ── Types for git gutter decorations ──────────────────
interface DiffHunk {
  type: 'added' | 'modified' | 'deleted'
  startLine: number
  count: number
}

// ── CSS color regex for inline color decorators ──────────────────
const CSS_COLOR_REGEX = /#(?:[0-9a-fA-F]{3,4}){1,2}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)|hsla?\(\s*\d+\s*,\s*\d+%?\s*,\s*\d+%?\s*(?:,\s*[\d.]+\s*)?\)/g

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'])

function isImageFile(filePath: string): boolean {
  const ext = filePath.replace(/\\/g, '/').split('/').pop()?.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTENSIONS.has(ext)
}

function filePathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  // On Windows paths like C:/foo/bar, prepend file:///
  // On Unix paths like /foo/bar, prepend file://
  if (/^[a-zA-Z]:/.test(normalized)) {
    return `file:///${normalized}`
  }
  return `file://${normalized}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function EditorPanel() {
  const { openFiles, activeFilePath, updateFileContent, markSaved, closeFile, closeAllFiles } = useEditorStore()
  const addToast = useToastStore((s) => s.addToast)
  const getSnippetsForLanguage = useSnippetStore((s) => s.getSnippetsForLanguage)
  const activeFile = openFiles.find((f) => f.path === activeFilePath)
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Editor config state for command palette toggling
  const [editorConfig, setEditorConfig] = useState({ fontSize: 13, minimap: true, wordWrap: false })
  const minimapRef = useRef(true)

  // Inline edit (Ctrl+K) state
  const [inlineEditVisible, setInlineEditVisible] = useState(false)
  const [inlineEditPos, setInlineEditPos] = useState({ top: 60, left: 100 })
  const [inlineEditText, setInlineEditText] = useState('')
  const [inlineProcessing, setInlineProcessing] = useState(false)

  // Inline diff preview state (shown after AI responds to Ctrl+K)
  const [diffVisible, setDiffVisible] = useState(false)
  const [diffOriginalCode, setDiffOriginalCode] = useState('')
  const [diffSuggestedCode, setDiffSuggestedCode] = useState('')
  const [diffPos, setDiffPos] = useState({ top: 60, left: 100 })
  const diffSelectionRef = useRef<MonacoEditor.ISelection | null>(null)

  // Decoration refs for active line highlight, git gutter, and color decorators
  const activeLineDecorationsRef = useRef<string[]>([])
  const gitGutterDecorationsRef = useRef<string[]>([])
  const colorDecorationsRef = useRef<string[]>([])
  const rootPath = useFileStore((s) => s.rootPath)

  // Split editor state
  const [splitMode, setSplitMode] = useState<'single' | 'split'>('single')
  const [splitFilePath, setSplitFilePath] = useState<string | null>(null)
  const splitFile = splitFilePath ? openFiles.find((f) => f.path === splitFilePath) : null

  // Drag-and-drop state for OS file drops
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)
  const openFile = useEditorStore((s) => s.openFile)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    // Only show overlay for file drags from OS (has Files type)
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragOver(false)

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    let openedCount = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      // Electron exposes .path on dropped File objects
      const filePath = (file as any).path as string | undefined
      if (!filePath) continue

      try {
        const result = await window.api.readFile(filePath)
        openFile(
          {
            path: filePath,
            name: file.name,
            content: result.content,
            language: result.language,
            isModified: false,
            aiModified: false,
          },
          { preview: false },
        )
        openedCount++
      } catch (err: any) {
        addToast({ type: 'error', message: `Failed to open ${file.name}: ${err?.message || err}` })
      }
    }

    if (openedCount > 0) {
      addToast({
        type: 'success',
        message: openedCount === 1
          ? `Opened ${files[0].name}`
          : `Opened ${openedCount} files`,
        duration: 2000,
      })
    }
  }, [openFile, addToast])

  const scanFile = useProblemsStore((s) => s.scanFile)

  // Current Monaco theme (synced from the theme store)
  const currentMonacoTheme = useThemeStore((s) => s.activeTheme().monacoTheme)

  // Listen for theme changes and update Monaco accordingly
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.monacoTheme && monacoRef.current) {
        monacoRef.current.editor.setTheme(detail.monacoTheme)
      }
    }
    window.addEventListener('orion:theme-changed', handler)
    return () => window.removeEventListener('orion:theme-changed', handler)
  }, [])

  // Scan the active file for problems when it changes
  useEffect(() => {
    if (activeFile) {
      scanFile(activeFile.path, activeFile.content)
    }
  }, [activeFilePath]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (value: string | undefined) => {
    if (activeFilePath && value !== undefined) {
      updateFileContent(activeFilePath, value)

      // Scan for problems on content change
      scanFile(activeFilePath, value)

      // Auto-save with 2-second debounce
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = setTimeout(async () => {
        if (activeFilePath) {
          await window.api.writeFile(activeFilePath, value)
          markSaved(activeFilePath) // clear modified indicator
        }
      }, 2000)
    }
  }

  // Clean up auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [])

  const handleEditorMount = (editor: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // Register Ctrl+K for inline edit
    editor.addAction({
      id: 'orion-inline-edit',
      label: 'Edit with AI (Ctrl+K)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: (ed) => {
        const selection = ed.getSelection()
        const model = ed.getModel()
        if (!selection || !model) return

        const selectedText = model.getValueInRange(selection)
        setInlineEditText(selectedText)

        // Position the inline edit near the selection
        const pos = ed.getScrolledVisiblePosition(selection.getStartPosition())
        const domNode = ed.getDomNode()
        if (pos && domNode) {
          const rect = domNode.getBoundingClientRect()
          setInlineEditPos({
            top: pos.top + rect.top - 10,
            left: Math.max(pos.left + rect.left, rect.left + 40),
          })
        } else {
          setInlineEditPos({ top: 100, left: 100 })
        }

        setInlineEditVisible(true)
      },
    })

    // Register Ctrl+H for find and replace (Monaco built-in)
    editor.addAction({
      id: 'orion-find-replace',
      label: 'Find and Replace',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH],
      run: (ed) => {
        ed.getAction('editor.action.startFindReplaceAction')?.run()
      },
    })

    // Multi-cursor: Ctrl+D - Select next occurrence of current selection
    editor.addAction({
      id: 'orion-add-selection-to-next-match',
      label: 'Add Selection to Next Find Match',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD],
      run: (ed) => {
        ed.getAction('editor.action.addSelectionToNextFindMatch')?.run()
      },
    })

    // Multi-cursor: Ctrl+Shift+L - Select all occurrences
    editor.addAction({
      id: 'orion-select-all-occurrences',
      label: 'Select All Occurrences',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL],
      run: (ed) => {
        ed.getAction('editor.action.selectHighlights')?.run()
      },
    })

    // Multi-cursor: Ctrl+Alt+Up - Add cursor above
    editor.addAction({
      id: 'orion-add-cursor-above',
      label: 'Add Cursor Above',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.UpArrow],
      run: (ed) => {
        ed.getAction('editor.action.insertCursorAbove')?.run()
      },
    })

    // Multi-cursor: Ctrl+Alt+Down - Add cursor below
    editor.addAction({
      id: 'orion-add-cursor-below',
      label: 'Add Cursor Below',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.DownArrow],
      run: (ed) => {
        ed.getAction('editor.action.insertCursorBelow')?.run()
      },
    })

    // ── Right-click context menu AI actions ──────────────────
    editor.addAction({
      id: 'orion-ai-explain',
      label: 'AI: Explain Selection',
      contextMenuGroupId: '9_ai',
      contextMenuOrder: 1,
      precondition: 'editorHasSelection',
      run: (ed) => {
        const sel = ed.getSelection()
        const mdl = ed.getModel()
        if (!sel || !mdl) return
        const text = mdl.getValueInRange(sel)
        if (!text.trim()) return
        window.dispatchEvent(
          new CustomEvent('orion:ai-context-action', {
            detail: {
              action: 'explain',
              selectedText: text,
              filePath: activeFilePath,
              language: activeFile?.language || '',
            },
          }),
        )
      },
    })

    editor.addAction({
      id: 'orion-ai-refactor',
      label: 'AI: Refactor Selection',
      contextMenuGroupId: '9_ai',
      contextMenuOrder: 2,
      precondition: 'editorHasSelection',
      run: (ed) => {
        const sel = ed.getSelection()
        const mdl = ed.getModel()
        if (!sel || !mdl) return
        const text = mdl.getValueInRange(sel)
        if (!text.trim()) return

        // Store selection for diff preview
        diffSelectionRef.current = sel

        // Position diff near selection
        const vPos = ed.getScrolledVisiblePosition(sel.getStartPosition())
        const domNode = ed.getDomNode()
        if (vPos && domNode) {
          const rect = domNode.getBoundingClientRect()
          setDiffPos({
            top: vPos.top + rect.top - 10,
            left: Math.max(vPos.left + rect.left, rect.left + 40),
          })
        } else {
          setDiffPos({ top: 100, left: 100 })
        }

        window.dispatchEvent(
          new CustomEvent('orion:ai-context-action', {
            detail: {
              action: 'refactor',
              selectedText: text,
              filePath: activeFilePath,
              language: activeFile?.language || '',
              fullContext: mdl.getValue().substring(0, 2000),
            },
          }),
        )
      },
    })

    editor.addAction({
      id: 'orion-ai-add-comments',
      label: 'AI: Add Comments',
      contextMenuGroupId: '9_ai',
      contextMenuOrder: 3,
      precondition: 'editorHasSelection',
      run: (ed) => {
        const sel = ed.getSelection()
        const mdl = ed.getModel()
        if (!sel || !mdl) return
        const text = mdl.getValueInRange(sel)
        if (!text.trim()) return

        diffSelectionRef.current = sel

        const vPos = ed.getScrolledVisiblePosition(sel.getStartPosition())
        const domNode = ed.getDomNode()
        if (vPos && domNode) {
          const rect = domNode.getBoundingClientRect()
          setDiffPos({
            top: vPos.top + rect.top - 10,
            left: Math.max(vPos.left + rect.left, rect.left + 40),
          })
        } else {
          setDiffPos({ top: 100, left: 100 })
        }

        window.dispatchEvent(
          new CustomEvent('orion:ai-context-action', {
            detail: {
              action: 'add-comments',
              selectedText: text,
              filePath: activeFilePath,
              language: activeFile?.language || '',
              fullContext: mdl.getValue().substring(0, 2000),
            },
          }),
        )
      },
    })

    editor.addAction({
      id: 'orion-ai-fix-issues',
      label: 'AI: Fix Issues',
      contextMenuGroupId: '9_ai',
      contextMenuOrder: 4,
      precondition: 'editorHasSelection',
      run: (ed) => {
        const sel = ed.getSelection()
        const mdl = ed.getModel()
        if (!sel || !mdl) return
        const text = mdl.getValueInRange(sel)
        if (!text.trim()) return

        diffSelectionRef.current = sel

        const vPos = ed.getScrolledVisiblePosition(sel.getStartPosition())
        const domNode = ed.getDomNode()
        if (vPos && domNode) {
          const rect = domNode.getBoundingClientRect()
          setDiffPos({
            top: vPos.top + rect.top - 10,
            left: Math.max(vPos.left + rect.left, rect.left + 40),
          })
        } else {
          setDiffPos({ top: 100, left: 100 })
        }

        window.dispatchEvent(
          new CustomEvent('orion:ai-context-action', {
            detail: {
              action: 'fix-issues',
              selectedText: text,
              filePath: activeFilePath,
              language: activeFile?.language || '',
              fullContext: mdl.getValue().substring(0, 2000),
            },
          }),
        )
      },
    })

    // ── Active line highlighting ──────────────────
    // Highlight the current line with a subtle background using deltaDecorations
    const updateActiveLineDecoration = (lineNumber: number) => {
      activeLineDecorationsRef.current = editor.deltaDecorations(
        activeLineDecorationsRef.current,
        [{
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: {
            isWholeLine: true,
            className: 'orion-active-line-highlight',
            overviewRuler: { color: 'rgba(255, 255, 255, 0.08)', position: monaco.editor.OverviewRulerLane.Full },
          },
        }]
      )
    }

    // Set initial active line decoration
    updateActiveLineDecoration(editor.getPosition()?.lineNumber || 1)

    // Dispatch cursor position changes to status bar + update active line decoration
    editor.onDidChangeCursorPosition((e) => {
      updateActiveLineDecoration(e.position.lineNumber)
      window.dispatchEvent(new CustomEvent('orion:cursor-change', {
        detail: { line: e.position.lineNumber, column: e.position.column }
      }))
    })

    // Dispatch selection changes to status bar
    editor.onDidChangeCursorSelection((e) => {
      const selection = e.selection
      const model = editor.getModel()
      if (model && !selection.isEmpty()) {
        const text = model.getValueInRange(selection)
        window.dispatchEvent(new CustomEvent('orion:selection-change', {
          detail: { chars: text.length, lines: text.split('\n').length }
        }))
      } else {
        window.dispatchEvent(new CustomEvent('orion:selection-change', { detail: null }))
      }
    })

    // ── Color decorators: detect CSS color values and show inline color swatches ──────────────────
    const updateColorDecorations = () => {
      const edModel = editor.getModel()
      if (!edModel) return

      const decorations: MonacoEditor.IModelDeltaDecoration[] = []
      const lineCount = edModel.getLineCount()

      for (let lineNum = 1; lineNum <= lineCount; lineNum++) {
        const lineContent = edModel.getLineContent(lineNum)
        CSS_COLOR_REGEX.lastIndex = 0
        let colorMatch: RegExpExecArray | null
        while ((colorMatch = CSS_COLOR_REGEX.exec(lineContent)) !== null) {
          const startCol = colorMatch.index + 1
          const colorValue = colorMatch[0]

          decorations.push({
            range: new monaco.Range(lineNum, startCol, lineNum, startCol),
            options: {
              before: {
                content: '\u00A0',
                inlineClassName: `orion-color-swatch`,
                inlineClassNameAffectsLetterSpacing: true,
              },
              hoverMessage: { value: `Color: \`${colorValue}\`` },
            },
          })
        }
      }

      colorDecorationsRef.current = editor.deltaDecorations(
        colorDecorationsRef.current,
        decorations
      )

      // Apply color backgrounds to swatch elements after render
      requestAnimationFrame(() => {
        const domNode = editor.getDomNode()
        if (!domNode) return

        const swatchEls = domNode.querySelectorAll('.orion-color-swatch')
        swatchEls.forEach((el) => {
          const htmlEl = el as HTMLElement
          // Walk forward in the DOM to find the color text
          const parentLine = htmlEl.closest('.view-line')
          if (!parentLine) return
          const textContent = parentLine.textContent || ''
          CSS_COLOR_REGEX.lastIndex = 0
          const m = CSS_COLOR_REGEX.exec(textContent)
          if (m) {
            htmlEl.style.backgroundColor = m[0]
            htmlEl.style.border = '1px solid rgba(128,128,128,0.4)'
            htmlEl.style.borderRadius = '2px'
            htmlEl.style.marginRight = '4px'
            htmlEl.style.display = 'inline-block'
            htmlEl.style.width = '10px'
            htmlEl.style.height = '10px'
            htmlEl.style.verticalAlign = 'middle'
          }
        })
      })
    }

    // Run color decorators on mount and on content changes
    updateColorDecorations()
    editor.onDidChangeModelContent(() => {
      updateColorDecorations()
    })

    // ── Register snippet completion providers ──────────────────
    const snippetLanguages = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'python']
    for (const lang of snippetLanguages) {
      monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: [],
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position)
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          }
          const langSnippets = getSnippetsForLanguage(lang)
          const suggestions = langSnippets.map((snippet) => ({
            label: snippet.prefix,
            kind: monaco.languages.CompletionItemKind.Snippet,
            documentation: snippet.description,
            insertText: snippet.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: `Snippet: ${snippet.description}`,
            range,
            sortText: `!${snippet.prefix}`,
          }))
          return { suggestions }
        },
      })
    }

    // ── CodeLens provider: show reference counts above functions ──────────────────
    const codeLensLanguages = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact']
    const FUNC_DEF_REGEX = /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|(?:\w+)\s*=>)|class\s+(\w+))/
    for (const lang of codeLensLanguages) {
      monaco.languages.registerCodeLensProvider(lang, {
        provideCodeLenses: (model) => {
          const lenses: { range: any; id: string; command: { id: string; title: string; arguments?: any[] } }[] = []
          const text = model.getValue()
          const lineCount = model.getLineCount()

          // Collect all function/class definitions
          const definitions: { name: string; line: number }[] = []
          for (let lineNum = 1; lineNum <= lineCount; lineNum++) {
            const lineContent = model.getLineContent(lineNum)
            const match = FUNC_DEF_REGEX.exec(lineContent)
            if (match) {
              const name = match[1] || match[2] || match[3]
              if (name) {
                definitions.push({ name, line: lineNum })
              }
            }
          }

          // For each definition, count references in the file
          for (const def of definitions) {
            // Count occurrences of the name as a whole word, minus the definition itself
            const nameRegex = new RegExp(`\\b${def.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
            const matches = text.match(nameRegex)
            const refCount = matches ? matches.length - 1 : 0 // subtract the definition itself

            lenses.push({
              range: new monaco.Range(def.line, 1, def.line, 1),
              id: `codelens-${def.name}-${def.line}`,
              command: {
                id: `orion.showReferences.${def.name}`,
                title: `${refCount} reference${refCount !== 1 ? 's' : ''}`,
                arguments: [def.name, def.line],
              },
            })
          }

          return { lenses, dispose: () => {} }
        },
        resolveCodeLens: (_model, codeLens) => codeLens,
      })
    }

    // Register a command handler for CodeLens clicks (scroll to next reference)
    editor.addAction({
      id: 'orion-codelens-show-references',
      label: 'Show References',
      run: () => { /* no-op: command dispatch handled below */ },
    })

    // ── Definition provider: basic go-to-definition for TS/JS ──────────────────
    const IMPORT_REGEX = /(?:import\s+.*\s+from\s+['"](.+?)['"]|require\s*\(\s*['"](.+?)['"]\s*\))/
    for (const lang of codeLensLanguages) {
      monaco.languages.registerDefinitionProvider(lang, {
        provideDefinition: (model, position) => {
          const lineContent = model.getLineContent(position.lineNumber)
          const word = model.getWordAtPosition(position)
          if (!word) return null

          // Check if cursor is on an import path - resolve the file
          const importMatch = IMPORT_REGEX.exec(lineContent)
          if (importMatch) {
            const importPath = importMatch[1] || importMatch[2]
            if (importPath) {
              // Dispatch an event to open the file (let the app resolve the path)
              window.dispatchEvent(new CustomEvent('orion:open-file-from-import', {
                detail: { importPath, currentFile: model.uri.toString() },
              }))
            }
            // Return current position as fallback so Monaco doesn't error
            return {
              uri: model.uri,
              range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            }
          }

          // Same-file definition: find where the word is defined (function, const, let, var, class)
          const symbolName = word.word
          const defRegex = new RegExp(
            `(?:function\\s+${symbolName}\\b|(?:const|let|var)\\s+${symbolName}\\s*[=:]|class\\s+${symbolName}\\b|interface\\s+${symbolName}\\b|type\\s+${symbolName}\\b)`,
          )
          const lineCount = model.getLineCount()
          for (let lineNum = 1; lineNum <= lineCount; lineNum++) {
            const content = model.getLineContent(lineNum)
            if (defRegex.test(content)) {
              return {
                uri: model.uri,
                range: new monaco.Range(lineNum, 1, lineNum, content.length + 1),
              }
            }
          }

          return null
        },
      })
    }

    // ── Hover provider: show type hints, import paths, and color previews ──────────────────
    const TS_KEYWORDS: Record<string, string> = {
      'string': 'Primitive type: represents text data.',
      'number': 'Primitive type: represents numeric values (integers and floats).',
      'boolean': 'Primitive type: represents true/false values.',
      'void': 'Type: indicates no return value.',
      'null': 'Primitive type: intentional absence of any value.',
      'undefined': 'Primitive type: variable declared but not assigned.',
      'any': 'Type: opt out of type checking. Any value is allowed.',
      'unknown': 'Type: type-safe counterpart of any. Must narrow before use.',
      'never': 'Type: represents values that never occur (e.g. function that always throws).',
      'object': 'Type: represents non-primitive values.',
      'Array': 'Built-in generic type: Array<T> or T[].',
      'Promise': 'Built-in generic type: Promise<T> represents an async result.',
      'Record': 'Utility type: Record<K, V> constructs an object type.',
      'Partial': 'Utility type: Partial<T> makes all properties optional.',
      'Required': 'Utility type: Required<T> makes all properties required.',
      'Readonly': 'Utility type: Readonly<T> makes all properties readonly.',
      'Pick': 'Utility type: Pick<T, K> picks a set of properties.',
      'Omit': 'Utility type: Omit<T, K> omits a set of properties.',
      'Exclude': 'Utility type: Exclude<T, U> excludes types assignable to U.',
      'Extract': 'Utility type: Extract<T, U> extracts types assignable to U.',
      'ReturnType': 'Utility type: ReturnType<T> extracts the return type of a function type.',
      'Parameters': 'Utility type: Parameters<T> extracts parameter types of a function type.',
      'useState': 'React Hook: returns [state, setState]. Manages component state.',
      'useEffect': 'React Hook: runs side effects after render. Cleanup via return function.',
      'useRef': 'React Hook: returns a mutable ref object that persists across renders.',
      'useCallback': 'React Hook: returns a memoized callback function.',
      'useMemo': 'React Hook: returns a memoized value. Recomputes only when dependencies change.',
      'useContext': 'React Hook: accepts a context object and returns the current context value.',
      'useReducer': 'React Hook: alternative to useState for complex state logic.',
      'async': 'Keyword: declares an asynchronous function that returns a Promise.',
      'await': 'Keyword: pauses async function execution until a Promise settles.',
      'interface': 'Keyword: declares a TypeScript interface (structural type).',
      'type': 'Keyword: declares a TypeScript type alias.',
      'enum': 'Keyword: declares a TypeScript enum (set of named constants).',
      'const': 'Keyword: declares a block-scoped constant binding.',
      'let': 'Keyword: declares a block-scoped variable binding.',
      'function': 'Keyword: declares a function.',
      'class': 'Keyword: declares a class.',
      'extends': 'Keyword: used in class/interface inheritance.',
      'implements': 'Keyword: used to implement an interface in a class.',
      'import': 'Keyword: imports bindings from another module.',
      'export': 'Keyword: exports bindings from a module.',
    }

    const HOVER_IMPORT_REGEX = /import\s+(?:\{[^}]*\}|[^{}]+)\s+from\s+['"](.+?)['"]/
    const CSS_HEX_REGEX = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/
    const CSS_RGBA_REGEX = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/
    const CSS_HSLA_REGEX = /hsla?\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*(?:,\s*([\d.]+))?\s*\)/

    for (const lang of codeLensLanguages) {
      monaco.languages.registerHoverProvider(lang, {
        provideHover: (model, position) => {
          const word = model.getWordAtPosition(position)
          const lineContent = model.getLineContent(position.lineNumber)

          // CSS color preview: check if cursor is on a color value
          // Check hex colors
          const hexMatch = CSS_HEX_REGEX.exec(lineContent)
          if (hexMatch) {
            const startCol = hexMatch.index + 1
            const endCol = startCol + hexMatch[0].length
            if (position.column >= startCol && position.column <= endCol) {
              const colorVal = hexMatch[0]
              return {
                range: new monaco.Range(position.lineNumber, startCol, position.lineNumber, endCol),
                contents: [
                  { value: `**Color Preview**` },
                  { value: `\`${colorVal}\`\n\n${'\\'}u2588${'\\'}u2588${'\\'}u2588 \`${colorVal}\`` },
                ],
              }
            }
          }

          // Check rgba colors
          const rgbaMatch = CSS_RGBA_REGEX.exec(lineContent)
          if (rgbaMatch) {
            const startCol = rgbaMatch.index + 1
            const endCol = startCol + rgbaMatch[0].length
            if (position.column >= startCol && position.column <= endCol) {
              const colorVal = rgbaMatch[0]
              const r = rgbaMatch[1], g = rgbaMatch[2], b = rgbaMatch[3], a = rgbaMatch[4] || '1'
              return {
                range: new monaco.Range(position.lineNumber, startCol, position.lineNumber, endCol),
                contents: [
                  { value: `**Color Preview**` },
                  { value: `\`${colorVal}\`\n\nR: ${r} G: ${g} B: ${b} A: ${a}` },
                ],
              }
            }
          }

          // Check hsla colors
          const hslaMatch = CSS_HSLA_REGEX.exec(lineContent)
          if (hslaMatch) {
            const startCol = hslaMatch.index + 1
            const endCol = startCol + hslaMatch[0].length
            if (position.column >= startCol && position.column <= endCol) {
              const colorVal = hslaMatch[0]
              const h = hslaMatch[1], s = hslaMatch[2], l = hslaMatch[3], a = hslaMatch[4] || '1'
              return {
                range: new monaco.Range(position.lineNumber, startCol, position.lineNumber, endCol),
                contents: [
                  { value: `**Color Preview**` },
                  { value: `\`${colorVal}\`\n\nH: ${h} S: ${s}% L: ${l}% A: ${a}` },
                ],
              }
            }
          }

          if (!word) return null

          // Import path hover: show where a symbol is imported from
          const importMatch = HOVER_IMPORT_REGEX.exec(lineContent)
          if (importMatch) {
            const importPath = importMatch[1]
            // Check if cursor is on the import specifier names
            const braceStart = lineContent.indexOf('{')
            const braceEnd = lineContent.indexOf('}')
            if (braceStart !== -1 && braceEnd !== -1 && position.column > braceStart && position.column <= braceEnd + 1) {
              return {
                range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                contents: [
                  { value: `**\`${word.word}\`**` },
                  { value: `Imported from \`${importPath}\`` },
                ],
              }
            }
            // Default import
            const defaultImportMatch = lineContent.match(/import\s+(\w+)\s+from/)
            if (defaultImportMatch && defaultImportMatch[1] === word.word) {
              return {
                range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                contents: [
                  { value: `**\`${word.word}\`** (default import)` },
                  { value: `Imported from \`${importPath}\`` },
                ],
              }
            }
          }

          // TypeScript/JS keyword hints
          if (TS_KEYWORDS[word.word]) {
            return {
              range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
              contents: [
                { value: `**\`${word.word}\`**` },
                { value: TS_KEYWORDS[word.word] },
              ],
            }
          }

          // Check if the hovered word is imported somewhere in the file
          const fullText = model.getValue()
          const importLineRegex = new RegExp(
            `import\\s+(?:\\{[^}]*\\b${word.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^}]*\\}|${word.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s+from\\s+['"](.+?)['"]`,
          )
          const fileImportMatch = importLineRegex.exec(fullText)
          if (fileImportMatch) {
            return {
              range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
              contents: [
                { value: `**\`${word.word}\`**` },
                { value: `Imported from \`${fileImportMatch[1]}\`` },
              ],
            }
          }

          return null
        },
      })
    }
  }

  const handleInlineEditSubmit = async (instruction: string) => {
    if (!activeFile || !editorRef.current) return
    setInlineProcessing(true)

    try {
      const selection = editorRef.current.getSelection()
      const model = editorRef.current.getModel()
      if (!selection || !model) return

      const selectedCode = model.getValueInRange(selection) || ''
      const fullContext = model.getValue()

      // Store the selection for later use by the diff Accept handler
      diffSelectionRef.current = selection

      // Position the diff overlay near the selection
      const vPos = editorRef.current.getScrolledVisiblePosition(selection.getStartPosition())
      const domNode = editorRef.current.getDomNode()
      if (vPos && domNode) {
        const rect = domNode.getBoundingClientRect()
        setDiffPos({
          top: vPos.top + rect.top - 10,
          left: Math.max(vPos.left + rect.left, rect.left + 40),
        })
      } else {
        setDiffPos({ top: 100, left: 100 })
      }

      // Send to AI for inline editing
      const message = `You are editing code inline. The user selected this code:\n\`\`\`\n${selectedCode}\n\`\`\`\n\nFrom this file:\n\`\`\`${activeFile.language}\n${fullContext.substring(0, 2000)}\n\`\`\`\n\nInstruction: ${instruction}\n\nRespond with ONLY the replacement code, no explanation, no markdown fences. Just the raw code that should replace the selection.`

      window.api?.omoSend({
        type: 'chat',
        payload: { message, mode: 'chat', model: 'inline-edit' },
      })

      // Listen for the response -- show diff preview instead of immediately applying
      const handler = (event: any) => {
        if (event?.detail?.type === 'inline-edit-response') {
          const newCode = event.detail.content
          if (newCode && selection) {
            // Store original and suggested code, then show diff preview
            setDiffOriginalCode(selectedCode)
            setDiffSuggestedCode(newCode)
            setDiffVisible(true)
          }
          setInlineProcessing(false)
          setInlineEditVisible(false)
          window.removeEventListener('orion:inline-edit-response', handler)
        }
      }
      window.addEventListener('orion:inline-edit-response', handler)

      // Fallback timeout
      setTimeout(() => {
        if (inlineProcessing) {
          setInlineProcessing(false)
          setInlineEditVisible(false)
          addToast({ type: 'info', message: 'AI edit timed out - try from chat instead' })
          window.removeEventListener('orion:inline-edit-response', handler)
        }
      }, 30000)
    } catch (err) {
      setInlineProcessing(false)
      addToast({ type: 'error', message: 'Failed to process inline edit' })
    }
  }

  // Accept diff: apply the AI-suggested code to the editor
  const handleDiffAccept = useCallback((newCode: string) => {
    const sel = diffSelectionRef.current
    if (sel && editorRef.current) {
      editorRef.current.executeEdits('orion-inline-edit', [{
        range: sel,
        text: newCode,
      }])
      addToast({ type: 'success', message: 'AI suggestion applied' })
    }
    setDiffVisible(false)
    setDiffOriginalCode('')
    setDiffSuggestedCode('')
    diffSelectionRef.current = null
  }, [addToast])

  // Reject diff: dismiss without changes
  const handleDiffReject = useCallback(() => {
    setDiffVisible(false)
    setDiffOriginalCode('')
    setDiffSuggestedCode('')
    diffSelectionRef.current = null
    addToast({ type: 'info', message: 'AI suggestion dismissed' })
  }, [addToast])

  // Listen for AI context-action responses (refactor / add-comments / fix-issues)
  // These come from the AI backend after a right-click context menu action
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (!detail) return
      const { action, suggestedCode, originalText } = detail as {
        action: string
        suggestedCode: string
        originalText: string
      }
      if (!suggestedCode) return

      // For refactor, add-comments, fix-issues: show inline diff
      if (action === 'refactor' || action === 'add-comments' || action === 'fix-issues') {
        setDiffOriginalCode(originalText)
        setDiffSuggestedCode(suggestedCode)
        setDiffVisible(true)
      }
    }
    window.addEventListener('orion:ai-context-response', handler)
    return () => window.removeEventListener('orion:ai-context-response', handler)
  }, [])

  // ── Git gutter decorations ──────────────────
  // Show colored indicators in the editor gutter for modified/added/deleted lines
  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco || !activeFilePath || !rootPath) return

    let cancelled = false

    const fetchAndApplyGitGutter = async () => {
      try {
        const hunks: DiffHunk[] = await window.api.gitFileDiff(rootPath, activeFilePath)
        if (cancelled) return

        const decorations: MonacoEditor.IModelDeltaDecoration[] = []
        for (const hunk of hunks) {
          if (hunk.type === 'added') {
            // Green bar in gutter for added lines
            for (let i = 0; i < hunk.count; i++) {
              decorations.push({
                range: new monaco.Range(hunk.startLine + i, 1, hunk.startLine + i, 1),
                options: {
                  isWholeLine: true,
                  linesDecorationsClassName: 'orion-git-gutter-added',
                  overviewRuler: { color: '#2ea04370', position: monaco.editor.OverviewRulerLane.Left },
                  minimap: { color: '#2ea04350', position: monaco.editor.MinimapPosition.Gutter },
                },
              })
            }
          } else if (hunk.type === 'modified') {
            // Blue bar in gutter for modified lines
            for (let i = 0; i < hunk.count; i++) {
              decorations.push({
                range: new monaco.Range(hunk.startLine + i, 1, hunk.startLine + i, 1),
                options: {
                  isWholeLine: true,
                  linesDecorationsClassName: 'orion-git-gutter-modified',
                  overviewRuler: { color: '#1f6feb70', position: monaco.editor.OverviewRulerLane.Left },
                  minimap: { color: '#1f6feb50', position: monaco.editor.MinimapPosition.Gutter },
                },
              })
            }
          } else if (hunk.type === 'deleted') {
            // Red triangle indicator at the deleted line position
            decorations.push({
              range: new monaco.Range(hunk.startLine, 1, hunk.startLine, 1),
              options: {
                isWholeLine: false,
                linesDecorationsClassName: 'orion-git-gutter-deleted',
                overviewRuler: { color: '#f8514970', position: monaco.editor.OverviewRulerLane.Left },
                minimap: { color: '#f8514950', position: monaco.editor.MinimapPosition.Gutter },
              },
            })
          }
        }

        gitGutterDecorationsRef.current = editor.deltaDecorations(
          gitGutterDecorationsRef.current,
          decorations
        )
      } catch {
        // Silently ignore git errors (e.g., file not tracked)
      }
    }

    fetchAndApplyGitGutter()

    // Re-fetch git gutter on content changes (debounced)
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const disposable = editor.onDidChangeModelContent(() => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(fetchAndApplyGitGutter, 1500)
    })

    return () => {
      cancelled = true
      disposable.dispose()
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [activeFilePath, rootPath])

  // Ctrl+S save handler
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (activeFile) {
          setSaving(true)
          await window.api.writeFile(activeFile.path, activeFile.content)
          addToast({ type: 'success', message: `Saved ${activeFile.name}`, duration: 1500 })
          setTimeout(() => setSaving(false), 800)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeFile])

  // Handle split editor
  const handleSplitToggle = useCallback(() => {
    if (splitMode === 'single' && activeFile) {
      setSplitMode('split')
      // Use the second open file, or the same file
      const other = openFiles.find((f) => f.path !== activeFilePath)
      setSplitFilePath(other?.path || activeFilePath || null)
    } else {
      setSplitMode('single')
      setSplitFilePath(null)
    }
  }, [splitMode, activeFile, openFiles, activeFilePath])

  // Listen for split toggle events
  useEffect(() => {
    const handler = () => handleSplitToggle()
    window.addEventListener('orion:split-editor', handler)
    return () => window.removeEventListener('orion:split-editor', handler)
  }, [handleSplitToggle])

  // Command palette event handlers
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'orion:toggle-minimap': () => {
        const current = minimapRef.current
        const next = !current
        minimapRef.current = next
        setEditorConfig(prev => {
          editorRef.current?.updateOptions({ minimap: { enabled: next } })
          return { ...prev, minimap: next }
        })
      },
      'orion:toggle-wordwrap': () => {
        setEditorConfig(prev => {
          const next = { ...prev, wordWrap: !prev.wordWrap }
          editorRef.current?.updateOptions({ wordWrap: next.wordWrap ? 'on' : 'off' })
          return next
        })
      },
      'orion:font-increase': () => {
        setEditorConfig(prev => {
          const next = { ...prev, fontSize: prev.fontSize + 1 }
          editorRef.current?.updateOptions({ fontSize: next.fontSize })
          return next
        })
      },
      'orion:font-decrease': () => {
        setEditorConfig(prev => {
          const next = { ...prev, fontSize: Math.max(10, prev.fontSize - 1) }
          editorRef.current?.updateOptions({ fontSize: next.fontSize })
          return next
        })
      },
      'orion:font-reset': () => {
        setEditorConfig(prev => {
          const next = { ...prev, fontSize: 13 }
          editorRef.current?.updateOptions({ fontSize: 13 })
          return next
        })
      },
      'orion:format-document': () => {
        editorRef.current?.getAction('editor.action.formatDocument')?.run()
      },
      'orion:editor-find': () => {
        editorRef.current?.getAction('actions.find')?.run()
      },
      'orion:editor-replace': () => {
        editorRef.current?.getAction('editor.action.startFindReplaceAction')?.run()
      },
      'orion:close-tab': () => {
        if (activeFilePath) {
          closeFile(activeFilePath)
        }
      },
      'orion:close-all-tabs': () => {
        closeAllFiles()
      },
      'orion:save-file': () => {
        if (activeFile) {
          setSaving(true)
          window.api.writeFile(activeFile.path, activeFile.content).then(() => {
            markSaved(activeFile.path)
            addToast({ type: 'success', message: `Saved ${activeFile.name}`, duration: 1500 })
            setTimeout(() => setSaving(false), 800)
          })
        }
      },
      // Multi-cursor & selection actions (from Command Palette)
      'orion:add-selection-next-match': () => {
        editorRef.current?.getAction('editor.action.addSelectionToNextFindMatch')?.run()
      },
      'orion:select-all-occurrences': () => {
        editorRef.current?.getAction('editor.action.selectHighlights')?.run()
      },
      'orion:add-cursor-above': () => {
        editorRef.current?.getAction('editor.action.insertCursorAbove')?.run()
      },
      'orion:add-cursor-below': () => {
        editorRef.current?.getAction('editor.action.insertCursorBelow')?.run()
      },
      // Transform actions
      'orion:transform-uppercase': () => {
        editorRef.current?.getAction('editor.action.transformToUppercase')?.run()
      },
      'orion:transform-lowercase': () => {
        editorRef.current?.getAction('editor.action.transformToLowercase')?.run()
      },
      // Sort lines
      'orion:sort-lines-asc': () => {
        editorRef.current?.getAction('editor.action.sortLinesAscending')?.run()
      },
      'orion:sort-lines-desc': () => {
        editorRef.current?.getAction('editor.action.sortLinesDescending')?.run()
      },
      // Join lines
      'orion:join-lines': () => {
        editorRef.current?.getAction('editor.action.joinLines')?.run()
      },
      // Comment actions
      'orion:toggle-line-comment': () => {
        editorRef.current?.getAction('editor.action.commentLine')?.run()
      },
      'orion:toggle-block-comment': () => {
        editorRef.current?.getAction('editor.action.blockComment')?.run()
      },
      // Folding actions
      'orion:fold-all': () => {
        editorRef.current?.getAction('editor.foldAll')?.run()
      },
      'orion:unfold-all': () => {
        editorRef.current?.getAction('editor.unfoldAll')?.run()
      },
    }

    // Go-to-line handler (used by Outline panel)
    const goToLineHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.line && editorRef.current) {
        const lineNumber = detail.line as number
        editorRef.current.revealLineInCenter(lineNumber)
        editorRef.current.setPosition({ lineNumber, column: 1 })
        editorRef.current.focus()
      }
    }

    // Set language handler (from StatusBar language selector)
    const setLanguageHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.languageId && editorRef.current && monacoRef.current) {
        const model = editorRef.current.getModel()
        if (model) {
          monacoRef.current.editor.setModelLanguage(model, detail.languageId)
        }
      }
    }

    Object.entries(handlers).forEach(([event, handler]) => {
      window.addEventListener(event, handler)
    })
    window.addEventListener('orion:go-to-line', goToLineHandler)
    window.addEventListener('orion:set-language', setLanguageHandler)
    return () => {
      Object.entries(handlers).forEach(([event, handler]) => {
        window.removeEventListener(event, handler)
      })
      window.removeEventListener('orion:go-to-line', goToLineHandler)
      window.removeEventListener('orion:set-language', setLanguageHandler)
    }
  }, [activeFilePath, activeFile, closeFile, closeAllFiles, markSaved, addToast])

  const editorOptions: MonacoEditor.IStandaloneEditorConstructionOptions = {
    fontSize: editorConfig.fontSize,
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
    fontLigatures: true,
    minimap: {
      enabled: editorConfig.minimap,
      scale: 2,
      showSlider: 'mouseover',
      renderCharacters: false,
    },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    cursorWidth: 2,
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
    padding: { top: 16, bottom: 16 },
    lineNumbers: 'on',
    renderLineHighlight: 'line',
    lineHeight: 20,
    letterSpacing: 0.3,
    guides: {
      bracketPairs: true,
      bracketPairsHorizontal: true,
      indentation: true,
      highlightActiveBracketPair: true,
      highlightActiveIndentation: true,
    },
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
      useShadows: false,
      verticalSliderSize: 8,
      horizontalSliderSize: 8,
    },
    stickyScroll: { enabled: true },
    wordWrap: editorConfig.wordWrap ? 'on' : 'off',
    links: true,
    colorDecorators: true,
    matchBrackets: 'always',
    occurrencesHighlight: 'singleFile',
    folding: true,
    foldingHighlight: true,
    showFoldingControls: 'mouseover',
    suggest: {
      showIcons: true,
      showStatusBar: true,
      preview: true,
    },
    contextmenu: true,
  }

  return (
    <div
      className="h-full flex flex-col"
      style={{ background: 'var(--bg-primary)', position: 'relative' }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drop overlay for OS file drag */}
      {isDragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-content">
            <Upload size={32} />
            <span>Drop file to open</span>
          </div>
        </div>
      )}

      <TabBar />

      {/* Separator between tab bar and breadcrumbs */}
      {activeFile && (
        <div style={{ height: 1, background: 'var(--border)', flexShrink: 0 }} />
      )}

      {/* Breadcrumbs */}
      {activeFile && (
        <div className="shrink-0 flex items-center" style={{ borderBottom: '1px solid var(--border)' }}>
          <Breadcrumbs path={activeFile.path} saving={saving} content={activeFile.content} language={activeFile.language} />
          {/* Split editor toggle */}
          <button
            onClick={handleSplitToggle}
            title="Split Editor"
            style={{
              padding: '0 8px',
              height: 26,
              color: splitMode === 'split' ? 'var(--accent)' : 'var(--text-muted)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { if (splitMode !== 'split') e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { if (splitMode !== 'split') e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <Columns size={13} />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden" style={{ display: 'flex' }}>
        {activeFile ? (
          <>
            {/* Primary editor or image preview */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              {isImageFile(activeFile.path) ? (
                <ImagePreview filePath={activeFile.path} />
              ) : (
                <>
                  <Editor
                    theme={currentMonacoTheme}
                    language={activeFile.language}
                    value={activeFile.content}
                    onChange={handleChange}
                    onMount={handleEditorMount}
                    loading={<EditorLoading />}
                    options={editorOptions}
                  />
                  {/* Inline Edit Overlay */}
                  {inlineEditVisible && (
                    <InlineEdit
                      visible={inlineEditVisible}
                      onClose={() => setInlineEditVisible(false)}
                      onSubmit={handleInlineEditSubmit}
                      isProcessing={inlineProcessing}
                      selectedText={inlineEditText}
                      position={inlineEditPos}
                    />
                  )}
                  {/* Inline Diff Preview Overlay */}
                  {diffVisible && (
                    <InlineDiff
                      visible={diffVisible}
                      originalCode={diffOriginalCode}
                      suggestedCode={diffSuggestedCode}
                      language={activeFile.language}
                      onAccept={handleDiffAccept}
                      onReject={handleDiffReject}
                      position={diffPos}
                    />
                  )}
                </>
              )}
            </div>

            {/* Split editor */}
            {splitMode === 'split' && splitFile && (
              <>
                <div style={{ width: 1, background: 'var(--border)', flexShrink: 0 }} />
                <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                  {/* Split file tab */}
                  <div style={{
                    height: 26,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 12px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-tertiary)',
                    gap: 6,
                  }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {splitFile.name}
                    </span>
                    {/* Switch split file dropdown */}
                    <select
                      value={splitFilePath || ''}
                      onChange={(e) => setSplitFilePath(e.target.value)}
                      style={{
                        marginLeft: 'auto',
                        fontSize: 10,
                        color: 'var(--text-muted)',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                        borderRadius: 3,
                        padding: '1px 4px',
                        outline: 'none',
                      }}
                    >
                      {openFiles.map((f) => (
                        <option key={f.path} value={f.path}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                  <Editor
                    theme={currentMonacoTheme}
                    language={splitFile.language}
                    value={splitFile.content}
                    onChange={(val) => {
                      if (splitFilePath && val !== undefined) {
                        updateFileContent(splitFilePath, val)
                      }
                    }}
                    options={{
                      ...editorOptions,
                      minimap: { enabled: false },
                    }}
                  />
                </div>
              </>
            )}
          </>
        ) : (
          <WelcomeScreen />
        )}
      </div>
    </div>
  )
}

function Breadcrumbs({ path, saving }: { path: string; saving: boolean }) {
  const normalizedPath = path.replace(/\\/g, '/')
  const segments = normalizedPath.split('/').filter(Boolean)
  const fileName = segments.pop() || ''
  const dirSegments = segments.slice(-3)
  // How many segments were truncated (for building the full directory path on click)
  const truncatedCount = Math.max(0, segments.length - 3)

  const handleDirClick = (segmentIndex: number) => {
    // Build the full directory path up to the clicked segment.
    // segmentIndex is relative to dirSegments; map it back to the full segments array.
    const fullIndex = truncatedCount + segmentIndex
    const dirPath = segments.slice(0, fullIndex + 1).join('/')
    // Prefix with / on Unix-style paths (the original path starts with /)
    const prefix = normalizedPath.startsWith('/') ? '/' : ''
    window.dispatchEvent(
      new CustomEvent('orion:show-explorer', { detail: { directory: prefix + dirPath } })
    )
  }

  return (
    <div
      className="flex-1 flex items-center overflow-x-auto"
      style={{
        height: 24,
        background: 'var(--bg-primary)',
        fontSize: 12,
        color: 'var(--text-muted)',
        padding: '0 12px',
        gap: 2,
      }}
    >
      {segments.length > 3 && (
        <>
          <span style={{ opacity: 0.5, flexShrink: 0 }}>...</span>
          <ChevronRight size={10} style={{ opacity: 0.4, flexShrink: 0, margin: '0 1px' }} />
        </>
      )}
      {dirSegments.map((seg, i) => (
        <span key={i} className="flex items-center" style={{ flexShrink: 0, gap: 2 }}>
          <span
            role="button"
            tabIndex={0}
            onClick={() => handleDirClick(i)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDirClick(i) } }}
            style={{
              color: 'var(--text-muted)',
              padding: '1px 3px',
              borderRadius: 3,
              cursor: 'pointer',
              textDecoration: 'none',
              transition: 'color 0.15s, text-decoration 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--accent)'
              e.currentTarget.style.textDecoration = 'underline'
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)'
              e.currentTarget.style.textDecoration = 'none'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {seg}
          </span>
          <ChevronRight size={10} style={{ opacity: 0.4, flexShrink: 0 }} />
        </span>
      ))}
      {/* File name segment - not clickable */}
      <span style={{ color: 'var(--text-primary)', fontWeight: 500, flexShrink: 0 }}>
        {fileName}
      </span>

      {saving && (
        <span
          className="ml-auto flex items-center gap-1"
          style={{ fontSize: 10, color: 'var(--accent-green)', flexShrink: 0 }}
        >
          <Loader2 size={10} className="anim-spin" />
          Saved
        </span>
      )}
    </div>
  )
}

function ImagePreview({ filePath }: { filePath: string }) {
  const [zoom, setZoom] = useState(1)
  const [fitMode, setFitMode] = useState<'fit' | 'actual' | 'custom'>('fit')
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const [fileSize, setFileSize] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const src = filePathToFileUrl(filePath)
  const ext = filePath.replace(/\\/g, '/').split('/').pop()?.split('.').pop()?.toLowerCase() || ''
  const fileName = filePath.replace(/\\/g, '/').split('/').pop() || ''

  // Estimate file size from content length
  useEffect(() => {
    setLoadError(false)
    setDimensions(null)
    setFileSize(null)
    setZoom(1)
    setFitMode('fit')
  }, [filePath])

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setDimensions({ width: img.naturalWidth, height: img.naturalHeight })

    // Try to estimate file size via fetch on the file URL
    fetch(src)
      .then((res) => res.blob())
      .then((blob) => setFileSize(formatFileSize(blob.size)))
      .catch(() => setFileSize(null))
  }

  const handleZoomIn = () => {
    setFitMode('custom')
    setZoom((z) => Math.min(z * 1.25, 10))
  }

  const handleZoomOut = () => {
    setFitMode('custom')
    setZoom((z) => Math.max(z / 1.25, 0.1))
  }

  const handleFit = () => {
    setFitMode('fit')
    setZoom(1)
  }

  const handleActualSize = () => {
    setFitMode('actual')
    setZoom(1)
  }

  // Compute image style based on fit mode
  const getImageStyle = (): React.CSSProperties => {
    if (fitMode === 'fit') {
      return {
        maxWidth: '100%',
        maxHeight: '100%',
        objectFit: 'contain' as const,
      }
    }
    if (fitMode === 'actual') {
      return {
        width: dimensions?.width ?? 'auto',
        height: dimensions?.height ?? 'auto',
      }
    }
    // custom zoom
    return {
      width: dimensions ? dimensions.width * zoom : 'auto',
      height: dimensions ? dimensions.height * zoom : 'auto',
    }
  }

  // Checkered transparency background pattern
  const checkeredBg = `
    linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
    linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
    linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)
  `.trim()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary)',
      }}
    >
      {/* Image viewport */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundImage: checkeredBg,
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
          backgroundColor: '#1e1e1e',
          padding: 24,
        }}
      >
        {loadError ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            <ImageIcon size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
            <p style={{ fontSize: 13 }}>Failed to load image</p>
            <p style={{ fontSize: 11, marginTop: 4, opacity: 0.6 }}>{fileName}</p>
          </div>
        ) : (
          <img
            ref={imgRef}
            src={src}
            alt={fileName}
            onLoad={handleImageLoad}
            onError={() => setLoadError(true)}
            draggable={false}
            style={{
              ...getImageStyle(),
              imageRendering: zoom > 2 ? 'pixelated' : 'auto',
              transition: 'width 0.15s ease, height 0.15s ease',
            }}
          />
        )}
      </div>

      {/* Info bar and controls */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          fontSize: 11,
          color: 'var(--text-muted)',
          gap: 12,
        }}
      >
        {/* Left: file info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
            {fileName}
          </span>
          {dimensions && (
            <span>{dimensions.width} x {dimensions.height}</span>
          )}
          {fileSize && (
            <span>{fileSize}</span>
          )}
          <span style={{ textTransform: 'uppercase', opacity: 0.7 }}>{ext}</span>
        </div>

        {/* Right: zoom controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <ImagePreviewButton
            onClick={handleFit}
            title="Fit to view"
            active={fitMode === 'fit'}
          >
            <Minimize2 size={13} />
          </ImagePreviewButton>
          <ImagePreviewButton
            onClick={handleActualSize}
            title="100% (actual size)"
            active={fitMode === 'actual'}
          >
            <Maximize2 size={13} />
          </ImagePreviewButton>
          <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
          <ImagePreviewButton onClick={handleZoomOut} title="Zoom out">
            <ZoomOut size={13} />
          </ImagePreviewButton>
          <span style={{
            minWidth: 40,
            textAlign: 'center',
            fontSize: 11,
            color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {fitMode === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}
          </span>
          <ImagePreviewButton onClick={handleZoomIn} title="Zoom in">
            <ZoomIn size={13} />
          </ImagePreviewButton>
        </div>
      </div>
    </div>
  )
}

function ImagePreviewButton({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void
  title: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 22,
        border: 'none',
        borderRadius: 3,
        cursor: 'pointer',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
        transition: 'color 0.15s, background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.color = 'var(--text-secondary)'
          e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.color = 'var(--text-muted)'
          e.currentTarget.style.background = 'transparent'
        }
      }}
    >
      {children}
    </button>
  )
}

function EditorLoading() {
  return (
    <div
      className="h-full flex flex-col items-center justify-center gap-3"
      style={{ background: 'var(--bg-primary)' }}
    >
      <Loader2
        size={24}
        className="anim-spin"
        style={{ color: 'var(--accent)', opacity: 0.6 }}
      />
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading editor...</span>
    </div>
  )
}

function WelcomeScreen() {
  const { openFiles, setActiveFile } = useEditorStore()

  const dispatch = (event: string) => {
    window.dispatchEvent(new CustomEvent(event))
  }

  const quickActions = [
    {
      icon: FileText,
      label: 'New File',
      action: () => dispatch('orion:new-file'),
    },
    {
      icon: FolderOpen,
      label: 'Open Folder',
      action: () => window.api?.openFolder(),
    },
    {
      icon: Terminal,
      label: 'Open Terminal',
      action: () => dispatch('orion:toggle-terminal'),
    },
    {
      icon: MessageSquare,
      label: 'AI Chat',
      action: () => dispatch('orion:toggle-chat'),
    },
  ]

  const shortcuts = [
    { keys: ['Ctrl', 'P'], description: 'Quick Open' },
    { keys: ['Ctrl', 'Shift', 'P'], description: 'Command Palette' },
    { keys: ['Ctrl', 'K'], description: 'AI Inline Edit' },
    { keys: ['Ctrl', 'B'], description: 'Toggle Sidebar' },
    { keys: ['Ctrl', '`'], description: 'Toggle Terminal' },
    { keys: ['Ctrl', 'L'], description: 'AI Chat' },
  ]

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
        overflow: 'auto',
        animation: 'fade-in 0.4s ease-out',
      }}
    >
      <div style={{ maxWidth: 500, width: '100%', padding: '40px 32px' }}>

        {/* Logo area */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              background: 'linear-gradient(135deg, var(--accent), var(--accent-purple))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              lineHeight: 1.2,
            }}
          >
            Orion
          </h1>
          <p style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            marginTop: 6,
            letterSpacing: '0.02em',
          }}>
            by Bebut
          </p>
        </div>

        {/* Quick actions grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 32,
        }}>
          {quickActions.map(({ icon: Icon, label, action }) => (
            <button
              key={label}
              onClick={action}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: 12,
                fontFamily: 'var(--font-sans)',
                textAlign: 'left',
                transition: 'transform 0.15s ease, background 0.15s ease, border-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)'
                e.currentTarget.style.borderColor = 'var(--border-bright)'
                e.currentTarget.style.transform = 'translateY(-1px)'
                const iconEl = e.currentTarget.querySelector('.welcome-action-icon') as HTMLElement
                if (iconEl) iconEl.style.color = 'var(--accent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-secondary)'
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.transform = 'translateY(0)'
                const iconEl = e.currentTarget.querySelector('.welcome-action-icon') as HTMLElement
                if (iconEl) iconEl.style.color = 'var(--text-muted)'
              }}
            >
              <Icon
                size={16}
                className="welcome-action-icon"
                style={{
                  color: 'var(--text-muted)',
                  flexShrink: 0,
                  transition: 'color 0.15s ease',
                }}
              />
              <span style={{ fontWeight: 500 }}>{label}</span>
            </button>
          ))}
        </div>

        {/* Keyboard shortcuts */}
        <div style={{ marginBottom: 32 }}>
          <h2 style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 10,
          }}>
            Keyboard Shortcuts
          </h2>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            {shortcuts.map(({ keys, description }, i) => (
              <div
                key={description}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 14px',
                  borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {description}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  {keys.map((key, ki) => (
                    <span key={ki} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <kbd className="kbd">{key}</kbd>
                      {ki < keys.length - 1 && (
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>+</span>
                      )}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent files */}
        {openFiles.length > 0 && (
          <div>
            <h2 style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 10,
            }}>
              Recent Files
            </h2>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              overflow: 'hidden',
            }}>
              {openFiles.map((file, i) => {
                const fileName = file.path.replace(/\\/g, '/').split('/').pop() || file.name
                const dirPath = file.path.replace(/\\/g, '/').split('/').slice(-3, -1).join('/')
                return (
                  <button
                    key={file.path}
                    onClick={() => setActiveFile(file.path)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 14px',
                      background: 'transparent',
                      border: 'none',
                      borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                      cursor: 'pointer',
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      fontFamily: 'var(--font-sans)',
                      textAlign: 'left',
                      width: '100%',
                      transition: 'background 0.1s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-hover)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <FileText size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{fileName}</span>
                    {dirPath && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        {dirPath}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
