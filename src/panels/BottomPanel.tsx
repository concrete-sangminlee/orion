import { useState, useCallback, useEffect, useRef } from 'react'
import TerminalPanel from './TerminalPanel'
import ProblemsPanel from './ProblemsPanel'
import OutputPanel from './OutputPanel'
import { useAgentStore } from '@/store/agents'
import { useProblemsStore } from '@/store/problems'
import { useOutputStore } from '@/store/output'
import { useFileStore } from '@/store/files'
import { useToastStore } from '@/store/toast'
import { ipcErrorMessage } from '@/utils/ipcResult'
import type { TaskScript } from '@shared/ipc-contract'
import {
  Terminal, Activity, AlertTriangle, FileOutput,
  ChevronRight, AlertCircle, Info, Zap, Plus, X, Trash2,
  ChevronDown, Columns2, Ban,
} from 'lucide-react'
import { v4 as uuid } from 'uuid'

// Debug Console and Ports tabs were removed: they showed canned data and had
// no debugger or port-scanning backend.
type Tab = 'terminal' | 'output' | 'problems'

interface TabDef {
  id: Tab
  label: string
  Icon: typeof Terminal
  shortcutLabel?: string
}

const defaultTabOrder: TabDef[] = [
  { id: 'terminal', label: 'Terminal', Icon: Terminal, shortcutLabel: 'Ctrl+`' },
  { id: 'output', label: 'Output', Icon: FileOutput, shortcutLabel: 'Ctrl+Shift+U' },
  { id: 'problems', label: 'Problems', Icon: AlertTriangle, shortcutLabel: 'Ctrl+Shift+M' },
]

const STORAGE_KEY_TAB = 'orion-bottom-panel-active-tab'
const STORAGE_KEY_TAB_ORDER = 'orion-bottom-panel-tab-order'

// Typed into a shell after `npm run`; a name with shell syntax in it would
// run more than the script the user picked, so such scripts are not offered.
const SAFE_SCRIPT_NAME = /^[\w.:@/+-]+$/

/* ── CSS keyframes injected once ──────────────────────── */

const styleId = 'bottom-panel-animations'
if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
  const style = document.createElement('style')
  style.id = styleId
  style.textContent = `
    @keyframes bp-tab-slide-in {
      from { opacity: 0; transform: translateY(2px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes bp-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes bp-accent-grow {
      from { transform: scaleX(0); }
      to   { transform: scaleX(1); }
    }
    @keyframes bp-split-slide {
      from { opacity: 0; flex-basis: 0; }
      to   { opacity: 1; }
    }
    @keyframes bp-badge-pop {
      0%   { transform: scale(0.6); opacity: 0; }
      60%  { transform: scale(1.1); }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes bp-content-fade {
      from { opacity: 0; transform: translateY(2px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .bp-content-animated {
      animation: bp-content-fade 0.18s ease-out;
    }
    .bp-term-tab { transition: background 0.15s, color 0.15s, box-shadow 0.15s; }
    .bp-term-tab:hover { background: rgba(255,255,255,0.05) !important; }
    .bp-term-tab[data-active="true"] {
      background: rgba(255,255,255,0.08) !important;
      box-shadow: inset 0 -1px 0 var(--accent);
    }
    .bp-toolbar-btn {
      transition: background 0.12s, color 0.12s, transform 0.1s;
    }
    .bp-toolbar-btn:hover {
      background: rgba(255,255,255,0.08) !important;
      color: var(--text-primary) !important;
    }
    .bp-toolbar-btn:active { transform: scale(0.92); }
    .bp-rename-input {
      background: var(--bg-primary) !important;
      border: 1px solid var(--accent) !important;
      border-radius: 2px;
      outline: none;
      color: var(--text-primary);
      font-size: 10px;
      padding: 0 4px;
      height: 18px;
      width: 80px;
      font-family: inherit;
    }
    .bp-main-tab {
      transition: color 0.15s, background 0.15s;
      user-select: none;
    }
    .bp-main-tab:hover {
      color: var(--text-secondary) !important;
      background: rgba(255,255,255,0.02) !important;
    }
    .bp-main-tab.bp-tab-active:hover {
      color: var(--text-primary) !important;
      background: transparent !important;
    }
    .bp-drag-over-left {
      box-shadow: inset 2px 0 0 var(--accent);
    }
    .bp-drag-over-right {
      box-shadow: inset -2px 0 0 var(--accent);
    }
    .bp-main-tab[draggable="true"] {
      cursor: grab;
    }
    .bp-main-tab[draggable="true"]:active {
      cursor: grabbing;
    }
    .bp-menu-item {
      transition: background 0.12s, color 0.12s;
    }
    .bp-menu-item:hover {
      background: rgba(255,255,255,0.06);
      color: var(--text-primary);
    }
  `
  document.head.appendChild(style)
}

