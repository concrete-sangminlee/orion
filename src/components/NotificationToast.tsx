import React, { useState, useCallback, useRef, useEffect, createContext, useContext, useMemo } from 'react'
import {
  X,
  Info,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  Loader,
  Volume2,
  VolumeX,
  Trash2,
  Filter,
  Clock,
  ExternalLink,
  Copy,
  Minimize2,
  Maximize2,
} from 'lucide-react'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type NotificationToastType = 'info' | 'warning' | 'error' | 'success' | 'progress'

export type NotificationPosition = 'bottom-right' | 'top-right' | 'top-center' | 'bottom-center'

export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical'

export interface NotificationAction {
  label: string
  handler: () => void
  primary?: boolean
}

export interface Notification {
  id: string
  type: NotificationToastType
  title: string
  message?: string
  progress?: number
  actions?: NotificationAction[]
  source?: string
  timestamp: number
  autoDismiss?: number
  priority?: NotificationPriority
  groupKey?: string
  expandable?: boolean
  sound?: boolean
  read?: boolean
  dismissed?: boolean
}

interface NotificationGroup {
  key: string
  notifications: Notification[]
  latestTimestamp: number
  collapsed: boolean
}

interface NotificationContextValue {
  notifications: Notification[]
  history: Notification[]
  position: NotificationPosition
  doNotDisturb: boolean
  soundEnabled: boolean
  centerOpen: boolean
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => string
  removeNotification: (id: string) => void
  updateProgress: (id: string, progress: number, message?: string) => void
  completeProgress: (id: string, message?: string) => void
  clearAll: () => void
  clearHistory: () => void
  setPosition: (position: NotificationPosition) => void
  setDoNotDisturb: (value: boolean) => void
  toggleDoNotDisturb: () => void
  setSoundEnabled: (value: boolean) => void
  toggleSound: () => void
  setCenterOpen: (value: boolean) => void
  toggleCenter: () => void
  markRead: (id: string) => void
  markAllRead: () => void
  getUnreadCount: () => number
}

/* ------------------------------------------------------------------ */
/* Constants & lookups                                                  */
/* ------------------------------------------------------------------ */

const MAX_VISIBLE_TOASTS = 5
const MAX_HISTORY = 100
const DEFAULT_DISMISS_TIMEOUT: Record<NotificationToastType, number> = {
  info: 5000,
  success: 4000,
  warning: 8000,
  error: 0,
  progress: 0,
}

const PRIORITY_DISMISS_MULTIPLIER: Record<NotificationPriority, number> = {
  low: 0.6,
  normal: 1,
  high: 2,
  critical: 0,
}

const typeIcons: Record<NotificationToastType, React.ReactNode> = {
  info: <Info size={16} />,
  warning: <AlertTriangle size={16} />,
  error: <AlertCircle size={16} />,
  success: <CheckCircle size={16} />,
  progress: <Loader size={16} style={{ animation: 'nt-spin 1s linear infinite' }} />,
}

const typeSmallIcons: Record<NotificationToastType, React.ReactNode> = {
  info: <Info size={12} />,
  warning: <AlertTriangle size={12} />,
  error: <AlertCircle size={12} />,
  success: <CheckCircle size={12} />,
  progress: <Loader size={12} style={{ animation: 'nt-spin 1s linear infinite' }} />,
}

const typeColors: Record<NotificationToastType, { accent: string; bg: string; border: string }> = {
  info: {
    accent: 'var(--accent, #58a6ff)',
    bg: 'rgba(88, 166, 255, 0.10)',
    border: 'rgba(88, 166, 255, 0.25)',
  },
  warning: {
    accent: 'var(--accent-orange, #d29922)',
    bg: 'rgba(210, 153, 34, 0.10)',
    border: 'rgba(210, 153, 34, 0.25)',
  },
  error: {
    accent: 'var(--accent-red, #f85149)',
    bg: 'rgba(248, 81, 73, 0.10)',
    border: 'rgba(248, 81, 73, 0.25)',
  },
  success: {
    accent: 'var(--accent-green, #3fb950)',
    bg: 'rgba(63, 185, 80, 0.10)',
    border: 'rgba(63, 185, 80, 0.25)',
  },
  progress: {
    accent: 'var(--accent, #58a6ff)',
    bg: 'rgba(88, 166, 255, 0.10)',
    border: 'rgba(88, 166, 255, 0.25)',
  },
}

const priorityLabels: Record<NotificationPriority, string> = {
  low: 'Low',
  normal: '',
  high: 'Important',
  critical: 'Critical',
}

/* ------------------------------------------------------------------ */
/* Animations (injected once into <head>)                              */
/* ------------------------------------------------------------------ */

