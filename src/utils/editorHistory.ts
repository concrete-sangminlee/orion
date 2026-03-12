/**
 * Editor navigation history.
 * Tracks cursor positions, file visits, and symbol navigations
 * for back/forward navigation like a browser.
 */

/* ── Types ─────────────────────────────────────────────── */

export interface NavigationEntry {
  filePath: string
  line: number
  column: number
  timestamp: number
  reason?: NavigationReason
  symbolName?: string
}

export type NavigationReason =
  | 'open'
  | 'goto-line'
  | 'goto-definition'
  | 'goto-reference'
  | 'goto-symbol'
  | 'search-result'
  | 'bookmark'
  | 'error-navigation'
  | 'breadcrumb'
  | 'user-click'
  | 'link-follow'

/* ── Navigation History Manager ────────────────────────── */

export class NavigationHistory {
  private entries: NavigationEntry[] = []
  private currentIndex = -1
  private maxEntries = 100
  private minDistanceLines = 5  // Minimum line distance to create new entry
  private listeners = new Set<() => void>()

  /** Push a new navigation entry */
  push(entry: Omit<NavigationEntry, 'timestamp'>): void {
    const now = Date.now()
    const current = this.getCurrent()

    // Skip if same position (within threshold)
    if (current &&
        current.filePath === entry.filePath &&
        Math.abs(current.line - entry.line) < this.minDistanceLines) {
      // Update in place
      this.entries[this.currentIndex] = { ...entry, timestamp: now }
      return
    }

    // Truncate forward history
    if (this.currentIndex < this.entries.length - 1) {
      this.entries = this.entries.slice(0, this.currentIndex + 1)
    }

    this.entries.push({ ...entry, timestamp: now })
    this.currentIndex = this.entries.length - 1

    // Trim old entries
    if (this.entries.length > this.maxEntries) {
      const excess = this.entries.length - this.maxEntries
      this.entries = this.entries.slice(excess)
      this.currentIndex -= excess
    }

    this.notify()
  }

  /** Go back in history */
  goBack(): NavigationEntry | undefined {
    if (!this.canGoBack()) return undefined
    this.currentIndex--
    this.notify()
    return this.getCurrent()
  }

  /** Go forward in history */
  goForward(): NavigationEntry | undefined {
    if (!this.canGoForward()) return undefined
    this.currentIndex++
    this.notify()
    return this.getCurrent()
  }

  /** Check if can go back */
  canGoBack(): boolean {
    return this.currentIndex > 0
  }

  /** Check if can go forward */
  canGoForward(): boolean {
    return this.currentIndex < this.entries.length - 1
  }

  /** Get current entry */
  getCurrent(): NavigationEntry | undefined {
    return this.entries[this.currentIndex]
  }

  /** Get back stack */
  getBackStack(limit = 10): NavigationEntry[] {
    const start = Math.max(0, this.currentIndex - limit)
    return this.entries.slice(start, this.currentIndex).reverse()
  }

  /** Get forward stack */
  getForwardStack(limit = 10): NavigationEntry[] {
    const end = Math.min(this.entries.length, this.currentIndex + limit + 1)
    return this.entries.slice(this.currentIndex + 1, end)
  }

  /** Get all entries */
  getAll(): NavigationEntry[] {
    return [...this.entries]
  }

  /** Get entries for a specific file */
  getEntriesForFile(filePath: string): NavigationEntry[] {
    return this.entries.filter(e => e.filePath === filePath)
  }

  /** Get recently visited unique files */
  getRecentFiles(limit = 10): string[] {
    const seen = new Set<string>()
    const result: string[] = []

    for (let i = this.entries.length - 1; i >= 0 && result.length < limit; i--) {
      const path = this.entries[i].filePath
      if (!seen.has(path)) {
        seen.add(path)
        result.push(path)
      }
    }

    return result
  }

  /** Clear all entries for a file (e.g., when file is deleted) */
  removeFile(filePath: string): void {
    const before = this.entries.length
    this.entries = this.entries.filter(e => e.filePath !== filePath)
    const removed = before - this.entries.length
    this.currentIndex = Math.min(this.currentIndex, this.entries.length - 1)
    if (removed > 0) this.notify()
  }

  /** Subscribe to changes */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Clear all history */
  clear(): void {
    this.entries = []
    this.currentIndex = -1
    this.notify()
  }

  /** Get stats */
  getStats(): { totalEntries: number; uniqueFiles: number; currentIndex: number } {
    const uniqueFiles = new Set(this.entries.map(e => e.filePath)).size
    return {
      totalEntries: this.entries.length,
      uniqueFiles,
      currentIndex: this.currentIndex,
    }
  }

  private notify(): void {
    this.listeners.forEach(l => { try { l() } catch {} })
  }
}

/* ── Singleton ─────────────────────────────────────────── */

export const navigationHistory = new NavigationHistory()

/* ── Edit Location History ─────────────────────────────── */

export interface EditLocation {
  filePath: string
  line: number
  column: number
  timestamp: number
  editType: 'insert' | 'delete' | 'replace'
}

export class EditLocationHistory {
  private locations: EditLocation[] = []
  private currentIndex = -1
  private maxLocations = 50

  /** Record an edit location */
  record(location: Omit<EditLocation, 'timestamp'>): void {
    const now = Date.now()
    const last = this.locations[this.locations.length - 1]

    // Coalesce nearby edits in the same file
    if (last &&
        last.filePath === location.filePath &&
        Math.abs(last.line - location.line) < 3 &&
        now - last.timestamp < 2000) {
      last.line = location.line
      last.column = location.column
      last.timestamp = now
      return
    }

    // Truncate forward
    if (this.currentIndex < this.locations.length - 1) {
      this.locations = this.locations.slice(0, this.currentIndex + 1)
    }

    this.locations.push({ ...location, timestamp: now })
    this.currentIndex = this.locations.length - 1

    if (this.locations.length > this.maxLocations) {
      this.locations.shift()
      this.currentIndex--
    }
  }

  /** Navigate to previous edit location */
  goToPreviousEdit(): EditLocation | undefined {
    if (this.currentIndex <= 0) return undefined
    this.currentIndex--
    return this.locations[this.currentIndex]
  }

  /** Navigate to next edit location */
  goToNextEdit(): EditLocation | undefined {
    if (this.currentIndex >= this.locations.length - 1) return undefined
    this.currentIndex++
    return this.locations[this.currentIndex]
  }

  /** Get recent edit locations */
  getRecent(limit = 10): EditLocation[] {
    return this.locations.slice(-limit).reverse()
  }

  /** Clear edit locations for a file */
  removeFile(filePath: string): void {
    this.locations = this.locations.filter(l => l.filePath !== filePath)
    this.currentIndex = Math.min(this.currentIndex, this.locations.length - 1)
  }

  /** Clear all */
  clear(): void {
    this.locations = []
    this.currentIndex = -1
  }
}

export const editLocationHistory = new EditLocationHistory()
