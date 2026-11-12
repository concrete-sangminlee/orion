import { useEffect, useRef, useCallback, useMemo } from 'react'
import type { editor as MonacoEditor, languages as MonacoLanguages, IDisposable, IPosition } from 'monaco-editor'
import type { Monaco } from '@monaco-editor/react'
import { useCompletionStore } from '@/store/completion'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GhostTextProviderProps {
  editor: MonacoEditor.IStandaloneCodeEditor | null
  monaco: Monaco | null
  language: string
  filePath: string
}

interface CachedCompletion {
  text: string
  confidence: number
  timestamp: number
  prefix: string
  language: string
}

interface LanguageStrategy {
  /** Extra stop sequences beyond the universal ones */
  stopSequences: string[]
  /** Max tokens to request */
  maxTokens: number
  /** Temperature for sampling */
  temperature: number
  /** Whether multi-line completions are preferred */
  preferMultiLine: boolean
  /** Regex patterns that should suppress completions */
  suppressPatterns: RegExp[]
  /** Patterns that indicate a good trigger point */
  triggerPatterns: RegExp[]
}


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_MAX_SIZE = 64
const CACHE_TTL_MS = 60_000 // 1 minute
const CONTEXT_WINDOW_BEFORE = 80
const CONTEXT_WINDOW_AFTER = 20

// CSS variable-based styles injected once
const GHOST_STYLE_ID = 'orion-ghost-text-styles'
const GHOST_STYLES = `
  .orion-ghost-loading-indicator {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--orion-ghost-loading-color, rgba(130, 170, 255, 0.7));
    margin-left: 2px;
    animation: orion-ghost-pulse 1.2s ease-in-out infinite;
    position: absolute;
    left: 4px;
    top: 50%;
    transform: translateY(-50%);
  }
  @keyframes orion-ghost-pulse {
    0%, 100% { opacity: 0.3; transform: translateY(-50%) scale(0.8); }
    50% { opacity: 1; transform: translateY(-50%) scale(1.2); }
  }
  .orion-ghost-confidence-high .ghost-text-decoration {
    opacity: var(--orion-ghost-opacity-high, 0.6);
  }
  .orion-ghost-confidence-medium .ghost-text-decoration {
    opacity: var(--orion-ghost-opacity-medium, 0.4);
  }
  .orion-ghost-confidence-low .ghost-text-decoration {
    opacity: var(--orion-ghost-opacity-low, 0.25);
  }
`

// ---------------------------------------------------------------------------
// Language strategies
// ---------------------------------------------------------------------------

const DEFAULT_STRATEGY: LanguageStrategy = {
  stopSequences: ['\n\n\n'],
  maxTokens: 256,
  temperature: 0.2,
  preferMultiLine: true,
  suppressPatterns: [
    /^\s*\/\/\s*$/, // lone comment prefix
    /^\s*#\s*$/,    // lone hash comment
  ],
  triggerPatterns: [],
}

