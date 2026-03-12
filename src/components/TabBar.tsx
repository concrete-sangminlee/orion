import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { useProblemsStore, getProblemsForFile } from '@/store/problems'
import { X, ChevronLeft, ChevronRight, Pin, MoreHorizontal, Copy, FolderOpen, ArrowRightLeft, Columns, Rows } from 'lucide-react'

// ─── CSS Variables & Keyframes (injected once) ─────────────────────────────

const INJECTED_STYLES = `
.tab-scroll-container::-webkit-scrollbar { display: none; }

@keyframes orion-tab-mod-pulse {
  0%   { transform: scale(1);   opacity: 1; }
  50%  { transform: scale(1.6); opacity: 0.6; }
  100% { transform: scale(1);   opacity: 1; }
}

.orion-mod-dot-pulse {
  animation: orion-tab-mod-pulse 0.6s ease-in-out;
}

@keyframes orion-drop-zone-pulse {
  0%   { opacity: 0.5; }
  50%  { opacity: 1; }
  100% { opacity: 0.5; }
}

.orion-drop-zone-indicator {
  animation: orion-drop-zone-pulse 1.2s ease-in-out infinite;
}
`

// ─── Extension Colors ──────────────────────────────────────────────────────

const extColors: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6', js: '#f1e05a', jsx: '#f1e05a',
  json: '#8b949e', html: '#e34c26', css: '#563d7c', py: '#3572a5',
  rs: '#dea584', go: '#00add8', md: '#083fa1', yaml: '#cb171e',
  yml: '#cb171e', toml: '#9c4121', sh: '#89e051', vue: '#41b883',
  svg: '#ffb13b', scss: '#c6538c', less: '#1d365d', lua: '#000080',
}

// ─── Extension Icons (simple text-based icon labels) ───────────────────────

const extIcons: Record<string, string> = {
  ts: 'TS', tsx: 'TX', js: 'JS', jsx: 'JX',
  json: '{}', html: '<>', css: '#', py: 'Py',
  rs: 'Rs', go: 'Go', md: 'Md', yaml: 'Ym',
  yml: 'Ym', toml: 'Tm', sh: '$', vue: 'V',
  svg: 'Sv', scss: '#s', less: '#l', lua: 'Lu',
}

// ─── Helper: get first few content lines ───────────────────────────────────

function getPreviewLines(content: string | undefined, maxLines = 4): string[] {
  if (!content) return ['(empty)']
  return content.split('\n').slice(0, maxLines).map(l => l.length > 80 ? l.slice(0, 80) + '...' : l)
}

// ─── Helper: get relative path ─────────────────────────────────────────────

function getRelativePath(fullPath: string): string {
  // Try to strip common project-root prefixes
  const parts = fullPath.replace(/\\/g, '/').split('/')
  const srcIdx = parts.findIndex(p => p === 'src')
  if (srcIdx >= 0) return parts.slice(srcIdx).join('/')
  // Fall back to last 3 segments
  return parts.slice(-3).join('/')
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab Preview Tooltip
// ═══════════════════════════════════════════════════════════════════════════

function TabPreviewTooltip({
  file,
  anchorRect,
}: {
  file: { path: string; name: string; content?: string }
  anchorRect: DOMRect
}) {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const dotColor = extColors[ext] || '#8b949e'
  const iconLabel = extIcons[ext] || '?'
  const previewLines = getPreviewLines(file.content)
  const relPath = getRelativePath(file.path)

  const tooltipLeft = Math.max(4, anchorRect.left)
  const tooltipTop = anchorRect.bottom + 6

  return (
    <div
      style={{
        position: 'fixed',
        left: tooltipLeft,
        top: tooltipTop,
        zIndex: 10000,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '8px 10px',
        boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
        minWidth: 220,
        maxWidth: 380,
        pointerEvents: 'none',
      }}
    >
      {/* Header: icon + name + path */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 3,
            background: dotColor,
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {iconLabel}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
          {file.name}
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, wordBreak: 'break-all' }}>
        {relPath}
      </div>

      {/* Content preview */}
      <div
        style={{
          background: 'var(--bg-primary)',
          borderRadius: 4,
          padding: '4px 6px',
          fontSize: 10,
          fontFamily: 'var(--font-mono, "Fira Code", "Cascadia Code", Consolas, monospace)',
          color: 'var(--text-secondary)',
          lineHeight: '15px',
          whiteSpace: 'pre',
          overflow: 'hidden',
          maxHeight: 70,
        }}
      >
        {previewLines.join('\n')}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Inline Close Confirmation Popover
// ═══════════════════════════════════════════════════════════════════════════

function CloseConfirmPopover({
  fileName,
  filePath,
  anchorRect,
  onSave,
  onDontSave,
  onCancel,
}: {
  fileName: string
  filePath: string
  anchorRect: DOMRect | null
  onSave: () => void
  onDontSave: () => void
  onCancel: () => void
}) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onCancel()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onCancel])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  if (!anchorRect) return null

  const left = Math.max(4, anchorRect.left)
  const top = anchorRect.bottom + 2

  const btnBase: React.CSSProperties = {
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 500,
    border: '1px solid var(--border)',
    borderRadius: 4,
    cursor: 'pointer',
    transition: 'background 0.1s, color 0.1s',
  }

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 9999,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '10px 14px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        minWidth: 240,
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 10 }}>
        Save changes to <strong>{fileName}</strong>?
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          onMouseEnter={() => setHoveredBtn('cancel')}
          onMouseLeave={() => setHoveredBtn(null)}
          style={{
            ...btnBase,
            color: 'var(--text-muted)',
            background: hoveredBtn === 'cancel' ? 'rgba(255,255,255,0.08)' : 'transparent',
          }}
        >
          Cancel
        </button>
        <button
          onClick={onDontSave}
          onMouseEnter={() => setHoveredBtn('dontsave')}
          onMouseLeave={() => setHoveredBtn(null)}
          style={{
            ...btnBase,
            color: hoveredBtn === 'dontsave' ? '#f85149' : 'var(--text-secondary)',
            background: hoveredBtn === 'dontsave' ? 'rgba(248,81,73,0.1)' : 'transparent',
          }}
        >
          Don't Save
        </button>
        <button
          onClick={onSave}
          onMouseEnter={() => setHoveredBtn('save')}
          onMouseLeave={() => setHoveredBtn(null)}
          style={{
            ...btnBase,
            color: '#fff',
            background: hoveredBtn === 'save' ? 'var(--accent)' : 'var(--accent)',
            borderColor: 'var(--accent)',
            opacity: hoveredBtn === 'save' ? 1 : 0.9,
          }}
        >
          Save
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab Context Menu (right-click) — expanded with all requested items
// ═══════════════════════════════════════════════════════════════════════════

