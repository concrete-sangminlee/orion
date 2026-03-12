/**
 * Editor command registry and palette integration.
 * Central registry of all IDE commands with execution,
 * search, and keyboard shortcut binding.
 */

/* ── Types ─────────────────────────────────────────────── */

export interface Command {
  id: string
  label: string
  description?: string
  category: CommandCategory
  icon?: string
  keybinding?: string
  macKeybinding?: string
  when?: string
  handler: (...args: any[]) => void | Promise<void>
  isEnabled?: () => boolean
  isVisible?: () => boolean
}

export type CommandCategory =
  | 'file'
  | 'edit'
  | 'selection'
  | 'view'
  | 'go'
  | 'run'
  | 'terminal'
  | 'help'
  | 'debug'
  | 'git'
  | 'ai'
  | 'search'
  | 'preferences'
  | 'extensions'
  | 'window'

export interface CommandExecution {
  commandId: string
  timestamp: number
  args?: any[]
  duration?: number
  error?: string
}

/* ── Command Registry ──────────────────────────────────── */

class CommandRegistryImpl {
  private commands = new Map<string, Command>()
  private history: CommandExecution[] = []
  private maxHistory = 200
  private listeners = new Set<(event: { type: 'register' | 'execute'; command: Command }) => void>()

  /** Register a command */
  register(command: Command): () => void {
    this.commands.set(command.id, command)
    this.notify({ type: 'register', command })
    return () => this.commands.delete(command.id)
  }

  /** Register multiple commands */
  registerMany(commands: Command[]): () => void {
    const disposers = commands.map(cmd => this.register(cmd))
    return () => disposers.forEach(d => d())
  }

  /** Execute a command by ID */
  async execute(commandId: string, ...args: any[]): Promise<void> {
    const command = this.commands.get(commandId)
    if (!command) {
      console.warn(`Command not found: ${commandId}`)
      return
    }

    if (command.isEnabled && !command.isEnabled()) {
      return
    }

    const execution: CommandExecution = {
      commandId,
      timestamp: Date.now(),
      args: args.length > 0 ? args : undefined,
    }

    try {
      const start = performance.now()
      await command.handler(...args)
      execution.duration = performance.now() - start
      this.notify({ type: 'execute', command })
    } catch (err: any) {
      execution.error = err.message
      console.error(`Command failed: ${commandId}`, err)
    }

    this.history.push(execution)
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }
  }

  /** Get a command by ID */
  get(commandId: string): Command | undefined {
    return this.commands.get(commandId)
  }

  /** Get all commands */
  getAll(): Command[] {
    return [...this.commands.values()]
  }

  /** Get commands by category */
  getByCategory(category: CommandCategory): Command[] {
    return this.getAll().filter(cmd => cmd.category === category)
  }

  /** Search commands by label or description */
  search(query: string): Command[] {
    if (!query) return this.getAll()

    const lower = query.toLowerCase()
    const terms = lower.split(/\s+/)

    return this.getAll()
      .filter(cmd => {
        if (cmd.isVisible && !cmd.isVisible()) return false
        const text = `${cmd.label} ${cmd.description || ''} ${cmd.category}`.toLowerCase()
        return terms.every(term => text.includes(term))
      })
      .sort((a, b) => {
        // Exact match in label first
        const aExact = a.label.toLowerCase().includes(lower) ? 0 : 1
        const bExact = b.label.toLowerCase().includes(lower) ? 0 : 1
        if (aExact !== bExact) return aExact - bExact

        // Then by frequency in history
        const aFreq = this.getExecutionCount(a.id)
        const bFreq = this.getExecutionCount(b.id)
        if (aFreq !== bFreq) return bFreq - aFreq

        // Then alphabetically
        return a.label.localeCompare(b.label)
      })
  }

  /** Get recent commands */
  getRecent(limit = 10): Command[] {
    const seen = new Set<string>()
    const recent: Command[] = []

    for (let i = this.history.length - 1; i >= 0 && recent.length < limit; i--) {
      const exec = this.history[i]
      if (seen.has(exec.commandId)) continue
      seen.add(exec.commandId)

      const cmd = this.commands.get(exec.commandId)
      if (cmd) recent.push(cmd)
    }

    return recent
  }

  /** Get execution count for a command */
  getExecutionCount(commandId: string): number {
    return this.history.filter(e => e.commandId === commandId).length
  }

  /** Get execution history */
  getHistory(limit = 50): CommandExecution[] {
    return this.history.slice(-limit).reverse()
  }

  /** Check if a command exists */
  has(commandId: string): boolean {
    return this.commands.has(commandId)
  }

  /** Subscribe to command events */
  onCommand(listener: (event: { type: 'register' | 'execute'; command: Command }) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Clear all commands */
  clear(): void {
    this.commands.clear()
    this.history = []
  }

  private notify(event: { type: 'register' | 'execute'; command: Command }): void {
    this.listeners.forEach(l => {
      try { l(event) } catch {}
    })
  }
}

