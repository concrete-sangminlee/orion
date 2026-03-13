import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  X, Plus, Trash2, Edit3, Download, Upload, Search, Save,
  Terminal, ChevronDown, ChevronRight, Check, Copy, Star,
  Play, Settings, Monitor, AlertTriangle, Info, RefreshCw,
  Cpu, FolderOpen, Hash, Eye, EyeOff, MoreHorizontal,
  ArrowUpDown, ExternalLink, Zap, Shield, ShieldCheck,
} from 'lucide-react'

// ─── Injected Styles ──────────────────────────────────────────────────────────

const INJECTED_STYLES = `
.tpm-scrollbar::-webkit-scrollbar { width: 6px; }
.tpm-scrollbar::-webkit-scrollbar-track { background: transparent; }
.tpm-scrollbar::-webkit-scrollbar-thumb {
  background: var(--border-color, var(--border));
  border-radius: 3px;
}
.tpm-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

@keyframes tpm-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.tpm-fade-in { animation: tpm-fade-in 0.15s ease-out; }

@keyframes tpm-slide-in {
  from { opacity: 0; transform: translateX(-6px); }
  to   { opacity: 1; transform: translateX(0); }
}
.tpm-slide-in { animation: tpm-slide-in 0.18s ease-out; }

@keyframes tpm-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.tpm-pulse { animation: tpm-pulse 1.5s ease-in-out infinite; }

.tpm-profile-item:hover { background: var(--bg-hover) !important; }
.tpm-env-row:hover { background: var(--bg-hover) !important; }
.tpm-btn:hover { background: rgba(255,255,255,0.08) !important; }
.tpm-dropdown-item:hover { background: var(--bg-hover) !important; }
`

// ─── Types ────────────────────────────────────────────────────────────────────

type Platform = 'windows' | 'macos' | 'linux'
type CursorStyle = 'block' | 'underline' | 'line'
type SidePanel = 'profiles' | 'detection' | 'import-export'
type EditorSection = 'general' | 'appearance' | 'environment' | 'startup' | 'integration'

interface EnvVar {
  key: string
  value: string
  id: string
}

interface ProfileAppearance {
  fontSize: number
  fontFamily: string
  cursorStyle: CursorStyle
  lineHeight: number
  scrollback: number
  cursorBlink: boolean
}

interface ShellIntegration {
  enabled: boolean
  commandDecoration: boolean
  cwdDetection: boolean
  status: 'active' | 'inactive' | 'unknown'
}

interface TerminalProfile {
  id: string
  name: string
  shellPath: string
  shellType: string
  args: string[]
  icon: string
  color: string
  envVars: EnvVar[]
  cwd: string
  appearance: ProfileAppearance
  integration: ShellIntegration
  startupCommands: string[]
  isDefault: boolean
  isBuiltIn: boolean
  platform: Platform
  createdAt: number
  updatedAt: number
}

interface DetectedShell {
  name: string
  path: string
  shellType: string
  icon: string
  color: string
  available: boolean
  version?: string
}

interface Props {
  open: boolean
  onClose: () => void
  onLaunchProfile?: (profileId: string) => void
  platform?: Platform
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SHELL_ICONS: Record<string, { label: string; color: string }> = {
  bash:       { label: '$_', color: '#89e051' },
  zsh:        { label: 'Z',  color: '#4ec9b0' },
  fish:       { label: '>_', color: '#d2a8ff' },
  powershell: { label: 'PS', color: '#2d7dd2' },
  pwsh:       { label: 'PS', color: '#2d7dd2' },
  cmd:        { label: '>',  color: '#cccccc' },
  gitbash:    { label: 'G$', color: '#f14e32' },
  wsl:        { label: 'W',  color: '#e95420' },
  sh:         { label: '$',  color: '#89e051' },
  custom:     { label: 'C',  color: '#8b949e' },
}

const CURSOR_STYLES: { value: CursorStyle; label: string }[] = [
  { value: 'block',     label: 'Block' },
  { value: 'underline', label: 'Underline' },
  { value: 'line',      label: 'Line' },
]

const FONT_FAMILIES = [
  "'Cascadia Code', monospace",
  "'Fira Code', monospace",
  "'JetBrains Mono', monospace",
  "'Source Code Pro', monospace",
  "'Consolas', monospace",
  "'Courier New', monospace",
  "'Ubuntu Mono', monospace",
  "'Menlo', monospace",
  "monospace",
]

const PROFILE_COLORS = [
  '#89e051', '#4ec9b0', '#d2a8ff', '#2d7dd2', '#cccccc',
  '#f14e32', '#e95420', '#3572a5', '#f1e05a', '#e34c26',
  '#ff6b6b', '#48dbfb', '#feca57', '#ff9ff3', '#54a0ff',
]

const DEFAULT_APPEARANCE: ProfileAppearance = {
  fontSize: 13,
  fontFamily: "'Cascadia Code', monospace",
  cursorStyle: 'block',
  lineHeight: 1.4,
  scrollback: 1000,
  cursorBlink: true,
}

const DEFAULT_INTEGRATION: ShellIntegration = {
  enabled: true,
  commandDecoration: true,
  cwdDetection: true,
  status: 'unknown',
}

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'linux'
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'macos'
  return 'linux'
}

