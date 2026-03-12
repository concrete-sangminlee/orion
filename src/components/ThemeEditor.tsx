import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  Palette, Eye, Code, Download, Upload, RotateCcw, Search, Check, Copy,
  Sun, Moon, Monitor, Paintbrush, Contrast, Layers, X, Save, ChevronDown,
  ChevronRight, Trash2, Plus, Clock, AlertTriangle, Undo2, Star, Grid3X3,
} from 'lucide-react'
import { useThemeStore } from '@/store/theme'

// ── Types ────────────────────────────────────────────────────────────────────

interface ThemeToken {
  key: string
  value: string
  category: string
  label: string
  description?: string
  inherited?: string
}

type EditorTab = 'visual' | 'json' | 'gallery' | 'palette'
type PreviewTab = 'code' | 'ui' | 'terminal'

interface RecentChange {
  key: string
  oldValue: string
  newValue: string
  timestamp: number
}

interface ContrastPair {
  fg: string
  bg: string
  fgLabel: string
  bgLabel: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const TOKEN_CATEGORIES: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  editor: { label: 'Editor', icon: <Code size={14} />, description: 'Code editor backgrounds and text' },
  sidebar: { label: 'Sidebar', icon: <Layers size={14} />, description: 'File explorer and sidebar areas' },
  terminal: { label: 'Terminal', icon: <Monitor size={14} />, description: 'Integrated terminal colors' },
  statusbar: { label: 'Status Bar', icon: <Grid3X3 size={14} />, description: 'Bottom status bar area' },
  accents: { label: 'Accents', icon: <Paintbrush size={14} />, description: 'Accent and highlight colors' },
  borders: { label: 'Borders', icon: <Grid3X3 size={14} />, description: 'Border and separator lines' },
  scrollbar: { label: 'Scrollbar', icon: <Layers size={14} />, description: 'Scrollbar appearance' },
  text: { label: 'Text', icon: <Code size={14} />, description: 'Text and typography colors' },
}

const TOKEN_DEFINITIONS: Omit<ThemeToken, 'value'>[] = [
  // Editor
  { key: '--bg-primary', category: 'editor', label: 'Background', description: 'Main editor background color' },
  { key: '--bg-secondary', category: 'editor', label: 'Secondary Background', description: 'Sidebar and panel backgrounds' },
  { key: '--bg-tertiary', category: 'editor', label: 'Tertiary Background', description: 'Activity bar and deep backgrounds' },
  { key: '--bg-hover', category: 'editor', label: 'Hover Background', description: 'Background on hover states' },
  { key: '--bg-active', category: 'editor', label: 'Active Background', description: 'Background for active/selected items' },
  { key: '--bg-elevated', category: 'editor', label: 'Elevated Background', description: 'Dropdown and popup backgrounds' },
  // Sidebar
  { key: '--bg-secondary', category: 'sidebar', label: 'Sidebar Background', description: 'File explorer background', inherited: '--bg-secondary' },
  { key: '--bg-hover', category: 'sidebar', label: 'Sidebar Hover', description: 'Sidebar item hover state', inherited: '--bg-hover' },
  { key: '--bg-active', category: 'sidebar', label: 'Sidebar Active', description: 'Sidebar active selection', inherited: '--bg-active' },
  // Terminal
  { key: '--bg-primary', category: 'terminal', label: 'Terminal Background', description: 'Terminal panel background', inherited: '--bg-primary' },
  { key: '--accent-green', category: 'terminal', label: 'Terminal Green', description: 'ANSI green color' },
  { key: '--accent-red', category: 'terminal', label: 'Terminal Red', description: 'ANSI red color' },
  { key: '--accent-yellow', category: 'terminal', label: 'Terminal Yellow', description: 'ANSI yellow color' },
  { key: '--accent-blue', category: 'terminal', label: 'Terminal Blue', description: 'ANSI blue color' },
  { key: '--accent-purple', category: 'terminal', label: 'Terminal Magenta', description: 'ANSI magenta color' },
  { key: '--accent-cyan', category: 'terminal', label: 'Terminal Cyan', description: 'ANSI cyan color' },
  // Status Bar
  { key: '--bg-tertiary', category: 'statusbar', label: 'Status Bar Background', description: 'Status bar background', inherited: '--bg-tertiary' },
  { key: '--text-secondary', category: 'statusbar', label: 'Status Bar Text', description: 'Status bar text color', inherited: '--text-secondary' },
  // Accents
  { key: '--accent', category: 'accents', label: 'Primary Accent', description: 'Primary accent color used for buttons, links' },
  { key: '--accent-blue', category: 'accents', label: 'Blue', description: 'Blue accent color' },
  { key: '--accent-green', category: 'accents', label: 'Green', description: 'Green accent for success states' },
  { key: '--accent-orange', category: 'accents', label: 'Orange', description: 'Orange accent for warnings' },
  { key: '--accent-red', category: 'accents', label: 'Red', description: 'Red accent for errors and deletions' },
  { key: '--accent-purple', category: 'accents', label: 'Purple', description: 'Purple accent color' },
  { key: '--accent-yellow', category: 'accents', label: 'Yellow', description: 'Yellow accent for caution states' },
  { key: '--accent-cyan', category: 'accents', label: 'Cyan', description: 'Cyan accent color' },
  // Borders
  { key: '--border', category: 'borders', label: 'Border', description: 'Default border color' },
  { key: '--border-bright', category: 'borders', label: 'Bright Border', description: 'Prominent border color' },
  { key: '--border-focus', category: 'borders', label: 'Focus Border', description: 'Border color on focus', inherited: '--accent' },
  // Scrollbar
  { key: '--scrollbar-thumb', category: 'scrollbar', label: 'Scrollbar Thumb', description: 'Scrollbar handle color' },
  { key: '--scrollbar-track', category: 'scrollbar', label: 'Scrollbar Track', description: 'Scrollbar track background' },
  // Text
  { key: '--text-primary', category: 'text', label: 'Primary Text', description: 'Main text color' },
  { key: '--text-secondary', category: 'text', label: 'Secondary Text', description: 'Less prominent text' },
  { key: '--text-muted', category: 'text', label: 'Muted Text', description: 'Subtle text, placeholders' },
]

