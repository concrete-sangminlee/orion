import { useState, useCallback, useRef, useEffect } from 'react'
import {
  X,
  Sparkles,
  Copy,
  Check,
  ExternalLink,
  Github,
  FileText,
  Scale,
  Bug,
} from 'lucide-react'
import { APP_VERSION } from '@/utils/version'
import { PROJECT_LINKS } from '@/utils/projectLinks'

interface Props {
  open: boolean
  onClose: () => void
}

/* ── App info shape (matches preload.ts AppInfo) ─────────────────── */
interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  v8: string
  platform: string
  arch: string
}

const VERSION_FALLBACK = APP_VERSION

/* ── Orion constellation data (reused from SplashScreen) ─────────── */
const STARS: { cx: number; cy: number; r: number; delay: number; brightness: number }[] = [
  { cx: 30, cy: 28, r: 3.2, delay: 0, brightness: 1 },       // Betelgeuse (left shoulder)
  { cx: 88, cy: 30, r: 2.6, delay: 0.4, brightness: 0.9 },   // Bellatrix (right shoulder)
  { cx: 44, cy: 56, r: 2.0, delay: 0.8, brightness: 0.85 },  // Alnitak (belt left)
  { cx: 58, cy: 54, r: 2.4, delay: 1.2, brightness: 0.95 },  // Alnilam (belt center)
  { cx: 72, cy: 52, r: 2.0, delay: 0.6, brightness: 0.85 },  // Mintaka (belt right)
  { cx: 36, cy: 90, r: 2.2, delay: 1.0, brightness: 0.8 },   // Saiph (left foot)
  { cx: 82, cy: 92, r: 3.0, delay: 0.2, brightness: 1 },     // Rigel (right foot)
  { cx: 58, cy: 10, r: 1.6, delay: 1.4, brightness: 0.7 },   // Meissa (head)
]

const LINES: [number, number][] = [
  [7, 0], [7, 1], [0, 2], [1, 4],
  [2, 3], [3, 4], [2, 5], [4, 6],
]

/* ── Links (the repository declared in package.json) ─────────────── */
const LINKS = [
  { label: 'GitHub',        icon: Github,   url: PROJECT_LINKS.repository },
  { label: 'License',       icon: Scale,    url: PROJECT_LINKS.license },
  { label: 'Release Notes', icon: FileText, url: PROJECT_LINKS.releases },
  { label: 'Report Issue',  icon: Bug,      url: PROJECT_LINKS.issues },
]

/* ── Human-readable OS name ───────────────────────────────────────── */
function formatPlatform(platform: string): string {
  switch (platform) {
    case 'win32': return 'Windows'
    case 'darwin': return 'macOS'
    case 'linux': return 'Linux'
    default: return platform
  }
}

/* ── Injected CSS ─────────────────────────────────────────────────── */
const cssText = `
  @keyframes about-overlay-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes about-dialog-in {
    from { opacity: 0; transform: scale(0.92) translateY(12px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes about-shimmer {
    0%   { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  @keyframes about-twinkle {
    0%, 100% { opacity: 0.4; transform: scale(0.85); }
    50%      { opacity: 1; transform: scale(1.15); }
  }
  @keyframes about-line-draw {
    from { stroke-dashoffset: 200; }
    to   { stroke-dashoffset: 0; }
  }
  @keyframes about-star-glow {
    0%, 100% { filter: drop-shadow(0 0 2px currentColor); }
    50%      { filter: drop-shadow(0 0 8px currentColor) drop-shadow(0 0 16px currentColor); }
  }
  .about-scroll::-webkit-scrollbar { width: 6px; }
  .about-scroll::-webkit-scrollbar-track { background: transparent; }
  .about-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
  .about-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }
`

