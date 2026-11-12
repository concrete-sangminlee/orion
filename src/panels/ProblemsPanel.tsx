import { useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from 'react'
import {
  AlertCircle, AlertTriangle, Info, CheckCircle2, Search, FileText,
  ChevronRight, ChevronDown, Copy, X, ChevronsDownUp,
  ChevronsUpDown, FileCode2, Check, ArrowUpDown, FolderOpen,
  LayoutList, Filter, ArrowUp, ArrowDown, Layers, Tag,
} from 'lucide-react'
import {
  useProblemsStore, getProblemsCount,
  type ProblemSeverity, type Problem,
} from '@/store/problems'
import { useEditorStore } from '@/store/editor'

/* ── Types ─────────────────────────────────────────────── */

type GroupByMode = 'file' | 'severity' | 'source'
type SortMode = 'severity' | 'file' | 'line'
type SortDir = 'asc' | 'desc'

interface ProblemGroup {
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

const sevCfg: Record<
  ProblemSeverity,
  { Icon: typeof AlertCircle; color: string; label: string; bg: string; weight: number }
> = {
  error: {
    Icon: AlertCircle,
    color: 'var(--accent-red)',
    label: 'Errors',
    bg: 'rgba(248,81,73,0.12)',
    weight: 0,
  },
  warning: {
    Icon: AlertTriangle,
    color: 'var(--accent-orange)',
    label: 'Warnings',
    bg: 'rgba(227,179,65,0.12)',
    weight: 1,
  },
  info: {
    Icon: Info,
    color: 'var(--accent)',
    label: 'Info',
    bg: 'rgba(88,166,255,0.12)',
    weight: 2,
  },
}

/* ── Source badge colors ───────────────────────────────── */

// Keyed by marker source/owner: the language services and the editor's lint hints.
const srcBadge: Record<string, { bg: string; fg: string }> = {
  typescript:  { bg: 'rgba(49,120,198,0.15)', fg: '#79b8ff' },
  javascript:  { bg: 'rgba(241,224,90,0.12)', fg: '#e3d26f' },
  json:        { bg: 'rgba(88,166,255,0.10)', fg: '#58a6ff' },
  css:         { bg: 'rgba(130,80,223,0.15)', fg: '#b392f0' },
  todo:        { bg: 'rgba(227,179,65,0.12)', fg: '#e3b341' },
  'lint-hint': { bg: 'rgba(248,81,73,0.12)',  fg: '#f97583' },
}
const getSrcColors = (s: string) => srcBadge[s] || { bg: 'rgba(139,148,158,0.12)', fg: '#8b949e' }

/* ── File extension → icon color ──────────────────────── */

const extColors: Record<string, string> = {
  ts:     '#3178c6',
  tsx:    '#3178c6',
  js:     '#f1e05a',
  jsx:    '#f1e05a',
  css:    '#563d7c',
  scss:   '#c6538c',
  html:   '#e34c26',
  json:   '#292929',
  md:     '#083fa1',
  py:     '#3572a5',
  rs:     '#dea584',
  go:     '#00add8',
  vue:    '#41b883',
  svelte: '#ff3e00',
  yaml:   '#cb171e',
  toml:   '#9c4221',
}

function fileColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return extColors[ext] || 'var(--text-muted)'
}

/* ── Path helpers ─────────────────────────────────────── */

function fName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() || filePath
}

