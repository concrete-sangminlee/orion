import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useFileHistoryStore, formatRelativeTime, formatBytes, triggerLabels } from '@/store/fileHistory'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { useToastStore } from '@/store/toast'
import {
  Clock, RotateCcw, Trash2, X, ChevronDown, ChevronRight,
  Save, Zap, Timer, History, GitCompare, AlertTriangle,
  GitCommit, FileCode, Filter, Eye, ArrowLeftRight,
  Paintbrush, Wrench, HelpCircle, Plus, Minus,
} from 'lucide-react'
import type { FileSnapshot, TimelineEntry, GitCommitEntry, SnapshotTrigger } from '@/store/fileHistory'

// ── Label icon/color mapping ───────────────────────────

const labelConfig: Record<string, { Icon: typeof Save; color: string }> = {
  Saved: { Icon: Save, color: 'var(--accent-green)' },
  'Auto-saved': { Icon: Timer, color: 'var(--accent)' },
  'Before AI edit': { Icon: Zap, color: 'var(--accent-purple, #bc8cff)' },
}

const defaultLabelConfig = { Icon: History, color: 'var(--text-muted)' }

// ── Trigger icon mapping ───────────────────────────────

const triggerIcons: Record<SnapshotTrigger, typeof Save> = {
  'save': Save,
  'auto-save': Timer,
  'format': Paintbrush,
  'refactor': Wrench,
  'ai-edit': Zap,
  'manual': FileCode,
  'unknown': HelpCircle,
}

const triggerColors: Record<SnapshotTrigger, string> = {
  'save': 'var(--accent-green)',
  'auto-save': 'var(--accent)',
  'format': 'var(--accent-orange, #d29922)',
  'refactor': 'var(--accent-purple, #bc8cff)',
  'ai-edit': 'var(--accent-purple, #bc8cff)',
  'manual': 'var(--text-muted)',
  'unknown': 'var(--text-muted)',
}

// ── Inject CSS animations ──────────────────────────────

const styleId = 'timeline-panel-animations'
if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
  const style = document.createElement('style')
  style.id = styleId
  style.textContent = `
    @keyframes tl-fade-in {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes tl-diff-enter {
      from { opacity: 0; max-height: 0; }
      to   { opacity: 1; max-height: 600px; }
    }
    @keyframes tl-preview-enter {
      from { opacity: 0; transform: scale(0.97); }
      to   { opacity: 1; transform: scale(1); }
    }
    @keyframes tl-dot-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(88,166,255,0.3); }
      50% { box-shadow: 0 0 0 4px rgba(88,166,255,0); }
    }
    .tl-entry {
      transition: background 0.12s;
    }
    .tl-entry:hover {
      background: rgba(255,255,255,0.03) !important;
    }
    .tl-entry:hover .tl-actions {
      opacity: 1 !important;
    }
    .tl-entry:hover .tl-dot {
      transform: scale(1.3);
    }
    .tl-btn {
      transition: background 0.1s, color 0.1s, transform 0.1s;
    }
    .tl-btn:hover {
      background: rgba(255,255,255,0.08) !important;
      color: var(--text-primary) !important;
    }
    .tl-btn:active {
      transform: scale(0.92);
    }
    .tl-dot {
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .tl-compare-selected {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    .tl-cleanup-dropdown {
      animation: tl-fade-in 0.12s ease;
    }
    .tl-preview-tooltip {
      animation: tl-preview-enter 0.15s ease;
    }
  `
  document.head.appendChild(style)
}

// ── Simple diff utility ────────────────────────────────

interface DiffLine {
  type: 'same' | 'added' | 'removed'
  text: string
  lineNum?: number
}

function computeSimpleDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: DiffLine[] = []

  // Simple LCS-based diff
  const m = oldLines.length
  const n = newLines.length

  // For performance, if files are very large, just show a summary
  if (m + n > 2000) {
    result.push({ type: 'removed', text: `--- ${m} lines (old version)` })
    result.push({ type: 'added', text: `+++ ${n} lines (current version)` })
    return result
  }

  // Build a simple diff using a greedy approach
  let i = 0
  let j = 0

  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'same', text: oldLines[i], lineNum: j + 1 })
      i++
      j++
    } else {
      // Look ahead for a match
      let foundInNew = -1
      let foundInOld = -1
      const lookAhead = Math.min(10, Math.max(m - i, n - j))

      for (let k = 1; k <= lookAhead; k++) {
        if (j + k < n && oldLines[i] === newLines[j + k]) {
          foundInNew = j + k
          break
        }
        if (i + k < m && oldLines[i + k] === newLines[j]) {
          foundInOld = i + k
          break
        }
      }

      if (foundInNew !== -1) {
        // Lines were added in new
        while (j < foundInNew) {
          result.push({ type: 'added', text: newLines[j] })
          j++
        }
      } else if (foundInOld !== -1) {
        // Lines were removed from old
        while (i < foundInOld) {
          result.push({ type: 'removed', text: oldLines[i] })
          i++
        }
      } else {
        // Replace
        result.push({ type: 'removed', text: oldLines[i] })
        result.push({ type: 'added', text: newLines[j] })
        i++
        j++
      }
    }
  }

  // Remaining old lines (removed)
  while (i < m) {
    result.push({ type: 'removed', text: oldLines[i] })
    i++
  }

  // Remaining new lines (added)
  while (j < n) {
    result.push({ type: 'added', text: newLines[j] })
    j++
  }

  return result
}

/** Count added/removed from a diff */
function countDiffChanges(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.type === 'added') added++
    else if (l.type === 'removed') removed++
  }
  return { added, removed }
}

