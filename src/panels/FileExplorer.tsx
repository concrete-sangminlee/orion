import { useState, useCallback } from 'react'
import { useFileStore } from '@/store/files'
import { useEditorStore } from '@/store/editor'
import {
  ChevronRight, ChevronsDownUp,
  File, FileCode2, FileJson, FileText, FileImage,
  Folder, FolderOpen, FolderPlus, RotateCw,
  Settings, Braces, Hash, FileType, Image, Code,
} from 'lucide-react'
import type { FileNode } from '@shared/types'

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

/* ── File tree node ────────────────────────────────────── */

function FileTreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const { expandedDirs, toggleDir } = useFileStore()
  const { openFile, activeFilePath } = useEditorStore()
  const [contextActive, setContextActive] = useState(false)
  const isExpanded = expandedDirs.has(node.path)
  const isActive = activeFilePath === node.path
  const isDir = node.type === 'directory'

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

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextActive(true)
    setTimeout(() => setContextActive(false), 600)
  }

  const { Icon: FileIcon, color: iconColor } = isDir
    ? { Icon: isExpanded ? FolderOpen : Folder, color: isExpanded ? '#e8a953' : '#8b949e' }
    : getFileInfo(node.name)

  return (
    <>
      <div
        onClick={handleClick}
        onContextMenu={handleContextMenu}
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

      {/* Children */}
      {isDir && isExpanded && node.children?.map((child) => (
        <FileTreeNode key={child.path} node={child} depth={depth + 1} />
      ))}
    </>
  )
}

/* ── File Explorer panel ───────────────────────────────── */

export default function FileExplorer() {
  const { fileTree, rootPath } = useFileStore()
  const setRootPath = useFileStore((s) => s.setRootPath)
  const setFileTree = useFileStore((s) => s.setFileTree)

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
    // Re-set tree to trigger re-render with all collapsed
    const { fileTree: currentTree } = useFileStore.getState()
    // Clear expanded dirs by setting a new empty set
    useFileStore.setState({ expandedDirs: new Set() })
  }, [])

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
      <div className="flex-1 overflow-y-auto py-0.5">
        {fileTree.length === 0 ? (
          <EmptyExplorer onOpenFolder={handleOpenFolder} />
        ) : (
          fileTree.map((node) => (
            <FileTreeNode key={node.path} node={node} depth={0} />
          ))
        )}
      </div>
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
