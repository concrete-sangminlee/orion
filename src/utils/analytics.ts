/**
 * Privacy-first local analytics. All data stays in localStorage.
 * Tracks feature usage, session metrics, and performance for internal dashboards.
 */

/* ── Types ─────────────────────────────────────────────── */

export interface AnalyticsEvent {
  name: string
  category: string
  timestamp: number
  metadata?: Record<string, string | number | boolean>
}

export interface SessionData {
  id: string
  startTime: number
  endTime?: number
  filesOpened: number
  editsCount: number
  commandsUsed: number
  panelsOpened: string[]
  aiInteractions: number
}

export interface UsageStats {
  totalSessions: number
  totalEdits: number
  totalFilesOpened: number
  totalAiInteractions: number
  mostUsedCommands: Array<{ command: string; count: number }>
  mostOpenedPanels: Array<{ panel: string; count: number }>
  averageSessionMinutes: number
  startupTimeMs: number
  lastActive: number
}

/* ── Storage Keys ──────────────────────────────────────── */

const STORAGE_KEY = 'orion:analytics'
const SESSION_KEY = 'orion:current-session'
const MAX_EVENTS = 5000
const MAX_SESSIONS = 100

/* ── Implementation ────────────────────────────────────── */

class AnalyticsImpl {
  private events: AnalyticsEvent[] = []
  private sessions: SessionData[] = []
  private currentSession: SessionData
  private commandCounts = new Map<string, number>()
  private panelCounts = new Map<string, number>()
  private startupTime = 0

  constructor() {
    this.loadData()
    this.currentSession = {
      id: crypto.randomUUID?.() || `s-${Date.now()}`,
      startTime: Date.now(),
      filesOpened: 0,
      editsCount: 0,
      commandsUsed: 0,
      panelsOpened: [],
      aiInteractions: 0,
    }

    // Auto-save periodically
    if (typeof window !== 'undefined') {
      setInterval(() => this.save(), 30000)
      window.addEventListener('beforeunload', () => this.endSession())
    }
  }

  /* ── Event Tracking ────────────────────────────────── */

  track(name: string, category: string, metadata?: Record<string, string | number | boolean>): void {
    this.events.push({ name, category, timestamp: Date.now(), metadata })
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS)
    }
  }

  trackCommand(command: string): void {
    this.commandCounts.set(command, (this.commandCounts.get(command) || 0) + 1)
    this.currentSession.commandsUsed++
    this.track(command, 'command')
  }

  trackFileOpen(filePath: string): void {
    this.currentSession.filesOpened++
    this.track('file_open', 'editor', { file: filePath.split('/').pop() || filePath })
  }

  trackEdit(): void {
    this.currentSession.editsCount++
  }

  trackPanelOpen(panel: string): void {
    if (!this.currentSession.panelsOpened.includes(panel)) {
      this.currentSession.panelsOpened.push(panel)
    }
    this.panelCounts.set(panel, (this.panelCounts.get(panel) || 0) + 1)
    this.track('panel_open', 'ui', { panel })
  }

  trackAiInteraction(type: string): void {
    this.currentSession.aiInteractions++
    this.track('ai_interaction', 'ai', { type })
  }

  trackStartupTime(ms: number): void {
    this.startupTime = ms
    this.track('startup', 'performance', { durationMs: ms })
  }

  trackPerformance(metric: string, valueMs: number): void {
    this.track(metric, 'performance', { durationMs: valueMs })
  }

  /* ── Session ───────────────────────────────────────── */

  endSession(): void {
    this.currentSession.endTime = Date.now()
    this.sessions.push(this.currentSession)
    if (this.sessions.length > MAX_SESSIONS) {
      this.sessions = this.sessions.slice(-MAX_SESSIONS)
    }
    this.save()
  }

  /* ── Statistics ────────────────────────────────────── */

  getStats(): UsageStats {
    const allSessions = [...this.sessions, this.currentSession]
    const totalSessions = allSessions.length

    const totalEdits = allSessions.reduce((sum, s) => sum + s.editsCount, 0)
    const totalFilesOpened = allSessions.reduce((sum, s) => sum + s.filesOpened, 0)
    const totalAiInteractions = allSessions.reduce((sum, s) => sum + s.aiInteractions, 0)

    const durations = allSessions
      .filter(s => s.endTime)
      .map(s => (s.endTime! - s.startTime) / 60000)
    const averageSessionMinutes = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0

    const mostUsedCommands = Array.from(this.commandCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([command, count]) => ({ command, count }))

    const mostOpenedPanels = Array.from(this.panelCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([panel, count]) => ({ panel, count }))

    return {
      totalSessions,
      totalEdits,
      totalFilesOpened,
      totalAiInteractions,
      mostUsedCommands,
      mostOpenedPanels,
      averageSessionMinutes,
      startupTimeMs: this.startupTime,
      lastActive: Date.now(),
    }
  }

  /* ── Export / Import ───────────────────────────────── */

  exportData(): string {
    return JSON.stringify({
      events: this.events,
      sessions: this.sessions,
      commandCounts: Object.fromEntries(this.commandCounts),
      panelCounts: Object.fromEntries(this.panelCounts),
      exportDate: new Date().toISOString(),
    }, null, 2)
  }

  clearData(): void {
    this.events = []
    this.sessions = []
    this.commandCounts.clear()
    this.panelCounts.clear()
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }

  /* ── Persistence ───────────────────────────────────── */

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        events: this.events.slice(-1000), // Keep last 1000 for storage
        sessions: this.sessions.slice(-MAX_SESSIONS),
        commandCounts: Object.fromEntries(this.commandCounts),
        panelCounts: Object.fromEntries(this.panelCounts),
      }))
    } catch { /* quota exceeded */ }
  }

  private loadData(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return
      const data = JSON.parse(saved)
      this.events = data.events || []
      this.sessions = data.sessions || []
      if (data.commandCounts) {
        this.commandCounts = new Map(Object.entries(data.commandCounts) as [string, number][])
      }
      if (data.panelCounts) {
        this.panelCounts = new Map(Object.entries(data.panelCounts) as [string, number][])
      }
    } catch { /* corrupted data, start fresh */ }
  }
}

export const analytics = new AnalyticsImpl()
