import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { create } from 'zustand'
import {
  FolderOpen, FileText, GitBranch, FilePlus, Globe,
  ChevronRight, ChevronDown, Lightbulb, Check, RefreshCw,
  File, Code, Image, Database, FileJson, FileCode, Braces,
  Palette, Settings, Keyboard, Terminal, Sparkles, Zap,
  Star, ExternalLink, BookOpen, MessageCircle, X, Pin,
  PinOff, Clock, Monitor, Sun, Moon, Cloud, Cpu, Eye,
  Puzzle, Shield, Search, Play, Wand2, Bot, BrainCircuit,
  ArrowRight, Heart, Minus, Plus, ToggleLeft, ToggleRight,
  Layout, Type, Hash, Coffee, Layers, Rocket, Award,
  MousePointer, Maximize2, SplitSquareHorizontal,
} from 'lucide-react'
import { APP_VERSION } from '@/utils/version'
import { useEditorStore } from '@/store/editor'

/* ════════════════════════════════════════════════════════════════════════════
   Inline Zustand Store — walkthrough progress, recent items, quick settings
   ════════════════════════════════════════════════════════════════════════════ */

interface RecentItem {
  path: string
  name: string
  type: 'file' | 'folder'
  timestamp: number
  pinned: boolean
}

interface WalkthroughStep {
  id: string
  label: string
  description: string
  icon: typeof Sparkles
  completed: boolean
  actionLabel: string
}

interface WalkthroughGroup {
  id: string
  title: string
  description: string
  icon: typeof Rocket
  steps: WalkthroughStep[]
  expanded: boolean
}

interface QuickSettings {
  selectedTheme: string
  fontSize: number
  aiProvider: 'anthropic' | 'openai' | 'local' | 'none'
}

interface WelcomeStore {
  recentItems: RecentItem[]
  walkthroughs: WalkthroughGroup[]
  quickSettings: QuickSettings
  showOnStartup: boolean
  expandedSections: Record<string, boolean>
  tipIndex: number

  togglePin: (path: string) => void
  removeRecent: (path: string) => void
  clearRecent: () => void
  completeStep: (walkthroughId: string, stepId: string) => void
  resetWalkthrough: (walkthroughId: string) => void
  toggleWalkthroughExpand: (walkthroughId: string) => void
  setQuickSetting: <K extends keyof QuickSettings>(key: K, value: QuickSettings[K]) => void
  setShowOnStartup: (show: boolean) => void
  toggleSection: (section: string) => void
  nextTip: () => void
}

const STORAGE_KEYS = {
  recent: 'orion-welcome-recent-items',
  walkthroughs: 'orion-welcome-walkthrough-progress',
  quickSettings: 'orion-welcome-quick-settings',
  showOnStartup: 'orion-show-welcome',
  sections: 'orion-welcome-sections',
} as const

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : fallback
  } catch {
    return fallback
  }
}

function createDefaultWalkthroughs(): WalkthroughGroup[] {
  return [
    {
      id: 'get-started',
      title: 'Get Started with Orion',
      description: 'Learn the basics and set up your environment',
      icon: Rocket,
      expanded: true,
      steps: [
        { id: 'theme', label: 'Choose a Color Theme', description: 'Personalize the look and feel of your editor with a theme that suits your style', icon: Palette, completed: false, actionLabel: 'Browse Themes' },
        { id: 'keybindings', label: 'Customize Keybindings', description: 'Set up keyboard shortcuts from VS Code, Vim, Emacs, or create your own', icon: Keyboard, completed: false, actionLabel: 'Open Keybindings' },
        { id: 'extensions', label: 'Install Extensions', description: 'Enhance your editor with language support, linters, formatters, and more', icon: Puzzle, completed: false, actionLabel: 'Browse Extensions' },
        { id: 'ai-setup', label: 'Configure AI Assistant', description: 'Connect to Anthropic, OpenAI, or a local model for AI-powered coding', icon: BrainCircuit, completed: false, actionLabel: 'AI Settings' },
        { id: 'terminal', label: 'Explore the Terminal', description: 'Use the built-in terminal to run commands without leaving the editor', icon: Terminal, completed: false, actionLabel: 'Open Terminal' },
      ],
    },
    {
      id: 'ai-dev',
      title: 'AI-Powered Development',
      description: 'Harness AI to write, understand, and refactor code',
      icon: Sparkles,
      expanded: false,
      steps: [
        { id: 'ai-chat', label: 'Chat with AI', description: 'Ask questions about your code, get explanations, or brainstorm solutions in the AI panel', icon: MessageCircle, completed: false, actionLabel: 'Open AI Chat' },
        { id: 'ai-completions', label: 'AI Code Completions', description: 'Get intelligent inline suggestions as you type, powered by large language models', icon: Wand2, completed: false, actionLabel: 'Try Completions' },
        { id: 'ai-refactor', label: 'AI Refactoring', description: 'Select code and describe how to transform it. AI handles the rest', icon: Zap, completed: false, actionLabel: 'Try Refactor' },
        { id: 'ai-explain', label: 'Explain Code', description: 'Highlight any code block and ask AI to explain what it does step by step', icon: Eye, completed: false, actionLabel: 'Explain Selection' },
      ],
    },
    {
      id: 'customize',
      title: 'Customize Your Editor',
      description: 'Make Orion truly yours',
      icon: Settings,
      expanded: false,
      steps: [
        { id: 'settings', label: 'Edit Settings', description: 'Fine-tune every aspect of the editor behavior, from tab size to auto-save', icon: Settings, completed: false, actionLabel: 'Open Settings' },
        { id: 'themes-deep', label: 'Create a Custom Theme', description: 'Design your own color theme or modify an existing one with the theme editor', icon: Palette, completed: false, actionLabel: 'Theme Editor' },
        { id: 'keybinds-deep', label: 'Advanced Key Bindings', description: 'Create multi-chord shortcuts, when-clauses, and context-specific bindings', icon: Keyboard, completed: false, actionLabel: 'Keybinding Editor' },
      ],
    },
  ]
}

function loadWalkthroughProgress(walkthroughs: WalkthroughGroup[]): WalkthroughGroup[] {
  const saved = loadJSON<Record<string, string[]>>(STORAGE_KEYS.walkthroughs, {})
  return walkthroughs.map((wt) => ({
    ...wt,
    steps: wt.steps.map((s) => ({
      ...s,
      completed: saved[wt.id]?.includes(s.id) ?? false,
    })),
  }))
}

function saveWalkthroughProgress(walkthroughs: WalkthroughGroup[]) {
  const data: Record<string, string[]> = {}
  walkthroughs.forEach((wt) => {
    data[wt.id] = wt.steps.filter((s) => s.completed).map((s) => s.id)
  })
  localStorage.setItem(STORAGE_KEYS.walkthroughs, JSON.stringify(data))
}

const defaultRecentItems: RecentItem[] = loadJSON<RecentItem[]>(STORAGE_KEYS.recent, [])