const STYLE_ID = 'notification-toast-styles'
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    @keyframes nt-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @keyframes nt-slide-in-right {
      from { transform: translateX(calc(100% + 24px)); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes nt-slide-out-right {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(calc(100% + 24px)); opacity: 0; }
    }
    @keyframes nt-slide-in-left {
      from { transform: translateX(calc(-100% - 24px)); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes nt-slide-in-top {
      from { transform: translateY(-40px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes nt-slide-out-top {
      from { transform: translateY(0); opacity: 1; }
      to { transform: translateY(-40px); opacity: 0; }
    }
    @keyframes nt-slide-in-bottom {
      from { transform: translateY(40px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes nt-slide-out-bottom {
      from { transform: translateY(0); opacity: 1; }
      to { transform: translateY(40px); opacity: 0; }
    }

    @keyframes nt-progress-stripe {
      from { background-position: 0 0; }
      to { background-position: 20px 0; }
    }

    @keyframes nt-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    @keyframes nt-badge-bounce {
      0% { transform: scale(1); }
      30% { transform: scale(1.3); }
      60% { transform: scale(0.9); }
      100% { transform: scale(1); }
    }

    @keyframes nt-panel-enter {
      from { opacity: 0; transform: translateY(8px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes nt-panel-exit {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to { opacity: 0; transform: translateY(8px) scale(0.97); }
    }

    @keyframes nt-item-enter {
      from { opacity: 0; transform: translateX(20px); }
      to { opacity: 1; transform: translateX(0); }
    }

    @keyframes nt-item-exit {
      from { opacity: 1; max-height: 200px; }
      to { opacity: 0; max-height: 0; overflow: hidden; padding-top: 0; padding-bottom: 0; margin: 0; }
    }

    @keyframes nt-expand {
      from { max-height: 0; opacity: 0; }
      to { max-height: 500px; opacity: 1; }
    }

    .nt-toast:hover .nt-dismiss-btn {
      opacity: 1 !important;
    }

    .nt-toast .nt-dismiss-btn {
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    .nt-action-btn {
      border: none;
      border-radius: 4px;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: filter 0.1s, transform 0.1s;
      white-space: nowrap;
      font-family: inherit;
    }
    .nt-action-btn:hover {
      filter: brightness(1.15);
      transform: translateY(-1px);
    }
    .nt-action-btn:active {
      transform: translateY(0) scale(0.98);
    }
    .nt-action-btn-primary {
      background: var(--accent, #58a6ff);
      color: #fff;
    }
    .nt-action-btn-secondary {
      background: transparent;
      border: 1px solid var(--border, #3e4452);
      color: var(--text-secondary, #abb2bf);
    }

    .nt-scrollbar::-webkit-scrollbar { width: 5px; }
    .nt-scrollbar::-webkit-scrollbar-track { background: transparent; }
    .nt-scrollbar::-webkit-scrollbar-thumb {
      background: var(--text-muted, #636d83);
      opacity: 0.3;
      border-radius: 3px;
    }

    .nt-history-item:hover {
      background: var(--bg-hover, rgba(255,255,255,0.04)) !important;
    }
    .nt-history-item:hover .nt-history-dismiss {
      opacity: 1 !important;
    }
    .nt-history-item .nt-history-dismiss {
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    .nt-expand-btn:hover {
      background: rgba(255,255,255,0.06) !important;
    }

    .nt-progress-bar {
      height: 3px;
      border-radius: 2px;
      background: rgba(255,255,255,0.06);
      overflow: hidden;
    }
    .nt-progress-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    .nt-progress-fill-striped {
      background-image: linear-gradient(
        45deg,
        rgba(255,255,255,0.12) 25%,
        transparent 25%,
        transparent 50%,
        rgba(255,255,255,0.12) 50%,
        rgba(255,255,255,0.12) 75%,
        transparent 75%
      );
      background-size: 20px 20px;
      animation: nt-progress-stripe 0.6s linear infinite;
    }

    .nt-source-badge {
      font-size: 9px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 8px;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border, #3e4452);
      color: var(--text-muted, #636d83);
      letter-spacing: 0.3px;
      white-space: nowrap;
    }

    .nt-priority-badge {
      font-size: 8px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 3px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .nt-group-count {
      font-size: 9px;
      font-weight: 700;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--accent, #58a6ff);
      color: #fff;
      flex-shrink: 0;
    }

    .nt-filter-chip {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 10px;
      border: 1px solid var(--border, #3e4452);
      background: transparent;
      color: var(--text-muted, #636d83);
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
      white-space: nowrap;
    }
    .nt-filter-chip:hover {
      background: rgba(255,255,255,0.04);
    }
    .nt-filter-chip-active {
      border-color: var(--accent, #58a6ff) !important;
      background: rgba(88, 166, 255, 0.12) !important;
      color: var(--accent, #58a6ff) !important;
      font-weight: 600;
    }

    .nt-center-header-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      background: transparent;
      color: var(--text-muted, #636d83);
      transition: background 0.1s, color 0.1s;
      font-family: inherit;
    }
    .nt-center-header-btn:hover {
      background: rgba(255,255,255,0.06);
      color: var(--text-primary, #e6e6e6);
    }
  `
  document.head.appendChild(style)
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let idCounter = 0
function generateId(): string {
  idCounter += 1
  return `nt-${Date.now().toString(36)}-${idCounter}`
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatTimestamp(timestamp: number): string {
  const d = new Date(timestamp)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

type DateGroup = 'Today' | 'Yesterday' | 'Earlier'

function getDateGroup(timestamp: number): DateGroup {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  if (timestamp >= todayStart) return 'Today'
  if (timestamp >= yesterdayStart) return 'Yesterday'
  return 'Earlier'
}

function getAnimationForPosition(
  position: NotificationPosition,
  isExiting: boolean
): string {
  switch (position) {
    case 'top-right':
    case 'bottom-right':
      return isExiting
        ? 'nt-slide-out-right 0.25s ease-in forwards'
        : 'nt-slide-in-right 0.3s cubic-bezier(0.21, 1.02, 0.73, 1) forwards'
    case 'top-center':
      return isExiting
        ? 'nt-slide-out-top 0.25s ease-in forwards'
        : 'nt-slide-in-top 0.3s cubic-bezier(0.21, 1.02, 0.73, 1) forwards'
    case 'bottom-center':
      return isExiting
        ? 'nt-slide-out-bottom 0.25s ease-in forwards'
        : 'nt-slide-in-bottom 0.3s cubic-bezier(0.21, 1.02, 0.73, 1) forwards'
  }
}

function getPositionStyle(position: NotificationPosition): React.CSSProperties {
  switch (position) {
    case 'top-right':
      return { top: 40, right: 16 }
    case 'bottom-right':
      return { bottom: 36, right: 16 }
    case 'top-center':
      return { top: 40, left: '50%', transform: 'translateX(-50%)' }
    case 'bottom-center':
      return { bottom: 36, left: '50%', transform: 'translateX(-50%)' }
  }
}

function playNotificationSound(type: NotificationToastType): void {
  try {
    const ctx = new AudioContext()
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()
    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)

    gainNode.gain.setValueAtTime(0.08, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)

    const frequencies: Record<NotificationToastType, number> = {
      info: 600,
      success: 800,
      warning: 400,
      error: 300,
      progress: 500,
    }

    oscillator.frequency.setValueAtTime(frequencies[type], ctx.currentTime)
    oscillator.type = type === 'error' ? 'sawtooth' : 'sine'

    if (type === 'success') {
      oscillator.frequency.linearRampToValueAtTime(1000, ctx.currentTime + 0.1)
    }

    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + 0.3)

    setTimeout(() => ctx.close(), 500)
  } catch {
    // Audio not available, silently ignore
  }
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

const NotificationContext = createContext<NotificationContextValue | null>(null)

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

export function NotificationProvider({
  children,
  defaultPosition = 'bottom-right',
  defaultSoundEnabled = false,
}: {
  children: React.ReactNode
  defaultPosition?: NotificationPosition
  defaultSoundEnabled?: boolean
}) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [history, setHistory] = useState<Notification[]>([])
  const [position, setPosition] = useState<NotificationPosition>(defaultPosition)
  const [doNotDisturb, setDoNotDisturb] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(defaultSoundEnabled)
  const [centerOpen, setCenterOpen] = useState(false)
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    ensureStyles()
  }, [])

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const scheduleAutoDismiss = useCallback(
    (id: string, timeout: number) => {
      if (timeout <= 0) return
      const timer = setTimeout(() => {
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, dismissed: true } : n)))
        // After exit animation, remove from visible list
        setTimeout(() => {
          setNotifications((prev) => prev.filter((n) => n.id !== id))
          timersRef.current.delete(id)
        }, 300)
      }, timeout)
      timersRef.current.set(id, timer)
    },
    []
  )

  const addNotification = useCallback(
    (partial: Omit<Notification, 'id' | 'timestamp'>): string => {
      const id = generateId()
      const now = Date.now()
      const priority = partial.priority || 'normal'

      const notification: Notification = {
        ...partial,
        id,
        timestamp: now,
        read: false,
        dismissed: false,
      }

      // Always add to history
      setHistory((prev) => [notification, ...prev].slice(0, MAX_HISTORY))

      // Determine if we should show the toast popup
      const isCritical = priority === 'critical'
      const shouldShow = !doNotDisturb || isCritical

      if (shouldShow) {
        setNotifications((prev) => {
          const visible = prev.filter((n) => !n.dismissed)
          if (visible.length >= MAX_VISIBLE_TOASTS) {
            // Dismiss oldest non-critical toast to make room
            const oldest = visible.find((n) => n.priority !== 'critical')
            if (oldest) {
              const existingTimer = timersRef.current.get(oldest.id)
              if (existingTimer) clearTimeout(existingTimer)
              return [
                ...prev.filter((n) => n.id !== oldest.id),
                notification,
              ]
            }
          }
          return [...prev, notification]
        })

        // Sound
        if (soundEnabled && partial.sound !== false) {
          playNotificationSound(partial.type)
        }

        // Auto-dismiss
        const baseTimeout = partial.autoDismiss ?? DEFAULT_DISMISS_TIMEOUT[partial.type]
        const multiplier = PRIORITY_DISMISS_MULTIPLIER[priority]
        const timeout = multiplier === 0 ? 0 : baseTimeout * multiplier
        if (timeout > 0 && partial.type !== 'progress') {
          scheduleAutoDismiss(id, timeout)
        }
      }

      // Dispatch event for external listeners
      window.dispatchEvent(
        new CustomEvent('orion:notification-toast', {
          detail: { type: partial.type, title: partial.title, message: partial.message, id },
        })
      )

      return id
    },
    [doNotDisturb, soundEnabled, scheduleAutoDismiss]
  )

  const removeNotification = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    // Trigger exit animation
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, dismissed: true } : n)))
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id))
    }, 300)
  }, [])

  const updateProgress = useCallback((id: string, progress: number, message?: string) => {
    const update = (n: Notification) =>
      n.id === id ? { ...n, progress, ...(message ? { message } : {}) } : n
    setNotifications((prev) => prev.map(update))
    setHistory((prev) => prev.map(update))
  }, [])

  const completeProgress = useCallback(
    (id: string, message?: string) => {
      const update = (n: Notification): Notification =>
        n.id === id
          ? { ...n, progress: 100, type: 'success' as const, ...(message ? { message } : {}) }
          : n
      setNotifications((prev) => prev.map(update))
      setHistory((prev) => prev.map(update))
      // Auto-dismiss after completion
      scheduleAutoDismiss(id, 3000)
    },
    [scheduleAutoDismiss]
  )

  const clearAll = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer))
    timersRef.current.clear()
    setNotifications([])
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
  }, [])

  const toggleDoNotDisturb = useCallback(() => {
    setDoNotDisturb((prev) => !prev)
  }, [])

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => !prev)
  }, [])

  const toggleCenter = useCallback(() => {
    setCenterOpen((prev) => !prev)
  }, [])

  const markRead = useCallback((id: string) => {
    setHistory((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }, [])

  const markAllRead = useCallback(() => {
    setHistory((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [])

  const getUnreadCount = useCallback(() => {
    return history.filter((n) => !n.read).length
  }, [history])

  const value: NotificationContextValue = useMemo(
    () => ({
      notifications,
      history,
      position,
      doNotDisturb,
      soundEnabled,
      centerOpen,
      addNotification,
      removeNotification,
      updateProgress,
      completeProgress,
      clearAll,
      clearHistory,
      setPosition,
      setDoNotDisturb,
      toggleDoNotDisturb,
      setSoundEnabled,
      toggleSound,
      setCenterOpen,
      toggleCenter,
      markRead,
      markAllRead,
      getUnreadCount,
    }),
    [
      notifications,
      history,
      position,
      doNotDisturb,
      soundEnabled,
      centerOpen,
      addNotification,
      removeNotification,
      updateProgress,
      completeProgress,
      clearAll,
      clearHistory,
      toggleDoNotDisturb,
      toggleSound,
      toggleCenter,
      markRead,
      markAllRead,
      getUnreadCount,
    ]
  )

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext)
  if (!ctx) {
    throw new Error('useNotifications must be used within a NotificationProvider')
  }
  return ctx
}

/* ------------------------------------------------------------------ */
/* Single Toast Item                                                   */
/* ------------------------------------------------------------------ */

function ToastItem({
  notification,
  index,
  position,
  onDismiss,
}: {
  notification: Notification
  index: number
  position: NotificationPosition
  onDismiss: (id: string) => void
}) {
  const colors = typeColors[notification.type]
  const priority = notification.priority || 'normal'
  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState(false)
  const isExiting = notification.dismissed ?? false

  const isExpandable =
    notification.expandable || (notification.message && notification.message.length > 120)

  const displayMessage = useMemo(() => {
    if (!notification.message) return null
    if (!isExpandable || expanded) return notification.message
    return notification.message.slice(0, 120) + '...'
  }, [notification.message, isExpandable, expanded])

  return (
    <div
      className="nt-toast"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 320,
        maxWidth: 440,
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)',
        backdropFilter: 'blur(16px)',
        background: `linear-gradient(135deg, ${colors.bg}, rgba(30, 30, 30, 0.95))`,
        borderLeft: `3px solid ${colors.accent}`,
        borderTop: `1px solid ${colors.border}`,
        borderRight: `1px solid ${colors.border}`,
        borderBottom: `1px solid ${colors.border}`,
        animation: getAnimationForPosition(position, isExiting),
        animationDelay: isExiting ? '0s' : `${index * 0.05}s`,
        opacity: isExiting ? undefined : 0,
        transition: hovered ? 'box-shadow 0.15s ease' : undefined,
        ...(hovered ? { boxShadow: '0 12px 40px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.3)' } : {}),
      }}
    >
      {/* Priority indicator for critical/high */}
      {(priority === 'critical' || priority === 'high') && (
        <div
          style={{
            height: 2,
            background:
              priority === 'critical'
                ? `linear-gradient(90deg, ${typeColors.error.accent}, ${typeColors.warning.accent})`
                : colors.accent,
            animation: priority === 'critical' ? 'nt-pulse 1.5s ease infinite' : undefined,
          }}
        />
      )}

      {/* Main content row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px 8px' }}>
        <span
          style={{
            color: colors.accent,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            paddingTop: 1,
          }}
        >
          {typeIcons[notification.type]}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title row with source and priority */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-primary, #e6e6e6)',
                lineHeight: 1.3,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {notification.title}
            </span>

            {priority !== 'normal' && priorityLabels[priority] && (
              <span
                className="nt-priority-badge"
                style={{
                  background:
                    priority === 'critical'
                      ? 'rgba(248, 81, 73, 0.2)'
                      : priority === 'high'
                      ? 'rgba(210, 153, 34, 0.2)'
                      : 'rgba(88, 166, 255, 0.1)',
                  color:
                    priority === 'critical'
                      ? typeColors.error.accent
                      : priority === 'high'
                      ? typeColors.warning.accent
                      : typeColors.info.accent,
                }}
              >
                {priorityLabels[priority]}
              </span>
            )}
          </div>

          {/* Message body */}
          {displayMessage && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-secondary, #abb2bf)',
                lineHeight: 1.5,
                display: 'block',
                wordBreak: 'break-word',
              }}
            >
              {displayMessage}
            </span>
          )}

          {/* Expand toggle */}
          {isExpandable && (
            <button
              className="nt-expand-btn"
              onClick={() => setExpanded((prev) => !prev)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 10,
                color: 'var(--accent, #58a6ff)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 4px',
                borderRadius: 3,
                marginTop: 2,
                fontFamily: 'inherit',
              }}
            >
              {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}

          {/* Progress bar */}
          {notification.type === 'progress' && notification.progress !== undefined && (
            <div style={{ marginTop: 6 }}>
              <div className="nt-progress-bar">
                <div
                  className={`nt-progress-fill ${notification.progress < 100 ? 'nt-progress-fill-striped' : ''}`}
                  style={{
                    width: `${Math.min(100, Math.max(0, notification.progress))}%`,
                    background:
                      notification.progress >= 100
                        ? typeColors.success.accent
                        : colors.accent,
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--text-muted, #636d83)',
                  marginTop: 3,
                  display: 'block',
                }}
              >
                {notification.progress >= 100 ? 'Complete' : `${Math.round(notification.progress)}%`}
              </span>
            </div>
          )}

          {/* Source badge and timestamp */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 4,
            }}
          >
            {notification.source && (
              <span className="nt-source-badge">{notification.source}</span>
            )}
            <span style={{ fontSize: 10, color: 'var(--text-muted, #636d83)' }}>
              {formatRelativeTime(notification.timestamp)}
            </span>
          </div>

          {/* Actions */}
          {notification.actions && notification.actions.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {notification.actions.map((action, i) => (
                <button
                  key={action.label}
                  className={`nt-action-btn ${
                    action.primary || i === 0 ? 'nt-action-btn-primary' : 'nt-action-btn-secondary'
                  }`}
                  onClick={() => {
                    action.handler()
                    onDismiss(notification.id)
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dismiss button */}
        <button
          className="nt-dismiss-btn"
          onClick={() => onDismiss(notification.id)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 3,
            color: 'var(--text-muted, #636d83)',
            cursor: 'pointer',
            flexShrink: 0,
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.1s, background 0.1s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
            e.currentTarget.style.color = 'var(--text-primary, #e6e6e6)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-muted, #636d83)'
          }}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>

      {/* Auto-dismiss countdown bar (shown at very bottom) */}
      {notification.autoDismiss && notification.autoDismiss > 0 && notification.type !== 'progress' && !hovered && (
        <div style={{ height: 2, background: 'rgba(255,255,255,0.04)' }}>
          <div
            style={{
              height: '100%',
              background: colors.accent,
              opacity: 0.4,
              animation: `toast-progress ${notification.autoDismiss}ms linear forwards`,
            }}
          />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Grouped Toast Item                                                  */
/* ------------------------------------------------------------------ */

function GroupedToastIndicator({
  group,
  onExpand,
}: {
  group: NotificationGroup
  onExpand: () => void
}) {
  const latest = group.notifications[0]
  const colors = typeColors[latest.type]
  const count = group.notifications.length

  return (
    <div
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minWidth: 320,
        maxWidth: 440,
        borderRadius: 8,
        padding: '10px 14px',
        background: `linear-gradient(135deg, ${colors.bg}, rgba(30, 30, 30, 0.95))`,
        borderLeft: `3px solid ${colors.accent}`,
        border: `1px solid ${colors.border}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(16px)',
        cursor: 'pointer',
      }}
      onClick={onExpand}
    >
      <span style={{ color: colors.accent, display: 'flex', flexShrink: 0 }}>
        {typeIcons[latest.type]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-primary, #e6e6e6)',
            display: 'block',
          }}
        >
          {latest.title}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted, #636d83)' }}>
          and {count - 1} more similar notification{count - 1 !== 1 ? 's' : ''}
        </span>
      </div>
      <span className="nt-group-count">{count}</span>
      <ChevronDown size={14} style={{ color: 'var(--text-muted, #636d83)', flexShrink: 0 }} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Notification Center (history panel)                                 */
/* ------------------------------------------------------------------ */

export function NotificationCenter() {
  const ctx = useContext(NotificationContext)
  if (!ctx) return null

  const {
    history,
    centerOpen,
    setCenterOpen,
    doNotDisturb,
    toggleDoNotDisturb,
    soundEnabled,
    toggleSound,
    clearHistory,
    markRead,
    markAllRead,
    getUnreadCount,
  } = ctx

  const panelRef = useRef<HTMLDivElement>(null)
  const [filterType, setFilterType] = useState<NotificationToastType | null>(null)
  const [filterSource, setFilterSource] = useState<string | null>(null)
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set())
  const [exiting, setExiting] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [, setTick] = useState(0)

  // Force re-render for relative timestamps
  useEffect(() => {
    if (!centerOpen) return
    const interval = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(interval)
  }, [centerOpen])

  // Close on click outside & Escape
  useEffect(() => {
    if (!centerOpen) return
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerOpen])

  // Mark all read on open
  useEffect(() => {
    if (centerOpen) markAllRead()
  }, [centerOpen, markAllRead])

  const handleClose = useCallback(() => {
    setExiting(true)
    setTimeout(() => {
      setCenterOpen(false)
      setExiting(false)
    }, 200)
  }, [setCenterOpen])

  const handleDismissFromHistory = useCallback(
    (id: string) => {
      setDismissingIds((prev) => new Set(prev).add(id))
      setTimeout(() => {
        ctx.clearAll() // not ideal, we remove individually below
        setDismissingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 200)
    },
    [ctx]
  )

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  if (!centerOpen && !exiting) return null

  const unreadCount = getUnreadCount()

  // Collect unique sources
  const sources = useMemo(() => {
    const s = new Set<string>()
    history.forEach((n) => {
      if (n.source) s.add(n.source)
    })
    return Array.from(s).sort()
  }, [history])

  // Apply filters
  const filtered = useMemo(() => {
    let result = history
    if (filterType) result = result.filter((n) => n.type === filterType)
    if (filterSource) result = result.filter((n) => n.source === filterSource)
    return result
  }, [history, filterType, filterSource])

  // Group by date
  const grouped = useMemo(() => {
    const groups: Record<DateGroup, Notification[]> = { Today: [], Yesterday: [], Earlier: [] }
    for (const n of filtered) {
      groups[getDateGroup(n.timestamp)].push(n)
    }
    const result: { group: DateGroup; items: Notification[] }[] = []
    for (const group of ['Today', 'Yesterday', 'Earlier'] as DateGroup[]) {
      if (groups[group].length > 0) {
        result.push({ group, items: groups[group] })
      }
    }
    return result
  }, [filtered])

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        bottom: 36,
        right: 16,
        width: 420,
        maxHeight: 560,
        background: 'var(--bg-secondary, #21252b)',
        border: '1px solid var(--border-bright, #3e4452)',
        borderRadius: 10,
        boxShadow: '0 16px 48px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.2)',
        zIndex: 310,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: exiting
          ? 'nt-panel-exit 0.2s ease-in forwards'
          : 'nt-panel-enter 0.2s ease-out',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border, #3e4452)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={14} style={{ color: 'var(--text-primary, #e6e6e6)' }} />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary, #e6e6e6)',
              letterSpacing: 0.2,
            }}
          >
            Notifications
          </span>
          {unreadCount > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                background: 'var(--accent, #58a6ff)',
                color: '#fff',
                borderRadius: 10,
                padding: '1px 7px',
                lineHeight: '16px',
                animation: 'nt-badge-bounce 0.4s ease',
              }}
            >
              {unreadCount}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* Sound toggle */}
          <button
            className="nt-center-header-btn"
            onClick={toggleSound}
            title={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
          >
            {soundEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
          </button>

          {/* DND toggle */}
          <button
            className="nt-center-header-btn"
            onClick={toggleDoNotDisturb}
            style={{
              color: doNotDisturb ? 'var(--accent-orange, #d29922)' : undefined,
              background: doNotDisturb ? 'rgba(210, 153, 34, 0.12)' : undefined,
            }}
            title={doNotDisturb ? 'Disable Do Not Disturb' : 'Enable Do Not Disturb'}
          >
            {doNotDisturb ? <BellOff size={12} /> : <Bell size={12} />}
            {doNotDisturb && <span style={{ fontSize: 10 }}>DND</span>}
          </button>

          {/* Clear all */}
          {history.length > 0 && (
            <button
              className="nt-center-header-btn"
              onClick={clearHistory}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--accent-red, #f85149)'
                e.currentTarget.style.background = 'rgba(248, 81, 73, 0.1)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted, #636d83)'
                e.currentTarget.style.background = 'transparent'
              }}
              title="Clear all history"
            >
              <Trash2 size={12} />
            </button>
          )}

          {/* Close */}
          <button
            className="nt-center-header-btn"
            onClick={handleClose}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* DND banner */}
      {doNotDisturb && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 16px',
            background: 'rgba(210, 153, 34, 0.08)',
            borderBottom: '1px solid var(--border, #3e4452)',
            fontSize: 11,
            color: 'var(--accent-orange, #d29922)',
            flexShrink: 0,
          }}
        >
          <BellOff size={12} />
          Do Not Disturb -- non-critical popups suppressed
        </div>
      )}

      {/* Filter bar */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '8px 16px',
          borderBottom: '1px solid var(--border, #3e4452)',
          flexShrink: 0,
          overflowX: 'auto',
          alignItems: 'center',
        }}
      >
        <Filter size={11} style={{ color: 'var(--text-muted, #636d83)', flexShrink: 0 }} />
        <button
          className={`nt-filter-chip ${filterType === null && filterSource === null ? 'nt-filter-chip-active' : ''}`}
          onClick={() => {
            setFilterType(null)
            setFilterSource(null)
          }}
        >
          All
        </button>
        {(['error', 'warning', 'info', 'success', 'progress'] as NotificationToastType[]).map((type) => {
          const count = history.filter((n) => n.type === type).length
          if (count === 0) return null
          return (
            <button
              key={type}
              className={`nt-filter-chip ${filterType === type ? 'nt-filter-chip-active' : ''}`}
              onClick={() => setFilterType(filterType === type ? null : type)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <span style={{ color: typeColors[type].accent, display: 'flex' }}>
                {typeSmallIcons[type]}
              </span>
              {type}
              <span style={{ fontSize: 9, opacity: 0.7 }}>({count})</span>
            </button>
          )
        })}
        {sources.length > 0 && (
          <>
            <span
              style={{
                width: 1,
                height: 14,
                background: 'var(--border, #3e4452)',
                flexShrink: 0,
                margin: '0 2px',
              }}
            />
            {sources.map((source) => (
              <button
                key={source}
                className={`nt-filter-chip ${filterSource === source ? 'nt-filter-chip-active' : ''}`}
                onClick={() => setFilterSource(filterSource === source ? null : source)}
              >
                {source}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Notification list */}
      <div
        className="nt-scrollbar"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '48px 20px',
              gap: 12,
              color: 'var(--text-muted, #636d83)',
            }}
          >
            <BellOff size={32} style={{ opacity: 0.3 }} />
            <span style={{ fontSize: 12 }}>
              {filterType || filterSource ? 'No matching notifications' : 'No notifications yet'}
            </span>
            <span style={{ fontSize: 10, opacity: 0.6 }}>
              Notifications will appear here as they arrive
            </span>
          </div>
        ) : (
          grouped.map(({ group, items }) => (
            <div key={group}>
              {/* Date group header */}
              <div
                style={{
                  padding: '6px 16px',
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--text-muted, #636d83)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.8,
                  background: 'var(--bg-tertiary, rgba(255,255,255,0.02))',
                  borderBottom: '1px solid var(--border, #3e4452)',
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                }}
              >
                {group}
              </div>
              {items.map((n, idx) => {
                const colors = typeColors[n.type]
                const isDismissing = dismissingIds.has(n.id)
                const isExpanded = expandedIds.has(n.id)
                const canExpand =
                  n.expandable || (n.message && n.message.length > 100)

                const displayMsg = n.message
                  ? canExpand && !isExpanded
                    ? n.message.slice(0, 100) + '...'
                    : n.message
                  : null

                return (
                  <div
                    key={n.id}
                    className="nt-history-item"
                    onClick={() => {
                      if (!n.read) markRead(n.id)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 16px',
                      borderBottom: '1px solid var(--border, #3e4452)',
                      background: n.read ? 'transparent' : colors.bg,
                      transition: 'background 0.1s',
                      cursor: n.read ? 'default' : 'pointer',
                      position: 'relative',
                      animation: isDismissing
                        ? 'nt-item-exit 0.2s ease-in forwards'
                        : `nt-item-enter 0.25s ease-out ${idx * 0.02}s both`,
                    }}
                  >
                    {/* Unread dot + icon */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, paddingTop: 2 }}>
                      {!n.read ? (
                        <div
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: 'var(--accent, #58a6ff)',
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <div style={{ width: 6 }} />
                      )}
                      <span style={{ color: colors.accent, display: 'flex' }}>
                        {typeSmallIcons[n.type]}
                      </span>
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--text-primary, #e6e6e6)',
                          lineHeight: 1.3,
                          marginBottom: 2,
                        }}
                      >
                        {n.title}
                      </div>

                      {displayMsg && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--text-secondary, #abb2bf)',
                            lineHeight: 1.5,
                            wordBreak: 'break-word',
                          }}
                        >
                          {displayMsg}
                        </div>
                      )}

                      {canExpand && (
                        <button
                          className="nt-expand-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleExpand(n.id)
                          }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            fontSize: 10,
                            color: 'var(--accent, #58a6ff)',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            borderRadius: 3,
                            marginTop: 2,
                            fontFamily: 'inherit',
                          }}
                        >
                          {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                          {isExpanded ? 'Less' : 'More'}
                        </button>
                      )}

                      {/* Progress */}
                      {n.progress !== undefined && (
                        <div style={{ marginTop: 4 }}>
                          <div className="nt-progress-bar">
                            <div
                              className={`nt-progress-fill ${n.progress < 100 ? 'nt-progress-fill-striped' : ''}`}
                              style={{
                                width: `${Math.min(100, Math.max(0, n.progress))}%`,
                                background: n.progress >= 100 ? typeColors.success.accent : colors.accent,
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Actions in history */}
                      {n.actions && n.actions.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                          {n.actions.map((action, i) => (
                            <button
                              key={action.label}
                              className={`nt-action-btn ${
                                action.primary || i === 0 ? 'nt-action-btn-primary' : 'nt-action-btn-secondary'
                              }`}
                              onClick={(e) => {
                                e.stopPropagation()
                                action.handler()
                              }}
                              style={{ fontSize: 10, padding: '2px 8px' }}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Meta row: source + time */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        {n.source && <span className="nt-source-badge">{n.source}</span>}
                        <span style={{ fontSize: 10, color: 'var(--text-muted, #636d83)' }}>
                          {formatRelativeTime(n.timestamp)}
                        </span>
                        <span
                          style={{ fontSize: 9, color: 'var(--text-muted, #636d83)', opacity: 0.6 }}
                        >
                          {formatTimestamp(n.timestamp)}
                        </span>
                      </div>
                    </div>

                    {/* Dismiss from history */}
                    <button
                      className="nt-history-dismiss"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDismissFromHistory(n.id)
                      }}
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        background: 'var(--bg-tertiary, rgba(255,255,255,0.04))',
                        border: '1px solid var(--border, #3e4452)',
                        borderRadius: 4,
                        padding: 2,
                        color: 'var(--text-muted, #636d83)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title="Remove from history"
                    >
                      <X size={10} />
                    </button>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {history.length > 0 && (
        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid var(--border, #3e4452)',
            fontSize: 10,
            color: 'var(--text-muted, #636d83)',
            textAlign: 'center',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <span>
            {filtered.length} notification{filtered.length !== 1 ? 's' : ''}
            {filterType && ` (${filterType})`}
            {filterSource && ` from ${filterSource}`}
          </span>
          {history.length >= MAX_HISTORY && (
            <span style={{ opacity: 0.5 }}>(history limited to {MAX_HISTORY})</span>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main Toast Container (renders floating popups)                      */
/* ------------------------------------------------------------------ */

export default function NotificationToast() {
  const ctx = useContext(NotificationContext)

  // Grouping support
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  if (!ctx) {
    // Render nothing when used outside of provider
    return null
  }

  const { notifications, position, removeNotification } = ctx
  const visible = notifications.filter((n) => !n.dismissed)

  // Build groups for notifications with groupKey
  const { groups, ungrouped } = useMemo(() => {
    const groupMap = new Map<string, Notification[]>()
    const ungroupedItems: Notification[] = []

    for (const n of visible) {
      if (n.groupKey) {
        const existing = groupMap.get(n.groupKey) || []
        existing.push(n)
        groupMap.set(n.groupKey, existing)
      } else {
        ungroupedItems.push(n)
      }
    }

    const groupList: NotificationGroup[] = []
    groupMap.forEach((items, key) => {
      if (items.length > 1) {
        groupList.push({
          key,
          notifications: items.sort((a, b) => b.timestamp - a.timestamp),
          latestTimestamp: Math.max(...items.map((i) => i.timestamp)),
          collapsed: !collapsedGroups.has(key),
        })
      } else {
        // Single item in group => treat as ungrouped
        ungroupedItems.push(items[0])
      }
    })

    return { groups: groupList, ungrouped: ungroupedItems }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, collapsedGroups])

  const handleExpandGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  if (visible.length === 0) return null

  const posStyle = getPositionStyle(position)
  const isBottomAligned = position.startsWith('bottom')

  return (
    <div
      style={{
        position: 'fixed',
        ...posStyle,
        zIndex: 300,
        display: 'flex',
        flexDirection: isBottomAligned ? 'column-reverse' : 'column',
        gap: 8,
        pointerEvents: 'none',
        maxWidth: 460,
      }}
    >
      {/* Render grouped notifications */}
      {groups.map((group) => {
        if (group.collapsed) {
          return (
            <GroupedToastIndicator
              key={group.key}
              group={group}
              onExpand={() => handleExpandGroup(group.key)}
            />
          )
        }
        // Expanded group: show all items
        return group.notifications.map((n, i) => (
          <ToastItem
            key={n.id}
            notification={n}
            index={i}
            position={position}
            onDismiss={removeNotification}
          />
        ))
      })}

      {/* Render ungrouped notifications */}
      {ungrouped.map((n, i) => (
        <ToastItem
          key={n.id}
          notification={n}
          index={groups.length + i}
          position={position}
          onDismiss={removeNotification}
        />
      ))}

      {/* Overflow indicator */}
      {visible.length > MAX_VISIBLE_TOASTS && (
        <div
          style={{
            pointerEvents: 'none',
            textAlign: 'center',
            fontSize: 10,
            color: 'var(--text-muted, #636d83)',
            padding: '4px 0',
          }}
        >
          +{visible.length - MAX_VISIBLE_TOASTS} more
        </div>
      )}
    </div>
  )
}
