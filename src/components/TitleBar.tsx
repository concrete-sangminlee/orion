import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ChevronRight,
  Minus,
  Square,
  X,
  Zap,
  Search,
  Copy,
  Globe,
  Bug,
  ShieldCheck,
} from 'lucide-react'
import { useFileStore } from '@/store/files'
import { useEditorStore } from '@/store/editor'
import { useRecentFilesStore } from '@/store/recentFiles'

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
      --titlebar-accent: #58a6ff;
      --titlebar-debug-bg: rgba(234, 179, 8, 0.15);
      --titlebar-debug-color: #eab308;
      --titlebar-pill-bg: rgba(255, 255, 255, 0.05);
      --titlebar-pill-hover-bg: rgba(255, 255, 255, 0.08);
      --titlebar-pill-border: rgba(255, 255, 255, 0.08);
      --titlebar-modified-dot: #e5c07b;
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

function buildMenus(
  fileStore: ReturnType<typeof useFileStore>,
  editorStore: ReturnType<typeof useEditorStore>,
  recentFiles: { path: string; name: string }[],
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

  const dispatch = (name: string, detail?: unknown) =>
    window.dispatchEvent(detail ? new CustomEvent(name, { detail }) : new Event(name))

  /* ---------- recent files submenu ----------------------------------- */
  const recentFilesItems: MenuItem[] =
    recentFiles.length > 0
      ? [
          ...recentFiles.map((f) => ({
            type: 'action' as const,
            label: f.name,
            action: () => dispatch('orion:open-recent-file', { path: f.path, name: f.name }),
          })),
          { type: 'separator' as const },
          {
            type: 'action' as const,
            label: 'Clear Recently Opened',
            action: () => useRecentFilesStore.getState().clearRecent(),
          },
        ]
      : [
          {
            type: 'action' as const,
            label: '(No Recent Files)',
            action: () => {},
          },
        ]

  /* ---------- menus -------------------------------------------------- */
  return [
    /* ======================== File ======================== */
    {
      label: 'File',
      accelerator: 'F',
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
          label: 'New Window',
          shortcut: 'Ctrl+Shift+N',
          action: () => dispatch('orion:new-window'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Open Folder...',
          shortcut: 'Ctrl+O',
          action: () => window.api?.openFolder?.(),
        },
        {
          type: 'submenu',
          label: 'Open Recent',
          children: recentFilesItems,
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
          label: 'Save As...',
          shortcut: 'Ctrl+Shift+S',
          action: () => dispatch('orion:save-file-as'),
        },
        {
          type: 'action',
          label: 'Save All',
          action: saveAllFiles,
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Revert File',
          action: () => dispatch('orion:revert-file'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Close Tab',
          shortcut: 'Ctrl+W',
          action: () => dispatch('orion:close-tab'),
        },
        {
          type: 'action',
          label: 'Close All Tabs',
          action: () => dispatch('orion:close-all-tabs'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Auto Save',
          action: () => dispatch('orion:toggle-auto-save'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Preferences: Settings',
          shortcut: 'Ctrl+,',
          action: () => dispatch('orion:open-settings'),
        },
        {
          type: 'action',
          label: 'Preferences: Keyboard Shortcuts',
          shortcut: 'Ctrl+K Ctrl+S',
          action: () => dispatch('orion:keyboard-shortcuts'),
        },
        {
          type: 'action',
          label: 'Preferences: Color Theme',
          action: () => dispatch('orion:open-palette'),
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
    /* ======================== Edit ======================== */
    {
      label: 'Edit',
      accelerator: 'E',
      items: [
        {
          type: 'action',
          label: 'Undo',
          shortcut: 'Ctrl+Z',
          action: () => dispatch('orion:undo'),
        },
        {
          type: 'action',
          label: 'Redo',
          shortcut: 'Ctrl+Y',
          action: () => dispatch('orion:redo'),
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
          action: () => dispatch('orion:editor-find'),
        },
        {
          type: 'action',
          label: 'Replace',
          shortcut: 'Ctrl+H',
          action: () => dispatch('orion:editor-replace'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Find in Files',
          shortcut: 'Ctrl+Shift+F',
          action: () => dispatch('orion:show-search'),
        },
      ],
    },
    /* ======================== Selection ======================== */
    {
      label: 'Selection',
      accelerator: 'S',
      items: [
        {
          type: 'action',
          label: 'Select All',
          shortcut: 'Ctrl+A',
          action: () => document.execCommand('selectAll'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Expand Selection',
          shortcut: 'Shift+Alt+Right',
          action: () => dispatch('orion:expand-selection'),
        },
        {
          type: 'action',
          label: 'Shrink Selection',
          shortcut: 'Shift+Alt+Left',
          action: () => dispatch('orion:shrink-selection'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Add Cursor Above',
          shortcut: 'Ctrl+Alt+Up',
          action: () => dispatch('orion:add-cursor-above'),
        },
        {
          type: 'action',
          label: 'Add Cursor Below',
          shortcut: 'Ctrl+Alt+Down',
          action: () => dispatch('orion:add-cursor-below'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Select All Occurrences',
          shortcut: 'Ctrl+Shift+L',
          action: () => dispatch('orion:select-all-occurrences'),
        },
        {
          type: 'action',
          label: 'Add Next Occurrence',
          shortcut: 'Ctrl+D',
          action: () => dispatch('orion:add-selection-next-match'),
        },
      ],
    },
    /* ======================== Selection =================== */
    {
      label: 'Selection',
      accelerator: 'S',
      items: [
        {
          type: 'action',
          label: 'Select All',
          shortcut: 'Ctrl+A',
          action: () => dispatch('orion:select-all'),
        },
        {
          type: 'action',
          label: 'Expand Selection',
          shortcut: 'Shift+Alt+Right',
          action: () => dispatch('orion:expand-selection'),
        },
        {
          type: 'action',
          label: 'Shrink Selection',
          shortcut: 'Shift+Alt+Left',
          action: () => dispatch('orion:shrink-selection'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Copy Line Up',
          shortcut: 'Shift+Alt+Up',
          action: () => dispatch('orion:copy-line-up'),
        },
        {
          type: 'action',
          label: 'Copy Line Down',
          shortcut: 'Shift+Alt+Down',
          action: () => dispatch('orion:copy-line-down'),
        },
        {
          type: 'action',
          label: 'Move Line Up',
          shortcut: 'Alt+Up',
          action: () => dispatch('orion:move-line-up'),
        },
        {
          type: 'action',
          label: 'Move Line Down',
          shortcut: 'Alt+Down',
          action: () => dispatch('orion:move-line-down'),
        },
        {
          type: 'action',
          label: 'Duplicate Selection',
          action: () => dispatch('orion:duplicate-selection'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Add Cursor Above',
          shortcut: 'Ctrl+Alt+Up',
          action: () => dispatch('orion:add-cursor-above'),
        },
        {
          type: 'action',
          label: 'Add Cursor Below',
          shortcut: 'Ctrl+Alt+Down',
          action: () => dispatch('orion:add-cursor-below'),
        },
        {
          type: 'action',
          label: 'Add Cursors to Line Ends',
          shortcut: 'Shift+Alt+I',
          action: () => dispatch('orion:add-cursors-line-ends'),
        },
        {
          type: 'action',
          label: 'Add Next Occurrence',
          shortcut: 'Ctrl+D',
          action: () => dispatch('orion:add-selection-next-match'),
        },
        {
          type: 'action',
          label: 'Select All Occurrences',
          shortcut: 'Ctrl+Shift+L',
          action: () => dispatch('orion:select-all-occurrences'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Column Selection Mode',
          action: () => dispatch('orion:toggle-column-selection'),
        },
      ],
    },
    /* ======================== View ======================== */
    {
      label: 'View',
      accelerator: 'V',
      items: [
        {
          type: 'action',
          label: 'Command Palette',
          shortcut: 'Ctrl+Shift+P',
          action: () => dispatch('orion:open-palette'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Explorer',
          shortcut: 'Ctrl+Shift+E',
          action: () => dispatch('orion:show-explorer'),
        },
        {
          type: 'action',
          label: 'Search',
          shortcut: 'Ctrl+Shift+F',
          action: () => dispatch('orion:show-search'),
        },
        {
          type: 'action',
          label: 'Source Control',
          shortcut: 'Ctrl+Shift+G',
          action: () => dispatch('orion:show-git'),
        },
        {
          type: 'action',
          label: 'Extensions',
          shortcut: 'Ctrl+Shift+X',
          action: () => dispatch('orion:show-extensions'),
        },
        { type: 'separator' },
        {
          type: 'submenu',
          label: 'Appearance',
          children: [
            {
              type: 'action',
              label: 'Zen Mode',
              shortcut: 'Ctrl+K Z',
              action: () => dispatch('orion:zen-mode'),
            },
            {
              type: 'action',
              label: 'Toggle Full Screen',
              shortcut: 'F11',
              action: () => dispatch('orion:toggle-fullscreen'),
            },
            { type: 'separator' },
            {
              type: 'action',
              label: 'Toggle Status Bar',
              action: () => dispatch('orion:toggle-statusbar'),
            },
            {
              type: 'action',
              label: 'Toggle Activity Bar',
              action: () => dispatch('orion:toggle-activitybar'),
            },
            {
              type: 'action',
              label: 'Toggle Sidebar',
              shortcut: 'Ctrl+B',
              action: () => dispatch('orion:toggle-sidebar'),
            },
            {
              type: 'action',
              label: 'Toggle Panel',
              shortcut: 'Ctrl+J',
              action: () => dispatch('orion:toggle-panel'),
            },
          ],
        },
        {
          type: 'submenu',
          label: 'Editor Layout',
          children: [
            {
              type: 'action',
              label: 'Split Right',
              shortcut: 'Ctrl+\\',
              action: () => dispatch('orion:split-right'),
            },
            {
              type: 'action',
              label: 'Split Down',
              action: () => dispatch('orion:split-down'),
            },
          ],
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Terminal',
          shortcut: 'Ctrl+`',
          action: () => dispatch('orion:toggle-terminal'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Toggle Minimap',
          action: () => dispatch('orion:toggle-minimap'),
        },
        {
          type: 'action',
          label: 'Word Wrap',
          shortcut: 'Alt+Z',
          action: () => dispatch('orion:toggle-wordwrap'),
        },
      ],
    },
    /* ======================== Go ======================== */
    {
      label: 'Go',
      accelerator: 'G',
      items: [
        {
          type: 'action',
          label: 'Go to File...',
          shortcut: 'Ctrl+P',
          action: () => dispatch('orion:open-palette'),
        },
        {
          type: 'action',
          label: 'Go to Line...',
          shortcut: 'Ctrl+G',
          action: () => dispatch('orion:go-to-line'),
        },
        {
          type: 'action',
          label: 'Go to Symbol...',
          shortcut: 'Ctrl+Shift+O',
          action: () => dispatch('orion:show-outline'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Go to Definition',
          shortcut: 'F12',
          action: () => dispatch('orion:go-to-definition'),
        },
        {
          type: 'action',
          label: 'Go to References',
          shortcut: 'Shift+F12',
          action: () => dispatch('orion:go-to-references'),
        },
      ],
    },
    /* ======================== Run ======================== */
    {
      label: 'Run',
      accelerator: 'R',
      items: [
        {
          type: 'action',
          label: 'Run Build Task',
          shortcut: 'Ctrl+Shift+B',
          action: () => dispatch('orion:run-build'),
        },
        {
          type: 'action',
          label: 'Run Task...',
          action: () => dispatch('orion:run-task'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Toggle Breakpoint',
          shortcut: 'F9',
          action: () => dispatch('orion:toggle-breakpoint'),
        },
      ],
    },
    /* ======================== Terminal ======================== */
    {
      label: 'Terminal',
      accelerator: 'T',
      items: [
        {
          type: 'action',
          label: 'New Terminal',
          shortcut: 'Ctrl+`',
          action: () => dispatch('orion:toggle-terminal'),
        },
        {
          type: 'action',
          label: 'Split Terminal',
          action: () => dispatch('orion:split-terminal'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Clear Terminal',
          action: () => dispatch('orion:clear-terminal'),
        },
      ],
    },
    /* ======================== Run ========================= */
    {
      label: 'Run',
      accelerator: 'R',
      items: [
        {
          type: 'action',
          label: 'Start Debugging',
          shortcut: 'F5',
          action: () => dispatch('orion:debug-start'),
        },
        {
          type: 'action',
          label: 'Run Without Debugging',
          shortcut: 'Ctrl+F5',
          action: () => dispatch('orion:debug-run-no-debug'),
        },
        {
          type: 'action',
          label: 'Stop Debugging',
          shortcut: 'Shift+F5',
          action: () => dispatch('orion:debug-stop'),
        },
        {
          type: 'action',
          label: 'Restart Debugging',
          shortcut: 'Ctrl+Shift+F5',
          action: () => dispatch('orion:debug-restart'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Step Over',
          shortcut: 'F10',
          action: () => dispatch('orion:debug-step-over'),
        },
        {
          type: 'action',
          label: 'Step Into',
          shortcut: 'F11',
          action: () => dispatch('orion:debug-step-into'),
        },
        {
          type: 'action',
          label: 'Step Out',
          shortcut: 'Shift+F11',
          action: () => dispatch('orion:debug-step-out'),
        },
        {
          type: 'action',
          label: 'Continue',
          shortcut: 'F5',
          action: () => dispatch('orion:debug-continue'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Toggle Breakpoint',
          shortcut: 'F9',
          action: () => dispatch('orion:debug-toggle-breakpoint'),
        },
        {
          type: 'action',
          label: 'Add Configuration...',
          action: () => dispatch('orion:debug-add-config'),
        },
      ],
    },
    /* ======================== Help ======================== */
    {
      label: 'Help',
      accelerator: 'H',
      items: [
        {
          type: 'action',
          label: 'Welcome',
          action: () => dispatch('orion:show-welcome'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Keyboard Shortcuts Reference',
          shortcut: 'Ctrl+K Ctrl+S',
          action: () => dispatch('orion:keyboard-shortcuts'),
        },
        {
          type: 'action',
          label: 'Documentation',
          action: () =>
            window.open('https://github.com/concrete-sangminlee/orion', '_blank'),
        },
        {
          type: 'action',
          label: 'Release Notes',
          action: () => dispatch('orion:show-release-notes'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'Report Issue',
          action: () =>
            window.open('https://github.com/concrete-sangminlee/orion/issues', '_blank'),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: 'About Orion',
          action: () => dispatch('orion:show-about'),
        },
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
                  transition: 'background 0.08s, color 0.08s',
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
                  transition: 'background 0.08s, color 0.08s',
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
  const [isDebugging, setIsDebugging] = useState(false)
  const [remoteConnected] = useState(false) // placeholder for remote connection
  const [workspaceTrusted] = useState(true) // placeholder for workspace trust
  const navRef = useRef<HTMLElement>(null)
  const titleBarRef = useRef<HTMLElement>(null)

  const fileStore = useFileStore()
  const editorStore = useEditorStore()
  const recentFiles = useRecentFilesStore((s) => s.getRecent(5))
  const menus = buildMenus(fileStore, editorStore, recentFiles)

  /* Inject CSS variables */
  useEffect(() => {
    ensureTitleBarStyles()
  }, [])

  /* Active file info */
  const activeFile = editorStore.openFiles.find(
    (f) => f.path === editorStore.activeFilePath,
  )
  const fileName = activeFile?.name || ''
  const isModified = activeFile?.isModified || false
  const folderName = folderNameFromPath(fileStore.rootPath)

  /* Build title string: "[modified dot] filename - folder - Orion IDE" */
  const titleParts: string[] = []
  if (fileName) titleParts.push(fileName)
  if (folderName) titleParts.push(folderName)
  titleParts.push('Orion IDE')

  /* Listen for debug session events */
  useEffect(() => {
    const onDebugStart = () => setIsDebugging(true)
    const onDebugStop = () => setIsDebugging(false)
    window.addEventListener('orion:debug-start', onDebugStart)
    window.addEventListener('orion:debug-stop', onDebugStop)
    return () => {
      window.removeEventListener('orion:debug-start', onDebugStart)
      window.removeEventListener('orion:debug-stop', onDebugStop)
    }
  }, [])

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
        background: isDebugging
          ? 'linear-gradient(90deg, var(--titlebar-bg) 0%, var(--titlebar-debug-bg) 50%, var(--titlebar-bg) 100%)'
          : 'var(--titlebar-bg)',
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
                  transition: 'color 0.1s, background 0.1s',
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

      {/* Left indicators */}
      <div
        className="flex items-center gap-1"
        style={{
          marginLeft: 8,
          WebkitAppRegion: 'no-drag',
          height: '100%',
        } as React.CSSProperties}
        data-no-dblclick
      >
        {/* Remote connection indicator (placeholder) */}
        {remoteConnected && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              fontSize: 11,
              color: 'var(--titlebar-accent)',
              background: 'rgba(88, 166, 255, 0.1)',
              borderRadius: 12,
            }}
          >
            <Globe size={11} />
            <span>Remote</span>
          </div>
        )}

        {/* Debugging indicator */}
        {isDebugging && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--titlebar-debug-color)',
              background: 'var(--titlebar-debug-bg)',
              borderRadius: 12,
              letterSpacing: '0.3px',
            }}
          >
            <Bug size={11} />
            <span>Debugging</span>
          </div>
        )}

        {/* Workspace trust indicator */}
        {workspaceTrusted && folderName && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              padding: '2px 6px',
              fontSize: 10,
              color: 'var(--text-muted)',
              opacity: 0.5,
            }}
            title="Workspace is trusted"
          >
            <ShieldCheck size={10} />
          </div>
        )}
      </div>

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
          onClick={() => window.dispatchEvent(new Event('orion:open-palette'))}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 12px 3px 10px',
            minWidth: 220,
            maxWidth: 380,
            height: 24,
            fontSize: 11,
            color: 'var(--text-muted)',
            background: 'var(--titlebar-pill-bg)',
            border: '1px solid var(--titlebar-pill-border)',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'background 0.12s, border-color 0.12s',
            outline: 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--titlebar-pill-hover-bg)'
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.14)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--titlebar-pill-bg)'
            e.currentTarget.style.borderColor = 'var(--titlebar-pill-border)'
          }}
          title="Search or run a command (Ctrl+Shift+P)"
        >
          <Search size={11} style={{ opacity: 0.5, flexShrink: 0 }} />
          <span
            style={{
              flex: 1,
              textAlign: 'left',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
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
            {titleParts.join(' \u2014 ')}
          </span>
          <span
            style={{
              fontSize: 10,
              opacity: 0.4,
              flexShrink: 0,
              marginLeft: 8,
              padding: '0 4px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 3,
              lineHeight: '16px',
            }}
          >
            Ctrl+Shift+P
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
          className="flex items-center justify-center"
          aria-label="Minimize"
          style={{
            width: 46,
            height: '100%',
            color: 'var(--text-muted)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            cursor: 'default',
            transition: 'background 0.1s, color 0.1s',
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
          <Minus size={13} strokeWidth={1.5} />
        </button>

        {/* Maximize / Restore */}
        <button
          onClick={() => {
            window.api?.maximize?.()
            setIsMaximized((prev) => !prev)
          }}
          className="flex items-center justify-center"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          style={{
            width: 46,
            height: '100%',
            color: 'var(--text-muted)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            cursor: 'default',
            transition: 'background 0.1s, color 0.1s',
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
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="2" y="3" width="6" height="6" rx="0.5" />
              <path d="M3.5 3V1.5C3.5 1.22 3.72 1 4 1H8.5C8.78 1 9 1.22 9 1.5V6C9 6.28 8.78 6.5 8.5 6.5H8" />
            </svg>
          ) : (
            <Square size={10} strokeWidth={1.5} />
          )}
        </button>

        {/* Close */}
        <button
          onClick={() => window.api?.close?.()}
          className="flex items-center justify-center"
          aria-label="Close"
          style={{
            width: 46,
            height: '100%',
            color: 'var(--text-muted)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            cursor: 'default',
            transition: 'background 0.1s, color 0.1s',
            borderRadius: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--titlebar-close-hover-bg)'
            e.currentTarget.style.color = 'var(--titlebar-close-hover-color)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-muted)'
          }}
        >
          <X size={13} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  )
}