const useWelcomeStore = create<WelcomeStore>((set, get) => ({
  recentItems: defaultRecentItems,
  walkthroughs: loadWalkthroughProgress(createDefaultWalkthroughs()),
  quickSettings: loadJSON<QuickSettings>(STORAGE_KEYS.quickSettings, {
    selectedTheme: 'Orion Dark',
    fontSize: 14,
    aiProvider: 'anthropic',
  }),
  showOnStartup: loadJSON<boolean>(STORAGE_KEYS.showOnStartup, true),
  expandedSections: loadJSON<Record<string, boolean>>(STORAGE_KEYS.sections, {
    start: true,
    recent: true,
    walkthroughs: true,
    learn: true,
    quickSettings: false,
    whatsNew: false,
  }),
  tipIndex: Math.floor(Math.random() * 13),

  togglePin: (path) =>
    set((state) => {
      const items = state.recentItems.map((item) =>
        item.path === path ? { ...item, pinned: !item.pinned } : item
      )
      localStorage.setItem(STORAGE_KEYS.recent, JSON.stringify(items))
      return { recentItems: items }
    }),

  removeRecent: (path) =>
    set((state) => {
      const items = state.recentItems.filter((item) => item.path !== path)
      localStorage.setItem(STORAGE_KEYS.recent, JSON.stringify(items))
      return { recentItems: items }
    }),

  clearRecent: () => {
    localStorage.removeItem(STORAGE_KEYS.recent)
    set({ recentItems: [] })
  },

  completeStep: (walkthroughId, stepId) =>
    set((state) => {
      const walkthroughs = state.walkthroughs.map((wt) =>
        wt.id === walkthroughId
          ? {
              ...wt,
              steps: wt.steps.map((s) =>
                s.id === stepId ? { ...s, completed: !s.completed } : s
              ),
            }
          : wt
      )
      saveWalkthroughProgress(walkthroughs)
      return { walkthroughs }
    }),

  resetWalkthrough: (walkthroughId) =>
    set((state) => {
      const walkthroughs = state.walkthroughs.map((wt) =>
        wt.id === walkthroughId
          ? { ...wt, steps: wt.steps.map((s) => ({ ...s, completed: false })) }
          : wt
      )
      saveWalkthroughProgress(walkthroughs)
      return { walkthroughs }
    }),

  toggleWalkthroughExpand: (walkthroughId) =>
    set((state) => ({
      walkthroughs: state.walkthroughs.map((wt) =>
        wt.id === walkthroughId ? { ...wt, expanded: !wt.expanded } : wt
      ),
    })),

  setQuickSetting: (key, value) =>
    set((state) => {
      const quickSettings = { ...state.quickSettings, [key]: value }
      localStorage.setItem(STORAGE_KEYS.quickSettings, JSON.stringify(quickSettings))
      return { quickSettings }
    }),

  setShowOnStartup: (show) => {
    localStorage.setItem(STORAGE_KEYS.showOnStartup, JSON.stringify(show))
    set({ showOnStartup: show })
  },

  toggleSection: (section) =>
    set((state) => {
      const expanded = { ...state.expandedSections, [section]: !state.expandedSections[section] }
      localStorage.setItem(STORAGE_KEYS.sections, JSON.stringify(expanded))
      return { expandedSections: expanded }
    }),

  nextTip: () =>
    set((state) => ({ tipIndex: (state.tipIndex + 1) % TIPS.length })),
}))

/* ════════════════════════════════════════════════════════════════════════════
   Constants
   ════════════════════════════════════════════════════════════════════════════ */

const VERSION = APP_VERSION
const TAGLINE = 'The AI-Native Code Editor'

const TIPS = [
  { shortcut: 'Ctrl+P', text: 'Quickly open any file in your workspace by typing part of its name.' },
  { shortcut: 'Ctrl+Shift+P', text: 'Open the Command Palette to access every command in Orion.' },
  { shortcut: 'Ctrl+K', text: 'Use inline AI editing to transform, refactor, or generate code in place.' },
  { shortcut: 'Ctrl+D', text: 'Select the next occurrence of the current word for multi-cursor editing.' },
  { shortcut: 'Ctrl+\\', text: 'Split your editor to view two files side by side.' },
  { shortcut: 'Ctrl+`', text: 'Toggle the integrated terminal without leaving the editor.' },
  { shortcut: 'Ctrl+Shift+F', text: 'Search across all files in your workspace instantly.' },
  { shortcut: 'Alt+Up/Down', text: 'Move the current line up or down for quick rearranging.' },
  { shortcut: 'Ctrl+L', text: 'Open the AI chat panel for longer conversations about your code.' },
  { shortcut: 'F2', text: 'Rename a symbol across your entire project with a single keystroke.' },
  { shortcut: 'Ctrl+G', text: 'Jump to a specific line number instantly.' },
  { shortcut: 'Alt+Click', text: 'Place multiple cursors anywhere in the document for parallel editing.' },
  { shortcut: 'Ctrl+,', text: 'Open Settings to customize every aspect of your editing experience.' },
]

const WHATS_NEW = [
  { icon: BrainCircuit, title: 'Multi-Model AI Support', desc: 'Switch between Anthropic, OpenAI, and local models on the fly.', version: 'v1.3.0', badge: 'new' as const },
  { icon: SplitSquareHorizontal, title: 'Split Editor Enhancements', desc: 'Drag tabs between editor groups and use vertical/horizontal splits.', version: 'v1.3.0', badge: 'new' as const },
  { icon: Zap, title: 'Performance Boost', desc: 'File loading is 3x faster with our new virtual document engine.', version: 'v1.3.0', badge: 'improved' as const },
  { icon: Shield, title: 'Workspace Trust', desc: 'Control which folders can run code and access resources.', version: 'v1.2.0', badge: 'new' as const },
  { icon: Sparkles, title: 'AI Inline Edits', desc: 'Press Ctrl+K to transform code with natural language.', version: 'v1.2.0', badge: 'new' as const },
  { icon: Terminal, title: 'Terminal Themes', desc: 'Choose from multiple terminal color schemes.', version: 'v1.2.0', badge: 'improved' as const },
  { icon: Palette, title: 'Status Bar Dropdowns', desc: 'Quick access to language mode, encoding, and EOL settings.', version: 'v1.1.0', badge: 'improved' as const },
  { icon: Star, title: 'Chat History', desc: 'Your AI conversations are now saved and searchable.', version: 'v1.1.0', badge: 'new' as const },
]

const THEME_PREVIEWS = [
  { id: 'orion-dark', name: 'Orion Dark', bg: '#1a1b26', sidebar: '#16161e', editor: '#1a1b26', accent: '#7aa2f7', text: '#a9b1d6', comment: '#565f89' },
  { id: 'orion-light', name: 'Orion Light', bg: '#f5f5f5', sidebar: '#e8e8e8', editor: '#ffffff', accent: '#4f46e5', text: '#333333', comment: '#999999' },
  { id: 'monokai', name: 'Monokai Pro', bg: '#2d2a2e', sidebar: '#221f22', editor: '#2d2a2e', accent: '#ffd866', text: '#fcfcfa', comment: '#727072' },
  { id: 'nord', name: 'Nord', bg: '#2e3440', sidebar: '#242933', editor: '#2e3440', accent: '#88c0d0', text: '#d8dee9', comment: '#616e88' },
]

const LEARN_LINKS = [
  { icon: BookOpen, label: 'Documentation', description: 'Comprehensive guides and API reference', shortcut: '', url: '#docs' },
  { icon: Lightbulb, label: 'Tips & Tricks', description: 'Productivity hacks and hidden features', shortcut: '', url: '#tips' },
  { icon: Keyboard, label: 'Keyboard Shortcuts', description: 'Complete keyboard shortcut reference', shortcut: 'Ctrl+K Ctrl+S', url: '#shortcuts' },
  { icon: FileText, label: 'Release Notes', description: 'Detailed changelog for every version', shortcut: '', url: '#release-notes' },
  { icon: Play, label: 'Video Tutorials', description: 'Step-by-step walkthroughs on YouTube', shortcut: '', url: '#videos' },
  { icon: MessageCircle, label: 'Community Forum', description: 'Ask questions and share knowledge', shortcut: '', url: '#community' },
]

