import { useState, useCallback, useEffect, useRef } from 'react'
import { useFileStore } from '@/store/files'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import {
  ChevronRight, ChevronsDownUp,
  File, FileCode2, FileJson, FileText, FileImage,
  Folder, FolderOpen, FolderPlus, RotateCw,
  Settings, Braces, Hash, FileType, Image, Code,
  FilePlus, Trash2, Edit3, Clipboard, Plus,
} from 'lucide-react'
import type { FileNode } from '@shared/types'

/* ── Context menu types ──────────────────────────────────── */

interface ContextMenuState {
  x: number
  y: number
  node: FileNode
}

type InlineInputMode = 'new-file' | 'new-folder' | 'rename'

interface InlineInputState {
  mode: InlineInputMode
  parentPath: string
  /** Only set when mode === 'rename' */
  existingName?: string
  existingPath?: string
  depth: number
}

/* ── File icon mapping ─────────────────────────────────── */

type IconEntry = { Icon: typeof File; color: string }

const fileIcons: Record<string, IconEntry> = {
  ts:    { Icon: Code, color: '#3178c6' },
  tsx:   { Icon: Code, color: '#3178c6' },
  js:    { Icon: Code, color: '#f1e05a' },
  jsx:   { Icon: Code, color: '#f1e05a' },
  py:    { Icon: FileCode2, color: '#3572a5' },
  rs:    { Icon: FileCode2, color: '#dea584' },
  go:    { Icon: FileCode2, color: '#00add8' },
  json:  { Icon: Braces, color: '#cbcb41' },
  yaml:  { Icon: FileText, color: '#cb171e' },
  yml:   { Icon: FileText, color: '#cb171e' },
  toml:  { Icon: FileText, color: '#9c4121' },
  md:    { Icon: FileType, color: '#519aba' },
  txt:   { Icon: FileText, color: '#8b949e' },
  png:   { Icon: Image, color: '#a371f7' },
  jpg:   { Icon: Image, color: '#a371f7' },
  jpeg:  { Icon: Image, color: '#a371f7' },
  gif:   { Icon: Image, color: '#a371f7' },
  webp:  { Icon: Image, color: '#a371f7' },
  svg:   { Icon: Image, color: '#f78166' },
  html:  { Icon: Code, color: '#e34c26' },
  css:   { Icon: Hash, color: '#563d7c' },
  scss:  { Icon: Hash, color: '#c6538c' },
  less:  { Icon: Hash, color: '#1d365d' },
  vue:   { Icon: Code, color: '#41b883' },
  sh:    { Icon: FileCode2, color: '#89e051' },
  bash:  { Icon: FileCode2, color: '#89e051' },
  env:   { Icon: Settings, color: '#ecd53f' },
}

const configPatterns = [
  '.config', '.rc', '.prettierrc', '.eslintrc',
  'tsconfig', 'vite.config', 'webpack.config', 'jest.config',
  'tailwind.config', 'postcss.config',
]

function getFileInfo(name: string): IconEntry {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (fileIcons[ext]) return fileIcons[ext]
  const lowerName = name.toLowerCase()
  if (configPatterns.some((p) => lowerName.includes(p))) {
    return { Icon: Settings, color: '#8b949e' }
  }
  if (lowerName === '.gitignore' || lowerName === '.editorconfig') {
    return { Icon: Settings, color: '#8b949e' }
  }
  return { Icon: File, color: '#8b949e' }
}

/* ── Git status colors ─────────────────────────────────── */

const gitColors: Record<string, string> = {
  modified:  '#d29922',
  added:     '#3fb950',
  deleted:   '#f85149',
  untracked: '#8b949e',
  renamed:   '#d2a8ff',
}

/* ── Indent guide component ────────────────────────────── */

function IndentGuides({ depth }: { depth: number }) {
  if (depth <= 0) return null
  return (
    <>
      {Array.from({ length: depth }).map((_, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: i * 16 + 12,
            top: 0,
            bottom: 0,
            width: 1,
            background: 'var(--border)',
            opacity: 0.5,
          }}
        />
      ))}
    </>
  )
}

/* ── Context menu component ───────────────────────────── */

