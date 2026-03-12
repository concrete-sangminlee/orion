import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  Sparkles,
  Lightbulb,
  Bug,
  TestTube,
  FileText,
  Zap,
  Check,
  X,
  MessageSquare,
  Loader,
  ThumbsUp,
  ThumbsDown,
  ChevronRight,
  Edit3,
  Eye,
  Send,
  CornerDownLeft,
  ArrowRight,
  Shield,
  Code,
  Wand2,
  Copy,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  AlertTriangle,
  Info,
} from 'lucide-react'

// ── Injected Styles ───────────────────────────────────────────────────────────

const AI_INLINE_STYLE_ID = 'orion-ai-inline-styles'

const AI_INLINE_STYLES = `
@keyframes orion-ai-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@keyframes orion-ai-fade-in {
  from { opacity: 0; transform: translateY(4px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes orion-ai-slide-in-right {
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
}

@keyframes orion-ai-pulse-glow {
  0%, 100% { box-shadow: 0 0 4px rgba(139, 92, 246, 0.2); }
  50%      { box-shadow: 0 0 12px rgba(139, 92, 246, 0.5); }
}

@keyframes orion-ai-sparkle-rotate {
  0%   { transform: rotate(0deg) scale(1); }
  25%  { transform: rotate(5deg) scale(1.1); }
  50%  { transform: rotate(0deg) scale(1); }
  75%  { transform: rotate(-5deg) scale(1.1); }
  100% { transform: rotate(0deg) scale(1); }
}

@keyframes orion-ai-typewriter-blink {
  0%, 49% { border-right-color: rgba(139, 92, 246, 0.8); }
  50%, 100% { border-right-color: transparent; }
}

@keyframes orion-ai-confidence-fill {
  from { width: 0%; }
}

@keyframes orion-ai-ghost-breathe {
  0%, 100% { opacity: 0.35; }
  50%      { opacity: 0.5; }
}

@keyframes orion-ai-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

@keyframes orion-ai-dot-bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-4px); }
}

.orion-ai-inline-action-enter {
  animation: orion-ai-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.orion-ai-ghost-text {
  animation: orion-ai-ghost-breathe 2.5s ease-in-out infinite;
}

.orion-ai-sparkle-icon {
  animation: orion-ai-sparkle-rotate 2s ease-in-out infinite;
}

.orion-ai-shimmer-bg {
  background: linear-gradient(90deg, transparent 0%, rgba(139, 92, 246, 0.06) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: orion-ai-shimmer 2s ease-in-out infinite;
}

.orion-ai-pulse-border {
  animation: orion-ai-pulse-glow 2s ease-in-out infinite;
}

.orion-ai-loader-spin {
  animation: orion-ai-spin 1s linear infinite;
}
`

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AIAction {
  id: string
  type: 'explain' | 'fix' | 'test' | 'document' | 'optimize' | 'refactor' | 'custom'
  label: string
  icon: React.ReactNode
  line: number
  column?: number
  handler: () => void
  priority?: number
  shortcut?: string
}

export interface AISuggestion {
  id: string
  content: string
  originalContent?: string
  confidence: number
  model: string
  line: number
  endLine?: number
  type: 'completion' | 'edit' | 'refactor' | 'fix'
  explanation?: string
  timestamp: number
}

export interface AIExplanation {
  line: number
  content: string
  model: string
  isLoading: boolean
}

export interface AIEditIndicator {
  startLine: number
  endLine: number
  model: string
  timestamp: number
  type: 'generated' | 'modified' | 'suggested'
}

interface InlineChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_ICONS: Record<string, React.FC<{ size?: number; style?: React.CSSProperties }>> = {
  explain: Lightbulb,
  fix: Bug,
  test: TestTube,
  document: FileText,
  optimize: Zap,
  refactor: Wand2,
  custom: Sparkles,
}

const CONFIDENCE_COLORS = {
  high: '#3fb950',
  medium: '#d29922',
  low: '#f85149',
} as const

const MODEL_BADGES: Record<string, { label: string; color: string }> = {
  'gpt-4o': { label: 'GPT-4o', color: '#74aa9c' },
  'claude-sonnet': { label: 'Sonnet', color: '#d4a574' },
  'claude-opus': { label: 'Opus', color: '#8b5cf6' },
  'gpt-4o-mini': { label: 'Mini', color: '#74aa9c' },
  'codestral': { label: 'Codestral', color: '#ff7000' },
}

function getConfidenceLevel(c: number): 'high' | 'medium' | 'low' {
  if (c >= 0.8) return 'high'
  if (c >= 0.5) return 'medium'
  return 'low'
}

function getConfidenceColor(c: number): string {
  return CONFIDENCE_COLORS[getConfidenceLevel(c)]
}

// ── Style Injection ───────────────────────────────────────────────────────────

function useInjectStyles() {
  useEffect(() => {
    if (document.getElementById(AI_INLINE_STYLE_ID)) return
    const style = document.createElement('style')
    style.id = AI_INLINE_STYLE_ID
    style.textContent = AI_INLINE_STYLES
    document.head.appendChild(style)
    return () => {
      const el = document.getElementById(AI_INLINE_STYLE_ID)
      el?.remove()
    }
  }, [])
}

// ── Shared Styles ─────────────────────────────────────────────────────────────

