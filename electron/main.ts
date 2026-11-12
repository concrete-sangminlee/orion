import { app, BrowserWindow, dialog, Menu, screen, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { registerFilesystemHandlers } from './ipc/filesystem'
import { registerTerminalHandlers } from './ipc/terminal'
import { registerDialogHandlers } from './ipc/dialogs'
import { killAllTerminals } from './terminal/manager'
import { registerSettingsHandlers } from './ipc/settings'
import { registerOmoHandlers } from './ipc/omo'
import { registerInlineEditHandlers } from './ai/inline-edit'
import { registerGitHandlers } from './ipc/git'
import { registerWorkspaceHandlers } from './ipc/workspace'
import { registerFileOperationHandlers } from './ipc/file-operations'
import { registerClipboardHandlers } from './ipc/clipboard'
import { registerShellHandlers } from './ipc/shell'
import { registerTaskHandlers } from './ipc/tasks'
import { configureIpcTrust, handle, listen, emit } from './ipc/typed-ipc'
import { decideNavigation, type AppOrigin } from './security/app-origin'
import { grantFileAccess } from './workspace/granted-files'
import { grantWorkspaceRoot, initGrantedRoots } from './workspace/granted-roots'
import { itemsFromArgs } from './workspace/launch-args'

// --- Constants ---

// The main bundle is an ES module (package.json "type": "module"), where
// __dirname does not exist. Using it crashed createWindow() with
// "ReferenceError: __dirname is not defined", so no window ever opened.
const MAIN_DIR = path.dirname(fileURLToPath(import.meta.url))

const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'

const SUPPORTED_FILE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.py',
  '.html', '.css', '.scss', '.less', '.yaml', '.yml',
  '.toml', '.xml', '.svg', '.sh', '.bash', '.zsh',
  '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.java',
  '.rb', '.php', '.vue', '.svelte', '.astro',
]

// --- Crash reporter / logging ---
const logDir = path.join(app.getPath('userData'), 'logs')
const crashLogPath = path.join(logDir, 'crash.log')

function ensureLogDir(): void {
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }
  } catch {
    // Best-effort
  }
}

function logCrash(prefix: string, err: unknown): void {
  const timestamp = new Date().toISOString()
  const message = err instanceof Error
    ? `${err.message}\n${err.stack || ''}`
    : String(err)
  const entry = `[${timestamp}] ${prefix}: ${message}\n`

  console.error(`[Main] ${prefix}:`, err)

  try {
    ensureLogDir()
    fs.appendFileSync(crashLogPath, entry)
  } catch {
    // Best-effort
  }
}

process.on('uncaughtException', (err) => {
  logCrash('Uncaught exception', err)
})
process.on('unhandledRejection', (err) => {
  logCrash('Unhandled rejection', err)
})

// --- Performance: V8 & GPU flags ---
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

// --- Window state persistence ---
interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
  displayId?: string
}

const stateFilePath = path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState(): WindowState {
  try {
    const data = fs.readFileSync(stateFilePath, 'utf-8')
    return JSON.parse(data)
  } catch {
    return { width: 1400, height: 900, isMaximized: false }
  }
}

function saveWindowState(state: WindowState): void {
  try {
    fs.writeFileSync(stateFilePath, JSON.stringify(state))
  } catch (err) {
    console.error('[Main] Failed to save window state:', err)
  }
}

/**
 * Validate that saved position is visible on a currently-connected display.
 * If the saved display is gone or the window would be off-screen, reset position
 * so Electron centers on the primary display.
 */
