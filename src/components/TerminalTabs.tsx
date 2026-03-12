import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Plus, X, ChevronDown, Terminal, Split, MoreHorizontal, Trash2, Maximize2, Minimize2, Lock, Unlock, Search, Play, RotateCcw, Edit3, ArrowRight, ArrowDown, Columns, Rows, Copy, ExternalLink, Filter, Bell, BellOff, CircleDot, Square, Hash, Code } from 'lucide-react'

// ─── Injected Styles ────────────────────────────────────────────────────────

const INJECTED_STYLES = `
.terminal-tabs-scroll::-webkit-scrollbar { display: none; }

@keyframes terminal-tab-slide-in {
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
}

.terminal-tab-enter {
  animation: terminal-tab-slide-in 0.2s ease-out;
}

@keyframes terminal-badge-pulse {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.2); }
  100% { transform: scale(1); }
}

.terminal-badge-pulse {
  animation: terminal-badge-pulse 0.4s ease-in-out;
}

@keyframes terminal-drop-indicator {
  0%   { opacity: 0.4; }
  50%  { opacity: 1; }
  100% { opacity: 0.4; }
}

.terminal-drop-indicator {
  animation: terminal-drop-indicator 1s ease-in-out infinite;
}

.terminal-context-menu-item:hover {
  background: rgba(255, 255, 255, 0.08) !important;
}
`

// ─── Types ──────────────────────────────────────────────────────────────────

interface TerminalTabInfo {
  id: string
  title: string
  shellType: string
  isActive: boolean
  isTask: boolean
  pid?: number
  cwd?: string
  unreadCount?: number
  processName?: string
  splitDirection?: 'horizontal' | 'vertical' | null
  isLocked?: boolean
}

interface TerminalProfile {
  id: string
  name: string
  shellType: string
  icon: string
  command?: string
  args?: string[]
  color?: string
}

interface Props {
  terminals?: TerminalTabInfo[]
  activeTerminalId?: string
  onActivate?: (id: string) => void
  onClose?: (id: string) => void
  onAdd?: (profileId?: string) => void
  onRename?: (id: string, newTitle: string) => void
  onSplit?: (id: string, direction: 'horizontal' | 'vertical') => void
  onReorder?: (fromIndex: number, toIndex: number) => void
  onClear?: (id: string) => void
  onMaximize?: () => void
  onKillAll?: () => void
  isMaximized?: boolean
  profiles?: TerminalProfile[]
}

// ─── Shell Icons ────────────────────────────────────────────────────────────

const SHELL_ICONS: Record<string, { label: string; color: string }> = {
  bash:       { label: '$_', color: '#89e051' },
  zsh:        { label: 'Z',  color: '#4ec9b0' },
  fish:       { label: '>_', color: '#d2a8ff' },
  powershell: { label: 'PS', color: '#2d7dd2' },
  pwsh:       { label: 'PS', color: '#2d7dd2' },
  cmd:        { label: '>',  color: '#cccccc' },
  python:     { label: 'Py', color: '#3572a5' },
  node:       { label: 'N',  color: '#68a063' },
  sh:         { label: '$',  color: '#89e051' },
  wsl:        { label: 'W',  color: '#e95420' },
}

const DEFAULT_PROFILES: TerminalProfile[] = [
  { id: 'bash',       name: 'Bash',       shellType: 'bash',       icon: '$_', color: '#89e051' },
  { id: 'powershell', name: 'PowerShell', shellType: 'powershell', icon: 'PS', color: '#2d7dd2' },
  { id: 'cmd',        name: 'Command Prompt', shellType: 'cmd',    icon: '>',  color: '#cccccc' },
  { id: 'zsh',        name: 'Zsh',        shellType: 'zsh',        icon: 'Z',  color: '#4ec9b0' },
  { id: 'python',     name: 'Python',     shellType: 'python',     icon: 'Py', color: '#3572a5' },
  { id: 'node',       name: 'Node.js',    shellType: 'node',       icon: 'N',  color: '#68a063' },
]

const DEFAULT_TERMINALS: TerminalTabInfo[] = [
  { id: '1', title: 'bash', shellType: 'bash', isActive: true, isTask: false, pid: 12345, cwd: '/home/user/project' },
]

// ─── Shell Icon Component ───────────────────────────────────────────────────

function ShellIcon({ shellType, size = 14 }: { shellType: string; size?: number }) {
  const info = SHELL_ICONS[shellType.toLowerCase()] || { label: '>_', color: '#8b949e' }
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
        color: info.color,
        borderRadius: 3,
        background: `${info.color}18`,
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      {info.label}
    </span>
  )
}

