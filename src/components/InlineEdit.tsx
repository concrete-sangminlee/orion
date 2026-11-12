import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Sparkles, X, Loader2, Check, ChevronRight, Bug, Type, Zap, FileText, Minimize2, CheckCircle2, XCircle } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged'
  content: string
  hunkIndex?: number
}

interface DiffHunk {
  index: number
  lines: DiffLine[]
  status: 'pending' | 'accepted' | 'rejected'
}

interface Props {
  visible: boolean
  onClose: () => void
  onSubmit: (instruction: string) => void
  onAccept?: (code: string) => void
  onReject?: () => void
  isProcessing: boolean
  selectedText: string
  position: { top: number; left: number }
  selectionRange?: { startLine: number; endLine: number } | null
  aiResponse?: string | null
  streamingResponse?: string | null
  language?: string
}

// ── Quick Actions ──────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Fix bugs', icon: Bug, instruction: 'Fix any bugs in this code' },
  { label: 'Add types', icon: Type, instruction: 'Add TypeScript types to this code' },
  { label: 'Optimize', icon: Zap, instruction: 'Optimize this code for performance' },
  { label: 'Add docs', icon: FileText, instruction: 'Add documentation comments to this code' },
  { label: 'Simplify', icon: Minimize2, instruction: 'Simplify this code while preserving behavior' },
] as const

// ── Instruction history ────────────────────────────────────

const HISTORY_KEY = 'orion-inline-edit-history'
const MAX_HISTORY = 10

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHistory(history: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
  } catch { /* ignore */ }
}

function addToHistory(instruction: string) {
  const history = loadHistory()
  const filtered = history.filter(h => h !== instruction)
  filtered.unshift(instruction)
  saveHistory(filtered.slice(0, MAX_HISTORY))
}

// ── Token estimation ───────────────────────────────────────

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for code
  return Math.ceil(text.length / 4)
}

// ── Diff computation ───────────────────────────────────────

function computeInlineDiff(original: string, suggested: string): DiffLine[] {
  const oldLines = original.split('\n')
  const newLines = suggested.split('\n')
  const m = oldLines.length
  const n = newLines.length

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const stack: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: 'unchanged', content: oldLines[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', content: newLines[j - 1] })
      j--
    } else {
      stack.push({ type: 'removed', content: oldLines[i - 1] })
      i--
    }
  }

  return stack.reverse()
}

// ── Hunk grouping ──────────────────────────────────────────

function groupIntoHunks(diffLines: DiffLine[]): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let currentHunk: DiffLine[] = []
  let hunkIndex = 0
  let inChange = false

  for (const line of diffLines) {
    if (line.type === 'unchanged') {
      if (inChange && currentHunk.length > 0) {
        hunks.push({ index: hunkIndex, lines: currentHunk, status: 'pending' })
        hunkIndex++
        currentHunk = []
        inChange = false
      }
      // Context lines belong to next potential hunk or standalone
      currentHunk.push({ ...line, hunkIndex })
    } else {
      if (!inChange && currentHunk.length > 0) {
        // Trailing context from previous unchanged block - keep last 2 as context
        const contextLines = currentHunk.slice(-2)
        if (currentHunk.length > 2) {
          const standaloneContext = currentHunk.slice(0, -2)
          hunks.push({ index: hunkIndex, lines: standaloneContext, status: 'pending' })
          hunkIndex++
        }
        currentHunk = contextLines.map(l => ({ ...l, hunkIndex }))
      }
      inChange = true
      currentHunk.push({ ...line, hunkIndex })
    }
  }

  if (currentHunk.length > 0) {
    hunks.push({ index: hunkIndex, lines: currentHunk, status: 'pending' })
  }

  return hunks
}

// ── Syntax highlighting (lightweight) ──────────────────────

const KEYWORDS = new Set([
  'import', 'export', 'from', 'default', 'function', 'const', 'let', 'var',
  'if', 'else', 'return', 'for', 'while', 'class', 'extends', 'new', 'this',
  'try', 'catch', 'throw', 'typeof', 'async', 'await', 'true', 'false',
  'null', 'undefined', 'interface', 'type', 'enum', 'static', 'readonly',
  'public', 'private', 'protected', 'void', 'string', 'number', 'boolean',
  'def', 'self', 'None', 'True', 'False', 'lambda', 'with',
])

