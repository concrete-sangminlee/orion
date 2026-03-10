import { useState, useCallback, useEffect } from 'react'
import { useFileWatcher } from './hooks/useIpc'
import { useOmo } from './hooks/useOmo'
import TitleBar from './components/TitleBar'
import ActivityBar, { type PanelView } from './components/ActivityBar'
import Resizer from './components/Resizer'
import StatusBar from './components/StatusBar'
import SettingsModal from './components/SettingsModal'
import CommandPalette from '@/components/CommandPalette'
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
  const [activeView, setActiveView] = useState<PanelView>('agents')
  const [sidePanelWidth, setSidePanelWidth] = useState(DEFAULT_SIDE_PANEL_WIDTH)
  const [rightPanelWidth, setRightPanelWidth] = useState(DEFAULT_RIGHT_PANEL_WIDTH)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(DEFAULT_BOTTOM_PANEL_HEIGHT)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

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

  // Keyboard shortcuts: Ctrl+Shift+P for command palette, Ctrl+P for quick open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+P -> command palette (command mode)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        setPaletteOpen((prev) => !prev)
        return
      }
      // Ctrl+P -> quick open (file mode)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'p') {
        e.preventDefault()
        setPaletteOpen((prev) => !prev)
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
          onViewChange={setActiveView}
          onSettingsClick={() => setSettingsOpen(true)}
        />

        {/* Side Panel */}
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
          {activeView === 'search' ? <SearchPanel /> : <FileExplorer />}
        </div>

        <Resizer direction="horizontal" onResize={handleSideResize} />

        {/* Center */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <EditorPanel />
          </div>
          <Resizer direction="vertical" onResize={handleBottomResize} />
          <div style={{ height: bottomPanelHeight }}>
            <BottomPanel />
          </div>
        </div>

        <Resizer direction="horizontal" onResize={handleRightResize} />

        {/* Right Panel: Chat */}
        <div style={{ width: rightPanelWidth }}>
          <ChatPanel />
        </div>
      </div>

      <StatusBar />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    </div>
  )
}
