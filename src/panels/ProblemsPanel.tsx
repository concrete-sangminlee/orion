import { useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from 'react'
import {
  AlertCircle, AlertTriangle, Info, CheckCircle2,
  Search, FileText, ChevronRight, ChevronDown,
  Lightbulb, Copy, X, ChevronsDownUp, ChevronsUpDown,
  FileCode2, Check, Trash2, ArrowUpDown, FolderOpen,
  LayoutList, Filter, ArrowUp, ArrowDown, MoreHorizontal,
  Layers, Tag, Ban,
} from 'lucide-react'
import {
  useProblemsStore,
  getProblemsCount,
  type ProblemSeverity,
  type Problem,
} from '@/store/problems'
import { useEditorStore } from '@/store/editor'

/* ── Types ─────────────────────────────────────────────── */

type GroupByMode = 'file' | 'severity' | 'source'
type SortMode = 'severity' | 'file' | 'line'
type SortDirection = 'asc' | 'desc'

interface FileGroup {
  key: string
  label: string
  subLabel?: string
  iconColor?: string
  problems: Problem[]
  errorCount: number
  warningCount: number
  infoCount: number
}

/* ── Severity config ───────────────────────────────────── */

const severityConfig: Record<
  ProblemSeverity,
  { Icon: typeof AlertCircle; color: string; label: string; bgColor: string; weight: number }
> = {
  error: {
    Icon: AlertCircle,
    color: 'var(--accent-red)',
    label: 'Errors',
    bgColor: 'rgba(248,81,73,0.12)',
    weight: 0,
  },
  warning: {
    Icon: AlertTriangle,
    color: 'var(--accent-orange)',
    label: 'Warnings',
    bgColor: 'rgba(227,179,65,0.12)',
    weight: 1,
  },
  info: {
    Icon: Info,
    color: 'var(--accent)',
    label: 'Info',
    bgColor: 'rgba(88,166,255,0.12)',
    weight: 2,
  },
}

/* ── Source badge colors ───────────────────────────────── */

const sourceBadgeColors: Record<string, { bg: string; fg: string }> = {
  eslint:            { bg: 'rgba(130,80,223,0.15)', fg: '#b392f0' },
  typescript:        { bg: 'rgba(49,120,198,0.15)', fg: '#79b8ff' },
  'todo-scanner':    { bg: 'rgba(227,179,65,0.12)', fg: '#e3b341' },
  'code-quality':    { bg: 'rgba(248,81,73,0.12)',  fg: '#f97583' },
  style:             { bg: 'rgba(88,166,255,0.10)', fg: '#58a6ff' },
  'bracket-matcher': { bg: 'rgba(248,81,73,0.12)',  fg: '#f97583' },
  imports:           { bg: 'rgba(227,179,65,0.12)', fg: '#e3b341' },
}

function getSourceColors(source: string) {
  return sourceBadgeColors[source] || { bg: 'rgba(139,148,158,0.12)', fg: '#8b949e' }
}

/* ── File extension to icon color mapping ─────────────── */

function getFileIconColor(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: '#3178c6', tsx: '#3178c6', js: '#f1e05a', jsx: '#f1e05a',
    css: '#563d7c', scss: '#c6538c', html: '#e34c26', json: '#292929',
    md: '#083fa1', py: '#3572a5', rs: '#dea584', go: '#00add8',
    vue: '#41b883', svelte: '#ff3e00',
  }
  return map[ext] || 'var(--text-muted)'
}

/* ── Helpers ──────────────────────────────────────────── */

function extractFileName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() || filePath
}

function extractDirPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  parts.pop()
  return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : parts.join('/')
}

function severityWeight(s: ProblemSeverity): number {
  return severityConfig[s].weight
}

/* ── Component ─────────────────────────────────────────── */