const LANGUAGE_STRATEGIES: Record<string, Partial<LanguageStrategy>> = {
  typescript: {
    stopSequences: ['\n\n\n', '// ---'],
    maxTokens: 384,
    preferMultiLine: true,
    triggerPatterns: [
      /(?:function|const|let|var|class|interface|type|export|import)\s/,
      /=>\s*\{?\s*$/,
      /\)\s*\{?\s*$/,
      /:\s*$/,
    ],
    suppressPatterns: [
      /^\s*\/\*\*?\s*$/,
      /^\s*\*\s*$/,
    ],
  },
  typescriptreact: {
    stopSequences: ['\n\n\n', '// ---'],
    maxTokens: 384,
    preferMultiLine: true,
    triggerPatterns: [
      /(?:function|const|let|var|class|interface|type|export|import|return)\s/,
      /=>\s*[\({]?\s*$/,
      /<\w+/,
    ],
  },
  javascript: {
    stopSequences: ['\n\n\n'],
    maxTokens: 256,
    preferMultiLine: true,
    triggerPatterns: [
      /(?:function|const|let|var|class|export|import)\s/,
      /=>\s*\{?\s*$/,
    ],
  },
  javascriptreact: {
    stopSequences: ['\n\n\n'],
    maxTokens: 256,
    preferMultiLine: true,
    triggerPatterns: [
      /(?:function|const|let|var|class|export|import|return)\s/,
      /=>\s*[\({]?\s*$/,
      /<\w+/,
    ],
  },
  python: {
    stopSequences: ['\n\n\n', '\nclass ', '\ndef '],
    maxTokens: 384,
    temperature: 0.15,
    preferMultiLine: true,
    triggerPatterns: [
      /(?:def|class|if|for|while|with|import|from)\s/,
      /:\s*$/,
    ],
    suppressPatterns: [
      /^\s*#\s*$/,
      /^\s*"""\s*$/,
    ],
  },
  rust: {
    stopSequences: ['\n\n\n', '\nfn ', '\nimpl ', '\nmod '],
    maxTokens: 384,
    temperature: 0.15,
    preferMultiLine: true,
    triggerPatterns: [
      /(?:fn|struct|enum|impl|trait|let|pub|use)\s/,
      /\{\s*$/,
      /->\s*/,
    ],
  },
  go: {
    stopSequences: ['\n\n\n', '\nfunc ', '\ntype '],
    maxTokens: 256,
    temperature: 0.15,
    preferMultiLine: true,
    triggerPatterns: [
      /(?:func|type|var|const|package|import)\s/,
      /\{\s*$/,
    ],
  },
  css: {
    stopSequences: ['\n\n\n', '\n}'],
    maxTokens: 128,
    temperature: 0.1,
    preferMultiLine: true,
    triggerPatterns: [/\{\s*$/, /:\s*$/],
  },
  html: {
    stopSequences: ['\n\n\n'],
    maxTokens: 256,
    temperature: 0.1,
    preferMultiLine: true,
    triggerPatterns: [/<\w/, />\s*$/],
  },
  json: {
    stopSequences: ['\n\n'],
    maxTokens: 128,
    temperature: 0.05,
    preferMultiLine: false,
    suppressPatterns: [],
  },
  markdown: {
    stopSequences: ['\n\n\n'],
    maxTokens: 256,
    temperature: 0.3,
    preferMultiLine: true,
  },
}

function getStrategy(language: string): LanguageStrategy {
  const override = LANGUAGE_STRATEGIES[language]
  if (!override) return DEFAULT_STRATEGY
  return { ...DEFAULT_STRATEGY, ...override }
}

// ---------------------------------------------------------------------------
// Completion cache
// ---------------------------------------------------------------------------

class CompletionCache {
  private entries: Map<string, CachedCompletion> = new Map()

  private makeKey(prefix: string, language: string): string {
    // Use last 200 chars of prefix as key – enough for locality
    const tail = prefix.length > 200 ? prefix.slice(-200) : prefix
    return `${language}::${tail}`
  }

  get(prefix: string, language: string): CachedCompletion | null {
    const key = this.makeKey(prefix, language)
    const entry = this.entries.get(key)
    if (!entry) return null
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      this.entries.delete(key)
      return null
    }
    return entry
  }

  /** Try to find a cached entry whose prefix is a prefix of the current prefix */
  getPartialMatch(prefix: string, language: string): CachedCompletion | null {
    const now = Date.now()
    for (const [, entry] of Array.from(this.entries)) {
      if (entry.language !== language) continue
      if (now - entry.timestamp > CACHE_TTL_MS) continue
      // If the current prefix starts with the cached prefix, the cached completion
      // may still be relevant if the extra typed text matches the start of the completion
      if (prefix.startsWith(entry.prefix) && prefix.length > entry.prefix.length) {
        const typed = prefix.slice(entry.prefix.length)
        if (entry.text.startsWith(typed)) {
          return {
            ...entry,
            text: entry.text.slice(typed.length),
            confidence: entry.confidence * 0.9, // slightly lower confidence
          }
        }
      }
    }
    return null
  }

  set(prefix: string, language: string, text: string, confidence: number): void {
    if (this.entries.size >= CACHE_MAX_SIZE) {
      // Evict oldest entry
      let oldestKey: string | null = null
      let oldestTime = Infinity
      for (const [k, v] of Array.from(this.entries)) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp
          oldestKey = k
        }
      }
      if (oldestKey) this.entries.delete(oldestKey)
    }
    const key = this.makeKey(prefix, language)
    this.entries.set(key, { text, confidence, timestamp: Date.now(), prefix, language })
  }

  clear(): void {
    this.entries.clear()
  }
}

// Singleton cache shared across re-renders
const completionCache = new CompletionCache()

/**
 * Estimate the confidence of a completion response.
 * Returns a value between 0 and 1.
 */
function estimateConfidence(response: any, completionText: string, strategy: LanguageStrategy): number {
  let confidence = 0.5

  // Longer completions that look well-formed get higher confidence
  if (completionText.length > 30) confidence += 0.1
  if (completionText.length > 100) confidence += 0.05

  // Multi-line completions in languages that prefer them
  const lineCount = completionText.split('\n').length
  if (lineCount > 1 && strategy.preferMultiLine) confidence += 0.1

  // If the response has a confidence/score field, use it
  if (typeof response?.confidence === 'number') {
    confidence = response.confidence
  } else if (typeof response?.score === 'number') {
    confidence = Math.min(1, response.score)
  }

  // Balanced brackets/parens is a good sign
  const opens = (completionText.match(/[({[]/g) || []).length
  const closes = (completionText.match(/[)}\]]/g) || []).length
  if (opens === closes) confidence += 0.1

  return Math.max(0.1, Math.min(1, confidence))
}

function confidenceClass(confidence: number): string {
  if (confidence >= 0.65) return 'orion-ghost-confidence-high'
  if (confidence >= 0.4) return 'orion-ghost-confidence-medium'
  return 'orion-ghost-confidence-low'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GhostTextProvider({ editor, monaco, language, filePath }: GhostTextProviderProps) {
  // Off when disabled in Settings or when no provider is selected.
  const enabled = useCompletionStore((s) => s.enabled && s.provider !== 'off')
  const debounceMs = useCompletionStore((s) => s.debounceMs)
  const setGhostText = useCompletionStore((s) => s.setGhostText)
  const setLoading = useCompletionStore((s) => s.setLoading)
  const clear = useCompletionStore((s) => s.clear)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disposableRef = useRef<IDisposable | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const confidenceRef = useRef<number>(0.5)
  const loadingDecorationRef = useRef<string[]>([])
  const styleInjectedRef = useRef(false)
  const currentGhostRef = useRef<string | null>(null)
  const partialAcceptIdxRef = useRef<number>(0)

  const strategy = useMemo(() => getStrategy(language), [language])

  // -----------------------------------------------------------------------
  // Inject styles once
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (styleInjectedRef.current) return
    if (typeof document === 'undefined') return
    if (document.getElementById(GHOST_STYLE_ID)) {
      styleInjectedRef.current = true
      return
    }
    const style = document.createElement('style')
    style.id = GHOST_STYLE_ID
    style.textContent = GHOST_STYLES
    document.head.appendChild(style)
    styleInjectedRef.current = true
  }, [])

  // -----------------------------------------------------------------------
  // Loading indicator decoration helpers
  // -----------------------------------------------------------------------
  const showLoadingDecoration = useCallback((lineNumber: number) => {
    if (!editor) return
    const newDecorations = editor.deltaDecorations(loadingDecorationRef.current, [
      {
        range: {
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: 1,
        },
        options: {
          glyphMarginClassName: 'orion-ghost-loading-indicator',
          glyphMarginHoverMessage: { value: 'AI completion loading...' },
        },
      },
    ])
    loadingDecorationRef.current = newDecorations
  }, [editor])

  const clearLoadingDecoration = useCallback(() => {
    if (!editor) return
    if (loadingDecorationRef.current.length > 0) {
      editor.deltaDecorations(loadingDecorationRef.current, [])
      loadingDecorationRef.current = []
    }
  }, [editor])

  // -----------------------------------------------------------------------
  // Request completion
  // -----------------------------------------------------------------------
  const requestCompletion = useCallback(async (
    model: MonacoEditor.ITextModel,
    position: IPosition,
  ) => {
    if (!enabled) return

    // Cancel previous request
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    const currentLine = model.getLineContent(position.lineNumber)
    const textBeforeCursor = currentLine.substring(0, position.column - 1)

    // ---- Suppress checks ----
    // Don't trigger on empty lines at the start
    if (textBeforeCursor.trim() === '' && position.lineNumber <= 2) {
      clear()
      return
    }
    // Language-specific suppression
    for (const pat of strategy.suppressPatterns) {
      if (pat.test(textBeforeCursor)) {
        clear()
        return
      }
    }

    // ---- Build prefix/suffix context ----
    const lineCount = model.getLineCount()
    const startLine = Math.max(1, position.lineNumber - CONTEXT_WINDOW_BEFORE)
    const endLine = Math.min(lineCount, position.lineNumber + CONTEXT_WINDOW_AFTER)

    const prefix = model.getValueInRange({
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    })

    const suffix = model.getValueInRange({
      startLineNumber: position.lineNumber,
      startColumn: position.column,
      endLineNumber: endLine,
      endColumn: model.getLineMaxColumn(endLine),
    })

    // ---- Check cache ----
    const cached = completionCache.get(prefix, language)
      ?? completionCache.getPartialMatch(prefix, language)
    if (cached) {
      confidenceRef.current = cached.confidence
      currentGhostRef.current = cached.text
      partialAcceptIdxRef.current = 0
      setGhostText(cached.text, position.lineNumber, position.column)
      return
    }

    // ---- Gather rich context ----
    setLoading(true)
    showLoadingDecoration(position.lineNumber)

    try {
      // The main process picks the model, bounds the context and cancels the
      // previous request; the provider is whatever the user chose in Settings.
      const { provider } = useCompletionStore.getState()
      if (provider === 'off') {
        clear()
        return
      }
      const response = await window.api.aiComplete({
        provider,
        prefix,
        suffix,
        language,
        fileName: filePath.split(/[\\/]/).pop() || 'untitled',
        maxTokens: strategy.maxTokens,
      })

      if (abortRef.current?.signal.aborted) return

      if (response?.text) {
        let completionText: string = response.text

        // Clean up: remove trailing whitespace-only lines
        completionText = completionText.replace(/\n\s*$/, '')

        if (completionText.trim()) {
          const confidence = estimateConfidence(response, completionText, strategy)
          confidenceRef.current = confidence
          currentGhostRef.current = completionText
          partialAcceptIdxRef.current = 0

          // Cache the completion
          completionCache.set(prefix, language, completionText, confidence)

          // Apply confidence-based CSS class to the editor container
          const editorDom = editor?.getDomNode()
          if (editorDom) {
            editorDom.classList.remove(
              'orion-ghost-confidence-high',
              'orion-ghost-confidence-medium',
              'orion-ghost-confidence-low',
            )
            editorDom.classList.add(confidenceClass(confidence))
          }

          setGhostText(completionText, position.lineNumber, position.column)
        } else {
          clear()
        }
      } else {
        clear()
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        clear()
      }
    } finally {
      clearLoadingDecoration()
    }
  }, [
    enabled, filePath, language, strategy, editor,
    setGhostText, setLoading, clear,
    showLoadingDecoration, clearLoadingDecoration,
  ])

  // -----------------------------------------------------------------------
  // Register inline completions provider + listeners
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!editor || !monaco || !enabled) return

    // Register inline completions provider (supports multi-line via range)
    const provider: MonacoLanguages.InlineCompletionsProvider = {
      provideInlineCompletions: async (model, position, _context, _token) => {
        const store = useCompletionStore.getState()
        if (!store.enabled) return { items: [] }

        if (
          store.ghostText &&
          store.triggerLine === position.lineNumber &&
          store.triggerColumn === position.column
        ) {
          // Calculate multi-line end position
          const lines = store.ghostText.split('\n')
          const endLineNumber = position.lineNumber + lines.length - 1
          const lastLineText = lines[lines.length - 1]
          const endColumn = lines.length === 1
            ? position.column + lastLineText.length
            : lastLineText.length + 1

          return {
            items: [{
              insertText: store.ghostText,
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber,
                endColumn: lines.length === 1 ? position.column : endColumn,
              },
            }],
          }
        }

        return { items: [] }
      },
      freeInlineCompletions: () => {},
    }

    const disposable = monaco.languages.registerInlineCompletionsProvider(
      { pattern: '**' },
      provider,
    )
    disposableRef.current = disposable

    // Moving the caret dismisses the suggestion. It does not request a new
    // one: only typing does, so navigating a file costs no completion requests.
    const cursorDisposable = editor.onDidChangeCursorPosition((e) => {
      if (e.reason === 3) return // Explicit cursor set, skip
      // Typing moves the caret too; the content handler below owns that case.
      if (e.source === 'keyboard' && debounceRef.current) return

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = null
      clear()
      clearLoadingDecoration()
      currentGhostRef.current = null
      partialAcceptIdxRef.current = 0
    })

    // Typing: clear the current suggestion and ask for a new one after a pause.
    const contentDisposable = editor.onDidChangeModelContent(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      clear()
      clearLoadingDecoration()
      currentGhostRef.current = null
      partialAcceptIdxRef.current = 0

      // Re-trigger with debounce after typing
      debounceRef.current = setTimeout(() => {
        const model = editor.getModel()
        if (!model) return
        const pos = editor.getPosition()
        if (!pos) return
        debounceRef.current = null
        requestCompletion(model, pos)
      }, debounceMs)
    })

    return () => {
      disposable.dispose()
      cursorDisposable.dispose()
      contentDisposable.dispose()
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (abortRef.current) abortRef.current.abort()
      clearLoadingDecoration()
    }
  }, [editor, monaco, enabled, debounceMs, requestCompletion, clear, clearLoadingDecoration])

  // -----------------------------------------------------------------------
  // Tab: accept full completion
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!editor || !monaco) return

    const action = editor.addAction({
      id: 'orion-accept-ghost-text',
      label: 'Accept AI Completion',
      keybindings: [monaco.KeyCode.Tab],
      precondition: undefined,
      run: () => {
        const store = useCompletionStore.getState()
        if (store.ghostText && store.triggerLine && store.triggerColumn) {
          const model = editor.getModel()
          if (!model) return

          // Insert the full ghost text (supports multi-line)
          editor.executeEdits('ghost-text', [{
            range: {
              startLineNumber: store.triggerLine,
              startColumn: store.triggerColumn,
              endLineNumber: store.triggerLine,
              endColumn: store.triggerColumn,
            },
            text: store.ghostText,
          }])

          // Move cursor to end of inserted text
          const insertedLines = store.ghostText.split('\n')
          const endLine = store.triggerLine + insertedLines.length - 1
          const endCol = insertedLines.length === 1
            ? store.triggerColumn + insertedLines[0].length
            : insertedLines[insertedLines.length - 1].length + 1
          editor.setPosition({ lineNumber: endLine, column: endCol })

          currentGhostRef.current = null
          partialAcceptIdxRef.current = 0
          clear()
        } else {
          // No ghost text – do normal tab
          editor.trigger('keyboard', 'tab', null)
        }
      },
    })

    return () => action.dispose()
  }, [editor, monaco, clear])

  // -----------------------------------------------------------------------
  // Ctrl+Right: accept word-by-word (partial accept)
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!editor || !monaco) return

    const action = editor.addAction({
      id: 'orion-accept-ghost-word',
      label: 'Accept Next Word of AI Completion',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.RightArrow],
      precondition: undefined,
      run: () => {
        const store = useCompletionStore.getState()
        const ghost = currentGhostRef.current
        if (!ghost || !store.triggerLine || !store.triggerColumn) {
          // No ghost text – do normal ctrl+right (word navigation)
          editor.trigger('keyboard', 'cursorWordRight', null)
          return
        }

        // Determine next word boundary in the remaining ghost text
        const idx = partialAcceptIdxRef.current
        const remaining = ghost.slice(idx)
        if (!remaining) {
          currentGhostRef.current = null
          partialAcceptIdxRef.current = 0
          clear()
          return
        }

        // Match: leading whitespace + next word (or to end of line)
        const wordMatch = remaining.match(/^(\s*\S+)/)
        const acceptLength = wordMatch ? wordMatch[1].length : remaining.length
        const acceptedText = remaining.slice(0, acceptLength)

        // Calculate the current insert position
        const alreadyInserted = ghost.slice(0, idx)
        const alreadyLines = alreadyInserted.split('\n')
        let insertLine: number
        let insertCol: number
        if (alreadyLines.length === 1) {
          insertLine = store.triggerLine
          insertCol = store.triggerColumn + alreadyLines[0].length
        } else {
          insertLine = store.triggerLine + alreadyLines.length - 1
          insertCol = alreadyLines[alreadyLines.length - 1].length + 1
        }

        editor.executeEdits('ghost-text-partial', [{
          range: {
            startLineNumber: insertLine,
            startColumn: insertCol,
            endLineNumber: insertLine,
            endColumn: insertCol,
          },
          text: acceptedText,
        }])

        // Move cursor to end of accepted text
        const acceptedLines = acceptedText.split('\n')
        let newLine: number
        let newCol: number
        if (acceptedLines.length === 1) {
          newLine = insertLine
          newCol = insertCol + acceptedLines[0].length
        } else {
          newLine = insertLine + acceptedLines.length - 1
          newCol = acceptedLines[acceptedLines.length - 1].length + 1
        }
        editor.setPosition({ lineNumber: newLine, column: newCol })

        // Update partial index
        partialAcceptIdxRef.current = idx + acceptLength

        // Update ghost text to show remaining
        const newRemaining = ghost.slice(idx + acceptLength)
        if (newRemaining.trim()) {
          setGhostText(newRemaining, newLine, newCol)
        } else {
          currentGhostRef.current = null
          partialAcceptIdxRef.current = 0
          clear()
        }
      },
    })

    return () => action.dispose()
  }, [editor, monaco, clear, setGhostText])

  // Render nothing – this is a behavior-only component
  return null
}