/* ════════════════════════════════════════════════════════════════════════════
   Props
   ════════════════════════════════════════════════════════════════════════════ */

interface WelcomeTabProps {
  onOpenFolder: () => void
  onOpenPalette: () => void
  onOpenTerminal: () => void
  onOpenSettings: () => void
  onOpenChat: () => void
}

/* ════════════════════════════════════════════════════════════════════════════
   Utility helpers
   ════════════════════════════════════════════════════════════════════════════ */

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const iconMap: Record<string, { icon: typeof FileText; color: string }> = {
    ts: { icon: FileCode, color: 'var(--accent-primary)' },
    tsx: { icon: FileCode, color: 'var(--accent-primary)' },
    js: { icon: FileCode, color: '#e5c07b' },
    jsx: { icon: FileCode, color: '#e5c07b' },
    json: { icon: FileJson, color: '#98c379' },
    css: { icon: Braces, color: '#c678dd' },
    scss: { icon: Braces, color: '#c678dd' },
    html: { icon: Code, color: '#e06c75' },
    md: { icon: FileText, color: 'var(--text-secondary)' },
    py: { icon: FileCode, color: '#98c379' },
    rs: { icon: FileCode, color: '#e06c75' },
    go: { icon: FileCode, color: '#56b6c2' },
    png: { icon: Image, color: '#56b6c2' },
    jpg: { icon: Image, color: '#56b6c2' },
    svg: { icon: Image, color: '#e5c07b' },
    sql: { icon: Database, color: '#e5c07b' },
  }
  return iconMap[ext] || { icon: File, color: 'var(--text-secondary)' }
}

function getRelativePath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  if (parts.length <= 3) return parts.join('/')
  return '.../' + parts.slice(-3).join('/')
}

function formatTimestamp(ts: number): string {
  const now = Date.now()
  const diff = now - ts
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(ts).toLocaleDateString()
}

/* ════════════════════════════════════════════════════════════════════════════
   Style injection
   ════════════════════════════════════════════════════════════════════════════ */