export default function ProblemsPanel() {
  const problems = useProblemsStore((s) => s.problems)
  const clearFile = useProblemsStore((s) => s.clearFile)
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  const { openFile } = useEditorStore()

  /* ── Local state ─────────────────────────────────────── */

  const [showErrors, setShowErrors] = useState(true)
  const [showWarnings, setShowWarnings] = useState(true)
  const [showInfo, setShowInfo] = useState(true)
  const [filterText, setFilterText] = useState('')
  const [currentFileOnly, setCurrentFileOnly] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<GroupByMode>('file')
  const [sortMode, setSortMode] = useState<SortMode>('severity')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null)
  const [showGroupByMenu, setShowGroupByMenu] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)

  // Context menu
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; problem: Problem; groupKey?: string
  } | null>(null)

  // Refs
  const listRef = useRef<HTMLDivElement>(null)
  const groupByRef = useRef<HTMLDivElement>(null)
  const sortMenuRef = useRef<HTMLDivElement>(null)

  // Auto-refresh on marker change events
  const [, setMarkerTick] = useState(0)
  useEffect(() => {
    const handler = () => setMarkerTick((t) => t + 1)
    window.addEventListener('orion:markers-changed', handler)
    return () => window.removeEventListener('orion:markers-changed', handler)
  }, [])

  // Close dropdown menus on outside click
  useEffect(() => {
    if (!showGroupByMenu && !showSortMenu) return
    const handler = (e: MouseEvent) => {
      if (showGroupByMenu && groupByRef.current && !groupByRef.current.contains(e.target as Node)) {
        setShowGroupByMenu(false)
      }
      if (showSortMenu && sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showGroupByMenu, showSortMenu])

  // Dispatch status bar update whenever counts change
  const counts = useMemo(() => getProblemsCount(problems), [problems])
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('orion:status-bar-problems', {
        detail: { errors: counts.errors, warnings: counts.warnings, info: counts.info },
      })
    )
  }, [counts])

  /* ── Filtering ───────────────────────────────────────── */

  const filtered = useMemo(() => {
    const activeSeverities = new Set<ProblemSeverity>()
    if (showErrors) activeSeverities.add('error')
    if (showWarnings) activeSeverities.add('warning')
    if (showInfo) activeSeverities.add('info')

    const lowerFilter = filterText.toLowerCase()

    return problems
      .filter((p) => activeSeverities.has(p.severity))
      .filter((p) => {
        if (currentFileOnly && activeFilePath && p.file !== activeFilePath) return false
        return true
      })
      .filter((p) => {
        if (!lowerFilter) return true
        const fileName = extractFileName(p.file)
        return (
          p.message.toLowerCase().includes(lowerFilter) ||
          fileName.toLowerCase().includes(lowerFilter) ||
          p.source.toLowerCase().includes(lowerFilter) ||
          `${p.line}`.includes(lowerFilter)
        )
      })
  }, [problems, showErrors, showWarnings, showInfo, filterText, currentFileOnly, activeFilePath])

  /* ── Sorting ─────────────────────────────────────────── */

  const sorted = useMemo(() => {
    const items = [...filtered]
    const dir = sortDirection === 'asc' ? 1 : -1

    items.sort((a, b) => {
      switch (sortMode) {
        case 'severity': {
          const w = severityWeight(a.severity) - severityWeight(b.severity)
          if (w !== 0) return w * dir
          const fc = a.file.localeCompare(b.file)
          if (fc !== 0) return fc
          return (a.line - b.line) * dir
        }
        case 'file': {
          const fc = a.file.localeCompare(b.file) * dir
          if (fc !== 0) return fc
          const w = severityWeight(a.severity) - severityWeight(b.severity)
          if (w !== 0) return w
          return (a.line - b.line) * dir
        }
        case 'line': {
          const fc = a.file.localeCompare(b.file)
          if (fc !== 0) return fc
          return (a.line - b.line) * dir
        }
        default:
          return 0
      }
    })

    return items
  }, [filtered, sortMode, sortDirection])

  /* ── Grouping ────────────────────────────────────────── */

  const fileGroups = useMemo<FileGroup[]>(() => {
    const map = new Map<string, Problem[]>()

    for (const p of sorted) {
      let key: string
      switch (groupBy) {
        case 'file':
          key = p.file
          break
        case 'severity':
          key = p.severity
          break
        case 'source':
          key = p.source
          break
      }
      const list = map.get(key)
      if (list) list.push(p)
      else map.set(key, [p])
    }

    return Array.from(map.entries()).map(([key, probs]) => {
      let label: string
      let subLabel: string | undefined
      let iconColor: string | undefined

      switch (groupBy) {
        case 'file': {
          label = extractFileName(key)
          subLabel = extractDirPath(key)
          iconColor = getFileIconColor(label)
          break
        }
        case 'severity': {
          const cfg = severityConfig[key as ProblemSeverity]
          label = cfg?.label || key
          iconColor = cfg?.color
          break
        }
        case 'source': {
          label = key
          const sc = getSourceColors(key)
          iconColor = sc.fg
          break
        }
      }

      return {
        key,
        label,
        subLabel,
        iconColor,
        problems: probs,
        errorCount: probs.filter((p) => p.severity === 'error').length,
        warningCount: probs.filter((p) => p.severity === 'warning').length,
        infoCount: probs.filter((p) => p.severity === 'info').length,
      }
    })
  }, [sorted, groupBy])

  /* ── Callbacks ───────────────────────────────────────── */

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const collapseAll = useCallback(() => {
    setCollapsedGroups(new Set(fileGroups.map((g) => g.key)))
  }, [fileGroups])

  const expandAll = useCallback(() => {
    setCollapsedGroups(new Set())
  }, [])

  const handleNavigate = useCallback(
    async (filePath: string, line: number, column?: number) => {
      const fileName = extractFileName(filePath)
      const editorState = useEditorStore.getState()
      const existing = editorState.openFiles.find((f) => f.path === filePath)

      if (existing) {
        editorState.setActiveFile(filePath)
      } else {
        try {
          const result = await window.api?.readFile(filePath)
          if (result) {
            openFile({
              path: filePath,
              name: fileName,
              content: result.content,
              language: result.language || 'plaintext',
              isModified: false,
              aiModified: false,
            })
          }
        } catch {
          return
        }
      }

      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('orion:go-to-line', { detail: { line, column: column || 1 } })
        )
      }, 50)
    },
    [openFile]
  )

  const handleCopy = useCallback((problem: Problem) => {
    const col = problem.column ? `:${problem.column}` : ''
    const text = `${problem.message} [${problem.source}] (${problem.file}:${problem.line}${col})`
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(problem.id)
      setTimeout(() => setCopiedId(null), 1500)
    })
  }, [])

  const handleCopyAll = useCallback(() => {
    if (sorted.length === 0) return
    const lines = sorted.map((p) => {
      const col = p.column ? `:${p.column}` : ''
      const sev = p.severity.toUpperCase()
      return `[${sev}] ${p.message} (${p.source}) — ${p.file}:${p.line}${col}`
    })
    navigator.clipboard.writeText(lines.join('\n'))
  }, [sorted])

  const handleQuickFix = useCallback((problem: Problem) => {
    if (!problem.quickFix) return
    window.dispatchEvent(
      new CustomEvent('orion:apply-quick-fix', {
        detail: {
          file: problem.file,
          line: problem.line,
          column: problem.column,
          fix: problem.quickFix,
          problemId: problem.id,
        },
      })
    )
  }, [])

  const handleClearAll = useCallback(() => {
    const files = new Set(problems.map((p) => p.file))
    for (const f of files) {
      clearFile(f)
    }
  }, [problems, clearFile])

  const handleClearFile = useCallback(
    (filePath: string) => {
      clearFile(filePath)
    },
    [clearFile]
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, problem: Problem, groupKey?: string) => {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY, problem, groupKey })
    },
    []
  )

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleSortChange = useCallback((mode: SortMode) => {
    setSortMode((prev) => {
      if (prev === mode) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortDirection('asc')
      return mode
    })
    setShowSortMenu(false)
  }, [])

  const handleGroupByChange = useCallback((mode: GroupByMode) => {
    setGroupBy(mode)
    setCollapsedGroups(new Set())
    setShowGroupByMenu(false)
  }, [])

  /* ── Keyboard navigation ─────────────────────────────── */

  const flatProblemIds = useMemo(() => {
    const ids: string[] = []
    for (const group of fileGroups) {
      if (collapsedGroups.has(group.key)) continue
      for (const p of group.problems) {
        ids.push(p.id)
      }
    }
    return ids
  }, [fileGroups, collapsedGroups])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const currentIdx = selectedProblemId ? flatProblemIds.indexOf(selectedProblemId) : -1
        let nextIdx: number
        if (e.key === 'ArrowDown') {
          nextIdx = currentIdx < flatProblemIds.length - 1 ? currentIdx + 1 : 0
        } else {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : flatProblemIds.length - 1
        }
        if (flatProblemIds[nextIdx]) {
          setSelectedProblemId(flatProblemIds[nextIdx])
          const el = listRef.current?.querySelector(`[data-problem-id="${flatProblemIds[nextIdx]}"]`)
          el?.scrollIntoView({ block: 'nearest' })
        }
      } else if (e.key === 'Enter' && selectedProblemId) {
        const problem = sorted.find((p) => p.id === selectedProblemId)
        if (problem) {
          handleNavigate(problem.file, problem.line, problem.column)
        }
      }
    },
    [selectedProblemId, flatProblemIds, sorted, handleNavigate]
  )

  /* ── Derived ─────────────────────────────────────────── */

  const hasProblems = problems.length > 0
  const allCollapsed =
    fileGroups.length > 0 && fileGroups.every((g) => collapsedGroups.has(g.key))

  const groupByLabel: Record<GroupByMode, string> = {
    file: 'File',
    severity: 'Severity',
    source: 'Source',
  }

  const groupByIcon: Record<GroupByMode, ReactNode> = {
    file: <FolderOpen size={11} />,
    severity: <Layers size={11} />,
    source: <Tag size={11} />,
  }

  /* ── Render ──────────────────────────────────────────── */

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      onClick={closeContextMenu}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* ── Toolbar ─────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          minHeight: 30,
        }}
      >
        {/* Severity toggle buttons */}
        <ToggleBadge
          Icon={AlertCircle}
          count={counts.errors}
          active={showErrors}
          color="var(--accent-red)"
          bgColor="rgba(248,81,73,0.12)"
          onClick={() => setShowErrors((v) => !v)}
          title="Toggle errors"
        />
        <ToggleBadge
          Icon={AlertTriangle}
          count={counts.warnings}
          active={showWarnings}
          color="var(--accent-orange)"
          bgColor="rgba(227,179,65,0.12)"
          onClick={() => setShowWarnings((v) => !v)}
          title="Toggle warnings"
        />
        <ToggleBadge
          Icon={Info}
          count={counts.info}
          active={showInfo}
          color="var(--accent)"
          bgColor="rgba(88,166,255,0.12)"
          onClick={() => setShowInfo((v) => !v)}
          title="Toggle info"
        />

        <ToolbarSep />

        {/* Filter input */}
        <div
          style={{
            flex: 1,
            maxWidth: 260,
            display: 'flex',
            alignItems: 'center',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md, 4px)',
            overflow: 'hidden',
          }}
        >
          <Search
            size={11}
            style={{ color: 'var(--text-muted)', margin: '0 6px', flexShrink: 0 }}
          />
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter (message, file, source)..."
            style={{
              flex: 1,
              padding: '3px 6px 3px 0',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 11,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans, sans-serif)',
            }}
          />
          {filterText && (
            <button
              onClick={() => setFilterText('')}
              title="Clear filter"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                marginRight: 4,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                borderRadius: 2,
              }}
            >
              <X size={10} />
            </button>
          )}
        </div>

        <ToolbarSep />

        {/* Current file only toggle */}
        <ToolbarButton
          Icon={FileCode2}
          active={currentFileOnly}
          onClick={() => setCurrentFileOnly((v) => !v)}
          title={currentFileOnly ? 'Show all files' : 'Show current file only'}
        />

        {/* Group by dropdown */}
        <div ref={groupByRef} style={{ position: 'relative' }}>
          <ToolbarButton
            Icon={LayoutList}
            active={groupBy !== 'file'}
            onClick={() => setShowGroupByMenu((v) => !v)}
            title={`Group by: ${groupByLabel[groupBy]}`}
          />
          {showGroupByMenu && (
            <DropdownMenu style={{ right: 0, top: '100%', marginTop: 2, minWidth: 150 }}>
              <DropdownLabel>Group By</DropdownLabel>
              {(['file', 'severity', 'source'] as GroupByMode[]).map((mode) => (
                <DropdownItem
                  key={mode}
                  icon={groupByIcon[mode]}
                  label={groupByLabel[mode]}
                  active={groupBy === mode}
                  onClick={() => handleGroupByChange(mode)}
                />
              ))}
            </DropdownMenu>
          )}
        </div>

        {/* Sort dropdown */}
        <div ref={sortMenuRef} style={{ position: 'relative' }}>
          <ToolbarButton
            Icon={ArrowUpDown}
            active={sortMode !== 'severity'}
            onClick={() => setShowSortMenu((v) => !v)}
            title={`Sort by: ${sortMode} (${sortDirection})`}
          />
          {showSortMenu && (
            <DropdownMenu style={{ right: 0, top: '100%', marginTop: 2, minWidth: 160 }}>
              <DropdownLabel>Sort By</DropdownLabel>
              {([
                { mode: 'severity' as SortMode, label: 'Severity', icon: <AlertCircle size={11} /> },
                { mode: 'file' as SortMode, label: 'File Path', icon: <FileText size={11} /> },
                { mode: 'line' as SortMode, label: 'Line Number', icon: <LayoutList size={11} /> },
              ]).map((item) => (
                <DropdownItem
                  key={item.mode}
                  icon={item.icon}
                  label={item.label}
                  active={sortMode === item.mode}
                  suffix={
                    sortMode === item.mode ? (
                      sortDirection === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />
                    ) : undefined
                  }
                  onClick={() => handleSortChange(item.mode)}
                />
              ))}
            </DropdownMenu>
          )}
        </div>

        {/* Collapse / Expand all */}
        <ToolbarButton
          Icon={allCollapsed ? ChevronsUpDown : ChevronsDownUp}
          active={false}
          onClick={allCollapsed ? expandAll : collapseAll}
          title={allCollapsed ? 'Expand all' : 'Collapse all'}
        />

        <ToolbarSep />

        {/* Clear all */}
        <ToolbarButton
          Icon={Trash2}
          active={false}
          onClick={handleClearAll}
          title="Clear all problems"
          disabled={!hasProblems}
        />
      </div>

      {/* ── Problem list ────────────────────────────────── */}
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          fontSize: 12,
        }}
      >
        {!hasProblems ? (
          /* Empty state */
          <EmptyState />
        ) : filtered.length === 0 ? (
          <NoMatchState currentFileOnly={currentFileOnly} filterText={filterText} />
        ) : (
          fileGroups.map((group) => (
            <GroupSection
              key={group.key}
              group={group}
              groupBy={groupBy}
              collapsed={collapsedGroups.has(group.key)}
              onToggle={() => toggleGroup(group.key)}
              onNavigate={handleNavigate}
              onCopy={handleCopy}
              onQuickFix={handleQuickFix}
              onContextMenu={handleContextMenu}
              onClearFile={handleClearFile}
              copiedId={copiedId}
              selectedProblemId={selectedProblemId}
              onSelectProblem={setSelectedProblemId}
            />
          ))
        )}
      </div>

      {/* ── Summary bar ────────────────────────────────── */}
      {hasProblems && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '4px 10px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-primary)',
            flexShrink: 0,
            minHeight: 26,
            fontSize: 11,
            fontFamily: 'var(--font-sans, sans-serif)',
          }}
        >
          <SummaryBadge
            Icon={AlertCircle}
            label="Errors"
            count={counts.errors}
            color="var(--accent-red)"
            bgColor="rgba(248,81,73,0.12)"
          />
          <SummaryBadge
            Icon={AlertTriangle}
            label="Warnings"
            count={counts.warnings}
            color="var(--accent-orange)"
            bgColor="rgba(227,179,65,0.12)"
          />
          <SummaryBadge
            Icon={Info}
            label="Info"
            count={counts.info}
            color="var(--accent)"
            bgColor="rgba(88,166,255,0.12)"
          />

          <div style={{ flex: 1 }} />

          {/* Copy all */}
          <button
            onClick={handleCopyAll}
            title="Copy all visible problems"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              padding: '1px 6px',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 10,
              borderRadius: 3,
              fontFamily: 'var(--font-sans, sans-serif)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <Copy size={10} />
            Copy All
          </button>

          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
            {filtered.length} shown
            {currentFileOnly ? ' (current file)' : ''}
            {filterText ? ` matching "${filterText}"` : ''}
          </span>
        </div>
      )}

      {/* ── Context menu ──────────────────────────────── */}
      {contextMenu && (
        <ContextMenuOverlay
          x={contextMenu.x}
          y={contextMenu.y}
          problem={contextMenu.problem}
          groupBy={groupBy}
          onCopy={() => {
            handleCopy(contextMenu.problem)
            setContextMenu(null)
          }}
          onNavigate={() => {
            handleNavigate(contextMenu.problem.file, contextMenu.problem.line, contextMenu.problem.column)
            setContextMenu(null)
          }}
          onQuickFix={
            contextMenu.problem.quickFix
              ? () => {
                  handleQuickFix(contextMenu.problem)
                  setContextMenu(null)
                }
              : undefined
          }
          onClearFile={
            groupBy === 'file'
              ? () => {
                  handleClearFile(contextMenu.problem.file)
                  setContextMenu(null)
                }
              : undefined
          }
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════ */

/* ── Toolbar separator ─────────────────────────────────── */

function ToolbarSep() {
  return (
    <div
      style={{
        width: 1,
        height: 16,
        background: 'var(--border)',
        margin: '0 4px',
        flexShrink: 0,
      }}
    />
  )
}

/* ── Empty state ───────────────────────────────────────── */

function EmptyState() {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: 'rgba(63,185,80,0.06)',
          border: '1px solid rgba(63,185,80,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CheckCircle2
          size={18}
          style={{ color: 'var(--accent-green)', opacity: 0.7 }}
        />
      </div>
      <p
        style={{
          color: 'var(--text-muted)',
          fontSize: 12,
          fontWeight: 500,
          fontFamily: 'var(--font-sans, sans-serif)',
          marginTop: 4,
        }}
      >
        No problems detected
      </p>
      <p
        style={{
          color: 'var(--text-muted)',
          fontSize: 11,
          opacity: 0.5,
          fontFamily: 'var(--font-sans, sans-serif)',
          maxWidth: 260,
          textAlign: 'center',
          lineHeight: 1.4,
        }}
      >
        Errors and warnings from TypeScript, ESLint, and other language servers will appear here
      </p>
    </div>
  )
}

/* ── No match state ────────────────────────────────────── */

function NoMatchState({
  currentFileOnly,
  filterText,
}: {
  currentFileOnly: boolean
  filterText: string
}) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: 20,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: 'rgba(139,148,158,0.06)',
          border: '1px solid rgba(139,148,158,0.12)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Filter size={16} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
      </div>
      <p
        style={{
          color: 'var(--text-muted)',
          fontSize: 12,
          fontWeight: 500,
          fontFamily: 'var(--font-sans, sans-serif)',
        }}
      >
        No problems match the current filters
      </p>
      {(filterText || currentFileOnly) && (
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: 11,
            opacity: 0.5,
            fontFamily: 'var(--font-sans, sans-serif)',
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          {filterText && <>Searching for "{filterText}". </>}
          {currentFileOnly && <>Showing current file only. </>}
          Try adjusting your filters.
        </p>
      )}
    </div>
  )
}

