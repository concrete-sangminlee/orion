import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  ChevronRight,
  Minus,
  Square,
  X,
  Zap,
  Search,
} from 'lucide-react'
import { useFileStore } from '@/store/files'
import { useEditorStore } from '@/store/editor'
import { useRecentFilesStore } from '@/store/recentFiles'
import { openFileInEditor } from '@/utils/openFileInEditor'
import { requireCommand, runCommand } from '@/commands/registry'
import '@/commands/appCommands'

/* ------------------------------------------------------------------ */
/*  CSS variables (injected once)                                      */
/* ------------------------------------------------------------------ */

const TITLEBAR_STYLE_ID = 'orion-titlebar-styles'

function ensureTitleBarStyles() {
  if (document.getElementById(TITLEBAR_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = TITLEBAR_STYLE_ID
  style.textContent = `
    :root {
      --titlebar-height: 38px;
      --titlebar-bg: var(--bg-tertiary);
      --titlebar-border: rgba(255, 255, 255, 0.04);
      --titlebar-menu-font: 12px;
      --titlebar-menu-hover-bg: rgba(255, 255, 255, 0.06);
      --titlebar-menu-active-bg: rgba(255, 255, 255, 0.10);
      --titlebar-dropdown-bg: var(--bg-secondary);
      --titlebar-dropdown-border: var(--border);
      --titlebar-dropdown-shadow: 0 8px 24px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.3);
      --titlebar-dropdown-radius: 6px;
      --titlebar-item-radius: 4px;
      --titlebar-item-hover-bg: rgba(255, 255, 255, 0.08);
      --titlebar-close-hover-bg: #c42b1c;
      --titlebar-close-hover-color: #ffffff;
      --titlebar-winctrl-hover-bg: rgba(255, 255, 255, 0.06);
      --titlebar-winctrl-hover-color: var(--text-primary);
      --titlebar-pill-bg: rgba(255, 255, 255, 0.05);
      --titlebar-pill-hover-bg: rgba(255, 255, 255, 0.08);
      --titlebar-pill-border: rgba(255, 255, 255, 0.08);
      --titlebar-modified-dot: #e5c07b;
    }

    /* Dropdown open/close animation */
    @keyframes orion-dropdown-in {
      from {
        opacity: 0;
        transform: translateY(-4px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .orion-dropdown-animate {
      animation: orion-dropdown-in 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      transform-origin: top left;
    }

    /* Window control button active press state */
    .orion-winctrl:active {
      opacity: 0.7;
    }

    /* Logo subtle glow on hover */
    .orion-logo-icon {
      transition: filter 0.25s ease, transform 0.25s ease;
    }
    .orion-logo-icon:hover {
      filter: drop-shadow(0 0 6px rgba(88, 166, 255, 0.45));
      transform: scale(1.05);
    }
  `
  document.head.appendChild(style)
}

/* ------------------------------------------------------------------ */
/*  Menu definitions                                                   */
/* ------------------------------------------------------------------ */

type MenuItem =
  | { type: 'action'; label: string; shortcut?: string; action: () => void }
  | { type: 'submenu'; label: string; children: MenuItem[] }
  | { type: 'separator' }

type MenuDef = { label: string; accelerator: string; items: MenuItem[] }

/** A menu item that runs a registry command, labelled and keyed like it everywhere else. */
function command(id: string, label?: string): MenuItem {
  const { title, keybinding } = requireCommand(id)
  return { type: 'action', label: label ?? title, shortcut: keybinding, action: () => runCommand(id) }
}

const separator: MenuItem = { type: 'separator' }

/**
 * The visible menu bar on Windows and Linux (the window is frameless). Every
 * item is a command from the registry, so it does what the palette and the
 * native macOS menu do.
 */
export function buildMenus(recentFiles: { path: string; name: string }[]): MenuDef[] {
  const recentFilesItems: MenuItem[] =
    recentFiles.length > 0
      ? [
          ...recentFiles.map((f) => ({
            type: 'action' as const,
            label: f.name,
            action: () => void openFileInEditor(f.path),
          })),
          separator,
          {
            type: 'action' as const,
            label: 'Clear Recently Opened',
            action: () => useRecentFilesStore.getState().clearRecent(),
          },
        ]
      : [{ type: 'action' as const, label: '(No Recent Files)', action: () => {} }]

  return [
    {
      label: 'File',
      accelerator: 'F',
      items: [
        command('file.newFile'),
        separator,
        command('file.openFile'),
        command('file.openFolder'),
        { type: 'submenu', label: 'Open Recent', children: recentFilesItems },
        separator,
        command('file.save'),
        command('file.saveAs'),
        command('file.saveAll'),
        separator,
        command('file.revert'),
        separator,
        command('file.closeEditor'),
        command('file.closeAllEditors'),
        separator,
        command('preferences.settings', 'Preferences: Settings'),
        command('preferences.keyboardShortcuts', 'Preferences: Keyboard Shortcuts'),
        command('preferences.colorTheme', 'Preferences: Color Theme'),
        command('preferences.snippets', 'Preferences: Snippets'),
        separator,
        command('file.exit'),
      ],
    },
    {
      label: 'Edit',
      accelerator: 'E',
      items: [
        command('edit.undo'),
        command('edit.redo'),
        separator,
        command('edit.cut'),
        command('edit.copy'),
        command('edit.paste'),
        separator,
        command('edit.find'),
        command('edit.replace'),
        separator,
        command('view.search'),
        separator,
        command('edit.toggleLineComment'),
        command('edit.toggleBlockComment'),
      ],
    },
    {
      label: 'Selection',
      accelerator: 'S',
      items: [
        command('selection.selectAll'),
        command('selection.expand'),
        command('selection.shrink'),
        separator,
        command('selection.copyLineUp'),
        command('selection.copyLineDown'),
        command('selection.moveLineUp'),
        command('selection.moveLineDown'),
        command('selection.duplicate'),
        separator,
        command('selection.addCursorAbove'),
        command('selection.addCursorBelow'),
        command('selection.cursorsToLineEnds'),
        command('selection.addNextOccurrence'),
        command('selection.selectAllOccurrences'),
        separator,
        command('selection.columnSelection'),
      ],
    },
    {
      label: 'View',
      accelerator: 'V',
      items: [
        command('view.commandPalette'),
        separator,
        command('view.explorer', 'Explorer'),
        command('view.search', 'Search'),
        command('view.sourceControl', 'Source Control'),
        command('view.outline', 'Outline'),
        separator,
        {
          type: 'submenu',
          label: 'Appearance',
          children: [
            command('view.toggleZenMode', 'Zen Mode'),
            separator,
            command('view.toggleSidebar'),
            command('view.togglePanel'),
            command('view.toggleChat'),
          ],
        },
        {
          type: 'submenu',
          label: 'Editor Layout',
          children: [
            command('editor.splitRight', 'Split Right'),
            command('editor.splitDown', 'Split Down'),
            command('editor.toggleSplitDirection'),
          ],
        },
        separator,
        command('view.toggleTerminal', 'Terminal'),
        separator,
        command('view.toggleMinimap'),
        command('view.toggleWordWrap', 'Word Wrap'),
      ],
    },
    {
      label: 'Go',
      accelerator: 'G',
      items: [
        command('go.file'),
        command('go.symbol'),
        command('go.line'),
        separator,
        command('go.definition'),
        command('go.peekDefinition'),
        command('go.references'),
        separator,
        command('go.nextProblem'),
        command('go.previousProblem'),
      ],
    },
    // A Run menu offered debugging and breakpoints; there is no debugger.
    {
      label: 'Terminal',
      accelerator: 'T',
      items: [
        command('terminal.new'),
        command('terminal.split'),
        separator,
        command('terminal.runTask'),
        command('terminal.runBuildTask'),
        separator,
        command('terminal.clear'),
        command('terminal.kill'),
      ],
    },
    {
      label: 'Help',
      accelerator: 'H',
      items: [
        command('preferences.keyboardShortcuts', 'Keyboard Shortcuts Reference'),
        command('help.documentation'),
        separator,
        command('help.reportIssue'),
        command('help.checkForUpdates'),
        separator,
        command('help.about'),
      ],
    },
  ]
}

/* ------------------------------------------------------------------ */
/*  Render an accelerator-underlined label                             */
/* ------------------------------------------------------------------ */

function AcceleratorLabel({
  label,
  accelerator,
  showUnderline,
}: {
  label: string
  accelerator: string
  showUnderline: boolean
}) {
  if (!showUnderline) return <>{label}</>
  const idx = label.indexOf(accelerator)
  if (idx === -1) return <>{label}</>
  return (
    <>
      {label.slice(0, idx)}
      <span style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}>
        {label[idx]}
      </span>
      {label.slice(idx + 1)}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Submenu component                                                  */
/* ------------------------------------------------------------------ */

function SubMenu({
  items,
  onClose,
  focusedIdx,
  onFocusIdx,
}: {
  items: MenuItem[]
  onClose: () => void
  focusedIdx?: number | null
  onFocusIdx?: (idx: number | null) => void
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const activeIdx = focusedIdx ?? hoveredIdx

  return (
    <div
      className="orion-dropdown-animate"
      style={{
        position: 'absolute',
        top: -4,
        left: '100%',
        marginLeft: 2,
        minWidth: 200,
        background: 'var(--titlebar-dropdown-bg)',
        border: '1px solid var(--titlebar-dropdown-border)',
        borderRadius: 'var(--titlebar-dropdown-radius)',
        boxShadow: 'var(--titlebar-dropdown-shadow)',
        padding: 4,
        zIndex: 10000,
        backdropFilter: 'blur(12px)',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, idx) => {
        if (item.type === 'separator') {
          return (
            <div
              key={`sep-${idx}`}
              style={{
                height: 1,
                background: 'var(--titlebar-dropdown-border)',
                margin: '4px 8px',
              }}
            />
          )
        }

        if (item.type === 'submenu') {
          const isActive = activeIdx === idx
          return (
            <div
              key={item.label}
              style={{ position: 'relative' }}
              onMouseEnter={() => {
                setHoveredIdx(idx)
                onFocusIdx?.(idx)
              }}
              onMouseLeave={() => {
                setHoveredIdx(null)
                onFocusIdx?.(null)
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  fontSize: 12,
                  padding: '5px 8px',
                  borderRadius: 'var(--titlebar-item-radius)',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: isActive ? 'var(--titlebar-item-hover-bg)' : 'transparent',
                  cursor: 'default',
                  lineHeight: '18px',
                  transition: 'background 0.12s ease, color 0.12s ease',
                }}
              >
                <span>{item.label}</span>
                <ChevronRight size={12} style={{ opacity: 0.5, flexShrink: 0, marginLeft: 16 }} />
              </div>
              {isActive && <SubMenu items={item.children} onClose={onClose} />}
            </div>
          )
        }

        const isActive = activeIdx === idx
        return (
          <button
            key={item.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              fontSize: 12,
              padding: '5px 8px',
              borderRadius: 'var(--titlebar-item-radius)',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: isActive ? 'var(--titlebar-item-hover-bg)' : 'transparent',
              border: 'none',
              cursor: 'default',
              textAlign: 'left',
              lineHeight: '18px',
              transition: 'background 0.08s, color 0.08s',
            }}
            onMouseEnter={() => {
              setHoveredIdx(idx)
              onFocusIdx?.(idx)
            }}
            onMouseLeave={() => {
              setHoveredIdx(null)
              onFocusIdx?.(null)
            }}
            onClick={() => {
              item.action()
              onClose()
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginLeft: 32,
                  flexShrink: 0,
                  opacity: 0.7,
                }}
              >
                {item.shortcut}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Dropdown component with keyboard navigation                        */
/* ------------------------------------------------------------------ */

function DropdownMenu({
  items,
  onClose,
}: {
  items: MenuItem[]
  onClose: () => void
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [kbIdx, setKbIdx] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const activeIdx = kbIdx ?? hoveredIdx

  /* Get navigable (non-separator) indices */
  const navigableIndices = items
    .map((item, idx) => (item.type !== 'separator' ? idx : -1))
    .filter((i) => i !== -1)

  /* Keyboard navigation inside the dropdown */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setKbIdx((prev) => {
          const cur = prev ?? -1
          const curNavIdx = navigableIndices.indexOf(cur)
          if (e.key === 'ArrowDown') {
            const next = curNavIdx < navigableIndices.length - 1 ? curNavIdx + 1 : 0
            return navigableIndices[next]
          } else {
            const next = curNavIdx > 0 ? curNavIdx - 1 : navigableIndices.length - 1
            return navigableIndices[next]
          }
        })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (activeIdx !== null) {
          const item = items[activeIdx]
          if (item && item.type === 'action') {
            item.action()
            onClose()
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [items, activeIdx, navigableIndices, onClose])

  return (
    <div
      ref={containerRef}
      className="orion-dropdown-animate"
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: 2,
        minWidth: 240,
        background: 'var(--titlebar-dropdown-bg)',
        border: '1px solid var(--titlebar-dropdown-border)',
        borderRadius: 'var(--titlebar-dropdown-radius)',
        boxShadow: 'var(--titlebar-dropdown-shadow)',
        padding: 4,
        zIndex: 9999,
        backdropFilter: 'blur(12px)',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, idx) => {
        if (item.type === 'separator') {
          return (
            <div
              key={`sep-${idx}`}
              style={{
                height: 1,
                background: 'var(--titlebar-dropdown-border)',
                margin: '4px 8px',
              }}
            />
          )
        }

        if (item.type === 'submenu') {
          const isActive = activeIdx === idx
          return (
            <div
              key={item.label}
              style={{ position: 'relative' }}
              onMouseEnter={() => {
                setHoveredIdx(idx)
                setKbIdx(null)
              }}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  fontSize: 12,
                  padding: '5px 8px',
                  borderRadius: 'var(--titlebar-item-radius)',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: isActive ? 'var(--titlebar-item-hover-bg)' : 'transparent',
                  cursor: 'default',
                  lineHeight: '18px',
                  transition: 'background 0.12s ease, color 0.12s ease',
                }}
              >
                <span>{item.label}</span>
                <ChevronRight size={12} style={{ opacity: 0.5, flexShrink: 0, marginLeft: 16 }} />
              </div>
              {isActive && <SubMenu items={item.children} onClose={onClose} />}
            </div>
          )
        }

        const isActive = activeIdx === idx
        return (
          <button
            key={item.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              fontSize: 12,
              padding: '5px 8px',
              borderRadius: 'var(--titlebar-item-radius)',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: isActive ? 'var(--titlebar-item-hover-bg)' : 'transparent',
              border: 'none',
              cursor: 'default',
              textAlign: 'left',
              lineHeight: '18px',
              transition: 'background 0.08s, color 0.08s',
            }}
            onMouseEnter={() => {
              setHoveredIdx(idx)
              setKbIdx(null)
            }}
            onMouseLeave={() => setHoveredIdx(null)}
            onClick={() => {
              item.action()
              onClose()
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginLeft: 32,
                  flexShrink: 0,
                  opacity: 0.7,
                }}
              >
                {item.shortcut}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Helper: extract folder name from path                              */
/* ------------------------------------------------------------------ */

function folderNameFromPath(rootPath: string | null): string {
  if (!rootPath) return ''
  const parts = rootPath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || ''
}

/* ------------------------------------------------------------------ */
/*  TitleBar                                                           */
/* ------------------------------------------------------------------ */

export default function TitleBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [hoveredMenu, setHoveredMenu] = useState<string | null>(null)
  const [altActive, setAltActive] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const titleBarRef = useRef<HTMLElement>(null)

  const rootPath = useFileStore((s) => s.rootPath)
  const activeFile = useEditorStore((s) => s.openFiles.find((f) => f.path === s.activeFilePath))
  const recentFilesList = useRecentFilesStore((s) => s.recentFiles)
  const recentFiles = useMemo(() => recentFilesList.slice(0, 5), [recentFilesList])
  const menus = useMemo(() => buildMenus(recentFiles), [recentFiles])

  /* Inject CSS variables */
  useEffect(() => {
    ensureTitleBarStyles()
  }, [])

  /* Active file info */
  const fileName = activeFile?.name || ''
  const isModified = activeFile?.isModified || false
  const folderName = folderNameFromPath(rootPath)

  /* Build window title: "filename - Orion IDE" */
  const windowTitle = fileName
    ? `${fileName} - Orion IDE`
    : folderName
      ? `${folderName} - Orion IDE`
      : 'Orion IDE'

  /* Keep document.title in sync for the actual window frame */
  useEffect(() => {
    document.title = (isModified ? '\u25CF ' : '') + windowTitle
  }, [windowTitle, isModified])

  /* Close dropdown on outside click */
  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    },
    [],
  )

  useEffect(() => {
    if (openMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openMenu, handleClickOutside])

  const closeMenu = useCallback(() => {
    setOpenMenu(null)
    setAltActive(false)
  }, [])

  /* ---- Keyboard navigation: Alt to focus menu bar, arrows to move ---- */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      /* Alt key toggles menu bar focus */
      if (e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault()
        if (openMenu) {
          closeMenu()
          setAltActive(false)
        } else {
          setAltActive((prev) => !prev)
        }
        return
      }

      /* Alt+accelerator key opens a specific menu */
      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        const key = e.key.toUpperCase()
        const match = menus.find((m) => m.accelerator === key)
        if (match) {
          e.preventDefault()
          setOpenMenu(match.label)
          setAltActive(true)
          return
        }
      }

      /* When menu bar is focused (altActive) or a menu is open */
      if (altActive || openMenu) {
        if (e.key === 'Escape') {
          e.preventDefault()
          if (openMenu) {
            setOpenMenu(null)
          } else {
            setAltActive(false)
          }
          return
        }

        const currentIdx = openMenu
          ? menus.findIndex((m) => m.label === openMenu)
          : -1

        if (e.key === 'ArrowRight') {
          e.preventDefault()
          const nextIdx = currentIdx < menus.length - 1 ? currentIdx + 1 : 0
          if (openMenu) {
            setOpenMenu(menus[nextIdx].label)
          } else {
            setOpenMenu(menus[nextIdx >= 0 ? nextIdx : 0].label)
          }
          return
        }

        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          const prevIdx = currentIdx > 0 ? currentIdx - 1 : menus.length - 1
          if (openMenu) {
            setOpenMenu(menus[prevIdx].label)
          } else {
            setOpenMenu(menus[prevIdx >= 0 ? prevIdx : menus.length - 1].label)
          }
          return
        }

        /* Enter opens the focused menu if altActive but no dropdown open */
        if (e.key === 'Enter' && altActive && !openMenu) {
          e.preventDefault()
          setOpenMenu(menus[0].label)
          return
        }

        /* Letter key in altActive mode - check accelerator */
        if (!openMenu && altActive && e.key.length === 1) {
          const key = e.key.toUpperCase()
          const match = menus.find((m) => m.accelerator === key)
          if (match) {
            e.preventDefault()
            setOpenMenu(match.label)
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [altActive, openMenu, menus, closeMenu])

  /* Double-click title bar to maximize/restore */
  const handleTitleBarDoubleClick = useCallback((e: React.MouseEvent) => {
    // Only on the drag region (not buttons/menus)
    const target = e.target as HTMLElement
    if (target.closest('[data-no-dblclick]')) return
    window.api?.maximize?.()
    setIsMaximized((prev) => !prev)
  }, [])

  return (
    <header
      ref={titleBarRef}
      className="shrink-0 flex items-center select-none"
      style={{
        height: 'var(--titlebar-height, 38px)',
        background: 'var(--titlebar-bg)',
        borderBottom: '1px solid var(--titlebar-border)',
        WebkitAppRegion: 'drag',
        position: 'relative',
      } as React.CSSProperties}
      onDoubleClick={handleTitleBarDoubleClick}
    >
      {/* Logo + Brand */}
      <div
        data-no-dblclick
        className="flex items-center gap-2"
        style={{ paddingLeft: 14, paddingRight: 12, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div
          className="orion-logo-icon"
          style={{
            width: 20,
            height: 20,
            borderRadius: 5,
            background: 'linear-gradient(135deg, #58a6ff 0%, #8b5cf6 50%, #bc8cff 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 1px 3px rgba(88, 166, 255, 0.2), inset 0 1px 0 rgba(255,255,255,0.15)',
            cursor: 'pointer',
          }}
          title="Orion IDE"
        >
          <Zap size={11} color="#fff" fill="#fff" style={{ filter: 'drop-shadow(0 0.5px 1px rgba(0,0,0,0.3))' }} />
        </div>
      </div>

      {/* Menu Items */}
      <nav
        ref={navRef}
        data-no-dblclick
        className="flex items-center"
        style={{ WebkitAppRegion: 'no-drag', height: '100%' } as React.CSSProperties}
      >
        {menus.map((menu) => {
          const isOpen = openMenu === menu.label
          const isHighlighted = isOpen || hoveredMenu === menu.label

          return (
            <div
              key={menu.label}
              style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}
            >
              <button
                className="flex items-center justify-center"
                style={{
                  height: '100%',
                  padding: '0 8px',
                  fontSize: 'var(--titlebar-menu-font)',
                  color: isHighlighted
                    ? 'var(--text-primary)'
                    : altActive
                      ? 'var(--text-secondary)'
                      : 'var(--text-muted)',
                  background: isOpen
                    ? 'var(--titlebar-menu-active-bg)'
                    : isHighlighted
                      ? 'var(--titlebar-menu-hover-bg)'
                      : 'transparent',
                  borderRadius: 'var(--titlebar-item-radius)',
                  margin: '0 1px',
                  transition: 'color 0.15s ease, background 0.15s ease',
                  cursor: 'default',
                  border: 'none',
                  outline: 'none',
                }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  setOpenMenu(isOpen ? null : menu.label)
                  setAltActive(true)
                }}
                onMouseEnter={() => {
                  setHoveredMenu(menu.label)
                  /* Switch menus while another dropdown is already open */
                  if (openMenu && openMenu !== menu.label) {
                    setOpenMenu(menu.label)
                  }
                }}
                onMouseLeave={() => {
                  if (!openMenu) setHoveredMenu(null)
                }}
              >
                <AcceleratorLabel
                  label={menu.label}
                  accelerator={menu.accelerator}
                  showUnderline={altActive}
                />
              </button>

              {isOpen && (
                <DropdownMenu items={menu.items} onClose={closeMenu} />
              )}
            </div>
          )
        })}
      </nav>

      {/* Center: search pill / command quick access */}
      <div className="flex-1" />
      <div
        data-no-dblclick
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          WebkitAppRegion: 'no-drag',
          zIndex: 1,
        } as React.CSSProperties}
      >
        <button
          onClick={() => runCommand('go.file')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '3px 12px 3px 10px',
            minWidth: 280,
            maxWidth: 420,
            height: 26,
            fontSize: 12,
            color: 'var(--text-muted)',
            background: 'var(--titlebar-pill-bg)',
            border: '1px solid var(--titlebar-pill-border)',
            borderRadius: 20,
            cursor: 'pointer',
            transition: 'background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease',
            outline: 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--titlebar-pill-hover-bg)'
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.16)'
            e.currentTarget.style.boxShadow = '0 0 0 1px rgba(88, 166, 255, 0.1)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--titlebar-pill-bg)'
            e.currentTarget.style.borderColor = 'var(--titlebar-pill-border)'
            e.currentTarget.style.boxShadow = 'none'
          }}
          title="Go to File (Ctrl+P)"
        >
          <Search size={12} style={{ opacity: 0.45, flexShrink: 0 }} />
          <span
            style={{
              flex: 1,
              textAlign: 'left',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              letterSpacing: '0.01em',
            }}
          >
            {/* Show title in the pill */}
            {isModified && (
              <span
                style={{
                  color: 'var(--titlebar-modified-dot)',
                  marginRight: 4,
                  fontSize: 13,
                  lineHeight: 1,
                  verticalAlign: 'middle',
                }}
              >
                {'\u25CF'}
              </span>
            )}
            {windowTitle}
          </span>
          <span
            style={{
              fontSize: 10,
              opacity: 0.35,
              flexShrink: 0,
              marginLeft: 10,
              padding: '1px 5px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 4,
              lineHeight: '15px',
              fontFamily: 'inherit',
              letterSpacing: '0.02em',
            }}
          >
            Ctrl+P
          </span>
        </button>
      </div>
      <div className="flex-1" />

      {/* Window controls - Windows 11 style */}
      <div
        data-no-dblclick
        className="flex items-center"
        style={{ height: '100%', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Minimize */}
        <button
          onClick={() => window.api?.minimize?.()}
          className="flex items-center justify-center orion-winctrl"
          aria-label="Minimize"
          style={{
            width: 46,
            height: 32,
            color: 'var(--text-muted)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            cursor: 'default',
            transition: 'background 0.15s ease, color 0.15s ease',
            borderRadius: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--titlebar-winctrl-hover-bg)'
            e.currentTarget.style.color = 'var(--titlebar-winctrl-hover-color)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-muted)'
          }}
        >
          <Minus size={14} strokeWidth={1.2} />
        </button>

        {/* Maximize / Restore */}
        <button
          onClick={() => {
            window.api?.maximize?.()
            setIsMaximized((prev) => !prev)
          }}
          className="flex items-center justify-center orion-winctrl"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          style={{
            width: 46,
            height: 32,
            color: 'var(--text-muted)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            cursor: 'default',
            transition: 'background 0.15s ease, color 0.15s ease',
            borderRadius: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--titlebar-winctrl-hover-bg)'
            e.currentTarget.style.color = 'var(--titlebar-winctrl-hover-color)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-muted)'
          }}
        >
          {isMaximized ? (
            /* Restore icon: overlapping rectangles (Windows 11 style) */
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1">
              <rect x="2" y="3" width="6" height="6" rx="0.5" />
              <path d="M3.5 3V1.5C3.5 1.22 3.72 1 4 1H8.5C8.78 1 9 1.22 9 1.5V6C9 6.28 8.78 6.5 8.5 6.5H8" />
            </svg>
          ) : (
            <Square size={10} strokeWidth={1.2} />
          )}
        </button>

        {/* Close */}
        <button
          onClick={() => window.api?.close?.()}
          className="flex items-center justify-center orion-winctrl"
          aria-label="Close"
          style={{
            width: 46,
            height: 32,
            color: 'var(--text-muted)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            cursor: 'default',
            transition: 'background 0.15s ease, color 0.15s ease',
            borderRadius: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#c42b1c'
            e.currentTarget.style.color = '#ffffff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-muted)'
          }}
        >
          <X size={14} strokeWidth={1.2} />
        </button>
      </div>
    </header>
  )
}
