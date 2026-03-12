import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ─── Types ───────────────────────────────────────────────────────────────────

export type KeyBindingCategory =
  | 'general'
  | 'editor'
  | 'navigation'
  | 'search'
  | 'terminal'
  | 'debug'
  | 'git'
  | 'ai'
  | 'view'

export interface KeyBinding {
  id: string
  command: string
  key: string
  mac?: string
  when?: string
  category: KeyBindingCategory
  label: string
  isCustom?: boolean
}

export interface KeyBindingConflict {
  bindingA: KeyBinding
  bindingB: KeyBinding
  key: string
  context: string | null
}

export interface KeyChord {
  parts: string[]
  isChord: boolean
}

export interface KeyBindingExport {
  version: number
  exportedAt: string
  platform: string
  bindings: Array<{
    id: string
    key: string
  }>
}

// ─── Platform Detection ──────────────────────────────────────────────────────

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

function getPlatformKey(binding: KeyBinding): string {
  if (isMac && binding.mac) {
    return binding.mac
  }
  return binding.key
}

// ─── Key Normalization ───────────────────────────────────────────────────────

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const

function normalizeKeyPart(part: string): string {
  const trimmed = part.trim()
  const tokens = trimmed.split('+').map((t) => t.trim())

  const modifiers: string[] = []
  let mainKey = ''

  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (lower === 'ctrl' || lower === 'control') {
      modifiers.push('Ctrl')
    } else if (lower === 'alt' || lower === 'option') {
      modifiers.push('Alt')
    } else if (lower === 'shift') {
      modifiers.push('Shift')
    } else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') {
      modifiers.push('Meta')
    } else {
      mainKey = token
    }
  }

  const sortedModifiers = modifiers.sort(
    (a, b) => MODIFIER_ORDER.indexOf(a as any) - MODIFIER_ORDER.indexOf(b as any)
  )

  if (mainKey) {
    return [...sortedModifiers, mainKey].join('+')
  }
  return sortedModifiers.join('+')
}

function normalizeKey(key: string): string {
  if (!key) return ''
  const parts = key.split(/\s+/)
  return parts.map(normalizeKeyPart).join(' ')
}

function parseChord(key: string): KeyChord {
  const parts = key.split(/\s+/).filter(Boolean)
  return {
    parts: parts.map(normalizeKeyPart),
    isChord: parts.length > 1,
  }
}

function keysMatch(a: string, b: string): boolean {
  return normalizeKey(a).toLowerCase() === normalizeKey(b).toLowerCase()
}

// ─── When-Clause Evaluation ──────────────────────────────────────────────────

type WhenClauseOperator = '&&' | '||'

interface WhenClauseToken {
  negated: boolean
  context: string
}

interface WhenClauseExpr {
  tokens: WhenClauseToken[]
  operators: WhenClauseOperator[]
}

function parseWhenClause(when: string): WhenClauseExpr {
  const tokens: WhenClauseToken[] = []
  const operators: WhenClauseOperator[] = []

  const parts = when.split(/(\s*&&\s*|\s*\|\|\s*)/)

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim()
    if (!part) continue

    if (part === '&&' || part === '||') {
      operators.push(part)
    } else {
      const negated = part.startsWith('!')
      const context = negated ? part.slice(1) : part
      tokens.push({ negated, context })
    }
  }

  return { tokens, operators }
}

function evaluateWhenClause(when: string | undefined, activeContexts: Set<string>): boolean {
  if (!when) return true

  const expr = parseWhenClause(when)
  if (expr.tokens.length === 0) return true

  function evalToken(token: WhenClauseToken): boolean {
    const active = activeContexts.has(token.context)
    return token.negated ? !active : active
  }

  let result = evalToken(expr.tokens[0])

  for (let i = 0; i < expr.operators.length; i++) {
    const op = expr.operators[i]
    const nextVal = evalToken(expr.tokens[i + 1])

    if (op === '&&') {
      result = result && nextVal
    } else {
      result = result || nextVal
    }
  }

  return result
}

// ─── Available Contexts ──────────────────────────────────────────────────────

export const AVAILABLE_CONTEXTS = [
  'editorFocus',
  'editorHasSelection',
  'editorHasMultipleSelections',
  'editorReadonly',
  'editorLangId',
  'textInputFocus',
  'terminalFocus',
  'terminalVisible',
  'searchVisible',
  'searchInputFocused',
  'panelVisible',
  'panelFocus',
  'sideBarVisible',
  'sideBarFocus',
  'explorerViewletVisible',
  'debugActive',
  'debugState',
  'inDebugMode',
  'breakpointWidgetVisible',
  'gitActive',
  'gitHasChanges',
  'scmVisible',
  'suggestWidgetVisible',
  'parameterHintsVisible',
  'renameInputVisible',
  'findWidgetVisible',
  'replaceActive',
  'quickOpenVisible',
  'commandPaletteVisible',
  'inSnippetMode',
  'hasWordHighlights',
  'listFocus',
  'treeViewFocus',
  'markdownPreviewFocus',
  'notificationFocus',
  'chatFocus',
  'aiPanelVisible',
] as const

export type ContextKey = (typeof AVAILABLE_CONTEXTS)[number]

// ─── Category Labels ─────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<KeyBindingCategory, string> = {
  general: 'General',
  editor: 'Editor',
  navigation: 'Navigation',
  search: 'Search & Replace',
  terminal: 'Terminal',
  debug: 'Debug',
  git: 'Source Control',
  ai: 'AI Features',
  view: 'View & Layout',
}

export const CATEGORY_ICONS: Record<KeyBindingCategory, string> = {
  general: 'file',
  editor: 'edit',
  navigation: 'compass',
  search: 'search',
  terminal: 'terminal',
  debug: 'bug',
  git: 'git-branch',
  ai: 'sparkles',
  view: 'layout',
}

// ─── Default Keybindings Registry ────────────────────────────────────────────

