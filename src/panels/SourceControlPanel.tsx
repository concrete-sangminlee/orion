import { useState, useEffect, useCallback } from 'react'
import { useFileStore } from '@/store/files'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { GitBranch, Check, Plus, Minus, RotateCw, FileText, Trash2, ChevronRight, ChevronDown } from 'lucide-react'

interface GitFile {
  path: string
  state: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'
}

const STATUS_COLORS: Record<GitFile['state'], string> = {
  modified: '#d29922',
  added: '#3fb950',
  deleted: '#f85149',
  untracked: '#8b949e',
  renamed: '#d2a8ff',
}

const STATUS_LABELS: Record<GitFile['state'], string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  untracked: 'U',
  renamed: 'R',
}

export default function SourceControlPanel() {
  const [commitMessage, setCommitMessage] = useState('')
  const [branch, setBranch] = useState<string>('main')
  const [stagedFiles, setStagedFiles] = useState<GitFile[]>([])
  const [unstagedFiles, setUnstagedFiles] = useState<GitFile[]>([])
  const [stagedExpanded, setStagedExpanded] = useState(true)
  const [changesExpanded, setChangesExpanded] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const rootPath = useFileStore((s) => s.rootPath)
  const openFile = useEditorStore((s) => s.openFile)
  const addToast = useToastStore((s) => s.addToast)

  const refreshStatus = useCallback(async () => {
    if (!rootPath) return
    setIsRefreshing(true)
    try {
      const status = await (window as any).api.gitStatus(rootPath)
      if (status) {
        setStagedFiles(status.staged || [])
        setUnstagedFiles(status.unstaged || [])
        if (status.branch) setBranch(status.branch)
      }
    } catch (err) {
      console.error('Failed to refresh git status:', err)
    } finally {
      setIsRefreshing(false)
    }
  }, [rootPath])

  useEffect(() => {
    refreshStatus()
    const interval = setInterval(refreshStatus, 5000)
    return () => clearInterval(interval)
  }, [refreshStatus])

  const handleCommit = async () => {
    if (!commitMessage.trim() || !rootPath) return
    try {
      await (window as any).api.gitCommit(rootPath, commitMessage.trim())
      addToast({ type: 'success', message: 'Changes committed successfully' })
      setCommitMessage('')
      refreshStatus()
    } catch (err: any) {
      addToast({ type: 'error', message: err?.message || 'Commit failed' })
    }
  }

  const handleStage = async (filePath: string) => {
    if (!rootPath) return
    try {
      await (window as any).api.gitStage(rootPath, filePath)
      refreshStatus()
    } catch (err: any) {
      addToast({ type: 'error', message: err?.message || 'Failed to stage file' })
    }
  }

  const handleUnstage = async (filePath: string) => {
    if (!rootPath) return
    try {
      await (window as any).api.gitUnstage(rootPath, filePath)
      refreshStatus()
    } catch (err: any) {
      addToast({ type: 'error', message: err?.message || 'Failed to unstage file' })
    }
  }

  const handleDiscard = async (filePath: string) => {
    if (!rootPath) return
    try {
      await (window as any).api.gitDiscard(rootPath, filePath)
      addToast({ type: 'info', message: `Discarded changes in ${filePath.split('/').pop()}` })
      refreshStatus()
    } catch (err: any) {
      addToast({ type: 'error', message: err?.message || 'Failed to discard changes' })
    }
  }

  const handleFileClick = (filePath: string) => {
    if (rootPath) {
      openFile(`${rootPath}/${filePath}`)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleCommit()
    }
  }

  const fileName = (filePath: string) => {
    const parts = filePath.split('/')
    return parts[parts.length - 1]
  }

  const dirName = (filePath: string) => {
    const parts = filePath.split('/')
    if (parts.length <= 1) return ''
    return parts.slice(0, -1).join('/') + '/'
  }

  const totalChanges = stagedFiles.length + unstagedFiles.length

  const renderFileItem = (file: GitFile, isStaged: boolean) => {
    const color = STATUS_COLORS[file.state]
    const label = STATUS_LABELS[file.state]

    return (
      <div
        key={`${isStaged ? 'staged' : 'unstaged'}-${file.path}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 26,
          paddingLeft: 24,
          paddingRight: 8,
          fontSize: 12,
          cursor: 'pointer',
          userSelect: 'none',
        }}
        className="source-control-file-item"
        onClick={() => handleFileClick(file.path)}
      >
        {/* Status dot */}
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: color,
            marginRight: 8,
            flexShrink: 0,
          }}
        />

        {/* File icon */}
        <FileText size={14} style={{ marginRight: 6, flexShrink: 0, opacity: 0.6 }} />

        {/* File name and path */}
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={file.path}
        >
          {fileName(file.path)}
          {dirName(file.path) && (
            <span style={{ opacity: 0.5, marginLeft: 4 }}>
              {dirName(file.path)}
            </span>
          )}
        </span>

        {/* Status badge */}
        <span
          style={{
            color,
            fontWeight: 600,
            fontSize: 11,
            marginRight: 4,
            flexShrink: 0,
            width: 14,
            textAlign: 'center',
          }}
        >
          {label}
        </span>

        {/* Action buttons */}
        <div
          style={{ display: 'flex', gap: 2, flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {isStaged ? (
            <button
              onClick={() => handleUnstage(file.path)}
              title="Unstage"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 3,
                color: 'var(--text-secondary)',
              }}
              className="source-control-action-btn"
            >
              <Minus size={14} />
            </button>
          ) : (
            <>
              <button
                onClick={() => handleDiscard(file.path)}
                title="Discard Changes"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 3,
                  color: 'var(--text-secondary)',
                }}
                className="source-control-action-btn"
              >
                <Trash2 size={14} />
              </button>
              <button
                onClick={() => handleStage(file.path)}
                title="Stage"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 3,
                  color: 'var(--text-secondary)',
                }}
                className="source-control-action-btn"
              >
                <Plus size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div className="panel-header" style={{ flexShrink: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Source Control
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
          <button
            onClick={refreshStatus}
            title="Refresh"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              color: 'var(--text-secondary)',
            }}
            className="source-control-action-btn"
          >
            <RotateCw
              size={14}
              style={{
                animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
              }}
            />
          </button>
        </div>
      </div>

      {/* Branch indicator */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          fontSize: 12,
          color: 'var(--text-secondary)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <GitBranch size={14} />
        <span style={{ fontWeight: 500 }}>{branch}</span>
        {totalChanges > 0 && (
          <span
            style={{
              marginLeft: 'auto',
              background: 'var(--accent-blue, #388bfd)',
              color: '#fff',
              borderRadius: 10,
              padding: '0 6px',
              fontSize: 10,
              fontWeight: 600,
              lineHeight: '18px',
            }}
          >
            {totalChanges}
          </span>
        )}
      </div>

      {/* Commit section */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div style={{ position: 'relative' }}>
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message (Ctrl+Enter to commit)"
            rows={2}
            style={{
              width: '100%',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-primary)',
              fontSize: 12,
              padding: '6px 8px',
              resize: 'vertical',
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
              lineHeight: 1.4,
            }}
          />
        </div>
        <button
          onClick={handleCommit}
          disabled={!commitMessage.trim()}
          style={{
            width: '100%',
            marginTop: 6,
            padding: '5px 12px',
            borderRadius: 6,
            border: 'none',
            fontSize: 12,
            fontWeight: 600,
            cursor: commitMessage.trim() ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            background: commitMessage.trim()
              ? 'var(--accent-green, #3fb950)'
              : 'var(--bg-tertiary, #2d333b)',
            color: commitMessage.trim()
              ? '#fff'
              : 'var(--text-disabled, #545d68)',
            opacity: commitMessage.trim() ? 1 : 0.6,
            transition: 'background 0.15s, opacity 0.15s',
          }}
        >
          <Check size={14} />
          Commit
        </button>
      </div>

      {/* File lists */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {/* Staged Changes */}
        {stagedFiles.length > 0 && (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                height: 26,
                padding: '0 8px',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.3px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onClick={() => setStagedExpanded(!stagedExpanded)}
            >
              {stagedExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span style={{ marginLeft: 4 }}>Staged Changes</span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 10,
                  background: 'var(--bg-tertiary, #2d333b)',
                  borderRadius: 10,
                  padding: '0 6px',
                  lineHeight: '16px',
                }}
              >
                {stagedFiles.length}
              </span>
            </div>
            {stagedExpanded &&
              stagedFiles.map((file) => renderFileItem(file, true))}
          </div>
        )}

        {/* Unstaged Changes */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 26,
              padding: '0 8px',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.3px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              userSelect: 'none',
            }}
            onClick={() => setChangesExpanded(!changesExpanded)}
          >
            {changesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span style={{ marginLeft: 4 }}>Changes</span>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 10,
                background: 'var(--bg-tertiary, #2d333b)',
                borderRadius: 10,
                padding: '0 6px',
                lineHeight: '16px',
              }}
            >
              {unstagedFiles.length}
            </span>
          </div>
          {changesExpanded &&
            unstagedFiles.map((file) => renderFileItem(file, false))}
        </div>

        {/* Empty state */}
        {totalChanges === 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '32px 16px',
              color: 'var(--text-disabled, #545d68)',
              fontSize: 12,
              textAlign: 'center',
              gap: 8,
            }}
          >
            <Check size={24} style={{ opacity: 0.4 }} />
            <span>No changes detected</span>
          </div>
        )}
      </div>

      {/* Inline styles for hover effects and animations */}
      <style>{`
        .source-control-file-item:hover {
          background: var(--bg-hover, rgba(255,255,255,0.05));
        }
        .source-control-action-btn:hover {
          background: var(--bg-hover, rgba(255,255,255,0.1)) !important;
          color: var(--text-primary) !important;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