function createDetectedShells(platform: Platform): DetectedShell[] {
  const shells: DetectedShell[] = []
  if (platform === 'windows') {
    shells.push(
      { name: 'PowerShell',      path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', shellType: 'powershell', icon: 'PS', color: '#2d7dd2', available: true, version: '5.1' },
      { name: 'PowerShell 7',    path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',                      shellType: 'pwsh',       icon: 'PS', color: '#2d7dd2', available: true, version: '7.4' },
      { name: 'Command Prompt',  path: 'C:\\Windows\\System32\\cmd.exe',                                  shellType: 'cmd',        icon: '>',  color: '#cccccc', available: true },
      { name: 'Git Bash',        path: 'C:\\Program Files\\Git\\bin\\bash.exe',                            shellType: 'gitbash',    icon: 'G$', color: '#f14e32', available: true, version: '2.43' },
      { name: 'WSL (Ubuntu)',    path: 'C:\\Windows\\System32\\wsl.exe',                                   shellType: 'wsl',        icon: 'W',  color: '#e95420', available: true },
    )
  } else if (platform === 'macos') {
    shells.push(
      { name: 'Zsh',    path: '/bin/zsh',            shellType: 'zsh',  icon: 'Z',  color: '#4ec9b0', available: true, version: '5.9' },
      { name: 'Bash',   path: '/bin/bash',           shellType: 'bash', icon: '$_', color: '#89e051', available: true, version: '5.2' },
      { name: 'Fish',   path: '/opt/homebrew/bin/fish', shellType: 'fish', icon: '>_', color: '#d2a8ff', available: false },
      { name: 'sh',     path: '/bin/sh',             shellType: 'sh',   icon: '$',  color: '#89e051', available: true },
    )
  } else {
    shells.push(
      { name: 'Bash',   path: '/bin/bash',     shellType: 'bash', icon: '$_', color: '#89e051', available: true, version: '5.2' },
      { name: 'Zsh',    path: '/usr/bin/zsh',  shellType: 'zsh',  icon: 'Z',  color: '#4ec9b0', available: true, version: '5.9' },
      { name: 'Fish',   path: '/usr/bin/fish', shellType: 'fish', icon: '>_', color: '#d2a8ff', available: false },
      { name: 'sh',     path: '/bin/sh',       shellType: 'sh',   icon: '$',  color: '#89e051', available: true },
    )
  }
  return shells
}

function createDefaultProfiles(platform: Platform): TerminalProfile[] {
  const now = Date.now()
  const base: Omit<TerminalProfile, 'id' | 'name' | 'shellPath' | 'shellType' | 'icon' | 'color' | 'isDefault' | 'platform'> = {
    args: [],
    envVars: [],
    cwd: '',
    appearance: { ...DEFAULT_APPEARANCE },
    integration: { ...DEFAULT_INTEGRATION },
    startupCommands: [],
    isBuiltIn: true,
    createdAt: now,
    updatedAt: now,
  }

  if (platform === 'windows') {
    return [
      { ...base, id: 'powershell', name: 'PowerShell', shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', shellType: 'powershell', icon: 'PS', color: '#2d7dd2', isDefault: true, platform },
      { ...base, id: 'cmd', name: 'Command Prompt', shellPath: 'C:\\Windows\\System32\\cmd.exe', shellType: 'cmd', icon: '>', color: '#cccccc', isDefault: false, platform },
      { ...base, id: 'gitbash', name: 'Git Bash', shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe', shellType: 'gitbash', icon: 'G$', color: '#f14e32', isDefault: false, platform },
      { ...base, id: 'wsl', name: 'WSL', shellPath: 'C:\\Windows\\System32\\wsl.exe', shellType: 'wsl', icon: 'W', color: '#e95420', isDefault: false, platform },
    ]
  }
  if (platform === 'macos') {
    return [
      { ...base, id: 'zsh', name: 'Zsh', shellPath: '/bin/zsh', shellType: 'zsh', icon: 'Z', color: '#4ec9b0', isDefault: true, platform },
      { ...base, id: 'bash', name: 'Bash', shellPath: '/bin/bash', shellType: 'bash', icon: '$_', color: '#89e051', isDefault: false, platform },
    ]
  }
  return [
    { ...base, id: 'bash', name: 'Bash', shellPath: '/bin/bash', shellType: 'bash', icon: '$_', color: '#89e051', isDefault: true, platform },
    { ...base, id: 'zsh', name: 'Zsh', shellPath: '/usr/bin/zsh', shellType: 'zsh', icon: 'Z', color: '#4ec9b0', isDefault: false, platform },
  ]
}

let _envIdCounter = 0
function nextEnvId(): string {
  return `env_${Date.now()}_${++_envIdCounter}`
}

let _profileIdCounter = 0
function nextProfileId(): string {
  return `profile_${Date.now()}_${++_profileIdCounter}`
}

// ─── Shared Styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  fontSize: 12,
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color, var(--border))',
  borderRadius: 4,
  color: 'var(--text-primary)',
  outline: 'none',
  fontFamily: 'var(--font-sans)',
}

const monoInputStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: "'Cascadia Code', 'Fira Code', monospace",
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-muted)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 4,
}

const smallBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 22,
  color: 'var(--text-muted)',
  background: 'transparent',
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
}

const pillBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--text-secondary)',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color, var(--border))',
  borderRadius: 5,
  cursor: 'pointer',
}

const accentBtnStyle: React.CSSProperties = {
  ...pillBtnStyle,
  color: '#fff',
  background: 'var(--accent, #007acc)',
  border: '1px solid transparent',
}

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 0 6px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  userSelect: 'none',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none' as const,
  paddingRight: 24,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238b949e'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 8px center',
}

// ─── Shell Icon ───────────────────────────────────────────────────────────────

function ShellIcon({ shellType, size = 16, color }: { shellType: string; size?: number; color?: string }) {
  const info = SHELL_ICONS[shellType.toLowerCase()] || SHELL_ICONS.custom
  const c = color || info.color
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size + 2,
        height: size + 2,
        fontSize: size - 4,
        fontWeight: 700,
        fontFamily: 'monospace',
        color: c,
        borderRadius: 3,
        background: `${c}18`,
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      {info.label}
    </span>
  )
}

// ─── Integration Badge ────────────────────────────────────────────────────────

function IntegrationBadge({ status }: { status: 'active' | 'inactive' | 'unknown' }) {
  const config = {
    active:   { icon: <ShieldCheck size={11} />, color: 'var(--accent-green, #89e051)', label: 'Active' },
    inactive: { icon: <Shield size={11} />,      color: 'var(--accent-orange, #f0a040)', label: 'Inactive' },
    unknown:  { icon: <Shield size={11} />,      color: 'var(--text-muted)',              label: 'Unknown' },
  }
  const c = config[status]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '1px 6px',
        fontSize: 10,
        fontWeight: 500,
        color: c.color,
        background: `${c.color}18`,
        borderRadius: 8,
      }}
    >
      {c.icon} {c.label}
    </span>
  )
}

// ─── Environment Variable Editor ──────────────────────────────────────────────

