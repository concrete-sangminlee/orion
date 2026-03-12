import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  FolderOpen, File, GitBranch, Palette, Keyboard, Book, Zap, Star, Plus, Clock,
  ArrowRight, ExternalLink, Settings, Terminal, Code, Sparkles, Search,
  ChevronRight, ChevronDown, Lightbulb, Check, RefreshCw, FileText, FilePlus,
  FileCode, Braces, Image, Database, FileJson, Monitor, Sun, Moon, Layout,
  Play, Box, Globe, Cpu, Layers, MessageCircle, BookOpen, Download, X, Coffee,
  Flame, Rocket, Shield, Eye, Command, Hash, Wand2, Brain, Bot,
} from 'lucide-react'

// ─── Types ─────────────────────────────────────────────────────────────────

interface RecentProject {
  name: string
  path: string
  lastOpened: number
  framework?: string
}

interface WelcomePageProps {
  onOpenFile?: () => void
  onOpenFolder?: () => void
  onCloneRepo?: () => void
  onNewFile?: () => void
  onOpenProject?: (project: RecentProject) => void
  onOpenSettings?: () => void
  onOpenTerminal?: () => void
  onOpenPalette?: () => void
  onOpenChat?: () => void
  onOpenKeyboardShortcuts?: () => void
  recentProjects?: RecentProject[]
}

// ─── Constants ─────────────────────────────────────────────────────────────

const VERSION = '1.3.0'

const SHOW_WELCOME_KEY = 'orion-show-welcome-page'
const WELCOME_TIPS_KEY = 'orion-welcome-tip-idx'

const TIPS = [
  { shortcut: 'Ctrl+P', text: 'Quickly open any file by typing part of its name in Quick Open.' },
  { shortcut: 'Ctrl+Shift+P', text: 'Access every command in Orion through the Command Palette.' },
  { shortcut: 'Ctrl+K', text: 'Use inline AI editing to transform, refactor, or generate code in place.' },
  { shortcut: 'Ctrl+D', text: 'Select the next occurrence of the current word for multi-cursor editing.' },
  { shortcut: 'Ctrl+\\', text: 'Split your editor to view two files side by side.' },
  { shortcut: 'Ctrl+`', text: 'Toggle the integrated terminal without leaving the editor.' },
  { shortcut: 'Ctrl+Shift+F', text: 'Search across all files in your workspace instantly.' },
  { shortcut: 'Alt+Up/Down', text: 'Move the current line up or down for quick code rearranging.' },
  { shortcut: 'Ctrl+L', text: 'Open the AI chat panel for extended conversations about your code.' },
  { shortcut: 'F2', text: 'Rename a symbol across your entire project with a single keystroke.' },
  { shortcut: 'Ctrl+G', text: 'Jump to a specific line number in the current file.' },
  { shortcut: 'Alt+Click', text: 'Place multiple cursors anywhere for parallel editing.' },
  { shortcut: 'Ctrl+Shift+K', text: 'Delete an entire line without selecting it first.' },
  { shortcut: 'Ctrl+/', text: 'Toggle line comments on the current selection.' },
  { shortcut: 'Ctrl+Shift+[', text: 'Fold the current code region for a cleaner view.' },
]

const WHATS_NEW = [
  { icon: Brain, title: 'AI Code Lens', desc: 'Contextual AI actions appear above functions and classes automatically.' },
  { icon: Zap, title: 'Split Editor', desc: 'View and edit multiple files side by side with Ctrl+\\.' },
  { icon: Sparkles, title: 'AI Inline Edits', desc: 'Press Ctrl+K to transform code with natural language instructions.' },
  { icon: Terminal, title: 'Terminal Themes', desc: 'Choose from multiple terminal color schemes in settings.' },
  { icon: Palette, title: 'Theme Editor', desc: 'Create and customize your own color themes visually.' },
  { icon: Shield, title: 'Workspace Trust', desc: 'Control which folders can execute code and access resources.' },
]

const GETTING_STARTED = [
  { id: 'theme', icon: Palette, label: 'Choose a color theme', desc: 'Personalize the look and feel of your editor' },
  { id: 'ai', icon: Sparkles, label: 'Configure AI provider', desc: 'Set up AI-powered code assistance and completions' },
  { id: 'shortcuts', icon: Keyboard, label: 'Learn keyboard shortcuts', desc: 'Master keybindings to boost your productivity' },
  { id: 'terminal', icon: Terminal, label: 'Explore the terminal', desc: 'Use the integrated terminal for your workflow' },
  { id: 'extensions', icon: Box, label: 'Browse extensions', desc: 'Enhance Orion with community-built extensions' },
  { id: 'git', icon: GitBranch, label: 'Set up version control', desc: 'Connect to GitHub, GitLab, or other providers' },
]

const PROJECT_TEMPLATES = [
  { id: 'react', name: 'React', desc: 'React + TypeScript with Vite', icon: Globe, color: '#61DAFB', tag: 'Frontend' },
  { id: 'next', name: 'Next.js', desc: 'Full-stack React framework', icon: Layers, color: '#fff', tag: 'Full-stack' },
  { id: 'node', name: 'Node.js', desc: 'Express API server', icon: Cpu, color: '#68A063', tag: 'Backend' },
  { id: 'python', name: 'Python', desc: 'FastAPI or Flask project', icon: Code, color: '#3572A5', tag: 'Backend' },
  { id: 'rust', name: 'Rust', desc: 'Cargo binary or library', icon: Flame, color: '#DEA584', tag: 'Systems' },
  { id: 'electron', name: 'Electron', desc: 'Desktop app with web tech', icon: Monitor, color: '#9FEAF9', tag: 'Desktop' },
]