function ContextMenu({
  x,
  y,
  node,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onCopyPath,
}: {
  x: number
  y: number
  node: FileNode
  onClose: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onRename: () => void
  onDelete: () => void
  onCopyPath: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  /* Clamp position so menu doesn't overflow viewport */
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      menuRef.current.style.left = `${window.innerWidth - rect.width - 6}px`
    }
    if (rect.bottom > window.innerHeight) {
      menuRef.current.style.top = `${window.innerHeight - rect.height - 6}px`
    }
  }, [x, y])

  const isDir = node.type === 'directory'

  const items: {
    label: string
    icon: typeof File
    action: () => void
    separator?: boolean
    hidden?: boolean
  }[] = [
    { label: 'New File', icon: FilePlus, action: onNewFile, hidden: !isDir },
    { label: 'New Folder', icon: Plus, action: onNewFolder, hidden: !isDir, separator: isDir },
    { label: 'Rename', icon: Edit3, action: onRename },
    { label: 'Delete', icon: Trash2, action: onDelete, separator: true },
    { label: 'Copy Path', icon: Clipboard, action: onCopyPath },
  ]

  const visibleItems = items.filter((it) => !it.hidden)

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 9999,
        minWidth: 170,
        background: 'var(--bg-secondary, #1e1e2e)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
        padding: '4px 0',
        fontSize: 12,
      }}
    >
      {visibleItems.map((item, i) => {
        const IconComp = item.icon
        return (
          <div key={item.label}>
            <div
              onClick={(e) => {
                e.stopPropagation()
                item.action()
              }}
              className="flex items-center gap-2 cursor-pointer transition-colors duration-75"
              style={{
                padding: '5px 14px',
                color: item.label === 'Delete' ? '#f85149' : 'var(--text-secondary)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <IconComp size={13} style={{ flexShrink: 0, opacity: 0.8 }} />
              <span>{item.label}</span>
            </div>
            {item.separator && i < visibleItems.length - 1 && (
              <div
                style={{
                  height: 1,
                  background: 'var(--border)',
                  margin: '3px 8px',
                  opacity: 0.6,
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── Inline input for new file / new folder / rename ───── */

function InlineInput({
  mode,
  depth,
  initialValue,
  onSubmit,
  onCancel,
}: {
  mode: InlineInputMode
  depth: number
  initialValue: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Focus & select on mount
    requestAnimationFrame(() => {
      if (!inputRef.current) return
      inputRef.current.focus()
      if (mode === 'rename') {
        // Select name part without extension
        const dotIndex = initialValue.lastIndexOf('.')
        if (dotIndex > 0) {
          inputRef.current.setSelectionRange(0, dotIndex)
        } else {
          inputRef.current.select()
        }
      } else {
        inputRef.current.select()
      }
    })
  }, [])

  const isFolder = mode === 'new-folder'
  const IconComp = isFolder ? Folder : File

  return (
    <div
      className="flex items-center"
      style={{
        height: 24,
        paddingLeft: depth * 16 + 24,
        paddingRight: 8,
        position: 'relative',
        background: 'rgba(88,166,255,0.08)',
      }}
    >
      <IndentGuides depth={depth} />
      <IconComp
        size={14}
        style={{
          color: isFolder ? '#8b949e' : '#8b949e',
          flexShrink: 0,
          marginRight: 6,
        }}
      />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const trimmed = value.trim()
            if (trimmed) onSubmit(trimmed)
            else onCancel()
          }
          if (e.key === 'Escape') onCancel()
        }}
        onBlur={() => {
          const trimmed = value.trim()
          if (trimmed && trimmed !== initialValue) onSubmit(trimmed)
          else onCancel()
        }}
        style={{
          flex: 1,
          background: 'var(--bg-primary, #11111b)',
          border: '1px solid var(--accent)',
          borderRadius: 3,
          color: 'var(--text-primary)',
          fontSize: 12,
          padding: '1px 6px',
          outline: 'none',
          height: 18,
        }}
      />
    </div>
  )
}

/* ── File tree node ────────────────────────────────────── */

function FileTreeNode({
  node,
  depth,
  onContextMenu,
  inlineInput,
  onInlineSubmit,
  onInlineCancel,
}: {
  node: FileNode
  depth: number
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  inlineInput: InlineInputState | null
  onInlineSubmit: (value: string) => void
  onInlineCancel: () => void
}) {
  const { expandedDirs, toggleDir } = useFileStore()
  const { openFile, activeFilePath } = useEditorStore()
  const [contextActive, setContextActive] = useState(false)
  const isExpanded = expandedDirs.has(node.path)
  const isActive = activeFilePath === node.path
  const isDir = node.type === 'directory'

  /* Is this node being renamed inline? */
  const isRenaming =
    inlineInput?.mode === 'rename' && inlineInput.existingPath === node.path

  const handleClick = async () => {
    if (isDir) {
      toggleDir(node.path)
    } else {
      try {
        const result = await window.api.readFile(node.path)
        openFile({
          path: node.path,
          name: node.name,
          content: result.content,
          language: result.language,
          isModified: false,
          aiModified: false,
        })
      } catch (e) {
        console.error('Failed to open file:', e)
      }
    }
  }

  const handleCtx = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextActive(true)
    setTimeout(() => setContextActive(false), 600)
    onContextMenu(e, node)
  }

  const { Icon: FileIcon, color: iconColor } = isDir
    ? { Icon: isExpanded ? FolderOpen : Folder, color: isExpanded ? '#e8a953' : '#8b949e' }
    : getFileInfo(node.name)

  /* Show inline rename instead of normal row */
  if (isRenaming) {
    return (
      <>
        <InlineInput
          mode="rename"
          depth={depth}
          initialValue={node.name}
          onSubmit={onInlineSubmit}
          onCancel={onInlineCancel}
        />
        {isDir && isExpanded && node.children?.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            onContextMenu={onContextMenu}
            inlineInput={inlineInput}
            onInlineSubmit={onInlineSubmit}
            onInlineCancel={onInlineCancel}
          />
        ))}
      </>
    )
  }

  /* Should we show an inline input as first child of this directory? */
  const showChildInput =
    inlineInput &&
    (inlineInput.mode === 'new-file' || inlineInput.mode === 'new-folder') &&
    inlineInput.parentPath === node.path

  return (
    <>
      <div
        onClick={handleClick}
        onContextMenu={handleCtx}
        className="flex items-center cursor-pointer transition-colors duration-75"
        style={{
          height: 24,
          paddingLeft: depth * 16 + (isDir ? 6 : 24),
          paddingRight: 8,
          position: 'relative',
          background: isActive
            ? 'rgba(88,166,255,0.1)'
            : contextActive
              ? 'rgba(88,166,255,0.06)'
              : undefined,
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontSize: 12,
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.035)'
        }}
        onMouseLeave={(e) => {
          if (!isActive && !contextActive) e.currentTarget.style.background = 'transparent'
        }}
      >
        {/* Indent guides */}
        <IndentGuides depth={depth} />

        {/* Active file left indicator */}
        {isActive && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 2,
              background: 'var(--accent)',
              borderRadius: '0 1px 1px 0',
            }}
          />
        )}

        {/* Chevron for directories */}
        {isDir && (
          <ChevronRight
            size={14}
            style={{
              color: 'var(--text-muted)',
              flexShrink: 0,
              marginRight: 2,
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s ease',
            }}
          />
        )}

        {/* File/folder icon */}
        <FileIcon
          size={14}
          style={{
            color: iconColor,
            flexShrink: 0,
            marginRight: 6,
          }}
        />

        {/* Name */}
        <span className="truncate" style={{ flex: 1 }}>{node.name}</span>

        {/* Git status dot */}
        {node.gitStatus && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: gitColors[node.gitStatus],
              flexShrink: 0,
              marginLeft: 6,
              boxShadow: `0 0 4px ${gitColors[node.gitStatus]}60`,
            }}
            title={node.gitStatus}
          />
        )}
      </div>

      {/* Inline input for new file / new folder as first child */}
      {showChildInput && isExpanded && (
        <InlineInput
          mode={inlineInput.mode}
          depth={depth + 1}
          initialValue=""
          onSubmit={onInlineSubmit}
          onCancel={onInlineCancel}
        />
      )}

      {/* Children */}
      {isDir && isExpanded && node.children?.map((child) => (
        <FileTreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          onContextMenu={onContextMenu}
          inlineInput={inlineInput}
          onInlineSubmit={onInlineSubmit}
          onInlineCancel={onInlineCancel}
        />
      ))}
    </>
  )
}