function TabContextMenu({
  x,
  y,
  filePath,
  onClose,
}: {
  x: number
  y: number
  filePath: string
  onClose: () => void
}) {
  const {
    openFiles,
    closeFile,
    closeAllFiles,
    closeOtherFiles,
    closeToRight,
    closeSaved,
    pinnedTabs,
    pinTab,
    unpinTab,
  } = useEditorStore()
  const { addToast } = useToastStore()
  const menuRef = useRef<HTMLDivElement>(null)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const isTabPinned = pinnedTabs.includes(filePath)
  const fileName = openFiles.find(f => f.path === filePath)?.name || ''

  // Adjust menu position to stay within viewport
  const [adjustedPos, setAdjustedPos] = useState({ x, y })
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      let newX = x
      let newY = y
      if (rect.right > window.innerWidth) newX = window.innerWidth - rect.width - 4
      if (rect.bottom > window.innerHeight) newY = window.innerHeight - rect.height - 4
      if (newX < 0) newX = 4
      if (newY < 0) newY = 4
      setAdjustedPos({ x: newX, y: newY })
    }
  }, [x, y])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const dispatch = (event: string, detail?: any) => window.dispatchEvent(new CustomEvent(event, { detail }))

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      addToast({ type: 'success', message: `Copied ${label}`, duration: 1500 })
    } catch {
      addToast({ type: 'error', message: 'Failed to copy', duration: 1500 })
    }
  }

  const items: Array<{
    id: string
    label: string
    shortcut?: string
    icon?: React.ReactNode
    action: () => void
    danger?: boolean
    disabled?: boolean
  }> = [
    { id: 'close', label: 'Close', shortcut: 'Ctrl+W', action: () => { if (!isTabPinned) closeFile(filePath) }, disabled: isTabPinned },
    { id: 'close-others', label: 'Close Others', action: () => closeOtherFiles(filePath) },
    { id: 'close-right', label: 'Close to the Right', action: () => closeToRight(filePath) },
    { id: 'close-all', label: 'Close All', action: () => closeAllFiles() },
    { id: 'close-saved', label: 'Close Saved', action: () => closeSaved() },
    { id: 'divider0', label: '', action: () => {} },
    { id: 'copy-path', label: 'Copy Path', icon: <Copy size={12} />, action: () => copyToClipboard(filePath, 'path') },
    { id: 'copy-rel-path', label: 'Copy Relative Path', icon: <Copy size={12} />, action: () => copyToClipboard(getRelativePath(filePath), 'relative path') },
    { id: 'reveal', label: 'Reveal in Explorer', icon: <FolderOpen size={12} />, action: () => dispatch('orion:reveal-in-explorer', { path: filePath }) },
    { id: 'divider1', label: '', action: () => {} },
    { id: 'pin', label: isTabPinned ? 'Unpin Tab' : 'Pin Tab', icon: <Pin size={12} />, action: () => isTabPinned ? unpinTab(filePath) : pinTab(filePath) },
    { id: 'divider2', label: '', action: () => {} },
    { id: 'split-right', label: 'Split Right', shortcut: 'Ctrl+\\', icon: <Columns size={12} />, action: () => dispatch('orion:split-editor-right', { path: filePath }) },
    { id: 'split-down', label: 'Split Down', icon: <Rows size={12} />, action: () => dispatch('orion:split-editor-down', { path: filePath }) },
    { id: 'divider3', label: '', action: () => {} },
    { id: 'compare', label: 'Compare with...', icon: <ArrowRightLeft size={12} />, action: () => dispatch('orion:compare-file', { path: filePath }) },
  ]

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: adjustedPos.x,
        top: adjustedPos.y,
        zIndex: 9999,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '4px 0',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        minWidth: 220,
      }}
    >
      {items.map((item) => {
        if (item.id.startsWith('divider')) {
          return (
            <div
              key={item.id}
              style={{
                height: 1,
                background: 'var(--border)',
                margin: '4px 0',
              }}
            />
          )
        }
        const isDisabled = item.disabled
        return (
          <button
            key={item.id}
            onClick={() => {
              if (!isDisabled) {
                item.action()
                onClose()
              }
            }}
            onMouseEnter={() => setHoveredItem(item.id)}
            onMouseLeave={() => setHoveredItem(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '5px 14px',
              fontSize: 12,
              color: isDisabled
                ? 'var(--text-muted)'
                : hoveredItem === item.id
                  ? 'var(--text-primary)'
                  : 'var(--text-secondary)',
              background: !isDisabled && hoveredItem === item.id ? 'rgba(255,255,255,0.06)' : 'transparent',
              border: 'none',
              cursor: isDisabled ? 'default' : 'pointer',
              transition: 'background 0.1s, color 0.1s',
              textAlign: 'left',
              opacity: isDisabled ? 0.4 : 1,
            }}
          >
            {item.icon && (
              <span style={{ width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: 0.7 }}>
                {item.icon}
              </span>
            )}
            {!item.icon && <span style={{ width: 14, flexShrink: 0 }} />}
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.shortcut && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 16 }}>
                {item.shortcut}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab Overflow Dropdown ("..." menu showing all open tabs)
// ═══════════════════════════════════════════════════════════════════════════

function TabOverflowDropdown({
  openFiles,
  activeFilePath,
  pinnedTabs,
  onSelect,
  onClose,
  anchorRect,
}: {
  openFiles: { path: string; name: string; isModified: boolean }[]
  activeFilePath: string | null
  pinnedTabs: string[]
  onSelect: (path: string) => void
  onClose: () => void
  anchorRect: DOMRect | null
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!anchorRect) return null

  const left = Math.min(anchorRect.left, window.innerWidth - 260)
  const top = anchorRect.bottom + 2

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 9999,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '4px 0',
        boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
        minWidth: 200,
        maxWidth: 320,
        maxHeight: 360,
        overflowY: 'auto',
      }}
    >
      <div style={{ padding: '4px 12px 6px', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Open Tabs ({openFiles.length})
      </div>
      {openFiles.map((file) => {
        const isActive = activeFilePath === file.path
        const isPinned = pinnedTabs.includes(file.path)
        const ext = file.name.split('.').pop()?.toLowerCase() || ''
        const dotColor = extColors[ext] || '#8b949e'
        const isHovered = hoveredItem === file.path

        return (
          <button
            key={file.path}
            onClick={() => {
              onSelect(file.path)
              onClose()
            }}
            onMouseEnter={() => setHoveredItem(file.path)}
            onMouseLeave={() => setHoveredItem(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '5px 12px',
              fontSize: 12,
              color: isActive ? 'var(--text-primary)' : isHovered ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: isActive ? 'rgba(255,255,255,0.08)' : isHovered ? 'rgba(255,255,255,0.04)' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.1s',
              borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: dotColor,
                flexShrink: 0,
              }}
            />
            <span className="truncate" style={{ flex: 1, minWidth: 0 }}>
              {file.name}
            </span>
            {isPinned && (
              <Pin size={10} style={{ color: 'var(--text-muted)', flexShrink: 0, transform: 'rotate(45deg)' }} />
            )}
            {file.isModified && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  flexShrink: 0,
                }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab Switcher Overlay (Ctrl+Tab)
// ═══════════════════════════════════════════════════════════════════════════

function TabSwitcherOverlay({
  openFiles,
  activeFilePath,
  onSelect,
  onClose,
  selectedIndex,
}: {
  openFiles: { path: string; name: string; isModified: boolean }[]
  activeFilePath: string | null
  onSelect: (path: string) => void
  onClose: () => void
  selectedIndex: number
}) {
  const overlayRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 9999,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '6px 0',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        minWidth: 280,
        maxWidth: 400,
        maxHeight: 320,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          padding: '6px 14px 8px',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        Open Tabs
      </div>
      {openFiles.map((file, idx) => {
        const isSelected = idx === selectedIndex
        const ext = file.name.split('.').pop()?.toLowerCase() || ''
        const dotColor = extColors[ext] || '#8b949e'

        return (
          <div
            key={file.path}
            onClick={() => {
              onSelect(file.path)
              onClose()
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              fontSize: 12,
              cursor: 'pointer',
              color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: isSelected ? 'rgba(255,255,255,0.08)' : 'transparent',
              borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'background 0.08s',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: dotColor,
                flexShrink: 0,
              }}
            />
            <span className="truncate" style={{ flex: 1, minWidth: 0 }}>
              {file.name}
            </span>
            {file.isModified && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  flexShrink: 0,
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Drop Zone Indicator (for cross-group tab dragging)
// ═══════════════════════════════════════════════════════════════════════════

function DropZoneOverlay({
  position,
  isActive,
}: {
  position: 'left' | 'right' | 'top' | 'bottom' | 'center'
  isActive: boolean
}) {
  if (!isActive) return null

  const positionStyles: Record<string, React.CSSProperties> = {
    left:   { left: 0, top: 0, width: '50%', height: '100%' },
    right:  { right: 0, top: 0, width: '50%', height: '100%' },
    top:    { left: 0, top: 0, width: '100%', height: '50%' },
    bottom: { left: 0, bottom: 0, width: '100%', height: '50%' },
    center: { left: '10%', top: '10%', width: '80%', height: '80%' },
  }

  return (
    <div
      className="orion-drop-zone-indicator"
      style={{
        position: 'absolute',
        ...positionStyles[position],
        background: 'var(--accent)',
        opacity: 0.15,
        borderRadius: 4,
        border: '2px dashed var(--accent)',
        pointerEvents: 'none',
        zIndex: 100,
      }}
    />
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Main TabBar Component
// ═══════════════════════════════════════════════════════════════════════════

export default function TabBar() {
  const {
    openFiles,
    activeFilePath,
    setActiveFile,
    closeFile,
    closeAllFiles,
    reorderFiles,
    pinFile,
    previewPath,
    markSaved,
    pinnedTabs,
    pinTab,
    unpinTab,
    editorGroups,
    activeGroupId,
    createGroup,
    moveTabToGroup,
    splitEditor,
  } = useEditorStore()
  const { addToast } = useToastStore()
  const problems = useProblemsStore((s) => s.problems)

  // ─── Local state ─────────────────────────────────────────────────────────
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)
  const [hoveredCloseBtn, setHoveredCloseBtn] = useState<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const [closeAllHovered, setCloseAllHovered] = useState(false)
  const dragIndexRef = useRef<number>(-1)

  // Close confirmation state
  const [confirmClose, setConfirmClose] = useState<{
    path: string
    name: string
    anchorRect: DOMRect | null
  } | null>(null)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    path: string
  } | null>(null)

  // Tab switcher state
  const [tabSwitcher, setTabSwitcher] = useState(false)
  const [switcherIndex, setSwitcherIndex] = useState(0)
  const ctrlHeld = useRef(false)

  // Tab scroll state
  const [showScrollButtons, setShowScrollButtons] = useState(false)
  const tabContainerRef = useRef<HTMLDivElement>(null)

  // Tab preview tooltip state
  const [previewTooltip, setPreviewTooltip] = useState<{
    path: string
    rect: DOMRect
  } | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Tab overflow dropdown state
  const [overflowDropdown, setOverflowDropdown] = useState<DOMRect | null>(null)
  const overflowBtnRef = useRef<HTMLButtonElement>(null)

  // Modified dot pulse tracking: track paths that just became modified
  const [pulsingPaths, setPulsingPaths] = useState<Set<string>>(new Set())
  const prevModifiedRef = useRef<Set<string>>(new Set())

  // Cross-group drag drop zone state
  const [dragDropZone, setDragDropZone] = useState<'left' | 'right' | 'center' | null>(null)
  const tabBarRef = useRef<HTMLDivElement>(null)

  // ─── Track newly modified files for pulse animation ──────────────────────
  useEffect(() => {
    const currentModified = new Set(openFiles.filter(f => f.isModified).map(f => f.path))
    const newlyModified = new Set<string>()
    currentModified.forEach(p => {
      if (!prevModifiedRef.current.has(p)) {
        newlyModified.add(p)
      }
    })
    prevModifiedRef.current = currentModified

    if (newlyModified.size > 0) {
      setPulsingPaths(prev => {
        const next = new Set(prev)
        newlyModified.forEach(p => next.add(p))
        return next
      })
      // Remove pulse class after animation completes
      const timer = setTimeout(() => {
        setPulsingPaths(prev => {
          const next = new Set(prev)
          newlyModified.forEach(p => next.delete(p))
          return next
        })
      }, 650)
      return () => clearTimeout(timer)
    }
  }, [openFiles])

  // ─── Check if tabs overflow ──────────────────────────────────────────────
  useEffect(() => {
    const container = tabContainerRef.current
    if (!container) return
    const checkOverflow = () => {
      setShowScrollButtons(container.scrollWidth > container.clientWidth)
    }
    checkOverflow()
    const observer = new ResizeObserver(checkOverflow)
    observer.observe(container)
    return () => observer.disconnect()
  }, [openFiles])

  const scrollTabs = (direction: 'left' | 'right') => {
    const container = tabContainerRef.current
    if (!container) return
    container.scrollBy({ left: direction === 'left' ? -150 : 150, behavior: 'smooth' })
  }

  // ─── Auto-scroll active tab into view ────────────────────────────────────
  useEffect(() => {
    if (!activeFilePath || !tabContainerRef.current) return
    const activeTab = tabContainerRef.current.querySelector(`[data-path="${CSS.escape(activeFilePath)}"]`) as HTMLElement
    if (activeTab) {
      activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [activeFilePath])

  // ─── Handle close tab (checks unsaved changes) ──────────────────────────
  const handleCloseTab = useCallback(
    (filePath: string, anchorEl?: HTMLElement) => {
      // Pinned tabs cannot be closed
      if (pinnedTabs.includes(filePath)) {
        addToast({ type: 'info', message: 'Unpin the tab first to close it', duration: 2000 })
        return
      }
      const file = openFiles.find((f) => f.path === filePath)
      if (file && file.isModified) {
        const rect = anchorEl?.getBoundingClientRect() ?? null
        setConfirmClose({ path: filePath, name: file.name, anchorRect: rect })
      } else {
        closeFile(filePath)
      }
    },
    [openFiles, closeFile, pinnedTabs, addToast]
  )

  // ─── Save then close ────────────────────────────────────────────────────
  const handleSaveAndClose = useCallback(
    async (filePath: string) => {
      const file = openFiles.find((f) => f.path === filePath)
      if (file) {
        try {
          await (window as any).api.writeFile(filePath, file.content)
          markSaved(filePath)
          addToast({ type: 'success', message: `Saved ${file.name}`, duration: 1500 })
        } catch {
          // best effort
        }
      }
      closeFile(filePath)
      setConfirmClose(null)
    },
    [openFiles, closeFile, markSaved, addToast]
  )

  // ─── Hover preview handlers ──────────────────────────────────────────────
  const handleTabMouseEnter = useCallback((filePath: string, el: HTMLElement) => {
    setHoveredTab(filePath)
    // Delay showing the tooltip to avoid flicker
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      const rect = el.getBoundingClientRect()
      setPreviewTooltip({ path: filePath, rect })
    }, 600) // 600ms delay before showing preview
  }, [])

  const handleTabMouseLeave = useCallback(() => {
    setHoveredTab(null)
    setHoveredCloseBtn(null)
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setPreviewTooltip(null)
  }, [])

  // ─── Cross-group drop zone handlers ──────────────────────────────────────
  const handleTabBarDragOver = useCallback((e: React.DragEvent) => {
    // Only activate drop zones if dragging from another group or to edges
    if (!e.dataTransfer.types.includes('application/x-orion-tab')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const rect = tabBarRef.current?.getBoundingClientRect()
    if (!rect) return
    const relX = e.clientX - rect.left
    const zoneWidth = 40 // pixels from edge for split drop zones

    if (relX < zoneWidth) {
      setDragDropZone('left')
    } else if (relX > rect.width - zoneWidth) {
      setDragDropZone('right')
    } else {
      setDragDropZone(null)
    }
  }, [])

  const handleTabBarDrop = useCallback((e: React.DragEvent) => {
    const droppedPath = e.dataTransfer.getData('application/x-orion-tab')
    if (!droppedPath) return

    if (dragDropZone === 'left' || dragDropZone === 'right') {
      // Create a new split group and move the tab there
      const position = dragDropZone === 'left' ? 'left' : 'right'
      const newGroupId = splitEditor(position as any, droppedPath)
      // Dispatch event so the editor layout knows to re-render
      window.dispatchEvent(new CustomEvent('orion:split-editor-' + position, { detail: { path: droppedPath } }))
    }

    setDragDropZone(null)
  }, [dragDropZone, splitEditor])

  const handleTabBarDragLeave = useCallback(() => {
    setDragDropZone(null)
  }, [])

  // ─── Tab switcher keyboard handler ───────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
        e.preventDefault()
        if (!tabSwitcher && openFiles.length > 1) {
          ctrlHeld.current = true
          const currentIdx = openFiles.findIndex((f) => f.path === activeFilePath)
          const nextIdx = e.shiftKey
            ? (currentIdx - 1 + openFiles.length) % openFiles.length
            : (currentIdx + 1) % openFiles.length
          setSwitcherIndex(nextIdx)
          setTabSwitcher(true)
        } else if (tabSwitcher) {
          setSwitcherIndex((prev) => {
            const next = e.shiftKey
              ? (prev - 1 + openFiles.length) % openFiles.length
              : (prev + 1) % openFiles.length
            return next
          })
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        if (tabSwitcher && ctrlHeld.current) {
          ctrlHeld.current = false
          const file = openFiles[switcherIndex]
          if (file) {
            setActiveFile(file.path)
          }
          setTabSwitcher(false)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [tabSwitcher, switcherIndex, openFiles, activeFilePath, setActiveFile])

  // ─── Preview tooltip file data ───────────────────────────────────────────
  const previewFile = useMemo(() => {
    if (!previewTooltip) return null
    return openFiles.find(f => f.path === previewTooltip.path) || null
  }, [previewTooltip, openFiles])

  // ─── Render ──────────────────────────────────────────────────────────────

  if (openFiles.length === 0) return null

  return (
    <>
      <style>{INJECTED_STYLES}</style>
      <div
        ref={tabBarRef}
        className="shrink-0 flex items-end"
        onDragOver={handleTabBarDragOver}
        onDrop={handleTabBarDrop}
        onDragLeave={handleTabBarDragLeave}
        style={{
          height: 35,
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border)',
          position: 'relative',
        }}
      >
        {/* Cross-group drop zone indicators */}
        {dragDropZone === 'left' && (
          <div
            className="orion-drop-zone-indicator"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 40,
              height: '100%',
              background: 'var(--accent)',
              opacity: 0.2,
              zIndex: 50,
              borderRight: '2px solid var(--accent)',
              pointerEvents: 'none',
            }}
          />
        )}
        {dragDropZone === 'right' && (
          <div
            className="orion-drop-zone-indicator"
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              width: 40,
              height: '100%',
              background: 'var(--accent)',
              opacity: 0.2,
              zIndex: 50,
              borderLeft: '2px solid var(--accent)',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Left scroll button */}
        {showScrollButtons && (
          <button
            onClick={() => scrollTabs('left')}
            style={{
              height: 35,
              width: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-tertiary)',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              flexShrink: 0,
              padding: 0,
            }}
            title="Scroll tabs left"
          >
            <ChevronLeft size={14} />
          </button>
        )}

        {/* Scrollable tab container */}
        <div
          ref={tabContainerRef}
          className="tab-scroll-container flex items-end"
          onWheel={(e) => {
            e.preventDefault()
            e.currentTarget.scrollLeft += e.deltaY
          }}
          style={{
            flex: 1,
            minWidth: 0,
            height: 35,
            display: 'flex',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
        {openFiles.map((file, index) => {
          const isActive = activeFilePath === file.path
          const isHovered = hoveredTab === file.path
          const isDragOver = dragOverPath === file.path && draggingPath !== file.path
          const isDragging = draggingPath === file.path
          const isPreview = previewPath === file.path && !file.isPinned
          const ext = file.name.split('.').pop()?.toLowerCase() || ''
          const dotColor = extColors[ext] || '#8b949e'
          const isCloseHovered = hoveredCloseBtn === file.path
          const isUserPinned = pinnedTabs.includes(file.path)
          const pinnedCount = openFiles.filter((f) => pinnedTabs.includes(f.path)).length
          const isLastPinned = isUserPinned && index === pinnedCount - 1 && pinnedCount < openFiles.length
          const showCloseX = isUserPinned
            ? false
            : file.isModified ? (isCloseHovered || isActive || isHovered) : (isActive || isHovered)
          const showModDot = !isUserPinned && file.isModified && !isCloseHovered && !(isActive || isHovered)
          const showPinIcon = isUserPinned
          const fileProblems = getProblemsForFile(problems, file.path)
          const hasErrors = fileProblems.some(p => p.severity === 'error')
          const hasWarnings = !hasErrors && fileProblems.some(p => p.severity === 'warning')
          const isPulsing = pulsingPaths.has(file.path)

          return (
            <React.Fragment key={file.path}>
            <div
              draggable={true}
              onDragStart={(e) => {
                dragIndexRef.current = index
                setDraggingPath(file.path)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('application/x-orion-tab', file.path)
                e.dataTransfer.setData('text/plain', file.path)
                // Hide preview tooltip when starting drag
                setPreviewTooltip(null)
                if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (draggingPath !== file.path) {
                  setDragOverPath(file.path)
                }
              }}
              onDragLeave={() => {
                setDragOverPath(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDragOverPath(null)

                // Check if it is a cross-group drop (from dataTransfer)
                const droppedPath = e.dataTransfer.getData('application/x-orion-tab')
                const fromIndex = dragIndexRef.current
                if (fromIndex !== -1 && fromIndex !== index) {
                  reorderFiles(fromIndex, index)
                }
              }}
              onDragEnd={() => {
                setDraggingPath(null)
                setDragOverPath(null)
                dragIndexRef.current = -1
              }}
              data-path={file.path}
              onClick={() => setActiveFile(file.path)}
              onDoubleClick={() => {
                if (isPreview) pinFile(file.path)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                // Hide preview tooltip when opening context menu
                setPreviewTooltip(null)
                if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
                setContextMenu({ x: e.clientX, y: e.clientY, path: file.path })
              }}
              onMouseEnter={(e) => handleTabMouseEnter(file.path, e.currentTarget as HTMLElement)}
              onMouseLeave={handleTabMouseLeave}
              className="shrink-0 flex items-center cursor-pointer"
              style={{
                height: 35,
                paddingLeft: isUserPinned ? 8 : 14,
                paddingRight: isUserPinned ? 6 : 8,
                maxWidth: isUserPinned ? 48 : 200,
                minWidth: 0,
                gap: isUserPinned ? 0 : 6,
                position: 'relative',
                fontSize: 12,
                background: isActive
                  ? 'var(--bg-primary)'
                  : isHovered
                    ? 'rgba(255, 255, 255, 0.03)'
                    : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                transition: 'background 0.1s, color 0.1s',
                borderRight: index < openFiles.length - 1 && !isLastPinned
                  ? '1px solid rgba(255, 255, 255, 0.04)'
                  : 'none',
                borderLeft: isDragOver
                  ? '2px solid var(--accent)'
                  : '2px solid transparent',
                opacity: isDragging ? 0.5 : 1,
              }}
            >
              {/* Active tab bottom highlight */}
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 1,
                    background: 'var(--accent)',
                  }}
                />
              )}

              {/* Inactive tab bottom border */}
              {!isActive && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 1,
                    background: 'var(--border)',
                  }}
                />
              )}

              {/* Language dot icon */}
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: dotColor,
                  flexShrink: 0,
                  opacity: isActive ? 1 : 0.7,
                  transition: 'opacity 0.1s',
                }}
              />

              {/* File name - hidden for pinned tabs (compact mode) */}
              {!isUserPinned && (
                <span
                  className="truncate"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    lineHeight: '35px',
                    fontStyle: isPreview ? 'italic' : 'normal',
                    opacity: isPreview && !isActive ? 0.75 : 1,
                    textDecoration: isPreview ? 'underline dotted' : 'none',
                    textDecorationColor: isPreview ? 'var(--text-muted)' : undefined,
                    textUnderlineOffset: 3,
                  }}
                >
                  {file.name}
                </span>
              )}

              {/* Error/Warning indicator dot */}
              {(hasErrors || hasWarnings) && (
                <span
                  title={hasErrors ? 'File has errors' : 'File has warnings'}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: hasErrors ? '#f85149' : '#d29922',
                    flexShrink: 0,
                    marginLeft: 2,
                    boxShadow: hasErrors ? '0 0 4px #f8514980' : '0 0 4px #d2992280',
                  }}
                />
              )}

              {/* Pin icon for pinned tabs - clicking unpins */}
              {showPinIcon && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    unpinTab(file.path)
                  }}
                  title="Unpin tab (required before closing)"
                  className="flex items-center justify-center"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    border: 'none',
                    padding: 0,
                    marginLeft: 2,
                    color: isActive || isHovered ? 'var(--text-secondary)' : 'var(--text-muted)',
                    background: isHovered ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.1s, color 0.1s',
                    flexShrink: 0,
                    transform: 'rotate(45deg)',
                  }}
                >
                  <Pin size={11} strokeWidth={2} />
                </button>
              )}

              {/* Modified dot / Close button area (unpinned tabs only) */}
              {!isUserPinned && (
                <div
                  onMouseEnter={() => setHoveredCloseBtn(file.path)}
                  onMouseLeave={() => setHoveredCloseBtn(null)}
                  style={{
                    width: 20,
                    height: 20,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                  }}
                >
                  {/* Modified dot with pulse animation */}
                  {showModDot && (
                    <span
                      className={isPulsing ? 'orion-mod-dot-pulse' : ''}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: file.aiModified
                          ? 'var(--accent-green)'
                          : 'var(--accent)',
                      }}
                    />
                  )}

                  {/* Close button X */}
                  {showCloseX && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCloseTab(file.path, e.currentTarget)
                      }}
                      className="flex items-center justify-center"
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        color: 'var(--text-muted)',
                        transition: 'background 0.1s, color 0.1s',
                        background: isCloseHovered ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
                        e.currentTarget.style.color = 'var(--text-primary)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.color = 'var(--text-muted)'
                      }}
                    >
                      <X size={12} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              )}

              {/* Modified indicator for pinned tabs */}
              {isUserPinned && file.isModified && (
                <span
                  className={isPulsing ? 'orion-mod-dot-pulse' : ''}
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 4,
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: file.aiModified
                      ? 'var(--accent-green)'
                      : 'var(--accent)',
                  }}
                />
              )}
            </div>
            {/* Thin vertical separator between pinned and unpinned zones */}
            {isLastPinned && (
              <div
                style={{
                  width: 1,
                  height: 20,
                  alignSelf: 'center',
                  background: 'var(--border)',
                  flexShrink: 0,
                  margin: '0 1px',
                }}
              />
            )}
            </React.Fragment>
          )
        })}

        {/* Fill remaining tab bar space */}
        <div
          className="flex-1"
          style={{
            height: 35,
            minWidth: 20,
            flexShrink: 0,
            borderBottom: '1px solid var(--border)',
          }}
        />
        </div>
        {/* End scrollable tab container */}

        {/* Right scroll button */}
        {showScrollButtons && (
          <button
            onClick={() => scrollTabs('right')}
            style={{
              height: 35,
              width: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-tertiary)',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              flexShrink: 0,
              padding: 0,
            }}
            title="Scroll tabs right"
          >
            <ChevronRight size={14} />
          </button>
        )}

        {/* Overflow "..." dropdown button - shown when tabs overflow */}
        {showScrollButtons && (
          <button
            ref={overflowBtnRef}
            onClick={() => {
              if (overflowDropdown) {
                setOverflowDropdown(null)
              } else {
                const rect = overflowBtnRef.current?.getBoundingClientRect()
                setOverflowDropdown(rect || null)
              }
            }}
            title="Show all open tabs"
            style={{
              height: 35,
              width: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: overflowDropdown ? 'rgba(255,255,255,0.06)' : 'var(--bg-tertiary)',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              color: overflowDropdown ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              flexShrink: 0,
              padding: 0,
              transition: 'background 0.1s, color 0.1s',
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        )}

        {/* Close all tabs button */}
        <div
          style={{
            height: 35,
            display: 'flex',
            alignItems: 'center',
            paddingRight: 6,
            paddingLeft: 4,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <button
            onClick={closeAllFiles}
            title="Close all tabs"
            onMouseEnter={() => setCloseAllHovered(true)}
            onMouseLeave={() => setCloseAllHovered(false)}
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              color: closeAllHovered ? 'var(--text-primary)' : 'var(--text-muted)',
              background: closeAllHovered ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
              transition: 'background 0.1s, color 0.1s',
              cursor: 'pointer',
              border: 'none',
              padding: 0,
            }}
          >
            <X size={10} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Close confirmation popover */}
      {confirmClose && (
        <CloseConfirmPopover
          fileName={confirmClose.name}
          filePath={confirmClose.path}
          anchorRect={confirmClose.anchorRect}
          onSave={() => handleSaveAndClose(confirmClose.path)}
          onDontSave={() => {
            closeFile(confirmClose.path)
            setConfirmClose(null)
          }}
          onCancel={() => setConfirmClose(null)}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          filePath={contextMenu.path}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Tab switcher overlay (Ctrl+Tab) */}
      {tabSwitcher && openFiles.length > 1 && (
        <TabSwitcherOverlay
          openFiles={openFiles}
          activeFilePath={activeFilePath}
          onSelect={(path) => setActiveFile(path)}
          onClose={() => setTabSwitcher(false)}
          selectedIndex={switcherIndex}
        />
      )}

      {/* Tab overflow dropdown */}
      {overflowDropdown && (
        <TabOverflowDropdown
          openFiles={openFiles}
          activeFilePath={activeFilePath}
          pinnedTabs={pinnedTabs}
          onSelect={(path) => setActiveFile(path)}
          onClose={() => setOverflowDropdown(null)}
          anchorRect={overflowDropdown}
        />
      )}

      {/* Tab preview tooltip on hover */}
      {previewTooltip && previewFile && !draggingPath && !contextMenu && (
        <TabPreviewTooltip
          file={previewFile as any}
          anchorRect={previewTooltip.rect}
        />
      )}
    </>
  )
}