/* ── Summary badge ─────────────────────────────────────── */

function SummaryBadge({
  Icon,
  label,
  count,
  color,
  bgColor,
}: {
  Icon: typeof AlertCircle
  label: string
  count: number
  color: string
  bgColor: string
}) {
  const isActive = count > 0
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 8px 1px 5px',
        borderRadius: 10,
        background: isActive ? bgColor : 'transparent',
        color: isActive ? color : 'var(--text-muted)',
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        transition: 'all 0.15s',
      }}
    >
      <Icon size={11} />
      <span>{label}:</span>
      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 600 }}>{count}</span>
    </span>
  )
}

/* ── Toolbar icon button ──────────────────────────────── */

function ToolbarButton({
  Icon,
  active,
  onClick,
  title,
  disabled = false,
}: {
  Icon: typeof AlertCircle
  active: boolean
  onClick: () => void
  title: string
  disabled?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 22,
        border: 'none',
        borderRadius: 3,
        cursor: disabled ? 'default' : 'pointer',
        color: disabled
          ? 'var(--text-muted)'
          : active
            ? 'var(--accent)'
            : 'var(--text-muted)',
        background: active
          ? 'rgba(88,166,255,0.12)'
          : hovered && !disabled
            ? 'rgba(255,255,255,0.06)'
            : 'transparent',
        opacity: disabled ? 0.35 : 1,
        transition: 'background 0.1s, color 0.1s, opacity 0.1s',
        flexShrink: 0,
      }}
    >
      <Icon size={14} />
    </button>
  )
}

