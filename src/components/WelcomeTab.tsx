import { useState, useEffect, useMemo, useRef } from 'react'
import { create } from 'zustand'
import {
  FolderOpen, FileText, FilePlus,
  ChevronRight, ChevronDown, Lightbulb, Check, RefreshCw,
  File, Code, Image, Database, FileJson, FileCode, Braces,
  Palette, Settings, Keyboard, Terminal, Sparkles, Zap,
  ExternalLink, BookOpen, MessageCircle, X, Eye, Wand2, BrainCircuit,
  Heart, Minus, Plus, Type, Rocket,
} from 'lucide-react'
import { DEFAULT_FONT_SIZE } from '@shared/constants'
import type { Theme } from '@/themes'
import { APP_VERSION } from '@/utils/version'
import { PROJECT_LINKS } from '@/utils/projectLinks'
import { openFileInEditor, pickAndOpenFiles } from '@/utils/openFileInEditor'
import { useEditorStore } from '@/store/editor'
import { useRecentFilesStore } from '@/store/recentFiles'
import { useThemeStore } from '@/store/theme'
import { useCompletionStore } from '@/store/completion'

/* ════════════════════════════════════════════════════════════════════════════
   Inline Zustand Store — walkthrough progress and section layout
   ════════════════════════════════════════════════════════════════════════════ */

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

interface WelcomeStore {
  walkthroughs: WalkthroughGroup[]
  expandedSections: Record<string, boolean>
  tipIndex: number

  completeStep: (walkthroughId: string, stepId: string) => void
  resetWalkthrough: (walkthroughId: string) => void
  toggleWalkthroughExpand: (walkthroughId: string) => void
  toggleSection: (section: string) => void
  nextTip: () => void
}

