import React, { useState, useCallback, useEffect, useRef, Suspense } from 'react'
import type { FileNode, OpenFile } from '@shared/types'
import { Upload } from 'lucide-react'
import { useFileWatcher, useExternalFileWatcher } from './hooks/useIpc'
import { useOmo } from './hooks/useOmo'
import { loadLayout, useLayoutPersistence } from './hooks/useLayoutPersistence'
import { useRecoveryCheck } from './hooks/useAutoSave'
import { useGitCommands } from './hooks/useGitCommands'
import { installWindowCloseGuard } from './utils/closeGuard'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { useWorkspaceStore } from '@/store/workspace'
import { useToastStore } from '@/store/toast'
import ErrorBoundary from './components/ErrorBoundary'
import SplashScreen from './components/SplashScreen'
import TitleBar from './components/TitleBar'
import ActivityBar, { type PanelView } from './components/ActivityBar'
import Resizer from './components/Resizer'
import StatusBar from './components/StatusBar'
import CommandPalette from '@/components/CommandPalette'
import ToastContainer from '@/components/Toast'
import { ipcErrorMessage } from '@/utils/ipcResult'
import { openFileInEditor } from '@/utils/openFileInEditor'
import { runCommand } from '@/commands/registry'
import { PALETTE_MODES, type PaletteMode } from '@/commands/appCommands'
import { useCommandBridges } from '@/commands/useCommandBridges'
import { appShortcutCommand, listenForChords } from '@/commands/shortcuts'
import { migrateLegacyApiKeys } from '@/utils/apiKeys'
import FileExplorer from './panels/FileExplorer'
import BottomPanel from './panels/BottomPanel'
import {
  DEFAULT_SIDE_PANEL_WIDTH,
  DEFAULT_RIGHT_PANEL_WIDTH,
  DEFAULT_BOTTOM_PANEL_HEIGHT,
  SIDE_PANEL_MIN,
  SIDE_PANEL_MAX,
  RIGHT_PANEL_MIN,
  RIGHT_PANEL_MAX,
  BOTTOM_PANEL_MIN,
  BOTTOM_PANEL_MAX,
  SIDE_PANEL_SNAP_POINTS,
  RIGHT_PANEL_SNAP_POINTS,
  BOTTOM_PANEL_SNAP_POINTS,
} from '@shared/constants'
import type { ResizerConstraints } from './components/Resizer'

// Lazy-loaded panel components (not immediately visible)
const ChatPanel = React.lazy(() => import('./panels/ChatPanel'))
const SearchPanel = React.lazy(() => import('@/panels/SearchPanel'))
const SourceControlPanel = React.lazy(() => import('@/panels/SourceControlPanel'))
const OutlinePanel = React.lazy(() => import('@/panels/OutlinePanel'))
const EditorPanel = React.lazy(() => import('./panels/EditorPanel'))

// Lazy-loaded editor-area components
const DiffEditor = React.lazy(() => import('./components/DiffEditor'))

// Lazy-loaded modal/dialog components (only shown on demand)
const SettingsModal = React.lazy(() => import('./components/SettingsModal'))
const KeyboardShortcuts = React.lazy(() => import('./components/KeyboardShortcuts'))
const AboutDialog = React.lazy(() => import('./components/AboutDialog'))
const SnippetManager = React.lazy(() => import('@/components/SnippetManager'))

/** Workspace trust key prefix in localStorage */
const WORKSPACE_TRUST_KEY = 'orion-workspace-trust'

