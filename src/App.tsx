import React, { useState, useCallback, useEffect, useRef, Suspense } from 'react'
import { Upload } from 'lucide-react'
import { useFileWatcher, useExternalFileWatcher } from './hooks/useIpc'
import { useOmo } from './hooks/useOmo'
import { loadLayout, useLayoutPersistence } from './hooks/useLayoutPersistence'
import { useRecoveryCheck, clearRecovery } from './hooks/useAutoSave'
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
import FileExplorer from './panels/FileExplorer'
import EditorPanel from './panels/EditorPanel'
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
const ExtensionsPanel = React.lazy(() => import('./panels/ExtensionsPanel'))
const OutlinePanel = React.lazy(() => import('@/panels/OutlinePanel'))
const AgentPanel = React.lazy(() => import('./panels/AgentPanel'))
const DebugPanel = React.lazy(() => import('./panels/DebugPanel'))
const TestingPanel = React.lazy(() => import('./panels/TestingPanel'))
const ComposerPanel = React.lazy(() => import('./panels/ComposerPanel'))
const GitBlamePanel = React.lazy(() => import('./panels/GitBlamePanel'))
const ProfilerPanel = React.lazy(() => import('./panels/ProfilerPanel'))
const DatabasePanel = React.lazy(() => import('./panels/DatabasePanel'))
const ApiClientPanel = React.lazy(() => import('./panels/ApiClientPanel'))
const DockerPanel = React.lazy(() => import('./panels/DockerPanel'))
const NotebookPanel = React.lazy(() => import('./panels/NotebookPanel'))
const CICDPanel = React.lazy(() => import('./panels/CICDPanel'))
const RemoteExplorerPanel = React.lazy(() => import('./panels/RemoteExplorerPanel'))
const GitStashPanel = React.lazy(() => import('./panels/GitStashPanel'))
const GitTimelinePanel = React.lazy(() => import('./panels/GitTimelinePanel'))

// Lazy-loaded editor-area components
const Breadcrumbs = React.lazy(() => import('./components/Breadcrumbs'))
const DiffEditor = React.lazy(() => import('./components/DiffEditor'))
const DiffViewer = React.lazy(() => import('./components/DiffViewer'))
const HexEditor = React.lazy(() => import('./components/HexEditor'))
const SplitView = React.lazy(() => import('./components/SplitView'))
const MarkdownPreview = React.lazy(() => import('./components/MarkdownPreview'))
const ImageEditor = React.lazy(() => import('./components/ImageEditor'))

// Lazy-loaded modal/dialog components (only shown on demand)
const SettingsModal = React.lazy(() => import('./components/SettingsModal'))
const KeyboardShortcuts = React.lazy(() => import('./components/KeyboardShortcuts'))
const AboutDialog = React.lazy(() => import('./components/AboutDialog'))
const SnippetManager = React.lazy(() => import('@/components/SnippetManager'))
const NewProjectWizard = React.lazy(() => import('./components/NewProjectWizard'))
const ThemeEditor = React.lazy(() => import('./components/ThemeEditor'))
const OnboardingWalkthrough = React.lazy(() => import('./components/OnboardingWalkthrough'))
const SearchReplaceDialog = React.lazy(() => import('./components/SearchReplaceDialog'))
const WorkspaceTrust = React.lazy(() => import('./components/WorkspaceTrust'))
const SettingsEditor = React.lazy(() => import('./components/SettingsEditor'))
const KeybindingEditor = React.lazy(() => import('./components/KeybindingEditor'))

/** Workspace trust key prefix in localStorage */
const WORKSPACE_TRUST_KEY = 'orion-workspace-trust'

/** Minimal loading placeholder for lazy panels */
function PanelFallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%',
        color: 'var(--text-muted)',
        fontSize: 12,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 16,
          height: 16,
          border: '2px solid var(--border)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          marginRight: 8,
        }}
      />
      Loading...
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

/** Wrapper that subscribes to editor store for Breadcrumbs props */
function BreadcrumbsWrapper() {
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  if (!activeFilePath) return null
  return (
    <Suspense fallback={null}>
      <Breadcrumbs filePath={activeFilePath} />
    </Suspense>
  )
}

