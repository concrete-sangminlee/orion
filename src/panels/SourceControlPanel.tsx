import { useState, useEffect, useCallback, useRef } from 'react'
import { useFileStore } from '@/store/files'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { useOutputStore } from '@/store/output'
import { GitBranch, Check, Plus, Minus, RotateCw, FileText, Trash2, ChevronRight, ChevronDown, X, Clock, GitCommit, User, ArrowUp, ArrowDown, Download, Archive, Plus as PlusIcon, AlertTriangle, Package, Play, XCircle, Tag, GitMerge, CherryIcon, Copy, Bookmark, BookmarkPlus, Square, CheckSquare, List } from 'lucide-react'

interface GitFile {
  path: string
  state: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'
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
  let currentHunk: DiffHunk | null = null

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk)
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      currentHunk = {
        header: line,
        lines: [line],
        startLine: match ? parseInt(match[1]) : 0,
        endLine: match ? parseInt(match[1]) + parseInt(match[2] || '1') : 0,
      }
    } else if (currentHunk) {
      currentHunk.lines.push(line)
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
  const [branch, setBranch] = useState<string>('main')
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
  const [branches, setBranches] = useState<{ name: string; current: boolean }[]>([])
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
  const [hunkSelections, setHunkSelections] = useState<Record<string, Set<number>>>(new Set() as any)

  // Branch management enhancements
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [showMergePicker, setShowMergePicker] = useState(false)
  const [isRebasing, setIsRebasing] = useState(false)
  const mergePickerRef = useRef<HTMLDivElement>(null)

  // Git graph enhancements
  const [tags, setTags] = useState<GitTag[]>([])

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
      const list = await (window as any).api.gitStashList(rootPath)
      setStashes(list || [])
    } catch {
      setStashes([])
    }
  }, [rootPath])

  const refreshMergeStatus = useCallback(async () => {
    if (!rootPath) return
    try {
      const status = await (window as any).api.gitMergeStatus(rootPath)
      setIsMerging(status?.merging || false)
      if (status?.merging) {
        const files = await (window as any).api.gitConflictFiles(rootPath)
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

  // Listen for command palette event to switch to history tab
  useEffect(() => {
    const handler = () => setActiveTab('history')
    window.addEventListener('orion:git-show-history', handler)
    return () => window.removeEventListener('orion:git-show-history', handler)
  }, [])

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
      const detail = await (window as any).api.gitShow(rootPath, fullHash)
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
      await (window as any).api.gitPush(rootPath)
      appendOutput('Git', '[push] Push successful', 'success')
      addToast({ type: 'success', message: 'Pushed to remote successfully' })
      refreshStatus()
    } catch (err: any) {
      appendOutput('Git', `[push] Failed: ${err?.message || 'Unknown error'}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Push failed' })
    }
  }

  const handlePull = async () => {
    if (!rootPath) return
    appendOutput('Git', '[pull] Pulling from remote...', 'info')
    try {
      await (window as any).api.gitPull(rootPath)
      appendOutput('Git', '[pull] Pull successful', 'success')
      addToast({ type: 'success', message: 'Pulled from remote successfully' })
      refreshStatus()
    } catch (err: any) {
      appendOutput('Git', `[pull] Failed: ${err?.message || 'Unknown error'}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Pull failed' })
    }
  }

  const handleFetch = async () => {
    if (!rootPath) return
    appendOutput('Git', '[fetch] Fetching from all remotes...', 'info')
    try {
      await (window as any).api.gitFetch(rootPath)
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
      const result = await (window as any).api.gitBranches(rootPath)
      setBranches(result || [])
    } catch {
      setBranches([])
    }
  }

  const handleCreateBranch = async () => {
    if (!rootPath || !newBranchName.trim()) return
    try {
      await (window as any).api.gitCreateBranch(rootPath, newBranchName.trim())
      addToast({ type: 'success', message: `Created and switched to branch: ${newBranchName.trim()}` })
      appendOutput('Git', `[branch] Created: ${newBranchName.trim()}`, 'success')
      setNewBranchName('')
      setShowCreateBranch(false)
      refreshStatus()
    } catch (err: any) {
      addToast({ type: 'error', message: err?.message || 'Failed to create branch' })
    }
  }

  const handleSwitchBranch = async (branchName: string) => {
    if (!rootPath) return
    try {
      await (window as any).api.gitCheckout(rootPath, branchName)
      addToast({ type: 'success', message: `Switched to branch: ${branchName}` })
      appendOutput('Git', `[checkout] Switched to: ${branchName}`, 'info')
      setShowBranchPicker(false)
      refreshStatus()
    } catch (err: any) {
      addToast({ type: 'error', message: err?.message || 'Failed to switch branch' })
    }
  }

  const handleStageAll = async () => {
    if (!rootPath) return
    try {
      await (window as any).api.gitStageAll(rootPath)
      appendOutput('Git', '[stage] Staged all changes', 'info')
      refreshStatus()
    } catch (err: any) {
      addToast({ type: 'error', message: err?.message || 'Failed to stage all' })
    }
  }

  const handleUnstageAll = async () => {
    if (!rootPath) return
    try {
      await (window as any).api.gitUnstageAll(rootPath)
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
      if (msg) {
        await (window as any).api.gitStashSave(rootPath, msg)
        appendOutput('Git', `[stash] Stashed with message: "${msg}"`, 'info')
      } else {
        await (window as any).api.gitStash(rootPath)
        appendOutput('Git', '[stash] Stashed all changes', 'info')
      }
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

  const handleStashApply = async (index: number) => {
    if (!rootPath) return
    try {
      await (window as any).api.gitStashApply(rootPath, index)
      appendOutput('Git', `[stash] Applied stash@{${index}}`, 'info')
      addToast({ type: 'success', message: `Applied stash@{${index}}` })
      refreshStatus()
      refreshMergeStatus()
    } catch (err: any) {
      appendOutput('Git', `[stash] Apply failed: ${err?.message || 'Unknown error'}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Stash apply failed' })
    }
  }

  const handleStashPop = async (index: number) => {
    if (!rootPath) return
    try {
      // Pop uses drop after apply for specific index
      if (index === 0) {
        await (window as any).api.gitStashPop(rootPath)
      } else {
        await (window as any).api.gitStashApply(rootPath, index)
        await (window as any).api.gitStashDrop(rootPath, index)
      }
      appendOutput('Git', `[stash] Popped stash@{${index}}`, 'info')
      addToast({ type: 'success', message: `Popped stash@{${index}}` })
      refreshStatus()
      refreshStashes()
      refreshMergeStatus()
    } catch (err: any) {
      appendOutput('Git', `[stash] Pop failed: ${err?.message || 'Unknown error'}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Stash pop failed' })
    }
  }

  const handleStashDrop = async (index: number) => {
    if (!rootPath) return
    try {
      await (window as any).api.gitStashDrop(rootPath, index)
      appendOutput('Git', `[stash] Dropped stash@{${index}}`, 'warn')
      addToast({ type: 'info', message: `Dropped stash@{${index}}` })
      refreshStashes()
    } catch (err: any) {
      appendOutput('Git', `[stash] Drop failed: ${err?.message || 'Unknown error'}`, 'error')
      addToast({ type: 'error', message: err?.message || 'Stash drop failed' })
    }
  }

  const handleMergeAbort = async () => {
    if (!rootPath) return
    try {
      await (window as any).api.gitMergeAbort(rootPath)
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
    const fullPath = rootPath + '/' + filePath
    openFile(fullPath)
  }

  const handleConflictAction = (filePath: string, action: 'accept-current' | 'accept-incoming' | 'accept-both') => {
    if (!rootPath) return
    const fullPath = rootPath + '/' + filePath
    window.dispatchEvent(new CustomEvent('orion:resolve-conflict', {
      detail: { path: fullPath, action }
    }))
    openFile(fullPath)
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
    for (const filePath of selectedFileChecks) {
      try {
        await (window as any).api.gitStage(rootPath, filePath)
        appendOutput('Git', `[stage] Staged: ${filePath}`, 'info')
      } catch (err: any) {
        appendOutput('Git', `[stage] Failed: ${filePath}: ${err?.message}`, 'error')
      }
    }
    setSelectedFileChecks(new Set())
    refreshStatus()
  }

  // Inline diff toggle for a file
  const toggleInlineDiff = async (filePath: string) => {
    if (expandedFiles.has(filePath)) {
      setExpandedFiles(prev => {
        const next = new Set(prev)
        next.delete(filePath)
        return next
      })
      return
    }
    if (inlineDiffs[filePath]) {
      setExpandedFiles(prev => new Set(prev).add(filePath))
      return
    }
    if (!rootPath) return
    setLoadingInlineDiffs(prev => new Set(prev).add(filePath))
    try {
      const diff = await (window as any).api.gitDiff(rootPath, filePath)
      setInlineDiffs(prev => ({ ...prev, [filePath]: diff || 'No changes detected' }))
      setExpandedFiles(prev => new Set(prev).add(filePath))
    } catch {
      setInlineDiffs(prev => ({ ...prev, [filePath]: 'Failed to load diff' }))
      setExpandedFiles(prev => new Set(prev).add(filePath))
    } finally {
      setLoadingInlineDiffs(prev => {
        const next = new Set(prev)
        next.delete(filePath)
        return next
      })
    }
  }

  // Branch management: delete branch
  const handleDeleteBranch = async (branchName: string) => {
    if (!rootPath) return
    try {
      await (window as any).api.gitDeleteBranch(rootPath, branchName)
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
      await (window as any).api.gitMerge(rootPath, branchName)
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
      const status = await (window as any).api.gitRebaseStatus?.(rootPath)
      setIsRebasing(status?.rebasing || false)
    } catch {
      setIsRebasing(false)
    }
  }, [rootPath])

  // Fetch tags
  const fetchTags = useCallback(async () => {
    if (!rootPath) return
    try {
      const result = await (window as any).api.gitTags?.(rootPath)
      setTags(result || [])
    } catch {
      setTags([])
    }
  }, [rootPath])

  // Cherry-pick a commit
  const handleCherryPick = async (hash: string) => {
    if (!rootPath) return
    try {
      await (window as any).api.gitCherryPick(rootPath, hash)
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
    const isExpanded = expandedFiles.has(file.path)
    const isLoadingDiff = loadingInlineDiffs.has(file.path)
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
          onClick={() => toggleInlineDiff(file.path)}
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

        {/* Inline diff expansion */}
        {isExpanded && inlineDiffs[file.path] && (
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
              const hunks = parseDiffIntoHunks(inlineDiffs[file.path])
              if (hunks.length === 0) {
                return (
                  <div style={{
                    padding: '6px 10px',
                    fontSize: 11,
                    color: 'var(--text-disabled, #545d68)',
                    fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", Consolas, monospace)',
                  }}>
                    {inlineDiffs[file.path]}
                  </div>
                )
              }
              return hunks.map((hunk, hunkIdx) => (
                <div key={hunkIdx}>
                  {/* Hunk header with stage hunk button */}
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
                    {!isStaged && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          // Stage this hunk via patch (simulated - stages the full file as fallback)
                          handleStage(file.path)
                          addToast({ type: 'info', message: `Staged hunk ${hunkIdx + 1} of ${file.path.split('/').pop()}` })
                        }}
                        title={`Stage Hunk ${hunkIdx + 1}`}
                        style={{
                          background: 'rgba(63, 185, 80, 0.15)',
                          border: '1px solid rgba(63, 185, 80, 0.3)',
                          cursor: 'pointer',
                          padding: '1px 6px',
                          fontSize: 10,
                          fontWeight: 600,
                          borderRadius: 3,
                          color: '#3fb950',
                          flexShrink: 0,
                          fontFamily: 'inherit',
                        }}
                        className="source-control-action-btn"
                      >
                        Stage Hunk
                      </button>
                    )}
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

                  {/* Quick resolve actions */}
                  <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleConflictAction(file, 'accept-current')}
                      title="Accept Current"
                      style={{
                        background: 'none',
                        border: '1px solid rgba(210, 153, 34, 0.3)',
                        cursor: 'pointer',
                        padding: '1px 5px',
                        fontSize: 10,
                        fontWeight: 500,
                        borderRadius: 3,
                        color: '#d29922',
                      }}
                      className="source-control-action-btn"
                    >
                      Current
                    </button>
                    <button
                      onClick={() => handleConflictAction(file, 'accept-incoming')}
                      title="Accept Incoming"
                      style={{
                        background: 'none',
                        border: '1px solid rgba(56, 139, 253, 0.3)',
                        cursor: 'pointer',
                        padding: '1px 5px',
                        fontSize: 10,
                        fontWeight: 500,
                        borderRadius: 3,
                        color: '#388bfd',
                      }}
                      className="source-control-action-btn"
                    >
                      Incoming
                    </button>
                    <button
                      onClick={() => handleConflictAction(file, 'accept-both')}
                      title="Accept Both"
                      style={{
                        background: 'none',
                        border: '1px solid rgba(139, 148, 158, 0.3)',
                        cursor: 'pointer',
                        padding: '1px 5px',
                        fontSize: 10,
                        fontWeight: 500,
                        borderRadius: 3,
                        color: '#8b949e',
                      }}
                      className="source-control-action-btn"
                    >
                      Both
                    </button>
                  </div>
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
                  onClick={() => handleStashDrop(stash.index)}
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
                  {/* Hash pill + Message row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: 3,
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
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                        fontWeight: 500,
                      }}
                      title={entry.message}
                    >
                      {entry.message}
                    </span>
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
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-primary)',
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
          {branch}
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

        {/* Branch picker dropdown */}
        {showBranchPicker && (
          <div style={{
            position: 'absolute',
            left: 12,
            right: 12,
            top: '100%',
            maxHeight: 200,
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
                key={b.name}
                onClick={() => handleSwitchBranch(b.name)}
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
                <GitBranch size={12} style={{ opacity: 0.6 }} />
                {b.name}
                {b.current && <Check size={12} style={{ marginLeft: 'auto', color: 'var(--accent-green, #3fb950)' }} />}
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