/* ── Constellation SVG (reuses SplashScreen data) ─────────────────── */
function OrionConstellation({ size = 80 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {LINES.map(([from, to], i) => (
        <line
          key={`l-${i}`}
          x1={STARS[from].cx}
          y1={STARS[from].cy}
          x2={STARS[to].cx}
          y2={STARS[to].cy}
          stroke="var(--accent-purple, #bc8cff)"
          strokeWidth="0.6"
          opacity="0.25"
          strokeDasharray="200"
          style={{
            animation: `about-line-draw 1.8s ease-out ${0.2 + i * 0.15}s forwards`,
          }}
        />
      ))}
      {STARS.map((star, i) => (
        <g key={`s-${i}`}>
          <circle
            cx={star.cx}
            cy={star.cy}
            r={star.r * 2.5}
            fill={`rgba(188, 140, 255, ${star.brightness * 0.08})`}
            style={{
              animation: `about-star-glow ${2.5 + star.delay * 0.5}s ease-in-out ${star.delay}s infinite`,
              color: 'var(--accent-purple, #bc8cff)',
            }}
          />
          <circle
            cx={star.cx}
            cy={star.cy}
            r={star.r}
            fill={star.brightness >= 0.95 ? 'var(--accent, #58a6ff)' : 'var(--accent-purple, #bc8cff)'}
            style={{
              animation: `about-twinkle ${2 + star.delay * 0.6}s ease-in-out ${star.delay}s infinite`,
              transformOrigin: `${star.cx}px ${star.cy}px`,
            }}
          />
          <circle
            cx={star.cx}
            cy={star.cy}
            r={star.r * 0.4}
            fill="#fff"
            opacity={star.brightness * 0.7}
          />
        </g>
      ))}
    </svg>
  )
}