function validateWindowPosition(state: WindowState): WindowState {
  if (state.x === undefined || state.y === undefined) return state

  const displays = screen.getAllDisplays()
  const windowCenter = {
    x: state.x + Math.floor(state.width / 2),
    y: state.y + Math.floor(state.height / 2),
  }

  const isOnScreen = displays.some((display) => {
    const { x, y, width, height } = display.workArea
    return (
      windowCenter.x >= x &&
      windowCenter.x < x + width &&
      windowCenter.y >= y &&
      windowCenter.y < y + height
    )
  })

  if (!isOnScreen) {
    // Reset to center of primary display
    const primary = screen.getPrimaryDisplay()
    return {
      ...state,
      x: Math.floor(primary.workArea.x + (primary.workArea.width - state.width) / 2),
      y: Math.floor(primary.workArea.y + (primary.workArea.height - state.height) / 2),
    }
  }

  return state
}

// --- Multi-window tracking ---
const windows: Set<BrowserWindow> = new Set()
let mainWindow: BrowserWindow | null = null

function getActiveWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() || mainWindow
}

// There is no auto-updater: the update check used to wait two seconds and
// always report "no update available". The releases page is the truth.
const RELEASES_URL = 'https://github.com/concrete-sangminlee/orion/releases'

// --- Command line and OS "Open with" ---
/** In development the app directory is also on the command line. */
const DEV_APP_PATH = app.isPackaged ? undefined : app.getAppPath()

/** Open the first folder as the workspace and every file in the editor. */
function openItemsInWindow(win: BrowserWindow, items: { files: string[]; folders: string[] }): void {
  const [folder] = items.folders
  if (folder && grantWorkspaceRoot(folder) && !win.isDestroyed()) {
    const send = () => emit(win, 'app:open-folder', folder)
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
    else send()
  }
  openFilesInWindow(win, items.files)
}

function openFilesInWindow(win: BrowserWindow, filePaths: string[]): void {
  // Every path reaching here was chosen by the user (native dialog, OS file
  // association, command line), so the renderer may read and save it even
  // when it lives outside the open workspace.
  filePaths.forEach(grantFileAccess)
  if (filePaths.length > 0 && !win.isDestroyed()) {
    // Wait for renderer to be ready, then send file open requests
    const send = () => {
      filePaths.forEach((filePath) => {
        emit(win, 'app:open-file', filePath)
      })
    }
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', send)
    } else {
      send()
    }
  }
}

async function showOpenFilesDialog(win: BrowserWindow | null): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Supported', extensions: SUPPORTED_FILE_EXTENSIONS.map((e) => e.slice(1)) },
      { name: 'All Files', extensions: ['*'] },
    ],
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}

