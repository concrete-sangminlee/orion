import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Info,
  Trash2,
  BellOff,
  Bell,
  X,
  Search,
  Clock,
} from 'lucide-react'
import {
  useToastStore,
  type Notification,
  type NotificationCategory,
  type NotificationType,
} from '@/store/toast'

/*
 * The history of real notifications: every toast the app shows is recorded by
 * the toast store (src/store/toast.ts), with its category, actions and progress.
 */

const TYPE_ICONS: Record<NotificationType, React.ReactNode> = {
  info: <Info size={14} />,
  success: <CheckCircle size={14} />,
  warning: <AlertTriangle size={14} />,
  error: <AlertCircle size={14} />,
}

const TYPE_COLORS: Record<NotificationType, string> = {
  info: 'var(--accent-primary, #58a6ff)',
  success: 'var(--success, #3fb950)',
  warning: 'var(--warning, #d29922)',
  error: 'var(--error, #f85149)',
}

const ALL_TYPES: NotificationType[] = ['error', 'warning', 'info', 'success']
const ALL_CATEGORIES: NotificationCategory[] = ['Git', 'Editor', 'AI', 'System']

type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'Earlier'
const DATE_GROUPS: DateGroup[] = ['Today', 'Yesterday', 'This Week', 'Earlier']