const CONTRAST_PAIRS: ContrastPair[] = [
  { fg: '--text-primary', bg: '--bg-primary', fgLabel: 'Primary Text', bgLabel: 'Editor Background' },
  { fg: '--text-secondary', bg: '--bg-primary', fgLabel: 'Secondary Text', bgLabel: 'Editor Background' },
  { fg: '--text-muted', bg: '--bg-primary', fgLabel: 'Muted Text', bgLabel: 'Editor Background' },
  { fg: '--text-primary', bg: '--bg-secondary', fgLabel: 'Primary Text', bgLabel: 'Sidebar Background' },
  { fg: '--text-secondary', bg: '--bg-secondary', fgLabel: 'Secondary Text', bgLabel: 'Sidebar Background' },
  { fg: '--accent', bg: '--bg-primary', fgLabel: 'Accent', bgLabel: 'Editor Background' },
  { fg: '--accent-green', bg: '--bg-primary', fgLabel: 'Green', bgLabel: 'Editor Background' },
  { fg: '--accent-red', bg: '--bg-primary', fgLabel: 'Red', bgLabel: 'Editor Background' },
]

const SAMPLE_CODE = `import React, { useState } from 'react';

interface User {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

// Fetch user data from API
async function fetchUser(id: number): Promise<User> {
  const response = await fetch(\`/api/users/\${id}\`);
  if (!response.ok) {
    throw new Error('Failed to fetch user');
  }
  return response.json();
}

export default function UserCard({ userId }: { userId: number }) {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string>("");

  /* Load user on mount */
  React.useEffect(() => {
    fetchUser(userId)
      .then(setUser)
      .catch(e => setError(e.message));
  }, [userId]);

  if (error) return <div className="error">{error}</div>;
  if (!user) return <div>Loading...</div>;

  return (
    <div className="card">
      <h2>{user.name}</h2>
      <p>{user.email}</p>
      <span>{user.active ? "Active" : "Inactive"}</span>
    </div>
  );
}`

// ── Color Utilities ──────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '')
  const match = clean.match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!match) return null
  return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