// --- Application Menu ---
function buildAppMenu(): Menu {
  const template: Electron.MenuItemConstructorOptions[] = []

  // macOS App menu
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'Cmd+,',
          click: () => emit(getActiveWindow(), 'app:open-settings'),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }

  // File menu
  template.push({
    label: 'File',
    submenu: [
      {
        label: 'New File',
        accelerator: 'CmdOrCtrl+N',
        click: () => emit(getActiveWindow(), 'app:new-file'),
      },
      { type: 'separator' },
      {
        label: 'Open File...',
        accelerator: 'CmdOrCtrl+O',
        click: async () => {
          const win = getActiveWindow()
          if (!win) return
          const filePaths = await showOpenFilesDialog(win)
          openFilesInWindow(win, filePaths)
        },
      },
      {
        label: 'Open Folder...',
        accelerator: 'CmdOrCtrl+K CmdOrCtrl+O',
        click: async () => {
          const win = getActiveWindow()
          if (!win) return
          const result = await dialog.showOpenDialog(win, {
            properties: ['openDirectory'],
          })
          if (!result.canceled && result.filePaths[0] && grantWorkspaceRoot(result.filePaths[0])) {
            emit(win, 'app:open-folder', result.filePaths[0])
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Save',
        accelerator: 'CmdOrCtrl+S',
        click: () => emit(getActiveWindow(), 'app:save'),
      },
      {
        label: 'Save As...',
        accelerator: 'CmdOrCtrl+Shift+S',
        click: () => emit(getActiveWindow(), 'app:save-as'),
      },
      {
        label: 'Save All',
        accelerator: isMac ? 'Cmd+Alt+S' : 'Ctrl+K S',
        click: () => emit(getActiveWindow(), 'app:save-all'),
      },
      { type: 'separator' },
      {
        // Cmd+W must close the editor tab: with the 'close' role alone it
        // closed the window, and with it the app.
        label: 'Close Editor',
        accelerator: 'CmdOrCtrl+W',
        click: () => emit(getActiveWindow(), 'app:close-editor'),
      },
      { type: 'separator' },
      ...(!isMac
        ? [
            {
              label: 'Preferences',
              accelerator: 'Ctrl+,' as const,
              click: () => emit(getActiveWindow(), 'app:open-settings'),
            },
            { type: 'separator' as const },
          ]
        : []),
      isMac ? { role: 'close' as const, label: 'Close Window', accelerator: 'Cmd+Shift+W' } : { role: 'quit' as const },
    ],
  })

  // Edit menu
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo', accelerator: 'CmdOrCtrl+Z' },
      { role: 'redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y' },
      { type: 'separator' },
      { role: 'cut', accelerator: 'CmdOrCtrl+X' },
      { role: 'copy', accelerator: 'CmdOrCtrl+C' },
      { role: 'paste', accelerator: 'CmdOrCtrl+V' },
      { role: 'selectAll', accelerator: 'CmdOrCtrl+A' },
      { type: 'separator' },
      {
        label: 'Find',
        accelerator: 'CmdOrCtrl+F',
        click: () => emit(getActiveWindow(), 'app:find'),
      },
      {
        label: 'Replace',
        // Cmd+H is the macOS Hide shortcut (App menu), so it never reached this item.
        accelerator: isMac ? 'Cmd+Alt+F' : 'Ctrl+H',
        click: () => emit(getActiveWindow(), 'app:replace'),
      },
      { type: 'separator' },
      {
        label: 'Find in Files',
        accelerator: 'CmdOrCtrl+Shift+F',
        click: () => emit(getActiveWindow(), 'app:find-in-files'),
      },
    ],
  })

  // View menu
  template.push({
    label: 'View',
    submenu: [
      {
        label: 'Command Palette...',
        accelerator: 'CmdOrCtrl+Shift+P',
        click: () => emit(getActiveWindow(), 'app:command-palette'),
      },
      { type: 'separator' },
      {
        label: 'Explorer',
        accelerator: 'CmdOrCtrl+Shift+E',
        click: () => emit(getActiveWindow(), 'app:toggle-sidebar', 'explorer'),
      },
      {
        label: 'Search',
        accelerator: 'CmdOrCtrl+Shift+F',
        click: () => emit(getActiveWindow(), 'app:toggle-sidebar', 'search'),
      },
      {
        label: 'Source Control',
        accelerator: 'CmdOrCtrl+Shift+G',
        click: () => emit(getActiveWindow(), 'app:toggle-sidebar', 'git'),
      },
      { type: 'separator' },
      {
        label: 'Toggle Sidebar',
        accelerator: 'CmdOrCtrl+B',
        click: () => emit(getActiveWindow(), 'app:toggle-sidebar'),
      },
      {
        label: 'Toggle Panel',
        accelerator: 'CmdOrCtrl+J',
        click: () => emit(getActiveWindow(), 'app:toggle-panel'),
      },
      { type: 'separator' },
      {
        label: 'Zoom In',
        accelerator: 'CmdOrCtrl+=',
        click: () => {
          const win = getActiveWindow()
          if (win) {
            const current = win.webContents.getZoomLevel()
            win.webContents.setZoomLevel(current + 0.5)
          }
        },
      },
      {
        label: 'Zoom Out',
        accelerator: 'CmdOrCtrl+-',
        click: () => {
          const win = getActiveWindow()
          if (win) {
            const current = win.webContents.getZoomLevel()
            win.webContents.setZoomLevel(current - 0.5)
          }
        },
      },
      {
        label: 'Reset Zoom',
        accelerator: 'CmdOrCtrl+0',
        click: () => getActiveWindow()?.webContents.setZoomLevel(0),
      },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { role: 'toggleDevTools', accelerator: isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I' },
    ],
  })

  // Go menu
  template.push({
    label: 'Go',
    submenu: [
      {
        label: 'Go to File...',
        accelerator: 'CmdOrCtrl+P',
        click: () => emit(getActiveWindow(), 'app:quick-open'),
      },
      {
        label: 'Go to Symbol...',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: () => emit(getActiveWindow(), 'app:go-to-symbol'),
      },
      {
        label: 'Go to Line...',
        accelerator: 'CmdOrCtrl+G',
        click: () => emit(getActiveWindow(), 'app:go-to-line'),
      },
      { type: 'separator' },
      {
        label: 'Go to Definition',
        accelerator: 'F12',
        click: () => emit(getActiveWindow(), 'app:go-to-definition'),
      },
      {
        label: 'Peek Definition',
        accelerator: isMac ? 'Alt+F12' : 'Alt+F12',
        click: () => emit(getActiveWindow(), 'app:peek-definition'),
      },
    ],
  })

  // Terminal menu. (A Run menu offered debugging, breakpoints and "run active
  // file"; there is no debugger or runner behind any of them.)
  template.push({
    label: 'Terminal',
    submenu: [
      {
        label: 'New Terminal',
        // Ctrl+` toggles the panel in the page; Cmd+` belongs to macOS.
        accelerator: 'CmdOrCtrl+Shift+`',
        click: () => emit(getActiveWindow(), 'app:new-terminal'),
      },
      {
        label: 'Split Terminal',
        click: () => emit(getActiveWindow(), 'app:split-terminal'),
      },
      { type: 'separator' },
      {
        label: 'Run Task...',
        click: () => emit(getActiveWindow(), 'app:run-task'),
      },
      {
        label: 'Run Build Task',
        accelerator: 'CmdOrCtrl+Shift+B',
        click: () => emit(getActiveWindow(), 'app:run-build-task'),
      },
    ],
  })

  // Help menu
  template.push({
    label: 'Help',
    submenu: [
      {
        label: 'Documentation',
        click: () => void shell.openExternal('https://github.com/concrete-sangminlee/orion#readme'),
      },
      { type: 'separator' },
      {
        label: 'Keyboard Shortcuts',
        accelerator: 'CmdOrCtrl+K CmdOrCtrl+S',
        click: () => emit(getActiveWindow(), 'app:show-keybindings'),
      },
      { type: 'separator' },
      {
        label: 'Report Issue...',
        click: () => void shell.openExternal('https://github.com/concrete-sangminlee/orion/issues'),
      },
      { type: 'separator' },
      {
        label: 'Check for Updates...',
        click: () => void shell.openExternal(RELEASES_URL),
      },
      ...(!isMac
        ? [
            { type: 'separator' as const },
            {
              label: `About ${app.name}`,
              click: () => {
                const win = getActiveWindow()
                if (win) {
                  emit(win, 'app:open-about')
                }
              },
            },
          ]
        : []),
      // (Toggle Developer Tools is in View. A second copy here took F12,
      // which is Go to Definition.)
    ],
  })

  return Menu.buildFromTemplate(template)
}

