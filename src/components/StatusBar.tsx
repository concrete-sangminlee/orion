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
  Bell,
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
  const logs = useAgentStore((s) => s.logs)
  const activeAgents = agents.filter((a) => a.status !== 'idle').length
  const errorCount = logs.filter((l) => l.type === 'error').length
  const warningCount = logs.filter((l) => l.type === 'action').length
  const unreadNotifications = errorCount + activeAgents
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 })
  const [selectionInfo, setSelectionInfo] = useState<{ chars: number; lines: number } | null>(null)

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

  // Listen for cursor position changes from EditorPanel
  useEffect(() => {
    const handleCursorChange = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail) {
        setCursorPos({ line: detail.line, column: detail.column })
      }
    }
    const handleSelectionChange = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setSelectionInfo(detail)
    }
    window.addEventListener('orion:cursor-change', handleCursorChange)
    window.addEventListener('orion:selection-change', handleSelectionChange)
    return () => {
      window.removeEventListener('orion:cursor-change', handleCursorChange)
      window.removeEventListener('orion:selection-change', handleSelectionChange)
    }
  }, [])

  // Reset cursor position when the active file changes
  useEffect(() => {
    setCursorPos({ line: 1, column: 1 })
    setSelectionInfo(null)
  }, [activeFile?.path])

  // Derive display language from file extension
  const getLanguageLabel = (filename?: string, language?: string): string => {
    if (language) {
      const langMap: Record<string, string> = {
        typescript: 'TypeScript',
        typescriptreact: 'TypeScript React',
        javascript: 'JavaScript',
        javascriptreact: 'JavaScript React',
        python: 'Python',
        html: 'HTML',
        css: 'CSS',
        scss: 'SCSS',
        less: 'Less',
        json: 'JSON',
        markdown: 'Markdown',
        yaml: 'YAML',
        xml: 'XML',
        rust: 'Rust',
        go: 'Go',
        java: 'Java',
        cpp: 'C++',
        c: 'C',
        csharp: 'C#',
        ruby: 'Ruby',
        php: 'PHP',
        swift: 'Swift',
        kotlin: 'Kotlin',
        sql: 'SQL',
        shell: 'Shell',
        bash: 'Bash',
        powershell: 'PowerShell',
        dockerfile: 'Dockerfile',
        plaintext: 'Plain Text',
      }
      return langMap[language] || language.charAt(0).toUpperCase() + language.slice(1)
    }
    if (!filename) return 'Plain Text'
    const ext = filename.split('.').pop()?.toLowerCase()
    const extMap: Record<string, string> = {
      ts: 'TypeScript', tsx: 'TypeScript React',
      js: 'JavaScript', jsx: 'JavaScript React',
      py: 'Python', rb: 'Ruby', rs: 'Rust', go: 'Go',
      java: 'Java', kt: 'Kotlin', swift: 'Swift',
      cpp: 'C++', c: 'C', cs: 'C#', php: 'PHP',
      html: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less',
      json: 'JSON', md: 'Markdown', yml: 'YAML', yaml: 'YAML',
      xml: 'XML', sql: 'SQL', sh: 'Shell', ps1: 'PowerShell',
    }
    return ext ? (extMap[ext] || 'Plain Text') : 'Plain Text'
  }

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

        {/* Divider */}
        <div className="status-divider" />

        {/* Error & warning counters (always visible, like VS Code) */}
        <StatusItem title={`${errorCount} error(s), ${warningCount} warning(s)`}>
          <XCircle
            size={10}
            style={{ color: errorCount > 0 ? 'var(--accent-red, #f44747)' : 'var(--text-muted)' }}
          />
          <span style={{ color: errorCount > 0 ? 'var(--accent-red, #f44747)' : undefined }}>
            {errorCount}
          </span>
          <AlertTriangle
            size={10}
            style={{
              color: warningCount > 0 ? 'var(--accent-orange, #cca700)' : 'var(--text-muted)',
              marginLeft: 4,
            }}
          />
          <span style={{ color: warningCount > 0 ? 'var(--accent-orange, #cca700)' : undefined }}>
            {warningCount}
          </span>
        </StatusItem>
      </div>

      {/* SPACER pushes right section to the end */}
      <div className="flex-1" />

      {/* RIGHT SECTION */}
      <div className="flex items-center" style={{ height: '100%' }}>
        {activeFile && (
          <>
            <StatusItem title={selectionInfo ? `${selectionInfo.chars} characters selected across ${selectionInfo.lines} line(s)` : `Line ${cursorPos.line}, Column ${cursorPos.column}`}>
              <span>
                Ln {cursorPos.line}, Col {cursorPos.column}
                {selectionInfo && (
                  <span style={{ color: 'var(--accent)', marginLeft: 4 }}>
                    ({selectionInfo.chars} selected)
                  </span>
                )}
              </span>
            </StatusItem>
            <StatusItem>
              <span>Spaces: 2</span>
            </StatusItem>
            <StatusItem title="End of line sequence">
              <span>LF</span>
            </StatusItem>
            <StatusItem title="File encoding">
              <span>UTF-8</span>
            </StatusItem>
            <StatusItem title={`Language: ${getLanguageLabel(activeFile.name, activeFile.language)}`}>
              <span style={{ color: 'var(--text-secondary)' }}>
                {getLanguageLabel(activeFile.name, activeFile.language)}
              </span>
            </StatusItem>
          </>
        )}

        {/* Divider before bell */}
        <div className="status-divider" />

        {/* Notification bell */}
        <StatusItem
          title={unreadNotifications > 0 ? `${unreadNotifications} notification(s)` : 'No notifications'}
          onClick={() => window.dispatchEvent(new CustomEvent('orion:show-agents'))}
        >
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Bell size={11} style={{ color: unreadNotifications > 0 ? 'var(--accent, #58a6ff)' : 'var(--text-muted)' }} />
            {unreadNotifications > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -6,
                  background: 'var(--accent-red, #f44747)',
                  color: '#fff',
                  fontSize: 8,
                  fontWeight: 700,
                  lineHeight: 1,
                  minWidth: 12,
                  height: 12,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 3px',
                }}
              >
                {unreadNotifications > 99 ? '99+' : unreadNotifications}
              </span>
            )}
          </div>
        </StatusItem>

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

        {/* Divider */}
        <div className="status-divider" />

        {/* Feedback button */}
        <StatusItem
          title="Send feedback"
          onClick={() => window.open('https://github.com/orion-editor/orion/issues', '_blank')}
        >
          <span style={{ fontSize: 10 }}>Feedback</span>
        </StatusItem>

        {/* Divider */}
        <div className="status-divider" />

        {/* Status */}
        <StatusItem>
          <CheckCircle2 size={10} style={{ color: 'var(--accent-green)' }} />
          <span style={{ color: 'var(--accent-green)' }}>Ready</span>
        </StatusItem>
      </div>
    </footer>
  )
}
