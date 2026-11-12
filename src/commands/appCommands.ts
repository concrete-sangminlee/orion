/**
 * Every command the palette, the title bar menus, the native menu and the
 * keyboard shortcuts offer. Each one runs a real implementation: an event an
 * always-mounted component handles (App, EditorPanel, BottomPanel,
 * useGitCommands, StatusBar), a Monaco action on the active editor, or a store
 * or IPC call. src/__tests__/command-wiring.test.ts fails when an event
 * dispatched here has no listener in the app.
 */
import {
  AlertTriangle, Archive, ArrowDown, ArrowDownUp, ArrowLeftRight, ArrowUp, ArrowUpDown, Braces, BookOpen,
  Brain, Bug, CaseSensitive, ChevronsDownUp, ChevronsUpDown, Clipboard, Clock, Code, Columns, Copy, Download, Eraser,
  ExternalLink, FilePlus, FileSearch, FileText, FolderOpen, FolderOpenDot, GitBranch, GitCommitHorizontal, GitCompare,
  Hash, Indent, Info, Keyboard, Languages, Link2, Map as MapIcon, Maximize2, Merge, MessageSquare, MessageSquareCode,
  Milestone, Minus, MousePointer, Navigation, Outdent, Paintbrush, Palette, PanelBottom, PanelLeft, Pencil, Play, Plus,
  Redo2, RefreshCw, RotateCcw, RotateCw, Rows2, Save, SaveAll, Scissors, Search, Settings, SplitSquareVertical,
  Terminal, Trash2, Type, Undo2, Upload, Wand2, WrapText, X, XCircle, Zap, CheckSquare, ListTree, LogOut,
} from 'lucide-react'
import { pickAndOpenFiles } from '@/utils/openFileInEditor'
import { registerCommands, type Command } from './registry'
import { runEditCommand, runEditorAction } from './editor'
import { newUntitledFile, revertActiveFile, saveAllFiles } from './file'

/** What the palette shows when it opens: files, `>` commands, `#` symbols, `:` line, or the theme picker. */
export type PaletteMode = 'files' | 'commands' | 'symbols' | 'line' | 'themes'

export const PALETTE_MODES: readonly PaletteMode[] = ['files', 'commands', 'symbols', 'line', 'themes']

const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }))

const openPalette = (mode: PaletteMode) => emit('orion:open-palette', { mode })

const REPO_URL = 'https://github.com/concrete-sangminlee/orion'

const openExternal = (url: string) => window.api.shellOpenExternal(url)

const editorAction = (id: string, actionId: string, category: string, title: string, rest: Partial<Command> = {}): Command => ({
  id,
  category,
  title,
  run: () => runEditorAction(actionId, title),
  ...rest,
})

