import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useFileStore } from '@/store/files'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { useWorkspaceStore } from '@/store/workspace'
import {
  ChevronRight, ChevronsDownUp,
  File, FileCode, FileCode2, FileText,
  Folder, FolderOpen, FolderPlus, RotateCw,
  Settings, Braces, Hash, Image,
  FilePlus, Trash2, Edit3, Clipboard, Plus,
  Globe, Palette, Terminal as TermIcon, Coffee, Gem,
  Database, Lock, Package, Copy, FolderIcon,
  Columns, ExternalLink, Upload,
} from 'lucide-react'
import type { FileNode } from '@shared/types'

/* ── Context menu types ──────────────────────────────────── */

interface ContextMenuState {
  x: number
  y: number
  node: FileNode | null          // null = empty-space click
  target: 'file' | 'folder' | 'empty'
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
  // TypeScript / JavaScript
  ts:    { Icon: FileCode, color: '#3178c6' },
  tsx:   { Icon: FileCode, color: '#3178c6' },
  js:    { Icon: FileCode, color: '#f1e05a' },
  jsx:   { Icon: FileCode, color: '#f1e05a' },
  mjs:   { Icon: FileCode, color: '#f1e05a' },
  cjs:   { Icon: FileCode, color: '#f1e05a' },
  // Web
  html:  { Icon: Globe, color: '#e34c26' },
  htm:   { Icon: Globe, color: '#e34c26' },
  css:   { Icon: Palette, color: '#563d7c' },
  scss:  { Icon: Palette, color: '#c6538c' },
  less:  { Icon: Palette, color: '#1d365d' },
  // Data / Config
  json:  { Icon: Braces, color: '#8b949e' },
  yaml:  { Icon: FileText, color: '#cb171e' },
  yml:   { Icon: FileText, color: '#cb171e' },
  toml:  { Icon: FileText, color: '#9c4121' },
  xml:   { Icon: FileText, color: '#0060ac' },
  csv:   { Icon: FileText, color: '#8b949e' },
  // Config / Environment
  env:   { Icon: Lock, color: '#faf743' },
  // Languages
  py:    { Icon: Hash, color: '#3572a5' },
  rb:    { Icon: Gem, color: '#701516' },
  rs:    { Icon: Settings, color: '#dea584' },
  go:    { Icon: FileCode, color: '#00add8' },
  java:  { Icon: Coffee, color: '#b07219' },
  kt:    { Icon: FileCode, color: '#a97bff' },
  swift: { Icon: FileCode, color: '#f05138' },
  c:     { Icon: FileCode2, color: '#555555' },
  cpp:   { Icon: FileCode2, color: '#f34b7d' },
  h:     { Icon: FileCode2, color: '#555555' },
  hpp:   { Icon: FileCode2, color: '#f34b7d' },
  cs:    { Icon: FileCode, color: '#178600' },
  php:   { Icon: FileCode, color: '#4f5d95' },
  lua:   { Icon: FileCode, color: '#000080' },
  dart:  { Icon: FileCode, color: '#00b4ab' },
  vue:   { Icon: FileCode, color: '#41b883' },
  svelte: { Icon: FileCode, color: '#ff3e00' },
  // Documentation / Text
  md:    { Icon: FileText, color: '#083fa1' },
  mdx:   { Icon: FileText, color: '#083fa1' },
  txt:   { Icon: FileText, color: '#8b949e' },
  log:   { Icon: FileText, color: '#8b949e' },
  // Images
  svg:   { Icon: Image, color: '#ffb13b' },
  png:   { Icon: Image, color: '#a074c4' },
  jpg:   { Icon: Image, color: '#a074c4' },
  jpeg:  { Icon: Image, color: '#a074c4' },
  gif:   { Icon: Image, color: '#a074c4' },
  webp:  { Icon: Image, color: '#a074c4' },
  ico:   { Icon: Image, color: '#a074c4' },
  bmp:   { Icon: Image, color: '#a074c4' },
  // Database / Data
  sql:   { Icon: Database, color: '#e38c00' },
  db:    { Icon: Database, color: '#e38c00' },
  sqlite: { Icon: Database, color: '#e38c00' },
  // Shell / Terminal
  sh:    { Icon: TermIcon, color: '#89e051' },
  bash:  { Icon: TermIcon, color: '#89e051' },
  zsh:   { Icon: TermIcon, color: '#89e051' },
  fish:  { Icon: TermIcon, color: '#89e051' },
  bat:   { Icon: TermIcon, color: '#c1f12e' },
  cmd:   { Icon: TermIcon, color: '#c1f12e' },
  ps1:   { Icon: TermIcon, color: '#012456' },
  // Lock files
  lock:  { Icon: Lock, color: '#8b949e' },
  // Misc
  wasm:  { Icon: FileCode2, color: '#654ff0' },
  graphql: { Icon: FileCode, color: '#e10098' },
  gql:   { Icon: FileCode, color: '#e10098' },
  prisma: { Icon: Database, color: '#2d3748' },
}