function fDir(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  parts.pop()
  if (parts.length > 2) {
    return '.../' + parts.slice(-2).join('/')
  }
  return parts.join('/')
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function ProblemsPanel() {
  const problems = useProblemsStore((s) => s.problems)
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  const { openFile } = useEditorStore()

  const [showErrors, setShowErrors] = useState(true)
  const [showWarnings, setShowWarnings] = useState(true)
  const [showInfo, setShowInfo] = useState(true)
  const [filterText, setFilterText] = useState('')
  const [currentFileOnly, setCurrentFileOnly] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<GroupByMode>('file')
  const [sortMode, setSortMode] = useState<SortMode>('severity')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showGroupMenu, setShowGroupMenu] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; problem: Problem } | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  const groupMenuRef = useRef<HTMLDivElement>(null)
  const sortMenuRef = useRef<HTMLDivElement>(null)

  // Close dropdown menus on outside click
  useEffect(() => {
    if (!showGroupMenu && !showSortMenu) return
    const h = (e: MouseEvent) => {
      if (showGroupMenu && groupMenuRef.current && !groupMenuRef.current.contains(e.target as Node))
        setShowGroupMenu(false)
      if (showSortMenu && sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node))
        setShowSortMenu(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [showGroupMenu, showSortMenu])

  const counts = useMemo(() => getProblemsCount(problems), [problems])

  /* ── Filtering ───────────────────────────────────────── */

  const filtered = useMemo(() => {
    const active = new Set<ProblemSeverity>()
    if (showErrors) active.add('error')
    if (showWarnings) active.add('warning')
    if (showInfo) active.add('info')
    const lf = filterText.toLowerCase()

    return problems
      .filter((p) => active.has(p.severity))
      .filter((p) => !currentFileOnly || !activeFilePath || p.file === activeFilePath)
      .filter((p) => {
        if (!lf) return true
        return p.message.toLowerCase().includes(lf) ||
          fName(p.file).toLowerCase().includes(lf) ||
          p.source.toLowerCase().includes(lf) ||
          `${p.line}`.includes(lf)
      })
  }, [problems, showErrors, showWarnings, showInfo, filterText, currentFileOnly, activeFilePath])

  /* ── Sorting ─────────────────────────────────────────── */

  const sorted = useMemo(() => {
    const items = [...filtered]
    const d = sortDir === 'asc' ? 1 : -1

    items.sort((a, b) => {
      switch (sortMode) {
        case 'severity': {
          const w = (sevCfg[a.severity].weight - sevCfg[b.severity].weight) * d
          if (w !== 0) return w
          const fc = a.file.localeCompare(b.file)
          if (fc !== 0) return fc
          return (a.line - b.line) * d
        }
        case 'file': {
          const fc = a.file.localeCompare(b.file) * d
          if (fc !== 0) return fc
          const w = sevCfg[a.severity].weight - sevCfg[b.severity].weight
          if (w !== 0) return w
          return (a.line - b.line) * d
        }
        case 'line': {
          const fc = a.file.localeCompare(b.file)
          if (fc !== 0) return fc
          return (a.line - b.line) * d
        }
        default:
          return 0
      }
    })

    return items
  }, [filtered, sortMode, sortDir])

  /* ── Grouping ────────────────────────────────────────── */

  const groups = useMemo<ProblemGroup[]>(() => {
    const map = new Map<string, Problem[]>()

    for (const p of sorted) {
      let key: string
      switch (groupBy) {
        case 'file':     key = p.file; break
        case 'severity': key = p.severity; break
        case 'source':   key = p.source; break
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
        case 'file':
          label = fName(key)
          subLabel = fDir(key)
          iconColor = fileColor(label)
          break
        case 'severity': {
          const c = sevCfg[key as ProblemSeverity]
          label = c?.label || key
          iconColor = c?.color
          break
        }
        case 'source':
          label = key
          iconColor = getSrcColors(key).fg
          break
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

  const toggleGroup = useCallback((k: string) => {
    setCollapsed((prev) => {
      const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n
    })
  }, [])

  const collapseAll = useCallback(() => setCollapsed(new Set(groups.map((g) => g.key))), [groups])
  const expandAll = useCallback(() => setCollapsed(new Set()), [])

  const navigate = useCallback(async (filePath: string, line: number, col?: number) => {
    const name = fName(filePath)
    const es = useEditorStore.getState()
    const existing = es.openFiles.find((f) => f.path === filePath)
    if (existing) {
      es.setActiveFile(filePath)
    } else {
      try {
        const r = await window.api?.readFile(filePath)
        if (r) openFile({ path: filePath, name, content: r.content, language: r.language || 'plaintext', isModified: false, aiModified: false })
      } catch { return }
    }
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('orion:go-to-line', { detail: { line, column: col || 1 } }))
    }, 50)
  }, [openFile])

  const copyProblem = useCallback((p: Problem) => {
    const c = p.column ? `:${p.column}` : ''
    navigator.clipboard.writeText(`${p.message} [${p.source}] (${p.file}:${p.line}${c})`).then(() => {
      setCopiedId(p.id); setTimeout(() => setCopiedId(null), 1500)
    })
  }, [])

  const copyAll = useCallback(() => {
    if (!sorted.length) return
    const lines = sorted.map((p) => {
      const c = p.column ? `:${p.column}` : ''
      return `[${p.severity.toUpperCase()}] ${p.message} (${p.source}) — ${p.file}:${p.line}${c}`
    })
    navigator.clipboard.writeText(lines.join('\n'))
  }, [sorted])

  /* ── Keyboard navigation ─────────────────────────────── */

  const flatIds = useMemo(() => {
    const ids: string[] = []
    for (const g of groups) {
      if (collapsed.has(g.key)) continue
      for (const p of g.problems) ids.push(p.id)
    }
    return ids
  }, [groups, collapsed])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const cur = selectedId ? flatIds.indexOf(selectedId) : -1
      const next = e.key === 'ArrowDown'
        ? (cur < flatIds.length - 1 ? cur + 1 : 0)
        : (cur > 0 ? cur - 1 : flatIds.length - 1)
      if (flatIds[next]) {
        setSelectedId(flatIds[next])
        listRef.current?.querySelector(`[data-pid="${flatIds[next]}"]`)?.scrollIntoView({ block: 'nearest' })
      }
    } else if (e.key === 'Enter' && selectedId) {
      const p = sorted.find((x) => x.id === selectedId)
      if (p) navigate(p.file, p.line, p.column)
    }
  }, [selectedId, flatIds, sorted, navigate])

  /* ── Derived ─────────────────────────────────────────── */

  const hasProblems = problems.length > 0
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.key))
  const gLabels: Record<GroupByMode, string> = { file: 'File', severity: 'Severity', source: 'Source' }
  const gIcons: Record<GroupByMode, ReactNode> = {
    file: <FolderOpen size={11} />, severity: <Layers size={11} />, source: <Tag size={11} />,
  }

  /* ── Render ──────────────────────────────────────────── */

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      onClick={() => setCtxMenu(null)} onKeyDown={onKeyDown} tabIndex={0}>

      {/* ── Toolbar ─────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
        borderBottom: '1px solid var(--border)', flexShrink: 0, minHeight: 30,
      }}>
        <ToggleBadge Icon={AlertCircle} count={counts.errors} active={showErrors}
          color="var(--accent-red)" bg="rgba(248,81,73,0.12)"
          onClick={() => setShowErrors((v) => !v)} title="Toggle errors" />
        <ToggleBadge Icon={AlertTriangle} count={counts.warnings} active={showWarnings}
          color="var(--accent-orange)" bg="rgba(227,179,65,0.12)"
          onClick={() => setShowWarnings((v) => !v)} title="Toggle warnings" />
        <ToggleBadge Icon={Info} count={counts.info} active={showInfo}
          color="var(--accent)" bg="rgba(88,166,255,0.12)"
          onClick={() => setShowInfo((v) => !v)} title="Toggle info" />

        <Sep />

        {/* Filter input */}
        <div style={{
          flex: 1, maxWidth: 260, display: 'flex', alignItems: 'center',
          background: 'var(--bg-primary)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md, 4px)', overflow: 'hidden',
        }}>
          <Search size={11} style={{ color: 'var(--text-muted)', margin: '0 6px', flexShrink: 0 }} />
          <input value={filterText} onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter (message, file, source)..."
            style={{
              flex: 1, padding: '3px 6px 3px 0', background: 'transparent',
              border: 'none', outline: 'none', fontSize: 11,
              color: 'var(--text-primary)', fontFamily: 'var(--font-sans, sans-serif)',
            }} />
          {filterText && (
            <button onClick={() => setFilterText('')} title="Clear filter"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, marginRight: 4, border: 'none',
                background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 2 }}>
              <X size={10} />
            </button>
          )}
        </div>

        <Sep />

        <TbBtn Icon={FileCode2} active={currentFileOnly}
          onClick={() => setCurrentFileOnly((v) => !v)}
          title={currentFileOnly ? 'Show all files' : 'Show current file only'} />

        {/* Group by dropdown */}
        <div ref={groupMenuRef} style={{ position: 'relative' }}>
          <TbBtn Icon={LayoutList} active={groupBy !== 'file'}
            onClick={() => setShowGroupMenu((v) => !v)}
            title={`Group by: ${gLabels[groupBy]}`} />
          {showGroupMenu && (
            <DdMenu style={{ right: 0, top: '100%', marginTop: 2, minWidth: 150 }}>
              <DdLabel>Group By</DdLabel>
              {(['file', 'severity', 'source'] as GroupByMode[]).map((m) => (
                <DdItem key={m} icon={gIcons[m]} label={gLabels[m]} active={groupBy === m}
                  onClick={() => { setGroupBy(m); setCollapsed(new Set()); setShowGroupMenu(false) }} />
              ))}
            </DdMenu>
          )}
        </div>

        {/* Sort dropdown */}
        <div ref={sortMenuRef} style={{ position: 'relative' }}>
          <TbBtn Icon={ArrowUpDown} active={sortMode !== 'severity'}
            onClick={() => setShowSortMenu((v) => !v)}
            title={`Sort: ${sortMode} (${sortDir})`} />
          {showSortMenu && (
            <DdMenu style={{ right: 0, top: '100%', marginTop: 2, minWidth: 160 }}>
              <DdLabel>Sort By</DdLabel>
              {([
                { m: 'severity' as SortMode, l: 'Severity', i: <AlertCircle size={11} /> },
                { m: 'file' as SortMode, l: 'File Path', i: <FileText size={11} /> },
                { m: 'line' as SortMode, l: 'Line Number', i: <LayoutList size={11} /> },
              ]).map((x) => (
                <DdItem key={x.m} icon={x.i} label={x.l} active={sortMode === x.m}
                  suffix={sortMode === x.m ? (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : undefined}
                  onClick={() => {
                    if (sortMode === x.m) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
                    else { setSortMode(x.m); setSortDir('asc') }
                    setShowSortMenu(false)
                  }} />
              ))}
            </DdMenu>
          )}
        </div>

        <TbBtn Icon={allCollapsed ? ChevronsUpDown : ChevronsDownUp} active={false}
          onClick={allCollapsed ? expandAll : collapseAll}
          title={allCollapsed ? 'Expand all' : 'Collapse all'} />
      </div>

      {/* ── Problem list ────────────────────────────────── */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', fontSize: 12 }}>
        {!hasProblems ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <NoMatchState filterText={filterText} currentFileOnly={currentFileOnly} />
        ) : (
          groups.map((g) => (
            <GroupSection key={g.key} group={g} groupBy={groupBy}
              isCollapsed={collapsed.has(g.key)}
              onToggle={() => toggleGroup(g.key)}
              onNav={navigate} onCopy={copyProblem}
              onCtx={(e, p) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, problem: p }) }}
              copiedId={copiedId} selectedId={selectedId} onSelect={setSelectedId} />
          ))
        )}
      </div>

      {/* ── Summary bar ────────────────────────────────── */}
      {hasProblems && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '4px 10px',
          borderTop: '1px solid var(--border)', background: 'var(--bg-primary)',
          flexShrink: 0, minHeight: 26, fontSize: 11, fontFamily: 'var(--font-sans, sans-serif)',
        }}>
          <SumBadge Icon={AlertCircle} label="Errors" count={counts.errors}
            color="var(--accent-red)" bg="rgba(248,81,73,0.12)" />
          <SumBadge Icon={AlertTriangle} label="Warnings" count={counts.warnings}
            color="var(--accent-orange)" bg="rgba(227,179,65,0.12)" />
          <SumBadge Icon={Info} label="Info" count={counts.info}
            color="var(--accent)" bg="rgba(88,166,255,0.12)" />
          <div style={{ flex: 1 }} />
          <button onClick={copyAll} title="Copy all visible problems"
            style={{
              display: 'flex', alignItems: 'center', gap: 3, padding: '1px 6px',
              border: 'none', background: 'transparent', color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: 10, borderRadius: 3, fontFamily: 'var(--font-sans, sans-serif)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
            <Copy size={10} /> Copy All
          </button>
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
            {filtered.length} shown{currentFileOnly ? ' (current file)' : ''}{filterText ? ` matching "${filterText}"` : ''}
          </span>
        </div>
      )}

      {/* ── Context menu ──────────────────────────────── */}
      {ctxMenu && (
        <CtxMenuOverlay x={ctxMenu.x} y={ctxMenu.y} problem={ctxMenu.problem}
          onCopy={() => { copyProblem(ctxMenu.problem); setCtxMenu(null) }}
          onNav={() => { navigate(ctxMenu.problem.file, ctxMenu.problem.line, ctxMenu.problem.column); setCtxMenu(null) }}
          onClose={() => setCtxMenu(null)} />
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════ */

function Sep() {
  return <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px', flexShrink: 0 }} />
}

/* ── Empty state ───────────────────────────────────────── */

function EmptyState() {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 8,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: 'rgba(63,185,80,0.06)', border: '1px solid rgba(63,185,80,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <CheckCircle2 size={18} style={{ color: 'var(--accent-green)', opacity: 0.7 }} />
      </div>
      <p style={{
        color: 'var(--text-muted)', fontSize: 12, fontWeight: 500,
        fontFamily: 'var(--font-sans, sans-serif)', marginTop: 4,
      }}>
        No problems detected
      </p>
      <p style={{
        color: 'var(--text-muted)', fontSize: 11, opacity: 0.5,
        fontFamily: 'var(--font-sans, sans-serif)', maxWidth: 260,
        textAlign: 'center', lineHeight: 1.4,
      }}>
        Errors and warnings the editor reports for open files (TypeScript, JavaScript, JSON, CSS) and TODO / lint hints appear here
      </p>
    </div>
  )
}

/* ── No match state ────────────────────────────────────── */

function NoMatchState({ filterText, currentFileOnly }: { filterText: string; currentFileOnly: boolean }) {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: 'rgba(139,148,158,0.06)', border: '1px solid rgba(139,148,158,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Filter size={16} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-sans, sans-serif)' }}>
        No problems match the current filters
      </p>
      {(filterText || currentFileOnly) && (
        <p style={{
          color: 'var(--text-muted)', fontSize: 11, opacity: 0.5,
          fontFamily: 'var(--font-sans, sans-serif)', textAlign: 'center', lineHeight: 1.4,
        }}>
          {filterText && <>Searching for &ldquo;{filterText}&rdquo;. </>}
          {currentFileOnly && <>Showing current file only. </>}
          Try adjusting your filters.
        </p>
      )}
    </div>
  )
}