export const APP_COMMANDS: readonly Command[] = [
  // ── File ──────────────────────────────────────────────────────────
  { id: 'file.newFile', category: 'File', title: 'New File', keybinding: 'Ctrl+N', icon: FilePlus, run: newUntitledFile },
  { id: 'file.openFile', category: 'File', title: 'Open File...', keybinding: 'Ctrl+O', icon: FolderOpenDot, run: pickAndOpenFiles },
  { id: 'file.openFolder', category: 'File', title: 'Open Folder...', keybinding: 'Ctrl+K Ctrl+O', icon: FolderOpen, run: () => emit('orion:open-folder') },
  { id: 'file.save', category: 'File', title: 'Save', keybinding: 'Ctrl+S', icon: Save, run: () => emit('orion:save-file') },
  { id: 'file.saveAs', category: 'File', title: 'Save As...', keybinding: 'Ctrl+Shift+S', icon: Save, run: () => emit('orion:save-file-as') },
  { id: 'file.saveAll', category: 'File', title: 'Save All', keybinding: 'Ctrl+K S', icon: SaveAll, run: saveAllFiles },
  { id: 'file.revert', category: 'File', title: 'Revert File', icon: RotateCcw, run: revertActiveFile },
  { id: 'file.closeEditor', category: 'File', title: 'Close Editor', keybinding: 'Ctrl+W', icon: X, run: () => emit('orion:close-tab') },
  { id: 'file.closeAllEditors', category: 'File', title: 'Close All Editors', icon: X, run: () => emit('orion:close-all-tabs') },
  { id: 'file.exit', category: 'File', title: 'Exit', keybinding: 'Alt+F4', icon: LogOut, run: () => window.api.close() },

  // ── Edit ──────────────────────────────────────────────────────────
  { id: 'edit.undo', category: 'Edit', title: 'Undo', keybinding: 'Ctrl+Z', icon: Undo2, run: () => runEditCommand('undo') },
  { id: 'edit.redo', category: 'Edit', title: 'Redo', keybinding: 'Ctrl+Y', icon: Redo2, run: () => runEditCommand('redo') },
  { id: 'edit.cut', category: 'Edit', title: 'Cut', keybinding: 'Ctrl+X', icon: Scissors, run: () => runEditCommand('cut') },
  { id: 'edit.copy', category: 'Edit', title: 'Copy', keybinding: 'Ctrl+C', icon: Copy, run: () => runEditCommand('copy') },
  { id: 'edit.paste', category: 'Edit', title: 'Paste', keybinding: 'Ctrl+V', icon: Clipboard, run: () => runEditCommand('paste') },
  { id: 'edit.find', category: 'Edit', title: 'Find', keybinding: 'Ctrl+F', icon: Search, run: () => emit('orion:editor-find') },
  { id: 'edit.replace', category: 'Edit', title: 'Replace', keybinding: 'Ctrl+H', icon: Search, run: () => emit('orion:editor-replace') },
  { id: 'edit.toggleLineComment', category: 'Edit', title: 'Toggle Line Comment', keybinding: 'Ctrl+/', icon: MessageSquareCode, run: () => emit('orion:toggle-line-comment') },
  { id: 'edit.toggleBlockComment', category: 'Edit', title: 'Toggle Block Comment', keybinding: 'Shift+Alt+A', icon: Braces, run: () => emit('orion:toggle-block-comment') },

  // ── Selection ─────────────────────────────────────────────────────
  { id: 'selection.selectAll', category: 'Selection', title: 'Select All', keybinding: 'Ctrl+A', icon: CheckSquare, run: () => runEditCommand('selectAll') },
  { id: 'selection.expand', category: 'Selection', title: 'Expand Selection', keybinding: 'Shift+Alt+Right', icon: MousePointer, run: () => emit('orion:expand-selection') },
  { id: 'selection.shrink', category: 'Selection', title: 'Shrink Selection', keybinding: 'Shift+Alt+Left', icon: MousePointer, run: () => emit('orion:shrink-selection') },
  editorAction('selection.copyLineUp', 'editor.action.copyLinesUpAction', 'Selection', 'Copy Line Up', { keybinding: 'Shift+Alt+Up', icon: ArrowUp }),
  editorAction('selection.copyLineDown', 'editor.action.copyLinesDownAction', 'Selection', 'Copy Line Down', { keybinding: 'Shift+Alt+Down', icon: ArrowDown }),
  editorAction('selection.moveLineUp', 'editor.action.moveLinesUpAction', 'Selection', 'Move Line Up', { keybinding: 'Alt+Up', icon: ArrowUp }),
  editorAction('selection.moveLineDown', 'editor.action.moveLinesDownAction', 'Selection', 'Move Line Down', { keybinding: 'Alt+Down', icon: ArrowDown }),
  { id: 'selection.duplicate', category: 'Selection', title: 'Duplicate Selection', icon: Copy, run: () => emit('orion:duplicate-selection') },
  { id: 'selection.addCursorAbove', category: 'Selection', title: 'Add Cursor Above', keybinding: 'Ctrl+Alt+Up', icon: MousePointer, run: () => emit('orion:add-cursor-above') },
  { id: 'selection.addCursorBelow', category: 'Selection', title: 'Add Cursor Below', keybinding: 'Ctrl+Alt+Down', icon: MousePointer, run: () => emit('orion:add-cursor-below') },
  { id: 'selection.cursorsToLineEnds', category: 'Selection', title: 'Add Cursors to Line Ends', keybinding: 'Shift+Alt+I', icon: MousePointer, run: () => emit('orion:cursors-to-line-ends') },
  { id: 'selection.addNextOccurrence', category: 'Selection', title: 'Add Next Occurrence', keybinding: 'Ctrl+D', icon: MousePointer, run: () => emit('orion:add-selection-next-match') },
  { id: 'selection.selectAllOccurrences', category: 'Selection', title: 'Select All Occurrences', keybinding: 'Ctrl+Shift+L', icon: MousePointer, run: () => emit('orion:select-all-occurrences') },
  { id: 'selection.columnSelection', category: 'Selection', title: 'Column Selection Mode', icon: MousePointer, run: () => emit('orion:column-select') },

  // ── Editor ────────────────────────────────────────────────────────
  { id: 'editor.formatDocument', category: 'Editor', title: 'Format Document', keybinding: 'Shift+Alt+F', icon: Paintbrush, run: () => emit('orion:format-document') },
  editorAction('editor.indentLines', 'editor.action.indentLines', 'Editor', 'Indent Line', { keybinding: 'Ctrl+]', icon: Indent }),
  editorAction('editor.outdentLines', 'editor.action.outdentLines', 'Editor', 'Outdent Line', { keybinding: 'Ctrl+[', icon: Outdent }),
  editorAction('editor.deleteLines', 'editor.action.deleteLines', 'Editor', 'Delete Line', { keybinding: 'Ctrl+Shift+K', icon: Trash2 }),
  { id: 'editor.sortLinesAscending', category: 'Editor', title: 'Sort Lines Ascending', icon: ArrowUpDown, run: () => emit('orion:sort-lines-asc') },
  { id: 'editor.sortLinesDescending', category: 'Editor', title: 'Sort Lines Descending', icon: ArrowDownUp, run: () => emit('orion:sort-lines-desc') },
  { id: 'editor.joinLines', category: 'Editor', title: 'Join Lines', icon: Merge, run: () => emit('orion:join-lines') },
  { id: 'editor.trimWhitespace', category: 'Editor', title: 'Trim Trailing Whitespace', icon: Eraser, run: () => emit('orion:trim-whitespace') },
  { id: 'editor.transformUppercase', category: 'Editor', title: 'Transform to Uppercase', icon: CaseSensitive, run: () => emit('orion:transform-uppercase') },
  { id: 'editor.transformLowercase', category: 'Editor', title: 'Transform to Lowercase', icon: CaseSensitive, run: () => emit('orion:transform-lowercase') },
  { id: 'editor.transformTitlecase', category: 'Editor', title: 'Transform to Title Case', icon: CaseSensitive, run: () => emit('orion:transform-titlecase') },
  { id: 'editor.foldAll', category: 'Editor', title: 'Fold All', keybinding: 'Ctrl+K Ctrl+0', icon: ChevronsDownUp, run: () => emit('orion:fold-all') },
  { id: 'editor.unfoldAll', category: 'Editor', title: 'Unfold All', keybinding: 'Ctrl+K Ctrl+J', icon: ChevronsUpDown, run: () => emit('orion:unfold-all') },
  editorAction('editor.renameSymbol', 'editor.action.rename', 'Editor', 'Rename Symbol', { keybinding: 'F2', icon: Pencil }),
  { id: 'editor.changeLanguageMode', category: 'Editor', title: 'Change Language Mode', icon: Languages, run: () => emit('orion:change-language-mode') },
  { id: 'editor.splitRight', category: 'Editor', title: 'Split Editor Right', keybinding: 'Ctrl+\\', icon: Columns, run: () => emit('orion:split-editor-right') },
  { id: 'editor.splitDown', category: 'Editor', title: 'Split Editor Down', icon: Rows2, run: () => emit('orion:split-editor-down') },
  { id: 'editor.toggleSplitDirection', category: 'Editor', title: 'Toggle Split Direction', icon: ArrowLeftRight, run: () => emit('orion:toggle-split-direction') },
  { id: 'editor.toggleSyncScroll', category: 'Editor', title: 'Toggle Sync Scroll', icon: Link2, run: () => emit('orion:toggle-sync-scroll') },
  { id: 'editor.compareWith', category: 'Editor', title: 'Compare Active File With...', icon: GitCompare, run: () => emit('orion:compare-files') },
  { id: 'editor.fontIncrease', category: 'Editor', title: 'Increase Font Size', icon: Plus, run: () => emit('orion:font-increase') },
  { id: 'editor.fontDecrease', category: 'Editor', title: 'Decrease Font Size', icon: Minus, run: () => emit('orion:font-decrease') },
  { id: 'editor.fontReset', category: 'Editor', title: 'Reset Font Size', icon: Type, run: () => emit('orion:font-reset') },

  // ── View ──────────────────────────────────────────────────────────
  { id: 'view.commandPalette', category: 'View', title: 'Command Palette', keybinding: 'Ctrl+Shift+P', icon: Zap, run: () => openPalette('commands') },
  { id: 'view.explorer', category: 'View', title: 'Show Explorer', keybinding: 'Ctrl+Shift+E', icon: FileText, run: () => emit('orion:show-explorer') },
  { id: 'view.search', category: 'View', title: 'Find in Files', keybinding: 'Ctrl+Shift+F', icon: FileSearch, run: () => emit('orion:show-search') },
  { id: 'view.sourceControl', category: 'View', title: 'Show Source Control', keybinding: 'Ctrl+Shift+G', icon: GitBranch, run: () => emit('orion:show-git') },
  { id: 'view.outline', category: 'View', title: 'Show Outline', icon: ListTree, run: () => emit('orion:show-outline') },
  { id: 'view.toggleSidebar', category: 'View', title: 'Toggle Sidebar', keybinding: 'Ctrl+B', icon: PanelLeft, run: () => emit('orion:toggle-sidebar') },
  { id: 'view.togglePanel', category: 'View', title: 'Toggle Panel', keybinding: 'Ctrl+J', icon: PanelBottom, run: () => emit('orion:toggle-terminal') },
  { id: 'view.toggleTerminal', category: 'View', title: 'Toggle Terminal', keybinding: 'Ctrl+`', icon: Terminal, run: () => emit('orion:toggle-terminal') },
  { id: 'view.toggleChat', category: 'View', title: 'Toggle Chat Panel', icon: MessageSquare, run: () => emit('orion:toggle-chat') },
  { id: 'view.showChat', category: 'View', title: 'Show Chat', keybinding: 'Ctrl+L', icon: MessageSquare, run: () => emit('orion:show-chat') },
  { id: 'view.toggleZenMode', category: 'View', title: 'Toggle Zen Mode', keybinding: 'Ctrl+K Z', icon: Maximize2, run: () => emit('orion:toggle-zen-mode') },
  { id: 'view.toggleMinimap', category: 'View', title: 'Toggle Minimap', icon: MapIcon, run: () => emit('orion:toggle-minimap') },
  { id: 'view.toggleWordWrap', category: 'View', title: 'Toggle Word Wrap', icon: WrapText, run: () => emit('orion:toggle-wordwrap') },
  { id: 'view.toggleTimeline', category: 'View', title: 'Toggle Timeline', icon: Clock, run: () => emit('orion:toggle-timeline') },

  // ── Go ────────────────────────────────────────────────────────────
  { id: 'go.file', category: 'Go', title: 'Go to File...', keybinding: 'Ctrl+P', icon: FileText, run: () => openPalette('files') },
  { id: 'go.symbol', category: 'Go', title: 'Go to Symbol...', keybinding: 'Ctrl+Shift+O', icon: Hash, run: () => openPalette('symbols') },
  // EditorPanel opens its Go to Line box for an orion:go-to-line without a line.
  { id: 'go.line', category: 'Go', title: 'Go to Line...', keybinding: 'Ctrl+G', icon: Hash, run: () => emit('orion:go-to-line') },
  editorAction('go.definition', 'editor.action.revealDefinition', 'Go', 'Go to Definition', { keybinding: 'F12', icon: Navigation }),
  editorAction('go.peekDefinition', 'editor.action.peekDefinition', 'Go', 'Peek Definition', { keybinding: 'Alt+F12', icon: Navigation }),
  editorAction('go.references', 'editor.action.goToReferences', 'Go', 'Go to References', { keybinding: 'Shift+F12', icon: Milestone }),
  editorAction('go.nextProblem', 'editor.action.marker.next', 'Go', 'Go to Next Problem', { keybinding: 'Alt+F8', icon: AlertTriangle }),
  editorAction('go.previousProblem', 'editor.action.marker.prev', 'Go', 'Go to Previous Problem', { keybinding: 'Shift+Alt+F8', icon: AlertTriangle }),

  // ── Terminal ──────────────────────────────────────────────────────
  { id: 'terminal.new', category: 'Terminal', title: 'New Terminal', keybinding: 'Ctrl+Shift+`', icon: Terminal, run: () => emit('orion:new-terminal') },
  { id: 'terminal.split', category: 'Terminal', title: 'Split Terminal', icon: SplitSquareVertical, run: () => emit('orion:split-terminal') },
  { id: 'terminal.clear', category: 'Terminal', title: 'Clear Terminal', icon: Eraser, run: () => emit('orion:clear-terminal') },
  { id: 'terminal.kill', category: 'Terminal', title: 'Kill Terminal', icon: XCircle, run: () => emit('orion:kill-terminal') },
  { id: 'terminal.runTask', category: 'Terminal', title: 'Run Task...', icon: Play, run: () => emit('orion:run-task') },
  { id: 'terminal.runBuildTask', category: 'Terminal', title: 'Run Build Task', keybinding: 'Ctrl+Shift+B', icon: Play, run: () => emit('orion:run-build') },

  // ── Git (src/hooks/useGitCommands.ts) ─────────────────────────────
  { id: 'git.stageAll', category: 'Git', title: 'Stage All', icon: Plus, run: () => emit('orion:git-stage-all') },
  { id: 'git.unstageAll', category: 'Git', title: 'Unstage All', icon: Minus, run: () => emit('orion:git-unstage-all') },
  { id: 'git.commit', category: 'Git', title: 'Commit', icon: GitCommitHorizontal, run: () => emit('orion:git-commit') },
  { id: 'git.push', category: 'Git', title: 'Push', icon: Upload, run: () => emit('orion:git-push') },
  { id: 'git.pull', category: 'Git', title: 'Pull', icon: Download, run: () => emit('orion:git-pull') },
  { id: 'git.fetch', category: 'Git', title: 'Fetch', icon: RefreshCw, run: () => emit('orion:git-fetch') },
  { id: 'git.stash', category: 'Git', title: 'Stash', icon: Archive, run: () => emit('orion:git-stash') },
  { id: 'git.showLog', category: 'Git', title: 'Show Log', icon: GitBranch, run: () => emit('orion:git-show-history') },

  // ── AI (actions EditorPanel adds to each editor) ──────────────────
  { id: 'ai.inlineEdit', category: 'AI', title: 'Inline Edit', keybinding: 'Ctrl+I', icon: Zap, run: () => emit('orion:inline-edit') },
  editorAction('ai.explainSelection', 'orion-ai-explain', 'AI', 'Explain Selection', { icon: Brain }),
  editorAction('ai.refactorSelection', 'orion-ai-refactor', 'AI', 'Refactor Selection', { icon: Wand2 }),
  editorAction('ai.fixIssues', 'orion-ai-fix-issues', 'AI', 'Fix Issues in Selection', { icon: Bug }),
  editorAction('ai.addComments', 'orion-ai-add-comments', 'AI', 'Add Comments to Selection', { icon: MessageSquareCode }),

  // ── Preferences ───────────────────────────────────────────────────
  { id: 'preferences.settings', category: 'Preferences', title: 'Open Settings', keybinding: 'Ctrl+,', icon: Settings, run: () => emit('orion:open-settings') },
  { id: 'preferences.keyboardShortcuts', category: 'Preferences', title: 'Keyboard Shortcuts', keybinding: 'Ctrl+K Ctrl+S', icon: Keyboard, run: () => emit('orion:keyboard-shortcuts') },
  { id: 'preferences.colorTheme', category: 'Preferences', title: 'Color Theme', icon: Palette, run: () => openPalette('themes') },
  { id: 'preferences.snippets', category: 'Preferences', title: 'Snippets', icon: Code, run: () => emit('orion:open-snippets') },

  // ── Help ──────────────────────────────────────────────────────────
  { id: 'help.documentation', category: 'Help', title: 'Documentation', icon: BookOpen, run: () => openExternal(`${REPO_URL}#readme`) },
  { id: 'help.reportIssue', category: 'Help', title: 'Report Issue', icon: ExternalLink, run: () => openExternal(`${REPO_URL}/issues`) },
  // There is no auto-updater; the releases page lists every version and its notes.
  { id: 'help.checkForUpdates', category: 'Help', title: 'Check for Updates...', icon: ExternalLink, run: () => openExternal(`${REPO_URL}/releases`) },
  { id: 'help.about', category: 'Help', title: 'About Orion', icon: Info, run: () => emit('orion:about') },

  // ── Developer ─────────────────────────────────────────────────────
  { id: 'developer.reloadWindow', category: 'Developer', title: 'Reload Window', icon: RotateCw, run: () => window.api.reloadWindow() },
]

registerCommands(APP_COMMANDS)