/* ── Main component ───────────────────────────────────────────────── */
export default function AboutDialog({ open, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Fetch real system info from main process via IPC
  useEffect(() => {
    if (!open) return
    let cancelled = false
    window.api?.appGetInfo?.().then((info: AppInfo) => {
      if (!cancelled) setAppInfo(info)
    }).catch(() => {
      // Fallback: leave appInfo null, the UI will show placeholders
    })
    return () => { cancelled = true }
  }, [open])

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setCopied(false)
      setAppInfo(null)
    }
  }, [open])

  // Escape key handler
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onClose])

  // Focus trap: focus dialog on mount
  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus()
    }
  }, [open])

  const version = appInfo?.version || VERSION_FALLBACK
  const osLabel = appInfo
    ? `${formatPlatform(appInfo.platform)} (${appInfo.arch})`
    : `${navigator.platform || 'Unknown'}`

  const handleCopy = useCallback(() => {
    const lines = [
      `Orion IDE v${version}`,
      '',
      'System Information:',
      `  Electron: ${appInfo?.electron || 'N/A'}`,
      `  Chrome:   ${appInfo?.chrome || 'N/A'}`,
      `  Node.js:  ${appInfo?.node || 'N/A'}`,
      `  V8:       ${appInfo?.v8 || 'N/A'}`,
      `  OS:       ${osLabel}`,
    ].join('\n')
    navigator.clipboard.writeText(lines).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [appInfo, version, osLabel])

  const handleLink = useCallback((url: string) => {
    if (window.api?.shellOpenExternal) {
      window.api.shellOpenExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }, [])

  if (!open) return null

  return (
    <>
      <style>{cssText}</style>

      {/* Overlay with glass effect */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          background: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'about-overlay-in 0.25s ease-out both',
        }}
        onClick={onClose}
      >
        {/* Dialog card */}
        <div
          ref={dialogRef}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 460,
            maxHeight: '85vh',
            background: 'var(--bg-secondary, #1e1e2e)',
            border: '1px solid var(--border, #333)',
            borderRadius: 14,
            boxShadow:
              '0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            outline: 'none',
            animation: 'about-dialog-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px 0',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-muted, #666)',
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
              }}
            >
              About
            </span>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                padding: 4,
                borderRadius: 6,
                color: 'var(--text-muted, #888)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Scrollable body */}
          <div
            className="about-scroll"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '16px 28px 28px',
              gap: 20,
              overflowY: 'auto',
              flex: 1,
            }}
          >
            {/* Constellation logo */}
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: 22,
                background:
                  'linear-gradient(135deg, rgba(88,166,255,0.12) 0%, rgba(188,140,255,0.12) 100%)',
                border: '1px solid rgba(88,166,255,0.18)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 24px rgba(88,166,255,0.12)',
              }}
            >
              <OrionConstellation size={64} />
            </div>

            {/* Title with gradient text */}
            <div style={{ textAlign: 'center' }}>
              <h2
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  letterSpacing: '-0.5px',
                  margin: 0,
                  background:
                    'linear-gradient(135deg, var(--accent-purple, #bc8cff) 0%, var(--accent, #58a6ff) 50%, var(--accent-green, #3fb950) 100%)',
                  backgroundSize: '200% 200%',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  animation: 'about-shimmer 4s linear infinite',
                }}
              >
                Orion IDE
              </h2>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  marginTop: 6,
                }}
              >
                <Sparkles size={13} color="#bc8cff" />
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted, #888)',
                    fontWeight: 500,
                  }}
                >
                  AI-Powered Code Editor
                </span>
              </div>
            </div>

            {/* Version badge */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 14px',
                borderRadius: 20,
                background: 'rgba(88,166,255,0.1)',
                border: '1px solid rgba(88,166,255,0.2)',
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--accent, #58a6ff)',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              v{version}
            </span>

            {/* System Information */}
            <SectionLabel text="System Information" />
            <div
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid var(--border, #333)',
              }}
            >
              <SysRow label="Electron" value={appInfo?.electron || '...'} />
              <SysRow label="Chrome" value={appInfo?.chrome || '...'} />
              <SysRow label="Node.js" value={appInfo?.node || '...'} />
              <SysRow label="V8" value={appInfo?.v8 || '...'} />
              <SysRow label="OS" value={osLabel} />
              <SysRow
                label="Architecture"
                value={appInfo?.arch || '...'}
                last
              />
            </div>

            {/* Links */}
            <SectionLabel text="Links" />
            <div
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              {LINKS.map((link) => (
                <LinkRow
                  key={link.label}
                  label={link.label}
                  icon={link.icon}
                  onClick={() => handleLink(link.url)}
                />
              ))}
            </div>

            {/* Copyright */}
            <div
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                background: 'var(--bg-primary, #181825)',
                border: '1px solid var(--border, #333)',
                fontSize: 11,
                color: 'var(--text-muted, #666)',
                lineHeight: 1.6,
                textAlign: 'center',
              }}
            >
              Released under the{' '}
              <span
                style={{
                  color: 'var(--text-secondary, #aaa)',
                  fontWeight: 600,
                }}
              >
                MIT License
              </span>
              .
              <br />
              Copyright &copy; 2024-2026 Orion IDE Contributors.
            </div>

            {/* Copy button */}
            <button
              onClick={handleCopy}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '9px 12px',
                borderRadius: 8,
                border: copied
                  ? '1px solid rgba(63,185,80,0.3)'
                  : '1px solid var(--border, #333)',
                background: copied
                  ? 'rgba(63,185,80,0.1)'
                  : 'var(--bg-primary, #181825)',
                color: copied
                  ? 'var(--accent-green, #3fb950)'
                  : 'var(--text-secondary, #bbb)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!copied)
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = copied
                  ? 'rgba(63,185,80,0.1)'
                  : 'var(--bg-primary, #181825)'
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy Version Info'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

/* ── Helper components ────────────────────────────────────────────── */

function SectionLabel({ text }: { text: string }) {
  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginTop: 4,
      }}
    >
      <div style={{ flex: 1, height: 1, background: 'var(--border, #333)' }} />
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--text-muted, #666)',
          textTransform: 'uppercase',
          letterSpacing: '1.2px',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border, #333)' }} />
    </div>
  )
}

function SysRow({
  label,
  value,
  last,
}: {
  label: string
  value: string
  last?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '7px 14px',
        background: 'var(--bg-primary, #181825)',
        borderBottom: last ? 'none' : '1px solid var(--border, #333)',
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-muted, #888)',
          letterSpacing: '0.3px',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 11,
          color: 'var(--text-secondary, #bbb)',
          fontFamily: 'var(--font-mono, monospace)',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function LinkRow({
  label,
  icon: Icon,
  onClick,
}: {
  label: string
  icon: typeof Github
  onClick: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 12px',
        borderRadius: 6,
        cursor: 'pointer',
        color: 'var(--text-secondary, #bbb)',
        fontSize: 12,
        transition: 'background 0.15s',
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <Icon size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{label}</span>
      <ExternalLink size={12} style={{ opacity: 0.3 }} />
    </div>
  )
}
