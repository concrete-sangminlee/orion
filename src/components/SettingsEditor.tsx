import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  Search, RotateCcw, ChevronDown, ChevronRight, Check, Copy, X,
  Settings, Code, Terminal, Puzzle, Zap, Sparkles, Monitor, Palette,
  FileJson, Cloud, CloudOff, Clock, Pin, PinOff, AlertCircle, Info,
  ExternalLink, Filter, Star, Eye, EyeOff, FolderOpen, Plus, Trash2,
  Lightbulb, Tag,
} from 'lucide-react'
import {
  useSettingsStore,
  SETTINGS_SCHEMA,
  SETTING_DEFAULTS,
  getEffectiveSetting,
  validateSetting,
  searchSettings,
  getSettingCategories,
  type SettingDescriptor,
  type SettingsLayer,
  type ValidationResult,
} from '@/store/settings'

// ── Types ─────────────────────────────────────────────────────────────────────

type SettingsScope = 'user' | 'workspace' | 'folder'
type ViewMode = 'ui' | 'json'

interface CategoryDef {
  id: string
  label: string
  icon: React.ReactNode
  description: string
  matchKeys: string[]
  children?: CategoryDef[]
}

interface RecentlyModified {
  key: string
  timestamp: number
  layer: SettingsLayer
}

interface SettingGroupState {
  [groupKey: string]: boolean
}

// ── Extended Settings Schema ──────────────────────────────────────────────────

interface ExtendedSettingDescriptor extends SettingDescriptor {
  tags?: string[]
  markdownDescription?: string
  deprecationMessage?: string
  scope?: SettingsScope[]
  pinned?: boolean
  group?: string
  extensionId?: string
  color?: boolean
  filePath?: boolean
}

