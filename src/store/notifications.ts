/**
 * Enhanced notification store with progress tracking, action buttons, and smart grouping.
 * Extends the toast system with persistent notification history and notification center.
 */

import { create } from 'zustand'

/* ── Types ─────────────────────────────────────────────── */

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'
export type NotificationSource = 'system' | 'editor' | 'git' | 'ai' | 'extension' | 'terminal' | 'debug' | 'build' | 'test'

export interface NotificationAction {
  label: string
  callback: () => void
  primary?: boolean
  icon?: string
}

export interface ProgressNotification {
  id: string
  title: string
  message?: string
  progress: number // 0-100, -1 for indeterminate
  cancellable: boolean
  onCancel?: () => void
  startTime: number
  estimatedTotal?: number
}

export interface Notification {
  id: string
  level: NotificationLevel
  source: NotificationSource
  title: string
  message?: string
  detail?: string
  timestamp: number
  read: boolean
  pinned: boolean
  actions?: NotificationAction[]
  autoHide: boolean
  hideAfterMs: number
  groupKey?: string
}

/* ── Store ─────────────────────────────────────────────── */

interface NotificationStore {
  // State
  notifications: Notification[]
  progressItems: ProgressNotification[]
  doNotDisturb: boolean
  maxHistory: number
  unreadCount: number
  showCenter: boolean
  filter: NotificationSource | 'all'

  // Actions
  notify: (opts: {
    level?: NotificationLevel
    source?: NotificationSource
    title: string
    message?: string
    detail?: string
    actions?: NotificationAction[]
    autoHide?: boolean
    hideAfterMs?: number
    groupKey?: string
    pinned?: boolean
  }) => string

  info: (title: string, message?: string) => string
  success: (title: string, message?: string) => string
  warn: (title: string, message?: string) => string
  error: (title: string, message?: string) => string

  dismiss: (id: string) => void
  dismissAll: () => void
  markRead: (id: string) => void
  markAllRead: () => void
  pin: (id: string) => void
  unpin: (id: string) => void
  clearHistory: () => void

  // Progress
  startProgress: (title: string, cancellable?: boolean, onCancel?: () => void) => string
  updateProgress: (id: string, progress: number, message?: string) => void
  completeProgress: (id: string, message?: string) => void
  cancelProgress: (id: string) => void

  // Settings
  setDoNotDisturb: (dnd: boolean) => void
  toggleCenter: () => void
  setFilter: (filter: NotificationSource | 'all') => void

  // Helpers
  getGrouped: () => Map<string, Notification[]>
  getBySource: (source: NotificationSource) => Notification[]
}

let nextId = 1

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  progressItems: [],
  doNotDisturb: false,
  maxHistory: 200,
  unreadCount: 0,
  showCenter: false,
  filter: 'all',

  notify: (opts) => {
    const id = `notif-${nextId++}`
    const notification: Notification = {
      id,
      level: opts.level || 'info',
      source: opts.source || 'system',
      title: opts.title,
      message: opts.message,
      detail: opts.detail,
      timestamp: Date.now(),
      read: false,
      pinned: opts.pinned || false,
      actions: opts.actions,
      autoHide: opts.autoHide ?? true,
      hideAfterMs: opts.hideAfterMs ?? getDefaultHideMs(opts.level || 'info'),
      groupKey: opts.groupKey,
    }

    set(s => {
      const notifications = [notification, ...s.notifications].slice(0, s.maxHistory)
      return {
        notifications,
        unreadCount: s.unreadCount + 1,
      }
    })

    // Dispatch DOM event for Toast component to pick up
    if (!get().doNotDisturb) {
      window.dispatchEvent(new CustomEvent('orion:notification', { detail: notification }))
    }

    return id
  },

  info: (title, message) => get().notify({ level: 'info', title, message }),
  success: (title, message) => get().notify({ level: 'success', title, message }),
  warn: (title, message) => get().notify({ level: 'warning', title, message }),
  error: (title, message) => get().notify({ level: 'error', title, message }),

  dismiss: (id) => {
    set(s => ({
      notifications: s.notifications.filter(n => n.id !== id),
    }))
  },

  dismissAll: () => {
    set(s => ({
      notifications: s.notifications.filter(n => n.pinned),
    }))
  },

  markRead: (id) => {
    set(s => {
      const notif = s.notifications.find(n => n.id === id)
      if (!notif || notif.read) return s
      return {
        notifications: s.notifications.map(n => n.id === id ? { ...n, read: true } : n),
        unreadCount: Math.max(0, s.unreadCount - 1),
      }
    })
  },

  markAllRead: () => {
    set(s => ({
      notifications: s.notifications.map(n => ({ ...n, read: true })),
      unreadCount: 0,
    }))
  },

  pin: (id) => {
    set(s => ({
      notifications: s.notifications.map(n => n.id === id ? { ...n, pinned: true } : n),
    }))
  },

  unpin: (id) => {
    set(s => ({
      notifications: s.notifications.map(n => n.id === id ? { ...n, pinned: false } : n),
    }))
  },

  clearHistory: () => {
    set(s => ({
      notifications: s.notifications.filter(n => n.pinned),
      unreadCount: 0,
    }))
  },

  // Progress
  startProgress: (title, cancellable = false, onCancel) => {
    const id = `progress-${nextId++}`
    const item: ProgressNotification = {
      id,
      title,
      progress: -1,
      cancellable,
      onCancel,
      startTime: Date.now(),
    }
    set(s => ({ progressItems: [...s.progressItems, item] }))
    return id
  },

  updateProgress: (id, progress, message) => {
    set(s => ({
      progressItems: s.progressItems.map(p =>
        p.id === id ? { ...p, progress: Math.min(100, Math.max(-1, progress)), message } : p
      ),
    }))
  },

  completeProgress: (id, message) => {
    set(s => ({
      progressItems: s.progressItems.filter(p => p.id !== id),
    }))
    if (message) {
      get().success(message)
    }
  },

  cancelProgress: (id) => {
    const item = get().progressItems.find(p => p.id === id)
    if (item?.onCancel) item.onCancel()
    set(s => ({
      progressItems: s.progressItems.filter(p => p.id !== id),
    }))
  },

  // Settings
  setDoNotDisturb: (dnd) => set({ doNotDisturb: dnd }),
  toggleCenter: () => set(s => ({ showCenter: !s.showCenter })),
  setFilter: (filter) => set({ filter }),

  // Helpers
  getGrouped: () => {
    const map = new Map<string, Notification[]>()
    for (const n of get().notifications) {
      const key = n.groupKey || n.id
      const group = map.get(key) || []
      group.push(n)
      map.set(key, group)
    }
    return map
  },

  getBySource: (source) => get().notifications.filter(n => n.source === source),
}))

function getDefaultHideMs(level: NotificationLevel): number {
  switch (level) {
    case 'error': return 8000
    case 'warning': return 6000
    case 'success': return 4000
    default: return 5000
  }
}