const STORAGE_KEYS = {
  walkthroughs: 'orion-welcome-walkthrough-progress',
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
        { id: 'theme', label: 'Choose a Color Theme', description: 'Personalize the look and feel of your editor with a theme that suits your style', icon: Palette, completed: false, actionLabel: 'Open Settings' },
        { id: 'keybindings', label: 'Customize Keybindings', description: 'Look up the keyboard shortcut for every command', icon: Keyboard, completed: false, actionLabel: 'Open Keybindings' },
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
        { id: 'ai-completions', label: 'AI Code Completions', description: 'Get intelligent inline suggestions as you type, powered by large language models', icon: Wand2, completed: false, actionLabel: 'Turn On' },
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

const useWelcomeStore = create<WelcomeStore>((set) => ({
  walkthroughs: loadWalkthroughProgress(createDefaultWalkthroughs()),
  expandedSections: loadJSON<Record<string, boolean>>(STORAGE_KEYS.sections, {
    start: true,
    recent: true,
    walkthroughs: true,
    learn: true,
    quickSettings: false,
  }),
  tipIndex: Math.floor(Math.random() * 13),

  completeStep: (walkthroughId, stepId) =>
    set((state) => {
      const walkthroughs = state.walkthroughs.map((wt) =>
        wt.id === walkthroughId
          ? {
              ...wt,
              steps: wt.steps.map((s) =>
                s.id === stepId ? { ...s, completed: true } : s
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

/** Themes offered as one-click tiles; Settings lists all of them. */
const QUICK_THEME_IDS = ['orion-dark', 'github-light', 'monokai-pro', 'nord']

/** Mini-preview colours, taken from the theme's own workbench colours. */
function themePreview(theme: Theme) {
  const c = theme.colors
  return {
    id: theme.id,
    name: theme.name,
    bg: c['--bg-tertiary'] || c['--bg-primary'],
    sidebar: c['--bg-secondary'],
    editor: c['--bg-primary'],
    accent: c['--accent'],
    text: c['--text-primary'],
    comment: c['--text-muted'],
  }
}

/** The editor's own settings record (written by Settings, read by the editor panel). */
const EDITOR_SETTINGS_KEY = 'orion-editor-settings'
const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 24

function readEditorFontSize(): number {
  try {
    const size = JSON.parse(localStorage.getItem(EDITOR_SETTINGS_KEY) || '{}')?.fontSize
    if (typeof size === 'number' && Number.isFinite(size)) return size
  } catch { /* fall back to the default */ }
  return DEFAULT_FONT_SIZE
}

/** Save the font size where Settings keeps it and apply it to open editors. */
function applyEditorFontSize(fontSize: number) {
  let stored: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(localStorage.getItem(EDITOR_SETTINGS_KEY) || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed
  } catch { /* overwrite unreadable data */ }
  localStorage.setItem(EDITOR_SETTINGS_KEY, JSON.stringify({ ...stored, fontSize }))
  window.dispatchEvent(new CustomEvent('orion:editor-config', { detail: { fontSize } }))
}

const openExternal = (url: string) => () => { void window.api.shellOpenExternal(url) }

const LEARN_LINKS = [
  { icon: BookOpen, label: 'Documentation', description: 'Setup and feature guide in the README', shortcut: '', external: true, action: openExternal(PROJECT_LINKS.readme) },
  { icon: Keyboard, label: 'Keyboard Shortcuts', description: 'Complete keyboard shortcut reference', shortcut: 'Ctrl+K Ctrl+S', external: false, action: () => window.dispatchEvent(new Event('orion:keyboard-shortcuts')) },
  { icon: FileText, label: 'Release Notes', description: 'Changelog for every release', shortcut: '', external: true, action: openExternal(PROJECT_LINKS.releases) },
  { icon: MessageCircle, label: 'Report an Issue', description: 'Bugs and feature requests on GitHub', shortcut: '', external: true, action: openExternal(PROJECT_LINKS.issues) },
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
      onClick: () => { void pickAndOpenFiles() },
    },
    {
      id: 'open-folder',
      icon: FolderOpen,
      label: 'Open Folder...',
      shortcut: 'Ctrl+K Ctrl+O',
      color: '#e5c07b',
      onClick: onOpenFolder,
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

const RECENT_LIMIT = 10

function RecentSection() {
  const expanded = useWelcomeStore((s) => s.expandedSections.recent)
  const toggleSection = useWelcomeStore((s) => s.toggleSection)
  // The editor records every opened file here; untitled buffers have no file to reopen.
  const recentFiles = useRecentFilesStore((s) => s.recentFiles)
  const clearRecent = useRecentFilesStore((s) => s.clearRecent)
  // The badge counts what is listed, so it is sliced here rather than in the list.
  const items = useMemo(
    () => recentFiles.filter((f) => !f.path.startsWith('untitled-')).slice(0, RECENT_LIMIT),
    [recentFiles],
  )

  return (
    <section>
      <CollapsibleHeader
        title="Recent"
        expanded={expanded}
        onToggle={() => toggleSection('recent')}
        badge={items.length > 0 ? String(items.length) : undefined}
        rightContent={
          items.length > 0 && expanded ? (
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
          {items.length === 0 ? (
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
              <div>No recent files yet.</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                Files you open will be listed here.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {items.map((item) => {
                const { icon: FileIcon, color } = getFileIcon(item.name)
                return (
                  <div
                    key={item.path}
                    className="owt-recent-item"
                    title={item.path}
                    onClick={() => { void openFileInEditor(item.path) }}
                  >
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

  // Every step opens a feature that exists; a step is ticked only when its action runs.
  const stepActionMap: Record<string, () => void> = useMemo(() => ({
    theme: onOpenSettings,
    keybindings: () => window.dispatchEvent(new Event('orion:keyboard-shortcuts')),
    'ai-setup': onOpenSettings,
    terminal: onOpenTerminal,
    'ai-chat': onOpenChat,
    'ai-completions': () => useCompletionStore.getState().setEnabled(true),
    'ai-refactor': onOpenPalette,
    'ai-explain': onOpenChat,
    settings: onOpenSettings,
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
                              const action = stepActionMap[step.id]
                              if (!action) return
                              action()
                              completeStep(wt.id, step.id)
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
          {LEARN_LINKS.map(({ icon: LIcon, label, description, shortcut, external, action }) => (
            <button
              key={label}
              className="owt-learn-link"
              onClick={action}
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
              {external && <ExternalLink size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0, opacity: 0.5 }} />}
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
  const allThemes = useThemeStore((s) => s.themes)
  const activeThemeId = useThemeStore((s) => s.activeThemeId)
  const setTheme = useThemeStore((s) => s.setTheme)
  const quickThemes = useMemo(
    () => QUICK_THEME_IDS.map((id) => allThemes.find((t) => t.id === id)).filter((t) => t !== undefined),
    [allThemes],
  )

  const [fontSize, setFontSize] = useState(readEditorFontSize)
  // Settings can change the font size while this tab is open.
  useEffect(() => {
    const onConfig = (e: Event) => {
      const size = (e as CustomEvent<{ fontSize?: unknown }>).detail?.fontSize
      if (typeof size === 'number' && Number.isFinite(size)) setFontSize(size)
    }
    window.addEventListener('orion:editor-config', onConfig)
    return () => window.removeEventListener('orion:editor-config', onConfig)
  }, [])
  const changeFontSize = (size: number) => {
    const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size))
    setFontSize(next)
    applyEditorFontSize(next)
  }

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
              {quickThemes.map((t) => {
                const theme = themePreview(t)
                const isActive = activeThemeId === theme.id
                return (
                  <div
                    key={theme.id}
                    className={`owt-theme-preview ${isActive ? 'owt-theme-active' : ''}`}
                    onClick={() => setTheme(theme.id)}
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
                title="Decrease font size"
                onClick={() => changeFontSize(fontSize - 1)}
              >
                <Minus size={12} />
              </button>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Type size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                <input
                  type="range"
                  min={FONT_SIZE_MIN}
                  max={FONT_SIZE_MAX}
                  step={1}
                  value={fontSize}
                  aria-label="Editor font size"
                  onChange={(e) => changeFontSize(Number(e.target.value))}
                  className="owt-slider-track"
                />
              </div>
              <button
                className="owt-icon-btn"
                title="Increase font size"
                onClick={() => changeFontSize(fontSize + 1)}
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
                {fontSize}px
              </span>
            </div>
          </div>

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
          { icon: BookOpen, label: 'Documentation', url: PROJECT_LINKS.readme },
          { icon: ExternalLink, label: 'GitHub', url: PROJECT_LINKS.repository },
        ].map(({ icon: FIcon, label, url }, i, arr) => (
          <span key={label} style={{ display: 'contents' }}>
            <button
              className="owt-footer-link"
              onClick={openExternal(url)}
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

      {/* Version */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: 8,
      }}>
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
          </div>
        </div>

        {/* ===== FOOTER ===== */}
        <FooterSection />
      </div>
    </div>
  )
}