const AI_FEATURES = [
  { icon: Bot, title: 'AI Chat', desc: 'Have extended conversations about your code, architecture, and debugging.', shortcut: 'Ctrl+L' },
  { icon: Wand2, title: 'Inline Edits', desc: 'Select code and describe what you want changed. AI rewrites it in place.', shortcut: 'Ctrl+K' },
  { icon: Eye, title: 'Code Lens', desc: 'Contextual AI suggestions appear as clickable hints above functions.', shortcut: '' },
  { icon: Sparkles, title: 'Ghost Text', desc: 'Intelligent autocomplete suggestions that appear as you type.', shortcut: 'Tab' },
]

const THEME_PRESETS = [
  { id: 'dark', name: 'Dark Modern', colors: ['#1e1e2e', '#313244', '#6366f1', '#a5b4fc'] },
  { id: 'light', name: 'Light Breeze', colors: ['#fafafa', '#e4e4e7', '#4f46e5', '#818cf8'] },
  { id: 'midnight', name: 'Midnight Blue', colors: ['#0f172a', '#1e293b', '#3b82f6', '#93c5fd'] },
  { id: 'forest', name: 'Forest Green', colors: ['#0c1a0c', '#1a2e1a', '#22c55e', '#86efac'] },
  { id: 'sunset', name: 'Warm Sunset', colors: ['#1c1017', '#2d1a24', '#f43f5e', '#fda4af'] },
]

const FRAMEWORK_ICONS: Record<string, { icon: typeof FileText; color: string }> = {
  react: { icon: Globe, color: '#61DAFB' },
  vue: { icon: Globe, color: '#41B883' },
  angular: { icon: Globe, color: '#DD0031' },
  node: { icon: Cpu, color: '#68A063' },
  python: { icon: Code, color: '#3572A5' },
  rust: { icon: Flame, color: '#DEA584' },
  next: { icon: Layers, color: '#fff' },
  electron: { icon: Monitor, color: '#9FEAF9' },
}

// ─── Style injection ───────────────────────────────────────────────────────

const STYLE_ID = 'orion-welcome-page-styles'

function injectWelcomePageStyles() {
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = `
    @keyframes wpFadeInUp {
      from { opacity: 0; transform: translateY(18px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes wpPulseGlow {
      0%, 100% { box-shadow: 0 0 24px rgba(99,102,241,0.12); }
      50%      { box-shadow: 0 0 40px rgba(99,102,241,0.28); }
    }
    @keyframes wpShimmer {
      0%   { background-position: -200% center; }
      100% { background-position: 200% center; }
    }
    @keyframes wpFloat {
      0%, 100% { transform: translateY(0); }
      50%      { transform: translateY(-6px); }
    }
    @keyframes wpSpin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    @keyframes wpSlideIn {
      from { opacity: 0; transform: translateX(-12px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    .wp-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
    }
    .wp-card:hover {
      border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
      box-shadow: 0 4px 24px rgba(0,0,0,0.1);
      transform: translateY(-1px);
    }
    .wp-action-btn {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px; background: transparent; border: none;
      border-radius: 8px; color: var(--text-primary); cursor: pointer;
      font-size: 13px; text-align: left; transition: all 0.15s; width: 100%;
    }
    .wp-action-btn:hover {
      background: var(--bg-hover); transform: translateX(3px);
    }
    .wp-action-btn:active { transform: translateX(0); }
    .wp-project-card {
      display: flex; flex-direction: column; gap: 8px;
      padding: 16px; background: var(--bg-secondary);
      border: 1px solid var(--border); border-radius: 10px;
      cursor: pointer; transition: all 0.2s; text-align: left;
      border: none; width: 100%;
    }
    .wp-project-card:hover {
      background: var(--bg-hover);
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      transform: translateY(-2px);
    }
    .wp-template-card {
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      padding: 18px 12px; background: var(--bg-secondary);
      border: 1px solid var(--border); border-radius: 10px;
      cursor: pointer; transition: all 0.2s; text-align: center; border: none;
    }
    .wp-template-card:hover {
      background: var(--bg-hover); transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    }
    .wp-theme-swatch {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 12px; border-radius: 10px; cursor: pointer;
      transition: all 0.2s; border: 2px solid transparent;
      background: transparent;
    }
    .wp-theme-swatch:hover {
      border-color: var(--accent);
      background: var(--bg-hover);
    }
    .wp-ai-card {
      display: flex; align-items: flex-start; gap: 14px;
      padding: 16px; background: var(--bg-secondary);
      border: 1px solid var(--border); border-radius: 10px;
      transition: all 0.2s; cursor: default;
    }
    .wp-ai-card:hover {
      border-color: color-mix(in srgb, var(--accent-purple) 40%, var(--border));
      box-shadow: 0 2px 16px rgba(99,102,241,0.08);
    }
    .wp-search-input {
      width: 100%; padding: 10px 14px 10px 38px;
      background: var(--bg-secondary); border: 1px solid var(--border);
      border-radius: 10px; color: var(--text-primary);
      font-size: 13px; outline: none; transition: all 0.2s;
      font-family: var(--font-sans);
    }
    .wp-search-input::placeholder { color: var(--text-muted); }
    .wp-search-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
    }
    .wp-search-result {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 12px; border-radius: 6px; cursor: pointer;
      transition: background 0.12s; font-size: 12px;
      color: var(--text-primary); background: none; border: none;
      width: 100%; text-align: left;
    }
    .wp-search-result:hover { background: var(--bg-hover); }
    .wp-link-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 12px; border-radius: 6px; cursor: pointer;
      font-size: 12px; color: var(--text-muted); background: none;
      border: none; transition: all 0.15s; text-decoration: none;
    }
    .wp-link-btn:hover {
      color: var(--text-primary); background: var(--bg-hover);
    }
    .wp-checklist-item {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 10px 12px; border-radius: 8px; cursor: pointer;
      transition: background 0.12s;
    }
    .wp-checklist-item:hover { background: var(--bg-hover); }
    .wp-whats-new-item {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 14px 16px; transition: background 0.12s;
    }
    .wp-whats-new-item:hover { background: var(--bg-hover); }
    .wp-tip-btn:hover {
      border-color: var(--text-muted) !important;
      color: var(--text-primary) !important;
      background: var(--bg-hover) !important;
    }
    .wp-scroll::-webkit-scrollbar { width: 6px; }
    .wp-scroll::-webkit-scrollbar-track { background: transparent; }
    .wp-scroll::-webkit-scrollbar-thumb {
      background: var(--border); border-radius: 3px;
    }
    .wp-scroll::-webkit-scrollbar-thumb:hover {
      background: var(--text-muted);
    }
    @media (max-width: 900px) {
      .wp-main-grid { grid-template-columns: 1fr !important; }
      .wp-template-grid { grid-template-columns: repeat(2, 1fr) !important; }
      .wp-ai-grid { grid-template-columns: 1fr !important; }
    }
    @media (max-width: 600px) {
      .wp-template-grid { grid-template-columns: 1fr !important; }
      .wp-project-grid { grid-template-columns: 1fr !important; }
      .wp-hero-title { font-size: 32px !important; }
    }
  `
  document.head.appendChild(el)
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function shortenPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  if (parts.length <= 3) return parts.join('/')
  return `.../${parts.slice(-2).join('/')}`
}