const ADDITIONAL_SETTINGS: ExtendedSettingDescriptor[] = [
  // ── Workbench ──────────────────────────────────────────────────────
  {
    key: 'workbench.colorTheme', type: 'string', default: 'Orion Dark',
    description: 'Specifies the color theme used in the workbench.',
    markdownDescription: 'Specifies the **color theme** used in the workbench. Use `Preferences: Color Theme` to browse.',
    enum: ['Orion Dark', 'Orion Light', 'Monokai', 'Dracula', 'Nord', 'Solarized Dark', 'Solarized Light', 'High Contrast'],
    category: 'workbench', tags: ['theme', 'appearance'], group: 'Appearance', pinned: true,
  },
  {
    key: 'workbench.iconTheme', type: 'string', default: 'material-icon-theme',
    description: 'Specifies the file icon theme.',
    enum: ['material-icon-theme', 'seti', 'vscode-icons', 'none'],
    category: 'workbench', tags: ['icons', 'appearance'], group: 'Appearance',
  },
  {
    key: 'workbench.sideBar.location', type: 'string', default: 'left',
    description: 'Controls the position of the sidebar and activity bar.',
    enum: ['left', 'right'], category: 'workbench', tags: ['sidebar', 'layout'], group: 'Layout',
  },
  {
    key: 'workbench.activityBar.visible', type: 'boolean', default: true,
    description: 'Controls the visibility of the activity bar.', category: 'workbench', tags: ['layout'], group: 'Layout',
  },
  {
    key: 'workbench.statusBar.visible', type: 'boolean', default: true,
    description: 'Controls the visibility of the status bar.', category: 'workbench', tags: ['layout'], group: 'Layout',
  },
  {
    key: 'workbench.editor.showTabs', type: 'string', default: 'multiple',
    description: 'Controls whether editors show as individual tabs.',
    enum: ['multiple', 'single', 'none'], category: 'workbench', tags: ['tabs', 'editor'], group: 'Editor Management',
  },
  {
    key: 'workbench.editor.enablePreview', type: 'boolean', default: true,
    description: 'Controls whether opened editors show in preview mode.',
    markdownDescription: 'Controls whether editors show in **preview mode**. Preview editors are reused until pinned.',
    category: 'workbench', tags: ['preview', 'tabs'], group: 'Editor Management', pinned: true,
  },
  {
    key: 'workbench.startupEditor', type: 'string', default: 'welcomePage',
    description: 'Controls which editor is shown at startup.',
    enum: ['none', 'welcomePage', 'newUntitledFile', 'welcomePageInEmptyWorkbench'],
    category: 'workbench', tags: ['startup'], group: 'Startup',
  },
  {
    key: 'workbench.tree.indent', type: 'number', default: 8,
    description: 'Controls tree indentation in pixels.', min: 0, max: 40,
    category: 'workbench', tags: ['tree', 'indent'], group: 'Tree Widget',
  },
  {
    key: 'workbench.breadcrumbs.enabled', type: 'boolean', default: true,
    description: 'Enable or disable breadcrumb navigation.', category: 'workbench', tags: ['breadcrumbs'], group: 'Navigation',
  },
  {
    key: 'workbench.tree.renderIndentGuides', type: 'string', default: 'onHover',
    description: 'Controls whether the tree offers indent guides.',
    enum: ['none', 'onHover', 'always'], category: 'workbench', tags: ['tree', 'guides'], group: 'Tree Widget',
  },
  {
    key: 'workbench.tips.enabled', type: 'boolean', default: true,
    description: 'Show tips and tricks on the Welcome page.',
    category: 'workbench', tags: ['tips', 'welcome'], group: 'Startup',
  },
  {
    key: 'workbench.editor.revealIfOpen', type: 'boolean', default: false,
    description: 'Reveal an already opened editor instead of opening a new one.',
    category: 'workbench', tags: ['editor', 'reveal', 'tabs'], group: 'Editor Management',
  },
  {
    key: 'workbench.editor.pinnedTabSizing', type: 'string', default: 'normal',
    description: 'Controls the sizing of pinned editor tabs.',
    enum: ['normal', 'compact', 'shrink'], category: 'workbench', tags: ['tabs', 'pin', 'sizing'], group: 'Editor Management',
  },
  {
    key: 'workbench.panel.defaultLocation', type: 'string', default: 'bottom',
    description: 'Controls the default location of the panel (output, debug console, terminal).',
    enum: ['bottom', 'right', 'left'],
    category: 'workbench', tags: ['panel', 'layout'], group: 'Layout',
  },
  {
    key: 'workbench.editor.closeOnFileDelete', type: 'boolean', default: false,
    description: 'Automatically close editors when the underlying file is deleted.',
    category: 'workbench', tags: ['editor', 'close', 'files'], group: 'Editor Management',
  },
  {
    key: 'workbench.editor.highlightModifiedTabs', type: 'boolean', default: false,
    description: 'Highlight tabs with unsaved changes with a dot indicator.',
    category: 'workbench', tags: ['tabs', 'unsaved', 'indicator'], group: 'Editor Management',
  },
  {
    key: 'workbench.editor.labelFormat', type: 'string', default: 'default',
    description: 'Controls the format of the label for an editor tab.',
    enum: ['default', 'short', 'medium', 'long'],
    category: 'workbench', tags: ['tabs', 'label', 'format'], group: 'Editor Management',
  },
  {
    key: 'workbench.list.smoothScrolling', type: 'boolean', default: false,
    description: 'Enable smooth scrolling in lists and trees.',
    category: 'workbench', tags: ['scroll', 'smooth', 'Experimental'], group: 'Tree Widget',
  },
  {
    key: 'workbench.colorCustomizations', type: 'object', default: {},
    description: 'Overrides colors from the currently selected color theme.',
    markdownDescription: 'Overrides colors from the currently selected **color theme**. Use `workbench.colorCustomizations` to customize individual UI colors.',
    category: 'workbench', tags: ['theme', 'colors', 'customization'], group: 'Appearance',
  },
  {
    key: 'workbench.editor.tabCloseButton', type: 'string', default: 'right',
    description: 'Controls the position of tab close buttons.',
    enum: ['left', 'right', 'off'], category: 'workbench', tags: ['tabs'], group: 'Editor Management',
  },
  // ── Features ───────────────────────────────────────────────────────
  {
    key: 'features.fileNesting.enabled', type: 'boolean', default: true,
    description: 'Controls whether file nesting is enabled in the explorer.',
    markdownDescription: 'Controls whether **file nesting** is enabled. Related files (e.g. `tsconfig.json` and `tsconfig.node.json`) nest under a parent.',
    category: 'features', tags: ['explorer', 'nesting', 'Experimental'], group: 'Explorer',
  },
  {
    key: 'features.timeline.enabled', type: 'boolean', default: true,
    description: 'Enable the timeline panel for file history.', category: 'features', tags: ['timeline', 'git'], group: 'Explorer',
  },
  {
    key: 'features.search.useRipgrep', type: 'boolean', default: true,
    description: 'Use ripgrep for file search.', category: 'features', tags: ['search', 'performance'], group: 'Search',
  },
  {
    key: 'features.search.maxResults', type: 'number', default: 20000,
    description: 'Maximum number of search results.', min: 100, max: 100000,
    category: 'features', tags: ['search'], group: 'Search',
  },
  {
    key: 'features.git.enabled', type: 'boolean', default: true,
    description: 'Whether git integration is enabled.', category: 'features', tags: ['git', 'scm'], group: 'Source Control', pinned: true,
  },
  {
    key: 'features.git.autoFetch', type: 'boolean', default: false,
    description: 'Periodically fetch from remotes.', category: 'features', tags: ['git', 'remote'], group: 'Source Control',
  },
  {
    key: 'features.git.autostash', type: 'boolean', default: false,
    description: 'Stash changes before pulling and restore after.', category: 'features', tags: ['git', 'stash'], group: 'Source Control',
  },
  {
    key: 'features.autoSave', type: 'string', default: 'off',
    description: 'Controls auto-save of editors.',
    enum: ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'],
    category: 'features', tags: ['save', 'auto'], group: 'Files', pinned: true,
  },
  {
    key: 'features.files.trimTrailingWhitespace', type: 'boolean', default: false,
    description: 'Trim trailing whitespace when saving.', category: 'features', tags: ['whitespace', 'save'], group: 'Files',
  },
  {
    key: 'features.files.insertFinalNewline', type: 'boolean', default: false,
    description: 'Insert a final newline at end of file on save.', category: 'features', tags: ['newline', 'save'], group: 'Files',
  },
  {
    key: 'features.files.encoding', type: 'string', default: 'utf8',
    description: 'Default character set encoding.',
    enum: ['utf8', 'utf16le', 'utf16be', 'ascii', 'iso-8859-1', 'windows-1252', 'shift_jis', 'euc-kr'],
    category: 'features', tags: ['encoding'], group: 'Files',
  },
  {
    key: 'features.files.defaultLanguage', type: 'string', default: '',
    description: 'Default language mode for new untitled files.', category: 'features', tags: ['language'], group: 'Files',
  },
  // ── Features (continued) ────────────────────────────────────────
  {
    key: 'features.files.eol', type: 'string', default: 'auto',
    description: 'The default end-of-line character.',
    enum: ['auto', 'LF', 'CRLF'], category: 'features', tags: ['eol', 'line ending'], group: 'Files',
  },
  {
    key: 'features.files.exclude', type: 'object', default: { '**/.git': true, '**/.DS_Store': true, '**/node_modules': true },
    description: 'Glob patterns for excluding files and folders from the explorer and search.',
    markdownDescription: 'Configure **glob patterns** for excluding files and folders. The file explorer and search will ignore matched patterns.',
    category: 'features', tags: ['exclude', 'glob', 'explorer'], group: 'Files',
  },
  {
    key: 'features.files.watcherExclude', type: 'object', default: { '**/.git/objects/**': true, '**/node_modules/**': true },
    description: 'Glob patterns to exclude from file watching to reduce CPU.',
    category: 'features', tags: ['watcher', 'performance'], group: 'Files',
  },
  {
    key: 'features.search.exclude', type: 'object', default: { '**/node_modules': true, '**/bower_components': true },
    description: 'Glob patterns to exclude from search results.',
    category: 'features', tags: ['search', 'exclude'], group: 'Search',
  },
  {
    key: 'features.search.smartCase', type: 'boolean', default: true,
    description: 'Case-sensitive search only when query contains uppercase.',
    category: 'features', tags: ['search', 'case'], group: 'Search',
  },
  {
    key: 'features.git.confirmSync', type: 'boolean', default: true,
    description: 'Confirm before synchronizing git repositories.',
    category: 'features', tags: ['git', 'sync'], group: 'Source Control',
  },
  {
    key: 'features.git.defaultCloneDirectory', type: 'string', default: '', filePath: true,
    description: 'The default location to clone a git repository.',
    category: 'features', tags: ['git', 'clone', 'path'], group: 'Source Control',
  },
  {
    key: 'features.problems.decorations.enabled', type: 'boolean', default: true,
    description: 'Show problems as decorations in the explorer tree.',
    category: 'features', tags: ['problems', 'diagnostics'], group: 'Problems',
  },
  {
    key: 'features.debug.console.fontSize', type: 'number', default: 14,
    description: 'Font size in the debug console.', min: 8, max: 30,
    category: 'features', tags: ['debug', 'console', 'font'], group: 'Debug',
  },
  {
    key: 'features.debug.allowBreakpointsEverywhere', type: 'boolean', default: false,
    description: 'Allow setting breakpoints in any file.',
    category: 'features', tags: ['debug', 'breakpoints'], group: 'Debug',
  },
  // ── Terminal ──────────────────────────────────────────────────────
  {
    key: 'terminal.cursorStyle', type: 'string', default: 'block',
    description: 'Controls the terminal cursor style.',
    enum: ['block', 'underline', 'bar'], category: 'terminal', tags: ['cursor'], group: 'Cursor',
  },
  {
    key: 'terminal.cursorBlinking', type: 'boolean', default: false,
    description: 'Whether the terminal cursor blinks.', category: 'terminal', tags: ['cursor'], group: 'Cursor',
  },
  {
    key: 'terminal.shell.path', type: 'string', default: '', filePath: true,
    description: 'The path of the shell the terminal uses.',
    markdownDescription: 'The path of the shell the terminal uses. Set to a custom shell executable path.',
    category: 'terminal', tags: ['shell', 'path'], group: 'Shell',
  },
  {
    key: 'terminal.background', type: 'string', default: '', color: true,
    description: 'Terminal background color override.',
    category: 'terminal', tags: ['color', 'background'], group: 'Appearance',
  },
  {
    key: 'terminal.foreground', type: 'string', default: '', color: true,
    description: 'Terminal foreground color override.',
    category: 'terminal', tags: ['color', 'foreground'], group: 'Appearance',
  },
  {
    key: 'terminal.selectionBackground', type: 'string', default: '', color: true,
    description: 'Terminal selection background color.',
    category: 'terminal', tags: ['color', 'selection'], group: 'Appearance',
  },
  {
    key: 'terminal.scrollback', type: 'number', default: 1000,
    description: 'Maximum number of lines in terminal scrollback.', min: 100, max: 100000,
    category: 'terminal', tags: ['scrollback', 'buffer'], group: 'Buffer',
  },
  {
    key: 'terminal.copyOnSelection', type: 'boolean', default: false,
    description: 'Copy text to clipboard when selection is made in the terminal.',
    category: 'terminal', tags: ['copy', 'selection'], group: 'Behavior',
  },
  {
    key: 'terminal.shell.args', type: 'array', default: [],
    description: 'Arguments to pass to the terminal shell.',
    category: 'terminal', tags: ['shell', 'args'], group: 'Shell',
  },
  {
    key: 'terminal.env', type: 'object', default: {},
    description: 'Additional environment variables to set for the terminal.',
    markdownDescription: 'Additional **environment variables** injected into terminal sessions. Keys are variable names, values are their contents.',
    category: 'terminal', tags: ['env', 'environment', 'variables'], group: 'Shell',
  },
  {
    key: 'terminal.detectLocale', type: 'string', default: 'auto',
    description: 'Controls how the terminal detects locale settings.',
    enum: ['auto', 'off', 'on'], category: 'terminal', tags: ['locale', 'encoding'], group: 'Shell',
  },
  {
    key: 'terminal.enableBell', type: 'boolean', default: false,
    description: 'Enable the terminal bell sound.',
    category: 'terminal', tags: ['bell', 'audio'], group: 'Behavior',
    deprecationMessage: 'Use terminal.enableVisualBell for a less disruptive notification.',
  },
  {
    key: 'terminal.enableVisualBell', type: 'boolean', default: false,
    description: 'Enable a visual flash when the terminal bell triggers.',
    category: 'terminal', tags: ['bell', 'visual'], group: 'Behavior',
  },
  // ── Extensions ─────────────────────────────────────────────────────
  {
    key: 'extensions.autoUpdate', type: 'boolean', default: true,
    description: 'Automatically update extensions.', category: 'extensions', tags: ['update'], group: 'Management',
  },
  {
    key: 'extensions.autoCheckUpdates', type: 'boolean', default: true,
    description: 'Automatically check for extension updates.', category: 'extensions', tags: ['update'], group: 'Management',
  },
  {
    key: 'extensions.ignoreRecommendations', type: 'boolean', default: false,
    description: 'When true, extension recommendations are hidden.', category: 'extensions', tags: ['recommendations'], group: 'Recommendations',
  },
  {
    key: 'extensions.confirmedUriHandlerExtensionIds', type: 'array', default: [],
    description: 'Extension IDs allowed to handle URIs.', category: 'extensions', tags: ['uri', 'security'], group: 'Security',
  },
  // ── AI ──────────────────────────────────────────────────────────────
  {
    key: 'ai.chat.contextWindow', type: 'number', default: 8192,
    description: 'Maximum tokens for conversation context.', min: 1024, max: 200000,
    category: 'ai', tags: ['context', 'tokens'], group: 'Chat',
  },
  {
    key: 'ai.chat.systemPrompt', type: 'string', default: '',
    description: 'Custom system prompt for AI conversations.',
    markdownDescription: 'Custom **system prompt** prepended to all AI conversations. Leave empty for default.',
    category: 'ai', tags: ['prompt', 'chat'], group: 'Chat',
  },
  {
    key: 'ai.chat.showReferences', type: 'boolean', default: true,
    description: 'Show file references alongside AI responses.', category: 'ai', tags: ['references'], group: 'Chat',
  },
  {
    key: 'ai.codeActions.quickFix', type: 'boolean', default: true,
    description: 'AI-powered quick fix suggestions.', category: 'ai', tags: ['quick fix', 'Preview'], group: 'Code Actions',
  },
  {
    key: 'ai.codeActions.refactor', type: 'boolean', default: true,
    description: 'AI-powered refactoring suggestions.', category: 'ai', tags: ['refactor', 'Preview'], group: 'Code Actions',
  },
  {
    key: 'ai.agent.autoApprove', type: 'boolean', default: false,
    description: 'Automatically approve agent tool calls without prompting.',
    markdownDescription: 'Automatically approve AI agent tool calls **without prompting**. Use with caution.',
    category: 'ai', tags: ['agent', 'safety', 'Experimental'], group: 'Agent',
  },
  {
    key: 'ai.agent.maxSteps', type: 'number', default: 25,
    description: 'Maximum steps per agent task.', min: 1, max: 100,
    category: 'ai', tags: ['agent', 'limit'], group: 'Agent',
  },
  {
    key: 'ai.agent.allowedTools', type: 'array', default: ['read', 'write', 'search', 'terminal'],
    description: 'Tools the AI agent may use.', category: 'ai', tags: ['agent', 'tools', 'permissions'], group: 'Agent',
  },
  {
    key: 'ai.agent.timeout', type: 'number', default: 120000,
    description: 'Maximum time (ms) for an agent task before it is cancelled.', min: 10000, max: 600000,
    category: 'ai', tags: ['agent', 'timeout'], group: 'Agent',
  },
  {
    key: 'ai.model.temperature', type: 'number', default: 0.7,
    description: 'Sampling temperature for AI completions.', min: 0, max: 2,
    category: 'ai', tags: ['model', 'temperature', 'Experimental'], group: 'Model',
  },
  {
    key: 'ai.model.topP', type: 'number', default: 1.0,
    description: 'Nucleus sampling parameter (top_p).', min: 0, max: 1,
    category: 'ai', tags: ['model', 'sampling', 'Experimental'], group: 'Model',
  },
  {
    key: 'ai.model.maxTokens', type: 'number', default: 4096,
    description: 'Maximum tokens for AI responses.', min: 256, max: 32768,
    category: 'ai', tags: ['model', 'tokens'], group: 'Model',
  },
  {
    key: 'ai.indexing.enabled', type: 'boolean', default: true,
    description: 'Enable workspace indexing for AI context.',
    markdownDescription: 'Enable **workspace indexing** so AI features can reference project files. Indexing runs in the background.',
    category: 'ai', tags: ['indexing', 'context', 'Preview'], group: 'Indexing',
  },
  {
    key: 'ai.indexing.excludePatterns', type: 'array', default: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    description: 'Patterns to exclude from AI indexing.',
    category: 'ai', tags: ['indexing', 'exclude'], group: 'Indexing',
  },
  {
    key: 'ai.privacy.telemetry', type: 'boolean', default: false,
    description: 'Allow sending anonymous usage data for AI feature improvement.',
    category: 'ai', tags: ['privacy', 'telemetry'], group: 'Privacy',
  },
  // ── Extension-contributed settings ────────────────────────────────
  {
    key: 'prettier.printWidth', type: 'number', default: 80,
    description: 'Specify the line length that the printer will wrap on.', min: 40, max: 300,
    category: 'extensions', tags: ['prettier', 'formatting', 'Language-specific'], group: 'Prettier', extensionId: 'esbenp.prettier-vscode',
  },
  {
    key: 'prettier.singleQuote', type: 'boolean', default: false,
    description: 'Use single quotes instead of double quotes.',
    category: 'extensions', tags: ['prettier', 'formatting', 'Language-specific'], group: 'Prettier', extensionId: 'esbenp.prettier-vscode',
  },
  {
    key: 'prettier.semi', type: 'boolean', default: true,
    description: 'Print semicolons at the ends of statements.',
    category: 'extensions', tags: ['prettier', 'Language-specific'], group: 'Prettier', extensionId: 'esbenp.prettier-vscode',
  },
  {
    key: 'eslint.enable', type: 'boolean', default: true,
    description: 'Controls whether ESLint is enabled or not.',
    category: 'extensions', tags: ['eslint', 'linting'], group: 'ESLint', extensionId: 'dbaeumer.vscode-eslint',
  },
  {
    key: 'eslint.run', type: 'string', default: 'onType',
    description: 'Run the linter on save (onSave) or on type (onType).',
    enum: ['onSave', 'onType'], category: 'extensions', tags: ['eslint'], group: 'ESLint', extensionId: 'dbaeumer.vscode-eslint',
  },
  {
    key: 'gitlens.codeLens.enabled', type: 'boolean', default: true,
    description: 'Specifies whether to show CodeLens for blame annotations.',
    category: 'extensions', tags: ['gitlens', 'blame'], group: 'GitLens', extensionId: 'eamodio.gitlens',
  },
  {
    key: 'gitlens.currentLine.enabled', type: 'boolean', default: true,
    description: 'Show blame annotations on the current line.',
    category: 'extensions', tags: ['gitlens', 'blame'], group: 'GitLens', extensionId: 'eamodio.gitlens',
  },
  {
    key: 'gitlens.hovers.currentLine.over', type: 'string', default: 'annotation',
    description: 'Controls when to show hover information for the current line.',
    enum: ['annotation', 'line'], category: 'extensions', tags: ['gitlens', 'hover'], group: 'GitLens', extensionId: 'eamodio.gitlens',
  },
  {
    key: 'tailwindCSS.emmetCompletions', type: 'boolean', default: false,
    description: 'Enable completions when using Emmet-style syntax.',
    category: 'extensions', tags: ['tailwind', 'emmet', 'Preview'], group: 'Tailwind CSS', extensionId: 'bradlc.vscode-tailwindcss',
  },
  {
    key: 'tailwindCSS.classAttributes', type: 'array', default: ['class', 'className', 'ngClass'],
    description: 'HTML attributes for which to provide class completions.',
    category: 'extensions', tags: ['tailwind', 'completions'], group: 'Tailwind CSS', extensionId: 'bradlc.vscode-tailwindcss',
  },
  {
    key: 'errorLens.enabled', type: 'boolean', default: true,
    description: 'Enable inline display of errors and warnings in the editor.',
    category: 'extensions', tags: ['errors', 'inline', 'diagnostics'], group: 'Error Lens', extensionId: 'usernamehw.errorlens',
  },
  {
    key: 'errorLens.messageBackgroundMode', type: 'string', default: 'message',
    description: 'Controls the background highlight style for error messages.',
    enum: ['message', 'line', 'none'], category: 'extensions', tags: ['errors', 'display'],
    group: 'Error Lens', extensionId: 'usernamehw.errorlens',
  },
  {
    key: 'copilot.enable', type: 'object', default: { '*': true, plaintext: false, markdown: true },
    description: 'Enable or disable Copilot for specific languages.',
    markdownDescription: 'Enable or disable Copilot completions for specific **language identifiers**. Use `*` for all languages.',
    category: 'extensions', tags: ['copilot', 'completions', 'Language-specific'], group: 'Copilot', extensionId: 'github.copilot',
  },
  {
    key: 'copilot.inlineSuggest.enable', type: 'boolean', default: true,
    description: 'Show inline suggestions from GitHub Copilot.',
    category: 'extensions', tags: ['copilot', 'inline'], group: 'Copilot', extensionId: 'github.copilot',
  },
]