/* ── Terminal profile definitions ─────────────────────── */

export interface TerminalProfile {
  id: string
  name: string
  shellPath: string
  args: string[]
  icon: string // emoji used as icon
}

const isWindows = navigator.userAgent.includes('Windows') || navigator.platform?.startsWith('Win')

const windowsProfiles: TerminalProfile[] = [
  { id: 'powershell', name: 'PowerShell', shellPath: 'powershell.exe', args: [], icon: 'PS' },
  { id: 'cmd', name: 'Command Prompt', shellPath: 'cmd.exe', args: [], icon: '>' },
  { id: 'gitbash', name: 'Git Bash', shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login', '-i'], icon: '$' },
  { id: 'wsl', name: 'WSL', shellPath: 'wsl.exe', args: [], icon: '#' },
]

const unixProfiles: TerminalProfile[] = [
  { id: 'bash', name: 'bash', shellPath: '/bin/bash', args: ['--login'], icon: '$' },
  { id: 'zsh', name: 'zsh', shellPath: '/bin/zsh', args: ['--login'], icon: '%' },
]

const defaultProfiles = isWindows ? windowsProfiles : unixProfiles

/* ── Log type styling ──────────────────────────────────── */

const logTypeConfig: Record<string, { color: string; borderColor: string; Icon: typeof Info }> = {
  info:       { color: 'var(--accent)',        borderColor: 'rgba(88,166,255,0.3)',  Icon: Info },
  action:     { color: 'var(--accent-green)',  borderColor: 'rgba(63,185,80,0.3)',   Icon: Zap },
  delegation: { color: 'var(--accent-purple)', borderColor: 'rgba(188,140,255,0.3)', Icon: ChevronRight },
  error:      { color: 'var(--accent-red)',    borderColor: 'rgba(248,81,73,0.3)',   Icon: AlertCircle },
}

/* ── Helpers ───────────────────────────────────────────── */

function loadTabOrder(): Tab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TAB_ORDER)
    if (raw) {
      const order = JSON.parse(raw) as Tab[]
      // Validate: all default tabs must be present
      const validIds = new Set(defaultTabOrder.map(t => t.id))
      if (order.every((id: Tab) => validIds.has(id)) && order.length === defaultTabOrder.length) {
        return order
      }
    }
  } catch { /* ignore */ }
  return defaultTabOrder.map(t => t.id)
}

function loadActiveTab(): Tab {
  let stored: string | null = null
  try { stored = localStorage.getItem(STORAGE_KEY_TAB) } catch { /* ignore */ }
  // A tab saved by an older version (e.g. 'ports') must not leave the panel blank.
  return defaultTabOrder.find(t => t.id === stored)?.id ?? 'terminal'
}

/* ── Main component ────────────────────────────────────── */

interface TermInstance {
  id: string
  name: string
  profileId?: string
  shellPath?: string
  shellArgs?: string[]
  /** ID of the terminal this one is split with (shares a row) */
  splitParentId?: string
  /** Named by the user; shell title escapes no longer rename it. */
  renamed?: boolean
  /** Typed into the shell once it has started (task runs). */
  initialCommand?: string
}

