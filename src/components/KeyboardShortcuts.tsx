import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  X,
  Search,
  Keyboard,
  ChevronDown,
  ChevronRight,
  Pencil,
  RotateCcw,
  Download,
  Upload,
  AlertTriangle,
  Check,
} from 'lucide-react'
import { useKeybindingsStore, Keybinding } from '../store/keybindings'

interface Props {
  open: boolean
  onClose: () => void
}

/* ─── CSS injected once ─── */
const STYLES = `
@keyframes keycapture-pulse {
  0%, 100% { box-shadow: 0 0 0 1px var(--accent); }
  50% { box-shadow: 0 0 0 2px var(--accent), 0 0 12px rgba(var(--accent-rgb, 100,149,237), 0.35); }
}
@keyframes ks-fade-in {
  from { opacity: 0; transform: translateY(-2px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes ks-toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(4px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.ks-row:hover .ks-row-actions { opacity: 1 !important; }
.ks-btn-ghost {
  padding: 4px;
  border-radius: 4px;
  background: transparent;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}
.ks-btn-ghost:hover {
  background: rgba(255,255,255,0.08);
}
.ks-header-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.ks-header-btn:hover {
  background: rgba(255,255,255,0.06);
}
.ks-modifier-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  height: 28px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-mono, monospace);
  border-radius: 4px;
  transition: all 0.1s ease;
  user-select: none;
}
.ks-modifier-key[data-active="false"] {
  color: var(--text-muted);
  background: var(--bg-primary);
  border: 1px solid var(--border);
  opacity: 0.5;
}
.ks-modifier-key[data-active="true"] {
  color: #fff;
  background: var(--accent);
  border: 1px solid var(--accent);
  opacity: 1;
  box-shadow: 0 0 8px rgba(var(--accent-rgb, 100,149,237), 0.4);
}
`

/* ─── Helpers ─── */

function parseShortcut(shortcut: string): string[][] {
  if (!shortcut) return []
  return shortcut.split(' ').map((chord) => chord.split('+'))
}

function keyEventToString(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null

  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')

  let key = e.key
  if (key === ' ') key = 'Space'
  else if (key === 'ArrowUp') key = 'Up'
  else if (key === 'ArrowDown') key = 'Down'
  else if (key === 'ArrowLeft') key = 'Left'
  else if (key === 'ArrowRight') key = 'Right'
  else if (key === 'Escape') key = 'Escape'
  else if (key === 'Enter') key = 'Enter'
  else if (key === 'Backspace') key = 'Backspace'
  else if (key === 'Delete') key = 'Delete'
  else if (key === 'Tab') key = 'Tab'
  else if (key.length === 1) key = key.toUpperCase()

  parts.push(key)
  return parts.join('+')
}

/* ─── Sub-components ─── */

function KbdKey({ keyName }: { keyName: string }) {
  return (
    <kbd
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 22,
        height: 22,
        padding: '0 6px',
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'var(--font-mono, monospace)',
        color: 'var(--text-primary)',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderBottom: '2px solid var(--border)',
        borderRadius: 4,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        boxShadow: '0 1px 1px rgba(0,0,0,0.2)',
      }}
    >
      {keyName}
    </kbd>
  )
}