/** Pages that asked to reload (win:reload) and have not finished loading since. */
const reloadRequested = new WeakSet<Electron.WebContents>()

// --- Window creation ---
function createWindow(filesToOpen?: string[]): BrowserWindow {
  const savedState = validateWindowPosition(loadWindowState())

  const win = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    ...(savedState.x !== undefined && savedState.y !== undefined
      ? { x: savedState.x, y: savedState.y }
      : {}),
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0d1117',
    show: false, // Prevent flash — show after ready-to-show
    webPreferences: {
      preload: path.join(MAIN_DIR, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload is a self-contained CommonJS bundle that only uses
      // contextBridge/ipcRenderer, so the renderer can run fully sandboxed.
      sandbox: true,
      webSecurity: !process.env.VITE_DEV_SERVER_URL, // Strict in prod, relaxed in dev
      backgroundThrottling: false, // Keep terminals responsive when in background
      spellcheck: true,
    },
  })

  windows.add(win)

  // Set mainWindow reference (first window or when mainWindow is gone)
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = win
  }

  // Show window smoothly once content is painted (prevents white flash)
  win.once('ready-to-show', () => {
    win.show()
    if (savedState.isMaximized) {
      win.maximize()
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(MAIN_DIR, '../dist/index.html'))
  }

  // Open DevTools in development
  if (process.env.VITE_DEV_SERVER_URL) {
    win.webContents.openDevTools()
  }

  // Open files passed as arguments
  if (filesToOpen && filesToOpen.length > 0) {
    openFilesInWindow(win, filesToOpen)
  }

  // Security: the preload exposes window.api to whatever page this window
  // shows, so it must never leave the app. Links go to the OS only through
  // the same protocol allowlist as the shell:open-external channel; file:
  // URLs and custom schemes (which openExternal hands to OS protocol
  // handlers) are dropped.
  const routeNavigation = (url: string): boolean => {
    const decision = decideNavigation(url, APP_ORIGIN)
    if (decision === 'open-external') void shell.openExternal(url)
    else if (decision === 'deny') console.warn('[Security] Blocked navigation to', url)
    return decision === 'allow'
  }

  win.webContents.on('will-navigate', (event, url) => {
    if (!routeNavigation(url)) event.preventDefault()
  })

  win.webContents.on('will-redirect', (event, url) => {
    if (!routeNavigation(url)) event.preventDefault()
  })

  // New windows are never created; allowlisted links open in the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    routeNavigation(url)
    return { action: 'deny' }
  })

  // The renderer's beforeunload handler refuses to unload while a tab has
  // unsaved edits. A renderer cannot show a prompt then, so ask here, for a
  // close (the 'close' event fires first) or a reload the app asked for
  // (win:reload). Any other unload is the page navigating, e.g. a link: that
  // goes ahead to will-navigate, which keeps the window on the app, without
  // a question about saving. Without preventDefault() the unload is refused.
  let closeRequested = false
  win.on('close', () => { closeRequested = true })
  win.webContents.on('did-finish-load', () => reloadRequested.delete(win.webContents))
  win.webContents.on('will-prevent-unload', (event) => {
    const isReload = reloadRequested.delete(win.webContents)
    if (!closeRequested && !isReload) {
      event.preventDefault()
      return
    }
    const then = closeRequested ? 'close' : 'reload'
    closeRequested = false
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: 'Do you want to save your changes?',
      detail: "Your changes will be lost if you don't save them.",
    })
    // Don't Save: unload anyway, discarding the edits.
    if (choice === 1) event.preventDefault()
    // Save: the renderer saves, then closes or reloads again if all were saved.
    else if (choice === 0) emit(win, 'app:save-and-close', then)
  })

  // --- Track window bounds for persistence ---
  let boundsTimeout: ReturnType<typeof setTimeout> | null = null
  const debounceSaveBounds = () => {
    if (boundsTimeout) clearTimeout(boundsTimeout)
    boundsTimeout = setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isMaximized()) {
        const bounds = win.getBounds()
        savedState.x = bounds.x
        savedState.y = bounds.y
        savedState.width = bounds.width
        savedState.height = bounds.height
        // Track which display the window is on
        const currentDisplay = screen.getDisplayMatching(bounds)
        savedState.displayId = String(currentDisplay.id)
      }
    }, 300)
  }

  win.on('resize', debounceSaveBounds)
  win.on('move', debounceSaveBounds)

  win.on('close', () => {
    if (!win.isDestroyed()) {
      const isMaximized = win.isMaximized()
      if (!isMaximized) {
        const bounds = win.getBounds()
        savedState.x = bounds.x
        savedState.y = bounds.y
        savedState.width = bounds.width
        savedState.height = bounds.height
      }
      savedState.isMaximized = isMaximized
      saveWindowState(savedState)
    }
  })

  win.on('closed', () => {
    windows.delete(win)
    if (mainWindow === win) {
      mainWindow = windows.size > 0 ? Array.from(windows)[0] : null
    }
  })

  return win
}

