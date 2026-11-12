import { useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, Search, X } from 'lucide-react'
import { listCommands } from '@/commands/registry'
import '@/commands/appCommands'

interface Props {
  open: boolean
  onClose: () => void
}

interface ShortcutEntry {
  id: string
  category: string
  title: string
  keybinding: string
}

/**
 * Keys that are not commands of their own, handled by App and the editor panel.
 * Everything else comes from the command registry, so this list shows the
 * shortcuts the app really has. (It used to be a hand-written list with an
 * editor whose changes nothing ever applied.)
 */
const OTHER_KEYS: ShortcutEntry[] = [
  { id: 'other.nextEditor', category: 'File', title: 'Next Editor', keybinding: 'Ctrl+Tab' },
  { id: 'other.previousEditor', category: 'File', title: 'Previous Editor', keybinding: 'Ctrl+Shift+Tab' },
  { id: 'other.focusGroup1', category: 'Editor', title: 'Focus First Editor Group', keybinding: 'Ctrl+1' },
  { id: 'other.focusGroup2', category: 'Editor', title: 'Focus Second Editor Group', keybinding: 'Ctrl+2' },
]

export function shortcutEntries(): ShortcutEntry[] {
  const commands = listCommands()
    .filter((c): c is typeof c & { keybinding: string } => Boolean(c.keybinding))
    .map(({ id, category, title, keybinding }) => ({ id, category, title, keybinding }))
  return [...commands, ...OTHER_KEYS]
}

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
      }}
    >
      {keyName}
    </kbd>
  )
}

/** "Ctrl+K Ctrl+S" as two chords of keycaps. */
function ShortcutKeys({ shortcut }: { shortcut: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {shortcut.split(' ').map((chord, ci) => (
        <span key={ci} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          {chord.split('+').map((key, ki) => (
            <span key={ki} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {ki > 0 && <span style={{ fontSize: 9, color: 'var(--text-muted)', opacity: 0.5 }}>+</span>}
              <KbdKey keyName={key} />
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}

export default function KeyboardShortcuts({ open, onClose }: Props) {
  const [filter, setFilter] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const entries = useMemo(shortcutEntries, [])

  useEffect(() => {
    if (!open) return
    setFilter('')
    const timer = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(timer)
  }, [open])

  const grouped = useMemo(() => {
    const q = filter.toLowerCase().trim()
    const shown = q
      ? entries.filter((e) => `${e.category} ${e.title} ${e.keybinding}`.toLowerCase().includes(q))
      : entries
    const byCategory = new Map<string, ShortcutEntry[]>()
    for (const entry of shown) byCategory.set(entry.category, [...(byCategory.get(entry.category) ?? []), entry])
    return byCategory
  }, [entries, filter])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
        className="anim-scale-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
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
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <Keyboard size={16} style={{ color: 'var(--accent)', marginRight: 10 }} />
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderBottom: '1px solid var(--border)' }}>
          <Search size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by command or key"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: 'var(--text-primary)' }}
          />
        </div>

        <div style={{ overflowY: 'auto', padding: '8px 20px 16px' }}>
          {grouped.size === 0 && (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No matching shortcuts</div>
          )}
          {[...grouped].map(([category, items]) => (
            <section key={category} style={{ marginTop: 10 }}>
              <h3 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', margin: '0 0 4px' }}>
                {category}
              </h3>
              {items.map((entry) => (
                <div
                  key={entry.id}
                  data-testid="shortcut-row"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, color: 'var(--text-secondary)' }}
                >
                  <span>{entry.title}</span>
                  <ShortcutKeys shortcut={entry.keybinding} />
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