const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  // ── General / File Operations ──────────────────────────────────────────────
  {
    id: 'general.newFile',
    command: 'workbench.action.files.newFile',
    key: 'Ctrl+N',
    mac: 'Cmd+N',
    category: 'general',
    label: 'New File',
  },
  {
    id: 'general.openFile',
    command: 'workbench.action.files.openFile',
    key: 'Ctrl+O',
    mac: 'Cmd+O',
    category: 'general',
    label: 'Open File',
  },
  {
    id: 'general.openFolder',
    command: 'workbench.action.files.openFolder',
    key: 'Ctrl+K Ctrl+O',
    mac: 'Cmd+K Cmd+O',
    category: 'general',
    label: 'Open Folder',
  },
  {
    id: 'general.save',
    command: 'workbench.action.files.save',
    key: 'Ctrl+S',
    mac: 'Cmd+S',
    category: 'general',
    label: 'Save',
  },
  {
    id: 'general.saveAs',
    command: 'workbench.action.files.saveAs',
    key: 'Ctrl+Shift+S',
    mac: 'Cmd+Shift+S',
    category: 'general',
    label: 'Save As...',
  },
  {
    id: 'general.saveAll',
    command: 'workbench.action.files.saveAll',
    key: 'Ctrl+K S',
    mac: 'Cmd+Alt+S',
    category: 'general',
    label: 'Save All',
  },
  {
    id: 'general.closeTab',
    command: 'workbench.action.closeActiveEditor',
    key: 'Ctrl+W',
    mac: 'Cmd+W',
    category: 'general',
    label: 'Close Tab',
  },
  {
    id: 'general.closeAllTabs',
    command: 'workbench.action.closeAllEditors',
    key: 'Ctrl+K Ctrl+W',
    mac: 'Cmd+K Cmd+W',
    category: 'general',
    label: 'Close All Tabs',
  },
  {
    id: 'general.closeOtherTabs',
    command: 'workbench.action.closeOtherEditors',
    key: '',
    category: 'general',
    label: 'Close Other Tabs',
  },
  {
    id: 'general.reopenClosed',
    command: 'workbench.action.reopenClosedEditor',
    key: 'Ctrl+Shift+T',
    mac: 'Cmd+Shift+T',
    category: 'general',
    label: 'Reopen Closed Editor',
  },
  {
    id: 'general.openRecent',
    command: 'workbench.action.openRecent',
    key: 'Ctrl+R',
    mac: 'Cmd+R',
    category: 'general',
    label: 'Open Recent',
  },
  {
    id: 'general.commandPalette',
    command: 'workbench.action.showCommands',
    key: 'Ctrl+Shift+P',
    mac: 'Cmd+Shift+P',
    category: 'general',
    label: 'Command Palette',
  },
  {
    id: 'general.quickOpen',
    command: 'workbench.action.quickOpen',
    key: 'Ctrl+P',
    mac: 'Cmd+P',
    category: 'general',
    label: 'Quick Open',
  },
  {
    id: 'general.settings',
    command: 'workbench.action.openSettings',
    key: 'Ctrl+,',
    mac: 'Cmd+,',
    category: 'general',
    label: 'Open Settings',
  },
  {
    id: 'general.keyboardShortcuts',
    command: 'workbench.action.openGlobalKeybindings',
    key: 'Ctrl+K Ctrl+S',
    mac: 'Cmd+K Cmd+S',
    category: 'general',
    label: 'Keyboard Shortcuts',
  },
  {
    id: 'general.revertFile',
    command: 'workbench.action.files.revert',
    key: '',
    category: 'general',
    label: 'Revert File',
  },
  {
    id: 'general.openSettingsJson',
    command: 'workbench.action.openSettingsJson',
    key: '',
    category: 'general',
    label: 'Open Settings (JSON)',
  },
  {
    id: 'general.openKeybindingsJson',
    command: 'workbench.action.openGlobalKeybindingsFile',
    key: '',
    category: 'general',
    label: 'Open Keybindings (JSON)',
  },

  // ── Editor ─────────────────────────────────────────────────────────────────
  {
    id: 'editor.undo',
    command: 'editor.action.undo',
    key: 'Ctrl+Z',
    mac: 'Cmd+Z',
    category: 'editor',
    label: 'Undo',
    when: 'editorFocus',
  },
  {
    id: 'editor.redo',
    command: 'editor.action.redo',
    key: 'Ctrl+Y',
    mac: 'Cmd+Shift+Z',
    category: 'editor',
    label: 'Redo',
    when: 'editorFocus',
  },
  {
    id: 'editor.cut',
    command: 'editor.action.clipboardCutAction',
    key: 'Ctrl+X',
    mac: 'Cmd+X',
    category: 'editor',
    label: 'Cut',
    when: 'editorFocus',
  },
  {
    id: 'editor.copy',
    command: 'editor.action.clipboardCopyAction',
    key: 'Ctrl+C',
    mac: 'Cmd+C',
    category: 'editor',
    label: 'Copy',
    when: 'editorFocus',
  },
  {
    id: 'editor.paste',
    command: 'editor.action.clipboardPasteAction',
    key: 'Ctrl+V',
    mac: 'Cmd+V',
    category: 'editor',
    label: 'Paste',
    when: 'editorFocus',
  },
  {
    id: 'editor.selectAll',
    command: 'editor.action.selectAll',
    key: 'Ctrl+A',
    mac: 'Cmd+A',
    category: 'editor',
    label: 'Select All',
    when: 'editorFocus',
  },
  {
    id: 'editor.find',
    command: 'actions.find',
    key: 'Ctrl+F',
    mac: 'Cmd+F',
    category: 'editor',
    label: 'Find',
    when: 'editorFocus',
  },
  {
    id: 'editor.findReplace',
    command: 'editor.action.startFindReplaceAction',
    key: 'Ctrl+H',
    mac: 'Cmd+Alt+F',
    category: 'editor',
    label: 'Find and Replace',
    when: 'editorFocus',
  },
  {
    id: 'editor.toggleLineComment',
    command: 'editor.action.commentLine',
    key: 'Ctrl+/',
    mac: 'Cmd+/',
    category: 'editor',
    label: 'Toggle Line Comment',
    when: 'editorFocus',
  },
  {
    id: 'editor.toggleBlockComment',
    command: 'editor.action.blockComment',
    key: 'Shift+Alt+A',
    mac: 'Shift+Alt+A',
    category: 'editor',
    label: 'Toggle Block Comment',
    when: 'editorFocus',
  },
  {
    id: 'editor.moveLineUp',
    command: 'editor.action.moveLinesUpAction',
    key: 'Alt+Up',
    mac: 'Alt+Up',
    category: 'editor',
    label: 'Move Line Up',
    when: 'editorFocus',
  },
  {
    id: 'editor.moveLineDown',
    command: 'editor.action.moveLinesDownAction',
    key: 'Alt+Down',
    mac: 'Alt+Down',
    category: 'editor',
    label: 'Move Line Down',
    when: 'editorFocus',
  },
  {
    id: 'editor.copyLineUp',
    command: 'editor.action.copyLinesUpAction',
    key: 'Shift+Alt+Up',
    mac: 'Shift+Alt+Up',
    category: 'editor',
    label: 'Copy Line Up',
    when: 'editorFocus',
  },
  {
    id: 'editor.copyLineDown',
    command: 'editor.action.copyLinesDownAction',
    key: 'Shift+Alt+Down',
    mac: 'Shift+Alt+Down',
    category: 'editor',
    label: 'Copy Line Down',
    when: 'editorFocus',
  },
  {
    id: 'editor.deleteLine',
    command: 'editor.action.deleteLines',
    key: 'Ctrl+Shift+K',
    mac: 'Cmd+Shift+K',
    category: 'editor',
    label: 'Delete Line',
    when: 'editorFocus',
  },
  {
    id: 'editor.indentLine',
    command: 'editor.action.indentLines',
    key: 'Ctrl+]',
    mac: 'Cmd+]',
    category: 'editor',
    label: 'Indent Line',
    when: 'editorFocus',
  },
  {
    id: 'editor.outdentLine',
    command: 'editor.action.outdentLines',
    key: 'Ctrl+[',
    mac: 'Cmd+[',
    category: 'editor',
    label: 'Outdent Line',
    when: 'editorFocus',
  },
  {
    id: 'editor.selectNextOccurrence',
    command: 'editor.action.addSelectionToNextFindMatch',
    key: 'Ctrl+D',
    mac: 'Cmd+D',
    category: 'editor',
    label: 'Add Next Occurrence',
    when: 'editorFocus',
  },
  {
    id: 'editor.selectAllOccurrences',
    command: 'editor.action.selectHighlights',
    key: 'Ctrl+Shift+L',
    mac: 'Cmd+Shift+L',
    category: 'editor',
    label: 'Select All Occurrences',
    when: 'editorFocus',
  },
  {
    id: 'editor.addCursorAbove',
    command: 'editor.action.insertCursorAbove',
    key: 'Ctrl+Alt+Up',
    mac: 'Cmd+Alt+Up',
    category: 'editor',
    label: 'Add Cursor Above',
    when: 'editorFocus',
  },
  {
    id: 'editor.addCursorBelow',
    command: 'editor.action.insertCursorBelow',
    key: 'Ctrl+Alt+Down',
    mac: 'Cmd+Alt+Down',
    category: 'editor',
    label: 'Add Cursor Below',
    when: 'editorFocus',
  },
  {
    id: 'editor.fold',
    command: 'editor.fold',
    key: 'Ctrl+Shift+[',
    mac: 'Cmd+Alt+[',
    category: 'editor',
    label: 'Fold',
    when: 'editorFocus',
  },
  {
    id: 'editor.unfold',
    command: 'editor.unfold',
    key: 'Ctrl+Shift+]',
    mac: 'Cmd+Alt+]',
    category: 'editor',
    label: 'Unfold',
    when: 'editorFocus',
  },
  {
    id: 'editor.foldAll',
    command: 'editor.foldAll',
    key: 'Ctrl+K Ctrl+0',
    mac: 'Cmd+K Cmd+0',
    category: 'editor',
    label: 'Fold All',
    when: 'editorFocus',
  },
  {
    id: 'editor.unfoldAll',
    command: 'editor.unfoldAll',
    key: 'Ctrl+K Ctrl+J',
    mac: 'Cmd+K Cmd+J',
    category: 'editor',
    label: 'Unfold All',
    when: 'editorFocus',
  },
  {
    id: 'editor.foldLevel1',
    command: 'editor.foldLevel1',
    key: 'Ctrl+K Ctrl+1',
    mac: 'Cmd+K Cmd+1',
    category: 'editor',
    label: 'Fold Level 1',
    when: 'editorFocus',
  },
  {
    id: 'editor.foldLevel2',
    command: 'editor.foldLevel2',
    key: 'Ctrl+K Ctrl+2',
    mac: 'Cmd+K Cmd+2',
    category: 'editor',
    label: 'Fold Level 2',
    when: 'editorFocus',
  },
  {
    id: 'editor.foldLevel3',
    command: 'editor.foldLevel3',
    key: 'Ctrl+K Ctrl+3',
    mac: 'Cmd+K Cmd+3',
    category: 'editor',
    label: 'Fold Level 3',
    when: 'editorFocus',
  },
  {
    id: 'editor.formatDocument',
    command: 'editor.action.formatDocument',
    key: 'Shift+Alt+F',
    mac: 'Shift+Alt+F',
    category: 'editor',
    label: 'Format Document',
    when: 'editorFocus',
  },
  {
    id: 'editor.formatSelection',
    command: 'editor.action.formatSelection',
    key: 'Ctrl+K Ctrl+F',
    mac: 'Cmd+K Cmd+F',
    category: 'editor',
    label: 'Format Selection',
    when: 'editorHasSelection',
  },
  {
    id: 'editor.renameSymbol',
    command: 'editor.action.rename',
    key: 'F2',
    category: 'editor',
    label: 'Rename Symbol',
    when: 'editorFocus',
  },
  {
    id: 'editor.quickFix',
    command: 'editor.action.quickFix',
    key: 'Ctrl+.',
    mac: 'Cmd+.',
    category: 'editor',
    label: 'Quick Fix',
    when: 'editorFocus',
  },
  {
    id: 'editor.triggerSuggest',
    command: 'editor.action.triggerSuggest',
    key: 'Ctrl+Space',
    mac: 'Ctrl+Space',
    category: 'editor',
    label: 'Trigger Suggest',
    when: 'editorFocus',
  },
  {
    id: 'editor.triggerParameterHints',
    command: 'editor.action.triggerParameterHints',
    key: 'Ctrl+Shift+Space',
    mac: 'Cmd+Shift+Space',
    category: 'editor',
    label: 'Trigger Parameter Hints',
    when: 'editorFocus',
  },
  {
    id: 'editor.peekDefinition',
    command: 'editor.action.peekDefinition',
    key: 'Alt+F12',
    mac: 'Alt+F12',
    category: 'editor',
    label: 'Peek Definition',
    when: 'editorFocus',
  },
  {
    id: 'editor.goToDefinition',
    command: 'editor.action.revealDefinition',
    key: 'F12',
    category: 'editor',
    label: 'Go to Definition',
    when: 'editorFocus',
  },
  {
    id: 'editor.goToReferences',
    command: 'editor.action.goToReferences',
    key: 'Shift+F12',
    category: 'editor',
    label: 'Go to References',
    when: 'editorFocus',
  },
  {
    id: 'editor.toggleWordWrap',
    command: 'editor.action.toggleWordWrap',
    key: 'Alt+Z',
    mac: 'Alt+Z',
    category: 'editor',
    label: 'Toggle Word Wrap',
  },
  {
    id: 'editor.expandSelection',
    command: 'editor.action.smartSelect.expand',
    key: 'Shift+Alt+Right',
    mac: 'Ctrl+Shift+Cmd+Right',
    category: 'editor',
    label: 'Expand Selection',
    when: 'editorFocus',
  },
  {
    id: 'editor.shrinkSelection',
    command: 'editor.action.smartSelect.shrink',
    key: 'Shift+Alt+Left',
    mac: 'Ctrl+Shift+Cmd+Left',
    category: 'editor',
    label: 'Shrink Selection',
    when: 'editorFocus',
  },
  {
    id: 'editor.selectLine',
    command: 'editor.action.selectLine',
    key: 'Ctrl+L',
    mac: 'Cmd+L',
    category: 'editor',
    label: 'Select Line',
    when: 'editorFocus',
  },
  {
    id: 'editor.joinLines',
    command: 'editor.action.joinLines',
    key: '',
    mac: 'Ctrl+J',
    category: 'editor',
    label: 'Join Lines',
    when: 'editorFocus',
  },
  {
    id: 'editor.transformUppercase',
    command: 'editor.action.transformToUppercase',
    key: '',
    category: 'editor',
    label: 'Transform to Uppercase',
    when: 'editorHasSelection',
  },
  {
    id: 'editor.transformLowercase',
    command: 'editor.action.transformToLowercase',
    key: '',
    category: 'editor',
    label: 'Transform to Lowercase',
    when: 'editorHasSelection',
  },
  {
    id: 'editor.transformTitleCase',
    command: 'editor.action.transformToTitleCase',
    key: '',
    category: 'editor',
    label: 'Transform to Title Case',
    when: 'editorHasSelection',
  },
  {
    id: 'editor.sortLinesAscending',
    command: 'editor.action.sortLinesAscending',
    key: '',
    category: 'editor',
    label: 'Sort Lines Ascending',
    when: 'editorHasSelection',
  },
  {
    id: 'editor.sortLinesDescending',
    command: 'editor.action.sortLinesDescending',
    key: '',
    category: 'editor',
    label: 'Sort Lines Descending',
    when: 'editorHasSelection',
  },
  {
    id: 'editor.trimTrailingWhitespace',
    command: 'editor.action.trimTrailingWhitespace',
    key: 'Ctrl+K Ctrl+X',
    mac: 'Cmd+K Cmd+X',
    category: 'editor',
    label: 'Trim Trailing Whitespace',
    when: 'editorFocus',
  },
  {
    id: 'editor.duplicateSelection',
    command: 'editor.action.duplicateSelection',
    key: '',
    category: 'editor',
    label: 'Duplicate Selection',
    when: 'editorFocus',
  },
  {
    id: 'editor.insertLineBelow',
    command: 'editor.action.insertLineAfter',
    key: 'Ctrl+Enter',
    mac: 'Cmd+Enter',
    category: 'editor',
    label: 'Insert Line Below',
    when: 'editorFocus',
  },
  {
    id: 'editor.insertLineAbove',
    command: 'editor.action.insertLineBefore',
    key: 'Ctrl+Shift+Enter',
    mac: 'Cmd+Shift+Enter',
    category: 'editor',
    label: 'Insert Line Above',
    when: 'editorFocus',
  },

  // ── Navigation ─────────────────────────────────────────────────────────────
  {
    id: 'nav.goToLine',
    command: 'workbench.action.gotoLine',
    key: 'Ctrl+G',
    mac: 'Ctrl+G',
    category: 'navigation',
    label: 'Go to Line',
  },
  {
    id: 'nav.goToSymbol',
    command: 'workbench.action.gotoSymbol',
    key: 'Ctrl+Shift+O',
    mac: 'Cmd+Shift+O',
    category: 'navigation',
    label: 'Go to Symbol in File',
  },
  {
    id: 'nav.goToSymbolWorkspace',
    command: 'workbench.action.showAllSymbols',
    key: 'Ctrl+T',
    mac: 'Cmd+T',
    category: 'navigation',
    label: 'Go to Symbol in Workspace',
  },
  {
    id: 'nav.nextTab',
    command: 'workbench.action.nextEditor',
    key: 'Ctrl+Tab',
    mac: 'Ctrl+Tab',
    category: 'navigation',
    label: 'Next Tab',
  },
  {
    id: 'nav.prevTab',
    command: 'workbench.action.previousEditor',
    key: 'Ctrl+Shift+Tab',
    mac: 'Ctrl+Shift+Tab',
    category: 'navigation',
    label: 'Previous Tab',
  },
  {
    id: 'nav.goBack',
    command: 'workbench.action.navigateBack',
    key: 'Alt+Left',
    mac: 'Ctrl+-',
    category: 'navigation',
    label: 'Go Back',
  },
  {
    id: 'nav.goForward',
    command: 'workbench.action.navigateForward',
    key: 'Alt+Right',
    mac: 'Ctrl+Shift+-',
    category: 'navigation',
    label: 'Go Forward',
  },
  {
    id: 'nav.nextError',
    command: 'editor.action.marker.nextInFiles',
    key: 'F8',
    category: 'navigation',
    label: 'Next Error or Warning',
  },
  {
    id: 'nav.prevError',
    command: 'editor.action.marker.prevInFiles',
    key: 'Shift+F8',
    category: 'navigation',
    label: 'Previous Error or Warning',
  },
  {
    id: 'nav.goToBracket',
    command: 'editor.action.jumpToBracket',
    key: 'Ctrl+Shift+\\',
    mac: 'Cmd+Shift+\\',
    category: 'navigation',
    label: 'Go to Bracket',
    when: 'editorFocus',
  },
  {
    id: 'nav.nextChange',
    command: 'workbench.action.editor.nextChange',
    key: 'Alt+F5',
    mac: 'Alt+F5',
    category: 'navigation',
    label: 'Next Change',
  },
  {
    id: 'nav.prevChange',
    command: 'workbench.action.editor.previousChange',
    key: 'Shift+Alt+F5',
    mac: 'Shift+Alt+F5',
    category: 'navigation',
    label: 'Previous Change',
  },
  {
    id: 'nav.switchEditor1',
    command: 'workbench.action.openEditorAtIndex1',
    key: 'Alt+1',
    mac: 'Ctrl+1',
    category: 'navigation',
    label: 'Switch to Editor 1',
  },
  {
    id: 'nav.switchEditor2',
    command: 'workbench.action.openEditorAtIndex2',
    key: 'Alt+2',
    mac: 'Ctrl+2',
    category: 'navigation',
    label: 'Switch to Editor 2',
  },
  {
    id: 'nav.switchEditor3',
    command: 'workbench.action.openEditorAtIndex3',
    key: 'Alt+3',
    mac: 'Ctrl+3',
    category: 'navigation',
    label: 'Switch to Editor 3',
  },

  // ── Search ─────────────────────────────────────────────────────────────────
  {
    id: 'search.findInFiles',
    command: 'workbench.action.findInFiles',
    key: 'Ctrl+Shift+F',
    mac: 'Cmd+Shift+F',
    category: 'search',
    label: 'Find in Files',
  },
  {
    id: 'search.replaceInFiles',
    command: 'workbench.action.replaceInFiles',
    key: 'Ctrl+Shift+H',
    mac: 'Cmd+Shift+H',
    category: 'search',
    label: 'Replace in Files',
  },
  {
    id: 'search.findNext',
    command: 'editor.action.nextMatchFindAction',
    key: 'F3',
    mac: 'Cmd+G',
    category: 'search',
    label: 'Find Next',
    when: 'findWidgetVisible',
  },
  {
    id: 'search.findPrevious',
    command: 'editor.action.previousMatchFindAction',
    key: 'Shift+F3',
    mac: 'Cmd+Shift+G',
    category: 'search',
    label: 'Find Previous',
    when: 'findWidgetVisible',
  },
  {
    id: 'search.nextResult',
    command: 'search.action.focusNextSearchResult',
    key: 'F4',
    category: 'search',
    label: 'Next Search Result',
    when: 'searchVisible',
  },
  {
    id: 'search.prevResult',
    command: 'search.action.focusPreviousSearchResult',
    key: 'Shift+F4',
    category: 'search',
    label: 'Previous Search Result',
    when: 'searchVisible',
  },
  {
    id: 'search.toggleRegex',
    command: 'toggleSearchRegex',
    key: 'Alt+R',
    mac: 'Cmd+Alt+R',
    category: 'search',
    label: 'Toggle Regex',
    when: 'searchInputFocused',
  },
  {
    id: 'search.toggleCaseSensitive',
    command: 'toggleSearchCaseSensitive',
    key: 'Alt+C',
    mac: 'Cmd+Alt+C',
    category: 'search',
    label: 'Toggle Case Sensitive',
    when: 'searchInputFocused',
  },
  {
    id: 'search.toggleWholeWord',
    command: 'toggleSearchWholeWord',
    key: 'Alt+W',
    mac: 'Cmd+Alt+W',
    category: 'search',
    label: 'Toggle Whole Word',
    when: 'searchInputFocused',
  },

  // ── View & Layout ──────────────────────────────────────────────────────────
  {
    id: 'view.toggleSidebar',
    command: 'workbench.action.toggleSidebarVisibility',
    key: 'Ctrl+B',
    mac: 'Cmd+B',
    category: 'view',
    label: 'Toggle Sidebar',
  },
  {
    id: 'view.togglePanel',
    command: 'workbench.action.togglePanel',
    key: 'Ctrl+J',
    mac: 'Cmd+J',
    category: 'view',
    label: 'Toggle Bottom Panel',
  },
  {
    id: 'view.toggleTerminal',
    command: 'workbench.action.terminal.toggleTerminal',
    key: 'Ctrl+`',
    mac: 'Ctrl+`',
    category: 'view',
    label: 'Toggle Terminal',
  },
  {
    id: 'view.showExplorer',
    command: 'workbench.view.explorer',
    key: 'Ctrl+Shift+E',
    mac: 'Cmd+Shift+E',
    category: 'view',
    label: 'Show Explorer',
  },
  {
    id: 'view.showSearch',
    command: 'workbench.view.search',
    key: 'Ctrl+Shift+F',
    mac: 'Cmd+Shift+F',
    category: 'view',
    label: 'Show Search',
  },
  {
    id: 'view.showSourceControl',
    command: 'workbench.view.scm',
    key: 'Ctrl+Shift+G',
    mac: 'Ctrl+Shift+G',
    category: 'view',
    label: 'Show Source Control',
  },
  {
    id: 'view.showDebug',
    command: 'workbench.view.debug',
    key: 'Ctrl+Shift+D',
    mac: 'Cmd+Shift+D',
    category: 'view',
    label: 'Show Debug',
  },
  {
    id: 'view.showExtensions',
    command: 'workbench.view.extensions',
    key: 'Ctrl+Shift+X',
    mac: 'Cmd+Shift+X',
    category: 'view',
    label: 'Show Extensions',
  },
  {
    id: 'view.splitEditor',
    command: 'workbench.action.splitEditor',
    key: 'Ctrl+\\',
    mac: 'Cmd+\\',
    category: 'view',
    label: 'Split Editor',
  },
  {
    id: 'view.closeEditorGroup',
    command: 'workbench.action.closeEditorsInGroup',
    key: 'Ctrl+K W',
    mac: 'Cmd+K W',
    category: 'view',
    label: 'Close Editor Group',
  },
  {
    id: 'view.focusEditor',
    command: 'workbench.action.focusFirstEditorGroup',
    key: 'Ctrl+1',
    mac: 'Cmd+1',
    category: 'view',
    label: 'Focus First Editor Group',
  },
  {
    id: 'view.focusSidebar',
    command: 'workbench.action.focusSideBar',
    key: 'Ctrl+0',
    mac: 'Cmd+0',
    category: 'view',
    label: 'Focus Sidebar',
  },
  {
    id: 'view.zoomIn',
    command: 'workbench.action.zoomIn',
    key: 'Ctrl+=',
    mac: 'Cmd+=',
    category: 'view',
    label: 'Zoom In',
  },
  {
    id: 'view.zoomOut',
    command: 'workbench.action.zoomOut',
    key: 'Ctrl+-',
    mac: 'Cmd+-',
    category: 'view',
    label: 'Zoom Out',
  },
  {
    id: 'view.resetZoom',
    command: 'workbench.action.zoomReset',
    key: 'Ctrl+Numpad0',
    mac: 'Cmd+Numpad0',
    category: 'view',
    label: 'Reset Zoom',
  },
  {
    id: 'view.fullscreen',
    command: 'workbench.action.toggleFullScreen',
    key: 'F11',
    category: 'view',
    label: 'Toggle Full Screen',
  },
  {
    id: 'view.zenMode',
    command: 'workbench.action.toggleZenMode',
    key: 'Ctrl+K Z',
    mac: 'Cmd+K Z',
    category: 'view',
    label: 'Zen Mode',
  },
  {
    id: 'view.toggleMinimap',
    command: 'editor.action.toggleMinimap',
    key: '',
    category: 'view',
    label: 'Toggle Minimap',
  },
  {
    id: 'view.toggleBreadcrumbs',
    command: 'breadcrumbs.toggle',
    key: '',
    category: 'view',
    label: 'Toggle Breadcrumbs',
  },
  {
    id: 'view.toggleActivityBar',
    command: 'workbench.action.toggleActivityBarVisibility',
    key: '',
    category: 'view',
    label: 'Toggle Activity Bar',
  },
  {
    id: 'view.toggleStatusBar',
    command: 'workbench.action.toggleStatusbarVisibility',
    key: '',
    category: 'view',
    label: 'Toggle Status Bar',
  },

  // ── Terminal ───────────────────────────────────────────────────────────────
  {
    id: 'terminal.new',
    command: 'workbench.action.terminal.new',
    key: 'Ctrl+Shift+`',
    mac: 'Ctrl+Shift+`',
    category: 'terminal',
    label: 'New Terminal',
  },
  {
    id: 'terminal.split',
    command: 'workbench.action.terminal.split',
    key: 'Ctrl+Shift+5',
    mac: 'Cmd+\\',
    category: 'terminal',
    label: 'Split Terminal',
    when: 'terminalFocus',
  },
  {
    id: 'terminal.kill',
    command: 'workbench.action.terminal.kill',
    key: '',
    category: 'terminal',
    label: 'Kill Terminal',
    when: 'terminalFocus',
  },
  {
    id: 'terminal.clear',
    command: 'workbench.action.terminal.clear',
    key: '',
    mac: 'Cmd+K',
    category: 'terminal',
    label: 'Clear Terminal',
    when: 'terminalFocus',
  },
  {
    id: 'terminal.scrollUp',
    command: 'workbench.action.terminal.scrollUp',
    key: 'Ctrl+Shift+Up',
    mac: 'Cmd+Up',
    category: 'terminal',
    label: 'Scroll Up',
    when: 'terminalFocus',
  },
  {
    id: 'terminal.scrollDown',
    command: 'workbench.action.terminal.scrollDown',
    key: 'Ctrl+Shift+Down',
    mac: 'Cmd+Down',
    category: 'terminal',
    label: 'Scroll Down',
    when: 'terminalFocus',
  },
  {
    id: 'terminal.copy',
    command: 'workbench.action.terminal.copySelection',
    key: 'Ctrl+Shift+C',
    mac: 'Cmd+C',
    category: 'terminal',
    label: 'Copy in Terminal',
    when: 'terminalFocus',
  },
  {
    id: 'terminal.paste',
    command: 'workbench.action.terminal.paste',
    key: 'Ctrl+Shift+V',
    mac: 'Cmd+V',
    category: 'terminal',
    label: 'Paste in Terminal',
    when: 'terminalFocus',
  },
  {
    id: 'terminal.focusNext',
    command: 'workbench.action.terminal.focusNext',
    key: '',
    category: 'terminal',
    label: 'Focus Next Terminal',
    when: 'terminalFocus',
  },
  {
    id: 'terminal.focusPrev',
    command: 'workbench.action.terminal.focusPrevious',
    key: '',
    category: 'terminal',
    label: 'Focus Previous Terminal',
    when: 'terminalFocus',
  },
  {
    id: 'terminal.rename',
    command: 'workbench.action.terminal.rename',
    key: '',
    category: 'terminal',
    label: 'Rename Terminal',
    when: 'terminalFocus',
  },

  // ── Debug ──────────────────────────────────────────────────────────────────
  {
    id: 'debug.start',
    command: 'workbench.action.debug.start',
    key: 'F5',
    category: 'debug',
    label: 'Start Debugging',
  },
  {
    id: 'debug.stop',
    command: 'workbench.action.debug.stop',
    key: 'Shift+F5',
    category: 'debug',
    label: 'Stop Debugging',
    when: 'debugActive',
  },
  {
    id: 'debug.restart',
    command: 'workbench.action.debug.restart',
    key: 'Ctrl+Shift+F5',
    mac: 'Cmd+Shift+F5',
    category: 'debug',
    label: 'Restart Debugging',
    when: 'debugActive',
  },
  {
    id: 'debug.continue',
    command: 'workbench.action.debug.continue',
    key: 'F5',
    category: 'debug',
    label: 'Continue',
    when: 'debugActive',
  },
  {
    id: 'debug.stepOver',
    command: 'workbench.action.debug.stepOver',
    key: 'F10',
    category: 'debug',
    label: 'Step Over',
    when: 'debugActive',
  },
  {
    id: 'debug.stepInto',
    command: 'workbench.action.debug.stepInto',
    key: 'F11',
    category: 'debug',
    label: 'Step Into',
    when: 'debugActive',
  },
  {
    id: 'debug.stepOut',
    command: 'workbench.action.debug.stepOut',
    key: 'Shift+F11',
    category: 'debug',
    label: 'Step Out',
    when: 'debugActive',
  },
  {
    id: 'debug.toggleBreakpoint',
    command: 'editor.debug.action.toggleBreakpoint',
    key: 'F9',
    category: 'debug',
    label: 'Toggle Breakpoint',
    when: 'editorFocus',
  },
  {
    id: 'debug.console',
    command: 'workbench.debug.action.toggleRepl',
    key: 'Ctrl+Shift+Y',
    mac: 'Cmd+Shift+Y',
    category: 'debug',
    label: 'Debug Console',
  },
  {
    id: 'debug.inlineBreakpoint',
    command: 'editor.debug.action.toggleInlineBreakpoint',
    key: 'Shift+F9',
    category: 'debug',
    label: 'Inline Breakpoint',
    when: 'editorFocus',
  },
  {
    id: 'debug.runWithoutDebugging',
    command: 'workbench.action.debug.run',
    key: 'Ctrl+F5',
    mac: 'Ctrl+F5',
    category: 'debug',
    label: 'Run Without Debugging',
  },

  // ── Git / Source Control ───────────────────────────────────────────────────
  {
    id: 'git.commit',
    command: 'git.commit',
    key: '',
    category: 'git',
    label: 'Git: Commit',
    when: 'gitActive',
  },
  {
    id: 'git.push',
    command: 'git.push',
    key: '',
    category: 'git',
    label: 'Git: Push',
    when: 'gitActive',
  },
  {
    id: 'git.pull',
    command: 'git.pull',
    key: '',
    category: 'git',
    label: 'Git: Pull',
    when: 'gitActive',
  },
  {
    id: 'git.fetch',
    command: 'git.fetch',
    key: '',
    category: 'git',
    label: 'Git: Fetch',
    when: 'gitActive',
  },
  {
    id: 'git.stageAll',
    command: 'git.stageAll',
    key: '',
    category: 'git',
    label: 'Git: Stage All Changes',
    when: 'gitActive',
  },
  {
    id: 'git.unstageAll',
    command: 'git.unstageAll',
    key: '',
    category: 'git',
    label: 'Git: Unstage All Changes',
    when: 'gitActive',
  },
  {
    id: 'git.stash',
    command: 'git.stash',
    key: '',
    category: 'git',
    label: 'Git: Stash',
    when: 'gitActive',
  },
  {
    id: 'git.stashPop',
    command: 'git.stashPop',
    key: '',
    category: 'git',
    label: 'Git: Pop Stash',
    when: 'gitActive',
  },
  {
    id: 'git.blame',
    command: 'git.toggleBlame',
    key: '',
    category: 'git',
    label: 'Git: Toggle Blame',
  },
  {
    id: 'git.openChanges',
    command: 'git.openChange',
    key: '',
    category: 'git',
    label: 'Git: Open Changes',
    when: 'gitActive',
  },
  {
    id: 'git.checkout',
    command: 'git.checkout',
    key: '',
    category: 'git',
    label: 'Git: Checkout To...',
    when: 'gitActive',
  },
  {
    id: 'git.createBranch',
    command: 'git.branch',
    key: '',
    category: 'git',
    label: 'Git: Create Branch',
    when: 'gitActive',
  },

  // ── AI Features ────────────────────────────────────────────────────────────
  {
    id: 'ai.chat',
    command: 'orion.ai.openChat',
    key: 'Ctrl+L',
    mac: 'Cmd+L',
    category: 'ai',
    label: 'Open AI Chat',
  },
  {
    id: 'ai.inlineEdit',
    command: 'orion.ai.inlineEdit',
    key: 'Ctrl+K',
    mac: 'Cmd+K',
    category: 'ai',
    label: 'Inline AI Edit',
    when: 'editorFocus',
  },
  {
    id: 'ai.explain',
    command: 'orion.ai.explainSelection',
    key: '',
    category: 'ai',
    label: 'AI: Explain Selection',
    when: 'editorHasSelection',
  },
  {
    id: 'ai.refactor',
    command: 'orion.ai.refactorSelection',
    key: '',
    category: 'ai',
    label: 'AI: Refactor Selection',
    when: 'editorHasSelection',
  },
  {
    id: 'ai.fix',
    command: 'orion.ai.fixBug',
    key: '',
    category: 'ai',
    label: 'AI: Fix Bug',
    when: 'editorHasSelection',
  },
  {
    id: 'ai.generateTests',
    command: 'orion.ai.generateTests',
    key: '',
    category: 'ai',
    label: 'AI: Generate Tests',
    when: 'editorFocus',
  },
  {
    id: 'ai.generateDocs',
    command: 'orion.ai.generateDocs',
    key: '',
    category: 'ai',
    label: 'AI: Generate Documentation',
    when: 'editorFocus',
  },
  {
    id: 'ai.acceptSuggestion',
    command: 'orion.ai.acceptGhostText',
    key: 'Tab',
    category: 'ai',
    label: 'Accept AI Suggestion',
    when: 'suggestWidgetVisible',
  },
  {
    id: 'ai.dismissSuggestion',
    command: 'orion.ai.dismissGhostText',
    key: 'Escape',
    category: 'ai',
    label: 'Dismiss AI Suggestion',
    when: 'suggestWidgetVisible',
  },
  {
    id: 'ai.acceptNextWord',
    command: 'orion.ai.acceptNextWord',
    key: 'Ctrl+Right',
    mac: 'Cmd+Right',
    category: 'ai',
    label: 'Accept Next Word',
    when: 'suggestWidgetVisible',
  },
  {
    id: 'ai.togglePanel',
    command: 'orion.ai.togglePanel',
    key: 'Ctrl+Shift+L',
    mac: 'Cmd+Shift+L',
    category: 'ai',
    label: 'Toggle AI Panel',
  },
  {
    id: 'ai.newConversation',
    command: 'orion.ai.newConversation',
    key: '',
    category: 'ai',
    label: 'AI: New Conversation',
    when: 'chatFocus',
  },
  {
    id: 'ai.codeAction',
    command: 'orion.ai.codeAction',
    key: '',
    category: 'ai',
    label: 'AI: Code Action',
    when: 'editorFocus',
  },
]

