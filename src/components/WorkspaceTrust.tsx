import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  FolderCheck,
  FolderX,
  AlertTriangle,
  Info,
  X,
  Check,
  Plus,
  Trash2,
  Lock,
  Unlock,
  Terminal,
  Bug,
  Puzzle,
  Play,
  Settings,
  Code,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Search,
  Edit3,
  Eye,
  RefreshCw,
  Zap,
  GitBranch,
  FileText,
} from 'lucide-react'

/* ================================================================== */
/* Types & Constants                                                   */
/* ================================================================== */

type TrustLevel = 'trusted' | 'restricted' | 'untrusted'

interface TrustedFolder {
  path: string
  addedAt: number
  label?: string
}

interface WorkspaceTrustState {
  level: TrustLevel
  trustedFolders: TrustedFolder[]
  workspacePath: string
  workspaceLabel: string
}

interface RestrictedFeature {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  severity: 'high' | 'medium' | 'low'
}

const STORAGE_KEY = 'orion-workspace-trust'
const DISMISSED_KEY = 'orion-trust-prompt-dismissed'

const RESTRICTED_FEATURES: RestrictedFeature[] = [
  {
    id: 'terminal',
    name: 'Terminal Access',
    description: 'Running shell commands and scripts is disabled to prevent execution of malicious code.',
    icon: <Terminal size={16} />,
    severity: 'high',
  },
  {
    id: 'tasks',
    name: 'Task Execution',
    description: 'Build tasks, watchers, and automated scripts are blocked in restricted mode.',
    icon: <Play size={16} />,
    severity: 'high',
  },
  {
    id: 'debugging',
    name: 'Debugging',
    description: 'Debug configurations and launch profiles cannot run untrusted code.',
    icon: <Bug size={16} />,
    severity: 'high',
  },
  {
    id: 'extensions',
    name: 'Workspace Extensions',
    description: 'Extensions recommended by the workspace are not activated automatically.',
    icon: <Puzzle size={16} />,
    severity: 'medium',
  },
  {
    id: 'settings',
    name: 'Workspace Settings',
    description: 'Workspace-specific settings that could alter editor behavior are ignored.',
    icon: <Settings size={16} />,
    severity: 'medium',
  },
  {
    id: 'code-actions',
    name: 'Automatic Code Actions',
    description: 'Code actions on save and format-on-save from workspace config are disabled.',
    icon: <Zap size={16} />,
    severity: 'medium',
  },
  {
    id: 'git-operations',
    name: 'Git Hooks',
    description: 'Pre-commit hooks and other Git hooks defined in the workspace are skipped.',
    icon: <GitBranch size={16} />,
    severity: 'medium',
  },
  {
    id: 'file-nesting',
    name: 'Custom File Nesting',
    description: 'Workspace-defined file nesting rules are not applied.',
    icon: <FileText size={16} />,
    severity: 'low',
  },
]

const SEVERITY_COLORS: Record<string, { color: string; bg: string }> = {
  high: { color: '#f85149', bg: 'rgba(248, 81, 73, 0.1)' },
  medium: { color: '#d29922', bg: 'rgba(210, 153, 34, 0.1)' },
  low: { color: '#58a6ff', bg: 'rgba(88, 166, 255, 0.1)' },
}

const TRUST_COLORS: Record<TrustLevel, { primary: string; bg: string; border: string; badge: string }> = {
  trusted: {
    primary: '#3fb950',
    bg: 'rgba(63, 185, 80, 0.08)',
    border: 'rgba(63, 185, 80, 0.25)',
    badge: 'rgba(63, 185, 80, 0.15)',
  },
  restricted: {
    primary: '#d29922',
    bg: 'rgba(210, 153, 34, 0.08)',
    border: 'rgba(210, 153, 34, 0.25)',
    badge: 'rgba(210, 153, 34, 0.15)',
  },
  untrusted: {
    primary: '#f85149',
    bg: 'rgba(248, 81, 73, 0.08)',
    border: 'rgba(248, 81, 73, 0.25)',
    badge: 'rgba(248, 81, 73, 0.15)',
  },
}

/* ================================================================== */
/* Persistence helpers                                                 */
/* ================================================================== */

function loadTrustState(): WorkspaceTrustState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {
    level: 'untrusted',
    trustedFolders: [],
    workspacePath: '/home/user/projects/my-workspace',
    workspaceLabel: 'my-workspace',
  }
}

function saveTrustState(state: WorkspaceTrustState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* storage full */ }
}

function isPromptDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'true'
  } catch {
    return false
  }
}

function setPromptDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, 'true')
  } catch { /* ignore */ }
}

/* ================================================================== */
/* CSS keyframes injection                                             */
/* ================================================================== */

const ANIMATION_ID = 'orion-workspace-trust-animations'

function injectAnimations() {
  if (document.getElementById(ANIMATION_ID)) return
  const style = document.createElement('style')
  style.id = ANIMATION_ID
  style.textContent = `
    @keyframes wt-fade-in {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes wt-scale-in {
      from { opacity: 0; transform: scale(0.95); }
      to   { opacity: 1; transform: scale(1); }
    }
    @keyframes wt-slide-down {
      from { opacity: 0; transform: translateY(-100%); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes wt-pulse-shield {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.08); }
    }
    @keyframes wt-shimmer {
      0%   { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes wt-check-pop {
      0%   { transform: scale(0); opacity: 0; }
      60%  { transform: scale(1.2); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes wt-banner-enter {
      from { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }
      to   { opacity: 1; max-height: 60px; padding-top: 8px; padding-bottom: 8px; }
    }
  `
  document.head.appendChild(style)
}

/* ================================================================== */
/* Shared styles                                                       */
/* ================================================================== */

const baseOverlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.55)',
  backdropFilter: 'blur(4px)',
  animation: 'wt-fade-in 0.2s ease-out',
}

const baseCard: React.CSSProperties = {
  background: 'var(--bg-primary, #1e1e1e)',
  border: '1px solid var(--border, #3c3c3c)',
  borderRadius: 12,
  boxShadow: '0 20px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
  animation: 'wt-scale-in 0.25s ease-out',
  maxHeight: '90vh',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
}

const btnBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '8px 18px',
  borderRadius: 6,
  border: '1px solid transparent',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  fontFamily: 'inherit',
  lineHeight: 1.4,
}

/* ================================================================== */
/* 1. WorkspaceTrustPrompt                                             */
/* ================================================================== */

interface TrustPromptProps {
  workspacePath?: string
  workspaceLabel?: string
  onTrust: () => void
  onTrustParent?: () => void
  onRestricted: () => void
  onManage?: () => void
  onClose: () => void
}

export function WorkspaceTrustPrompt({
  workspacePath = '/home/user/projects/my-workspace',
  workspaceLabel = 'my-workspace',
  onTrust,
  onTrustParent,
  onRestricted,
  onManage,
  onClose,
}: TrustPromptProps) {
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => { injectAnimations() }, [])

  const parentPath = useMemo(() => {
    const parts = workspacePath.replace(/\\/g, '/').split('/')
    return parts.slice(0, -1).join('/')
  }, [workspacePath])

  return (
    <div style={baseOverlay} onClick={onClose}>
      <div
        style={{ ...baseCard, width: 560, maxWidth: '95vw' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '28px 32px 0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(210,153,34,0.15) 0%, rgba(248,81,73,0.10) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
            animation: 'wt-pulse-shield 2s ease-in-out infinite',
          }}>
            <ShieldAlert size={32} color="#d29922" />
          </div>

          <h2 style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 600,
            color: 'var(--text-primary, #e1e1e1)',
            lineHeight: 1.3,
          }}>
            Do you trust the authors of this workspace?
          </h2>

          <p style={{
            margin: '12px 0 0',
            fontSize: 13,
            color: 'var(--text-secondary, #8b949e)',
            lineHeight: 1.6,
            maxWidth: 440,
          }}>
            Code in this workspace can run automatically and may execute potentially harmful operations.
            Only trust workspaces from authors and sources you recognize.
          </p>
        </div>

        {/* Workspace path */}
        <div style={{
          margin: '20px 32px 0',
          padding: '12px 16px',
          borderRadius: 8,
          background: 'var(--bg-secondary, #252526)',
          border: '1px solid var(--border, #3c3c3c)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <FolderOpen size={16} color="var(--text-tertiary, #6e7681)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-primary, #e1e1e1)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {workspaceLabel}
            </div>
            <div style={{
              fontSize: 11,
              color: 'var(--text-tertiary, #6e7681)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginTop: 2,
            }}>
              {workspacePath}
            </div>
          </div>
        </div>

        {/* Expandable details */}
        <div style={{ margin: '16px 32px 0' }}>
          <button
            onClick={() => setShowDetails(!showDetails)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent, #58a6ff)',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: 0,
              fontFamily: 'inherit',
            }}
          >
            {showDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            What features are restricted?
          </button>

          {showDetails && (
            <div style={{
              marginTop: 10,
              padding: '12px 16px',
              borderRadius: 8,
              background: 'var(--bg-secondary, #252526)',
              border: '1px solid var(--border, #3c3c3c)',
              animation: 'wt-fade-in 0.15s ease-out',
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px 16px',
              }}>
                {RESTRICTED_FEATURES.slice(0, 6).map(feat => (
                  <div key={feat.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: 'var(--text-secondary, #8b949e)',
                  }}>
                    <div style={{ color: SEVERITY_COLORS[feat.severity].color, flexShrink: 0 }}>
                      {feat.icon}
                    </div>
                    {feat.name}
                  </div>
                ))}
              </div>
              <div style={{
                marginTop: 10,
                fontSize: 11,
                color: 'var(--text-tertiary, #6e7681)',
                lineHeight: 1.5,
              }}>
                Restricted mode limits functionality to keep you safe. You can always change
                trust settings later from the Manage Workspace Trust panel.
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{
          padding: '24px 32px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          {/* Primary: Trust */}
          <button
            onMouseEnter={() => setHoveredBtn('trust')}
            onMouseLeave={() => setHoveredBtn(null)}
            onClick={() => { onTrust(); onClose() }}
            style={{
              ...btnBase,
              background: hoveredBtn === 'trust'
                ? 'linear-gradient(135deg, #3fb950 0%, #2ea043 100%)'
                : 'linear-gradient(135deg, #2ea043 0%, #238636 100%)',
              color: '#fff',
              padding: '12px 24px',
              fontSize: 14,
              fontWeight: 600,
              boxShadow: hoveredBtn === 'trust'
                ? '0 4px 16px rgba(63, 185, 80, 0.3)'
                : '0 2px 8px rgba(63, 185, 80, 0.15)',
              transform: hoveredBtn === 'trust' ? 'translateY(-1px)' : 'none',
            }}
          >
            <ShieldCheck size={18} />
            Trust Workspace
          </button>

          {/* Secondary row */}
          <div style={{ display: 'flex', gap: 10 }}>
            {onTrustParent && (
              <button
                onMouseEnter={() => setHoveredBtn('parent')}
                onMouseLeave={() => setHoveredBtn(null)}
                onClick={() => { onTrustParent(); onClose() }}
                style={{
                  ...btnBase,
                  flex: 1,
                  background: hoveredBtn === 'parent'
                    ? 'var(--bg-tertiary, #333)'
                    : 'var(--bg-secondary, #252526)',
                  color: 'var(--text-primary, #e1e1e1)',
                  border: '1px solid var(--border, #3c3c3c)',
                  fontSize: 12,
                }}
                title={`Trust all workspaces in ${parentPath}`}
              >
                <FolderCheck size={14} />
                Trust Parent Folder
              </button>
            )}

            <button
              onMouseEnter={() => setHoveredBtn('restricted')}
              onMouseLeave={() => setHoveredBtn(null)}
              onClick={() => { onRestricted(); onClose() }}
              style={{
                ...btnBase,
                flex: 1,
                background: hoveredBtn === 'restricted'
                  ? 'var(--bg-tertiary, #333)'
                  : 'var(--bg-secondary, #252526)',
                color: 'var(--text-secondary, #8b949e)',
                border: '1px solid var(--border, #3c3c3c)',
                fontSize: 12,
              }}
            >
              <Lock size={14} />
              Continue in Restricted Mode
            </button>
          </div>

          {/* Manage link */}
          {onManage && (
            <button
              onClick={onManage}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent, #58a6ff)',
                fontSize: 12,
                cursor: 'pointer',
                padding: '4px 0',
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              <Settings size={12} />
              Manage Trusted Folders
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/* 2. RestrictedModeBanner                                             */
/* ================================================================== */

interface RestrictedBannerProps {
  onTrust: () => void
  onManage: () => void
  onDismiss?: () => void
}

export function RestrictedModeBanner({ onTrust, onManage, onDismiss }: RestrictedBannerProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [visible, setVisible] = useState(true)

  useEffect(() => { injectAnimations() }, [])

  if (!visible) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 16px',
      background: 'linear-gradient(90deg, rgba(210,153,34,0.12) 0%, rgba(210,153,34,0.06) 100%)',
      borderBottom: '1px solid rgba(210, 153, 34, 0.25)',
      animation: 'wt-banner-enter 0.3s ease-out',
      fontSize: 13,
      overflow: 'hidden',
    }}>
      <ShieldAlert size={16} color="#d29922" style={{ flexShrink: 0 }} />

      <span style={{ color: 'var(--text-secondary, #8b949e)', flex: 1, minWidth: 0 }}>
        <strong style={{ color: '#d29922', fontWeight: 600 }}>Restricted Mode</strong>
        {' '}&mdash; Some features are disabled because this workspace is not trusted.
      </span>

      <button
        onMouseEnter={() => setHovered('trust')}
        onMouseLeave={() => setHovered(null)}
        onClick={onTrust}
        style={{
          ...btnBase,
          padding: '4px 12px',
          fontSize: 12,
          background: hovered === 'trust' ? 'rgba(63, 185, 80, 0.2)' : 'rgba(63, 185, 80, 0.1)',
          color: '#3fb950',
          border: '1px solid rgba(63, 185, 80, 0.3)',
          borderRadius: 4,
        }}
      >
        <ShieldCheck size={13} />
        Trust
      </button>

      <button
        onMouseEnter={() => setHovered('manage')}
        onMouseLeave={() => setHovered(null)}
        onClick={onManage}
        style={{
          ...btnBase,
          padding: '4px 12px',
          fontSize: 12,
          background: hovered === 'manage' ? 'var(--bg-tertiary, #333)' : 'transparent',
          color: 'var(--text-secondary, #8b949e)',
          border: '1px solid var(--border, #3c3c3c)',
          borderRadius: 4,
        }}
      >
        Manage
      </button>

      {onDismiss && (
        <button
          onClick={() => { setVisible(false); onDismiss() }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-tertiary, #6e7681)',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            borderRadius: 4,
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

/* ================================================================== */
/* 3. TrustBadge                                                       */
/* ================================================================== */

interface TrustBadgeProps {
  level: TrustLevel
  onClick?: () => void
  size?: 'small' | 'normal'
}

export function TrustBadge({ level, onClick, size = 'normal' }: TrustBadgeProps) {
  const [hovered, setHovered] = useState(false)
  const colors = TRUST_COLORS[level]
  const isSmall = size === 'small'

  const iconSize = isSmall ? 12 : 14
  const icon = level === 'trusted'
    ? <ShieldCheck size={iconSize} />
    : level === 'restricted'
      ? <ShieldAlert size={iconSize} />
      : <ShieldOff size={iconSize} />

  const label = level === 'trusted'
    ? 'Trusted'
    : level === 'restricted'
      ? 'Restricted'
      : 'Untrusted'

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: isSmall ? 4 : 6,
        padding: isSmall ? '2px 8px' : '3px 10px',
        borderRadius: 4,
        border: 'none',
        background: hovered ? colors.border : colors.badge,
        color: colors.primary,
        fontSize: isSmall ? 11 : 12,
        fontWeight: 500,
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'inherit',
        transition: 'all 0.15s ease',
        lineHeight: 1.4,
      }}
      title={`Workspace is ${label.toLowerCase()}`}
    >
      {icon}
      {label}
    </button>
  )
}

/* ================================================================== */
/* 4. Feature Restriction List (internal)                              */
/* ================================================================== */

function FeatureRestrictionList({ expanded: defaultExpanded = false }: { expanded?: boolean }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filterText, setFilterText] = useState('')

  const filtered = useMemo(() => {
    if (!filterText) return RESTRICTED_FEATURES
    const q = filterText.toLowerCase()
    return RESTRICTED_FEATURES.filter(
      f => f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)
    )
  }, [filterText])

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
      }}>
        <h3 style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--text-primary, #e1e1e1)',
          flex: 1,
        }}>
          <Lock size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          Restricted Features
        </h3>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderRadius: 4,
          background: 'var(--bg-secondary, #252526)',
          border: '1px solid var(--border, #3c3c3c)',
        }}>
          <Search size={12} color="var(--text-tertiary, #6e7681)" />
          <input
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            placeholder="Filter..."
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary, #e1e1e1)',
              fontSize: 12,
              width: 100,
              fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.map(feat => {
          const isExpanded = expandedIds.has(feat.id)
          const sev = SEVERITY_COLORS[feat.severity]

          return (
            <div
              key={feat.id}
              style={{
                borderRadius: 6,
                border: '1px solid var(--border, #3c3c3c)',
                background: 'var(--bg-secondary, #252526)',
                overflow: 'hidden',
                transition: 'border-color 0.15s ease',
              }}
            >
              <button
                onClick={() => toggleExpand(feat.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                }}
              >
                <div style={{ color: sev.color, flexShrink: 0 }}>
                  {feat.icon}
                </div>
                <span style={{
                  flex: 1,
                  fontSize: 13,
                  color: 'var(--text-primary, #e1e1e1)',
                  fontWeight: 500,
                }}>
                  {feat.name}
                </span>
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: sev.bg,
                  color: sev.color,
                }}>
                  {feat.severity}
                </span>
                {isExpanded
                  ? <ChevronDown size={14} color="var(--text-tertiary, #6e7681)" />
                  : <ChevronRight size={14} color="var(--text-tertiary, #6e7681)" />
                }
              </button>

              {isExpanded && (
                <div style={{
                  padding: '0 14px 12px 40px',
                  fontSize: 12,
                  color: 'var(--text-secondary, #8b949e)',
                  lineHeight: 1.6,
                  animation: 'wt-fade-in 0.15s ease-out',
                }}>
                  {feat.description}
                </div>
              )}
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div style={{
            padding: 24,
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--text-tertiary, #6e7681)',
          }}>
            No matching features found.
          </div>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* 5. Trusted Folder Manager (internal)                                */
/* ================================================================== */

interface FolderManagerProps {
  folders: TrustedFolder[]
  onAdd: (path: string, label?: string) => void
  onRemove: (path: string) => void
  workspacePath: string
}

function TrustedFolderManager({ folders, onAdd, onRemove, workspacePath }: FolderManagerProps) {
  const [newPath, setNewPath] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showAdd && inputRef.current) inputRef.current.focus()
  }, [showAdd])

  const handleAdd = useCallback(() => {
    const trimmed = newPath.trim()
    if (!trimmed) return
    onAdd(trimmed, newLabel.trim() || undefined)
    setNewPath('')
    setNewLabel('')
    setShowAdd(false)
  }, [newPath, newLabel, onAdd])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd()
    else if (e.key === 'Escape') {
      setShowAdd(false)
      setNewPath('')
      setNewLabel('')
    }
  }, [handleAdd])

  const isTrusted = useCallback((folderPath: string) => {
    const norm = folderPath.replace(/\\/g, '/').replace(/\/$/, '')
    const normWs = workspacePath.replace(/\\/g, '/').replace(/\/$/, '')
    return normWs === norm || normWs.startsWith(norm + '/')
  }, [workspacePath])

  const sortedFolders = useMemo(() => {
    return [...folders].sort((a, b) => b.addedAt - a.addedAt)
  }, [folders])

  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
      }}>
        <h3 style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--text-primary, #e1e1e1)',
          flex: 1,
        }}>
          <FolderCheck size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          Trusted Folders
        </h3>
        <span style={{
          fontSize: 11,
          color: 'var(--text-tertiary, #6e7681)',
          padding: '2px 8px',
          borderRadius: 10,
          background: 'var(--bg-secondary, #252526)',
        }}>
          {folders.length} folder{folders.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => setShowAdd(!showAdd)}
          style={{
            ...btnBase,
            padding: '4px 10px',
            fontSize: 12,
            background: showAdd ? 'rgba(88, 166, 255, 0.15)' : 'var(--bg-secondary, #252526)',
            color: showAdd ? 'var(--accent, #58a6ff)' : 'var(--text-secondary, #8b949e)',
            border: '1px solid var(--border, #3c3c3c)',
            borderRadius: 4,
          }}
        >
          <Plus size={13} />
          Add
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{
          padding: 14,
          marginBottom: 10,
          borderRadius: 8,
          background: 'var(--bg-secondary, #252526)',
          border: '1px solid var(--accent, #58a6ff)',
          animation: 'wt-fade-in 0.15s ease-out',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-tertiary, #6e7681)', display: 'block', marginBottom: 4 }}>
                Folder Path *
              </label>
              <input
                ref={inputRef}
                value={newPath}
                onChange={e => setNewPath(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="/home/user/trusted-projects"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 4,
                  border: '1px solid var(--border, #3c3c3c)',
                  background: 'var(--bg-primary, #1e1e1e)',
                  color: 'var(--text-primary, #e1e1e1)',
                  fontSize: 13,
                  fontFamily: "'SF Mono', 'Cascadia Code', Consolas, monospace",
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-tertiary, #6e7681)', display: 'block', marginBottom: 4 }}>
                Label (optional)
              </label>
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="My Projects"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 4,
                  border: '1px solid var(--border, #3c3c3c)',
                  background: 'var(--bg-primary, #1e1e1e)',
                  color: 'var(--text-primary, #e1e1e1)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                onClick={() => { setShowAdd(false); setNewPath(''); setNewLabel('') }}
                style={{
                  ...btnBase,
                  padding: '6px 14px',
                  fontSize: 12,
                  background: 'transparent',
                  color: 'var(--text-secondary, #8b949e)',
                  border: '1px solid var(--border, #3c3c3c)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!newPath.trim()}
                style={{
                  ...btnBase,
                  padding: '6px 14px',
                  fontSize: 12,
                  background: newPath.trim() ? '#238636' : '#1a1a1a',
                  color: newPath.trim() ? '#fff' : '#555',
                  cursor: newPath.trim() ? 'pointer' : 'not-allowed',
                  opacity: newPath.trim() ? 1 : 0.6,
                }}
              >
                <Plus size={13} />
                Add Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Folder list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {sortedFolders.map(folder => {
          const isActive = isTrusted(folder.path)
          const isConfirming = confirmRemove === folder.path

          return (
            <div
              key={folder.path}
              onMouseEnter={() => setHoveredRow(folder.path)}
              onMouseLeave={() => { setHoveredRow(null); setConfirmRemove(null) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderRadius: 6,
                background: hoveredRow === folder.path
                  ? 'var(--bg-tertiary, #2a2a2a)'
                  : 'var(--bg-secondary, #252526)',
                border: `1px solid ${isActive ? 'rgba(63, 185, 80, 0.25)' : 'var(--border, #3c3c3c)'}`,
                transition: 'all 0.15s ease',
              }}
            >
              {isActive
                ? <FolderCheck size={16} color="#3fb950" />
                : <FolderOpen size={16} color="var(--text-tertiary, #6e7681)" />
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                {folder.label && (
                  <div style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--text-primary, #e1e1e1)',
                    marginBottom: 2,
                  }}>
                    {folder.label}
                  </div>
                )}
                <div style={{
                  fontSize: folder.label ? 11 : 13,
                  color: folder.label ? 'var(--text-tertiary, #6e7681)' : 'var(--text-primary, #e1e1e1)',
                  fontFamily: "'SF Mono', 'Cascadia Code', Consolas, monospace",
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {folder.path}
                </div>
                <div style={{
                  fontSize: 10,
                  color: 'var(--text-tertiary, #6e7681)',
                  marginTop: 2,
                }}>
                  Added {new Date(folder.addedAt).toLocaleDateString()}
                </div>
              </div>

              {isActive && (
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: 'rgba(63, 185, 80, 0.1)',
                  color: '#3fb950',
                  flexShrink: 0,
                }}>
                  Active
                </span>
              )}

              {isConfirming ? (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={() => { onRemove(folder.path); setConfirmRemove(null) }}
                    style={{
                      ...btnBase,
                      padding: '4px 8px',
                      fontSize: 11,
                      background: 'rgba(248, 81, 73, 0.15)',
                      color: '#f85149',
                      border: '1px solid rgba(248, 81, 73, 0.3)',
                      borderRadius: 4,
                    }}
                  >
                    Remove
                  </button>
                  <button
                    onClick={() => setConfirmRemove(null)}
                    style={{
                      ...btnBase,
                      padding: '4px 8px',
                      fontSize: 11,
                      background: 'transparent',
                      color: 'var(--text-secondary, #8b949e)',
                      border: '1px solid var(--border, #3c3c3c)',
                      borderRadius: 4,
                    }}
                  >
                    Keep
                  </button>
                </div>
              ) : (
                hoveredRow === folder.path && (
                  <button
                    onClick={() => setConfirmRemove(folder.path)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-tertiary, #6e7681)',
                      cursor: 'pointer',
                      padding: 4,
                      display: 'flex',
                      alignItems: 'center',
                      borderRadius: 4,
                      flexShrink: 0,
                    }}
                    title="Remove trusted folder"
                  >
                    <Trash2 size={14} />
                  </button>
                )
              )}
            </div>
          )
        })}

        {folders.length === 0 && (
          <div style={{
            padding: '32px 24px',
            textAlign: 'center',
            borderRadius: 8,
            background: 'var(--bg-secondary, #252526)',
            border: '1px dashed var(--border, #3c3c3c)',
          }}>
            <FolderX size={28} color="var(--text-tertiary, #6e7681)" style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 13, color: 'var(--text-secondary, #8b949e)', marginBottom: 4 }}>
              No trusted folders configured
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary, #6e7681)' }}>
              Add folders to automatically trust workspaces within them.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* 6. Learn More / Info Section (internal)                             */
/* ================================================================== */

function TrustInfoSection() {
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  const sections = useMemo(() => [
    {
      id: 'why',
      title: 'Why is Workspace Trust needed?',
      content: `When you open a workspace, code within it can be automatically executed through tasks,
debug configurations, workspace settings, and extensions. If you clone a repository from
an unknown source, it could contain malicious code that runs without your explicit consent.
Workspace Trust lets you decide which folders are safe to fully use.`,
    },
    {
      id: 'restricted',
      title: 'What does Restricted Mode do?',
      content: `In Restricted Mode, Orion IDE disables features that could automatically execute code:
terminal access, task running, debugging, workspace-recommended extensions, certain workspace
settings, and Git hooks. You can still browse, read, and edit code safely. This gives you
a chance to review the code before granting full trust.`,
    },
    {
      id: 'inheritance',
      title: 'How does trust inheritance work?',
      content: `When you trust a parent folder, all workspaces within that folder automatically inherit
the trusted status. For example, trusting "/home/user/projects" means any workspace opened
under that path will be fully trusted. This is convenient for your personal project directories
while keeping downloaded or cloned repos restricted until explicitly trusted.`,
    },
    {
      id: 'revoke',
      title: 'Can I revoke trust?',
      content: `Yes, you can remove any folder from your trusted list at any time through the Workspace
Trust management panel. Removing a trusted folder will cause all workspaces within it to
revert to restricted mode the next time they are opened. You can also reset all trust
settings to start fresh.`,
    },
  ], [])

  return (
    <div>
      <h3 style={{
        margin: '0 0 12px',
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--text-primary, #e1e1e1)',
      }}>
        <Info size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        Learn More
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {sections.map(section => {
          const isExpanded = expandedSection === section.id
          return (
            <div
              key={section.id}
              style={{
                borderRadius: 6,
                border: '1px solid var(--border, #3c3c3c)',
                background: 'var(--bg-secondary, #252526)',
                overflow: 'hidden',
              }}
            >
              <button
                onClick={() => setExpandedSection(isExpanded ? null : section.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                }}
              >
                {isExpanded
                  ? <ChevronDown size={14} color="var(--accent, #58a6ff)" />
                  : <ChevronRight size={14} color="var(--text-tertiary, #6e7681)" />
                }
                <span style={{
                  flex: 1,
                  fontSize: 13,
                  color: isExpanded ? 'var(--accent, #58a6ff)' : 'var(--text-primary, #e1e1e1)',
                  fontWeight: 500,
                }}>
                  {section.title}
                </span>
              </button>
              {isExpanded && (
                <div style={{
                  padding: '0 14px 14px 36px',
                  fontSize: 12,
                  color: 'var(--text-secondary, #8b949e)',
                  lineHeight: 1.7,
                  whiteSpace: 'pre-line',
                  animation: 'wt-fade-in 0.15s ease-out',
                }}>
                  {section.content}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ================================================================== */
/* 7. Main: WorkspaceTrust panel                                       */
/* ================================================================== */

type PanelTab = 'overview' | 'folders' | 'restrictions' | 'learn'

interface WorkspaceTrustProps {
  open?: boolean
  onClose?: () => void
}

export default function WorkspaceTrust({ open = true, onClose }: WorkspaceTrustProps) {
  const [state, setState] = useState<WorkspaceTrustState>(loadTrustState)
  const [activeTab, setActiveTab] = useState<PanelTab>('overview')
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null)
  const [justTrusted, setJustTrusted] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  useEffect(() => { injectAnimations() }, [])
  useEffect(() => { saveTrustState(state) }, [state])

  /* ── Trust actions ─────────────────────────────────────────────── */

  const trustWorkspace = useCallback(() => {
    setState(prev => {
      const already = prev.trustedFolders.some(f => f.path === prev.workspacePath)
      return {
        ...prev,
        level: 'trusted',
        trustedFolders: already ? prev.trustedFolders : [
          ...prev.trustedFolders,
          { path: prev.workspacePath, addedAt: Date.now(), label: prev.workspaceLabel },
        ],
      }
    })
    setJustTrusted(true)
    setTimeout(() => setJustTrusted(false), 2000)
  }, [])

  const trustParentFolder = useCallback(() => {
    setState(prev => {
      const parts = prev.workspacePath.replace(/\\/g, '/').split('/')
      const parentPath = parts.slice(0, -1).join('/')
      const parentLabel = parts[parts.length - 2] || 'parent'
      const already = prev.trustedFolders.some(f => f.path === parentPath)
      return {
        ...prev,
        level: 'trusted',
        trustedFolders: already ? prev.trustedFolders : [
          ...prev.trustedFolders,
          { path: parentPath, addedAt: Date.now(), label: parentLabel },
        ],
      }
    })
    setJustTrusted(true)
    setTimeout(() => setJustTrusted(false), 2000)
  }, [])

  const setRestricted = useCallback(() => {
    setState(prev => ({ ...prev, level: 'restricted' }))
  }, [])

  const addFolder = useCallback((path: string, label?: string) => {
    setState(prev => {
      if (prev.trustedFolders.some(f => f.path === path)) return prev
      const next = {
        ...prev,
        trustedFolders: [...prev.trustedFolders, { path, addedAt: Date.now(), label }],
      }
      // Check if this new folder covers the current workspace
      const norm = path.replace(/\\/g, '/').replace(/\/$/, '')
      const normWs = prev.workspacePath.replace(/\\/g, '/').replace(/\/$/, '')
      if (normWs === norm || normWs.startsWith(norm + '/')) {
        next.level = 'trusted'
      }
      return next
    })
  }, [])

  const removeFolder = useCallback((path: string) => {
    setState(prev => {
      const next = {
        ...prev,
        trustedFolders: prev.trustedFolders.filter(f => f.path !== path),
      }
      // Check if workspace is still covered
      const normWs = prev.workspacePath.replace(/\\/g, '/').replace(/\/$/, '')
      const stillTrusted = next.trustedFolders.some(f => {
        const norm = f.path.replace(/\\/g, '/').replace(/\/$/, '')
        return normWs === norm || normWs.startsWith(norm + '/')
      })
      if (!stillTrusted && prev.level === 'trusted') {
        next.level = 'restricted'
      }
      return next
    })
  }, [])

  const resetAll = useCallback(() => {
    setState(prev => ({
      ...prev,
      level: 'untrusted',
      trustedFolders: [],
    }))
    setShowResetConfirm(false)
  }, [])

  /* ── Tab definitions ───────────────────────────────────────────── */

  const tabs: { id: PanelTab; label: string; icon: React.ReactNode }[] = useMemo(() => [
    { id: 'overview', label: 'Overview', icon: <Shield size={14} /> },
    { id: 'folders', label: 'Trusted Folders', icon: <FolderCheck size={14} /> },
    { id: 'restrictions', label: 'Restrictions', icon: <Lock size={14} /> },
    { id: 'learn', label: 'Learn More', icon: <Info size={14} /> },
  ], [])

  /* ── Derived ───────────────────────────────────────────────────── */

  const trustColors = TRUST_COLORS[state.level]

  if (!open) return null

  return (
    <div style={baseOverlay} onClick={onClose}>
      <div
        style={{ ...baseCard, width: 680, maxWidth: '95vw' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <div style={{
          padding: '20px 24px 0',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 16,
        }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${trustColors.bg} 0%, ${trustColors.border} 100%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            {state.level === 'trusted'
              ? <ShieldCheck size={24} color={trustColors.primary} />
              : state.level === 'restricted'
                ? <ShieldAlert size={24} color={trustColors.primary} />
                : <ShieldOff size={24} color={trustColors.primary} />
            }
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                color: 'var(--text-primary, #e1e1e1)',
              }}>
                Workspace Trust
              </h2>
              <TrustBadge level={state.level} size="small" />
              {justTrusted && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  color: '#3fb950',
                  animation: 'wt-check-pop 0.4s ease-out',
                }}>
                  <Check size={14} />
                  Updated
                </div>
              )}
            </div>
            <p style={{
              margin: '4px 0 0',
              fontSize: 12,
              color: 'var(--text-tertiary, #6e7681)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {state.workspacePath}
            </p>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-tertiary, #6e7681)',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
                borderRadius: 4,
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* ── Tab bar ─────────────────────────────────────────────── */}
        <div style={{
          display: 'flex',
          gap: 0,
          padding: '16px 24px 0',
          borderBottom: '1px solid var(--border, #3c3c3c)',
        }}>
          {tabs.map(tab => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  background: 'none',
                  border: 'none',
                  borderBottom: isActive ? `2px solid var(--accent, #58a6ff)` : '2px solid transparent',
                  color: isActive ? 'var(--text-primary, #e1e1e1)' : 'var(--text-tertiary, #6e7681)',
                  fontSize: 13,
                  fontWeight: isActive ? 500 : 400,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s ease',
                  marginBottom: -1,
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* ── Content ─────────────────────────────────────────────── */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: 24,
          minHeight: 0,
          maxHeight: 'calc(90vh - 180px)',
        }}>
          {/* Overview */}
          {activeTab === 'overview' && (
            <div style={{ animation: 'wt-fade-in 0.2s ease-out' }}>
              {/* Status card */}
              <div style={{
                padding: 20,
                borderRadius: 10,
                background: trustColors.bg,
                border: `1px solid ${trustColors.border}`,
                marginBottom: 20,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  {state.level === 'trusted'
                    ? <ShieldCheck size={20} color={trustColors.primary} />
                    : state.level === 'restricted'
                      ? <ShieldAlert size={20} color={trustColors.primary} />
                      : <ShieldOff size={20} color={trustColors.primary} />
                  }
                  <div>
                    <div style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: trustColors.primary,
                      textTransform: 'capitalize',
                    }}>
                      {state.level === 'trusted'
                        ? 'This workspace is trusted'
                        : state.level === 'restricted'
                          ? 'Running in Restricted Mode'
                          : 'This workspace is not trusted'
                      }
                    </div>
                    <div style={{
                      fontSize: 12,
                      color: 'var(--text-secondary, #8b949e)',
                      marginTop: 2,
                    }}>
                      {state.level === 'trusted'
                        ? 'All features are enabled. Code in this workspace can run freely.'
                        : state.level === 'restricted'
                          ? `${RESTRICTED_FEATURES.length} features are disabled for your safety.`
                          : 'Choose whether to trust this workspace or continue with restrictions.'
                      }
                    </div>
                  </div>
                </div>

                {/* Quick actions */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {state.level !== 'trusted' && (
                    <button
                      onMouseEnter={() => setHoveredBtn('ov-trust')}
                      onMouseLeave={() => setHoveredBtn(null)}
                      onClick={trustWorkspace}
                      style={{
                        ...btnBase,
                        padding: '8px 16px',
                        fontSize: 13,
                        fontWeight: 600,
                        background: hoveredBtn === 'ov-trust'
                          ? 'linear-gradient(135deg, #3fb950 0%, #2ea043 100%)'
                          : 'linear-gradient(135deg, #2ea043 0%, #238636 100%)',
                        color: '#fff',
                        boxShadow: hoveredBtn === 'ov-trust'
                          ? '0 4px 12px rgba(63, 185, 80, 0.25)'
                          : 'none',
                      }}
                    >
                      <Unlock size={14} />
                      Trust This Workspace
                    </button>
                  )}
                  {state.level !== 'trusted' && (
                    <button
                      onMouseEnter={() => setHoveredBtn('ov-parent')}
                      onMouseLeave={() => setHoveredBtn(null)}
                      onClick={trustParentFolder}
                      style={{
                        ...btnBase,
                        padding: '8px 16px',
                        fontSize: 13,
                        background: hoveredBtn === 'ov-parent'
                          ? 'var(--bg-tertiary, #333)'
                          : 'var(--bg-secondary, #252526)',
                        color: 'var(--text-primary, #e1e1e1)',
                        border: '1px solid var(--border, #3c3c3c)',
                      }}
                    >
                      <FolderCheck size={14} />
                      Trust Parent Folder
                    </button>
                  )}
                  {state.level === 'trusted' && (
                    <button
                      onMouseEnter={() => setHoveredBtn('ov-restrict')}
                      onMouseLeave={() => setHoveredBtn(null)}
                      onClick={setRestricted}
                      style={{
                        ...btnBase,
                        padding: '8px 16px',
                        fontSize: 13,
                        background: hoveredBtn === 'ov-restrict'
                          ? 'rgba(210, 153, 34, 0.15)'
                          : 'var(--bg-secondary, #252526)',
                        color: 'var(--text-secondary, #8b949e)',
                        border: '1px solid var(--border, #3c3c3c)',
                      }}
                    >
                      <Lock size={14} />
                      Enter Restricted Mode
                    </button>
                  )}
                </div>
              </div>

              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
                <div style={{
                  padding: 16,
                  borderRadius: 8,
                  background: 'var(--bg-secondary, #252526)',
                  border: '1px solid var(--border, #3c3c3c)',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary, #e1e1e1)' }}>
                    {state.trustedFolders.length}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary, #6e7681)', marginTop: 2 }}>
                    Trusted Folders
                  </div>
                </div>
                <div style={{
                  padding: 16,
                  borderRadius: 8,
                  background: 'var(--bg-secondary, #252526)',
                  border: '1px solid var(--border, #3c3c3c)',
                  textAlign: 'center',
                }}>
                  <div style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: state.level === 'trusted' ? '#3fb950' : '#d29922',
                  }}>
                    {state.level === 'trusted' ? RESTRICTED_FEATURES.length : 0}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary, #6e7681)', marginTop: 2 }}>
                    Features Enabled
                  </div>
                </div>
                <div style={{
                  padding: 16,
                  borderRadius: 8,
                  background: 'var(--bg-secondary, #252526)',
                  border: '1px solid var(--border, #3c3c3c)',
                  textAlign: 'center',
                }}>
                  <div style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: state.level !== 'trusted' ? '#f85149' : 'var(--text-tertiary, #6e7681)',
                  }}>
                    {state.level !== 'trusted' ? RESTRICTED_FEATURES.length : 0}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary, #6e7681)', marginTop: 2 }}>
                    Restricted
                  </div>
                </div>
              </div>

              {/* Security info */}
              <div style={{
                padding: 16,
                borderRadius: 8,
                background: 'rgba(88, 166, 255, 0.06)',
                border: '1px solid rgba(88, 166, 255, 0.15)',
                display: 'flex',
                gap: 12,
              }}>
                <Info size={16} color="#58a6ff" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)', lineHeight: 1.6 }}>
                  <strong style={{ color: 'var(--text-primary, #e1e1e1)' }}>Why Workspace Trust?</strong><br />
                  Workspace Trust protects you from automatically executing potentially malicious code
                  when opening projects from unknown sources. In Restricted Mode, features like the
                  terminal, debugging, and task execution are disabled until you explicitly grant trust.
                </div>
              </div>

              {/* Reset */}
              <div style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: '1px solid var(--border, #3c3c3c)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary, #6e7681)' }}>
                  Reset all workspace trust settings
                </div>
                {showResetConfirm ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={resetAll}
                      style={{
                        ...btnBase,
                        padding: '4px 12px',
                        fontSize: 12,
                        background: 'rgba(248, 81, 73, 0.15)',
                        color: '#f85149',
                        border: '1px solid rgba(248, 81, 73, 0.3)',
                        borderRadius: 4,
                      }}
                    >
                      Confirm Reset
                    </button>
                    <button
                      onClick={() => setShowResetConfirm(false)}
                      style={{
                        ...btnBase,
                        padding: '4px 12px',
                        fontSize: 12,
                        background: 'transparent',
                        color: 'var(--text-secondary, #8b949e)',
                        border: '1px solid var(--border, #3c3c3c)',
                        borderRadius: 4,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onMouseEnter={() => setHoveredBtn('reset')}
                    onMouseLeave={() => setHoveredBtn(null)}
                    onClick={() => setShowResetConfirm(true)}
                    style={{
                      ...btnBase,
                      padding: '4px 12px',
                      fontSize: 12,
                      background: hoveredBtn === 'reset' ? 'rgba(248, 81, 73, 0.1)' : 'transparent',
                      color: 'var(--text-tertiary, #6e7681)',
                      border: '1px solid var(--border, #3c3c3c)',
                      borderRadius: 4,
                    }}
                  >
                    <RefreshCw size={12} />
                    Reset All
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Trusted Folders tab */}
          {activeTab === 'folders' && (
            <div style={{ animation: 'wt-fade-in 0.2s ease-out' }}>
              <div style={{
                padding: 14,
                borderRadius: 8,
                background: 'rgba(63, 185, 80, 0.06)',
                border: '1px solid rgba(63, 185, 80, 0.15)',
                marginBottom: 20,
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
              }}>
                <FolderCheck size={15} color="#3fb950" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)', lineHeight: 1.6 }}>
                  Trusted folders grant full access to all workspaces within them.
                  Child folders inherit trust from their parent &mdash; trusting{' '}
                  <code style={{
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: 'var(--bg-secondary, #252526)',
                    fontSize: 11,
                    fontFamily: "'SF Mono', 'Cascadia Code', Consolas, monospace",
                  }}>/home/user/projects</code>{' '}
                  automatically trusts everything inside it.
                </div>
              </div>
              <TrustedFolderManager
                folders={state.trustedFolders}
                onAdd={addFolder}
                onRemove={removeFolder}
                workspacePath={state.workspacePath}
              />
            </div>
          )}

          {/* Restrictions tab */}
          {activeTab === 'restrictions' && (
            <div style={{ animation: 'wt-fade-in 0.2s ease-out' }}>
              {state.level === 'trusted' ? (
                <div style={{
                  padding: 20,
                  borderRadius: 8,
                  background: 'rgba(63, 185, 80, 0.06)',
                  border: '1px solid rgba(63, 185, 80, 0.15)',
                  textAlign: 'center',
                  marginBottom: 20,
                }}>
                  <ShieldCheck size={28} color="#3fb950" style={{ marginBottom: 8 }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#3fb950', marginBottom: 4 }}>
                    All Features Enabled
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)' }}>
                    This workspace is trusted. No features are currently restricted.
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: 14,
                  borderRadius: 8,
                  background: 'rgba(210, 153, 34, 0.06)',
                  border: '1px solid rgba(210, 153, 34, 0.15)',
                  marginBottom: 20,
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                }}>
                  <AlertTriangle size={15} color="#d29922" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)', flex: 1 }}>
                    The following features are disabled in restricted mode. Trust this workspace to enable them.
                  </span>
                  <button
                    onClick={trustWorkspace}
                    style={{
                      ...btnBase,
                      padding: '4px 12px',
                      fontSize: 12,
                      background: '#238636',
                      color: '#fff',
                      borderRadius: 4,
                      flexShrink: 0,
                    }}
                  >
                    <Unlock size={12} />
                    Trust
                  </button>
                </div>
              )}
              <FeatureRestrictionList />
            </div>
          )}

          {/* Learn More tab */}
          {activeTab === 'learn' && (
            <div style={{ animation: 'wt-fade-in 0.2s ease-out' }}>
              <TrustInfoSection />

              <div style={{
                marginTop: 20,
                padding: 16,
                borderRadius: 8,
                background: 'var(--bg-secondary, #252526)',
                border: '1px solid var(--border, #3c3c3c)',
              }}>
                <h4 style={{
                  margin: '0 0 10px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary, #e1e1e1)',
                }}>
                  Quick Reference
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { icon: <ShieldCheck size={14} color="#3fb950" />, label: 'Trusted', desc: 'All features are enabled. Full editor functionality.' },
                    { icon: <ShieldAlert size={14} color="#d29922" />, label: 'Restricted', desc: 'Limited features. Safe for reviewing unfamiliar code.' },
                    { icon: <ShieldOff size={14} color="#f85149" />, label: 'Untrusted', desc: 'Workspace has not been evaluated. Trust prompt will appear.' },
                  ].map(item => (
                    <div key={item.label} style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: 'var(--bg-primary, #1e1e1e)',
                    }}>
                      <div style={{ flexShrink: 0, marginTop: 1 }}>{item.icon}</div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary, #e1e1e1)' }}>
                          {item.label}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary, #6e7681)', marginTop: 1 }}>
                          {item.desc}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{
                marginTop: 16,
                display: 'flex',
                gap: 8,
              }}>
                <a
                  href="https://docs.orion-ide.dev/workspace-trust"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    ...btnBase,
                    padding: '8px 14px',
                    fontSize: 12,
                    background: 'var(--bg-secondary, #252526)',
                    color: 'var(--accent, #58a6ff)',
                    border: '1px solid var(--border, #3c3c3c)',
                    textDecoration: 'none',
                  }}
                >
                  <ExternalLink size={12} />
                  Documentation
                </a>
                <a
                  href="https://docs.orion-ide.dev/security"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    ...btnBase,
                    padding: '8px 14px',
                    fontSize: 12,
                    background: 'var(--bg-secondary, #252526)',
                    color: 'var(--accent, #58a6ff)',
                    border: '1px solid var(--border, #3c3c3c)',
                    textDecoration: 'none',
                  }}
                >
                  <Shield size={12} />
                  Security Guide
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