// ─── Context Menu ───────────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number
  y: number
  terminalId: string
  terminalTitle: string
  isLocked?: boolean
  onClose: () => void
  onRename: () => void
  onSplitH: () => void
  onSplitV: () => void
  onKill: () => void
  onClear: () => void
  onMoveToEditor: () => void
  onChangeProfile: (profileId: string) => void
  onToggleLock: () => void
  onCopyPath: () => void
  profiles: TerminalProfile[]
}

function TerminalContextMenu({
  x, y, terminalId, terminalTitle, isLocked, onClose, onRename, onSplitH, onSplitV,
  onKill, onClear, onMoveToEditor, onChangeProfile, onToggleLock, onCopyPath, profiles,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [showProfileSub, setShowProfileSub] = useState(false)
  const [menuPos, setMenuPos] = useState({ x, y })

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      let nx = x, ny = y
      if (rect.right > window.innerWidth - 8) nx = window.innerWidth - rect.width - 8
      if (rect.bottom > window.innerHeight - 8) ny = window.innerHeight - rect.height - 8
      if (nx !== x || ny !== y) setMenuPos({ x: Math.max(4, nx), y: Math.max(4, ny) })
    }
  }, [x, y])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 12px',
    fontSize: 12,
    color: '#cccccc',
    cursor: 'pointer',
    borderRadius: 3,
    whiteSpace: 'nowrap',
    position: 'relative',
  }

  const separatorStyle: React.CSSProperties = {
    height: 1,
    background: 'rgba(255,255,255,0.08)',
    margin: '4px 8px',
  }

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: menuPos.x,
        top: menuPos.y,
        zIndex: 10100,
        background: '#1e1e1e',
        border: '1px solid #454545',
        borderRadius: 6,
        padding: '4px 0',
        minWidth: 200,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      }}
    >
      <div className="terminal-context-menu-item" style={itemStyle} onClick={onRename}>
        <Edit3 size={14} style={{ opacity: 0.7 }} />
        Rename...
      </div>
      <div style={separatorStyle} />
      <div className="terminal-context-menu-item" style={itemStyle} onClick={onSplitH}>
        <Columns size={14} style={{ opacity: 0.7 }} />
        Split Right
      </div>
      <div className="terminal-context-menu-item" style={itemStyle} onClick={onSplitV}>
        <Rows size={14} style={{ opacity: 0.7 }} />
        Split Down
      </div>
      <div style={separatorStyle} />
      <div
        className="terminal-context-menu-item"
        style={{ ...itemStyle, position: 'relative' }}
        onMouseEnter={() => setShowProfileSub(true)}
        onMouseLeave={() => setShowProfileSub(false)}
      >
        <Terminal size={14} style={{ opacity: 0.7 }} />
        Change Profile
        <ChevronDown size={12} style={{ marginLeft: 'auto', opacity: 0.5, transform: 'rotate(-90deg)' }} />
        {showProfileSub && (
          <div
            style={{
              position: 'absolute',
              left: '100%',
              top: 0,
              marginLeft: 2,
              background: '#1e1e1e',
              border: '1px solid #454545',
              borderRadius: 6,
              padding: '4px 0',
              minWidth: 170,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
          >
            {profiles.map(p => (
              <div
                key={p.id}
                className="terminal-context-menu-item"
                style={itemStyle}
                onClick={() => { onChangeProfile(p.id); onClose() }}
              >
                <ShellIcon shellType={p.shellType} size={14} />
                {p.name}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={separatorStyle} />
      <div className="terminal-context-menu-item" style={itemStyle} onClick={onMoveToEditor}>
        <ExternalLink size={14} style={{ opacity: 0.7 }} />
        Move to Editor Area
      </div>
      <div className="terminal-context-menu-item" style={itemStyle} onClick={onCopyPath}>
        <Copy size={14} style={{ opacity: 0.7 }} />
        Copy Working Directory
      </div>
      <div className="terminal-context-menu-item" style={itemStyle} onClick={onToggleLock}>
        {isLocked
          ? <><Unlock size={14} style={{ opacity: 0.7 }} />Unlock Scroll</>
          : <><Lock size={14} style={{ opacity: 0.7 }} />Lock Scroll</>
        }
      </div>
      <div className="terminal-context-menu-item" style={itemStyle} onClick={onClear}>
        <RotateCcw size={14} style={{ opacity: 0.7 }} />
        Clear Terminal
      </div>
      <div style={separatorStyle} />
      <div
        className="terminal-context-menu-item"
        style={{ ...itemStyle, color: '#f85149' }}
        onClick={onKill}
      >
        <Trash2 size={14} style={{ opacity: 0.7 }} />
        Kill Terminal
      </div>
    </div>
  )
}

// ─── Rename Input Overlay ───────────────────────────────────────────────────

function RenameInput({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [])

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          const trimmed = value.trim()
          onSubmit(trimmed || initialValue)
        }
        if (e.key === 'Escape') onCancel()
        e.stopPropagation()
      }}
      onBlur={() => {
        const trimmed = value.trim()
        onSubmit(trimmed || initialValue)
      }}
      style={{
        background: '#1b1b1b',
        border: '1px solid #007acc',
        borderRadius: 3,
        color: '#cccccc',
        fontSize: 12,
        padding: '1px 4px',
        width: 90,
        outline: 'none',
        fontFamily: 'inherit',
      }}
    />
  )
}

// ─── Profile Dropdown ───────────────────────────────────────────────────────

function ProfileDropdown({
  profiles,
  onSelect,
  onClose,
  anchorRect,
}: {
  profiles: TerminalProfile[]
  onSelect: (profileId: string) => void
  onClose: () => void
  anchorRect: DOMRect
}) {
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const dropLeft = Math.min(anchorRect.left, window.innerWidth - 200)
  const dropTop = anchorRect.bottom + 4

  return (
    <div
      ref={dropRef}
      style={{
        position: 'fixed',
        left: dropLeft,
        top: dropTop,
        zIndex: 10100,
        background: '#1e1e1e',
        border: '1px solid #454545',
        borderRadius: 6,
        padding: '4px 0',
        minWidth: 190,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ padding: '4px 10px 6px', fontSize: 11, color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Launch Profile
      </div>
      {profiles.map(p => (
        <div
          key={p.id}
          className="terminal-context-menu-item"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 12px',
            fontSize: 12,
            color: '#cccccc',
            cursor: 'pointer',
            borderRadius: 3,
          }}
          onClick={() => { onSelect(p.id); onClose() }}
        >
          <ShellIcon shellType={p.shellType} size={14} />
          <span>{p.name}</span>
          {p.command && (
            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6e7681', fontFamily: 'monospace' }}>
              {p.command}
            </span>
          )}
        </div>
      ))}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 8px' }} />
      <div
        className="terminal-context-menu-item"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 12px',
          fontSize: 12,
          color: '#8b949e',
          cursor: 'pointer',
          borderRadius: 3,
        }}
        onClick={() => { onSelect('default'); onClose() }}
      >
        <Terminal size={14} style={{ opacity: 0.5 }} />
        <span>Default Profile</span>
      </div>
    </div>
  )
}