/* ── Summary badge ─────────────────────────────────────── */

function SumBadge({ Icon, label, count, color, bg }: {
  Icon: typeof AlertCircle; label: string; count: number; color: string; bg: string
}) {
  const on = count > 0
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '1px 8px 1px 5px', borderRadius: 10,
      background: on ? bg : 'transparent', color: on ? color : 'var(--text-muted)',
      fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', transition: 'all 0.15s',
    }}>
      <Icon size={11} /> <span>{label}:</span>
      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 600 }}>{count}</span>
    </span>
  )
}

/* ── Toolbar button ────────────────────────────────────── */

function TbBtn({ Icon, active, onClick, title }: {
  Icon: typeof AlertCircle; active: boolean; onClick: () => void; title: string
}) {
  const [h, setH] = useState(false)
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 22, border: 'none', borderRadius: 3,
        cursor: 'pointer', flexShrink: 0,
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        background: active ? 'rgba(88,166,255,0.12)' : h ? 'rgba(255,255,255,0.06)' : 'transparent',
        transition: 'background 0.1s, color 0.1s',
      }}>
      <Icon size={14} />
    </button>
  )
}

/* ── Toggle badge ──────────────────────────────────────── */

function ToggleBadge({ Icon, count, active, color, bg, onClick, title }: {
  Icon: typeof AlertCircle; count: number; active: boolean; color: string; bg: string
  onClick: () => void; title: string
}) {
  return (
    <button onClick={onClick} title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, height: 22, padding: '0 7px',
        borderRadius: 3, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 500,
        fontFamily: 'var(--font-mono, monospace)',
        color: active ? color : 'var(--text-muted)',
        background: active ? bg : 'transparent',
        opacity: active ? 1 : 0.5,
        transition: 'opacity 0.1s, background 0.1s, color 0.1s',
      }}>
      <Icon size={12} /> {count}
    </button>
  )
}