function getProjectIcon(framework?: string) {
  if (framework && FRAMEWORK_ICONS[framework]) return FRAMEWORK_ICONS[framework]
  return { icon: FolderOpen, color: 'var(--accent)' }
}

// ─── Searchable items ──────────────────────────────────────────────────────

interface SearchableItem {
  id: string
  label: string
  category: string
  icon: typeof FileText
  action: string
}

function buildSearchItems(): SearchableItem[] {
  return [
    { id: 's-new-file', label: 'New File', category: 'Actions', icon: FilePlus, action: 'newFile' },
    { id: 's-open-file', label: 'Open File', category: 'Actions', icon: FileText, action: 'openFile' },
    { id: 's-open-folder', label: 'Open Folder', category: 'Actions', icon: FolderOpen, action: 'openFolder' },
    { id: 's-clone-repo', label: 'Clone Git Repository', category: 'Actions', icon: GitBranch, action: 'cloneRepo' },
    { id: 's-settings', label: 'Open Settings', category: 'Settings', icon: Settings, action: 'settings' },
    { id: 's-keyboard', label: 'Keyboard Shortcuts', category: 'Settings', icon: Keyboard, action: 'keyboard' },
    { id: 's-theme', label: 'Change Color Theme', category: 'Settings', icon: Palette, action: 'settings' },
    { id: 's-terminal', label: 'Open Terminal', category: 'Tools', icon: Terminal, action: 'terminal' },
    { id: 's-palette', label: 'Command Palette', category: 'Tools', icon: Command, action: 'palette' },
    { id: 's-ai-chat', label: 'AI Chat', category: 'AI', icon: Bot, action: 'chat' },
    { id: 's-docs', label: 'Documentation', category: 'Help', icon: BookOpen, action: 'docs' },
    { id: 's-extensions', label: 'Browse Extensions', category: 'Tools', icon: Box, action: 'extensions' },
  ]
}

// ─── Inline Orion Logo SVG ─────────────────────────────────────────────────