/** Special file names get a specific icon regardless of extension */
const nameIcons: Record<string, IconEntry> = {
  'package.json':      { Icon: Package, color: '#cb3837' },
  'package-lock.json': { Icon: Lock, color: '#8b949e' },
  'tsconfig.json':     { Icon: Settings, color: '#3178c6' },
  'vite.config.ts':    { Icon: Settings, color: '#646cff' },
  'vite.config.js':    { Icon: Settings, color: '#646cff' },
  'webpack.config.js': { Icon: Settings, color: '#8dd6f9' },
  'webpack.config.ts': { Icon: Settings, color: '#8dd6f9' },
  'tailwind.config.js': { Icon: Settings, color: '#06b6d4' },
  'tailwind.config.ts': { Icon: Settings, color: '#06b6d4' },
  'postcss.config.js': { Icon: Settings, color: '#dd3a0a' },
  'postcss.config.ts': { Icon: Settings, color: '#dd3a0a' },
  'jest.config.js':    { Icon: Settings, color: '#99424f' },
  'jest.config.ts':    { Icon: Settings, color: '#99424f' },
  '.gitignore':        { Icon: Settings, color: '#f34f29' },
  '.eslintrc':         { Icon: Settings, color: '#4b32c3' },
  '.eslintrc.js':      { Icon: Settings, color: '#4b32c3' },
  '.eslintrc.json':    { Icon: Settings, color: '#4b32c3' },
  '.prettierrc':       { Icon: Settings, color: '#56b3b4' },
  '.prettierrc.js':    { Icon: Settings, color: '#56b3b4' },
  '.prettierrc.json':  { Icon: Settings, color: '#56b3b4' },
  '.editorconfig':     { Icon: Settings, color: '#8b949e' },
  '.env':              { Icon: Lock, color: '#faf743' },
  '.env.local':        { Icon: Lock, color: '#faf743' },
  '.env.development':  { Icon: Lock, color: '#faf743' },
  '.env.production':   { Icon: Lock, color: '#faf743' },
  'Dockerfile':        { Icon: Package, color: '#2496ed' },
  'docker-compose.yml': { Icon: Package, color: '#2496ed' },
  'docker-compose.yaml': { Icon: Package, color: '#2496ed' },
  'Makefile':          { Icon: TermIcon, color: '#6d8086' },
  'README.md':         { Icon: FileText, color: '#083fa1' },
  'LICENSE':           { Icon: FileText, color: '#8b949e' },
  'LICENSE.md':        { Icon: FileText, color: '#8b949e' },
  'yarn.lock':         { Icon: Lock, color: '#2c8ebb' },
  'pnpm-lock.yaml':    { Icon: Lock, color: '#f69220' },
  'Cargo.toml':        { Icon: Package, color: '#dea584' },
  'Cargo.lock':        { Icon: Lock, color: '#dea584' },
  'go.mod':            { Icon: Package, color: '#00add8' },
  'go.sum':            { Icon: Lock, color: '#00add8' },
  'Gemfile':           { Icon: Gem, color: '#701516' },
  'Gemfile.lock':      { Icon: Lock, color: '#701516' },
}

const configPatterns = [
  '.config', '.rc', '.prettierrc', '.eslintrc',
  'tsconfig', 'vite.config', 'webpack.config', 'jest.config',
  'tailwind.config', 'postcss.config',
]

