import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, X, ChevronDown, ChevronUp } from 'lucide-react'

/* ── Types ──────────────────────────────────────────────── */

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged'
  content: string
  oldLineNo?: number
  newLineNo?: number
}

export interface InlineDiffProps {
  originalCode: string
  suggestedCode: string
  language: string
  onAccept: (newCode: string) => void
  onReject: () => void
  position: { top: number; left: number }
  visible: boolean
}

/* ── Diff computation ───────────────────────────────────── */

function computeDiff(original: string, suggested: string): DiffLine[] {
  const oldLines = original.split('\n')
  const newLines = suggested.split('\n')

  // Simple LCS-based diff
  const m = oldLines.length
  const n = newLines.length

  // Build LCS table
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

  // Backtrack to produce diff lines
  const result: DiffLine[] = []
  let i = m
  let j = n
  const stack: DiffLine[] = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: 'unchanged', content: oldLines[i - 1], oldLineNo: i, newLineNo: j })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', content: newLines[j - 1], newLineNo: j })
      j--
    } else {
      stack.push({ type: 'removed', content: oldLines[i - 1], oldLineNo: i })
      i--
    }
  }

  // Reverse to get correct order
  for (let k = stack.length - 1; k >= 0; k--) {
    result.push(stack[k])
  }

  return result
}

/* ── Component ──────────────────────────────────────────── */