// Where the app's own pages live: the dev server in development, the bundled
// renderer directory in production. Used for navigation and IPC sender checks.
const APP_ORIGIN: AppOrigin = {
  devServerUrl: process.env.VITE_DEV_SERVER_URL || undefined,
  rendererRoot: path.join(MAIN_DIR, '../dist'),
}

function registerIpcHandlers() {
  configureIpcTrust(APP_ORIGIN)
  registerFilesystemHandlers(() => mainWindow)
  registerTerminalHandlers()
  registerSettingsHandlers()
  registerOmoHandlers(() => mainWindow)
  registerInlineEditHandlers()
  registerGitHandlers()
  registerWorkspaceHandlers()
  registerFileOperationHandlers(() => mainWindow)
  registerDialogHandlers()
  registerClipboardHandlers()
  registerShellHandlers()
  registerTaskHandlers(() => mainWindow)

  // Window controls
  // The window that asked, not the first one.
  const senderWindow = (event: Electron.IpcMainEvent) => BrowserWindow.fromWebContents(event.sender)
  listen('win:minimize', (event) => senderWindow(event)?.minimize())
  listen('win:maximize', (event) => {
    const win = senderWindow(event)
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  listen('win:close', (event) => senderWindow(event)?.close())
  listen('win:reload', (event) => {
    reloadRequested.add(event.sender)
    event.sender.reload()
  })

  // Open folder dialog
  handle('fs:open-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    // The renderer may open exactly the folder the user picked.
    grantWorkspaceRoot(result.filePaths[0])
    return result.filePaths[0]
  })

  handle('fs:open-file-dialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const filePaths = await showOpenFilesDialog(win)
    filePaths.forEach(grantFileAccess)
    return filePaths
  })

  // Get app info
  handle('app:get-info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
  }))
}

