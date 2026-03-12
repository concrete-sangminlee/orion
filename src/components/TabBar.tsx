import { useState, useRef, useEffect, useCallback } from 'react'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { X } from 'lucide-react'

const extColors: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6', js: '#f1e05a', jsx: '#f1e05a',
  json: '#8b949e', html: '#e34c26', css: '#563d7c', py: '#3572a5',
  rs: '#dea584', go: '#00add8', md: '#083fa1', yaml: '#cb171e',
  yml: '#cb171e', toml: '#9c4121', sh: '#89e051', vue: '#41b883',
  svg: '#ffb13b', scss: '#c6538c', less: '#1d365d', lua: '#000080',
}

/** Inline confirmation popover for closing a modified file */
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

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onCancel()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onCancel])

  // Close on Escape
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

/** Context menu for right-clicking a tab */
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
    closeFile,
    closeAllFiles,
    closeOtherFiles,
    closeToRight,
    closeSaved,
  } = useEditorStore()
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

  const items = [
    { id: 'close', label: 'Close', shortcut: 'Ctrl+W', action: () => closeFile(filePath) },
    { id: 'close-others', label: 'Close Others', action: () => closeOtherFiles(filePath) },
    { id: 'close-all', label: 'Close All', action: () => closeAllFiles() },
    { id: 'close-right', label: 'Close to the Right', action: () => closeToRight(filePath) },
    { id: 'divider', label: '', action: () => {} },
    { id: 'close-saved', label: 'Close Saved', action: () => closeSaved() },
  ]

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 9999,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '4px 0',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        minWidth: 180,
      }}
    >
      {items.map((item) => {
        if (item.id === 'divider') {
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
        return (
          <button
            key={item.id}
            onClick={() => {
              item.action()
              onClose()
            }}
            onMouseEnter={() => setHoveredItem(item.id)}
            onMouseLeave={() => setHoveredItem(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '5px 14px',
              fontSize: 12,
              color: hoveredItem === item.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: hoveredItem === item.id ? 'rgba(255,255,255,0.06)' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.1s, color 0.1s',
              textAlign: 'left',
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 20 }}>
                {item.shortcut}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Tab switcher overlay (Ctrl+Tab) */
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
  } = useEditorStore()
  const { addToast } = useToastStore()
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

  // Handle attempting to close a tab (checks for unsaved changes)
  const handleCloseTab = useCallback(
    (filePath: string, anchorEl?: HTMLElement) => {
      const file = openFiles.find((f) => f.path === filePath)
      if (file && file.isModified) {
        const rect = anchorEl?.getBoundingClientRect() ?? null
        setConfirmClose({ path: filePath, name: file.name, anchorRect: rect })
      } else {
        closeFile(filePath)
      }
    },
    [openFiles, closeFile]
  )

  // Save then close
  const handleSaveAndClose = useCallback(
    async (filePath: string) => {
      const file = openFiles.find((f) => f.path === filePath)
      if (file) {
        try {
          await window.api.writeFile(filePath, file.content)
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

  // Tab switcher keyboard handler
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
          // Select the highlighted tab
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

  if (openFiles.length === 0) return null

  return (
    <>
      <div
        className="shrink-0 flex items-end overflow-x-auto"
        style={{
          height: 35,
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border)',
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
          // Modified files: show dot when not hovering close area, show X on hover
          const showCloseX = file.isModified ? isCloseHovered : (isActive || isHovered)
          const showModDot = file.isModified && !isCloseHovered && !showCloseX

          return (
            <div
              key={file.path}
              draggable={true}
              onDragStart={(e) => {
                dragIndexRef.current = index
                setDraggingPath(file.path)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('application/x-orion-tab', file.path)
                e.dataTransfer.setData('text/plain', file.path)
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
                setDragOverPath(null)
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
              onClick={() => setActiveFile(file.path)}
              onDoubleClick={() => {
                if (isPreview) pinFile(file.path)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, path: file.path })
              }}
              className="shrink-0 flex items-center cursor-pointer"
              style={{
                height: 35,
                paddingLeft: 14,
                paddingRight: 8,
                maxWidth: 200,
                minWidth: 0,
                gap: 6,
                position: 'relative',
                fontSize: 12,
                background: isActive
                  ? 'var(--bg-primary)'
                  : isHovered
                    ? 'rgba(255, 255, 255, 0.03)'
                    : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                transition: 'background 0.1s, color 0.1s',
                borderRight: index < openFiles.length - 1
                  ? '1px solid rgba(255, 255, 255, 0.04)'
                  : 'none',
                borderLeft: isDragOver
                  ? '2px solid var(--accent)'
                  : '2px solid transparent',
                opacity: isDragging ? 0.5 : 1,
              }}
              onMouseEnter={() => setHoveredTab(file.path)}
              onMouseLeave={() => {
                setHoveredTab(null)
                setHoveredCloseBtn(null)
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

              {/* Inactive tab bottom border (to match bg-tertiary -> bg-primary boundary) */}
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

              {/* File name */}
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

              {/* Modified dot / Close button area */}
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
                {/* Modified dot (accent color) - shown when file is modified and close X is NOT visible */}
                {showModDot && (
                  <span
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

                {/* Non-modified: show close X on active/hover (no modified dot to worry about) */}
                {!file.isModified && (isActive || isHovered) && !showCloseX && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      closeFile(file.path)
                    }}
                    className="flex items-center justify-center"
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      color: 'var(--text-muted)',
                      transition: 'background 0.1s, color 0.1s',
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
            </div>
          )
        })}

        {/* Fill remaining tab bar space */}
        <div
          className="flex-1"
          style={{
            height: 35,
            borderBottom: '1px solid var(--border)',
          }}
        />

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
    </>
  )
}
