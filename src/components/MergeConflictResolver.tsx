import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  memo,
} from 'react'
import {
  GitMerge,
  ChevronUp,
  ChevronDown,
  Check,
  CheckCheck,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  Combine,
  Eye,
  FileCode,
  Pencil,
  RotateCcw,
  Columns,
  AlertTriangle,
} from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'

/* ── Types ──────────────────────────────────────────────── */

export interface ConflictHunk {
  id: string
  /** Line index (0-based) where the conflict starts in the original text */
  startLine: number
  /** Line index (0-based) where the conflict ends in the original text */
  endLine: number
  currentContent: string
  incomingContent: string
  baseContent: string | null
  resolved: boolean
  resolution: 'current' | 'incoming' | 'both' | 'custom' | null
  customContent: string | null
}

export interface MergeConflictResolverProps {
  filePath: string
  fileContent: string
  /** The branch name for "current" side (defaults to HEAD) */
  currentBranch?: string
  /** The branch name for "incoming" side */
  incomingBranch?: string
  /** Called when the user finalises the merge */
  onResolve?: (resolvedContent: string) => void
  onClose?: () => void
  language?: string
}

/* ── Constants ──────────────────────────────────────────── */

const MARKER_CURRENT_START = /^<{7}\s*(.*)/
const MARKER_BASE_START = /^\|{7}\s*(.*)/
const MARKER_SEPARATOR = /^={7}/
const MARKER_INCOMING_END = /^>{7}\s*(.*)/

/* ── Conflict parser ────────────────────────────────────── */

function parseConflicts(content: string): {
  conflicts: ConflictHunk[]
  nonConflictingLines: Map<number, string>
} {
  const lines = content.split('\n')
  const conflicts: ConflictHunk[] = []
  const nonConflictingLines = new Map<number, string>()

  let i = 0
  let conflictIndex = 0

  while (i < lines.length) {
    const currentStartMatch = lines[i].match(MARKER_CURRENT_START)

    if (currentStartMatch) {
      const startLine = i
      const currentLines: string[] = []
      const incomingLines: string[] = []
      const baseLines: string[] = []
      let section: 'current' | 'base' | 'incoming' = 'current'
      let hasBase = false

      i++ // skip the <<<<<<< marker

      while (i < lines.length) {
        const baseMatch = lines[i].match(MARKER_BASE_START)
        const sepMatch = lines[i].match(MARKER_SEPARATOR)
        const endMatch = lines[i].match(MARKER_INCOMING_END)

        if (baseMatch) {
          section = 'base'
          hasBase = true
          i++
          continue
        }
        if (sepMatch) {
          section = 'incoming'
          i++
          continue
        }
        if (endMatch) {
          conflicts.push({
            id: `conflict-${conflictIndex++}`,
            startLine,
            endLine: i,
            currentContent: currentLines.join('\n'),
            incomingContent: incomingLines.join('\n'),
            baseContent: hasBase ? baseLines.join('\n') : null,
            resolved: false,
            resolution: null,
            customContent: null,
          })
          i++
          break
        }

        if (section === 'current') currentLines.push(lines[i])
        else if (section === 'base') baseLines.push(lines[i])
        else incomingLines.push(lines[i])

        i++
      }
    } else {
      nonConflictingLines.set(i, lines[i])
      i++
    }
  }

  return { conflicts, nonConflictingLines }
}

/* ── Build resolved output ──────────────────────────────── */

function buildResolvedContent(
  original: string,
  conflicts: ConflictHunk[],
): string {
  const lines = original.split('\n')
  const result: string[] = []
  let i = 0

  const conflictByStart = new Map<number, ConflictHunk>()
  for (const c of conflicts) {
    conflictByStart.set(c.startLine, c)
  }

  while (i < lines.length) {
    const conflict = conflictByStart.get(i)
    if (conflict) {
      let resolved: string
      switch (conflict.resolution) {
        case 'current':
          resolved = conflict.currentContent
          break
        case 'incoming':
          resolved = conflict.incomingContent
          break
        case 'both':
          resolved = conflict.currentContent + '\n' + conflict.incomingContent
          break
        case 'custom':
          resolved = conflict.customContent ?? ''
          break
        default:
          // Unresolved — keep markers
          for (let j = conflict.startLine; j <= conflict.endLine; j++) {
            result.push(lines[j])
          }
          i = conflict.endLine + 1
          continue
      }
      if (resolved.length > 0) {
        result.push(...resolved.split('\n'))
      }
      i = conflict.endLine + 1
    } else {
      result.push(lines[i])
      i++
    }
  }

  return result.join('\n')
}