// ─── Filter Bar ─────────────────────────────────────────────────────────────

function TerminalFilterBar({
  value,
  onChange,
  onClose,
}: {
  value: string
  onChange: (v: string) => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 8px',
        background: '#1a1a1a',
        borderBottom: '1px solid #2d2d2d',
      }}
    >
      <Search size={12} style={{ color: '#6e7681', flexShrink: 0 }} />
      <input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Filter terminals..."
        onKeyDown={e => {
          if (e.key === 'Escape') { onChange(''); onClose() }
          e.stopPropagation()
        }}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: '#cccccc',
          fontSize: 11,
          fontFamily: 'inherit',
        }}
      />
      {value && (
        <button
          onClick={() => { onChange(''); onClose() }}
          style={{
            background: 'none',
            border: 'none',
            color: '#6e7681',
            cursor: 'pointer',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

// ─── Single Tab ─────────────────────────────────────────────────────────────

interface TabProps {
  terminal: TerminalTabInfo
  isActive: boolean
  isRenaming: boolean
  onActivate: () => void
  onClose: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onStartRename: () => void
  onFinishRename: (newTitle: string) => void
  onCancelRename: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragEnd: () => void
  onDrop: (e: React.DragEvent) => void
  isDragOver: boolean
  dragSide: 'left' | 'right' | null
}

function TerminalTab({
  terminal, isActive, isRenaming, onActivate, onClose, onContextMenu,
  onStartRename, onFinishRename, onCancelRename,
  onDragStart, onDragOver, onDragEnd, onDrop,
  isDragOver, dragSide,
}: TabProps) {
  const [isHovered, setIsHovered] = useState(false)
  const tabRef = useRef<HTMLDivElement>(null)

  const displayTitle = terminal.processName
    ? `${terminal.title} (${terminal.processName})`
    : terminal.title

  return (
    <div
      ref={tabRef}
      className="terminal-tab-enter"
      draggable={!isRenaming}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onActivate}
      onDoubleClick={onStartRename}
      onContextMenu={onContextMenu}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '0 8px',
        height: 32,
        cursor: 'pointer',
        fontSize: 12,
        color: isActive ? '#ffffff' : '#969696',
        background: isActive ? '#1e1e1e' : 'transparent',
        borderBottom: isActive ? '1px solid #007acc' : '1px solid transparent',
        transition: 'all 0.15s ease',
        flexShrink: 0,
        userSelect: 'none',
        ...(isHovered && !isActive ? { background: 'rgba(255,255,255,0.04)' } : {}),
      }}
    >
      {/* Drop indicator left */}
      {isDragOver && dragSide === 'left' && (
        <div
          className="terminal-drop-indicator"
          style={{
            position: 'absolute',
            left: 0,
            top: 4,
            bottom: 4,
            width: 2,
            background: '#007acc',
            borderRadius: 1,
          }}
        />
      )}

      {/* Drop indicator right */}
      {isDragOver && dragSide === 'right' && (
        <div
          className="terminal-drop-indicator"
          style={{
            position: 'absolute',
            right: 0,
            top: 4,
            bottom: 4,
            width: 2,
            background: '#007acc',
            borderRadius: 1,
          }}
        />
      )}

      {/* Task indicator */}
      {terminal.isTask && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 14,
            height: 14,
            borderRadius: 2,
            background: 'rgba(220, 160, 50, 0.2)',
            color: '#dca032',
            fontSize: 8,
            fontWeight: 800,
            flexShrink: 0,
          }}
          title="Task terminal"
        >
          T
        </span>
      )}

      {/* Shell icon */}
      {!terminal.isTask && <ShellIcon shellType={terminal.shellType} size={14} />}

      {/* Split indicator */}
      {terminal.splitDirection && (
        <span style={{ color: '#007acc', display: 'flex', alignItems: 'center' }}>
          {terminal.splitDirection === 'horizontal'
            ? <Columns size={10} />
            : <Rows size={10} />
          }
        </span>
      )}

      {/* Lock indicator */}
      {terminal.isLocked && (
        <Lock size={10} style={{ color: '#6e7681', flexShrink: 0 }} />
      )}

      {/* Title */}
      {isRenaming ? (
        <RenameInput
          initialValue={terminal.title}
          onSubmit={onFinishRename}
          onCancel={onCancelRename}
        />
      ) : (
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 120,
          }}
          title={`${displayTitle}${terminal.cwd ? ` - ${terminal.cwd}` : ''}${terminal.pid ? ` (PID: ${terminal.pid})` : ''}`}
        >
          {displayTitle}
        </span>
      )}

      {/* Unread badge */}
      {!isActive && terminal.unreadCount && terminal.unreadCount > 0 ? (
        <span
          className="terminal-badge-pulse"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            background: '#007acc',
            color: '#ffffff',
            fontSize: 9,
            fontWeight: 700,
            padding: '0 4px',
            flexShrink: 0,
          }}
        >
          {terminal.unreadCount > 99 ? '99+' : terminal.unreadCount}
        </span>
      ) : null}

      {/* Close button */}
      {(isHovered || isActive) && !isRenaming && (
        <button
          onClick={e => { e.stopPropagation(); onClose() }}
          title="Kill Terminal"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            padding: 0,
            background: 'transparent',
            border: 'none',
            color: '#969696',
            cursor: 'pointer',
            borderRadius: 3,
            flexShrink: 0,
            transition: 'all 0.1s ease',
          }}
          onMouseEnter={e => {
            ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)'
            ;(e.currentTarget as HTMLElement).style.color = '#ffffff'
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLElement).style.background = 'transparent'
            ;(e.currentTarget as HTMLElement).style.color = '#969696'
          }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

