import { useState, useEffect, useCallback } from 'react'
import { useFileStore } from '@/store/files'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { useOutputStore } from '@/store/output'
import { GitBranch, Check, Plus, Minus, RotateCw, FileText, Trash2, ChevronRight, ChevronDown, X, Clock, GitCommit, User } from 'lucide-react'

interface GitFile {
  path: string
  state: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'
}

interface GitLogEntry {
  fullHash: string
  hash: string
  message: string
  author: string
  date: string
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

type ActiveTab = 'changes' | 'history'

export default function SourceControlPanel() {
  const [commitMessage, setCommitMessage] = useState('')
  const [branch, setBranch] = useState<string>('main')
  const [stagedFiles, setStagedFiles] = useState<GitFile[]>([])
  const [unstagedFiles, setUnstagedFiles] = useState<GitFile[]>([])
  const [stagedExpanded, setStagedExpanded] = useState(true)
  const [changesExpanded, setChangesExpanded] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedDiff, setSelectedDiff] = useState<{ path: string; diff: string } | null>(null)
  const [isDiffLoading, setIsDiffLoading] = useState(false)

  // History tab state
  const [activeTab, setActiveTab] = useState<ActiveTab>('changes')
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([])
  const [isLoadingLog, setIsLoadingLog] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [commitDetail, setCommitDetail] = useState<string | null>(null)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)

  const rootPath = useFileStore((s) => s.rootPath)
  const openFile = useEditorStore((s) => s.openFile)
  const addToast = useToastStore((s) => s.addToast)
  const appendOutput = useOutputStore((s) => s.appendOutput)

  const refreshStatus = useCallback(async () => {
    if (!rootPath) return
    setIsRefreshing(true)
    try {
      const status = await (window as any).api.gitStatus(rootPath)
      if (status) {
        setStagedFiles(status.staged || [])
        setUnstagedFiles(status.unstaged || [])
        if (status.branch) setBranch(status.branch)
        const total = (status.staged?.length || 0) + (status.unstaged?.length || 0)
        if (total > 0) {
          appendOutput('Git', `[status] Branch: ${status.branch || 'unknown'} | ${total} changed file(s)`, 'info')
        }
      }
    } catch (err: any) {
      appendOutput('Git', `[status] Error: ${err?.message || 'Failed to refresh'}`, 'error')
      console.error('Failed to refresh git status:', err)
    } finally {
      setIsRefreshing(false)
    }
  }, [rootPath, appendOutput])

  const fetchLog = useCallback(async () => {
    if (!rootPath) return
    setIsLoadingLog(true)
    try {
      const entries = await (window as any).api.gitLog(rootPath, 50)
      setLogEntries(entries || [])
    } catch (err) {
      console.error('Failed to fetch git log:', err)
      setLogEntries([])
    } finally {
      setIsLoadingLog(false)
    }
  }, [rootPath])

  useEffect(() => {
    refreshStatus()
    const interval = setInterval(refreshStatus, 5000)
    return () => clearInterval(interval)
  }, [refreshStatus])

  // Fetch log when History tab is activated
  useEffect(() => {
    if (activeTab === 'history') {
      fetchLog()
    }
  }, [activeTab, fetchLog])

  const handleCommit = async () => {
    if (!commitMessage.trim() || !rootPath) return
    appendOutput('Git', `[commit] Committing: "${commitMessage.trim()}"`, 'info')
    try {
      await (window as any).api.gitCommit(rootPath, commitMessage.trim())
      appendOutput('Git', `[commit] Success: "${commitMessage.trim()}"`, 'success')
      addToast({ type: 'success', message: 'Changes committed successfully' })
      setCommitMessage('')
      refreshStatus()
    } catch (err: any) {
      appendOutput('Git', `[commit] Failed: ${err?.message || 'Unknown error'}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Commit failed' })
    }
  }

  const handleStage = async (filePath: string) => {
    if (!rootPath) return
    try {
      await (window as any).api.gitStage(rootPath, filePath)
      appendOutput('Git', `[stage] Staged: ${filePath}`, 'info')
      refreshStatus()
    } catch (err: any) {
      appendOutput('Git', `[stage] Failed to stage ${filePath}: ${err?.message}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Failed to stage file' })
    }
  }

  const handleUnstage = async (filePath: string) => {
    if (!rootPath) return
    try {
      await (window as any).api.gitUnstage(rootPath, filePath)
      appendOutput('Git', `[unstage] Unstaged: ${filePath}`, 'info')
      refreshStatus()
    } catch (err: any) {
      appendOutput('Git', `[unstage] Failed to unstage ${filePath}: ${err?.message}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Failed to unstage file' })
    }
  }

  const handleDiscard = async (filePath: string) => {
    if (!rootPath) return
    try {
      await (window as any).api.gitDiscard(rootPath, filePath)
      appendOutput('Git', `[discard] Discarded changes: ${filePath}`, 'warn')
      addToast({ type: 'info', message: `Discarded changes in ${filePath.split('/').pop()}` })
      refreshStatus()
    } catch (err: any) {
      appendOutput('Git', `[discard] Failed to discard ${filePath}: ${err?.message}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Failed to discard changes' })
    }
  }

  const handleFileClick = async (filePath: string) => {
    if (!rootPath) return
    setIsDiffLoading(true)
    try {
      const diff = await (window as any).api.gitDiff(rootPath, filePath)
      setSelectedDiff({ path: filePath, diff: diff || 'No changes detected' })
    } catch {
      setSelectedDiff({ path: filePath, diff: 'Failed to load diff' })
    } finally {
      setIsDiffLoading(false)
    }
  }

  const handleCommitClick = async (hash: string) => {
    if (!rootPath) return
    if (selectedCommit === hash) {
      setSelectedCommit(null)
      setCommitDetail(null)
      return
    }
    setSelectedCommit(hash)
    setIsLoadingDetail(true)
    try {
      const detail = await (window as any).api.gitShow(rootPath, hash)
      setCommitDetail(detail || 'No details available')
    } catch {
      setCommitDetail('Failed to load commit details')
    } finally {
      setIsLoadingDetail(false)
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

  const getDiffLineStyle = (line: string): React.CSSProperties => {
    if (line.startsWith('@@')) {
      return {
        background: 'rgba(130, 100, 210, 0.12)',
        color: '#b392f0',
      }
    }
    if (line.startsWith('+')) {
      return {
        background: 'rgba(63, 185, 80, 0.1)',
        color: '#3fb950',
      }
    }
    if (line.startsWith('-')) {
      return {
        background: 'rgba(248, 81, 73, 0.1)',
        color: '#f85149',
      }
    }
    return {}
  }

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

  const renderChangesTab = () => (
    <>
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

      {/* Diff Viewer */}
      {selectedDiff && (
        <div
          style={{
            flexShrink: 0,
            maxHeight: '50%',
            display: 'flex',
            flexDirection: 'column',
            borderTop: '2px solid var(--accent-blue, #388bfd)',
          }}
        >
          {/* Diff header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '6px 10px',
              background: 'var(--bg-tertiary, #2d333b)',
              fontSize: 12,
              fontWeight: 600,
              flexShrink: 0,
              gap: 6,
            }}
          >
            <FileText size={13} style={{ opacity: 0.7, flexShrink: 0 }} />
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={selectedDiff.path}
            >
              {fileName(selectedDiff.path)}
              {dirName(selectedDiff.path) && (
                <span style={{ opacity: 0.5, marginLeft: 4, fontWeight: 400 }}>
                  {dirName(selectedDiff.path)}
                </span>
              )}
            </span>
            <button
              onClick={() => setSelectedDiff(null)}
              title="Close Diff"
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
                flexShrink: 0,
              }}
              className="source-control-action-btn"
            >
              <X size={14} />
            </button>
          </div>

          {/* Diff content */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'auto',
              background: 'var(--bg-primary)',
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace)',
            }}
          >
            {isDiffLoading ? (
              <div
                style={{
                  padding: '16px',
                  color: 'var(--text-disabled, #545d68)',
                  textAlign: 'center',
                }}
              >
                Loading diff...
              </div>
            ) : (
              selectedDiff.diff.split('\n').map((line, idx) => {
                const lineStyle = getDiffLineStyle(line)
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      minHeight: 18,
                      ...lineStyle,
                    }}
                  >
                    <span
                      style={{
                        width: 40,
                        flexShrink: 0,
                        textAlign: 'right',
                        paddingRight: 8,
                        color: 'var(--text-disabled, #545d68)',
                        userSelect: 'none',
                        opacity: 0.6,
                        borderRight: '1px solid var(--border)',
                      }}
                    >
                      {idx + 1}
                    </span>
                    <pre
                      style={{
                        margin: 0,
                        paddingLeft: 8,
                        paddingRight: 8,
                        whiteSpace: 'pre',
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        lineHeight: 'inherit',
                      }}
                    >
                      {line}
                    </pre>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </>
  )

  const renderHistoryTab = () => (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Commit list */}
      <div
        style={{
          flex: selectedCommit ? 0.5 : 1,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {isLoadingLog ? (
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
            <RotateCw size={18} style={{ opacity: 0.4, animation: 'spin 1s linear infinite' }} />
            <span>Loading history...</span>
          </div>
        ) : logEntries.length === 0 ? (
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
            <GitCommit size={24} style={{ opacity: 0.4 }} />
            <span>No commit history</span>
          </div>
        ) : (
          logEntries.map((entry, idx) => {
            const isSelected = selectedCommit === entry.hash
            const isLast = idx === logEntries.length - 1
            return (
              <div
                key={entry.hash}
                className="source-control-commit-item"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  padding: '0 12px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  background: isSelected ? 'var(--bg-hover, rgba(255,255,255,0.05))' : 'transparent',
                }}
                onClick={() => handleCommitClick(entry.hash)}
              >
                {/* Timeline */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    width: 20,
                    flexShrink: 0,
                    paddingTop: 10,
                  }}
                >
                  {/* Commit dot */}
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: isSelected ? 'var(--accent-blue, #388bfd)' : '#8b949e',
                      border: `2px solid ${isSelected ? 'var(--accent-blue, #388bfd)' : '#3d444d'}`,
                      flexShrink: 0,
                      zIndex: 1,
                    }}
                  />
                  {/* Connecting line */}
                  {!isLast && (
                    <div
                      style={{
                        width: 1,
                        flex: 1,
                        background: 'var(--border, #3d444d)',
                        minHeight: 20,
                      }}
                    />
                  )}
                </div>

                {/* Commit content */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '6px 0 6px 8px',
                    borderBottom: !isLast ? '1px solid rgba(255,255,255,0.03)' : 'none',
                  }}
                >
                  {/* Hash + Message row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: 2,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
                        fontSize: 11,
                        color: '#d2a8ff',
                        fontWeight: 600,
                        flexShrink: 0,
                        letterSpacing: '0.3px',
                      }}
                    >
                      {entry.hash}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                      title={entry.message}
                    >
                      {entry.message}
                    </span>
                  </div>

                  {/* Author + Date row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 11,
                      color: 'var(--text-disabled, #545d68)',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <User size={10} />
                      {entry.author}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Clock size={10} />
                      {entry.date}
                    </span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Commit detail viewer */}
      {selectedCommit && (
        <div
          style={{
            flex: 0.5,
            display: 'flex',
            flexDirection: 'column',
            borderTop: '2px solid var(--accent-blue, #388bfd)',
            minHeight: 0,
          }}
        >
          {/* Detail header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '6px 10px',
              background: 'var(--bg-tertiary, #2d333b)',
              fontSize: 12,
              fontWeight: 600,
              flexShrink: 0,
              gap: 6,
            }}
          >
            <GitCommit size={13} style={{ opacity: 0.7, flexShrink: 0 }} />
            <span
              style={{
                fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
                color: '#d2a8ff',
                fontSize: 11,
              }}
            >
              {selectedCommit}
            </span>
            <span style={{ flex: 1 }} />
            <button
              onClick={() => { setSelectedCommit(null); setCommitDetail(null) }}
              title="Close"
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
                flexShrink: 0,
              }}
              className="source-control-action-btn"
            >
              <X size={14} />
            </button>
          </div>

          {/* Detail content */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'auto',
              background: 'var(--bg-primary)',
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace)',
            }}
          >
            {isLoadingDetail ? (
              <div
                style={{
                  padding: '16px',
                  color: 'var(--text-disabled, #545d68)',
                  textAlign: 'center',
                }}
              >
                Loading commit details...
              </div>
            ) : commitDetail ? (
              commitDetail.split('\n').map((line, idx) => {
                let lineColor = 'var(--text-primary)'
                let lineBg = 'transparent'
                if (line.includes('|')) {
                  lineColor = 'var(--text-secondary)'
                } else if (line.includes('insertion') || line.includes('deletion') || line.includes('file changed') || line.includes('files changed')) {
                  lineColor = '#3fb950'
                  lineBg = 'rgba(63, 185, 80, 0.06)'
                }
                return (
                  <div
                    key={idx}
                    style={{
                      padding: '0 12px',
                      minHeight: 18,
                      color: lineColor,
                      background: lineBg,
                      whiteSpace: 'pre',
                    }}
                  >
                    {line}
                  </div>
                )
              })
            ) : null}
          </div>
        </div>
      )}
    </div>
  )

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
            onClick={() => {
              if (activeTab === 'changes') refreshStatus()
              else fetchLog()
            }}
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
                animation: isRefreshing || isLoadingLog ? 'spin 1s linear infinite' : 'none',
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

      {/* Tab switcher */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setActiveTab('changes')}
          style={{
            flex: 1,
            padding: '6px 12px',
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.3px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'changes' ? '2px solid var(--accent-blue, #388bfd)' : '2px solid transparent',
            color: activeTab === 'changes' ? 'var(--text-primary)' : 'var(--text-disabled, #545d68)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            transition: 'color 0.15s, border-color 0.15s',
          }}
          className="source-control-tab-btn"
        >
          <FileText size={12} />
          Changes
          {totalChanges > 0 && (
            <span
              style={{
                background: activeTab === 'changes' ? 'var(--accent-blue, #388bfd)' : 'var(--bg-tertiary, #2d333b)',
                color: activeTab === 'changes' ? '#fff' : 'var(--text-disabled, #545d68)',
                borderRadius: 8,
                padding: '0 5px',
                fontSize: 10,
                fontWeight: 600,
                lineHeight: '16px',
              }}
            >
              {totalChanges}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          style={{
            flex: 1,
            padding: '6px 12px',
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.3px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'history' ? '2px solid var(--accent-blue, #388bfd)' : '2px solid transparent',
            color: activeTab === 'history' ? 'var(--text-primary)' : 'var(--text-disabled, #545d68)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            transition: 'color 0.15s, border-color 0.15s',
          }}
          className="source-control-tab-btn"
        >
          <Clock size={12} />
          History
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'changes' ? renderChangesTab() : renderHistoryTab()}

      {/* Inline styles for hover effects and animations */}
      <style>{`
        .source-control-file-item:hover {
          background: var(--bg-hover, rgba(255,255,255,0.05));
        }
        .source-control-action-btn:hover {
          background: var(--bg-hover, rgba(255,255,255,0.1)) !important;
          color: var(--text-primary) !important;
        }
        .source-control-commit-item:hover {
          background: var(--bg-hover, rgba(255,255,255,0.05)) !important;
        }
        .source-control-tab-btn:hover {
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