/* ── Toggle badge button ───────────────────────────────── */

function ToggleBadge({
  Icon,
  count,
  active,
  color,
  bgColor,
  onClick,
  title,
}: {
  Icon: typeof AlertCircle
  count: number
  active: boolean
  color: string
  bgColor: string
  onClick: () => void
  title: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        height: 22,
        padding: '0 7px',
        borderRadius: 3,
        border: 'none',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 500,
        fontFamily: 'var(--font-mono, monospace)',
        color: active ? color : 'var(--text-muted)',
        background: active ? bgColor : 'transparent',
        opacity: active ? 1 : 0.5,
        transition: 'opacity 0.1s, background 0.1s, color 0.1s',
      }}
    >
      <Icon size={12} />
      {count}
    </button>
  )
}

/* ── Dropdown menu ─────────────────────────────────────── */

function DropdownMenu({
  children,
  style,
}: {
  children: ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        position: 'absolute',
        zIndex: 100,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '4px 0',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        fontFamily: 'var(--font-sans, sans-serif)',
        fontSize: 12,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function DropdownLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: '4px 12px 2px',
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        opacity: 0.6,
      }}
    >
      {children}
    </div>
  )
}

function DropdownItem({
  icon,
  label,
  active,
  suffix,
  onClick,
}: {
  icon?: ReactNode
  label: string
  active?: boolean
  suffix?: ReactNode
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 12px',
        cursor: 'pointer',
        color: active ? 'var(--accent)' : 'var(--text-primary)',
        background: hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
        transition: 'background 0.08s',
        fontWeight: active ? 500 : 400,
        whiteSpace: 'nowrap',
      }}
    >
      {icon && (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            color: active ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          {icon}
        </span>
      )}
      <span style={{ flex: 1 }}>{label}</span>
      {active && !suffix && <Check size={12} style={{ flexShrink: 0, opacity: 0.7 }} />}
      {suffix && (
        <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, opacity: 0.7 }}>
          {suffix}
        </span>
      )}
    </div>
  )
}