// ─── Serialization helpers ───────────────────────────────────────────────────
// Zustand persist cannot serialize Map/Set natively. We store them as plain
// objects/arrays and rehydrate on load.

interface PersistedState {
  customOverrides: Record<string, string>
  activeContexts: string[]
}

function serializeForStorage(state: KeybindingCustomizationState): PersistedState {
  return {
    customOverrides: Object.fromEntries(state.customOverrides),
    activeContexts: Array.from(state.activeContexts),
  }
}

function deserializeFromStorage(persisted: PersistedState): {
  customOverrides: Map<string, string>
  activeContexts: Set<string>
} {
  return {
    customOverrides: new Map(Object.entries(persisted.customOverrides ?? {})),
    activeContexts: new Set(persisted.activeContexts ?? []),
  }
}

// ─── Store Interface ─────────────────────────────────────────────────────────

export interface KeybindingCustomizationState {
  /** Full binding list (defaults + user-added custom bindings) */
  bindings: KeyBinding[]

  /** Map of binding id -> custom key override */
  customOverrides: Map<string, string>

  /** Currently active when-clause contexts */
  activeContexts: Set<string>

  /** Current search/filter query */
  searchQuery: string

  /** Selected category filter (null = show all) */
  selectedCategory: KeyBindingCategory | null

