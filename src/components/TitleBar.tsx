import { useState, useEffect, useRef, useCallback } from 'react'
import { Minus, Square, X, Zap } from 'lucide-react'
import { useFileStore } from '@/store/files'
import { useEditorStore } from '@/store/editor'

/* ------------------------------------------------------------------ */
/*  Menu definitions                                                   */
/* ------------------------------------------------------------------ */

type MenuItem =
  | { type: 'action'; label: string; shortcut?: string; action: () => void }
  | { type: 'separator' }

type MenuDef = { label: string; items: MenuItem[] }

function buildMenus(
  fileStore: ReturnType<typeof useFileStore>,
  editorStore: ReturnType<typeof useEditorStore>,
): MenuDef[] {
  /* ---------- helpers ------------------------------------------------ */
  const saveActiveFile = () => {
    const active = editorStore.openFiles.find(
      (f) => f.path === editorStore.activeFilePath,
    )
    if (active && active.path) {
      window.api?.saveFile?.(active.path, active.content)
    }
  }

  const saveAllFiles = () => {
    editorStore.openFiles.forEach((f) => {
      if (f.isModified && f.path) {
        window.api?.saveFile?.(f.path, f.content)
      }
    })
  }

  /* ---------- menus -------------------------------------------------- */
  return [
    {
      label: 'File',
      items: [
        {
          type: 'action',
          label: 'New File',
          shortcut: 'Ctrl+N',
          action: () => {
            const untitled = `untitled-${Date.now()}`
            editorStore.openFile({
              path: untitled,
              name: 'Untitled',
              content: '',
              language: 'plaintext',
              isModified: false,
            })
          },
        },
        {
          type: 'action',
          label: 'Open Folder...',
          shortcut: 'Ctrl+K Ctrl+O',
          action: () => {
            window.api?.openFolder?.()
          },
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Save',
          shortcut: 'Ctrl+S',
          action: saveActiveFile,
        },
        {
          type: 'action',
          label: 'Save All',
          shortcut: 'Ctrl+K S',
          action: saveAllFiles,
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Exit',
          shortcut: 'Alt+F4',
          action: () => window.api?.close?.(),
        },
      ],
    },
    {
      label: 'Edit',
      items: [
        {
          type: 'action',
          label: 'Undo',
          shortcut: 'Ctrl+Z',
          action: () => document.execCommand('undo'),
        },
        {
          type: 'action',
          label: 'Redo',
          shortcut: 'Ctrl+Y',
          action: () => document.execCommand('redo'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Cut',
          shortcut: 'Ctrl+X',
          action: () => document.execCommand('cut'),
        },
        {
          type: 'action',
          label: 'Copy',
          shortcut: 'Ctrl+C',
          action: () => document.execCommand('copy'),
        },
        {
          type: 'action',
          label: 'Paste',
          shortcut: 'Ctrl+V',
          action: () => navigator.clipboard.readText().then((t) => document.execCommand('insertText', false, t)).catch(() => {}),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Find',
          shortcut: 'Ctrl+F',
          action: () => window.dispatchEvent(new CustomEvent('orion:find')),
        },
      ],
    },
    {
      label: 'View',
      items: [
        {
          type: 'action',
          label: 'Command Palette',
          shortcut: 'Ctrl+Shift+P',
          action: () =>
            window.dispatchEvent(new CustomEvent('orion:command-palette')),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Explorer',
          shortcut: 'Ctrl+Shift+E',
          action: () =>
            window.dispatchEvent(
              new CustomEvent('orion:toggle-panel', { detail: 'explorer' }),
            ),
        },
        {
          type: 'action',
          label: 'Search',
          shortcut: 'Ctrl+Shift+F',
          action: () =>
            window.dispatchEvent(
              new CustomEvent('orion:toggle-panel', { detail: 'search' }),
            ),
        },
        {
          type: 'action',
          label: 'Source Control',
          shortcut: 'Ctrl+Shift+G',
          action: () =>
            window.dispatchEvent(
              new CustomEvent('orion:toggle-panel', {
                detail: 'source-control',
              }),
            ),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Toggle Terminal',
          shortcut: 'Ctrl+`',
          action: () =>
            window.dispatchEvent(new CustomEvent('orion:toggle-terminal')),
        },
        {
          type: 'action',
          label: 'Toggle Sidebar',
          shortcut: 'Ctrl+B',
          action: () =>
            window.dispatchEvent(new CustomEvent('orion:toggle-sidebar')),
        },
      ],
    },
    {
      label: 'Terminal',
      items: [
        {
          type: 'action',
          label: 'New Terminal',
          shortcut: 'Ctrl+Shift+`',
          action: () =>
            window.dispatchEvent(new CustomEvent('orion:new-terminal')),
        },
      ],
    },
    {
      label: 'Help',
      items: [
        {
          type: 'action',
          label: 'About Orion',
          action: () =>
            window.dispatchEvent(new CustomEvent('orion:about')),
        },
      ],
    },
  ]
}

/* ------------------------------------------------------------------ */
/*  Dropdown component                                                 */
/* ------------------------------------------------------------------ */

function DropdownMenu({
  items,
  onClose,
}: {
  items: MenuItem[]
  onClose: () => void
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: 2,
        minWidth: 220,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.3)',
        padding: 4,
        zIndex: 9999,
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
                background: 'var(--border)',
                margin: '4px 8px',
              }}
            />
          )
        }

        const isHovered = hoveredIdx === idx
        return (
          <button
            key={item.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              fontSize: 12,
              padding: '5px 24px 5px 8px',
              borderRadius: 4,
              color: isHovered ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: isHovered ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: 'none',
              cursor: 'default',
              textAlign: 'left',
              lineHeight: '18px',
              transition: 'background 0.08s, color 0.08s',
            }}
            onMouseEnter={() => setHoveredIdx(idx)}
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
/*  TitleBar                                                           */
/* ------------------------------------------------------------------ */