/* ── Group section (file / severity / source) ──────────── */

function GroupSection({
  group,
  groupBy,
  collapsed,
  onToggle,
  onNavigate,
  onCopy,
  onQuickFix,
  onContextMenu,
  onClearFile,
  copiedId,
  selectedProblemId,
  onSelectProblem,
}: {
  group: FileGroup
  groupBy: GroupByMode
  collapsed: boolean
  onToggle: () => void
  onNavigate: (file: string, line: number, column?: number) => void
  onCopy: (problem: Problem) => void
  onQuickFix: (problem: Problem) => void
  onContextMenu: (e: React.MouseEvent, problem: Problem, groupKey?: string) => void
  onClearFile: (filePath: string) => void
  copiedId: string | null
  selectedProblemId: string | null
  onSelectProblem: (id: string) => void
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown
  const [headerHovered, setHeaderHovered] = useState(false)

  const GroupIcon = groupBy === 'severity'
    ? severityConfig[group.key as ProblemSeverity]?.Icon || AlertCircle
    : groupBy === 'source'
      ? Tag
      : FileText

  const iconColor = group.iconColor || 'var(--text-muted)'

  return (
    <div>
      {/* Group header */}
      <div
        onClick={onToggle}
        onMouseEnter={() => setHeaderHovered(true)}
        onMouseLeave={() => setHeaderHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 10px',
          cursor: 'pointer',
          background: headerHovered ? 'rgba(255,255,255,0.04)' : 'var(--bg-primary)',
          borderBottom: '1px solid var(--border)',
          fontFamily: 'var(--font-sans, sans-serif)',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-primary)',
          userSelect: 'none',
          position: 'sticky',
          top: 0,
          zIndex: 1,
          transition: 'background 0.08s',
        }}
      >
        <Chevron size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <GroupIcon size={12} style={{ color: iconColor, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {group.label}
        </span>
        {group.subLabel && (
          <span
            style={{
              color: 'var(--text-muted)',
              fontSize: 10,
              fontWeight: 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              opacity: 0.7,
              marginLeft: 2,
            }}
          >
            {group.subLabel}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Per-group severity counts */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {group.errorCount > 0 && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                color: 'var(--accent-red)',
                fontSize: 10,
              }}
            >
              <AlertCircle size={10} /> {group.errorCount}
            </span>
          )}
          {group.warningCount > 0 && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                color: 'var(--accent-orange)',
                fontSize: 10,
              }}
            >
              <AlertTriangle size={10} /> {group.warningCount}
            </span>
          )}
          {group.infoCount > 0 && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                color: 'var(--accent)',
                fontSize: 10,
              }}
            >
              <Info size={10} /> {group.infoCount}
            </span>
          )}
          <span
            style={{
              marginLeft: 2,
              padding: '1px 5px',
              borderRadius: 8,
              background: 'rgba(139,148,158,0.12)',
              color: 'var(--text-muted)',
              fontSize: 10,
              fontWeight: 500,
            }}
          >
            {group.problems.length}
          </span>

          {/* Clear file button (only for file group mode) */}
          {groupBy === 'file' && headerHovered && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClearFile(group.key)
              }}
              title="Clear problems for this file"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                borderRadius: 3,
                padding: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(248,81,73,0.15)'
                e.currentTarget.style.color = 'var(--accent-red)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--text-muted)'
              }}
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Problem rows */}
      {!collapsed &&
        group.problems.map((problem, idx) => (
          <ProblemRow
            key={problem.id}
            problem={problem}
            index={idx}
            groupBy={groupBy}
            onNavigate={onNavigate}
            onCopy={onCopy}
            onQuickFix={onQuickFix}
            onContextMenu={(e, p) => onContextMenu(e, p, group.key)}
            isCopied={copiedId === problem.id}
            isSelected={selectedProblemId === problem.id}
            onSelect={() => onSelectProblem(problem.id)}
          />
        ))}
    </div>
  )
}