  /** Whether the recording mode is active for capturing keystrokes */
  isRecording: boolean

  /** The binding id currently being recorded */
  recordingBindingId: string | null

  // ── Context Management ──────────────────────────────────────────────────
  setContext: (context: string, active: boolean) => void
  setContexts: (contexts: Record<string, boolean>) => void
  isContextActive: (context: string) => boolean
  clearAllContexts: () => void

  // ── Binding Queries ─────────────────────────────────────────────────────
  getBindingById: (id: string) => KeyBinding | undefined
  getBindingByCommand: (command: string) => KeyBinding | undefined
  getBindingsByCategory: (category: KeyBindingCategory) => KeyBinding[]
  getCategories: () => KeyBindingCategory[]
  getEffectiveKey: (id: string) => string
  getDefaultKey: (id: string) => string
  isCustomized: (id: string) => boolean
  getActiveBindings: () => KeyBinding[]

  // ── Binding Resolution ──────────────────────────────────────────────────
  resolveKeypress: (key: string) => KeyBinding[]
  resolveKeypressInContext: (key: string) => KeyBinding | null
  matchesChord: (firstKey: string, secondKey: string) => KeyBinding | null

  // ── Customization ──────────────────────────────────────────────────────
  setCustomKey: (id: string, key: string) => void
  removeCustomKey: (id: string) => void
  resetBinding: (id: string) => void
  resetAllBindings: () => void
  addCustomBinding: (binding: KeyBinding) => void
  removeCustomBinding: (id: string) => void