/* ── Singleton ─────────────────────────────────────────── */

export const commandRegistry = new CommandRegistryImpl()

/* ── Built-in Commands ─────────────────────────────────── */

export function registerBuiltinCommands(handlers: {
  openFile?: () => void
  saveFile?: () => void
  saveAll?: () => void
  newFile?: () => void
  closeTab?: () => void
  closeAll?: () => void
  undo?: () => void
  redo?: () => void
  find?: () => void
  replace?: () => void
  goToLine?: () => void
  goToFile?: () => void
  goToSymbol?: () => void
  toggleSidebar?: () => void
  toggleTerminal?: () => void
  toggleBottomPanel?: () => void
  toggleFullscreen?: () => void
  zoomIn?: () => void
  zoomOut?: () => void
  resetZoom?: () => void
  openSettings?: () => void
  openKeyboardShortcuts?: () => void
  showCommandPalette?: () => void
  toggleWordWrap?: () => void
  formatDocument?: () => void
  toggleComment?: () => void
  openNewWindow?: () => void
  reloadWindow?: () => void
  toggleDevTools?: () => void
  runTask?: () => void
  startDebug?: () => void
  toggleBreakpoint?: () => void
  openTerminal?: () => void
  newTerminal?: () => void
  gitCommit?: () => void
  gitPush?: () => void
  gitPull?: () => void
  aiChat?: () => void
  aiCompletion?: () => void
  aiExplain?: () => void
  aiRefactor?: () => void
  searchInFiles?: () => void
  replaceInFiles?: () => void
  installExtension?: () => void
}) {
  const noop = () => {}
  const commands: Command[] = [
    // File
    { id: 'file.open', label: 'Open File...', category: 'file', keybinding: 'Ctrl+O', macKeybinding: 'Cmd+O', handler: handlers.openFile || noop },
    { id: 'file.save', label: 'Save', category: 'file', keybinding: 'Ctrl+S', macKeybinding: 'Cmd+S', handler: handlers.saveFile || noop },
    { id: 'file.saveAll', label: 'Save All', category: 'file', keybinding: 'Ctrl+K S', macKeybinding: 'Cmd+Alt+S', handler: handlers.saveAll || noop },
    { id: 'file.new', label: 'New File', category: 'file', keybinding: 'Ctrl+N', macKeybinding: 'Cmd+N', handler: handlers.newFile || noop },
    { id: 'file.close', label: 'Close Editor', category: 'file', keybinding: 'Ctrl+W', macKeybinding: 'Cmd+W', handler: handlers.closeTab || noop },
    { id: 'file.closeAll', label: 'Close All Editors', category: 'file', keybinding: 'Ctrl+K Ctrl+W', macKeybinding: 'Cmd+K Cmd+W', handler: handlers.closeAll || noop },

    // Edit
    { id: 'edit.undo', label: 'Undo', category: 'edit', keybinding: 'Ctrl+Z', macKeybinding: 'Cmd+Z', handler: handlers.undo || noop },
    { id: 'edit.redo', label: 'Redo', category: 'edit', keybinding: 'Ctrl+Y', macKeybinding: 'Cmd+Shift+Z', handler: handlers.redo || noop },
    { id: 'edit.find', label: 'Find', category: 'edit', keybinding: 'Ctrl+F', macKeybinding: 'Cmd+F', handler: handlers.find || noop },
    { id: 'edit.replace', label: 'Replace', category: 'edit', keybinding: 'Ctrl+H', macKeybinding: 'Cmd+Alt+F', handler: handlers.replace || noop },
    { id: 'edit.formatDocument', label: 'Format Document', category: 'edit', keybinding: 'Shift+Alt+F', macKeybinding: 'Shift+Alt+F', handler: handlers.formatDocument || noop },
    { id: 'edit.toggleComment', label: 'Toggle Line Comment', category: 'edit', keybinding: 'Ctrl+/', macKeybinding: 'Cmd+/', handler: handlers.toggleComment || noop },
    { id: 'edit.toggleWordWrap', label: 'Toggle Word Wrap', category: 'edit', keybinding: 'Alt+Z', macKeybinding: 'Alt+Z', handler: handlers.toggleWordWrap || noop },

    // View
    { id: 'view.toggleSidebar', label: 'Toggle Sidebar', category: 'view', keybinding: 'Ctrl+B', macKeybinding: 'Cmd+B', handler: handlers.toggleSidebar || noop },
    { id: 'view.toggleTerminal', label: 'Toggle Terminal', category: 'view', keybinding: 'Ctrl+`', macKeybinding: 'Ctrl+`', handler: handlers.toggleTerminal || noop },
    { id: 'view.toggleBottomPanel', label: 'Toggle Bottom Panel', category: 'view', keybinding: 'Ctrl+J', macKeybinding: 'Cmd+J', handler: handlers.toggleBottomPanel || noop },
    { id: 'view.toggleFullscreen', label: 'Toggle Fullscreen', category: 'view', keybinding: 'F11', macKeybinding: 'Ctrl+Cmd+F', handler: handlers.toggleFullscreen || noop },
    { id: 'view.zoomIn', label: 'Zoom In', category: 'view', keybinding: 'Ctrl+=', macKeybinding: 'Cmd+=', handler: handlers.zoomIn || noop },
    { id: 'view.zoomOut', label: 'Zoom Out', category: 'view', keybinding: 'Ctrl+-', macKeybinding: 'Cmd+-', handler: handlers.zoomOut || noop },
    { id: 'view.resetZoom', label: 'Reset Zoom', category: 'view', keybinding: 'Ctrl+0', macKeybinding: 'Cmd+0', handler: handlers.resetZoom || noop },

    // Go
    { id: 'go.toLine', label: 'Go to Line...', category: 'go', keybinding: 'Ctrl+G', macKeybinding: 'Ctrl+G', handler: handlers.goToLine || noop },
    { id: 'go.toFile', label: 'Go to File...', category: 'go', keybinding: 'Ctrl+P', macKeybinding: 'Cmd+P', handler: handlers.goToFile || noop },
    { id: 'go.toSymbol', label: 'Go to Symbol...', category: 'go', keybinding: 'Ctrl+Shift+O', macKeybinding: 'Cmd+Shift+O', handler: handlers.goToSymbol || noop },

    // Preferences
    { id: 'preferences.settings', label: 'Open Settings', category: 'preferences', keybinding: 'Ctrl+,', macKeybinding: 'Cmd+,', handler: handlers.openSettings || noop },
    { id: 'preferences.keyboardShortcuts', label: 'Keyboard Shortcuts', category: 'preferences', keybinding: 'Ctrl+K Ctrl+S', macKeybinding: 'Cmd+K Cmd+S', handler: handlers.openKeyboardShortcuts || noop },

    // Window
    { id: 'window.commandPalette', label: 'Show Command Palette', category: 'window', keybinding: 'Ctrl+Shift+P', macKeybinding: 'Cmd+Shift+P', handler: handlers.showCommandPalette || noop },
    { id: 'window.newWindow', label: 'New Window', category: 'window', keybinding: 'Ctrl+Shift+N', macKeybinding: 'Cmd+Shift+N', handler: handlers.openNewWindow || noop },
    { id: 'window.reload', label: 'Reload Window', category: 'window', handler: handlers.reloadWindow || noop },
    { id: 'window.toggleDevTools', label: 'Toggle Developer Tools', category: 'window', keybinding: 'Ctrl+Shift+I', macKeybinding: 'Cmd+Alt+I', handler: handlers.toggleDevTools || noop },

    // Run
    { id: 'run.task', label: 'Run Task...', category: 'run', handler: handlers.runTask || noop },
    { id: 'run.startDebugging', label: 'Start Debugging', category: 'run', keybinding: 'F5', macKeybinding: 'F5', handler: handlers.startDebug || noop },
    { id: 'run.toggleBreakpoint', label: 'Toggle Breakpoint', category: 'run', keybinding: 'F9', macKeybinding: 'F9', handler: handlers.toggleBreakpoint || noop },

    // Terminal
    { id: 'terminal.open', label: 'Open Terminal', category: 'terminal', handler: handlers.openTerminal || noop },
    { id: 'terminal.new', label: 'New Terminal', category: 'terminal', keybinding: 'Ctrl+Shift+`', macKeybinding: 'Ctrl+Shift+`', handler: handlers.newTerminal || noop },

    // Git
    { id: 'git.commit', label: 'Git: Commit', category: 'git', handler: handlers.gitCommit || noop },
    { id: 'git.push', label: 'Git: Push', category: 'git', handler: handlers.gitPush || noop },
    { id: 'git.pull', label: 'Git: Pull', category: 'git', handler: handlers.gitPull || noop },

    // AI
    { id: 'ai.chat', label: 'AI: Open Chat', category: 'ai', keybinding: 'Ctrl+Shift+A', macKeybinding: 'Cmd+Shift+A', handler: handlers.aiChat || noop },
    { id: 'ai.completion', label: 'AI: Trigger Completion', category: 'ai', keybinding: 'Ctrl+Space', macKeybinding: 'Ctrl+Space', handler: handlers.aiCompletion || noop },
    { id: 'ai.explain', label: 'AI: Explain Code', category: 'ai', handler: handlers.aiExplain || noop },
    { id: 'ai.refactor', label: 'AI: Refactor Selection', category: 'ai', handler: handlers.aiRefactor || noop },

    // Search
    { id: 'search.searchInFiles', label: 'Search in Files', category: 'search', keybinding: 'Ctrl+Shift+F', macKeybinding: 'Cmd+Shift+F', handler: handlers.searchInFiles || noop },
    { id: 'search.replaceInFiles', label: 'Replace in Files', category: 'search', keybinding: 'Ctrl+Shift+H', macKeybinding: 'Cmd+Shift+H', handler: handlers.replaceInFiles || noop },

    // Extensions
    { id: 'extensions.install', label: 'Install Extension...', category: 'extensions', handler: handlers.installExtension || noop },
  ]

  return commandRegistry.registerMany(commands)
}

