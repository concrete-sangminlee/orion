import { useState, useEffect, useCallback, useRef } from 'react'
import { useFileStore } from '@/store/files'
import { useToastStore } from '@/store/toast'
import { useOutputStore } from '@/store/output'
import { useScmStore } from '@/store/scm'
import { pullCurrentBranch, pushCurrentBranch, stashChanges } from '@/hooks/useGitCommands'
import { openFileInEditor } from '@/utils/openFileInEditor'
import { ipcErrorMessage } from '@/utils/ipcResult'
import type { GitBranch as GitBranchInfo } from '@shared/ipc-contract'
import { GitBranch, Check, Plus, Minus, RotateCw, FileText, Trash2, ChevronRight, ChevronDown, X, Clock, GitCommit, User, ArrowUp, ArrowDown, Download, Archive, Plus as PlusIcon, AlertTriangle, Package, Play, XCircle, Tag, GitMerge, Copy, Bookmark, BookmarkPlus, Square, CheckSquare, List } from 'lucide-react'

interface GitFile {
  path: string
  state: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'
}

const inlineDiffKey = (filePath: string, isStaged: boolean) => `${isStaged ? 'staged' : 'unstaged'}:${filePath}`

interface CheckoutTarget {
  /** The local branch to switch to. */
  branch: string
  /** Remote-tracking ref to create `branch` from when it does not exist yet. */
  track?: string
}

/** What checking out a picker entry should switch to. */
function checkoutTargetFor(branch: GitBranchInfo, all: GitBranchInfo[]): CheckoutTarget {
  if (!branch.remote) return { branch: branch.name }
  // A remote-tracking ref checks out as a detached HEAD: switch to the local
  // branch of that name, or create one that tracks this ref.
  const local = branch.name.slice(branch.remote.length + 1)
  return all.some((b) => !b.remote && b.name === local) ? { branch: local } : { branch: local, track: branch.name }
}

function checkoutTitle(branch: GitBranchInfo, target: CheckoutTarget): string | undefined {
  if (!branch.remote) return undefined
  return target.track
    ? `Create local branch ${target.branch} tracking ${branch.name}`
    : `Switch to the existing local branch ${target.branch}`
}

interface GitLogEntry {
  fullHash: string
  hash: string
  message: string
  author: string
  email: string
  date: string
}

interface StashEntry {
  index: number
  hash: string
  message: string
}

interface CommitDetail {
  fullHash: string
  hash: string
  author: string
  email: string
  date: string
  message: string
  filesChanged: { file: string; changes: string }[]
  summary: string
}

interface DiffHunk {
  header: string
  lines: string[]
  startLine: number
  endLine: number
}

interface CommitTemplate {
  id: string
  name: string
  template: string
}

interface GitTag {
  name: string
  hash: string
  targetHash?: string
  message?: string
  tagger?: string
  taggerEmail?: string
  date?: string
  isAnnotated?: boolean
}

const CONVENTIONAL_COMMIT_TYPES = [
  { type: 'feat', label: 'feat:', description: 'A new feature', color: '#3fb950' },
  { type: 'fix', label: 'fix:', description: 'A bug fix', color: '#f85149' },
  { type: 'refactor', label: 'refactor:', description: 'Code refactoring', color: '#d2a8ff' },
  { type: 'docs', label: 'docs:', description: 'Documentation changes', color: '#388bfd' },
  { type: 'test', label: 'test:', description: 'Adding/updating tests', color: '#d29922' },
  { type: 'chore', label: 'chore:', description: 'Maintenance tasks', color: '#8b949e' },
  { type: 'style', label: 'style:', description: 'Code style changes', color: '#f78166' },
  { type: 'perf', label: 'perf:', description: 'Performance improvements', color: '#7ee787' },
  { type: 'ci', label: 'ci:', description: 'CI/CD changes', color: '#a5d6ff' },
] as const

const BRANCH_COLORS = [
  '#388bfd', '#3fb950', '#d29922', '#f85149', '#d2a8ff',
  '#f78166', '#a5d6ff', '#7ee787', '#ff7b72', '#79c0ff',
]

const getBranchColor = (name: string): string => {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return BRANCH_COLORS[Math.abs(hash) % BRANCH_COLORS.length]
}