/* ── Syntax highlight (lightweight token colouring) ────── */

const SyntaxLine = memo(function SyntaxLine({
  line,
  lineNumber,
  language,
}: {
  line: string
  lineNumber: number
  language?: string
}) {
  const highlighted = useMemo(() => {
    if (!language) return escapeHtml(line)
    return tokenHighlight(line, language)
  }, [line, language])

  return (
    <div style={{ display: 'flex', minHeight: 20, lineHeight: '20px' }}>
      <span
        style={{
          display: 'inline-block',
          width: 48,
          textAlign: 'right',
          paddingRight: 12,
          color: 'var(--text-secondary)',
          opacity: 0.5,
          userSelect: 'none',
          fontFamily: 'monospace',
          fontSize: 12,
          flexShrink: 0,
        }}
      >
        {lineNumber}
      </span>
      <span
        style={{
          fontFamily: 'monospace',
          fontSize: 13,
          whiteSpace: 'pre',
          color: 'var(--text-primary)',
        }}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </div>
  )
})

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function tokenHighlight(line: string, _language: string): string {
  let result = escapeHtml(line)

  // Keywords
  result = result.replace(
    /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|interface|type|extends|implements|new|this|super|async|await|try|catch|throw|switch|case|default|break|continue|do|in|of|typeof|instanceof|void|null|undefined|true|false)\b/g,
    '<span style="color:#c586c0">$1</span>',
  )

  // Strings
  result = result.replace(
    /(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|`[^`]*?`|"[^"]*?"|'[^']*?')/g,
    '<span style="color:#ce9178">$1</span>',
  )

  // Comments
  result = result.replace(
    /(\/\/.*$)/g,
    '<span style="color:#6a9955">$1</span>',
  )

  // Numbers
  result = result.replace(
    /\b(\d+\.?\d*)\b/g,
    '<span style="color:#b5cea8">$1</span>',
  )

  return result
}

/* ── Side-by-side diff view for a single conflict ───────── */

const SideBySideDiff = memo(function SideBySideDiff({
  current,
  incoming,
  language,
}: {
  current: string
  incoming: string
  language?: string
}) {
  const currentLines = current.split('\n')
  const incomingLines = incoming.split('\n')
  const maxLen = Math.max(currentLines.length, incomingLines.length)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 1,
        borderRadius: 4,
        overflow: 'hidden',
        border: '1px solid var(--border-primary)',
      }}
    >
      {/* Current side header */}
      <div
        style={{
          padding: '4px 8px',
          background: 'rgba(40, 160, 80, 0.15)',
          color: 'var(--text-secondary)',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        Current Change
      </div>
      <div
        style={{
          padding: '4px 8px',
          background: 'rgba(40, 100, 200, 0.15)',
          color: 'var(--text-secondary)',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        Incoming Change
      </div>

      {/* Lines */}
      <div
        style={{
          background: 'rgba(40, 160, 80, 0.06)',
          padding: '4px 0',
          overflow: 'auto',
        }}
      >
        {Array.from({ length: maxLen }).map((_, idx) => (
          <SyntaxLine
            key={idx}
            line={currentLines[idx] ?? ''}
            lineNumber={idx + 1}
            language={language}
          />
        ))}
      </div>
      <div
        style={{
          background: 'rgba(40, 100, 200, 0.06)',
          padding: '4px 0',
          overflow: 'auto',
        }}
      >
        {Array.from({ length: maxLen }).map((_, idx) => (
          <SyntaxLine
            key={idx}
            line={incomingLines[idx] ?? ''}
            lineNumber={idx + 1}
            language={language}
          />
        ))}
      </div>
    </div>
  )
})

/* ── Conflict hunk component ────────────────────────────── */

interface ConflictBlockProps {
  conflict: ConflictHunk
  index: number
  isFocused: boolean
  language?: string
  showBase: boolean
  onAcceptCurrent: (id: string) => void
  onAcceptIncoming: (id: string) => void
  onAcceptBoth: (id: string) => void
  onCustomResolve: (id: string, content: string) => void
  onReset: (id: string) => void
  onFocus: (index: number) => void
}

const ConflictBlock = memo(function ConflictBlock({
  conflict,
  index,
  isFocused,
  language,
  showBase,
  onAcceptCurrent,
  onAcceptIncoming,
  onAcceptBoth,
  onCustomResolve,
  onReset,
  onFocus,
}: ConflictBlockProps) {
  const [showDiff, setShowDiff] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const blockRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isFocused && blockRef.current) {
      blockRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isFocused])

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isEditing])

  const handleStartEdit = useCallback(() => {
    const initial =
      conflict.customContent ??
      conflict.currentContent + '\n' + conflict.incomingContent
    setEditContent(initial)
    setIsEditing(true)
  }, [conflict])

  const handleSaveEdit = useCallback(() => {
    onCustomResolve(conflict.id, editContent)
    setIsEditing(false)
  }, [conflict.id, editContent, onCustomResolve])

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false)
  }, [])

  const resolvedLabel = useMemo(() => {
    switch (conflict.resolution) {
      case 'current':
        return 'Accepted Current'
      case 'incoming':
        return 'Accepted Incoming'
      case 'both':
        return 'Accepted Both'
      case 'custom':
        return 'Custom Resolution'
      default:
        return null
    }
  }, [conflict.resolution])

  const resolvedContent = useMemo(() => {
    switch (conflict.resolution) {
      case 'current':
        return conflict.currentContent
      case 'incoming':
        return conflict.incomingContent
      case 'both':
        return conflict.currentContent + '\n' + conflict.incomingContent
      case 'custom':
        return conflict.customContent ?? ''
      default:
        return null
    }
  }, [conflict])

  const focusBorderColor = isFocused
    ? 'var(--accent-primary)'
    : 'var(--border-primary)'

  return (
    <div
      ref={blockRef}
      onClick={() => onFocus(index)}
      style={{
        border: `1px solid ${focusBorderColor}`,
        borderRadius: 6,
        marginBottom: 12,
        overflow: 'hidden',
        boxShadow: isFocused ? '0 0 0 1px var(--accent-primary)' : 'none',
        transition: 'box-shadow 0.15s, border-color 0.15s',
      }}
    >
      {/* Conflict header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border-primary)',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GitMerge size={14} style={{ color: 'var(--warning)' }} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            Conflict {index + 1}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Lines {conflict.startLine + 1}–{conflict.endLine + 1}
          </span>
          {conflict.resolved && resolvedLabel && (
            <span
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 3,
                background: 'rgba(40, 160, 80, 0.15)',
                color: 'var(--success)',
                fontWeight: 600,
              }}
            >
              {resolvedLabel}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {!conflict.resolved ? (
            <>
              <ActionButton
                icon={<ArrowUpFromLine size={12} />}
                label="Accept Current"
                color="rgba(40, 160, 80, 0.8)"
                onClick={() => onAcceptCurrent(conflict.id)}
              />
              <ActionButton
                icon={<ArrowDownToLine size={12} />}
                label="Accept Incoming"
                color="rgba(40, 100, 200, 0.8)"
                onClick={() => onAcceptIncoming(conflict.id)}
              />
              <ActionButton
                icon={<Combine size={12} />}
                label="Accept Both"
                color="rgba(180, 140, 40, 0.8)"
                onClick={() => onAcceptBoth(conflict.id)}
              />
              <ActionButton
                icon={<Pencil size={12} />}
                label="Edit"
                color="var(--text-secondary)"
                onClick={handleStartEdit}
              />
              <ActionButton
                icon={<Columns size={12} />}
                label="Compare"
                color="var(--text-secondary)"
                onClick={() => setShowDiff((d) => !d)}
                active={showDiff}
              />
            </>
          ) : (
            <ActionButton
              icon={<RotateCcw size={12} />}
              label="Reset"
              color="var(--text-secondary)"
              onClick={() => onReset(conflict.id)}
            />
          )}
        </div>
      </div>

      {/* Conflict body */}
      {!conflict.resolved ? (
        <div>
          {/* Current change */}
          <div
            style={{
              background: 'rgba(40, 160, 80, 0.08)',
              borderLeft: '3px solid rgba(40, 160, 80, 0.6)',
            }}
          >
            <div
              style={{
                padding: '3px 12px',
                fontSize: 11,
                color: 'rgba(40, 160, 80, 0.9)',
                fontWeight: 600,
                background: 'rgba(40, 160, 80, 0.12)',
              }}
            >
              {'<<<'} Current Change
            </div>
            <div style={{ padding: '4px 0' }}>
              {conflict.currentContent.split('\n').map((line, idx) => (
                <SyntaxLine
                  key={idx}
                  line={line}
                  lineNumber={conflict.startLine + 1 + idx}
                  language={language}
                />
              ))}
            </div>
          </div>

          {/* Base (common ancestor) */}
          {showBase && conflict.baseContent !== null && (
            <div
              style={{
                background: 'rgba(180, 180, 180, 0.06)',
                borderLeft: '3px solid rgba(180, 180, 180, 0.4)',
                borderTop: '1px solid var(--border-primary)',
              }}
            >
              <div
                style={{
                  padding: '3px 12px',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                  background: 'rgba(180, 180, 180, 0.08)',
                }}
              >
                ||| Common Ancestor
              </div>
              <div style={{ padding: '4px 0' }}>
                {conflict.baseContent.split('\n').map((line, idx) => (
                  <SyntaxLine
                    key={idx}
                    line={line}
                    lineNumber={idx + 1}
                    language={language}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Separator */}
          <div
            style={{
              height: 1,
              background: 'var(--border-primary)',
            }}
          />

          {/* Incoming change */}
          <div
            style={{
              background: 'rgba(40, 100, 200, 0.08)',
              borderLeft: '3px solid rgba(40, 100, 200, 0.6)',
            }}
          >
            <div
              style={{
                padding: '3px 12px',
                fontSize: 11,
                color: 'rgba(40, 100, 200, 0.9)',
                fontWeight: 600,
                background: 'rgba(40, 100, 200, 0.12)',
              }}
            >
              {'>>>'} Incoming Change
            </div>
            <div style={{ padding: '4px 0' }}>
              {conflict.incomingContent.split('\n').map((line, idx) => (
                <SyntaxLine
                  key={idx}
                  line={line}
                  lineNumber={conflict.startLine + 1 + idx}
                  language={language}
                />
              ))}
            </div>
          </div>

          {/* Side-by-side diff toggle */}
          {showDiff && (
            <div style={{ padding: 8, borderTop: '1px solid var(--border-primary)' }}>
              <SideBySideDiff
                current={conflict.currentContent}
                incoming={conflict.incomingContent}
                language={language}
              />
            </div>
          )}

          {/* Manual editing area */}
          {isEditing && (
            <div
              style={{
                borderTop: '1px solid var(--border-primary)',
                padding: 8,
                background: 'var(--bg-secondary)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                  }}
                >
                  Custom Resolution
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={handleSaveEdit}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 10px',
                      fontSize: 11,
                      background: 'var(--success)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    <Check size={11} /> Apply
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 10px',
                      fontSize: 11,
                      background: 'var(--bg-tertiary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    <X size={11} /> Cancel
                  </button>
                </div>
              </div>
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                spellCheck={false}
                style={{
                  width: '100%',
                  minHeight: 120,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  lineHeight: '20px',
                  padding: 8,
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 4,
                  resize: 'vertical',
                  outline: 'none',
                }}
              />
            </div>
          )}
        </div>
      ) : (
        /* Resolved preview */
        <div
          style={{
            background: 'rgba(40, 160, 80, 0.04)',
            borderLeft: '3px solid var(--success)',
            padding: '4px 0',
          }}
        >
          {(resolvedContent ?? '').split('\n').map((line, idx) => (
            <SyntaxLine
              key={idx}
              line={line}
              lineNumber={idx + 1}
              language={language}
            />
          ))}
        </div>
      )}
    </div>
  )
})

/* ── Small action button ────────────────────────────────── */

interface ActionButtonProps {
  icon: React.ReactNode
  label: string
  color: string
  onClick: () => void
  active?: boolean
}

const ActionButton = memo(function ActionButton({
  icon,
  label,
  color,
  onClick,
  active,
}: ActionButtonProps) {
  return (
    <button
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        fontSize: 11,
        color: active ? '#fff' : color,
        background: active ? 'var(--accent-primary)' : 'transparent',
        border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-primary)'}`,
        borderRadius: 3,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background 0.1s, color 0.1s',
      }}
    >
      {icon}
      {label}
    </button>
  )
})

