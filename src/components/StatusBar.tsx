import { useState } from 'react'
import { useAgentStore } from '@/store/agents'
import { useEditorStore } from '@/store/editor'
import { useChatStore } from '@/store/chat'
import {
  GitBranch,
  AlertTriangle,
  XCircle,
  Bot,
  Zap,
  CheckCircle2,
  Cloud,
} from 'lucide-react'

interface StatusItemProps {
  children: React.ReactNode
  style?: React.CSSProperties
  onClick?: () => void
}

function StatusItem({ children, style, onClick }: StatusItemProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className="flex items-center"
      style={{
        height: '100%',
        padding: '0 7px',
        gap: 4,
        cursor: onClick ? 'pointer' : 'default',
        background: hovered ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
        transition: 'background 0.1s',
        ...style,
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </div>
  )
}

export default function StatusBar() {
  const agents = useAgentStore((s) => s.agents)
  const activeFile = useEditorStore((s) =>
    s.openFiles.find((f) => f.path === s.activeFilePath)
  )
  const model = useChatStore((s) => s.selectedModel)
  const activeAgents = agents.filter((a) => a.status !== 'idle').length

  return (
    <footer
      className="shrink-0 flex items-center select-none"
      style={{
        height: 22,
        background: 'var(--bg-tertiary)',
        borderTop: '1px solid var(--border)',
        fontSize: 11,
        color: 'var(--text-muted)',
      }}
    >
      {/* LEFT SECTION */}
      <div className="flex items-center" style={{ height: '100%' }}>
        {/* Brand badge */}
        <div
          className="flex items-center justify-center"
          style={{
            height: 22,
            padding: '0 10px',
            background: 'linear-gradient(135deg, #58a6ff, #bc8cff)',
            color: '#fff',
            fontWeight: 600,
            fontSize: 10,
            gap: 4,
            display: 'flex',
          }}
        >
          <Zap size={9} fill="#fff" />
          Orion
        </div>

        {/* Branch info */}
        <StatusItem>
          <GitBranch size={11} style={{ color: 'var(--text-secondary)' }} />
          <span style={{ color: 'var(--text-secondary)' }}>main</span>
        </StatusItem>

        {/* Sync indicator */}
        <StatusItem>
          <Cloud size={10} style={{ color: 'var(--text-muted)' }} />
        </StatusItem>

        {/* Active agents */}
        {activeAgents > 0 && (
          <StatusItem style={{ color: 'var(--accent-green)' }}>
            <Bot size={11} />
            <span>{activeAgents} active</span>
          </StatusItem>
        )}
      </div>

      {/* CENTER SECTION */}
      <div className="flex-1 flex items-center justify-center" style={{ height: '100%' }}>
        <StatusItem>
          <XCircle size={10} style={{ color: 'var(--text-muted)' }} />
          <span>0</span>
        </StatusItem>
        <StatusItem>
          <AlertTriangle size={10} style={{ color: 'var(--text-muted)' }} />
          <span>0</span>
        </StatusItem>
      </div>

      {/* RIGHT SECTION */}
      <div className="flex items-center" style={{ height: '100%' }}>
        {activeFile && (
          <>
            {/* Line/Col info */}
            <StatusItem>
              <span>Ln 1, Col 1</span>
            </StatusItem>

            {/* Spaces */}
            <StatusItem>
              <span>Spaces: 2</span>
            </StatusItem>

            {/* Encoding */}
            <StatusItem>
              <span>UTF-8</span>
            </StatusItem>

            {/* Language */}
            <StatusItem>
              <span style={{ color: 'var(--text-secondary)' }}>
                {activeFile.language || 'Plain Text'}
              </span>
            </StatusItem>
          </>
        )}

        {/* AI model */}
        <StatusItem>
          <Zap size={9} />
          <span>{model}</span>
        </StatusItem>

        {/* Status */}
        <StatusItem>
          <CheckCircle2 size={10} style={{ color: 'var(--accent-green)' }} />
          <span style={{ color: 'var(--accent-green)' }}>Ready</span>
        </StatusItem>
      </div>
    </footer>
  )
}