/* ── File Explorer panel ───────────────────────────────── */

export default function FileExplorer() {
  const { fileTree, rootPath, expandedDirs } = useFileStore()
  const setRootPath = useFileStore((s) => s.setRootPath)
  const setFileTree = useFileStore((s) => s.setFileTree)
  const toggleDir = useFileStore((s) => s.toggleDir)
  const addToast = useToastStore((s) => s.addToast)

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const [inlineInput, setInlineInput] = useState<InlineInputState | null>(null)

  /* ── Standard handlers ───────────────────────────────── */

  const handleOpenFolder = async () => {
    const path = await window.api.openFolder()
    if (path) {
      setRootPath(path)
      const tree = await window.api.readDir(path)
      setFileTree(tree)
      window.api.watchStart(path)
    }
  }

  const handleRefresh = async () => {
    if (!rootPath) return
    const tree = await window.api.readDir(rootPath)
    setFileTree(tree)
  }

  const handleCollapseAll = useCallback(() => {
    useFileStore.setState({ expandedDirs: new Set() })
  }, [])

  /* ── Context menu open / close ───────────────────────── */

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const closeContextMenu = useCallback(() => {
    setCtxMenu(null)
  }, [])

  /* ── Context menu actions ────────────────────────────── */

  const handleNewFile = useCallback(() => {
    if (!ctxMenu) return
    const node = ctxMenu.node
    const parentPath = node.type === 'directory' ? node.path : node.path.replace(/[\\/][^\\/]+$/, '')
    /* Ensure the directory is expanded so the inline input is visible */
    if (node.type === 'directory' && !expandedDirs.has(node.path)) {
      toggleDir(node.path)
    }
    setInlineInput({
      mode: 'new-file',
      parentPath,
      depth: 0, // depth calculated relative to where it shows
    })
    closeContextMenu()
  }, [ctxMenu, expandedDirs, toggleDir, closeContextMenu])

  const handleNewFolder = useCallback(() => {
    if (!ctxMenu) return
    const node = ctxMenu.node
    const parentPath = node.type === 'directory' ? node.path : node.path.replace(/[\\/][^\\/]+$/, '')
    if (node.type === 'directory' && !expandedDirs.has(node.path)) {
      toggleDir(node.path)
    }
    setInlineInput({
      mode: 'new-folder',
      parentPath,
      depth: 0,
    })
    closeContextMenu()
  }, [ctxMenu, expandedDirs, toggleDir, closeContextMenu])

  const handleRename = useCallback(() => {
    if (!ctxMenu) return
    const node = ctxMenu.node
    setInlineInput({
      mode: 'rename',
      parentPath: node.path.replace(/[\\/][^\\/]+$/, ''),
      existingName: node.name,
      existingPath: node.path,
      depth: 0,
    })
    closeContextMenu()
  }, [ctxMenu, closeContextMenu])

  const handleDelete = useCallback(async () => {
    if (!ctxMenu) return
    const node = ctxMenu.node
    closeContextMenu()
    const confirmed = window.confirm(
      `Are you sure you want to delete "${node.name}"?${node.type === 'directory' ? ' This will delete all contents.' : ''}`
    )
    if (!confirmed) return
    try {
      await window.api.deleteFile(node.path)
      addToast({ type: 'success', message: `Deleted ${node.name}` })
      await handleRefresh()
    } catch (err: any) {
      addToast({ type: 'error', message: `Failed to delete: ${err?.message || err}` })
    }
  }, [ctxMenu, closeContextMenu, addToast, handleRefresh])

  const handleCopyPath = useCallback(() => {
    if (!ctxMenu) return
    navigator.clipboard.writeText(ctxMenu.node.path).then(() => {
      addToast({ type: 'info', message: 'Path copied to clipboard' })
    }).catch(() => {
      addToast({ type: 'error', message: 'Failed to copy path' })
    })
    closeContextMenu()
  }, [ctxMenu, closeContextMenu, addToast])

  /* ── Inline input handlers ──────────────────────────── */

  const handleInlineSubmit = useCallback(async (value: string) => {
    if (!inlineInput) return
    const { mode, parentPath, existingPath } = inlineInput

    try {
      if (mode === 'new-file') {
        const sep = parentPath.includes('/') ? '/' : '\\'
        const filePath = parentPath + sep + value
        await window.api.createFile(filePath)
        addToast({ type: 'success', message: `Created ${value}` })
      } else if (mode === 'new-folder') {
        const sep = parentPath.includes('/') ? '/' : '\\'
        const dirPath = parentPath + sep + value
        await window.api.createDir(dirPath)
        addToast({ type: 'success', message: `Created folder ${value}` })
      } else if (mode === 'rename' && existingPath) {
        const sep = parentPath.includes('/') ? '/' : '\\'
        const newPath = parentPath + sep + value
        await window.api.renameFile(existingPath, newPath)
        addToast({ type: 'success', message: `Renamed to ${value}` })
      }
      await handleRefresh()
    } catch (err: any) {
      addToast({ type: 'error', message: `Operation failed: ${err?.message || err}` })
    } finally {
      setInlineInput(null)
    }
  }, [inlineInput, addToast, handleRefresh])

  const handleInlineCancel = useCallback(() => {
    setInlineInput(null)
  }, [])

  /* ── Background click to close context menu ─────────── */

  const handleTreeContextMenu = useCallback((e: React.MouseEvent) => {
    /* Right-click on empty area of the tree (not on a node).
       Only show New File / New Folder if we have a rootPath. */
    if (!rootPath) return
    e.preventDefault()
    /* Create a fake root-level node so we can reuse the context menu */
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      node: { name: '', path: rootPath, type: 'directory' },
    })
  }, [rootPath])

  const folderName = rootPath?.replace(/\\/g, '/').split('/').pop() || ''

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Section Header */}
      <div
        className="shrink-0 flex items-center px-4"
        style={{
          height: 34,
          color: 'var(--text-secondary)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span>EXPLORER</span>
        <div className="ml-auto flex items-center gap-0.5">
          <HeaderButton
            Icon={ChevronsDownUp}
            title="Collapse All"
            onClick={handleCollapseAll}
          />
          <HeaderButton
            Icon={RotateCw}
            title="Refresh Explorer"
            onClick={handleRefresh}
          />
          <HeaderButton
            Icon={FolderPlus}
            title="Open Folder"
            onClick={handleOpenFolder}
          />
        </div>
      </div>

      {/* Workspace name */}
      {rootPath && (
        <div
          className="shrink-0 flex items-center gap-1.5 px-3 cursor-pointer"
          style={{
            height: 26,
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            background: 'rgba(255,255,255,0.015)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.015)'
          }}
        >
          <ChevronRight
            size={12}
            style={{
              transform: 'rotate(90deg)',
              transition: 'transform 0.15s ease',
              flexShrink: 0,
            }}
          />
          {folderName}
        </div>
      )}

      {/* File Tree */}
      <div
        className="flex-1 overflow-y-auto py-0.5"
        onContextMenu={handleTreeContextMenu}
      >
        {fileTree.length === 0 ? (
          <EmptyExplorer onOpenFolder={handleOpenFolder} />
        ) : (
          fileTree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              onContextMenu={handleContextMenu}
              inlineInput={inlineInput}
              onInlineSubmit={handleInlineSubmit}
              onInlineCancel={handleInlineCancel}
            />
          ))
        )}
      </div>

      {/* Context menu portal */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          node={ctxMenu.node}
          onClose={closeContextMenu}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onRename={handleRename}
          onDelete={handleDelete}
          onCopyPath={handleCopyPath}
        />
      )}
    </div>
  )
}

/* ── Header icon button ────────────────────────────────── */

function HeaderButton({
  Icon,
  title,
  onClick,
}: {
  Icon: typeof File
  title: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center rounded transition-colors duration-100"
      title={title}
      style={{
        width: 22,
        height: 22,
        color: 'var(--text-muted)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--text-secondary)'
        e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-muted)'
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <Icon size={13} />
    </button>
  )
}

/* ── Empty state ───────────────────────────────────────── */

function EmptyExplorer({ onOpenFolder }: { onOpenFolder: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Folder size={24} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
      </div>
      <div className="text-center">
        <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>
          No folder opened
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 11, opacity: 0.7, lineHeight: 1.5 }}>
          Open a folder to start exploring your project
        </p>
      </div>
      <button
        onClick={onOpenFolder}
        className="flex items-center gap-2 transition-all duration-150"
        style={{
          fontSize: 12,
          padding: '7px 18px',
          background: 'var(--accent)',
          color: '#fff',
          borderRadius: 6,
          fontWeight: 500,
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(88,166,255,0.2)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '0.9'
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(88,166,255,0.3)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '1'
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(88,166,255,0.2)'
        }}
      >
        <FolderPlus size={13} />
        Open Folder
      </button>
    </div>
  )
}