/** Relative luminance per WCAG 2.0 */
function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [rs, gs, bs] = [rgb.r, rgb.g, rgb.b].map(c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/** WCAG contrast ratio between two hex colors */
function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1)
  const l2 = relativeLuminance(hex2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function wcagLevel(ratio: number): { level: string; color: string } {
  if (ratio >= 7) return { level: 'AAA', color: '#3fb950' }
  if (ratio >= 4.5) return { level: 'AA', color: '#58a6ff' }
  if (ratio >= 3) return { level: 'AA Large', color: '#e3b341' }
  return { level: 'Fail', color: '#f85149' }
}

function isValidHex(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color)
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ThemeEditor() {
  const {
    themes, activeThemeId, customThemes,
    setTheme, createCustomTheme, updateCustomTheme, deleteCustomTheme,
    exportTheme, importVSCodeTheme, activeTheme: getActiveTheme,
    setWorkbenchColorOverride, removeWorkbenchColorOverride, colorOverrides,
    clearAllColorOverrides,
  } = useThemeStore()

  const currentTheme = getActiveTheme()

  // ── State ──────────────────────────────────────────────────────────────────

  const [activeTab, setActiveTab] = useState<EditorTab>('visual')
  const [previewTab, setPreviewTab] = useState<PreviewTab>('code')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(Object.keys(TOKEN_CATEGORIES)))
  const [editingColors, setEditingColors] = useState<Record<string, string>>({})
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [recentChanges, setRecentChanges] = useState<RecentChange[]>([])
  const [showRecentChanges, setShowRecentChanges] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'dark' | 'light' | 'custom'>('all')
  const [showContrastChecker, setShowContrastChecker] = useState(false)
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [colorInputMode, setColorInputMode] = useState<Record<string, 'picker' | 'hex'>>({})
  const [selectedGalleryTheme, setSelectedGalleryTheme] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const notificationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Helpers ────────────────────────────────────────────────────────────────

  const showNotification = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    if (notificationTimeoutRef.current) clearTimeout(notificationTimeoutRef.current)
    setNotification({ message, type })
    notificationTimeoutRef.current = setTimeout(() => setNotification(null), 3000)
  }, [])

  /** Merge current theme colors with any in-progress edits */
  const effectiveColors = useMemo(() => {
    const base = { ...currentTheme.colors }
    for (const [k, v] of Object.entries(colorOverrides.workbench)) {
      base[k] = v
    }
    for (const [k, v] of Object.entries(editingColors)) {
      base[k] = v
    }
    return base
  }, [currentTheme.colors, colorOverrides.workbench, editingColors])

  /** Build tokens from definitions + current colors */
  const allTokens = useMemo<ThemeToken[]>(() => {
    return TOKEN_DEFINITIONS.map(def => ({
      ...def,
      value: effectiveColors[def.key] || '#000000',
    }))
  }, [effectiveColors])

  /** Filtered tokens based on search */
  const filteredTokens = useMemo(() => {
    if (!searchQuery.trim()) return allTokens
    const q = searchQuery.toLowerCase()
    return allTokens.filter(t =>
      t.label.toLowerCase().includes(q) ||
      t.key.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q)
    )
  }, [allTokens, searchQuery])

  /** Group tokens by category */
  const tokensByCategory = useMemo(() => {
    const groups: Record<string, ThemeToken[]> = {}
    for (const token of filteredTokens) {
      if (!groups[token.category]) groups[token.category] = []
      groups[token.category].push(token)
    }
    return groups
  }, [filteredTokens])

  /** Unique color palette from current theme */
  const colorPalette = useMemo(() => {
    const unique = new Map<string, string[]>()
    for (const [key, val] of Object.entries(effectiveColors)) {
      const hex = val.toLowerCase()
      if (!unique.has(hex)) unique.set(hex, [])
      unique.get(hex)!.push(key)
    }
    return Array.from(unique.entries()).map(([hex, keys]) => ({ hex, keys }))
      .sort((a, b) => {
        const la = relativeLuminance(a.hex)
        const lb = relativeLuminance(b.hex)
        return la - lb
      })
  }, [effectiveColors])

  /** Gallery themes filtered */
  const galleryThemes = useMemo(() => {
    if (galleryFilter === 'all') return themes
    if (galleryFilter === 'custom') return themes.filter(t => (t as any).isCustom)
    return themes.filter(t => t.type === galleryFilter)
  }, [themes, galleryFilter])

  // ── Sync JSON editor ───────────────────────────────────────────────────────

  useEffect(() => {
    if (activeTab === 'json') {
      setJsonText(JSON.stringify(effectiveColors, null, 2))
      setJsonError(null)
    }
  }, [activeTab, effectiveColors])

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleColorChange = useCallback((key: string, value: string) => {
    const oldValue = effectiveColors[key] || '#000000'
    setEditingColors(prev => ({ ...prev, [key]: value }))

    if (isValidHex(value) && value !== oldValue) {
      setWorkbenchColorOverride(key, value)
      setRecentChanges(prev => {
        const filtered = prev.filter(c => c.key !== key)
        return [{ key, oldValue, newValue: value, timestamp: Date.now() }, ...filtered].slice(0, 50)
      })
    }
  }, [effectiveColors, setWorkbenchColorOverride])

  const handleResetToken = useCallback((key: string) => {
    setEditingColors(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    removeWorkbenchColorOverride(key)
    showNotification(`Reset ${key} to default`)
  }, [removeWorkbenchColorOverride, showNotification])

  const handleResetAll = useCallback(() => {
    setEditingColors({})
    clearAllColorOverrides()
    setRecentChanges([])
    showNotification('All colors reset to theme defaults')
  }, [clearAllColorOverrides, showNotification])

  const handleJsonApply = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText)
      if (typeof parsed !== 'object' || parsed === null) {
        setJsonError('JSON must be an object with CSS variable keys and hex color values.')
        return
      }
      setJsonError(null)
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && isValidHex(value)) {
          setWorkbenchColorOverride(key, value)
        }
      }
      setEditingColors({})
      showNotification('JSON theme applied successfully')
    } catch {
      setJsonError('Invalid JSON syntax. Please check your input.')
    }
  }, [jsonText, setWorkbenchColorOverride, showNotification])

  const handleExport = useCallback(() => {
    const json = exportTheme(activeThemeId)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentTheme.name.toLowerCase().replace(/\s+/g, '-')}-theme.json`
    a.click()
    URL.revokeObjectURL(url)
    showNotification('Theme exported successfully')
  }, [exportTheme, activeThemeId, currentTheme.name, showNotification])

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const theme = importVSCodeTheme(reader.result as string)
        setTheme(theme.id)
        showNotification(`Imported "${theme.name}" successfully`)
      } catch (err) {
        showNotification(err instanceof Error ? err.message : 'Failed to import theme', 'error')
      }
    }
    reader.readAsText(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [importVSCodeTheme, setTheme, showNotification])

  const handleSaveCustomTheme = useCallback(() => {
    const name = saveName.trim()
    if (!name) return
    const overrides = { ...colorOverrides.workbench, ...editingColors }
    const validOverrides: Record<string, string> = {}
    for (const [k, v] of Object.entries(overrides)) {
      if (isValidHex(v)) validOverrides[k] = v
    }
    const newTheme = createCustomTheme(activeThemeId, name, validOverrides)
    setTheme(newTheme.id)
    setEditingColors({})
    setSaveName('')
    setShowSaveDialog(false)
    showNotification(`Custom theme "${name}" saved`)
  }, [saveName, colorOverrides.workbench, editingColors, createCustomTheme, activeThemeId, setTheme, showNotification])

  const handleDeleteTheme = useCallback((id: string) => {
    deleteCustomTheme(id)
    showNotification('Theme deleted')
  }, [deleteCustomTheme, showNotification])

  const handleCopyColor = useCallback((hex: string, key: string) => {
    navigator.clipboard.writeText(hex).then(() => {
      setCopiedToken(key)
      setTimeout(() => setCopiedToken(null), 1500)
    })
  }, [])

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])

  const handleUndoChange = useCallback((change: RecentChange) => {
    handleColorChange(change.key, change.oldValue)
    setRecentChanges(prev => prev.filter(c => c !== change))
    showNotification(`Reverted ${change.key}`)
  }, [handleColorChange, showNotification])

  // ── Styles ─────────────────────────────────────────────────────────────────

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column' as const,
      height: '100%',
      backgroundColor: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: 13,
      overflow: 'hidden',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 20px',
      borderBottom: '1px solid var(--border)',
      backgroundColor: 'var(--bg-secondary)',
      flexShrink: 0,
    },
    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    },
    headerTitle: {
      fontSize: 15,
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    },
    headerActions: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    },
    iconBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 32,
      height: 32,
      border: '1px solid var(--border)',
      borderRadius: 6,
      backgroundColor: 'transparent',
      color: 'var(--text-secondary)',
      cursor: 'pointer',
      transition: 'all 0.15s ease',
    },
    btn: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 14px',
      border: '1px solid var(--border)',
      borderRadius: 6,
      backgroundColor: 'var(--bg-elevated)',
      color: 'var(--text-primary)',
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 500,
      transition: 'all 0.15s ease',
      whiteSpace: 'nowrap' as const,
    },
    btnPrimary: {
      backgroundColor: 'var(--accent)',
      color: '#fff',
      border: '1px solid var(--accent)',
    },
    btnDanger: {
      backgroundColor: 'transparent',
      color: 'var(--accent-red)',
      border: '1px solid var(--accent-red)',
    },
    tabBar: {
      display: 'flex',
      gap: 0,
      borderBottom: '1px solid var(--border)',
      backgroundColor: 'var(--bg-secondary)',
      padding: '0 16px',
      flexShrink: 0,
    },
    tab: (active: boolean) => ({
      padding: '10px 18px',
      border: 'none',
      borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
      backgroundColor: 'transparent',
      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: active ? 600 : 400,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      transition: 'all 0.15s ease',
    }),
    body: {
      display: 'flex',
      flex: 1,
      overflow: 'hidden',
    },
    leftPanel: {
      flex: 1,
      overflow: 'auto',
      padding: 0,
      borderRight: '1px solid var(--border)',
      minWidth: 0,
    },
    rightPanel: {
      width: 420,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column' as const,
      overflow: 'hidden',
    },
    searchBar: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 16px',
      borderBottom: '1px solid var(--border)',
      backgroundColor: 'var(--bg-secondary)',
    },
    searchInput: {
      flex: 1,
      padding: '6px 10px',
      border: '1px solid var(--border)',
      borderRadius: 6,
      backgroundColor: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontSize: 12,
      outline: 'none',
    },
    categoryHeader: (expanded: boolean) => ({
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 16px',
      backgroundColor: expanded ? 'var(--bg-elevated)' : 'transparent',
      cursor: 'pointer',
      borderBottom: '1px solid var(--border)',
      userSelect: 'none' as const,
      transition: 'background-color 0.15s ease',
    }),
    categoryLabel: {
      flex: 1,
      fontWeight: 600,
      fontSize: 12,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.5px',
    },
    categoryCount: {
      fontSize: 11,
      color: 'var(--text-muted)',
      backgroundColor: 'var(--bg-active)',
      padding: '1px 7px',
      borderRadius: 10,
    },
    tokenRow: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 16px 8px 32px',
      borderBottom: '1px solid var(--border)',
      transition: 'background-color 0.1s ease',
    },
    colorSwatch: (color: string) => ({
      width: 28,
      height: 28,
      borderRadius: 6,
      backgroundColor: color,
      border: '2px solid var(--border-bright)',
      flexShrink: 0,
      cursor: 'pointer',
      transition: 'transform 0.15s ease, box-shadow 0.15s ease',
    }),
    tokenInfo: {
      flex: 1,
      minWidth: 0,
    },
    tokenLabel: {
      fontSize: 12,
      fontWeight: 500,
      color: 'var(--text-primary)',
      overflow: 'hidden' as const,
      textOverflow: 'ellipsis' as const,
      whiteSpace: 'nowrap' as const,
    },
    tokenDescription: {
      fontSize: 11,
      color: 'var(--text-muted)',
      marginTop: 1,
      overflow: 'hidden' as const,
      textOverflow: 'ellipsis' as const,
      whiteSpace: 'nowrap' as const,
    },
    tokenActions: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      flexShrink: 0,
    },
    hexInput: {
      width: 80,
      padding: '4px 8px',
      border: '1px solid var(--border)',
      borderRadius: 4,
      backgroundColor: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontSize: 11,
      fontFamily: 'monospace',
      outline: 'none',
      textAlign: 'center' as const,
    },
    colorInput: {
      width: 28,
      height: 28,
      border: 'none',
      borderRadius: 4,
      cursor: 'pointer',
      padding: 0,
      backgroundColor: 'transparent',
    },
    smallIconBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 24,
      height: 24,
      border: 'none',
      borderRadius: 4,
      backgroundColor: 'transparent',
      color: 'var(--text-muted)',
      cursor: 'pointer',
      transition: 'all 0.1s ease',
    },
    inheritBadge: {
      fontSize: 10,
      color: 'var(--accent-purple)',
      backgroundColor: 'rgba(188,140,255,0.1)',
      padding: '1px 6px',
      borderRadius: 4,
      fontFamily: 'monospace',
    },
    previewPane: {
      flex: 1,
      overflow: 'auto',
    },
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderNotification = () => {
    if (!notification) return null
    return (
      <div style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        padding: '10px 18px',
        borderRadius: 8,
        backgroundColor: notification.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
        color: '#fff',
        fontSize: 12,
        fontWeight: 500,
        zIndex: 10000,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        animation: 'slideInRight 0.2s ease',
      }}>
        {notification.type === 'success' ? <Check size={14} /> : <AlertTriangle size={14} />}
        {notification.message}
      </div>
    )
  }

  const renderTokenRow = (token: ThemeToken) => {
    const isEdited = colorOverrides.workbench[token.key] !== undefined || editingColors[token.key] !== undefined
    const mode = colorInputMode[token.key] || 'picker'
    return (
      <div
        key={`${token.category}-${token.key}`}
        style={{
          ...styles.tokenRow,
          backgroundColor: isEdited ? 'rgba(88,166,255,0.04)' : 'transparent',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = isEdited ? 'rgba(88,166,255,0.04)' : 'transparent' }}
      >
        <div style={{ position: 'relative' }}>
          <div
            style={styles.colorSwatch(token.value)}
            onClick={() => setColorInputMode(prev => ({
              ...prev,
              [token.key]: mode === 'picker' ? 'hex' : 'picker',
            }))}
            title={token.value}
          />
          {isEdited && (
            <div style={{
              position: 'absolute',
              top: -2,
              right: -2,
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: 'var(--accent-blue)',
              border: '1.5px solid var(--bg-primary)',
            }} />
          )}
        </div>
        <div style={styles.tokenInfo}>
          <div style={styles.tokenLabel}>{token.label}</div>
          <div style={styles.tokenDescription}>
            {token.description}
            {token.inherited && (
              <span style={{ ...styles.inheritBadge, marginLeft: 6 }}>
                inherits {token.inherited}
              </span>
            )}
          </div>
        </div>
        <div style={styles.tokenActions}>
          <input
            type="color"
            value={token.value}
            onChange={e => handleColorChange(token.key, e.target.value)}
            style={styles.colorInput}
            title="Pick color"
          />
          <input
            type="text"
            value={editingColors[token.key] ?? token.value}
            onChange={e => {
              const v = e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value
              setEditingColors(prev => ({ ...prev, [token.key]: v }))
              if (isValidHex(v)) handleColorChange(token.key, v)
            }}
            style={{
              ...styles.hexInput,
              borderColor: editingColors[token.key] && !isValidHex(editingColors[token.key])
                ? 'var(--accent-red)' : 'var(--border)',
            }}
            spellCheck={false}
          />
          <button
            style={styles.smallIconBtn}
            onClick={() => handleCopyColor(token.value, `${token.category}-${token.key}`)}
            title="Copy hex value"
          >
            {copiedToken === `${token.category}-${token.key}` ? <Check size={12} /> : <Copy size={12} />}
          </button>
          {isEdited && (
            <button
              style={{ ...styles.smallIconBtn, color: 'var(--accent-orange)' }}
              onClick={() => handleResetToken(token.key)}
              title="Reset to default"
            >
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      </div>
    )
  }

  const renderVisualEditor = () => (
    <div style={styles.leftPanel}>
      <div style={styles.searchBar}>
        <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          style={styles.searchInput}
          placeholder="Search tokens by name, category, or description..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          spellCheck={false}
        />
        {searchQuery && (
          <button style={styles.smallIconBtn} onClick={() => setSearchQuery('')}>
            <X size={14} />
          </button>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {filteredTokens.length} tokens
        </span>
      </div>
      <div style={{ overflow: 'auto', flex: 1 }}>
        {Object.entries(TOKEN_CATEGORIES).map(([catKey, catInfo]) => {
          const tokens = tokensByCategory[catKey]
          if (!tokens || tokens.length === 0) return null
          const isExpanded = expandedCategories.has(catKey)
          return (
            <div key={catKey}>
              <div
                style={styles.categoryHeader(isExpanded)}
                onClick={() => toggleCategory(catKey)}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span style={{ color: 'var(--text-secondary)', display: 'flex' }}>{catInfo.icon}</span>
                <span style={styles.categoryLabel}>{catInfo.label}</span>
                <span style={styles.categoryCount}>{tokens.length}</span>
              </div>
              {isExpanded && tokens.map(renderTokenRow)}
            </div>
          )
        })}
        {filteredTokens.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Search size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
            <div>No tokens match "{searchQuery}"</div>
          </div>
        )}
      </div>
    </div>
  )

  const renderJsonEditor = () => (
    <div style={{ ...styles.leftPanel, display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Edit theme colors as JSON. Keys are CSS custom properties, values are hex colors.
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={styles.btn} onClick={() => {
            setJsonText(JSON.stringify(effectiveColors, null, 2))
            setJsonError(null)
          }}>
            <RotateCcw size={12} /> Reset
          </button>
          <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={handleJsonApply}>
            <Check size={12} /> Apply
          </button>
        </div>
      </div>
      {jsonError && (
        <div style={{
          padding: '8px 16px',
          backgroundColor: 'rgba(248,81,73,0.1)',
          borderBottom: '1px solid var(--accent-red)',
          color: 'var(--accent-red)',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <AlertTriangle size={14} />
          {jsonError}
        </div>
      )}
      <textarea
        value={jsonText}
        onChange={e => {
          setJsonText(e.target.value)
          setJsonError(null)
        }}
        spellCheck={false}
        style={{
          flex: 1,
          padding: 16,
          border: 'none',
          backgroundColor: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 12,
          lineHeight: 1.6,
          resize: 'none',
          outline: 'none',
          tabSize: 2,
        }}
      />
    </div>
  )

  const renderGallery = () => (
    <div style={{ ...styles.leftPanel, display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
          Browse and activate themes
        </span>
        {(['all', 'dark', 'light', 'custom'] as const).map(f => (
          <button
            key={f}
            onClick={() => setGalleryFilter(f)}
            style={{
              ...styles.btn,
              padding: '4px 10px',
              fontSize: 11,
              ...(galleryFilter === f ? { backgroundColor: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}),
            }}
          >
            {f === 'dark' && <Moon size={11} />}
            {f === 'light' && <Sun size={11} />}
            {f === 'custom' && <Paintbrush size={11} />}
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <div style={{ overflow: 'auto', flex: 1, padding: 16 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 12,
        }}>
          {galleryThemes.map(theme => {
            const isActive = theme.id === activeThemeId
            const isSelected = theme.id === selectedGalleryTheme
            const isCustom = (theme as any).isCustom
            return (
              <div
                key={theme.id}
                onClick={() => setSelectedGalleryTheme(theme.id)}
                onDoubleClick={() => setTheme(theme.id)}
                style={{
                  border: isActive
                    ? '2px solid var(--accent)'
                    : isSelected
                      ? '2px solid var(--accent-purple)'
                      : '2px solid var(--border)',
                  borderRadius: 10,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  backgroundColor: 'var(--bg-elevated)',
                }}
              >
                {/* Color preview strip */}
                <div style={{ display: 'flex', height: 40 }}>
                  {theme.previewColors.map((c, i) => (
                    <div key={i} style={{ flex: 1, backgroundColor: c }} />
                  ))}
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 12, flex: 1 }}>{theme.name}</span>
                    {isActive && <Check size={14} style={{ color: 'var(--accent-green)' }} />}
                    {theme.type === 'dark' ? <Moon size={12} style={{ color: 'var(--text-muted)' }} /> : <Sun size={12} style={{ color: 'var(--accent-yellow)' }} />}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                    by {theme.author}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {theme.tags.slice(0, 4).map(tag => (
                      <span key={tag} style={{
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 4,
                        backgroundColor: 'var(--bg-active)',
                        color: 'var(--text-secondary)',
                      }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      style={{ ...styles.btn, flex: 1, justifyContent: 'center', fontSize: 11, padding: '4px 8px', ...(isActive ? { opacity: 0.5, cursor: 'default' } : {}) }}
                      onClick={e => { e.stopPropagation(); if (!isActive) setTheme(theme.id) }}
                    >
                      {isActive ? 'Active' : 'Apply'}
                    </button>
                    {isCustom && (
                      <button
                        style={{ ...styles.btn, ...styles.btnDanger, fontSize: 11, padding: '4px 8px' }}
                        onClick={e => { e.stopPropagation(); handleDeleteTheme(theme.id) }}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {galleryThemes.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            No themes found for this filter.
          </div>
        )}
      </div>
    </div>
  )

  const renderPalette = () => (
    <div style={{ ...styles.leftPanel, display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Color palette ({colorPalette.length} unique colors)
        </span>
        <button
          style={styles.btn}
          onClick={() => setShowContrastChecker(!showContrastChecker)}
        >
          <Contrast size={12} />
          {showContrastChecker ? 'Hide' : 'Show'} Contrast Checker
        </button>
      </div>
      <div style={{ overflow: 'auto', flex: 1, padding: 16 }}>
        {/* Palette grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 8,
          marginBottom: showContrastChecker ? 24 : 0,
        }}>
          {colorPalette.map(({ hex, keys }) => {
            const hsl = hexToHsl(hex)
            return (
              <div
                key={hex}
                style={{
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'transform 0.15s ease',
                }}
                onClick={() => handleCopyColor(hex, hex)}
              >
                <div style={{ height: 48, backgroundColor: hex }} />
                <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-elevated)' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600, marginBottom: 2 }}>
                    {copiedToken === hex ? (
                      <span style={{ color: 'var(--accent-green)' }}>Copied!</span>
                    ) : hex}
                  </div>
                  {hsl && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      H:{hsl.h} S:{hsl.s}% L:{hsl.l}%
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    {keys.length} token{keys.length !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Contrast checker */}
        {showContrastChecker && (
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Contrast size={16} /> WCAG Contrast Ratios
            </h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: 6,
            }}>
              {CONTRAST_PAIRS.map((pair, i) => {
                const fgHex = effectiveColors[pair.fg] || '#ffffff'
                const bgHex = effectiveColors[pair.bg] || '#000000'
                const ratio = contrastRatio(fgHex, bgHex)
                const level = wcagLevel(ratio)
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--bg-elevated)',
                    }}
                  >
                    {/* Visual sample */}
                    <div style={{
                      width: 64,
                      height: 32,
                      borderRadius: 6,
                      backgroundColor: bgHex,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      color: fgHex,
                      border: '1px solid var(--border)',
                      flexShrink: 0,
                    }}>
                      Aa
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>
                        {pair.fgLabel} <span style={{ color: 'var(--text-muted)' }}>on</span> {pair.bgLabel}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {fgHex} / {bgHex}
                      </div>
                    </div>
                    <div style={{
                      textAlign: 'right',
                      flexShrink: 0,
                    }}>
                      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace' }}>
                        {ratio.toFixed(2)}
                      </div>
                      <div style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: level.color,
                        letterSpacing: '0.5px',
                      }}>
                        {level.level}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  // ── Preview Panes ──────────────────────────────────────────────────────────

  const renderCodePreview = () => {
    const bg = effectiveColors['--bg-primary'] || '#0d1117'
    const fg = effectiveColors['--text-primary'] || '#e6edf3'
    const muted = effectiveColors['--text-muted'] || '#484f58'
    const blue = effectiveColors['--accent-blue'] || '#58a6ff'
    const green = effectiveColors['--accent-green'] || '#3fb950'
    const purple = effectiveColors['--accent-purple'] || '#bc8cff'
    const orange = effectiveColors['--accent-orange'] || '#f78166'
    const cyan = effectiveColors['--accent-cyan'] || '#76e3ea'
    const yellow = effectiveColors['--accent-yellow'] || '#e3b341'
    const red = effectiveColors['--accent-red'] || '#f85149'

    /** Simple syntax highlighter for the preview */
    const highlightLine = (line: string, lineNum: number) => {
      const spans: React.ReactNode[] = []
      let remaining = line
      let keyIdx = 0

      const push = (text: string, color: string) => {
        spans.push(<span key={keyIdx++} style={{ color }}>{text}</span>)
      }

      // Very simplified highlighting
      if (remaining.trimStart().startsWith('//') || remaining.trimStart().startsWith('/*') || remaining.trimStart().startsWith('*')) {
        push(remaining, muted)
      } else {
        // Tokenize crudely
        const keywords = /\b(import|from|export|default|function|const|let|var|if|else|return|await|async|throw|new|interface|type|extends|typeof|null)\b/g
        const strings = /(["'`])(?:(?!\1|\\).|\\.)*?\1/g
        const types = /\b(React|User|Promise|Error|string|number|boolean|void)\b/g
        const funcs = /\b(useState|useEffect|fetch|then|catch|setUser|setError|fetchUser)\b/g
        const nums = /\b(\d+)\b/g

        // Build a flat token array with positions
        interface Tok { start: number; end: number; color: string }
        const tokens: Tok[] = []

        for (const m of remaining.matchAll(keywords)) {
          tokens.push({ start: m.index!, end: m.index! + m[0].length, color: purple })
        }
        for (const m of remaining.matchAll(strings)) {
          tokens.push({ start: m.index!, end: m.index! + m[0].length, color: green })
        }
        for (const m of remaining.matchAll(types)) {
          tokens.push({ start: m.index!, end: m.index! + m[0].length, color: cyan })
        }
        for (const m of remaining.matchAll(funcs)) {
          tokens.push({ start: m.index!, end: m.index! + m[0].length, color: yellow })
        }
        for (const m of remaining.matchAll(nums)) {
          tokens.push({ start: m.index!, end: m.index! + m[0].length, color: orange })
        }

        // Sort by position, remove overlaps
        tokens.sort((a, b) => a.start - b.start)
        const cleaned: Tok[] = []
        let lastEnd = 0
        for (const tok of tokens) {
          if (tok.start >= lastEnd) {
            cleaned.push(tok)
            lastEnd = tok.end
          }
        }

        let pos = 0
        for (const tok of cleaned) {
          if (tok.start > pos) push(remaining.slice(pos, tok.start), fg)
          push(remaining.slice(tok.start, tok.end), tok.color)
          pos = tok.end
        }
        if (pos < remaining.length) push(remaining.slice(pos), fg)
        if (cleaned.length === 0 && spans.length === 0) push(remaining, fg)
      }

      return (
        <div key={lineNum} style={{ display: 'flex', minHeight: 20, lineHeight: '20px' }}>
          <span style={{ width: 40, textAlign: 'right', paddingRight: 12, color: muted, userSelect: 'none', flexShrink: 0 }}>
            {lineNum}
          </span>
          <span style={{ whiteSpace: 'pre' }}>{spans}</span>
        </div>
      )
    }

    const lines = SAMPLE_CODE.split('\n')

    return (
      <div style={{
        flex: 1,
        overflow: 'auto',
        backgroundColor: bg,
        fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 12,
        padding: '12px 0',
      }}>
        {lines.map((line, i) => highlightLine(line, i + 1))}
      </div>
    )
  }

  const renderUIPreview = () => {
    const bg = effectiveColors['--bg-primary'] || '#0d1117'
    const bgSec = effectiveColors['--bg-secondary'] || '#161b22'
    const bgTer = effectiveColors['--bg-tertiary'] || '#010409'
    const bgHov = effectiveColors['--bg-hover'] || '#1c2128'
    const bgAct = effectiveColors['--bg-active'] || '#252c35'
    const border = effectiveColors['--border'] || '#21262d'
    const borderBr = effectiveColors['--border-bright'] || '#30363d'
    const textPri = effectiveColors['--text-primary'] || '#e6edf3'
    const textSec = effectiveColors['--text-secondary'] || '#8b949e'
    const textMut = effectiveColors['--text-muted'] || '#484f58'
    const accent = effectiveColors['--accent'] || '#58a6ff'
    const green = effectiveColors['--accent-green'] || '#3fb950'
    const red = effectiveColors['--accent-red'] || '#f85149'
    const purple = effectiveColors['--accent-purple'] || '#bc8cff'

    return (
      <div style={{ flex: 1, overflow: 'auto', backgroundColor: bg, padding: 0 }}>
        {/* Mini IDE mockup */}
        <div style={{ display: 'flex', height: '100%', minHeight: 300 }}>
          {/* Activity Bar */}
          <div style={{ width: 36, backgroundColor: bgTer, borderRight: `1px solid ${border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8, gap: 12 }}>
            {[accent, textSec, textMut, textMut].map((c, i) => (
              <div key={i} style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: c, opacity: i === 0 ? 1 : 0.4 }} />
            ))}
          </div>
          {/* Sidebar */}
          <div style={{ width: 160, backgroundColor: bgSec, borderRight: `1px solid ${border}`, padding: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: textSec, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8, padding: '0 4px' }}>Explorer</div>
            {['src', '  components', '    App.tsx', '    Header.tsx', '  utils', '    helpers.ts', 'package.json', 'tsconfig.json'].map((item, i) => {
              const indent = item.length - item.trimStart().length
              const isActive = i === 2
              return (
                <div key={i} style={{
                  padding: '3px 4px',
                  paddingLeft: 4 + indent * 6,
                  borderRadius: 4,
                  fontSize: 11,
                  color: isActive ? textPri : textSec,
                  backgroundColor: isActive ? bgAct : 'transparent',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {item.trim()}
                </div>
              )
            })}
          </div>
          {/* Editor area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {/* Tab bar */}
            <div style={{ display: 'flex', backgroundColor: bgSec, borderBottom: `1px solid ${border}`, height: 32 }}>
              {['App.tsx', 'Header.tsx'].map((tab, i) => (
                <div key={i} style={{
                  padding: '0 14px',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 11,
                  color: i === 0 ? textPri : textMut,
                  backgroundColor: i === 0 ? bg : 'transparent',
                  borderRight: `1px solid ${border}`,
                  borderBottom: i === 0 ? `2px solid ${accent}` : 'none',
                  cursor: 'pointer',
                }}>
                  {tab}
                </div>
              ))}
            </div>
            {/* Editor content placeholder */}
            <div style={{ flex: 1, padding: 12, backgroundColor: bg }}>
              {[1, 2, 3, 4, 5, 6, 7].map(n => (
                <div key={n} style={{ display: 'flex', marginBottom: 2, lineHeight: '18px' }}>
                  <span style={{ width: 28, textAlign: 'right', marginRight: 12, fontSize: 11, color: textMut }}>{n}</span>
                  <div style={{
                    height: 12,
                    marginTop: 3,
                    borderRadius: 2,
                    backgroundColor: n === 4 ? bgAct : bgHov,
                    width: `${40 + Math.sin(n * 2.1) * 30}%`,
                    opacity: 0.5,
                  }} />
                </div>
              ))}
            </div>
            {/* Status bar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              height: 24,
              backgroundColor: bgTer,
              borderTop: `1px solid ${border}`,
              padding: '0 10px',
              gap: 12,
              fontSize: 10,
            }}>
              <span style={{ color: accent }}>main</span>
              <span style={{ color: green }}>0 errors</span>
              <span style={{ color: textMut }}>UTF-8</span>
              <span style={{ flex: 1 }} />
              <span style={{ color: textSec }}>Ln 4, Col 12</span>
              <span style={{ color: purple }}>TypeScript</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderTerminalPreview = () => {
    const bg = effectiveColors['--bg-primary'] || '#0d1117'
    const fg = effectiveColors['--text-primary'] || '#e6edf3'
    const green = effectiveColors['--accent-green'] || '#3fb950'
    const red = effectiveColors['--accent-red'] || '#f85149'
    const yellow = effectiveColors['--accent-yellow'] || '#e3b341'
    const blue = effectiveColors['--accent-blue'] || '#58a6ff'
    const purple = effectiveColors['--accent-purple'] || '#bc8cff'
    const cyan = effectiveColors['--accent-cyan'] || '#76e3ea'
    const muted = effectiveColors['--text-muted'] || '#484f58'

    const lines: { prompt?: boolean; text: string; color?: string; parts?: { text: string; color: string }[] }[] = [
      { prompt: true, parts: [
        { text: 'user@orion', color: green },
        { text: ':', color: fg },
        { text: '~/project', color: blue },
        { text: '$ ', color: fg },
        { text: 'git status', color: fg },
      ]},
      { text: 'On branch main', color: fg },
      { text: 'Changes to be committed:', color: fg },
      { parts: [{ text: '  modified:   ', color: green }, { text: 'src/App.tsx', color: fg }] },
      { parts: [{ text: '  new file:   ', color: green }, { text: 'src/ThemeEditor.tsx', color: fg }] },
      { text: '' },
      { text: 'Changes not staged for commit:', color: fg },
      { parts: [{ text: '  modified:   ', color: red }, { text: 'package.json', color: fg }] },
      { text: '' },
      { prompt: true, parts: [
        { text: 'user@orion', color: green },
        { text: ':', color: fg },
        { text: '~/project', color: blue },
        { text: '$ ', color: fg },
        { text: 'npm run build', color: fg },
      ]},
      { text: '' },
      { parts: [{ text: '> ', color: muted }, { text: 'orion-ide@1.0.0 build', color: fg }] },
      { parts: [{ text: '> ', color: muted }, { text: 'tsc && vite build', color: fg }] },
      { text: '' },
      { parts: [{ text: 'vite v5.2.0 ', color: purple }, { text: 'building for production...', color: fg }] },
      { parts: [{ text: '  transforming...', color: yellow }] },
      { parts: [{ text: '  ✓ ', color: green }, { text: '2847 modules transformed.', color: fg }] },
      { parts: [{ text: '  rendering chunks...', color: cyan }] },
      { parts: [{ text: '  ✓ ', color: green }, { text: 'built in 3.42s', color: fg }] },
      { text: '' },
      { prompt: true, parts: [
        { text: 'user@orion', color: green },
        { text: ':', color: fg },
        { text: '~/project', color: blue },
        { text: '$ ', color: fg },
        { text: '▊', color: fg },
      ]},
    ]

    return (
      <div style={{
        flex: 1,
        overflow: 'auto',
        backgroundColor: bg,
        fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 12,
        padding: 12,
        lineHeight: 1.7,
      }}>
        {lines.map((line, i) => (
          <div key={i} style={{ minHeight: 20 }}>
            {line.parts ? (
              line.parts.map((part, j) => (
                <span key={j} style={{ color: part.color }}>{part.text}</span>
              ))
            ) : (
              <span style={{ color: line.color || fg }}>{line.text}</span>
            )}
          </div>
        ))}
      </div>
    )
  }

  // ── Recent Changes Panel ───────────────────────────────────────────────────

  const renderRecentChanges = () => {
    if (!showRecentChanges) return null
    return (
      <div style={{
        position: 'absolute',
        top: 42,
        right: 0,
        width: 320,
        maxHeight: 400,
        overflow: 'auto',
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-bright)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        zIndex: 100,
      }}>
        <div style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          backgroundColor: 'var(--bg-elevated)',
        }}>
          <span style={{ fontWeight: 600, fontSize: 12 }}>Recent Changes</span>
          <button style={styles.smallIconBtn} onClick={() => setShowRecentChanges(false)}>
            <X size={14} />
          </button>
        </div>
        {recentChanges.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            No changes yet
          </div>
        ) : (
          recentChanges.map((change, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              borderBottom: '1px solid var(--border)',
              fontSize: 11,
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: 4,
                backgroundColor: change.oldValue,
                border: '1px solid var(--border)',
                flexShrink: 0,
              }} />
              <span style={{ color: 'var(--text-muted)' }}>→</span>
              <div style={{
                width: 16, height: 16, borderRadius: 4,
                backgroundColor: change.newValue,
                border: '1px solid var(--border)',
                flexShrink: 0,
              }} />
              <div style={{ flex: 1, fontFamily: 'monospace', fontSize: 10, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {change.key}
              </div>
              <button
                style={{ ...styles.smallIconBtn, color: 'var(--accent-orange)' }}
                onClick={() => handleUndoChange(change)}
                title="Undo this change"
              >
                <Undo2 size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    )
  }

  // ── Save Dialog ────────────────────────────────────────────────────────────

  const renderSaveDialog = () => {
    if (!showSaveDialog) return null
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }} onClick={() => setShowSaveDialog(false)}>
        <div style={{
          width: 400,
          backgroundColor: 'var(--bg-elevated)',
          borderRadius: 12,
          border: '1px solid var(--border-bright)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          padding: 24,
        }} onClick={e => e.stopPropagation()}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Save size={18} /> Save Custom Theme
          </h3>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
            Save your current color customizations as a new theme. This will create a copy of "{currentTheme.name}" with your modifications.
          </p>
          <input
            type="text"
            placeholder="Enter theme name..."
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveCustomTheme()}
            autoFocus
            style={{
              width: '100%',
              padding: '10px 14px',
              border: '1px solid var(--border-bright)',
              borderRadius: 8,
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              outline: 'none',
              marginBottom: 16,
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button style={styles.btn} onClick={() => setShowSaveDialog(false)}>Cancel</button>
            <button
              style={{ ...styles.btn, ...styles.btnPrimary, opacity: saveName.trim() ? 1 : 0.5 }}
              onClick={handleSaveCustomTheme}
              disabled={!saveName.trim()}
            >
              <Save size={12} /> Save Theme
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Main Render ────────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.headerTitle}>
            <Palette size={18} style={{ color: 'var(--accent-purple)' }} />
            Theme Editor
          </div>
          <div style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            Active:
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              borderRadius: 4,
              backgroundColor: 'var(--bg-active)',
              color: 'var(--text-primary)',
              fontWeight: 500,
            }}>
              {currentTheme.type === 'dark' ? <Moon size={10} /> : <Sun size={10} />}
              {currentTheme.name}
            </span>
            {Object.keys(colorOverrides.workbench).length > 0 && (
              <span style={{
                fontSize: 10,
                color: 'var(--accent-orange)',
                backgroundColor: 'rgba(247,129,102,0.1)',
                padding: '1px 6px',
                borderRadius: 4,
              }}>
                {Object.keys(colorOverrides.workbench).length} override{Object.keys(colorOverrides.workbench).length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <div style={styles.headerActions}>
          <div style={{ position: 'relative' }}>
            <button
              style={{
                ...styles.iconBtn,
                color: recentChanges.length > 0 ? 'var(--accent-yellow)' : 'var(--text-secondary)',
              }}
              onClick={() => setShowRecentChanges(!showRecentChanges)}
              title="Recent changes"
            >
              <Clock size={15} />
            </button>
            {recentChanges.length > 0 && (
              <div style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 14,
                height: 14,
                borderRadius: '50%',
                backgroundColor: 'var(--accent-yellow)',
                color: '#000',
                fontSize: 9,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {recentChanges.length > 9 ? '9+' : recentChanges.length}
              </div>
            )}
            {renderRecentChanges()}
          </div>
          <button
            style={styles.iconBtn}
            onClick={handleResetAll}
            title="Reset all to defaults"
          >
            <RotateCcw size={15} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleImport}
          />
          <button
            style={styles.btn}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={12} /> Import
          </button>
          <button style={styles.btn} onClick={handleExport}>
            <Download size={12} /> Export
          </button>
          <button
            style={{ ...styles.btn, ...styles.btnPrimary }}
            onClick={() => setShowSaveDialog(true)}
          >
            <Save size={12} /> Save As...
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={styles.tabBar}>
        <button style={styles.tab(activeTab === 'visual')} onClick={() => setActiveTab('visual')}>
          <Paintbrush size={13} /> Visual Editor
        </button>
        <button style={styles.tab(activeTab === 'json')} onClick={() => setActiveTab('json')}>
          <Code size={13} /> JSON Editor
        </button>
        <button style={styles.tab(activeTab === 'gallery')} onClick={() => setActiveTab('gallery')}>
          <Star size={13} /> Gallery
        </button>
        <button style={styles.tab(activeTab === 'palette')} onClick={() => setActiveTab('palette')}>
          <Palette size={13} /> Palette
        </button>
      </div>

      {/* Body */}
      <div style={styles.body}>
        {/* Left: Editor content */}
        {activeTab === 'visual' && renderVisualEditor()}
        {activeTab === 'json' && renderJsonEditor()}
        {activeTab === 'gallery' && renderGallery()}
        {activeTab === 'palette' && renderPalette()}

        {/* Right: Live Preview */}
        <div style={styles.rightPanel}>
          <div style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            backgroundColor: 'var(--bg-secondary)',
            padding: '0 12px',
          }}>
            <span style={{
              padding: '8px 0',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginRight: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <Eye size={12} /> Live Preview
            </span>
            {(['code', 'ui', 'terminal'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setPreviewTab(tab)}
                style={{
                  padding: '8px 12px',
                  border: 'none',
                  borderBottom: previewTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                  backgroundColor: 'transparent',
                  color: previewTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: previewTab === tab ? 600 : 400,
                  textTransform: 'capitalize',
                }}
              >
                {tab}
              </button>
            ))}
          </div>
          <div style={styles.previewPane}>
            {previewTab === 'code' && renderCodePreview()}
            {previewTab === 'ui' && renderUIPreview()}
            {previewTab === 'terminal' && renderTerminalPreview()}
          </div>
        </div>
      </div>

      {/* Dialogs & Overlays */}
      {renderSaveDialog()}
      {renderNotification()}

      {/* Global animation keyframes */}
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