/** Hide this panel with display:none rather than unmounting it: unmounting kills every terminal's shell. */
export default function BottomPanel() {
  /* ── Panel state ────────────────────────────────────── */
  const [activeTab, setActiveTabRaw] = useState<Tab>(loadActiveTab)
  const [tabOrder, setTabOrderRaw] = useState<Tab[]>(loadTabOrder)

  /* ── Drag reorder state ─────────────────────────────── */
  const [dragTabId, setDragTabId] = useState<Tab | null>(null)
  const [dragOverTabId, setDragOverTabId] = useState<Tab | null>(null)
  const [dragOverSide, setDragOverSide] = useState<'left' | 'right' | null>(null)

  /* ── Persisted setters ──────────────────────────────── */
  const setActiveTab = useCallback((tab: Tab) => {
    setActiveTabRaw(tab)
    try { localStorage.setItem(STORAGE_KEY_TAB, tab) } catch { /* ignore */ }
  }, [])

  const setTabOrder = useCallback((order: Tab[]) => {
    setTabOrderRaw(order)
    try { localStorage.setItem(STORAGE_KEY_TAB_ORDER, JSON.stringify(order)) } catch { /* ignore */ }
  }, [])

  /* ── Terminal state ─────────────────────────────────── */
  const [terminals, setTerminals] = useState<TermInstance[]>([
    { id: uuid(), name: 'Terminal 1' },
  ])
  const [activeTerminal, setActiveTerminal] = useState<string>(() => terminals[0]?.id || '')
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; termId: string } | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [taskScripts, setTaskScripts] = useState<TaskScript[] | null>(null)
  const taskMenuRef = useRef<HTMLDivElement>(null)
  const logs = useAgentStore((s) => s.logs)

  /* ── Output unread tracking ─────────────────────────── */
  const [outputUnread, setOutputUnread] = useState(0)
  const outputActiveChannel = useOutputStore((s) => s.activeChannel)
  const outputLineCount = useOutputStore((s) => s.channels.get(s.activeChannel)?.length ?? 0)
  const prevOutputLineCountRef = useRef(outputLineCount)

  useEffect(() => {
    if (activeTab === 'output') {
      if (outputUnread !== 0) setOutputUnread(0)
      prevOutputLineCountRef.current = outputLineCount
    } else if (outputLineCount > prevOutputLineCountRef.current) {
      setOutputUnread(prev => prev + (outputLineCount - prevOutputLineCountRef.current))
      prevOutputLineCountRef.current = outputLineCount
    }
  }, [outputLineCount, activeTab, outputUnread])

  /* ── Create terminal with optional profile or task ───── */
  const addTerminal = useCallback((profile?: TerminalProfile, task?: { name: string; command: string }) => {
    const num = terminals.length + 1
    const name = task ? task.name : profile ? `${profile.name} ${num}` : `Terminal ${num}`
    const t: TermInstance = {
      id: uuid(),
      name,
      profileId: profile?.id,
      shellPath: profile?.shellPath,
      shellArgs: profile?.args,
      initialCommand: task?.command,
    }
    setTerminals(prev => [...prev, t])
    setActiveTerminal(t.id)
    setActiveTab('terminal')
    setShowProfileMenu(false)
  }, [terminals.length, setActiveTab])

  const addDefaultTerminal = useCallback(() => {
    addTerminal(undefined)
  }, [addTerminal])

  const closeTerminal = useCallback((id: string) => {
    setTerminals(prev => {
      const next = prev.filter(t => t.id !== id && t.splitParentId !== id)
      const closing = prev.find(t => t.id === id)
      const finalNext = closing?.splitParentId
        ? prev.filter(t => t.id !== id)
        : next
      if (finalNext.length === 0) {
        const t: TermInstance = { id: uuid(), name: 'Terminal 1' }
        setActiveTerminal(t.id)
        return [t]
      }
      if (activeTerminal === id) setActiveTerminal(finalNext[0].id)
      return finalNext
    })
  }, [activeTerminal])

  /* ── Split terminal ──────────────────────────────────── */
  const splitTerminal = useCallback((targetId: string = activeTerminal) => {
    const current = terminals.find(t => t.id === targetId)
    if (!current) return
    const parentId = current.splitParentId || current.id
    const num = terminals.length + 1
    const t: TermInstance = {
      id: uuid(),
      name: `Terminal ${num}`,
      splitParentId: parentId,
    }
    setTerminals(prev => {
      const parentIdx = prev.findIndex(x => x.id === parentId)
      let lastIdx = parentIdx
      for (let i = parentIdx + 1; i < prev.length; i++) {
        if (prev[i].splitParentId === parentId) lastIdx = i
        else break
      }
      const copy = [...prev]
      copy.splice(lastIdx + 1, 0, t)
      return copy
    })
    setActiveTerminal(t.id)
    setActiveTab('terminal')
  }, [terminals, activeTerminal, setActiveTab])

  /* ── Terminal title tracking ─────────────────────────── */
  const handleTitleChange = useCallback((sessionId: string, title: string) => {
    setTerminals(prev =>
      prev.map(t =>
        t.id === sessionId && !t.renamed ? { ...t, name: title || t.name } : t
      )
    )
  }, [])

  /* ── Rename terminal (double-click) ──────────────────── */
  const startRename = useCallback((id: string, currentName: string) => {
    setRenamingId(id)
    setRenameValue(currentName)
  }, [])

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      setTerminals(prev =>
        prev.map(t => t.id === renamingId ? { ...t, name: renameValue.trim(), renamed: true } : t)
      )
    }
    setRenamingId(null)
    setRenameValue('')
  }, [renamingId, renameValue])

  const cancelRename = useCallback(() => {
    setRenamingId(null)
    setRenameValue('')
  }, [])

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  /* ── Clear terminal ──────────────────────────────────── */
  const clearTerminal = useCallback(() => {
    window.dispatchEvent(new CustomEvent('terminal:clear', { detail: { sessionId: activeTerminal } }))
  }, [activeTerminal])

  /* ── Kill terminal (unmounting its TerminalPanel kills the ptys) ── */
  const killTerminal = useCallback((id: string) => {
    closeTerminal(id)
    setContextMenu(null)
  }, [closeTerminal])

  /* ── Tasks: package.json scripts, each run in a new terminal ── */
  // A new terminal starts in the workspace folder, whatever the others cd'd to.
  const runScript = useCallback((name: string) => {
    setTaskScripts(null)
    addTerminal(undefined, { name: `npm: ${name}`, command: `npm run ${name}` })
  }, [addTerminal])

  const loadScripts = useCallback(async (): Promise<TaskScript[] | null> => {
    const { addToast } = useToastStore.getState()
    const rootPath = useFileStore.getState().rootPath
    if (!rootPath) {
      addToast({ type: 'info', message: 'Open a folder to run its tasks' })
      return null
    }
    try {
      const scripts = (await window.api.taskListScripts(rootPath)).filter(s => SAFE_SCRIPT_NAME.test(s.name))
      if (scripts.length === 0) {
        addToast({ type: 'info', message: 'No npm scripts found in package.json' })
        return null
      }
      return scripts
    } catch (err) {
      addToast({ type: 'error', message: `Could not read package.json scripts: ${ipcErrorMessage(err)}` })
      return null
    }
  }, [])

  const runBuildTask = useCallback(async () => {
    const scripts = await loadScripts()
    if (!scripts) return
    if (scripts.some(s => s.name === 'build')) runScript('build')
    else useToastStore.getState().addToast({ type: 'info', message: 'No "build" script in package.json' })
  }, [loadScripts, runScript])

  const pickTask = useCallback(async () => {
    const scripts = await loadScripts()
    if (!scripts) return
    setActiveTab('terminal')
    setTaskScripts(scripts)
  }, [loadScripts, setActiveTab])

  /* ── Commands from the palette and menus ─────────────── */
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'orion:new-terminal': () => addDefaultTerminal(),
      'orion:split-terminal': () => splitTerminal(),
      'orion:clear-terminal': () => clearTerminal(),
      'orion:kill-terminal': () => killTerminal(activeTerminal),
      'orion:run-build': () => { void runBuildTask() },
      'orion:run-task': () => { void pickTask() },
    }
    for (const [name, handler] of Object.entries(handlers)) window.addEventListener(name, handler)
    return () => {
      for (const [name, handler] of Object.entries(handlers)) window.removeEventListener(name, handler)
    }
  }, [addDefaultTerminal, splitTerminal, clearTerminal, killTerminal, activeTerminal, runBuildTask, pickTask])

  /* ── Close task picker on outside click / Escape ─────── */
  useEffect(() => {
    if (!taskScripts) return
    const onMouseDown = (e: MouseEvent) => {
      if (taskMenuRef.current && !taskMenuRef.current.contains(e.target as Node)) setTaskScripts(null)
    }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setTaskScripts(null) }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [taskScripts])

  /* ── Close context menu on outside click ─────────────── */
  useEffect(() => {
    if (!contextMenu) return
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu])

  /* ── Close profile dropdown on outside click ─────────── */
  useEffect(() => {
    if (!showProfileMenu) return
    const handler = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showProfileMenu])

  /* ── Keyboard shortcuts ──────────────────────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Shift+` = new terminal. Shift turns e.key into '~', so match
      // the physical key. Sent as the palette command so that App, which
      // owns the panel's visibility, also shows the panel.
      if (e.ctrlKey && e.shiftKey && e.code === 'Backquote') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('orion:new-terminal'))
        return
      }
      // Ctrl+` = toggle/focus terminal tab
      if (e.ctrlKey && !e.shiftKey && e.code === 'Backquote') {
        e.preventDefault()
        setActiveTab('terminal')
        return
      }
      // Ctrl+Shift+M = problems
      if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
        e.preventDefault()
        setActiveTab('problems')
        return
      }
      // Ctrl+Shift+U = output
      if (e.ctrlKey && e.shiftKey && (e.key === 'U' || e.key === 'u')) {
        e.preventDefault()
        setActiveTab('output')
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setActiveTab])

  /* ── Tab drag reorder ────────────────────────────────── */
  const handleTabDragStart = useCallback((e: React.DragEvent, tabId: Tab) => {
    setDragTabId(tabId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', tabId)
    // Make the drag image semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5'
    }
  }, [])

  const handleTabDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1'
    }
    setDragTabId(null)
    setDragOverTabId(null)
    setDragOverSide(null)
  }, [])

  const handleTabDragOver = useCallback((e: React.DragEvent, tabId: Tab) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragTabId || dragTabId === tabId) {
      setDragOverTabId(null)
      setDragOverSide(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    const side = e.clientX < midX ? 'left' : 'right'
    setDragOverTabId(tabId)
    setDragOverSide(side)
  }, [dragTabId])

  const handleTabDrop = useCallback((e: React.DragEvent, targetTabId: Tab) => {
    e.preventDefault()
    if (!dragTabId || dragTabId === targetTabId) return

    const currentOrder = [...tabOrder]
    const dragIdx = currentOrder.indexOf(dragTabId)
    if (dragIdx === -1) return

    // Remove dragged tab
    currentOrder.splice(dragIdx, 1)
    // Find target position
    let targetIdx = currentOrder.indexOf(targetTabId)
    if (dragOverSide === 'right') targetIdx += 1
    currentOrder.splice(targetIdx, 0, dragTabId)
    setTabOrder(currentOrder)

    setDragTabId(null)
    setDragOverTabId(null)
    setDragOverSide(null)
  }, [dragTabId, dragOverSide, tabOrder, setTabOrder])

  /* ── Counts for badges ──────────────────────────────── */
  const problems = useProblemsStore((s) => s.problems)
  const problemsErrorCount = problems.filter((p) => p.severity === 'error').length
  const problemsWarningCount = problems.filter((p) => p.severity === 'warning').length
  const problemsBadge = problemsErrorCount + problemsWarningCount
  const terminalSessionCount = terminals.filter(t => !t.splitParentId).length

  const getBadge = useCallback((tabId: Tab): { count: number; color: string; bgColor: string; secondary?: { count: number; color: string } } | null => {
    switch (tabId) {
      case 'problems':
        if (problemsErrorCount > 0 || problemsWarningCount > 0) {
          return {
            count: problemsErrorCount,
            color: problemsErrorCount > 0 ? 'var(--accent-red)' : 'var(--accent-orange)',
            bgColor: problemsErrorCount > 0 ? 'rgba(248,81,73,0.15)' : 'rgba(227,179,65,0.15)',
            ...(problemsWarningCount > 0 && problemsErrorCount > 0
              ? { secondary: { count: problemsWarningCount, color: 'var(--accent-orange)' } }
              : {}),
            ...(problemsErrorCount === 0 ? { count: problemsWarningCount } : {}),
          }
        }
        return null
      case 'output':
        return outputUnread > 0
          ? { count: outputUnread, color: 'var(--accent)', bgColor: 'rgba(88,166,255,0.12)' }
          : null
      case 'terminal':
        return terminalSessionCount > 1
          ? { count: terminalSessionCount, color: 'var(--accent-green, var(--accent))', bgColor: 'rgba(63,185,80,0.12)' }
          : null
      default:
        return null
    }
  }, [problemsErrorCount, problemsWarningCount, outputUnread, terminalSessionCount])

  /* ── Build split groups for rendering ────────────────── */
  const terminalGroups = buildTerminalGroups(terminals)

  const activeGroup = terminalGroups.find(g =>
    g.some(t => t.id === activeTerminal)
  )
  const activeGroupParentId = activeGroup?.[0]?.splitParentId || activeGroup?.[0]?.id

  /* ── Resolve ordered tabs ───────────────────────────── */
  const tabDefMap = new Map(defaultTabOrder.map(t => [t.id, t]))
  const orderedTabs = tabOrder
    .map(id => tabDefMap.get(id))
    .filter((t): t is TabDef => t != null)

  /* ── Render ──────────────────────────────────────────── */
  // The app layout sizes this panel (its wrapper and Resizer own the height),
  // so fill the wrapper instead of keeping a second, competing height.
  return (
    <div
      className="flex flex-col"
      style={{
        height: '100%',
        position: 'relative',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-primary)',
      }}
    >
      {/* ── Tab Bar ─────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center px-1 gap-0"
        style={{
          height: 34,
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {orderedTabs.map(({ id, label, Icon, shortcutLabel }) => {
          const isActive = activeTab === id
          const badge = getBadge(id)
          const isDragOver = dragOverTabId === id && dragTabId !== id

          // Show channel name in Output tab when not Main
          const displayLabel =
            id === 'output' && outputActiveChannel !== 'Orion'
              ? `${label}: ${outputActiveChannel}`
              : label

          return (
            <button
              key={id}
              data-tab-button
              draggable
              onDragStart={(e) => handleTabDragStart(e, id)}
              onDragEnd={handleTabDragEnd}
              onDragOver={(e) => handleTabDragOver(e, id)}
              onDrop={(e) => handleTabDrop(e, id)}
              onDragLeave={() => { setDragOverTabId(null); setDragOverSide(null) }}
              onClick={() => setActiveTab(id)}
              className={`bp-main-tab flex items-center gap-1.5 relative${isActive ? ' bp-tab-active' : ''}${isDragOver && dragOverSide === 'left' ? ' bp-drag-over-left' : ''}${isDragOver && dragOverSide === 'right' ? ' bp-drag-over-right' : ''}`}
              style={{
                height: 34,
                padding: '0 12px',
                fontSize: 11,
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: isActive ? 500 : 400,
                background: 'transparent',
                border: 'none',
                cursor: 'grab',
                opacity: dragTabId === id ? 0.5 : 1,
              }}
              title={shortcutLabel ? `${label} (${shortcutLabel})` : label}
            >
              <Icon size={12} />
              {displayLabel}

              {/* Badge */}
              {badge && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    padding: '0 4px',
                    background: badge.bgColor,
                    color: badge.color,
                    fontFamily: 'var(--font-mono, monospace)',
                    animation: 'bp-badge-pop 0.25s ease',
                  }}
                >
                  {badge.count > 99 ? '99+' : badge.count}
                  {badge.secondary && badge.secondary.count > 0 && (
                    <>
                      <span style={{ opacity: 0.4, fontSize: 8 }}>/</span>
                      <span style={{ color: badge.secondary.color }}>
                        {badge.secondary.count > 99 ? '99+' : badge.secondary.count}
                      </span>
                    </>
                  )}
                </span>
              )}

              {/* Active bottom accent line */}
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 8,
                    right: 8,
                    height: 2,
                    background: 'var(--accent)',
                    borderRadius: '2px 2px 0 0',
                    animation: 'bp-accent-grow 0.2s ease',
                    transformOrigin: 'center',
                  }}
                />
              )}
            </button>
          )
        })}

        {/* ── Separator ────────────────────────────────────── */}
        <div
          style={{
            width: 1,
            height: 16,
            background: 'var(--border)',
            margin: '0 4px',
            opacity: 0.5,
          }}
        />

        {/* Right side: terminal sub-tabs + panel controls */}
        <div className="ml-auto flex items-center gap-0.5" style={{ paddingRight: 4 }}>
          {activeTab === 'terminal' && (
            <>
              {/* Terminal instance tabs */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  marginRight: 4,
                  maxWidth: 400,
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  scrollbarWidth: 'none',
                }}
              >
                {terminals.filter(t => !t.splitParentId).map(t => {
                  const isActive = activeTerminal === t.id ||
                    terminals.some(s => s.splitParentId === t.id && s.id === activeTerminal)
                  const splitChildren = terminals.filter(s => s.splitParentId === t.id)
                  const hasSplits = splitChildren.length > 0

                  const tooltipParts = [t.name]
                  if (t.shellPath) tooltipParts.push(`Shell: ${t.shellPath}`)
                  if (hasSplits) tooltipParts.push(`+${splitChildren.length} split`)

                  return (
                    <div
                      key={t.id}
                      className="bp-term-tab"
                      data-active={isActive}
                      onClick={() => setActiveTerminal(t.id)}
                      onDoubleClick={() => startRename(t.id, t.name)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setContextMenu({ x: e.clientX, y: e.clientY, termId: t.id })
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 3,
                        height: 24, padding: '0 6px 0 8px',
                        fontSize: 10, borderRadius: 4,
                        color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                        background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
                        border: 'none', cursor: 'pointer',
                        maxWidth: 160,
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        animation: 'bp-tab-slide-in 0.15s ease',
                        position: 'relative',
                      }}
                      title={tooltipParts.join('\n')}
                    >
                      <Terminal size={10} style={{ flexShrink: 0, opacity: 0.7 }} />
                      {renamingId === t.id ? (
                        <input
                          ref={renameInputRef}
                          className="bp-rename-input"
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') cancelRename()
                          }}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t.name}
                        </span>
                      )}
                      {hasSplits && (
                        <Columns2 size={9} style={{ flexShrink: 0, opacity: 0.4 }} />
                      )}
                      <span
                        onClick={e => { e.stopPropagation(); closeTerminal(t.id) }}
                        style={{
                          display: 'flex', alignItems: 'center',
                          marginLeft: 2, opacity: 0, cursor: 'pointer', flexShrink: 0,
                          transition: 'opacity 0.1s',
                          padding: 1,
                          borderRadius: 2,
                        }}
                        className="bp-close-x"
                        onMouseEnter={e => {
                          e.currentTarget.style.opacity = '1'
                          e.currentTarget.style.background = 'rgba(248,81,73,0.15)'
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.opacity = '0'
                          e.currentTarget.style.background = 'transparent'
                        }}
                      >
                        <X size={10} />
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* ── Action buttons ──────────────────────────── */}

              {/* New terminal button */}
              <button
                className="bp-toolbar-btn"
                onClick={addDefaultTerminal}
                title="New Terminal (Ctrl+Shift+`)"
                style={{
                  width: 24, height: 24,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 4, border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', background: 'transparent',
                }}
              >
                <Plus size={13} />
              </button>

              {/* Split terminal button */}
              <button
                className="bp-toolbar-btn"
                onClick={() => splitTerminal()}
                title="Split Terminal"
                style={{
                  width: 24, height: 24,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 4, border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', background: 'transparent',
                }}
              >
                <Columns2 size={13} />
              </button>

              {/* Profile dropdown button */}
              <div style={{ position: 'relative' }} ref={profileMenuRef}>
                <button
                  className="bp-toolbar-btn"
                  onClick={() => setShowProfileMenu(prev => !prev)}
                  title="Select Terminal Profile"
                  style={{
                    width: 24, height: 24,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 4, border: 'none', cursor: 'pointer',
                    color: showProfileMenu ? 'var(--text-primary)' : 'var(--text-muted)',
                    background: showProfileMenu ? 'rgba(255,255,255,0.08)' : 'transparent',
                  }}
                >
                  <ChevronDown size={13} />
                </button>

                {/* Profile dropdown menu */}
                {showProfileMenu && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 28,
                      right: 0,
                      minWidth: 200,
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '4px 0',
                      zIndex: 1000,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                      animation: 'bp-fade-in 0.12s ease',
                    }}
                  >
                    <div
                      style={{
                        padding: '4px 10px',
                        fontSize: 10,
                        color: 'var(--text-muted)',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      Terminal Profiles
                    </div>
                    {defaultProfiles.map(profile => (
                      <button
                        key={profile.id}
                        onClick={() => addTerminal(profile)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          width: '100%',
                          padding: '6px 10px',
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'background 0.12s, color 0.12s',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                          e.currentTarget.style.color = 'var(--text-primary)'
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.color = 'var(--text-secondary)'
                        }}
                      >
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 4,
                            background: 'rgba(255,255,255,0.04)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            fontWeight: 700,
                            fontFamily: 'var(--font-mono, monospace)',
                            color: 'var(--accent)',
                            flexShrink: 0,
                          }}
                        >
                          {profile.icon}
                        </span>
                        <span>{profile.name}</span>
                        <span
                          style={{
                            marginLeft: 'auto',
                            fontSize: 9,
                            color: 'var(--text-muted)',
                            opacity: 0.6,
                            fontFamily: 'var(--font-mono, monospace)',
                          }}
                        >
                          {profile.shellPath.split(/[/\\]/).pop()}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Separator */}
              <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 3px', opacity: 0.4 }} />

              {/* Clear terminal button */}
              <button
                className="bp-toolbar-btn"
                onClick={clearTerminal}
                title="Clear Terminal"
                style={{
                  width: 24, height: 24,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 4, border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', background: 'transparent',
                }}
              >
                <Ban size={13} />
              </button>

              {/* Kill terminal button */}
              <button
                className="bp-toolbar-btn"
                onClick={() => killTerminal(activeTerminal)}
                title="Kill Terminal"
                style={{
                  width: 24, height: 24,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 4, border: 'none', cursor: 'pointer',
                  color: 'var(--accent-red, #f85149)', background: 'transparent',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(248,81,73,0.15)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Trash2 size={13} />
              </button>
            </>
          )}

          {/* ── Panel action buttons (always visible) ──────── */}
          <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 3px', opacity: 0.4 }} />

          {/* Close panel button */}
          <button
            className="bp-toolbar-btn"
            // App owns the panel's visibility; this is the event it toggles on.
            onClick={() => window.dispatchEvent(new CustomEvent('orion:toggle-terminal'))}
            title="Close Panel"
            style={{
              width: 24, height: 24,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 4, border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', background: 'transparent',
            }}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── Content area ───────────────────────────────────── */}
      <div className="flex-1 overflow-hidden bp-content-animated" style={{ position: 'relative' }}>
        {/* Terminals stay mounted (display:none) while another tab is shown:
            unmounting a terminal kills its shell. */}
        <div style={{ height: '100%', display: activeTab === 'terminal' ? 'block' : 'none' }}>
          {terminalGroups.map(group => {
            const parentId = group[0].splitParentId || group[0].id
            const isGroupVisible = parentId === activeGroupParentId
            // Hidden groups keep the visible element shape so that showing
            // another group does not remount (and kill) these terminals.
            return (
              <div
                key={parentId}
                style={{
                  display: isGroupVisible ? 'flex' : 'none',
                  height: '100%',
                  gap: 0,
                }}
              >
                {group.map((t, idx) => (
                  <div
                    key={t.id}
                    style={{
                      flex: 1,
                      height: '100%',
                      position: 'relative',
                      borderLeft: idx > 0 ? '1px solid var(--border)' : 'none',
                      animation: group.length > 1 ? 'bp-split-slide 0.2s ease' : undefined,
                    }}
                    onClick={() => setActiveTerminal(t.id)}
                  >
                    {/* Split pane header */}
                    {group.length > 1 && (
                      <div
                        style={{
                          height: 24,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '0 8px',
                          background: activeTerminal === t.id
                            ? 'rgba(88,166,255,0.06)'
                            : 'rgba(255,255,255,0.01)',
                          borderBottom: `1px solid ${activeTerminal === t.id ? 'rgba(88,166,255,0.2)' : 'var(--border)'}`,
                          fontSize: 10,
                          color: activeTerminal === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
                          transition: 'background 0.15s, border-color 0.15s',
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        <Terminal size={10} style={{ opacity: 0.6 }} />
                        {renamingId === t.id ? (
                          <input
                            ref={renameInputRef}
                            className="bp-rename-input"
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitRename()
                              if (e.key === 'Escape') cancelRename()
                            }}
                            onClick={e => e.stopPropagation()}
                          />
                        ) : (
                          <span
                            onDoubleClick={() => startRename(t.id, t.name)}
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t.name}
                          </span>
                        )}
                        <span style={{ flex: 1 }} />
                        <span
                          onClick={e => { e.stopPropagation(); closeTerminal(t.id) }}
                          className="bp-toolbar-btn"
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 18, height: 18,
                            borderRadius: 3,
                            cursor: 'pointer',
                            color: 'var(--text-muted)',
                            background: 'transparent',
                            border: 'none',
                          }}
                          title="Close split"
                        >
                          <X size={10} />
                        </span>
                      </div>
                    )}
                    <div style={{ height: group.length > 1 ? 'calc(100% - 24px)' : '100%' }}>
                      <TerminalPanel
                        key={t.id}
                        sessionId={t.id}
                        shellPath={t.shellPath}
                        shellArgs={t.shellArgs}
                        initialCommand={t.initialCommand}
                        onTitleChange={handleTitleChange}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {activeTab === 'problems' && <ProblemsPanel />}

        {activeTab === 'output' && <OutputPanel />}

        {/* ── Run Task picker (package.json scripts) ─────── */}
        {taskScripts && (
          <div
            ref={taskMenuRef}
            role="menu"
            aria-label="Run Task"
            style={{
              position: 'absolute',
              top: 6,
              right: 8,
              minWidth: 240,
              maxWidth: '60%',
              maxHeight: '85%',
              overflowY: 'auto',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 0',
              zIndex: 1000,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              animation: 'bp-fade-in 0.12s ease',
            }}
          >
            <div
              style={{
                padding: '4px 10px',
                fontSize: 10,
                color: 'var(--text-muted)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Run Task
            </div>
            {taskScripts.map(script => (
              <button
                key={script.name}
                role="menuitem"
                className="bp-menu-item"
                onClick={() => runScript(script.name)}
                title={script.command}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 10px',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ flexShrink: 0 }}>{script.name}</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono, monospace)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {script.command}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Terminal tab context menu ────────────────────── */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            minWidth: 180,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '4px 0',
            zIndex: 10000,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            animation: 'bp-fade-in 0.1s ease',
          }}
        >
          {[
            { label: 'Rename', action: () => {
              const t = terminals.find(t => t.id === contextMenu.termId)
              if (t) startRename(t.id, t.name)
              setContextMenu(null)
            }},
            { label: 'Split Terminal', action: () => {
              splitTerminal(contextMenu.termId)
              setContextMenu(null)
            }},
            { label: 'Clear Terminal', action: () => {
              window.dispatchEvent(new CustomEvent('terminal:clear', { detail: { sessionId: contextMenu.termId } }))
              setContextMenu(null)
            }},
            { divider: true } as any,
            { label: 'Kill Terminal', danger: true, action: () => {
              killTerminal(contextMenu.termId)
            }},
          ].map((item, i) =>
            item.divider ? (
              <div
                key={`div-${i}`}
                style={{ height: 1, background: 'var(--border)', margin: '4px 0', opacity: 0.5 }}
              />
            ) : (
              <button
                key={item.label}
                onClick={item.action}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '5px 12px',
                  fontSize: 11,
                  color: item.danger ? 'var(--accent-red)' : 'var(--text-secondary)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.1s, color 0.1s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = item.danger
                    ? 'rgba(248,81,73,0.1)'
                    : 'rgba(255,255,255,0.06)'
                  e.currentTarget.style.color = item.danger
                    ? 'var(--accent-red)'
                    : 'var(--text-primary)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = item.danger
                    ? 'var(--accent-red)'
                    : 'var(--text-secondary)'
                }}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}

      {/* ── Global style for close-on-hover terminal tabs ── */}
      <style>{`
        .bp-term-tab:hover .bp-close-x { opacity: 0.5 !important; }
        .bp-term-tab .bp-close-x:hover { opacity: 1 !important; }
      `}</style>
    </div>
  )
}

/* ── Build terminal groups (parent + splits) ──────────── */

function buildTerminalGroups(terminals: TermInstance[]): TermInstance[][] {
  const groups: TermInstance[][] = []
  const used = new Set<string>()

  for (const t of terminals) {
    if (used.has(t.id)) continue
    if (t.splitParentId) continue

    const group = [t]
    used.add(t.id)

    for (const s of terminals) {
      if (s.splitParentId === t.id && !used.has(s.id)) {
        group.push(s)
        used.add(s.id)
      }
    }
    groups.push(group)
  }
  return groups
}