// ── Merge & Deduplicate ───────────────────────────────────────────────────────

const ALL_SETTINGS: ExtendedSettingDescriptor[] = [
  ...SETTINGS_SCHEMA.map((s): ExtendedSettingDescriptor => ({
    ...s, tags: s.key.split('.'), group: s.key.split('.').slice(0, -1).join(' > ') || s.category,
  })),
  ...ADDITIONAL_SETTINGS,
]

const SETTINGS_MAP = new Map<string, ExtendedSettingDescriptor>()
for (const s of ALL_SETTINGS) SETTINGS_MAP.set(s.key, s)
const UNIQUE_SETTINGS = Array.from(SETTINGS_MAP.values())

// ── Category Tree ─────────────────────────────────────────────────────────────

const CATEGORIES: CategoryDef[] = [
  { id: 'commonly-used', label: 'Commonly Used', icon: <Star size={15} />, description: 'Frequently changed settings', matchKeys: [] },
  {
    id: 'editor', label: 'Text Editor', icon: <Code size={15} />, description: 'Editor appearance and behavior', matchKeys: ['editor'],
    children: [
      { id: 'editor.cursor', label: 'Cursor', icon: <Code size={13} />, description: 'Cursor style and behavior', matchKeys: ['editor'] },
      { id: 'editor.formatting', label: 'Formatting', icon: <Code size={13} />, description: 'Code formatting', matchKeys: ['editor'] },
    ],
  },
  {
    id: 'workbench', label: 'Workbench', icon: <Monitor size={15} />, description: 'Window, sidebar, tabs', matchKeys: ['workbench', 'general', 'theme'],
    children: [
      { id: 'workbench.appearance', label: 'Appearance', icon: <Palette size={13} />, description: 'Colors and themes', matchKeys: ['workbench'] },
      { id: 'workbench.layout', label: 'Layout', icon: <Monitor size={13} />, description: 'Window layout', matchKeys: ['workbench'] },
    ],
  },
  { id: 'terminal', label: 'Terminal', icon: <Terminal size={15} />, description: 'Integrated terminal', matchKeys: ['terminal'] },
  { id: 'features', label: 'Features', icon: <Zap size={15} />, description: 'Explorer, search, SCM, files', matchKeys: ['features'] },
  { id: 'extensions', label: 'Extensions', icon: <Puzzle size={15} />, description: 'Extension management', matchKeys: ['extensions'] },
  { id: 'ai', label: 'AI', icon: <Sparkles size={15} />, description: 'AI completions, chat, agents', matchKeys: ['ai'] },
]