/* ── Problem row ──────────────────────────────────────── */

function ProblemRow({
  problem,
  index,
  groupBy,
  onNavigate,
  onCopy,
  onQuickFix,
  onContextMenu,
  isCopied,
  isSelected,
  onSelect,
}: {
  problem: Problem
  index: number
  groupBy: GroupByMode
  onNavigate: (file: string, line: number, column?: number) => void
  onCopy: (problem: Problem) => void
  onQuickFix: (problem: Problem) => void
  onContextMenu: (e: React.MouseEvent, problem: Problem) => void
  isCopied: boolean
  isSelected: boolean
  onSelect: () => void
}) {
  const cfg = severityConfig[problem.severity]
  const sourceColors = getSourceColors(problem.source)
  const [hovered, setHovered] = useState(false)
  const hasQuickFix = !!problem.quickFix
  const isOdd = index % 2 === 1

  // When grouped by severity or source, show the file name in the row
  const showFileInRow = groupBy !== 'file'
  const fileName = extractFileName(problem.file)

  return (
    <div
      data-problem-id={problem.id}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
        onNavigate(problem.file, problem.line, problem.column)
      }}
      onContextMenu={(e) => onContextMenu(e, problem)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '4px 10px 4px 30px',
        cursor: 'pointer',
        transition: 'background 0.08s',
        background: isSelected
          ? 'rgba(88,166,255,0.10)'
          : hovered
            ? 'rgba(255,255,255,0.05)'
            : isOdd
              ? 'rgba(255,255,255,0.015)'
              : 'transparent',
        borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
      }}
    >
      {/* Severity icon */}
      <cfg.Icon
        size={13}
        style={{
          color: cfg.color,
          flexShrink: 0,
          marginTop: 2,
        }}
      />

      {/* Message + source */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <span
          style={{
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            wordBreak: 'break-word',
            fontFamily: 'var(--font-sans, sans-serif)',
            fontSize: 12,
          }}
        >
          {problem.message}
        </span>
        <span
          style={{
            marginLeft: 6,
            padding: '0px 5px',
            borderRadius: 3,
            background: sourceColors.bg,
            color: sourceColors.fg,
            fontSize: 10,
            fontFamily: 'var(--font-sans, sans-serif)',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            verticalAlign: 'middle',
          }}
        >
          {problem.source}
        </span>

        {/* Quick fix label inline */}
        {hasQuickFix && (
          <span
            style={{
              marginLeft: 4,
              padding: '0px 4px',
              borderRadius: 3,
              background: 'rgba(227,179,65,0.08)',
              color: 'var(--accent-orange)',
              fontSize: 9,
              fontFamily: 'var(--font-sans, sans-serif)',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              verticalAlign: 'middle',
              opacity: 0.8,
            }}
          >
            Quick Fix
          </span>
        )}

        {/* File name when not grouped by file */}
        {showFileInRow && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              marginTop: 1,
            }}
          >
            <FileText size={10} style={{ color: getFileIconColor(fileName), flexShrink: 0 }} />
            <span
              style={{
                color: 'var(--text-muted)',
                fontSize: 10,
                fontFamily: 'var(--font-mono, monospace)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                opacity: 0.7,
              }}
            >
              {fileName}
            </span>
          </div>
        )}
      </div>

      {/* File:line:column reference */}
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flexShrink: 0,
          color: 'var(--text-muted)',
          fontSize: 10,
          fontFamily: 'var(--font-mono, monospace)',
          marginTop: 2,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ opacity: 0.6 }}>
          Ln {problem.line}
          {problem.column != null && `, Col ${problem.column}`}
        </span>
      </span>

      {/* Action icons (visible on hover) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flexShrink: 0,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.12s',
        }}
      >
        {/* Quick fix button */}
        <ActionButton
          title={hasQuickFix ? `Quick fix: ${problem.quickFix}` : 'No quick fixes available'}
          disabled={!hasQuickFix}
          activeColor="var(--accent-orange)"
          activeBg="rgba(227,179,65,0.12)"
          activeHoverBg="rgba(227,179,65,0.22)"
          onClick={(e) => {
            e.stopPropagation()
            if (hasQuickFix) onQuickFix(problem)
          }}
        >
          <Lightbulb size={12} />
        </ActionButton>

        {/* Copy button */}
        <ActionButton
          title={isCopied ? 'Copied!' : 'Copy problem text'}
          activeColor={isCopied ? 'var(--accent-green)' : 'var(--text-muted)'}
          activeBg={isCopied ? 'rgba(63,185,80,0.15)' : 'transparent'}
          activeHoverBg={isCopied ? 'rgba(63,185,80,0.15)' : 'rgba(255,255,255,0.08)'}
          onClick={(e) => {
            e.stopPropagation()
            onCopy(problem)
          }}
        >
          {isCopied ? <Check size={11} /> : <Copy size={11} />}
        </ActionButton>
      </div>
    </div>
  )
}

