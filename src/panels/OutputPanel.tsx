import { useEffect, useRef, useState, useCallback } from 'react'
import {
  useOutputStore,
  type OutputLineType,
} from '@/store/output'
import {
  ChevronDown, Trash2, Copy, WrapText, FileOutput,
} from 'lucide-react'

/* ── Line type colour mapping ────────────────────────────── */

const lineTypeColors: Record<OutputLineType, string> = {
  info:    'var(--text-secondary)',
  warn:    '#d29922',
  error:   '#f85149',
  success: '#3fb950',
}

/* ── Component ────────────────────────────────────────────── */

export default function OutputPanel() {
  const channels    = useOutputStore((s) => s.channels)
  const active      = useOutputStore((s) => s.activeChannel)
  const setActive   = useOutputStore((s) => s.setActiveChannel)
  const clearChan   = useOutputStore((s) => s.clearChannel)

  const [wordWrap, setWordWrap]       = useState(true)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolled = useRef(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const lines = channels.get(active) ?? []

  /* ── Auto-scroll ───────────────────────────────────────── */

  useEffect(() => {
    if (!userScrolled.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines.length])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // If user scrolled up more than 40px from bottom, pause auto-scroll
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    userScrolled.current = !atBottom
  }, [])

  /* ── Close dropdown on outside click ───────────────────── */

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  /* ── Copy all output ───────────────────────────────────── */

  const handleCopy = useCallback(() => {
    const text = lines.map((l) => l.text).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 1500)
    })
  }, [lines])

  /* ── Channel list (keys of channels map) ───────────────── */

  const channelNames = Array.from(channels.keys())

  /* ── Empty state ───────────────────────────────────────── */

  if (lines.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Toolbar
          channelNames={channelNames}
          active={active}
          setActive={setActive}
          dropdownOpen={dropdownOpen}
          setDropdownOpen={setDropdownOpen}
          dropdownRef={dropdownRef}
          onClear={() => clearChan(active)}
          onCopy={handleCopy}
          copyFeedback={copyFeedback}
          wordWrap={wordWrap}
          onToggleWrap={() => setWordWrap((v) => !v)}
        />
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FileOutput size={18} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, marginTop: 4 }}>
            No output
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 11, opacity: 0.5 }}>
            Output from {active} channel will appear here
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar
        channelNames={channelNames}
        active={active}
        setActive={setActive}
        dropdownOpen={dropdownOpen}
        setDropdownOpen={setDropdownOpen}
        dropdownRef={dropdownRef}
        onClear={() => clearChan(active)}
        onCopy={handleCopy}
        copyFeedback={copyFeedback}
        wordWrap={wordWrap}
        onToggleWrap={() => setWordWrap((v) => !v)}
      />

      {/* ── Log area ──────────────────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: wordWrap ? 'hidden' : 'auto',
          fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
          fontSize: 12,
          lineHeight: 1.55,
          padding: '2px 0',
        }}
      >
        {lines.map((line) => (
          <div
            key={line.id}
            style={{
              display: 'flex',
              minHeight: 20,
              padding: '0 10px',
              whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
              wordBreak: wordWrap ? 'break-all' : undefined,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {/* Timestamp */}
            <span
              style={{
                color: 'var(--text-muted)',
                opacity: 0.5,
                fontSize: 10,
                flexShrink: 0,
                width: 62,
                paddingTop: 2,
                userSelect: 'none',
              }}
            >
              {new Date(line.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>

            {/* Text */}
            <span style={{ color: lineTypeColors[line.type], flex: 1 }}>
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Toolbar ──────────────────────────────────────────────── */

function Toolbar({
  channelNames,
  active,
  setActive,
  dropdownOpen,
  setDropdownOpen,
  dropdownRef,
  onClear,
  onCopy,
  copyFeedback,
  wordWrap,
  onToggleWrap,
}: {
  channelNames: string[]
  active: string
  setActive: (ch: string) => void
  dropdownOpen: boolean
  setDropdownOpen: (v: boolean) => void
  dropdownRef: React.RefObject<HTMLDivElement | null>
  onClear: () => void
  onCopy: () => void
  copyFeedback: boolean
  wordWrap: boolean
  onToggleWrap: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      {/* ── Channel selector ──────────────────────────────── */}
      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            height: 24,
            padding: '0 8px',
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--text-primary)',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {active}
          <ChevronDown size={11} style={{ opacity: 0.5 }} />
        </button>

        {dropdownOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 2,
              minWidth: 140,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              borderRadius: 5,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              zIndex: 100,
              overflow: 'hidden',
            }}
          >
            {channelNames.map((ch) => (
              <button
                key={ch}
                onClick={() => {
                  setActive(ch)
                  setDropdownOpen(false)
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '5px 10px',
                  fontSize: 11,
                  fontWeight: active === ch ? 600 : 400,
                  color: active === ch ? 'var(--accent)' : 'var(--text-secondary)',
                  background: active === ch ? 'rgba(88,166,255,0.08)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (active !== ch) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                }}
                onMouseLeave={(e) => {
                  if (active !== ch) e.currentTarget.style.background = 'transparent'
                }}
              >
                {ch}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* ── Word wrap toggle ──────────────────────────────── */}
      <ToolbarButton
        title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
        active={wordWrap}
        onClick={onToggleWrap}
      >
        <WrapText size={13} />
      </ToolbarButton>

      {/* ── Copy ──────────────────────────────────────────── */}
      <ToolbarButton title="Copy all output" onClick={onCopy}>
        <Copy size={13} />
        {copyFeedback && (
          <span style={{ fontSize: 9, marginLeft: 2, color: 'var(--accent-green, #3fb950)' }}>
            Copied
          </span>
        )}
      </ToolbarButton>

      {/* ── Clear ─────────────────────────────────────────── */}
      <ToolbarButton title="Clear output" onClick={onClear}>
        <Trash2 size={13} />
      </ToolbarButton>
    </div>
  )
}

/* ── Small toolbar icon button ────────────────────────────── */

function ToolbarButton({
  title,
  onClick,
  children,
  active,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        height: 22,
        padding: '0 5px',
        borderRadius: 3,
        border: 'none',
        cursor: 'pointer',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        background: active ? 'rgba(88,166,255,0.10)' : 'transparent',
        transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
        e.currentTarget.style.color = 'var(--text-primary)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? 'rgba(88,166,255,0.10)' : 'transparent'
        e.currentTarget.style.color = active ? 'var(--accent)' : 'var(--text-muted)'
      }}
    >
      {children}
    </button>
  )
}