/* ── Command Palette Helpers ───────────────────────────── */

export interface PaletteItem {
  id: string
  label: string
  description?: string
  detail?: string
  keybinding?: string
  category?: string
  icon?: string
  handler: () => void
}

export function commandsToPaletteItems(commands: Command[]): PaletteItem[] {
  const isMac = navigator.platform?.includes('Mac')

  return commands
    .filter(cmd => !cmd.isVisible || cmd.isVisible())
    .map(cmd => ({
      id: cmd.id,
      label: cmd.label,
      description: cmd.description,
      detail: cmd.category,
      keybinding: isMac ? (cmd.macKeybinding || cmd.keybinding) : cmd.keybinding,
      category: cmd.category,
      icon: cmd.icon,
      handler: () => commandRegistry.execute(cmd.id),
    }))
}

/** Get commands formatted for the command palette */
export function getCommandPaletteItems(query = ''): PaletteItem[] {
  const commands = query ? commandRegistry.search(query) : [
    ...commandRegistry.getRecent(5),
    ...commandRegistry.getAll(),
  ]

  // Deduplicate
  const seen = new Set<string>()
  const unique = commands.filter(cmd => {
    if (seen.has(cmd.id)) return false
    seen.add(cmd.id)
    return true
  })

  return commandsToPaletteItems(unique)
}
