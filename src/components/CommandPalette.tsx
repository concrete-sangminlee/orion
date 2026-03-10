import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, FileText, Settings, Terminal, FolderOpen, MessageSquare, Zap, Command as CommandIcon, ChevronRight } from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'

interface PaletteItem {
  id: string
  label: string
  category: 'file' | 'command' | 'setting'
  icon: React.ReactNode
  shortcut?: string
  action: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
}

function flattenFiles(nodes: any[], prefix = ''): { name: string; path: string }[] {
  const result: { name: string; path: string }[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      result.push({ name: node.name, path: node.path })
    } else if (node.children) {
      result.push(...flattenFiles(node.children, node.path))
    }
  }
  return result
}

export default function CommandPalette({ open, onClose, onOpenSettings }: Props) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { openFile } = useEditorStore()
  const { fileTree } = useFileStore()

  const isFileMode = !query.startsWith('>')
  const searchQuery = query.startsWith('>') ? query.slice(1).trim() : query.trim()

  const commands: PaletteItem[] = useMemo(() => [
    { id: 'settings', label: 'Preferences: Open Settings', category: 'command', icon: <Settings size={14} />, action: () => { onClose(); onOpenSettings() } },
    { id: 'terminal', label: 'Terminal: Create New Terminal', category: 'command', icon: <Terminal size={14} />, shortcut: 'Ctrl+`', action: () => { onClose() } },
    { id: 'chat', label: 'AI: Open Chat', category: 'command', icon: <MessageSquare size={14} />, shortcut: 'Ctrl+L', action: () => { onClose() } },
    { id: 'agent', label: 'AI: Toggle Agent Mode', category: 'command', icon: <Zap size={14} />, action: () => { onClose() } },
    { id: 'folder', label: 'File: Open Folder', category: 'command', icon: <FolderOpen size={14} />, shortcut: 'Ctrl+O', action: () => { window.api?.openFolder(); onClose() } },
  ], [onClose, onOpenSettings])

  const fileItems: PaletteItem[] = useMemo(() => {
    return flattenFiles(fileTree).map(f => ({
      id: f.path,
      label: f.name,
      category: 'file' as const,
      icon: <FileText size={14} />,
      action: () => {
        window.api?.readFile(f.path).then((content: string) => {
          const ext = f.name.split('.').pop() || ''
          const langMap: Record<string, string> = {
            ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
            json: 'json', md: 'markdown', css: 'css', html: 'html', py: 'python',
            rs: 'rust', go: 'go', java: 'java', yml: 'yaml', yaml: 'yaml',
          }
          openFile({
            path: f.path, name: f.name, content,
            language: langMap[ext] || ext,
            isModified: false, aiModified: false,
          })
        })
        onClose()
      },
    }))
  }, [fileTree, openFile, onClose])

  const items = useMemo(() => {
    const source = isFileMode ? fileItems : commands
    if (!searchQuery) return source.slice(0, 20)
    const lower = searchQuery.toLowerCase()
    return source
      .filter(item => item.label.toLowerCase().includes(lower))
      .slice(0, 20)
  }, [isFileMode, searchQuery, fileItems, commands])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, items.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter' && items[selectedIndex]) {
      items[selectedIndex].action()
    }
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', justifyContent: 'center',
        paddingTop: 80,
      }}
      onClick={onClose}
    >
      <div
        className="anim-scale-in"
        onClick={e => e.stopPropagation()}
        style={{
          width: 560, maxHeight: 400,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-bright)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
        }}>
          {isFileMode
            ? <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            : <ChevronRight size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          }
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isFileMode ? 'Search files by name (type > for commands)' : 'Type a command...'}
            style={{
              flex: 1, background: 'transparent',
              border: 'none', outline: 'none',
              fontSize: 13, color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
            }}
          />
        </div>

        {/* Results */}
        <div ref={listRef} style={{
          flex: 1, overflowY: 'auto',
          padding: '4px 0',
        }}>
          {items.length === 0 ? (
            <div style={{
              padding: '24px 16px', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: 12,
            }}>
              No results found
            </div>
          ) : (
            items.map((item, idx) => (
              <div
                key={item.id}
                onClick={item.action}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 14px',
                  cursor: 'pointer',
                  background: idx === selectedIndex ? 'var(--bg-active)' : 'transparent',
                  color: idx === selectedIndex ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 13,
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span style={{ color: 'var(--text-muted)', flexShrink: 0, display: 'flex' }}>
                  {item.icon}
                </span>
                <span className="truncate" style={{ flex: 1 }}>{item.label}</span>
                {item.shortcut && (
                  <span className="kbd">{item.shortcut}</span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: '6px 14px',
          borderTop: '1px solid var(--border)',
          display: 'flex', gap: 12,
          fontSize: 11, color: 'var(--text-muted)',
        }}>
          <span><span className="kbd" style={{ marginRight: 4 }}>↑↓</span> navigate</span>
          <span><span className="kbd" style={{ marginRight: 4 }}>↵</span> select</span>
          <span><span className="kbd" style={{ marginRight: 4 }}>esc</span> close</span>
        </div>
      </div>
    </div>
  )
}