/** Minimal loading placeholder for lazy panels with shimmer animation */
function PanelFallback() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%',
        gap: 12,
        padding: 24,
      }}
    >
      <style>{`
        @keyframes orion-shimmer {
          0% { opacity: 0.3; }
          50% { opacity: 0.6; }
          100% { opacity: 0.3; }
        }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 280 }}>
        <div style={{
          height: 10,
          width: '70%',
          borderRadius: 4,
          background: 'var(--border)',
          animation: 'orion-shimmer 1.5s ease-in-out infinite',
        }} />
        <div style={{
          height: 10,
          width: '100%',
          borderRadius: 4,
          background: 'var(--border)',
          animation: 'orion-shimmer 1.5s ease-in-out infinite',
          animationDelay: '0.15s',
        }} />
        <div style={{
          height: 10,
          width: '85%',
          borderRadius: 4,
          background: 'var(--border)',
          animation: 'orion-shimmer 1.5s ease-in-out infinite',
          animationDelay: '0.3s',
        }} />
        <div style={{
          height: 10,
          width: '60%',
          borderRadius: 4,
          background: 'var(--border)',
          animation: 'orion-shimmer 1.5s ease-in-out infinite',
          animationDelay: '0.45s',
        }} />
      </div>
    </div>
  )
}

// Compute initial layout once (before first render) so values are read synchronously
const initialLayout = loadLayout({
  sidePanelWidth: DEFAULT_SIDE_PANEL_WIDTH,
  rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
  bottomPanelHeight: DEFAULT_BOTTOM_PANEL_HEIGHT,
  sidebarVisible: true,
  bottomVisible: true,
  chatVisible: true,
})

export default function App() {
  const [splashDone, setSplashDone] = useState(false)
  const [activeView, setActiveView] = useState<PanelView>('explorer')
  const [sidePanelWidth, setSidePanelWidth] = useState(initialLayout.sidePanelWidth)
  const [rightPanelWidth, setRightPanelWidth] = useState(initialLayout.rightPanelWidth)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(initialLayout.bottomPanelHeight)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // What the palette shows when it opens, and a counter that remounts it so
  // a request made while it is open (Color Theme from its own list) applies.
  const [palette, setPalette] = useState<{ mode: PaletteMode; request: number }>({ mode: 'files', request: 0 })
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [snippetsOpen, setSnippetsOpen] = useState(false)
  const [sidebarVisible, setSidebarVisible] = useState(initialLayout.sidebarVisible)
  const [bottomVisible, setBottomVisible] = useState(initialLayout.bottomVisible)
  const [chatVisible, setChatVisible] = useState(initialLayout.chatVisible)
  const [zenMode, setZenMode] = useState(false)
  const [zenExitVisible, setZenExitVisible] = useState(false)
  const zenExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Window focus/blur tracking ────────────────────────
  const [windowFocused, setWindowFocused] = useState(true)

  useEffect(() => {
    const onFocus = () => setWindowFocused(true)
    const onBlur = () => setWindowFocused(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // ── Focus management refs ──────────────────────────────
  // Track which element had focus before a modal opened so we can return focus on close
  const modalTriggerRef = useRef<HTMLElement | null>(null)

  // Screen reader live region announcement
  const [liveAnnouncement, setLiveAnnouncement] = useState('')

  /** Announce a message to screen readers via aria-live region */
  const announce = useCallback((message: string) => {
    setLiveAnnouncement('')
    // Use rAF to ensure DOM clears before re-setting, so screen readers re-announce
    requestAnimationFrame(() => setLiveAnnouncement(message))
  }, [])

  // ── Diff editor state ──────────────────────────────────
  const [diffView, setDiffView] = useState<{
    original: string
    modified: string
    originalPath: string
    modifiedPath: string
  } | null>(null)

  // ── Workspace trust banner ─────────────────────────────
  const [workspaceTrustDismissed, setWorkspaceTrustDismissed] = useState(true)

  // ── Modal open/close helpers with focus management ──────
  const openModal = useCallback((setter: React.Dispatch<React.SetStateAction<boolean>>) => {
    modalTriggerRef.current = document.activeElement as HTMLElement | null
    setter(true)
  }, [])

  const closeModal = useCallback((setter: React.Dispatch<React.SetStateAction<boolean>>) => {
    setter(false)
    // Return focus to the element that triggered the modal
    requestAnimationFrame(() => {
      modalTriggerRef.current?.focus()
      modalTriggerRef.current = null
    })
  }, [])

  // Store pre-zen state so we can restore on exit
  const preZenState = useRef<{
    sidebar: boolean
    bottom: boolean
    chat: boolean
  } | null>(null)

  const toggleZenMode = useCallback(() => {
    setZenMode((prev) => {
      if (!prev) {
        // Entering zen mode: save current state and hide everything
        preZenState.current = {
          sidebar: sidebarVisible,
          bottom: bottomVisible,
          chat: chatVisible,
        }
        setSidebarVisible(false)
        setBottomVisible(false)
        setChatVisible(false)
      } else {
        // Exiting zen mode: restore previous state
        if (preZenState.current) {
          setSidebarVisible(preZenState.current.sidebar)
          setBottomVisible(preZenState.current.bottom)
          setChatVisible(preZenState.current.chat)
          preZenState.current = null
        } else {
          setSidebarVisible(true)
          setBottomVisible(true)
          setChatVisible(true)
        }
      }
      return !prev
    })
  }, [sidebarVisible, bottomVisible, chatVisible])

  // Show zen exit hint for 3 seconds when entering zen mode
  useEffect(() => {
    if (zenMode) {
      setZenExitVisible(true)
      zenExitTimerRef.current = setTimeout(() => setZenExitVisible(false), 3000)
    } else {
      setZenExitVisible(false)
      if (zenExitTimerRef.current) clearTimeout(zenExitTimerRef.current)
    }
    return () => {
      if (zenExitTimerRef.current) clearTimeout(zenExitTimerRef.current)
    }
  }, [zenMode])

  // ── Global drag-and-drop from OS file manager ──────────────────
  const [globalDragOver, setGlobalDragOver] = useState(false)
  const globalDragCounterRef = useRef(0)

  const handleGlobalDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    globalDragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setGlobalDragOver(true)
    }
  }, [])

  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleGlobalDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    globalDragCounterRef.current--
    if (globalDragCounterRef.current <= 0) {
      globalDragCounterRef.current = 0
      setGlobalDragOver(false)
    }
  }, [])

  const applyWorkspaceTree = useCallback(async (folderPath: string, tree: FileNode[], successMessage?: string) => {
    const { setRootPath, setFileTree } = useFileStore.getState()
    setRootPath(folderPath)
    await useWorkspaceStore.getState().loadWorkspaceSettings(folderPath)
    setFileTree(tree)
    window.api.watchStart(folderPath)

    if (successMessage) {
      useToastStore.getState().addToast({ type: 'success', message: successMessage, duration: 2000 })
    }

    setSidebarVisible(true)
    setActiveView('explorer')
  }, [])

  const openWorkspacePath = useCallback(async (folderPath: string, successMessage?: string) => {
    try {
      const tree = await window.api.openWorkspace(folderPath)
      await applyWorkspaceTree(folderPath, tree, successMessage)
    } catch (err) {
      // Keep the current workspace; an unreadable folder must not look like an empty one.
      useToastStore.getState().addToast({ type: 'error', message: `Could not open folder: ${ipcErrorMessage(err)}` })
    }
  }, [applyWorkspaceTree])

  const promptOpenWorkspace = useCallback(async () => {
    const folderPath = await window.api?.openFolder?.()
    if (folderPath) {
      await openWorkspacePath(folderPath)
    }
  }, [openWorkspacePath])

  const handleOpenFolderEvent = useCallback((event?: Event) => {
    const folderPath = (event as CustomEvent<string | undefined> | undefined)?.detail
    if (typeof folderPath === 'string' && folderPath.trim()) {
      void openWorkspacePath(folderPath)
      return
    }
    void promptOpenWorkspace()
  }, [openWorkspacePath, promptOpenWorkspace])

  const handleGlobalDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    globalDragCounterRef.current = 0
    setGlobalDragOver(false)

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    const { addToast } = useToastStore.getState()
    const { openFile } = useEditorStore.getState()

    // A single dropped folder becomes the workspace. openWorkspace rejects for
    // anything that is not a folder, which then opens as a file below.
    if (files.length === 1) {
      const droppedFile = files[0]
      const filePath = window.api.pathForDroppedFile(droppedFile)
      if (filePath) {
        try {
          // Try to read as directory first
          const tree = await window.api.openWorkspace(filePath)
          await applyWorkspaceTree(filePath, tree, `Opened folder: ${droppedFile.name}`)
          return
        } catch {
          // Not a directory, fall through to open as file
        }
      }
    }

    // Open files in the editor
    let openedCount = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const filePath = window.api.pathForDroppedFile(file)
      if (!filePath) continue

      // Try opening as a folder first for multi-drops
      try {
        const tree = await window.api.readDir(filePath)
        if (tree && Array.isArray(tree)) {
          // Skip folders in multi-file drop (only first single folder gets set as workspace)
          continue
        }
      } catch {
        // Not a directory, open as file
      }

      try {
        const result = await window.api.readFile(filePath)
        openFile(
          {
            path: filePath,
            name: file.name,
            content: result.content,
            language: result.language,
            isModified: false,
            aiModified: false,
          },
          { preview: false },
        )
        openedCount++
      } catch (err: any) {
        addToast({ type: 'error', message: `Failed to open ${file.name}: ${ipcErrorMessage(err)}` })
      }
    }

    if (openedCount > 0) {
      addToast({
        type: 'success',
        message: openedCount === 1
          ? `Opened ${files[0].name}`
          : `Opened ${openedCount} files`,
        duration: 2000,
      })
    }
  }, [applyWorkspaceTree])

  // --- Resizer constraints ---
  const sideConstraints: ResizerConstraints = {
    min: SIDE_PANEL_MIN, max: SIDE_PANEL_MAX,
    defaultSize: DEFAULT_SIDE_PANEL_WIDTH,
    snapPoints: SIDE_PANEL_SNAP_POINTS, snapThreshold: 5,
  }
  const rightConstraints: ResizerConstraints = {
    min: RIGHT_PANEL_MIN, max: RIGHT_PANEL_MAX,
    defaultSize: DEFAULT_RIGHT_PANEL_WIDTH,
    snapPoints: RIGHT_PANEL_SNAP_POINTS, snapThreshold: 5,
  }
  const bottomConstraints: ResizerConstraints = {
    min: BOTTOM_PANEL_MIN, max: BOTTOM_PANEL_MAX,
    defaultSize: DEFAULT_BOTTOM_PANEL_HEIGHT,
    snapPoints: BOTTOM_PANEL_SNAP_POINTS, snapThreshold: 5,
  }

  const applySnap = (value: number, c: ResizerConstraints): number => {
    if (!c.snapPoints) return value
    for (const sp of c.snapPoints) {
      if (Math.abs(value - sp) <= (c.snapThreshold ?? 5)) return sp
    }
    return value
  }

  const handleSideResize = useCallback((delta: number) => {
    setSidePanelWidth((w) => {
      const raw = w + delta
      if (raw < SIDE_PANEL_MIN) {
        // Collapse
        setSidebarVisible(false)
        return DEFAULT_SIDE_PANEL_WIDTH
      }
      const snapped = applySnap(raw, sideConstraints)
      return Math.min(SIDE_PANEL_MAX, Math.max(SIDE_PANEL_MIN, snapped))
    })
  }, [])
  const handleRightResize = useCallback((delta: number) => {
    setRightPanelWidth((w) => {
      const raw = w - delta
      if (raw < RIGHT_PANEL_MIN) {
        setChatVisible(false)
        return DEFAULT_RIGHT_PANEL_WIDTH
      }
      const snapped = applySnap(raw, rightConstraints)
      return Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, snapped))
    })
  }, [])
  const handleBottomResize = useCallback((delta: number) => {
    setBottomPanelHeight((h) => {
      const raw = h - delta
      if (raw < BOTTOM_PANEL_MIN) {
        setBottomVisible(false)
        return DEFAULT_BOTTOM_PANEL_HEIGHT
      }
      const snapped = applySnap(raw, bottomConstraints)
      return Math.min(BOTTOM_PANEL_MAX, Math.max(BOTTOM_PANEL_MIN, snapped))
    })
  }, [])

  // Stable callback for ActivityBar view changes (avoids inline function in JSX)
  const handleViewChange = useCallback((v: PanelView) => {
    if (v === activeView && sidebarVisible) {
      setSidebarVisible(false)
    } else {
      setSidebarVisible(true)
      setActiveView(v)
    }
  }, [activeView, sidebarVisible])

  // Stable callback for opening settings from ActivityBar
  const handleSettingsClick = useCallback(() => openModal(setSettingsOpen), [openModal])

  // Persist layout dimensions and panel visibility to localStorage (debounced)
  useLayoutPersistence({
    sidePanelWidth,
    rightPanelWidth,
    bottomPanelHeight,
    sidebarVisible,
    bottomVisible,
    chatVisible,
  })

  useFileWatcher()
  useExternalFileWatcher()
  useOmo()
  // Command palette Git commands; they work whether or not the panel is open.
  useGitCommands()
  useRecoveryCheck()

  // API keys are stored encrypted by the main process, which loads them
  // itself. Older versions kept them in plaintext localStorage: hand those
  // over once and delete the plaintext copy when the main process persisted
  // them (it keeps them in memory only when OS encryption is unavailable).
  useEffect(() => {
    void migrateLegacyApiKeys()
  }, [])

  useEffect(() => {
    try {
      const storedPrompts = localStorage.getItem('orion-prompts')
      if (storedPrompts) {
        const prompts = JSON.parse(storedPrompts)
        window.api?.omoSetPrompts(prompts)
      }
    } catch {}
  }, [])

  // ── Workspace trust: check on root path change ───────
  useEffect(() => {
    const unsubscribe = useFileStore.subscribe((state) => {
      const root = state.rootPath
      if (!root) {
        setWorkspaceTrustDismissed(true)
        return
      }
      const key = `${WORKSPACE_TRUST_KEY}:${root}`
      const decision = localStorage.getItem(key)
      setWorkspaceTrustDismissed(decision !== null)
    })
    // Run once on mount with current state
    const root = useFileStore.getState().rootPath
    if (root) {
      const key = `${WORKSPACE_TRUST_KEY}:${root}`
      setWorkspaceTrustDismissed(localStorage.getItem(key) !== null)
    }
    return unsubscribe
  }, [])

  const handleWorkspaceTrust = useCallback((trusted: boolean) => {
    const root = useFileStore.getState().rootPath
    if (root) {
      localStorage.setItem(`${WORKSPACE_TRUST_KEY}:${root}`, trusted ? 'trusted' : 'restricted')
    }
    setWorkspaceTrustDismissed(true)
  }, [])

  // ── Listen for orion:show-diff custom event ────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        original: string
        modified: string
        originalPath: string
        modifiedPath: string
      } | undefined
      if (detail) {
        setDiffView(detail)
      }
    }
    window.addEventListener('orion:show-diff', handler)
    return () => window.removeEventListener('orion:show-diff', handler)
  }, [])

  // Native menu items (and the Outline panel's symbol actions) run commands.
  useCommandBridges()
  // Closing, quitting or reloading the window asks before discarding unsaved edits.
  useEffect(() => installWindowCloseGuard(), [])

  useEffect(() => {
    const unsub = window.api?.onAppOpenFolder?.((folderPath) => {
      void openWorkspacePath(folderPath)
    })
    return () => { unsub?.() }
  }, [openWorkspacePath])

  // Files opened from the native File > Open File menu, an OS file
  // association, or the command line. Nothing subscribed to this before, so
  // those files never reached the editor.
  useEffect(() => {
    const unsub = window.api?.onAppOpenFile?.((filePath) => {
      void openFileInEditor(filePath)
    })
    return () => { unsub?.() }
  }, [])

  // Listen for custom events from menu bar / commands
  useEffect(() => {
    const handlers: Record<string, (event: Event) => void> = {
      'orion:toggle-sidebar': () => { setSidebarVisible((v) => !v); announce(sidebarVisible ? 'Sidebar collapsed' : 'Sidebar expanded') },
      'orion:toggle-terminal': () => { setBottomVisible((v) => !v); announce(bottomVisible ? 'Terminal panel closed' : 'Terminal panel opened') },
      // The bottom panel creates the terminal or runs the task; show it.
      'orion:new-terminal': () => setBottomVisible(true),
      'orion:split-terminal': () => setBottomVisible(true),
      'orion:run-task': () => setBottomVisible(true),
      'orion:run-build': () => setBottomVisible(true),
      'orion:toggle-chat': () => { setChatVisible((v) => !v); announce(chatVisible ? 'Chat panel closed' : 'Chat panel opened') },
      'orion:show-chat': () => setChatVisible(true),
      'orion:open-folder': handleOpenFolderEvent,
      'orion:open-settings': () => openModal(setSettingsOpen),
      'orion:open-palette': (event) => {
        const mode = (event as CustomEvent<{ mode?: unknown } | undefined>).detail?.mode
        setPalette((p) => ({
          mode: PALETTE_MODES.includes(mode as PaletteMode) ? (mode as PaletteMode) : 'files',
          request: p.request + 1,
        }))
        // Opened from the palette itself, it is closing in the same tick:
        // open it again without taking it as the element to refocus.
        if (!paletteOpen) modalTriggerRef.current = document.activeElement as HTMLElement | null
        setPaletteOpen(true)
      },
      'orion:keyboard-shortcuts': () => openModal(setShortcutsOpen),
      'orion:toggle-zen-mode': () => toggleZenMode(),
      'orion:about': () => openModal(setAboutOpen),
      'orion:open-snippets': () => openModal(setSnippetsOpen),
      'orion:show-explorer': () => { setSidebarVisible(true); setActiveView('explorer') },
      'orion:show-search': () => { setSidebarVisible(true); setActiveView('search') },
      'orion:show-git': () => { setSidebarVisible(true); setActiveView('git') },
      'orion:show-outline': () => { setSidebarVisible(true); setActiveView('outline') },
      // (Close tab / close all are EditorPanel's: handling them here too
      // closed the next tab as well.)
      'orion:focus-editor': () => {
        // Focus the Monaco editor instance when requested
        const editorEl = document.querySelector('#editor-main .monaco-editor textarea') as HTMLElement | null
        editorEl?.focus()
      },
    }
    Object.entries(handlers).forEach(([event, handler]) => {
      window.addEventListener(event, handler)
    })
    return () => {
      Object.entries(handlers).forEach(([event, handler]) => {
        window.removeEventListener(event, handler)
      })
    }
  }, [toggleZenMode, openModal, announce, handleOpenFolderEvent, sidebarVisible, bottomVisible, chatVisible, paletteOpen])

  // Update window title based on active file
  useEffect(() => {
    const unsubscribe = useEditorStore.subscribe((state: { openFiles: OpenFile[]; activeFilePath: string | null }) => {
      const activeFile = state.openFiles.find((f: OpenFile) => f.path === state.activeFilePath)
      if (activeFile) {
        const modified = activeFile.isModified ? '\u25cf ' : ''
        document.title = `${modified}${activeFile.name} - Orion`
      } else {
        document.title = 'Orion'
      }
    })
    return unsubscribe
  }, [])

  // Keyboard shortcuts. They run the commands the menus and the palette run.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey

      const command = appShortcutCommand(e)
      if (command) {
        e.preventDefault()
        // The palette keys close an open palette instead of reopening it.
        if (paletteOpen && (command === 'view.commandPalette' || command === 'go.file')) closeModal(setPaletteOpen)
        else runCommand(command)
        return
      }
      // Ctrl+Shift+Y -> focus output panel (toggle bottom panel)
      if (ctrl && e.shiftKey && e.key === 'Y') {
        e.preventDefault()
        setBottomVisible(true)
        return
      }
      // Ctrl+Tab -> next tab, Ctrl+Shift+Tab -> previous tab
      if (ctrl && e.key === 'Tab') {
        e.preventDefault()
        const { openFiles, activeFilePath, setActiveFile } = useEditorStore.getState()
        if (openFiles.length > 1 && activeFilePath) {
          const idx = openFiles.findIndex((f: OpenFile) => f.path === activeFilePath)
          const next = e.shiftKey
            ? (idx - 1 + openFiles.length) % openFiles.length
            : (idx + 1) % openFiles.length
          setActiveFile(openFiles[next].path)
        }
        return
      }

      // Escape -> close any open modal/overlay, then exit zen mode, then focus editor
      // Focus is returned to the triggering element via closeModal()
      if (e.key === 'Escape') {
        if (settingsOpen) { e.preventDefault(); closeModal(setSettingsOpen); return }
        if (shortcutsOpen) { e.preventDefault(); closeModal(setShortcutsOpen); return }
        if (aboutOpen) { e.preventDefault(); closeModal(setAboutOpen); return }
        if (snippetsOpen) { e.preventDefault(); closeModal(setSnippetsOpen); return }
        if (paletteOpen) { e.preventDefault(); closeModal(setPaletteOpen); return }
        if (zenMode) { e.preventDefault(); toggleZenMode(); return }
        // No modal open - return focus to the editor
        window.dispatchEvent(new Event('orion:focus-editor'))
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [zenMode, toggleZenMode, settingsOpen, shortcutsOpen, aboutOpen, snippetsOpen, paletteOpen, closeModal])

  // Ctrl+K chords (Ctrl+K Ctrl+S shortcuts, Ctrl+K S save all, Ctrl+K Z zen,
  // Ctrl+K Ctrl+O open folder). The second key is theirs alone: Ctrl+K
  // Ctrl+S used to open the shortcuts and also save.
  useEffect(() => listenForChords(window, runCommand), [])

  return (
    <ErrorBoundary>
    {/* Application root container */}
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
        overflow: 'hidden',
        transition: 'filter 0.2s ease',
        filter: windowFocused ? 'none' : 'saturate(0.6) brightness(0.92)',
      }}
      onDragEnter={handleGlobalDragEnter}
      onDragOver={handleGlobalDragOver}
      onDragLeave={handleGlobalDragLeave}
      onDrop={handleGlobalDrop}
    >
      {/* Screen reader live region for dynamic announcements (status changes, notifications) */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {liveAnnouncement}
      </div>

      {/* Workspace trust banner */}
      {!workspaceTrustDismissed && (
        <div
          role="alert"
          aria-label="Workspace trust prompt"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '8px 16px',
            /* WCAG AA: gold on dark bg gives ~7:1 contrast ratio */
            background: 'linear-gradient(90deg, rgba(227, 179, 65, 0.12), rgba(227, 179, 65, 0.06))',
            borderBottom: '1px solid rgba(227, 179, 65, 0.3)',
            fontSize: 13,
            color: 'var(--text-primary)',
            flexShrink: 0,
            zIndex: 100,
          }}
        >
          <span style={{ fontWeight: 500 }}>
            Do you trust the authors of the files in this folder?
          </span>
          <button
            onClick={() => handleWorkspaceTrust(true)}
            aria-label="Trust this workspace"
            style={{
              padding: '3px 14px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 4,
              border: 'none',
              cursor: 'pointer',
              /* WCAG AA: white (#fff) on accent blue meets 4.5:1 minimum */
              background: 'var(--accent)',
              color: '#fff',
            }}
          >
            Trust
          </button>
          <button
            onClick={() => handleWorkspaceTrust(false)}
            aria-label="Do not trust this workspace"
            style={{
              padding: '3px 14px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 4,
              border: '1px solid var(--border)',
              cursor: 'pointer',
              background: 'transparent',
              color: 'var(--text-primary)',
            }}
          >
            Don&apos;t Trust
          </button>
        </div>
      )}

      {/* Skip navigation links for keyboard/screen reader users
          Visible on focus, allows jumping past repeated navigation to main content.
          tabIndex ensures they are the first focusable elements in tab order. */}
      <a className="skip-nav" href="#editor-main" tabIndex={1}>
        Skip to editor
      </a>
      <a className="skip-nav" href="#status-bar" tabIndex={2} style={{ left: 140 }}>
        Skip to status bar
      </a>
      {/* Global drop overlay for OS file/folder drag */}
      {globalDragOver && (
        <div
          role="presentation"
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backdropFilter: 'blur(2px)',
            background: 'rgba(88, 166, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            animation: 'fade-in 0.15s ease-out',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 16,
              border: '2px dashed var(--accent)',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                color: 'var(--accent)',
                fontSize: 15,
                fontWeight: 600,
                userSelect: 'none',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: 'rgba(88, 166, 255, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Upload size={28} style={{ opacity: 0.9 }} />
              </div>
              <span>Drop files to open</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                Drop a folder to open as workspace
              </span>
            </div>
          </div>
        </div>
      )}

      {!splashDone && <SplashScreen onComplete={() => setSplashDone(true)} />}

      {/* Title Bar - hidden in zen mode with smooth transition */}
      <div
        role="banner"
        aria-label="Title Bar"
        aria-hidden={zenMode}
        style={{
          overflow: 'hidden',
          maxHeight: zenMode ? 0 : 38,
          opacity: zenMode ? 0 : 1,
          transition: 'max-height 0.3s ease, opacity 0.2s ease',
        }}
      >
        <TitleBar />
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Activity Bar - hidden in zen mode */}
        <div
          role="navigation"
          aria-label="Activity Bar - Switch between views"
          aria-hidden={zenMode}
          style={{
            overflow: 'hidden',
            maxWidth: zenMode ? 0 : 48,
            opacity: zenMode ? 0 : 1,
            transition: 'max-width 0.3s ease, opacity 0.2s ease',
          }}
        >
          <ActivityBar
            activeView={activeView}
            onViewChange={handleViewChange}
            onSettingsClick={handleSettingsClick}
          />
        </div>

        {/* Side Panel - complementary landmark with dynamic label based on active view */}
        {sidebarVisible && !zenMode && (
          <>
            <div
              role="complementary"
              aria-label={`Side Panel - ${activeView.charAt(0).toUpperCase() + activeView.slice(1)}`}
              aria-expanded={sidebarVisible}
              style={{
                width: sidePanelWidth,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                background: 'var(--bg-secondary)',
                borderRight: '1px solid var(--border)',
              }}
            >
              {activeView === 'explorer' && <FileExplorer />}
              <ErrorBoundary>
                <Suspense fallback={<PanelFallback />}>
                  {activeView === 'search' && <SearchPanel />}
                  {activeView === 'git' && <SourceControlPanel />}
                  {activeView === 'outline' && <OutlinePanel />}
                </Suspense>
              </ErrorBoundary>
            </div>

            <Resizer
              direction="horizontal"
              onResize={handleSideResize}
              currentSize={sidePanelWidth}
              constraints={sideConstraints}
              onCollapse={() => setSidebarVisible(false)}
              onReset={() => setSidePanelWidth(DEFAULT_SIDE_PANEL_WIDTH)}
            />
          </>
        )}
        {!sidebarVisible && !zenMode && (
          <Resizer
            direction="horizontal"
            onResize={handleSideResize}
            collapsed
            onExpand={() => setSidebarVisible(true)}
          />
        )}

        {/* Center - main content area (editor, breadcrumbs, bottom panel) */}
        <div role="main" aria-label="Editor content" id="editor-main" tabIndex={-1} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* The editor panel shows the breadcrumbs. (An app-level bar listed
              made-up sibling files and folders.) */}
          <div className={zenMode ? 'zen-editor-container' : undefined} style={{ flex: 1, overflow: 'hidden' }}>
            {diffView ? (
              <ErrorBoundary>
                <Suspense fallback={<PanelFallback />}>
                  <DiffEditor
                    originalContent={diffView.original}
                    modifiedContent={diffView.modified}
                    originalPath={diffView.originalPath}
                    modifiedPath={diffView.modifiedPath}
                    onClose={() => setDiffView(null)}
                  />
                </Suspense>
              </ErrorBoundary>
            ) : (
              <Suspense fallback={<PanelFallback />}>
                <EditorPanel />
              </Suspense>
            )}
          </div>
          {bottomVisible && !zenMode && (
            <Resizer
              direction="vertical"
              onResize={handleBottomResize}
              currentSize={bottomPanelHeight}
              constraints={bottomConstraints}
              onCollapse={() => setBottomVisible(false)}
              onReset={() => setBottomPanelHeight(DEFAULT_BOTTOM_PANEL_HEIGHT)}
            />
          )}
          {/* Hidden, not unmounted: a terminal's shell lives as long as its view
              is mounted, so unmounting the panel killed every running shell. */}
          <div
            role="region"
            aria-label="Terminal and Output Panel"
            aria-expanded={bottomVisible && !zenMode}
            style={{ height: bottomPanelHeight, display: bottomVisible && !zenMode ? undefined : 'none' }}
          >
            <BottomPanel />
          </div>
          {!bottomVisible && !zenMode && (
            <Resizer
              direction="vertical"
              onResize={handleBottomResize}
              collapsed
              onExpand={() => setBottomVisible(true)}
            />
          )}
        </div>

        {/* Right Panel: Chat. (A "Composer" tab showed canned diffs and changed no file.) */}
        {chatVisible && !zenMode && (
          <>
            <Resizer
              direction="horizontal"
              onResize={handleRightResize}
              currentSize={rightPanelWidth}
              constraints={rightConstraints}
              onCollapse={() => setChatVisible(false)}
              onReset={() => setRightPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH)}
            />
            <div role="complementary" aria-label="AI Panel" aria-expanded={chatVisible} style={{ width: rightPanelWidth, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <ErrorBoundary>
                  <Suspense fallback={<PanelFallback />}>
                    <ChatPanel />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </div>
          </>
        )}
        {!chatVisible && !zenMode && (
          <Resizer
            direction="horizontal"
            onResize={handleRightResize}
            collapsed
            onExpand={() => setChatVisible(true)}
          />
        )}
      </div>

      {/* Status Bar - hidden in zen mode with smooth transition
          WCAG AA: status bar text uses --text-secondary (~#8b949e) on --bg-tertiary
          which provides ~4.6:1 contrast ratio, meeting AA for normal text */}
      <div
        id="status-bar"
        role="contentinfo"
        aria-label="Status Bar"
        aria-hidden={zenMode}
        tabIndex={-1}
        style={{
          overflow: 'hidden',
          maxHeight: zenMode ? 0 : 22,
          opacity: zenMode ? 0 : 1,
          transition: 'max-height 0.3s ease, opacity 0.2s ease',
        }}
      >
        <StatusBar
          onToggleTerminal={() => setBottomVisible((v) => !v)}
          onToggleChat={() => setChatVisible((v) => !v)}
        />
      </div>

      {/* Zen Mode: centered exit hint at top, auto-fades, reappears on hover */}
      {zenMode && (
        <div
          className="zen-exit-zone"
          onMouseEnter={() => setZenExitVisible(true)}
          onMouseLeave={() => setZenExitVisible(false)}
        >
          <button
            className={`zen-exit-hint${zenExitVisible ? ' zen-exit-hint--visible' : ''}`}
            onClick={toggleZenMode}
            aria-label="Exit Zen Mode. You can also press Escape."
          >
            Exit Zen Mode (Esc)
          </button>
        </div>
      )}

      {/* Modal dialogs - focus is trapped inside and returned to trigger on close.
          Each modal receives aria-modal="true" from its own component.
          Keyboard: Escape closes any open modal (handled in keydown listener above).
          WCAG AA: All modal overlays use semi-transparent backgrounds that maintain
          sufficient contrast between foreground content and the dimmed background. */}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal open={settingsOpen} onClose={() => closeModal(setSettingsOpen)} />
        </Suspense>
      )}

      {aboutOpen && (
        <Suspense fallback={null}>
          <AboutDialog open={aboutOpen} onClose={() => closeModal(setAboutOpen)} />
        </Suspense>
      )}

      {shortcutsOpen && (
        <Suspense fallback={null}>
          <KeyboardShortcuts open={shortcutsOpen} onClose={() => closeModal(setShortcutsOpen)} />
        </Suspense>
      )}

      {snippetsOpen && (
        // Its own boundary: a render error closes this dialog, not the whole IDE.
        <ErrorBoundary>
          <Suspense fallback={null}>
            <SnippetManager open={snippetsOpen} onClose={() => closeModal(setSnippetsOpen)} />
          </Suspense>
        </ErrorBoundary>
      )}

      <CommandPalette
        key={palette.request}
        open={paletteOpen}
        mode={palette.mode}
        onClose={() => closeModal(setPaletteOpen)}
      />

      {/* Toast notifications - aria-live region for screen readers */}
      <div aria-live="assertive" aria-atomic="true" role="alert">
        <ToastContainer />
      </div>
    </div>
    </ErrorBoundary>
  )
}