function ShortcutDisplay({
  shortcut,
  isCustomized,
}: {
  shortcut: string
  isCustomized?: boolean
}) {
  const chords = parseShortcut(shortcut)
  if (chords.length === 0) {
    return (
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
        Unassigned
      </span>
    )
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {chords.map((keys, ci) => (
        <span key={ci} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          {ci > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 2px' }}> </span>
          )}
          {keys.map((k, ki) => (
            <span key={ki} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {ki > 0 && (
                <span style={{ fontSize: 9, color: 'var(--text-muted)', opacity: 0.5 }}>+</span>
              )}
              <KbdKey keyName={k} />
            </span>
          ))}
        </span>
      ))}
      {isCustomized && (
        <span
          style={{
            fontSize: 8,
            color: '#e8a317',
            background: 'rgba(232, 163, 23, 0.12)',
            padding: '1px 5px',
            borderRadius: 3,
            fontWeight: 600,
            marginLeft: 4,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Modified
        </span>
      )}
    </span>
  )
}

/* ─── Keyboard Shortcut Recording Widget ─── */

function KeyCaptureWidget({
  onCapture,
  onCancel,
}: {
  onCapture: (shortcut: string) => void
  onCancel: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [captured, setCaptured] = useState<string | null>(null)
  const [modifiers, setModifiers] = useState({ ctrl: false, shift: false, alt: false, meta: false })

  useEffect(() => {
    containerRef.current?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        onCancel()
        return
      }

      // Update modifier state for visual feedback
      setModifiers({
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
      })

      const combo = keyEventToString(e)
      if (combo) {
        setCaptured(combo)
        // Small delay so user can see what was captured
        setTimeout(() => onCapture(combo), 150)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setModifiers({
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
      })
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [onCapture, onCancel])

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px',
        background: 'var(--bg-primary)',
        border: '1px solid var(--accent)',
        borderRadius: 8,
        outline: 'none',
        animation: 'keycapture-pulse 2s ease-in-out infinite',
        minWidth: 280,
      }}
    >
      {/* Modifier key indicators */}
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="ks-modifier-key" data-active={String(modifiers.ctrl || modifiers.meta)}>
          Ctrl
        </span>
        <span className="ks-modifier-key" data-active={String(modifiers.shift)}>
          Shift
        </span>
        <span className="ks-modifier-key" data-active={String(modifiers.alt)}>
          Alt
        </span>
        <span className="ks-modifier-key" data-active={String(modifiers.meta)}>
          Meta
        </span>
      </div>

      {/* Captured or prompt text */}
      <div
        style={{
          fontSize: 12,
          color: captured ? 'var(--text-primary)' : 'var(--text-muted)',
          fontStyle: captured ? 'normal' : 'italic',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {captured ? (
          <>
            <ShortcutDisplay shortcut={captured} />
          </>
        ) : (
          'Press desired key combination...'
        )}
      </div>

      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
        Press <KbdKey keyName="Esc" /> to cancel
      </span>
    </div>
  )
}

/* ─── Source badge ─── */

function SourceBadge({ isUser }: { isUser: boolean }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: 3,
        letterSpacing: '0.3px',
        whiteSpace: 'nowrap',
        ...(isUser
          ? {
              color: '#e8a317',
              background: 'rgba(232, 163, 23, 0.10)',
              border: '1px solid rgba(232, 163, 23, 0.20)',
            }
          : {
              color: 'var(--text-muted)',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
            }),
      }}
    >
      {isUser ? 'User' : 'Default'}
    </span>
  )
}

/* ─── When badge ─── */

function WhenBadge({ when }: { when?: string }) {
  if (!when) return <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.4 }}>--</span>
  return (
    <span
      style={{
        fontSize: 10,
        color: 'var(--text-muted)',
        background: 'rgba(255,255,255,0.05)',
        padding: '2px 6px',
        borderRadius: 3,
        fontFamily: 'var(--font-mono, monospace)',
        maxWidth: 140,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        display: 'inline-block',
      }}
      title={when}
    >
      {when}
    </span>
  )
}

/* ─── Confirm Reset All dialog ─── */

