import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  X, Pin, PinOff, Columns, Rows, Copy, FolderOpen, ExternalLink,
  ArrowRightLeft, RotateCcw, FileText, GitBranch, AlertCircle,
  Diff, ChevronRight, MoreHorizontal, Maximize2, Lock, Unlock,
  ArrowLeft, ArrowRight, Save, Trash2
} from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { useProblemsStore, getProblemsForFile } from '@/store/problems'

// ─── Injected Styles ───────────────────────────────────────────────────────

const CONTEXT_MENU_STYLES = `
.orion-tab-ctx-menu {
  position: fixed;
  z-index: 10010;
  min-width: 240px;
  max-width: 320px;
  background: var(--bg-secondary, #1e1e1e);
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 5px;
  padding: 4px 0;
  box-shadow: 0 6px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04);
  font-size: 12px;
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  color: var(--text-primary, #cccccc);
  user-select: none;
}

.orion-tab-ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 24px 4px 8px;
  cursor: pointer;
  white-space: nowrap;
  position: relative;
  min-height: 26px;
}

.orion-tab-ctx-item:hover:not(.orion-tab-ctx-disabled) {
  background: var(--accent, #007acc);
  color: #fff;
}

.orion-tab-ctx-item:hover:not(.orion-tab-ctx-disabled) .orion-tab-ctx-keybinding {
  color: rgba(255,255,255,0.7);
}

.orion-tab-ctx-disabled {
  opacity: 0.4;
  cursor: default;
}

.orion-tab-ctx-separator {
  height: 1px;
  background: var(--border, #3c3c3c);
  margin: 4px 8px;
}

.orion-tab-ctx-keybinding {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted, #6e7681);
  padding-left: 24px;
}

.orion-tab-ctx-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.orion-tab-ctx-submenu-arrow {
  margin-left: auto;
  opacity: 0.6;
}

/* Tab decoration badges */
.orion-tab-decoration {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 4px;
  flex-shrink: 0;
}

.orion-tab-decoration-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  border-radius: 7px;
  font-size: 9px;
  font-weight: 700;
  padding: 0 3px;
  line-height: 1;
}

/* Pinned tab icon */
.orion-pinned-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--accent, #007acc);
}

/* Tab wrap container */
.orion-tabs-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
}

.orion-tabs-nowrap {
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
}

.orion-tabs-nowrap::-webkit-scrollbar { display: none; }

/* Tab sizing modes */
.orion-tab-shrink {
  min-width: 60px;
  max-width: 160px;
  flex: 0 1 auto;
}

.orion-tab-fit {
  flex: 0 0 auto;
}

.orion-tab-fixed {
  width: 120px;
  flex: 0 0 120px;
}

/* Preview tab italic */
.orion-tab-preview .orion-tab-label {
  font-style: italic;
}

@keyframes orion-ctx-fade-in {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}

.orion-tab-ctx-menu {
  animation: orion-ctx-fade-in 0.1s ease-out;
}
`

