import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { Files, Search, GitBranch, Settings, ListTree, RotateCcw, EyeOff } from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { useProblemsStore, getProblemsCount } from '@/store/problems'
import type { FileNode, OpenFile } from '@shared/types'

// Run and Debug, AI Agents, Extensions and Testing were removed: each was a
// simulation (timers, hard-coded catalogues, random test results) with no
// debugger, agent runtime, marketplace or test runner behind it.
type PanelView = 'explorer' | 'search' | 'git' | 'outline'

interface Props {
  activeView: PanelView
  onViewChange: (view: PanelView) => void
  onSettingsClick?: () => void
}

interface ActivityItem {
  view: PanelView
  Icon: typeof Files
  label: string
  shortcut?: string
  badgeKey?: 'git' | 'problems' | 'search'
}

const defaultItems: ActivityItem[] = [
  { view: 'explorer', Icon: Files, label: 'Explorer', shortcut: 'Ctrl+Shift+E' },
  { view: 'search', Icon: Search, label: 'Search', shortcut: 'Ctrl+Shift+F', badgeKey: 'search' },
  { view: 'git', Icon: GitBranch, label: 'Source Control', shortcut: 'Ctrl+Shift+G', badgeKey: 'git' },
  { view: 'outline', Icon: ListTree, label: 'Outline', shortcut: 'Ctrl+Shift+O' },
]

const STORAGE_KEY_ORDER = 'orion:activity-bar-order'
const STORAGE_KEY_HIDDEN = 'orion:activity-bar-hidden'

/** Load persisted item order from localStorage */
function loadPersistedOrder(items: ActivityItem[]): ActivityItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_ORDER)
    if (!stored) return items
    const order: PanelView[] = JSON.parse(stored)
    if (!Array.isArray(order)) return items
    const itemMap = new Map(items.map((i) => [i.view, i]))
    const ordered: ActivityItem[] = []
    for (const view of order) {
      const item = itemMap.get(view)
      if (item) {
        ordered.push(item)
        itemMap.delete(view)
      }
    }
    // Append any new items not in the stored order
    for (const item of itemMap.values()) {
      ordered.push(item)
    }
    return ordered
  } catch {
    return items
  }
}

/** Load hidden items from localStorage */
function loadHiddenItems(): Set<PanelView> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_HIDDEN)
    if (!stored) return new Set()
    const arr: PanelView[] = JSON.parse(stored)
    return new Set(arr)
  } catch {
    return new Set()
  }
}

/* ── Tooltip Component ─────────────────────────────────────────── */
function Tooltip({ label, shortcut, visible, anchorRect }: {
  label: string
  shortcut?: string
  visible: boolean
  anchorRect: DOMRect | null
}) {
  if (!visible || !anchorRect) return null
  return (
    <div
      className="activity-tooltip"
      style={{
        position: 'fixed',
        left: anchorRect.right + 8,
        top: anchorRect.top + anchorRect.height / 2,
        transform: 'translateY(-50%)',
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <span className="activity-tooltip-label">{label}</span>
      {shortcut && <span className="activity-tooltip-shortcut">{shortcut}</span>}
    </div>
  )
}

/* ── Badge Component ───────────────────────────────────────────── */
const Badge = React.memo(function Badge({ count, type }: { count: number; type?: 'error' | 'info' }) {
  const prevCountRef = useRef(count)
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    if (count !== prevCountRef.current && count > 0) {
      setPulse(true)
      const timer = setTimeout(() => setPulse(false), 400)
      prevCountRef.current = count
      return () => clearTimeout(timer)
    }
    prevCountRef.current = count
  }, [count])

  if (count <= 0) return null

  const bg = type === 'error'
    ? 'var(--accent-red, #f85149)'
    : 'var(--accent-blue, #388bfd)'

  return (
    <span
      className={pulse ? 'activity-badge-pulse' : ''}
      style={{
        position: 'absolute',
        top: 4,
        right: 4,
        minWidth: 14,
        height: 14,
        borderRadius: 7,
        background: bg,
        color: '#fff',
        fontSize: 9,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 3px',
        lineHeight: 1,
        pointerEvents: 'none',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
})

/* ── Context Menu Component ────────────────────────────────────── */
function ContextMenu({ x, y, itemLabel, onHide, onReset, onClose }: {
  x: number
  y: number
  itemLabel: string | null
  onHide: () => void
  onReset: () => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="anim-fade-in"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 10000,
        minWidth: 200,
        background: 'var(--bg-secondary, #1e1e1e)',
        border: '1px solid var(--border, #333)',
        borderRadius: 6,
        padding: '4px 0',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
        fontSize: 12,
      }}
    >
      {itemLabel && (
        <button
          onClick={onHide}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '6px 12px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            textAlign: 'left',
            fontSize: 12,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover, rgba(255,255,255,0.06))'
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
          }}
        >
          <EyeOff size={14} strokeWidth={1.4} />
          Hide &quot;{itemLabel}&quot; from Activity Bar
        </button>
      )}
      {itemLabel && (
        <div style={{ height: 1, background: 'var(--border, #333)', margin: '4px 0' }} />
      )}
      <button
        onClick={onReset}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '6px 12px',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: 12,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover, rgba(255,255,255,0.06))'
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
        }}
      >
        <RotateCcw size={14} strokeWidth={1.4} />
        Reset Activity Bar
      </button>
    </div>
  )
}