/* ── Action button (row hover actions) ─────────────────── */

function ActionButton({
  title,
  disabled = false,
  activeColor,
  activeBg,
  activeHoverBg,
  onClick,
  children,
}: {
  title: string
  disabled?: boolean
  activeColor: string
  activeBg: string
  activeHoverBg: string
  onClick: (e: React.MouseEvent) => void
  children: ReactNode
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        border: 'none',
        background: disabled ? 'transparent' : activeBg,
        color: disabled ? 'var(--text-muted)' : activeColor,
        cursor: disabled ? 'default' : 'pointer',
        borderRadius: 3,
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = activeHoverBg
      }}
      onMouseLeave={(e) => {
        if (!disabled) e.currentTarget.style.background = activeBg
      }}
    >
      {children}
    </button>
  )
}

/* ── Context menu overlay ─────────────────────────────── */

function ContextMenuOverlay({
  x,
  y,
  problem,
  groupBy,
  onCopy,
  onNavigate,
  onQuickFix,
  onClearFile,
  onClose,
}: {
  x: number
  y: number
  problem: Problem
  groupBy: GroupByMode
  onCopy: () => void
  onNavigate: () => void
  onQuickFix?: () => void
  onClearFile?: () => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPos, setAdjustedPos] = useState({ x, y })

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      let newX = x
      let newY = y
      if (x + rect.width > window.innerWidth) newX = window.innerWidth - rect.width - 4
      if (y + rect.height > window.innerHeight) newY = window.innerHeight - rect.height - 4
      if (newX < 0) newX = 4
      if (newY < 0) newY = 4
      if (newX !== x || newY !== y) setAdjustedPos({ x: newX, y: newY })
    }
  }, [x, y])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const fileName = extractFileName(problem.file)

  return (
    <div
      ref={menuRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: adjustedPos.x,
        top: adjustedPos.y,
        zIndex: 9999,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '4px 0',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        minWidth: 220,
        fontFamily: 'var(--font-sans, sans-serif)',
        fontSize: 12,
      }}
    >
      {/* Header showing problem severity + truncated message */}
      <div
        style={{
          padding: '4px 14px 6px',
          borderBottom: '1px solid var(--border)',
          marginBottom: 4,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          {(() => {
            const cfg = severityConfig[problem.severity]
            return <cfg.Icon size={11} style={{ color: cfg.color, flexShrink: 0 }} />
          })()}
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 200,
            }}
          >
            {problem.message.length > 50
              ? problem.message.substring(0, 50) + '...'
              : problem.message}
          </span>
        </div>
      </div>

      <ContextMenuItem
        icon={<ChevronRight size={12} />}
        label="Go to Problem"
        shortcut="Enter"
        onClick={onNavigate}
      />
      <ContextMenuItem
        icon={<Copy size={12} />}
        label="Copy Problem Text"
        shortcut="Ctrl+C"
        onClick={onCopy}
      />

      <ContextMenuSep />

      {onQuickFix ? (
        <ContextMenuItem
          icon={<Lightbulb size={12} style={{ color: 'var(--accent-orange)' }} />}
          label={`Quick Fix: ${problem.quickFix}`}
          onClick={onQuickFix}
        />
      ) : (
        <ContextMenuItem
          icon={<Lightbulb size={12} />}
          label="No Quick Fix Available"
          onClick={onClose}
          disabled
        />
      )}

      {onClearFile && (
        <>
          <ContextMenuSep />
          <ContextMenuItem
            icon={<Trash2 size={12} style={{ color: 'var(--accent-red)' }} />}
            label={`Clear Problems: ${fileName}`}
            onClick={onClearFile}
          />
        </>
      )}

      <ContextMenuSep />

      <ContextMenuItem
        icon={<Ban size={12} />}
        label="Dismiss Problem"
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent('orion:dismiss-problem', {
              detail: { problemId: problem.id },
            })
          )
          onClose()
        }}
      />
    </div>
  )
}

/* ── Context menu helpers ──────────────────────────────── */

function ContextMenuSep() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
}

function ContextMenuItem({
  icon,
  label,
  shortcut,
  onClick,
  disabled = false,
}: {
  icon?: ReactNode
  label: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 14px',
        cursor: disabled ? 'default' : 'pointer',
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        opacity: disabled ? 0.5 : 1,
        background: hovered && !disabled ? 'rgba(255,255,255,0.06)' : 'transparent',
        transition: 'background 0.08s',
      }}
    >
      {icon && (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            color: 'var(--text-muted)',
          }}
        >
          {icon}
        </span>
      )}
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {shortcut && (
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            opacity: 0.6,
            flexShrink: 0,
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          {shortcut}
        </span>
      )}
    </div>
  )
}