let stylesInjected = false
function injectStyles() {
  if (stylesInjected) return
  stylesInjected = true
  const style = document.createElement('style')
  style.textContent = CONTEXT_MENU_STYLES
  document.head.appendChild(style)
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TabAction {
  id: string
  label: string
  icon?: React.ReactNode
  keybinding?: string
  handler: () => void
  disabled?: boolean
  separator?: boolean
}

export type TabSizingMode = 'shrink' | 'fit' | 'fixed'

export interface TabGroupInfo {
  groupId: string
  tabCount: number
  activeFilePath: string | null
}

export interface TabDecorationInfo {
  gitStatus?: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicting' | null
  isModified: boolean
  hasErrors: boolean
  errorCount: number
  warningCount: number
}

export interface ClosedTab {
  path: string
  name: string
  content: string
  language: string
  closedAt: number
}

export interface TabManagerConfig {
  tabLimit: number
  wrapTabs: boolean
  tabSizing: TabSizingMode
  enablePreviewMode: boolean
  stickyScrollTabs: boolean
  showTabDecorations: boolean
  closeOnMiddleClick: boolean
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_TAB_LIMIT = 20
const CLOSED_TABS_HISTORY_MAX = 20
const LRU_STORAGE_KEY = 'orion-tab-lru'
const CLOSED_TABS_KEY = 'orion-closed-tabs'
const TAB_CONFIG_KEY = 'orion-tab-config'
const SCROLL_POSITIONS_KEY = 'orion-tab-scroll-positions'

const ICON_SIZE = 14

// ─── Persistence Helpers ───────────────────────────────────────────────────

function loadClosedTabs(): ClosedTab[] {
  try {
    const raw = localStorage.getItem(CLOSED_TABS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistClosedTabs(tabs: ClosedTab[]) {
  try {
    localStorage.setItem(CLOSED_TABS_KEY, JSON.stringify(tabs))
  } catch {
    // storage full
  }
}

function loadTabConfig(): TabManagerConfig {
  try {
    const raw = localStorage.getItem(TAB_CONFIG_KEY)
    if (raw) return { ...defaultConfig, ...JSON.parse(raw) }
  } catch {
    // ignore
  }
  return defaultConfig
}

function persistTabConfig(config: TabManagerConfig) {
  try {
    localStorage.setItem(TAB_CONFIG_KEY, JSON.stringify(config))
  } catch {
    // ignore
  }
}

function loadScrollPositions(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SCROLL_POSITIONS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function persistScrollPositions(positions: Record<string, number>) {
  try {
    localStorage.setItem(SCROLL_POSITIONS_KEY, JSON.stringify(positions))
  } catch {
    // ignore
  }
}

function loadLRUOrder(): string[] {
  try {
    const raw = localStorage.getItem(LRU_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistLRUOrder(order: string[]) {
  try {
    localStorage.setItem(LRU_STORAGE_KEY, JSON.stringify(order))
  } catch {
    // ignore
  }
}

const defaultConfig: TabManagerConfig = {
  tabLimit: DEFAULT_TAB_LIMIT,
  wrapTabs: false,
  tabSizing: 'shrink',
  enablePreviewMode: true,
  stickyScrollTabs: true,
  showTabDecorations: true,
  closeOnMiddleClick: true,
}

// ─── Git Status Colors ─────────────────────────────────────────────────────

const gitStatusColors: Record<string, string> = {
  modified: '#e2c08d',
  added: '#73c991',
  deleted: '#c74e39',
  renamed: '#73c991',
  untracked: '#73c991',
  conflicting: '#e51400',
}

const gitStatusLabels: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicting: '!',
}

// ─── Helper: get relative path ─────────────────────────────────────────────

function getRelativePath(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, '/').split('/')
  const srcIdx = parts.findIndex(p => p === 'src')
  if (srcIdx >= 0) return parts.slice(srcIdx).join('/')
  return parts.slice(-3).join('/')
}

function getFileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

// ═══════════════════════════════════════════════════════════════════════════
//  Tab Context Menu Items Generator
// ═══════════════════════════════════════════════════════════════════════════

export interface GetTabContextMenuOptions {
  tabId: string
  filePath: string
  groupId: string
  isPinned: boolean
  isPreview: boolean
  isModified: boolean
  tabIndex: number
  totalTabs: number
  pinnedCount: number
  onClose: (path: string) => void
  onCloseOthers: (path: string) => void
  onCloseAll: () => void
  onCloseToRight: (path: string) => void
  onCloseToLeft: (path: string) => void
  onCloseSaved: () => void
  onCloseAllInGroup: (groupId: string) => void
  onPin: (path: string) => void
  onUnpin: (path: string) => void
  onSplitRight: (path: string) => void
  onSplitDown: (path: string) => void
  onCopyPath: (path: string) => void
  onCopyRelativePath: (path: string) => void
  onRevealInExplorer: (path: string) => void
  onRevealInOS: (path: string) => void
  onReopenClosed: () => void
  onCompareWith: (path: string) => void
  onMoveToNewWindow: (path: string) => void
  hasClosedTabs: boolean
}

export function getTabContextMenuItems(
  tabId: string,
  options: GetTabContextMenuOptions
): TabAction[] {
  const {
    filePath, groupId, isPinned, isPreview, isModified,
    tabIndex, totalTabs, pinnedCount,
    onClose, onCloseOthers, onCloseAll, onCloseToRight, onCloseToLeft,
    onCloseSaved, onCloseAllInGroup,
    onPin, onUnpin, onSplitRight, onSplitDown,
    onCopyPath, onCopyRelativePath, onRevealInExplorer, onRevealInOS,
    onReopenClosed, onCompareWith, onMoveToNewWindow,
    hasClosedTabs,
  } = options

  const tabsToRight = totalTabs - tabIndex - 1
  const tabsToLeft = tabIndex
  const unpinnedToRight = Math.max(0, tabsToRight - Math.max(0, pinnedCount - tabIndex - 1))
  const unpinnedToLeft = Math.max(0, tabsToLeft - Math.min(tabsToLeft, pinnedCount))

  const items: TabAction[] = [
    // ── Close operations ─────────────────────
    {
      id: 'close',
      label: 'Close',
      icon: <X size={ICON_SIZE} />,
      keybinding: 'Ctrl+W',
      handler: () => onClose(filePath),
      disabled: isPinned,
    },
    {
      id: 'close-others',
      label: 'Close Others',
      handler: () => onCloseOthers(filePath),
      disabled: totalTabs <= 1,
    },
    {
      id: 'close-all',
      label: 'Close All',
      keybinding: 'Ctrl+K Ctrl+W',
      handler: () => onCloseAll(),
    },
    {
      id: 'close-to-right',
      label: `Close to the Right (${unpinnedToRight})`,
      handler: () => onCloseToRight(filePath),
      disabled: unpinnedToRight === 0,
    },
    {
      id: 'close-to-left',
      label: `Close to the Left (${unpinnedToLeft})`,
      handler: () => onCloseToLeft(filePath),
      disabled: unpinnedToLeft === 0,
    },
    {
      id: 'sep-close',
      label: '',
      handler: () => {},
      separator: true,
    },
    {
      id: 'close-saved',
      label: 'Close Saved',
      icon: <Save size={ICON_SIZE} />,
      handler: () => onCloseSaved(),
    },
    {
      id: 'close-all-in-group',
      label: 'Close All in Group',
      handler: () => onCloseAllInGroup(groupId),
    },
    {
      id: 'sep-pin',
      label: '',
      handler: () => {},
      separator: true,
    },

    // ── Pin operations ───────────────────────
    isPinned
      ? {
          id: 'unpin',
          label: 'Unpin Tab',
          icon: <PinOff size={ICON_SIZE} />,
          handler: () => onUnpin(filePath),
        }
      : {
          id: 'pin',
          label: 'Pin Tab',
          icon: <Pin size={ICON_SIZE} />,
          handler: () => onPin(filePath),
        },

    {
      id: 'sep-split',
      label: '',
      handler: () => {},
      separator: true,
    },

    // ── Split operations ─────────────────────
    {
      id: 'split-right',
      label: 'Split Right',
      icon: <Columns size={ICON_SIZE} />,
      handler: () => onSplitRight(filePath),
    },
    {
      id: 'split-down',
      label: 'Split Down',
      icon: <Rows size={ICON_SIZE} />,
      handler: () => onSplitDown(filePath),
    },

    {
      id: 'sep-path',
      label: '',
      handler: () => {},
      separator: true,
    },

    // ── Path operations ──────────────────────
    {
      id: 'copy-path',
      label: 'Copy Path',
      icon: <Copy size={ICON_SIZE} />,
      keybinding: 'Ctrl+K Ctrl+P',
      handler: () => onCopyPath(filePath),
    },
    {
      id: 'copy-relative-path',
      label: 'Copy Relative Path',
      icon: <Copy size={ICON_SIZE} />,
      keybinding: 'Ctrl+K Ctrl+Shift+P',
      handler: () => onCopyRelativePath(filePath),
    },

    {
      id: 'sep-reveal',
      label: '',
      handler: () => {},
      separator: true,
    },

    // ── Reveal operations ────────────────────
    {
      id: 'reveal-in-explorer',
      label: 'Reveal in File Explorer',
      icon: <FolderOpen size={ICON_SIZE} />,
      handler: () => onRevealInExplorer(filePath),
    },
    {
      id: 'reveal-in-os',
      label: 'Reveal in OS File Manager',
      icon: <ExternalLink size={ICON_SIZE} />,
      handler: () => onRevealInOS(filePath),
    },

    {
      id: 'sep-misc',
      label: '',
      handler: () => {},
      separator: true,
    },

    // ── Misc operations ──────────────────────
    {
      id: 'reopen-closed',
      label: 'Reopen Closed Editor',
      icon: <RotateCcw size={ICON_SIZE} />,
      keybinding: 'Ctrl+Shift+T',
      handler: () => onReopenClosed(),
      disabled: !hasClosedTabs,
    },
    {
      id: 'compare-with',
      label: 'Compare with...',
      icon: <Diff size={ICON_SIZE} />,
      handler: () => onCompareWith(filePath),
    },
    {
      id: 'move-to-new-window',
      label: 'Move to New Window',
      icon: <Maximize2 size={ICON_SIZE} />,
      handler: () => onMoveToNewWindow(filePath),
    },
  ]

  return items
}

// ═══════════════════════════════════════════════════════════════════════════
//  Tab Decorations Component
// ═══════════════════════════════════════════════════════════════════════════

export interface TabDecorationsProps {
  filePath: string
  isModified: boolean
  hasErrors?: boolean
  errorCount?: number
  warningCount?: number
  gitStatus?: string | null
  showDecorations?: boolean
}

export function TabDecorations({
  filePath,
  isModified,
  hasErrors = false,
  errorCount = 0,
  warningCount = 0,
  gitStatus = null,
  showDecorations = true,
}: TabDecorationsProps) {
  if (!showDecorations) return null

  const hasAnyDecoration = isModified || hasErrors || errorCount > 0 || warningCount > 0 || gitStatus

  if (!hasAnyDecoration) return null

  return (
    <span className="orion-tab-decoration">
      {/* Git status indicator */}
      {gitStatus && gitStatusColors[gitStatus] && (
        <span
          className="orion-tab-decoration-badge"
          style={{
            background: `${gitStatusColors[gitStatus]}22`,
            color: gitStatusColors[gitStatus],
            fontSize: 8,
            fontWeight: 700,
          }}
          title={`Git: ${gitStatus}`}
        >
          {gitStatusLabels[gitStatus] || '?'}
        </span>
      )}

      {/* Error count badge */}
      {errorCount > 0 && (
        <span
          className="orion-tab-decoration-badge"
          style={{
            background: 'rgba(229, 20, 0, 0.15)',
            color: '#f14c4c',
          }}
          title={`${errorCount} error${errorCount > 1 ? 's' : ''}`}
        >
          {errorCount > 99 ? '99+' : errorCount}
        </span>
      )}

      {/* Warning count badge */}
      {warningCount > 0 && errorCount === 0 && (
        <span
          className="orion-tab-decoration-badge"
          style={{
            background: 'rgba(227, 189, 91, 0.15)',
            color: '#cca700',
          }}
          title={`${warningCount} warning${warningCount > 1 ? 's' : ''}`}
        >
          {warningCount > 99 ? '99+' : warningCount}
        </span>
      )}

      {/* Modified indicator dot */}
      {isModified && (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--text-muted, #6e7681)',
            display: 'inline-block',
            flexShrink: 0,
          }}
          title="Unsaved changes"
        />
      )}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  Pinned Tab Icon
// ═══════════════════════════════════════════════════════════════════════════

export function PinnedTabIcon({ size = 12, color }: { size?: number; color?: string }) {
  return (
    <span
      className="orion-pinned-icon"
      title="Pinned"
      style={{ color: color || 'var(--accent, #007acc)' }}
    >
      <Pin size={size} />
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  LRU Tab Manager Hook
// ═══════════════════════════════════════════════════════════════════════════

export function useTabLRU() {
  const [lruOrder, setLruOrder] = useState<string[]>(() => loadLRUOrder())

  const touch = useCallback((path: string) => {
    setLruOrder(prev => {
      const filtered = prev.filter(p => p !== path)
      const updated = [...filtered, path]
      persistLRUOrder(updated)
      return updated
    })
  }, [])

  const remove = useCallback((path: string) => {
    setLruOrder(prev => {
      const updated = prev.filter(p => p !== path)
      persistLRUOrder(updated)
      return updated
    })
  }, [])

  const getLeastRecentlyUsed = useCallback((
    openPaths: string[],
    pinnedPaths: string[],
    count: number
  ): string[] => {
    const unpinned = openPaths.filter(p => !pinnedPaths.includes(p))
    // Sort by LRU order: tabs not in the LRU list come first (oldest),
    // then by position in the LRU array (lower index = less recently used)
    const sorted = [...unpinned].sort((a, b) => {
      const aIdx = lruOrder.indexOf(a)
      const bIdx = lruOrder.indexOf(b)
      if (aIdx === -1 && bIdx === -1) return 0
      if (aIdx === -1) return -1
      if (bIdx === -1) return 1
      return aIdx - bIdx
    })
    return sorted.slice(0, count)
  }, [lruOrder])

  return { touch, remove, getLeastRecentlyUsed, lruOrder }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Closed Tabs History Hook
// ═══════════════════════════════════════════════════════════════════════════

export function useClosedTabsHistory() {
  const [closedTabs, setClosedTabs] = useState<ClosedTab[]>(() => loadClosedTabs())

  const pushClosed = useCallback((tab: ClosedTab) => {
    setClosedTabs(prev => {
      // Deduplicate by path (keep the most recent close)
      const filtered = prev.filter(t => t.path !== tab.path)
      const updated = [...filtered, tab].slice(-CLOSED_TABS_HISTORY_MAX)
      persistClosedTabs(updated)
      return updated
    })
  }, [])

  const popClosed = useCallback((): ClosedTab | null => {
    let result: ClosedTab | null = null
    setClosedTabs(prev => {
      if (prev.length === 0) return prev
      result = prev[prev.length - 1]
      const updated = prev.slice(0, -1)
      persistClosedTabs(updated)
      return updated
    })
    return result
  }, [])

  const clearClosed = useCallback(() => {
    setClosedTabs([])
    persistClosedTabs([])
  }, [])

  return { closedTabs, pushClosed, popClosed, clearClosed, hasClosedTabs: closedTabs.length > 0 }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sticky Scroll Positions Hook
// ═══════════════════════════════════════════════════════════════════════════

export function useStickyScrollTabs(enabled: boolean = true) {
  const [scrollPositions, setScrollPositions] = useState<Record<string, number>>(
    () => loadScrollPositions()
  )

  const saveScrollPosition = useCallback((path: string, position: number) => {
    if (!enabled) return
    setScrollPositions(prev => {
      const updated = { ...prev, [path]: position }
      persistScrollPositions(updated)
      return updated
    })
  }, [enabled])

  const getScrollPosition = useCallback((path: string): number => {
    return scrollPositions[path] ?? 0
  }, [scrollPositions])

  const clearScrollPosition = useCallback((path: string) => {
    setScrollPositions(prev => {
      const updated = { ...prev }
      delete updated[path]
      persistScrollPositions(updated)
      return updated
    })
  }, [])

  return { saveScrollPosition, getScrollPosition, clearScrollPosition }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Tab Config Hook
// ═══════════════════════════════════════════════════════════════════════════

export function useTabConfig() {
  const [config, setConfig] = useState<TabManagerConfig>(() => loadTabConfig())

  const updateConfig = useCallback((partial: Partial<TabManagerConfig>) => {
    setConfig(prev => {
      const updated = { ...prev, ...partial }
      persistTabConfig(updated)
      return updated
    })
  }, [])

  const resetConfig = useCallback(() => {
    setConfig(defaultConfig)
    persistTabConfig(defaultConfig)
  }, [])

  return { config, updateConfig, resetConfig }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Tab Limit Enforcer Hook
// ═══════════════════════════════════════════════════════════════════════════

export function useTabLimitEnforcer(
  tabLimit: number,
  openPaths: string[],
  pinnedPaths: string[],
  onCloseTab: (path: string) => void
) {
  const { getLeastRecentlyUsed } = useTabLRU()

  useEffect(() => {
    if (tabLimit <= 0) return
    const unpinnedCount = openPaths.filter(p => !pinnedPaths.includes(p)).length
    const excess = openPaths.length - tabLimit
    if (excess <= 0) return

    // Only close unpinned tabs
    const toClose = getLeastRecentlyUsed(openPaths, pinnedPaths, Math.min(excess, unpinnedCount))
    toClose.forEach(path => onCloseTab(path))
  }, [openPaths.length, tabLimit, pinnedPaths, openPaths, getLeastRecentlyUsed, onCloseTab])
}

// ═══════════════════════════════════════════════════════════════════════════
//  Context Menu Item Component
// ═══════════════════════════════════════════════════════════════════════════

function ContextMenuItem({
  action,
  onExecute,
  focusIndex,
  index,
}: {
  action: TabAction
  onExecute: (action: TabAction) => void
  focusIndex: number
  index: number
}) {
  if (action.separator) {
    return <div className="orion-tab-ctx-separator" />
  }

  const isFocused = focusIndex === index
  const isDisabled = action.disabled ?? false

  return (
    <div
      className={`orion-tab-ctx-item ${isDisabled ? 'orion-tab-ctx-disabled' : ''}`}
      style={{
        background: isFocused && !isDisabled ? 'var(--accent, #007acc)' : undefined,
        color: isFocused && !isDisabled ? '#fff' : undefined,
      }}
      onClick={() => {
        if (!isDisabled) onExecute(action)
      }}
      onMouseEnter={(e) => {
        // Hover state handled by CSS, but we use this for keyboard navigation sync
      }}
      role="menuitem"
      aria-disabled={isDisabled}
    >
      <span className="orion-tab-ctx-icon">
        {action.icon || <span style={{ width: ICON_SIZE }} />}
      </span>
      <span>{action.label}</span>
      {action.keybinding && (
        <span
          className="orion-tab-ctx-keybinding"
          style={{
            color: isFocused && !isDisabled ? 'rgba(255,255,255,0.7)' : undefined,
          }}
        >
          {action.keybinding}
        </span>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  Tab Group Manager Component
// ═══════════════════════════════════════════════════════════════════════════

export interface TabGroupManagerProps {
  groups: TabGroupInfo[]
  activeGroupId: string
  onSelectGroup: (groupId: string) => void
  onCloseGroup: (groupId: string) => void
  onCreateGroup: (position: 'left' | 'right' | 'top' | 'bottom') => void
}

export function TabGroupManager({
  groups,
  activeGroupId,
  onSelectGroup,
  onCloseGroup,
  onCreateGroup,
}: TabGroupManagerProps) {
  const [hovered, setHovered] = useState<string | null>(null)

  if (groups.length <= 1) return null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '0 4px',
        borderBottom: '1px solid var(--border, #3c3c3c)',
        height: 24,
        fontSize: 10,
        color: 'var(--text-muted, #6e7681)',
        background: 'var(--bg-primary, #1e1e1e)',
      }}
    >
      {groups.map((group, i) => (
        <div
          key={group.groupId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 6px',
            borderRadius: 3,
            cursor: 'pointer',
            background:
              group.groupId === activeGroupId
                ? 'var(--accent, #007acc)'
                : hovered === group.groupId
                  ? 'rgba(255,255,255,0.06)'
                  : 'transparent',
            color:
              group.groupId === activeGroupId
                ? '#fff'
                : 'var(--text-secondary, #8b949e)',
            transition: 'background 0.12s, color 0.12s',
          }}
          onClick={() => onSelectGroup(group.groupId)}
          onMouseEnter={() => setHovered(group.groupId)}
          onMouseLeave={() => setHovered(null)}
        >
          <span style={{ fontWeight: 600 }}>Group {i + 1}</span>
          <span style={{ opacity: 0.6 }}>({group.tabCount})</span>
          {groups.length > 1 && (
            <span
              onClick={(e) => {
                e.stopPropagation()
                onCloseGroup(group.groupId)
              }}
              style={{
                marginLeft: 2,
                opacity: 0.5,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={10} />
            </span>
          )}
        </div>
      ))}
      <div
        style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <button
          onClick={() => onCreateGroup('right')}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted, #6e7681)',
            cursor: 'pointer',
            padding: '1px 4px',
            borderRadius: 2,
            fontSize: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
          title="Split Right"
        >
          <Columns size={10} /> Split
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  Tab Sizing Helper
// ═══════════════════════════════════════════════════════════════════════════

export function getTabSizeClassName(mode: TabSizingMode): string {
  switch (mode) {
    case 'shrink': return 'orion-tab-shrink'
    case 'fit':    return 'orion-tab-fit'
    case 'fixed':  return 'orion-tab-fixed'
    default:       return 'orion-tab-shrink'
  }
}

export function getTabContainerClassName(wrapTabs: boolean): string {
  return wrapTabs ? 'orion-tabs-wrap' : 'orion-tabs-nowrap'
}

// ═══════════════════════════════════════════════════════════════════════════
//  Close to Left Helper
// ═══════════════════════════════════════════════════════════════════════════

export function closeToLeft(
  openFiles: Array<{ path: string }>,
  pinnedPaths: string[],
  targetPath: string
): string[] {
  const idx = openFiles.findIndex(f => f.path === targetPath)
  if (idx <= 0) return []
  return openFiles
    .slice(0, idx)
    .filter(f => !pinnedPaths.includes(f.path))
    .map(f => f.path)
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main EditorTabContextMenu Component
// ═══════════════════════════════════════════════════════════════════════════

export interface EditorTabContextMenuProps {
  visible: boolean
  x: number
  y: number
  tabPath: string
  tabName: string
  tabIndex: number
  groupId: string
  onClose: () => void
}

export default function EditorTabContextMenu({
  visible,
  x,
  y,
  tabPath,
  tabName,
  tabIndex,
  groupId,
  onClose,
}: EditorTabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [adjustedPos, setAdjustedPos] = useState({ x, y })

  // Inject styles on first mount
  useEffect(() => { injectStyles() }, [])

  // Store access
  const {
    openFiles, pinnedTabs, activeFilePath, previewPath,
    closeFile, closeAllFiles, closeOtherFiles, closeToRight, closeSaved,
    pinTab, unpinTab, splitEditor,
  } = useEditorStore()

  const addToast = useToastStore(s => s.addToast)
  const problems = useProblemsStore(s => s.problems)

  // Closed tabs history
  const { closedTabs, pushClosed, popClosed, hasClosedTabs } = useClosedTabsHistory()

  // Compute tab info
  const isPinned = pinnedTabs.includes(tabPath)
  const isPreview = previewPath === tabPath
  const fileData = openFiles.find(f => f.path === tabPath)
  const isModified = fileData?.isModified ?? false
  const totalTabs = openFiles.length
  const pinnedCount = pinnedTabs.length

  // Adjust menu position to stay within viewport
  useEffect(() => {
    if (!visible || !menuRef.current) {
      setAdjustedPos({ x, y })
      return
    }

    requestAnimationFrame(() => {
      if (!menuRef.current) return
      const rect = menuRef.current.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight

      let nx = x
      let ny = y

      if (x + rect.width > vw - 8) {
        nx = Math.max(8, vw - rect.width - 8)
      }
      if (y + rect.height > vh - 8) {
        ny = Math.max(8, vh - rect.height - 8)
      }

      setAdjustedPos({ x: nx, y: ny })
    })
  }, [visible, x, y])

  // Handlers
  const handleClose = useCallback((path: string) => {
    const file = openFiles.find(f => f.path === path)
    if (file) {
      pushClosed({
        path: file.path,
        name: file.name,
        content: file.content,
        language: file.language,
        closedAt: Date.now(),
      })
    }
    closeFile(path)
  }, [openFiles, closeFile, pushClosed])

  const handleCloseOthers = useCallback((path: string) => {
    openFiles.forEach(f => {
      if (f.path !== path && !pinnedTabs.includes(f.path)) {
        pushClosed({
          path: f.path,
          name: f.name,
          content: f.content,
          language: f.language,
          closedAt: Date.now(),
        })
      }
    })
    closeOtherFiles(path)
  }, [openFiles, pinnedTabs, closeOtherFiles, pushClosed])

  const handleCloseAll = useCallback(() => {
    openFiles.forEach(f => {
      if (!pinnedTabs.includes(f.path)) {
        pushClosed({
          path: f.path,
          name: f.name,
          content: f.content,
          language: f.language,
          closedAt: Date.now(),
        })
      }
    })
    closeAllFiles()
  }, [openFiles, pinnedTabs, closeAllFiles, pushClosed])

  const handleCloseToRight = useCallback((path: string) => {
    const idx = openFiles.findIndex(f => f.path === path)
    if (idx === -1) return
    openFiles.forEach((f, i) => {
      if (i > idx && !pinnedTabs.includes(f.path)) {
        pushClosed({
          path: f.path,
          name: f.name,
          content: f.content,
          language: f.language,
          closedAt: Date.now(),
        })
      }
    })
    closeToRight(path)
  }, [openFiles, pinnedTabs, closeToRight, pushClosed])

  const handleCloseToLeft = useCallback((path: string) => {
    const idx = openFiles.findIndex(f => f.path === path)
    if (idx <= 0) return
    const toClose = closeToLeftHelper(openFiles, pinnedTabs, path)
    toClose.forEach(p => {
      const f = openFiles.find(file => file.path === p)
      if (f) {
        pushClosed({
          path: f.path,
          name: f.name,
          content: f.content,
          language: f.language,
          closedAt: Date.now(),
        })
      }
    })
    // Close individually since the store doesn't have a closeToLeft
    toClose.forEach(p => closeFile(p))
  }, [openFiles, pinnedTabs, closeFile, pushClosed])

  const handleCloseSaved = useCallback(() => {
    openFiles.forEach(f => {
      if (!f.isModified && !pinnedTabs.includes(f.path)) {
        pushClosed({
          path: f.path,
          name: f.name,
          content: f.content,
          language: f.language,
          closedAt: Date.now(),
        })
      }
    })
    closeSaved()
  }, [openFiles, pinnedTabs, closeSaved, pushClosed])

  const handleCloseAllInGroup = useCallback((_groupId: string) => {
    // For now, close all from the main group
    handleCloseAll()
  }, [handleCloseAll])

  const handlePin = useCallback((path: string) => {
    pinTab(path)
  }, [pinTab])

  const handleUnpin = useCallback((path: string) => {
    unpinTab(path)
  }, [unpinTab])

  const handleSplitRight = useCallback((path: string) => {
    splitEditor('right', path)
    addToast({ type: 'info', message: `Split editor right: ${getFileName(path)}` })
  }, [splitEditor, addToast])

  const handleSplitDown = useCallback((path: string) => {
    splitEditor('bottom', path)
    addToast({ type: 'info', message: `Split editor down: ${getFileName(path)}` })
  }, [splitEditor, addToast])

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      addToast({ type: 'success', message: 'Path copied to clipboard' })
    }).catch(() => {
      addToast({ type: 'error', message: 'Failed to copy path' })
    })
  }, [addToast])

  const handleCopyRelativePath = useCallback((path: string) => {
    const rel = getRelativePath(path)
    navigator.clipboard.writeText(rel).then(() => {
      addToast({ type: 'success', message: 'Relative path copied to clipboard' })
    }).catch(() => {
      addToast({ type: 'error', message: 'Failed to copy path' })
    })
  }, [addToast])

  const handleRevealInExplorer = useCallback((path: string) => {
    addToast({ type: 'info', message: `Reveal in explorer: ${getFileName(path)}` })
  }, [addToast])

  const handleRevealInOS = useCallback((path: string) => {
    addToast({ type: 'info', message: `Opening OS file manager for: ${getFileName(path)}` })
  }, [addToast])

  const handleReopenClosed = useCallback(() => {
    const tab = popClosed()
    if (tab) {
      const { openFile } = useEditorStore.getState()
      openFile({
        path: tab.path,
        name: tab.name,
        content: tab.content,
        language: tab.language,
        isModified: false,
        aiModified: false,
      })
      addToast({ type: 'info', message: `Reopened: ${tab.name}` })
    }
  }, [popClosed, addToast])

  const handleCompareWith = useCallback((path: string) => {
    addToast({ type: 'info', message: `Compare: select another file to diff against ${getFileName(path)}` })
  }, [addToast])

  const handleMoveToNewWindow = useCallback((path: string) => {
    addToast({ type: 'info', message: `Move to new window: ${getFileName(path)}` })
  }, [addToast])

  // Build menu items
  const menuItems = useMemo(() => {
    if (!visible) return []
    return getTabContextMenuItems(tabPath, {
      tabId: tabPath,
      filePath: tabPath,
      groupId,
      isPinned,
      isPreview,
      isModified,
      tabIndex,
      totalTabs,
      pinnedCount,
      onClose: handleClose,
      onCloseOthers: handleCloseOthers,
      onCloseAll: handleCloseAll,
      onCloseToRight: handleCloseToRight,
      onCloseToLeft: handleCloseToLeft,
      onCloseSaved: handleCloseSaved,
      onCloseAllInGroup: handleCloseAllInGroup,
      onPin: handlePin,
      onUnpin: handleUnpin,
      onSplitRight: handleSplitRight,
      onSplitDown: handleSplitDown,
      onCopyPath: handleCopyPath,
      onCopyRelativePath: handleCopyRelativePath,
      onRevealInExplorer: handleRevealInExplorer,
      onRevealInOS: handleRevealInOS,
      onReopenClosed: handleReopenClosed,
      onCompareWith: handleCompareWith,
      onMoveToNewWindow: handleMoveToNewWindow,
      hasClosedTabs,
    })
  }, [
    visible, tabPath, groupId, isPinned, isPreview, isModified,
    tabIndex, totalTabs, pinnedCount, hasClosedTabs,
    handleClose, handleCloseOthers, handleCloseAll,
    handleCloseToRight, handleCloseToLeft, handleCloseSaved,
    handleCloseAllInGroup, handlePin, handleUnpin,
    handleSplitRight, handleSplitDown, handleCopyPath,
    handleCopyRelativePath, handleRevealInExplorer, handleRevealInOS,
    handleReopenClosed, handleCompareWith, handleMoveToNewWindow,
  ])

  // Non-separator items for keyboard navigation
  const actionableItems = useMemo(
    () => menuItems.filter(item => !item.separator),
    [menuItems]
  )

  // Click outside to close
  useEffect(() => {
    if (!visible) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Use a small delay so the menu can render first
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [visible, onClose])

  // Keyboard navigation
  useEffect(() => {
    if (!visible) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          onClose()
          break
        case 'ArrowDown':
          e.preventDefault()
          setFocusIndex(prev => {
            const next = prev + 1
            return next >= actionableItems.length ? 0 : next
          })
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocusIndex(prev => {
            const next = prev - 1
            return next < 0 ? actionableItems.length - 1 : next
          })
          break
        case 'Enter':
          e.preventDefault()
          if (focusIndex >= 0 && focusIndex < actionableItems.length) {
            const item = actionableItems[focusIndex]
            if (!item.disabled) {
              item.handler()
              onClose()
            }
          }
          break
        case 'Home':
          e.preventDefault()
          setFocusIndex(0)
          break
        case 'End':
          e.preventDefault()
          setFocusIndex(actionableItems.length - 1)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, focusIndex, actionableItems, onClose])

  // Reset focus index when menu opens
  useEffect(() => {
    if (visible) {
      setFocusIndex(-1)
    }
  }, [visible])

  // Scroll context menu on close
  useEffect(() => {
    if (!visible) return
    const handleScroll = () => onClose()
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [visible, onClose])

  if (!visible) return null

  // Map actionable items back to their full index for focus tracking
  let actionableIdx = -1

  return (
    <div
      ref={menuRef}
      className="orion-tab-ctx-menu"
      style={{
        left: adjustedPos.x,
        top: adjustedPos.y,
      }}
      role="menu"
      aria-label="Tab context menu"
    >
      {menuItems.map((item) => {
        if (item.separator) {
          return <div key={item.id} className="orion-tab-ctx-separator" />
        }

        actionableIdx++
        const currentActionIdx = actionableIdx

        return (
          <ContextMenuItem
            key={item.id}
            action={item}
            onExecute={(action) => {
              action.handler()
              onClose()
            }}
            focusIndex={focusIndex}
            index={currentActionIdx}
          />
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  Convenience alias for closeToLeft used internally
// ═══════════════════════════════════════════════════════════════════════════

const closeToLeftHelper = closeToLeft