function getFileInfo(name: string): IconEntry {
  /* Check special file names first */
  if (nameIcons[name]) return nameIcons[name]

  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (fileIcons[ext]) return fileIcons[ext]
  const lowerName = name.toLowerCase()
  if (configPatterns.some((p) => lowerName.includes(p))) {
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

/* ── Delete confirmation dialog ──────────────────────── */

function DeleteDialog({
  name,
  isDirectory,
  onConfirm,
  onCancel,
}: {
  name: string
  isDirectory: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, onConfirm])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary, #1e1e2e)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '20px 24px',
          minWidth: 340,
          maxWidth: 420,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
          Delete {isDirectory ? 'Folder' : 'File'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
          Are you sure you want to delete <strong style={{ color: 'var(--text-primary)' }}>"{name}"</strong>?
          {isDirectory && ' This will delete all its contents.'}
          {' '}This action will move the item to the system trash if possible.
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            style={{
              fontSize: 12,
              padding: '5px 14px',
              borderRadius: 5,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              fontSize: 12,
              padding: '5px 14px',
              borderRadius: 5,
              border: 'none',
              background: '#f85149',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 500,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Context menu component ───────────────────────────── */

interface ContextMenuItem {
  label: string
  icon: typeof File
  action: () => void
  separator?: boolean
  hidden?: boolean
  danger?: boolean
}

function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
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

  const visibleItems = items.filter((it) => !it.hidden)

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 9999,
        minWidth: 190,
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
                color: item.danger ? '#f85149' : 'var(--text-secondary)',
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
  dropTargetFolder,
  onFolderDragOver,
  onFolderDragLeave,
}: {
  node: FileNode
  depth: number
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  inlineInput: InlineInputState | null
  onInlineSubmit: (value: string) => void
  onInlineCancel: () => void
  dropTargetFolder?: string | null
  onFolderDragOver?: (e: React.DragEvent, folderPath: string) => void
  onFolderDragLeave?: (e: React.DragEvent) => void
}) {
  const { expandedDirs, toggleDir } = useFileStore()
  const { openFile, activeFilePath, pinFile } = useEditorStore()
  const [contextActive, setContextActive] = useState(false)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isExpanded = expandedDirs.has(node.path)
  const isActive = activeFilePath === node.path
  const isDir = node.type === 'directory'

  /* Is this node being renamed inline? */
  const isRenaming =
    inlineInput?.mode === 'rename' && inlineInput.existingPath === node.path

  /** Open the file in the editor (preview or pinned) */
  const openFileInEditor = async (preview: boolean) => {
    try {
      const result = await window.api.readFile(node.path)
      openFile(
        {
          path: node.path,
          name: node.name,
          content: result.content,
          language: result.language,
          isModified: false,
          aiModified: false,
        },
        { preview },
      )
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }

  const handleClick = () => {
    if (isDir) {
      toggleDir(node.path)
      return
    }
    // Delay single-click to distinguish from double-click
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      openFileInEditor(true) // single-click = preview
    }, 200)
  }

  const handleDoubleClick = () => {
    if (isDir) return
    // Cancel the pending single-click
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    openFileInEditor(false) // double-click = pinned
  }

  const handleCtx = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextActive(true)
    setTimeout(() => setContextActive(false), 600)
    onContextMenu(e, node)
  }

  const { Icon: FileIcon, color: iconColor } = isDir
    ? { Icon: isExpanded ? FolderOpen : Folder, color: '#dcb67a' }
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
            dropTargetFolder={dropTargetFolder}
            onFolderDragOver={onFolderDragOver}
            onFolderDragLeave={onFolderDragLeave}
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

  const isFolderDropTarget = isDir && dropTargetFolder === node.path

  return (
    <>
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleCtx}
        className={`flex items-center cursor-pointer transition-colors duration-75${isFolderDropTarget ? ' folder-drop-target' : ''}`}
        style={{
          height: 24,
          paddingLeft: depth * 16 + (isDir ? 6 : 24),
          paddingRight: 8,
          position: 'relative',
          background: isFolderDropTarget
            ? undefined  /* handled by folder-drop-target class */
            : isActive
              ? 'rgba(88,166,255,0.1)'
              : contextActive
                ? 'rgba(88,166,255,0.06)'
                : undefined,
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontSize: 12,
        }}
        onMouseEnter={(e) => {
          if (!isActive && !isFolderDropTarget) e.currentTarget.style.background = 'rgba(255,255,255,0.035)'
        }}
        onMouseLeave={(e) => {
          if (!isActive && !contextActive && !isFolderDropTarget) e.currentTarget.style.background = 'transparent'
        }}
        onDragOver={isDir && onFolderDragOver ? (e) => onFolderDragOver(e, node.path) : undefined}
        onDragLeave={isDir && onFolderDragLeave ? onFolderDragLeave : undefined}
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
          dropTargetFolder={dropTargetFolder}
          onFolderDragOver={onFolderDragOver}
          onFolderDragLeave={onFolderDragLeave}
        />
      ))}
    </>
  )
}