const COMMONLY_USED_KEYS = new Set([
  'editor.fontSize', 'editor.fontFamily', 'editor.tabSize', 'editor.wordWrap',
  'editor.formatOnSave', 'editor.minimap.enabled', 'editor.cursorStyle',
  'workbench.colorTheme', 'workbench.editor.enablePreview', 'features.autoSave',
  'features.git.enabled', 'ai.inlineCompletions', 'ai.streaming', 'terminal.fontSize',
  ...UNIQUE_SETTINGS.filter(s => s.pinned).map(s => s.key),
])

const RECOMMENDED_KEYS = new Set([
  'editor.formatOnSave', 'editor.bracketPairColorization', 'features.files.trimTrailingWhitespace',
  'features.files.insertFinalNewline', 'features.git.enabled', 'ai.codeActions.quickFix',
])

// ── Helpers ────────────────────────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return a === b
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object), kb = Object.keys(b as object)
    return ka.length === kb.length && ka.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return false
}

function renderMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    if (match[2]) parts.push(<strong key={match.index} style={{ fontWeight: 600 }}>{match[2]}</strong>)
    else if (match[3]) parts.push(<code key={match.index} style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: 3, fontSize: '0.9em', fontFamily: 'var(--font-mono, monospace)' }}>{match[3]}</code>)
    else if (match[4]) parts.push(<em key={match.index}>{match[4]}</em>)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length > 0 ? parts : text
}

function fuzzyMatch(query: string, text: string): boolean {
  const lq = query.toLowerCase(), lt = text.toLowerCase()
  if (lt.includes(lq)) return true
  let qi = 0
  for (let ti = 0; ti < lt.length && qi < lq.length; ti++) {
    if (lt[ti] === lq[qi]) qi++
  }
  return qi === lq.length
}

function getSettingsForCategory(categoryId: string, settings: ExtendedSettingDescriptor[]): ExtendedSettingDescriptor[] {
  if (categoryId === 'commonly-used') return settings.filter(s => COMMONLY_USED_KEYS.has(s.key))
  if (categoryId === 'recommended') return settings.filter(s => RECOMMENDED_KEYS.has(s.key))
  // Handle sub-categories like editor.cursor -> filter by group containing keyword
  const parts = categoryId.split('.')
  if (parts.length > 1) {
    const parentCat = CATEGORIES.find(c => c.id === parts[0])
    if (parentCat) {
      return settings.filter(s => parentCat.matchKeys.includes(s.category) && s.group?.toLowerCase().includes(parts[1]))
    }
  }
  const cat = CATEGORIES.find(c => c.id === categoryId)
  if (!cat) return []
  return settings.filter(s => cat.matchKeys.includes(s.category))
}

function groupByField(settings: ExtendedSettingDescriptor[]): Map<string, ExtendedSettingDescriptor[]> {
  const groups = new Map<string, ExtendedSettingDescriptor[]>()
  for (const s of settings) {
    const k = s.group || s.category
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(s)
  }
  return groups
}

type SyncStatus = 'synced' | 'syncing' | 'error' | 'disabled'

