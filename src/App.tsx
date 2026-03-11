import { useState, useCallback, useEffect } from 'react'
import { useFileWatcher } from './hooks/useIpc'
import { useOmo } from './hooks/useOmo'
import TitleBar from './components/TitleBar'
import ActivityBar, { type PanelView } from './components/ActivityBar'
import Resizer from './components/Resizer'
import StatusBar from './components/StatusBar'
import SettingsModal from './components/SettingsModal'
import CommandPalette from '@/components/CommandPalette'
import ToastContainer from '@/components/Toast'
import AgentPanel from './panels/AgentPanel'
import FileExplorer from './panels/FileExplorer'
import SearchPanel from '@/panels/SearchPanel'
import EditorPanel from './panels/EditorPanel'
import ChatPanel from './panels/ChatPanel'
import BottomPanel from './panels/BottomPanel'
import {
  DEFAULT_SIDE_PANEL_WIDTH,
  DEFAULT_RIGHT_PANEL_WIDTH,
  DEFAULT_BOTTOM_PANEL_HEIGHT,
  MIN_PANEL_WIDTH,
} from '@shared/constants'

export default function App() {
  const [activeView, setActiveView] = useState<PanelView>('explorer')
  const [sidePanelWidth, setSidePanelWidth] = useState(DEFAULT_SIDE_PANEL_WIDTH)
  const [rightPanelWidth, setRightPanelWidth] = useState(DEFAULT_RIGHT_PANEL_WIDTH)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(DEFAULT_BOTTOM_PANEL_HEIGHT)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [bottomVisible, setBottomVisible] = useState(true)
  const [chatVisible, setChatVisible] = useState(true)

  const handleSideResize = useCallback((delta: number) => {
    setSidePanelWidth((w) => Math.max(MIN_PANEL_WIDTH, w + delta))
  }, [])
  const handleRightResize = useCallback((delta: number) => {
    setRightPanelWidth((w) => Math.max(MIN_PANEL_WIDTH, w - delta))
  }, [])
  const handleBottomResize = useCallback((delta: number) => {
    setBottomPanelHeight((h) => Math.max(100, h - delta))
  }, [])

  useFileWatcher()
  useOmo()

  // Load saved API keys on startup
  useEffect(() => {
    try {
      const stored = localStorage.getItem('orion-api-keys')
      if (stored) {
        const keys = JSON.parse(stored)
        window.api?.omoSetApiKeys(keys)
      }
      const storedPrompts = localStorage.getItem('orion-prompts')
      if (storedPrompts) {
        const prompts = JSON.parse(storedPrompts)
        window.api?.omoSetPrompts(prompts)
      }
    } catch {}
  }, [])

  // Listen for custom events from menu bar / commands
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'orion:toggle-sidebar': () => setSidebarVisible((v) => !v),
      'orion:toggle-terminal': () => setBottomVisible((v) => !v),
      'orion:toggle-chat': () => setChatVisible((v) => !v),
      'orion:open-settings': () => setSettingsOpen(true),
      'orion:open-palette': () => setPaletteOpen(true),
      'orion:show-explorer': () => { setSidebarVisible(true); setActiveView('explorer') },
      'orion:show-search': () => { setSidebarVisible(true); setActiveView('search') },
      'orion:show-git': () => { setSidebarVisible(true); setActiveView('git') },
      'orion:show-agents': () => { setSidebarVisible(true); setActiveView('agents') },
    }
    Object.entries(handlers).forEach(([event, handler]) => {
      window.addEventListener(event, handler)
    })
    return () => {
      Object.entries(handlers).forEach(([event, handler]) => {
        window.removeEventListener(event, handler)
      })
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey

      // Ctrl+Shift+P -> command palette
      if (ctrl && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        setPaletteOpen((prev) => !prev)
        return
      }
      // Ctrl+P -> quick open (file mode)
      if (ctrl && !e.shiftKey && e.key === 'p') {
        e.preventDefault()
        setPaletteOpen((prev) => !prev)
        return
      }
      // Ctrl+B -> toggle sidebar
      if (ctrl && e.key === 'b') {
        e.preventDefault()
        setSidebarVisible((v) => !v)
        return
      }
      // Ctrl+` -> toggle terminal
      if (ctrl && e.key === '`') {
        e.preventDefault()
        setBottomVisible((v) => !v)
        return
      }
      // Ctrl+J -> toggle bottom panel
      if (ctrl && e.key === 'j') {
        e.preventDefault()
        setBottomVisible((v) => !v)
        return
      }
      // Ctrl+L -> focus chat
      if (ctrl && e.key === 'l') {
        e.preventDefault()
        setChatVisible(true)
        return
      }
      // Ctrl+, -> settings
      if (ctrl && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
        return
      }
      // Ctrl+Shift+E -> explorer
      if (ctrl && e.shiftKey && e.key === 'E') {
        e.preventDefault()
        setSidebarVisible(true)
        setActiveView('explorer')
        return
      }
      // Ctrl+Shift+F -> search
      if (ctrl && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setSidebarVisible(true)
        setActiveView('search')
        return
      }
      // Ctrl+Shift+G -> git
      if (ctrl && e.shiftKey && e.key === 'G') {
        e.preventDefault()
        setSidebarVisible(true)
        setActiveView('git')
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
        overflow: 'hidden',
      }}
    >
      <TitleBar />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ActivityBar
          activeView={activeView}
          onViewChange={(v) => {
            if (v === activeView && sidebarVisible) {
              setSidebarVisible(false)
            } else {
              setSidebarVisible(true)
              setActiveView(v)
            }
          }}
          onSettingsClick={() => setSettingsOpen(true)}
        />

        {/* Side Panel */}
        {sidebarVisible && (
          <>
            <div
              style={{
                width: sidePanelWidth,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                background: 'var(--bg-secondary)',
                borderRight: '1px solid var(--border)',
              }}
            >
              {activeView === 'agents' && <AgentPanel />}
              {activeView === 'search' && <SearchPanel />}
              {(activeView === 'explorer' || activeView === 'git') && <FileExplorer />}
            </div>

            <Resizer direction="horizontal" onResize={handleSideResize} />
          </>
        )}

        {/* Center */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <EditorPanel />
          </div>
          {bottomVisible && (
            <>
              <Resizer direction="vertical" onResize={handleBottomResize} />
              <div style={{ height: bottomPanelHeight }}>
                <BottomPanel />
              </div>
            </>
          )}
        </div>

        {/* Right Panel: Chat */}
        {chatVisible && (
          <>
            <Resizer direction="horizontal" onResize={handleRightResize} />
            <div style={{ width: rightPanelWidth }}>
              <ChatPanel />
            </div>
          </>
        )}
      </div>

      <StatusBar
        onToggleTerminal={() => setBottomVisible((v) => !v)}
        onToggleChat={() => setChatVisible((v) => !v)}
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <ToastContainer />
    </div>
  )
}
