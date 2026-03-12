import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, FileText, Settings, Terminal, FolderOpen, MessageSquare, Zap, ChevronRight, Columns, Eye, EyeOff, Type, Minus, Plus, GitBranch, Paintbrush, WrapText, Map, PanelLeft, PanelBottom, X, Save, RotateCcw, RotateCw, Scissors, Copy, Clipboard, Keyboard, MousePointer, CaseSensitive, ArrowUpDown, ArrowDownUp, Merge, MessageSquareCode, Braces, ChevronsDownUp, ChevronsUpDown, Palette, Code } from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { useThemeStore } from '@/store/theme'

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
  const [themeMode, setThemeMode] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { openFile } = useEditorStore()
  const { fileTree } = useFileStore()
  const { themes: allThemes, setTheme, activeThemeId } = useThemeStore()

  const isFileMode = !themeMode && !query.startsWith('>')
  const searchQuery = themeMode
    ? query.trim()
    : query.startsWith('>') ? query.slice(1).trim() : query.trim()

  const dispatch = (event: string) => window.dispatchEvent(new CustomEvent(event))

  const commands: PaletteItem[] = useMemo(() => [
    // File
    { id: 'save', label: 'File: Save', category: 'command', icon: <Save size={14} />, shortcut: 'Ctrl+S', action: () => { dispatch('orion:save-file'); onClose() } },
    { id: 'folder', label: 'File: Open Folder', category: 'command', icon: <FolderOpen size={14} />, shortcut: 'Ctrl+O', action: () => { window.api?.openFolder(); onClose() } },
    { id: 'close-tab', label: 'File: Close Editor', category: 'command', icon: <X size={14} />, shortcut: 'Ctrl+W', action: () => { dispatch('orion:close-tab'); onClose() } },
    { id: 'close-all', label: 'File: Close All Editors', category: 'command', icon: <X size={14} />, action: () => { dispatch('orion:close-all-tabs'); onClose() } },
    // Edit
    { id: 'undo', label: 'Edit: Undo', category: 'command', icon: <RotateCcw size={14} />, shortcut: 'Ctrl+Z', action: () => { document.execCommand('undo'); onClose() } },
    { id: 'redo', label: 'Edit: Redo', category: 'command', icon: <RotateCw size={14} />, shortcut: 'Ctrl+Y', action: () => { document.execCommand('redo'); onClose() } },
    { id: 'cut', label: 'Edit: Cut', category: 'command', icon: <Scissors size={14} />, shortcut: 'Ctrl+X', action: () => { document.execCommand('cut'); onClose() } },
    { id: 'copy', label: 'Edit: Copy', category: 'command', icon: <Copy size={14} />, shortcut: 'Ctrl+C', action: () => { document.execCommand('copy'); onClose() } },
    { id: 'paste', label: 'Edit: Paste', category: 'command', icon: <Clipboard size={14} />, shortcut: 'Ctrl+V', action: () => { document.execCommand('paste'); onClose() } },
    { id: 'find', label: 'Edit: Find', category: 'command', icon: <Search size={14} />, shortcut: 'Ctrl+F', action: () => { dispatch('orion:editor-find'); onClose() } },
    { id: 'replace', label: 'Edit: Find and Replace', category: 'command', icon: <Search size={14} />, shortcut: 'Ctrl+H', action: () => { dispatch('orion:editor-replace'); onClose() } },
    // View
    { id: 'toggle-sidebar', label: 'View: Toggle Sidebar', category: 'command', icon: <PanelLeft size={14} />, shortcut: 'Ctrl+B', action: () => { dispatch('orion:toggle-sidebar'); onClose() } },
    { id: 'toggle-terminal', label: 'View: Toggle Terminal', category: 'command', icon: <PanelBottom size={14} />, shortcut: 'Ctrl+`', action: () => { dispatch('orion:toggle-terminal'); onClose() } },
    { id: 'toggle-chat', label: 'View: Toggle Chat Panel', category: 'command', icon: <MessageSquare size={14} />, shortcut: 'Ctrl+L', action: () => { dispatch('orion:toggle-chat'); onClose() } },
    { id: 'show-explorer', label: 'View: Show Explorer', category: 'command', icon: <FileText size={14} />, shortcut: 'Ctrl+Shift+E', action: () => { dispatch('orion:show-explorer'); onClose() } },
    { id: 'show-search', label: 'View: Show Search', category: 'command', icon: <Search size={14} />, shortcut: 'Ctrl+Shift+F', action: () => { dispatch('orion:show-search'); onClose() } },
    { id: 'show-git', label: 'View: Show Source Control', category: 'command', icon: <GitBranch size={14} />, shortcut: 'Ctrl+Shift+G', action: () => { dispatch('orion:show-git'); onClose() } },
    { id: 'show-agents', label: 'View: Show Agents', category: 'command', icon: <Zap size={14} />, action: () => { dispatch('orion:show-agents'); onClose() } },
    // Editor
    { id: 'toggle-wordwrap', label: 'Editor: Toggle Word Wrap', category: 'command', icon: <WrapText size={14} />, action: () => { dispatch('orion:toggle-wordwrap'); onClose() } },
    { id: 'toggle-minimap', label: 'Editor: Toggle Minimap', category: 'command', icon: <Map size={14} />, action: () => { dispatch('orion:toggle-minimap'); onClose() } },
    { id: 'format', label: 'Editor: Format Document', category: 'command', icon: <Paintbrush size={14} />, shortcut: 'Shift+Alt+F', action: () => { dispatch('orion:format-document'); onClose() } },
    { id: 'split-editor', label: 'Editor: Split Editor Right', category: 'command', icon: <Columns size={14} />, action: () => { dispatch('orion:split-editor'); onClose() } },
    { id: 'font-increase', label: 'Editor: Increase Font Size', category: 'command', icon: <Plus size={14} />, shortcut: 'Ctrl+=', action: () => { dispatch('orion:font-increase'); onClose() } },
    { id: 'font-decrease', label: 'Editor: Decrease Font Size', category: 'command', icon: <Minus size={14} />, shortcut: 'Ctrl+-', action: () => { dispatch('orion:font-decrease'); onClose() } },
    { id: 'font-reset', label: 'Editor: Reset Font Size', category: 'command', icon: <Type size={14} />, action: () => { dispatch('orion:font-reset'); onClose() } },
    // Multi-cursor / Selection
    { id: 'add-selection-next', label: 'Editor: Add Selection to Next Find Match', category: 'command', icon: <MousePointer size={14} />, shortcut: 'Ctrl+D', action: () => { dispatch('orion:add-selection-next-match'); onClose() } },
    { id: 'select-all-occurrences', label: 'Editor: Select All Occurrences', category: 'command', icon: <MousePointer size={14} />, shortcut: 'Ctrl+Shift+L', action: () => { dispatch('orion:select-all-occurrences'); onClose() } },
    { id: 'add-cursor-above', label: 'Editor: Add Cursor Above', category: 'command', icon: <MousePointer size={14} />, shortcut: 'Ctrl+Alt+Up', action: () => { dispatch('orion:add-cursor-above'); onClose() } },
    { id: 'add-cursor-below', label: 'Editor: Add Cursor Below', category: 'command', icon: <MousePointer size={14} />, shortcut: 'Ctrl+Alt+Down', action: () => { dispatch('orion:add-cursor-below'); onClose() } },
    // Transform
    { id: 'transform-uppercase', label: 'Editor: Transform to Uppercase', category: 'command', icon: <CaseSensitive size={14} />, action: () => { dispatch('orion:transform-uppercase'); onClose() } },
    { id: 'transform-lowercase', label: 'Editor: Transform to Lowercase', category: 'command', icon: <CaseSensitive size={14} />, action: () => { dispatch('orion:transform-lowercase'); onClose() } },
    // Sort / Join
    { id: 'sort-lines-asc', label: 'Editor: Sort Lines Ascending', category: 'command', icon: <ArrowUpDown size={14} />, action: () => { dispatch('orion:sort-lines-asc'); onClose() } },
    { id: 'sort-lines-desc', label: 'Editor: Sort Lines Descending', category: 'command', icon: <ArrowDownUp size={14} />, action: () => { dispatch('orion:sort-lines-desc'); onClose() } },
    { id: 'join-lines', label: 'Editor: Join Lines', category: 'command', icon: <Merge size={14} />, action: () => { dispatch('orion:join-lines'); onClose() } },
    // Comments
    { id: 'toggle-line-comment', label: 'Editor: Toggle Line Comment', category: 'command', icon: <MessageSquareCode size={14} />, shortcut: 'Ctrl+/', action: () => { dispatch('orion:toggle-line-comment'); onClose() } },
    { id: 'toggle-block-comment', label: 'Editor: Toggle Block Comment', category: 'command', icon: <Braces size={14} />, shortcut: 'Ctrl+Shift+/', action: () => { dispatch('orion:toggle-block-comment'); onClose() } },
    // Folding
    { id: 'fold-all', label: 'Editor: Fold All', category: 'command', icon: <ChevronsDownUp size={14} />, shortcut: 'Ctrl+K Ctrl+0', action: () => { dispatch('orion:fold-all'); onClose() } },
    { id: 'unfold-all', label: 'Editor: Unfold All', category: 'command', icon: <ChevronsUpDown size={14} />, shortcut: 'Ctrl+K Ctrl+J', action: () => { dispatch('orion:unfold-all'); onClose() } },
    // Terminal
    { id: 'terminal', label: 'Terminal: Create New Terminal', category: 'command', icon: <Terminal size={14} />, shortcut: 'Ctrl+`', action: () => { dispatch('orion:toggle-terminal'); onClose() } },
    // AI
    { id: 'inline-edit', label: 'AI: Inline Edit (Ctrl+K)', category: 'command', icon: <Zap size={14} />, shortcut: 'Ctrl+K', action: () => { dispatch('orion:inline-edit'); onClose() } },
    // Preferences
    { id: 'color-theme', label: 'Preferences: Color Theme', category: 'command', icon: <Palette size={14} />, action: () => { setThemeMode(true); setQuery(''); setSelectedIndex(0) } },
    { id: 'settings', label: 'Preferences: Open Settings', category: 'command', icon: <Settings size={14} />, shortcut: 'Ctrl+,', action: () => { onClose(); onOpenSettings() } },
    { id: 'shortcuts', label: 'Preferences: Keyboard Shortcuts', category: 'command', icon: <Keyboard size={14} />, shortcut: 'Ctrl+K Ctrl+S', action: () => { onClose(); onOpenSettings() } },
  ], [onClose, onOpenSettings, setThemeMode])

  const fileItems: PaletteItem[] = useMemo(() => {
    return flattenFiles(fileTree).map(f => ({
      id: f.path,
      label: f.name,
      category: 'file' as const,
      icon: <FileText size={14} />,
      action: () => {
        window.api?.readFile(f.path).then((result: any) => {
          const content = typeof result === 'string' ? result : result?.content || ''
          const ext = f.name.split('.').pop() || ''
          const langMap: Record<string, string> = {
            ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
            json: 'json', md: 'markdown', css: 'css', html: 'html', py: 'python',
            rs: 'rust', go: 'go', java: 'java', yml: 'yaml', yaml: 'yaml',
            scss: 'scss', less: 'less', vue: 'vue', sh: 'shell', bash: 'shell',
            toml: 'toml', xml: 'xml', svg: 'xml', sql: 'sql', graphql: 'graphql',
          }
          openFile({
            path: f.path, name: f.name, content,
            language: result?.language || langMap[ext] || ext,
            isModified: false, aiModified: false,
          })
        })
        onClose()
      },
    }))
  }, [fileTree, openFile, onClose])

  // Theme picker items (shown in theme-mode)
  const themeItems: PaletteItem[] = useMemo(() => {
    return allThemes.map((t) => ({
      id: `theme-${t.id}`,
      label: `${t.name}${t.id === activeThemeId ? '  (active)' : ''}`,
      category: 'command' as const,
      icon: <Palette size={14} />,
      action: () => { setTheme(t.id); onClose() },
    }))
  }, [allThemes, activeThemeId, setTheme, onClose])

  const items = useMemo(() => {
    const source = themeMode ? themeItems : isFileMode ? fileItems : commands
    if (!searchQuery) return source.slice(0, 30)
    const lower = searchQuery.toLowerCase()

    // Fuzzy match: each character must appear in order
    const fuzzyMatch = (text: string, query: string) => {
      let qi = 0
      const tl = text.toLowerCase()
      for (let i = 0; i < tl.length && qi < query.length; i++) {
        if (tl[i] === query[qi]) qi++
      }
      return qi === query.length
    }

    // Score: prefer exact substring > starts with > fuzzy
    const scored = source
      .filter(item => fuzzyMatch(item.label, lower))
      .map(item => {
        const ll = item.label.toLowerCase()
        let score = 0
        if (ll === lower) score = 100
        else if (ll.startsWith(lower)) score = 80
        else if (ll.includes(lower)) score = 60
        else score = 30 // fuzzy only
        return { item, score }
      })
      .sort((a, b) => b.score - a.score)

    return scored.map(s => s.item).slice(0, 30)
  }, [themeMode, isFileMode, searchQuery, themeItems, fileItems, commands])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setThemeMode(false)
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
          {themeMode
            ? <Palette size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            : isFileMode
              ? <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              : <ChevronRight size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          }
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={themeMode ? 'Select a color theme...' : isFileMode ? 'Search files by name (type > for commands)' : 'Type a command...'}
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
                <span className="truncate" style={{ flex: 1 }}>
                  {item.label}
                  {item.category === 'file' && (
                    <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.4 }}>
                      {item.id.replace(/\\/g, '/').split('/').slice(-3, -1).join('/')}
                    </span>
                  )}
                </span>
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