function OrionLogo({ size = 72 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      style={{ filter: 'drop-shadow(0 0 24px rgba(99,102,241,0.4))' }}
    >
      <defs>
        <linearGradient id="wpBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4F46E5" />
          <stop offset="50%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
        <linearGradient id="wpOGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#C7D2FE" />
          <stop offset="100%" stopColor="#E0E7FF" />
        </linearGradient>
        <linearGradient id="wpStarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="100%" stopColor="#FCD34D" />
        </linearGradient>
        <filter id="wpGlow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="96" ry="96" fill="url(#wpBgGrad)" />
      <circle cx="256" cy="270" r="140" fill="none" stroke="url(#wpOGrad)" strokeWidth="36" strokeLinecap="round" opacity="0.95" />
      <circle cx="256" cy="270" r="140" fill="none" stroke="url(#wpBgGrad)" strokeWidth="40" strokeDasharray="60 820" strokeDashoffset="-40" transform="rotate(-45 256 270)" />
      <circle cx="348" cy="178" r="12" fill="url(#wpStarGrad)" filter="url(#wpGlow)" />
      <circle cx="164" cy="362" r="9" fill="url(#wpStarGrad)" filter="url(#wpGlow)" />
      <circle cx="178" cy="192" r="7" fill="url(#wpStarGrad)" filter="url(#wpGlow)" opacity="0.9" />
      <circle cx="340" cy="352" r="7" fill="url(#wpStarGrad)" filter="url(#wpGlow)" opacity="0.9" />
      <circle cx="222" cy="270" r="5" fill="#FDE68A" filter="url(#wpGlow)" opacity="0.85" />
      <circle cx="256" cy="262" r="6" fill="#FDE68A" filter="url(#wpGlow)" opacity="0.95" />
      <circle cx="290" cy="270" r="5" fill="#FDE68A" filter="url(#wpGlow)" opacity="0.85" />
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
    </svg>
  )
}

// ─── Section Header ────────────────────────────────────────────────────────

function SectionTitle({ children, icon: Icon, badge }: {
  children: React.ReactNode
  icon?: typeof FileText
  badge?: string
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 13, fontWeight: 700, color: 'var(--text-primary)',
      marginBottom: 14, letterSpacing: '-0.2px',
    }}>
      {Icon && (
        <div style={{
          width: 24, height: 24, borderRadius: 6,
          background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={13} style={{ color: 'var(--accent)' }} />
        </div>
      )}
      <span>{children}</span>
      {badge && (
        <span style={{
          fontSize: 9, fontWeight: 700, color: 'var(--accent)',
          background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
          padding: '1px 7px', borderRadius: 10, lineHeight: '16px',
        }}>
          {badge}
        </span>
      )}
    </div>
  )
}

// ─── Collapsible Section ───────────────────────────────────────────────────

function CollapsibleSection({ title, icon, expanded, onToggle, badge, children }: {
  title: string
  icon?: typeof FileText
  expanded: boolean
  onToggle: () => void
  badge?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, fontWeight: 700, color: 'var(--text-primary)',
          marginBottom: expanded ? 14 : 6, letterSpacing: '-0.2px',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          transition: 'color 0.15s', width: '100%', textAlign: 'left',
        }}
      >
        {expanded
          ? <ChevronDown size={14} style={{ color: 'var(--text-muted)', transition: 'transform 0.2s' }} />
          : <ChevronRight size={14} style={{ color: 'var(--text-muted)', transition: 'transform 0.2s' }} />
        }
        {icon && (
          <div style={{
            width: 24, height: 24, borderRadius: 6,
            background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {React.createElement(icon, { size: 13, style: { color: 'var(--accent)' } })}
          </div>
        )}
        <span style={{ flex: 1 }}>{title}</span>
        {badge && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: 'var(--accent)',
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
            padding: '1px 7px', borderRadius: 10, lineHeight: '16px',
          }}>
            {badge}
          </span>
        )}
      </button>
      {expanded && children}
    </section>
  )
}

// ─── Kbd Component ─────────────────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      fontSize: 10, fontWeight: 500, color: 'var(--text-muted)',
      fontFamily: 'var(--font-mono, monospace)',
      background: 'var(--bg-secondary)', padding: '2px 7px',
      borderRadius: 4, border: '1px solid var(--border)',
      lineHeight: '18px', whiteSpace: 'nowrap',
    }}>
      {children}
    </kbd>
  )
}

// ─── Icon Badge ────────────────────────────────────────────────────────────

