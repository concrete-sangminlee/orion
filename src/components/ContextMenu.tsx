import React, { useState, useCallback, useRef, useEffect, useMemo, createContext, useContext } from 'react'
import {
  Check,
  ChevronRight,
  Copy,
  Clipboard,
  Scissors,
  Trash2,
  FileText,
  FilePlus,
  FolderPlus,
  FolderOpen,
  Pencil,
  RefreshCw,
  Eye,
  Pin,
  Columns,
  Rows,
  X,
  XCircle,
  ArrowRightLeft,
  Terminal,
  Play,
  Code,
  Search,
  Replace,
  MessageSquare,
  Braces,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Indent,
  Outdent,
  WrapText,
  Type,
  Hash,
  GitBranch,
  Paintbrush,
  Download,
  Upload,
  Archive,
  Link2,
  ExternalLink,
  SplitSquareVertical,
  ToggleLeft,
  Maximize2,
  Minimize2,
} from 'lucide-react'

// ─── Injected Styles ─────────────────────────────────────────────────────────

const STYLE_ID = 'orion-context-menu-styles'

function ensureContextMenuStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    @keyframes orion-ctx-fade-in {
      from { opacity: 0; transform: scale(0.96) translateY(-2px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes orion-ctx-fade-out {
      from { opacity: 1; transform: scale(1) translateY(0); }
      to   { opacity: 0; transform: scale(0.96) translateY(-2px); }
    }
    @keyframes orion-ctx-submenu-in {
      from { opacity: 0; transform: translateX(-4px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    .orion-ctx-menu {
      animation: orion-ctx-fade-in 0.12s ease-out forwards;
    }
    .orion-ctx-menu-exit {
      animation: orion-ctx-fade-out 0.08s ease-in forwards;
    }
    .orion-ctx-submenu {
      animation: orion-ctx-submenu-in 0.12s ease-out forwards;
    }
    .orion-ctx-menu::-webkit-scrollbar {
      width: 6px;
    }
    .orion-ctx-menu::-webkit-scrollbar-track {
      background: transparent;
    }
    .orion-ctx-menu::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.1);
      border-radius: 3px;
    }
    .orion-ctx-menu::-webkit-scrollbar-thumb:hover {
      background: rgba(255,255,255,0.2);
    }
  `
  document.head.appendChild(style)
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MenuItem {
  id: string
  label: string
  icon?: React.ReactNode
  keybinding?: string
  disabled?: boolean
  disabledReason?: string
  checked?: boolean
  children?: MenuItem[]
  separator?: boolean
  handler?: () => void
  hidden?: boolean
  customRender?: (item: MenuItem, isActive: boolean) => React.ReactNode
  group?: string
}

export interface ContextMenuPosition {
  x: number
  y: number
}

interface ContextMenuState {
  items: MenuItem[]
  position: ContextMenuPosition
  onClose?: () => void
  context?: Record<string, unknown>
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface ContextMenuContextValue {
  show: (items: MenuItem[], position: ContextMenuPosition, context?: Record<string, unknown>) => void
  hide: () => void
  isVisible: boolean
}

const ContextMenuContext = createContext<ContextMenuContextValue>({
  show: () => {},
  hide: () => {},
  isVisible: false,
})

// ─── Provider ────────────────────────────────────────────────────────────────

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ContextMenuState | null>(null)

  const show = useCallback((items: MenuItem[], position: ContextMenuPosition, context?: Record<string, unknown>) => {
    setState({ items, position, context })
  }, [])

  const hide = useCallback(() => {
    setState(null)
  }, [])

  const value = useMemo(() => ({
    show,
    hide,
    isVisible: state !== null,
  }), [show, hide, state])

  return (
    <ContextMenuContext.Provider value={value}>
      {children}
      {state && (
        <ContextMenu
          items={state.items}
          position={state.position}
          onClose={hide}
        />
      )}
    </ContextMenuContext.Provider>
  )
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useContextMenu() {
  return useContext(ContextMenuContext)
}

/**
 * Hook that wires onContextMenu to the context menu provider.
 * Returns a handler to attach to an element's onContextMenu prop.
 */
export function useContextMenuTrigger(
  itemsOrFactory: MenuItem[] | ((e: React.MouseEvent) => MenuItem[]),
) {
  const { show } = useContextMenu()

  return useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const items = typeof itemsOrFactory === 'function' ? itemsOrFactory(e) : itemsOrFactory
    show(items, { x: e.clientX, y: e.clientY })
  }, [show, itemsOrFactory])
}

// ─── Positioning Helpers ─────────────────────────────────────────────────────

const MENU_MIN_WIDTH = 200
const MENU_MAX_HEIGHT_RATIO = 0.8
const SUBMENU_OFFSET = 2
const EDGE_PADDING = 8

function computeMenuPosition(
  anchor: ContextMenuPosition,
  menuWidth: number,
  menuHeight: number,
): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = anchor.x
  let top = anchor.y

  // Flip horizontally if overflows right edge
  if (left + menuWidth + EDGE_PADDING > vw) {
    left = Math.max(EDGE_PADDING, vw - menuWidth - EDGE_PADDING)
  }
  // Flip vertically if overflows bottom edge
  if (top + menuHeight + EDGE_PADDING > vh) {
    top = Math.max(EDGE_PADDING, vh - menuHeight - EDGE_PADDING)
  }
  return { left, top }
}

function computeSubmenuPosition(
  parentRect: DOMRect,
  submenuWidth: number,
  submenuHeight: number,
): { left: number; top: number; flipX: boolean } {
  const vw = window.innerWidth
  const vh = window.innerHeight

  let left = parentRect.right + SUBMENU_OFFSET
  let flipX = false

  if (left + submenuWidth + EDGE_PADDING > vw) {
    left = parentRect.left - submenuWidth - SUBMENU_OFFSET
    flipX = true
    if (left < EDGE_PADDING) {
      left = EDGE_PADDING
    }
  }

  let top = parentRect.top
  if (top + submenuHeight + EDGE_PADDING > vh) {
    top = Math.max(EDGE_PADDING, vh - submenuHeight - EDGE_PADDING)
  }
  return { left, top, flipX }
}

// ─── Shared Styles ───────────────────────────────────────────────────────────

const menuContainerStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 99999,
  minWidth: MENU_MIN_WIDTH,
  maxWidth: 340,
  backgroundColor: '#252526',
  border: '1px solid #454545',
  borderRadius: 6,
  boxShadow: '0 4px 24px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.3)',
  padding: '4px 0',
  overflow: 'hidden',
  userSelect: 'none',
  outline: 'none',
}

const itemBaseStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '4px 24px 4px 8px',
  margin: '0 4px',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: '#ccc',
  cursor: 'default',
  gap: 8,
  lineHeight: '22px',
  position: 'relative',
  whiteSpace: 'nowrap',
}

const separatorStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: '#454545',
  margin: '4px 8px',
}

const keybindingStyle: React.CSSProperties = {
  marginLeft: 'auto',
  paddingLeft: 24,
  fontSize: 12,
  color: '#888',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}

const iconSlotStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}

// ─── Submenu Item Component ──────────────────────────────────────────────────

interface SubmenuItemProps {
  item: MenuItem
  isActive: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onClick: () => void
  onSubmenuClose: () => void
}

function SubmenuItem({ item, isActive, onMouseEnter, onMouseLeave, onClick, onSubmenuClose }: SubmenuItemProps) {
  const itemRef = useRef<HTMLDivElement>(null)
  const [submenuPos, setSubmenuPos] = useState<{ left: number; top: number } | null>(null)
  const submenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isActive && itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect()
      // Estimate submenu size - refine after render
      const estWidth = 220
      const estHeight = Math.min((item.children?.filter(c => !c.hidden).length || 0) * 28 + 8, window.innerHeight * 0.7)
      const pos = computeSubmenuPosition(rect, estWidth, estHeight)
      setSubmenuPos({ left: pos.left, top: pos.top })
    } else {
      setSubmenuPos(null)
    }
  }, [isActive, item.children])

  // Refine position after submenu renders
  useEffect(() => {
    if (isActive && submenuRef.current && itemRef.current) {
      const subRect = submenuRef.current.getBoundingClientRect()
      const parentRect = itemRef.current.getBoundingClientRect()
      const pos = computeSubmenuPosition(parentRect, subRect.width, subRect.height)
      setSubmenuPos({ left: pos.left, top: pos.top })
    }
  }, [isActive])

  return (
    <>
      <div
        ref={itemRef}
        style={{
          ...itemBaseStyle,
          backgroundColor: isActive ? '#094771' : 'transparent',
          color: item.disabled ? '#666' : '#ccc',
          opacity: item.disabled ? 0.5 : 1,
          cursor: item.disabled ? 'not-allowed' : 'default',
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
        title={item.disabled && item.disabledReason ? item.disabledReason : undefined}
      >
        <span style={iconSlotStyle}>
          {item.checked !== undefined ? (
            item.checked ? <Check size={14} color="#ccc" /> : null
          ) : (
            item.icon || null
          )}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
        <ChevronRight size={12} color="#888" style={{ marginLeft: 8, flexShrink: 0 }} />
      </div>
      {isActive && submenuPos && item.children && (
        <div
          ref={submenuRef}
          className="orion-ctx-submenu"
          style={{
            ...menuContainerStyle,
            position: 'fixed',
            left: submenuPos.left,
            top: submenuPos.top,
            maxHeight: `${Math.floor(window.innerHeight * MENU_MAX_HEIGHT_RATIO)}px`,
            overflowY: 'auto',
          }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          <MenuItemList
            items={item.children.filter(c => !c.hidden)}
            onClose={onSubmenuClose}
            depth={1}
          />
        </div>
      )}
    </>
  )
}

// ─── Menu Item List (recursive) ──────────────────────────────────────────────

interface MenuItemListProps {
  items: MenuItem[]
  onClose: () => void
  depth?: number
}

function MenuItemList({ items, onClose, depth = 0 }: MenuItemListProps) {
  const [activeIndex, setActiveIndex] = useState<number>(-1)
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typeAheadRef = useRef<string>('')
  const typeAheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Visible items for keyboard navigation
  const visibleItems = useMemo(() => items.filter(i => !i.separator && !i.hidden), [items])

  // Clear hover timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      if (typeAheadTimerRef.current) clearTimeout(typeAheadTimerRef.current)
    }
  }, [])

  // Focus container for keyboard events
  useEffect(() => {
    if (depth === 0 && containerRef.current) {
      containerRef.current.focus()
    }
  }, [depth])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        e.stopPropagation()
        setActiveIndex(prev => {
          const next = prev + 1
          return next >= visibleItems.length ? 0 : next
        })
        setActiveSubmenu(null)
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        e.stopPropagation()
        setActiveIndex(prev => {
          const next = prev - 1
          return next < 0 ? visibleItems.length - 1 : next
        })
        setActiveSubmenu(null)
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        e.stopPropagation()
        if (activeIndex >= 0 && activeIndex < visibleItems.length) {
          const item = visibleItems[activeIndex]
          if (item.children && item.children.length > 0 && !item.disabled) {
            setActiveSubmenu(item.id)
          }
        }
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        e.stopPropagation()
        if (activeSubmenu) {
          setActiveSubmenu(null)
        } else if (depth > 0) {
          onClose()
        }
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        e.stopPropagation()
        if (activeIndex >= 0 && activeIndex < visibleItems.length) {
          const item = visibleItems[activeIndex]
          if (item.disabled) break
          if (item.children && item.children.length > 0) {
            setActiveSubmenu(item.id)
          } else if (item.handler) {
            item.handler()
            onClose()
          }
        }
        break
      }
      case 'Escape': {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        break
      }
      case 'Home': {
        e.preventDefault()
        setActiveIndex(0)
        break
      }
      case 'End': {
        e.preventDefault()
        setActiveIndex(visibleItems.length - 1)
        break
      }
      default: {
        // Type-ahead search
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          typeAheadRef.current += e.key.toLowerCase()
          if (typeAheadTimerRef.current) clearTimeout(typeAheadTimerRef.current)
          typeAheadTimerRef.current = setTimeout(() => {
            typeAheadRef.current = ''
          }, 600)

          const query = typeAheadRef.current
          const matchIdx = visibleItems.findIndex(item =>
            item.label.toLowerCase().startsWith(query)
          )
          if (matchIdx >= 0) {
            setActiveIndex(matchIdx)
          }
        }
        break
      }
    }
  }, [visibleItems, activeIndex, activeSubmenu, depth, onClose])

  // Ensure active item is scrolled into view
  useEffect(() => {
    if (activeIndex >= 0 && containerRef.current) {
      const items = containerRef.current.querySelectorAll('[data-ctx-item]')
      const target = items[activeIndex] as HTMLElement | undefined
      if (target) {
        target.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [activeIndex])

  const handleItemMouseEnter = useCallback((item: MenuItem, index: number) => {
    setActiveIndex(index)
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    if (item.children && item.children.length > 0 && !item.disabled) {
      hoverTimerRef.current = setTimeout(() => {
        setActiveSubmenu(item.id)
      }, 150)
    } else {
      // Delay closing submenu slightly to prevent flickering
      hoverTimerRef.current = setTimeout(() => {
        setActiveSubmenu(null)
      }, 100)
    }
  }, [])

  const handleItemMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
  }, [])

  const handleItemClick = useCallback((item: MenuItem) => {
    if (item.disabled) return
    if (item.children && item.children.length > 0) {
      setActiveSubmenu(prev => prev === item.id ? null : item.id)
      return
    }
    if (item.handler) {
      item.handler()
    }
    onClose()
  }, [onClose])

  let visibleIdx = -1

  return (
    <div
      ref={containerRef}
      tabIndex={depth === 0 ? 0 : -1}
      onKeyDown={handleKeyDown}
      style={{ outline: 'none' }}
      role="menu"
      aria-label="Context menu"
    >
      {items.map((item) => {
        if (item.hidden) return null

        if (item.separator) {
          return <div key={item.id} style={separatorStyle} role="separator" />
        }

        visibleIdx++
        const currentIdx = visibleIdx
        const isActive = activeIndex === currentIdx

        if (item.children && item.children.length > 0) {
          return (
            <SubmenuItem
              key={item.id}
              item={item}
              isActive={activeSubmenu === item.id || isActive}
              onMouseEnter={() => handleItemMouseEnter(item, currentIdx)}
              onMouseLeave={handleItemMouseLeave}
              onClick={() => handleItemClick(item)}
              onSubmenuClose={onClose}
            />
          )
        }

        // Custom render
        if (item.customRender) {
          return (
            <div
              key={item.id}
              data-ctx-item
              onMouseEnter={() => handleItemMouseEnter(item, currentIdx)}
              onMouseLeave={handleItemMouseLeave}
              onClick={() => handleItemClick(item)}
              role="menuitem"
              aria-disabled={item.disabled}
            >
              {item.customRender(item, isActive)}
            </div>
          )
        }

        return (
          <div
            key={item.id}
            data-ctx-item
            style={{
              ...itemBaseStyle,
              backgroundColor: isActive ? '#094771' : 'transparent',
              color: item.disabled ? '#666' : '#ccc',
              opacity: item.disabled ? 0.5 : 1,
              cursor: item.disabled ? 'not-allowed' : 'default',
            }}
            onMouseEnter={() => handleItemMouseEnter(item, currentIdx)}
            onMouseLeave={handleItemMouseLeave}
            onClick={() => handleItemClick(item)}
            title={item.disabled && item.disabledReason ? item.disabledReason : undefined}
            role="menuitem"
            aria-disabled={item.disabled}
            aria-checked={item.checked}
          >
            <span style={iconSlotStyle}>
              {item.checked !== undefined ? (
                item.checked ? <Check size={14} color="#ccc" /> : null
              ) : (
                item.icon || null
              )}
            </span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {item.label}
            </span>
            {item.keybinding && (
              <span style={keybindingStyle}>{item.keybinding}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Backdrop ────────────────────────────────────────────────────────────────

function ContextMenuBackdrop({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99998,
        background: 'transparent',
      }}
      onMouseDown={(e) => {
        e.preventDefault()
        onClose()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    />
  )
}

// ─── Main ContextMenu Component ──────────────────────────────────────────────

interface ContextMenuProps {
  items: MenuItem[]
  position: ContextMenuPosition
  onClose: () => void
}

export default function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPos, setAdjustedPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    ensureContextMenuStyles()
  }, [])

  // Compute position once menu renders and we know its size
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      const pos = computeMenuPosition(position, rect.width, rect.height)
      setAdjustedPos(pos)
    }
  }, [position])

  // Close on window blur or resize
  useEffect(() => {
    const handleBlur = () => onClose()
    const handleResize = () => onClose()
    window.addEventListener('blur', handleBlur)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('resize', handleResize)
    }
  }, [onClose])

  const filteredItems = useMemo(() => items.filter(i => !i.hidden), [items])

  // Group items by group label and insert group separators
  const groupedItems = useMemo(() => {
    let lastGroup: string | undefined
    const result: MenuItem[] = []
    for (const item of filteredItems) {
      if (item.group && item.group !== lastGroup && result.length > 0 && !result[result.length - 1].separator) {
        result.push({ id: `sep-${item.group}`, label: '', separator: true })
      }
      lastGroup = item.group
      result.push(item)
    }
    return result
  }, [filteredItems])

  return (
    <>
      <ContextMenuBackdrop onClose={onClose} />
      <div
        ref={menuRef}
        className="orion-ctx-menu"
        style={{
          ...menuContainerStyle,
          left: adjustedPos ? adjustedPos.left : position.x,
          top: adjustedPos ? adjustedPos.top : position.y,
          maxHeight: `${Math.floor(window.innerHeight * MENU_MAX_HEIGHT_RATIO)}px`,
          overflowY: 'auto',
          visibility: adjustedPos ? 'visible' : 'hidden',
        }}
      >
        <MenuItemList items={groupedItems} onClose={onClose} />
      </div>
    </>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Pre-built Context Menus
// ═════════════════════════════════════════════════════════════════════════════

// ─── Helper: separator factory ───────────────────────────────────────────────

function sep(id: string): MenuItem {
  return { id, label: '', separator: true }
}

// ─── Editor Context Menu ─────────────────────────────────────────────────────

export interface EditorContextMenuProps {
  position: ContextMenuPosition
  onClose: () => void
  hasSelection?: boolean
  clipboardHasContent?: boolean
  canUndo?: boolean
  canRedo?: boolean
  onCut?: () => void
  onCopy?: () => void
  onPaste?: () => void
  onSelectAll?: () => void
  onUndo?: () => void
  onRedo?: () => void
  onGoToDefinition?: () => void
  onGoToDeclaration?: () => void
  onGoToTypeDefinition?: () => void
  onGoToImplementation?: () => void
  onGoToReferences?: () => void
  onPeekDefinition?: () => void
  onPeekReferences?: () => void
  onRename?: () => void
  onRefactor?: () => void
  onSourceAction?: () => void
  onFormatDocument?: () => void
  onFormatSelection?: () => void
  onToggleLineComment?: () => void
  onToggleBlockComment?: () => void
  onFold?: () => void
  onUnfold?: () => void
  onFoldAll?: () => void
  onUnfoldAll?: () => void
  onChangeAllOccurrences?: () => void
  onCopyLineUp?: () => void
  onCopyLineDown?: () => void
  onMoveLineUp?: () => void
  onMoveLineDown?: () => void
  onRevealInExplorer?: () => void
  onOpenInTerminal?: () => void
  onCopyPath?: () => void
  onCopyRelativePath?: () => void
  customItems?: MenuItem[]
}

export function EditorContextMenu({
  position,
  onClose,
  hasSelection = false,
  clipboardHasContent = true,
  canUndo = true,
  canRedo = false,
  onCut,
  onCopy,
  onPaste,
  onSelectAll,
  onUndo,
  onRedo,
  onGoToDefinition,
  onGoToDeclaration,
  onGoToTypeDefinition,
  onGoToImplementation,
  onGoToReferences,
  onPeekDefinition,
  onPeekReferences,
  onRename,
  onRefactor,
  onSourceAction,
  onFormatDocument,
  onFormatSelection,
  onToggleLineComment,
  onToggleBlockComment,
  onFold,
  onUnfold,
  onFoldAll,
  onUnfoldAll,
  onChangeAllOccurrences,
  onCopyLineUp,
  onCopyLineDown,
  onMoveLineUp,
  onMoveLineDown,
  onRevealInExplorer,
  onOpenInTerminal,
  onCopyPath,
  onCopyRelativePath,
  customItems,
}: EditorContextMenuProps) {
  const items: MenuItem[] = [
    // ── Navigation Group ──
    {
      id: 'goto-definition',
      label: 'Go to Definition',
      icon: <Code size={14} />,
      keybinding: 'F12',
      handler: onGoToDefinition,
      group: 'navigation',
    },
    {
      id: 'goto-declaration',
      label: 'Go to Declaration',
      handler: onGoToDeclaration,
      group: 'navigation',
    },
    {
      id: 'goto-type-definition',
      label: 'Go to Type Definition',
      handler: onGoToTypeDefinition,
      group: 'navigation',
    },
    {
      id: 'goto-implementations',
      label: 'Go to Implementations',
      keybinding: 'Ctrl+F12',
      handler: onGoToImplementation,
      group: 'navigation',
    },
    {
      id: 'goto-references',
      label: 'Go to References',
      keybinding: 'Shift+F12',
      handler: onGoToReferences,
      group: 'navigation',
    },
    sep('sep-peek'),
    {
      id: 'peek',
      label: 'Peek',
      icon: <Eye size={14} />,
      group: 'peek',
      children: [
        {
          id: 'peek-definition',
          label: 'Peek Definition',
          keybinding: 'Alt+F12',
          handler: onPeekDefinition,
        },
        {
          id: 'peek-references',
          label: 'Peek References',
          keybinding: 'Shift+Alt+F12',
          handler: onPeekReferences,
        },
      ],
    },
    sep('sep-edit'),
    // ── Edit Group ──
    {
      id: 'rename',
      label: 'Rename Symbol',
      icon: <Pencil size={14} />,
      keybinding: 'F2',
      handler: onRename,
      group: 'edit',
    },
    {
      id: 'refactor',
      label: 'Refactor...',
      keybinding: 'Ctrl+Shift+R',
      handler: onRefactor,
      group: 'edit',
    },
    {
      id: 'source-action',
      label: 'Source Action...',
      handler: onSourceAction,
      group: 'edit',
    },
    sep('sep-clipboard'),
    // ── Clipboard Group ──
    {
      id: 'cut',
      label: 'Cut',
      icon: <Scissors size={14} />,
      keybinding: 'Ctrl+X',
      handler: onCut,
      disabled: !hasSelection,
      disabledReason: 'No text selected',
      group: 'clipboard',
    },
    {
      id: 'copy',
      label: 'Copy',
      icon: <Copy size={14} />,
      keybinding: 'Ctrl+C',
      handler: onCopy,
      disabled: !hasSelection,
      disabledReason: 'No text selected',
      group: 'clipboard',
    },
    {
      id: 'paste',
      label: 'Paste',
      icon: <Clipboard size={14} />,
      keybinding: 'Ctrl+V',
      handler: onPaste,
      disabled: !clipboardHasContent,
      disabledReason: 'Clipboard is empty',
      group: 'clipboard',
    },
    sep('sep-format'),
    // ── Format Group ──
    {
      id: 'format-document',
      label: 'Format Document',
      icon: <Paintbrush size={14} />,
      keybinding: 'Shift+Alt+F',
      handler: onFormatDocument,
      group: 'format',
    },
    {
      id: 'format-selection',
      label: 'Format Selection',
      keybinding: 'Ctrl+K Ctrl+F',
      handler: onFormatSelection,
      disabled: !hasSelection,
      disabledReason: 'No text selected',
      group: 'format',
    },
    sep('sep-comment'),
    // ── Comment / Fold Group ──
    {
      id: 'toggle-line-comment',
      label: 'Toggle Line Comment',
      keybinding: 'Ctrl+/',
      handler: onToggleLineComment,
      group: 'comment',
    },
    {
      id: 'toggle-block-comment',
      label: 'Toggle Block Comment',
      keybinding: 'Shift+Alt+A',
      handler: onToggleBlockComment,
      group: 'comment',
    },
    sep('sep-fold'),
    {
      id: 'folding',
      label: 'Folding',
      icon: <Braces size={14} />,
      group: 'fold',
      children: [
        { id: 'fold', label: 'Fold', keybinding: 'Ctrl+Shift+[', handler: onFold },
        { id: 'unfold', label: 'Unfold', keybinding: 'Ctrl+Shift+]', handler: onUnfold },
        sep('sep-fold-all'),
        { id: 'fold-all', label: 'Fold All', keybinding: 'Ctrl+K Ctrl+0', handler: onFoldAll },
        { id: 'unfold-all', label: 'Unfold All', keybinding: 'Ctrl+K Ctrl+J', handler: onUnfoldAll },
      ],
    },
    sep('sep-lines'),
    // ── Line Manipulation ──
    {
      id: 'line-actions',
      label: 'Line Actions',
      icon: <ArrowUpDown size={14} />,
      group: 'lines',
      children: [
        { id: 'copy-line-up', label: 'Copy Line Up', keybinding: 'Shift+Alt+Up', icon: <ArrowUp size={14} />, handler: onCopyLineUp },
        { id: 'copy-line-down', label: 'Copy Line Down', keybinding: 'Shift+Alt+Down', icon: <ArrowDown size={14} />, handler: onCopyLineDown },
        sep('sep-move'),
        { id: 'move-line-up', label: 'Move Line Up', keybinding: 'Alt+Up', icon: <ArrowUp size={14} />, handler: onMoveLineUp },
        { id: 'move-line-down', label: 'Move Line Down', keybinding: 'Alt+Down', icon: <ArrowDown size={14} />, handler: onMoveLineDown },
      ],
    },
    sep('sep-selection'),
    // ── Selection ──
    {
      id: 'select-all',
      label: 'Select All',
      keybinding: 'Ctrl+A',
      handler: onSelectAll,
      group: 'selection',
    },
    {
      id: 'change-all-occurrences',
      label: 'Change All Occurrences',
      keybinding: 'Ctrl+F2',
      handler: onChangeAllOccurrences,
      disabled: !hasSelection,
      disabledReason: 'Select text to change all occurrences',
      group: 'selection',
    },
    sep('sep-reveal'),
    // ── Reveal / Copy Path ──
    {
      id: 'reveal-in-explorer',
      label: 'Reveal in Explorer',
      icon: <FolderOpen size={14} />,
      handler: onRevealInExplorer,
      group: 'reveal',
    },
    {
      id: 'open-in-terminal',
      label: 'Open in Integrated Terminal',
      icon: <Terminal size={14} />,
      handler: onOpenInTerminal,
      group: 'reveal',
    },
    sep('sep-path'),
    {
      id: 'copy-path',
      label: 'Copy Path',
      keybinding: 'Shift+Alt+C',
      handler: onCopyPath,
      group: 'path',
    },
    {
      id: 'copy-relative-path',
      label: 'Copy Relative Path',
      keybinding: 'Ctrl+Shift+Alt+C',
      handler: onCopyRelativePath,
      group: 'path',
    },
    // ── Custom extras ──
    ...(customItems ? [sep('sep-custom'), ...customItems] : []),
  ]

  return <ContextMenu items={items} position={position} onClose={onClose} />
}

// ─── Tab Context Menu ────────────────────────────────────────────────────────

export interface TabContextMenuProps {
  position: ContextMenuPosition
  onClose: () => void
  isPinned?: boolean
  isModified?: boolean
  tabCount?: number
  onCloseTab?: () => void
  onCloseOtherTabs?: () => void
  onCloseTabsToRight?: () => void
  onCloseTabsToLeft?: () => void
  onCloseAllTabs?: () => void
  onCloseSavedTabs?: () => void
  onPinTab?: () => void
  onUnpinTab?: () => void
  onSplitRight?: () => void
  onSplitDown?: () => void
  onMoveToNewWindow?: () => void
  onCopyPath?: () => void
  onCopyRelativePath?: () => void
  onRevealInExplorer?: () => void
  onOpenInTerminal?: () => void
  onReopenClosedTab?: () => void
  onKeepOpen?: () => void
  onCompareWithSaved?: () => void
  customItems?: MenuItem[]
}

export function TabContextMenu({
  position,
  onClose,
  isPinned = false,
  isModified = false,
  tabCount = 1,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onCloseTabsToLeft,
  onCloseAllTabs,
  onCloseSavedTabs,
  onPinTab,
  onUnpinTab,
  onSplitRight,
  onSplitDown,
  onMoveToNewWindow,
  onCopyPath,
  onCopyRelativePath,
  onRevealInExplorer,
  onOpenInTerminal,
  onReopenClosedTab,
  onKeepOpen,
  onCompareWithSaved,
  customItems,
}: TabContextMenuProps) {
  const items: MenuItem[] = [
    {
      id: 'close-tab',
      label: 'Close',
      icon: <X size={14} />,
      keybinding: 'Ctrl+W',
      handler: onCloseTab,
    },
    {
      id: 'close-others',
      label: 'Close Others',
      handler: onCloseOtherTabs,
      disabled: tabCount <= 1,
      disabledReason: 'No other tabs to close',
    },
    {
      id: 'close-right',
      label: 'Close to the Right',
      handler: onCloseTabsToRight,
    },
    {
      id: 'close-left',
      label: 'Close to the Left',
      handler: onCloseTabsToLeft,
    },
    {
      id: 'close-all',
      label: 'Close All',
      handler: onCloseAllTabs,
    },
    {
      id: 'close-saved',
      label: 'Close Saved',
      handler: onCloseSavedTabs,
    },
    sep('sep-reopen'),
    {
      id: 'reopen-closed',
      label: 'Reopen Closed Editor',
      keybinding: 'Ctrl+Shift+T',
      handler: onReopenClosedTab,
    },
    sep('sep-keep'),
    {
      id: 'keep-open',
      label: 'Keep Open',
      keybinding: 'Ctrl+K Enter',
      handler: onKeepOpen,
    },
    {
      id: 'pin-tab',
      label: isPinned ? 'Unpin' : 'Pin',
      icon: <Pin size={14} />,
      handler: isPinned ? onUnpinTab : onPinTab,
    },
    sep('sep-split'),
    {
      id: 'split-right',
      label: 'Split Right',
      icon: <Columns size={14} />,
      handler: onSplitRight,
    },
    {
      id: 'split-down',
      label: 'Split Down',
      icon: <Rows size={14} />,
      handler: onSplitDown,
    },
    {
      id: 'move-to-new-window',
      label: 'Move to New Window',
      icon: <ExternalLink size={14} />,
      handler: onMoveToNewWindow,
    },
    sep('sep-compare'),
    {
      id: 'compare-with-saved',
      label: 'Compare with Saved',
      handler: onCompareWithSaved,
      disabled: !isModified,
      disabledReason: 'File has no unsaved changes',
    },
    sep('sep-path'),
    {
      id: 'copy-path',
      label: 'Copy Path',
      icon: <Copy size={14} />,
      keybinding: 'Shift+Alt+C',
      handler: onCopyPath,
    },
    {
      id: 'copy-relative-path',
      label: 'Copy Relative Path',
      handler: onCopyRelativePath,
    },
    {
      id: 'reveal-in-explorer',
      label: 'Reveal in Explorer',
      icon: <FolderOpen size={14} />,
      handler: onRevealInExplorer,
    },
    {
      id: 'open-in-terminal',
      label: 'Open in Integrated Terminal',
      icon: <Terminal size={14} />,
      handler: onOpenInTerminal,
    },
    ...(customItems ? [sep('sep-custom'), ...customItems] : []),
  ]

  return <ContextMenu items={items} position={position} onClose={onClose} />
}

// ─── File Explorer Context Menu ──────────────────────────────────────────────

export interface FileExplorerContextMenuProps {
  position: ContextMenuPosition
  onClose: () => void
  isFile?: boolean
  isFolder?: boolean
  isRoot?: boolean
  isReadOnly?: boolean
  hasSelection?: boolean
  selectedCount?: number
  onNewFile?: () => void
  onNewFolder?: () => void
  onOpen?: () => void
  onOpenToSide?: () => void
  onOpenWithDefaultApp?: () => void
  onRevealInSystemExplorer?: () => void
  onOpenInTerminal?: () => void
  onCut?: () => void
  onCopy?: () => void
  onPaste?: () => void
  onCopyPath?: () => void
  onCopyRelativePath?: () => void
  onRename?: () => void
  onDelete?: () => void
  onFindInFolder?: () => void
  onCollapseAll?: () => void
  onRefreshExplorer?: () => void
  onCompareSelected?: () => void
  onCompareWithClipboard?: () => void
  customItems?: MenuItem[]
}

export function FileExplorerContextMenu({
  position,
  onClose,
  isFile = true,
  isFolder = false,
  isRoot = false,
  isReadOnly = false,
  hasSelection = true,
  selectedCount = 1,
  onNewFile,
  onNewFolder,
  onOpen,
  onOpenToSide,
  onOpenWithDefaultApp,
  onRevealInSystemExplorer,
  onOpenInTerminal,
  onCut,
  onCopy,
  onPaste,
  onCopyPath,
  onCopyRelativePath,
  onRename,
  onDelete,
  onFindInFolder,
  onCollapseAll,
  onRefreshExplorer,
  onCompareSelected,
  onCompareWithClipboard,
  customItems,
}: FileExplorerContextMenuProps) {
  const items: MenuItem[] = [
    // ── Open ──
    {
      id: 'open',
      label: 'Open',
      icon: <FileText size={14} />,
      handler: onOpen,
      hidden: isFolder && !isRoot,
    },
    {
      id: 'open-to-side',
      label: 'Open to the Side',
      icon: <Columns size={14} />,
      handler: onOpenToSide,
      hidden: !isFile,
    },
    {
      id: 'open-with',
      label: 'Open with Default App',
      icon: <ExternalLink size={14} />,
      handler: onOpenWithDefaultApp,
      hidden: !isFile,
    },
    sep('sep-new'),
    // ── New ──
    {
      id: 'new-file',
      label: 'New File...',
      icon: <FilePlus size={14} />,
      handler: onNewFile,
      disabled: isReadOnly,
      disabledReason: isReadOnly ? 'Folder is read-only' : undefined,
    },
    {
      id: 'new-folder',
      label: 'New Folder...',
      icon: <FolderPlus size={14} />,
      handler: onNewFolder,
      disabled: isReadOnly,
      disabledReason: isReadOnly ? 'Folder is read-only' : undefined,
    },
    sep('sep-clipboard'),
    // ── Clipboard ──
    {
      id: 'cut',
      label: 'Cut',
      icon: <Scissors size={14} />,
      keybinding: 'Ctrl+X',
      handler: onCut,
      disabled: isRoot || isReadOnly,
      disabledReason: isRoot ? 'Cannot cut root folder' : 'Read-only',
    },
    {
      id: 'copy',
      label: 'Copy',
      icon: <Copy size={14} />,
      keybinding: 'Ctrl+C',
      handler: onCopy,
      disabled: isRoot,
      disabledReason: 'Cannot copy root folder',
    },
    {
      id: 'paste',
      label: 'Paste',
      icon: <Clipboard size={14} />,
      keybinding: 'Ctrl+V',
      handler: onPaste,
      disabled: isReadOnly,
      disabledReason: 'Read-only location',
    },
    sep('sep-paths'),
    // ── Paths ──
    {
      id: 'copy-path',
      label: 'Copy Path',
      keybinding: 'Shift+Alt+C',
      handler: onCopyPath,
    },
    {
      id: 'copy-relative-path',
      label: 'Copy Relative Path',
      keybinding: 'Ctrl+Shift+Alt+C',
      handler: onCopyRelativePath,
    },
    sep('sep-modify'),
    // ── Modify ──
    {
      id: 'rename',
      label: 'Rename',
      icon: <Pencil size={14} />,
      keybinding: 'F2',
      handler: onRename,
      disabled: isRoot || isReadOnly,
      disabledReason: isRoot ? 'Cannot rename root folder' : 'Read-only',
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 size={14} />,
      keybinding: 'Delete',
      handler: onDelete,
      disabled: isRoot || isReadOnly,
      disabledReason: isRoot ? 'Cannot delete root folder' : 'Read-only',
    },
    sep('sep-find'),
    // ── Find / Reveal ──
    {
      id: 'find-in-folder',
      label: isFolder ? 'Find in Folder...' : 'Find in Containing Folder...',
      icon: <Search size={14} />,
      handler: onFindInFolder,
    },
    {
      id: 'reveal-in-system-explorer',
      label: 'Reveal in File Explorer',
      icon: <FolderOpen size={14} />,
      handler: onRevealInSystemExplorer,
    },
    {
      id: 'open-in-terminal',
      label: 'Open in Integrated Terminal',
      icon: <Terminal size={14} />,
      handler: onOpenInTerminal,
    },
    sep('sep-compare'),
    // ── Compare ──
    {
      id: 'compare-selected',
      label: 'Compare Selected',
      icon: <ArrowRightLeft size={14} />,
      handler: onCompareSelected,
      disabled: selectedCount < 2,
      disabledReason: 'Select two files to compare',
    },
    {
      id: 'compare-with-clipboard',
      label: 'Compare with Clipboard',
      handler: onCompareWithClipboard,
      hidden: !isFile,
    },
    sep('sep-explorer'),
    // ── Explorer Actions ──
    {
      id: 'collapse-all',
      label: 'Collapse Folders in Explorer',
      handler: onCollapseAll,
    },
    {
      id: 'refresh-explorer',
      label: 'Refresh Explorer',
      icon: <RefreshCw size={14} />,
      handler: onRefreshExplorer,
    },
    ...(customItems ? [sep('sep-custom'), ...customItems] : []),
  ]

  return <ContextMenu items={items} position={position} onClose={onClose} />
}

// ─── Terminal Context Menu ───────────────────────────────────────────────────

export interface TerminalContextMenuProps {
  position: ContextMenuPosition
  onClose: () => void
  hasSelection?: boolean
  hasMultipleTerminals?: boolean
  isMaximized?: boolean
  onCopy?: () => void
  onPaste?: () => void
  onSelectAll?: () => void
  onClear?: () => void
  onSplitTerminal?: () => void
  onNewTerminal?: () => void
  onKillTerminal?: () => void
  onRenameTerminal?: () => void
  onChangeColor?: () => void
  onChangeIcon?: () => void
  onMaximize?: () => void
  onRestore?: () => void
  onMoveToEditor?: () => void
  onCopyAsHtml?: () => void
  onScrollToTop?: () => void
  onScrollToBottom?: () => void
  onToggleScrollLock?: () => void
  isScrollLocked?: boolean
  customItems?: MenuItem[]
}

export function TerminalContextMenu({
  position,
  onClose,
  hasSelection = false,
  hasMultipleTerminals = false,
  isMaximized = false,
  onCopy,
  onPaste,
  onSelectAll,
  onClear,
  onSplitTerminal,
  onNewTerminal,
  onKillTerminal,
  onRenameTerminal,
  onChangeColor,
  onChangeIcon,
  onMaximize,
  onRestore,
  onMoveToEditor,
  onCopyAsHtml,
  onScrollToTop,
  onScrollToBottom,
  onToggleScrollLock,
  isScrollLocked = false,
  customItems,
}: TerminalContextMenuProps) {
  const items: MenuItem[] = [
    // ── Clipboard ──
    {
      id: 'copy',
      label: 'Copy',
      icon: <Copy size={14} />,
      keybinding: 'Ctrl+C',
      handler: onCopy,
      disabled: !hasSelection,
      disabledReason: 'No text selected in terminal',
    },
    {
      id: 'copy-as-html',
      label: 'Copy as HTML',
      handler: onCopyAsHtml,
      disabled: !hasSelection,
      disabledReason: 'No text selected in terminal',
    },
    {
      id: 'paste',
      label: 'Paste',
      icon: <Clipboard size={14} />,
      keybinding: 'Ctrl+V',
      handler: onPaste,
    },
    sep('sep-select'),
    // ── Selection ──
    {
      id: 'select-all',
      label: 'Select All',
      keybinding: 'Ctrl+A',
      handler: onSelectAll,
    },
    sep('sep-nav'),
    // ── Scroll ──
    {
      id: 'scroll-to-top',
      label: 'Scroll to Top',
      handler: onScrollToTop,
    },
    {
      id: 'scroll-to-bottom',
      label: 'Scroll to Bottom',
      handler: onScrollToBottom,
    },
    {
      id: 'toggle-scroll-lock',
      label: 'Scroll Lock',
      checked: isScrollLocked,
      handler: onToggleScrollLock,
    },
    sep('sep-clear'),
    // ── Terminal Management ──
    {
      id: 'clear',
      label: 'Clear Terminal',
      keybinding: 'Ctrl+K',
      handler: onClear,
    },
    sep('sep-terminal-actions'),
    {
      id: 'split-terminal',
      label: 'Split Terminal',
      icon: <SplitSquareVertical size={14} />,
      keybinding: 'Ctrl+Shift+5',
      handler: onSplitTerminal,
    },
    {
      id: 'new-terminal',
      label: 'New Terminal',
      icon: <Terminal size={14} />,
      keybinding: 'Ctrl+Shift+`',
      handler: onNewTerminal,
    },
    sep('sep-terminal-config'),
    {
      id: 'rename-terminal',
      label: 'Rename...',
      icon: <Pencil size={14} />,
      handler: onRenameTerminal,
    },
    {
      id: 'change-color',
      label: 'Change Color...',
      icon: <Paintbrush size={14} />,
      handler: onChangeColor,
    },
    {
      id: 'change-icon',
      label: 'Change Icon...',
      handler: onChangeIcon,
    },
    sep('sep-terminal-layout'),
    {
      id: 'maximize-restore',
      label: isMaximized ? 'Restore Panel Size' : 'Maximize Panel Size',
      icon: isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />,
      handler: isMaximized ? onRestore : onMaximize,
    },
    {
      id: 'move-to-editor',
      label: 'Move Terminal into Editor Area',
      handler: onMoveToEditor,
    },
    sep('sep-kill'),
    {
      id: 'kill-terminal',
      label: 'Kill Terminal',
      icon: <Trash2 size={14} />,
      handler: onKillTerminal,
    },
    ...(customItems ? [sep('sep-custom'), ...customItems] : []),
  ]

  return <ContextMenu items={items} position={position} onClose={onClose} />
}

// ═════════════════════════════════════════════════════════════════════════════
// Utility: Build menu items from a declarative spec
// ═════════════════════════════════════════════════════════════════════════════

export interface MenuItemSpec {
  id: string
  label: string
  icon?: React.ReactNode
  keybinding?: string
  disabled?: boolean
  disabledReason?: string
  checked?: boolean
  children?: MenuItemSpec[]
  separator?: boolean
  handler?: () => void
  hidden?: boolean
  group?: string
}

/**
 * Convert a flat list of MenuItemSpecs into MenuItem[] with auto-generated
 * separator IDs and proper nesting. Convenience for building menus declaratively.
 */
export function buildMenuItems(specs: MenuItemSpec[]): MenuItem[] {
  return specs.map((spec) => {
    const item: MenuItem = { ...spec }
    if (spec.children) {
      item.children = buildMenuItems(spec.children)
    }
    return item
  })
}

// ═════════════════════════════════════════════════════════════════════════════
// Utility: Merge custom items into a pre-built menu
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Insert custom menu items after a given item ID, or at the end if the anchor
 * is not found. Useful for extending pre-built context menus.
 */
export function insertMenuItems(
  baseItems: MenuItem[],
  newItems: MenuItem[],
  afterId?: string,
): MenuItem[] {
  if (!afterId) {
    return [...baseItems, sep('sep-inserted'), ...newItems]
  }
  const idx = baseItems.findIndex(i => i.id === afterId)
  if (idx === -1) {
    return [...baseItems, sep('sep-inserted'), ...newItems]
  }
  return [
    ...baseItems.slice(0, idx + 1),
    sep('sep-inserted'),
    ...newItems,
    ...baseItems.slice(idx + 1),
  ]
}

// ═════════════════════════════════════════════════════════════════════════════
// Utility: useContextMenuHandler - convenient hook for attaching to elements
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Returns props to spread onto an element to show a context menu on right-click.
 *
 * Usage:
 *   const contextProps = useContextMenuHandler(myItems)
 *   return <div {...contextProps}>Right-click me</div>
 */
export function useContextMenuHandler(
  items: MenuItem[] | (() => MenuItem[]),
): { onContextMenu: (e: React.MouseEvent) => void } {
  const { show } = useContextMenu()

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const resolved = typeof items === 'function' ? items() : items
    show(resolved, { x: e.clientX, y: e.clientY })
  }, [show, items])

  return { onContextMenu }
}

