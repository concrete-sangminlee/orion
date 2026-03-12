import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import Editor, { DiffEditor as MonacoDiffEditorComponent, type Monaco } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { useProblemsStore } from '@/store/problems'
import { useThemeStore } from '@/store/theme'
import { useSnippetStore } from '@/store/snippets'
import { useAutoSave, clearRecovery } from '@/hooks/useAutoSave'
import TabBar from '@/components/TabBar'
import WelcomeTab from '@/components/WelcomeTab'
import InlineEdit from '@/components/InlineEdit'
import InlineDiff from '@/components/InlineDiff'
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
import TimelinePanel from '@/components/TimelinePanel'
import FileIcon, { FolderIcon } from '@/components/FileIcon'
import { registerCodeActionProviders } from '@/providers/codeActions'
import { registerLanguageProviders } from '@/providers/languageProviders'

// ── Types for git gutter decorations ──────────────────
interface DiffHunk {
  type: 'added' | 'modified' | 'deleted'
  startLine: number
  count: number
}

// ── Named CSS colors (top 20) for inline color decorators ──────────────────
const NAMED_CSS_COLORS: Record<string, string> = {
  red: '#ff0000', blue: '#0000ff', green: '#008000', yellow: '#ffff00',
  orange: '#ffa500', purple: '#800080', white: '#ffffff', black: '#000000',
  gray: '#808080', pink: '#ffc0cb', brown: '#a52a2a', cyan: '#00ffff',
  magenta: '#ff00ff', lime: '#00ff00', navy: '#000080', teal: '#008080',
  silver: '#c0c0c0', gold: '#ffd700', coral: '#ff7f50', tomato: '#ff6347',
}
const NAMED_COLOR_PATTERN = Object.keys(NAMED_CSS_COLORS).join('|')

// ── CSS color regex for inline color decorators ──────────────────
const CSS_COLOR_REGEX = new RegExp(
  `#(?:[0-9a-fA-F]{3,4}){1,2}\\b` +
  `|rgba?\\(\\s*\\d+\\s*,\\s*\\d+\\s*,\\s*\\d+\\s*(?:,\\s*[\\d.]+\\s*)?\\)` +
  `|hsla?\\(\\s*\\d+\\s*,\\s*\\d+%?\\s*,\\s*\\d+%?\\s*(?:,\\s*[\\d.]+\\s*)?\\)` +
  `|\\b(?:${NAMED_COLOR_PATTERN})\\b`,
  'gi'
)

interface ColorMatch {
  line: number
  startCol: number
  endCol: number
  color: string
}

/**
 * Detect color values in source text.
 * Returns an array of { line, startCol, endCol, color } objects.
 */
function detectColors(content: string): ColorMatch[] {
  const results: ColorMatch[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const lineContent = lines[i]
    CSS_COLOR_REGEX.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = CSS_COLOR_REGEX.exec(lineContent)) !== null) {
      const raw = m[0]
      // For named colors, resolve to hex; otherwise use raw value
      const resolved = NAMED_CSS_COLORS[raw.toLowerCase()] || raw
      results.push({
        line: i + 1,
        startCol: m.index + 1,
        endCol: m.index + 1 + raw.length,
        color: resolved,
      })
    }
  }
  return results
}

