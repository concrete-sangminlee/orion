import { useState, useRef } from 'react'
import { useEditorStore } from '@/store/editor'
import { X } from 'lucide-react'

const extColors: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6', js: '#f1e05a', jsx: '#f1e05a',
  json: '#8b949e', html: '#e34c26', css: '#563d7c', py: '#3572a5',
  rs: '#dea584', go: '#00add8', md: '#083fa1', yaml: '#cb171e',
  yml: '#cb171e', toml: '#9c4121', sh: '#89e051', vue: '#41b883',
  svg: '#ffb13b', scss: '#c6538c', less: '#1d365d', lua: '#000080',
}

export default function TabBar() {
  const { openFiles, activeFilePath, setActiveFile, closeFile, closeAllFiles, reorderFiles } = useEditorStore()
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const [closeAllHovered, setCloseAllHovered] = useState(false)
  const dragIndexRef = useRef<number>(-1)

  if (openFiles.length === 0) return null

  return (
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
        const ext = file.name.split('.').pop()?.toLowerCase() || ''
        const dotColor = extColors[ext] || '#8b949e'
        const showClose = isActive || isHovered

        return (
          <div
            key={file.path}
            draggable={true}
            onDragStart={(e) => {
              dragIndexRef.current = index
              setDraggingPath(file.path)
              e.dataTransfer.effectAllowed = 'move'
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
            onMouseLeave={() => setHoveredTab(null)}
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
              }}
            >
              {file.name}
            </span>

            {/* Modified dot / Close button area */}
            <div
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
              {/* Modified indicator dot - shown when file is modified and close button is NOT visible */}
              {file.isModified && !showClose && (
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: file.aiModified
                      ? 'var(--accent-green)'
                      : 'var(--text-muted)',
                  }}
                />
              )}

              {/* Modified indicator dot - shown alongside close button when modified */}
              {file.isModified && showClose && (
                <span
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: file.aiModified
                      ? 'var(--accent-green)'
                      : 'var(--text-muted)',
                  }}
                />
              )}

              {/* Close button - appears on hover or when active */}
              {showClose && (
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
  )
}