function IconBadge({ icon: Icon, color, size = 32 }: {
  icon: typeof FileText; color: string; size?: number
}) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.25,
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Icon size={size * 0.5} style={{ color }} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function WelcomePage({
  onOpenFile,
  onOpenFolder,
  onCloneRepo,
  onNewFile,
  onOpenProject,
  onOpenSettings,
  onOpenTerminal,
  onOpenPalette,
  onOpenChat,
  onOpenKeyboardShortcuts,
  recentProjects = [],
}: WelcomePageProps) {
  // ─── State ─────────────────────────────────────────────────────────────

  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * TIPS.length))
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [showOnStartup, setShowOnStartup] = useState(() => {
    try { return localStorage.getItem(SHOW_WELCOME_KEY) !== 'false' } catch { return true }
  })
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    quickActions: true,
    recentProjects: true,
    gettingStarted: true,
    whatsNew: false,
    templates: true,
    aiFeatures: true,
    customize: false,
    learn: false,
  })
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('orion-welcome-steps') || '{}') } catch { return {} }
  })
  const [selectedTheme, setSelectedTheme] = useState('dark')
  const searchRef = useRef<HTMLInputElement>(null)
  const searchItems = useMemo(buildSearchItems, [])

  // ─── Effects ───────────────────────────────────────────────────────────

  useEffect(() => { injectWelcomePageStyles() }, [])

  useEffect(() => {
    localStorage.setItem(SHOW_WELCOME_KEY, String(showOnStartup))
  }, [showOnStartup])

  useEffect(() => {
    localStorage.setItem('orion-welcome-steps', JSON.stringify(checkedSteps))
  }, [checkedSteps])

  // Auto-rotate tips
  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex(prev => (prev + 1) % TIPS.length)
    }, 15000)
    return () => clearInterval(interval)
  }, [])

  // ─── Callbacks ─────────────────────────────────────────────────────────

  const nextTip = useCallback(() => {
    setTipIndex(prev => (prev + 1) % TIPS.length)
  }, [])

  const toggleSection = useCallback((key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const toggleStep = useCallback((id: string) => {
    setCheckedSteps(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const handleSearchAction = useCallback((action: string) => {
    const actions: Record<string, (() => void) | undefined> = {
      newFile: onNewFile,
      openFile: onOpenFile,
      openFolder: onOpenFolder,
      cloneRepo: onCloneRepo,
      settings: onOpenSettings,
      keyboard: onOpenKeyboardShortcuts,
      terminal: onOpenTerminal,
      palette: onOpenPalette,
      chat: onOpenChat,
      docs: () => window.open('#', '_blank'),
      extensions: () => window.dispatchEvent(new Event('orion:open-extensions')),
    }
    actions[action]?.()
    setSearchQuery('')
  }, [onNewFile, onOpenFile, onOpenFolder, onCloneRepo, onOpenSettings, onOpenKeyboardShortcuts, onOpenTerminal, onOpenPalette, onOpenChat])

  // ─── Derived ───────────────────────────────────────────────────────────

  const filteredSearchItems = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    return searchItems.filter(item =>
      item.label.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [searchQuery, searchItems])

  const completedSteps = GETTING_STARTED.filter(g => checkedSteps[g.id]).length
  const completionPct = (completedSteps / GETTING_STARTED.length) * 100

  const quickActions = useMemo(() => [
    { id: 'new-file', icon: FilePlus, label: 'New File', shortcut: 'Ctrl+N', onClick: onNewFile },
    { id: 'open-file', icon: FileText, label: 'Open File', shortcut: 'Ctrl+O', onClick: onOpenFile },
    { id: 'open-folder', icon: FolderOpen, label: 'Open Folder', shortcut: '', onClick: onOpenFolder },
    { id: 'clone-repo', icon: GitBranch, label: 'Clone Git Repository', shortcut: '', onClick: onCloneRepo },
  ], [onNewFile, onOpenFile, onOpenFolder, onCloneRepo])

  const sortedProjects = useMemo(() =>
    [...recentProjects].sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 8),
    [recentProjects]
  )

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div
      className="wp-scroll"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)',
        overflow: 'auto',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      {/* Ambient gradient overlay */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 400,
        background: 'radial-gradient(ellipse 70% 40% at 50% 0%, color-mix(in srgb, var(--accent-purple) 7%, transparent), transparent)',
        pointerEvents: 'none', zIndex: 0,
      }} />
      <div style={{
        position: 'absolute', top: 100, right: 0, width: 500, height: 500,
        background: 'radial-gradient(ellipse at 100% 0%, color-mix(in srgb, var(--accent) 4%, transparent), transparent)',
        pointerEvents: 'none', zIndex: 0,
      }} />

      {/* Main scroll area */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '36px 40px 32px',
        minHeight: 0, position: 'relative', zIndex: 1,
      }}>

        {/* ═══ HERO SECTION ═══ */}
        <div style={{
          textAlign: 'center', marginBottom: 36,
          animation: 'wpFadeInUp 0.5s ease both',
        }}>
          <div style={{
            marginBottom: 14, display: 'inline-block',
            animation: 'wpPulseGlow 4s ease-in-out infinite, wpFloat 6s ease-in-out infinite',
            borderRadius: 24,
          }}>
            <OrionLogo size={76} />
          </div>

          <div className="wp-hero-title" style={{
            fontSize: 46, fontWeight: 800, letterSpacing: '-2.5px',
            background: 'linear-gradient(135deg, #818CF8 0%, #6366F1 20%, #A78BFA 45%, #34D399 70%, #6EE7B7 100%)',
            backgroundSize: '200% auto',
            animation: 'wpShimmer 6s linear infinite',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            lineHeight: 1.1, marginBottom: 8,
          }}>
            Orion IDE
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <span style={{
              fontSize: 14, color: 'var(--text-secondary)',
              fontWeight: 400, letterSpacing: '0.3px',
            }}>
              AI-Powered Code Editor for the Modern Developer
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, color: 'var(--accent)',
              background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
              padding: '2px 9px', borderRadius: 10, letterSpacing: '0.5px',
            }}>
              v{VERSION}
            </span>
          </div>
        </div>

        {/* ═══ SEARCH BAR ═══ */}
        <div style={{
          position: 'relative', maxWidth: 560, width: '100%',
          marginBottom: 36,
          animation: 'wpFadeInUp 0.5s ease 0.05s both',
        }}>
          <Search size={15} style={{
            position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
            color: searchFocused ? 'var(--accent)' : 'var(--text-muted)',
            transition: 'color 0.2s', pointerEvents: 'none', zIndex: 2,
          }} />
          <input
            ref={searchRef}
            className="wp-search-input"
            placeholder="Search commands, settings, and more..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                setSearchQuery('')
                searchRef.current?.blur()
              }
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', padding: 4, borderRadius: 4,
                display: 'flex', alignItems: 'center',
              }}
            >
              <X size={14} />
            </button>
          )}

          {/* Search Results Dropdown */}
          {searchFocused && filteredSearchItems.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0,
              marginTop: 4, background: 'var(--bg-secondary)',
              border: '1px solid var(--border)', borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
              overflow: 'hidden', zIndex: 100,
              animation: 'wpFadeInUp 0.15s ease both',
            }}>
              {filteredSearchItems.map(item => (
                <button
                  key={item.id}
                  className="wp-search-result"
                  onMouseDown={() => handleSearchAction(item.action)}
                >
                  <IconBadge icon={item.icon} color="var(--accent)" size={24} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  <span style={{
                    fontSize: 10, color: 'var(--text-muted)',
                    background: 'var(--bg-primary)', padding: '1px 6px',
                    borderRadius: 4,
                  }}>
                    {item.category}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ═══ MAIN GRID LAYOUT ═══ */}
        <div
          className="wp-main-grid"
          style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: 36, maxWidth: 1060, width: '100%',
            animation: 'wpFadeInUp 0.5s ease 0.1s both',
          }}
        >

          {/* ═══ LEFT COLUMN ═══ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

            {/* --- Quick Actions --- */}
            <CollapsibleSection
              title="Quick Actions"
              icon={Zap}
              expanded={expandedSections.quickActions}
              onToggle={() => toggleSection('quickActions')}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {quickActions.map(({ id, icon: Icon, label, shortcut, onClick }) => (
                  <button key={id} className="wp-action-btn" onClick={() => onClick?.()}>
                    <IconBadge icon={Icon} color="var(--accent)" size={30} />
                    <span style={{ flex: 1, fontWeight: 400 }}>{label}</span>
                    {shortcut && <Kbd>{shortcut}</Kbd>}
                    <ArrowRight size={13} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                  </button>
                ))}
              </div>
            </CollapsibleSection>

            {/* --- Recent Projects --- */}
            <CollapsibleSection
              title="Recent Projects"
              icon={Clock}
              expanded={expandedSections.recentProjects}
              onToggle={() => toggleSection('recentProjects')}
              badge={sortedProjects.length > 0 ? String(sortedProjects.length) : undefined}
            >
              {sortedProjects.length === 0 ? (
                <div style={{
                  fontSize: 12, color: 'var(--text-muted)', padding: 20,
                  textAlign: 'center', background: 'var(--bg-secondary)',
                  borderRadius: 10, border: '1px dashed var(--border)',
                  lineHeight: 1.6,
                }}>
                  <FolderOpen size={28} style={{ color: 'var(--text-muted)', opacity: 0.3, marginBottom: 8 }} />
                  <br />
                  No recent projects yet.
                  <br />
                  <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => onOpenFolder?.()}>
                    Open a folder
                  </span>
                  {' '}to get started.
                </div>
              ) : (
                <div
                  className="wp-project-grid"
                  style={{
                    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 8,
                  }}
                >
                  {sortedProjects.map(project => {
                    const { icon: PIcon, color } = getProjectIcon(project.framework)
                    return (
                      <button
                        key={project.path}
                        className="wp-project-card"
                        onClick={() => onOpenProject?.(project)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <IconBadge icon={PIcon} color={color} size={32} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                              {project.name}
                            </div>
                            <div style={{
                              fontSize: 10, color: 'var(--text-muted)', marginTop: 2,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                              {shortenPath(project.path)}
                            </div>
                          </div>
                        </div>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          fontSize: 10, color: 'var(--text-muted)',
                        }}>
                          <Clock size={10} />
                          {timeAgo(project.lastOpened)}
                          {project.framework && (
                            <span style={{
                              marginLeft: 'auto', fontSize: 9, fontWeight: 600,
                              color: color, background: `color-mix(in srgb, ${color} 10%, transparent)`,
                              padding: '1px 6px', borderRadius: 6,
                            }}>
                              {project.framework}
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </CollapsibleSection>

            {/* --- Tips & Tricks --- */}
            <section style={{ animation: 'wpSlideIn 0.4s ease 0.2s both' }}>
              <SectionTitle icon={Lightbulb}>Tips &amp; Tricks</SectionTitle>
              <div className="wp-card" style={{ position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <IconBadge icon={Lightbulb} color="var(--accent-orange, #f59e0b)" size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {TIPS[tipIndex].shortcut && (
                      <div style={{ marginBottom: 6 }}>
                        <Kbd>{TIPS[tipIndex].shortcut}</Kbd>
                      </div>
                    )}
                    <div style={{
                      fontSize: 12, color: 'var(--text-secondary)',
                      lineHeight: 1.6,
                    }}>
                      {TIPS[tipIndex].text}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {TIPS.map((_, i) => (
                      <div
                        key={i}
                        style={{
                          width: i === tipIndex ? 16 : 4, height: 4,
                          borderRadius: 2,
                          background: i === tipIndex ? 'var(--accent)' : 'var(--border)',
                          transition: 'all 0.3s',
                          cursor: 'pointer',
                        }}
                        onClick={() => setTipIndex(i)}
                      />
                    ))}
                  </div>
                  <button
                    onClick={nextTip}
                    className="wp-tip-btn"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 12px', background: 'transparent',
                      border: '1px solid var(--border)', borderRadius: 6,
                      color: 'var(--text-secondary)', cursor: 'pointer',
                      fontSize: 11, fontWeight: 500, transition: 'all 0.15s',
                    }}
                  >
                    <RefreshCw size={11} />
                    Next Tip
                  </button>
                </div>
              </div>
            </section>

            {/* --- AI Features Highlight --- */}
            <CollapsibleSection
              title="AI Features"
              icon={Sparkles}
              expanded={expandedSections.aiFeatures}
              onToggle={() => toggleSection('aiFeatures')}
            >
              <div
                className="wp-ai-grid"
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                }}
              >
                {AI_FEATURES.map(feat => (
                  <div key={feat.title} className="wp-ai-card">
                    <IconBadge icon={feat.icon} color="var(--accent-purple, #a78bfa)" size={34} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
                        marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        {feat.title}
                        {feat.shortcut && <Kbd>{feat.shortcut}</Kbd>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                        {feat.desc}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>

            {/* --- Customize --- */}
            <CollapsibleSection
              title="Customize"
              icon={Palette}
              expanded={expandedSections.customize}
              onToggle={() => toggleSection('customize')}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Theme Picker */}
                <div>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                    marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.6px',
                  }}>
                    Color Theme
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {THEME_PRESETS.map(theme => (
                      <button
                        key={theme.id}
                        className="wp-theme-swatch"
                        onClick={() => {
                          setSelectedTheme(theme.id)
                          onOpenSettings?.()
                        }}
                        style={{
                          borderColor: selectedTheme === theme.id ? 'var(--accent)' : 'transparent',
                        }}
                      >
                        <div style={{
                          display: 'flex', borderRadius: 8, overflow: 'hidden',
                          border: '1px solid var(--border)',
                        }}>
                          {theme.colors.map((c, i) => (
                            <div key={i} style={{ width: 16, height: 32, background: c }} />
                          ))}
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {theme.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quick settings links */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <button className="wp-link-btn" onClick={() => onOpenSettings?.()}>
                    <Settings size={12} /> Font Size
                  </button>
                  <button className="wp-link-btn" onClick={() => onOpenKeyboardShortcuts?.()}>
                    <Keyboard size={12} /> Key Bindings
                  </button>
                  <button className="wp-link-btn" onClick={() => onOpenSettings?.()}>
                    <Monitor size={12} /> Editor Layout
                  </button>
                  <button className="wp-link-btn" onClick={() => onOpenSettings?.()}>
                    <Code size={12} /> Font Ligatures
                  </button>
                </div>
              </div>
            </CollapsibleSection>
          </div>

          {/* ═══ RIGHT COLUMN ═══ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

            {/* --- Getting Started --- */}
            <CollapsibleSection
              title="Getting Started"
              icon={Rocket}
              expanded={expandedSections.gettingStarted}
              onToggle={() => toggleSection('gettingStarted')}
              badge={`${completedSteps}/${GETTING_STARTED.length}`}
            >
              {/* Progress bar */}
              <div style={{
                height: 5, borderRadius: 3, background: 'var(--bg-hover)',
                marginBottom: 14, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${completionPct}%`,
                  background: completedSteps === GETTING_STARTED.length
                    ? 'linear-gradient(90deg, #22c55e, #34d399)'
                    : 'linear-gradient(90deg, var(--accent-purple, #7c3aed), var(--accent, #6366f1))',
                  borderRadius: 3,
                  transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {GETTING_STARTED.map(({ id, icon: ItemIcon, label, desc }) => {
                  const done = checkedSteps[id]
                  return (
                    <div
                      key={id}
                      className="wp-checklist-item"
                      onClick={() => {
                        toggleStep(id)
                        // Trigger corresponding action
                        if (id === 'theme') onOpenSettings?.()
                        else if (id === 'ai') onOpenSettings?.()
                        else if (id === 'shortcuts') onOpenKeyboardShortcuts?.()
                        else if (id === 'terminal') onOpenTerminal?.()
                        else if (id === 'extensions') window.dispatchEvent(new Event('orion:open-extensions'))
                        else if (id === 'git') window.dispatchEvent(new Event('orion:show-git'))
                      }}
                    >
                      {/* Checkbox */}
                      <div style={{
                        width: 20, height: 20, borderRadius: 6,
                        border: done ? 'none' : '2px solid var(--text-muted)',
                        background: done ? 'linear-gradient(135deg, #22c55e, #34d399)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, marginTop: 2, transition: 'all 0.2s',
                      }}>
                        {done && <Check size={12} style={{ color: '#fff' }} />}
                      </div>
                      <IconBadge
                        icon={ItemIcon}
                        color={done ? 'var(--text-muted)' : 'var(--accent-purple, #a78bfa)'}
                        size={28}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 400,
                          color: done ? 'var(--text-muted)' : 'var(--text-primary)',
                          textDecoration: done ? 'line-through' : 'none',
                          transition: 'all 0.15s',
                        }}>
                          {label}
                        </div>
                        <div style={{
                          fontSize: 11, color: 'var(--text-muted)',
                          marginTop: 2, lineHeight: 1.35,
                        }}>
                          {desc}
                        </div>
                      </div>
                      <ChevronRight size={14} style={{
                        color: 'var(--text-muted)', flexShrink: 0, marginTop: 5,
                      }} />
                    </div>
                  )
                })}
              </div>
            </CollapsibleSection>

            {/* --- What's New --- */}
            <CollapsibleSection
              title={`What's New in v${VERSION}`}
              icon={Star}
              expanded={expandedSections.whatsNew}
              onToggle={() => toggleSection('whatsNew')}
            >
              <div className="wp-card" style={{ padding: 0, overflow: 'hidden' }}>
                {WHATS_NEW.map(({ icon: WIcon, title, desc }, i) => (
                  <div
                    key={title}
                    className="wp-whats-new-item"
                    style={{
                      borderBottom: i < WHATS_NEW.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <IconBadge icon={WIcon} color="var(--accent)" size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600,
                        color: 'var(--text-primary)', marginBottom: 2,
                      }}>
                        {title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                        {desc}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>

            {/* --- Project Templates --- */}
            <CollapsibleSection
              title="Project Templates"
              icon={Layout}
              expanded={expandedSections.templates}
              onToggle={() => toggleSection('templates')}
            >
              <div
                className="wp-template-grid"
                style={{
                  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 8,
                }}
              >
                {PROJECT_TEMPLATES.map(tmpl => (
                  <button
                    key={tmpl.id}
                    className="wp-template-card"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('orion:new-project', { detail: { template: tmpl.id } }))
                    }}
                  >
                    <div style={{
                      width: 40, height: 40, borderRadius: 10,
                      background: `color-mix(in srgb, ${tmpl.color} 12%, transparent)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <tmpl.icon size={20} style={{ color: tmpl.color }} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {tmpl.name}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      {tmpl.desc}
                    </div>
                    <span style={{
                      fontSize: 9, fontWeight: 600, color: tmpl.color,
                      background: `color-mix(in srgb, ${tmpl.color} 8%, transparent)`,
                      padding: '1px 8px', borderRadius: 8,
                    }}>
                      {tmpl.tag}
                    </span>
                  </button>
                ))}
              </div>
            </CollapsibleSection>

            {/* --- Learn --- */}
            <CollapsibleSection
              title="Learn"
              icon={BookOpen}
              expanded={expandedSections.learn}
              onToggle={() => toggleSection('learn')}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[
                  { icon: BookOpen, label: 'Documentation', desc: 'Comprehensive guides and API reference', onClick: () => window.open('#', '_blank') },
                  { icon: Keyboard, label: 'Keyboard Shortcuts', desc: 'Full reference of all keybindings', onClick: onOpenKeyboardShortcuts },
                  { icon: Play, label: 'Interactive Playground', desc: 'Try Orion features in a sandbox', onClick: () => window.dispatchEvent(new Event('orion:open-playground')) },
                  { icon: MessageCircle, label: 'Community Forum', desc: 'Connect with other Orion developers', onClick: () => window.open('#', '_blank') },
                  { icon: Code, label: 'Extension API', desc: 'Build your own Orion extensions', onClick: () => window.open('#', '_blank') },
                ].map(item => (
                  <button
                    key={item.label}
                    className="wp-action-btn"
                    onClick={() => item.onClick?.()}
                  >
                    <IconBadge icon={item.icon} color="var(--accent)" size={28} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                        {item.label}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                        {item.desc}
                      </div>
                    </div>
                    <ExternalLink size={12} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                  </button>
                ))}
              </div>
            </CollapsibleSection>
          </div>
        </div>

        {/* ═══ FOOTER ═══ */}
        <footer style={{
          marginTop: 48, paddingTop: 20,
          borderTop: '1px solid var(--border)',
          maxWidth: 1060, width: '100%',
          display: 'flex', flexDirection: 'column', gap: 16,
          animation: 'wpFadeInUp 0.5s ease 0.25s both',
        }}>
          {/* Community links row */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 4, flexWrap: 'wrap',
          }}>
            {[
              { icon: BookOpen, label: 'Docs' },
              { icon: ExternalLink, label: 'GitHub' },
              { icon: MessageCircle, label: 'Discord' },
              { icon: ExternalLink, label: 'Twitter' },
              { icon: Coffee, label: 'Sponsor' },
              { icon: Star, label: 'Changelog' },
            ].map((link, i, arr) => (
              <React.Fragment key={link.label}>
                <button
                  className="wp-link-btn"
                  onClick={() => window.open('#', '_blank')}
                >
                  <link.icon size={12} />
                  {link.label}
                </button>
                {i < arr.length - 1 && (
                  <span style={{ color: 'var(--border)', fontSize: 10 }}>|</span>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Bottom bar: startup toggle + version */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            paddingBottom: 8,
          }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8,
              cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)',
            }}>
              <div
                onClick={() => setShowOnStartup(!showOnStartup)}
                style={{
                  width: 16, height: 16, borderRadius: 4,
                  border: showOnStartup ? 'none' : '1.5px solid var(--text-muted)',
                  background: showOnStartup ? 'var(--accent)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {showOnStartup && <Check size={10} style={{ color: 'var(--bg-primary)' }} />}
              </div>
              Show Welcome Page on Startup
            </label>

            <div style={{
              fontSize: 11, color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ opacity: 0.6 }}>Built with</span>
              <span style={{
                background: 'linear-gradient(135deg, #818CF8, #A78BFA)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                fontWeight: 700, letterSpacing: '-0.3px',
              }}>
                Orion
              </span>
              <span style={{ opacity: 0.4 }}>v{VERSION}</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