function EnvVarEditor({
  envVars,
  onChange,
}: {
  envVars: EnvVar[]
  onChange: (envVars: EnvVar[]) => void
}) {
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editKey, setEditKey] = useState('')
  const [editVal, setEditVal] = useState('')
  const [showValues, setShowValues] = useState<Record<string, boolean>>({})

  const handleAdd = useCallback(() => {
    if (!newKey.trim()) return
    onChange([...envVars, { key: newKey.trim(), value: newVal, id: nextEnvId() }])
    setNewKey('')
    setNewVal('')
  }, [envVars, newKey, newVal, onChange])

  const handleRemove = useCallback((id: string) => {
    onChange(envVars.filter(e => e.id !== id))
  }, [envVars, onChange])

  const startEdit = useCallback((env: EnvVar) => {
    setEditId(env.id)
    setEditKey(env.key)
    setEditVal(env.value)
  }, [])

  const saveEdit = useCallback(() => {
    if (!editId || !editKey.trim()) return
    onChange(envVars.map(e => e.id === editId ? { ...e, key: editKey.trim(), value: editVal } : e))
    setEditId(null)
  }, [editId, editKey, editVal, envVars, onChange])

  const toggleShow = useCallback((id: string) => {
    setShowValues(p => ({ ...p, [id]: !p[id] }))
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {envVars.map(env => (
        <div
          key={env.id}
          className="tpm-env-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 6px',
            borderRadius: 4,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color, var(--border))',
          }}
        >
          {editId === env.id ? (
            <>
              <input
                style={{ ...monoInputStyle, width: '35%', fontSize: 11 }}
                value={editKey}
                onChange={e => setEditKey(e.target.value)}
                placeholder="KEY"
                onKeyDown={e => e.key === 'Enter' && saveEdit()}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>=</span>
              <input
                style={{ ...monoInputStyle, flex: 1, fontSize: 11 }}
                value={editVal}
                onChange={e => setEditVal(e.target.value)}
                placeholder="value"
                onKeyDown={e => e.key === 'Enter' && saveEdit()}
              />
              <button className="tpm-btn" style={smallBtnStyle} onClick={saveEdit} title="Save">
                <Check size={12} />
              </button>
              <button className="tpm-btn" style={smallBtnStyle} onClick={() => setEditId(null)} title="Cancel">
                <X size={12} />
              </button>
            </>
          ) : (
            <>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--accent-blue, #58a6ff)', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '35%' }}>
                {env.key}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>=</span>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {showValues[env.id] ? env.value : '\u2022'.repeat(Math.min(env.value.length, 12))}
              </span>
              <button className="tpm-btn" style={smallBtnStyle} onClick={() => toggleShow(env.id)} title={showValues[env.id] ? 'Hide' : 'Show'}>
                {showValues[env.id] ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
              <button className="tpm-btn" style={smallBtnStyle} onClick={() => startEdit(env)} title="Edit">
                <Edit3 size={11} />
              </button>
              <button className="tpm-btn" style={smallBtnStyle} onClick={() => handleRemove(env.id)} title="Remove">
                <Trash2 size={11} />
              </button>
            </>
          )}
        </div>
      ))}

      {/* Add new row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <input
          style={{ ...monoInputStyle, width: '35%', fontSize: 11 }}
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          placeholder="NEW_KEY"
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>=</span>
        <input
          style={{ ...monoInputStyle, flex: 1, fontSize: 11 }}
          value={newVal}
          onChange={e => setNewVal(e.target.value)}
          placeholder="value"
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button
          className="tpm-btn"
          style={{ ...smallBtnStyle, color: newKey.trim() ? 'var(--accent-green, #89e051)' : 'var(--text-muted)' }}
          onClick={handleAdd}
          disabled={!newKey.trim()}
          title="Add"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  )
}

// ─── Startup Commands Editor ──────────────────────────────────────────────────

function StartupCommandsEditor({
  commands,
  onChange,
}: {
  commands: string[]
  onChange: (cmds: string[]) => void
}) {
  const [newCmd, setNewCmd] = useState('')

  const handleAdd = useCallback(() => {
    if (!newCmd.trim()) return
    onChange([...commands, newCmd.trim()])
    setNewCmd('')
  }, [commands, newCmd, onChange])

  const handleRemove = useCallback((idx: number) => {
    onChange(commands.filter((_, i) => i !== idx))
  }, [commands, onChange])

  const handleReorder = useCallback((idx: number, dir: -1 | 1) => {
    const next = [...commands]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    onChange(next)
  }, [commands, onChange])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
        Commands execute sequentially when a new terminal starts with this profile.
      </div>
      {commands.map((cmd, i) => (
        <div
          key={i}
          className="tpm-env-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            borderRadius: 4,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color, var(--border))',
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', width: 16, textAlign: 'right' }}>
            {i + 1}.
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {cmd}
          </span>
          <button className="tpm-btn" style={smallBtnStyle} onClick={() => handleReorder(i, -1)} title="Move up" disabled={i === 0}>
            <ArrowUpDown size={11} />
          </button>
          <button className="tpm-btn" style={smallBtnStyle} onClick={() => handleRemove(i)} title="Remove">
            <Trash2 size={11} />
          </button>
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <input
          style={{ ...monoInputStyle, flex: 1, fontSize: 11 }}
          value={newCmd}
          onChange={e => setNewCmd(e.target.value)}
          placeholder="e.g. source ~/.nvm/nvm.sh"
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button
          className="tpm-btn"
          style={{ ...smallBtnStyle, color: newCmd.trim() ? 'var(--accent-green, #89e051)' : 'var(--text-muted)' }}
          onClick={handleAdd}
          disabled={!newCmd.trim()}
          title="Add command"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  )
}

// ─── Quick Launch Dropdown ────────────────────────────────────────────────────

function QuickLaunchDropdown({
  profiles,
  onLaunch,
  onClose,
}: {
  profiles: TerminalProfile[]
  onLaunch: (id: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const filtered = useMemo(() => {
    if (!filter.trim()) return profiles
    const q = filter.toLowerCase()
    return profiles.filter(p => p.name.toLowerCase().includes(q) || p.shellType.toLowerCase().includes(q))
  }, [profiles, filter])

  return (
    <div
      ref={ref}
      className="tpm-fade-in"
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: 4,
        width: 240,
        background: 'var(--bg-elevated, var(--bg-secondary))',
        border: '1px solid var(--border-color, var(--border))',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        zIndex: 1000,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '6px 6px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border-color, var(--border))' }}>
          <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            autoFocus
            style={{ ...inputStyle, border: 'none', padding: '4px 2px', background: 'transparent', fontSize: 11 }}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter profiles..."
          />
        </div>
      </div>
      <div className="tpm-scrollbar" style={{ maxHeight: 220, overflowY: 'auto' }}>
        {filtered.length === 0 && (
          <div style={{ padding: '12px 16px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            No matching profiles
          </div>
        )}
        {filtered.map(p => (
          <button
            key={p.id}
            className="tpm-dropdown-item"
            onClick={() => { onLaunch(p.id); onClose() }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 12px',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: 12,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <ShellIcon shellType={p.shellType} size={14} color={p.color} />
            <span style={{ flex: 1 }}>{p.name}</span>
            {p.isDefault && (
              <span style={{ fontSize: 9, color: 'var(--accent, #007acc)', fontWeight: 600, textTransform: 'uppercase' }}>Default</span>
            )}
            <Play size={11} style={{ color: 'var(--text-muted)' }} />
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Profile Editor Panel ─────────────────────────────────────────────────────

function ProfileEditorPanel({
  profile,
  onChange,
  onSetDefault,
  onDelete,
}: {
  profile: TerminalProfile
  onChange: (p: TerminalProfile) => void
  onSetDefault: () => void
  onDelete: () => void
}) {
  const [section, setSection] = useState<EditorSection>('general')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const update = useCallback(<K extends keyof TerminalProfile>(key: K, val: TerminalProfile[K]) => {
    onChange({ ...profile, [key]: val, updatedAt: Date.now() })
  }, [profile, onChange])

  const updateAppearance = useCallback(<K extends keyof ProfileAppearance>(key: K, val: ProfileAppearance[K]) => {
    onChange({ ...profile, appearance: { ...profile.appearance, [key]: val }, updatedAt: Date.now() })
  }, [profile, onChange])

  const updateIntegration = useCallback(<K extends keyof ShellIntegration>(key: K, val: ShellIntegration[K]) => {
    onChange({ ...profile, integration: { ...profile.integration, [key]: val }, updatedAt: Date.now() })
  }, [profile, onChange])

  const sections: { id: EditorSection; label: string; icon: React.ReactNode }[] = [
    { id: 'general',     label: 'General',     icon: <Settings size={12} /> },
    { id: 'appearance',  label: 'Appearance',  icon: <Eye size={12} /> },
    { id: 'environment', label: 'Environment', icon: <Hash size={12} /> },
    { id: 'startup',     label: 'Startup',     icon: <Zap size={12} /> },
    { id: 'integration', label: 'Integration', icon: <ShieldCheck size={12} /> },
  ]

  return (
    <div className="tpm-slide-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Profile Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border-color, var(--border))' }}>
        <ShellIcon shellType={profile.shellType} size={20} color={profile.color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{profile.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {profile.shellPath || 'No path configured'}
          </div>
        </div>
        <IntegrationBadge status={profile.integration.status} />
        {profile.isDefault && (
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent, #007acc)', textTransform: 'uppercase', padding: '2px 6px', background: 'var(--accent, #007acc)18', borderRadius: 4 }}>
            Default
          </span>
        )}
      </div>

      {/* Section Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color, var(--border))', padding: '0 12px' }}>
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '8px 10px',
              fontSize: 11,
              fontWeight: section === s.id ? 600 : 400,
              color: section === s.id ? 'var(--accent, #007acc)' : 'var(--text-muted)',
              background: 'transparent',
              border: 'none',
              borderBottom: section === s.id ? '2px solid var(--accent, #007acc)' : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {/* Section Content */}
      <div className="tpm-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {section === 'general' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Profile Name</label>
              <input style={inputStyle} value={profile.name} onChange={e => update('name', e.target.value)} placeholder="My Profile" />
            </div>
            <div>
              <label style={labelStyle}>Shell Path</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input style={{ ...monoInputStyle, flex: 1 }} value={profile.shellPath} onChange={e => update('shellPath', e.target.value)} placeholder="/bin/bash" />
                <button className="tpm-btn" style={pillBtnStyle} title="Browse">
                  <FolderOpen size={12} /> Browse
                </button>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Shell Arguments</label>
              <input
                style={monoInputStyle}
                value={profile.args.join(' ')}
                onChange={e => update('args', e.target.value.split(/\s+/).filter(Boolean))}
                placeholder="--login --norc"
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Space-separated shell arguments</div>
            </div>
            <div>
              <label style={labelStyle}>Working Directory</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input style={{ ...monoInputStyle, flex: 1 }} value={profile.cwd} onChange={e => update('cwd', e.target.value)} placeholder="Inherited from workspace" />
                <button className="tpm-btn" style={pillBtnStyle} title="Browse">
                  <FolderOpen size={12} />
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Icon Label</label>
                <input style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700 }} value={profile.icon} onChange={e => update('icon', e.target.value.slice(0, 3))} maxLength={3} />
              </div>
              <div>
                <label style={labelStyle}>Color</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {PROFILE_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => update('color', c)}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: c,
                        border: profile.color === c ? '2px solid var(--text-primary)' : '2px solid transparent',
                        cursor: 'pointer',
                        outline: profile.color === c ? '2px solid var(--bg-primary)' : 'none',
                        outlineOffset: -3,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Shell Type</label>
              <select
                style={selectStyle}
                value={profile.shellType}
                onChange={e => update('shellType', e.target.value)}
              >
                {Object.entries(SHELL_ICONS).map(([key, val]) => (
                  <option key={key} value={key}>{val.label} - {key}</option>
                ))}
              </select>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--border-color, var(--border))' }}>
              {!profile.isDefault && (
                <button className="tpm-btn" style={pillBtnStyle} onClick={onSetDefault}>
                  <Star size={12} /> Set as Default
                </button>
              )}
              {!profile.isBuiltIn && (
                confirmDelete ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--accent-red, #f85149)' }}>Delete profile?</span>
                    <button className="tpm-btn" style={{ ...pillBtnStyle, color: 'var(--accent-red, #f85149)', borderColor: 'var(--accent-red, #f85149)' }} onClick={onDelete}>
                      <Check size={11} /> Yes
                    </button>
                    <button className="tpm-btn" style={pillBtnStyle} onClick={() => setConfirmDelete(false)}>
                      <X size={11} /> No
                    </button>
                  </div>
                ) : (
                  <button className="tpm-btn" style={{ ...pillBtnStyle, color: 'var(--accent-red, #f85149)' }} onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={12} /> Delete
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {section === 'appearance' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Font Size</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="range"
                    min={8}
                    max={24}
                    step={1}
                    value={profile.appearance.fontSize}
                    onChange={e => updateAppearance('fontSize', Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--accent, #007acc)' }}
                  />
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)', minWidth: 28 }}>
                    {profile.appearance.fontSize}px
                  </span>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Line Height</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="range"
                    min={1.0}
                    max={2.5}
                    step={0.1}
                    value={profile.appearance.lineHeight}
                    onChange={e => updateAppearance('lineHeight', Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--accent, #007acc)' }}
                  />
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)', minWidth: 28 }}>
                    {profile.appearance.lineHeight.toFixed(1)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label style={labelStyle}>Font Family</label>
              <select
                style={selectStyle}
                value={profile.appearance.fontFamily}
                onChange={e => updateAppearance('fontFamily', e.target.value)}
              >
                {FONT_FAMILIES.map(f => (
                  <option key={f} value={f}>{f.split(',')[0].replace(/'/g, '')}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Cursor Style</label>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  {CURSOR_STYLES.map(cs => (
                    <button
                      key={cs.value}
                      onClick={() => updateAppearance('cursorStyle', cs.value)}
                      style={{
                        flex: 1,
                        padding: '5px 8px',
                        fontSize: 11,
                        fontWeight: profile.appearance.cursorStyle === cs.value ? 600 : 400,
                        color: profile.appearance.cursorStyle === cs.value ? 'var(--accent, #007acc)' : 'var(--text-muted)',
                        background: profile.appearance.cursorStyle === cs.value ? 'var(--accent, #007acc)18' : 'var(--bg-secondary)',
                        border: profile.appearance.cursorStyle === cs.value ? '1px solid var(--accent, #007acc)' : '1px solid var(--border-color, var(--border))',
                        borderRadius: 4,
                        cursor: 'pointer',
                        textAlign: 'center' as const,
                      }}
                    >
                      {cs.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ width: 100 }}>
                <label style={labelStyle}>Cursor Blink</label>
                <button
                  onClick={() => updateAppearance('cursorBlink', !profile.appearance.cursorBlink)}
                  style={{
                    ...pillBtnStyle,
                    width: '100%',
                    justifyContent: 'center',
                    marginTop: 4,
                    color: profile.appearance.cursorBlink ? 'var(--accent-green, #89e051)' : 'var(--text-muted)',
                    background: profile.appearance.cursorBlink ? 'var(--accent-green, #89e051)10' : 'var(--bg-secondary)',
                  }}
                >
                  {profile.appearance.cursorBlink ? 'On' : 'Off'}
                </button>
              </div>
            </div>

            <div>
              <label style={labelStyle}>Scrollback Lines</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={100}
                  max={10000}
                  step={100}
                  value={profile.appearance.scrollback}
                  onChange={e => updateAppearance('scrollback', Number(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--accent, #007acc)' }}
                />
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)', minWidth: 48, textAlign: 'right' }}>
                  {profile.appearance.scrollback.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Preview */}
            <div>
              <label style={labelStyle}>Preview</label>
              <div
                style={{
                  marginTop: 4,
                  padding: 12,
                  background: 'var(--bg-primary)',
                  borderRadius: 6,
                  border: '1px solid var(--border-color, var(--border))',
                  fontFamily: profile.appearance.fontFamily,
                  fontSize: profile.appearance.fontSize,
                  lineHeight: profile.appearance.lineHeight,
                  color: 'var(--text-primary)',
                }}
              >
                <div style={{ color: 'var(--accent-green, #89e051)' }}>user@host<span style={{ color: 'var(--text-muted)' }}>:</span><span style={{ color: 'var(--accent-blue, #58a6ff)' }}>~/project</span><span style={{ color: 'var(--text-muted)' }}>$</span> ls -la</div>
                <div style={{ color: 'var(--text-secondary)' }}>drwxr-xr-x  12 user user  4096 Mar 13 10:24 .</div>
                <div style={{ color: 'var(--text-secondary)' }}>-rw-r--r--   1 user user   245 Mar 13 09:15 package.json</div>
                <div>
                  <span style={{ color: 'var(--accent-green, #89e051)' }}>user@host</span>
                  <span style={{ color: 'var(--text-muted)' }}>:</span>
                  <span style={{ color: 'var(--accent-blue, #58a6ff)' }}>~/project</span>
                  <span style={{ color: 'var(--text-muted)' }}>$ </span>
                  <span
                    className={profile.appearance.cursorBlink ? 'tpm-pulse' : ''}
                    style={{
                      display: 'inline-block',
                      width: profile.appearance.cursorStyle === 'line' ? 2 : (profile.appearance.fontSize * 0.6),
                      height: profile.appearance.cursorStyle === 'underline' ? 2 : profile.appearance.fontSize,
                      background: 'var(--text-primary)',
                      verticalAlign: profile.appearance.cursorStyle === 'underline' ? 'bottom' : 'text-bottom',
                      opacity: 0.7,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {section === 'environment' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Environment Variables</label>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {profile.envVars.length} variable{profile.envVars.length !== 1 ? 's' : ''}
              </span>
            </div>
            <EnvVarEditor
              envVars={profile.envVars}
              onChange={envVars => update('envVars', envVars)}
            />
            <div style={{ marginTop: 8, padding: 8, borderRadius: 4, background: 'var(--accent-blue, #58a6ff)08', border: '1px solid var(--accent-blue, #58a6ff)20' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--accent-blue, #58a6ff)', fontWeight: 600, marginBottom: 2 }}>
                <Info size={10} /> Tip
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Environment variables set here are merged with the system environment. These override existing system variables with the same key.
              </div>
            </div>
          </div>
        )}

        {section === 'startup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={labelStyle}>Startup Commands</label>
            <StartupCommandsEditor
              commands={profile.startupCommands}
              onChange={cmds => update('startupCommands', cmds)}
            />
          </div>
        )}

        {section === 'integration' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Shell Integration</label>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Enables enhanced terminal features like command decorations and working directory detection.
                </div>
              </div>
              <IntegrationBadge status={profile.integration.status} />
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: 12,
                borderRadius: 6,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color, var(--border))',
              }}
            >
              {[
                { key: 'enabled' as const, label: 'Enable Shell Integration', desc: 'Inject shell integration script on startup' },
                { key: 'commandDecoration' as const, label: 'Command Decorations', desc: 'Show success/failure indicators next to commands' },
                { key: 'cwdDetection' as const, label: 'CWD Detection', desc: 'Automatically track the current working directory' },
              ].map(opt => (
                <div key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    onClick={() => updateIntegration(opt.key, !profile.integration[opt.key])}
                    style={{
                      width: 36,
                      height: 20,
                      borderRadius: 10,
                      border: 'none',
                      background: profile.integration[opt.key] ? 'var(--accent, #007acc)' : 'var(--bg-tertiary)',
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'background 0.2s',
                      flexShrink: 0,
                    }}
                  >
                    <span style={{
                      position: 'absolute',
                      top: 2,
                      left: profile.integration[opt.key] ? 18 : 2,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: '#fff',
                      transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                    }} />
                  </button>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{opt.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{opt.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {profile.integration.status === 'inactive' && (
              <div style={{ padding: 10, borderRadius: 4, background: 'var(--accent-orange, #f0a040)10', border: '1px solid var(--accent-orange, #f0a040)30' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent-orange, #f0a040)', fontWeight: 600 }}>
                  <AlertTriangle size={11} /> Shell integration is not active
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                  The shell may not support integration, or the integration script failed to load. Try restarting the terminal or checking your shell configuration.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Shell Detection Panel ────────────────────────────────────────────────────

function ShellDetectionPanel({
  detectedShells,
  profiles,
  onCreateFromShell,
  onRefresh,
}: {
  detectedShells: DetectedShell[]
  profiles: TerminalProfile[]
  onCreateFromShell: (shell: DetectedShell) => void
  onRefresh: () => void
}) {
  const [scanning, setScanning] = useState(false)

  const handleRefresh = useCallback(() => {
    setScanning(true)
    onRefresh()
    setTimeout(() => setScanning(false), 1200)
  }, [onRefresh])

  const existingPaths = useMemo(() => new Set(profiles.map(p => p.shellPath.toLowerCase())), [profiles])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Detected Shells</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Shells found on your system. Click to create a profile.
          </div>
        </div>
        <button className="tpm-btn" style={pillBtnStyle} onClick={handleRefresh}>
          <RefreshCw size={12} className={scanning ? 'tpm-pulse' : ''} />
          {scanning ? 'Scanning...' : 'Rescan'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {detectedShells.map((shell, i) => {
          const alreadyAdded = existingPaths.has(shell.path.toLowerCase())
          return (
            <div
              key={i}
              className="tpm-env-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                borderRadius: 6,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color, var(--border))',
                opacity: shell.available ? 1 : 0.5,
              }}
            >
              <ShellIcon shellType={shell.shellType} size={18} color={shell.color} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{shell.name}</span>
                  {shell.version && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>v{shell.version}</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {shell.path}
                </div>
              </div>

              <span style={{
                fontSize: 10,
                fontWeight: 500,
                padding: '2px 6px',
                borderRadius: 4,
                color: shell.available ? 'var(--accent-green, #89e051)' : 'var(--accent-red, #f85149)',
                background: shell.available ? 'var(--accent-green, #89e051)15' : 'var(--accent-red, #f85149)15',
              }}>
                {shell.available ? 'Available' : 'Not Found'}
              </span>

              {shell.available && (
                alreadyAdded ? (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>Added</span>
                ) : (
                  <button className="tpm-btn" style={pillBtnStyle} onClick={() => onCreateFromShell(shell)}>
                    <Plus size={11} /> Add
                  </button>
                )
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Import/Export Panel ──────────────────────────────────────────────────────

function ImportExportPanel({
  profiles,
  onImport,
}: {
  profiles: TerminalProfile[]
  onImport: (data: TerminalProfile[]) => void
}) {
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState(false)
  const [exported, setExported] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = useCallback(() => {
    const data = JSON.stringify(profiles, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `terminal-profiles-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setExported(true)
    setTimeout(() => setExported(false), 2000)
  }, [profiles])

  const handleCopyJson = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(profiles, null, 2))
    setExported(true)
    setTimeout(() => setExported(false), 2000)
  }, [profiles])

  const handleImportText = useCallback(() => {
    setImportError(null)
    setImportSuccess(false)
    try {
      const data = JSON.parse(importText)
      const arr = Array.isArray(data) ? data : [data]
      const valid = arr.filter(
        (p: unknown) => typeof p === 'object' && p !== null && 'name' in p && 'shellPath' in p
      ) as TerminalProfile[]
      if (valid.length === 0) {
        setImportError('No valid profiles found. Each profile needs at least "name" and "shellPath".')
        return
      }
      // Assign new IDs to avoid conflicts
      const imported = valid.map(p => ({
        ...p,
        id: nextProfileId(),
        isBuiltIn: false,
        isDefault: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        appearance: { ...DEFAULT_APPEARANCE, ...(p.appearance || {}) },
        integration: { ...DEFAULT_INTEGRATION, ...(p.integration || {}) },
        envVars: (p.envVars || []).map((e: EnvVar) => ({ ...e, id: nextEnvId() })),
        args: p.args || [],
        startupCommands: p.startupCommands || [],
      }))
      onImport(imported)
      setImportText('')
      setImportSuccess(true)
      setTimeout(() => setImportSuccess(false), 3000)
    } catch {
      setImportError('Invalid JSON. Please paste valid profile JSON data.')
    }
  }, [importText, onImport])

  const handleFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setImportText(reader.result as string)
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
      {/* Export */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Export Profiles</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          Export all {profiles.length} profile{profiles.length !== 1 ? 's' : ''} as JSON for backup or sharing.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="tpm-btn" style={accentBtnStyle} onClick={handleExport}>
            <Download size={12} /> {exported ? 'Downloaded!' : 'Download JSON'}
          </button>
          <button className="tpm-btn" style={pillBtnStyle} onClick={handleCopyJson}>
            <Copy size={12} /> {exported ? 'Copied!' : 'Copy to Clipboard'}
          </button>
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--border-color, var(--border))' }} />

      {/* Import */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Import Profiles</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          Paste profile JSON or load from a file. Imported profiles receive new IDs to avoid conflicts.
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileImport} style={{ display: 'none' }} />
          <button className="tpm-btn" style={pillBtnStyle} onClick={() => fileInputRef.current?.click()}>
            <Upload size={12} /> Load File
          </button>
        </div>

        <textarea
          style={{
            ...monoInputStyle,
            height: 160,
            resize: 'vertical',
            lineHeight: 1.5,
          }}
          value={importText}
          onChange={e => { setImportText(e.target.value); setImportError(null) }}
          placeholder={'[\n  {\n    "name": "My Shell",\n    "shellPath": "/bin/zsh",\n    "shellType": "zsh",\n    ...\n  }\n]'}
        />

        {importError && (
          <div style={{ marginTop: 6, padding: 8, borderRadius: 4, background: 'var(--accent-red, #f85149)10', border: '1px solid var(--accent-red, #f85149)30', fontSize: 11, color: 'var(--accent-red, #f85149)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle size={11} /> {importError}
          </div>
        )}
        {importSuccess && (
          <div style={{ marginTop: 6, padding: 8, borderRadius: 4, background: 'var(--accent-green, #89e051)10', border: '1px solid var(--accent-green, #89e051)30', fontSize: 11, color: 'var(--accent-green, #89e051)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Check size={11} /> Profiles imported successfully!
          </div>
        )}

        <button
          className="tpm-btn"
          style={{ ...accentBtnStyle, marginTop: 8, opacity: importText.trim() ? 1 : 0.5 }}
          onClick={handleImportText}
          disabled={!importText.trim()}
        >
          <Download size={12} /> Import
        </button>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Main Component
// ═════════════════════════════════════════════════════════════════════════════

function TerminalProfileManager({ open, onClose, onLaunchProfile, platform: platformProp }: Props) {
  const platform = platformProp || detectPlatform()

  const [profiles, setProfiles] = useState<TerminalProfile[]>(() => createDefaultProfiles(platform))
  const [selectedId, setSelectedId] = useState<string | null>(() => profiles[0]?.id ?? null)
  const [sidePanel, setSidePanel] = useState<SidePanel>('profiles')
  const [searchQuery, setSearchQuery] = useState('')
  const [showQuickLaunch, setShowQuickLaunch] = useState(false)
  const [detectedShells, setDetectedShells] = useState<DetectedShell[]>(() => createDetectedShells(platform))

  const overlayRef = useRef<HTMLDivElement>(null)
  const stylesInjected = useRef(false)

  // Inject styles
  useEffect(() => {
    if (stylesInjected.current) return
    stylesInjected.current = true
    const style = document.createElement('style')
    style.textContent = INJECTED_STYLES
    style.setAttribute('data-tpm-styles', '')
    document.head.appendChild(style)
    return () => { style.remove(); stylesInjected.current = false }
  }, [])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // Filtered profiles
  const filteredProfiles = useMemo(() => {
    if (!searchQuery.trim()) return profiles
    const q = searchQuery.toLowerCase()
    return profiles.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.shellType.toLowerCase().includes(q) ||
      p.shellPath.toLowerCase().includes(q)
    )
  }, [profiles, searchQuery])

  const selectedProfile = useMemo(() => profiles.find(p => p.id === selectedId) ?? null, [profiles, selectedId])

  // Handlers
  const handleProfileChange = useCallback((updated: TerminalProfile) => {
    setProfiles(prev => prev.map(p => p.id === updated.id ? updated : p))
  }, [])

  const handleSetDefault = useCallback(() => {
    if (!selectedId) return
    setProfiles(prev => prev.map(p => ({
      ...p,
      isDefault: p.id === selectedId,
    })))
  }, [selectedId])

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    setProfiles(prev => {
      const next = prev.filter(p => p.id !== selectedId)
      // If deleted was default, make first one default
      if (prev.find(p => p.id === selectedId)?.isDefault && next.length > 0) {
        next[0] = { ...next[0], isDefault: true }
      }
      return next
    })
    setSelectedId(profiles.find(p => p.id !== selectedId)?.id ?? null)
  }, [selectedId, profiles])

  const handleCreateNew = useCallback(() => {
    const newProfile: TerminalProfile = {
      id: nextProfileId(),
      name: 'New Profile',
      shellPath: platform === 'windows' ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/bash',
      shellType: platform === 'windows' ? 'cmd' : 'bash',
      args: [],
      icon: '>_',
      color: PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)],
      envVars: [],
      cwd: '',
      appearance: { ...DEFAULT_APPEARANCE },
      integration: { ...DEFAULT_INTEGRATION },
      startupCommands: [],
      isDefault: false,
      isBuiltIn: false,
      platform,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setProfiles(prev => [...prev, newProfile])
    setSelectedId(newProfile.id)
    setSidePanel('profiles')
  }, [platform])

  const handleCreateFromShell = useCallback((shell: DetectedShell) => {
    const newProfile: TerminalProfile = {
      id: nextProfileId(),
      name: shell.name,
      shellPath: shell.path,
      shellType: shell.shellType,
      args: [],
      icon: shell.icon,
      color: shell.color,
      envVars: [],
      cwd: '',
      appearance: { ...DEFAULT_APPEARANCE },
      integration: { ...DEFAULT_INTEGRATION },
      startupCommands: [],
      isDefault: false,
      isBuiltIn: false,
      platform,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setProfiles(prev => [...prev, newProfile])
    setSelectedId(newProfile.id)
    setSidePanel('profiles')
  }, [platform])

  const handleImport = useCallback((imported: TerminalProfile[]) => {
    setProfiles(prev => [...prev, ...imported])
    if (imported.length > 0) {
      setSelectedId(imported[0].id)
      setSidePanel('profiles')
    }
  }, [])

  const handleRefreshDetection = useCallback(() => {
    setDetectedShells(createDetectedShells(platform))
  }, [platform])

  const handleLaunch = useCallback((profileId: string) => {
    onLaunchProfile?.(profileId)
  }, [onLaunchProfile])

  const handleDuplicate = useCallback((profileId: string) => {
    const source = profiles.find(p => p.id === profileId)
    if (!source) return
    const dup: TerminalProfile = {
      ...source,
      id: nextProfileId(),
      name: `${source.name} (Copy)`,
      isDefault: false,
      isBuiltIn: false,
      envVars: source.envVars.map(e => ({ ...e, id: nextEnvId() })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setProfiles(prev => [...prev, dup])
    setSelectedId(dup.id)
  }, [profiles])

  if (!open) return null

  const sidePanelItems: { id: SidePanel; label: string; icon: React.ReactNode }[] = [
    { id: 'profiles',      label: 'Profiles',       icon: <Terminal size={14} /> },
    { id: 'detection',     label: 'Shell Detection', icon: <Cpu size={14} /> },
    { id: 'import-export', label: 'Import/Export',   icon: <Download size={14} /> },
  ]

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        className="tpm-fade-in"
        style={{
          width: 960,
          maxWidth: '92vw',
          height: 640,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-secondary, #1e1e1e)',
          border: '1px solid var(--border-color, var(--border))',
          borderRadius: 8,
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}
      >
        {/* Title Bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border-color, var(--border))',
          background: 'var(--bg-tertiary, #181818)',
        }}>
          <Terminal size={16} style={{ color: 'var(--accent, #007acc)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
            Terminal Profile Manager
          </span>

          {/* Quick Launch */}
          <div style={{ position: 'relative' }}>
            <button
              className="tpm-btn"
              style={accentBtnStyle}
              onClick={() => setShowQuickLaunch(!showQuickLaunch)}
            >
              <Play size={12} /> Launch
              <ChevronDown size={10} />
            </button>
            {showQuickLaunch && (
              <QuickLaunchDropdown
                profiles={profiles}
                onLaunch={handleLaunch}
                onClose={() => setShowQuickLaunch(false)}
              />
            )}
          </div>

          <button className="tpm-btn" style={smallBtnStyle} onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left Sidebar */}
          <div style={{
            width: 260,
            minWidth: 260,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid var(--border-color, var(--border))',
            background: 'var(--bg-tertiary, #181818)',
          }}>
            {/* Side panel tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color, var(--border))' }}>
              {sidePanelItems.map(sp => (
                <button
                  key={sp.id}
                  onClick={() => setSidePanel(sp.id)}
                  title={sp.label}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    padding: '8px 4px',
                    fontSize: 10,
                    fontWeight: sidePanel === sp.id ? 600 : 400,
                    color: sidePanel === sp.id ? 'var(--accent, #007acc)' : 'var(--text-muted)',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: sidePanel === sp.id ? '2px solid var(--accent, #007acc)' : '2px solid transparent',
                    cursor: 'pointer',
                    marginBottom: -1,
                  }}
                >
                  {sp.icon}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sp.label}</span>
                </button>
              ))}
            </div>

            {sidePanel === 'profiles' && (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                {/* Search + Add */}
                <div style={{ padding: '8px 8px 4px', display: 'flex', gap: 4 }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border-color, var(--border))' }}>
                    <Search size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input
                      style={{ ...inputStyle, border: 'none', padding: '4px 2px', background: 'transparent', fontSize: 11 }}
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search profiles..."
                    />
                    {searchQuery && (
                      <button className="tpm-btn" style={{ ...smallBtnStyle, width: 16, height: 16 }} onClick={() => setSearchQuery('')}>
                        <X size={10} />
                      </button>
                    )}
                  </div>
                  <button className="tpm-btn" style={{ ...smallBtnStyle, color: 'var(--accent, #007acc)' }} onClick={handleCreateNew} title="New profile">
                    <Plus size={14} />
                  </button>
                </div>

                {/* Profile list */}
                <div className="tpm-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 8px' }}>
                  {filteredProfiles.length === 0 && (
                    <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                      {searchQuery ? 'No matching profiles' : 'No profiles configured'}
                    </div>
                  )}
                  {filteredProfiles.map(p => (
                    <button
                      key={p.id}
                      className="tpm-profile-item"
                      onClick={() => { setSelectedId(p.id); setSidePanel('profiles') }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                        padding: '6px 8px',
                        marginBottom: 2,
                        background: selectedId === p.id ? 'var(--bg-active, var(--bg-hover))' : 'transparent',
                        border: selectedId === p.id ? '1px solid var(--border-active, var(--accent, #007acc))40' : '1px solid transparent',
                        borderRadius: 5,
                        cursor: 'pointer',
                        textAlign: 'left',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <ShellIcon shellType={p.shellType} size={16} color={p.color} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.shellType}
                          {p.envVars.length > 0 && ` \u00b7 ${p.envVars.length} env`}
                          {p.startupCommands.length > 0 && ` \u00b7 ${p.startupCommands.length} cmd`}
                        </div>
                      </div>
                      {p.isDefault && (
                        <Star size={11} style={{ color: 'var(--accent, #007acc)', flexShrink: 0 }} fill="var(--accent, #007acc)" />
                      )}
                      <button
                        className="tpm-btn"
                        style={{ ...smallBtnStyle, width: 20, height: 20 }}
                        onClick={e => { e.stopPropagation(); handleDuplicate(p.id) }}
                        title="Duplicate"
                      >
                        <Copy size={10} />
                      </button>
                    </button>
                  ))}
                </div>

                {/* Summary */}
                <div style={{
                  padding: '6px 12px',
                  borderTop: '1px solid var(--border-color, var(--border))',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}>
                  <span>{profiles.length} profile{profiles.length !== 1 ? 's' : ''}</span>
                  <span>Default: {profiles.find(p => p.isDefault)?.name || 'None'}</span>
                </div>
              </div>
            )}

            {sidePanel === 'detection' && (
              <div className="tpm-scrollbar" style={{ flex: 1, overflowY: 'auto' }}>
                <ShellDetectionPanel
                  detectedShells={detectedShells}
                  profiles={profiles}
                  onCreateFromShell={handleCreateFromShell}
                  onRefresh={handleRefreshDetection}
                />
              </div>
            )}

            {sidePanel === 'import-export' && (
              <div className="tpm-scrollbar" style={{ flex: 1, overflowY: 'auto' }}>
                <ImportExportPanel profiles={profiles} onImport={handleImport} />
              </div>
            )}
          </div>

          {/* Right: Profile Editor */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {selectedProfile ? (
              <ProfileEditorPanel
                key={selectedProfile.id}
                profile={selectedProfile}
                onChange={handleProfileChange}
                onSetDefault={handleSetDefault}
                onDelete={handleDelete}
              />
            ) : (
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                color: 'var(--text-muted)',
              }}>
                <Terminal size={40} style={{ opacity: 0.3 }} />
                <div style={{ fontSize: 13, fontWeight: 500 }}>No profile selected</div>
                <div style={{ fontSize: 11 }}>Select a profile from the list or create a new one</div>
                <button className="tpm-btn" style={accentBtnStyle} onClick={handleCreateNew}>
                  <Plus size={12} /> Create Profile
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TerminalProfileManager