/* ── Dropdown components ───────────────────────────────── */

function DdMenu({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      position: 'absolute', zIndex: 100, background: 'var(--bg-secondary)',
      border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      fontFamily: 'var(--font-sans, sans-serif)', fontSize: 12, ...style,
    }}>
      {children}
    </div>
  )
}

function DdLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: '4px 12px 2px', fontSize: 10, fontWeight: 600,
      color: 'var(--text-muted)', textTransform: 'uppercase',
      letterSpacing: '0.5px', opacity: 0.6,
    }}>
      {children}
    </div>
  )
}

function DdItem({ icon, label, active, suffix, onClick }: {
  icon?: ReactNode; label: string; active?: boolean; suffix?: ReactNode; onClick: () => void
}) {
  const [h, setH] = useState(false)
  return (
    <div onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px',
        cursor: 'pointer', whiteSpace: 'nowrap',
        color: active ? 'var(--accent)' : 'var(--text-primary)',
        background: h ? 'rgba(255,255,255,0.06)' : 'transparent',
        fontWeight: active ? 500 : 400, transition: 'background 0.08s',
      }}>
      {icon && <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: active ? 'var(--accent)' : 'var(--text-muted)' }}>{icon}</span>}
      <span style={{ flex: 1 }}>{label}</span>
      {active && !suffix && <Check size={12} style={{ flexShrink: 0, opacity: 0.7 }} />}
      {suffix && <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, opacity: 0.7 }}>{suffix}</span>}
    </div>
  )
}