// ═════════════════════════════════════════════════════════════════════════════
// Standalone context menu (no provider needed)
// ═════════════════════════════════════════════════════════════════════════════

interface StandaloneContextMenuProps {
  items: MenuItem[]
  position: ContextMenuPosition
  onClose: () => void
  visible: boolean
}

/**
 * A standalone context menu that does not require the ContextMenuProvider.
 * Useful for self-contained components that manage their own context menu state.
 */
export function StandaloneContextMenu({ items, position, onClose, visible }: StandaloneContextMenuProps) {
  if (!visible) return null
  return <ContextMenu items={items} position={position} onClose={onClose} />
}

// ═════════════════════════════════════════════════════════════════════════════
// Re-export icon helpers for menu construction
// ═════════════════════════════════════════════════════════════════════════════

// Convenience: commonly used 14px icons for menu items, so consumers
// don't have to import lucide-react themselves.
export const MenuIcons = {
  Cut: <Scissors size={14} />,
  Copy: <Copy size={14} />,
  Paste: <Clipboard size={14} />,
  Delete: <Trash2 size={14} />,
  Rename: <Pencil size={14} />,
  NewFile: <FilePlus size={14} />,
  NewFolder: <FolderPlus size={14} />,
  Open: <FileText size={14} />,
  OpenFolder: <FolderOpen size={14} />,
  Search: <Search size={14} />,
  Terminal: <Terminal size={14} />,
  Refresh: <RefreshCw size={14} />,
  Pin: <Pin size={14} />,
  Close: <X size={14} />,
  SplitRight: <Columns size={14} />,
  SplitDown: <Rows size={14} />,
  Code: <Code size={14} />,
  Eye: <Eye size={14} />,
  Format: <Paintbrush size={14} />,
  Compare: <ArrowRightLeft size={14} />,
  External: <ExternalLink size={14} />,
  Download: <Download size={14} />,
  Upload: <Upload size={14} />,
  Git: <GitBranch size={14} />,
  Link: <Link2 size={14} />,
} as const
