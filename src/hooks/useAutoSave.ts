import { useEffect, useRef, useCallback } from 'react'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { useFileHistoryStore } from '@/store/fileHistory'
import { ipcErrorMessage, writeFileChecked } from '@/utils/ipcResult'
import { canAutoSave, needsSaveLocation } from '@/utils/saveGuards'

// ── Types ──────────────────────────────────────────────
export type AutoSaveMode = 'off' | 'afterDelay' | 'onFocusChange' | 'onWindowChange'

export interface AutoSaveSettings {
  autoSaveMode: AutoSaveMode
  autoSaveDelay: number // ms, only used for 'afterDelay'
}

const DEFAULTS: AutoSaveSettings = {
  autoSaveMode: 'afterDelay',
  autoSaveDelay: 1000,
}

function normalizeAutoSaveDelay(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULTS.autoSaveDelay
  if (!Number.isInteger(value) || value < 0) return DEFAULTS.autoSaveDelay
  return value
}

// ── Recovery helpers ──────────────────────────────────
const RECOVERY_INDEX_KEY = 'orion-recovery-index'
const MAX_RECOVERY_FILES = 10

function recoveryKey(filePath: string): string {
  // Simple hash to avoid special characters in keys
  let h = 0
  for (let i = 0; i < filePath.length; i++) {
    h = ((h << 5) - h + filePath.charCodeAt(i)) | 0
  }
  return `orion-recovery-${(h >>> 0).toString(36)}`
}