function highlightLine(text: string) {
  const regex = /(\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|[a-zA-Z_$][\w$]*|[^\s\w]|\s+)/gm
  const tokens: { text: string; color: string }[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const t = match[0]
    let color = 'inherit'
    if (t.startsWith('//') || t.startsWith('#')) color = 'var(--inline-edit-syntax-comment, #6a9955)'
    else if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) || (t.startsWith('`') && t.endsWith('`'))) color = 'var(--inline-edit-syntax-string, #ce9178)'
    else if (/^\d/.test(t)) color = 'var(--inline-edit-syntax-number, #b5cea8)'
    else if (KEYWORDS.has(t)) color = 'var(--inline-edit-syntax-keyword, #569cd6)'
    else if (/^[^\s\w]$/.test(t)) color = 'var(--inline-edit-syntax-punct, #d4d4d4)'
    tokens.push({ text: t, color })
  }
  if (tokens.length === 0) return <span>{text}</span>
  return <>{tokens.map((tok, i) => <span key={i} style={{ color: tok.color }}>{tok.text}</span>)}</>
}

// ── Phase type ─────────────────────────────────────────────

type Phase = 'input' | 'loading' | 'preview' | 'streaming'

// ── Component ──────────────────────────────────────────────

export default function InlineEdit({
  visible,
  onClose,
  onSubmit,
  onAccept,
  onReject,
  isProcessing,
  selectedText,
  position,
  selectionRange,
  aiResponse,
  streamingResponse,
  language,
}: Props) {
  const [instruction, setInstruction] = useState('')
  const [fadeIn, setFadeIn] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [hunkStatuses, setHunkStatuses] = useState<Record<number, 'pending' | 'accepted' | 'rejected'>>({})

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Determine the current phase
  const phase: Phase = useMemo(() => {
    if (streamingResponse && isProcessing) return 'streaming'
    if (aiResponse) return 'preview'
    if (isProcessing) return 'loading'
    return 'input'
  }, [aiResponse, isProcessing, streamingResponse])

  // Compute diff for preview phase
  const diffLines = useMemo(() => {
    const response = aiResponse || streamingResponse
    if (!response || !selectedText) return []
    return computeInlineDiff(selectedText, response)
  }, [aiResponse, streamingResponse, selectedText])

  // Group into hunks for per-hunk accept/reject
  const hunks = useMemo(() => groupIntoHunks(diffLines), [diffLines])

  const addedCount = useMemo(() => diffLines.filter(l => l.type === 'added').length, [diffLines])
  const removedCount = useMemo(() => diffLines.filter(l => l.type === 'removed').length, [diffLines])

  // Token estimation
  const tokenEstimate = useMemo(() => estimateTokens(selectedText), [selectedText])

  // Fade-in animation
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => setFadeIn(true))
    } else {
      setFadeIn(false)
    }
  }, [visible])

  // Auto-focus and reset on open
  useEffect(() => {
    if (visible && phase === 'input') {
      setInstruction('')
      setShowContext(false)
      setHistoryIndex(-1)
      setHunkStatuses({})
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [visible, phase])

  // Auto-resize textarea
  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [])

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInstruction(e.target.value)
    setHistoryIndex(-1)
    autoResize(e.target)
  }, [autoResize])

  // Submit handler
  const handleSubmit = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isProcessing) return
    addToHistory(trimmed)
    onSubmit(trimmed)
  }, [isProcessing, onSubmit])

  // Build accepted code from hunks
  const buildCodeFromHunks = useCallback(() => {
    const resultLines: string[] = []
    for (const hunk of hunks) {
      const status = hunkStatuses[hunk.index] ?? 'accepted'
      const hasChanges = hunk.lines.some(l => l.type !== 'unchanged')
      for (const line of hunk.lines) {
        if (!hasChanges) {
          resultLines.push(line.content)
        } else if (status === 'accepted' || status === 'pending') {
          if (line.type !== 'removed') resultLines.push(line.content)
        } else {
          // rejected: keep original
          if (line.type !== 'added') resultLines.push(line.content)
        }
      }
    }
    return resultLines.join('\n')
  }, [hunks, hunkStatuses])

  // Accept with per-hunk logic
  const handleAccept = useCallback(() => {
    if (!onAccept) return
    const hasAnyHunkDecision = Object.keys(hunkStatuses).length > 0
    if (hasAnyHunkDecision) {
      onAccept(buildCodeFromHunks())
    } else if (aiResponse) {
      onAccept(aiResponse)
    }
  }, [onAccept, hunkStatuses, buildCodeFromHunks, aiResponse])

  // Keyboard shortcuts for input
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter: allow newline (default textarea behavior)
    if (e.key === 'Enter' && e.shiftKey) {
      return // Let default behavior add newline
    }

    // Ctrl+Enter or Enter (without shift): submit
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(instruction)
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }

    // Up/Down arrow for history navigation (only when cursor is at start/end)
    const el = e.currentTarget
    const history = loadHistory()

    if (e.key === 'ArrowUp' && el.selectionStart === 0 && el.selectionEnd === 0 && history.length > 0) {
      e.preventDefault()
      const newIndex = Math.min(historyIndex + 1, history.length - 1)
      setHistoryIndex(newIndex)
      setInstruction(history[newIndex])
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart = 0
          inputRef.current.selectionEnd = 0
          autoResize(inputRef.current)
        }
      }, 0)
      return
    }

    if (e.key === 'ArrowDown' && el.selectionStart === el.value.length && historyIndex >= 0) {
      e.preventDefault()
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      if (newIndex < 0) {
        setInstruction('')
      } else {
        setInstruction(history[newIndex])
      }
      setTimeout(() => {
        if (inputRef.current) autoResize(inputRef.current)
      }, 0)
      return
    }
  }, [instruction, historyIndex, handleSubmit, onClose, autoResize])

  // Global keyboard handler for preview/streaming phase
  useEffect(() => {
    if (!visible || (phase !== 'preview' && phase !== 'streaming')) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (onReject) onReject()
        onClose()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        handleAccept()
      }
      if (e.key === 'Tab' && !e.ctrlKey && !e.shiftKey && !e.altKey && phase === 'preview') {
        e.preventDefault()
        handleAccept()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [visible, phase, handleAccept, onReject, onClose])

  // Hunk accept/reject handlers
  const handleHunkAccept = useCallback((hunkIndex: number) => {
    setHunkStatuses(prev => ({ ...prev, [hunkIndex]: 'accepted' }))
  }, [])

  const handleHunkReject = useCallback((hunkIndex: number) => {
    setHunkStatuses(prev => ({ ...prev, [hunkIndex]: 'rejected' }))
  }, [])

  if (!visible) return null

  const lineCount = selectedText ? selectedText.split('\n').length : 0
  const hasSelection = selectedText.length > 0

  // ── Styles ─────────────────────────────────────────────────

  const kbdStyle: React.CSSProperties = {
    padding: '1px 5px',
    background: 'var(--inline-edit-kbd-bg, rgba(255,255,255,0.07))',
    borderRadius: 3,
    fontSize: 10,
    border: '1px solid var(--inline-edit-kbd-border, rgba(255,255,255,0.1))',
    fontFamily: 'inherit',
    color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.35))',
  }

  const quickActionBtnStyle: React.CSSProperties = {
    padding: '3px 8px',
    fontSize: 10,
    fontWeight: 500,
    color: 'var(--inline-edit-text-secondary, rgba(255,255,255,0.5))',
    background: 'var(--inline-edit-action-bg, rgba(255,255,255,0.04))',
    border: '1px solid var(--inline-edit-action-border, rgba(255,255,255,0.08))',
    borderRadius: 4,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    transition: 'all 0.15s',
    whiteSpace: 'nowrap' as const,
  }

  // ── Render Diff Lines (shared between preview and streaming) ──

  const renderDiffContent = (isStreaming: boolean) => {
    const changedHunks = hunks.filter(h => h.lines.some(l => l.type !== 'unchanged'))

    return (
      <div style={{ padding: '4px 0' }}>
        {hunks.map((hunk) => {
          const hasChanges = hunk.lines.some(l => l.type !== 'unchanged')
          const hunkStatus = hunkStatuses[hunk.index] ?? 'pending'

          return (
            <div key={hunk.index} style={{ position: 'relative' }}>
              {/* Per-hunk accept/reject buttons */}
              {hasChanges && !isStreaming && changedHunks.length > 1 && (
                <div style={{
                  position: 'absolute',
                  right: 8,
                  top: 2,
                  zIndex: 2,
                  display: 'flex',
                  gap: 2,
                  opacity: 0.7,
                  transition: 'opacity 0.15s',
                }}>
                  {hunkStatus === 'pending' ? (
                    <>
                      <button
                        onClick={() => handleHunkAccept(hunk.index)}
                        title="Accept this change"
                        style={{
                          background: 'var(--inline-edit-hunk-accept-bg, rgba(63,185,80,0.2))',
                          border: '1px solid var(--inline-edit-hunk-accept-border, rgba(63,185,80,0.3))',
                          borderRadius: 3,
                          padding: '2px 4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          color: 'var(--inline-edit-added-color, #3fb950)',
                        }}
                      >
                        <Check size={10} />
                      </button>
                      <button
                        onClick={() => handleHunkReject(hunk.index)}
                        title="Reject this change"
                        style={{
                          background: 'var(--inline-edit-hunk-reject-bg, rgba(248,81,73,0.2))',
                          border: '1px solid var(--inline-edit-hunk-reject-border, rgba(248,81,73,0.3))',
                          borderRadius: 3,
                          padding: '2px 4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          color: 'var(--inline-edit-removed-color, #f85149)',
                        }}
                      >
                        <X size={10} />
                      </button>
                    </>
                  ) : (
                    <span style={{
                      fontSize: 9,
                      padding: '2px 6px',
                      borderRadius: 3,
                      fontWeight: 600,
                      background: hunkStatus === 'accepted'
                        ? 'var(--inline-edit-hunk-accept-bg, rgba(63,185,80,0.2))'
                        : 'var(--inline-edit-hunk-reject-bg, rgba(248,81,73,0.2))',
                      color: hunkStatus === 'accepted'
                        ? 'var(--inline-edit-added-color, #3fb950)'
                        : 'var(--inline-edit-removed-color, #f85149)',
                      border: `1px solid ${hunkStatus === 'accepted' ? 'rgba(63,185,80,0.3)' : 'rgba(248,81,73,0.3)'}`,
                      cursor: 'pointer',
                    }}
                      onClick={() => setHunkStatuses(prev => {
                        const copy = { ...prev }
                        delete copy[hunk.index]
                        return copy
                      })}
                      title="Click to reset"
                    >
                      {hunkStatus === 'accepted' ? 'Accepted' : 'Rejected'}
                    </span>
                  )}
                </div>
              )}

              {hunk.lines.map((line, i) => {
                const dimmed = hasChanges && hunkStatus === 'rejected' && line.type === 'added'
                const restored = hasChanges && hunkStatus === 'rejected' && line.type === 'removed'
                const accepted = hasChanges && hunkStatus === 'accepted'

                const bg = dimmed
                  ? 'var(--inline-edit-dimmed-bg, rgba(255,255,255,0.02))'
                  : restored
                    ? 'var(--inline-edit-restored-bg, rgba(255,255,255,0.04))'
                    : line.type === 'added'
                      ? 'var(--inline-edit-added-bg, rgba(63,185,80,0.1))'
                      : line.type === 'removed'
                        ? 'var(--inline-edit-removed-bg, rgba(248,81,73,0.1))'
                        : 'transparent'

                const borderLeft = dimmed || restored
                  ? '3px solid var(--inline-edit-dimmed-border, rgba(255,255,255,0.1))'
                  : line.type === 'added'
                    ? '3px solid var(--inline-edit-added-color, #3fb950)'
                    : line.type === 'removed'
                      ? '3px solid var(--inline-edit-removed-color, #f85149)'
                      : '3px solid transparent'

                const textColor = dimmed
                  ? 'var(--inline-edit-dimmed-text, rgba(255,255,255,0.2))'
                  : restored
                    ? 'var(--inline-edit-text, #e4e4e7)'
                    : line.type === 'removed'
                      ? 'var(--inline-edit-removed-text, rgba(255,255,255,0.4))'
                      : 'var(--inline-edit-text, #e4e4e7)'

                const textDecoration = (line.type === 'removed' && !restored) ? 'line-through' : dimmed ? 'line-through' : 'none'
                const marker = dimmed ? '~' : restored ? ' ' : line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '
                const markerColor = dimmed
                  ? 'var(--inline-edit-dimmed-text, rgba(255,255,255,0.2))'
                  : line.type === 'added'
                    ? 'var(--inline-edit-added-color, #3fb950)'
                    : line.type === 'removed'
                      ? 'var(--inline-edit-removed-color, #f85149)'
                      : 'transparent'

                return (
                  <div
                    key={`${hunk.index}-${i}`}
                    style={{
                      display: 'flex',
                      background: bg,
                      borderLeft,
                      padding: '0 12px 0 0',
                      minHeight: 20,
                      opacity: dimmed ? 0.5 : line.type === 'removed' && !restored ? 0.7 : 1,
                    }}
                  >
                    <span style={{
                      width: 20, minWidth: 20,
                      color: markerColor,
                      fontWeight: 700,
                      userSelect: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                    }}>
                      {marker}
                    </span>
                    <span style={{
                      flex: 1,
                      whiteSpace: 'pre',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color: textColor,
                      textDecoration,
                    }}>
                      {highlightLine(line.content)}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* Streaming cursor indicator */}
        {isStreaming && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 12px',
            gap: 6,
          }}>
            <div style={{
              width: 6, height: 6,
              borderRadius: '50%',
              background: 'var(--inline-edit-accent, #58a6ff)',
              animation: 'inlineEditPulse 1s ease-in-out infinite',
            }} />
            <span style={{
              fontSize: 10,
              color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.35))',
              fontStyle: 'italic',
            }}>
              Generating...
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: position.top,
        left: Math.max(position.left, 40),
        zIndex: 60,
        width: 560,
        maxWidth: 'calc(100vw - 80px)',
        opacity: fadeIn ? 1 : 0,
        transform: fadeIn ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.98)',
        transition: 'opacity 0.2s ease-out, transform 0.2s ease-out',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          background: 'var(--inline-edit-bg, #1e1e2e)',
          border: '1px solid var(--inline-edit-border, rgba(88,166,255,0.3))',
          borderRadius: 10,
          boxShadow: 'var(--inline-edit-shadow, 0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(88,166,255,0.1), 0 0 80px rgba(88,166,255,0.05))',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ── Header ──────────────────────────────────────── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--inline-edit-separator, rgba(255,255,255,0.06))',
          background: 'var(--inline-edit-header-bg, linear-gradient(135deg, rgba(88,166,255,0.08) 0%, rgba(139,92,246,0.05) 100%))',
        }}>
          <div style={{
            width: 20, height: 20,
            borderRadius: 5,
            background: 'var(--inline-edit-icon-bg, linear-gradient(135deg, #58a6ff 0%, #8b5cf6 100%))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Sparkles size={11} style={{ color: '#fff' }} />
          </div>
          <span style={{
            fontSize: 12,
            color: 'var(--inline-edit-text, #e4e4e7)',
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}>
            {phase === 'preview' ? 'AI Edit Preview'
              : phase === 'streaming' ? 'Generating...'
              : phase === 'loading' ? 'Generating...'
              : 'Edit with AI'}
          </span>

          {/* Selection info badge with token count */}
          {hasSelection && selectionRange && (
            <span style={{
              fontSize: 10,
              color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.5))',
              background: 'var(--inline-edit-badge-bg, rgba(255,255,255,0.06))',
              padding: '2px 8px',
              borderRadius: 10,
              fontFamily: "'Cascadia Code', 'Fira Code', monospace",
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{ color: 'var(--inline-edit-accent, #58a6ff)' }}>L{selectionRange.startLine}</span>
              {selectionRange.startLine !== selectionRange.endLine && (
                <>
                  <ChevronRight size={8} style={{ opacity: 0.4 }} />
                  <span style={{ color: 'var(--inline-edit-accent, #58a6ff)' }}>L{selectionRange.endLine}</span>
                </>
              )}
              <span style={{ opacity: 0.6, marginLeft: 2 }}>({lineCount} line{lineCount !== 1 ? 's' : ''})</span>
              <span style={{
                opacity: 0.4,
                borderLeft: '1px solid rgba(255,255,255,0.1)',
                paddingLeft: 4,
                marginLeft: 2,
              }}>
                ~{tokenEstimate} tokens
              </span>
            </span>
          )}
          {hasSelection && !selectionRange && (
            <span style={{
              fontSize: 10,
              color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.5))',
              background: 'var(--inline-edit-badge-bg, rgba(255,255,255,0.06))',
              padding: '2px 8px',
              borderRadius: 10,
            }}>
              {lineCount} line{lineCount !== 1 ? 's' : ''} selected
              <span style={{ opacity: 0.5, marginLeft: 4 }}>~{tokenEstimate} tok</span>
            </span>
          )}

          {/* Phase indicators */}
          {(phase === 'preview' || phase === 'streaming') && (
            <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
              <span style={{
                fontSize: 10, color: 'var(--inline-edit-added-color, #3fb950)',
                background: 'var(--inline-edit-added-bg, rgba(63,185,80,0.12))',
                padding: '2px 6px', borderRadius: 3, fontWeight: 500,
              }}>+{addedCount}</span>
              <span style={{
                fontSize: 10, color: 'var(--inline-edit-removed-color, #f85149)',
                background: 'var(--inline-edit-removed-bg, rgba(248,81,73,0.12))',
                padding: '2px 6px', borderRadius: 3, fontWeight: 500,
              }}>-{removedCount}</span>
            </div>
          )}

          {/* Close button */}
          <button
            onClick={() => {
              if ((phase === 'preview' || phase === 'streaming') && onReject) onReject()
              onClose()
            }}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              color: 'var(--inline-edit-close-color, rgba(255,255,255,0.3))',
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              marginLeft: (phase === 'preview' || phase === 'streaming') ? 0 : 'auto',
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'rgba(255,255,255,0.7)'
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--inline-edit-close-color, rgba(255,255,255,0.3))'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Input Phase ──────────────────────────────────── */}
        {phase === 'input' && (
          <>
            {/* Input row */}
            <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              {/* Multi-line textarea */}
              <textarea
                ref={inputRef}
                value={instruction}
                onChange={handleTextareaChange}
                onKeyDown={handleInputKeyDown}
                placeholder={hasSelection
                  ? 'Describe changes to the selected code...'
                  : 'Describe code to generate at cursor...'}
                rows={1}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  background: 'var(--inline-edit-input-bg, rgba(255,255,255,0.04))',
                  border: '1px solid var(--inline-edit-input-border, rgba(255,255,255,0.08))',
                  borderRadius: 8,
                  outline: 'none',
                  fontSize: 13,
                  color: 'var(--inline-edit-text, #e4e4e7)',
                  fontFamily: "'Inter', -apple-system, sans-serif",
                  resize: 'none',
                  lineHeight: '1.5',
                  minHeight: 36,
                  maxHeight: 160,
                  transition: 'border-color 0.15s',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--inline-edit-accent, rgba(88,166,255,0.4))' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--inline-edit-input-border, rgba(255,255,255,0.08))' }}
              />
              <button
                onClick={() => handleSubmit(instruction)}
                disabled={!instruction.trim() || isProcessing}
                style={{
                  padding: '8px 16px',
                  background: instruction.trim()
                    ? 'var(--inline-edit-submit-bg, linear-gradient(135deg, #58a6ff 0%, #8b5cf6 100%))'
                    : 'var(--inline-edit-action-bg, rgba(255,255,255,0.04))',
                  color: instruction.trim() ? '#fff' : 'var(--inline-edit-text-muted, rgba(255,255,255,0.2))',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: instruction.trim() ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.2s',
                  flexShrink: 0,
                  height: 36,
                  opacity: instruction.trim() ? 1 : 0.6,
                }}
              >
                <Sparkles size={12} />
                Edit
              </button>
            </div>

            {/* Quick action buttons */}
            {hasSelection && (
              <div style={{
                padding: '0 12px 8px',
                display: 'flex',
                gap: 4,
                flexWrap: 'wrap',
              }}>
                {QUICK_ACTIONS.map((action) => {
                  const Icon = action.icon
                  return (
                    <button
                      key={action.label}
                      onClick={() => {
                        setInstruction(action.instruction)
                        handleSubmit(action.instruction)
                      }}
                      style={quickActionBtnStyle}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--inline-edit-action-hover-bg, rgba(88,166,255,0.1))'
                        e.currentTarget.style.borderColor = 'var(--inline-edit-accent, rgba(88,166,255,0.3))'
                        e.currentTarget.style.color = 'var(--inline-edit-accent, #58a6ff)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--inline-edit-action-bg, rgba(255,255,255,0.04))'
                        e.currentTarget.style.borderColor = 'var(--inline-edit-action-border, rgba(255,255,255,0.08))'
                        e.currentTarget.style.color = 'var(--inline-edit-text-secondary, rgba(255,255,255,0.5))'
                      }}
                    >
                      <Icon size={10} />
                      {action.label}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Selected text context preview */}
            {hasSelection && (
              <div style={{ padding: '0 12px 10px' }}>
                <button
                  onClick={() => setShowContext(!showContext)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.4))',
                    fontSize: 10,
                    cursor: 'pointer',
                    padding: '2px 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontFamily: "'Inter', -apple-system, sans-serif",
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--inline-edit-text-muted, rgba(255,255,255,0.4))' }}
                >
                  <ChevronRight
                    size={10}
                    style={{
                      transform: showContext ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s',
                    }}
                  />
                  {showContext ? 'Hide' : 'Show'} selected code
                </button>
                {showContext && (
                  <div style={{
                    marginTop: 6,
                    background: 'var(--inline-edit-context-bg, rgba(0,0,0,0.3))',
                    borderRadius: 6,
                    border: '1px solid var(--inline-edit-context-border, rgba(255,255,255,0.04))',
                    maxHeight: 150,
                    overflow: 'auto',
                    padding: '8px 10px',
                    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
                    fontSize: 11,
                    lineHeight: '18px',
                    color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.5))',
                    whiteSpace: 'pre',
                    tabSize: 2,
                  }}>
                    {selectedText.split('\n').map((line, i) => (
                      <div key={i} style={{ display: 'flex', minHeight: 18 }}>
                        <span style={{
                          width: 30, minWidth: 30, textAlign: 'right',
                          paddingRight: 10, color: 'rgba(255,255,255,0.15)',
                          userSelect: 'none', fontSize: 10,
                        }}>
                          {(selectionRange?.startLine ?? 1) + i}
                        </span>
                        <span style={{ color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.5))' }}>{highlightLine(line)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Hint bar */}
            <div style={{
              padding: '6px 12px',
              borderTop: '1px solid var(--inline-edit-separator, rgba(255,255,255,0.04))',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: 'var(--inline-edit-footer-bg, rgba(0,0,0,0.15))',
              flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 10, color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.25))', display: 'flex', alignItems: 'center', gap: 4 }}>
                <kbd style={kbdStyle}>Enter</kbd> submit
              </span>
              <span style={{ fontSize: 10, color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.25))', display: 'flex', alignItems: 'center', gap: 4 }}>
                <kbd style={kbdStyle}>Shift+Enter</kbd> new line
              </span>
              <span style={{ fontSize: 10, color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.25))', display: 'flex', alignItems: 'center', gap: 4 }}>
                <kbd style={kbdStyle}>↑↓</kbd> history
              </span>
              <span style={{ fontSize: 10, color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.25))', display: 'flex', alignItems: 'center', gap: 4 }}>
                <kbd style={kbdStyle}>Esc</kbd> cancel
              </span>
            </div>
          </>
        )}

        {/* ── Loading Phase ────────────────────────────────── */}
        {phase === 'loading' && (
          <div style={{
            padding: '24px 16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}>
            <div style={{
              position: 'relative',
              width: 36, height: 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: '2px solid var(--inline-edit-spinner-track, rgba(88,166,255,0.1))',
                borderTopColor: 'var(--inline-edit-accent, #58a6ff)',
                animation: 'inlineEditSpin 0.8s linear infinite',
              }} />
              <Sparkles size={14} style={{ color: 'var(--inline-edit-accent, #58a6ff)' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--inline-edit-text, #e4e4e7)', fontWeight: 500 }}>
                Generating edit...
              </div>
              <div style={{
                fontSize: 10, color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.35))', marginTop: 4,
              }}>
                {hasSelection
                  ? `Editing ${lineCount} line${lineCount !== 1 ? 's' : ''}`
                  : 'Generating code at the cursor'}
              </div>
            </div>
            <div style={{
              width: '80%', height: 2,
              background: 'var(--inline-edit-progress-track, rgba(255,255,255,0.04))',
              borderRadius: 1, overflow: 'hidden',
            }}>
              <div style={{
                width: '40%', height: '100%',
                background: 'var(--inline-edit-progress-bar, linear-gradient(90deg, transparent 0%, #58a6ff 50%, transparent 100%))',
                borderRadius: 1,
                animation: 'inlineEditProgress 1.5s ease-in-out infinite',
              }} />
            </div>
          </div>
        )}

        {/* ── Streaming Phase (real-time diff) ────────────── */}
        {phase === 'streaming' && streamingResponse && (
          <>
            <div style={{
              maxHeight: 350,
              overflow: 'auto',
              fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
              fontSize: 12,
              lineHeight: '20px',
            }}>
              {diffLines.length > 0 ? renderDiffContent(true) : (
                <div style={{ padding: '16px', textAlign: 'center' }}>
                  <Loader2 size={16} style={{
                    color: 'var(--inline-edit-accent, #58a6ff)',
                    animation: 'inlineEditSpin 0.8s linear infinite',
                  }} />
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Preview Phase (Diff) ─────────────────────────── */}
        {phase === 'preview' && aiResponse && (
          <>
            {/* Diff view */}
            <div style={{
              maxHeight: 350,
              overflow: 'auto',
              fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
              fontSize: 12,
              lineHeight: '20px',
            }}>
              {diffLines.length > 0 ? renderDiffContent(false) : (
                <div style={{ padding: '8px 12px' }}>
                  {aiResponse.split('\n').map((line, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      minHeight: 20,
                      background: 'var(--inline-edit-added-bg, rgba(63,185,80,0.08))',
                      borderLeft: '3px solid var(--inline-edit-added-color, #3fb950)',
                      padding: '0 12px 0 0',
                    }}>
                      <span style={{
                        width: 20, minWidth: 20,
                        color: 'var(--inline-edit-added-color, #3fb950)', fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11,
                      }}>+</span>
                      <span style={{ flex: 1, whiteSpace: 'pre', color: 'var(--inline-edit-text, #e4e4e7)' }}>
                        {highlightLine(line)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderTop: '1px solid var(--inline-edit-separator, rgba(255,255,255,0.06))',
              background: 'var(--inline-edit-footer-bg, rgba(0,0,0,0.2))',
              gap: 8,
            }}>
              {/* Keyboard shortcuts hint */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.25))', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <kbd style={kbdStyle}>Tab</kbd> accept
                </span>
                <span style={{ fontSize: 10, color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.25))', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <kbd style={kbdStyle}>Esc</kbd> reject
                </span>
                <span style={{ fontSize: 10, color: 'var(--inline-edit-text-muted, rgba(255,255,255,0.25))', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <kbd style={kbdStyle}>Ctrl+Enter</kbd> accept
                </span>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {/* Reject button */}
                <button
                  onClick={() => {
                    if (onReject) onReject()
                    onClose()
                  }}
                  style={{
                    padding: '5px 12px',
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--inline-edit-text-secondary, rgba(255,255,255,0.6))',
                    background: 'var(--inline-edit-action-bg, rgba(255,255,255,0.04))',
                    border: '1px solid var(--inline-edit-action-border, rgba(255,255,255,0.08))',
                    borderRadius: 6,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--inline-edit-reject-hover-bg, rgba(248,81,73,0.12))'
                    e.currentTarget.style.borderColor = 'rgba(248,81,73,0.3)'
                    e.currentTarget.style.color = 'var(--inline-edit-removed-color, #f85149)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--inline-edit-action-bg, rgba(255,255,255,0.04))'
                    e.currentTarget.style.borderColor = 'var(--inline-edit-action-border, rgba(255,255,255,0.08))'
                    e.currentTarget.style.color = 'var(--inline-edit-text-secondary, rgba(255,255,255,0.6))'
                  }}
                >
                  <X size={11} />
                  Reject
                </button>

                {/* Accept button */}
                <button
                  onClick={handleAccept}
                  style={{
                    padding: '5px 14px',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#fff',
                    background: 'var(--inline-edit-accept-bg, linear-gradient(135deg, #2ea043 0%, #3fb950 100%))',
                    border: '1px solid var(--inline-edit-added-color, #3fb950)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    transition: 'all 0.15s',
                    boxShadow: '0 2px 8px rgba(63,185,80,0.3)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, #238636 0%, #2ea043 100%)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--inline-edit-accept-bg, linear-gradient(135deg, #2ea043 0%, #3fb950 100%))'
                  }}
                >
                  <Check size={12} />
                  Accept
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes inlineEditSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes inlineEditProgress {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(200%); }
          100% { transform: translateX(-100%); }
        }
        @keyframes inlineEditPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