const parseDiffIntoHunks = (diff: string): DiffHunk[] => {
  const hunks: DiffHunk[] = []
  const lines = diff.split('\n')
  // An untracked folder's diff covers several files: name the file in each
  // hunk header, and keep the next file's headers out of the previous hunk.
  const multiFile = lines.filter((line) => line.startsWith('diff --git ')).length > 1
  let file = ''
  let currentHunk: DiffHunk | null = null

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (currentHunk) hunks.push(currentHunk)
      currentHunk = null
      file = ''
    } else if (!currentHunk && (line.startsWith('--- ') || line.startsWith('+++ '))) {
      // "+++ b/<path>", or "--- a/<path>" when the file was deleted.
      const name = line.slice(4)
      if (name !== '/dev/null') file = name.replace(/^[ab]\//, '')
    } else if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk)
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      const header = multiFile && file ? `${file} ${line}` : line
      currentHunk = {
        header,
        lines: [header],
        startLine: match ? parseInt(match[1]) : 0,
        endLine: match ? parseInt(match[1]) + parseInt(match[2] || '1') : 0,
      }
    } else if (currentHunk && /^([ +\-\\]|$)/.test(line)) {
      currentHunk.lines.push(line)
    } else if (currentHunk) {
      // Not a diff line (e.g. main's "N more untracked files not shown"):
      // show it as a heading, not as a line of the file above.
      hunks.push(currentHunk, { header: line, lines: [line], startLine: 0, endLine: 0 })
      currentHunk = null
    }
  }
  if (currentHunk) hunks.push(currentHunk)
  return hunks
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
  const commitInputRef = useRef<HTMLTextAreaElement>(null)
  const [focusCommitTick, setFocusCommitTick] = useState(0)
  const [branch, setBranch] = useState<string>('')
  // A detached HEAD has no branch: commits made there are easy to lose.
  const [detached, setDetached] = useState(false)
  const [head, setHead] = useState('')
  const [stagedFiles, setStagedFiles] = useState<GitFile[]>([])
  const [unstagedFiles, setUnstagedFiles] = useState<GitFile[]>([])
  const [stagedExpanded, setStagedExpanded] = useState(true)
  const [changesExpanded, setChangesExpanded] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [ahead, setAhead] = useState(0)
  const [behind, setBehind] = useState(0)
  const [selectedDiff, setSelectedDiff] = useState<{ path: string; diff: string } | null>(null)
  const [isDiffLoading, setIsDiffLoading] = useState(false)

  // Branch management state
  const [showCreateBranch, setShowCreateBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [showBranchPicker, setShowBranchPicker] = useState(false)
  const branchPickerRef = useRef<HTMLDivElement>(null)

  // History tab state
  const [activeTab, setActiveTab] = useState<ActiveTab>('changes')
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([])
  const [isLoadingLog, setIsLoadingLog] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)

  // Stash management state
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [stashExpanded, setStashExpanded] = useState(false)
  const [stashMessage, setStashMessage] = useState('')
  const [showStashInput, setShowStashInput] = useState(false)
  // Stash indices shift after a pop or drop, so no second stash action may
  // start (e.g. from a double click) until the list is refreshed.
  const [stashBusy, setStashBusy] = useState(false)

  // Merge conflict state
  const [isMerging, setIsMerging] = useState(false)
  const [conflictFiles, setConflictFiles] = useState<string[]>([])

  // Conventional commits & templates state
  const [showCommitTypes, setShowCommitTypes] = useState(false)
  const [savedTemplates, setSavedTemplates] = useState<CommitTemplate[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const commitTypesRef = useRef<HTMLDivElement>(null)
  const templatesRef = useRef<HTMLDivElement>(null)

  // Interactive staging state
  const [selectedFileChecks, setSelectedFileChecks] = useState<Set<string>>(new Set())
  const [inlineDiffs, setInlineDiffs] = useState<Record<string, string>>({})
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  const [loadingInlineDiffs, setLoadingInlineDiffs] = useState<Set<string>>(new Set())

  // Branch management enhancements
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [showMergePicker, setShowMergePicker] = useState(false)
  const [isRebasing, setIsRebasing] = useState(false)
  const mergePickerRef = useRef<HTMLDivElement>(null)

  // Git graph enhancements
  const [tags, setTags] = useState<GitTag[]>([])

  const rootPath = useFileStore((s) => s.rootPath)
  const addToast = useToastStore((s) => s.addToast)
  const appendOutput = useOutputStore((s) => s.appendOutput)
  const pendingRequest = useScmStore((s) => s.pendingRequest)
  const scmRevision = useScmStore((s) => s.revision)

  const refreshStatus = useCallback(async () => {
    if (!rootPath) return
    setIsRefreshing(true)
    try {
      const status = await window.api.gitStatus(rootPath)
      if (status) {
        setStagedFiles(status.staged || [])
        setUnstagedFiles(status.unstaged || [])
        // A row that left its list (staged, committed, discarded) must not come
        // back expanded with the diff it had then.
        const listed = new Set([
          ...(status.staged || []).map((f) => inlineDiffKey(f.path, true)),
          ...(status.unstaged || []).map((f) => inlineDiffKey(f.path, false)),
        ])
        setExpandedFiles((prev) => {
          const kept = [...prev].filter((key) => listed.has(key))
          return kept.length === prev.size ? prev : new Set(kept)
        })
        if (status.branch) setBranch(status.branch)
        setDetached(status.detached === true)
        setHead(status.head || '')
        if (status.ahead !== undefined) setAhead(status.ahead)
        if (status.behind !== undefined) setBehind(status.behind)
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

  const refreshStashes = useCallback(async () => {
    if (!rootPath) return
    try {
      const list = await window.api.gitStashList(rootPath)
      setStashes(list || [])
    } catch {
      setStashes([])
    }
  }, [rootPath])

  const refreshMergeStatus = useCallback(async () => {
    if (!rootPath) return
    try {
      const status = await window.api.gitMergeStatus(rootPath)
      setIsMerging(status?.merging || false)
      if (status?.merging) {
        const files = await window.api.gitConflictFiles(rootPath)
        setConflictFiles(files || [])
      } else {
        setConflictFiles([])
      }
    } catch {
      setIsMerging(false)
      setConflictFiles([])
    }
  }, [rootPath])

  const fetchLog = useCallback(async () => {
    if (!rootPath) return
    setIsLoadingLog(true)
    try {
      const entries = await window.api.gitLog(rootPath, 50)
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
    refreshStashes()
    refreshMergeStatus()
    const interval = setInterval(() => {
      refreshStatus()
      refreshStashes()
      refreshMergeStatus()
    }, 5000)
    return () => clearInterval(interval)
  }, [refreshStatus, refreshStashes, refreshMergeStatus])

  // Fetch log when History tab is activated
  useEffect(() => {
    if (activeTab === 'history') {
      fetchLog()
    }
  }, [activeTab, fetchLog])

  // Requests from the command palette (useGitCommands). They wait in the store
  // because the palette opens this panel in the same tick it asks for them.
  useEffect(() => {
    if (!pendingRequest) return
    useScmStore.getState().clearRequest()
    if (pendingRequest === 'history') {
      setActiveTab('history')
    } else {
      setActiveTab('changes')
      setFocusCommitTick((t) => t + 1)
    }
  }, [pendingRequest])

  // Runs after the render that shows the Changes tab, so the box exists.
  useEffect(() => {
    if (focusCommitTick > 0) commitInputRef.current?.focus()
  }, [focusCommitTick])

  // A palette command changed the repository: show it now, not at the next poll.
  useEffect(() => {
    if (scmRevision === 0) return
    refreshStatus()
    refreshStashes()
  }, [scmRevision, refreshStatus, refreshStashes])

  // Click outside handler for branch picker
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (branchPickerRef.current && !branchPickerRef.current.contains(e.target as Node)) {
        setShowBranchPicker(false)
      }
    }
    if (showBranchPicker) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showBranchPicker])

  const handleCommit = async () => {
    if (!commitMessage.trim() || !rootPath) return
    if (
      detached &&
      !window.confirm(
        `HEAD is detached at ${head}. This commit will not be on any branch, and switching branches later can lose it. Commit anyway?`,
      )
    ) {
      return
    }
    appendOutput('Git', `[commit] Committing: "${commitMessage.trim()}"`, 'info')
    try {
      await window.api.gitCommit(rootPath, commitMessage.trim())
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
      await window.api.gitStage(rootPath, filePath)
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
      await window.api.gitUnstage(rootPath, filePath)
      appendOutput('Git', `[unstage] Unstaged: ${filePath}`, 'info')
      refreshStatus()
    } catch (err: any) {
      appendOutput('Git', `[unstage] Failed to unstage ${filePath}: ${err?.message}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Failed to unstage file' })
    }
  }

  const handleDiscard = async (file: GitFile) => {
    if (!rootPath) return
    const filePath = file.path
    // Discarding cannot be undone, and for an untracked row (which may be a
    // whole new folder) it deletes from disk.
    const question = file.state === 'untracked'
      ? `Permanently delete the untracked ${filePath.endsWith('/') ? 'folder' : 'file'} ${filePath}? This cannot be undone.`
      : `Discard your changes to ${filePath}? This cannot be undone.`
    if (!window.confirm(question)) return
    try {
      await window.api.gitDiscard(rootPath, filePath)
      appendOutput('Git', `[discard] Discarded changes: ${filePath}`, 'warn')
      addToast({ type: 'info', message: `Discarded changes in ${filePath.split('/').pop()}` })
      refreshStatus()
    } catch (err) {
      appendOutput('Git', `[discard] Failed to discard ${filePath}: ${ipcErrorMessage(err)}`, 'error')
      addToast({ type: 'error', message: ipcErrorMessage(err) || 'Failed to discard changes' })
    }
  }

  const handleFileClick = async (filePath: string) => {
    if (!rootPath) return
    setIsDiffLoading(true)
    try {
      const diff = await window.api.gitDiff(rootPath, filePath)
      setSelectedDiff({ path: filePath, diff: diff || 'No changes detected' })
    } catch {
      setSelectedDiff({ path: filePath, diff: 'Failed to load diff' })
    } finally {
      setIsDiffLoading(false)
    }
  }

  const handleCommitClick = async (fullHash: string, shortHash: string) => {
    if (!rootPath) return
    if (selectedCommit === shortHash) {
      setSelectedCommit(null)
      setCommitDetail(null)
      return
    }
    setSelectedCommit(shortHash)
    setIsLoadingDetail(true)
    try {
      const detail = await window.api.gitShow(rootPath, fullHash)
      setCommitDetail(detail || null)
    } catch {
      setCommitDetail(null)
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

  const handlePush = async () => {
    if (!rootPath) return
    appendOutput('Git', '[push] Pushing to remote...', 'info')
    try {
      const summary = await pushCurrentBranch(rootPath)
      appendOutput('Git', `[push] ${summary}`, 'success')
      addToast({ type: 'success', message: summary })
      refreshStatus()
    } catch (err) {
      appendOutput('Git', `[push] Failed: ${ipcErrorMessage(err)}`, 'error')
      addToast({ type: 'error', message: ipcErrorMessage(err) || 'Push failed' })
    }
  }

  const handlePull = async () => {
    if (!rootPath) return
    appendOutput('Git', '[pull] Pulling from remote...', 'info')
    try {
      const summary = await pullCurrentBranch(rootPath)
      appendOutput('Git', `[pull] ${summary}`, 'success')
      addToast({ type: 'success', message: summary })
      refreshStatus()
    } catch (err) {
      appendOutput('Git', `[pull] Failed: ${ipcErrorMessage(err)}`, 'error')
      addToast({ type: 'error', message: ipcErrorMessage(err) || 'Pull failed' })
    }
  }

  const handleFetch = async () => {
    if (!rootPath) return
    appendOutput('Git', '[fetch] Fetching from all remotes...', 'info')
    try {
      await window.api.gitFetch(rootPath)
      appendOutput('Git', '[fetch] Fetch successful', 'success')
      addToast({ type: 'success', message: 'Fetched from remote' })
      refreshStatus()
    } catch (err: any) {
      appendOutput('Git', `[fetch] Failed: ${err?.message || 'Unknown error'}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Fetch failed' })
    }
  }

  const fetchBranches = async () => {
    if (!rootPath) return
    try {
      const result = await window.api.gitBranches(rootPath)
      setBranches(result || [])
    } catch {
      setBranches([])
    }
  }

  const handleCreateBranch = async () => {
    if (!rootPath || !newBranchName.trim()) return
    try {
      await window.api.gitCreateBranch(rootPath, newBranchName.trim())
      addToast({ type: 'success', message: `Created and switched to branch: ${newBranchName.trim()}` })
      appendOutput('Git', `[branch] Created: ${newBranchName.trim()}`, 'success')
      setNewBranchName('')
      setShowCreateBranch(false)
      refreshStatus()
    } catch (err: any) {
      addToast({ type: 'error', message: err?.message || 'Failed to create branch' })
    }
  }

  const handleSwitchBranch = async ({ branch: branchName, track }: CheckoutTarget) => {
    if (!rootPath) return
    if (
      detached &&
      !window.confirm(
        `HEAD is detached at ${head}. Commits made here that are not on a branch become hard to find once you switch. Switch to ${branchName} anyway?`,
      )
    ) {
      return
    }
    try {
      await window.api.gitCheckout(rootPath, branchName, track)
      const done = track ? `Created branch ${branchName} tracking ${track}` : `Switched to branch: ${branchName}`
      addToast({ type: 'success', message: done })
      appendOutput('Git', `[checkout] ${done}`, 'info')
      setShowBranchPicker(false)
      refreshStatus()
    } catch (err) {
      addToast({ type: 'error', message: ipcErrorMessage(err) || 'Failed to switch branch' })
    }
  }

  const handleStageAll = async () => {
    if (!rootPath) return
    try {
      await window.api.gitStageAll(rootPath)
      appendOutput('Git', '[stage] Staged all changes', 'info')
      refreshStatus()
    } catch (err: any) {
      addToast({ type: 'error', message: err?.message || 'Failed to stage all' })
    }
  }

  const handleUnstageAll = async () => {
    if (!rootPath) return
    try {
      await window.api.gitUnstageAll(rootPath)
      appendOutput('Git', '[unstage] Unstaged all changes', 'info')
      refreshStatus()
    } catch (err: any) {
      addToast({ type: 'error', message: err?.message || 'Failed to unstage all' })
    }
  }

  const handleStashSave = async () => {
    if (!rootPath) return
    const msg = stashMessage.trim()
    try {
      if (!(await stashChanges(rootPath, msg || undefined))) {
        addToast({ type: 'info', message: 'No local changes to stash' })
        return
      }
      appendOutput('Git', msg ? `[stash] Stashed with message: "${msg}"` : '[stash] Stashed changes', 'info')
      addToast({ type: 'success', message: 'Changes stashed' })
      setStashMessage('')
      setShowStashInput(false)
      refreshStatus()
      refreshStashes()
    } catch (err: any) {
      appendOutput('Git', `[stash] Failed: ${err?.message || 'Unknown error'}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Stash failed' })
    }
  }

  /** Run one stash action at a time, until the list shows the new indices. */
  const runStashAction = async (action: () => Promise<void>) => {
    if (stashBusy) return
    setStashBusy(true)
    try {
      await action()
      await refreshStashes()
    } finally {
      setStashBusy(false)
    }
  }

  const handleStashApply = (index: number) => runStashAction(async () => {
    if (!rootPath) return
    try {
      await window.api.gitStashApply(rootPath, index)
      appendOutput('Git', `[stash] Applied stash@{${index}}`, 'info')
      addToast({ type: 'success', message: `Applied stash@{${index}}` })
      refreshStatus()
      refreshMergeStatus()
    } catch (err: any) {
      appendOutput('Git', `[stash] Apply failed: ${err?.message || 'Unknown error'}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Stash apply failed' })
    }
  })

  const handleStashPop = (index: number) => runStashAction(async () => {
    if (!rootPath) return
    try {
      // Pop can be done by applying and dropping in one command.
      await window.api.gitStashApply(rootPath, index, { drop: true })
      appendOutput('Git', `[stash] Popped stash@{${index}}`, 'info')
      addToast({ type: 'success', message: `Popped stash@{${index}}` })
      refreshStatus()
      refreshMergeStatus()
    } catch (err: any) {
      appendOutput('Git', `[stash] Pop failed: ${err?.message || 'Unknown error'}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Stash pop failed' })
    }
  })

  const handleStashDrop = (stash: StashEntry) => runStashAction(async () => {
    if (!rootPath) return
    const { index } = stash
    if (!window.confirm(`Drop stash@{${index}} "${stash.message}"? Its changes are deleted and cannot be restored.`)) return
    try {
      await window.api.gitStashDrop(rootPath, index)
      appendOutput('Git', `[stash] Dropped stash@{${index}}`, 'warn')
      addToast({ type: 'info', message: `Dropped stash@{${index}}` })
    } catch (err) {
      appendOutput('Git', `[stash] Drop failed: ${ipcErrorMessage(err)}`, 'error')
      addToast({ type: 'error', message: ipcErrorMessage(err) || 'Stash drop failed' })
    }
  })

  const handleMergeAbort = async () => {
    if (!rootPath) return
    try {
      await window.api.gitMergeAbort(rootPath)
      appendOutput('Git', '[merge] Merge aborted', 'warn')
      addToast({ type: 'info', message: 'Merge aborted' })
      refreshStatus()
      refreshMergeStatus()
    } catch (err: any) {
      appendOutput('Git', `[merge] Abort failed: ${err?.message || 'Unknown error'}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Merge abort failed' })
    }
  }

  const handleConflictFileClick = (filePath: string) => {
    if (!rootPath) return
    // Read it from disk: an empty tab at this path would be saved over the
    // conflicted file.
    void openFileInEditor(rootPath + '/' + filePath)
  }

  // Load saved templates from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('orion-commit-templates')
      if (saved) setSavedTemplates(JSON.parse(saved))
    } catch { /* ignore */ }
  }, [])

  // Save templates to localStorage when they change
  const persistTemplates = useCallback((templates: CommitTemplate[]) => {
    setSavedTemplates(templates)
    try { localStorage.setItem('orion-commit-templates', JSON.stringify(templates)) } catch { /* ignore */ }
  }, [])

  const handleSaveTemplate = () => {
    if (!templateName.trim() || !commitMessage.trim()) return
    const newTemplate: CommitTemplate = {
      id: Date.now().toString(),
      name: templateName.trim(),
      template: commitMessage.trim(),
    }
    persistTemplates([...savedTemplates, newTemplate])
    setTemplateName('')
    setShowSaveTemplate(false)
    addToast({ type: 'success', message: `Template "${newTemplate.name}" saved` })
  }

  const handleDeleteTemplate = (id: string) => {
    persistTemplates(savedTemplates.filter(t => t.id !== id))
  }

  const handleApplyTemplate = (template: string) => {
    setCommitMessage(template)
    setShowTemplates(false)
  }

  const handleConventionalCommitType = (type: string) => {
    const current = commitMessage.trim()
    // Check if already has a conventional type prefix
    const prefixMatch = current.match(/^(feat|fix|refactor|docs|test|chore|style|perf|ci):\s*/)
    if (prefixMatch) {
      setCommitMessage(`${type}: ${current.slice(prefixMatch[0].length)}`)
    } else {
      setCommitMessage(`${type}: ${current}`)
    }
    setShowCommitTypes(false)
  }

  // Click outside for commit types dropdown
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (commitTypesRef.current && !commitTypesRef.current.contains(e.target as Node)) setShowCommitTypes(false)
      if (templatesRef.current && !templatesRef.current.contains(e.target as Node)) setShowTemplates(false)
      if (mergePickerRef.current && !mergePickerRef.current.contains(e.target as Node)) setShowMergePicker(false)
    }
    if (showCommitTypes || showTemplates || showMergePicker) {
      document.addEventListener('mousedown', handleClick)
    }
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showCommitTypes, showTemplates, showMergePicker])

  // Interactive staging: toggle file checkbox
  const toggleFileCheck = (path: string) => {
    setSelectedFileChecks(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // Stage all checked files
  const handleStageChecked = async () => {
    if (!rootPath || selectedFileChecks.size === 0) return
    const filesToStage = Array.from(selectedFileChecks)
    for (const filePath of filesToStage) {
      try {
        await window.api.gitStage(rootPath, filePath)
        appendOutput('Git', `[stage] Staged: ${filePath}`, 'info')
      } catch (err: any) {
        appendOutput('Git', `[stage] Failed: ${filePath}: ${err?.message}`, 'error')
      }
    }
    setSelectedFileChecks(new Set())
    refreshStatus()
  }

  // Inline diff toggle for a file. A file can be both staged and changed, so
  // each list keeps its own diff (index vs HEAD, or worktree vs index). It is
  // fetched on every expand: the file may have changed since the last one.
  const toggleInlineDiff = async (filePath: string, isStaged: boolean) => {
    const key = inlineDiffKey(filePath, isStaged)
    if (expandedFiles.has(key)) {
      setExpandedFiles(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      return
    }
    if (!rootPath) return
    setLoadingInlineDiffs(prev => new Set(prev).add(key))
    try {
      const diff = await window.api.gitDiff(rootPath, filePath, isStaged)
      setInlineDiffs(prev => ({ ...prev, [key]: diff || 'No changes detected' }))
      setExpandedFiles(prev => new Set(prev).add(key))
    } catch {
      setInlineDiffs(prev => ({ ...prev, [key]: 'Failed to load diff' }))
      setExpandedFiles(prev => new Set(prev).add(key))
    } finally {
      setLoadingInlineDiffs(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  // Branch management: delete branch
  const handleDeleteBranch = async (branchName: string) => {
    if (!rootPath) return
    try {
      await window.api.gitDeleteBranch(rootPath, branchName)
      addToast({ type: 'success', message: `Deleted branch: ${branchName}` })
      appendOutput('Git', `[branch] Deleted: ${branchName}`, 'warn')
      setShowDeleteConfirm(null)
      fetchBranches()
      refreshStatus()
    } catch (err: any) {
      addToast({ type: 'error', message: err?.message || 'Failed to delete branch' })
    }
  }

  // Branch management: merge
  const handleMergeBranch = async (branchName: string) => {
    if (!rootPath) return
    try {
      await window.api.gitMerge(rootPath, branchName)
      addToast({ type: 'success', message: `Merged branch: ${branchName}` })
      appendOutput('Git', `[merge] Merged: ${branchName} into ${branch}`, 'success')
      setShowMergePicker(false)
      refreshStatus()
      refreshMergeStatus()
    } catch (err: any) {
      appendOutput('Git', `[merge] Failed: ${err?.message || 'Unknown error'}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Merge failed' })
      refreshMergeStatus()
    }
  }

  // Fetch rebase status
  const refreshRebaseStatus = useCallback(async () => {
    if (!rootPath) return
    try {
      const status = await window.api.gitRebaseStatus?.(rootPath)
      setIsRebasing(status?.rebasing || false)
    } catch {
      setIsRebasing(false)
    }
  }, [rootPath])

  // Fetch tags
  const fetchTags = useCallback(async () => {
    if (!rootPath) return
    try {
      const result = await window.api.gitTags?.(rootPath)
      setTags(result || [])
    } catch {
      setTags([])
    }
  }, [rootPath])

  // Cherry-pick a commit
  const handleCherryPick = async (hash: string) => {
    if (!rootPath) return
    try {
      await window.api.gitCherryPick(rootPath, hash)
      addToast({ type: 'success', message: `Cherry-picked commit ${hash.substring(0, 7)}` })
      appendOutput('Git', `[cherry-pick] Applied: ${hash.substring(0, 7)}`, 'success')
      refreshStatus()
      fetchLog()
    } catch (err: any) {
      appendOutput('Git', `[cherry-pick] Failed: ${err?.message || 'Unknown error'}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Cherry-pick failed' })
    }
  }

  // Add rebase/tags to refresh cycle
  useEffect(() => {
    refreshRebaseStatus()
    fetchTags()
  }, [refreshRebaseStatus, fetchTags])

  // Fetch tags when history tab activates
  useEffect(() => {
    if (activeTab === 'history') {
      fetchTags()
    }
  }, [activeTab, fetchTags])

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
    const diffKey = inlineDiffKey(file.path, isStaged)
    const isExpanded = expandedFiles.has(diffKey)
    const isLoadingDiff = loadingInlineDiffs.has(diffKey)
    const isChecked = selectedFileChecks.has(file.path)
    const fileKey = `${isStaged ? 'staged' : 'unstaged'}-${file.path}`

    return (
      <div key={fileKey}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 26,
            paddingLeft: 8,
            paddingRight: 8,
            fontSize: 12,
            cursor: 'pointer',
            userSelect: 'none',
          }}
          className="source-control-file-item"
          onClick={() => toggleInlineDiff(file.path, isStaged)}
        >
          {/* Checkbox for multi-select staging */}
          {!isStaged && (
            <div
              onClick={(e) => { e.stopPropagation(); toggleFileCheck(file.path) }}
              style={{
                width: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 4,
                flexShrink: 0,
                cursor: 'pointer',
                color: isChecked ? 'var(--accent-blue, #388bfd)' : 'var(--text-disabled, #545d68)',
              }}
              title="Select for batch staging"
            >
              {isChecked ? <CheckSquare size={13} /> : <Square size={13} />}
            </div>
          )}
          {isStaged && <div style={{ width: 20, flexShrink: 0 }} />}

          {/* Expand/collapse indicator */}
          <div style={{ width: 14, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            {isLoadingDiff ? (
              <RotateCw size={10} style={{ animation: 'spin 1s linear infinite', opacity: 0.5 }} />
            ) : isExpanded ? (
              <ChevronDown size={12} style={{ opacity: 0.5 }} />
            ) : (
              <ChevronRight size={12} style={{ opacity: 0.5 }} />
            )}
          </div>

          {/* Status dot */}
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: color,
              marginRight: 6,
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
                  onClick={() => handleDiscard(file)}
                  title={file.state === 'untracked' ? 'Delete Untracked' : 'Discard Changes'}
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

        {/* Inline diff expansion */}
        {isExpanded && inlineDiffs[diffKey] && (
          <div
            style={{
              marginLeft: 20,
              marginRight: 8,
              marginBottom: 4,
              borderRadius: 4,
              border: '1px solid var(--border, #3d444d)',
              overflow: 'hidden',
              background: 'var(--bg-primary)',
            }}
          >
            {(() => {
              const hunks = parseDiffIntoHunks(inlineDiffs[diffKey])
              if (hunks.length === 0) {
                return (
                  <div style={{
                    padding: '6px 10px',
                    fontSize: 11,
                    color: 'var(--text-disabled, #545d68)',
                    fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
                  }}>
                    {inlineDiffs[diffKey]}
                  </div>
                )
              }
              return hunks.map((hunk, hunkIdx) => (
                <div key={hunkIdx}>
                  {/* Hunk header. No per-hunk staging: no IPC applies a partial patch. */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '2px 8px',
                      background: 'rgba(130, 100, 210, 0.08)',
                      borderBottom: '1px solid var(--border, #3d444d)',
                      fontSize: 11,
                      fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
                      color: '#b392f0',
                      gap: 6,
                    }}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {hunk.header}
                    </span>
                  </div>
                  {/* Hunk lines */}
                  {hunk.lines.slice(1).map((line, lineIdx) => {
                    const lineStyle = getDiffLineStyle(line)
                    return (
                      <div
                        key={lineIdx}
                        style={{
                          display: 'flex',
                          minHeight: 18,
                          fontSize: 11,
                          fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
                          lineHeight: 1.5,
                          ...lineStyle,
                        }}
                      >
                        <span
                          style={{
                            width: 32,
                            flexShrink: 0,
                            textAlign: 'right',
                            paddingRight: 6,
                            color: 'var(--text-disabled, #545d68)',
                            userSelect: 'none',
                            opacity: 0.5,
                            borderRight: '1px solid var(--border)',
                            fontSize: 10,
                          }}
                        >
                          {lineIdx + 1}
                        </span>
                        <pre
                          style={{
                            margin: 0,
                            paddingLeft: 6,
                            paddingRight: 6,
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
                  })}
                </div>
              ))
            })()}
          </div>
        )}
      </div>
    )
  }

  // Generate a consistent color from a string (for author avatars)
  const avatarColor = (name: string): string => {
    const colors = ['#f85149', '#3fb950', '#388bfd', '#d29922', '#d2a8ff', '#f78166', '#a5d6ff', '#7ee787', '#ff7b72', '#79c0ff']
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
  }

  // Format ISO date string to relative time
  const formatRelativeDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffSecs = Math.floor(diffMs / 1000)
      const diffMins = Math.floor(diffSecs / 60)
      const diffHours = Math.floor(diffMins / 60)
      const diffDays = Math.floor(diffHours / 24)
      const diffWeeks = Math.floor(diffDays / 7)
      const diffMonths = Math.floor(diffDays / 30)
      const diffYears = Math.floor(diffDays / 365)

      if (diffSecs < 60) return 'just now'
      if (diffMins < 60) return `${diffMins} min ago`
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
      if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
      if (diffWeeks < 5) return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`
      if (diffMonths < 12) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`
      return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`
    } catch {
      return dateStr
    }
  }

  const renderChangesTab = () => (
    <>
      {/* Merge conflict banner */}
      {isMerging && (
        <div
          style={{
            padding: '8px 12px',
            background: 'rgba(210, 153, 34, 0.12)',
            borderBottom: '1px solid rgba(210, 153, 34, 0.3)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <AlertTriangle size={14} style={{ color: '#d29922', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#d29922' }}>
              Merge in progress {conflictFiles.length > 0 ? `\u2014 ${conflictFiles.length} conflict${conflictFiles.length !== 1 ? 's' : ''} to resolve` : ''}
            </span>
          </div>

          {/* Conflicted files list */}
          {conflictFiles.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {conflictFiles.map((file) => (
                <div
                  key={file}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '3px 0',
                    fontSize: 12,
                    gap: 6,
                  }}
                >
                  <AlertTriangle size={12} style={{ color: '#d29922', flexShrink: 0 }} />
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      color: 'var(--text-primary)',
                    }}
                    title={file}
                    onClick={() => handleConflictFileClick(file)}
                    className="source-control-file-item"
                  >
                    {fileName(file)}
                    {dirName(file) && (
                      <span style={{ opacity: 0.5, marginLeft: 4 }}>{dirName(file)}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Abort merge button */}
          <button
            onClick={handleMergeAbort}
            style={{
              width: '100%',
              padding: '4px 8px',
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(248, 81, 73, 0.15)',
              border: '1px solid rgba(248, 81, 73, 0.3)',
              borderRadius: 4,
              color: '#f85149',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
            className="source-control-action-btn"
          >
            <XCircle size={12} />
            Abort Merge
          </button>
        </div>
      )}

      {/* Commit section */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        {/* Conventional commits & templates toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, position: 'relative' }}>
          {/* Conventional commit type dropdown */}
          <div ref={commitTypesRef} style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowCommitTypes(!showCommitTypes); setShowTemplates(false) }}
              title="Conventional commit type"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                padding: '3px 8px',
                fontSize: 10,
                fontWeight: 600,
                background: 'var(--bg-tertiary, #2d333b)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              className="source-control-action-btn"
            >
              <List size={11} />
              Type
              <ChevronDown size={9} />
            </button>
            {showCommitTypes && (
              <div style={{
                position: 'absolute',
                left: 0,
                top: '100%',
                marginTop: 2,
                width: 200,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                zIndex: 60,
                padding: 4,
              }}>
                {CONVENTIONAL_COMMIT_TYPES.map(ct => (
                  <div
                    key={ct.type}
                    onClick={() => handleConventionalCommitType(ct.type)}
                    className="source-control-file-item"
                    style={{
                      padding: '4px 8px',
                      fontSize: 11,
                      cursor: 'pointer',
                      borderRadius: 3,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span style={{
                      fontWeight: 700,
                      color: ct.color,
                      fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
                      fontSize: 10,
                      minWidth: 55,
                    }}>
                      {ct.label}
                    </span>
                    <span style={{ color: 'var(--text-disabled, #545d68)', fontSize: 10 }}>
                      {ct.description}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Templates dropdown */}
          <div ref={templatesRef} style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowTemplates(!showTemplates); setShowCommitTypes(false) }}
              title="Saved commit templates"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                padding: '3px 8px',
                fontSize: 10,
                fontWeight: 600,
                background: 'var(--bg-tertiary, #2d333b)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              className="source-control-action-btn"
            >
              <Bookmark size={11} />
              Templates
              {savedTemplates.length > 0 && (
                <span style={{
                  background: 'var(--accent-blue, #388bfd)',
                  color: '#fff',
                  borderRadius: 6,
                  padding: '0 4px',
                  fontSize: 9,
                  lineHeight: '14px',
                  fontWeight: 700,
                }}>
                  {savedTemplates.length}
                </span>
              )}
            </button>
            {showTemplates && (
              <div style={{
                position: 'absolute',
                left: 0,
                top: '100%',
                marginTop: 2,
                width: 240,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                zIndex: 60,
                padding: 4,
              }}>
                {savedTemplates.length === 0 ? (
                  <div style={{ padding: '8px', fontSize: 11, color: 'var(--text-disabled, #545d68)', textAlign: 'center' }}>
                    No saved templates
                  </div>
                ) : (
                  savedTemplates.map(t => (
                    <div
                      key={t.id}
                      className="source-control-file-item"
                      style={{
                        padding: '4px 8px',
                        fontSize: 11,
                        cursor: 'pointer',
                        borderRadius: 3,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span
                        style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        onClick={() => handleApplyTemplate(t.template)}
                        title={t.template}
                      >
                        <span style={{ fontWeight: 600 }}>{t.name}</span>
                        <span style={{ opacity: 0.5, marginLeft: 4, fontSize: 10 }}>{t.template.substring(0, 30)}</span>
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t.id) }}
                        title="Delete template"
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 2,
                          color: 'var(--text-disabled, #545d68)',
                          display: 'flex',
                          alignItems: 'center',
                          flexShrink: 0,
                        }}
                        className="source-control-action-btn"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))
                )}
                <div style={{ borderTop: '1px solid var(--border)', marginTop: 2, paddingTop: 2 }}>
                  {!showSaveTemplate ? (
                    <div
                      onClick={() => { if (commitMessage.trim()) setShowSaveTemplate(true); else addToast({ type: 'info', message: 'Write a commit message first' }) }}
                      className="source-control-file-item"
                      style={{
                        padding: '4px 8px',
                        fontSize: 11,
                        cursor: 'pointer',
                        borderRadius: 3,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        color: 'var(--accent-blue, #388bfd)',
                      }}
                    >
                      <BookmarkPlus size={12} />
                      Save current as template
                    </div>
                  ) : (
                    <div style={{ padding: '4px', display: 'flex', gap: 4 }}>
                      <input
                        autoFocus
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveTemplate()
                          if (e.key === 'Escape') { setShowSaveTemplate(false); setTemplateName('') }
                        }}
                        placeholder="Template name..."
                        style={{
                          flex: 1,
                          padding: '3px 6px',
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border)',
                          borderRadius: 3,
                          color: 'var(--text-primary)',
                          fontSize: 10,
                          outline: 'none',
                        }}
                      />
                      <button
                        onClick={handleSaveTemplate}
                        style={{
                          padding: '3px 6px',
                          fontSize: 10,
                          fontWeight: 600,
                          background: 'var(--accent-blue, #388bfd)',
                          border: 'none',
                          borderRadius: 3,
                          color: '#fff',
                          cursor: 'pointer',
                        }}
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <span style={{ flex: 1 }} />
        </div>

        <div style={{ position: 'relative' }}>
          <textarea
            ref={commitInputRef}
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
              <span style={{ flex: 1 }} />
              <button
                onClick={(e) => { e.stopPropagation(); handleUnstageAll() }}
                title="Unstage All"
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
                  marginRight: 4,
                }}
                className="source-control-action-btn"
              >
                <Minus size={14} />
              </button>
              <span
                style={{
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
            <span style={{ flex: 1 }} />
            {/* Stage checked button */}
            {selectedFileChecks.size > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); handleStageChecked() }}
                title={`Stage ${selectedFileChecks.size} selected`}
                style={{
                  background: 'rgba(63, 185, 80, 0.15)',
                  border: '1px solid rgba(63, 185, 80, 0.3)',
                  cursor: 'pointer',
                  padding: '1px 6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 3,
                  color: '#3fb950',
                  marginRight: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  gap: 3,
                }}
                className="source-control-action-btn"
              >
                <CheckSquare size={11} />
                Stage {selectedFileChecks.size}
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); handleStageAll() }}
              title="Stage All"
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
                marginRight: 4,
              }}
              className="source-control-action-btn"
            >
              <Plus size={14} />
            </button>
            <span
              style={{
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

        {/* Stashes Section */}
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
            onClick={() => { setStashExpanded(!stashExpanded); if (!stashExpanded) refreshStashes() }}
          >
            {stashExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span style={{ marginLeft: 4 }}>Stashes</span>
            <span style={{ flex: 1 }} />
            <button
              onClick={(e) => { e.stopPropagation(); setShowStashInput(!showStashInput) }}
              title="Stash All Changes"
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
                marginRight: 4,
              }}
              className="source-control-action-btn"
            >
              <Archive size={14} />
            </button>
            {stashes.length > 0 && (
              <span
                style={{
                  fontSize: 10,
                  background: 'var(--bg-tertiary, #2d333b)',
                  borderRadius: 10,
                  padding: '0 6px',
                  lineHeight: '16px',
                }}
              >
                {stashes.length}
              </span>
            )}
          </div>

          {/* Stash message input */}
          {showStashInput && (
            <div style={{ padding: '4px 12px 4px 24px', display: 'flex', gap: 4 }}>
              <input
                autoFocus
                value={stashMessage}
                onChange={(e) => setStashMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleStashSave()
                  if (e.key === 'Escape') { setShowStashInput(false); setStashMessage('') }
                }}
                placeholder="Stash message (optional)..."
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                  fontSize: 11,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                onClick={handleStashSave}
                title="Stash"
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'var(--bg-tertiary, #2d333b)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
                className="source-control-action-btn"
              >
                Stash
              </button>
            </div>
          )}

          {/* Stash entries */}
          {stashExpanded && stashes.map((stash) => (
            <div
              key={stash.index}
              style={{
                display: 'flex',
                alignItems: 'center',
                height: 26,
                paddingLeft: 24,
                paddingRight: 8,
                fontSize: 12,
                cursor: 'default',
                userSelect: 'none',
              }}
              className="source-control-file-item"
            >
              <Package size={13} style={{ marginRight: 6, flexShrink: 0, opacity: 0.5, color: '#d2a8ff' }} />
              <span
                style={{
                  fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
                  fontSize: 10,
                  color: '#d2a8ff',
                  marginRight: 6,
                  flexShrink: 0,
                  opacity: 0.7,
                }}
              >
                {'{'}{ stash.index }{'}'}
              </span>
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={stash.message}
              >
                {stash.message}
              </span>

              {/* Stash action buttons */}
              <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => handleStashApply(stash.index)}
                  disabled={stashBusy}
                  title="Apply (keep stash)"
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
                  <Play size={12} />
                </button>
                <button
                  onClick={() => handleStashPop(stash.index)}
                  disabled={stashBusy}
                  title="Pop (apply & remove)"
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
                  <ArrowUp size={12} />
                </button>
                <button
                  onClick={() => handleStashDrop(stash)}
                  disabled={stashBusy}
                  title="Drop (delete stash)"
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
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}

          {stashExpanded && stashes.length === 0 && (
            <div
              style={{
                padding: '8px 24px',
                fontSize: 11,
                color: 'var(--text-disabled, #545d68)',
              }}
            >
              No stashes
            </div>
          )}
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
            const color = avatarColor(entry.author)
            const initial = (entry.author || '?')[0].toUpperCase()
            return (
              <div
                key={entry.fullHash || entry.hash + idx}
                className="source-control-commit-item"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  padding: '0 12px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  background: isSelected ? 'var(--bg-hover, rgba(255,255,255,0.05))' : 'transparent',
                }}
                onClick={() => handleCommitClick(entry.fullHash || entry.hash, entry.hash)}
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
                      background: isSelected ? 'var(--accent-blue, #388bfd)' : color,
                      border: `2px solid ${isSelected ? 'var(--accent-blue, #388bfd)' : 'rgba(255,255,255,0.1)'}`,
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
                  {/* Hash pill + Tags + Branch labels + Message row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      marginBottom: 3,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
                        fontSize: 10,
                        color: '#d2a8ff',
                        fontWeight: 600,
                        flexShrink: 0,
                        letterSpacing: '0.3px',
                        background: 'rgba(210, 168, 255, 0.1)',
                        padding: '1px 6px',
                        borderRadius: 8,
                        border: '1px solid rgba(210, 168, 255, 0.15)',
                      }}
                    >
                      {entry.hash}
                    </span>
                    {/* Tags on this commit */}
                    {tags.filter(t => {
                      const targetHash = t.targetHash || t.hash
                      return targetHash.startsWith(entry.hash) || (entry.fullHash && targetHash.startsWith(entry.fullHash.substring(0, 7)))
                    }).map(t => (
                      <span
                        key={t.name}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          fontSize: 9,
                          fontWeight: 700,
                          color: '#d29922',
                          background: 'rgba(210, 153, 34, 0.12)',
                          padding: '1px 6px',
                          borderRadius: 8,
                          border: '1px solid rgba(210, 153, 34, 0.25)',
                          flexShrink: 0,
                        }}
                        title={`Tag: ${t.name}`}
                      >
                        <Tag size={8} />
                        {t.name}
                      </span>
                    ))}
                    {/* Branch label if this is HEAD */}
                    {idx === 0 && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          fontSize: 9,
                          fontWeight: 700,
                          color: getBranchColor(branch),
                          background: `${getBranchColor(branch)}18`,
                          padding: '1px 6px',
                          borderRadius: 8,
                          border: `1px solid ${getBranchColor(branch)}40`,
                          flexShrink: 0,
                        }}
                        title={`HEAD -> ${branch}`}
                      >
                        <GitBranch size={8} />
                        {branch}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                        fontWeight: 500,
                        minWidth: 0,
                      }}
                      title={entry.message}
                    >
                      {entry.message}
                    </span>
                    {/* Cherry-pick action */}
                    {idx > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCherryPick(entry.fullHash || entry.hash) }}
                        title="Cherry-pick this commit"
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 2,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 3,
                          color: 'var(--text-disabled, #545d68)',
                          flexShrink: 0,
                          opacity: 0,
                          transition: 'opacity 0.15s',
                        }}
                        className="source-control-action-btn source-control-cherry-pick"
                      >
                        <Copy size={11} />
                      </button>
                    )}
                  </div>

                  {/* Author avatar + name + Date row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      color: 'var(--text-disabled, #545d68)',
                    }}
                  >
                    {/* Author avatar circle */}
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 9,
                        fontWeight: 700,
                        color: '#fff',
                        flexShrink: 0,
                        lineHeight: 1,
                      }}
                      title={entry.email || entry.author}
                    >
                      {initial}
                    </div>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.author}
                    </span>
                    <span style={{ flexShrink: 0, opacity: 0.7 }}>
                      {formatRelativeDate(entry.date)}
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
                background: 'rgba(210, 168, 255, 0.1)',
                padding: '1px 6px',
                borderRadius: 8,
              }}
            >
              {selectedCommit}
            </span>
            {commitDetail && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  fontWeight: 400,
                }}
              >
                {commitDetail.message}
              </span>
            )}
            {!commitDetail && <span style={{ flex: 1 }} />}
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
              <div style={{ padding: '8px 0' }}>
                {/* Commit metadata */}
                <div style={{ padding: '0 12px 8px', borderBottom: '1px solid var(--border, #3d444d)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: avatarColor(commitDetail.author),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#fff',
                        flexShrink: 0,
                      }}
                    >
                      {(commitDetail.author || '?')[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {commitDetail.author}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-disabled, #545d68)' }}>
                        {commitDetail.email} · {formatRelativeDate(commitDetail.date)}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 4, fontWeight: 500 }}>
                    {commitDetail.message}
                  </div>
                </div>

                {/* Files changed list */}
                {commitDetail.filesChanged.length > 0 && (
                  <div style={{ padding: '6px 0' }}>
                    <div style={{
                      padding: '2px 12px 4px',
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.3px',
                      color: 'var(--text-disabled, #545d68)',
                    }}>
                      Files Changed ({commitDetail.filesChanged.length})
                    </div>
                    {commitDetail.filesChanged.map((fc, idx) => {
                      // Parse changes like "10 ++++----" into insertions/deletions
                      const plusCount = (fc.changes.match(/\+/g) || []).length
                      const minusCount = (fc.changes.match(/-/g) || []).length
                      return (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '2px 12px',
                            fontSize: 12,
                            gap: 8,
                          }}
                          className="source-control-file-item"
                        >
                          <FileText size={13} style={{ opacity: 0.5, flexShrink: 0 }} />
                          <span
                            style={{
                              flex: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: 'var(--text-primary)',
                              fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
                              fontSize: 11,
                            }}
                            title={fc.file}
                          >
                            {fc.file}
                          </span>
                          <span style={{ display: 'flex', gap: 2, flexShrink: 0, fontSize: 11 }}>
                            {plusCount > 0 && <span style={{ color: '#3fb950' }}>+{plusCount}</span>}
                            {minusCount > 0 && <span style={{ color: '#f85149' }}>-{minusCount}</span>}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Summary line */}
                {commitDetail.summary && (
                  <div
                    style={{
                      padding: '6px 12px',
                      fontSize: 11,
                      color: '#3fb950',
                      background: 'rgba(63, 185, 80, 0.06)',
                      borderTop: '1px solid var(--border, #3d444d)',
                    }}
                  >
                    {commitDetail.summary}
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  padding: '16px',
                  color: 'var(--text-disabled, #545d68)',
                  textAlign: 'center',
                }}
              >
                No details available
              </div>
            )}
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

      {/* Branch indicator - enhanced */}
      <div ref={branchPickerRef} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12, borderBottom: '1px solid var(--border)', flexShrink: 0, position: 'relative' }}>
        <GitBranch size={14} style={{ color: 'var(--text-secondary)' }} />
        <button
          onClick={() => { setShowBranchPicker(!showBranchPicker); if (!showBranchPicker) fetchBranches() }}
          title={detached ? `HEAD is detached at ${head}: new commits are not on any branch` : undefined}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: detached ? '#d29922' : 'var(--text-primary)',
            fontWeight: 500,
            fontSize: 12,
            padding: '2px 4px',
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
          className="source-control-action-btn"
        >
          {detached ? `detached @${head}` : branch}
          <ChevronDown size={10} />
        </button>

        {/* Create branch button */}
        <button
          onClick={() => setShowCreateBranch(!showCreateBranch)}
          title="Create Branch"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 2,
            borderRadius: 3,
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
          }}
          className="source-control-action-btn"
        >
          <Plus size={12} />
        </button>

        {/* Ahead/Behind indicators */}
        {(ahead > 0 || behind > 0) && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
            {behind > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}><ArrowDown size={10} />{behind}</span>}
            {ahead > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}><ArrowUp size={10} />{ahead}</span>}
          </span>
        )}

        {/* Change count badge */}
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

        {/* Merge branch button */}
        <div ref={mergePickerRef} style={{ position: 'relative' }}>
          <button
            onClick={() => { setShowMergePicker(!showMergePicker); if (!showMergePicker) fetchBranches() }}
            title="Merge Branch"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 2,
              borderRadius: 3,
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
            }}
            className="source-control-action-btn"
          >
            <GitMerge size={12} />
          </button>
          {showMergePicker && (
            <div style={{
              position: 'absolute',
              right: 0,
              top: '100%',
              marginTop: 4,
              width: 200,
              maxHeight: 200,
              overflowY: 'auto',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              zIndex: 55,
              padding: 4,
            }}>
              <div style={{ padding: '3px 8px', fontSize: 10, fontWeight: 600, color: 'var(--text-disabled, #545d68)', textTransform: 'uppercase' }}>
                Merge into {branch}
              </div>
              {branches.filter(b => !b.current).map(b => (
                <div
                  key={b.name}
                  onClick={() => handleMergeBranch(b.name)}
                  className="source-control-file-item"
                  style={{
                    padding: '4px 8px',
                    fontSize: 11,
                    cursor: 'pointer',
                    borderRadius: 3,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <GitMerge size={11} style={{ opacity: 0.6, color: getBranchColor(b.name) }} />
                  {b.name}
                </div>
              ))}
              {branches.filter(b => !b.current).length === 0 && (
                <div style={{ padding: '6px 8px', fontSize: 11, color: 'var(--text-disabled)' }}>No other branches</div>
              )}
            </div>
          )}
        </div>

        {/* Rebase indicator */}
        {isRebasing && (
          <span
            title="Rebase in progress"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 10,
              fontWeight: 600,
              color: '#d29922',
              background: 'rgba(210, 153, 34, 0.15)',
              padding: '1px 6px',
              borderRadius: 8,
              border: '1px solid rgba(210, 153, 34, 0.3)',
            }}
          >
            <RotateCw size={9} />
            REBASE
          </span>
        )}

        {/* Branch picker dropdown */}
        {showBranchPicker && (
          <div style={{
            position: 'absolute',
            left: 12,
            right: 12,
            top: '100%',
            maxHeight: 250,
            overflowY: 'auto',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            zIndex: 50,
            padding: 4,
          }}>
            {branches.map((b) => (
              <div
                key={`${b.remote ? 'remote' : 'local'}:${b.name}`}
                className="source-control-file-item"
                style={{
                  padding: '5px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: b.current ? 'var(--accent-blue, #388bfd)' : 'var(--text-primary)',
                  fontWeight: b.current ? 600 : 400,
                }}
              >
                <GitBranch size={12} style={{ color: getBranchColor(b.name), opacity: 0.8 }} />
                {/* Color-coded branch label */}
                <span
                  onClick={() => handleSwitchBranch(checkoutTargetFor(b, branches))}
                  title={checkoutTitle(b, checkoutTargetFor(b, branches))}
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    opacity: b.remote ? 0.75 : 1,
                  }}
                >
                  {b.name}
                </span>
                {b.current && <Check size={12} style={{ color: 'var(--accent-green, #3fb950)', flexShrink: 0 }} />}
                {/* Delete branch button (local branches other than the current one) */}
                {!b.current && !b.remote && (
                  <>
                    {showDeleteConfirm === b.name ? (
                      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleDeleteBranch(b.name)}
                          style={{
                            background: 'rgba(248, 81, 73, 0.2)',
                            border: '1px solid rgba(248, 81, 73, 0.4)',
                            cursor: 'pointer',
                            padding: '1px 5px',
                            fontSize: 9,
                            fontWeight: 600,
                            borderRadius: 3,
                            color: '#f85149',
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(null)}
                          style={{
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border)',
                            cursor: 'pointer',
                            padding: '1px 5px',
                            fontSize: 9,
                            borderRadius: 3,
                            color: 'var(--text-secondary)',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(b.name) }}
                        title="Delete branch"
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 2,
                          display: 'flex',
                          alignItems: 'center',
                          borderRadius: 3,
                          color: 'var(--text-disabled, #545d68)',
                          flexShrink: 0,
                        }}
                        className="source-control-action-btn"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Branch create input */}
      {showCreateBranch && (
        <div style={{ padding: '4px 12px', borderBottom: '1px solid var(--border)' }}>
          <input
            autoFocus
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateBranch()
              if (e.key === 'Escape') { setShowCreateBranch(false); setNewBranchName('') }
            }}
            placeholder="New branch name..."
            style={{
              width: '100%',
              padding: '5px 8px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--accent-blue, #388bfd)',
              borderRadius: 4,
              color: 'var(--text-primary)',
              fontSize: 12,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      {/* Action toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '4px 8px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button
          onClick={handlePull}
          title="Pull"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: '4px 8px',
            fontSize: 11,
            fontWeight: 500,
            background: 'var(--bg-tertiary, #2d333b)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'background 0.15s, color 0.15s',
          }}
          className="source-control-action-btn"
        >
          <ArrowDown size={12} />
          Pull
        </button>
        <button
          onClick={handlePush}
          title="Push"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: '4px 8px',
            fontSize: 11,
            fontWeight: 500,
            background: 'var(--bg-tertiary, #2d333b)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'background 0.15s, color 0.15s',
          }}
          className="source-control-action-btn"
        >
          <ArrowUp size={12} />
          Push
        </button>
        <button
          onClick={handleFetch}
          title="Fetch"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px 6px',
            background: 'var(--bg-tertiary, #2d333b)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'background 0.15s, color 0.15s',
          }}
          className="source-control-action-btn"
        >
          <Download size={12} />
        </button>
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
        .source-control-commit-item:hover .source-control-cherry-pick {
          opacity: 1 !important;
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