function ConfirmResetDialog({
  customCount,
  onConfirm,
  onCancel,
}: {
  customCount: number
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '24px 28px',
          maxWidth: 380,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          animation: 'ks-fade-in 0.15s ease-out',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <AlertTriangle size={18} style={{ color: '#e05252' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            Reset All Keybindings?
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 20px', lineHeight: 1.6 }}>
          This will reset <strong>{customCount}</strong> customized keybinding{customCount !== 1 ? 's' : ''} back
          to their default values. This action cannot be undone.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onCancel}
            className="ks-header-btn"
            style={{
              color: 'var(--text-secondary)',
              background: 'transparent',
              border: '1px solid var(--border)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="ks-header-btn"
            style={{
              color: '#fff',
              background: '#e05252',
              border: '1px solid #e05252',
            }}
          >
            <RotateCcw size={12} />
            Reset All
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Shortcut Row ─── */

const GRID_TEMPLATE = '1fr 180px 64px 100px auto'

function ShortcutRow({
  binding,
  editingId,
  onStartEdit,
  onCancelEdit,
  onSaveBinding,
}: {
  binding: Keybinding
  editingId: string | null
  onStartEdit: (id: string) => void
  onCancelEdit: () => void
  onSaveBinding: (id: string, shortcut: string) => void
}) {
  const { getEffectiveBinding, isCustomized, resetBinding, findConflicts } =
    useKeybindingsStore()
  const isEditing = editingId === binding.id
  const hasCustom = isCustomized(binding.id)
  const effectiveShortcut = getEffectiveBinding(binding.id)
  const [pendingConflicts, setPendingConflicts] = useState<Keybinding[]>([])
  const [pendingShortcut, setPendingShortcut] = useState<string | null>(null)

  const handleCapture = useCallback(
    (shortcut: string) => {
      const conflicts = findConflicts(shortcut, binding.id)
      if (conflicts.length > 0) {
        setPendingConflicts(conflicts)
        setPendingShortcut(shortcut)
      } else {
        onSaveBinding(binding.id, shortcut)
        setPendingConflicts([])
        setPendingShortcut(null)
      }
    },
    [binding.id, findConflicts, onSaveBinding]
  )

  const handleAcceptConflict = useCallback(() => {
    if (pendingShortcut) {
      onSaveBinding(binding.id, pendingShortcut)
    }
    setPendingConflicts([])
    setPendingShortcut(null)
  }, [binding.id, pendingShortcut, onSaveBinding])

  const handleRejectConflict = useCallback(() => {
    setPendingConflicts([])
    setPendingShortcut(null)
    onCancelEdit()
  }, [onCancelEdit])

  return (
    <div>
      <div
        className="ks-row"
        style={{
          display: 'grid',
          gridTemplateColumns: GRID_TEMPLATE,
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderRadius: 4,
          transition: 'background 0.1s',
          borderBottom: '1px solid rgba(255,255,255,0.03)',
          background: isEditing ? 'rgba(255, 255, 255, 0.06)' : undefined,
          cursor: 'default',
        }}
        onMouseEnter={(e) => {
          if (!isEditing) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
        }}
        onMouseLeave={(e) => {
          if (!isEditing) e.currentTarget.style.background = 'transparent'
        }}
        onDoubleClick={() => {
          if (!isEditing) onStartEdit(binding.id)
        }}
      >
        {/* Command name */}
        <span
          style={{
            fontSize: 12,
            color: hasCustom ? '#e8a317' : 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={binding.id}
        >
          {binding.label}
        </span>

        {/* Keybinding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isEditing && pendingConflicts.length === 0 ? (
            <KeyCaptureWidget onCapture={handleCapture} onCancel={onCancelEdit} />
          ) : (
            <ShortcutDisplay shortcut={effectiveShortcut} isCustomized={hasCustom} />
          )}
        </div>

        {/* Source */}
        <SourceBadge isUser={hasCustom} />

        {/* When clause */}
        <WhenBadge when={binding.when} />

        {/* Actions */}
        <div
          className="ks-row-actions"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            opacity: 0,
            transition: 'opacity 0.15s',
          }}
        >
          {!isEditing && (
            <button
              className="ks-btn-ghost"
              onClick={() => onStartEdit(binding.id)}
              title="Edit keybinding"
              style={{ color: 'var(--text-muted)' }}
            >
              <Pencil size={12} />
            </button>
          )}

          {hasCustom && !isEditing && (
            <button
              className="ks-btn-ghost"
              onClick={() => resetBinding(binding.id)}
              title="Reset to default"
              style={{ color: '#e8a317' }}
            >
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Conflict warning */}
      {pendingConflicts.length > 0 && (
        <div
          style={{
            margin: '2px 12px 6px 12px',
            padding: '10px 14px',
            background: 'rgba(232, 163, 23, 0.08)',
            border: '1px solid rgba(232, 163, 23, 0.25)',
            borderRadius: 6,
            fontSize: 11,
            animation: 'ks-fade-in 0.15s ease-out',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <AlertTriangle size={13} style={{ color: '#e8a317' }} />
            <span style={{ color: '#e8a317', fontWeight: 600 }}>Keybinding Conflict</span>
          </div>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 10 }}>
            This keybinding already exists for:
            {pendingConflicts.map((c) => (
              <div key={c.id} style={{ marginLeft: 8, marginTop: 3 }}>
                <span style={{ fontWeight: 600 }}>{c.label}</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>({c.category})</span>
              </div>
            ))}
            <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>
              Override with <strong style={{ color: 'var(--text-primary)' }}>{pendingShortcut}</strong>?
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleAcceptConflict}
              className="ks-header-btn"
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
              }}
            >
              <Check size={12} />
              Assign Anyway
            </button>
            <button
              onClick={handleRejectConflict}
              className="ks-header-btn"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Category Section ─── */

function CategorySection({
  category,
  bindings,
  defaultExpanded,
  editingId,
  onStartEdit,
  onCancelEdit,
  onSaveBinding,
}: {
  category: string
  bindings: Keybinding[]
  defaultExpanded: boolean
  editingId: string | null
  onStartEdit: (id: string) => void
  onCancelEdit: () => void
  onSaveBinding: (id: string, shortcut: string) => void
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  useEffect(() => {
    setExpanded(defaultExpanded)
  }, [defaultExpanded])

  const customizedCount = bindings.filter((b) => useKeybindingsStore.getState().isCustomized(b.id)).length

  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '8px 8px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          borderRadius: 4,
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        {expanded ? (
          <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
        )}
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--accent)',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
          }}
        >
          {category}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>
          ({bindings.length})
        </span>
        {customizedCount > 0 && (
          <span
            style={{
              fontSize: 9,
              color: '#e8a317',
              background: 'rgba(232,163,23,0.10)',
              padding: '1px 6px',
              borderRadius: 8,
              fontWeight: 600,
              marginLeft: 4,
            }}
          >
            {customizedCount} modified
          </span>
        )}
      </button>

      {expanded && (
        <div style={{ marginLeft: 8 }}>
          {/* Column headers */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: GRID_TEMPLATE,
              gap: 8,
              padding: '4px 12px',
              borderBottom: '1px solid var(--border)',
              marginBottom: 2,
            }}
          >
            {['Command', 'Keybinding', 'Source', 'When', ''].map((label) => (
              <span
                key={label || 'actions'}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {label}
              </span>
            ))}
          </div>

          {bindings.map((binding) => (
            <ShortcutRow
              key={binding.id}
              binding={binding}
              editingId={editingId}
              onStartEdit={onStartEdit}
              onCancelEdit={onCancelEdit}
              onSaveBinding={onSaveBinding}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Main component ─── */

export default function KeyboardShortcuts({ open, onClose }: Props) {
  const { keybindings, customBindings, resetAllBindings, setCustomBinding, getEffectiveBinding } =
    useKeybindingsStore()
  const [filter, setFilter] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [exportToast, setExportToast] = useState(false)
  const [importToast, setImportToast] = useState<string | null>(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setFilter('')
      setEditingId(null)
      setShowResetConfirm(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Close on Escape (only when not editing and no dialog open)
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editingId && !showResetConfirm) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose, editingId, showResetConfirm])

  const handleSaveBinding = useCallback(
    (commandId: string, shortcut: string) => {
      setCustomBinding(commandId, shortcut)
      setEditingId(null)
    },
    [setCustomBinding]
  )

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
  }, [])

  const handleStartEdit = useCallback((id: string) => {
    setEditingId(id)
  }, [])

  const handleExport = useCallback(() => {
    const exportData: Record<string, string> = {}
    for (const [id, shortcut] of Object.entries(customBindings)) {
      exportData[id] = shortcut
    }
    const json = JSON.stringify(exportData, null, 2)

    // Create downloadable file as well as copying to clipboard
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'orion-keybindings.json'
    a.click()
    URL.revokeObjectURL(url)

    navigator.clipboard.writeText(json).catch(() => {
      /* clipboard may not be available */
    })
    setExportToast(true)
    setTimeout(() => setExportToast(false), 2500)
  }, [customBindings])

  const handleImport = useCallback(() => {
    importInputRef.current?.click()
  }, [])

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string)
          if (typeof data !== 'object' || data === null || Array.isArray(data)) {
            setImportToast('Invalid format: expected a JSON object')
            setTimeout(() => setImportToast(null), 3000)
            return
          }

          let imported = 0
          for (const [id, shortcut] of Object.entries(data)) {
            if (typeof shortcut === 'string') {
              setCustomBinding(id, shortcut)
              imported++
            }
          }

          setImportToast(`Imported ${imported} keybinding${imported !== 1 ? 's' : ''} successfully`)
          setTimeout(() => setImportToast(null), 3000)
        } catch {
          setImportToast('Failed to parse JSON file')
          setTimeout(() => setImportToast(null), 3000)
        }
      }
      reader.readAsText(file)

      // Reset file input so the same file can be imported again
      e.target.value = ''
    },
    [setCustomBinding]
  )

  const handleResetAll = useCallback(() => {
    resetAllBindings()
    setEditingId(null)
    setShowResetConfirm(false)
  }, [resetAllBindings])

  const customCount = Object.keys(customBindings).length

  const { filteredByCategory, totalCount } = useMemo(() => {
    const q = filter.toLowerCase().trim()
    const cats = [...new Set(keybindings.map((k) => k.category))]

    const filtered = q
      ? keybindings.filter((k) => {
          const effectiveShortcut = getEffectiveBinding(k.id)
          return (
            k.label.toLowerCase().includes(q) ||
            effectiveShortcut.toLowerCase().includes(q) ||
            k.shortcut.toLowerCase().includes(q) ||
            k.category.toLowerCase().includes(q) ||
            k.id.toLowerCase().includes(q) ||
            (k.when && k.when.toLowerCase().includes(q)) ||
            (q === 'user' && k.id in customBindings) ||
            (q === 'default' && !(k.id in customBindings))
          )
        })
      : keybindings

    const grouped: Record<string, Keybinding[]> = {}
    for (const cat of cats) {
      const items = filtered.filter((k) => k.category === cat)
      if (items.length > 0) {
        grouped[cat] = items
      }
    }

    return {
      filteredByCategory: grouped,
      totalCount: filtered.length,
    }
  }, [filter, keybindings, customBindings, getEffectiveBinding])

  if (!open) return null

  const activeCats = Object.keys(filteredByCategory)
  const isFiltering = filter.trim().length > 0

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (!editingId && !showResetConfirm) onClose()
      }}
    >
      <style>{STYLES}</style>

      {/* Hidden file input for import */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      {/* Reset confirmation dialog */}
      {showResetConfirm && (
        <ConfirmResetDialog
          customCount={customCount}
          onConfirm={handleResetAll}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}

      <div
        className="anim-scale-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 820,
          maxHeight: '85vh',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Keyboard size={16} style={{ color: 'var(--accent)', marginRight: 10 }} />
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Keyboard Shortcuts
          </h2>
          <span
            style={{
              marginLeft: 10,
              fontSize: 11,
              color: 'var(--text-muted)',
              background: 'rgba(255,255,255,0.06)',
              padding: '2px 8px',
              borderRadius: 10,
            }}
          >
            {totalCount} commands
          </span>

          {customCount > 0 && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 11,
                color: '#e8a317',
                background: 'rgba(232,163,23,0.1)',
                padding: '2px 8px',
                borderRadius: 10,
                fontWeight: 600,
              }}
            >
              {customCount} customized
            </span>
          )}

          {/* Header action buttons */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            {/* Import */}
            <button
              onClick={handleImport}
              title="Import keybindings from JSON file"
              className="ks-header-btn"
              style={{
                color: 'var(--text-secondary)',
                background: 'transparent',
                border: '1px solid var(--border)',
              }}
            >
              <Upload size={12} />
              Import
            </button>

            {/* Export */}
            {customCount > 0 && (
              <button
                onClick={handleExport}
                title="Export custom keybindings as JSON"
                className="ks-header-btn"
                style={{
                  color: 'var(--text-secondary)',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  position: 'relative',
                }}
              >
                <Download size={12} />
                Export
                {exportToast && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -30,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: 'var(--accent)',
                      color: '#fff',
                      fontSize: 10,
                      padding: '3px 10px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                      fontWeight: 600,
                      animation: 'ks-toast-in 0.15s ease-out',
                      pointerEvents: 'none',
                    }}
                  >
                    Exported & copied
                  </span>
                )}
              </button>
            )}

            {/* Reset All */}
            {customCount > 0 && (
              <button
                onClick={() => setShowResetConfirm(true)}
                title="Reset all keybindings to defaults"
                className="ks-header-btn"
                style={{
                  color: '#e05252',
                  background: 'transparent',
                  border: '1px solid rgba(224,82,82,0.3)',
                }}
              >
                <RotateCcw size={12} />
                Reset All
              </button>
            )}

            <button
              onClick={onClose}
              className="ks-btn-ghost"
              style={{ color: 'var(--text-muted)', marginLeft: 4 }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Import toast ── */}
        {importToast && (
          <div
            style={{
              padding: '8px 20px',
              fontSize: 11,
              fontWeight: 600,
              color: importToast.startsWith('Failed') || importToast.startsWith('Invalid')
                ? '#e05252'
                : '#4ec9b0',
              background: importToast.startsWith('Failed') || importToast.startsWith('Invalid')
                ? 'rgba(224,82,82,0.08)'
                : 'rgba(78,201,176,0.08)',
              borderBottom: '1px solid var(--border)',
              animation: 'ks-fade-in 0.15s ease-out',
            }}
          >
            {importToast}
          </div>
        )}

        {/* ── Search ── */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '0 10px',
            }}
          >
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder='Search by command, key, source ("user"/"default"), or when clause...'
              style={{
                flex: 1,
                padding: '8px 10px',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: 12,
                color: 'var(--text-primary)',
              }}
            />
            {filter && (
              <button
                onClick={() => setFilter('')}
                className="ks-btn-ghost"
                style={{ color: 'var(--text-muted)' }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* ── Shortcuts list ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 16px' }}>
          {activeCats.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 0',
                color: 'var(--text-muted)',
                fontSize: 12,
              }}
            >
              No shortcuts match &ldquo;{filter}&rdquo;
            </div>
          )}

          {activeCats.map((cat) => (
            <CategorySection
              key={cat}
              category={cat}
              bindings={filteredByCategory[cat]}
              defaultExpanded={isFiltering || activeCats.length <= 5}
              editingId={editingId}
              onStartEdit={handleStartEdit}
              onCancelEdit={handleCancelEdit}
              onSaveBinding={handleSaveBinding}
            />
          ))}
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 20px',
            borderTop: '1px solid var(--border)',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Double-click or{' '}
            <Pencil
              size={10}
              style={{ display: 'inline', verticalAlign: 'middle', margin: '0 2px' }}
            />{' '}
            to edit &middot; Press <KbdKey keyName="Esc" /> to {editingId ? 'cancel edit' : 'close'}
          </span>
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px',
              borderRadius: 6,
              fontSize: 12,
              color: 'var(--text-secondary)',
              background: 'var(--bg-hover)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