/* ── Group section ─────────────────────────────────────── */

function GroupSection({ group, groupBy, isCollapsed, onToggle, onNav, onCopy, onCtx, copiedId, selectedId, onSelect }: {
  group: ProblemGroup; groupBy: GroupByMode; isCollapsed: boolean; onToggle: () => void
  onNav: (f: string, l: number, c?: number) => void; onCopy: (p: Problem) => void
  onCtx: (e: React.MouseEvent, p: Problem) => void
  copiedId: string | null; selectedId: string | null
  onSelect: (id: string) => void
}) {
  const Chev = isCollapsed ? ChevronRight : ChevronDown
  const [hov, setHov] = useState(false)
  const GrpIcon = groupBy === 'severity'
    ? (sevCfg[group.key as ProblemSeverity]?.Icon || AlertCircle)
    : groupBy === 'source' ? Tag : FileText
  const ic = group.iconColor || 'var(--text-muted)'

  return (
    <div>
      {/* Group header */}
      <div onClick={onToggle} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px',
          cursor: 'pointer', userSelect: 'none', position: 'sticky', top: 0, zIndex: 1,
          background: hov ? 'rgba(255,255,255,0.04)' : 'var(--bg-primary)',
          borderBottom: '1px solid var(--border)',
          fontFamily: 'var(--font-sans, sans-serif)', fontSize: 11,
          fontWeight: 600, color: 'var(--text-primary)', transition: 'background 0.08s',
        }}>
        <Chev size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <GrpIcon size={12} style={{ color: ic, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {group.label}
        </span>
        {group.subLabel && (
          <span style={{
            color: 'var(--text-muted)', fontSize: 10, fontWeight: 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            opacity: 0.7, marginLeft: 2,
          }}>
            {group.subLabel}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {group.errorCount > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--accent-red)', fontSize: 10 }}>
              <AlertCircle size={10} /> {group.errorCount}
            </span>
          )}
          {group.warningCount > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--accent-orange)', fontSize: 10 }}>
              <AlertTriangle size={10} /> {group.warningCount}
            </span>
          )}
          {group.infoCount > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--accent)', fontSize: 10 }}>
              <Info size={10} /> {group.infoCount}
            </span>
          )}
          <span style={{
            marginLeft: 2, padding: '1px 5px', borderRadius: 8,
            background: 'rgba(139,148,158,0.12)', color: 'var(--text-muted)',
            fontSize: 10, fontWeight: 500,
          }}>
            {group.problems.length}
          </span>
        </div>
      </div>

      {/* Problem rows */}
      {!isCollapsed && group.problems.map((p, i) => (
        <ProblemRow key={p.id} problem={p} idx={i} groupBy={groupBy}
          onNav={onNav} onCopy={onCopy} onCtx={onCtx}
          copied={copiedId === p.id} selected={selectedId === p.id}
          onSelect={() => onSelect(p.id)} />
      ))}
    </div>
  )
}