export default function TitleBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [hoveredMenu, setHoveredMenu] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)

  const fileStore = useFileStore()
  const editorStore = useEditorStore()
  const menus = buildMenus(fileStore, editorStore)

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

  const closeMenu = useCallback(() => setOpenMenu(null), [])

  return (
    <header
      className="shrink-0 flex items-center select-none"
      style={{
        height: 38,
        background: 'var(--bg-tertiary)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* Logo + Brand */}
      <div
        className="flex items-center gap-2"
        style={{ paddingLeft: 14, paddingRight: 8, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            background: 'linear-gradient(135deg, #58a6ff 0%, #bc8cff 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Zap size={10} color="#fff" fill="#fff" />
        </div>
        <span
          style={{
            color: 'var(--text-muted)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.3px',
          }}
        >
          Orion
        </span>
      </div>

      {/* Menu Items */}
      <nav
        ref={navRef}
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
                  fontSize: 12,
                  color: isHighlighted ? 'var(--text-primary)' : 'var(--text-muted)',
                  background: isOpen
                    ? 'rgba(255, 255, 255, 0.10)'
                    : isHighlighted
                      ? 'rgba(255, 255, 255, 0.06)'
                      : 'transparent',
                  borderRadius: 4,
                  margin: '0 1px',
                  transition: 'color 0.1s, background 0.1s',
                  cursor: 'default',
                }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  setOpenMenu(isOpen ? null : menu.label)
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
                {menu.label}
              </button>

              {isOpen && (
                <DropdownMenu items={menu.items} onClose={closeMenu} />
              )}
            </div>
          )
        })}
      </nav>

      {/* Center drag region */}
      <div className="flex-1" />

      {/* Window title (subtle, centered) */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 11,
          color: 'var(--text-muted)',
          pointerEvents: 'none',
          opacity: 0.6,
        }}
      >
        Orion
      </div>

      {/* Window controls */}
      <div
        className="flex items-center"
        style={{ height: '100%', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {[
          {
            Icon: Minus,
            onClick: () => window.api?.minimize(),
            hoverBg: 'rgba(255, 255, 255, 0.06)',
            hoverColor: 'var(--text-primary)',
          },
          {
            Icon: Square,
            onClick: () => window.api?.maximize(),
            hoverBg: 'rgba(255, 255, 255, 0.06)',
            hoverColor: 'var(--text-primary)',
            size: 10,
          },
          {
            Icon: X,
            onClick: () => window.api?.close(),
            hoverBg: '#c42b1c',
            hoverColor: '#ffffff',
          },
        ].map(({ Icon, onClick, hoverBg, hoverColor, size }, i) => (
          <button
            key={i}
            onClick={onClick}
            className="flex items-center justify-center"
            style={{
              width: 46,
              height: '100%',
              color: 'var(--text-muted)',
              transition: 'background 0.1s, color 0.1s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = hoverBg
              e.currentTarget.style.color = hoverColor
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-muted)'
            }}
          >
            <Icon size={(size as number) || 13} strokeWidth={1.5} />
          </button>
        ))}
      </div>
    </header>
  )
}