/** Simple string hash for generating unique class names */
function colorHash(color: string): string {
  let h = 0
  for (let i = 0; i < color.length; i++) {
    h = ((h << 5) - h + color.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

/** Convert various color formats to an rgba() string for the color picker */
function colorToRGBA(color: string): { r: number; g: number; b: number; a: number } | null {
  // Hex
  const hexMatch = color.match(/^#([0-9a-fA-F]{3,8})$/)
  if (hexMatch) {
    const hex = hexMatch[1]
    let r: number, g: number, b: number, a = 1
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16) / 255
      g = parseInt(hex[1] + hex[1], 16) / 255
      b = parseInt(hex[2] + hex[2], 16) / 255
    } else if (hex.length === 4) {
      r = parseInt(hex[0] + hex[0], 16) / 255
      g = parseInt(hex[1] + hex[1], 16) / 255
      b = parseInt(hex[2] + hex[2], 16) / 255
      a = parseInt(hex[3] + hex[3], 16) / 255
    } else if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16) / 255
      g = parseInt(hex.slice(2, 4), 16) / 255
      b = parseInt(hex.slice(4, 6), 16) / 255
    } else if (hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16) / 255
      g = parseInt(hex.slice(2, 4), 16) / 255
      b = parseInt(hex.slice(4, 6), 16) / 255
      a = parseInt(hex.slice(6, 8), 16) / 255
    } else {
      return null
    }
    return { r, g, b, a }
  }
  // rgb/rgba
  const rgbMatch = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1]) / 255,
      g: parseInt(rgbMatch[2]) / 255,
      b: parseInt(rgbMatch[3]) / 255,
      a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1,
    }
  }
  // hsl/hsla – convert to rgb
  const hslMatch = color.match(/^hsla?\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (hslMatch) {
    const h = parseInt(hslMatch[1]) / 360
    const s = parseInt(hslMatch[2]) / 100
    const l = parseInt(hslMatch[3]) / 100
    const a = hslMatch[4] !== undefined ? parseFloat(hslMatch[4]) : 1
    let r: number, g: number, b: number
    if (s === 0) {
      r = g = b = l
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1
        if (t > 1) t -= 1
        if (t < 1 / 6) return p + (q - p) * 6 * t
        if (t < 1 / 2) return q
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
        return p
      }
      const q2 = l < 0.5 ? l * (1 + s) : l + s - l * s
      const p2 = 2 * l - q2
      r = hue2rgb(p2, q2, h + 1 / 3)
      g = hue2rgb(p2, q2, h)
      b = hue2rgb(p2, q2, h - 1 / 3)
    }
    return { r, g, b, a }
  }
  return null
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
  const { openFiles, activeFilePath, updateFileContent, markSaved, closeFile, closeAllFiles, reloadFileContent, dismissExternalChange } = useEditorStore()
  const addToast = useToastStore((s) => s.addToast)
  const getSnippetsForLanguage = useSnippetStore((s) => s.getSnippetsForLanguage)
  const activeFile = openFiles.find((f) => f.path === activeFilePath)
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const { scheduleAutoSave } = useAutoSave()

  // Editor config state – initialised from saved settings, if any
  const [editorConfig, setEditorConfig] = useState(() => {
    const defaults = {
      fontSize: 14, minimap: true, wordWrap: false,
      fontFamily: 'Cascadia Code', lineHeight: 1.5,
      fontLigatures: true, cursorStyle: 'line' as string,
      renderWhitespace: 'selection' as string, letterSpacing: 0,
      formatOnSave: false, trimTrailingWhitespace: true, insertFinalNewline: true,
    }
    try {
      const stored = localStorage.getItem('orion-editor-settings')
      if (stored) {
        const parsed = JSON.parse(stored)
        return { ...defaults, ...parsed }
      }
    } catch { /* ignore */ }
    return defaults
  })
  const minimapRef = useRef(editorConfig.minimap)

  // Inline edit (Ctrl+K) state
  const [inlineEditVisible, setInlineEditVisible] = useState(false)
  const [inlineEditPos, setInlineEditPos] = useState({ top: 60, left: 100 })
  const [inlineEditText, setInlineEditText] = useState('')
  const [inlineProcessing, setInlineProcessing] = useState(false)
  const [inlineEditSelRange, setInlineEditSelRange] = useState<{ startLine: number; endLine: number } | null>(null)
  const [inlineEditAiResponse, setInlineEditAiResponse] = useState<string | null>(null)
  const inlineEditSelectionRef = useRef<MonacoEditor.ISelection | null>(null)

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
  const colorStyleElRef = useRef<HTMLStyleElement | null>(null)
  const colorDecoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorLensDecorationsRef = useRef<string[]>([])
  // Track recent edits per function for "Modified N minutes ago" CodeLens
  const recentEditsMapRef = useRef<Map<string, number>>(new Map())
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
      const filePath = (droppedFile as any).path as string | undefined
      if (filePath) {
        try {
          const tree = await window.api.readDir(filePath)
          if (tree && Array.isArray(tree) && tree.length >= 0) {
            // It's a valid directory - set as workspace root
            setRootPath(filePath)
            await useWorkspaceStore.getState().loadWorkspaceSettings(filePath)
            setFileTree(tree)
            window.api.watchStart(filePath)
            addToast({ type: 'success', message: `Opened folder: ${droppedFile.name}`, duration: 2000 })
            return
          }
        } catch {
          // Not a directory, fall through to open as file
        }
      }
    }

    let openedCount = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      // Electron exposes .path on dropped File objects
      const filePath = (file as any).path as string | undefined
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

      // Auto-save (mode & delay handled by the hook)
      scheduleAutoSave(activeFilePath, value)
    }
  }

  const handleEditorMount = (editor: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

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

    // Register snippet completions for TS/JS languages
    if (monaco) {
      const snippetLanguages = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact']
      for (const lang of snippetLanguages) {
        monaco.languages.registerCompletionItemProvider(lang, {
          provideCompletionItems: (model, position) => {
            const word = model.getWordUntilPosition(position)
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            }

            return {
              suggestions: [
                {
                  label: 'useState',
                  kind: monaco.languages.CompletionItemKind.Snippet,
                  insertText: 'const [${1:state}, set${1/(.*)/${1:/capitalize}/}] = useState(${2:initialValue})',
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  documentation: 'React useState hook',
                  range,
                },
                {
                  label: 'useEffect',
                  kind: monaco.languages.CompletionItemKind.Snippet,
                  insertText: 'useEffect(() => {\n\t${1}\n}, [${2}])',
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  documentation: 'React useEffect hook',
                  range,
                },
                {
                  label: 'comp',
                  kind: monaco.languages.CompletionItemKind.Snippet,
                  insertText: 'export default function ${1:Component}() {\n\treturn (\n\t\t<div>\n\t\t\t${2}\n\t\t</div>\n\t)\n}',
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  documentation: 'React functional component',
                  range,
                },
              ],
            }
          },
        })
      }
    }

    // Register Ctrl+K for inline edit (Cursor-style)
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

        // Store the selection for later use
        inlineEditSelectionRef.current = selection

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

    // ── Color picker: register a DocumentColorProvider so Monaco shows native color picker ──
    const colorProviderLanguages = [
      'css', 'scss', 'less', 'html', 'javascript', 'typescript',
      'javascriptreact', 'typescriptreact', 'json', 'jsonc',
    ]
    for (const lang of colorProviderLanguages) {
      monaco.languages.registerColorProvider(lang, {
        provideDocumentColors: (model) => {
          const text = model.getValue()
          const colorMatches = detectColors(text)
          const results: { range: InstanceType<typeof monaco.Range>; color: { red: number; green: number; blue: number; alpha: number } }[] = []
          for (const cm of colorMatches) {
            const rgba = colorToRGBA(cm.color)
            if (!rgba) continue
            results.push({
              range: new monaco.Range(cm.line, cm.startCol, cm.line, cm.endCol),
              color: { red: rgba.r, green: rgba.g, blue: rgba.b, alpha: rgba.a },
            })
          }
          return { colors: results, dispose: () => {} }
        },
        provideColorPresentations: (model, colorInfo) => {
          const { red, green, blue, alpha } = colorInfo.color
          const r = Math.round(red * 255)
          const g = Math.round(green * 255)
          const b = Math.round(blue * 255)
          const presentations: { label: string; textEdit?: { range: InstanceType<typeof monaco.Range>; text: string } }[] = []

          // Hex presentation
          const hexR = r.toString(16).padStart(2, '0')
          const hexG = g.toString(16).padStart(2, '0')
          const hexB = b.toString(16).padStart(2, '0')
          if (alpha < 1) {
            const hexA = Math.round(alpha * 255).toString(16).padStart(2, '0')
            presentations.push({
              label: `#${hexR}${hexG}${hexB}${hexA}`,
              textEdit: { range: colorInfo.range, text: `#${hexR}${hexG}${hexB}${hexA}` },
            })
          } else {
            presentations.push({
              label: `#${hexR}${hexG}${hexB}`,
              textEdit: { range: colorInfo.range, text: `#${hexR}${hexG}${hexB}` },
            })
          }

          // RGBA presentation
          if (alpha < 1) {
            presentations.push({
              label: `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`,
              textEdit: { range: colorInfo.range, text: `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})` },
            })
          } else {
            presentations.push({
              label: `rgb(${r}, ${g}, ${b})`,
              textEdit: { range: colorInfo.range, text: `rgb(${r}, ${g}, ${b})` },
            })
          }

          return presentations
        },
      })
    }

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

    // ── CodeLens provider: references, implementations, tests, AI, recent changes ──
    const codeLensLanguages = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact']
    const CL_FUNC_DEF = /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|(?:\w+)\s*=>)|class\s+(\w+))/
    const CL_IFACE = /^[ \t]*(?:export\s+)?(?:interface|type)\s+(\w+)/
    const CL_EXPORT = /^[ \t]*export\s+(?:default\s+)?(?:function|const|let|var|class|interface|type|enum|abstract)\s+(\w+)/
    const CL_TEST_BLOCK = /^[ \t]*(?:describe|it|test)\s*\(\s*['"`](.+?)['"`]/

    // Helper: count references across all open editor models
    const countRefsAcrossModels = (sym: string): number => {
      const re = new RegExp(`\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
      let n = 0
      for (const m of monaco.editor.getModels()) { const hits = m.getValue().match(re); if (hits) n += hits.length }
      return n
    }

    // Helper: count implementations (implements/extends) across all open models
    const countImpl = (iface: string): number => {
      const re = new RegExp(`\\b(?:implements|extends)\\s+(?:[\\w,\\s]*\\b)?${iface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
      let n = 0
      for (const m of monaco.editor.getModels()) { const hits = m.getValue().match(re); if (hits) n += hits.length }
      return n
    }

    // Helper: find the closing brace line for a block starting at startLine
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findBlockEnd = (mdl: any, startLine: number): number => {
      const lc = mdl.getLineCount()
      let depth = 0; let opened = false
      for (let ln = startLine; ln <= lc; ln++) {
        const c = mdl.getLineContent(ln)
        for (const ch of c) {
          if (ch === '{') { depth++; opened = true } else if (ch === '}') { depth-- }
          if (opened && depth === 0) return ln
        }
      }
      return startLine
    }

    // Track edits for "Modified N minutes ago" CodeLens
    editor.onDidChangeModelContent(() => {
      const mdl = editor.getModel()
      if (!mdl) return
      const pos = editor.getPosition()
      if (!pos) return
      const curLine = mdl.getLineContent(pos.lineNumber)
      const curMatch = CL_FUNC_DEF.exec(curLine)
      if (curMatch) {
        const nm = curMatch[1] || curMatch[2] || curMatch[3]
        if (nm) recentEditsMapRef.current.set(`${mdl.uri.toString()}:${nm}`, Date.now())
      }
      // Check above lines to find enclosing function
      for (let off = 1; off <= 30; off++) {
        const ln = pos.lineNumber - off
        if (ln < 1) break
        const above = mdl.getLineContent(ln)
        const am = CL_FUNC_DEF.exec(above)
        if (am) {
          const nm = am[1] || am[2] || am[3]
          if (nm && pos.lineNumber <= findBlockEnd(mdl, ln)) {
            recentEditsMapRef.current.set(`${mdl.uri.toString()}:${nm}`, Date.now())
          }
          break
        }
      }
    })

    // Register CodeLens command actions for click handlers
    editor.addAction({
      id: 'orion-codelens-show-references',
      label: 'Show References',
      run: (ed) => { ed.getAction('editor.action.referenceSearch.trigger')?.run() },
    })
    editor.addAction({
      id: 'orion-codelens-run-test',
      label: 'Run Test',
      run: () => { /* dispatched via event */ },
    })
    editor.addAction({
      id: 'orion-codelens-debug-test',
      label: 'Debug Test',
      run: () => { /* dispatched via event */ },
    })
    editor.addAction({
      id: 'orion-codelens-explain',
      label: 'AI: Explain Function',
      run: () => { /* dispatched via event */ },
    })

    for (const lang of codeLensLanguages) {
      monaco.languages.registerCodeLensProvider(lang, {
        provideCodeLenses: (model) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lenses: { range: any; id: string; command: { id: string; title: string; arguments?: any[] } }[] = []
          const lineCount = model.getLineCount()
          const uri = model.uri.toString()
          const isTestFile = /\.(test|spec)\.[jt]sx?$/.test(uri)

          // ── 1. Scan for definitions (functions, classes, interfaces/types, exports) ──
          const definitions: { name: string; line: number; kind: 'function' | 'class' | 'interface' | 'type' | 'export' }[] = []

          for (let lineNum = 1; lineNum <= lineCount; lineNum++) {
            const lineContent = model.getLineContent(lineNum)

            // Check interface/type first (more specific)
            const ifaceMatch = CL_IFACE.exec(lineContent)
            if (ifaceMatch && ifaceMatch[1]) {
              const kind = lineContent.includes('interface') ? 'interface' as const : 'type' as const
              definitions.push({ name: ifaceMatch[1], line: lineNum, kind })
              continue
            }

            // Check function/class/const declarations
            const funcMatch = CL_FUNC_DEF.exec(lineContent)
            if (funcMatch) {
              const name = funcMatch[1] || funcMatch[2] || funcMatch[3]
              if (name) {
                if (CL_EXPORT.test(lineContent)) {
                  definitions.push({ name, line: lineNum, kind: 'export' })
                } else {
                  definitions.push({ name, line: lineNum, kind: funcMatch[3] ? 'class' : 'function' })
                }
              }
            }
          }

          // ── 2. Reference count CodeLens for each definition ──
          for (const def of definitions) {
            const totalRefs = countRefsAcrossModels(def.name)
            const refCount = Math.max(0, totalRefs - 1)

            lenses.push({
              range: new monaco.Range(def.line, 1, def.line, 1),
              id: `codelens-ref-${def.name}-${def.line}`,
              command: {
                id: 'orion-codelens-show-references',
                title: `${refCount} reference${refCount !== 1 ? 's' : ''}`,
                arguments: [def.name, def.line],
              },
            })

            // ── 3. Implementation count for interfaces/types ──
            if (def.kind === 'interface' || def.kind === 'type') {
              const ic = countImpl(def.name)
              lenses.push({
                range: new monaco.Range(def.line, 1, def.line, 1),
                id: `codelens-impl-${def.name}-${def.line}`,
                command: {
                  id: 'orion-codelens-show-references',
                  title: `${ic} implementation${ic !== 1 ? 's' : ''}`,
                  arguments: [def.name, def.line],
                },
              })
            }

            // ── 4. AI "Explain" CodeLens for complex functions (>20 lines) ──
            if (def.kind === 'function' || def.kind === 'class' || def.kind === 'export') {
              const endLine = findBlockEnd(model, def.line)
              const blockLen = endLine - def.line + 1
              if (blockLen > 20) {
                lenses.push({
                  range: new monaco.Range(def.line, 1, def.line, 1),
                  id: `codelens-explain-${def.name}-${def.line}`,
                  command: {
                    id: 'orion-codelens-explain',
                    title: 'Explain',
                    arguments: [def.name, def.line, endLine, uri],
                  },
                })
              }
            }

            // ── 5. Recent changes CodeLens ──
            const editKey = `${uri}:${def.name}`
            const lastEdit = recentEditsMapRef.current.get(editKey)
            if (lastEdit) {
              const minsAgo = Math.round((Date.now() - lastEdit) / 60000)
              if (minsAgo < 60) {
                const label = minsAgo < 1 ? 'just now' : `${minsAgo} minute${minsAgo !== 1 ? 's' : ''} ago`
                lenses.push({
                  range: new monaco.Range(def.line, 1, def.line, 1),
                  id: `codelens-recent-${def.name}-${def.line}`,
                  command: {
                    id: '',
                    title: `Modified ${label}`,
                  },
                })
              }
            }
          }

          // ── 6. Test CodeLens for test files ──
          if (isTestFile) {
            for (let lineNum = 1; lineNum <= lineCount; lineNum++) {
              const lineContent = model.getLineContent(lineNum)
              const testMatch = CL_TEST_BLOCK.exec(lineContent)
              if (testMatch && testMatch[1]) {
                const testName = testMatch[1]
                const blockType = lineContent.trim().startsWith('describe') ? 'describe' : 'test'

                lenses.push({
                  range: new monaco.Range(lineNum, 1, lineNum, 1),
                  id: `codelens-run-test-${lineNum}`,
                  command: {
                    id: 'orion-codelens-run-test',
                    title: 'Run Test',
                    arguments: [testName, lineNum, uri, blockType],
                  },
                })

                lenses.push({
                  range: new monaco.Range(lineNum, 1, lineNum, 1),
                  id: `codelens-debug-test-${lineNum}`,
                  command: {
                    id: 'orion-codelens-debug-test',
                    title: 'Debug Test',
                    arguments: [testName, lineNum, uri, blockType],
                  },
                })
              }
            }
          }

          return { lenses, dispose: () => {} }
        },
        resolveCodeLens: (_model, codeLens) => codeLens,
      })
    }

    // ── CodeLens click event handlers ──
    const handleRunTest = (e: Event) => {
      const { testName, filePath } = (e as CustomEvent).detail || {}
      if (testName && filePath) {
        window.dispatchEvent(new CustomEvent('orion:run-task', {
          detail: { command: `npx jest --testNamePattern="${testName}" "${filePath}"`, label: `Run: ${testName}` },
        }))
      }
    }
    window.addEventListener('orion:codelens-run-test', handleRunTest)

    const handleDebugTest = (e: Event) => {
      const { testName, filePath } = (e as CustomEvent).detail || {}
      if (testName && filePath) {
        window.dispatchEvent(new CustomEvent('orion:run-task', {
          detail: { command: `node --inspect-brk node_modules/.bin/jest --testNamePattern="${testName}" "${filePath}"`, label: `Debug: ${testName}` },
        }))
      }
    }
    window.addEventListener('orion:codelens-debug-test', handleDebugTest)

    const handleExplain = (e: Event) => {
      const { startLine, endLine } = (e as CustomEvent).detail || {}
      const mdl = editor.getModel()
      if (mdl && startLine && endLine) {
        const text = mdl.getValueInRange(new monaco.Range(startLine, 1, endLine, mdl.getLineMaxColumn(endLine)))
        window.dispatchEvent(new CustomEvent('orion:ai-context-action', {
          detail: { action: 'explain', selectedText: text, filePath: activeFilePath, language: activeFile?.language || '' },
        }))
      }
    }
    window.addEventListener('orion:codelens-explain', handleExplain)

    // Wire Monaco command dispatching to custom events for CodeLens clicks
    const origTrigger = editor.trigger.bind(editor)
    const patchedTrigger: typeof editor.trigger = (source, handlerId, payload) => {
      if (handlerId === 'orion-codelens-run-test' && payload?.arguments) {
        const [testName, , filePath] = payload.arguments
        window.dispatchEvent(new CustomEvent('orion:codelens-run-test', { detail: { testName, filePath } }))
        return
      }
      if (handlerId === 'orion-codelens-debug-test' && payload?.arguments) {
        const [testName, , filePath] = payload.arguments
        window.dispatchEvent(new CustomEvent('orion:codelens-debug-test', { detail: { testName, filePath } }))
        return
      }
      if (handlerId === 'orion-codelens-explain' && payload?.arguments) {
        const [functionName, startLine, endLine] = payload.arguments
        window.dispatchEvent(new CustomEvent('orion:codelens-explain', { detail: { functionName, startLine, endLine } }))
        return
      }
      if (handlerId === 'orion-codelens-show-references') {
        editor.getAction('editor.action.referenceSearch.trigger')?.run()
        return
      }
      origTrigger(source, handlerId, payload)
    }
    editor.trigger = patchedTrigger

    // ── Language providers: definition, references, hover, symbols, rename ──────────────────
    registerLanguageProviders(monaco, editor, {
      getActiveFilePath: () => activeFilePath,
      getProblems: () => useProblemsStore.getState().problems,
    })

    // ── Code Actions / Quick Fix provider: lightbulb with fix suggestions ──────────────────
    registerCodeActionProviders(monaco, editor)

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
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit0],
      run: (ed) => ed.getAction('editor.foldAll')?.run(),
    })
    editor.addAction({
      id: 'orion-unfold-all',
      label: 'Unfold All',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyJ],
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
        const markers = monaco.editor.getModelMarkers({ resource: model.uri, owner: 'orion' })
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
        const markers = monaco.editor.getModelMarkers({ resource: model.uri, owner: 'orion' })
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

    // ── Fix with AI action (triggered from hover tooltip link) ──────────────────
    editor.addAction({
      id: 'orion-fix-with-ai',
      label: 'Fix with AI',
      run: (ed) => {
        const pos = ed.getPosition()
        if (!pos) return
        const model = ed.getModel()
        if (!model) return
        const markers = monaco.editor.getModelMarkers({ resource: model.uri, owner: 'orion' })
        const marker = markers.find(m =>
          m.startLineNumber <= pos.lineNumber && m.endLineNumber >= pos.lineNumber
        )
        if (marker) {
          window.dispatchEvent(new CustomEvent('orion:fix-with-ai', {
            detail: {
              message: marker.message,
              source: marker.source,
              line: marker.startLineNumber,
              file: activeFilePath,
            },
          }))
        }
      },
    })

    // ── Linked editing for HTML/JSX tags ──────────────────
    const linkedEditingLanguages = ['html', 'javascriptreact', 'typescriptreact']
    for (const lang of linkedEditingLanguages) {
      monaco.languages.registerLinkedEditingRangeProvider(lang, {
        provideLinkedEditingRanges(model, position) {
          const line = model.getLineContent(position.lineNumber)
          const offset = position.column - 1

          // Check if cursor is on a tag name (opening or closing)
          // Match opening tag: <TagName or closing tag: </TagName
          const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9._-]*)/g
          let match: RegExpExecArray | null
          while ((match = tagPattern.exec(line)) !== null) {
            const tagStart = match.index + match[0].length - match[1].length
            const tagEnd = tagStart + match[1].length
            if (offset >= tagStart && offset <= tagEnd) {
              const tagName = match[1]
              const isClosing = match[0].startsWith('</')
              const fullText = model.getValue()

              // Find the matching tag
              if (isClosing) {
                // Find the matching opening tag by scanning backwards
                const closingTagPos = model.getPositionAt(
                  fullText.lastIndexOf(match[0], model.getOffsetAt(position))
                )
                const beforeClosing = fullText.substring(0, model.getOffsetAt(closingTagPos))
                // Simple stack-based search for matching opening tag
                let depth = 0
                const openPattern = new RegExp(`</?${tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s>/])`, 'g')
                const allTags: { index: number; isClose: boolean }[] = []
                let m2: RegExpExecArray | null
                while ((m2 = openPattern.exec(beforeClosing)) !== null) {
                  allTags.push({ index: m2.index, isClose: m2[0].startsWith('</') })
                }
                // Walk from end to find the matching open
                for (let i = allTags.length - 1; i >= 0; i--) {
                  if (allTags[i].isClose) {
                    depth++
                  } else {
                    if (depth === 0) {
                      // Found matching opening tag
                      const openPos = model.getPositionAt(allTags[i].index + 1) // skip <
                      const openRange = {
                        startLineNumber: openPos.lineNumber,
                        startColumn: openPos.column,
                        endLineNumber: openPos.lineNumber,
                        endColumn: openPos.column + tagName.length,
                      }
                      const closeRange = {
                        startLineNumber: position.lineNumber,
                        startColumn: tagStart + 1,
                        endLineNumber: position.lineNumber,
                        endColumn: tagEnd + 1,
                      }
                      return {
                        ranges: [openRange, closeRange],
                        wordPattern: /[a-zA-Z][a-zA-Z0-9._-]*/,
                      }
                    }
                    depth--
                  }
                }
              } else {
                // Find the matching closing tag by scanning forwards
                const openOffset = model.getOffsetAt(position)
                const afterOpen = fullText.substring(openOffset)
                let depth = 0
                const closePattern = new RegExp(`</?${tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s>/])`, 'g')
                let m2: RegExpExecArray | null
                while ((m2 = closePattern.exec(afterOpen)) !== null) {
                  if (m2[0].startsWith('</')) {
                    if (depth === 0) {
                      // Found matching closing tag
                      const closeAbsOffset = openOffset + m2.index + 2 // skip </
                      const closePos = model.getPositionAt(closeAbsOffset)
                      const openRange = {
                        startLineNumber: position.lineNumber,
                        startColumn: tagStart + 1,
                        endLineNumber: position.lineNumber,
                        endColumn: tagEnd + 1,
                      }
                      const closeRange = {
                        startLineNumber: closePos.lineNumber,
                        startColumn: closePos.column,
                        endLineNumber: closePos.lineNumber,
                        endColumn: closePos.column + tagName.length,
                      }
                      return {
                        ranges: [openRange, closeRange],
                        wordPattern: /[a-zA-Z][a-zA-Z0-9._-]*/,
                      }
                    }
                    depth--
                  } else {
                    depth++
                  }
                }
              }
              break
            }
          }
          return null
        },
      })
    }

    // ── Import block folding range provider ──────────────────
    const foldingLanguages = [
      'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
      'python', 'go', 'rust', 'java', 'css', 'scss', 'less',
    ]
    for (const lang of foldingLanguages) {
      monaco.languages.registerFoldingRangeProvider(lang, {
        provideFoldingRanges(model) {
          const ranges: { start: number; end: number; kind: number }[] = []
          const lineCount = model.getLineCount()
          let importStart = -1
          let importEnd = -1

          for (let i = 1; i <= lineCount; i++) {
            const lineText = model.getLineContent(i).trim()
            // Match import/require statements across common languages
            const isImport = /^(import\s|from\s|require\(|const\s+\w+\s*=\s*require|let\s+\w+\s*=\s*require|var\s+\w+\s*=\s*require|#include|use\s|using\s|@import)/.test(lineText)
            if (isImport) {
              if (importStart === -1) importStart = i
              importEnd = i
            } else if (lineText === '' && importStart !== -1) {
              // Allow blank lines within import blocks
              continue
            } else if (importStart !== -1 && importEnd > importStart) {
              // End of import block
              ranges.push({
                start: importStart,
                end: importEnd,
                kind: monaco.languages.FoldingRangeKind.Imports.value,
              })
              importStart = -1
              importEnd = -1
            } else {
              importStart = -1
              importEnd = -1
            }
          }
          // Handle imports at end of scannable area
          if (importStart !== -1 && importEnd > importStart) {
            ranges.push({
              start: importStart,
              end: importEnd,
              kind: monaco.languages.FoldingRangeKind.Imports.value,
            })
          }
          return ranges
        },
      })
    }
  }

  const handleInlineEditSubmit = async (instruction: string) => {
    if (!activeFile || !editorRef.current) return
    setInlineProcessing(true)
    setInlineEditAiResponse(null)

    try {
      // Use stored selection from when Ctrl+K was pressed, or get current
      const selection = inlineEditSelectionRef.current || editorRef.current.getSelection()
      const model = editorRef.current.getModel()
      if (!selection || !model) return

      const selectedCode = model.getValueInRange(selection) || ''
      const fullContext = model.getValue()

      // Also store in diffSelectionRef for backwards compat with InlineDiff
      diffSelectionRef.current = selection

      // Build the AI prompt
      const hasSelection = selectedCode.trim().length > 0
      const codeContext = fullContext.substring(0, 3000)
      const fence = '`' + '`' + '`'
      const message = hasSelection
        ? 'Edit the following code according to the instruction: ' + instruction + '\n\nSelected code to edit:\n' + fence + (activeFile.language || '') + '\n' + selectedCode + '\n' + fence + '\n\nFull file context (for reference):\n' + fence + (activeFile.language || '') + '\n' + codeContext + '\n' + fence + '\n\nReturn ONLY the modified code that should replace the selection. No explanation, no markdown fences.'
        : 'Generate code according to the instruction: ' + instruction + '\n\nFile context (cursor is at line ' + selection.startLineNumber + '):\n' + fence + (activeFile.language || '') + '\n' + codeContext + '\n' + fence + '\n\nReturn ONLY the code to insert. No explanation, no markdown fences.'

      window.api?.omoSend({
        type: 'chat',
        payload: { message, mode: 'chat', model: 'inline-edit' },
      })

      // Listen for the response -- show diff preview inline in the widget
      const handler = (event: any) => {
        if (event?.detail?.type === 'inline-edit-response') {
          const newCode = event.detail.content
          if (newCode) {
            // Show the AI response in the inline edit widget (preview phase)
            setInlineEditAiResponse(newCode)
            // Also populate the separate diff state for backwards compat
            setDiffOriginalCode(selectedCode)
            setDiffSuggestedCode(newCode)
          }
          setInlineProcessing(false)
          window.removeEventListener('orion:inline-edit-response', handler)
        }
      }
      window.addEventListener('orion:inline-edit-response', handler)

      // Fallback timeout
      setTimeout(() => {
        if (inlineProcessing) {
          setInlineProcessing(false)
          setInlineEditAiResponse(null)
          setInlineEditVisible(false)
          addToast({ type: 'info', message: 'AI edit timed out - try from chat instead' })
          window.removeEventListener('orion:inline-edit-response', handler)
        }
      }, 30000)
    } catch (err) {
      setInlineProcessing(false)
      setInlineEditAiResponse(null)
      addToast({ type: 'error', message: 'Failed to process inline edit' })
    }
  }

  // Accept inline edit: apply the AI code to the editor
  const handleInlineEditAccept = useCallback((newCode: string) => {
    const sel = inlineEditSelectionRef.current || diffSelectionRef.current
    if (sel && editorRef.current) {
      editorRef.current.executeEdits('orion-inline-edit', [{
        range: sel,
        text: newCode,
      }])
      addToast({ type: 'success', message: 'AI edit applied' })
    }
    setInlineEditVisible(false)
    setInlineEditAiResponse(null)
    setInlineEditText('')
    setInlineEditSelRange(null)
    inlineEditSelectionRef.current = null
  }, [addToast])

  // Reject inline edit: dismiss AI response but keep widget open to refine
  const handleInlineEditReject = useCallback(() => {
    setInlineEditAiResponse(null)
  }, [])

  // Close inline edit entirely
  const handleInlineEditClose = useCallback(() => {
    setInlineEditVisible(false)
    setInlineEditAiResponse(null)
    setInlineEditText('')
    setInlineProcessing(false)
    setInlineEditSelRange(null)
    inlineEditSelectionRef.current = null
  }, [])

  // Accept diff: apply the AI-suggested code to the editor
  const handleDiffAccept = useCallback((newCode: string) => {
    const sel = diffSelectionRef.current
    if (sel && editorRef.current) {
      // Snapshot before AI edit
      if (activeFile) {
        useFileHistoryStore.getState().addSnapshot(activeFile.path, activeFile.content, 'Before AI edit')
      }
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
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !activeFilePath) return

    const editor = editorRef.current
    const monaco = monacoRef.current

    // Helper to map problem severity to Monaco MarkerSeverity
    const toMarkerSeverity = (sev: string) => {
      switch (sev) {
        case 'error': return monaco.MarkerSeverity.Error
        case 'warning': return monaco.MarkerSeverity.Warning
        default: return monaco.MarkerSeverity.Info
      }
    }

    // Subscribe to problems store
    const unsubscribe = useProblemsStore.subscribe((state) => {
      const problems = state.problems.filter(p => p.file === activeFilePath)

      // ── Set Monaco markers for built-in squiggly underlines ──────────────────
      const model = editor.getModel()
      if (model) {
        const markers = problems.map((problem) => ({
          severity: toMarkerSeverity(problem.severity),
          message: problem.message,
          source: problem.source,
          startLineNumber: problem.line,
          startColumn: problem.column || 1,
          endLineNumber: problem.endLine || problem.line,
          endColumn: problem.endColumn || (problem.column ? problem.column + 1 : model.getLineMaxColumn(problem.line)),
        }))
        monaco.editor.setModelMarkers(model, 'orion', markers)
      }

      // ── Inline error-lens decorations ──────────────────
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
    })

    // Clean up markers when switching files
    return () => {
      unsubscribe()
      const model = editor.getModel()
      if (model) {
        monaco.editor.setModelMarkers(model, 'orion', [])
      }
    }
  }, [activeFilePath])

  // Ctrl+S save handler
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (activeFile) {
          setSaving(true)
          useFileHistoryStore.getState().addSnapshot(activeFile.path, activeFile.content, 'Saved')
          await window.api.writeFile(activeFile.path, activeFile.content)
          markSaved(activeFile.path)
          clearRecovery(activeFile.path)
          addToast({ type: 'success', message: `Saved ${activeFile.name}`, duration: 1500 })
          setTimeout(() => setSaving(false), 800)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeFile])

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

  // Toggle split direction handler (for context menu and command palette)
  const handleToggleSplitDirection = useCallback(() => {
    if (splitMode === 'horizontal') {
      setSplitMode('vertical')
    } else if (splitMode === 'vertical') {
      setSplitMode('horizontal')
    }
  }, [splitMode])

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

  // Handle split editor right (horizontal)
  const handleSplitRight = useCallback(() => {
    if (splitMode === 'single' && activeFile) {
      setSplitMode('horizontal')
      const other = openFiles.find((f) => f.path !== activeFilePath)
      const splitPath = other?.path || activeFilePath || null
      setSplitFilePath(splitPath)
      setGroup1Files(activeFilePath ? [activeFilePath] : [])
      setGroup2Files(splitPath ? [splitPath] : [])
    } else if (splitMode !== 'single') {
      setSplitMode('single')
      setSplitFilePath(null)
      setGroup1Files([])
      setGroup2Files([])
    }
  }, [splitMode, activeFile, openFiles, activeFilePath])

  // Handle split editor down (vertical)
  const handleSplitDown = useCallback(() => {
    if (splitMode === 'single' && activeFile) {
      setSplitMode('vertical')
      const other = openFiles.find((f) => f.path !== activeFilePath)
      const splitPath = other?.path || activeFilePath || null
      setSplitFilePath(splitPath)
      setGroup1Files(activeFilePath ? [activeFilePath] : [])
      setGroup2Files(splitPath ? [splitPath] : [])
    } else if (splitMode !== 'single') {
      setSplitMode('single')
      setSplitFilePath(null)
      setGroup1Files([])
      setGroup2Files([])
    }
  }, [splitMode, activeFile, openFiles, activeFilePath])

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
  const handleCompareFiles = useCallback(() => {
    if (!activeFilePath) return
    setDiffOriginalPath(activeFilePath)
    setDiffFilePickerOpen(true)
  }, [activeFilePath])

  // Handle selecting the comparison file
  const handleSelectDiffFile = useCallback((path: string) => {
    setDiffModifiedPath(path)
    setDiffFilePickerOpen(false)
    setDiffEditorMode(true)
  }, [])

  // Close diff editor
  const handleCloseDiffEditor = useCallback(() => {
    setDiffEditorMode(false)
    setDiffOriginalPath(null)
    setDiffModifiedPath(null)
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
    const handler = () => handleSplitToggle()
    const handlerRight = () => handleSplitRight()
    const handlerDown = () => handleSplitDown()
    const handlerSyncScroll = () => handleToggleSyncScroll()
    const handlerCompare = () => handleCompareFiles()
    const handlerToggleDir = () => handleToggleSplitDirection()
    window.addEventListener('orion:split-editor', handler)
    window.addEventListener('orion:split-editor-right', handlerRight)
    window.addEventListener('orion:split-editor-down', handlerDown)
    window.addEventListener('orion:toggle-sync-scroll', handlerSyncScroll)
    window.addEventListener('orion:compare-files', handlerCompare)
    window.addEventListener('orion:toggle-split-direction', handlerToggleDir)
    return () => {
      window.removeEventListener('orion:split-editor', handler)
      window.removeEventListener('orion:split-editor-right', handlerRight)
      window.removeEventListener('orion:split-editor-down', handlerDown)
      window.removeEventListener('orion:toggle-sync-scroll', handlerSyncScroll)
      window.removeEventListener('orion:compare-files', handlerCompare)
      window.removeEventListener('orion:toggle-split-direction', handlerToggleDir)
    }
  }, [handleSplitToggle, handleSplitRight, handleSplitDown, handleToggleSyncScroll, handleCompareFiles, handleToggleSplitDirection])

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
      'orion:save-file': async () => {
        if (activeFile) {
          setSaving(true)

          // Format on save
          if (editorConfig.formatOnSave && editorRef.current) {
            try {
              await editorRef.current.getAction('editor.action.formatDocument')?.run()
            } catch { /* formatter may not be available for this language */ }
          }

          // Get latest content from editor model (may have been formatted)
          let content = editorRef.current?.getModel()?.getValue() ?? activeFile.content

          // Trim trailing whitespace on save
          if (editorConfig.trimTrailingWhitespace) {
            content = content.replace(/[ \t]+$/gm, '')
          }

          // Insert final newline
          if (editorConfig.insertFinalNewline && content.length > 0 && !content.endsWith('\n')) {
            content = content + '\n'
          }

          // Update the editor model if content was modified by trim/newline
          if (editorRef.current) {
            const model = editorRef.current.getModel()
            if (model && model.getValue() !== content) {
              model.setValue(content)
            }
          }

          useFileHistoryStore.getState().addSnapshot(activeFile.path, content, 'Saved')
          window.api.writeFile(activeFile.path, content).then(() => {
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
        editorRef.current?.trigger('', 'editor.action.selectHighlights', {})
      },
      'orion:expand-selection': () => {
        editorRef.current?.getAction('editor.action.smartSelect.expand')?.run()
      },
      'orion:shrink-selection': () => {
        editorRef.current?.getAction('editor.action.smartSelect.shrink')?.run()
      },
      'orion:add-next-occurrence': () => {
        editorRef.current?.getAction('editor.action.addSelectionToNextFindMatch')?.run()
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
      'orion:find-in-selection': () => {
        editorRef.current?.trigger('', 'editor.action.startFindReplaceAction', {})
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
        if (activeFile?.language === 'markdown') {
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

    // New window handler
    const newWindowHandler = () => {
      if (window.api) {
        const { addToast } = useToastStore.getState()
        addToast({ type: 'info', message: 'Opening new window...' })
      }
    }

    // Editor config update from Settings modal
    const editorConfigHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail) {
        setEditorConfig(prev => {
          const next = { ...prev, ...detail }
          if (editorRef.current) {
            const cursorStyleMap: Record<string, string> = {
              'line': 'line', 'block': 'block', 'underline': 'underline',
              'line-thin': 'line-thin', 'block-outline': 'block-outline',
              'underline-thin': 'underline-thin',
            }
            editorRef.current.updateOptions({
              fontSize: next.fontSize,
              fontFamily: `'${next.fontFamily}', monospace`,
              lineHeight: Math.round(next.fontSize * next.lineHeight),
              fontLigatures: next.fontLigatures,
              cursorStyle: cursorStyleMap[next.cursorStyle] || 'line',
              renderWhitespace: next.renderWhitespace,
              letterSpacing: next.letterSpacing,
              minimap: { enabled: next.minimap },
              wordWrap: next.wordWrap ? 'on' : 'off',
            })
            minimapRef.current = next.minimap
          }
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
    window.addEventListener('orion:new-window', newWindowHandler)
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
      window.removeEventListener('orion:new-window', newWindowHandler)
      window.removeEventListener('orion:editor-config', editorConfigHandler)
      window.removeEventListener('orion:toggle-timeline', toggleTimelineHandler)
    }
  }, [activeFilePath, activeFile, closeFile, closeAllFiles, markSaved, addToast])

  const editorOptions: MonacoEditor.IStandaloneEditorConstructionOptions = {
    fontSize: editorConfig.fontSize,
    fontFamily: `'${editorConfig.fontFamily}', monospace`,
    fontLigatures: editorConfig.fontLigatures,
    minimap: {
      enabled: editorConfig.minimap,
      maxColumn: 80,
      renderCharacters: true,
      showSlider: 'mouseover',
      side: 'right',
      scale: 1,
    },
    scrollBeyondLastLine: true,
    scrollBeyondLastColumn: 5,
    smoothScrolling: true,
    mouseWheelScrollSensitivity: 1,
    fastScrollSensitivity: 5,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    cursorStyle: editorConfig.cursorStyle as any,
    cursorWidth: 2,
    renderWhitespace: (editorConfig.renderWhitespace || 'selection') as any,
    bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
    padding: { top: 8, bottom: 8 },
    lineNumbers: 'on',
    renderLineHighlight: 'line',
    lineHeight: Math.round(editorConfig.fontSize * (editorConfig.lineHeight || 1.5)),
    letterSpacing: editorConfig.letterSpacing ?? 0.3,
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
    stickyScroll: { enabled: true, maxLineCount: 5 },
    wordWrap: editorConfig.wordWrap ? 'on' : 'off',
    wordWrapColumn: 80,
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
    formatOnPaste: true,
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
              onClick={handleCompareFiles}
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
                if (!result.error) {
                  reloadFileContent(activeFile.path, result.content)
                  addToast({ type: 'info', message: 'File reloaded from disk' })
                }
              } catch { /* ignore */ }
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
            onClick={() => {
              if (activeFile) {
                setDiffEditorMode(true)
                setDiffOriginalPath(activeFile.path)
                setDiffModifiedPath(activeFile.path)
                dismissExternalChange(activeFile.path)
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
                  <span style={{ color: 'var(--text-muted)', fontSize: 10, opacity: 0.7 }}>Original:</span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {diffOriginalPath.replace(/\\/g, '/').split('/').pop()}
                  </span>
                  <span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>{'\u2194'}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10, opacity: 0.7 }}>Modified:</span>
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
                    original={openFiles.find(f => f.path === diffOriginalPath)?.content || ''}
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
                  ) : (
                    <>
                      <div style={
                        (markdownPreview && activeFile?.language === 'markdown') || (jsonTreeView && activeFile?.path?.endsWith('.json'))
                          ? { flex: 1, overflow: 'hidden', position: 'relative' }
                          : { flex: 1, minHeight: 0 }
                      }>
                      <Editor
                        theme={currentMonacoTheme}
                        language={activeFile.language}
                        value={activeFile.content}
                        onChange={handleChange}
                        onMount={handleEditorMount}
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
                      {/* Inline Edit Overlay (Ctrl+K - Cursor-style) */}
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
                          theme={currentMonacoTheme}
                          language={splitFile.language}
                          value={splitFile.content}
                          onChange={(val) => {
                            if (splitFilePath && val !== undefined) {
                              updateFileContent(splitFilePath, val)
                            }
                          }}
                          onMount={(editor) => {
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
            onOpenFolder={() => window.api.openFolder().then((result: any) => {
              if (result) window.dispatchEvent(new CustomEvent('orion:folder-opened', { detail: result }))
            })}
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