/* ── Problem row ──────────────────────────────────────── */

function ProblemRow({ problem, idx, groupBy, onNav, onCopy, onCtx, copied, selected, onSelect }: {
  problem: Problem; idx: number; groupBy: GroupByMode
  onNav: (f: string, l: number, c?: number) => void; onCopy: (p: Problem) => void
  onCtx: (e: React.MouseEvent, p: Problem) => void
  copied: boolean; selected: boolean; onSelect: () => void
}) {
  const cfg = sevCfg[problem.severity]
  const sc = getSrcColors(problem.source)
  const [hov, setHov] = useState(false)
  const showFile = groupBy !== 'file'
  const fn = fName(problem.file)

  return (
    <div data-pid={problem.id}
      onClick={(e) => { e.stopPropagation(); onSelect(); onNav(problem.file, problem.line, problem.column) }}
      onContextMenu={(e) => onCtx(e, problem)}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '4px 10px 4px 30px', cursor: 'pointer',
        transition: 'background 0.08s',
        background: selected ? 'rgba(88,166,255,0.10)'
          : hov ? 'rgba(255,255,255,0.05)'
          : idx % 2 ? 'rgba(255,255,255,0.015)' : 'transparent',
        borderLeft: selected ? `2px solid var(--accent)` : `2px solid ${hov ? cfg.color : 'transparent'}`,
      }}>
      {/* Severity icon */}
      <cfg.Icon size={13} style={{ color: cfg.color, flexShrink: 0, marginTop: 2 }} />

      {/* Message + source */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <span style={{
          color: 'var(--text-secondary)', lineHeight: 1.5, wordBreak: 'break-word',
          fontFamily: 'var(--font-sans, sans-serif)', fontSize: 12,
        }}>
          {problem.message}
        </span>
        <span style={{
          marginLeft: 6, padding: '0px 5px', borderRadius: 3,
          background: sc.bg, color: sc.fg, fontSize: 10,
          fontFamily: 'var(--font-sans, sans-serif)', fontWeight: 500,
          whiteSpace: 'nowrap', verticalAlign: 'middle',
        }}>
          {problem.source}
        </span>
        {showFile && (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 1, cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onNav(problem.file, problem.line, problem.column) }}
            title={`Open ${problem.file}:${problem.line}`}
          >
            <FileText size={10} style={{ color: fileColor(fn), flexShrink: 0 }} />
            <span style={{
              color: 'var(--accent, #58a6ff)', fontSize: 10,
              fontFamily: 'var(--font-mono, monospace)',
              overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', opacity: 0.8,
              textDecoration: 'underline',
              textDecorationColor: 'rgba(88,166,255,0.3)',
              textUnderlineOffset: 2,
            }}>
              {fn}:{problem.line}
            </span>
          </div>
        )}
      </div>

      {/* Line:column */}
      <span style={{
        display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0,
        color: 'var(--text-muted)', fontSize: 10,
        fontFamily: 'var(--font-mono, monospace)', marginTop: 2, whiteSpace: 'nowrap',
      }}>
        <span style={{ opacity: 0.6 }}>
          Ln {problem.line}{problem.column != null && `, Col ${problem.column}`}
        </span>
      </span>

      {/* Hover actions */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0,
        opacity: hov ? 1 : 0, transition: 'opacity 0.12s',
      }}>
        <button
          onClick={(e) => { e.stopPropagation(); onCopy(problem) }}
          title={copied ? 'Copied!' : 'Copy problem text'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 20, height: 20, border: 'none', borderRadius: 3,
            background: copied ? 'rgba(63,185,80,0.15)' : 'transparent',
            color: copied ? 'var(--accent-green)' : 'var(--text-muted)',
            cursor: 'pointer', transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => { if (!copied) e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = copied ? 'rgba(63,185,80,0.15)' : 'transparent' }}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      </div>
    </div>
  )
}