const basePanel: React.CSSProperties = {
  background: 'var(--panel-bg, #1e1e2e)',
  border: '1px solid var(--panel-border, rgba(139, 92, 246, 0.25))',
  borderRadius: 8,
  boxShadow: '0 4px 24px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(139, 92, 246, 0.1)',
  color: 'var(--foreground, #cdd6f4)',
  fontFamily: 'var(--font-family, "Inter", "Segoe UI", system-ui, sans-serif)',
  fontSize: 12,
}

const baseButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 4,
  border: 'none',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 500,
  transition: 'all 0.15s ease',
  fontFamily: 'inherit',
}

const aiAccentGradient = 'linear-gradient(135deg, #8b5cf6, #6d28d9)'

// ═══════════════════════════════════════════════════════════════════════════════
// 1. AI Lens - Code lens-style indicators above functions
// ═══════════════════════════════════════════════════════════════════════════════

export interface AILensProps {
  actions: AIAction[]
  line: number
  visible?: boolean
  compact?: boolean
  onActionClick?: (action: AIAction) => void
}

export function AILens({ actions, line, visible = true, compact = false, onActionClick }: AILensProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [expandedGroup, setExpandedGroup] = useState(false)

  if (!visible || actions.length === 0) return null

  const sorted = [...actions].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  const displayed = compact && !expandedGroup ? sorted.slice(0, 2) : sorted
  const hasMore = compact && sorted.length > 2

  return (
    <div
      className="orion-ai-inline-action-enter"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '1px 0',
        marginLeft: 60,
        userSelect: 'none',
        lineHeight: 1,
      }}
      data-ai-lens-line={line}
    >
      <Sparkles
        size={11}
        style={{ color: '#8b5cf6', opacity: 0.7, flexShrink: 0, marginRight: 2 }}
        className="orion-ai-sparkle-icon"
      />
      {displayed.map((action) => {
        const isHovered = hoveredId === action.id
        return (
          <button
            key={action.id}
            style={{
              ...baseButton,
              padding: '1px 6px',
              background: isHovered ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
              color: isHovered ? '#a78bfa' : 'rgba(139, 92, 246, 0.65)',
              fontSize: 11,
              fontWeight: 400,
              letterSpacing: 0.2,
              borderRadius: 3,
            }}
            onMouseEnter={() => setHoveredId(action.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={(e) => {
              e.stopPropagation()
              onActionClick?.(action)
              action.handler()
            }}
            title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
          >
            {action.label}
          </button>
        )
      })}
      {hasMore && !expandedGroup && (
        <button
          style={{
            ...baseButton,
            padding: '1px 4px',
            background: 'transparent',
            color: 'rgba(139, 92, 246, 0.5)',
            fontSize: 10,
          }}
          onClick={(e) => { e.stopPropagation(); setExpandedGroup(true) }}
        >
          +{sorted.length - 2} more
        </button>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Inline Action Button - Floating action button near code
// ═══════════════════════════════════════════════════════════════════════════════

export interface AIActionButtonProps {
  action: AIAction
  position: { top: number; left: number }
  visible?: boolean
  size?: 'sm' | 'md'
}

export function AIActionButton({ action, position, visible = true, size = 'sm' }: AIActionButtonProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isPressed, setIsPressed] = useState(false)

  if (!visible) return null

  const iconSize = size === 'sm' ? 12 : 14
  const IconComponent = ACTION_ICONS[action.type] ?? Sparkles

  return (
    <div
      className="orion-ai-inline-action-enter"
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        zIndex: 50,
        pointerEvents: 'auto',
      }}
    >
      <button
        style={{
          ...baseButton,
          padding: size === 'sm' ? '2px 6px' : '4px 10px',
          background: isHovered
            ? aiAccentGradient
            : 'var(--panel-bg, #1e1e2e)',
          color: isHovered ? '#fff' : '#a78bfa',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          borderRadius: 6,
          boxShadow: isHovered
            ? '0 2px 12px rgba(139, 92, 246, 0.3)'
            : '0 1px 4px rgba(0, 0, 0, 0.2)',
          transform: isPressed ? 'scale(0.95)' : isHovered ? 'scale(1.03)' : 'scale(1)',
          transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
          gap: 3,
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => { setIsHovered(false); setIsPressed(false) }}
        onMouseDown={() => setIsPressed(true)}
        onMouseUp={() => setIsPressed(false)}
        onClick={(e) => { e.stopPropagation(); action.handler() }}
        title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
      >
        <IconComponent size={iconSize} />
        {(size === 'md' || isHovered) && (
          <span style={{ fontSize: size === 'sm' ? 10 : 11, whiteSpace: 'nowrap' }}>
            {action.label}
          </span>
        )}
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Ghost Text Suggestions - AI completion shown as dimmed ghost text
// ═══════════════════════════════════════════════════════════════════════════════

export interface AIGhostTextProps {
  suggestion: AISuggestion | null
  onAccept: () => void
  onReject: () => void
  onPartialAccept?: (wordCount: number) => void
  visible?: boolean
}

export function AIGhostText({ suggestion, onAccept, onReject, onPartialAccept, visible = true }: AIGhostTextProps) {
  const [acceptedWords, setAcceptedWords] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setAcceptedWords(0)
  }, [suggestion?.id])

  useEffect(() => {
    if (!visible || !suggestion) return

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        onAccept()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onReject()
      } else if (e.key === 'ArrowRight' && e.ctrlKey) {
        // Accept word-by-word
        e.preventDefault()
        const words = suggestion.content.split(/(\s+)/)
        const next = Math.min(acceptedWords + 1, words.length)
        setAcceptedWords(next)
        onPartialAccept?.(next)
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [visible, suggestion, onAccept, onReject, onPartialAccept, acceptedWords])

  if (!visible || !suggestion) return null

  const words = suggestion.content.split(/(\s+)/)
  const acceptedText = words.slice(0, acceptedWords).join('')
  const pendingText = words.slice(acceptedWords).join('')

  return (
    <div
      ref={containerRef}
      className="orion-ai-ghost-text"
      style={{
        display: 'inline',
        position: 'relative',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
      data-ai-ghost-suggestion={suggestion.id}
    >
      {acceptedWords > 0 && (
        <span style={{
          color: 'rgba(139, 92, 246, 0.6)',
          fontStyle: 'italic',
        }}>
          {acceptedText}
        </span>
      )}
      <span style={{
        color: 'rgba(150, 150, 170, 0.4)',
        fontStyle: 'italic',
      }}>
        {pendingText}
      </span>
      {/* Confidence micro-indicator */}
      <span style={{
        display: 'inline-block',
        width: 4,
        height: 4,
        borderRadius: '50%',
        background: getConfidenceColor(suggestion.confidence),
        marginLeft: 4,
        verticalAlign: 'middle',
        opacity: 0.7,
      }} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. AI Diff Preview - Show proposed changes inline
// ═══════════════════════════════════════════════════════════════════════════════

interface DiffPreviewLine {
  type: 'added' | 'removed' | 'unchanged'
  content: string
}

export interface AIDiffPreviewProps {
  original: string
  suggested: string
  suggestion: AISuggestion
  onAccept: (newCode: string) => void
  onReject: () => void
  position: { top: number; left: number }
  visible?: boolean
  maxHeight?: number
}

export function AIDiffPreview({
  original,
  suggested,
  suggestion,
  onAccept,
  onReject,
  position,
  visible = true,
  maxHeight = 320,
}: AIDiffPreviewProps) {
  const [isMinimized, setIsMinimized] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const diffLines = useMemo((): DiffPreviewLine[] => {
    const oldLines = original.split('\n')
    const newLines = suggested.split('\n')
    const m = oldLines.length
    const n = newLines.length

    // LCS-based diff
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }

    const result: DiffPreviewLine[] = []
    let i = m, j = n
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        result.push({ type: 'unchanged', content: oldLines[i - 1] })
        i--; j--
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        result.push({ type: 'added', content: newLines[j - 1] })
        j--
      } else {
        result.push({ type: 'removed', content: oldLines[i - 1] })
        i--
      }
    }
    return result.reverse()
  }, [original, suggested])

  const stats = useMemo(() => {
    const added = diffLines.filter(l => l.type === 'added').length
    const removed = diffLines.filter(l => l.type === 'removed').length
    return { added, removed }
  }, [diffLines])

  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        onAccept(suggested)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onReject()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [visible, suggested, onAccept, onReject])

  if (!visible) return null

  return (
    <div
      ref={panelRef}
      className="orion-ai-inline-action-enter orion-ai-pulse-border"
      style={{
        ...basePanel,
        position: 'absolute',
        top: position.top,
        left: position.left,
        width: 560,
        maxHeight,
        overflow: 'hidden',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 10px',
        borderBottom: '1px solid rgba(139, 92, 246, 0.15)',
        background: 'rgba(139, 92, 246, 0.05)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={12} style={{ color: '#8b5cf6' }} className="orion-ai-sparkle-icon" />
          <span style={{ fontWeight: 600, fontSize: 11, color: '#a78bfa' }}>AI Suggestion</span>
          <ModelBadge model={suggestion.model} />
          <ConfidenceBadge confidence={suggestion.confidence} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: '#3fb950' }}>+{stats.added}</span>
          <span style={{ fontSize: 10, color: '#f85149' }}>-{stats.removed}</span>
          <button
            style={{ ...baseButton, padding: '1px 3px', background: 'transparent', color: '#6c7086' }}
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? 'Expand' : 'Collapse'}
          >
            {isMinimized ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        </div>
      </div>

      {/* Diff Body */}
      {!isMinimized && (
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 0',
          fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", "Cascadia Code", monospace)',
          fontSize: 12,
          lineHeight: '18px',
        }}>
          {diffLines.map((line, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                padding: '0 10px',
                background:
                  line.type === 'added'
                    ? 'rgba(63, 185, 80, 0.08)'
                    : line.type === 'removed'
                    ? 'rgba(248, 81, 73, 0.08)'
                    : 'transparent',
                borderLeft: `2px solid ${
                  line.type === 'added'
                    ? '#3fb950'
                    : line.type === 'removed'
                    ? '#f85149'
                    : 'transparent'
                }`,
                textDecoration: line.type === 'removed' ? 'line-through' : 'none',
                opacity: line.type === 'removed' ? 0.6 : 1,
              }}
            >
              <span style={{
                display: 'inline-block',
                width: 14,
                textAlign: 'center',
                color: line.type === 'added' ? '#3fb950' : line.type === 'removed' ? '#f85149' : '#585b70',
                fontSize: 11,
                userSelect: 'none',
                flexShrink: 0,
              }}>
                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
              </span>
              <span style={{
                whiteSpace: 'pre',
                tabSize: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {line.content || ' '}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Footer Controls */}
      <AcceptRejectControls
        onAccept={() => onAccept(suggested)}
        onReject={onReject}
        acceptLabel="Apply Changes"
        acceptShortcut="Ctrl+Enter"
        rejectShortcut="Esc"
      />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Accept / Reject Controls
// ═══════════════════════════════════════════════════════════════════════════════

export interface AcceptRejectControlsProps {
  onAccept: () => void
  onReject: () => void
  onFeedback?: (positive: boolean) => void
  acceptLabel?: string
  rejectLabel?: string
  acceptShortcut?: string
  rejectShortcut?: string
  compact?: boolean
}

export function AcceptRejectControls({
  onAccept,
  onReject,
  onFeedback,
  acceptLabel = 'Accept',
  rejectLabel = 'Reject',
  acceptShortcut = 'Tab',
  rejectShortcut = 'Esc',
  compact = false,
}: AcceptRejectControlsProps) {
  const [hoveredBtn, setHoveredBtn] = useState<'accept' | 'reject' | 'up' | 'down' | null>(null)

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: compact ? '3px 6px' : '5px 10px',
      borderTop: '1px solid rgba(139, 92, 246, 0.12)',
      background: 'rgba(0, 0, 0, 0.1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          style={{
            ...baseButton,
            background: hoveredBtn === 'accept' ? '#3fb950' : 'rgba(63, 185, 80, 0.15)',
            color: hoveredBtn === 'accept' ? '#fff' : '#3fb950',
            padding: compact ? '2px 6px' : '3px 10px',
          }}
          onMouseEnter={() => setHoveredBtn('accept')}
          onMouseLeave={() => setHoveredBtn(null)}
          onClick={(e) => { e.stopPropagation(); onAccept() }}
          title={acceptShortcut}
        >
          <Check size={compact ? 10 : 12} />
          {!compact && <span>{acceptLabel}</span>}
          {!compact && (
            <kbd style={{
              fontSize: 9,
              padding: '0 3px',
              borderRadius: 2,
              background: 'rgba(255,255,255,0.15)',
              marginLeft: 2,
            }}>{acceptShortcut}</kbd>
          )}
        </button>
        <button
          style={{
            ...baseButton,
            background: hoveredBtn === 'reject' ? '#f85149' : 'rgba(248, 81, 73, 0.1)',
            color: hoveredBtn === 'reject' ? '#fff' : '#f85149',
            padding: compact ? '2px 6px' : '3px 10px',
          }}
          onMouseEnter={() => setHoveredBtn('reject')}
          onMouseLeave={() => setHoveredBtn(null)}
          onClick={(e) => { e.stopPropagation(); onReject() }}
          title={rejectShortcut}
        >
          <X size={compact ? 10 : 12} />
          {!compact && <span>{rejectLabel}</span>}
          {!compact && (
            <kbd style={{
              fontSize: 9,
              padding: '0 3px',
              borderRadius: 2,
              background: 'rgba(255,255,255,0.1)',
              marginLeft: 2,
            }}>{rejectShortcut}</kbd>
          )}
        </button>
      </div>

      {/* Optional feedback thumbs */}
      {onFeedback && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            style={{
              ...baseButton,
              padding: '2px 4px',
              background: hoveredBtn === 'up' ? 'rgba(63, 185, 80, 0.15)' : 'transparent',
              color: '#6c7086',
            }}
            onMouseEnter={() => setHoveredBtn('up')}
            onMouseLeave={() => setHoveredBtn(null)}
            onClick={() => onFeedback(true)}
            title="Helpful"
          >
            <ThumbsUp size={10} />
          </button>
          <button
            style={{
              ...baseButton,
              padding: '2px 4px',
              background: hoveredBtn === 'down' ? 'rgba(248, 81, 73, 0.1)' : 'transparent',
              color: '#6c7086',
            }}
            onMouseEnter={() => setHoveredBtn('down')}
            onMouseLeave={() => setHoveredBtn(null)}
            onClick={() => onFeedback(false)}
            title="Not helpful"
          >
            <ThumbsDown size={10} />
          </button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. AI Explanation Tooltip
// ═══════════════════════════════════════════════════════════════════════════════

export interface AIExplanationTooltipProps {
  explanation: AIExplanation | null
  position: { top: number; left: number }
  visible?: boolean
  onClose: () => void
  onCopy?: () => void
}

export function AIExplanationTooltip({
  explanation,
  position,
  visible = true,
  onClose,
  onCopy,
}: AIExplanationTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [visible, onClose])

  if (!visible || !explanation) return null

  return (
    <div
      ref={tooltipRef}
      className="orion-ai-inline-action-enter"
      style={{
        ...basePanel,
        position: 'absolute',
        top: position.top,
        left: position.left,
        width: 420,
        maxHeight: 280,
        overflow: 'hidden',
        zIndex: 65,
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 10px',
        borderBottom: '1px solid rgba(139, 92, 246, 0.12)',
        background: 'rgba(139, 92, 246, 0.04)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Lightbulb size={12} style={{ color: '#f9e2af' }} />
          <span style={{ fontWeight: 600, fontSize: 11, color: '#a78bfa' }}>AI Explanation</span>
          <ModelBadge model={explanation.model} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {onCopy && (
            <button
              style={{ ...baseButton, padding: '1px 4px', background: 'transparent', color: '#6c7086' }}
              onClick={onCopy}
              title="Copy"
            >
              <Copy size={11} />
            </button>
          )}
          <button
            style={{ ...baseButton, padding: '1px 4px', background: 'transparent', color: '#6c7086' }}
            onClick={onClose}
            title="Close (Esc)"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{
        padding: '8px 12px',
        overflowY: 'auto',
        maxHeight: 220,
        fontSize: 12,
        lineHeight: 1.6,
        color: 'var(--foreground, #cdd6f4)',
      }}>
        {explanation.isLoading ? (
          <AILoadingState message="Analyzing code..." size="sm" />
        ) : (
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {explanation.content}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Inline Chat - Small chat input in the editor gutter
// ═══════════════════════════════════════════════════════════════════════════════

export interface AIInlineChatProps {
  line: number
  onSubmit: (message: string) => void
  onClose: () => void
  position: { top: number; left: number }
  visible?: boolean
  isProcessing?: boolean
  messages?: InlineChatMessage[]
  placeholder?: string
}

export function AIInlineChat({
  line,
  onSubmit,
  onClose,
  position,
  visible = true,
  isProcessing = false,
  messages = [],
  placeholder = 'Ask AI about this code...',
}: AIInlineChatProps) {
  const [input, setInput] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const chatBodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus()
    }
  }, [visible])

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight
    }
  }, [messages.length])

  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [visible, onClose])

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isProcessing) return
    onSubmit(trimmed)
    setInput('')
    setIsExpanded(true)
  }, [input, isProcessing, onSubmit])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  if (!visible) return null

  return (
    <div
      className="orion-ai-inline-action-enter orion-ai-pulse-border"
      style={{
        ...basePanel,
        position: 'absolute',
        top: position.top,
        left: position.left,
        width: isExpanded ? 440 : 380,
        zIndex: 70,
        transition: 'width 0.2s ease',
      }}
      data-ai-inline-chat-line={line}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '5px 10px',
        borderBottom: '1px solid rgba(139, 92, 246, 0.12)',
        background: 'rgba(139, 92, 246, 0.04)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <MessageSquare size={12} style={{ color: '#8b5cf6' }} />
          <span style={{ fontWeight: 600, fontSize: 11, color: '#a78bfa' }}>
            Inline Chat
          </span>
          <span style={{ fontSize: 10, color: '#585b70' }}>Line {line}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <kbd style={{
            fontSize: 9,
            padding: '0 4px',
            borderRadius: 2,
            background: 'rgba(255,255,255,0.06)',
            color: '#6c7086',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>Alt+\</kbd>
          <button
            style={{ ...baseButton, padding: '1px 4px', background: 'transparent', color: '#6c7086' }}
            onClick={onClose}
            title="Close (Esc)"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Messages area */}
      {isExpanded && messages.length > 0 && (
        <div
          ref={chatBodyRef}
          style={{
            maxHeight: 200,
            overflowY: 'auto',
            padding: '6px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'flex-start',
              }}
            >
              <div style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: 1,
                background: msg.role === 'assistant'
                  ? 'linear-gradient(135deg, #8b5cf6, #6d28d9)'
                  : 'rgba(88, 91, 112, 0.3)',
              }}>
                {msg.role === 'assistant'
                  ? <Sparkles size={9} style={{ color: '#fff' }} />
                  : <span style={{ fontSize: 9, color: '#cdd6f4' }}>U</span>
                }
              </div>
              <div style={{
                fontSize: 11,
                lineHeight: 1.5,
                color: 'var(--foreground, #cdd6f4)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                flex: 1,
              }}>
                {msg.content}
              </div>
            </div>
          ))}
          {isProcessing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
              <div style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
              }}>
                <Loader size={9} style={{ color: '#fff' }} className="orion-ai-loader-spin" />
              </div>
              <TypingDots />
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 6,
        padding: '6px 8px',
        borderTop: isExpanded && messages.length > 0 ? '1px solid rgba(139, 92, 246, 0.1)' : 'none',
      }}>
        <Sparkles size={13} style={{ color: '#8b5cf6', flexShrink: 0, marginBottom: 4 }} />
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          style={{
            flex: 1,
            background: 'rgba(0, 0, 0, 0.15)',
            border: '1px solid rgba(139, 92, 246, 0.2)',
            borderRadius: 6,
            color: 'var(--foreground, #cdd6f4)',
            padding: '5px 8px',
            fontSize: 11,
            lineHeight: 1.4,
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit',
            minHeight: 28,
            maxHeight: 80,
          }}
          disabled={isProcessing}
        />
        <button
          style={{
            ...baseButton,
            padding: '4px 8px',
            background: input.trim()
              ? aiAccentGradient
              : 'rgba(139, 92, 246, 0.1)',
            color: input.trim() ? '#fff' : '#585b70',
            borderRadius: 6,
            marginBottom: 0,
            opacity: isProcessing ? 0.5 : 1,
          }}
          onClick={handleSubmit}
          disabled={!input.trim() || isProcessing}
          title="Send (Enter)"
        >
          {isProcessing ? (
            <Loader size={12} className="orion-ai-loader-spin" />
          ) : (
            <Send size={12} />
          )}
        </button>
      </div>

      {/* Quick suggestions (when empty) */}
      {!isExpanded && input === '' && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          padding: '4px 8px 6px',
        }}>
          {['Explain this', 'Fix bugs', 'Add types', 'Optimize'].map((q) => (
            <button
              key={q}
              style={{
                ...baseButton,
                padding: '2px 7px',
                background: 'rgba(139, 92, 246, 0.06)',
                color: '#7c7f93',
                borderRadius: 10,
                fontSize: 10,
                border: '1px solid rgba(139, 92, 246, 0.12)',
              }}
              onClick={() => { setInput(q); inputRef.current?.focus() }}
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. AI Edit Indicator - Show which lines are AI-generated/modified
// ═══════════════════════════════════════════════════════════════════════════════

export interface AIEditIndicatorProps {
  indicators: AIEditIndicator[]
  lineHeight?: number
  gutterWidth?: number
}

export function AIEditIndicatorGutter({ indicators, lineHeight = 19, gutterWidth = 4 }: AIEditIndicatorProps) {
  if (indicators.length === 0) return null

  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: gutterWidth, height: '100%', pointerEvents: 'none' }}>
      {indicators.map((ind, idx) => {
        const color = ind.type === 'generated'
          ? '#8b5cf6'
          : ind.type === 'modified'
          ? '#d29922'
          : '#6d28d9'

        const lineCount = ind.endLine - ind.startLine + 1
        return (
          <div
            key={idx}
            style={{
              position: 'absolute',
              top: (ind.startLine - 1) * lineHeight,
              left: 0,
              width: gutterWidth,
              height: lineCount * lineHeight,
              background: `linear-gradient(180deg, ${color}dd, ${color}88)`,
              borderRadius: '0 2px 2px 0',
              opacity: 0.8,
              transition: 'opacity 0.3s ease',
            }}
            title={`AI ${ind.type} (${ind.model}) - Lines ${ind.startLine}-${ind.endLine}`}
          />
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Confidence Indicator
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConfidenceBadgeProps {
  confidence: number
  showLabel?: boolean
  size?: 'sm' | 'md'
}

export function ConfidenceBadge({ confidence, showLabel = false, size = 'sm' }: ConfidenceBadgeProps) {
  const level = getConfidenceLevel(confidence)
  const color = CONFIDENCE_COLORS[level]
  const pct = Math.round(confidence * 100)
  const barWidth = size === 'sm' ? 28 : 40

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
    }}>
      {/* Segmented bar */}
      <div style={{
        display: 'flex',
        gap: 1,
        alignItems: 'center',
      }}>
        {[0.33, 0.66, 1.0].map((threshold, i) => (
          <div
            key={i}
            style={{
              width: barWidth / 3 - 1,
              height: size === 'sm' ? 3 : 5,
              borderRadius: 1,
              background: confidence >= threshold ? color : 'rgba(255, 255, 255, 0.08)',
              transition: 'background 0.3s ease',
            }}
          />
        ))}
      </div>
      {showLabel && (
        <span style={{ fontSize: size === 'sm' ? 9 : 10, color, fontWeight: 500 }}>
          {pct}%
        </span>
      )}
    </div>
  )
}

// Full confidence indicator with progress bar animation
export interface ConfidenceIndicatorProps {
  confidence: number
  model: string
  label?: string
}

export function ConfidenceIndicator({ confidence, model, label }: ConfidenceIndicatorProps) {
  const color = getConfidenceColor(confidence)
  const pct = Math.round(confidence * 100)

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '3px 8px',
      background: 'rgba(0, 0, 0, 0.15)',
      borderRadius: 4,
      fontSize: 10,
    }}>
      <Shield size={10} style={{ color, flexShrink: 0 }} />
      {label && <span style={{ color: '#7c7f93' }}>{label}</span>}
      <div style={{
        flex: 1,
        height: 3,
        background: 'rgba(255, 255, 255, 0.06)',
        borderRadius: 2,
        overflow: 'hidden',
        minWidth: 40,
      }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          borderRadius: 2,
          transition: 'width 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        }} />
      </div>
      <span style={{ color, fontWeight: 600, fontSize: 10, minWidth: 28, textAlign: 'right' }}>
        {pct}%
      </span>
      <ModelBadge model={model} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Loading State
// ═══════════════════════════════════════════════════════════════════════════════

export interface AILoadingStateProps {
  message?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'spinner' | 'dots' | 'shimmer'
}

export function AILoadingState({
  message = 'AI is thinking...',
  size = 'md',
  variant = 'dots',
}: AILoadingStateProps) {
  const iconSize = size === 'sm' ? 12 : size === 'md' ? 16 : 20

  return (
    <div
      className="orion-ai-shimmer-bg"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: size === 'sm' ? 6 : 8,
        padding: size === 'sm' ? '4px 8px' : size === 'md' ? '6px 12px' : '10px 16px',
        borderRadius: 6,
      }}
    >
      {variant === 'spinner' ? (
        <Loader size={iconSize} style={{ color: '#8b5cf6' }} className="orion-ai-loader-spin" />
      ) : variant === 'shimmer' ? (
        <Sparkles size={iconSize} style={{ color: '#8b5cf6' }} className="orion-ai-sparkle-icon" />
      ) : (
        <TypingDots />
      )}
      <span style={{
        fontSize: size === 'sm' ? 10 : size === 'md' ? 11 : 13,
        color: '#a78bfa',
        fontWeight: 500,
      }}>
        {message}
      </span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper Components
// ═══════════════════════════════════════════════════════════════════════════════

function ModelBadge({ model }: { model: string }) {
  const badge = MODEL_BADGES[model]
  if (!badge) {
    return (
      <span style={{
        fontSize: 9,
        padding: '0 4px',
        borderRadius: 3,
        background: 'rgba(139, 92, 246, 0.1)',
        color: '#7c7f93',
        fontWeight: 500,
      }}>
        {model}
      </span>
    )
  }
  return (
    <span style={{
      fontSize: 9,
      padding: '0 4px',
      borderRadius: 3,
      background: `${badge.color}18`,
      color: badge.color,
      fontWeight: 600,
      letterSpacing: 0.3,
    }}>
      {badge.label}
    </span>
  )
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: '#8b5cf6',
            opacity: 0.6,
            animation: `orion-ai-dot-bounce 1.2s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. AI Action Bar - Floating bar with contextual actions for a selection
// ═══════════════════════════════════════════════════════════════════════════════

export interface AIActionBarProps {
  actions: AIAction[]
  position: { top: number; left: number }
  visible?: boolean
  onClose?: () => void
}

export function AIActionBar({ actions, position, visible = true, onClose }: AIActionBarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  if (!visible || actions.length === 0) return null

  return (
    <div
      className="orion-ai-inline-action-enter"
      style={{
        ...basePanel,
        position: 'absolute',
        top: position.top,
        left: position.left,
        zIndex: 55,
        display: 'flex',
        alignItems: 'center',
        padding: '3px 4px',
        gap: 2,
      }}
    >
      <Sparkles size={11} style={{ color: '#8b5cf6', margin: '0 3px', flexShrink: 0 }} />
      {actions.map((action) => {
        const isHovered = hoveredId === action.id
        const IconComp = ACTION_ICONS[action.type] ?? Sparkles
        return (
          <button
            key={action.id}
            style={{
              ...baseButton,
              padding: '3px 7px',
              background: isHovered ? 'rgba(139, 92, 246, 0.18)' : 'transparent',
              color: isHovered ? '#c4b5fd' : '#7c7f93',
              borderRadius: 4,
              gap: 4,
            }}
            onMouseEnter={() => setHoveredId(action.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={(e) => { e.stopPropagation(); action.handler() }}
            title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
          >
            <IconComp size={12} />
            <span>{action.label}</span>
          </button>
        )
      })}
      {onClose && (
        <button
          style={{
            ...baseButton,
            padding: '2px 3px',
            background: 'transparent',
            color: '#585b70',
            marginLeft: 2,
          }}
          onClick={onClose}
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12. AI Status Indicator - Tiny indicator showing AI is active on a line
// ═══════════════════════════════════════════════════════════════════════════════

export interface AILineStatusProps {
  line: number
  status: 'idle' | 'processing' | 'suggestion' | 'applied' | 'error'
  model?: string
  onClick?: () => void
}

export function AILineStatus({ line, status, model, onClick }: AILineStatusProps) {
  const colorMap: Record<string, string> = {
    idle: 'transparent',
    processing: '#8b5cf6',
    suggestion: '#d29922',
    applied: '#3fb950',
    error: '#f85149',
  }

  const iconMap: Record<string, React.ReactNode> = {
    processing: <Loader size={9} className="orion-ai-loader-spin" />,
    suggestion: <Sparkles size={9} />,
    applied: <Check size={9} />,
    error: <AlertTriangle size={9} />,
  }

  if (status === 'idle') return null

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: `${colorMap[status]}22`,
        color: colorMap[status],
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
      }}
      onClick={onClick}
      title={`AI: ${status}${model ? ` (${model})` : ''} - Line ${line}`}
    >
      {iconMap[status]}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Orchestrator Component
// ═══════════════════════════════════════════════════════════════════════════════

export interface AIInlineActionsProps {
  /** Currently visible AI actions (from code analysis) */
  actions: AIAction[]
  /** Active AI suggestion (ghost text / diff preview) */
  activeSuggestion: AISuggestion | null
  /** Active AI explanation tooltip */
  activeExplanation: AIExplanation | null
  /** Edit indicators showing AI-modified lines */
  editIndicators: AIEditIndicator[]
  /** Whether inline chat is open */
  inlineChatOpen: boolean
  /** Line number where inline chat is anchored */
  inlineChatLine: number
  /** Inline chat messages history */
  inlineChatMessages: InlineChatMessage[]
  /** Whether AI is currently processing something */
  isProcessing: boolean
  /** Original code for diff preview (when suggestion is an edit type) */
  originalCode?: string

  // ── Callbacks ─────────────────────────────────────
  onAcceptSuggestion: () => void
  onRejectSuggestion: () => void
  onPartialAcceptSuggestion?: (wordCount: number) => void
  onAcceptDiff?: (newCode: string) => void
  onRejectDiff?: () => void
  onInlineChatSubmit: (message: string) => void
  onInlineChatClose: () => void
  onCloseExplanation: () => void
  onFeedback?: (suggestionId: string, positive: boolean) => void
  onActionClick?: (action: AIAction) => void

  // ── Layout ────────────────────────────────────────
  editorTop?: number
  editorLeft?: number
  lineHeight?: number
  gutterWidth?: number
  scrollTop?: number
}

export default function AIInlineActions({
  actions,
  activeSuggestion,
  activeExplanation,
  editIndicators,
  inlineChatOpen,
  inlineChatLine,
  inlineChatMessages,
  isProcessing,
  originalCode,
  onAcceptSuggestion,
  onRejectSuggestion,
  onPartialAcceptSuggestion,
  onAcceptDiff,
  onRejectDiff,
  onInlineChatSubmit,
  onInlineChatClose,
  onCloseExplanation,
  onFeedback,
  onActionClick,
  editorTop = 0,
  editorLeft = 0,
  lineHeight = 19,
  gutterWidth = 60,
  scrollTop = 0,
}: AIInlineActionsProps) {
  useInjectStyles()

  const [dismissedActions, setDismissedActions] = useState<Set<string>>(new Set())

  // ── Keyboard shortcuts ────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Alt+\ -> toggle inline chat
      if (e.altKey && e.key === '\\') {
        e.preventDefault()
        if (inlineChatOpen) {
          onInlineChatClose()
        }
        // Opening inline chat would be handled by the parent based on cursor position
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [inlineChatOpen, onInlineChatClose])

  // ── Group actions by line ─────────────────────────────────
  const actionsByLine = useMemo(() => {
    const map = new Map<number, AIAction[]>()
    for (const action of actions) {
      if (dismissedActions.has(action.id)) continue
      const list = map.get(action.line) || []
      list.push(action)
      map.set(action.line, list)
    }
    return map
  }, [actions, dismissedActions])

  // ── Helpers ───────────────────────────────────────────────
  const lineToY = useCallback(
    (line: number) => editorTop + (line - 1) * lineHeight - scrollTop,
    [editorTop, lineHeight, scrollTop],
  )

  const showDiffPreview =
    activeSuggestion &&
    (activeSuggestion.type === 'edit' || activeSuggestion.type === 'refactor' || activeSuggestion.type === 'fix') &&
    originalCode &&
    onAcceptDiff &&
    onRejectDiff

  const showGhostText =
    activeSuggestion &&
    activeSuggestion.type === 'completion' &&
    !showDiffPreview

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
      data-ai-inline-actions
    >
      {/* Pointer events layer - everything interactive needs pointerEvents: 'auto' */}

      {/* Edit indicator gutter marks */}
      <AIEditIndicatorGutter
        indicators={editIndicators}
        lineHeight={lineHeight}
        gutterWidth={4}
      />

      {/* AI Lens rows (code-lens style) */}
      {Array.from(actionsByLine.entries()).map(([line, lineActions]) => (
        <div
          key={`lens-${line}`}
          style={{
            position: 'absolute',
            top: lineToY(line) - lineHeight,
            left: gutterWidth,
            pointerEvents: 'auto',
            height: lineHeight,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <AILens
            actions={lineActions}
            line={line}
            onActionClick={onActionClick}
            compact={lineActions.length > 3}
          />
        </div>
      ))}

      {/* Ghost text (completion suggestion) */}
      {showGhostText && activeSuggestion && (
        <div
          style={{
            position: 'absolute',
            top: lineToY(activeSuggestion.line),
            left: gutterWidth + 200, // approximate cursor position
            pointerEvents: 'auto',
            height: lineHeight,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <AIGhostText
            suggestion={activeSuggestion}
            onAccept={onAcceptSuggestion}
            onReject={onRejectSuggestion}
            onPartialAccept={onPartialAcceptSuggestion}
          />
        </div>
      )}

      {/* Diff preview (edit/refactor/fix suggestion) */}
      {showDiffPreview && activeSuggestion && originalCode && onAcceptDiff && onRejectDiff && (
        <div style={{ pointerEvents: 'auto' }}>
          <AIDiffPreview
            original={originalCode}
            suggested={activeSuggestion.content}
            suggestion={activeSuggestion}
            onAccept={onAcceptDiff}
            onReject={onRejectDiff}
            position={{
              top: lineToY(activeSuggestion.line) + lineHeight + 4,
              left: gutterWidth + 20,
            }}
          />
        </div>
      )}

      {/* Confidence indicator for active suggestion */}
      {activeSuggestion && (
        <div
          style={{
            position: 'absolute',
            top: lineToY(activeSuggestion.line) - lineHeight - 4,
            right: 20,
            pointerEvents: 'auto',
          }}
        >
          <ConfidenceIndicator
            confidence={activeSuggestion.confidence}
            model={activeSuggestion.model}
            label="Confidence"
          />
        </div>
      )}

      {/* Explanation tooltip */}
      {activeExplanation && (
        <div style={{ pointerEvents: 'auto' }}>
          <AIExplanationTooltip
            explanation={activeExplanation}
            position={{
              top: lineToY(activeExplanation.line) + lineHeight + 4,
              left: gutterWidth + 40,
            }}
            onClose={onCloseExplanation}
            onCopy={() => {
              if (activeExplanation.content) {
                navigator.clipboard.writeText(activeExplanation.content).catch(() => {})
              }
            }}
          />
        </div>
      )}

      {/* Inline chat */}
      {inlineChatOpen && (
        <div style={{ pointerEvents: 'auto' }}>
          <AIInlineChat
            line={inlineChatLine}
            onSubmit={onInlineChatSubmit}
            onClose={onInlineChatClose}
            position={{
              top: lineToY(inlineChatLine) + lineHeight + 4,
              left: gutterWidth + 10,
            }}
            isProcessing={isProcessing}
            messages={inlineChatMessages}
          />
        </div>
      )}

      {/* Line-level processing indicators */}
      {isProcessing && activeSuggestion && (
        <div
          style={{
            position: 'absolute',
            top: lineToY(activeSuggestion.line),
            left: 8,
            pointerEvents: 'auto',
          }}
        >
          <AILineStatus
            line={activeSuggestion.line}
            status="processing"
            model={activeSuggestion.model}
          />
        </div>
      )}

      {/* Global loading overlay (when processing with no specific line target) */}
      {isProcessing && !activeSuggestion && (
        <div style={{
          position: 'absolute',
          bottom: 12,
          right: 16,
          pointerEvents: 'auto',
        }}>
          <AILoadingState message="AI is thinking..." variant="dots" size="sm" />
        </div>
      )}
    </div>
  )
}