/* ── Badge type mapping ────────────────────────────────────────── */
function getBadgeType(key?: string): 'error' | 'info' {
  return key === 'problems' ? 'error' : 'info'
}

/* ── Main Component ────────────────────────────────────────────── */
export default function ActivityBar({ activeView, onViewChange, onSettingsClick }: Props) {
  const [hoveredView, setHoveredView] = useState<string | null>(null)
  const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null)
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [items, setItems] = useState<ActivityItem[]>(() => loadPersistedOrder(defaultItems))
  const [hiddenItems, setHiddenItems] = useState<Set<PanelView>>(() => loadHiddenItems())
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; view: PanelView; label: string
  } | null>(null)

  // Badge counts from stores
  const openFiles = useEditorStore((s: { openFiles: OpenFile[] }) => s.openFiles)
  const fileTree = useFileStore((s: { fileTree: FileNode[] }) => s.fileTree)
  const problems = useProblemsStore((s) => s.problems)
  const problemsCounts = useMemo(() => getProblemsCount(problems), [problems])

  // Search result badge, reported by the search panel.
  const [searchResultCount, setSearchResultCount] = useState(0)

  // Listen for external events to update badge state
  useEffect(() => {
    const onSearchResults = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setSearchResultCount(typeof detail?.count === 'number' ? detail.count : 0)
    }

    window.addEventListener('orion:search-results', onSearchResults)
    return () => {
      window.removeEventListener('orion:search-results', onSearchResults)
    }
  }, [])

  // Count files with git status recursively from the file tree
  const countGitFiles = useCallback((nodes: FileNode[]): number => {
    let count = 0
    for (const node of nodes) {
      if (node.gitStatus) count++
      if (node.children) count += countGitFiles(node.children)
    }
    return count
  }, [])

  const gitChangedCount = useMemo(() => {
    const treeCount = countGitFiles(fileTree)
    if (treeCount > 0) return treeCount
    return openFiles.filter((f: OpenFile) => f.isModified || f.aiModified).length
  }, [fileTree, openFiles, countGitFiles])

  const getBadgeCount = useCallback((key?: string): number => {
    switch (key) {
      case 'git':
        return gitChangedCount
      case 'problems':
        return problemsCounts.errors + problemsCounts.warnings
      case 'search':
        return searchResultCount
      default:
        return 0
    }
  }, [gitChangedCount, problemsCounts, searchResultCount])

  // Visible items (filtered by hidden set)
  const visibleItems = useMemo(
    () => items.filter((i) => !hiddenItems.has(i.view)),
    [items, hiddenItems]
  )

  // Persist order to localStorage whenever items change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_ORDER, JSON.stringify(items.map((i) => i.view)))
    } catch { /* ignore quota errors */ }
  }, [items])

  // Persist hidden items to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_HIDDEN, JSON.stringify([...hiddenItems]))
    } catch { /* ignore quota errors */ }
  }, [hiddenItems])

  // Tooltip hover logic with 300ms delay
  const handleMouseEnter = useCallback((view: string, el: HTMLElement) => {
    setHoveredView(view)
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      setTooltipRect(el.getBoundingClientRect())
      setTooltipVisible(true)
    }, 300)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setHoveredView(null)
    setTooltipVisible(false)
    setTooltipRect(null)
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [])

  // Drag reorder handlers (operate on the full items array, using visibleItems indices)
  const handleDragStart = (visibleIdx: number) => {
    setDragIndex(visibleIdx)
  }

  const handleDragOver = (e: React.DragEvent, visibleIdx: number) => {
    e.preventDefault()
    if (dragIndex !== null && dragIndex !== visibleIdx) {
      setDragOverIndex(visibleIdx)
    }
  }

  const handleDrop = (visibleIdx: number) => {
    if (dragIndex !== null && dragIndex !== visibleIdx) {
      // Map visible indices back to full items array
      const dragView = visibleItems[dragIndex]?.view
      const dropView = visibleItems[visibleIdx]?.view
      if (dragView && dropView) {
        const fullDragIdx = items.findIndex((i) => i.view === dragView)
        const fullDropIdx = items.findIndex((i) => i.view === dropView)
        if (fullDragIdx !== -1 && fullDropIdx !== -1) {
          const reordered = [...items]
          const [moved] = reordered.splice(fullDragIdx, 1)
          reordered.splice(fullDropIdx, 0, moved)
          setItems(reordered)
        }
      }
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    setDragOverIndex(null)
  }

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent, view: PanelView, label: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, view, label })
  }, [])

  const handleHideItem = useCallback(() => {
    if (!contextMenu) return
    setHiddenItems((prev) => {
      const next = new Set(prev)
      next.add(contextMenu.view)
      return next
    })
    // If the hidden item was active, switch to the first visible item
    if (activeView === contextMenu.view) {
      const nextVisible = items.find((i) => !hiddenItems.has(i.view) && i.view !== contextMenu.view)
      if (nextVisible) onViewChange(nextVisible.view)
    }
    setContextMenu(null)
  }, [contextMenu, activeView, items, hiddenItems, onViewChange])

  const handleResetBar = useCallback(() => {
    setItems([...defaultItems])
    setHiddenItems(new Set())
    localStorage.removeItem(STORAGE_KEY_ORDER)
    localStorage.removeItem(STORAGE_KEY_HIDDEN)
    setContextMenu(null)
  }, [])

  // Find current tooltip item data
  const hoveredItem = hoveredView
    ? visibleItems.find((i) => i.view === hoveredView)
    : null

  // Bottom items tooltip data
  const bottomTooltipLabel = hoveredView === 'settings' ? 'Settings' : null
  const bottomTooltipShortcut =
    hoveredView === 'settings' ? 'Ctrl+,' : undefined

  return (
    <>
      <Tooltip
        label={hoveredItem?.label ?? bottomTooltipLabel ?? ''}
        shortcut={hoveredItem?.shortcut ?? bottomTooltipShortcut}
        visible={tooltipVisible && (!!hoveredItem || !!bottomTooltipLabel)}
        anchorRect={tooltipRect}
      />

      {/* Context menu portal */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          itemLabel={contextMenu.label}
          onHide={handleHideItem}
          onReset={handleResetBar}
          onClose={() => setContextMenu(null)}
        />
      )}

      <nav
        className="activity-bar shrink-0 flex flex-col items-center"
        style={{
          width: 50,
          background: 'var(--bg-tertiary)',
          borderRight: '1px solid var(--border)',
          paddingTop: 6,
          paddingBottom: 8,
          userSelect: 'none',
        }}
        onContextMenu={(e) => {
          // Right-click on empty area of activity bar
          if ((e.target as HTMLElement).closest('.activity-bar-item')) return
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY, view: 'explorer', label: '' })
        }}
      >
        {/* ── Top panel icons ──────────────────────────────────── */}
        {visibleItems.map(({ view, Icon, label, shortcut, badgeKey }, index) => {
          const isActive = activeView === view
          const isHovered = hoveredView === view
          const badgeCount = getBadgeCount(badgeKey)
          const isDragOver = dragOverIndex === index
          const isDragging = dragIndex === index

          return (
            <button
              key={view}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={handleDragEnd}
              onClick={() => onViewChange(view)}
              onContextMenu={(e) => handleContextMenu(e, view, label)}
              className="activity-bar-item relative flex items-center justify-center"
              aria-label={label}
              title="" /* prevent native tooltip, we render our own */
              style={{
                width: 48,
                height: 48,
                borderLeft: isActive
                  ? '2px solid var(--activity-bar-active-border, var(--accent-blue, #388bfd))'
                  : '2px solid transparent',
                background: isActive
                  ? 'var(--activity-bar-active-bg, rgba(56, 139, 253, 0.08))'
                  : 'transparent',
                color: isActive
                  ? 'var(--text-primary)'
                  : isHovered
                    ? 'var(--text-secondary)'
                    : 'var(--text-muted)',
                transition: 'color 0.15s ease, border-color 0.2s ease, background 0.2s ease, opacity 0.15s ease',
                opacity: isDragging ? 0.4 : 1,
                borderTop: isDragOver ? '2px solid var(--accent-blue, #388bfd)' : '2px solid transparent',
                cursor: 'pointer',
                position: 'relative',
              }}
              onMouseEnter={(e) => handleMouseEnter(view, e.currentTarget)}
              onMouseLeave={handleMouseLeave}
            >
              <Icon size={21} strokeWidth={isActive ? 1.8 : 1.4} className="activity-bar-icon" />

              {/* Badge count (git, problems, search) */}
              <Badge count={badgeCount} type={getBadgeType(badgeKey)} />
            </button>
          )
        })}

        {/* ── Spacer ───────────────────────────────────────────── */}
        <div className="flex-1" />

        {/* ── Bottom section ───────────────────────────────────── */}

        {/* Settings button */}
        <button
          onClick={() => {
            if (onSettingsClick) {
              onSettingsClick()
            } else {
              window.dispatchEvent(new Event('orion:open-settings'))
            }
          }}
          className="activity-bar-item relative flex items-center justify-center"
          aria-label="Settings"
          style={{
            width: 48,
            height: 48,
            borderLeft: '2px solid transparent',
            color: hoveredView === 'settings' ? 'var(--text-secondary)' : 'var(--text-muted)',
            transition: 'color 0.15s ease',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => handleMouseEnter('settings', e.currentTarget)}
          onMouseLeave={handleMouseLeave}
        >
          <Settings size={20} strokeWidth={1.4} className="activity-bar-icon activity-settings-icon" />
        </button>
      </nav>
    </>
  )
}

export type { PanelView }