/* ── Main component ─────────────────────────────────────── */

function MergeConflictResolver({
  filePath,
  fileContent,
  currentBranch = 'HEAD',
  incomingBranch = 'incoming',
  onResolve,
  onClose,
  language,
}: MergeConflictResolverProps) {
  const addToast = useToastStore((s) => s.addToast)
  const activeFilePath = useEditorStore((s) => s.activeFilePath)

  const [showBase, setShowBase] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Parse conflicts from file content
  const { conflicts: initialConflicts } = useMemo(
    () => parseConflicts(fileContent),
    [fileContent],
  )

  const [conflicts, setConflicts] = useState<ConflictHunk[]>(initialConflicts)

  // Reset when file content changes
  useEffect(() => {
    const { conflicts: parsed } = parseConflicts(fileContent)
    setConflicts(parsed)
    setFocusedIndex(0)
  }, [fileContent])

  // Summary counts
  const totalConflicts = conflicts.length
  const resolvedCount = useMemo(
    () => conflicts.filter((c) => c.resolved).length,
    [conflicts],
  )
  const remainingCount = totalConflicts - resolvedCount
  const allResolved = remainingCount === 0 && totalConflicts > 0

  // Has any base content
  const hasBaseContent = useMemo(
    () => conflicts.some((c) => c.baseContent !== null),
    [conflicts],
  )

  /* ── Conflict actions ────────────────────────────────── */

  const updateConflict = useCallback(
    (id: string, patch: Partial<ConflictHunk>) => {
      setConflicts((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      )
    },
    [],
  )

  const handleAcceptCurrent = useCallback(
    (id: string) => {
      updateConflict(id, { resolved: true, resolution: 'current' })
    },
    [updateConflict],
  )

  const handleAcceptIncoming = useCallback(
    (id: string) => {
      updateConflict(id, { resolved: true, resolution: 'incoming' })
    },
    [updateConflict],
  )

  const handleAcceptBoth = useCallback(
    (id: string) => {
      updateConflict(id, { resolved: true, resolution: 'both' })
    },
    [updateConflict],
  )

  const handleCustomResolve = useCallback(
    (id: string, content: string) => {
      updateConflict(id, {
        resolved: true,
        resolution: 'custom',
        customContent: content,
      })
    },
    [updateConflict],
  )

  const handleReset = useCallback(
    (id: string) => {
      updateConflict(id, {
        resolved: false,
        resolution: null,
        customContent: null,
      })
    },
    [updateConflict],
  )

  /* ── Bulk actions ────────────────────────────────────── */

  const handleAcceptAllCurrent = useCallback(() => {
    setConflicts((prev) =>
      prev.map((c) =>
        c.resolved ? c : { ...c, resolved: true, resolution: 'current' as const },
      ),
    )
    addToast({
      type: 'info',
      message: `Accepted all ${remainingCount} current changes`,
    })
  }, [remainingCount, addToast])

  const handleAcceptAllIncoming = useCallback(() => {
    setConflicts((prev) =>
      prev.map((c) =>
        c.resolved ? c : { ...c, resolved: true, resolution: 'incoming' as const },
      ),
    )
    addToast({
      type: 'info',
      message: `Accepted all ${remainingCount} incoming changes`,
    })
  }, [remainingCount, addToast])

  const handleResetAll = useCallback(() => {
    setConflicts((prev) =>
      prev.map((c) => ({
        ...c,
        resolved: false,
        resolution: null,
        customContent: null,
      })),
    )
  }, [])

  /* ── Navigation ──────────────────────────────────────── */

  const navigateToConflict = useCallback(
    (direction: 'next' | 'prev') => {
      if (totalConflicts === 0) return
      setFocusedIndex((prev) => {
        if (direction === 'next') {
          return (prev + 1) % totalConflicts
        }
        return (prev - 1 + totalConflicts) % totalConflicts
      })
    },
    [totalConflicts],
  )

  const handleNextConflict = useCallback(
    () => navigateToConflict('next'),
    [navigateToConflict],
  )
  const handlePrevConflict = useCallback(
    () => navigateToConflict('prev'),
    [navigateToConflict],
  )

  /* ── Keyboard shortcuts ──────────────────────────────── */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault()
        handleNextConflict()
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        handlePrevConflict()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleNextConflict, handlePrevConflict])

  /* ── Finalise merge ──────────────────────────────────── */

  const handleFinaliseMerge = useCallback(() => {
    if (!allResolved) {
      addToast({
        type: 'warning',
        message: `${remainingCount} conflict${remainingCount > 1 ? 's' : ''} still unresolved`,
      })
      return
    }

    const result = buildResolvedContent(fileContent, conflicts)
    onResolve?.(result)
    addToast({
      type: 'success',
      message: `Merge conflicts resolved for ${fileName(filePath)}`,
    })
  }, [allResolved, remainingCount, fileContent, conflicts, filePath, onResolve, addToast])

  /* ── Resolved preview ────────────────────────────────── */

  const previewContent = useMemo(
    () => buildResolvedContent(fileContent, conflicts),
    [fileContent, conflicts],
  )

  /* ── Render ──────────────────────────────────────────── */

  if (totalConflicts === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 40,
          color: 'var(--text-secondary)',
          gap: 12,
        }}
      >
        <CheckCheck size={32} style={{ color: 'var(--success)' }} />
        <span style={{ fontSize: 14 }}>No merge conflicts found in this file.</span>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
      }}
    >
      {/* ── Top toolbar ──────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-primary)',
          flexWrap: 'wrap',
          gap: 6,
          flexShrink: 0,
        }}
      >
        {/* Left: file info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GitMerge size={16} style={{ color: 'var(--warning)' }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            Merge Conflicts
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {fileName(filePath)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {currentBranch} {'<->'} {incomingBranch}
          </span>
        </div>

        {/* Right: actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {hasBaseContent && (
            <ActionButton
              icon={<Eye size={12} />}
              label="Show Base"
              color="var(--text-secondary)"
              onClick={() => setShowBase((s) => !s)}
              active={showBase}
            />
          )}
          {onClose && (
            <button
              onClick={onClose}
              title="Close"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                background: 'transparent',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Conflict summary bar ─────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 12px',
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border-primary)',
          flexWrap: 'wrap',
          gap: 6,
          flexShrink: 0,
        }}
      >
        {/* Summary badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SummaryBadge
            label="Total"
            count={totalConflicts}
            color="var(--warning)"
          />
          <SummaryBadge
            label="Resolved"
            count={resolvedCount}
            color="var(--success)"
          />
          <SummaryBadge
            label="Remaining"
            count={remainingCount}
            color={remainingCount > 0 ? 'var(--error)' : 'var(--success)'}
          />

          {/* Progress bar */}
          <div
            style={{
              width: 80,
              height: 4,
              borderRadius: 2,
              background: 'var(--bg-primary)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${totalConflicts > 0 ? (resolvedCount / totalConflicts) * 100 : 0}%`,
                background: allResolved ? 'var(--success)' : 'var(--accent-primary)',
                borderRadius: 2,
                transition: 'width 0.2s',
              }}
            />
          </div>
        </div>

        {/* Navigation and bulk actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <ActionButton
            icon={<ArrowUpFromLine size={12} />}
            label="Accept All Current"
            color="rgba(40, 160, 80, 0.8)"
            onClick={handleAcceptAllCurrent}
          />
          <ActionButton
            icon={<ArrowDownToLine size={12} />}
            label="Accept All Incoming"
            color="rgba(40, 100, 200, 0.8)"
            onClick={handleAcceptAllIncoming}
          />

          {resolvedCount > 0 && (
            <ActionButton
              icon={<RotateCcw size={12} />}
              label="Reset All"
              color="var(--text-secondary)"
              onClick={handleResetAll}
            />
          )}

          <div
            style={{
              width: 1,
              height: 18,
              background: 'var(--border-primary)',
              margin: '0 4px',
            }}
          />

          {/* Conflict navigation */}
          <button
            onClick={handlePrevConflict}
            title="Previous Conflict (Alt+Up)"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              background: 'transparent',
              border: '1px solid var(--border-primary)',
              borderRadius: 3,
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            <ChevronUp size={14} />
          </button>
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              minWidth: 40,
              textAlign: 'center',
            }}
          >
            {focusedIndex + 1} / {totalConflicts}
          </span>
          <button
            onClick={handleNextConflict}
            title="Next Conflict (Alt+Down)"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              background: 'transparent',
              border: '1px solid var(--border-primary)',
              borderRadius: 3,
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {/* ── Conflict list ────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 12,
        }}
      >
        {conflicts.map((conflict, idx) => (
          <ConflictBlock
            key={conflict.id}
            conflict={conflict}
            index={idx}
            isFocused={idx === focusedIndex}
            language={language}
            showBase={showBase}
            onAcceptCurrent={handleAcceptCurrent}
            onAcceptIncoming={handleAcceptIncoming}
            onAcceptBoth={handleAcceptBoth}
            onCustomResolve={handleCustomResolve}
            onReset={handleReset}
            onFocus={setFocusedIndex}
          />
        ))}
      </div>

      {/* ── Bottom bar: finalise ─────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'var(--bg-secondary)',
          borderTop: '1px solid var(--border-primary)',
          flexShrink: 0,
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {allResolved ? (
            <CheckCheck size={14} style={{ color: 'var(--success)' }} />
          ) : (
            <AlertTriangle size={14} style={{ color: 'var(--warning)' }} />
          )}
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {allResolved
              ? 'All conflicts resolved. Ready to complete merge.'
              : `${remainingCount} conflict${remainingCount > 1 ? 's' : ''} remaining`}
          </span>
        </div>
        <button
          onClick={handleFinaliseMerge}
          disabled={!allResolved}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 16px',
            fontSize: 12,
            fontWeight: 600,
            background: allResolved ? 'var(--success)' : 'var(--bg-tertiary)',
            color: allResolved ? '#fff' : 'var(--text-secondary)',
            border: 'none',
            borderRadius: 4,
            cursor: allResolved ? 'pointer' : 'default',
            opacity: allResolved ? 1 : 0.6,
            transition: 'background 0.15s, opacity 0.15s',
          }}
        >
          <FileCode size={13} />
          Complete Merge
        </button>
      </div>
    </div>
  )
}

/* ── Summary badge sub-component ────────────────────────── */

const SummaryBadge = memo(function SummaryBadge({
  label,
  count,
  color,
}: {
  label: string
  count: number
  color: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        {label}:
      </span>
      <span style={{ fontSize: 12, fontWeight: 700, color }}>{count}</span>
    </div>
  )
})

/* ── Helper ─────────────────────────────────────────────── */

function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path
}

export default MergeConflictResolver