/* ── Context menu overlay ─────────────────────────────── */

function CtxMenuOverlay({ x, y, problem, onCopy, onNav, onClose }: {
  x: number; y: number; problem: Problem
  onCopy: () => void; onNav: () => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useEffect(() => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      let nx = x, ny = y
      if (x + r.width > window.innerWidth) nx = window.innerWidth - r.width - 4
      if (y + r.height > window.innerHeight) ny = window.innerHeight - r.height - 4
      if (nx < 0) nx = 4; if (ny < 0) ny = 4
      if (nx !== x || ny !== y) setPos({ x: nx, y: ny })
    }
  }, [x, y])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const cfg = sevCfg[problem.severity]

  return (
    <div ref={ref} onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 9999,
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 6, padding: '4px 0', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        minWidth: 220, fontFamily: 'var(--font-sans, sans-serif)', fontSize: 12,
      }}>
      {/* Header */}
      <div style={{ padding: '4px 14px 6px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
          <cfg.Icon size={11} style={{ color: cfg.color, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            {problem.message.length > 50 ? problem.message.substring(0, 50) + '...' : problem.message}
          </span>
        </div>
      </div>

      <CtxItem icon={<ChevronRight size={12} />} label="Go to Problem" shortcut="Enter" onClick={onNav} />
      <CtxItem icon={<Copy size={12} />} label="Copy Problem Text" shortcut="Ctrl+C" onClick={onCopy} />
    </div>
  )
}

function CtxItem({ icon, label, shortcut, onClick }: {
  icon?: ReactNode; label: string; shortcut?: string; onClick: () => void
}) {
  const [h, setH] = useState(false)
  return (
    <div onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 14px',
        cursor: 'pointer',
        color: 'var(--text-primary)',
        background: h ? 'rgba(255,255,255,0.06)' : 'transparent',
        transition: 'background 0.08s',
      }}>
      {icon && <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'var(--text-muted)' }}>{icon}</span>}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {shortcut && <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.6, flexShrink: 0, fontFamily: 'var(--font-mono, monospace)' }}>{shortcut}</span>}
    </div>
  )
}