const STYLE_ID = 'orion-welcome-tab-styles'

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    @keyframes orionWelcomeFadeInUp {
      from { opacity: 0; transform: translateY(18px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes orionWelcomePulse {
      0%, 100% { box-shadow: 0 0 20px rgba(99,102,241,0.12); }
      50% { box-shadow: 0 0 40px rgba(99,102,241,0.28); }
    }
    @keyframes orionWelcomeShimmer {
      0% { background-position: -200% center; }
      100% { background-position: 200% center; }
    }
    @keyframes orionWelcomeStepCheck {
      0% { transform: scale(0.8); }
      50% { transform: scale(1.2); }
      100% { transform: scale(1); }
    }
    @keyframes orionWelcomeProgressFill {
      from { width: 0%; }
      to { width: var(--target-width); }
    }
    @keyframes orionBadgePulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    .owt-action-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: transparent;
      border: none;
      border-radius: 8px;
      color: var(--text-primary);
      cursor: pointer;
      font-size: 13px;
      font-weight: 400;
      text-align: left;
      transition: all 0.15s ease;
      width: 100%;
      font-family: inherit;
    }
    .owt-action-btn:hover {
      background: var(--bg-tertiary, var(--bg-hover));
      transform: translateX(3px);
    }
    .owt-action-btn:active {
      transform: translateX(1px);
    }

    .owt-recent-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      background: transparent;
      border: none;
      border-radius: 6px;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 12px;
      text-align: left;
      transition: all 0.12s ease;
      width: 100%;
      font-family: inherit;
      position: relative;
    }
    .owt-recent-item:hover {
      background: var(--bg-tertiary, var(--bg-hover));
    }
    .owt-recent-item:hover .owt-recent-name {
      color: var(--accent-primary) !important;
    }
    .owt-recent-item:hover .owt-recent-actions {
      opacity: 1;
    }

    .owt-recent-actions {
      opacity: 0;
      transition: opacity 0.15s;
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .owt-icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 4px;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.12s;
      padding: 0;
    }
    .owt-icon-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }

    .owt-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 20px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .owt-card:hover {
      border-color: color-mix(in srgb, var(--accent-primary) 35%, var(--border-color));
      box-shadow: 0 2px 20px rgba(0,0,0,0.08);
    }

    .owt-walkthrough-step {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.12s;
    }
    .owt-walkthrough-step:hover {
      background: var(--bg-tertiary, var(--bg-hover));
    }
    .owt-walkthrough-step:hover .owt-step-action {
      opacity: 1;
    }

    .owt-step-action {
      opacity: 0;
      transition: opacity 0.15s;
    }

    .owt-learn-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      background: transparent;
      border: none;
      border-radius: 8px;
      color: var(--text-primary);
      cursor: pointer;
      font-size: 13px;
      text-align: left;
      transition: all 0.15s ease;
      width: 100%;
      font-family: inherit;
    }
    .owt-learn-link:hover {
      background: var(--bg-tertiary, var(--bg-hover));
      transform: translateX(2px);
    }

    .owt-theme-preview {
      border: 2px solid var(--border-color);
      border-radius: 8px;
      cursor: pointer;
      overflow: hidden;
      transition: all 0.2s;
      flex: 1;
      min-width: 120px;
    }
    .owt-theme-preview:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    }
    .owt-theme-preview.owt-theme-active {
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 1px var(--accent-primary), 0 4px 16px rgba(99,102,241,0.2);
    }

    .owt-slider-track {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 4px;
      border-radius: 2px;
      background: var(--bg-tertiary, var(--bg-hover));
      outline: none;
    }
    .owt-slider-track::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--accent-primary);
      cursor: pointer;
      border: 2px solid var(--bg-primary);
      box-shadow: 0 1px 4px rgba(0,0,0,0.2);
      transition: transform 0.15s;
    }
    .owt-slider-track::-webkit-slider-thumb:hover {
      transform: scale(1.2);
    }

    .owt-footer-link {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 4px;
      color: var(--text-secondary);
      font-size: 12px;
      text-decoration: none;
      cursor: pointer;
      transition: color 0.15s, background 0.15s;
      border: none;
      background: none;
      font-family: inherit;
    }
    .owt-footer-link:hover {
      color: var(--text-primary);
      background: var(--bg-tertiary, var(--bg-hover));
    }

    .owt-badge-new {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 1px 6px;
      border-radius: 3px;
      background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
      color: var(--accent-primary);
    }
    .owt-badge-improved {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 1px 6px;
      border-radius: 3px;
      background: color-mix(in srgb, #34d399 15%, transparent);
      color: #34d399;
    }

    .owt-whats-new-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      transition: background 0.12s;
    }
    .owt-whats-new-item:hover {
      background: var(--bg-tertiary, var(--bg-hover));
    }

    .owt-tip-next {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 5px 12px;
      background: transparent;
      border: 1px solid var(--border-color);
      border-radius: 5px;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 11px;
      font-weight: 500;
      transition: all 0.15s;
      font-family: inherit;
    }
    .owt-tip-next:hover {
      border-color: var(--text-secondary);
      color: var(--text-primary);
      background: var(--bg-tertiary, var(--bg-hover));
    }

    .owt-clear-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      background: transparent;
      border: none;
      border-radius: 4px;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 10px;
      font-weight: 500;
      transition: all 0.15s;
      font-family: inherit;
    }
    .owt-clear-btn:hover {
      color: var(--text-primary);
      background: var(--bg-tertiary, var(--bg-hover));
    }

    .owt-toggle-provider {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid var(--border-color);
      background: transparent;
      cursor: pointer;
      transition: all 0.15s;
      flex: 1;
      font-family: inherit;
    }
    .owt-toggle-provider:hover {
      background: var(--bg-tertiary, var(--bg-hover));
    }
    .owt-toggle-provider.owt-provider-active {
      border-color: var(--accent-primary);
      background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
    }

    .owt-scroll-container::-webkit-scrollbar {
      width: 8px;
    }
    .owt-scroll-container::-webkit-scrollbar-track {
      background: transparent;
    }
    .owt-scroll-container::-webkit-scrollbar-thumb {
      background: color-mix(in srgb, var(--text-secondary) 25%, transparent);
      border-radius: 4px;
    }
    .owt-scroll-container::-webkit-scrollbar-thumb:hover {
      background: color-mix(in srgb, var(--text-secondary) 40%, transparent);
    }
  `
  document.head.appendChild(style)
}

/* ════════════════════════════════════════════════════════════════════════════
   Orion Logo SVG (inline)
   ════════════════════════════════════════════════════════════════════════════ */

function OrionLogo({ size = 72 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      style={{ filter: 'drop-shadow(0 0 28px rgba(99,102,241,0.45))' }}
    >
      <defs>
        <linearGradient id="owt-bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4F46E5" />
          <stop offset="50%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
        <linearGradient id="owt-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#C7D2FE" />
          <stop offset="100%" stopColor="#E0E7FF" />
        </linearGradient>
        <linearGradient id="owt-star-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="100%" stopColor="#FCD34D" />
        </linearGradient>
        <filter id="owt-glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="96" ry="96" fill="url(#owt-bg-grad)" />
      <circle cx="256" cy="270" r="140" fill="none" stroke="url(#owt-ring-grad)" strokeWidth="36" strokeLinecap="round" opacity="0.95" />
      <circle cx="256" cy="270" r="140" fill="none" stroke="url(#owt-bg-grad)" strokeWidth="40" strokeDasharray="60 820" strokeDashoffset="-40" transform="rotate(-45 256 270)" />
      <circle cx="348" cy="178" r="12" fill="url(#owt-star-grad)" filter="url(#owt-glow)" />
      <circle cx="164" cy="362" r="9" fill="url(#owt-star-grad)" filter="url(#owt-glow)" />
      <circle cx="178" cy="192" r="7" fill="url(#owt-star-grad)" filter="url(#owt-glow)" opacity="0.9" />
      <circle cx="340" cy="352" r="7" fill="url(#owt-star-grad)" filter="url(#owt-glow)" opacity="0.9" />
      <circle cx="222" cy="270" r="5" fill="#FDE68A" filter="url(#owt-glow)" opacity="0.85" />
      <circle cx="256" cy="262" r="6" fill="#FDE68A" filter="url(#owt-glow)" opacity="0.95" />
      <circle cx="290" cy="270" r="5" fill="#FDE68A" filter="url(#owt-glow)" opacity="0.85" />
      <line x1="178" y1="192" x2="222" y2="270" stroke="#C7D2FE" strokeWidth="1.5" opacity="0.3" />
      <line x1="222" y1="270" x2="256" y2="262" stroke="#C7D2FE" strokeWidth="1.5" opacity="0.3" />
      <line x1="256" y1="262" x2="290" y2="270" stroke="#C7D2FE" strokeWidth="1.5" opacity="0.3" />
      <line x1="290" y1="270" x2="340" y2="352" stroke="#C7D2FE" strokeWidth="1.5" opacity="0.3" />
      <line x1="348" y1="178" x2="290" y2="270" stroke="#C7D2FE" strokeWidth="1.5" opacity="0.3" />
      <line x1="178" y1="192" x2="348" y2="178" stroke="#C7D2FE" strokeWidth="1" opacity="0.2" />
      <line x1="164" y1="362" x2="222" y2="270" stroke="#C7D2FE" strokeWidth="1.5" opacity="0.3" />
      <line x1="164" y1="362" x2="340" y2="352" stroke="#C7D2FE" strokeWidth="1" opacity="0.2" />
      <circle cx="120" cy="120" r="2" fill="#E0E7FF" opacity="0.5" />
      <circle cx="400" cy="100" r="2.5" fill="#E0E7FF" opacity="0.4" />
      <circle cx="390" cy="420" r="2" fill="#E0E7FF" opacity="0.45" />
      <circle cx="100" cy="400" r="1.5" fill="#E0E7FF" opacity="0.35" />
      <circle cx="300" cy="130" r="1.5" fill="#E0E7FF" opacity="0.4" />
      <circle cx="430" cy="260" r="2" fill="#E0E7FF" opacity="0.3" />
      <circle cx="80" cy="280" r="1.5" fill="#E0E7FF" opacity="0.35" />
    </svg>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Sub-components
   ════════════════════════════════════════════════════════════════════════════ */

function SectionHeader({ children, style: extraStyle }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.8px',
      color: 'var(--text-secondary)',
      marginBottom: 10,
      ...extraStyle,
    }}>
      {children}
    </div>
  )
}

function CollapsibleHeader({
  title,
  expanded,
  onToggle,
  badge,
  rightContent,
}: {
  title: string
  expanded: boolean
  onToggle: () => void
  badge?: string
  rightContent?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.8px',
          color: 'var(--text-secondary)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          fontFamily: 'inherit',
          transition: 'color 0.15s',
        }}
      >
        {expanded
          ? <ChevronDown size={12} style={{ transition: 'transform 0.2s' }} />
          : <ChevronRight size={12} style={{ transition: 'transform 0.2s' }} />
        }
        {title}
        {badge && (
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--accent-primary)',
            background: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
            padding: '0 5px',
            borderRadius: 8,
            lineHeight: '16px',
            textTransform: 'none' as const,
            letterSpacing: '0',
          }}>
            {badge}
          </span>
        )}
      </button>
      {rightContent}
    </div>
  )
}

function KBD({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      fontSize: 10,
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-mono, monospace)',
      background: 'var(--bg-secondary)',
      padding: '2px 6px',
      borderRadius: 4,
      border: '1px solid var(--border-color)',
      whiteSpace: 'nowrap' as const,
    }}>
      {children}
    </kbd>
  )
}

function IconBox({
  icon: Icon,
  color,
  size = 28,
  iconSize = 14,
  bgOpacity = 10,
}: {
  icon: typeof Sparkles
  color: string
  size?: number
  iconSize?: number
  bgOpacity?: number
}) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: size > 28 ? 10 : 7,
      background: `color-mix(in srgb, ${color} ${bgOpacity}%, transparent)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Icon size={iconSize} style={{ color }} />
    </div>
  )
}

