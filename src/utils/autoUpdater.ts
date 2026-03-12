/**
 * Auto-updater client for the IDE.
 * Manages checking for updates, downloading, and installing.
 */

/* ── Types ─────────────────────────────────────────────── */

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export interface UpdateInfo {
  version: string
  releaseDate: string
  releaseNotes: string
  mandatory: boolean
  downloadUrl?: string
  size?: number
  sha256?: string
}

export interface DownloadProgress {
  bytesPerSecond: number
  percent: number
  transferred: number
  total: number
}

export interface UpdateChannelConfig {
  channel: 'stable' | 'beta' | 'nightly'
  autoCheck: boolean
  autoDownload: boolean
  autoInstall: boolean
  checkIntervalMs: number
}

/* ── State ─────────────────────────────────────────────── */

let currentStatus: UpdateStatus = 'idle'
let currentUpdateInfo: UpdateInfo | null = null
let currentProgress: DownloadProgress | null = null
let statusListeners: Set<(status: UpdateStatus, info?: UpdateInfo, progress?: DownloadProgress) => void> = new Set()
let checkTimer: ReturnType<typeof setInterval> | null = null

const STORAGE_KEY = 'orion:update-config'
const api = () => (window as any).api

/* ── Default Config ───────────────────────────────────── */

const DEFAULT_CONFIG: UpdateChannelConfig = {
  channel: 'stable',
  autoCheck: true,
  autoDownload: false,
  autoInstall: false,
  checkIntervalMs: 4 * 60 * 60 * 1000, // 4 hours
}

/* ── Config Persistence ───────────────────────────────── */

export function getUpdateConfig(): UpdateChannelConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return { ...DEFAULT_CONFIG, ...JSON.parse(stored) }
  } catch {}
  return { ...DEFAULT_CONFIG }
}

export function setUpdateConfig(config: Partial<UpdateChannelConfig>): void {
  const current = getUpdateConfig()
  const merged = { ...current, ...config }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))

  // Restart check timer if interval changed
  if (config.checkIntervalMs !== undefined || config.autoCheck !== undefined) {
    stopAutoCheck()
    if (merged.autoCheck) startAutoCheck(merged.checkIntervalMs)
  }
}

/* ── Status Management ────────────────────────────────── */

function setStatus(status: UpdateStatus, info?: UpdateInfo, progress?: DownloadProgress): void {
  currentStatus = status
  if (info) currentUpdateInfo = info
  if (progress) currentProgress = progress
  statusListeners.forEach(l => l(status, info || currentUpdateInfo || undefined, progress || currentProgress || undefined))
}

export function getUpdateStatus(): { status: UpdateStatus; info: UpdateInfo | null; progress: DownloadProgress | null } {
  return { status: currentStatus, info: currentUpdateInfo, progress: currentProgress }
}

export function onUpdateStatus(
  listener: (status: UpdateStatus, info?: UpdateInfo, progress?: DownloadProgress) => void
): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

/* ── Core Actions ─────────────────────────────────────── */

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  if (currentStatus === 'checking' || currentStatus === 'downloading') return null

  setStatus('checking')

  try {
    const result = await api()?.checkForUpdates?.()
    if (result?.updateAvailable) {
      const info: UpdateInfo = {
        version: result.version,
        releaseDate: result.releaseDate || new Date().toISOString(),
        releaseNotes: result.releaseNotes || '',
        mandatory: result.mandatory || false,
        downloadUrl: result.downloadUrl,
        size: result.size,
        sha256: result.sha256,
      }
      setStatus('available', info)

      // Auto-download if configured
      const config = getUpdateConfig()
      if (config.autoDownload) {
        downloadUpdate()
      }

      return info
    } else {
      setStatus('not-available')
      return null
    }
  } catch (err: any) {
    setStatus('error')
    console.error('Update check failed:', err)
    return null
  }
}

export async function downloadUpdate(): Promise<boolean> {
  if (currentStatus !== 'available' || !currentUpdateInfo) return false

  setStatus('downloading')
  currentProgress = { bytesPerSecond: 0, percent: 0, transferred: 0, total: currentUpdateInfo.size || 0 }

  try {
    // Listen for progress events
    const progressUnsub = api()?.onDownloadProgress?.((progress: DownloadProgress) => {
      setStatus('downloading', undefined, progress)
    })

    await api()?.downloadUpdate?.()

    if (progressUnsub) progressUnsub()

    setStatus('downloaded')

    // Auto-install if configured
    const config = getUpdateConfig()
    if (config.autoInstall) {
      installUpdate()
    }

    return true
  } catch (err: any) {
    setStatus('error')
    console.error('Update download failed:', err)
    return false
  }
}

export async function installUpdate(): Promise<void> {
  if (currentStatus !== 'downloaded') return

  setStatus('installing')

  try {
    // This will quit and install
    await api()?.installUpdate?.()
  } catch (err: any) {
    setStatus('error')
    console.error('Update install failed:', err)
  }
}

/* ── Auto-Check Timer ─────────────────────────────────── */

export function startAutoCheck(intervalMs?: number): void {
  stopAutoCheck()
  const interval = intervalMs || getUpdateConfig().checkIntervalMs
  checkTimer = setInterval(() => checkForUpdates(), interval)
}

export function stopAutoCheck(): void {
  if (checkTimer) {
    clearInterval(checkTimer)
    checkTimer = null
  }
}

/* ── Initialize ───────────────────────────────────────── */

export function initAutoUpdater(): () => void {
  const config = getUpdateConfig()

  // Initial check after 30 seconds
  const initialCheck = setTimeout(() => {
    if (config.autoCheck) checkForUpdates()
  }, 30000)

  // Start periodic checks
  if (config.autoCheck) {
    startAutoCheck(config.checkIntervalMs)
  }

  // Listen for IPC events from main process
  const unsubAvailable = api()?.onUpdateAvailable?.((info: UpdateInfo) => {
    setStatus('available', info)
  })

  const unsubDownloaded = api()?.onUpdateDownloaded?.(() => {
    setStatus('downloaded')
  })

  const unsubError = api()?.onUpdateError?.((err: string) => {
    setStatus('error')
    console.error('Auto-update error:', err)
  })

  return () => {
    clearTimeout(initialCheck)
    stopAutoCheck()
    unsubAvailable?.()
    unsubDownloaded?.()
    unsubError?.()
  }
}

/* ── Changelog Helpers ────────────────────────────────── */

export function parseReleaseNotes(markdown: string): ReleaseSection[] {
  const sections: ReleaseSection[] = []
  let current: ReleaseSection | null = null

  for (const line of markdown.split('\n')) {
    const headerMatch = line.match(/^#{1,3}\s+(.+)/)
    if (headerMatch) {
      if (current) sections.push(current)
      current = { title: headerMatch[1], items: [] }
    } else if (current && line.trim().startsWith('-')) {
      current.items.push(line.trim().slice(1).trim())
    } else if (current && line.trim().startsWith('*')) {
      current.items.push(line.trim().slice(1).trim())
    }
  }
  if (current) sections.push(current)

  return sections
}

export interface ReleaseSection {
  title: string
  items: string[]
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

export function estimateTimeRemaining(transferred: number, total: number, bytesPerSecond: number): string {
  if (bytesPerSecond <= 0 || total <= transferred) return '--:--'
  const remaining = (total - transferred) / bytesPerSecond
  const minutes = Math.floor(remaining / 60)
  const seconds = Math.floor(remaining % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** Get the current app version */
export function getAppVersion(): string {
  return (window as any).__ORION_VERSION__ || api()?.getVersion?.() || '0.1.0-dev'
}