function dateGroup(timestamp: number, now = new Date()): DateGroup {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (timestamp >= todayStart) return 'Today'
  if (timestamp >= todayStart - 86400000) return 'Yesterday'
  if (timestamp >= todayStart - 7 * 86400000) return 'This Week'
  return 'Earlier'
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

const STYLE_ID = 'nc-styles'
function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    @keyframes nc-panel-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
    .nc-panel { animation: nc-panel-in 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
    .nc-item:hover { background: var(--bg-hover, rgba(255,255,255,0.04)) !important; }
    .nc-icon-btn {
      display: flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 4px; border: none;
      background: transparent; color: var(--text-secondary, #8b949e); cursor: pointer;
    }
    .nc-icon-btn:hover { background: rgba(255,255,255,0.08); color: var(--text-primary, #e6edf3); }
    .nc-chip {
      font-size: 11px; padding: 2px 9px; border-radius: 12px; cursor: pointer;
      border: 1px solid var(--border-color, rgba(255,255,255,0.1));
      background: transparent; color: var(--text-secondary, #8b949e);
    }
    .nc-chip-active {
      border-color: var(--accent-primary, #58a6ff); background: rgba(88,166,255,0.12);
      color: var(--accent-primary, #58a6ff); font-weight: 600;
    }
    .nc-action-btn {
      border: 1px solid var(--border-color, rgba(255,255,255,0.1)); border-radius: 4px;
      padding: 2px 9px; font-size: 11px; font-weight: 600; cursor: pointer;
      background: transparent; color: var(--accent-primary, #58a6ff);
    }
  `
  document.head.appendChild(style)
}

function NotificationItem({ notification }: { notification: Notification }) {
  const markRead = useToastStore((s) => s.markRead)
  const color = TYPE_COLORS[notification.type]
  const showProgress = notification.progress !== undefined

  return (
    <div
      className="nc-item"
      role="listitem"
      onClick={() => { if (!notification.read) markRead(notification.id) }}
      style={{
        display: 'flex',
        gap: 10,
        padding: '10px 14px',
        borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.06))',
        background: notification.read ? 'transparent' : 'rgba(88,166,255,0.05)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, height: 18 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: notification.read ? 'transparent' : 'var(--accent-primary, #58a6ff)',
          }}
        />
        <span style={{ color, display: 'flex' }}>{TYPE_ICONS[notification.type]}</span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          title={notification.message}
          style={{
            fontSize: 12,
            color: 'var(--text-primary, #e6edf3)',
            lineHeight: 1.4,
            wordBreak: 'break-word',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {notification.message}
        </div>

        {showProgress && (
          <div style={{ marginTop: 6 }}>
            <div style={{ height: 3, borderRadius: 2, background: 'var(--bg-tertiary, rgba(255,255,255,0.06))', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${notification.completed ? 100 : Math.min(100, Math.max(0, notification.progress ?? 0))}%`,
                  background: notification.completed ? TYPE_COLORS.success : color,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-secondary, #8b949e)' }}>
              {notification.completed ? 'Completed' : `${notification.progress}%`}
            </span>
          </div>
        )}

        {notification.actions && notification.actions.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {notification.actions.map((action) => (
              <button
                key={action.label}
                className="nc-action-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  action.onClick()
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 10, color: 'var(--text-secondary, #8b949e)' }}>
          <span title={new Date(notification.timestamp).toLocaleString()}>{formatRelativeTime(notification.timestamp)}</span>
          <span style={{ opacity: 0.8 }}>{notification.category}</span>
        </div>
      </div>
    </div>
  )
}

interface NotificationCenterProps {
  open: boolean
  onClose: () => void
  anchorRef?: React.RefObject<HTMLDivElement | null>
}

export default function NotificationCenter({ open, onClose, anchorRef }: NotificationCenterProps) {
  const notifications = useToastStore((s) => s.notifications)
  const doNotDisturb = useToastStore((s) => s.doNotDisturb)
  const toggleDoNotDisturb = useToastStore((s) => s.toggleDoNotDisturb)
  const clearAllNotifications = useToastStore((s) => s.clearAllNotifications)
  const markAllRead = useToastStore((s) => s.markAllRead)

  const panelRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<NotificationType | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<NotificationCategory | null>(null)

  useEffect(() => {
    ensureStyles()
  }, [])

  // Opening the center is reading it: this clears the status bar badge.
  useEffect(() => {
    if (open) markAllRead()
  }, [open, markAllRead])

  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || anchorRef?.current?.contains(target)) return
      onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, anchorRef, onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return notifications.filter((n) =>
      (!typeFilter || n.type === typeFilter) &&
      (!categoryFilter || n.category === categoryFilter) &&
      (!q || n.message.toLowerCase().includes(q)),
    )
  }, [notifications, query, typeFilter, categoryFilter])

  const grouped = useMemo(() => {
    const now = new Date()
    return DATE_GROUPS
      .map((group) => ({ group, items: filtered.filter((n) => dateGroup(n.timestamp, now) === group) }))
      .filter(({ items }) => items.length > 0)
  }, [filtered])

  if (!open) return null

  const filtering = Boolean(query.trim() || typeFilter || categoryFilter)

  return (
    <div
      ref={panelRef}
      className="nc-panel"
      role="dialog"
      aria-label="Notifications"
      style={{
        position: 'fixed',
        top: 32,
        right: 0,
        bottom: 24,
        width: 400,
        maxWidth: '100vw',
        background: 'var(--bg-primary, #0d1117)',
        borderLeft: '1px solid var(--border-color, rgba(255,255,255,0.1))',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.3)',
        zIndex: 300,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.08))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={14} style={{ color: 'var(--text-primary, #e6edf3)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #e6edf3)' }}>Notifications</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            className="nc-icon-btn"
            onClick={toggleDoNotDisturb}
            title={doNotDisturb ? 'Disable Do Not Disturb' : 'Enable Do Not Disturb'}
            style={doNotDisturb ? { color: 'var(--warning, #d29922)' } : undefined}
          >
            {doNotDisturb ? <BellOff size={13} /> : <Bell size={13} />}
          </button>
          {notifications.length > 0 && (
            <button className="nc-icon-btn" onClick={clearAllNotifications} title="Clear all notifications">
              <Trash2 size={13} />
            </button>
          )}
          <button className="nc-icon-btn" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        </div>
      </div>

      {doNotDisturb && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 14px',
            background: 'rgba(210, 153, 34, 0.08)',
            borderBottom: '1px solid rgba(210, 153, 34, 0.15)',
            fontSize: 11,
            color: 'var(--warning, #d29922)',
          }}
        >
          <BellOff size={13} />
          Do Not Disturb is on: new notifications are listed here without a popup.
        </div>
      )}

      {notifications.length > 0 && (
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.06))', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary, #8b949e)' }} />
            <input
              type="text"
              placeholder="Search notifications..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-tertiary, rgba(255,255,255,0.04))',
                border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                borderRadius: 6,
                padding: '5px 8px 5px 26px',
                fontSize: 12,
                color: 'var(--text-primary, #e6edf3)',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {ALL_TYPES.map((t) => (
              <button
                key={t}
                className={`nc-chip ${typeFilter === t ? 'nc-chip-active' : ''}`}
                onClick={() => setTypeFilter(typeFilter === t ? null : t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)} ({notifications.filter((n) => n.type === t).length})
              </button>
            ))}
            {ALL_CATEGORIES.map((c) => (
              <button
                key={c}
                className={`nc-chip ${categoryFilter === c ? 'nc-chip-active' : ''}`}
                onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      <div role="list" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {filtered.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '48px 24px',
              gap: 10,
              color: 'var(--text-secondary, #8b949e)',
              fontSize: 12,
              textAlign: 'center',
            }}
          >
            <Bell size={28} style={{ opacity: 0.3 }} />
            {notifications.length > 0 ? 'No notifications match your filters' : 'No notifications yet'}
          </div>
        ) : (
          grouped.map(({ group, items }) => (
            <div key={group}>
              <div
                style={{
                  padding: '6px 14px',
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--text-secondary, #8b949e)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.8,
                  background: 'var(--bg-tertiary, rgba(255,255,255,0.02))',
                  borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.06))',
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Clock size={10} />
                {group}
              </div>
              {items.map((n) => (
                <NotificationItem key={n.id} notification={n} />
              ))}
            </div>
          ))
        )}
      </div>

      <div
        style={{
          padding: '7px 14px',
          borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))',
          fontSize: 10,
          color: 'var(--text-secondary, #8b949e)',
        }}
      >
        {filtered.length} notification{filtered.length !== 1 ? 's' : ''}
        {filtering && ' (filtered)'}
      </div>
    </div>
  )
}