// --- Single instance lock & file open protocol ---
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  // Another instance is already running - pass args and quit
  app.quit()
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    // `orion-ide <path>` while Orion runs: the path is relative to where that
    // command ran, not to this process.
    const items = itemsFromArgs(argv, workingDirectory, DEV_APP_PATH)

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      openItemsInWindow(mainWindow, items)
    }
  })

  // macOS: open-file event for file associations
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    if (mainWindow) {
      openFilesInWindow(mainWindow, [filePath])
    } else {
      // App not ready yet, store for later
      pendingFilesToOpen.push(filePath)
    }
  })

  app.whenReady().then(() => {
    initGrantedRoots(path.join(app.getPath('userData'), 'granted-roots.json'))
    registerIpcHandlers()

    // Build and set application menu
    // On Windows with custom title bar, the menu is hidden but accelerators still work
    const menu = buildAppMenu()
    Menu.setApplicationMenu(isWindows ? null : menu)

    // On Windows, keep the menu available for accelerators even though it's hidden
    if (isWindows) {
      Menu.setApplicationMenu(menu)
      // The menu won't show because frame: false, but accelerators are active
    }

    // Files and a folder named on the command line. (A global shortcut used
    // to grab Ctrl+Shift+N from every other application on the system.)
    const cliItems = itemsFromArgs(process.argv, process.cwd(), DEV_APP_PATH)
    const win = createWindow([...pendingFilesToOpen, ...cliItems.files])
    openItemsInWindow(win, { files: [], folders: cliItems.folders })
  })

  // Shells must not outlive the app.
  app.on('will-quit', () => killAllTerminals())

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('activate', () => {
    if (windows.size === 0) createWindow()
  })
}

// Files received before app is ready (macOS open-file)
const pendingFilesToOpen: string[] = []