// ── Confirm dialog component ───────────────────────────

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCancel()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onCancel])

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '16px 20px',
        zIndex: 1000,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        minWidth: 280,
        animation: 'tl-fade-in 0.15s ease',
      }}
    >
      <div className="flex items-start gap-2" style={{ marginBottom: 12 }}>
        <AlertTriangle size={16} style={{ color: 'var(--accent-orange, #d29922)', flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{message}</p>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="tl-btn"
          style={{
            padding: '4px 12px',
            fontSize: 11,
            borderRadius: 4,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="tl-btn"
          style={{
            padding: '4px 12px',
            fontSize: 11,
            borderRadius: 4,
            border: '1px solid var(--accent-red)',
            background: 'rgba(248,81,73,0.1)',
            color: 'var(--accent-red)',
            cursor: 'pointer',
          }}
        >
          Confirm
        </button>
      </div>
    </div>
  )
}

// ── Hover preview tooltip ──────────────────────────────

function SnapshotPreview({ snapshot, anchorRect }: { snapshot: FileSnapshot; anchorRect: DOMRect | null }) {
  if (!anchorRect) return null

  const lines = snapshot.content.split('\n')
  const previewLines = lines.slice(0, 20)

  return (
    <div
      className="tl-preview-tooltip"
      style={{
        position: 'fixed',
        left: anchorRect.right + 8,
        top: Math.min(anchorRect.top, window.innerHeight - 320),
        width: 340,
        maxHeight: 300,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        zIndex: 2000,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--border)',
          fontSize: 10,
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          background: 'var(--bg-tertiary)',
        }}
      >
        <span>{snapshot.label} - {new Date(snapshot.timestamp).toLocaleString()}</span>
        <span>{formatBytes(snapshot.size)}</span>
      </div>
      <div
        style={{
          padding: '6px 10px',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 10,
          lineHeight: 1.5,
          overflowY: 'auto',
          maxHeight: 250,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre',
          scrollbarWidth: 'thin',
        }}
      >
        {previewLines.map((line, i) => (
          <div key={i} style={{ minHeight: 15 }}>
            <span style={{ color: 'var(--text-muted)', opacity: 0.4, display: 'inline-block', width: 28, textAlign: 'right', marginRight: 8 }}>
              {i + 1}
            </span>
            {line}
          </div>
        ))}
        {lines.length > 20 && (
          <div style={{ color: 'var(--text-muted)', opacity: 0.5, fontStyle: 'italic', padding: '4px 0' }}>
            ... {lines.length - 20} more lines
          </div>
        )}
      </div>
    </div>
  )
}

// ── Inline diff viewer ─────────────────────────────────

function InlineDiffView({
  diffLines,
  headerLeft,
  headerRight,
  onClose,
  onRestore,
}: {
  diffLines: DiffLine[]
  headerLeft: string
  headerRight: string
  onClose: () => void
  onRestore?: () => void
}) {
  const { added, removed } = countDiffChanges(diffLines)

  return (
    <div
      style={{
        borderLeft: '2px solid var(--accent)',
        margin: 0,
        background: 'rgba(0,0,0,0.15)',
        animation: 'tl-diff-enter 0.2s ease',
        overflow: 'hidden',
      }}
    >
      {/* Diff header */}
      <div
        className="flex items-center"
        style={{
          padding: '4px 10px',
          borderBottom: '1px solid var(--border)',
          gap: 6,
        }}
      >
        <GitCompare size={11} style={{ color: 'var(--accent)', opacity: 0.7 }} />
        <span style={{ fontSize: 10, color: 'var(--text-muted)', flex: 1 }}>
          {headerLeft} vs {headerRight}
        </span>
        {/* Change stats */}
        <span style={{ fontSize: 9, display: 'flex', gap: 6, marginRight: 4 }}>
          <span style={{ color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: 2 }}>
            <Plus size={9} />
            {added}
          </span>
          <span style={{ color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: 2 }}>
            <Minus size={9} />
            {removed}
          </span>
        </span>
        {onRestore && (
          <button
            className="tl-btn"
            onClick={(e) => {
              e.stopPropagation()
              onRestore()
            }}
            style={{
              padding: '2px 8px',
              fontSize: 10,
              borderRadius: 3,
              border: '1px solid rgba(63,185,80,0.3)',
              background: 'rgba(63,185,80,0.08)',
              color: 'var(--accent-green)',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Restore
          </button>
        )}
        <button
          className="tl-btn"
          onClick={onClose}
          style={{
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 3,
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            background: 'transparent',
          }}
        >
          <X size={11} />
        </button>
      </div>

      {/* Diff lines */}
      <div
        style={{
          maxHeight: 300,
          overflowY: 'auto',
          overflowX: 'auto',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 10,
          lineHeight: 1.6,
          scrollbarWidth: 'thin',
        }}
      >
        {diffLines.length === 0 ? (
          <div
            style={{
              padding: '12px 10px',
              color: 'var(--text-muted)',
              fontStyle: 'italic',
              fontSize: 10,
              textAlign: 'center',
            }}
          >
            No differences - content is identical
          </div>
        ) : (
          diffLines.slice(0, 200).map((line, idx) => (
            <div
              key={idx}
              style={{
                padding: '0 10px',
                whiteSpace: 'pre',
                background:
                  line.type === 'added'
                    ? 'rgba(63,185,80,0.08)'
                    : line.type === 'removed'
                      ? 'rgba(248,81,73,0.08)'
                      : 'transparent',
                color:
                  line.type === 'added'
                    ? 'var(--accent-green)'
                    : line.type === 'removed'
                      ? 'var(--accent-red)'
                      : 'var(--text-muted)',
                borderLeft:
                  line.type === 'added'
                    ? '2px solid rgba(63,185,80,0.4)'
                    : line.type === 'removed'
                      ? '2px solid rgba(248,81,73,0.4)'
                      : '2px solid transparent',
              }}
            >
              <span style={{ opacity: 0.5, display: 'inline-block', width: 14, textAlign: 'right', marginRight: 8 }}>
                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
              </span>
              {line.text}
            </div>
          ))
        )}
        {diffLines.length > 200 && (
          <div
            style={{
              padding: '4px 10px',
              color: 'var(--text-muted)',
              fontSize: 9,
              fontStyle: 'italic',
              textAlign: 'center',
            }}
          >
            ... {diffLines.length - 200} more lines
          </div>
        )}
      </div>
    </div>
  )
}

// ── Cleanup dropdown ───────────────────────────────────

function CleanupDropdown({
  onDeleteOlderThan,
  onKeepLastN,
  onClose,
}: {
  onDeleteOlderThan: (days: number) => void
  onKeepLastN: (n: number) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const menuItemStyle = {
    padding: '5px 10px',
    fontSize: 11,
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    width: '100%',
    textAlign: 'left' as const,
    display: 'block',
    borderRadius: 3,
  }

  return (
    <div
      ref={ref}
      className="tl-cleanup-dropdown"
      style={{
        position: 'absolute',
        top: 30,
        right: 4,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 4,
        zIndex: 1001,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        minWidth: 190,
      }}
    >
      <div style={{ padding: '4px 10px 2px', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 600 }}>
        Delete older than
      </div>
      {[1, 3, 7, 14, 30].map((d) => (
        <button
          key={d}
          className="tl-btn"
          style={menuItemStyle}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent' }}
          onClick={() => { onDeleteOlderThan(d); onClose() }}
        >
          {d} day{d > 1 ? 's' : ''}
        </button>
      ))}
      <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
      <div style={{ padding: '4px 10px 2px', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 600 }}>
        Keep last N snapshots
      </div>
      {[5, 10, 20].map((n) => (
        <button
          key={n}
          className="tl-btn"
          style={menuItemStyle}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent' }}
          onClick={() => { onKeepLastN(n); onClose() }}
        >
          Keep last {n}
        </button>
      ))}
    </div>
  )
}

// ── Main Timeline Panel ────────────────────────────────

export default function TimelinePanel() {
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  const openFiles = useEditorStore((s) => s.openFiles)
  const updateFileContent = useEditorStore((s) => s.updateFileContent)
  const addToast = useToastStore((s) => s.addToast)
  const rootPath = useFileStore((s) => s.rootPath)
  const { getSnapshots, getTimeline, deleteSnapshot, clearFileHistory, restoreSnapshot, deleteOlderThan, keepLastN, addGitCommits } = useFileHistoryStore()

  const [previewId, setPreviewId] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: 'restore' | 'delete' | 'clear'; id?: string } | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [showCleanup, setShowCleanup] = useState(false)
  const [hoveredSnapshotId, setHoveredSnapshotId] = useState<string | null>(null)
  const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null)
  const [compareMode, setCompareMode] = useState(false)
  const [compareSelection, setCompareSelection] = useState<[string | null, string | null]>([null, null])
  const [showGitCommits, setShowGitCommits] = useState(true)

  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load the file's git history so the timeline can show commits next to local snapshots.
  useEffect(() => {
    if (!rootPath || !activeFilePath) return
    let cancelled = false
    window.api.gitFileLog(rootPath, { file: activeFilePath, limit: 20 })
      .then(({ commits }) => {
        if (cancelled) return
        addGitCommits(activeFilePath, commits.map((c): GitCommitEntry => ({
          type: 'git-commit',
          id: c.fullHash,
          hash: c.hash,
          message: c.message,
          author: c.author,
          timestamp: Date.parse(c.date),
        })))
      })
      // Not a repository or git unavailable: the timeline keeps its local snapshots only.
      .catch(() => {})
    return () => { cancelled = true }
  }, [rootPath, activeFilePath, addGitCommits])

  const activeFile = openFiles.find((f) => f.path === activeFilePath)
  const snapshots = useMemo(
    () => (activeFilePath ? getSnapshots(activeFilePath) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeFilePath, useFileHistoryStore((s) => s.snapshots)]
  )

  const timeline = useMemo(
    () => (activeFilePath ? getTimeline(activeFilePath) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeFilePath, useFileHistoryStore((s) => s.snapshots), useFileHistoryStore((s) => s.gitCommits), showGitCommits]
  )

  const displayEntries = useMemo(() => {
    if (showGitCommits) return timeline
    return timeline.filter((e) => e.type === 'snapshot')
  }, [timeline, showGitCommits])

  // Group entries by date
  const groupedEntries = useMemo(() => {
    const groups: { label: string; entries: TimelineEntry[] }[] = []
    const today = new Date()
    const todayStr = today.toDateString()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toDateString()

    let currentGroup: { label: string; entries: TimelineEntry[] } | null = null

    for (const entry of displayEntries) {
      const date = new Date(entry.timestamp)
      const dateStr = date.toDateString()
      let groupLabel: string

      if (dateStr === todayStr) {
        groupLabel = 'Today'
      } else if (dateStr === yesterdayStr) {
        groupLabel = 'Yesterday'
      } else {
        groupLabel = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      }

      if (!currentGroup || currentGroup.label !== groupLabel) {
        currentGroup = { label: groupLabel, entries: [] }
        groups.push(currentGroup)
      }
      currentGroup.entries.push(entry)
    }

    return groups
  }, [displayEntries])

  // Diff computation for preview (snapshot vs current)
  const diffLines = useMemo(() => {
    if (!previewId || !activeFile) return null
    const snapshot = snapshots.find((s) => s.id === previewId)
    if (!snapshot) return null
    return computeSimpleDiff(snapshot.content, activeFile.content)
  }, [previewId, activeFile, snapshots])

  // Compare mode diff
  const compareDiff = useMemo(() => {
    if (!compareMode || !compareSelection[0] || !compareSelection[1]) return null
    const snapA = snapshots.find((s) => s.id === compareSelection[0])
    const snapB = snapshots.find((s) => s.id === compareSelection[1])
    if (!snapA || !snapB) return null
    // Older on left, newer on right
    const [older, newer] = snapA.timestamp <= snapB.timestamp ? [snapA, snapB] : [snapB, snapA]
    return {
      lines: computeSimpleDiff(older.content, newer.content),
      olderLabel: `${older.label} (${formatRelativeTime(older.timestamp)})`,
      newerLabel: `${newer.label} (${formatRelativeTime(newer.timestamp)})`,
      olderId: older.id,
      newerId: newer.id,
    }
  }, [compareMode, compareSelection, snapshots])

  // Hover preview snapshot
  const hoveredSnapshot = useMemo(() => {
    if (!hoveredSnapshotId) return null
    return snapshots.find((s) => s.id === hoveredSnapshotId) || null
  }, [hoveredSnapshotId, snapshots])

  const handleRestore = useCallback(
    (id: string) => {
      const snapshot = restoreSnapshot(id)
      if (snapshot && activeFilePath) {
        updateFileContent(activeFilePath, snapshot.content)
        addToast({
          type: 'success',
          message: `Restored "${snapshot.label}" from ${formatRelativeTime(snapshot.timestamp)}`,
          duration: 2500,
        })
        setPreviewId(null)
        setConfirmAction(null)
      }
    },
    [activeFilePath, restoreSnapshot, updateFileContent, addToast]
  )

  const handleDelete = useCallback(
    (id: string) => {
      deleteSnapshot(id)
      if (previewId === id) setPreviewId(null)
      setConfirmAction(null)
    },
    [deleteSnapshot, previewId]
  )

  const handleClear = useCallback(() => {
    if (activeFilePath) {
      clearFileHistory(activeFilePath)
      setPreviewId(null)
      setConfirmAction(null)
    }
  }, [activeFilePath, clearFileHistory])

  const handleDeleteOlderThan = useCallback((days: number) => {
    if (!activeFilePath) return
    const count = deleteOlderThan(activeFilePath, days)
    addToast({
      type: 'info',
      message: count > 0 ? `Deleted ${count} snapshot${count > 1 ? 's' : ''} older than ${days} day${days > 1 ? 's' : ''}` : 'No snapshots matched that criteria',
      duration: 2500,
    })
  }, [activeFilePath, deleteOlderThan, addToast])

  const handleKeepLastN = useCallback((n: number) => {
    if (!activeFilePath) return
    const count = keepLastN(activeFilePath, n)
    addToast({
      type: 'info',
      message: count > 0 ? `Deleted ${count} older snapshot${count > 1 ? 's' : ''}` : 'No snapshots removed',
      duration: 2500,
    })
  }, [activeFilePath, keepLastN, addToast])

  const handleCompareClick = useCallback((id: string) => {
    setCompareSelection((prev) => {
      if (prev[0] === id) return [null, prev[1]]
      if (prev[1] === id) return [prev[0], null]
      if (!prev[0]) return [id, prev[1]]
      if (!prev[1]) return [prev[0], id]
      // Both selected, replace the first
      return [id, prev[1]]
    })
  }, [])

  const handleHoverEnter = useCallback((snapId: string, el: HTMLElement) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredSnapshotId(snapId)
      setHoveredRect(el.getBoundingClientRect())
    }, 400)
  }, [])

  const handleHoverLeave = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    setHoveredSnapshotId(null)
    setHoveredRect(null)
  }, [])

  if (!activeFilePath) {
    return (
      <div
        className="h-full flex flex-col items-center justify-center"
        style={{ color: 'var(--text-muted)', fontSize: 11 }}
      >
        <Clock size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
        <span>No file open</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" style={{ position: 'relative' }}>
      {/* Header */}
      <div
        className="flex items-center shrink-0"
        style={{
          height: 28,
          padding: '0 8px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-tertiary)',
          gap: 6,
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <Clock size={12} style={{ color: 'var(--accent)', opacity: 0.8 }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.2px' }}>
          TIMELINE
        </span>
        <span
          style={{
            fontSize: 9,
            color: 'var(--text-muted)',
            marginLeft: 4,
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          {snapshots.length > 0 ? snapshots.length : ''}
        </span>
        <span style={{ flex: 1 }} />

        {/* Compare mode toggle */}
        {snapshots.length >= 2 && (
          <button
            className="tl-btn"
            onClick={(e) => {
              e.stopPropagation()
              setCompareMode(!compareMode)
              setCompareSelection([null, null])
            }}
            title={compareMode ? 'Exit compare mode' : 'Compare two snapshots'}
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 3,
              border: 'none',
              cursor: 'pointer',
              color: compareMode ? 'var(--accent)' : 'var(--text-muted)',
              background: compareMode ? 'rgba(88,166,255,0.1)' : 'transparent',
            }}
          >
            <ArrowLeftRight size={11} />
          </button>
        )}

        {/* Git commits toggle */}
        <button
          className="tl-btn"
          onClick={(e) => {
            e.stopPropagation()
            setShowGitCommits(!showGitCommits)
          }}
          title={showGitCommits ? 'Hide git commits' : 'Show git commits'}
          style={{
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 3,
            border: 'none',
            cursor: 'pointer',
            color: showGitCommits ? 'var(--accent-orange, #d29922)' : 'var(--text-muted)',
            background: showGitCommits ? 'rgba(210,153,34,0.1)' : 'transparent',
          }}
        >
          <GitCommit size={11} />
        </button>

        {/* Cleanup dropdown */}
        {snapshots.length > 0 && (
          <button
            className="tl-btn"
            onClick={(e) => {
              e.stopPropagation()
              setShowCleanup(!showCleanup)
            }}
            title="Cleanup options"
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 3,
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              background: 'transparent',
            }}
          >
            <Filter size={11} />
          </button>
        )}

        {snapshots.length > 0 && (
          <button
            className="tl-btn"
            onClick={(e) => {
              e.stopPropagation()
              setConfirmAction({ type: 'clear' })
            }}
            title="Clear all history for this file"
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 3,
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              background: 'transparent',
            }}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>

      {/* Compare mode banner */}
      {compareMode && !collapsed && (
        <div
          style={{
            padding: '4px 10px',
            background: 'rgba(88,166,255,0.08)',
            borderBottom: '1px solid var(--border)',
            fontSize: 10,
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <ArrowLeftRight size={10} />
          <span>
            {!compareSelection[0] && !compareSelection[1]
              ? 'Select two snapshots to compare'
              : compareSelection[0] && !compareSelection[1]
                ? 'Select a second snapshot'
                : 'Comparing selected snapshots'}
          </span>
          <span style={{ flex: 1 }} />
          {(compareSelection[0] || compareSelection[1]) && (
            <button
              className="tl-btn"
              onClick={() => setCompareSelection([null, null])}
              style={{
                padding: '1px 6px',
                fontSize: 9,
                borderRadius: 3,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          )}
        </div>
      )}

      {/* Compare diff result */}
      {compareMode && compareDiff && !collapsed && (
        <InlineDiffView
          diffLines={compareDiff.lines}
          headerLeft={compareDiff.olderLabel}
          headerRight={compareDiff.newerLabel}
          onClose={() => setCompareSelection([null, null])}
        />
      )}

      {/* Content */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          {displayEntries.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center"
              style={{ padding: '24px 16px', color: 'var(--text-muted)' }}
            >
              <History size={20} style={{ opacity: 0.25, marginBottom: 8 }} />
              <span style={{ fontSize: 11 }}>No history yet</span>
              <span style={{ fontSize: 10, opacity: 0.5, marginTop: 4, textAlign: 'center' }}>
                Snapshots will appear here when you save or auto-save this file
              </span>
            </div>
          ) : (
            groupedEntries.map((group) => (
              <div key={group.label}>
                {/* Date group header */}
                <div
                  style={{
                    padding: '6px 10px 2px',
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                    opacity: 0.7,
                  }}
                >
                  {group.label}
                </div>

                {group.entries.map((entry, entryIdx) => {
                  const isLast = entryIdx === group.entries.length - 1

                  // ── Git commit entry ──
                  if (entry.type === 'git-commit') {
                    return (
                      <div
                        key={entry.id}
                        className="tl-entry"
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 0,
                          padding: '4px 0 4px 10px',
                          animation: 'tl-fade-in 0.15s ease',
                        }}
                      >
                        {/* Timeline connector */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0, paddingTop: 2 }}>
                          <div
                            className="tl-dot"
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '2px',
                              background: 'var(--accent-orange, #d29922)',
                              border: '1.5px solid var(--bg-primary)',
                              flexShrink: 0,
                              transform: 'rotate(45deg)',
                            }}
                          />
                          {!isLast && (
                            <div style={{ width: 1, flex: 1, minHeight: 12, background: 'var(--border)', marginTop: 2 }} />
                          )}
                        </div>

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <GitCommit size={10} style={{ color: 'var(--accent-orange, #d29922)', flexShrink: 0 }} />
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {entry.message}
                            </span>
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', opacity: 0.6, display: 'flex', gap: 6, marginTop: 1 }}>
                            <span>{formatRelativeTime(entry.timestamp)}</span>
                            <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{entry.hash.substring(0, 7)}</span>
                            <span>{entry.author}</span>
                          </div>
                        </div>
                      </div>
                    )
                  }

                  // ── Snapshot entry ──
                  const snap = entry as FileSnapshot & { type: 'snapshot' }
                  const config = labelConfig[snap.label] || defaultLabelConfig
                  const isPreview = previewId === snap.id
                  const isCompareA = compareSelection[0] === snap.id
                  const isCompareB = compareSelection[1] === snap.id
                  const isCompareSelected = isCompareA || isCompareB
                  const TriggerIcon = triggerIcons[snap.trigger] || triggerIcons.unknown
                  const triggerColor = triggerColors[snap.trigger] || triggerColors.unknown

                  return (
                    <div key={snap.id}>
                      <div
                        className={`tl-entry${isCompareSelected ? ' tl-compare-selected' : ''}`}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 0,
                          padding: '4px 0 4px 10px',
                          cursor: 'pointer',
                          background: isPreview ? 'rgba(88,166,255,0.06)' : isCompareSelected ? 'rgba(88,166,255,0.04)' : 'transparent',
                          animation: 'tl-fade-in 0.15s ease',
                        }}
                        onClick={() => {
                          if (compareMode) {
                            handleCompareClick(snap.id)
                          } else {
                            setPreviewId(isPreview ? null : snap.id)
                          }
                        }}
                        onMouseEnter={(e) => handleHoverEnter(snap.id, e.currentTarget)}
                        onMouseLeave={handleHoverLeave}
                        title={`${snap.label} - ${new Date(snap.timestamp).toLocaleString()}\nSize: ${formatBytes(snap.size)}\nTrigger: ${triggerLabels[snap.trigger]}\nClick to ${compareMode ? 'select for comparison' : 'preview diff'}`}
                      >
                        {/* Timeline dot + connector line */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0, paddingTop: 4 }}>
                          <div
                            className="tl-dot"
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: isPreview ? 'var(--accent)' : isCompareSelected ? 'var(--accent)' : config.color,
                              border: `1.5px solid var(--bg-primary)`,
                              flexShrink: 0,
                              animation: isPreview ? 'tl-dot-pulse 2s ease-in-out infinite' : 'none',
                            }}
                          />
                          {!isLast && (
                            <div style={{ width: 1, flex: 1, minHeight: 16, background: 'var(--border)', marginTop: 2 }} />
                          )}
                        </div>

                        {/* Label + metadata */}
                        <div style={{ flex: 1, minWidth: 0, paddingRight: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <config.Icon
                              size={11}
                              style={{ color: config.color, flexShrink: 0, opacity: 0.8 }}
                            />
                            <span
                              style={{
                                fontSize: 11,
                                color: 'var(--text-secondary)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {snap.label}
                            </span>
                          </div>

                          {/* Change summary line */}
                          <div
                            style={{
                              fontSize: 9,
                              color: 'var(--text-muted)',
                              opacity: 0.6,
                              display: 'flex',
                              gap: 6,
                              marginTop: 1,
                              alignItems: 'center',
                            }}
                          >
                            <span>{formatRelativeTime(snap.timestamp)}</span>
                            <span>{formatBytes(snap.size)}</span>
                            {(snap.linesAdded > 0 || snap.linesRemoved > 0) && (
                              <>
                                <span style={{ color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Plus size={8} />
                                  {snap.linesAdded}
                                </span>
                                <span style={{ color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Minus size={8} />
                                  {snap.linesRemoved}
                                </span>
                              </>
                            )}
                          </div>

                          {/* Trigger badge */}
                          <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                                fontSize: 9,
                                color: triggerColor,
                                background: `color-mix(in srgb, ${triggerColor} 10%, transparent)`,
                                padding: '1px 5px',
                                borderRadius: 3,
                                border: `1px solid color-mix(in srgb, ${triggerColor} 20%, transparent)`,
                              }}
                            >
                              <TriggerIcon size={8} />
                              {triggerLabels[snap.trigger]}
                            </span>
                            {isCompareSelected && (
                              <span
                                style={{
                                  fontSize: 8,
                                  color: 'var(--accent)',
                                  background: 'rgba(88,166,255,0.12)',
                                  padding: '1px 4px',
                                  borderRadius: 3,
                                  fontWeight: 600,
                                }}
                              >
                                {isCompareA ? 'A' : 'B'}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Action buttons (shown on hover via CSS) */}
                        {!compareMode && (
                          <div
                            className="tl-actions"
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 2,
                              opacity: 0,
                              flexShrink: 0,
                              paddingRight: 6,
                            }}
                          >
                            <button
                              className="tl-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmAction({ type: 'restore', id: snap.id })
                              }}
                              title="Restore this version"
                              style={{
                                width: 22,
                                height: 22,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 3,
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--accent-green)',
                                background: 'transparent',
                              }}
                            >
                              <RotateCcw size={11} />
                            </button>
                            <button
                              className="tl-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                setPreviewId(snap.id)
                              }}
                              title="View diff against current"
                              style={{
                                width: 22,
                                height: 22,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 3,
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--accent)',
                                background: 'transparent',
                              }}
                            >
                              <Eye size={11} />
                            </button>
                            <button
                              className="tl-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmAction({ type: 'delete', id: snap.id })
                              }}
                              title="Delete this snapshot"
                              style={{
                                width: 22,
                                height: 22,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 3,
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--accent-red)',
                                background: 'transparent',
                              }}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Inline diff preview (snapshot vs current) */}
                      {isPreview && diffLines && !compareMode && (
                        <InlineDiffView
                          diffLines={diffLines}
                          headerLeft="Snapshot"
                          headerRight="Current"
                          onClose={() => setPreviewId(null)}
                          onRestore={() => setConfirmAction({ type: 'restore', id: snap.id })}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
      )}

      {/* Cleanup dropdown */}
      {showCleanup && (
        <CleanupDropdown
          onDeleteOlderThan={handleDeleteOlderThan}
          onKeepLastN={handleKeepLastN}
          onClose={() => setShowCleanup(false)}
        />
      )}

      {/* Hover preview tooltip */}
      {hoveredSnapshot && !previewId && !compareMode && (
        <SnapshotPreview snapshot={hoveredSnapshot} anchorRect={hoveredRect} />
      )}

      {/* Confirm dialog overlay */}
      {confirmAction && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: 999,
          }}
        >
          <ConfirmDialog
            message={
              confirmAction.type === 'restore'
                ? 'Restore this snapshot? Current unsaved changes will be replaced.'
                : confirmAction.type === 'clear'
                  ? 'Clear all history for this file? This cannot be undone.'
                  : 'Delete this snapshot? This cannot be undone.'
            }
            onConfirm={() => {
              if (confirmAction.type === 'restore' && confirmAction.id) {
                handleRestore(confirmAction.id)
              } else if (confirmAction.type === 'delete' && confirmAction.id) {
                handleDelete(confirmAction.id)
              } else if (confirmAction.type === 'clear') {
                handleClear()
              }
            }}
            onCancel={() => setConfirmAction(null)}
          />
        </div>
      )}
    </div>
  )
}