const TAG_STYLES: Record<string, { bg: string; color: string }> = {
  Experimental: { bg: 'rgba(248,81,73,0.12)', color: 'var(--accent-red, #f85149)' },
  Preview: { bg: 'rgba(136,98,240,0.12)', color: 'var(--accent-purple, #8862f0)' },
  'Language-specific': { bg: 'rgba(88,166,255,0.12)', color: 'var(--accent-blue, #58a6ff)' },
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const S = {
  container: { display: 'flex', flexDirection: 'column' as const, height: '100%', width: '100%', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)', fontSize: 13, overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderBottom: '1px solid var(--border-color, #333)', background: 'var(--bg-secondary, #252526)', flexShrink: 0 },
  headerTitle: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 6 },
  scopeTabs: { display: 'flex', gap: 0, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border-color, #333)' },
  scopeTab: (a: boolean) => ({ padding: '4px 12px', fontSize: 12, cursor: 'pointer', border: 'none', background: a ? 'var(--accent, #007acc)' : 'var(--bg-tertiary, #1e1e1e)', color: a ? '#fff' : 'var(--text-secondary, #999)', fontWeight: a ? 600 : 400, transition: 'all 0.15s', fontFamily: 'inherit' }),
  viewToggle: (a: boolean) => ({ padding: '4px 8px', border: '1px solid ' + (a ? 'var(--accent, #007acc)' : 'var(--border-color, #3c3c3c)'), borderRadius: 3, background: a ? 'rgba(0,122,204,0.15)' : 'transparent', color: a ? 'var(--accent, #007acc)' : 'var(--text-secondary, #999)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }),
  syncBadge: (s: SyncStatus) => ({ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 8px', borderRadius: 10, cursor: 'pointer', background: s === 'synced' ? 'rgba(63,185,80,0.15)' : s === 'syncing' ? 'rgba(88,166,255,0.15)' : s === 'error' ? 'rgba(248,81,73,0.15)' : 'rgba(139,148,158,0.15)', color: s === 'synced' ? 'var(--accent-green, #3fb950)' : s === 'syncing' ? 'var(--accent-blue, #58a6ff)' : s === 'error' ? 'var(--accent-red, #f85149)' : 'var(--text-secondary, #8b949e)' }),
  searchWrap: { padding: '8px 20px', borderBottom: '1px solid var(--border-color, #333)', background: 'var(--bg-secondary, #252526)', flexShrink: 0 },
  searchInput: { width: '100%', padding: '7px 12px 7px 32px', border: '1px solid var(--border-color, #3c3c3c)', borderRadius: 4, background: 'var(--bg-primary, #1e1e1e)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const },
  searchIcon: { position: 'absolute' as const, left: 28, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted, #666)', pointerEvents: 'none' as const },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  sidebar: { width: 220, minWidth: 180, borderRight: '1px solid var(--border-color, #333)', background: 'var(--bg-secondary, #252526)', overflowY: 'auto' as const, flexShrink: 0, padding: '6px 0' },
  sidebarItem: (a: boolean, depth: number) => ({ display: 'flex', alignItems: 'center', gap: 8, padding: `6px 14px 6px ${14 + depth * 16}px`, cursor: 'pointer', fontSize: depth > 0 ? 12 : 13, color: a ? 'var(--text-primary)' : 'var(--text-secondary, #999)', background: a ? 'var(--bg-active, rgba(255,255,255,0.06))' : 'transparent', borderLeft: a ? '2px solid var(--accent, #007acc)' : '2px solid transparent', transition: 'all 0.12s', fontWeight: a ? 500 : 400, userSelect: 'none' as const }),
  sidebarCount: { marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted, #666)', background: 'var(--bg-tertiary, #1e1e1e)', padding: '1px 6px', borderRadius: 8, minWidth: 18, textAlign: 'center' as const },
  content: { flex: 1, overflowY: 'auto' as const, padding: '0 0 40px 0' },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 24px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5, color: 'var(--text-muted, #666)', borderBottom: '1px solid var(--border-color, #333)', background: 'var(--bg-secondary, #252526)' },
  groupHeader: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 24px 6px', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #ccc)', cursor: 'pointer', userSelect: 'none' as const, position: 'sticky' as const, top: 0, background: 'var(--bg-primary)', zIndex: 1, borderBottom: '1px solid var(--border-color, #333)' },
  settingRow: { padding: '12px 24px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column' as const, gap: 6, position: 'relative' as const, transition: 'background 0.1s' },
  settingLabel: { fontWeight: 500, color: 'var(--text-primary)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 },
  settingId: { fontSize: 11, color: 'var(--text-muted, #666)', fontFamily: 'var(--font-mono, monospace)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 },
  settingDesc: { fontSize: 12, color: 'var(--text-secondary, #999)', lineHeight: 1.5, maxWidth: 600 },
  modifiedDot: { width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-blue, #58a6ff)', flexShrink: 0, marginTop: 4 },
  controlRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 },
  toggle: (on: boolean) => ({ width: 36, height: 20, borderRadius: 10, background: on ? 'var(--accent, #007acc)' : 'var(--bg-tertiary, #3c3c3c)', border: '1px solid ' + (on ? 'var(--accent, #007acc)' : 'var(--border-color, #555)'), cursor: 'pointer', position: 'relative' as const, transition: 'all 0.2s', flexShrink: 0 }),
  toggleKnob: (on: boolean) => ({ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute' as const, top: 2, left: on ? 19 : 2, transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }),
  dropdown: { padding: '5px 28px 5px 8px', border: '1px solid var(--border-color, #3c3c3c)', borderRadius: 3, background: 'var(--bg-primary, #1e1e1e)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', outline: 'none', appearance: 'none' as const, WebkitAppearance: 'none' as const, backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%23888\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', minWidth: 160 },
  numInput: { width: 80, padding: '5px 8px', border: '1px solid var(--border-color, #3c3c3c)', borderRadius: 3, background: 'var(--bg-primary, #1e1e1e)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', outline: 'none' },
  textInput: { width: '100%', maxWidth: 400, padding: '5px 8px', border: '1px solid var(--border-color, #3c3c3c)', borderRadius: 3, background: 'var(--bg-primary, #1e1e1e)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const },
  jsonEditor: { width: '100%', maxWidth: 500, minHeight: 80, padding: 8, border: '1px solid var(--border-color, #3c3c3c)', borderRadius: 3, background: 'var(--bg-primary, #1e1e1e)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono, "Cascadia Code", monospace)', outline: 'none', resize: 'vertical' as const, lineHeight: 1.5, boxSizing: 'border-box' as const },
  resetBtn: { display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', border: 'none', borderRadius: 3, background: 'transparent', color: 'var(--text-muted, #666)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' },
  tag: (bg: string, color: string) => ({ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 3, background: bg, color, fontSize: 10, fontWeight: 500, letterSpacing: 0.3 }),
  filterChip: (a: boolean) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, border: '1px solid ' + (a ? 'var(--accent, #007acc)' : 'var(--border-color, #3c3c3c)'), background: a ? 'rgba(0,122,204,0.15)' : 'transparent', color: a ? 'var(--accent, #007acc)' : 'var(--text-muted, #666)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }),
  validationErr: { fontSize: 11, color: 'var(--accent-red, #f85149)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 },
  emptyState: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: 60, color: 'var(--text-muted, #666)', gap: 12, fontSize: 13 },
  copiedToast: { position: 'fixed' as const, bottom: 40, left: '50%', transform: 'translateX(-50%)', padding: '6px 16px', borderRadius: 6, background: 'var(--bg-elevated, #2d2d2d)', color: 'var(--text-primary)', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', zIndex: 10000, border: '1px solid var(--border-color, #444)', display: 'flex', alignItems: 'center', gap: 6 },
  jsonViewContainer: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  jsonViewArea: { flex: 1, width: '100%', padding: 16, border: 'none', background: 'var(--bg-primary, #1e1e1e)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-mono, "Cascadia Code", monospace)', outline: 'none', resize: 'none' as const, lineHeight: 1.6, boxSizing: 'border-box' as const },
  colorSwatch: (c: string) => ({ width: 28, height: 28, borderRadius: 4, border: '1px solid var(--border-color, #555)', background: c || 'transparent', cursor: 'pointer', flexShrink: 0 }),
  browseBtn: { padding: '5px 10px', border: '1px solid var(--border-color, #3c3c3c)', borderRadius: 3, background: 'var(--bg-secondary, #252526)', color: 'var(--text-secondary, #999)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 },
  arrayItem: { display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' },
  arrayAddBtn: { display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: '1px dashed var(--border-color, #3c3c3c)', borderRadius: 3, background: 'transparent', color: 'var(--text-muted, #666)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' },
  extensionBadge: { fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(88,166,255,0.1)', color: 'var(--accent-blue, #58a6ff)', fontFamily: 'var(--font-mono, monospace)' },
} as const

// ── Setting Control Components ────────────────────────────────────────────────

interface ControlProps {
  descriptor: ExtendedSettingDescriptor
  value: unknown
  onChange: (value: unknown) => void
  validationError?: string
}

const ToggleControl: React.FC<ControlProps> = ({ value, onChange }) => {
  const on = Boolean(value)
  return (
    <div style={S.toggle(on)} onClick={() => onChange(!on)} role="switch" aria-checked={on} tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(!on) } }}>
      <div style={S.toggleKnob(on)} />
    </div>
  )
}

const DropdownControl: React.FC<ControlProps> = ({ descriptor, value, onChange }) => (
  <select style={S.dropdown} value={String(value ?? descriptor.default)} onChange={e => onChange(e.target.value)}>
    {(descriptor.enum ?? []).map(opt => <option key={String(opt)} value={String(opt)}>{String(opt)}</option>)}
  </select>
)

const NumberControl: React.FC<ControlProps> = ({ descriptor, value, onChange, validationError }) => {
  const [local, setLocal] = useState(String(value ?? descriptor.default))
  useEffect(() => { setLocal(String(value ?? descriptor.default)) }, [value, descriptor.default])
  const commit = () => { const n = parseFloat(local); if (!isNaN(n)) onChange(n) }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="number" style={{ ...S.numInput, borderColor: validationError ? 'var(--accent-red)' : 'var(--border-color, #3c3c3c)' }}
        value={local} onChange={e => setLocal(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit() }} min={descriptor.min} max={descriptor.max}
        step={descriptor.max && descriptor.max <= 3 ? 0.1 : 1} />
      {descriptor.min !== undefined && descriptor.max !== undefined && (
        <span style={{ fontSize: 11, color: 'var(--text-muted, #666)' }}>({descriptor.min} - {descriptor.max})</span>
      )}
    </div>
  )
}

const TextControl: React.FC<ControlProps> = ({ descriptor, value, onChange }) => {
  const [local, setLocal] = useState(String(value ?? descriptor.default ?? ''))
  useEffect(() => { setLocal(String(value ?? descriptor.default ?? '')) }, [value, descriptor.default])
  const commit = () => onChange(local)
  return (
    <input type="text" style={S.textInput} value={local} onChange={e => setLocal(e.target.value)}
      onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} placeholder={String(descriptor.default || '')} />
  )
}

const ColorControl: React.FC<ControlProps> = ({ descriptor, value, onChange }) => {
  const [local, setLocal] = useState(String(value ?? descriptor.default ?? ''))
  const colorRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setLocal(String(value ?? descriptor.default ?? '')) }, [value, descriptor.default])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={S.colorSwatch(local)} onClick={() => colorRef.current?.click()} title="Pick a color" />
      <input ref={colorRef} type="color" style={{ width: 0, height: 0, opacity: 0, position: 'absolute' }}
        value={local || '#000000'} onChange={e => { setLocal(e.target.value); onChange(e.target.value) }} />
      <input type="text" style={{ ...S.textInput, maxWidth: 140, fontFamily: 'var(--font-mono, monospace)' }}
        value={local} onChange={e => setLocal(e.target.value)} onBlur={() => onChange(local)}
        onKeyDown={e => { if (e.key === 'Enter') onChange(local) }} placeholder="#000000" />
      {local && (
        <button style={S.resetBtn} onClick={() => { setLocal(''); onChange('') }} title="Clear color">
          <X size={12} />
        </button>
      )}
    </div>
  )
}

const FilePathControl: React.FC<ControlProps> = ({ descriptor, value, onChange }) => {
  const [local, setLocal] = useState(String(value ?? descriptor.default ?? ''))
  useEffect(() => { setLocal(String(value ?? descriptor.default ?? '')) }, [value, descriptor.default])
  const commit = () => onChange(local)
  const handleBrowse = () => {
    window.dispatchEvent(new CustomEvent('orion:browse-file', {
      detail: { key: descriptor.key, current: local },
    }))
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="text" style={{ ...S.textInput, maxWidth: 320, fontFamily: 'var(--font-mono, monospace)' }}
        value={local} onChange={e => setLocal(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit() }} placeholder="/usr/bin/bash" />
      <button style={S.browseBtn} onClick={handleBrowse} title="Browse file system">
        <FolderOpen size={13} /> Browse
      </button>
    </div>
  )
}

const ArrayControl: React.FC<ControlProps> = ({ descriptor, value, onChange }) => {
  const arr: string[] = Array.isArray(value) ? value.map(String) : (Array.isArray(descriptor.default) ? (descriptor.default as string[]).map(String) : [])
  const [newItem, setNewItem] = useState('')

  const addItem = () => {
    if (!newItem.trim()) return
    onChange([...arr, newItem.trim()])
    setNewItem('')
  }
  const removeItem = (idx: number) => onChange(arr.filter((_, i) => i !== idx))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 400 }}>
      {arr.map((item, idx) => (
        <div key={idx} style={S.arrayItem}>
          <span style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary)', padding: '2px 6px', background: 'var(--bg-tertiary, #1e1e1e)', borderRadius: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item}</span>
          <button style={{ ...S.resetBtn, padding: '2px 4px' }} onClick={() => removeItem(idx)} title="Remove item">
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        <input type="text" style={{ ...S.textInput, maxWidth: 260, fontSize: 12 }} value={newItem}
          onChange={e => setNewItem(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addItem() }} placeholder="Add item..." />
        <button style={S.arrayAddBtn} onClick={addItem} title="Add item">
          <Plus size={12} /> Add
        </button>
      </div>
    </div>
  )
}

const JsonControl: React.FC<ControlProps> = ({ descriptor, value, onChange, validationError }) => {
  const [local, setLocal] = useState(() => { try { return JSON.stringify(value ?? descriptor.default, null, 2) } catch { return '{}' } })
  const [parseErr, setParseErr] = useState<string | null>(null)
  useEffect(() => { try { setLocal(JSON.stringify(value ?? descriptor.default, null, 2)); setParseErr(null) } catch { /* keep */ } }, [value, descriptor.default])
  const commit = () => { try { setParseErr(null); onChange(JSON.parse(local)) } catch (e) { setParseErr((e as Error).message) } }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <textarea style={{ ...S.jsonEditor, borderColor: (parseErr || validationError) ? 'var(--accent-red)' : 'var(--border-color, #3c3c3c)' }}
        value={local} onChange={e => setLocal(e.target.value)} onBlur={commit} spellCheck={false} />
      {parseErr && <div style={S.validationErr}><AlertCircle size={12} /> JSON: {parseErr}</div>}
    </div>
  )
}

// ── Setting Tags Renderer ─────────────────────────────────────────────────────

const SettingTags: React.FC<{ tags: string[] }> = ({ tags }) => {
  const displayTags = tags.filter(t => TAG_STYLES[t])
  if (displayTags.length === 0) return null
  return (
    <span style={{ display: 'inline-flex', gap: 4, marginLeft: 4 }}>
      {displayTags.map(t => {
        const st = TAG_STYLES[t]
        return <span key={t} style={S.tag(st.bg, st.color)}><Tag size={9} />{t}</span>
      })}
    </span>
  )
}

// ── Setting Row ───────────────────────────────────────────────────────────────

interface SettingRowProps {
  descriptor: ExtendedSettingDescriptor
  scope: SettingsScope
  onCopyId: (key: string) => void
  isRecentlyModified?: boolean
}

const SettingRow: React.FC<SettingRowProps> = React.memo(({ descriptor, scope, onCopyId, isRecentlyModified }) => {
  const [hovered, setHovered] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const layers = useSettingsStore(s => s.layers)
  const setSetting = useSettingsStore(s => s.setSetting)
  const resetSetting = useSettingsStore(s => s.resetSetting)
  const removeSetting = useSettingsStore(s => s.removeSetting)

  const effectiveValue = getEffectiveSetting(descriptor.key)
  const userValue = layers.user[descriptor.key]
  const workspaceValue = layers.workspace[descriptor.key]
  const defaultValue = descriptor.default
  const displayValue = effectiveValue ?? defaultValue
  const isModified = !deepEqual(displayValue, defaultValue)
  const isOverridden = scope === 'user' ? workspaceValue !== undefined : userValue !== undefined

  const handleChange = useCallback((newValue: unknown) => {
    const layer: SettingsLayer = scope === 'workspace' ? 'workspace' : scope === 'folder' ? 'folder' : 'user'
    const result = validateSetting(descriptor.key, newValue)
    if (!result.valid) { setValidationError(result.message ?? 'Invalid value'); return }
    setValidationError(null)
    setSetting(descriptor.key, newValue, layer)
  }, [descriptor.key, scope, setSetting])

  const handleReset = useCallback(() => {
    const layer: SettingsLayer = scope === 'workspace' ? 'workspace' : scope === 'folder' ? 'folder' : 'user'
    if (scope === 'user') resetSetting(descriptor.key)
    else removeSetting(descriptor.key, layer)
    setValidationError(null)
  }, [descriptor.key, scope, removeSetting, resetSetting])

  const renderControl = () => {
    const props: ControlProps = { descriptor, value: displayValue, onChange: handleChange, validationError: validationError ?? undefined }
    if (descriptor.color) return <ColorControl {...props} />
    if (descriptor.filePath) return <FilePathControl {...props} />
    if (descriptor.type === 'boolean') return <ToggleControl {...props} />
    if (descriptor.enum && descriptor.enum.length > 0) return <DropdownControl {...props} />
    if (descriptor.type === 'number') return <NumberControl {...props} />
    if (descriptor.type === 'array') return <ArrayControl {...props} />
    if (descriptor.type === 'object') return <JsonControl {...props} />
    return <TextControl {...props} />
  }

  const desc = descriptor.markdownDescription || descriptor.description

  return (
    <div style={{ ...S.settingRow, ...(hovered ? { background: 'var(--bg-hover, rgba(255,255,255,0.03))' } : {}), ...(isRecentlyModified ? { borderLeft: '3px solid var(--accent-blue, #58a6ff)', paddingLeft: 21 } : {}) }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        {isModified && <div style={S.modifiedDot} title="Modified from default" />}
        <div style={{ flex: 1 }}>
          <div style={S.settingLabel}>
            {descriptor.key.split('.').pop()?.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
            <SettingTags tags={descriptor.tags ?? []} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={S.settingId} onClick={() => onCopyId(descriptor.key)} title="Click to copy setting ID">
              {descriptor.key} <Copy size={10} />
            </div>
            {descriptor.extensionId && (
              <span style={S.extensionBadge} title={`Contributed by ${descriptor.extensionId}`}>
                {descriptor.extensionId}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: hovered ? 1 : 0, transition: 'opacity 0.15s' }}>
          {isModified && (
            <button style={S.resetBtn} onClick={handleReset} title="Reset to default"
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted, #666)' }}>
              <RotateCcw size={12} /> Reset
            </button>
          )}
        </div>
      </div>
      <div style={S.settingDesc}>{renderMarkdown(desc)}</div>
      <div style={S.controlRow}>{renderControl()}</div>
      {validationError && <div style={S.validationErr}><AlertCircle size={12} /> {validationError}</div>}
      {isOverridden && (
        <div style={{ fontSize: 11, color: 'var(--accent-orange, #f0883e)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <Info size={12} /> Also modified in {scope === 'user' ? 'Workspace' : 'User'} settings
        </div>
      )}
      {descriptor.deprecationMessage && (
        <div style={{ ...S.validationErr, color: 'var(--accent-orange, #f0883e)' }}>
          <AlertCircle size={12} /> Deprecated: {descriptor.deprecationMessage}
        </div>
      )}
    </div>
  )
})

SettingRow.displayName = 'SettingRow'

// ── JSON View Component ───────────────────────────────────────────────────────

const JsonView: React.FC<{ scope: SettingsScope }> = ({ scope }) => {
  const layers = useSettingsStore(s => s.layers)
  const setSetting = useSettingsStore(s => s.setSetting)
  const [parseError, setParseError] = useState<string | null>(null)

  const layerKey: SettingsLayer = scope === 'workspace' ? 'workspace' : scope === 'folder' ? 'folder' : 'user'
  const currentSettings = useMemo(() => layers[layerKey] ?? {}, [layers, layerKey])

  const [jsonText, setJsonText] = useState(() => JSON.stringify(currentSettings, null, 2))

  const prevSettingsRef = useRef(currentSettings)
  useEffect(() => {
    if (prevSettingsRef.current !== currentSettings) {
      prevSettingsRef.current = currentSettings
      setJsonText(JSON.stringify(currentSettings, null, 2))
      setParseError(null)
    }
  }, [currentSettings])

  const handleSave = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText)
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        setParseError('Settings must be a JSON object')
        return
      }
      setParseError(null)
      for (const [key, val] of Object.entries(parsed)) {
        setSetting(key, val, layerKey)
      }
    } catch (e) {
      setParseError((e as Error).message)
    }
  }, [jsonText, layerKey, setSetting])

  return (
    <div style={S.jsonViewContainer}>
      <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border-color, #333)', background: 'var(--bg-secondary, #252526)' }}>
        <FileJson size={14} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>{scope}.settings.json</span>
        <button style={{ ...S.browseBtn, fontSize: 11 }} onClick={handleSave} title="Save changes (Ctrl+S)">
          <Check size={12} /> Apply
        </button>
        {parseError && <span style={{ fontSize: 11, color: 'var(--accent-red, #f85149)' }}>{parseError}</span>}
      </div>
      <textarea style={S.jsonViewArea} value={jsonText} onChange={e => setJsonText(e.target.value)}
        spellCheck={false} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave() } }} />
    </div>
  )
}

// ── Sync Status Detail Panel ──────────────────────────────────────────────────

interface SyncDetailProps {
  status: SyncStatus
  onToggle: () => void
  scope: SettingsScope
}

const SYNC_CATEGORIES = [
  { label: 'Settings', synced: true },
  { label: 'Keyboard Shortcuts', synced: true },
  { label: 'Extensions', synced: true },
  { label: 'UI State', synced: false },
  { label: 'Snippets', synced: true },
  { label: 'Profiles', synced: false },
]

const SyncStatusPanel: React.FC<SyncDetailProps> = ({ status, onToggle, scope }) => {
  const isEnabled = status !== 'disabled'
  return (
    <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-color, #333)', background: 'var(--bg-secondary, #252526)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isEnabled ? <Cloud size={16} style={{ color: 'var(--accent-green, #3fb950)' }} /> : <CloudOff size={16} style={{ color: 'var(--text-muted)' }} />}
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Settings Sync {isEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <button style={{ ...S.browseBtn, fontSize: 11 }} onClick={onToggle}>
          {isEnabled ? 'Turn Off' : 'Turn On'}
        </button>
      </div>
      {isEnabled && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
            Your {scope} settings are synchronized across devices. Last synced {status === 'synced' ? 'moments ago' : status === 'syncing' ? 'now...' : 'failed'}.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {SYNC_CATEGORIES.map(cat => (
              <div key={cat.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0' }}>
                {cat.synced
                  ? <Check size={12} style={{ color: 'var(--accent-green, #3fb950)' }} />
                  : <X size={12} style={{ color: 'var(--text-muted, #666)' }} />}
                <span>{cat.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: cat.synced ? 'var(--accent-green, #3fb950)' : 'var(--text-muted, #666)' }}>
                  {cat.synced ? 'Synced' : 'Not synced'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {!isEnabled && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Turn on Settings Sync to keep your settings, keybindings, and extensions consistent across all your devices.
        </div>
      )}
    </div>
  )
}

// ── Recommended Settings Card ─────────────────────────────────────────────────

interface RecommendedCardProps {
  descriptor: ExtendedSettingDescriptor
  scope: SettingsScope
  onCopyId: (key: string) => void
}

const RecommendedCard: React.FC<RecommendedCardProps> = ({ descriptor, scope, onCopyId }) => {
  const layers = useSettingsStore(s => s.layers)
  const setSetting = useSettingsStore(s => s.setSetting)
  const effectiveValue = getEffectiveSetting(descriptor.key)
  const isDefault = deepEqual(effectiveValue, descriptor.default)

  const handleApplyRecommended = () => {
    // For boolean settings, toggle to `true` as recommendation; for others, apply the default
    const layer: SettingsLayer = scope === 'workspace' ? 'workspace' : 'user'
    if (descriptor.type === 'boolean') {
      setSetting(descriptor.key, true, layer)
    }
  }

  return (
    <div style={{
      padding: '10px 16px',
      margin: '0 0 8px',
      borderRadius: 6,
      border: '1px solid var(--border-color, #333)',
      background: 'var(--bg-primary)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
    }}>
      <Lightbulb size={16} style={{ color: 'var(--accent-yellow, #e3b341)', flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>
          {descriptor.key.split('.').pop()?.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {descriptor.description}
        </div>
        <div style={S.settingId} onClick={() => onCopyId(descriptor.key)} title="Copy setting ID">
          {descriptor.key} <Copy size={10} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {!isDefault && (
          <span style={{ fontSize: 10, color: 'var(--accent-green, #3fb950)', padding: '2px 6px', background: 'rgba(63,185,80,0.12)', borderRadius: 3 }}>
            Applied
          </span>
        )}
        {isDefault && descriptor.type === 'boolean' && (
          <button style={{ ...S.browseBtn, fontSize: 11 }} onClick={handleApplyRecommended}>
            <Check size={11} /> Enable
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export const SettingsEditor: React.FC = () => {
  const [scope, setScope] = useState<SettingsScope>('user')
  const [viewMode, setViewMode] = useState<ViewMode>('ui')
  const [activeCategory, setActiveCategory] = useState('commonly-used')
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<SettingGroupState>({})
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced')
  const [recentlyModified, setRecentlyModified] = useState<RecentlyModified[]>([])
  const [showModifiedOnly, setShowModifiedOnly] = useState(false)
  const [showSyncPanel, setShowSyncPanel] = useState(false)
  const [pinnedSettings, setPinnedSettings] = useState<Set<string>>(() => new Set(COMMONLY_USED_KEYS))
  const [expandedSidebarItems, setExpandedSidebarItems] = useState<Set<string>>(new Set(['editor', 'workbench']))
  const searchInputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const layers = useSettingsStore(s => s.layers)

  // Track recently modified settings
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key: string; layer: SettingsLayer }
      setRecentlyModified(prev => [{ key: detail.key, timestamp: Date.now(), layer: detail.layer }, ...prev.filter(r => r.key !== detail.key)].slice(0, 10))
    }
    window.addEventListener('orion:setting-changed', handler)
    return () => window.removeEventListener('orion:setting-changed', handler)
  }, [])

  // Ctrl+F to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); searchInputRef.current?.focus(); searchInputRef.current?.select() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleCopyId = useCallback((key: string) => {
    navigator.clipboard.writeText(key).catch(() => {})
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }, [])

  const toggleGroup = useCallback((k: string) => setCollapsedGroups(prev => ({ ...prev, [k]: !prev[k] })), [])

  const toggleSidebarExpand = useCallback((id: string) => {
    setExpandedSidebarItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  // Filtered settings
  const filteredSettings = useMemo(() => {
    let settings = UNIQUE_SETTINGS
    settings = settings.filter(s => { if (s.scope && !s.scope.includes(scope)) return false; return true })
    if (searchQuery.trim()) {
      settings = settings.filter(s =>
        fuzzyMatch(searchQuery, s.key) || fuzzyMatch(searchQuery, s.description) || fuzzyMatch(searchQuery, s.category) ||
        (s.tags ?? []).some(t => fuzzyMatch(searchQuery, t)) ||
        (s.markdownDescription ? fuzzyMatch(searchQuery, s.markdownDescription) : false)
      )
    } else {
      settings = getSettingsForCategory(activeCategory, settings)
    }
    if (showModifiedOnly) {
      settings = settings.filter(s => !deepEqual(getEffectiveSetting(s.key), s.default))
    }
    return settings
  }, [searchQuery, activeCategory, scope, showModifiedOnly, layers])

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = {}
    const flatCats = (cats: CategoryDef[]): CategoryDef[] => cats.flatMap(cat => [cat, ...(cat.children ? flatCats(cat.children) : [])])
    for (const cat of flatCats(CATEGORIES)) c[cat.id] = getSettingsForCategory(cat.id, UNIQUE_SETTINGS).length
    return c
  }, [])

  const groupedSettings = useMemo(() => groupByField(filteredSettings), [filteredSettings])

  // Count of total modified settings for the badge in header
  const modifiedCount = useMemo(() => {
    return UNIQUE_SETTINGS.filter(s => !deepEqual(getEffectiveSetting(s.key), s.default)).length
  }, [layers])

  const recentKeys = useMemo(() => {
    const cutoff = Date.now() - 5 * 60 * 1000
    return new Set(recentlyModified.filter(r => r.timestamp > cutoff).map(r => r.key))
  }, [recentlyModified])

  const recentlyModifiedSettings = useMemo(() =>
    recentlyModified.map(r => SETTINGS_MAP.get(r.key)).filter((s): s is ExtendedSettingDescriptor => s !== undefined).slice(0, 5),
    [recentlyModified]
  )

  const recommendedSettings = useMemo(() =>
    UNIQUE_SETTINGS.filter(s => RECOMMENDED_KEYS.has(s.key)),
    []
  )

  const extensionSettings = useMemo(() =>
    UNIQUE_SETTINGS.filter(s => s.extensionId),
    []
  )

  const handleOpenJson = useCallback(() => {
    window.dispatchEvent(new CustomEvent('orion:open-settings-json', { detail: { scope } }))
  }, [scope])

  const handleToggleSync = useCallback(() => {
    setSyncStatus(prev => prev === 'disabled' ? 'synced' : 'disabled')
  }, [])

  // Sidebar category renderer
  const renderSidebarItem = (cat: CategoryDef, depth: number = 0) => {
    const hasChildren = cat.children && cat.children.length > 0
    const isExpanded = expandedSidebarItems.has(cat.id)
    const isActive = activeCategory === cat.id
    return (
      <React.Fragment key={cat.id}>
        <div style={S.sidebarItem(isActive, depth)}
          onClick={() => {
            setActiveCategory(cat.id)
            contentRef.current?.scrollTo(0, 0)
            if (hasChildren) toggleSidebarExpand(cat.id)
          }}
          onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover, rgba(255,255,255,0.04))' }}
          onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
          title={cat.description}>
          {hasChildren && (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
          {!hasChildren && depth === 0 && cat.icon}
          {hasChildren && cat.icon}
          {cat.label}
          <span style={S.sidebarCount}>{categoryCounts[cat.id] ?? 0}</span>
        </div>
        {hasChildren && isExpanded && cat.children!.map(child => renderSidebarItem(child, depth + 1))}
      </React.Fragment>
    )
  }

  return (
    <div style={S.container}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={S.header}>
        <div style={S.headerTitle}>
          <Settings size={15} /> Settings
          {modifiedCount > 0 && (
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: 'rgba(88,166,255,0.15)', color: 'var(--accent-blue, #58a6ff)', fontWeight: 500, marginLeft: 4 }}>
              {modifiedCount} modified
            </span>
          )}
        </div>

        {/* Scope Tabs */}
        <div style={S.scopeTabs}>
          {(['user', 'workspace', 'folder'] as SettingsScope[]).map(s => (
            <button key={s} style={S.scopeTab(scope === s)} onClick={() => setScope(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* View Mode Toggle */}
        <button style={S.viewToggle(viewMode === 'json')} onClick={() => setViewMode(v => v === 'ui' ? 'json' : 'ui')}
          title={viewMode === 'ui' ? 'Switch to JSON view' : 'Switch to UI view'}>
          {viewMode === 'ui' ? <FileJson size={13} /> : <Settings size={13} />}
          {viewMode === 'ui' ? 'JSON' : 'UI'}
        </button>

        {/* Sync Status */}
        <div style={S.syncBadge(syncStatus)} onClick={() => setShowSyncPanel(v => !v)}
          title="Click to view sync details">
          {syncStatus === 'synced' && <><Cloud size={12} /> Synced</>}
          {syncStatus === 'syncing' && <><Cloud size={12} /> Syncing...</>}
          {syncStatus === 'error' && <><CloudOff size={12} /> Sync Error</>}
          {syncStatus === 'disabled' && <><CloudOff size={12} /> Sync Off</>}
        </div>

        {/* Open JSON File */}
        <button style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: '1px solid var(--border-color, #3c3c3c)', borderRadius: 3, background: 'transparent', color: 'var(--text-secondary, #999)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
          onClick={handleOpenJson} title={`Open ${scope} settings JSON`}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-color, #3c3c3c)' }}>
          <ExternalLink size={12} /> Open File
        </button>
      </div>

      {/* ── Search Bar ─────────────────────────────────────────────────── */}
      {viewMode === 'ui' && (
        <div style={S.searchWrap}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={S.searchIcon} />
            <input ref={searchInputRef} style={S.searchInput} type="text"
              placeholder="Search settings by name, description, or tag (Ctrl+F)"
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            {searchQuery && (
              <button style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted, #666)', cursor: 'pointer', padding: 2, display: 'flex' }}
                onClick={() => setSearchQuery('')}><X size={14} /></button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={S.filterChip(showModifiedOnly)} onClick={() => setShowModifiedOnly(v => !v)}>
              <Filter size={10} /> Modified {showModifiedOnly && modifiedCount > 0 ? `(${modifiedCount})` : ''}
            </button>
            <button style={S.filterChip(false)} onClick={() => { setSearchQuery(''); setActiveCategory('commonly-used'); setShowModifiedOnly(false) }}>
              <RotateCcw size={10} /> Reset Filters
            </button>
            {searchQuery && (
              <span style={{ fontSize: 11, color: 'var(--text-muted, #666)' }}>
                {filteredSettings.length} result{filteredSettings.length !== 1 ? 's' : ''} for &quot;{searchQuery}&quot;
              </span>
            )}
          </div>
          {/* Scope description */}
          <div style={{ fontSize: 11, color: 'var(--text-muted, #666)', marginTop: 6 }}>
            {scope === 'user' && 'User settings apply globally across all workspaces.'}
            {scope === 'workspace' && 'Workspace settings override user settings for this project only.'}
            {scope === 'folder' && 'Folder settings apply to a specific folder within a multi-root workspace.'}
          </div>
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div style={S.body}>
        {/* JSON View */}
        {viewMode === 'json' ? (
          <JsonView scope={scope} />
        ) : (
          <>
            {/* Sidebar Tree */}
            {!searchQuery && (
              <div style={S.sidebar}>
                {CATEGORIES.map(cat => renderSidebarItem(cat))}

                {/* Recommended Section in sidebar */}
                <div style={{ borderTop: '1px solid var(--border-color, #333)', marginTop: 8, paddingTop: 8 }}>
                  <div style={S.sidebarItem(activeCategory === 'recommended', 0)}
                    onClick={() => { setActiveCategory('recommended'); contentRef.current?.scrollTo(0, 0) }}
                    onMouseEnter={e => { if (activeCategory !== 'recommended') (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)' }}
                    onMouseLeave={e => { if (activeCategory !== 'recommended') (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}>
                    <Lightbulb size={15} /> Recommended
                    <span style={S.sidebarCount}>{recommendedSettings.length}</span>
                  </div>
                </div>

                {/* Sidebar footer with keyboard hints */}
                <div style={{ borderTop: '1px solid var(--border-color, #333)', marginTop: 'auto', padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted, #555)', lineHeight: 1.6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Search</span>
                      <kbd style={{ fontSize: 10, padding: '0 4px', background: 'var(--bg-tertiary)', borderRadius: 2, border: '1px solid var(--border-color, #444)', fontFamily: 'inherit' }}>Ctrl+F</kbd>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Open JSON</span>
                      <kbd style={{ fontSize: 10, padding: '0 4px', background: 'var(--bg-tertiary)', borderRadius: 2, border: '1px solid var(--border-color, #444)', fontFamily: 'inherit' }}>Ctrl+,</kbd>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Toggle View</span>
                      <kbd style={{ fontSize: 10, padding: '0 4px', background: 'var(--bg-tertiary)', borderRadius: 2, border: '1px solid var(--border-color, #444)', fontFamily: 'inherit' }}>Ctrl+Shift+J</kbd>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Content Area */}
            <div style={S.content} ref={contentRef}>
              {/* Sync Panel (toggled from header) */}
              {showSyncPanel && (
                <SyncStatusPanel status={syncStatus} onToggle={handleToggleSync} scope={scope} />
              )}

              {/* Recently Modified Section */}
              {!searchQuery && recentlyModifiedSettings.length > 0 && activeCategory === 'commonly-used' && (
                <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-color, #333)', background: 'var(--bg-secondary, #252526)' }}>
                  <div style={S.sectionHeader}><Clock size={12} /> Recently Modified</div>
                  {recentlyModifiedSettings.map(desc => (
                    <SettingRow key={`recent-${desc.key}`} descriptor={desc} scope={scope} onCopyId={handleCopyId} isRecentlyModified />
                  ))}
                </div>
              )}

              {/* Recommended Settings Section */}
              {!searchQuery && activeCategory === 'recommended' && (
                <div style={{ padding: '16px 24px' }}>
                  <div style={{ ...S.sectionHeader, padding: '0 0 10px 0' }}>
                    <Lightbulb size={12} /> Recommended settings for your workspace
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
                    These settings are suggested for improved developer experience. Enable or adjust them to match your workflow.
                  </p>
                  {recommendedSettings.map(desc => (
                    <RecommendedCard key={desc.key} descriptor={desc} scope={scope} onCopyId={handleCopyId} />
                  ))}
                </div>
              )}

              {/* Scope override notice */}
              {!searchQuery && scope !== 'user' && activeCategory !== 'recommended' && (
                <div style={{ padding: '8px 24px', borderBottom: '1px solid var(--border-color, #333)', background: 'rgba(88,166,255,0.06)', fontSize: 12, color: 'var(--accent-blue, #58a6ff)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Info size={13} />
                  <span>
                    {scope === 'workspace' ? 'Workspace' : 'Folder'} settings override User settings.
                    Changes here are saved to <code style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: 3, fontSize: 11, fontFamily: 'var(--font-mono, monospace)' }}>
                      .vscode/{scope === 'workspace' ? 'settings' : 'folder-settings'}.json
                    </code>
                  </span>
                </div>
              )}

              {/* Extension Settings Header */}
              {!searchQuery && activeCategory === 'extensions' && extensionSettings.length > 0 && (
                <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--border-color, #333)', background: 'var(--bg-secondary, #252526)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Puzzle size={13} />
                    {extensionSettings.length} settings contributed by installed extensions
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {Array.from(new Set(extensionSettings.map(s => s.extensionId).filter(Boolean))).map(extId => (
                      <span key={extId} style={S.extensionBadge}>{extId}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Search results count */}
              {searchQuery && (
                <div style={{ padding: '6px 24px', fontSize: 12, color: 'var(--text-muted, #666)', borderBottom: '1px solid var(--border-color, #333)', background: 'var(--bg-secondary, #252526)' }}>
                  {filteredSettings.length} setting{filteredSettings.length !== 1 ? 's' : ''} match &quot;{searchQuery}&quot;
                </div>
              )}

              {/* Empty State */}
              {filteredSettings.length === 0 && (
                <div style={S.emptyState}>
                  <Search size={32} strokeWidth={1.5} />
                  <span style={{ fontWeight: 500 }}>No settings found{searchQuery ? ` for "${searchQuery}"` : ''}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 360, textAlign: 'center', lineHeight: 1.5 }}>
                    {searchQuery
                      ? 'Try different keywords, or search by setting ID (e.g. "editor.fontSize")'
                      : 'Select a category from the sidebar or use the search bar above'}
                  </span>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    {showModifiedOnly && (
                      <button style={{ ...S.filterChip(false), padding: '4px 12px', fontSize: 12 }}
                        onClick={() => setShowModifiedOnly(false)}>Show all settings</button>
                    )}
                    {searchQuery && (
                      <button style={{ ...S.filterChip(false), padding: '4px 12px', fontSize: 12 }}
                        onClick={() => setSearchQuery('')}>Clear search</button>
                    )}
                  </div>
                </div>
              )}

              {/* Grouped Settings */}
              {Array.from(groupedSettings.entries()).map(([groupKey, settings]) => {
                const isCollapsed = collapsedGroups[groupKey]
                return (
                  <div key={groupKey}>
                    <div style={S.groupHeader} onClick={() => toggleGroup(groupKey)}>
                      {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      {groupKey}
                      <span style={{ fontSize: 11, color: 'var(--text-muted, #666)', fontWeight: 400, marginLeft: 4 }}>
                        ({settings.length})
                      </span>
                    </div>
                    {!isCollapsed && settings.map(desc => (
                      <SettingRow key={desc.key} descriptor={desc} scope={scope} onCopyId={handleCopyId}
                        isRecentlyModified={recentKeys.has(desc.key)} />
                    ))}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Copied Toast ───────────────────────────────────────────────── */}
      {copiedKey && (
        <div style={S.copiedToast}>
          <Check size={13} style={{ color: 'var(--accent-green, #3fb950)' }} />
          Copied: {copiedKey}
        </div>
      )}
    </div>
  )
}

export default SettingsEditor