function ProgressBar({ completed, total, label }: { completed: number; total: number; label?: string }) {
  const pct = total > 0 ? (completed / total) * 100 : 0
  const isComplete = completed === total && total > 0
  return (
    <div style={{ marginBottom: 14 }}>
      {label && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{label}</span>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: isComplete ? '#34d399' : 'var(--text-secondary)',
          }}>
            {completed}/{total}
          </span>
        </div>
      )}
      <div style={{
        height: 4,
        borderRadius: 2,
        background: 'var(--bg-tertiary, var(--bg-hover))',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: isComplete
            ? '#34d399'
            : 'linear-gradient(90deg, var(--accent-primary), color-mix(in srgb, var(--accent-primary) 60%, #c084fc))',
          borderRadius: 2,
          transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        }} />
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Hero Section
   ──────────────────────────────────────────────────────────────────────────── */

function HeroSection() {
  return (
    <div style={{
      textAlign: 'center' as const,
      marginBottom: 48,
      animation: 'orionWelcomeFadeInUp 0.5s ease both',
    }}>
      <div style={{
        marginBottom: 18,
        animation: 'orionWelcomePulse 4s ease-in-out infinite',
        borderRadius: 24,
        display: 'inline-block',
      }}>
        <OrionLogo size={80} />
      </div>

      <div style={{
        fontSize: 48,
        fontWeight: 800,
        letterSpacing: '-2.5px',
        background: 'linear-gradient(135deg, #818CF8 0%, #6366F1 20%, #A78BFA 40%, #34D399 65%, #6EE7B7 80%, #818CF8 100%)',
        backgroundSize: '200% auto',
        animation: 'orionWelcomeShimmer 6s linear infinite',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        lineHeight: 1.1,
        marginBottom: 10,
      }}>
        Orion IDE
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        flexWrap: 'wrap' as const,
      }}>
        <span style={{
          fontSize: 15,
          color: 'var(--text-secondary)',
          fontWeight: 400,
          letterSpacing: '0.5px',
        }}>
          {TAGLINE}
        </span>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--accent-primary)',
          background: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
          padding: '2px 10px',
          borderRadius: 10,
          letterSpacing: '0.5px',
        }}>
          v{VERSION}
        </span>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Start Section
   ──────────────────────────────────────────────────────────────────────────── */