export default function App() {
  const [splashDone, setSplashDone] = useState(false)
  const [activeView, setActiveView] = useState<PanelView>('explorer')
  const [sidePanelWidth, setSidePanelWidth] = useState(initialLayout.sidePanelWidth)
  const [rightPanelWidth, setRightPanelWidth] = useState(initialLayout.rightPanelWidth)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(initialLayout.bottomPanelHeight)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [snippetsOpen, setSnippetsOpen] = useState(false)
  const [sidebarVisible, setSidebarVisible] = useState(initialLayout.sidebarVisible)
  const [bottomVisible, setBottomVisible] = useState(initialLayout.bottomVisible)
  const [chatVisible, setChatVisible] = useState(initialLayout.chatVisible)
  const [zenMode, setZenMode] = useState(false)
  const [rightPanelTab, setRightPanelTab] = useState<'chat' | 'composer'>('chat')
  const [zenExitVisible, setZenExitVisible] = useState(false)
  const zenExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const handleGlobalDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    globalDragCounterRef.current = 0
    setGlobalDragOver(false)

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    const { addToast } = useToastStore.getState()
    const { openFile } = useEditorStore.getState()
    const { setRootPath, setFileTree } = useFileStore.getState()

    // Check if a single folder was dropped (Electron exposes .path on File objects)
    // A dropped folder typically has no type or size=0 in Electron
    if (files.length === 1) {
      const droppedFile = files[0]
      const filePath = (droppedFile as any).path as string | undefined
      if (filePath) {
        try {
          // Try to read as directory first
          const tree = await window.api.readDir(filePath)
          if (tree && Array.isArray(tree) && tree.length >= 0) {
            // It's a valid directory - set as workspace root
            setRootPath(filePath)
            await useWorkspaceStore.getState().loadWorkspaceSettings(filePath)
            setFileTree(tree)
            window.api.watchStart(filePath)
            addToast({ type: 'success', message: `Opened folder: ${droppedFile.name}`, duration: 2000 })
            return
          }
        } catch {
          // Not a directory, fall through to open as file
        }
      }
    }

    // Open files in the editor
    let openedCount = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const filePath = (file as any).path as string | undefined
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
        addToast({ type: 'error', message: `Failed to open ${file.name}: ${err?.message || err}` })
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
  }, [])

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
  useRecoveryCheck()

  // Load saved API keys on startup
  useEffect(() => {
    try {
      const stored = localStorage.getItem('orion-api-keys')
      if (stored) {
        const keys = JSON.parse(stored)
        window.api?.omoSetApiKeys(keys)
      }
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

  // Listen for custom events from menu bar / commands
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'orion:toggle-sidebar': () => { setSidebarVisible((v) => !v); announce(sidebarVisible ? 'Sidebar collapsed' : 'Sidebar expanded') },
      'orion:toggle-terminal': () => { setBottomVisible((v) => !v); announce(bottomVisible ? 'Terminal panel closed' : 'Terminal panel opened') },
      'orion:toggle-chat': () => { setChatVisible((v) => !v); announce(chatVisible ? 'Chat panel closed' : 'Chat panel opened') },
      'orion:open-settings': () => openModal(setSettingsOpen),
      'orion:open-palette': () => openModal(setPaletteOpen),
      'orion:keyboard-shortcuts': () => openModal(setShortcutsOpen),
      'orion:zen-mode': () => toggleZenMode(),
      'orion:toggle-zen-mode': () => toggleZenMode(),
      'orion:about': () => openModal(setAboutOpen),
      'orion:open-snippets': () => openModal(setSnippetsOpen),
      'orion:show-explorer': () => { setSidebarVisible(true); setActiveView('explorer') },
      'orion:show-search': () => { setSidebarVisible(true); setActiveView('search') },
      'orion:show-git': () => { setSidebarVisible(true); setActiveView('git') },
      'orion:show-agents': () => { setSidebarVisible(true); setActiveView('agents') },
      'orion:show-outline': () => { setSidebarVisible(true); setActiveView('outline') },
      'orion:show-debug': () => { setSidebarVisible(true); setActiveView('debug') },
      'orion:show-extensions': () => { setSidebarVisible(true); setActiveView('extensions') },
      'orion:show-testing': () => { setSidebarVisible(true); setActiveView('testing') },
      'orion:close-tab': () => {
        const { activeFilePath, closeFile } = useEditorStore.getState()
        if (activeFilePath) closeFile(activeFilePath)
      },
      'orion:close-all-tabs': () => {
        useEditorStore.getState().closeAllFiles()
      },
      'orion:toggle-auto-save': () => {
        // Toggle auto-save in workspace settings
        window.dispatchEvent(new Event('orion:open-settings'))
      },
      'orion:save-all': () => {
        const { openFiles, markSaved } = useEditorStore.getState()
        const modified = openFiles.filter(f => f.isModified)
        Promise.all(modified.map(async f => {
          try {
            await window.api.writeFile(f.path, f.content)
            markSaved(f.path)
            clearRecovery(f.path)
          } catch {}
        })).then(() => {
          if (modified.length > 0) {
            const { addToast } = useToastStore.getState()
            addToast({ type: 'success', message: `Saved ${modified.length} file(s)` })
          }
        })
      },
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
  }, [toggleZenMode, openModal, announce, sidebarVisible, bottomVisible, chatVisible])

  // Update window title based on active file
  useEffect(() => {
    const unsubscribe = useEditorStore.subscribe((state) => {
      const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath)
      if (activeFile) {
        const modified = activeFile.isModified ? '\u25cf ' : ''
        document.title = `${modified}${activeFile.name} - Orion`
      } else {
        document.title = 'Orion'
      }
    })
    return unsubscribe
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey

      // Ctrl+Shift+S -> save all
      if (ctrl && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        const { openFiles, markSaved } = useEditorStore.getState()
        const modified = openFiles.filter(f => f.isModified)
        Promise.all(modified.map(async f => {
          try {
            await window.api.writeFile(f.path, f.content)
            markSaved(f.path)
            clearRecovery(f.path)
          } catch {}
        })).then(() => {
          if (modified.length > 0) {
            const { addToast } = useToastStore.getState()
            addToast({ type: 'success', message: `Saved ${modified.length} file(s)` })
          }
        })
        return
      }

      // Ctrl+Shift+N -> new window
      if (ctrl && e.shiftKey && e.key === 'N') {
        e.preventDefault()
        window.dispatchEvent(new Event('orion:new-window'))
        return
      }

      // Ctrl+N -> new untitled file
      if (ctrl && e.key === 'n') {
        e.preventDefault()
        const { openFile } = useEditorStore.getState()
        const id = Date.now()
        openFile({
          path: `untitled-${id}`,
          name: `Untitled-${id}`,
          content: '',
          language: 'plaintext',
          isModified: false,
          aiModified: false,
        })
        return
      }

      // Ctrl+W -> close current tab
      if (ctrl && e.key === 'w') {
        e.preventDefault()
        const { activeFilePath, closeFile } = useEditorStore.getState()
        if (activeFilePath) {
          closeFile(activeFilePath)
        }
        return
      }

      // Ctrl+Shift+P -> command palette
      if (ctrl && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        if (paletteOpen) closeModal(setPaletteOpen); else openModal(setPaletteOpen)
        return
      }
      // Ctrl+P -> quick open (file mode)
      if (ctrl && !e.shiftKey && e.key === 'p') {
        e.preventDefault()
        if (paletteOpen) closeModal(setPaletteOpen); else openModal(setPaletteOpen)
        return
      }
      // Ctrl+B -> toggle sidebar
      if (ctrl && e.key === 'b') {
        e.preventDefault()
        setSidebarVisible((v) => !v)
        return
      }
      // Ctrl+` -> toggle terminal
      if (ctrl && e.key === '`') {
        e.preventDefault()
        setBottomVisible((v) => !v)
        return
      }
      // Ctrl+J -> toggle bottom panel
      if (ctrl && e.key === 'j') {
        e.preventDefault()
        setBottomVisible((v) => !v)
        return
      }
      // Ctrl+L -> focus chat
      if (ctrl && e.key === 'l') {
        e.preventDefault()
        setChatVisible(true)
        return
      }
      // Ctrl+, -> settings
      if (ctrl && e.key === ',') {
        e.preventDefault()
        openModal(setSettingsOpen)
        return
      }
      // Ctrl+Shift+E -> explorer
      if (ctrl && e.shiftKey && e.key === 'E') {
        e.preventDefault()
        setSidebarVisible(true)
        setActiveView('explorer')
        return
      }
      // Ctrl+Shift+F -> search
      if (ctrl && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setSidebarVisible(true)
        setActiveView('search')
        return
      }
      // Ctrl+Shift+G -> git
      if (ctrl && e.shiftKey && e.key === 'G') {
        e.preventDefault()
        setSidebarVisible(true)
        setActiveView('git')
        return
      }
      // Ctrl+Shift+O -> outline
      if (ctrl && e.shiftKey && e.key === 'O') {
        e.preventDefault()
        setSidebarVisible(true)
        setActiveView('outline')
        return
      }
      // Ctrl+Shift+D -> debug
      if (ctrl && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        setSidebarVisible(true)
        setActiveView('debug')
        return
      }
      // Ctrl+Shift+X -> extensions
      if (ctrl && e.shiftKey && e.key === 'X') {
        e.preventDefault()
        setSidebarVisible(true)
        setActiveView('extensions')
        return
      }
      // Ctrl+Shift+T -> testing
      if (ctrl && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        setSidebarVisible(true)
        setActiveView('testing')
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
          const idx = openFiles.findIndex((f) => f.path === activeFilePath)
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

    // Ctrl+K, Ctrl+S chord for keyboard shortcuts
    let chordPending = false
    const handleChord = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key === 'k') {
        chordPending = true
        // Allow a short window for the second key
        setTimeout(() => { chordPending = false }, 1000)
        return
      }
      if (chordPending && ctrl && e.key === 's') {
        e.preventDefault()
        chordPending = false
        openModal(setShortcutsOpen)
        return
      }
      // Ctrl+K Z -> toggle zen mode
      if (chordPending && e.key === 'z') {
        e.preventDefault()
        chordPending = false
        toggleZenMode()
        return
      }
      if (chordPending && !(ctrl && e.key === 'k')) {
        chordPending = false
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keydown', handleChord)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keydown', handleChord)
    }
  }, [zenMode, toggleZenMode, settingsOpen, shortcutsOpen, aboutOpen, snippetsOpen, paletteOpen, openModal, closeModal])

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
            onViewChange={(v) => {
              if (v === activeView && sidebarVisible) {
                setSidebarVisible(false)
              } else {
                setSidebarVisible(true)
                setActiveView(v)
              }
            }}
            onSettingsClick={() => openModal(setSettingsOpen)}
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
              <Suspense fallback={<PanelFallback />}>
                {activeView === 'agents' && <AgentPanel />}
                {activeView === 'search' && <SearchPanel />}
                {activeView === 'git' && <SourceControlPanel />}
                {activeView === 'debug' && <DebugPanel />}
                {activeView === 'outline' && <OutlinePanel />}
                {activeView === 'extensions' && <ExtensionsPanel />}
                {activeView === 'testing' && <TestingPanel />}
              </Suspense>
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
          {/* Breadcrumbs - only shown when a file is open and not in diff view */}
          {!diffView && <BreadcrumbsWrapper />}
          <div className={zenMode ? 'zen-editor-container' : undefined} style={{ flex: 1, overflow: 'hidden' }}>
            {diffView ? (
              <Suspense fallback={<PanelFallback />}>
                <DiffEditor
                  originalContent={diffView.original}
                  modifiedContent={diffView.modified}
                  originalPath={diffView.originalPath}
                  modifiedPath={diffView.modifiedPath}
                  onClose={() => setDiffView(null)}
                />
              </Suspense>
            ) : (
              <EditorPanel />
            )}
          </div>
          {bottomVisible && !zenMode && (
            <>
              <Resizer
                direction="vertical"
                onResize={handleBottomResize}
                currentSize={bottomPanelHeight}
                constraints={bottomConstraints}
                onCollapse={() => setBottomVisible(false)}
                onReset={() => setBottomPanelHeight(DEFAULT_BOTTOM_PANEL_HEIGHT)}
              />
              <div
                role="region"
                aria-label="Terminal and Output Panel"
                aria-expanded={bottomVisible}
                style={{ height: bottomPanelHeight }}
              >
                <BottomPanel />
              </div>
            </>
          )}
          {!bottomVisible && !zenMode && (
            <Resizer
              direction="vertical"
              onResize={handleBottomResize}
              collapsed
              onExpand={() => setBottomVisible(true)}
            />
          )}
        </div>

        {/* Right Panel: Chat / Composer */}
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
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', flexShrink: 0 }}>
                {(['chat', 'composer'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setRightPanelTab(tab)}
                    style={{
                      flex: 1, padding: '6px 12px', fontSize: 11, fontWeight: 500, cursor: 'pointer',
                      background: rightPanelTab === tab ? 'var(--bg-primary)' : 'transparent',
                      color: rightPanelTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
                      border: 'none', borderBottom: rightPanelTab === tab ? '2px solid var(--accent-primary)' : '2px solid transparent',
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}
                  >
                    {tab === 'chat' ? 'Chat' : 'Composer'}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <Suspense fallback={<PanelFallback />}>
                  {rightPanelTab === 'chat' ? <ChatPanel /> : <ComposerPanel />}
                </Suspense>
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
        <Suspense fallback={null}>
          <SnippetManager open={snippetsOpen} onClose={() => closeModal(setSnippetsOpen)} />
        </Suspense>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => closeModal(setPaletteOpen)}
        onOpenSettings={() => openModal(setSettingsOpen)}
      />

      {/* Toast notifications - aria-live region for screen readers */}
      <div aria-live="assertive" aria-atomic="true" role="alert">
        <ToastContainer />
      </div>
    </div>
    </ErrorBoundary>
  )
}
