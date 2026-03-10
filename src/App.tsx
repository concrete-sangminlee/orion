import { useState, useCallback } from 'react'
import TitleBar from './components/TitleBar'
import ActivityBar, { type PanelView } from './components/ActivityBar'
import Resizer from './components/Resizer'
import AgentPanel from './panels/AgentPanel'
import FileExplorer from './panels/FileExplorer'
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

  const handleSideResize = useCallback((delta: number) => {
    setSidePanelWidth((w) => Math.max(MIN_PANEL_WIDTH, w + delta))
  }, [])

  const handleRightResize = useCallback((delta: number) => {
    setRightPanelWidth((w) => Math.max(MIN_PANEL_WIDTH, w - delta))
  }, [])

  const handleBottomResize = useCallback((delta: number) => {
    setBottomPanelHeight((h) => Math.max(100, h - delta))
  }, [])

  return (
    <div className="h-screen flex flex-col">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <ActivityBar activeView={activeView} onViewChange={setActiveView} />

        {/* Side Panel */}
        <div className="flex flex-col overflow-hidden" style={{ width: sidePanelWidth }}>
          {activeView === 'agents' && <AgentPanel />}
          <FileExplorer />
        </div>

        <Resizer direction="horizontal" onResize={handleSideResize} />

        {/* Center: Editor + Bottom Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
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
    </div>
  )
}
