import { useState, useEffect } from 'react'
import { useAgentStore } from '@/store/agents'
import { useEditorStore } from '@/store/editor'
import { useChatStore } from '@/store/chat'
import { useFileStore } from '@/store/files'
import {
  GitBranch,
  AlertTriangle,
  XCircle,
  Bot,
  Zap,
  CheckCircle2,
  Cloud,
  CloudOff,
  MessageSquare,
  Terminal,
  ArrowUpDown,
} from 'lucide-react'

interface Props {
  onToggleTerminal?: () => void
  onToggleChat?: () => void
}

interface StatusItemProps {
  children: React.ReactNode
  style?: React.CSSProperties
  onClick?: () => void
  title?: string
}

function StatusItem({ children, style, onClick, title }: StatusItemProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className="flex items-center"
      title={title}
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

interface GitInfo {
  isRepo: boolean
  branch: string
  files: { path: string; state: string }[]
  ahead: number
  behind: number
}

export default function StatusBar({ onToggleTerminal, onToggleChat }: Props) {
  const agents = useAgentStore((s) => s.agents)
  const activeFile = useEditorStore((s) =>
    s.openFiles.find((f) => f.path === s.activeFilePath)
  )
  const model = useChatStore((s) => s.selectedModel)
  const rootPath = useFileStore((s) => s.rootPath)
  const activeAgents = agents.filter((a) => a.status !== 'idle').length
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)

  useEffect(() => {
    if (!rootPath) return
    const fetchGit = async () => {
      try {
        const info = await window.api?.gitStatus(rootPath)
        if (info) setGitInfo(info)
      } catch {}
    }
    fetchGit()
    const interval = setInterval(fetchGit, 5000)
    return () => clearInterval(interval)
  }, [rootPath])

  const changedFiles = gitInfo?.files?.length || 0

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
        <StatusItem title={gitInfo?.isRepo ? `Branch: ${gitInfo.branch}` : 'Not a git repository'}>
          <GitBranch size={11} style={{ color: 'var(--text-secondary)' }} />
          <span style={{ color: 'var(--text-secondary)' }}>
            {gitInfo?.isRepo ? gitInfo.branch : 'No repo'}
          </span>
        </StatusItem>

        {/* Sync indicator */}
        <StatusItem title={gitInfo?.isRepo ? `${gitInfo.ahead || 0}↑ ${gitInfo.behind || 0}↓` : ''}>
          {gitInfo?.isRepo ? (
            <>
              <ArrowUpDown size={10} style={{ color: 'var(--text-muted)' }} />
              {(gitInfo.ahead > 0 || gitInfo.behind > 0) && (
                <span style={{ fontSize: 10 }}>
                  {gitInfo.ahead > 0 && `${gitInfo.ahead}↑`}
                  {gitInfo.behind > 0 && ` ${gitInfo.behind}↓`}
                </span>
              )}
            </>
          ) : (
            <CloudOff size={10} style={{ color: 'var(--text-muted)' }} />
          )}
        </StatusItem>

        {/* Changed files count */}
        {changedFiles > 0 && (
          <StatusItem title={`${changedFiles} changed files`}>
            <Cloud size={10} style={{ color: 'var(--accent-orange)' }} />
            <span style={{ color: 'var(--accent-orange)' }}>{changedFiles}</span>
          </StatusItem>
        )}

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
            <StatusItem>
              <span>Ln 1, Col 1</span>
            </StatusItem>
            <StatusItem>
              <span>Spaces: 2</span>
            </StatusItem>
            <StatusItem>
              <span>UTF-8</span>
            </StatusItem>
            <StatusItem>
              <span style={{ color: 'var(--text-secondary)' }}>
                {activeFile.language || 'Plain Text'}
              </span>
            </StatusItem>
          </>
        )}

        {/* Toggle buttons */}
        <StatusItem onClick={onToggleTerminal} title="Toggle Terminal (Ctrl+`)">
          <Terminal size={11} />
        </StatusItem>
        <StatusItem onClick={onToggleChat} title="Toggle Chat (Ctrl+L)">
          <MessageSquare size={11} />
        </StatusItem>

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