/* ── Helpers ───────────────────────────────────────────── */

/** Get the path separator used in a given path string */
function sep(p: string): string {
  return p.includes('/') ? '/' : '\\'
}

/** Compute a relative path from a root to a target */
function relativePath(root: string, target: string): string {
  const norm = (s: string) => s.replace(/\\/g, '/')
  const r = norm(root)
  const t = norm(target)
  if (t.startsWith(r)) {
    const rel = t.slice(r.length)
    return rel.startsWith('/') ? rel.slice(1) : rel
  }
  return t
}

/* ── Glob pattern matching (simple) ────────────────────── */

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports: * (any chars except /), ** (any chars), ? (single char).
 * A bare name like "node_modules" matches any segment.
 */
function globToRegExp(pattern: string): RegExp {
  // If the pattern has no path separators and no wildcards, match as a segment name
  if (!pattern.includes('/') && !pattern.includes('*') && !pattern.includes('?')) {
    // Match the name exactly as a path segment
    return new RegExp('(^|[\\\\/])' + escapeRegExp(pattern) + '($|[\\\\/])')
  }
  let re = pattern
    .replace(/\\/g, '/')
    .replace(/\*\*/g, '\0GLOBSTAR\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\0GLOBSTAR\0/g, '.*')
  // Escape dots
  re = re.replace(/\./g, '\\.')
  return new RegExp('(^|[\\\\/])' + re + '$', 'i')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function filterTreeByExcludes(tree: FileNode[], patterns: RegExp[]): FileNode[] {
  return tree
    .filter((node) => {
      // Check if the node name matches any exclude pattern
      for (const re of patterns) {
        if (re.test(node.name)) return false
      }
      return true
    })
    .map((node) => {
      if (node.type === 'directory' && node.children) {
        return { ...node, children: filterTreeByExcludes(node.children, patterns) }
      }
      return node
    })
}

/* ── File Explorer panel ───────────────────────────────── */

export default function FileExplorer() {
  const { fileTree, rootPath, expandedDirs } = useFileStore()
  const setRootPath = useFileStore((s) => s.setRootPath)
  const setFileTree = useFileStore((s) => s.setFileTree)
  const toggleDir = useFileStore((s) => s.toggleDir)
  const addToast = useToastStore((s) => s.addToast)
  const excludePatterns = useWorkspaceStore((s) => s.settings.excludePatterns)

  // Compile exclude patterns into RegExps and filter the tree
  const excludeRegExps = useMemo(
    () => excludePatterns.map(globToRegExp),
    [excludePatterns],
  )
  const filteredTree = useMemo(
    () => filterTreeByExcludes(fileTree, excludeRegExps),
    [fileTree, excludeRegExps],
  )

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const [inlineInput, setInlineInput] = useState<InlineInputState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null)

  // Drag-and-drop state for OS file drops into explorer
  const [explorerDragOver, setExplorerDragOver] = useState(false)
  const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null)
  const explorerDragCounterRef = useRef(0)

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

  /* ── Toolbar new file / new folder at root ────────────── */

  const handleToolbarNewFile = useCallback(() => {
    if (!rootPath) return
    setInlineInput({
      mode: 'new-file',
      parentPath: rootPath,
      depth: 0,
    })
  }, [rootPath])

  const handleToolbarNewFolder = useCallback(() => {
    if (!rootPath) return
    setInlineInput({
      mode: 'new-folder',
      parentPath: rootPath,
      depth: 0,
    })
  }, [rootPath])

  /* ── Context menu open / close ───────────────────────── */

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault()
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      node,
      target: node.type === 'directory' ? 'folder' : 'file',
    })
  }, [])

  const closeContextMenu = useCallback(() => {
    setCtxMenu(null)
  }, [])

  /* ── Context menu actions ────────────────────────────── */

  const handleNewFile = useCallback(() => {
    if (!ctxMenu) return
    const node = ctxMenu.node
    const parentPath = node && node.type === 'directory' ? node.path : (node ? node.path.replace(/[\\/][^\\/]+$/, '') : rootPath!)
    /* Ensure the directory is expanded so the inline input is visible */
    if (node && node.type === 'directory' && !expandedDirs.has(node.path)) {
      toggleDir(node.path)
    }
    setInlineInput({
      mode: 'new-file',
      parentPath,
      depth: 0,
    })
    closeContextMenu()
  }, [ctxMenu, expandedDirs, toggleDir, closeContextMenu, rootPath])

  const handleNewFolder = useCallback(() => {
    if (!ctxMenu) return
    const node = ctxMenu.node
    const parentPath = node && node.type === 'directory' ? node.path : (node ? node.path.replace(/[\\/][^\\/]+$/, '') : rootPath!)
    if (node && node.type === 'directory' && !expandedDirs.has(node.path)) {
      toggleDir(node.path)
    }
    setInlineInput({
      mode: 'new-folder',
      parentPath,
      depth: 0,
    })
    closeContextMenu()
  }, [ctxMenu, expandedDirs, toggleDir, closeContextMenu, rootPath])

  const handleRename = useCallback(() => {
    if (!ctxMenu || !ctxMenu.node) return
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

  const handleDeleteRequest = useCallback(() => {
    if (!ctxMenu || !ctxMenu.node) return
    setDeleteTarget(ctxMenu.node)
    closeContextMenu()
  }, [ctxMenu, closeContextMenu])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    const name = deleteTarget.name
    try {
      await window.api.trashItem(deleteTarget.path)
      addToast({ type: 'success', message: `Deleted ${name}` })
      await handleRefresh()
    } catch (err: any) {
      addToast({ type: 'error', message: `Failed to delete: ${err?.message || err}` })
    } finally {
      setDeleteTarget(null)
    }
  }, [deleteTarget, addToast, handleRefresh])

  const handleDeleteCancel = useCallback(() => {
    setDeleteTarget(null)
  }, [])

  const handleCopyPath = useCallback(() => {
    if (!ctxMenu || !ctxMenu.node) return
    const nodePath = ctxMenu.node.path
    window.api.copyPathToClipboard(nodePath).then(() => {
      addToast({ type: 'info', message: 'Path copied to clipboard' })
    }).catch(() => {
      // Fallback to navigator clipboard
      navigator.clipboard.writeText(nodePath).then(() => {
        addToast({ type: 'info', message: 'Path copied to clipboard' })
      }).catch(() => {
        addToast({ type: 'error', message: 'Failed to copy path' })
      })
    })
    closeContextMenu()
  }, [ctxMenu, closeContextMenu, addToast])

  const handleCopyRelativePath = useCallback(() => {
    if (!ctxMenu || !ctxMenu.node || !rootPath) return
    const rel = relativePath(rootPath, ctxMenu.node.path)
    navigator.clipboard.writeText(rel).then(() => {
      addToast({ type: 'info', message: 'Relative path copied' })
    }).catch(() => {
      addToast({ type: 'error', message: 'Failed to copy path' })
    })
    closeContextMenu()
  }, [ctxMenu, closeContextMenu, addToast, rootPath])

  const handleDuplicate = useCallback(async () => {
    if (!ctxMenu || !ctxMenu.node) return
    const node = ctxMenu.node
    closeContextMenu()
    try {
      const result = await window.api.duplicateFile(node.path)
      if (result.success) {
        addToast({ type: 'success', message: `Duplicated ${node.name}` })
        await handleRefresh()
      } else {
        addToast({ type: 'error', message: `Failed to duplicate: ${result.error}` })
      }
    } catch (err: any) {
      addToast({ type: 'error', message: `Failed to duplicate: ${err?.message || err}` })
    }
  }, [ctxMenu, closeContextMenu, addToast, handleRefresh])

  const handleOpenFileFromMenu = useCallback(async () => {
    if (!ctxMenu || !ctxMenu.node) return
    const node = ctxMenu.node
    closeContextMenu()
    if (node.type === 'file') {
      try {
        const result = await window.api.readFile(node.path)
        useEditorStore.getState().openFile(
          {
            path: node.path,
            name: node.name,
            content: result.content,
            language: result.language,
            isModified: false,
            aiModified: false,
          },
          { preview: false },
        )
      } catch (e) {
        console.error('Failed to open file:', e)
      }
    }
  }, [ctxMenu, closeContextMenu])

  const handleOpenToSide = useCallback(async () => {
    if (!ctxMenu || !ctxMenu.node) return
    const node = ctxMenu.node
    closeContextMenu()
    if (node.type === 'file') {
      try {
        const result = await window.api.readFile(node.path)
        useEditorStore.getState().openFile(
          {
            path: node.path,
            name: node.name,
            content: result.content,
            language: result.language,
            isModified: false,
            aiModified: false,
          },
          { preview: false },
        )
        // Trigger split editor via custom event (EditorPanel listens for this)
        window.dispatchEvent(new CustomEvent('orion:split-editor'))
      } catch (e) {
        console.error('Failed to open file to side:', e)
      }
    }
  }, [ctxMenu, closeContextMenu])

  const handleRevealInFileManager = useCallback(() => {
    if (!ctxMenu || !ctxMenu.node) return
    const nodePath = ctxMenu.node.path
    closeContextMenu()
    if (typeof window.api.showItemInFolder === 'function') {
      window.api.showItemInFolder(nodePath).catch(() => {
        addToast({ type: 'error', message: 'Failed to reveal in file manager' })
      })
    } else {
      addToast({ type: 'info', message: 'Reveal in file manager is not available' })
    }
  }, [ctxMenu, closeContextMenu, addToast])

  /* ── Build context menu items based on target type ────── */

  const buildMenuItems = useCallback((): ContextMenuItem[] => {
    if (!ctxMenu) return []

    if (ctxMenu.target === 'file') {
      return [
        { label: 'Open', icon: File, action: handleOpenFileFromMenu },
        { label: 'Open to the Side', icon: Columns, action: handleOpenToSide, separator: true },
        { label: 'Rename', icon: Edit3, action: handleRename },
        { label: 'Delete', icon: Trash2, action: handleDeleteRequest, danger: true, separator: true },
        { label: 'Duplicate', icon: Copy, action: handleDuplicate, separator: true },
        { label: 'Copy Path', icon: Clipboard, action: handleCopyPath },
        { label: 'Copy Relative Path', icon: Clipboard, action: handleCopyRelativePath, separator: true },
        { label: 'Reveal in File Manager', icon: ExternalLink, action: handleRevealInFileManager },
      ]
    }

    if (ctxMenu.target === 'folder') {
      return [
        { label: 'New File...', icon: FilePlus, action: handleNewFile },
        { label: 'New Folder...', icon: FolderIcon, action: handleNewFolder, separator: true },
        { label: 'Rename', icon: Edit3, action: handleRename },
        { label: 'Delete', icon: Trash2, action: handleDeleteRequest, danger: true, separator: true },
        { label: 'Copy Path', icon: Clipboard, action: handleCopyPath },
        { label: 'Copy Relative Path', icon: Clipboard, action: handleCopyRelativePath, separator: true },
        { label: 'Collapse All', icon: ChevronsDownUp, action: () => { closeContextMenu(); handleCollapseAll() } },
      ]
    }

    // empty space
    return [
      { label: 'New File...', icon: FilePlus, action: handleNewFile },
      { label: 'New Folder...', icon: FolderIcon, action: handleNewFolder, separator: true },
      { label: 'Refresh', icon: RotateCw, action: () => { closeContextMenu(); handleRefresh() } },
    ]
  }, [
    ctxMenu, handleOpenFileFromMenu, handleOpenToSide, handleRename,
    handleDeleteRequest, handleDuplicate, handleCopyPath, handleCopyRelativePath,
    handleNewFile, handleNewFolder, handleRevealInFileManager,
    handleCollapseAll, closeContextMenu, handleRefresh,
  ])

  /* ── Inline input handlers ──────────────────────────── */

  const handleInlineSubmit = useCallback(async (value: string) => {
    if (!inlineInput) return
    const { mode, parentPath, existingPath } = inlineInput

    try {
      if (mode === 'new-file') {
        const s = sep(parentPath)
        const filePath = parentPath + s + value
        await window.api.createFile(filePath)
        addToast({ type: 'success', message: `Created ${value}` })
      } else if (mode === 'new-folder') {
        const s = sep(parentPath)
        const dirPath = parentPath + s + value
        await window.api.createDir(dirPath)
        addToast({ type: 'success', message: `Created folder ${value}` })
      } else if (mode === 'rename' && existingPath) {
        const s = sep(parentPath)
        const newPath = parentPath + s + value
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

  /* ── Drag-and-drop from OS file explorer ─────────────── */

  const handleExplorerDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    explorerDragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setExplorerDragOver(true)
    }
  }, [])

  const handleExplorerDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    explorerDragCounterRef.current--
    if (explorerDragCounterRef.current <= 0) {
      explorerDragCounterRef.current = 0
      setExplorerDragOver(false)
      setDropTargetFolder(null)
    }
  }, [])

  const handleExplorerDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleExplorerDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    explorerDragCounterRef.current = 0
    setExplorerDragOver(false)
    setDropTargetFolder(null)

    if (!rootPath) return

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    // Determine the target directory: use dropTargetFolder or root
    const targetDir = dropTargetFolder || rootPath

    let copiedCount = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const filePath = (file as any).path as string | undefined
      if (!filePath) continue

      try {
        const result = await window.api.copyFile(filePath, targetDir)
        if (result.success) {
          copiedCount++
        } else {
          addToast({ type: 'error', message: `Failed to copy ${file.name}: ${result.error}` })
        }
      } catch (err: any) {
        addToast({ type: 'error', message: `Failed to copy ${file.name}: ${err?.message || err}` })
      }
    }

    if (copiedCount > 0) {
      addToast({
        type: 'success',
        message: copiedCount === 1
          ? `Copied ${files[0].name} to workspace`
          : `Copied ${copiedCount} files to workspace`,
      })
      // Refresh the file tree to show new files
      await handleRefresh()
    }
  }, [rootPath, dropTargetFolder, addToast, handleRefresh])

  /** Handler for when a folder row is dragged over (to highlight target folder) */
  const handleFolderDragOver = useCallback((e: React.DragEvent, folderPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
      setDropTargetFolder(folderPath)
    }
  }, [])

  const handleFolderDragLeave = useCallback((_e: React.DragEvent) => {
    setDropTargetFolder(null)
  }, [])

  /* ── Background click to close context menu ─────────── */

  const handleTreeContextMenu = useCallback((e: React.MouseEvent) => {
    /* Right-click on empty area of the tree (not on a node).
       Only show New File / New Folder if we have a rootPath. */
    if (!rootPath) return
    e.preventDefault()
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      node: null,
      target: 'empty',
    })
  }, [rootPath])

  const folderName = rootPath?.replace(/\\/g, '/').split('/').pop() || ''

  /* ── Inline input at root level (from toolbar buttons) ── */
  const showRootInlineInput =
    inlineInput &&
    (inlineInput.mode === 'new-file' || inlineInput.mode === 'new-folder') &&
    inlineInput.parentPath === rootPath

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ position: 'relative' }}
      onDragEnter={handleExplorerDragEnter}
      onDragLeave={handleExplorerDragLeave}
      onDragOver={handleExplorerDragOver}
      onDrop={handleExplorerDrop}
    >
      {/* Drop overlay for OS file drag into explorer */}
      {explorerDragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-content">
            <Upload size={24} />
            <span>Drop to copy into workspace</span>
          </div>
        </div>
      )}

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
            Icon={FilePlus}
            title="New File"
            onClick={handleToolbarNewFile}
          />
          <HeaderButton
            Icon={FolderPlus}
            title="New Folder"
            onClick={handleToolbarNewFolder}
          />
          <HeaderButton
            Icon={RotateCw}
            title="Refresh Explorer"
            onClick={handleRefresh}
          />
          <HeaderButton
            Icon={ChevronsDownUp}
            title="Collapse All"
            onClick={handleCollapseAll}
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
          <>
            {/* Root-level inline input (e.g. from toolbar New File / New Folder) */}
            {showRootInlineInput && (
              <InlineInput
                mode={inlineInput.mode}
                depth={0}
                initialValue=""
                onSubmit={handleInlineSubmit}
                onCancel={handleInlineCancel}
              />
            )}
            {fileTree.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                depth={0}
                onContextMenu={handleContextMenu}
                inlineInput={inlineInput}
                onInlineSubmit={handleInlineSubmit}
                onInlineCancel={handleInlineCancel}
                dropTargetFolder={dropTargetFolder}
                onFolderDragOver={handleFolderDragOver}
                onFolderDragLeave={handleFolderDragLeave}
              />
            ))}
          </>
        )}
      </div>

      {/* Context menu portal */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildMenuItems()}
          onClose={closeContextMenu}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <DeleteDialog
          name={deleteTarget.name}
          isDirectory={deleteTarget.type === 'directory'}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
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