export default function InlineDiff({
  originalCode,
  suggestedCode,
  language,
  onAccept,
  onReject,
  position,
  visible,
}: InlineDiffProps) {
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified')
  const [fadeIn, setFadeIn] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Compute diff lines
  const diffLines = computeDiff(originalCode, suggestedCode)
  const addedCount = diffLines.filter((l) => l.type === 'added').length
  const removedCount = diffLines.filter((l) => l.type === 'removed').length

  // Fade-in animation
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => setFadeIn(true))
    } else {
      setFadeIn(false)
    }
  }, [visible])

  // Keyboard shortcuts: Ctrl+Enter to accept, Escape to reject
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onReject()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onAccept(suggestedCode)
      }
    },
    [visible, onAccept, onReject, suggestedCode],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])

  if (!visible) return null

  const lineStyles = {
    added: {
      background: 'rgba(63, 185, 80, 0.12)',
      borderLeft: '3px solid #3fb950',
    },
    removed: {
      background: 'rgba(248, 81, 73, 0.12)',
      borderLeft: '3px solid #f85149',
      textDecoration: 'line-through' as const,
      opacity: 0.7,
    },
    unchanged: {
      background: 'transparent',
      borderLeft: '3px solid transparent',
    },
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        zIndex: 55,
        minWidth: 480,
        maxWidth: 700,
        maxHeight: 420,
        opacity: fadeIn ? 1 : 0,
        transform: fadeIn ? 'translateY(0)' : 'translateY(-6px)',
        transition: 'opacity 0.25s ease-out, transform 0.25s ease-out',
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--accent)',
          borderRadius: 10,
          boxShadow: '0 12px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(88,166,255,0.15)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 420,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(88,166,255,0.06)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>
            AI Suggestion
          </span>
          <span
            style={{
              fontSize: 10,
              color: '#3fb950',
              background: 'rgba(63,185,80,0.12)',
              padding: '1px 6px',
              borderRadius: 3,
              fontWeight: 500,
            }}
          >
            +{addedCount}
          </span>
          <span
            style={{
              fontSize: 10,
              color: '#f85149',
              background: 'rgba(248,81,73,0.12)',
              padding: '1px 6px',
              borderRadius: 3,
              fontWeight: 500,
            }}
          >
            -{removedCount}
          </span>

          {/* View mode toggle */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
            <button
              onClick={() => setViewMode('unified')}
              style={{
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 500,
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                color: viewMode === 'unified' ? '#fff' : 'var(--text-muted)',
                background: viewMode === 'unified' ? 'var(--accent)' : 'transparent',
                transition: 'all 0.15s',
              }}
            >
              Unified
            </button>
            <button
              onClick={() => setViewMode('split')}
              style={{
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 500,
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                color: viewMode === 'split' ? '#fff' : 'var(--text-muted)',
                background: viewMode === 'split' ? 'var(--accent)' : 'transparent',
                transition: 'all 0.15s',
              }}
            >
              Split
            </button>
          </div>
        </div>

        {/* Diff body */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
            fontSize: 12,
            lineHeight: '20px',
          }}
        >
          {viewMode === 'unified' ? (
            /* Unified diff view */
            <div style={{ padding: '4px 0' }}>
              {diffLines.map((line, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    ...lineStyles[line.type],
                    padding: '0 12px 0 0',
                    minHeight: 20,
                  }}
                >
                  {/* Gutter with line numbers */}
                  <span
                    style={{
                      width: 36,
                      minWidth: 36,
                      textAlign: 'right',
                      paddingRight: 8,
                      color: 'var(--text-muted)',
                      fontSize: 10,
                      opacity: 0.5,
                      userSelect: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                    }}
                  >
                    {line.type === 'removed'
                      ? line.oldLineNo ?? ''
                      : line.type === 'added'
                        ? ''
                        : line.oldLineNo ?? ''}
                  </span>
                  <span
                    style={{
                      width: 36,
                      minWidth: 36,
                      textAlign: 'right',
                      paddingRight: 8,
                      color: 'var(--text-muted)',
                      fontSize: 10,
                      opacity: 0.5,
                      userSelect: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                    }}
                  >
                    {line.type === 'added'
                      ? line.newLineNo ?? ''
                      : line.type === 'removed'
                        ? ''
                        : line.newLineNo ?? ''}
                  </span>
                  {/* Diff marker */}
                  <span
                    style={{
                      width: 16,
                      minWidth: 16,
                      color:
                        line.type === 'added'
                          ? '#3fb950'
                          : line.type === 'removed'
                            ? '#f85149'
                            : 'transparent',
                      fontWeight: 700,
                      userSelect: 'none',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  {/* Code content */}
                  <span
                    style={{
                      flex: 1,
                      whiteSpace: 'pre',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color:
                        line.type === 'removed'
                          ? 'var(--text-muted)'
                          : 'var(--text-primary)',
                    }}
                  >
                    {line.content}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            /* Split diff view */
            <div style={{ display: 'flex', minHeight: 0 }}>
              {/* Left: original */}
              <div
                style={{
                  flex: 1,
                  borderRight: '1px solid var(--border)',
                  padding: '4px 0',
                  overflow: 'auto',
                }}
              >
                <div
                  style={{
                    padding: '2px 8px',
                    fontSize: 10,
                    color: '#f85149',
                    fontWeight: 600,
                    borderBottom: '1px solid var(--border)',
                    marginBottom: 2,
                  }}
                >
                  Original
                </div>
                {diffLines
                  .filter((l) => l.type !== 'added')
                  .map((line, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '0 8px',
                        minHeight: 20,
                        display: 'flex',
                        alignItems: 'center',
                        background:
                          line.type === 'removed'
                            ? 'rgba(248, 81, 73, 0.1)'
                            : 'transparent',
                        whiteSpace: 'pre',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color:
                          line.type === 'removed'
                            ? 'var(--text-muted)'
                            : 'var(--text-primary)',
                        textDecoration:
                          line.type === 'removed' ? 'line-through' : 'none',
                        opacity: line.type === 'removed' ? 0.7 : 1,
                      }}
                    >
                      <span
                        style={{
                          width: 28,
                          minWidth: 28,
                          textAlign: 'right',
                          paddingRight: 8,
                          fontSize: 10,
                          color: 'var(--text-muted)',
                          opacity: 0.5,
                          userSelect: 'none',
                        }}
                      >
                        {line.oldLineNo ?? ''}
                      </span>
                      {line.content}
                    </div>
                  ))}
              </div>
              {/* Right: suggested */}
              <div style={{ flex: 1, padding: '4px 0', overflow: 'auto' }}>
                <div
                  style={{
                    padding: '2px 8px',
                    fontSize: 10,
                    color: '#3fb950',
                    fontWeight: 600,
                    borderBottom: '1px solid var(--border)',
                    marginBottom: 2,
                  }}
                >
                  Suggested
                </div>
                {diffLines
                  .filter((l) => l.type !== 'removed')
                  .map((line, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '0 8px',
                        minHeight: 20,
                        display: 'flex',
                        alignItems: 'center',
                        background:
                          line.type === 'added'
                            ? 'rgba(63, 185, 80, 0.1)'
                            : 'transparent',
                        whiteSpace: 'pre',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <span
                        style={{
                          width: 28,
                          minWidth: 28,
                          textAlign: 'right',
                          paddingRight: 8,
                          fontSize: 10,
                          color: 'var(--text-muted)',
                          opacity: 0.5,
                          userSelect: 'none',
                        }}
                      >
                        {line.newLineNo ?? ''}
                      </span>
                      {line.content}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer with actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderTop: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.15)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            <kbd
              style={{
                padding: '1px 4px',
                background: 'rgba(255,255,255,0.06)',
                borderRadius: 3,
                fontSize: 10,
                border: '1px solid var(--border)',
              }}
            >
              Ctrl+Enter
            </kbd>{' '}
            accept{' '}
            <kbd
              style={{
                padding: '1px 4px',
                background: 'rgba(255,255,255,0.06)',
                borderRadius: 3,
                fontSize: 10,
                border: '1px solid var(--border)',
                marginLeft: 6,
              }}
            >
              Esc
            </kbd>{' '}
            reject
          </span>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={onReject}
              style={{
                padding: '5px 14px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                background: 'var(--bg-hover)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(248,81,73,0.15)'
                e.currentTarget.style.borderColor = '#f85149'
                e.currentTarget.style.color = '#f85149'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)'
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.color = 'var(--text-secondary)'
              }}
            >
              <X size={12} />
              Reject
            </button>
            <button
              onClick={() => onAccept(suggestedCode)}
              style={{
                padding: '5px 14px',
                fontSize: 11,
                fontWeight: 600,
                color: '#fff',
                background: '#3fb950',
                border: '1px solid #3fb950',
                borderRadius: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#2ea043'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#3fb950'
              }}
            >
              <Check size={12} />
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