function getRecoveryIndex(): Record<string, string> {
  try {
    const raw = localStorage.getItem(RECOVERY_INDEX_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function setRecoveryIndex(index: Record<string, string>) {
  try {
    localStorage.setItem(RECOVERY_INDEX_KEY, JSON.stringify(index))
  } catch {
    // localStorage full or unavailable
  }
}

/** Where the fingerprint of the file as it was on disk when its edits began is kept. */
function baseKey(entryKey: string): string {
  return `${entryKey}-base`
}

function setRecoveryBase(filePath: string, diskContent: string) {
  try {
    localStorage.setItem(baseKey(recoveryKey(filePath)), contentHash(diskContent))
  } catch {}
}

function removeEntry(entryKey: string) {
  try {
    localStorage.removeItem(entryKey)
    localStorage.removeItem(baseKey(entryKey))
  } catch {}
}

/** A fingerprint of file text. It only tells whether the text changed; it is not cryptographic. */
function contentHash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${text.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`
}

/** Store file content for crash recovery. Limits to MAX_RECOVERY_FILES entries. */
function storeRecovery(filePath: string, content: string) {
  const key = recoveryKey(filePath)
  const index = getRecoveryIndex()

  const getRecoveryTimestamp = (path: string, recoveryKey: string): number | null => {
    try {
      const raw = localStorage.getItem(recoveryKey)
      if (!raw) return null
      const parsed = JSON.parse(raw) as RecoveryEntry
      return typeof parsed.timestamp === 'number' ? parsed.timestamp : null
    } catch {
      return null
    }
  }

  // If this file isn't already tracked and we're at the limit, evict the oldest
  if (!index[filePath]) {
    const entries = Object.entries(index)
    if (entries.length >= MAX_RECOVERY_FILES) {
      let oldest: { path: string; key: string; timestamp: number } | null = null
      for (const [trackedPath, trackedKey] of entries) {
        const ts = getRecoveryTimestamp(trackedPath, trackedKey)
        if (ts === null) continue
        if (!oldest || ts < oldest.timestamp) {
          oldest = { path: trackedPath, key: trackedKey, timestamp: ts }
        }
      }

      if (!oldest && entries.length > 0) {
        oldest = {
          path: entries[0][0],
          key: entries[0][1],
          timestamp: Date.now(),
        }
      }

      if (oldest) {
        removeEntry(oldest.key)
        delete index[oldest.path]
      }
    }
  }

  index[filePath] = key
  setRecoveryIndex(index)

  try {
    localStorage.setItem(key, JSON.stringify({ path: filePath, content, timestamp: Date.now() }))
  } catch {
    // localStorage full – silently skip
  }
}

/** Clear the recovery entry for a file (its buffer was saved or discarded). */
export function clearRecovery(filePath: string) {
  const index = getRecoveryIndex()
  if (index[filePath]) {
    delete index[filePath]
    setRecoveryIndex(index)
  }
  removeEntry(recoveryKey(filePath))
}

// A recovery copy belongs to a buffer that is open with unsaved edits. Once the
// buffer is closed or reverted (Don't Save, Reload) its edits were discarded on
// purpose: a copy left behind would come back at the next launch as "unsaved
// changes" and then be auto-saved over the file. (A renamed buffer gets a new
// copy under its new path with its next change or backup.) Closing a clean tab
// discards nothing, so it keeps a copy the last session left for that file.
//
// When a buffer's edits begin, its clean content is what it last loaded from
// or saved to disk: that fingerprint lets a restore tell whether the file
// changed since. (Reading the disk instead would mark that content as seen by
// the editor, and the watcher would then drop a real external change.)
useEditorStore.subscribe((state, prev) => {
  if (state.openFiles === prev.openFiles) return
  const current = new Map(state.openFiles.map((f) => [f.path, f]))
  for (const before of prev.openFiles) {
    const after = current.get(before.path)
    if (before.isModified && !after?.isModified) clearRecovery(before.path)
    else if (after && !before.isModified && after.isModified && !needsSaveLocation(before.path)) {
      setRecoveryBase(before.path, before.content)
    }
  }
})

export interface RecoveryEntry {
  path: string
  content: string
  timestamp: number
  /** Fingerprint of the buffer's clean (on-disk) content when the edits began, if known. */
  baseHash?: string
}

/** Check for any pending recovery entries. Returns array of recoverable files. */
export function getRecoveryEntries(): RecoveryEntry[] {
  const index = getRecoveryIndex()
  const entries: RecoveryEntry[] = []

  for (const [filePath, key] of Object.entries(index)) {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const { path, content, timestamp } = JSON.parse(raw) as RecoveryEntry
        const baseHash = localStorage.getItem(baseKey(key)) ?? undefined
        entries.push({ path, content, timestamp, baseHash })
      } else {
        // Stale index entry
        removeEntry(key)
        delete index[filePath]
      }
    } catch {
      removeEntry(key)
      delete index[filePath]
    }
  }

  setRecoveryIndex(index)
  return entries
}

/** Clear all recovery entries. */
export function clearAllRecovery() {
  const index = getRecoveryIndex()
  for (const key of Object.values(index)) removeEntry(key)
  try { localStorage.removeItem(RECOVERY_INDEX_KEY) } catch {}
}

/**
 * Reopen the buffers of `entries` with their unsaved edits. Auto-save may then
 * write a restored buffer only when the file is still exactly what it was when
 * those edits began; otherwise the tab is flagged as changed on disk, so the
 * user compares, keeps or reloads it first.
 */
export async function restoreRecoveryEntries(entries: RecoveryEntry[]): Promise<void> {
  const failures: string[] = []
  for (const entry of entries) {
    const name = entry.path.split(/[\\/]/).pop() || entry.path
    let language = guessLanguage(name)
    let changedOnDisk = false
    if (!needsSaveLocation(entry.path)) {
      let disk: { content: string; language: string }
      try {
        disk = await window.api.readFile(entry.path)
      } catch (err) {
        failures.push(`${name} (${ipcErrorMessage(err)})`)
        continue
      }
      if (disk.content === entry.content) {
        // Nothing unsaved: the file already holds this text.
        clearRecovery(entry.path)
        continue
      }
      language = disk.language
      changedOnDisk = entry.baseHash !== contentHash(disk.content)
    }
    const { openFiles, openFile, updateFileContent, markExternalChange } = useEditorStore.getState()
    // A tab with edits of its own made since launch keeps them.
    if (openFiles.some((f) => f.path === entry.path && f.isModified)) continue
    openFile({ path: entry.path, name, content: entry.content, language, isModified: true, aiModified: false })
    // openFile only activates a tab that is already open.
    updateFileContent(entry.path, entry.content)
    if (changedOnDisk) markExternalChange(entry.path)
  }
  if (failures.length > 0) {
    useToastStore.getState().addToast({ type: 'error', message: `Could not restore ${failures.join(', ')}` })
  }
}

// ── Read settings from localStorage ──────────────────
export function getAutoSaveSettings(): AutoSaveSettings {
  try {
    const stored = localStorage.getItem('orion-editor-settings')
    if (stored) {
      const parsed = JSON.parse(stored)
      // Handle migration from old boolean autoSave
      let mode: AutoSaveMode = DEFAULTS.autoSaveMode
      if (parsed.autoSaveMode && ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'].includes(parsed.autoSaveMode)) {
        mode = parsed.autoSaveMode
      } else if (typeof parsed.autoSave === 'boolean') {
        mode = parsed.autoSave ? 'afterDelay' : 'off'
      }
      return {
        autoSaveMode: mode,
        autoSaveDelay: normalizeAutoSaveDelay(parsed.autoSaveDelay),
      }
    }
  } catch {}
  return { ...DEFAULTS }
}

// ── Auto-save status event ──────────────────────────
function emitAutoSaved() {
  window.dispatchEvent(new CustomEvent('orion:auto-saved'))
}

// ── Perform save for a single file ──────────────────
async function performSave(filePath: string, content: string) {
  // Re-check at fire time: the file may have changed on disk since the save
  // was scheduled. Overwriting it then would silently discard that version.
  if (!canAutoSave(useEditorStore.getState().openFiles.find((f) => f.path === filePath))) return
  try {
    // Take auto-save snapshot (throttled to 5 min intervals in the store)
    useFileHistoryStore.getState().addSnapshot(filePath, content, 'Auto-saved')
    await writeFileChecked(filePath, content, 'Auto-save')
    // Edits typed while the write was in flight are still unsaved.
    const current = useEditorStore.getState().openFiles.find((f) => f.path === filePath)
    if (current && current.content !== content) return
    useEditorStore.getState().markSaved(filePath)
    clearRecovery(filePath)
    emitAutoSaved()
  } catch {
    // Save failed – recovery backup is still in place
  }
}

/** Save all modified files. */
async function saveAllModified() {
  const { openFiles, markSaved } = useEditorStore.getState()
  const modified = openFiles.filter((f) => canAutoSave(f))
  if (modified.length === 0) return

  let savedCount = 0

  await Promise.all(
    modified.map(async (f) => {
      try {
        await writeFileChecked(f.path, f.content, `Auto-save ${f.name}`)
        markSaved(f.path)
        clearRecovery(f.path)
        savedCount++
      } catch {}
    })
  )

  if (savedCount > 0) emitAutoSaved()
}

// ── Recovery backup interval (every 5 seconds for modified files) ──
const RECOVERY_INTERVAL = 5000

// ── Hook ──────────────────────────────────────────────
export function useAutoSave() {
  const settingsRef = useRef<AutoSaveSettings>(getAutoSaveSettings())
  const delayTimerRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Re-read settings when they change
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail) {
        let mode: AutoSaveMode = settingsRef.current.autoSaveMode
        if (detail.autoSaveMode && ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'].includes(detail.autoSaveMode)) {
          mode = detail.autoSaveMode
        } else if (typeof detail.autoSave === 'boolean') {
          mode = detail.autoSave ? 'afterDelay' : 'off'
        }
        settingsRef.current = {
          autoSaveMode: mode,
          autoSaveDelay:
            detail.autoSaveDelay !== undefined
              ? normalizeAutoSaveDelay(detail.autoSaveDelay)
              : settingsRef.current.autoSaveDelay,
        }
      }
    }
    window.addEventListener('orion:editor-config', handler)
    return () => window.removeEventListener('orion:editor-config', handler)
  }, [])

  // Refresh settings on mount
  useEffect(() => {
    settingsRef.current = getAutoSaveSettings()
  }, [])

  // ── afterDelay: called from EditorPanel on content change ──
  const scheduleAutoSave = useCallback((filePath: string, content: string) => {
    // Always store recovery backup immediately on change
    storeRecovery(filePath, content)

    const { autoSaveMode, autoSaveDelay } = settingsRef.current
    if (autoSaveMode !== 'afterDelay') return

    const existingTimer = delayTimerRefs.current.get(filePath)
    if (existingTimer) clearTimeout(existingTimer)

    const timer = setTimeout(async () => {
      delayTimerRefs.current.delete(filePath)
      if (settingsRef.current.autoSaveMode !== 'afterDelay') return
      await performSave(filePath, content)
    }, autoSaveDelay)
    delayTimerRefs.current.set(filePath, timer)
  }, [])

  // ── onFocusChange: save when editor blurs ──
  useEffect(() => {
    const handler = () => {
      if (settingsRef.current.autoSaveMode !== 'onFocusChange') return
      saveAllModified()
    }
    window.addEventListener('orion:editor-blur', handler)
    return () => window.removeEventListener('orion:editor-blur', handler)
  }, [])

  // ── onWindowChange: save when window loses focus ──
  useEffect(() => {
    const handler = () => {
      if (settingsRef.current.autoSaveMode !== 'onWindowChange') return
      saveAllModified()
    }
    window.addEventListener('blur', handler)
    return () => window.removeEventListener('blur', handler)
  }, [])

  // ── Recovery backup: periodically store modified files ──
  useEffect(() => {
    const interval = setInterval(() => {
      const { openFiles } = useEditorStore.getState()
      const modified = openFiles.filter((f) => f.isModified)
      for (const f of modified) {
        storeRecovery(f.path, f.content)
      }
    }, RECOVERY_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      for (const timer of delayTimerRefs.current.values()) {
        clearTimeout(timer)
      }
      delayTimerRefs.current.clear()
    }
  }, [])

  return { scheduleAutoSave }
}

// ── Startup recovery check hook ──────────────────────
export function useRecoveryCheck() {
  useEffect(() => {
    // Short delay so the app is fully rendered
    const timer = setTimeout(() => {
      const entries = getRecoveryEntries()
      if (entries.length === 0) return

      const { addToast } = useToastStore.getState()
      addToast({
        type: 'info',
        message: `Found unsaved changes to ${entries.length} file(s) from the last session.`,
        action: {
          label: 'Restore',
          // The entries stay until the restored buffers are saved or discarded.
          onClick: () => { void restoreRecoveryEntries(entries) },
        },
        secondaryAction: {
          label: 'Discard',
          onClick: () => {
            clearAllRecovery()
          },
        },
        duration: 15000, // show for 15 seconds
      })
    }, 2000)

    return () => clearTimeout(timer)
  }, [])
}

function guessLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact',
    js: 'javascript', jsx: 'javascriptreact',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
    java: 'java', kt: 'kotlin', swift: 'swift',
    cpp: 'cpp', c: 'c', cs: 'csharp', php: 'php',
    html: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml',
    xml: 'xml', sql: 'sql', sh: 'shell', ps1: 'powershell',
  }
  return ext ? (map[ext] || 'plaintext') : 'plaintext'
}
