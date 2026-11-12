import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { disposeModelsExcept, modelPathFor } from '@/monaco/setup' // bundled Monaco + workers; must run before an Editor mounts
import Editor, { DiffEditor as MonacoDiffEditorComponent, type Monaco } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { useProblemsStore } from '@/store/problems'
import { useThemeStore } from '@/store/theme'
import { useAutoSave, clearRecovery } from '@/hooks/useAutoSave'
import TabBar from '@/components/TabBar'
import WelcomeTab from '@/components/WelcomeTab'
import InlineEdit from '@/components/InlineEdit'
import { useChatStore } from '@/store/chat'
import {
  applyInlineEdit,
  buildInlineEditRequest,
  canApplyInlineEdit,
  createRequestGate,
  onInlineEditCommand,
  registerInlineEditActions,
  requestInlineEdit,
} from '@/utils/inlineEdit'
import GhostTextProvider from '@/components/GhostTextProvider'
import EmmetProvider from '@/components/EmmetProvider'
import MarkdownPreview, { markdownPreviewStyles } from '@/components/MarkdownPreview'
import JsonTreeViewer from '@/components/JsonTreeViewer'
import CsvTableViewer from '@/components/CsvTableViewer'
import {
  Zap, FolderOpen, MessageSquare, Terminal, Command,
  ChevronRight, ChevronDown, FilePlus, Loader2, Keyboard, Clock,
  Search, Settings, GitBranch, Columns, Sparkles,
  FileText, ZoomIn, ZoomOut, Maximize2, Minimize2,
  Image as ImageIcon, Folder, File, Hash, Box, Braces, Type as TypeIcon,
  Upload, Rows2, Link2, Link2Off, X, GitCompare, Eye,
  GripVertical, GripHorizontal, MoreVertical, Table,
} from 'lucide-react'
import { useEditorStore as useBreadcrumbEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { useWorkspaceStore } from '@/store/workspace'
import { useFileHistoryStore } from '@/store/fileHistory'
import type { OpenFile } from '@shared/types'
import { ipcErrorMessage, writeFileChecked } from '@/utils/ipcResult'
import { confirmOverwriteIfChangedOnDisk, needsSaveLocation } from '@/utils/saveGuards'
import TimelinePanel from '@/components/TimelinePanel'
import FileIcon, { FolderIcon } from '@/components/FileIcon'
import { detectColors } from '@/providers/colors'
import { syncProblemsWithMonaco } from '@/providers/diagnostics'
import { registerEditorProviders } from '@/providers/editorProviders'
import { loadEditorConfig, monacoOptionsFor, type EditorConfig } from '@/providers/editorOptions'

// ── Types for git gutter decorations ──────────────────
interface DiffHunk {
  type: 'added' | 'modified' | 'deleted'
  startLine: number
  count: number
}

/** Simple string hash for generating unique class names */
function colorHash(color: string): string {
  let h = 0
  for (let i = 0; i < color.length; i++) {
    h = ((h << 5) - h + color.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

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
  const openFiles = useEditorStore((s) => s.openFiles)
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  const updateFileContent = useEditorStore((s) => s.updateFileContent)
  const markSaved = useEditorStore((s) => s.markSaved)
  const closeFile = useEditorStore((s) => s.closeFile)
  const closeAllFiles = useEditorStore((s) => s.closeAllFiles)
  const reloadFileContent = useEditorStore((s) => s.reloadFileContent)
  const dismissExternalChange = useEditorStore((s) => s.dismissExternalChange)
  const renamePath = useEditorStore((s) => s.renamePath)
  const addToast = useToastStore((s) => s.addToast)
  const activeFile = useMemo(() => openFiles.find((f) => f.path === activeFilePath), [openFiles, activeFilePath])
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const activeFileRef = useRef(activeFile)
  activeFileRef.current = activeFile
  const openFilesRef = useRef(openFiles)
  openFilesRef.current = openFiles
  const activeFilePathRef = useRef(activeFilePath)
  activeFilePathRef.current = activeFilePath
  const { scheduleAutoSave } = useAutoSave()

  // Editor config state – initialised from saved settings, if any
  const [editorConfig, setEditorConfig] = useState<EditorConfig>(loadEditorConfig)
  // Save handlers live in long-lived listeners; they read the current settings here.
  const editorConfigRef = useRef(editorConfig)
  editorConfigRef.current = editorConfig
  const minimapRef = useRef(editorConfig.minimap)

  // Inline edit (Ctrl+I) state
  const [inlineEditVisible, setInlineEditVisible] = useState(false)
  const [inlineEditPos, setInlineEditPos] = useState({ top: 60, left: 100 })
  const [inlineEditText, setInlineEditText] = useState('')
  const [inlineProcessing, setInlineProcessing] = useState(false)
  const [inlineEditSelRange, setInlineEditSelRange] = useState<{ startLine: number; endLine: number } | null>(null)
  const [inlineEditAiResponse, setInlineEditAiResponse] = useState<string | null>(null)
  const inlineEditSelectionRef = useRef<import('monaco-editor').Selection | null>(null)
  // The model the widget was opened on: the editor swaps models on tab switches.
  const inlineEditModelRef = useRef<MonacoEditor.ITextModel | null>(null)
  const [inlineEditGate] = useState(createRequestGate)

  // Decoration refs for active line highlight, git gutter, and color decorators
  const activeLineDecorationsRef = useRef<string[]>([])
  const gitGutterDecorationsRef = useRef<string[]>([])
  const colorDecorationsRef = useRef<string[]>([])
  const colorStyleElRef = useRef<HTMLStyleElement | null>(null)
  const colorDecoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorLensDecorationsRef = useRef<string[]>([])
  const rootPath = useFileStore((s) => s.rootPath)

  // Markdown preview state
  const [markdownPreview, setMarkdownPreview] = useState(false)

  // JSON tree view / CSV table view state
  const [jsonTreeView, setJsonTreeView] = useState(false)
  const [csvTableView, setCsvTableView] = useState(false)

  // Timeline panel state
  const [timelineVisible, setTimelineVisible] = useState(false)
  const [timelineHeight, setTimelineHeight] = useState(200)
  const isDraggingTimeline = useRef(false)
  const timelineContainerRef = useRef<HTMLDivElement | null>(null)

  // Split editor state: supports horizontal (side by side) and vertical (top/bottom)
  const [splitMode, setSplitMode] = useState<'single' | 'horizontal' | 'vertical'>('single')
  const [splitFilePath, setSplitFilePath] = useState<string | null>(null)
  const splitFile = splitFilePath ? openFiles.find((f) => f.path === splitFilePath) : null

  // Release the Monaco models of files that are no longer open.
  const openFilePathsKey = openFiles.map((f) => f.path).join('\0')
  useEffect(() => {
    disposeModelsExcept(openFilePathsKey ? openFilePathsKey.split('\0') : [])
  }, [openFilePathsKey])
  // Editor group management: track files in each group
  const [group1Files, setGroup1Files] = useState<string[]>([])
  const [group2Files, setGroup2Files] = useState<string[]>([])
  // Active pane tracking (1 = primary, 2 = split)
  const [activePane, setActivePane] = useState<1 | 2>(1)
  // Split ratio (0-1, proportion of first pane)
  const [splitRatio, setSplitRatio] = useState(0.5)
  const isDraggingSplit = useRef(false)
  const splitContainerRef = useRef<HTMLDivElement | null>(null)
  // Divider context menu for toggling split direction
  const [dividerContextMenu, setDividerContextMenu] = useState<{ x: number; y: number } | null>(null)
  // Sync scroll between split editors
  const [syncScrollEnabled, setSyncScrollEnabled] = useState(false)
  const splitEditorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const isSyncingScroll = useRef(false)
  // Go to Line (Ctrl+G) state
  const [goToLineOpen, setGoToLineOpen] = useState(false)
  const [goToLineValue, setGoToLineValue] = useState('')

  // Diff editor state
  const [diffEditorMode, setDiffEditorMode] = useState(false)
  const [diffOriginalPath, setDiffOriginalPath] = useState<string | null>(null)
  const [diffModifiedPath, setDiffModifiedPath] = useState<string | null>(null)
  const [diffFilePickerOpen, setDiffFilePickerOpen] = useState(false)
  // Compare on the "changed on disk" bar: the disk version is the original
  // side, the buffer the modified side.
  const [diffDiskContent, setDiffDiskContent] = useState<string | null>(null)

  // Pane 2 only receives saves while it is on screen.
  const activePaneRef = useRef(activePane)
  activePaneRef.current = activePane
  const visibleSplitFileRef = useRef(splitFile)
  visibleSplitFileRef.current = splitMode !== 'single' && !diffEditorMode ? splitFile : null

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

    const { setRootPath, setFileTree } = useFileStore.getState()

    // Check if a single folder was dropped
    if (files.length === 1) {
      const droppedFile = files[0]
      const filePath = window.api.pathForDroppedFile(droppedFile)
      if (filePath) {
        try {
          // Rejects unless the dropped item is a folder.
          const tree = await window.api.openWorkspace(filePath)
          setRootPath(filePath)
          await useWorkspaceStore.getState().loadWorkspaceSettings(filePath)
          setFileTree(tree)
          window.api.watchStart(filePath)
          addToast({ type: 'success', message: `Opened folder: ${droppedFile.name}`, duration: 2000 })
          return
        } catch {
          // Not a directory, fall through to open as file
        }
      }
    }

    let openedCount = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const filePath = window.api.pathForDroppedFile(file)
      if (!filePath) continue

      // Skip folders in multi-file drops
      try {
        const tree = await window.api.readDir(filePath)
        if (tree && Array.isArray(tree)) continue
      } catch {
        // Not a directory, open as file
      }

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

  const handleChange = (value: string | undefined) => {
    if (activeFilePath && value !== undefined) {
      updateFileContent(activeFilePath, value)

      // Auto-save (mode & delay handled by the hook)
      scheduleAutoSave(activeFilePath, value)
    }
  }

  // Both editors pass keepCurrentModel: two panes showing one file share its
  // model, and unmounting either one used to dispose it under the other
  // (closing the split blanked pane 1). A kept model can miss buffer changes
  // made while no editor showed it (Reload during a diff, JSON tree edits),
  // so a newly mounted editor first catches its model up with the buffer.
  const syncModelWithBuffer = (editor: MonacoEditor.IStandaloneCodeEditor) => {
    const model = editor.getModel()
    if (!model) return
    const file = openFilesRef.current.find((f) => modelPathFor(f.path) === model.uri.toString())
    if (!file || model.getValue() === file.content) return
    editor.executeEdits('', [{ range: model.getFullModelRange(), text: file.content, forceMoveMarkers: true }])
    editor.pushUndoStop()
  }

  const handleEditorMount = (editor: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    setLensEditor(editor)

    // Register custom Monaco themes from the theme registry
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).monaco = monaco
    for (const t of useThemeStore.getState().themes) {
      if (t.monacoThemeData) {
        try { monaco.editor.defineTheme(t.monacoTheme, t.monacoThemeData) } catch { /* already defined */ }
      }
    }
    const _ct = useThemeStore.getState().activeTheme()
    if (_ct.monacoThemeData) monaco.editor.setTheme(_ct.monacoTheme)

    // Emit blur event for onFocusChange auto-save mode
    editor.onDidBlurEditorWidget(() => {
      window.dispatchEvent(new Event('orion:editor-blur'))
    })

    // ── TypeScript/JavaScript autocomplete enhancements ──────────────────

    // Configure TypeScript defaults for better IntelliSense
    if (monaco) {
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ESNext,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        allowJs: true,
        checkJs: false,
        jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        isolatedModules: true,
      })

      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
      })

      // Add React type declarations for JSX support
      monaco.languages.typescript.typescriptDefaults.addExtraLib(
        `declare module 'react' {
          export function useState<T>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
          export function useEffect(effect: () => void | (() => void), deps?: any[]): void;
          export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: any[]): T;
          export function useMemo<T>(factory: () => T, deps: any[]): T;
          export function useRef<T>(initial: T): { current: T };
          export function useContext<T>(context: React.Context<T>): T;
          export function useReducer<S, A>(reducer: (state: S, action: A) => S, initialState: S): [S, (action: A) => void];
          export type FC<P = {}> = (props: P) => JSX.Element | null;
          export type ReactNode = string | number | boolean | null | undefined | JSX.Element | ReactNode[];
          export interface CSSProperties { [key: string]: string | number | undefined; }
        }
        declare namespace JSX {
          interface Element {}
          interface IntrinsicElements {
            [elemName: string]: any;
          }
        }`,
        'ts:react.d.ts'
      )
    }

    // Better CSS autocomplete
    if (monaco) {
      monaco.languages.css.cssDefaults?.setOptions?.({
        validate: true,
        lint: {
          compatibleVendorPrefixes: 'warning',
          duplicateProperties: 'warning',
          emptyRules: 'warning',
          importStatement: 'warning',
        },
      })
    }

    // JSON schema validation for common files
    if (monaco) {
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: true,
        schemas: [
          {
            uri: 'https://json.schemastore.org/package.json',
            fileMatch: ['package.json'],
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                version: { type: 'string' },
                scripts: { type: 'object' },
                dependencies: { type: 'object' },
                devDependencies: { type: 'object' },
              },
            },
          },
          {
            uri: 'https://json.schemastore.org/tsconfig.json',
            fileMatch: ['tsconfig.json', 'tsconfig.*.json'],
            schema: {
              type: 'object',
              properties: {
                compilerOptions: { type: 'object' },
                include: { type: 'array' },
                exclude: { type: 'array' },
              },
            },
          },
        ],
      })
    }

    // Open the inline edit widget (Cursor-style) on the editor's selection
    const openInlineEdit = (ed: MonacoEditor.ICodeEditor): boolean => {
      const selection = ed.getSelection()
      const model = ed.getModel()
      if (!selection || !model) return false

      // A reply to an earlier opening must not land on this one.
      inlineEditGate.cancel()
      setInlineProcessing(false)

      const selectedText = model.getValueInRange(selection)
      setInlineEditText(selectedText)
      inlineEditSelectionRef.current = selection
      inlineEditModelRef.current = model

      // Capture selection range for display
      if (selectedText) {
        setInlineEditSelRange({
          startLine: selection.startLineNumber,
          endLine: selection.endLineNumber,
        })
      } else {
        setInlineEditSelRange(null)
      }

      // Reset any previous AI response
      setInlineEditAiResponse(null)

      // Position the inline edit widget relative to the editor container
      const pos = ed.getScrolledVisiblePosition(selection.getStartPosition())
      const domNode = ed.getDomNode()
      if (pos && domNode) {
        const editorWidth = domNode.getBoundingClientRect().width
        // Position widget below the selection line within the editor
        setInlineEditPos({
          top: pos.top + 24,
          left: Math.min(Math.max(pos.left, 40), Math.max(editorWidth - 540, 40)),
        })
      } else {
        setInlineEditPos({ top: 100, left: 40 })
      }

      setInlineEditVisible(true)
      return true
    }

    // Ctrl+I (as in VS Code), and the Refactor / Add Comments / Fix Issues
    // context-menu items, which open the same widget with their instruction
    // already submitted. It was Ctrl+K, which Monaco and the app both use to
    // start chords (Ctrl+K Ctrl+C, Ctrl+K Ctrl+S, ...), so it never fired.
    registerInlineEditActions(editor, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, {
      open: openInlineEdit,
      submit: (instruction) => void handleInlineEditSubmit(instruction),
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
      const position = editor.getPosition()
      const selection = editor.getSelection()
      const model = editor.getModel()
      if (!position || !model) return

      let selectedChars = 0
      let selectedLines = 0
      if (selection && !selection.isEmpty()) {
        selectedChars = model.getValueInRange(selection).length
        selectedLines = selection.endLineNumber - selection.startLineNumber + 1
      }

      window.dispatchEvent(new CustomEvent('orion:cursor-position', {
        detail: {
          line: position.lineNumber,
          column: position.column,
          selectedChars,
          selectedLines,
          totalLines: model.getLineCount(),
        }
      }))
    })

    // Dispatch selection changes to status bar
    editor.onDidChangeCursorSelection((e) => {
      const selection = e.selection
      const model = editor.getModel()
      if (!model) return
      const position = editor.getPosition()

      let selectedChars = 0
      let selectedLines = 0
      if (!selection.isEmpty()) {
        selectedChars = model.getValueInRange(selection).length
        selectedLines = selection.endLineNumber - selection.startLineNumber + 1
      }

      window.dispatchEvent(new CustomEvent('orion:cursor-position', {
        detail: {
          line: position?.lineNumber || selection.startLineNumber,
          column: position?.column || selection.startColumn,
          selectedChars,
          selectedLines,
          totalLines: model.getLineCount(),
        }
      }))
    })

    // ── Dispatch file-level info (indent, EOL, language) to StatusBar ──────────────────
    const dispatchFileInfo = () => {
      const m = editor.getModel()
      if (!m) return
      const opts = m.getOptions()
      const eolVal = m.getEOL() === '\r\n' ? 'CRLF' : 'LF'
      const langId = m.getLanguageId()
      window.dispatchEvent(new CustomEvent('orion:file-info', {
        detail: {
          useSpaces: opts.insertSpaces,
          tabSize: opts.tabSize,
          eol: eolVal,
          languageId: langId,
        }
      }))
    }
    // Dispatch immediately on mount
    dispatchFileInfo()
    // Also dispatch whenever the model's options or language change
    editor.getModel()?.onDidChangeOptions(() => dispatchFileInfo())
    editor.getModel()?.onDidChangeLanguage(() => dispatchFileInfo())

    // ── Color decorators: detect CSS color values and show inline color swatches ──────────────────
    const updateColorDecorations = () => {
      const edModel = editor.getModel()
      if (!edModel) return

      const content = edModel.getValue()
      const matches = detectColors(content)

      // Build dynamic style element with unique CSS classes per color
      const uniqueColors = new Map<string, string>() // color -> className
      for (const cm of matches) {
        if (!uniqueColors.has(cm.color)) {
          uniqueColors.set(cm.color, `orion-cdeco-${colorHash(cm.color)}`)
        }
      }

      // Remove old style element
      if (colorStyleElRef.current) {
        colorStyleElRef.current.remove()
        colorStyleElRef.current = null
      }

      // Create new style element with classes for each unique color
      const styleEl = document.createElement('style')
      styleEl.setAttribute('data-orion-color-decorations', 'true')
      let css = ''
      uniqueColors.forEach((className, color) => {
        css += `.${className}::before {
  content: ' ';
  display: inline-block;
  width: 10px;
  height: 10px;
  background-color: ${color};
  border: 1px solid rgba(128,128,128,0.4);
  border-radius: 2px;
  margin-right: 4px;
  vertical-align: middle;
  font-size: 0;
  line-height: 10px;
}\n`
      })
      styleEl.textContent = css
      document.head.appendChild(styleEl)
      colorStyleElRef.current = styleEl

      // Build decorations using beforeContentClassName
      const decorations: MonacoEditor.IModelDeltaDecoration[] = matches.map((cm) => ({
        range: new monaco.Range(cm.line, cm.startCol, cm.line, cm.startCol),
        options: {
          beforeContentClassName: uniqueColors.get(cm.color)!,
          hoverMessage: { value: `Color: \`${cm.color}\`` },
        },
      }))

      colorDecorationsRef.current = editor.deltaDecorations(
        colorDecorationsRef.current,
        decorations
      )
    }

    // Debounced wrapper for color decorations (500ms)
    const debouncedUpdateColorDecorations = () => {
      if (colorDecoTimerRef.current) clearTimeout(colorDecoTimerRef.current)
      colorDecoTimerRef.current = setTimeout(updateColorDecorations, 500)
    }

    // Run color decorators on mount and on content changes (debounced)
    updateColorDecorations()
    editor.onDidChangeModelContent(() => {
      debouncedUpdateColorDecorations()
    })

    // Providers, CodeLens commands and the Problems feed are global to Monaco,
    // so they are registered once, not on every mount of this editor.
    registerEditorProviders(monaco)
    syncProblemsWithMonaco(monaco)

    // ── Go to Line (Ctrl+G) ──────────────────
    editor.addAction({
      id: 'orion-go-to-line',
      label: 'Go to Line',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG],
      run: () => {
        setGoToLineOpen(true)
        setGoToLineValue('')
      },
    })

    // ── Code folding ──────────────────
    editor.addAction({
      id: 'orion-fold',
      label: 'Fold',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.BracketLeft],
      run: (ed) => ed.getAction('editor.fold')?.run(),
    })
    editor.addAction({
      id: 'orion-unfold',
      label: 'Unfold',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.BracketRight],
      run: (ed) => ed.getAction('editor.unfold')?.run(),
    })
    editor.addAction({
      id: 'orion-fold-all',
      label: 'Fold All',
      // One chord (Ctrl+K Ctrl+0). Listed as two entries it bound Ctrl+K and
      // Ctrl+0 on their own, which took Ctrl+K from Inline Edit.
      keybindings: [monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit0)],
      run: (ed) => ed.getAction('editor.foldAll')?.run(),
    })
    editor.addAction({
      id: 'orion-unfold-all',
      label: 'Unfold All',
      keybindings: [monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyJ)],
      run: (ed) => ed.getAction('editor.unfoldAll')?.run(),
    })

    // ── Toggle line/block comment ──────────────────
    editor.addAction({
      id: 'orion-toggle-comment',
      label: 'Toggle Line Comment',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
      run: (ed) => ed.getAction('editor.action.commentLine')?.run(),
    })
    editor.addAction({
      id: 'orion-toggle-block-comment',
      label: 'Toggle Block Comment',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyA],
      run: (ed) => ed.getAction('editor.action.blockComment')?.run(),
    })

    // ── Delete line (Ctrl+Shift+K) ──────────────────
    editor.addAction({
      id: 'orion-delete-line',
      label: 'Delete Line',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyK],
      run: (ed) => ed.getAction('editor.action.deleteLines')?.run(),
    })

    // ── Move line up/down (Alt+Up/Down) ──────────────────
    editor.addAction({
      id: 'orion-move-line-up',
      label: 'Move Line Up',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.UpArrow],
      run: (ed) => ed.getAction('editor.action.moveLinesUpAction')?.run(),
    })
    editor.addAction({
      id: 'orion-move-line-down',
      label: 'Move Line Down',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.DownArrow],
      run: (ed) => ed.getAction('editor.action.moveLinesDownAction')?.run(),
    })

    // ── Copy line up/down (Shift+Alt+Up/Down) ──────────────────
    editor.addAction({
      id: 'orion-copy-line-up',
      label: 'Copy Line Up',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.UpArrow],
      run: (ed) => ed.getAction('editor.action.copyLinesUpAction')?.run(),
    })
    editor.addAction({
      id: 'orion-copy-line-down',
      label: 'Copy Line Down',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.DownArrow],
      run: (ed) => ed.getAction('editor.action.copyLinesDownAction')?.run(),
    })

    // ── Go to Symbol (Ctrl+Shift+O) ──────────────────
    editor.addAction({
      id: 'orion-go-to-symbol',
      label: 'Go to Symbol in File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO],
      run: (ed) => {
        ed.getAction('editor.action.quickOutline')?.run()
      },
    })

    // ── Go to Definition (F12) ──────────────────
    editor.addAction({
      id: 'orion-go-to-definition',
      label: 'Go to Definition',
      keybindings: [monaco.KeyCode.F12],
      run: (ed) => {
        ed.getAction('editor.action.revealDefinition')?.run()
      },
    })

    // ── Peek Definition (Alt+F12) ──────────────────
    editor.addAction({
      id: 'orion-peek-definition',
      label: 'Peek Definition',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.F12],
      run: (ed) => {
        ed.getAction('editor.action.peekDefinition')?.run()
      },
    })

    // ── Find All References (Shift+F12) ──────────────────
    editor.addAction({
      id: 'orion-find-references',
      label: 'Find All References',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F12],
      run: (ed) => {
        ed.getAction('editor.action.referenceSearch.trigger')?.run()
      },
    })

    // ── Rename Symbol (F2) ──────────────────
    editor.addAction({
      id: 'orion-rename-symbol',
      label: 'Rename Symbol',
      keybindings: [monaco.KeyCode.F2],
      run: (ed) => {
        ed.getAction('editor.action.rename')?.run()
      },
    })

    // ── Toggle Sidebar (Ctrl+B) ──────────────────
    editor.addAction({
      id: 'orion-toggle-sidebar',
      label: 'Toggle Sidebar',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB],
      run: () => {
        window.dispatchEvent(new Event('orion:toggle-sidebar'))
      },
    })

    // ── Toggle Markdown Preview (Ctrl+Shift+V) ──────────────────
    editor.addAction({
      id: 'orion-markdown-preview',
      label: 'Toggle Markdown Preview',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyV],
      run: () => {
        window.dispatchEvent(new Event('orion:toggle-markdown-preview'))
      },
    })

    // ── Go to Next Error/Warning (F8) ──────────────────
    editor.addAction({
      id: 'orion-next-error',
      label: 'Go to Next Error or Warning',
      keybindings: [monaco.KeyCode.F8],
      run: (ed) => {
        const model = ed.getModel()
        if (!model) return
        const markers = monaco.editor.getModelMarkers({ resource: model.uri })
          .sort((a, b) => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn)
        if (markers.length === 0) return

        const pos = ed.getPosition()
        if (!pos) return

        // Find the next marker after current position (wraps around)
        let next = markers.find(m =>
          m.startLineNumber > pos.lineNumber ||
          (m.startLineNumber === pos.lineNumber && m.startColumn > pos.column)
        )
        if (!next) next = markers[0] // wrap to first

        ed.setPosition({ lineNumber: next.startLineNumber, column: next.startColumn })
        ed.revealLineInCenter(next.startLineNumber)

        // Trigger Monaco's built-in marker peek widget
        ed.getAction('editor.action.marker.next')?.run()
      },
    })

    // ── Go to Previous Error/Warning (Shift+F8) ──────────────────
    editor.addAction({
      id: 'orion-prev-error',
      label: 'Go to Previous Error or Warning',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F8],
      run: (ed) => {
        const model = ed.getModel()
        if (!model) return
        const markers = monaco.editor.getModelMarkers({ resource: model.uri })
          .sort((a, b) => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn)
        if (markers.length === 0) return

        const pos = ed.getPosition()
        if (!pos) return

        // Find the previous marker before current position (wraps around)
        let prev = [...markers].reverse().find(m =>
          m.startLineNumber < pos.lineNumber ||
          (m.startLineNumber === pos.lineNumber && m.startColumn < pos.column)
        )
        if (!prev) prev = markers[markers.length - 1] // wrap to last

        ed.setPosition({ lineNumber: prev.startLineNumber, column: prev.startColumn })
        ed.revealLineInCenter(prev.startLineNumber)

        // Trigger Monaco's built-in marker peek widget
        ed.getAction('editor.action.marker.prev')?.run()
      },
    })
  }

  // Uses only refs and store state: the context-menu actions call it from
  // closures created when the editor mounted.
  const handleInlineEditSubmit = async (instruction: string) => {
    const editor = editorRef.current
    const model = inlineEditModelRef.current
    const selection = inlineEditSelectionRef.current
    if (!editor || !model || !selection || editor.getModel() !== model) return

    const requestId = inlineEditGate.start()
    setInlineEditAiResponse(null)
    setInlineProcessing(true)
    const result = await requestInlineEdit(
      buildInlineEditRequest(model, selection, {
        instruction,
        filePath: model.uri.path,
        chatModel: useChatStore.getState().selectedModel,
      }),
    )
    // Closed, reopened or resubmitted while waiting: drop this reply.
    if (!inlineEditGate.isCurrent(requestId)) return
    setInlineProcessing(false)
    if ('error' in result) {
      addToast({ type: 'error', message: `AI edit failed: ${result.error}` })
      return
    }
    setInlineEditAiResponse(result.text)
  }

  // Close inline edit entirely
  const handleInlineEditClose = useCallback(() => {
    inlineEditGate.cancel()
    setInlineEditVisible(false)
    setInlineEditAiResponse(null)
    setInlineEditText('')
    setInlineProcessing(false)
    setInlineEditSelRange(null)
    inlineEditSelectionRef.current = null
    inlineEditModelRef.current = null
  }, [inlineEditGate])

  // The widget edits the file it was opened on. Left open over another tab,
  // its submit was silently ignored and a late reply showed over that file.
  useEffect(() => handleInlineEditClose, [activeFilePath, handleInlineEditClose])

  // Accept inline edit: apply the AI code to the editor
  const handleInlineEditAccept = useCallback((newCode: string) => {
    const editor = editorRef.current
    const sel = inlineEditSelectionRef.current
    if (editor && sel && canApplyInlineEdit(editor.getModel(), inlineEditModelRef.current, sel, inlineEditText)) {
      applyInlineEdit(editor, sel, newCode)
      addToast({ type: 'success', message: 'AI edit applied' })
    } else {
      addToast({ type: 'error', message: 'The code changed after the edit was requested, so it was not applied' })
    }
    handleInlineEditClose()
  }, [addToast, inlineEditText, handleInlineEditClose])

  // Reject inline edit: drop the suggestion (the widget then closes itself)
  const handleInlineEditReject = useCallback(() => {
    setInlineEditAiResponse(null)
  }, [])

  // The command palette's "AI: Inline Edit" runs the Ctrl+K action.
  useEffect(() => onInlineEditCommand(() => {
    const editor = editorRef.current
    if (!editor || !activeFileRef.current) {
      addToast({ type: 'info', message: 'Open a file to edit it with AI' })
      return
    }
    editor.focus()
    void editor.getAction('orion-inline-edit')?.run()
  }), [addToast])

  // ── Git gutter decorations ──────────────────
  // Show colored indicators in the editor gutter for modified/added/deleted lines
  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco || !activeFilePath || !rootPath) return

    let cancelled = false

    const fetchAndApplyGitGutter = async () => {
      try {
        const hunks: DiffHunk[] = await window.api.gitDiffFile(rootPath, activeFilePath)
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

  // ── Error Lens - inline diagnostic decorations ──────────────────
  // The editor it draws in. Monaco mounts <Editor> asynchronously, after this
  // effect has run for the newly shown file, so it reruns on every mount
  // (first file, and after a remount) instead of only on a tab switch.
  const [lensEditor, setLensEditor] = useState<MonacoEditor.IStandaloneCodeEditor | null>(null)
  useEffect(() => {
    const monaco = monacoRef.current
    if (!lensEditor || !monaco || !activeFilePath) return

    const editor = lensEditor

    // The problems store mirrors Monaco's markers (providers/diagnostics), so
    // the squiggles are Monaco's own; this only adds the inline messages.
    const showErrorLens = (state: ReturnType<typeof useProblemsStore.getState>) => {
      const problems = state.problems.filter(p => p.file === activeFilePath)
      const decorations: MonacoEditor.IModelDeltaDecoration[] = problems.map((problem) => {
        const isError = problem.severity === 'error'
        const isWarning = problem.severity === 'warning'

        return {
          range: new monaco.Range(problem.line, 1, problem.line, 1),
          options: {
            after: {
              content: `  ${problem.message}`,
              inlineClassName: isError
                ? 'error-lens-error'
                : isWarning
                  ? 'error-lens-warning'
                  : 'error-lens-info',
            },
            isWholeLine: true,
            className: isError
              ? 'error-lens-line-error'
              : isWarning
                ? 'error-lens-line-warning'
                : 'error-lens-line-info',
            overviewRuler: {
              color: isError ? '#f85149' : isWarning ? '#d29922' : '#3fb950',
              position: monaco.editor.OverviewRulerLane.Right,
            },
            minimap: {
              color: isError ? '#f8514980' : isWarning ? '#d2992280' : '#3fb95080',
              position: monaco.editor.MinimapPosition.Gutter,
            },
          },
        }
      })

      errorLensDecorationsRef.current = editor.deltaDecorations(
        errorLensDecorationsRef.current,
        decorations,
      )
    }
    showErrorLens(useProblemsStore.getState())
    return useProblemsStore.subscribe(showErrorLens)
  }, [activeFilePath, lensEditor])

  // The file a save applies to, and the editor showing it: the pane with
  // keyboard focus, else the pane last clicked. Saves used to always take
  // pane 1, so Ctrl+S typed in pane 2 wrote (and reported) the other file.
  const getSaveTarget = useCallback((): { file: OpenFile; editor: MonacoEditor.IStandaloneCodeEditor | null } | null => {
    const split = visibleSplitFileRef.current
    const splitFocused = splitEditorRef.current?.hasTextFocus() ?? false
    const primaryFocused = editorRef.current?.hasTextFocus() ?? false
    if (split && (splitFocused || (!primaryFocused && activePaneRef.current === 2))) {
      return { file: split, editor: splitEditorRef.current }
    }
    const primary = activeFileRef.current
    return primary ? { file: primary, editor: editorRef.current } : null
  }, [])

  // Write a buffer to its file. A buffer with no file yet (Ctrl+N's
  // untitled-<id>, which fs:write-file rejects), or a Save As, first asks
  // where to write it and then moves the tab to that file. The content is
  // produced only once the save goes ahead, so a cancelled save never
  // reformats the buffer; it gets the language the file is saved as.
  const saveBuffer = useCallback(async (
    file: OpenFile,
    prepareContent: (language: string) => string | Promise<string>,
    saveAs = false,
  ) => {
    let targetPath = file.path
    let language: string | undefined
    if (saveAs || needsSaveLocation(file.path)) {
      let chosen: Awaited<ReturnType<typeof window.api.saveFileDialog>>
      try {
        chosen = await window.api.saveFileDialog(file.name)
      } catch (err) {
        addToast({ type: 'error', message: `Failed to save ${file.name}: ${ipcErrorMessage(err)}` })
        return
      }
      if (!chosen) return
      const chosenPath = chosen.filePath
      // Two tabs must never share a path.
      if (chosenPath !== file.path && openFilesRef.current.some((f) => f.path === chosenPath)) {
        addToast({ type: 'error', message: `${chosenPath} is open in another tab. Close it, then save again.` })
        return
      }
      targetPath = chosenPath
      language = chosen.language
    }
    // Also when Save As picked the buffer's own file: the native "replace?"
    // prompt does not say that the file changed on disk.
    if (targetPath === file.path && !confirmOverwriteIfChangedOnDisk(file)) return

    const name = targetPath.split(/[\\/]/).pop() || file.name
    setSaving(true)
    try {
      const content = await prepareContent(language ?? file.language)
      const bufferOf = (path: string) => useEditorStore.getState().openFiles.find((f) => f.path === path)?.content
      // The buffer this write saves, the save's own trim and format included.
      const writtenBuffer = bufferOf(file.path)
      useFileHistoryStore.getState().addSnapshot(targetPath, content, 'Saved')
      await writeFileChecked(targetPath, content, `Save ${name}`)
      if (targetPath !== file.path) {
        renamePath(file.path, targetPath, language)
        setSplitFilePath((current) => (current === file.path ? targetPath : current))
      }
      // Edits typed while the write was in flight are still unsaved.
      if (bufferOf(targetPath) === writtenBuffer) {
        markSaved(targetPath)
        clearRecovery(file.path)
      }
      addToast({ type: 'success', message: `Saved ${name}`, duration: 1500 })
    } catch (err: unknown) {
      addToast({ type: 'error', message: `Failed to save ${name}: ${ipcErrorMessage(err)}` })
    } finally {
      setTimeout(() => setSaving(false), 800)
    }
  }, [addToast, markSaved, renamePath])

  // Ctrl+S and File > Save / Save As: format, trim and add the final newline
  // in the pane being saved, once the save is going ahead. Auto-save writes
  // the buffer as typed.
  const saveFocusedPane = useCallback(async (saveAs: boolean) => {
    const target = getSaveTarget()
    if (!target) return
    const { file: af, editor } = target
    await saveBuffer(af, async (language) => {
      const { formatOnSave, insertFinalNewline } = editorConfigRef.current
      // Trailing spaces are content in Markdown: two of them make a line break.
      const trimTrailingWhitespace = editorConfigRef.current.trimTrailingWhitespace && language !== 'markdown'
      const model = editor?.getModel()
      if (!editor || !model) {
        // No text editor shows the file (e.g. the JSON tree view).
        let content = af.content
        if (trimTrailingWhitespace) content = content.replace(/[ \t]+$/gm, '')
        if (insertFinalNewline && content.length > 0 && !content.endsWith('\n')) content += '\n'
        return content
      }

      if (formatOnSave) {
        try {
          await editor.getAction('editor.action.formatDocument')?.run()
        } catch { /* formatter may not be available for this language */ }
      }

      // Trim and add the final newline as edits: model.setValue would also
      // wipe the undo history and move the cursor on every Ctrl+S.
      const edits: MonacoEditor.IIdentifiedSingleEditOperation[] = []
      if (trimTrailingWhitespace || insertFinalNewline) {
        const lastLine = model.getLineCount()
        // The final newline alone only needs the last line.
        for (let line = trimTrailingWhitespace ? 1 : lastLine; line <= lastLine; line++) {
          const text = model.getLineContent(line)
          const keep = trimTrailingWhitespace ? text.replace(/[ \t]+$/, '').length : text.length
          // A last line with text has no line break after it.
          const addNewline = insertFinalNewline && line === lastLine && keep > 0
          if (keep < text.length || addNewline) {
            edits.push({
              range: { startLineNumber: line, startColumn: keep + 1, endLineNumber: line, endColumn: text.length + 1 },
              text: addNewline ? model.getEOL() : '',
            })
          }
        }
      }
      if (edits.length > 0) {
        editor.pushUndoStop()
        editor.executeEdits('orion-save', edits)
        editor.pushUndoStop()
      }
      return model.getValue()
    }, saveAs)
  }, [getSaveTarget, saveBuffer])

  // Ctrl+S save handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void saveFocusedPane(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveFocusedPane])

  // Toggle split direction handler (for context menu and command palette)
  const handleToggleSplitDirection = useCallback(() => {
    if (splitMode === 'horizontal') {
      setSplitMode('vertical')
    } else if (splitMode === 'vertical') {
      setSplitMode('horizontal')
    }
  }, [splitMode])

  // Handle split editor right (horizontal)
  const handleSplitRight = useCallback(() => {
    if (splitMode === 'single' && activeFileRef.current) {
      setSplitMode('horizontal')
      const other = openFilesRef.current.find((f) => f.path !== activeFilePathRef.current)
      const splitPath = other?.path || activeFilePathRef.current || null
      setSplitFilePath(splitPath)
      setGroup1Files(activeFilePathRef.current ? [activeFilePathRef.current] : [])
      setGroup2Files(splitPath ? [splitPath] : [])
    } else if (splitMode !== 'single') {
      setSplitMode('single')
      setSplitFilePath(null)
      setGroup1Files([])
      setGroup2Files([])
    }
  }, [splitMode])

  // Handle split editor down (vertical)
  const handleSplitDown = useCallback(() => {
    if (splitMode === 'single' && activeFileRef.current) {
      setSplitMode('vertical')
      const other = openFilesRef.current.find((f) => f.path !== activeFilePathRef.current)
      const splitPath = other?.path || activeFilePathRef.current || null
      setSplitFilePath(splitPath)
      setGroup1Files(activeFilePathRef.current ? [activeFilePathRef.current] : [])
      setGroup2Files(splitPath ? [splitPath] : [])
    } else if (splitMode !== 'single') {
      setSplitMode('single')
      setSplitFilePath(null)
      setGroup1Files([])
      setGroup2Files([])
    }
  }, [splitMode])

  // Toggle split (Ctrl+\) - toggles between single and the last used direction
  const handleSplitToggle = useCallback(() => {
    if (splitMode === 'single') {
      handleSplitRight()
    } else {
      setSplitMode('single')
      setSplitFilePath(null)
      setGroup1Files([])
      setGroup2Files([])
    }
  }, [splitMode, handleSplitRight])

  // Handle sync scroll toggle
  const handleToggleSyncScroll = useCallback(() => {
    setSyncScrollEnabled(prev => !prev)
  }, [])

  // Handle opening diff editor
  const handleCompareFiles = useCallback((path?: string) => {
    // A tab's "Compare with..." names its file; otherwise the active one.
    const original = path ?? activeFilePath
    if (!original) return
    // The disk text from a "changed on disk" Compare belongs to that file only.
    setDiffDiskContent(null)
    setDiffOriginalPath(original)
    setDiffFilePickerOpen(true)
  }, [activeFilePath])

  // Open `path` in the side pane, keeping the main pane's file. Used when the
  // request names the file (Open to the Side, a tab's Split, a tab dropped on
  // the edge): never guess it, and never close a split that is already open.
  const openInSplit = useCallback((mode: 'horizontal' | 'vertical', path: string) => {
    const mainPath = useEditorStore.getState().activeFilePath
    setSplitMode(mode)
    setSplitFilePath(path)
    setGroup1Files(mainPath ? [mainPath] : [])
    setGroup2Files([path])
  }, [])

  // Ctrl+\ to toggle split editor
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault()
        handleSplitToggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSplitToggle])

  // Ctrl+1 / Ctrl+2 to focus split panes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        if (e.key === '1') {
          e.preventDefault()
          setActivePane(1)
          editorRef.current?.focus()
        } else if (e.key === '2' && splitMode !== 'single') {
          e.preventDefault()
          setActivePane(2)
          splitEditorRef.current?.focus()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [splitMode])

  // Drag resize for split divider
  useEffect(() => {
    if (splitMode === 'single') return

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingSplit.current || !splitContainerRef.current) return
      const rect = splitContainerRef.current.getBoundingClientRect()
      let ratio: number
      if (splitMode === 'horizontal') {
        ratio = (e.clientX - rect.left) / rect.width
      } else {
        ratio = (e.clientY - rect.top) / rect.height
      }
      ratio = Math.max(0.15, Math.min(0.85, ratio))
      setSplitRatio(ratio)
    }

    const handleMouseUp = () => {
      isDraggingSplit.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [splitMode])

  // Close divider context menu on click elsewhere
  useEffect(() => {
    if (!dividerContextMenu) return
    const handler = () => setDividerContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [dividerContextMenu])

  // Ctrl+G to open Go to Line dialog
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault()
        setGoToLineOpen(true)
        setGoToLineValue('')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Handle selecting the comparison file
  const handleSelectDiffFile = useCallback((path: string) => {
    setDiffDiskContent(null)
    setDiffModifiedPath(path)
    setDiffFilePickerOpen(false)
    setDiffEditorMode(true)
  }, [])

  // Close diff editor
  const handleCloseDiffEditor = useCallback(() => {
    setDiffEditorMode(false)
    setDiffOriginalPath(null)
    setDiffModifiedPath(null)
    setDiffDiskContent(null)
  }, [])

  // Move tab from one group to another
  const handleMoveTabToGroup = useCallback((filePath: string, targetGroup: 1 | 2) => {
    if (targetGroup === 2) {
      setGroup1Files(prev => prev.filter(p => p !== filePath))
      setGroup2Files(prev => prev.includes(filePath) ? prev : [...prev, filePath])
      setSplitFilePath(filePath)
    } else {
      setGroup2Files(prev => prev.filter(p => p !== filePath))
      setGroup1Files(prev => prev.includes(filePath) ? prev : [...prev, filePath])
    }
    // If a group becomes empty, close the split
    setTimeout(() => {
      setGroup2Files(prev => {
        if (prev.length === 0 && splitMode !== 'single') {
          setSplitMode('single')
          setSplitFilePath(null)
          setGroup1Files([])
        }
        return prev
      })
    }, 0)
  }, [splitMode])

  // Sync scroll effect
  useEffect(() => {
    const primary = editorRef.current
    const secondary = splitEditorRef.current
    if (!syncScrollEnabled || !primary || !secondary) return

    const disposeA = primary.onDidScrollChange((e) => {
      if (isSyncingScroll.current) return
      isSyncingScroll.current = true
      secondary.setScrollTop(e.scrollTop)
      secondary.setScrollLeft(e.scrollLeft)
      requestAnimationFrame(() => { isSyncingScroll.current = false })
    })

    const disposeB = secondary.onDidScrollChange((e) => {
      if (isSyncingScroll.current) return
      isSyncingScroll.current = true
      primary.setScrollTop(e.scrollTop)
      primary.setScrollLeft(e.scrollLeft)
      requestAnimationFrame(() => { isSyncingScroll.current = false })
    })

    return () => {
      disposeA.dispose()
      disposeB.dispose()
    }
  }, [syncScrollEnabled, splitMode])

  // Listen for split toggle events
  useEffect(() => {
    const pathOf = (e: Event) => (e as CustomEvent<{ path?: string } | undefined>).detail?.path
    const handlerRight = (e: Event) => {
      const path = pathOf(e)
      if (path) openInSplit('horizontal', path)
      else handleSplitRight()
    }
    const handlerDown = (e: Event) => {
      const path = pathOf(e)
      if (path) openInSplit('vertical', path)
      else handleSplitDown()
    }
    const handlerSyncScroll = () => handleToggleSyncScroll()
    const handlerCompare = (e: Event) => handleCompareFiles(pathOf(e))
    const handlerToggleDir = () => handleToggleSplitDirection()
    window.addEventListener('orion:split-editor-right', handlerRight)
    window.addEventListener('orion:split-editor-down', handlerDown)
    window.addEventListener('orion:toggle-sync-scroll', handlerSyncScroll)
    window.addEventListener('orion:compare-files', handlerCompare)
    window.addEventListener('orion:toggle-split-direction', handlerToggleDir)
    return () => {
      window.removeEventListener('orion:split-editor-right', handlerRight)
      window.removeEventListener('orion:split-editor-down', handlerDown)
      window.removeEventListener('orion:toggle-sync-scroll', handlerSyncScroll)
      window.removeEventListener('orion:compare-files', handlerCompare)
      window.removeEventListener('orion:toggle-split-direction', handlerToggleDir)
    }
  }, [openInSplit, handleSplitRight, handleSplitDown, handleToggleSyncScroll, handleCompareFiles, handleToggleSplitDirection])

  // Listen for tab-to-group-drop events from TabBar
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.filePath && detail?.targetGroup) {
        handleMoveTabToGroup(detail.filePath, detail.targetGroup)
      }
    }
    window.addEventListener('orion:move-tab-to-group', handler)
    return () => window.removeEventListener('orion:move-tab-to-group', handler)
  }, [handleMoveTabToGroup])

  // Command palette event handlers
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      // The editors' options follow editorConfig (monacoOptionsFor).
      'orion:toggle-minimap': () => {
        const next = !minimapRef.current
        minimapRef.current = next
        setEditorConfig(prev => ({ ...prev, minimap: next }))
      },
      'orion:toggle-wordwrap': () => setEditorConfig(prev => ({ ...prev, wordWrap: !prev.wordWrap })),
      'orion:font-increase': () => setEditorConfig(prev => ({ ...prev, fontSize: prev.fontSize + 1 })),
      'orion:font-decrease': () => setEditorConfig(prev => ({ ...prev, fontSize: Math.max(10, prev.fontSize - 1) })),
      'orion:font-reset': () => setEditorConfig(prev => ({ ...prev, fontSize: 13 })),
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
      'orion:save-file': () => saveFocusedPane(false),
      'orion:save-file-as': () => saveFocusedPane(true),
      // Multi-cursor & selection actions (from Command Palette)
      'orion:add-selection-next-match': () => {
        editorRef.current?.getAction('editor.action.addSelectionToNextFindMatch')?.run()
      },
      'orion:select-all-occurrences': () => {
        editorRef.current?.trigger('', 'editor.action.selectHighlights', {})
      },
      'orion:expand-selection': () => {
        editorRef.current?.getAction('editor.action.smartSelect.expand')?.run()
      },
      'orion:shrink-selection': () => {
        editorRef.current?.getAction('editor.action.smartSelect.shrink')?.run()
      },
      'orion:add-cursor-above': () => {
        editorRef.current?.trigger('', 'editor.action.insertCursorAbove', {})
      },
      'orion:add-cursor-below': () => {
        editorRef.current?.trigger('', 'editor.action.insertCursorBelow', {})
      },
      'orion:cursors-to-line-ends': () => {
        editorRef.current?.trigger('', 'editor.action.insertCursorAtEndOfEachLineSelected', {})
      },
      'orion:column-select': () => {
        editorRef.current?.trigger('', 'editor.action.toggleColumnSelection', {})
      },
      // Transform actions
      'orion:transform-uppercase': () => {
        editorRef.current?.getAction('editor.action.transformToUppercase')?.run()
      },
      'orion:transform-lowercase': () => {
        editorRef.current?.getAction('editor.action.transformToLowercase')?.run()
      },
      'orion:transform-titlecase': () => {
        editorRef.current?.trigger('', 'editor.action.transformToTitlecase', {})
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
      // Duplicate / Trim
      'orion:duplicate-selection': () => {
        editorRef.current?.getAction('editor.action.duplicateSelection')?.run()
      },
      'orion:trim-whitespace': () => {
        editorRef.current?.getAction('editor.action.trimTrailingWhitespace')?.run()
      },
      'orion:toggle-markdown-preview': () => {
        if (activeFileRef.current?.language === 'markdown') {
          setMarkdownPreview(prev => !prev)
        }
      },
    }

    // Go-to-line handler (used by Outline panel and Ctrl+G)
    const goToLineHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.line && editorRef.current) {
        const lineNumber = detail.line as number
        editorRef.current.revealLineInCenter(lineNumber)
        editorRef.current.setPosition({ lineNumber, column: 1 })
        editorRef.current.focus()
      } else {
        setGoToLineOpen(true)
        setGoToLineValue('')
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

    // Set indentation handler (from StatusBar indentation selector)
    const setIndentHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail && editorRef.current) {
        const { useSpaces, size } = detail as { useSpaces: boolean; size: number }
        editorRef.current.getModel()?.updateOptions({
          tabSize: size,
          insertSpaces: useSpaces,
        })
        editorRef.current.updateOptions({
          tabSize: size,
          insertSpaces: useSpaces,
        })
      }
    }

    // Set EOL handler (from StatusBar EOL selector)
    const setEolHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail && editorRef.current && monacoRef.current) {
        const eolValue = detail.eol === 'CRLF'
          ? monacoRef.current.editor.EndOfLineSequence.CRLF
          : monacoRef.current.editor.EndOfLineSequence.LF
        editorRef.current.getModel()?.pushEOL(eolValue)
      }
    }

    // Insert at cursor handler (from ChatPanel "Insert at Cursor" button)
    const insertAtCursorHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.code && editorRef.current) {
        const editor = editorRef.current
        const position = editor.getPosition()
        if (position) {
          editor.executeEdits('insert-from-chat', [{
            range: {
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            },
            text: detail.code,
          }])
          editor.focus()
        }
      }
    }

    // Editor config update from Settings modal. Both panes' options are
    // derived from editorConfig (monacoOptionsFor), so updating it applies them.
    const editorConfigHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail && typeof detail === 'object') {
        setEditorConfig(prev => {
          const next = { ...prev, ...detail }
          minimapRef.current = next.minimap
          return next
        })
      }
    }

    Object.entries(handlers).forEach(([event, handler]) => {
      window.addEventListener(event, handler)
    })
    window.addEventListener('orion:go-to-line', goToLineHandler)
    window.addEventListener('orion:set-language', setLanguageHandler)
    window.addEventListener('orion:set-indent', setIndentHandler)
    window.addEventListener('orion:set-eol', setEolHandler)
    window.addEventListener('orion:insert-at-cursor', insertAtCursorHandler)
    window.addEventListener('orion:editor-config', editorConfigHandler)

    const toggleTimelineHandler = () => setTimelineVisible(prev => !prev)
    window.addEventListener('orion:toggle-timeline', toggleTimelineHandler)

    return () => {
      Object.entries(handlers).forEach(([event, handler]) => {
        window.removeEventListener(event, handler)
      })
      window.removeEventListener('orion:go-to-line', goToLineHandler)
      window.removeEventListener('orion:set-language', setLanguageHandler)
      window.removeEventListener('orion:set-indent', setIndentHandler)
      window.removeEventListener('orion:set-eol', setEolHandler)
      window.removeEventListener('orion:insert-at-cursor', insertAtCursorHandler)
      window.removeEventListener('orion:editor-config', editorConfigHandler)
      window.removeEventListener('orion:toggle-timeline', toggleTimelineHandler)
    }
  }, [activeFilePath, closeFile, closeAllFiles, addToast, saveFocusedPane])

  const editorOptions: MonacoEditor.IStandaloneEditorConstructionOptions = {
    ...monacoOptionsFor(editorConfig),
    scrollBeyondLastLine: true,
    scrollBeyondLastColumn: 5,
    mouseWheelScrollSensitivity: 1,
    fastScrollSensitivity: 5,
    cursorSmoothCaretAnimation: 'on',
    cursorWidth: 2,
    padding: { top: 8, bottom: 8 },
    renderLineHighlight: 'line',
    guides: {
      bracketPairs: true,
      bracketPairsHorizontal: true,
      indentation: true,
      highlightActiveBracketPair: true,
      highlightActiveIndentation: true,
    },
    overviewRulerBorder: false,
    overviewRulerLanes: 3,
    hideCursorInOverviewRuler: false,
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
      useShadows: false,
      verticalSliderSize: 8,
      horizontalSliderSize: 8,
    },
    wrappingIndent: 'indent',
    wrappingStrategy: 'advanced',
    links: true,
    colorDecorators: true,
    matchBrackets: 'always',
    occurrencesHighlight: 'singleFile',
    folding: true,
    foldingHighlight: true,
    showFoldingControls: 'mouseover',
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnCommitCharacter: true,
    suggestSelection: 'first',
    suggest: {
      showIcons: true,
      showStatusBar: true,
      preview: true,
      insertMode: 'replace',
    },
    contextmenu: true,
    find: {
      seedSearchStringFromSelection: 'selection',
      autoFindInSelection: 'multiline',
      addExtraSpaceOnTop: true,
      loop: true,
    },
    autoClosingBrackets: 'always',
    autoClosingQuotes: 'always',
    autoClosingOvertype: 'always',
    autoSurround: 'languageDefined',
    linkedEditing: true,
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
      <style>{markdownPreviewStyles}</style>
      {/* Drop overlay for OS file drag */}
      {isDragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-content">
            <Upload size={32} />
            <span>Drop to open</span>
            <span style={{ fontSize: 11, opacity: 0.7, fontWeight: 400 }}>
              Files open in editor &middot; Folders set as workspace
            </span>
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
          {/* Markdown preview toggle */}
          {activeFile?.language === 'markdown' && (
            <button
              onClick={() => setMarkdownPreview(prev => !prev)}
              title="Toggle Markdown Preview"
              style={{
                background: markdownPreview ? 'rgba(88,166,255,0.15)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: 3,
                color: markdownPreview ? 'var(--accent-blue)' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { if (!markdownPreview) e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { if (!markdownPreview) e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <Eye size={12} />
              Preview
            </button>
          )}
          {/* JSON tree view toggle */}
          {activeFile?.path?.endsWith('.json') && (
            <button
              onClick={() => setJsonTreeView(prev => !prev)}
              title="Toggle Tree View"
              style={{
                background: jsonTreeView ? 'rgba(88,166,255,0.15)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: 3,
                color: jsonTreeView ? 'var(--accent-blue)' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { if (!jsonTreeView) e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { if (!jsonTreeView) e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <Braces size={12} />
              Tree View
            </button>
          )}
          {/* CSV/TSV table view toggle */}
          {(activeFile?.path?.endsWith('.csv') || activeFile?.path?.endsWith('.tsv')) && (
            <button
              onClick={() => setCsvTableView(prev => !prev)}
              title="Toggle Table View"
              style={{
                background: csvTableView ? 'rgba(88,166,255,0.15)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: 3,
                color: csvTableView ? 'var(--accent-blue)' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { if (!csvTableView) e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { if (!csvTableView) e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <Table size={12} />
              Table View
            </button>
          )}
          {/* Split editor buttons */}
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 2, paddingRight: 4 }}>
            {/* Sync scroll toggle (only visible when split) */}
            {splitMode !== 'single' && (
              <button
                onClick={handleToggleSyncScroll}
                title={syncScrollEnabled ? 'Disable Sync Scroll' : 'Enable Sync Scroll'}
                style={{
                  padding: '0 6px',
                  height: 22,
                  color: syncScrollEnabled ? 'var(--accent)' : 'var(--text-muted)',
                  background: syncScrollEnabled ? 'rgba(255,255,255,0.06)' : 'transparent',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                  gap: 3,
                  fontSize: 10,
                }}
                onMouseEnter={(e) => { if (!syncScrollEnabled) e.currentTarget.style.color = 'var(--text-secondary)' }}
                onMouseLeave={(e) => { if (!syncScrollEnabled) e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                {syncScrollEnabled ? <Link2 size={11} /> : <Link2Off size={11} />}
              </button>
            )}
            {/* Compare files button */}
            <button
              onClick={() => handleCompareFiles()}
              title="Compare Active File With..."
              style={{
                padding: '0 6px',
                height: 22,
                color: diffEditorMode ? 'var(--accent)' : 'var(--text-muted)',
                background: diffEditorMode ? 'rgba(255,255,255,0.06)' : 'transparent',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { if (!diffEditorMode) e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { if (!diffEditorMode) e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <GitCompare size={12} />
            </button>
            {/* Split right button */}
            <button
              onClick={handleSplitRight}
              title="Split Editor Right (Ctrl+\)"
              style={{
                padding: '0 6px',
                height: 22,
                color: splitMode === 'horizontal' ? 'var(--accent)' : 'var(--text-muted)',
                background: splitMode === 'horizontal' ? 'rgba(255,255,255,0.06)' : 'transparent',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { if (splitMode !== 'horizontal') e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { if (splitMode !== 'horizontal') e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <Columns size={12} />
            </button>
            {/* Split down button */}
            <button
              onClick={handleSplitDown}
              title="Split Editor Down"
              style={{
                padding: '0 6px',
                height: 22,
                color: splitMode === 'vertical' ? 'var(--accent)' : 'var(--text-muted)',
                background: splitMode === 'vertical' ? 'rgba(255,255,255,0.06)' : 'transparent',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { if (splitMode !== 'vertical') e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { if (splitMode !== 'vertical') e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              <Rows2 size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Diff file picker overlay */}
      {diffFilePickerOpen && (
        <DiffFilePicker
          openFiles={openFiles}
          currentPath={diffOriginalPath}
          onSelect={handleSelectDiffFile}
          onClose={() => setDiffFilePickerOpen(false)}
        />
      )}

      {/* External file change notification bar */}
      {activeFile?.isDeletedOnDisk && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          fontSize: 12,
          background: 'rgba(220, 80, 80, 0.12)',
          borderBottom: '1px solid rgba(220, 80, 80, 0.3)',
          color: '#f08080',
          flexShrink: 0,
        }}>
          <span style={{ flex: 1 }}>
            This file has been deleted from disk.
          </span>
          <button
            onClick={() => {
              if (activeFile) closeFile(activeFile.path)
            }}
            style={{
              padding: '2px 10px',
              fontSize: 11,
              borderRadius: 3,
              border: '1px solid rgba(220, 80, 80, 0.4)',
              background: 'rgba(220, 80, 80, 0.15)',
              color: '#f08080',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(220, 80, 80, 0.25)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(220, 80, 80, 0.15)' }}
          >
            Close
          </button>
        </div>
      )}
      {activeFile?.hasExternalChange && !activeFile?.isDeletedOnDisk && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          fontSize: 12,
          background: 'rgba(200, 160, 40, 0.12)',
          borderBottom: '1px solid rgba(200, 160, 40, 0.3)',
          color: '#d4a847',
          flexShrink: 0,
        }}>
          <span style={{ flex: 1 }}>
            This file has been changed on disk.
          </span>
          <button
            onClick={async () => {
              if (!activeFile) return
              try {
                const result = await window.api.readFile(activeFile.path)
                reloadFileContent(activeFile.path, result.content)
                addToast({ type: 'info', message: 'File reloaded from disk' })
              } catch (err) {
                addToast({ type: 'error', message: `Failed to reload file: ${err instanceof Error ? err.message : String(err)}` })
              }
            }}
            style={{
              padding: '2px 10px',
              fontSize: 11,
              borderRadius: 3,
              border: '1px solid rgba(200, 160, 40, 0.4)',
              background: 'rgba(200, 160, 40, 0.15)',
              color: '#d4a847',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(200, 160, 40, 0.25)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(200, 160, 40, 0.15)' }}
          >
            Reload
          </button>
          <button
            onClick={() => {
              if (activeFile) dismissExternalChange(activeFile.path)
            }}
            style={{
              padding: '2px 10px',
              fontSize: 11,
              borderRadius: 3,
              border: '1px solid rgba(200, 160, 40, 0.4)',
              background: 'rgba(200, 160, 40, 0.15)',
              color: '#d4a847',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(200, 160, 40, 0.25)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(200, 160, 40, 0.15)' }}
          >
            Keep Mine
          </button>
          <button
            onClick={async () => {
              if (!activeFile) return
              // Show the disk version against the buffer. The conflict stays
              // flagged (so saves keep asking) until Reload or Keep Mine.
              try {
                const disk = await window.api.readFile(activeFile.path)
                setDiffDiskContent(disk.content)
                setDiffOriginalPath(activeFile.path)
                setDiffModifiedPath(activeFile.path)
                setDiffEditorMode(true)
              } catch (err) {
                addToast({ type: 'error', message: `Failed to read ${activeFile.name} from disk: ${ipcErrorMessage(err)}` })
              }
            }}
            style={{
              padding: '2px 10px',
              fontSize: 11,
              borderRadius: 3,
              border: '1px solid rgba(200, 160, 40, 0.4)',
              background: 'rgba(200, 160, 40, 0.15)',
              color: '#d4a847',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(200, 160, 40, 0.25)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(200, 160, 40, 0.15)' }}
          >
            Compare
          </button>
        </div>
      )}

      <div ref={splitContainerRef} className="flex-1 overflow-hidden" style={{ display: 'flex', flexDirection: splitMode === 'vertical' ? 'column' : 'row' }}>
        {activeFile ? (
          <>
            {/* Diff editor mode */}
            {diffEditorMode && diffOriginalPath && diffModifiedPath ? (
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {/* Diff editor header */}
                <div style={{
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 12px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-tertiary)',
                  gap: 8,
                }}>
                  <GitCompare size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ color: 'var(--text-muted)', fontSize: 10, opacity: 0.7 }}>{diffDiskContent !== null ? 'On disk:' : 'Original:'}</span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {diffOriginalPath.replace(/\\/g, '/').split('/').pop()}
                  </span>
                  <span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>{'\u2194'}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10, opacity: 0.7 }}>{diffDiskContent !== null ? 'Yours:' : 'Modified:'}</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    {diffModifiedPath.replace(/\\/g, '/').split('/').pop()}
                  </span>
                  <button
                    onClick={handleCloseDiffEditor}
                    title="Close Diff View"
                    style={{
                      marginLeft: 'auto',
                      width: 20,
                      height: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 3,
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      background: 'transparent',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
                  >
                    <X size={12} />
                  </button>
                </div>
                <div style={{ flex: 1 }}>
                  <MonacoDiffEditorComponent
                    theme={currentMonacoTheme}
                    language={activeFile.language}
                    original={diffDiskContent ?? openFiles.find(f => f.path === diffOriginalPath)?.content ?? ''}
                    modified={openFiles.find(f => f.path === diffModifiedPath)?.content || ''}
                    loading={<EditorLoading />}
                    options={{
                      ...editorOptions,
                      readOnly: true,
                      renderSideBySide: true,
                      enableSplitViewResizing: true,
                      renderOverviewRuler: true,
                      minimap: { enabled: false },
                    }}
                  />
                </div>
              </div>
            ) : (
              <>
                {/* Primary editor or image preview */}
                <div
                  style={{
                    flex: splitMode !== 'single' ? `0 0 calc(${splitRatio * 100}% - 3px)` : 1,
                    position: 'relative',
                    overflow: 'hidden',
                    display: markdownPreview && activeFile?.language === 'markdown' ? 'flex' : 'flex',
                    flexDirection: 'column',
                    borderTop: splitMode !== 'single' && activePane === 1 ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                  onClick={() => setActivePane(1)}
                >
                  {/* Group 1 header (only shown when split) */}
                  {splitMode !== 'single' && (
                    <div style={{
                      height: 28,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 12px',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      background: 'var(--bg-tertiary)',
                      gap: 6,
                      flexShrink: 0,
                    }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                        {activeFile.name}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 9, opacity: 0.5, marginLeft: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Group 1
                      </span>
                      <span style={{ flex: 1 }} />
                      <span style={{ color: 'var(--text-muted)', fontSize: 10, opacity: 0.6 }}>Ctrl+1</span>
                    </div>
                  )}
                  {isImageFile(activeFile.path) ? (
                    <ImagePreview filePath={activeFile.path} />
                  ) : csvTableView && (activeFile.path?.endsWith('.csv') || activeFile.path?.endsWith('.tsv')) ? (
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <CsvTableViewer content={activeFile.content || ''} isTsv={activeFile.path?.endsWith('.tsv')} />
                    </div>
                  ) : jsonTreeView && activeFile?.path?.endsWith('.json') ? (
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <JsonTreeViewer content={activeFile.content || ''} onChange={handleChange} />
                    </div>
                  ) : (
                    <>
                      <div style={markdownPreview && activeFile?.language === 'markdown' ? { flex: 1, overflow: 'hidden', position: 'relative' } : { flex: 1, minHeight: 0 }}>
                      <Editor
                        // One model per file. Without a path every file shared a
                        // single model, so Ctrl+Z after switching tabs restored the
                        // previous file's text into the current one (and saving
                        // wrote it to the wrong file).
                        path={modelPathFor(activeFile.path)}
                        theme={currentMonacoTheme}
                        language={activeFile.language}
                        value={activeFile.content}
                        keepCurrentModel
                        onChange={handleChange}
                        onMount={(editor, monaco) => {
                          syncModelWithBuffer(editor)
                          handleEditorMount(editor, monaco)
                        }}
                        loading={<EditorLoading />}
                        options={editorOptions}
                      />
                      <GhostTextProvider
                        editor={editorRef.current}
                        monaco={monacoRef.current}
                        language={activeFile?.language || 'plaintext'}
                        filePath={activeFilePath || ''}
                      />
                      <EmmetProvider monaco={monacoRef.current} />
                      {/* Inline Edit Overlay (Ctrl+I) */}
                      {inlineEditVisible && (
                        <InlineEdit
                          visible={inlineEditVisible}
                          onClose={handleInlineEditClose}
                          onSubmit={handleInlineEditSubmit}
                          onAccept={handleInlineEditAccept}
                          onReject={handleInlineEditReject}
                          isProcessing={inlineProcessing}
                          selectedText={inlineEditText}
                          position={inlineEditPos}
                          selectionRange={inlineEditSelRange}
                          aiResponse={inlineEditAiResponse}
                          language={activeFile?.language}
                        />
                      )}
                      {/* Go to Line Overlay */}
                      {goToLineOpen && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            zIndex: 50,
                            display: 'flex',
                            justifyContent: 'center',
                            paddingTop: 60,
                          }}
                          onClick={() => setGoToLineOpen(false)}
                        >
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: 340,
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border)',
                              borderRadius: 8,
                              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                              padding: 4,
                              height: 'fit-content',
                            }}
                          >
                            <input
                              autoFocus
                              type="text"
                              value={goToLineValue}
                              onChange={(e) => setGoToLineValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  setGoToLineOpen(false)
                                }
                                if (e.key === 'Enter') {
                                  const lineNum = parseInt(goToLineValue, 10)
                                  if (editorRef.current && lineNum > 0) {
                                    editorRef.current.revealLineInCenter(lineNum)
                                    editorRef.current.setPosition({ lineNumber: lineNum, column: 1 })
                                    editorRef.current.focus()
                                  }
                                  setGoToLineOpen(false)
                                }
                              }}
                              placeholder={`Go to Line (1-${editorRef.current?.getModel()?.getLineCount() || '...'})`}
                              style={{
                                width: '100%',
                                padding: '8px 12px',
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border)',
                                borderRadius: 6,
                                color: 'var(--text-primary)',
                                fontSize: 13,
                                outline: 'none',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>
                        </div>
                      )}
                      </div>
                      {/* Markdown Preview Pane */}
                      {markdownPreview && activeFile?.language === 'markdown' && (
                        <>
                          <div style={{ width: 1, background: 'var(--border)', flexShrink: 0 }} />
                          <div style={{ flex: 1, overflow: 'hidden' }}>
                            <MarkdownPreview content={activeFile.content || ''} />
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Split editor */}
                {splitMode !== 'single' && splitFile && (
                  <>
                    {/* Draggable divider with handle */}
                    <div
                      style={{
                        ...(splitMode === 'horizontal'
                          ? { width: 6, minWidth: 6 }
                          : { height: 6, minHeight: 6 }),
                        background: 'var(--border)',
                        flexShrink: 0,
                        cursor: splitMode === 'horizontal' ? 'col-resize' : 'row-resize',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        zIndex: 5,
                        transition: 'background 0.15s',
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        isDraggingSplit.current = true
                        document.body.style.cursor = splitMode === 'horizontal' ? 'col-resize' : 'row-resize'
                        document.body.style.userSelect = 'none'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--border)' }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setDividerContextMenu({ x: e.clientX, y: e.clientY })
                      }}
                    >
                      {splitMode === 'horizontal' ? (
                        <GripVertical size={10} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                      ) : (
                        <GripHorizontal size={10} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                      )}
                    </div>

                    {/* Divider context menu */}
                    {dividerContextMenu && (
                      <div
                        style={{
                          position: 'fixed',
                          left: dividerContextMenu.x,
                          top: dividerContextMenu.y,
                          zIndex: 1000,
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                          padding: 4,
                          minWidth: 180,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            handleToggleSplitDirection()
                            setDividerContextMenu(null)
                          }}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 10px',
                            border: 'none',
                            borderRadius: 4,
                            background: 'transparent',
                            color: 'var(--text-primary)',
                            fontSize: 12,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                        >
                          {splitMode === 'horizontal' ? <Rows2 size={13} /> : <Columns size={13} />}
                          Toggle Split Direction ({splitMode === 'horizontal' ? 'to Vertical' : 'to Horizontal'})
                        </button>
                      </div>
                    )}

                    {/* Split pane (Group 2) */}
                    <div
                      style={{
                        flex: `0 0 calc(${(1 - splitRatio) * 100}% - 3px)`,
                        overflow: 'hidden',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        borderTop: activePane === 2 ? '2px solid var(--accent)' : '2px solid transparent',
                      }}
                      onClick={() => setActivePane(2)}
                      onDragOver={(e) => {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        const tabPath = e.dataTransfer.getData('application/x-orion-tab')
                        if (tabPath) {
                          window.dispatchEvent(new CustomEvent('orion:move-tab-to-group', { detail: { filePath: tabPath, targetGroup: 2 } }))
                        }
                      }}
                    >
                      {/* Split file header */}
                      <div style={{
                        height: 28,
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 12px',
                        borderBottom: '1px solid var(--border)',
                        fontSize: 11,
                        color: 'var(--text-secondary)',
                        background: 'var(--bg-tertiary)',
                        gap: 6,
                        flexShrink: 0,
                      }}>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                          {splitFile.name}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 9, opacity: 0.5, marginLeft: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Group 2
                        </span>
                        {/* Sync scroll indicator */}
                        {syncScrollEnabled && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--accent)', fontSize: 10 }}>
                            <Link2 size={10} />
                            synced
                          </span>
                        )}
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
                        <span style={{ color: 'var(--text-muted)', fontSize: 10, opacity: 0.6 }}>Ctrl+2</span>
                        {/* Close split button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); setSplitMode('single'); setSplitFilePath(null); setGroup1Files([]); setGroup2Files([]) }}
                          title="Close Split"
                          style={{
                            width: 18,
                            height: 18,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 3,
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-muted)',
                            background: 'transparent',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
                        >
                          <X size={11} />
                        </button>
                      </div>
                      <div style={{ flex: 1 }}>
                        <Editor
                          path={modelPathFor(splitFile.path)}
                          theme={currentMonacoTheme}
                          language={splitFile.language}
                          value={splitFile.content}
                          keepCurrentModel
                          onChange={(val) => {
                            if (splitFilePath && val !== undefined) {
                              updateFileContent(splitFilePath, val)
                              scheduleAutoSave(splitFilePath, val)
                            }
                          }}
                          onMount={(editor) => {
                            syncModelWithBuffer(editor)
                            splitEditorRef.current = editor
                          }}
                          options={{
                            ...editorOptions,
                            minimap: { enabled: false },
                          }}
                        />
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        ) : (
          <WelcomeTab
            onOpenFolder={() => window.dispatchEvent(new Event('orion:open-folder'))}
            onOpenPalette={() => window.dispatchEvent(new Event('orion:open-palette'))}
            onOpenTerminal={() => window.dispatchEvent(new Event('orion:toggle-terminal'))}
            onOpenSettings={() => window.dispatchEvent(new Event('orion:open-settings'))}
            onOpenChat={() => window.dispatchEvent(new Event('orion:toggle-chat'))}
          />
        )}
      </div>

      {/* ── Timeline Panel (collapsible below editor) ── */}
      {timelineVisible && activeFile && (
        <>
          {/* Resize handle */}
          <div
            style={{
              height: 4,
              cursor: 'ns-resize',
              background: 'var(--border)',
              flexShrink: 0,
              position: 'relative',
              zIndex: 10,
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              isDraggingTimeline.current = true
              const startY = e.clientY
              const startHeight = timelineHeight

              const onMove = (ev: MouseEvent) => {
                if (!isDraggingTimeline.current) return
                const delta = startY - ev.clientY
                setTimelineHeight(Math.max(100, Math.min(500, startHeight + delta)))
              }

              const onUp = () => {
                isDraggingTimeline.current = false
                document.removeEventListener('mousemove', onMove)
                document.removeEventListener('mouseup', onUp)
              }

              document.addEventListener('mousemove', onMove)
              document.addEventListener('mouseup', onUp)
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.opacity = '0.6' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--border)'; e.currentTarget.style.opacity = '1' }}
          />
          <div
            ref={timelineContainerRef}
            style={{
              height: timelineHeight,
              flexShrink: 0,
              overflow: 'hidden',
              borderTop: '1px solid var(--border)',
            }}
          >
            <TimelinePanel />
          </div>
        </>
      )}
    </div>
  )
}

/* ── Diff File Picker ── */
function DiffFilePicker({
  openFiles,
  currentPath,
  onSelect,
  onClose,
}: {
  openFiles: { path: string; name: string }[]
  currentPath: string | null
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const candidates = openFiles.filter(f => f.path !== currentPath)
    if (!query.trim()) return candidates
    const lower = query.toLowerCase()
    return candidates.filter(f => f.name.toLowerCase().includes(lower) || f.path.toLowerCase().includes(lower))
  }, [openFiles, currentPath, query])

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  useEffect(() => { setSelectedIndex(0) }, [query])

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && filtered[selectedIndex]) { onSelect(filtered[selectedIndex].path) }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', justifyContent: 'center',
        paddingTop: 80,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 480, maxHeight: 340,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-bright)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
        }}>
          <GitCompare size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Select a file to compare with..."
            style={{
              flex: 1, background: 'transparent',
              border: 'none', outline: 'none',
              fontSize: 13, color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
            }}
          />
        </div>
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              No other open files to compare with
            </div>
          ) : (
            filtered.map((file, idx) => (
              <div
                key={file.path}
                onClick={() => onSelect(file.path)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 14px',
                  cursor: 'pointer',
                  background: idx === selectedIndex ? 'var(--bg-active)' : 'transparent',
                  color: idx === selectedIndex ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 13,
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <FileText size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{file.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.5 }}>
                  {file.path.replace(/\\/g, '/').split('/').slice(-3, -1).join('/')}
                </span>
              </div>
            ))
          )}
        </div>
        <div style={{
          padding: '6px 14px',
          borderTop: '1px solid var(--border)',
          fontSize: 11, color: 'var(--text-muted)',
        }}>
          Select a file to compare with the active file
        </div>
      </div>
    </div>
  )
}

/* ── Symbol extraction for breadcrumb ── */
interface BreadcrumbSymbol {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'const' | 'method' | 'property'
  line: number
  endLine: number
  indent: number
  children: BreadcrumbSymbol[]
  parent: BreadcrumbSymbol | null
}

function extractBreadcrumbSymbols(content: string, language: string): BreadcrumbSymbol[] {
  const symbols: BreadcrumbSymbol[] = []
  const lines = content.split('\n')
  lines.forEach((line, idx) => {
    const trimmed = line.trim(); const lineNum = idx + 1
    const indent = line.length - line.trimStart().length
    let match = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/)
    if (match) { symbols.push({ name: match[1], kind: 'function', line: lineNum, endLine: lineNum, indent, children: [], parent: null }); return }
    match = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|<)/)
    if (match) { symbols.push({ name: match[1], kind: 'function', line: lineNum, endLine: lineNum, indent, children: [], parent: null }); return }
    match = trimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/)
    if (match) { symbols.push({ name: match[1], kind: 'class', line: lineNum, endLine: lineNum, indent, children: [], parent: null }); return }
    match = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/)
    if (match) { symbols.push({ name: match[1], kind: 'interface', line: lineNum, endLine: lineNum, indent, children: [], parent: null }); return }
    match = trimmed.match(/^(?:export\s+)?type\s+(\w+)\s*=/)
    if (match) { symbols.push({ name: match[1], kind: 'type', line: lineNum, endLine: lineNum, indent, children: [], parent: null }); return }
    match = trimmed.match(/^(?:export\s+)?enum\s+(\w+)/)
    if (match) { symbols.push({ name: match[1], kind: 'class', line: lineNum, endLine: lineNum, indent, children: [], parent: null }); return }
    // Methods inside classes/objects
    match = trimmed.match(/^(?:(?:public|private|protected|static|async|readonly|override|abstract)\s+)*(\w+)\s*\(/)
    if (match && indent > 0 && !['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'import', 'export', 'from', 'const', 'let', 'var', 'function'].includes(match[1])) {
      symbols.push({ name: match[1], kind: 'method' as any, line: lineNum, endLine: lineNum, indent, children: [], parent: null }); return
    }
    // Arrow function properties
    match = trimmed.match(/^(\w+)\s*[:=]\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/)
    if (match && indent > 0) {
      symbols.push({ name: match[1], kind: 'method' as any, line: lineNum, endLine: lineNum, indent, children: [], parent: null }); return
    }
    if (language === 'python') {
      match = trimmed.match(/^def\s+(\w+)/); if (match) { symbols.push({ name: match[1], kind: 'function', line: lineNum, endLine: lineNum, indent, children: [], parent: null }); return }
      match = trimmed.match(/^class\s+(\w+)/); if (match) { symbols.push({ name: match[1], kind: 'class', line: lineNum, endLine: lineNum, indent, children: [], parent: null }); return }
    }
  })
  // Compute endLine
  for (let i = 0; i < symbols.length; i++) {
    symbols[i].endLine = i + 1 < symbols.length ? symbols[i + 1].line - 1 : lines.length
  }
  // Build parent-child hierarchy based on indentation
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (symbols[j].indent < symbols[i].indent && symbols[i].line >= symbols[j].line && symbols[i].line <= symbols[j].endLine) {
        symbols[i].parent = symbols[j]
        symbols[j].children.push(symbols[i])
        break
      }
    }
  }
  return symbols
}

function findSymbolChainAtLine(symbols: BreadcrumbSymbol[], line: number): BreadcrumbSymbol[] {
  // Find deepest symbol containing the line, then walk up to build chain
  let best: BreadcrumbSymbol | null = null
  for (let i = symbols.length - 1; i >= 0; i--) {
    if (line >= symbols[i].line && line <= symbols[i].endLine) {
      if (!best || symbols[i].indent > best.indent) best = symbols[i]
    }
  }
  if (!best) return []
  const chain: BreadcrumbSymbol[] = []
  let current: BreadcrumbSymbol | null = best
  while (current) { chain.unshift(current); current = current.parent }
  return chain
}

function findSymbolAtLine(symbols: BreadcrumbSymbol[], line: number): BreadcrumbSymbol | null {
  for (let i = symbols.length - 1; i >= 0; i--) { if (line >= symbols[i].line && line <= symbols[i].endLine) return symbols[i] }
  return null
}
const symbolKindIcons: Record<string, typeof Hash> = { function: Hash, class: Box, interface: Braces, type: TypeIcon, variable: Hash, const: Hash, method: Hash, property: Hash }
const symbolKindColors: Record<string, string> = { function: '#dcdcaa', class: '#4ec9b0', interface: '#4ec9b0', type: '#4ec9b0', variable: '#9cdcfe', const: '#4fc1ff', method: '#dcdcaa', property: '#9cdcfe' }

/* ── BreadcrumbDropdown ── */
interface DirEntry { name: string; path: string; type: 'file' | 'directory' }
function BreadcrumbDropdown({ dirPath, anchorRect, onClose, onNavigateFolder }: { dirPath: string; anchorRect: { left: number; top: number; bottom: number }; onClose: () => void; onNavigateFolder: (p: string) => void }) {
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDir, setCurrentDir] = useState(dirPath)
  const [filter, setFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { openFile } = useBreadcrumbEditorStore()

  useEffect(() => {
    setLoading(true)
    window.api.readDir(currentDir).then((tree: any[]) => {
      const items: DirEntry[] = (tree || []).map((n: any) => ({ name: n.name, path: n.path, type: n.type as 'file' | 'directory' }))
      items.sort((a, b) => { if (a.type !== b.type) return a.type === 'directory' ? -1 : 1; return a.name.localeCompare(b.name) })
      setEntries(items); setLoading(false)
    }).catch(() => { setEntries([]); setLoading(false) })
  }, [currentDir])

  useEffect(() => { setTimeout(() => filterInputRef.current?.focus(), 50) }, [currentDir])
  useEffect(() => { setSelectedIndex(0) }, [filter])
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  useEffect(() => { const h = (e: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) onClose() }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [onClose])

  const filtered = useMemo(() => {
    if (!filter.trim()) return entries
    const lower = filter.toLowerCase()
    return entries.filter(e => e.name.toLowerCase().includes(lower))
  }, [entries, filter])

  const handleClickEntry = async (entry: DirEntry) => {
    if (entry.type === 'directory') { setCurrentDir(entry.path); setFilter(''); onNavigateFolder(entry.path) }
    else { try { const r = await window.api.readFile(entry.path); openFile({ path: entry.path, name: entry.name, content: r.content, language: r.language, isModified: false, aiModified: false }); onClose() } catch { onClose() } }
  }
  const handleGoUp = () => { const p = currentDir.replace(/\\/g, '/').replace(/\/[^/]+$/, ''); if (p && p !== currentDir) { setCurrentDir(p.replace(/\//g, currentDir.includes('\\') ? '\\' : '/')); setFilter('') } }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && filtered[selectedIndex]) { e.preventDefault(); handleClickEntry(filtered[selectedIndex]) }
    if (e.key === 'Backspace' && !filter) { e.preventDefault(); handleGoUp() }
  }

  return (
    <div ref={dropdownRef} style={{ position: 'fixed', left: Math.min(anchorRect.left, window.innerWidth - 250), top: anchorRect.bottom + 2, width: 240, maxHeight: 340, background: 'var(--bg-secondary)', border: '1px solid var(--border-bright)', borderRadius: 6, boxShadow: '0 6px 20px rgba(0,0,0,0.4)', zIndex: 9999, fontSize: 12, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)', padding: '3px 6px' }}>
          <Search size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input ref={filterInputRef} type="text" placeholder="Filter..." value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={handleKeyDown}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 11, fontFamily: 'inherit' }} />
        </div>
      </div>
      {currentDir !== dirPath && (
        <div role="button" tabIndex={0} onClick={handleGoUp}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleGoUp() } }}
          style={{ padding: '4px 10px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 2 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
          <ChevronRight size={10} style={{ transform: 'rotate(180deg)' }} /> ..
        </div>
      )}
      <div ref={listRef} style={{ overflowY: 'auto', padding: '4px 0', flex: 1 }}>
        {loading ? (
          <div style={{ padding: '8px 10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}><Loader2 size={12} className="anim-spin" /> Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '8px 10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>{filter ? 'No matches' : 'Empty directory'}</div>
        ) : filtered.map((entry, idx) => (
          <div key={entry.path} role="button" tabIndex={0} onClick={() => handleClickEntry(entry)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClickEntry(entry) } }}
            onMouseEnter={() => setSelectedIndex(idx)}
            style={{
              padding: '3px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              color: 'var(--text-primary)', transition: 'background 0.1s',
              background: idx === selectedIndex ? 'var(--bg-hover)' : 'transparent',
            }}>
            {entry.type === 'directory' ? <FolderIcon size={14} /> : <FileIcon fileName={entry.name} size={14} />}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
            {entry.type === 'directory' && <ChevronRight size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── SymbolDropdown ── */
function SymbolDropdown({ symbols, anchorRect, onClose, highlightedSymbol }: { symbols: BreadcrumbSymbol[]; anchorRect: { left: number; top: number; bottom: number }; onClose: () => void; highlightedSymbol?: string | null }) {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])
  useEffect(() => { const h = (e: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) onClose() }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [onClose])
  useEffect(() => { setSelectedIndex(0) }, [filter])
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const filtered = filter.trim() ? symbols.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase())) : symbols
  const goToLine = (line: number) => { window.dispatchEvent(new CustomEvent('orion:go-to-line', { detail: { line } })); onClose() }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && filtered[selectedIndex]) { e.preventDefault(); goToLine(filtered[selectedIndex].line) }
  }

  return (
    <div ref={dropdownRef} style={{ position: 'fixed', left: Math.min(anchorRect.left, window.innerWidth - 260), top: anchorRect.bottom + 2, width: 260, maxHeight: 340, background: 'var(--bg-secondary)', border: '1px solid var(--border-bright)', borderRadius: 6, boxShadow: '0 6px 20px rgba(0,0,0,0.4)', zIndex: 9999, fontSize: 12, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)', padding: '3px 6px' }}>
          <Search size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input ref={inputRef} type="text" placeholder="Filter symbols..." value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={handleKeyDown}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 11, fontFamily: 'inherit' }} />
        </div>
      </div>
      <div ref={listRef} style={{ overflowY: 'auto', padding: '4px 0', flex: 1 }}>
        {filtered.length === 0 ? (<div style={{ padding: '8px 10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No symbols found</div>) : filtered.map((sym, i) => {
          const Icon = symbolKindIcons[sym.kind] || Hash
          const color = symbolKindColors[sym.kind] || 'var(--text-muted)'
          const isHighlighted = highlightedSymbol === sym.name && sym.line === filtered[i]?.line
          return (
            <div key={`${sym.name}-${sym.line}-${i}`} role="button" tabIndex={0} onClick={() => goToLine(sym.line)}
              onMouseEnter={() => setSelectedIndex(i)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToLine(sym.line) } }}
              style={{
                padding: '3px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                color: isHighlighted ? 'var(--accent)' : 'var(--text-primary)', transition: 'background 0.1s',
                background: i === selectedIndex ? 'var(--bg-hover)' : 'transparent',
                fontWeight: isHighlighted ? 600 : 400,
              }}>
              <Icon size={12} style={{ color, flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace" }}>{sym.name}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>:{sym.line}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Enhanced Breadcrumbs (VS Code style) ── */
function Breadcrumbs({ path, saving, content, language }: { path: string; saving: boolean; content: string; language: string }) {
  const normalizedPath = path.replace(/\\/g, '/')
  const segments = normalizedPath.split('/').filter(Boolean)
  const fileName = segments.pop() || ''
  const dirSegments = segments.slice(-3)
  const truncatedCount = Math.max(0, segments.length - 3)

  const [openDropdownIndex, setOpenDropdownIndex] = useState<number | null>(null)
  const [dropdownRect, setDropdownRect] = useState<{ left: number; top: number; bottom: number } | null>(null)
  const [dropdownDirPath, setDropdownDirPath] = useState<string | null>(null)
  const [cursorLine, setCursorLine] = useState(1)
  const [symbolDropdownOpen, setSymbolDropdownOpen] = useState(false)
  const [symbolDropdownRect, setSymbolDropdownRect] = useState<{ left: number; top: number; bottom: number } | null>(null)
  const [focusedSegment, setFocusedSegment] = useState<number | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const breadcrumbBarRef = useRef<HTMLDivElement>(null)
  const segmentRefs = useRef<(HTMLSpanElement | null)[]>([])
  const [symbolDropdownForChainIndex, setSymbolDropdownForChainIndex] = useState<number | null>(null)

  const allSymbols = useMemo(() => content ? extractBreadcrumbSymbols(content, language || 'typescript') : [], [content, language])
  const symbolChain = useMemo(() => findSymbolChainAtLine(allSymbols, cursorLine), [allSymbols, cursorLine])
  const currentSymbol = symbolChain.length > 0 ? symbolChain[symbolChain.length - 1] : null

  // Total segments for keyboard nav: dirSegments + file + symbolChain items (or fallback "symbols" label)
  const totalSegments = dirSegments.length + 1 + symbolChain.length + (symbolChain.length === 0 && allSymbols.length > 0 ? 1 : 0)

  // Listen for cursor position changes
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.line) setCursorLine(d.line) }
    window.addEventListener('orion:cursor-position', h)
    return () => window.removeEventListener('orion:cursor-position', h)
  }, [])

  // Reset dropdowns when path changes
  useEffect(() => { setOpenDropdownIndex(null); setSymbolDropdownOpen(false); setFocusedSegment(null); setIsFocused(false) }, [path])

  // Keyboard shortcut: Ctrl+Shift+. to focus breadcrumbs
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === '.') {
        e.preventDefault()
        setIsFocused(true)
        setFocusedSegment(0)
        setTimeout(() => segmentRefs.current[0]?.focus(), 0)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const closeAllDropdowns = useCallback(() => {
    setOpenDropdownIndex(null); setDropdownRect(null); setDropdownDirPath(null)
    setSymbolDropdownOpen(false); setSymbolDropdownForChainIndex(null)
  }, [])

  const handleSegmentClick = (segmentIndex: number, e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const fullIndex = truncatedCount + segmentIndex
    const pathParts = segments.slice(0, fullIndex + 1)
    let dirPath = normalizedPath.startsWith('/') ? '/' + pathParts.join('/') : pathParts.join('/')
    if (path.includes('\\')) dirPath = dirPath.replace(/\//g, '\\')
    if (openDropdownIndex === segmentIndex) { closeAllDropdowns() }
    else { closeAllDropdowns(); setOpenDropdownIndex(segmentIndex); setDropdownRect({ left: rect.left, top: rect.top, bottom: rect.bottom }); setDropdownDirPath(dirPath) }
  }

  const handleFileNameClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    let dirPath = normalizedPath.startsWith('/') ? '/' + segments.join('/') : segments.join('/')
    if (path.includes('\\')) dirPath = dirPath.replace(/\//g, '\\')
    if (openDropdownIndex === -1) { closeAllDropdowns() }
    else { closeAllDropdowns(); setOpenDropdownIndex(-1); setDropdownRect({ left: rect.left, top: rect.top, bottom: rect.bottom }); setDropdownDirPath(dirPath) }
  }

  const handleSymbolClick = (e: React.MouseEvent, chainIndex?: number) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (symbolDropdownOpen && symbolDropdownForChainIndex === (chainIndex ?? null)) { closeAllDropdowns() }
    else {
      closeAllDropdowns()
      setSymbolDropdownOpen(true)
      setSymbolDropdownRect({ left: rect.left, top: rect.top, bottom: rect.bottom })
      setSymbolDropdownForChainIndex(chainIndex ?? null)
    }
  }

  // Keyboard navigation within breadcrumbs
  const handleBreadcrumbKeyDown = (e: React.KeyboardEvent, segIndex: number) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeAllDropdowns()
      setIsFocused(false)
      setFocusedSegment(null)
      window.dispatchEvent(new CustomEvent('orion:focus-editor'))
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = Math.min(segIndex + 1, totalSegments - 1)
      setFocusedSegment(next)
      setTimeout(() => segmentRefs.current[next]?.focus(), 0)
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const prev = Math.max(segIndex - 1, 0)
      setFocusedSegment(prev)
      setTimeout(() => segmentRefs.current[prev]?.focus(), 0)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const el = segmentRefs.current[segIndex]
      if (el) el.click()
    }
  }

  const closeDropdown = useCallback(() => { setOpenDropdownIndex(null); setDropdownRect(null); setDropdownDirPath(null) }, [])
  const closeSymbolDropdown = useCallback(() => { setSymbolDropdownOpen(false); setSymbolDropdownForChainIndex(null) }, [])

  // Resolve which symbols to show in the symbol dropdown
  const symbolDropdownSymbols = useMemo(() => {
    if (symbolDropdownForChainIndex !== null && symbolChain[symbolDropdownForChainIndex]) {
      const clickedSym = symbolChain[symbolDropdownForChainIndex]
      if (clickedSym.children.length > 0) return clickedSym.children
      if (clickedSym.parent) return clickedSym.parent.children
      return allSymbols.filter(s => !s.parent)
    }
    return allSymbols
  }, [allSymbols, symbolChain, symbolDropdownForChainIndex])

  // Separator arrow style
  const sepStyle: React.CSSProperties = { opacity: 0.35, flexShrink: 0, margin: '0 2px', color: 'var(--text-muted)', fontSize: 11, lineHeight: '22px', userSelect: 'none' }

  let segRefIdx = 0

  return (
    <div ref={breadcrumbBarRef} className="flex-1 flex items-center overflow-x-auto" style={{
      height: 22, background: 'var(--bg-primary)', fontSize: 12, color: 'var(--text-muted)',
      padding: '0 10px', gap: 0, position: 'relative',
      scrollbarWidth: 'none',
    }}>
      {/* Ellipsis for truncated segments */}
      {segments.length > 3 && (
        <>
          <span style={{ opacity: 0.4, flexShrink: 0, fontSize: 11 }}>...</span>
          <span style={sepStyle}>&#x203A;</span>
        </>
      )}

      {/* Directory segments with folder icons */}
      {dirSegments.map((seg, i) => {
        const refI = segRefIdx++
        const isActive = openDropdownIndex === i
        return (
          <span key={i} className="flex items-center" style={{ flexShrink: 0 }}>
            <span
              ref={(el) => { segmentRefs.current[refI] = el }}
              role="button" tabIndex={isFocused ? 0 : -1}
              onClick={(e) => handleSegmentClick(i, e)}
              onKeyDown={(e) => handleBreadcrumbKeyDown(e, refI)}
              style={{
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                padding: '1px 4px', borderRadius: 3, cursor: 'pointer',
                transition: 'color 0.1s, background 0.1s',
                background: isActive ? 'rgba(255,255,255,0.08)' : (focusedSegment === refI ? 'rgba(255,255,255,0.04)' : 'transparent'),
                display: 'inline-flex', alignItems: 'center', gap: 3,
                outline: focusedSegment === refI ? '1px solid var(--accent)' : 'none',
                outlineOffset: -1,
              }}
              onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)' } }}
              onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' } }}
            >
              <FolderIcon size={12} />
              {seg}
            </span>
            <span style={sepStyle}>&#x203A;</span>
          </span>
        )
      })}

      {/* File name segment with file-type icon */}
      {(() => {
        const refI = segRefIdx++
        const isActive = openDropdownIndex === -1
        return (
          <span
            ref={(el) => { segmentRefs.current[refI] = el }}
            role="button" tabIndex={isFocused ? 0 : -1}
            onClick={handleFileNameClick}
            onKeyDown={(e) => handleBreadcrumbKeyDown(e, refI)}
            style={{
              color: isActive ? 'var(--text-primary)' : 'var(--text-primary)',
              fontWeight: 400, flexShrink: 0, padding: '1px 4px', borderRadius: 3, cursor: 'pointer',
              transition: 'color 0.1s, background 0.1s',
              background: isActive ? 'rgba(255,255,255,0.08)' : (focusedSegment === refI ? 'rgba(255,255,255,0.04)' : 'transparent'),
              display: 'inline-flex', alignItems: 'center', gap: 3,
              outline: focusedSegment === refI ? '1px solid var(--accent)' : 'none',
              outlineOffset: -1,
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
          >
            <FileIcon fileName={fileName} size={12} />
            {fileName}
          </span>
        )
      })()}

      {/* Symbol chain breadcrumbs (e.g. class > method > ...) */}
      {symbolChain.length > 0 && symbolChain.map((sym, chainIdx) => {
        const refI = segRefIdx++
        const Icon = symbolKindIcons[sym.kind] || Hash
        const color = symbolKindColors[sym.kind] || 'var(--text-muted)'
        const isLast = chainIdx === symbolChain.length - 1
        const isActive = symbolDropdownOpen && symbolDropdownForChainIndex === chainIdx
        return (
          <span key={`sym-${sym.name}-${sym.line}`} className="flex items-center" style={{ flexShrink: 0 }}>
            <span style={sepStyle}>&#x203A;</span>
            <span
              ref={(el) => { segmentRefs.current[refI] = el }}
              role="button" tabIndex={isFocused ? 0 : -1}
              onClick={(e) => handleSymbolClick(e, chainIdx)}
              onKeyDown={(e) => handleBreadcrumbKeyDown(e, refI)}
              style={{
                color: isActive ? 'var(--accent)' : (isLast ? color : 'var(--text-muted)'),
                flexShrink: 0, padding: '1px 4px', borderRadius: 3, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
                fontSize: 11, transition: 'color 0.1s, background 0.1s',
                background: isActive ? 'rgba(255,255,255,0.08)' : (focusedSegment === refI ? 'rgba(255,255,255,0.04)' : 'transparent'),
                fontWeight: isLast ? 500 : 400,
                outline: focusedSegment === refI ? '1px solid var(--accent)' : 'none',
                outlineOffset: -1,
              }}
              onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)' } }}
              onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.color = isLast ? color : 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' } }}
            >
              <Icon size={11} style={{ color, flexShrink: 0 }} />
              {sym.name}
            </span>
          </span>
        )
      })}

      {/* Fallback: show clickable "symbols" label when no symbol chain but symbols exist */}
      {symbolChain.length === 0 && allSymbols.length > 0 && (() => {
        const refI = segRefIdx++
        const isActive = symbolDropdownOpen && symbolDropdownForChainIndex === null
        return (
          <>
            <span style={sepStyle}>&#x203A;</span>
            <span
              ref={(el) => { segmentRefs.current[refI] = el }}
              role="button" tabIndex={isFocused ? 0 : -1}
              onClick={(e) => handleSymbolClick(e)}
              onKeyDown={(e) => handleBreadcrumbKeyDown(e, refI)}
              style={{
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                flexShrink: 0, padding: '1px 4px', borderRadius: 3, cursor: 'pointer',
                fontSize: 11, fontStyle: 'italic', transition: 'color 0.1s, background 0.1s',
                background: isActive ? 'rgba(255,255,255,0.08)' : (focusedSegment === refI ? 'rgba(255,255,255,0.04)' : 'transparent'),
                outline: focusedSegment === refI ? '1px solid var(--accent)' : 'none',
                outlineOffset: -1,
              }}
              onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)' } }}
              onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' } }}
            >symbols</span>
          </>
        )
      })()}

      {/* Saving indicator */}
      {saving && (
        <span className="ml-auto flex items-center gap-1" style={{ fontSize: 10, color: 'var(--accent-green)', flexShrink: 0 }}>
          <Loader2 size={10} className="anim-spin" /> Saved
        </span>
      )}

      {/* Dropdowns */}
      {openDropdownIndex !== null && dropdownRect && dropdownDirPath && (
        <BreadcrumbDropdown dirPath={dropdownDirPath} anchorRect={dropdownRect} onClose={closeDropdown} onNavigateFolder={(p) => { setDropdownDirPath(p) }} />
      )}
      {symbolDropdownOpen && symbolDropdownRect && symbolDropdownSymbols.length > 0 && (
        <SymbolDropdown symbols={symbolDropdownSymbols} anchorRect={symbolDropdownRect} onClose={closeSymbolDropdown} highlightedSymbol={currentSymbol?.name} />
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

  // Drag-to-pan state
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number }>({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 })

  const src = filePathToFileUrl(filePath)
  const ext = filePath.replace(/\\/g, '/').split('/').pop()?.split('.').pop()?.toLowerCase() || ''
  const fileName = filePath.replace(/\\/g, '/').split('/').pop() || ''

  // Reset state when file changes
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
    setZoom((z) => Math.min(z + 0.25, 10))
  }

  const handleZoomOut = () => {
    setFitMode('custom')
    setZoom((z) => Math.max(z - 0.25, 0.1))
  }

  const handleFit = () => {
    setFitMode('fit')
    setZoom(1)
  }

  const handleActualSize = () => {
    setFitMode('actual')
    setZoom(1)
  }

  const toggleFitActual = () => {
    if (fitMode === 'fit') {
      setFitMode('actual')
      setZoom(1)
    } else {
      setFitMode('fit')
      setZoom(1)
    }
  }

  // Drag-to-pan handlers
  const canPan = fitMode !== 'fit' || zoom > 1

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!canPan || !containerRef.current) return
    setIsPanning(true)
    panStart.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop,
    }
    e.preventDefault()
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || !containerRef.current) return
    const dx = e.clientX - panStart.current.x
    const dy = e.clientY - panStart.current.y
    containerRef.current.scrollLeft = panStart.current.scrollLeft - dx
    containerRef.current.scrollTop = panStart.current.scrollTop - dy
  }

  const handleMouseUp = () => {
    setIsPanning(false)
  }

  // Mouse wheel zoom (Ctrl+scroll)
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setFitMode('custom')
      setZoom((z) => Math.max(0.1, Math.min(10, z + delta)))
    }
  }

  // Checkerboard background for transparency
  const checkeredBg = `
    linear-gradient(45deg, rgba(255,255,255,0.03) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255,255,255,0.03) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.03) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.03) 75%)
  `.trim()

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        fontSize: 11,
        color: 'var(--text-muted)',
        flexShrink: 0,
      }}>
        <ImageIcon size={12} />
        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{fileName}</span>
        <span style={{ margin: '0 4px', opacity: 0.4 }}>|</span>
        {dimensions && (
          <span>{dimensions.width} &times; {dimensions.height}</span>
        )}
        {fileSize && (
          <>
            <span style={{ margin: '0 4px', opacity: 0.4 }}>|</span>
            <span>{fileSize}</span>
          </>
        )}
        <span style={{ margin: '0 4px', opacity: 0.4 }}>|</span>
        <span style={{ textTransform: 'uppercase', opacity: 0.7 }}>{ext}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, alignItems: 'center' }}>
          <ImagePreviewButton onClick={handleZoomOut} title="Zoom Out">
            <ZoomOut size={14} />
          </ImagePreviewButton>
          <span style={{
            padding: '0 6px',
            fontSize: 11,
            minWidth: 40,
            textAlign: 'center',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text-secondary)',
          }}>
            {fitMode === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}
          </span>
          <ImagePreviewButton onClick={handleZoomIn} title="Zoom In">
            <ZoomIn size={14} />
          </ImagePreviewButton>
          <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
          <ImagePreviewButton
            onClick={handleFit}
            title="Fit to View"
            active={fitMode === 'fit'}
          >
            <Minimize2 size={14} />
          </ImagePreviewButton>
          <ImagePreviewButton
            onClick={handleActualSize}
            title="Actual Size (100%)"
            active={fitMode === 'actual'}
          >
            <Maximize2 size={14} />
          </ImagePreviewButton>
        </div>
      </div>

      {/* Image viewport */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
          backgroundImage: checkeredBg,
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
          backgroundColor: '#1e1e1e',
          cursor: canPan ? (isPanning ? 'grabbing' : 'grab') : 'default',
          userSelect: 'none',
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
            onDoubleClick={toggleFitActual}
            draggable={false}
            style={{
              maxWidth: fitMode === 'fit' ? '90%' : undefined,
              maxHeight: fitMode === 'fit' ? '90%' : undefined,
              transform: fitMode !== 'fit' ? `scale(${zoom})` : undefined,
              transformOrigin: 'center center',
              transition: 'transform 0.15s ease',
              imageRendering: zoom > 2 ? 'pixelated' : 'auto',
              borderRadius: 4,
              boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
            }}
          />
        )}
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