function StartSection({ onOpenFolder }: { onOpenFolder: () => void }) {
  const openFile = useEditorStore((s) => s.openFile)
  const expanded = useWelcomeStore((s) => s.expandedSections.start)
  const toggleSection = useWelcomeStore((s) => s.toggleSection)

  const actions = useMemo(() => [
    {
      id: 'new-file',
      icon: FilePlus,
      label: 'New File',
      shortcut: 'Ctrl+N',
      color: 'var(--accent-primary)',
      onClick: () => {
        openFile({
          path: `untitled-${Date.now()}`,
          name: 'Untitled',
          content: '',
          language: 'plaintext',
          isModified: false,
          aiModified: false,
        })
      },
    },
    {
      id: 'open-file',
      icon: FileText,
      label: 'Open File...',
      shortcut: 'Ctrl+O',
      color: 'var(--accent-primary)',
      onClick: onOpenFolder,
    },
    {
      id: 'open-folder',
      icon: FolderOpen,
      label: 'Open Folder...',
      shortcut: 'Ctrl+K Ctrl+O',
      color: '#e5c07b',
      onClick: onOpenFolder,
    },
    {
      id: 'clone-repo',
      icon: GitBranch,
      label: 'Clone Git Repository...',
      shortcut: '',
      color: '#e06c75',
      onClick: () => window.dispatchEvent(new Event('orion:show-git')),
    },
    {
      id: 'connect-remote',
      icon: Globe,
      label: 'Connect to Remote...',
      shortcut: '',
      color: '#56b6c2',
      onClick: () => window.dispatchEvent(new Event('orion:connect-remote')),
    },
  ], [openFile, onOpenFolder])

  return (
    <section>
      <CollapsibleHeader
        title="Start"
        expanded={expanded}
        onToggle={() => toggleSection('start')}
      />
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {actions.map(({ id, icon: Icon, label, shortcut, color, onClick }) => (
            <button
              key={id}
              onClick={onClick}
              className="owt-action-btn"
            >
              <IconBox icon={Icon} color={color} />
              <span style={{ flex: 1 }}>{label}</span>
              {shortcut && <KBD>{shortcut}</KBD>}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Recent Section
   ──────────────────────────────────────────────────────────────────────────── */

function RecentSection() {
  const expanded = useWelcomeStore((s) => s.expandedSections.recent)
  const toggleSection = useWelcomeStore((s) => s.toggleSection)
  const recentItems = useWelcomeStore((s) => s.recentItems)
  const togglePin = useWelcomeStore((s) => s.togglePin)
  const removeRecent = useWelcomeStore((s) => s.removeRecent)
  const clearRecent = useWelcomeStore((s) => s.clearRecent)
  const openFile = useEditorStore((s) => s.openFile)

  const sortedItems = useMemo(() => {
    const pinned = recentItems.filter((i) => i.pinned).sort((a, b) => b.timestamp - a.timestamp)
    const unpinned = recentItems.filter((i) => !i.pinned).sort((a, b) => b.timestamp - a.timestamp)
    return [...pinned, ...unpinned]
  }, [recentItems])

  return (
    <section>
      <CollapsibleHeader
        title="Recent"
        expanded={expanded}
        onToggle={() => toggleSection('recent')}
        badge={recentItems.length > 0 ? String(recentItems.length) : undefined}
        rightContent={
          recentItems.length > 0 && expanded ? (
            <button
              className="owt-clear-btn"
              onClick={(e) => { e.stopPropagation(); clearRecent() }}
            >
              <X size={10} />
              Clear All
            </button>
          ) : undefined
        }
      />
      {expanded && (
        <>
          {sortedItems.length === 0 ? (
            <div style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              padding: '20px 16px',
              textAlign: 'center' as const,
              background: 'var(--bg-secondary)',
              borderRadius: 8,
              border: '1px dashed var(--border-color)',
              lineHeight: 1.6,
            }}>
              <FolderOpen size={24} style={{ color: 'var(--text-secondary)', marginBottom: 8, opacity: 0.5 }} />
              <div>No recent files or folders yet.</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                Open a file or folder to get started.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {sortedItems.map((item) => {
                const isFolder = item.type === 'folder'
                const { icon: FileIcon, color } = isFolder
                  ? { icon: FolderOpen, color: '#e5c07b' }
                  : getFileIcon(item.name)
                return (
                  <div
                    key={item.path}
                    className="owt-recent-item"
                    onClick={async () => {
                      if (isFolder) {
                        window.dispatchEvent(new CustomEvent('orion:open-folder', { detail: item.path }))
                        return
                      }
                      try {
                        const result = await window.api.readFile(item.path)
                        if (result) {
                          openFile({
                            path: item.path,
                            name: item.name,
                            content: result.content,
                            language: result.language || 'plaintext',
                            isModified: false,
                            aiModified: false,
                          })
                        }
                      } catch { /* ignore */ }
                    }}
                  >
                    {item.pinned && (
                      <Pin size={8} style={{
                        color: 'var(--accent-primary)',
                        position: 'absolute',
                        top: 3,
                        left: 4,
                        transform: 'rotate(-45deg)',
                      }} />
                    )}
                    <FileIcon size={14} style={{ color, flexShrink: 0 }} />
                    <span className="owt-recent-name" style={{
                      color: 'var(--text-primary)',
                      transition: 'color 0.12s',
                      fontWeight: 400,
                      whiteSpace: 'nowrap' as const,
                    }}>
                      {item.name}
                    </span>
                    <span style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap' as const,
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      textAlign: 'right' as const,
                      paddingRight: 4,
                    }}>
                      {getRelativePath(item.path)}
                    </span>
                    <span style={{
                      fontSize: 10,
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap' as const,
                      flexShrink: 0,
                    }}>
                      {formatTimestamp(item.timestamp)}
                    </span>
                    <div className="owt-recent-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="owt-icon-btn"
                        title={item.pinned ? 'Unpin' : 'Pin'}
                        onClick={() => togglePin(item.path)}
                      >
                        {item.pinned ? <PinOff size={11} /> : <Pin size={11} />}
                      </button>
                      <button
                        className="owt-icon-btn"
                        title="Remove from recent"
                        onClick={() => removeRecent(item.path)}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Walkthroughs Section
   ──────────────────────────────────────────────────────────────────────────── */

function WalkthroughsSection({
  onOpenPalette,
  onOpenTerminal,
  onOpenSettings,
  onOpenChat,
}: {
  onOpenPalette: () => void
  onOpenTerminal: () => void
  onOpenSettings: () => void
  onOpenChat: () => void
}) {
  const expanded = useWelcomeStore((s) => s.expandedSections.walkthroughs)
  const toggleSection = useWelcomeStore((s) => s.toggleSection)
  const walkthroughs = useWelcomeStore((s) => s.walkthroughs)
  const completeStep = useWelcomeStore((s) => s.completeStep)
  const resetWalkthrough = useWelcomeStore((s) => s.resetWalkthrough)
  const toggleWalkthroughExpand = useWelcomeStore((s) => s.toggleWalkthroughExpand)

  const totalSteps = walkthroughs.reduce((acc, wt) => acc + wt.steps.length, 0)
  const totalCompleted = walkthroughs.reduce((acc, wt) => acc + wt.steps.filter((s) => s.completed).length, 0)

  const stepActionMap: Record<string, () => void> = useMemo(() => ({
    theme: () => window.dispatchEvent(new Event('orion:open-themes')),
    keybindings: () => window.dispatchEvent(new Event('orion:open-keybindings')),
    extensions: () => window.dispatchEvent(new Event('orion:open-extensions')),
    'ai-setup': onOpenSettings,
    terminal: onOpenTerminal,
    'ai-chat': onOpenChat,
    'ai-completions': () => window.dispatchEvent(new Event('orion:toggle-ai-completions')),
    'ai-refactor': onOpenPalette,
    'ai-explain': onOpenChat,
    settings: onOpenSettings,
    'themes-deep': () => window.dispatchEvent(new Event('orion:open-theme-editor')),
    'keybinds-deep': () => window.dispatchEvent(new Event('orion:open-keybindings')),
  }), [onOpenPalette, onOpenTerminal, onOpenSettings, onOpenChat])

  return (
    <section>
      <CollapsibleHeader
        title="Walkthroughs"
        expanded={expanded}
        onToggle={() => toggleSection('walkthroughs')}
        badge={`${totalCompleted}/${totalSteps}`}
      />
      {expanded && (
        <>
          <ProgressBar completed={totalCompleted} total={totalSteps} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {walkthroughs.map((wt) => {
              const wtCompleted = wt.steps.filter((s) => s.completed).length
              const wtTotal = wt.steps.length
              const WtIcon = wt.icon
              const isComplete = wtCompleted === wtTotal

              return (
                <div key={wt.id} className="owt-card" style={{ padding: 0, overflow: 'hidden' }}>
                  {/* Walkthrough header */}
                  <button
                    onClick={() => toggleWalkthroughExpand(wt.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '14px 16px',
                      width: '100%',
                      background: 'none',
                      border: 'none',
                      borderBottom: wt.expanded ? '1px solid var(--border-color)' : 'none',
                      cursor: 'pointer',
                      textAlign: 'left' as const,
                      fontFamily: 'inherit',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <IconBox
                      icon={WtIcon}
                      color={isComplete ? '#34d399' : 'var(--accent-primary)'}
                      size={36}
                      iconSize={18}
                      bgOpacity={12}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {wt.title}
                        </span>
                        {isComplete && (
                          <span style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: '#34d399',
                            background: 'color-mix(in srgb, #34d399 12%, transparent)',
                            padding: '1px 6px',
                            borderRadius: 3,
                            textTransform: 'uppercase' as const,
                          }}>
                            Complete
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontSize: 11,
                        color: 'var(--text-secondary)',
                        marginTop: 2,
                      }}>
                        {wt.description}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: isComplete ? '#34d399' : 'var(--text-secondary)',
                      flexShrink: 0,
                    }}>
                      {wtCompleted}/{wtTotal}
                    </span>
                    {wt.expanded
                      ? <ChevronDown size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                      : <ChevronRight size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                    }
                  </button>

                  {/* Walkthrough steps */}
                  {wt.expanded && (
                    <div style={{ padding: '4px 0' }}>
                      {wt.steps.map((step) => {
                        const StepIcon = step.icon
                        return (
                          <div
                            key={step.id}
                            className="owt-walkthrough-step"
                            onClick={() => {
                              completeStep(wt.id, step.id)
                              const action = stepActionMap[step.id]
                              if (action) action()
                            }}
                          >
                            {/* Checkbox */}
                            <div style={{
                              width: 20,
                              height: 20,
                              borderRadius: 5,
                              border: step.completed ? 'none' : '2px solid var(--text-secondary)',
                              background: step.completed
                                ? 'linear-gradient(135deg, #34d399, #10b981)'
                                : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              marginTop: 2,
                              transition: 'all 0.2s',
                              animation: step.completed ? 'orionWelcomeStepCheck 0.3s ease' : 'none',
                            }}>
                              {step.completed && <Check size={12} style={{ color: '#fff' }} />}
                            </div>

                            {/* Step icon */}
                            <IconBox
                              icon={StepIcon}
                              color={step.completed ? 'var(--text-secondary)' : 'var(--accent-primary)'}
                              bgOpacity={step.completed ? 5 : 10}
                            />

                            {/* Step content */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{
                                fontSize: 13,
                                fontWeight: 400,
                                color: step.completed ? 'var(--text-secondary)' : 'var(--text-primary)',
                                textDecoration: step.completed ? 'line-through' : 'none',
                                transition: 'all 0.15s',
                              }}>
                                {step.label}
                              </div>
                              <div style={{
                                fontSize: 11,
                                color: 'var(--text-secondary)',
                                marginTop: 2,
                                lineHeight: 1.4,
                              }}>
                                {step.description}
                              </div>
                            </div>

                            {/* Action button (shown on hover) */}
                            <div className="owt-step-action" style={{ flexShrink: 0, marginTop: 2 }}>
                              <span style={{
                                fontSize: 10,
                                fontWeight: 500,
                                color: 'var(--accent-primary)',
                                padding: '3px 8px',
                                borderRadius: 4,
                                background: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',
                                whiteSpace: 'nowrap' as const,
                              }}>
                                {step.actionLabel}
                              </span>
                            </div>

                            <ChevronRight size={14} style={{
                              color: 'var(--text-secondary)',
                              flexShrink: 0,
                              marginTop: 4,
                              opacity: 0.6,
                            }} />
                          </div>
                        )
                      })}

                      {/* Reset button */}
                      {wtCompleted > 0 && (
                        <div style={{
                          display: 'flex',
                          justifyContent: 'flex-end',
                          padding: '4px 12px 8px',
                        }}>
                          <button
                            className="owt-clear-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              resetWalkthrough(wt.id)
                            }}
                          >
                            <RefreshCw size={9} />
                            Reset
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Learn Section
   ──────────────────────────────────────────────────────────────────────────── */

function LearnSection() {
  const expanded = useWelcomeStore((s) => s.expandedSections.learn)
  const toggleSection = useWelcomeStore((s) => s.toggleSection)

  return (
    <section>
      <CollapsibleHeader
        title="Learn"
        expanded={expanded}
        onToggle={() => toggleSection('learn')}
      />
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {LEARN_LINKS.map(({ icon: LIcon, label, description, shortcut, url }) => (
            <button
              key={label}
              className="owt-learn-link"
              onClick={() => window.open(url, '_blank')}
            >
              <IconBox icon={LIcon} color="var(--accent-primary)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-primary)' }}>
                  {label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                  {description}
                </div>
              </div>
              {shortcut && <KBD>{shortcut}</KBD>}
              <ExternalLink size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0, opacity: 0.5 }} />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Quick Settings Section
   ──────────────────────────────────────────────────────────────────────────── */

function QuickSettingsSection() {
  const expanded = useWelcomeStore((s) => s.expandedSections.quickSettings)
  const toggleSection = useWelcomeStore((s) => s.toggleSection)
  const quickSettings = useWelcomeStore((s) => s.quickSettings)
  const setQuickSetting = useWelcomeStore((s) => s.setQuickSetting)

  const aiProviders: Array<{ id: 'anthropic' | 'openai' | 'local' | 'none'; name: string; icon: typeof Bot; desc: string }> = [
    { id: 'anthropic', name: 'Anthropic', icon: BrainCircuit, desc: 'Claude models' },
    { id: 'openai', name: 'OpenAI', icon: Bot, desc: 'GPT models' },
    { id: 'local', name: 'Local', icon: Cpu, desc: 'Ollama / LM Studio' },
    { id: 'none', name: 'None', icon: Shield, desc: 'Disable AI' },
  ]

  return (
    <section>
      <CollapsibleHeader
        title="Quick Settings"
        expanded={expanded}
        onToggle={() => toggleSection('quickSettings')}
      />
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Theme selector */}
          <div>
            <SectionHeader style={{ marginBottom: 12 }}>Color Theme</SectionHeader>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 10,
            }}>
              {THEME_PREVIEWS.map((theme) => {
                const isActive = quickSettings.selectedTheme === theme.name
                return (
                  <div
                    key={theme.id}
                    className={`owt-theme-preview ${isActive ? 'owt-theme-active' : ''}`}
                    onClick={() => {
                      setQuickSetting('selectedTheme', theme.name)
                      window.dispatchEvent(new CustomEvent('orion:set-theme', { detail: theme.id }))
                    }}
                  >
                    {/* Mini editor preview */}
                    <div style={{ background: theme.bg, padding: 6, height: 72 }}>
                      {/* Title bar */}
                      <div style={{
                        display: 'flex',
                        gap: 3,
                        marginBottom: 4,
                      }}>
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#ff5f57' }} />
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#febc2e' }} />
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#28c840' }} />
                      </div>
                      <div style={{ display: 'flex', height: 'calc(100% - 12px)' }}>
                        {/* Sidebar */}
                        <div style={{
                          width: 20,
                          background: theme.sidebar,
                          borderRadius: 2,
                          marginRight: 3,
                          padding: '3px 2px',
                        }}>
                          <div style={{ width: '100%', height: 2, background: theme.text, opacity: 0.3, borderRadius: 1, marginBottom: 2 }} />
                          <div style={{ width: '80%', height: 2, background: theme.text, opacity: 0.2, borderRadius: 1, marginBottom: 2 }} />
                          <div style={{ width: '90%', height: 2, background: theme.accent, opacity: 0.5, borderRadius: 1, marginBottom: 2 }} />
                          <div style={{ width: '70%', height: 2, background: theme.text, opacity: 0.2, borderRadius: 1 }} />
                        </div>
                        {/* Editor */}
                        <div style={{
                          flex: 1,
                          background: theme.editor,
                          borderRadius: 2,
                          padding: '3px 4px',
                          overflow: 'hidden',
                        }}>
                          <div style={{ display: 'flex', gap: 3, marginBottom: 3 }}>
                            <div style={{ width: 12, height: 2, background: theme.comment, borderRadius: 1 }} />
                            <div style={{ width: 18, height: 2, background: theme.accent, borderRadius: 1 }} />
                          </div>
                          <div style={{ display: 'flex', gap: 3, marginBottom: 3, paddingLeft: 6 }}>
                            <div style={{ width: 10, height: 2, background: theme.text, opacity: 0.5, borderRadius: 1 }} />
                            <div style={{ width: 14, height: 2, background: theme.accent, opacity: 0.7, borderRadius: 1 }} />
                          </div>
                          <div style={{ display: 'flex', gap: 3, marginBottom: 3, paddingLeft: 6 }}>
                            <div style={{ width: 16, height: 2, background: theme.text, opacity: 0.4, borderRadius: 1 }} />
                          </div>
                          <div style={{ display: 'flex', gap: 3, paddingLeft: 3 }}>
                            <div style={{ width: 8, height: 2, background: theme.comment, borderRadius: 1 }} />
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Label */}
                    <div style={{
                      padding: '6px 8px',
                      fontSize: 11,
                      fontWeight: 500,
                      color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)',
                      textAlign: 'center' as const,
                      background: 'var(--bg-secondary)',
                      borderTop: '1px solid var(--border-color)',
                    }}>
                      {theme.name}
                      {isActive && (
                        <Check size={10} style={{
                          marginLeft: 4,
                          verticalAlign: 'middle',
                          color: 'var(--accent-primary)',
                        }} />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Font size slider */}
          <div>
            <SectionHeader style={{ marginBottom: 12 }}>Font Size</SectionHeader>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 14px',
              background: 'var(--bg-secondary)',
              borderRadius: 8,
              border: '1px solid var(--border-color)',
            }}>
              <button
                className="owt-icon-btn"
                onClick={() => {
                  const newSize = Math.max(10, quickSettings.fontSize - 1)
                  setQuickSetting('fontSize', newSize)
                  window.dispatchEvent(new CustomEvent('orion:set-font-size', { detail: newSize }))
                }}
              >
                <Minus size={12} />
              </button>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Type size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                <input
                  type="range"
                  min={10}
                  max={24}
                  step={1}
                  value={quickSettings.fontSize}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setQuickSetting('fontSize', v)
                    window.dispatchEvent(new CustomEvent('orion:set-font-size', { detail: v }))
                  }}
                  className="owt-slider-track"
                />
              </div>
              <button
                className="owt-icon-btn"
                onClick={() => {
                  const newSize = Math.min(24, quickSettings.fontSize + 1)
                  setQuickSetting('fontSize', newSize)
                  window.dispatchEvent(new CustomEvent('orion:set-font-size', { detail: newSize }))
                }}
              >
                <Plus size={12} />
              </button>
              <span style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono, monospace)',
                minWidth: 28,
                textAlign: 'right' as const,
              }}>
                {quickSettings.fontSize}px
              </span>
            </div>
          </div>

          {/* AI Provider toggle */}
          <div>
            <SectionHeader style={{ marginBottom: 12 }}>AI Provider</SectionHeader>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 8,
            }}>
              {aiProviders.map(({ id, name, icon: ProvIcon, desc }) => {
                const isActive = quickSettings.aiProvider === id
                return (
                  <button
                    key={id}
                    className={`owt-toggle-provider ${isActive ? 'owt-provider-active' : ''}`}
                    onClick={() => {
                      setQuickSetting('aiProvider', id)
                      window.dispatchEvent(new CustomEvent('orion:set-ai-provider', { detail: id }))
                    }}
                  >
                    <IconBox
                      icon={ProvIcon}
                      color={isActive ? 'var(--accent-primary)' : 'var(--text-secondary)'}
                      size={28}
                      iconSize={14}
                      bgOpacity={isActive ? 15 : 5}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12,
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)',
                      }}>
                        {name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                        {desc}
                      </div>
                    </div>
                    {isActive && (
                      <Check size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   What's New Section
   ──────────────────────────────────────────────────────────────────────────── */

function WhatsNewSection() {
  const expanded = useWelcomeStore((s) => s.expandedSections.whatsNew)
  const toggleSection = useWelcomeStore((s) => s.toggleSection)

  return (
    <section>
      <CollapsibleHeader
        title={`What's New in v${VERSION}`}
        expanded={expanded}
        onToggle={() => toggleSection('whatsNew')}
      />
      {expanded && (
        <div className="owt-card" style={{ padding: 0, overflow: 'hidden' }}>
          {WHATS_NEW.map(({ icon: WIcon, title, desc, version, badge }, i) => (
            <div
              key={title}
              className="owt-whats-new-item"
              style={{
                borderBottom: i < WHATS_NEW.length - 1 ? '1px solid var(--border-color)' : 'none',
              }}
            >
              <IconBox
                icon={WIcon}
                color={badge === 'new' ? 'var(--accent-primary)' : '#34d399'}
                size={32}
                iconSize={16}
                bgOpacity={12}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 2,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {title}
                  </span>
                  <span className={badge === 'new' ? 'owt-badge-new' : 'owt-badge-improved'}>
                    {badge}
                  </span>
                  <span style={{
                    fontSize: 9,
                    color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono, monospace)',
                  }}>
                    {version}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Tips Section
   ──────────────────────────────────────────────────────────────────────────── */

function TipsSection() {
  const tipIndex = useWelcomeStore((s) => s.tipIndex)
  const nextTip = useWelcomeStore((s) => s.nextTip)
  const tip = TIPS[tipIndex]

  return (
    <section>
      <SectionHeader>Tips & Tricks</SectionHeader>
      <div className="owt-card" style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <IconBox icon={Lightbulb} color="#e5c07b" size={32} iconSize={16} bgOpacity={12} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {tip.shortcut && (
              <kbd style={{
                display: 'inline-block',
                fontSize: 10,
                fontWeight: 600,
                fontFamily: 'var(--font-mono, monospace)',
                color: 'var(--accent-primary)',
                background: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',
                padding: '1px 7px',
                borderRadius: 4,
                marginBottom: 6,
              }}>
                {tip.shortcut}
              </kbd>
            )}
            <div style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.55,
            }}>
              {tip.text}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <span style={{
            fontSize: 10,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono, monospace)',
          }}>
            {tipIndex + 1}/{TIPS.length}
          </span>
          <button
            onClick={nextTip}
            className="owt-tip-next"
          >
            <RefreshCw size={11} />
            Next Tip
          </button>
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Footer
   ──────────────────────────────────────────────────────────────────────────── */

function FooterSection() {
  const showOnStartup = useWelcomeStore((s) => s.showOnStartup)
  const setShowOnStartup = useWelcomeStore((s) => s.setShowOnStartup)

  return (
    <footer style={{
      marginTop: 48,
      paddingTop: 20,
      borderTop: '1px solid var(--border-color)',
      maxWidth: 1080,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      animation: 'orionWelcomeFadeInUp 0.5s ease 0.25s both',
    }}>
      {/* Footer links */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        flexWrap: 'wrap' as const,
      }}>
        {[
          { icon: BookOpen, label: 'Documentation' },
          { icon: ExternalLink, label: 'GitHub' },
          { icon: MessageCircle, label: 'Discord' },
          { icon: ExternalLink, label: 'Twitter' },
          { icon: Heart, label: 'Sponsor' },
        ].map(({ icon: FIcon, label }, i, arr) => (
          <span key={label} style={{ display: 'contents' }}>
            <button
              className="owt-footer-link"
              onClick={() => window.open('#', '_blank')}
            >
              <FIcon size={12} />
              {label}
            </button>
            {i < arr.length - 1 && (
              <span style={{ color: 'var(--border-color)', fontSize: 11 }}>|</span>
            )}
          </span>
        ))}
      </div>

      {/* Startup toggle + version */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: 8,
      }}>
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--text-secondary)',
        }}>
          <div
            onClick={() => setShowOnStartup(!showOnStartup)}
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              border: showOnStartup ? 'none' : '1.5px solid var(--text-secondary)',
              background: showOnStartup ? 'var(--accent-primary)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {showOnStartup && <Check size={10} style={{ color: 'var(--bg-primary)' }} />}
          </div>
          Show Welcome Tab on Startup
        </label>

        <div style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ opacity: 0.6 }}>Built with</span>
          <Heart size={10} style={{ color: '#e06c75', opacity: 0.8 }} />
          <span>Orion IDE v{VERSION}</span>
        </div>
      </div>
    </footer>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Main WelcomeTab Component
   ════════════════════════════════════════════════════════════════════════════ */

export default function WelcomeTab({
  onOpenFolder,
  onOpenPalette,
  onOpenTerminal,
  onOpenSettings,
  onOpenChat,
}: WelcomeTabProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    injectStyles()
  }, [])

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      {/* Ambient gradient overlay */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 350,
        background: 'radial-gradient(ellipse 80% 50% at 50% 0%, color-mix(in srgb, var(--accent-primary) 6%, transparent), transparent)',
        pointerEvents: 'none',
        zIndex: 0,
      }} />

      {/* Secondary glow */}
      <div style={{
        position: 'absolute',
        top: 100,
        right: 0,
        width: 400,
        height: 400,
        background: 'radial-gradient(ellipse at center, color-mix(in srgb, #c084fc 3%, transparent), transparent)',
        pointerEvents: 'none',
        zIndex: 0,
      }} />

      <div
        ref={scrollRef}
        className="owt-scroll-container"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '40px 40px 24px',
          minHeight: 0,
          overflow: 'auto',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* ===== HERO ===== */}
        <HeroSection />

        {/* ===== MAIN GRID ===== */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 44,
          maxWidth: 1080,
          width: '100%',
          animation: 'orionWelcomeFadeInUp 0.5s ease 0.1s both',
        }}>
          {/* ===== LEFT COLUMN ===== */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <StartSection onOpenFolder={onOpenFolder} />
            <RecentSection />
            <TipsSection />
            <QuickSettingsSection />
          </div>

          {/* ===== RIGHT COLUMN ===== */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <WalkthroughsSection
              onOpenPalette={onOpenPalette}
              onOpenTerminal={onOpenTerminal}
              onOpenSettings={onOpenSettings}
              onOpenChat={onOpenChat}
            />
            <LearnSection />
            <WhatsNewSection />
          </div>
        </div>

        {/* ===== FOOTER ===== */}
        <FooterSection />
      </div>
    </div>
  )
}