export default function TerminalTabs({
  terminals: externalTerminals,
  activeTerminalId: externalActiveId,
  onActivate,
  onClose,
  onAdd,
  onRename,
  onSplit,
  onReorder,
  onClear,
  onMaximize,
  onKillAll,
  isMaximized = false,
  profiles: externalProfiles,
}: Props) {
  // ── Style injection ─────────────────────────────────────────────────────
  useEffect(() => {
    const id = 'orion-terminal-tabs-styles'
    if (!document.getElementById(id)) {
      const style = document.createElement('style')
      style.id = id
      style.textContent = INJECTED_STYLES
      document.head.appendChild(style)
    }
  }, [])

  // ── Internal state for standalone usage ─────────────────────────────────
  const [internalTerminals, setInternalTerminals] = useState<TerminalTabInfo[]>(DEFAULT_TERMINALS)
  const [internalActiveId, setInternalActiveId] = useState<string>('1')

  const terminals = externalTerminals ?? internalTerminals
  const activeId = externalActiveId ?? internalActiveId
  const profiles = externalProfiles ?? DEFAULT_PROFILES

  const nextIdRef = useRef(2)

  // ── UI State ────────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; terminalId: string } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [showProfileDropdown, setShowProfileDropdown] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [dragState, setDragState] = useState<{
    dragIndex: number | null
    overIndex: number | null
    overSide: 'left' | 'right' | null
  }>({ dragIndex: null, overIndex: null, overSide: null })
  const [lockedTerminals, setLockedTerminals] = useState<Set<string>>(new Set())

  const addBtnRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // ── Filtered terminals ──────────────────────────────────────────────────
  const filteredTerminals = useMemo(() => {
    if (!filterText.trim()) return terminals
    const q = filterText.toLowerCase()
    return terminals.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.shellType.toLowerCase().includes(q) ||
      (t.processName && t.processName.toLowerCase().includes(q)) ||
      (t.cwd && t.cwd.toLowerCase().includes(q))
    )
  }, [terminals, filterText])

  // ── Terminal stats ──────────────────────────────────────────────────────
  const terminalStats = useMemo(() => {
    const taskCount = terminals.filter(t => t.isTask).length
    const totalUnread = terminals.reduce((sum, t) => sum + (t.unreadCount ?? 0), 0)
    return { total: terminals.length, taskCount, totalUnread }
  }, [terminals])

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleActivate = useCallback((id: string) => {
    if (onActivate) {
      onActivate(id)
    } else {
      setInternalActiveId(id)
    }
  }, [onActivate])

  const handleClose = useCallback((id: string) => {
    if (onClose) {
      onClose(id)
    } else {
      setInternalTerminals(prev => {
        const idx = prev.findIndex(t => t.id === id)
        const next = prev.filter(t => t.id !== id)
        if (id === activeId && next.length > 0) {
          const newActiveIdx = Math.min(idx, next.length - 1)
          setInternalActiveId(next[newActiveIdx].id)
        }
        return next
      })
    }
  }, [onClose, activeId])

  const handleAdd = useCallback((profileId?: string) => {
    if (onAdd) {
      onAdd(profileId)
    } else {
      const profile = profiles.find(p => p.id === profileId) ?? profiles[0]
      const newId = String(nextIdRef.current++)
      const newTerminal: TerminalTabInfo = {
        id: newId,
        title: profile.name.toLowerCase(),
        shellType: profile.shellType,
        isActive: false,
        isTask: false,
        pid: 10000 + nextIdRef.current,
        cwd: '/home/user/project',
      }
      setInternalTerminals(prev => [...prev, newTerminal])
      setInternalActiveId(newId)
    }
  }, [onAdd, profiles])

  const handleRename = useCallback((id: string, newTitle: string) => {
    if (onRename) {
      onRename(id, newTitle)
    } else {
      setInternalTerminals(prev =>
        prev.map(t => t.id === id ? { ...t, title: newTitle } : t)
      )
    }
    setRenamingId(null)
  }, [onRename])

  const handleSplit = useCallback((id: string, direction: 'horizontal' | 'vertical') => {
    if (onSplit) {
      onSplit(id, direction)
    } else {
      setInternalTerminals(prev =>
        prev.map(t => t.id === id ? { ...t, splitDirection: direction } : t)
      )
      // Also add a new terminal for the split
      const source = terminals.find(t => t.id === id)
      if (source) {
        const newId = String(nextIdRef.current++)
        const splitTerminal: TerminalTabInfo = {
          id: newId,
          title: source.shellType,
          shellType: source.shellType,
          isActive: false,
          isTask: false,
          pid: 10000 + nextIdRef.current,
          cwd: source.cwd,
          splitDirection: direction,
        }
        setInternalTerminals(prev => {
          const idx = prev.findIndex(t => t.id === id)
          const next = [...prev]
          next.splice(idx + 1, 0, splitTerminal)
          return next
        })
      }
    }
    setContextMenu(null)
  }, [onSplit, terminals])

  const handleClear = useCallback((id: string) => {
    if (onClear) onClear(id)
    setContextMenu(null)
  }, [onClear])

  const handleToggleLock = useCallback((id: string) => {
    setLockedTerminals(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setContextMenu(null)
  }, [])

  const handleKillAll = useCallback(() => {
    if (onKillAll) {
      onKillAll()
    } else {
      setInternalTerminals([])
      setInternalActiveId('')
    }
  }, [onKillAll])

  // ── Drag and Drop ──────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    setDragState(prev => ({ ...prev, dragIndex: index }))
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    const side: 'left' | 'right' = e.clientX < midX ? 'left' : 'right'
    setDragState(prev => ({ ...prev, overIndex: index, overSide: side }))
  }, [])

  const handleDragEnd = useCallback(() => {
    setDragState({ dragIndex: null, overIndex: null, overSide: null })
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault()
    const fromIndex = dragState.dragIndex
    if (fromIndex === null || fromIndex === toIndex) {
      handleDragEnd()
      return
    }

    if (onReorder) {
      onReorder(fromIndex, toIndex)
    } else {
      setInternalTerminals(prev => {
        const next = [...prev]
        const [moved] = next.splice(fromIndex, 1)
        const insertIdx = dragState.overSide === 'right' ? toIndex : Math.max(0, toIndex)
        next.splice(fromIndex < toIndex ? insertIdx : insertIdx, 0, moved)
        return next
      })
    }
    handleDragEnd()
  }, [dragState, onReorder, handleDragEnd])

  // ── Context menu actions ───────────────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent, terminalId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, terminalId })
  }, [])

  const handleCopyPath = useCallback((id: string) => {
    const terminal = terminals.find(t => t.id === id)
    if (terminal?.cwd) {
      navigator.clipboard?.writeText(terminal.cwd).catch(() => {})
    }
    setContextMenu(null)
  }, [terminals])

  // ── Scroll active tab into view ────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current && activeId) {
      const container = scrollRef.current
      const activeTab = container.querySelector(`[data-terminal-id="${activeId}"]`)
      if (activeTab) {
        activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
      }
    }
  }, [activeId])

  // ── Keyboard shortcut for filter ───────────────────────────────────────
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F' && terminals.length > 3) {
        // Only auto-show filter for many terminals
        setShowFilter(true)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [terminals.length])

  // ── Context menu target ────────────────────────────────────────────────
  const contextTerminal = contextMenu
    ? terminals.find(t => t.id === contextMenu.terminalId)
    : null

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: '#181818',
        borderBottom: '1px solid #2d2d2d',
        width: '100%',
        userSelect: 'none',
      }}
    >
      {/* Filter bar (conditional) */}
      {showFilter && (
        <TerminalFilterBar
          value={filterText}
          onChange={setFilterText}
          onClose={() => setShowFilter(false)}
        />
      )}

      {/* Main tab bar row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 34,
          minHeight: 34,
        }}
      >
        {/* Terminal label */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '0 8px',
            fontSize: 11,
            color: '#8b949e',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            fontWeight: 600,
            flexShrink: 0,
            borderRight: '1px solid #2d2d2d',
            height: '100%',
          }}
        >
          <Terminal size={13} style={{ opacity: 0.6 }} />
          <span>Terminal</span>
          {terminalStats.total > 0 && (
            <span
              style={{
                fontSize: 10,
                color: '#6e7681',
                fontWeight: 400,
              }}
            >
              ({terminalStats.total})
            </span>
          )}
          {terminalStats.totalUnread > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 14,
                height: 14,
                borderRadius: 7,
                background: '#007acc',
                color: '#fff',
                fontSize: 9,
                fontWeight: 700,
                padding: '0 3px',
              }}
            >
              {terminalStats.totalUnread}
            </span>
          )}
        </div>

        {/* Scrollable tab area */}
        <div
          ref={scrollRef}
          className="terminal-tabs-scroll"
          style={{
            display: 'flex',
            alignItems: 'center',
            flex: 1,
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollBehavior: 'smooth',
          }}
        >
          {filteredTerminals.map((terminal, index) => {
            const originalIndex = terminals.indexOf(terminal)
            return (
              <div key={terminal.id} data-terminal-id={terminal.id}>
                <TerminalTab
                  terminal={{ ...terminal, isLocked: lockedTerminals.has(terminal.id) }}
                  isActive={terminal.id === activeId}
                  isRenaming={renamingId === terminal.id}
                  onActivate={() => handleActivate(terminal.id)}
                  onClose={() => handleClose(terminal.id)}
                  onContextMenu={e => handleContextMenu(e, terminal.id)}
                  onStartRename={() => setRenamingId(terminal.id)}
                  onFinishRename={newTitle => handleRename(terminal.id, newTitle)}
                  onCancelRename={() => setRenamingId(null)}
                  onDragStart={e => handleDragStart(e, originalIndex)}
                  onDragOver={e => handleDragOver(e, originalIndex)}
                  onDragEnd={handleDragEnd}
                  onDrop={e => handleDrop(e, originalIndex)}
                  isDragOver={dragState.overIndex === originalIndex && dragState.dragIndex !== originalIndex}
                  dragSide={dragState.overIndex === originalIndex ? dragState.overSide : null}
                />
              </div>
            )
          })}

          {/* Empty state */}
          {terminals.length === 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 12px',
                fontSize: 12,
                color: '#6e7681',
                fontStyle: 'italic',
              }}
            >
              No terminals open
            </div>
          )}

          {/* Filter no results */}
          {terminals.length > 0 && filteredTerminals.length === 0 && filterText && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 12px',
                fontSize: 12,
                color: '#6e7681',
                fontStyle: 'italic',
              }}
            >
              No matching terminals
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: '0 4px',
            flexShrink: 0,
            borderLeft: '1px solid #2d2d2d',
            height: '100%',
          }}
        >
          {/* Add terminal */}
          <button
            ref={addBtnRef}
            onClick={() => handleAdd()}
            title="New Terminal (Ctrl+Shift+`)"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              padding: 0,
              background: 'transparent',
              border: 'none',
              color: '#8b949e',
              cursor: 'pointer',
              borderRadius: 4,
              transition: 'all 0.1s ease',
            }}
            onMouseEnter={e => {
              ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'
              ;(e.currentTarget as HTMLElement).style.color = '#cccccc'
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = '#8b949e'
            }}
          >
            <Plus size={14} />
          </button>

          {/* Add terminal dropdown */}
          <button
            onClick={() => {
              setShowProfileDropdown(prev => !prev)
            }}
            title="Launch Profile..."
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 26,
              padding: 0,
              background: 'transparent',
              border: 'none',
              color: '#8b949e',
              cursor: 'pointer',
              borderRadius: 4,
              transition: 'all 0.1s ease',
            }}
            onMouseEnter={e => {
              ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'
              ;(e.currentTarget as HTMLElement).style.color = '#cccccc'
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = '#8b949e'
            }}
          >
            <ChevronDown size={12} />
          </button>

          {/* Divider */}
          <div style={{ width: 1, height: 16, background: '#2d2d2d', margin: '0 2px' }} />

          {/* Split terminal */}
          <button
            onClick={() => {
              if (activeId) handleSplit(activeId, 'horizontal')
            }}
            title="Split Terminal (Ctrl+Shift+5)"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              padding: 0,
              background: 'transparent',
              border: 'none',
              color: '#8b949e',
              cursor: activeId ? 'pointer' : 'default',
              borderRadius: 4,
              transition: 'all 0.1s ease',
              opacity: activeId ? 1 : 0.4,
            }}
            onMouseEnter={e => {
              if (activeId) {
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'
                ;(e.currentTarget as HTMLElement).style.color = '#cccccc'
              }
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = '#8b949e'
            }}
          >
            <Split size={14} />
          </button>

          {/* Filter */}
          <button
            onClick={() => setShowFilter(prev => !prev)}
            title="Filter Terminals"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              padding: 0,
              background: showFilter ? 'rgba(255,255,255,0.08)' : 'transparent',
              border: 'none',
              color: showFilter ? '#cccccc' : '#8b949e',
              cursor: 'pointer',
              borderRadius: 4,
              transition: 'all 0.1s ease',
            }}
            onMouseEnter={e => {
              ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'
              ;(e.currentTarget as HTMLElement).style.color = '#cccccc'
            }}
            onMouseLeave={e => {
              if (!showFilter) {
                ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                ;(e.currentTarget as HTMLElement).style.color = '#8b949e'
              }
            }}
          >
            <Filter size={14} />
          </button>

          {/* Divider */}
          <div style={{ width: 1, height: 16, background: '#2d2d2d', margin: '0 2px' }} />

          {/* Clear active terminal */}
          <button
            onClick={() => { if (activeId) handleClear(activeId) }}
            title="Clear Terminal"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              padding: 0,
              background: 'transparent',
              border: 'none',
              color: '#8b949e',
              cursor: activeId ? 'pointer' : 'default',
              borderRadius: 4,
              transition: 'all 0.1s ease',
              opacity: activeId ? 1 : 0.4,
            }}
            onMouseEnter={e => {
              if (activeId) {
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'
                ;(e.currentTarget as HTMLElement).style.color = '#cccccc'
              }
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = '#8b949e'
            }}
          >
            <RotateCcw size={14} />
          </button>

          {/* Lock scroll toggle */}
          <button
            onClick={() => { if (activeId) handleToggleLock(activeId) }}
            title={activeId && lockedTerminals.has(activeId) ? 'Unlock Scroll' : 'Lock Scroll'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              padding: 0,
              background: activeId && lockedTerminals.has(activeId) ? 'rgba(0,122,204,0.15)' : 'transparent',
              border: 'none',
              color: activeId && lockedTerminals.has(activeId) ? '#007acc' : '#8b949e',
              cursor: activeId ? 'pointer' : 'default',
              borderRadius: 4,
              transition: 'all 0.1s ease',
              opacity: activeId ? 1 : 0.4,
            }}
            onMouseEnter={e => {
              if (activeId) {
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'
                ;(e.currentTarget as HTMLElement).style.color = '#cccccc'
              }
            }}
            onMouseLeave={e => {
              if (activeId && lockedTerminals.has(activeId)) {
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(0,122,204,0.15)'
                ;(e.currentTarget as HTMLElement).style.color = '#007acc'
              } else {
                ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                ;(e.currentTarget as HTMLElement).style.color = '#8b949e'
              }
            }}
          >
            {activeId && lockedTerminals.has(activeId) ? <Lock size={14} /> : <Unlock size={14} />}
          </button>

          {/* Maximize / Restore */}
          <button
            onClick={onMaximize}
            title={isMaximized ? 'Restore Panel Size' : 'Maximize Panel'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              padding: 0,
              background: 'transparent',
              border: 'none',
              color: '#8b949e',
              cursor: 'pointer',
              borderRadius: 4,
              transition: 'all 0.1s ease',
            }}
            onMouseEnter={e => {
              ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'
              ;(e.currentTarget as HTMLElement).style.color = '#cccccc'
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = '#8b949e'
            }}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>

          {/* Kill all */}
          <button
            onClick={handleKillAll}
            title="Kill All Terminals"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              padding: 0,
              background: 'transparent',
              border: 'none',
              color: '#8b949e',
              cursor: terminals.length > 0 ? 'pointer' : 'default',
              borderRadius: 4,
              transition: 'all 0.1s ease',
              opacity: terminals.length > 0 ? 1 : 0.4,
            }}
            onMouseEnter={e => {
              if (terminals.length > 0) {
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(248,81,73,0.12)'
                ;(e.currentTarget as HTMLElement).style.color = '#f85149'
              }
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = '#8b949e'
            }}
          >
            <Trash2 size={14} />
          </button>

          {/* More actions */}
          <button
            title="More Actions..."
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              padding: 0,
              background: 'transparent',
              border: 'none',
              color: '#8b949e',
              cursor: 'pointer',
              borderRadius: 4,
              transition: 'all 0.1s ease',
            }}
            onMouseEnter={e => {
              ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'
              ;(e.currentTarget as HTMLElement).style.color = '#cccccc'
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = '#8b949e'
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

      {/* Quick profile launch bar (shown when > 0 terminals, subtle) */}
      {terminals.length > 0 && terminalStats.taskCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px 3px',
            borderTop: '1px solid #2d2d2d',
            fontSize: 10,
            color: '#6e7681',
          }}
        >
          <CircleDot size={10} style={{ color: '#dca032', opacity: 0.7 }} />
          <span>{terminalStats.taskCount} task{terminalStats.taskCount > 1 ? 's' : ''} running</span>
          {terminalStats.totalUnread > 0 && (
            <>
              <span style={{ margin: '0 4px', opacity: 0.3 }}>|</span>
              <Bell size={10} style={{ opacity: 0.6 }} />
              <span>{terminalStats.totalUnread} unread</span>
            </>
          )}
        </div>
      )}

      {/* Profile dropdown portal */}
      {showProfileDropdown && addBtnRef.current && (
        <ProfileDropdown
          profiles={profiles}
          onSelect={profileId => handleAdd(profileId)}
          onClose={() => setShowProfileDropdown(false)}
          anchorRect={addBtnRef.current.getBoundingClientRect()}
        />
      )}

      {/* Context menu portal */}
      {contextMenu && contextTerminal && (
        <TerminalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          terminalId={contextMenu.terminalId}
          terminalTitle={contextTerminal.title}
          isLocked={lockedTerminals.has(contextMenu.terminalId)}
          onClose={() => setContextMenu(null)}
          onRename={() => { setRenamingId(contextMenu.terminalId); setContextMenu(null) }}
          onSplitH={() => handleSplit(contextMenu.terminalId, 'horizontal')}
          onSplitV={() => handleSplit(contextMenu.terminalId, 'vertical')}
          onKill={() => { handleClose(contextMenu.terminalId); setContextMenu(null) }}
          onClear={() => handleClear(contextMenu.terminalId)}
          onMoveToEditor={() => setContextMenu(null)}
          onChangeProfile={() => setContextMenu(null)}
          onToggleLock={() => handleToggleLock(contextMenu.terminalId)}
          onCopyPath={() => handleCopyPath(contextMenu.terminalId)}
          profiles={profiles}
        />
      )}
    </div>
  )
}