  // ── Conflict Detection ──────────────────────────────────────────────────
  findConflicts: (key: string, excludeId?: string) => KeyBindingConflict[]
  findAllConflicts: () => KeyBindingConflict[]
  hasConflict: (key: string, excludeId?: string) => boolean

  // ── Search & Filter ─────────────────────────────────────────────────────
  setSearchQuery: (query: string) => void
  setSelectedCategory: (category: KeyBindingCategory | null) => void
  getFilteredBindings: () => KeyBinding[]

  // ── Recording ───────────────────────────────────────────────────────────
  startRecording: (bindingId: string) => void
  stopRecording: () => void
  recordKey: (key: string) => void

  // ── Import / Export ─────────────────────────────────────────────────────
  exportBindings: () => string
  importBindings: (json: string) => { success: boolean; error?: string; count?: number }
  exportAllBindings: () => string

  // ── Chord / Sequence Helpers ────────────────────────────────────────────
  parseChord: (key: string) => KeyChord
  isChordBinding: (id: string) => boolean
  getPendingChordBindings: (firstKey: string) => KeyBinding[]
}

// ─── Store Implementation ────────────────────────────────────────────────────

export const useKeybindingStore = create<KeybindingCustomizationState>()(
  persist(
    (set, get) => ({
      bindings: [...DEFAULT_KEYBINDINGS],
      customOverrides: new Map<string, string>(),
      activeContexts: new Set<string>(),
      searchQuery: '',
      selectedCategory: null,
      isRecording: false,
      recordingBindingId: null,

      // ── Context Management ────────────────────────────────────────────────

      setContext: (context, active) => {
        const next = new Set(get().activeContexts)
        if (active) {
          next.add(context)
        } else {
          next.delete(context)
        }
        set({ activeContexts: next })
      },

      setContexts: (contexts) => {
        const next = new Set(get().activeContexts)
        for (const [key, active] of Object.entries(contexts)) {
          if (active) {
            next.add(key)
          } else {
            next.delete(key)
          }
        }
        set({ activeContexts: next })
      },

      isContextActive: (context) => get().activeContexts.has(context),

      clearAllContexts: () => set({ activeContexts: new Set() }),

      // ── Binding Queries ───────────────────────────────────────────────────

      getBindingById: (id) => get().bindings.find((b) => b.id === id),

      getBindingByCommand: (command) => get().bindings.find((b) => b.command === command),

      getBindingsByCategory: (category) =>
        get().bindings.filter((b) => b.category === category),

      getCategories: () => {
        const categories = new Set(get().bindings.map((b) => b.category))
        return Array.from(categories)
      },

      getEffectiveKey: (id) => {
        const { customOverrides, bindings } = get()
        const override = customOverrides.get(id)
        if (override !== undefined) return override
        const binding = bindings.find((b) => b.id === id)
        return binding ? getPlatformKey(binding) : ''
      },

      getDefaultKey: (id) => {
        const binding = DEFAULT_KEYBINDINGS.find((b) => b.id === id)
        return binding ? getPlatformKey(binding) : ''
      },

      isCustomized: (id) => get().customOverrides.has(id),

      getActiveBindings: () => {
        const { bindings, activeContexts } = get()
        return bindings.filter((b) => evaluateWhenClause(b.when, activeContexts))
      },

      // ── Binding Resolution ────────────────────────────────────────────────

      resolveKeypress: (key) => {
        const { bindings, customOverrides } = get()
        const normalized = normalizeKey(key)
        return bindings.filter((b) => {
          const effectiveKey = customOverrides.get(b.id) ?? getPlatformKey(b)
          if (!effectiveKey) return false
          const chord = parseChord(effectiveKey)
          if (chord.isChord) {
            return normalizeKey(chord.parts[0]).toLowerCase() === normalized.toLowerCase()
          }
          return keysMatch(effectiveKey, key)
        })
      },

      resolveKeypressInContext: (key) => {
        const { bindings, customOverrides, activeContexts } = get()
        const normalized = normalizeKey(key)

        // Prefer the most specific match (one with a when-clause that is satisfied)
        let bestMatch: KeyBinding | null = null
        let bestSpecificity = -1

        for (const binding of bindings) {
          const effectiveKey = customOverrides.get(binding.id) ?? getPlatformKey(binding)
          if (!effectiveKey) continue
          if (!keysMatch(effectiveKey, key)) continue
          if (!evaluateWhenClause(binding.when, activeContexts)) continue

          // Bindings with a when-clause are more specific
          const specificity = binding.when ? binding.when.split(/&&|\|\|/).length : 0
          if (specificity > bestSpecificity) {
            bestSpecificity = specificity
            bestMatch = binding
          }
        }

        return bestMatch
      },

      matchesChord: (firstKey, secondKey) => {
        const { bindings, customOverrides, activeContexts } = get()
        const fullChord = `${normalizeKey(firstKey)} ${normalizeKey(secondKey)}`

        for (const binding of bindings) {
          const effectiveKey = customOverrides.get(binding.id) ?? getPlatformKey(binding)
          if (!effectiveKey) continue
          if (!keysMatch(effectiveKey, fullChord)) continue
          if (!evaluateWhenClause(binding.when, activeContexts)) continue
          return binding
        }

        return null
      },

      // ── Customization ─────────────────────────────────────────────────────

      setCustomKey: (id, key) => {
        const next = new Map(get().customOverrides)
        next.set(id, normalizeKey(key))
        set({ customOverrides: next })
      },

      removeCustomKey: (id) => {
        const next = new Map(get().customOverrides)
        next.delete(id)
        set({ customOverrides: next })
      },

      resetBinding: (id) => {
        const next = new Map(get().customOverrides)
        next.delete(id)
        set({ customOverrides: next })
      },

      resetAllBindings: () => {
        // Remove all custom overrides and any user-added custom bindings
        const defaultIds = new Set(DEFAULT_KEYBINDINGS.map((b) => b.id))
        set({
          customOverrides: new Map(),
          bindings: [...DEFAULT_KEYBINDINGS],
        })
      },

      addCustomBinding: (binding) => {
        const existing = get().bindings.find((b) => b.id === binding.id)
        if (existing) return // Don't add duplicates

        set({
          bindings: [
            ...get().bindings,
            { ...binding, isCustom: true, key: normalizeKey(binding.key) },
          ],
        })
      },

      removeCustomBinding: (id) => {
        const binding = get().bindings.find((b) => b.id === id)
        if (!binding?.isCustom) return // Only remove user-added custom bindings

        const next = new Map(get().customOverrides)
        next.delete(id)
        set({
          bindings: get().bindings.filter((b) => b.id !== id),
          customOverrides: next,
        })
      },

      // ── Conflict Detection ────────────────────────────────────────────────

      findConflicts: (key, excludeId) => {
        if (!key) return []
        const { bindings, customOverrides } = get()
        const normalizedTarget = normalizeKey(key).toLowerCase()
        const conflicts: KeyBindingConflict[] = []

        const matchingBindings = bindings.filter((b) => {
          if (excludeId && b.id === excludeId) return false
          const effectiveKey = customOverrides.get(b.id) ?? getPlatformKey(b)
          return normalizeKey(effectiveKey).toLowerCase() === normalizedTarget
        })

        // Compare every pair of matching bindings to check for when-clause overlaps
        for (let i = 0; i < matchingBindings.length; i++) {
          for (let j = i + 1; j < matchingBindings.length; j++) {
            const a = matchingBindings[i]
            const b = matchingBindings[j]

            // Two bindings conflict only if their when-clauses could both be true
            // simultaneously. If one has no when-clause, it always potentially
            // conflicts. If they have mutually exclusive contexts they are fine.
            const whenOverlaps = !a.when || !b.when || whenClausesCanOverlap(a.when, b.when)

            if (whenOverlaps) {
              conflicts.push({
                bindingA: a,
                bindingB: b,
                key: normalizedTarget,
                context: a.when || b.when || null,
              })
            }
          }
        }

        return conflicts
      },

      findAllConflicts: () => {
        const { bindings, customOverrides } = get()
        const keyMap = new Map<string, KeyBinding[]>()

        for (const binding of bindings) {
          const effectiveKey = customOverrides.get(binding.id) ?? getPlatformKey(binding)
          if (!effectiveKey) continue
          const normalized = normalizeKey(effectiveKey).toLowerCase()
          const existing = keyMap.get(normalized) ?? []
          existing.push(binding)
          keyMap.set(normalized, existing)
        }

        const allConflicts: KeyBindingConflict[] = []

        for (const [key, group] of keyMap) {
          if (group.length < 2) continue
          for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
              const a = group[i]
              const b = group[j]
              if (!a.when || !b.when || whenClausesCanOverlap(a.when, b.when)) {
                allConflicts.push({
                  bindingA: a,
                  bindingB: b,
                  key,
                  context: a.when || b.when || null,
                })
              }
            }
          }
        }

        return allConflicts
      },

      hasConflict: (key, excludeId) => {
        return get().findConflicts(key, excludeId).length > 0
      },

      // ── Search & Filter ───────────────────────────────────────────────────

      setSearchQuery: (query) => set({ searchQuery: query }),

      setSelectedCategory: (category) => set({ selectedCategory: category }),

      getFilteredBindings: () => {
        const { bindings, customOverrides, searchQuery, selectedCategory } = get()
        let filtered = bindings

        if (selectedCategory) {
          filtered = filtered.filter((b) => b.category === selectedCategory)
        }

        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase().trim()
          filtered = filtered.filter((b) => {
            const effectiveKey = customOverrides.get(b.id) ?? getPlatformKey(b)
            return (
              b.label.toLowerCase().includes(query) ||
              b.command.toLowerCase().includes(query) ||
              b.id.toLowerCase().includes(query) ||
              effectiveKey.toLowerCase().includes(query) ||
              b.category.toLowerCase().includes(query)
            )
          })
        }

        return filtered
      },

      // ── Recording ─────────────────────────────────────────────────────────

      startRecording: (bindingId) => {
        set({ isRecording: true, recordingBindingId: bindingId })
      },

      stopRecording: () => {
        set({ isRecording: false, recordingBindingId: null })
      },

      recordKey: (key) => {
        const { recordingBindingId, isRecording } = get()
        if (!isRecording || !recordingBindingId) return

        const normalized = normalizeKey(key)
        const next = new Map(get().customOverrides)
        next.set(recordingBindingId, normalized)
        set({
          customOverrides: next,
          isRecording: false,
          recordingBindingId: null,
        })
      },

      // ── Import / Export ───────────────────────────────────────────────────

      exportBindings: () => {
        const { customOverrides } = get()
        const exportData: KeyBindingExport = {
          version: 1,
          exportedAt: new Date().toISOString(),
          platform: isMac ? 'mac' : 'windows/linux',
          bindings: Array.from(customOverrides.entries()).map(([id, key]) => ({
            id,
            key,
          })),
        }
        return JSON.stringify(exportData, null, 2)
      },

      importBindings: (json) => {
        try {
          const data = JSON.parse(json)

          // Support both the full export format and a simple { id: key } map
          let entries: Array<{ id: string; key: string }> = []

          if (data.version && Array.isArray(data.bindings)) {
            entries = data.bindings
          } else if (typeof data === 'object' && !Array.isArray(data)) {
            entries = Object.entries(data).map(([id, key]) => ({
              id,
              key: key as string,
            }))
          } else if (Array.isArray(data)) {
            entries = data
          } else {
            return { success: false, error: 'Invalid format: expected an object or array' }
          }

          // Validate entries
          const validEntries = entries.filter(
            (e) => typeof e.id === 'string' && typeof e.key === 'string'
          )

          if (validEntries.length === 0) {
            return { success: false, error: 'No valid bindings found in import data' }
          }

          const next = new Map(get().customOverrides)
          for (const entry of validEntries) {
            next.set(entry.id, normalizeKey(entry.key))
          }

          set({ customOverrides: next })
          return { success: true, count: validEntries.length }
        } catch (err) {
          return {
            success: false,
            error: `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      },

      exportAllBindings: () => {
        const { bindings, customOverrides } = get()
        const allBindings = bindings.map((b) => ({
          id: b.id,
          command: b.command,
          key: customOverrides.get(b.id) ?? b.key,
          mac: b.mac,
          when: b.when,
          category: b.category,
          label: b.label,
          isDefault: !customOverrides.has(b.id),
        }))
        return JSON.stringify(allBindings, null, 2)
      },

      // ── Chord / Sequence Helpers ──────────────────────────────────────────

      parseChord: (key) => parseChord(key),

      isChordBinding: (id) => {
        const { customOverrides } = get()
        const binding = get().bindings.find((b) => b.id === id)
        if (!binding) return false
        const effectiveKey = customOverrides.get(id) ?? getPlatformKey(binding)
        return parseChord(effectiveKey).isChord
      },

      getPendingChordBindings: (firstKey) => {
        const { bindings, customOverrides, activeContexts } = get()
        const normalizedFirst = normalizeKey(firstKey).toLowerCase()

        return bindings.filter((b) => {
          const effectiveKey = customOverrides.get(b.id) ?? getPlatformKey(b)
          if (!effectiveKey) return false
          const chord = parseChord(effectiveKey)
          if (!chord.isChord) return false
          if (normalizeKey(chord.parts[0]).toLowerCase() !== normalizedFirst) return false
          return evaluateWhenClause(b.when, activeContexts)
        })
      },
    }),
    {
      name: 'orion-keybinding-customization',
      // Custom serialization to handle Map and Set
      storage: {
        getItem: (name) => {
          const raw = localStorage.getItem(name)
          if (!raw) return null
          try {
            const parsed = JSON.parse(raw)
            if (parsed?.state) {
              const { customOverrides, activeContexts, ...rest } = parsed.state
              const deserialized = deserializeFromStorage({
                customOverrides: customOverrides ?? {},
                activeContexts: activeContexts ?? [],
              })
              return {
                ...parsed,
                state: {
                  ...rest,
                  customOverrides: deserialized.customOverrides,
                  activeContexts: deserialized.activeContexts,
                },
              }
            }
            return parsed
          } catch {
            return null
          }
        },
        setItem: (name, value) => {
          try {
            const state = (value as any)?.state
            if (state) {
              const serialized = serializeForStorage(state)
              const toStore = {
                ...value,
                state: {
                  ...state,
                  customOverrides: serialized.customOverrides,
                  activeContexts: serialized.activeContexts,
                },
              }
              localStorage.setItem(name, JSON.stringify(toStore))
            } else {
              localStorage.setItem(name, JSON.stringify(value))
            }
          } catch {
            // Ignore storage errors
          }
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
      partialize: (state) => ({
        customOverrides: state.customOverrides,
        activeContexts: state.activeContexts,
        bindings: state.bindings.filter((b) => b.isCustom),
      }),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<KeybindingCustomizationState> | undefined
        const customBindings = (persistedState?.bindings ?? []) as KeyBinding[]
        const defaultIds = new Set(DEFAULT_KEYBINDINGS.map((b) => b.id))
        const uniqueCustom = customBindings.filter((b: KeyBinding) => !defaultIds.has(b.id))

        return {
          ...current,
          customOverrides: persistedState?.customOverrides ?? new Map<string, string>(),
          activeContexts: persistedState?.activeContexts ?? new Set<string>(),
          bindings: [...DEFAULT_KEYBINDINGS, ...uniqueCustom],
        }
      },
    }
  )
)

// ─── When-Clause Overlap Detection ───────────────────────────────────────────

function whenClausesCanOverlap(whenA: string, whenB: string): boolean {
  // Extract all simple context names from each clause
  const contextsA = extractContextNames(whenA)
  const contextsB = extractContextNames(whenB)

  // If one requires a context and the other requires its negation, they cannot
  // overlap (are mutually exclusive).
  for (const [ctx, positive] of contextsA) {
    const otherPositive = contextsB.get(ctx)
    if (otherPositive !== undefined && otherPositive !== positive) {
      return false
    }
  }

  return true
}

function extractContextNames(when: string): Map<string, boolean> {
  const result = new Map<string, boolean>()
  // Split on && and || and extract each context token
  const tokens = when.split(/\s*(?:&&|\|\|)\s*/)
  for (const token of tokens) {
    const trimmed = token.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('!')) {
      result.set(trimmed.slice(1), false)
    } else {
      result.set(trimmed, true)
    }
  }
  return result
}

// ─── Utility Exports ─────────────────────────────────────────────────────────

export {
  normalizeKey,
  parseChord,
  keysMatch,
  evaluateWhenClause,
  getPlatformKey,
  isMac,
  DEFAULT_KEYBINDINGS,
}
