import { useState, useEffect } from 'react'
import { X, Check, Eye, EyeOff, Sparkles, Code, Palette, Plus, Trash2, Terminal, Keyboard, Settings, User, Download, Upload, Pencil, Copy } from 'lucide-react'
import { useThemeStore } from '@/store/theme'
import { useWorkspaceStore, DEFAULT_WORKSPACE_SETTINGS } from '@/store/workspace'
import { useFileStore } from '@/store/files'
import { useProfileStore } from '@/store/profiles'
import type { WorkspaceSettings } from '@shared/types'

interface Props {
  open: boolean
  onClose: () => void
}

const providers = [
  { key: 'anthropic', label: 'Anthropic (Claude)', placeholder: 'sk-ant-...', color: '#bc8cff' },
  { key: 'openai', label: 'OpenAI (GPT)', placeholder: 'sk-...', color: '#3fb950' },
  { key: 'nvidia', label: 'NVIDIA NIM (build.nvidia.com)', placeholder: 'nvapi-...', color: '#76b900' },
  { key: 'kimi', label: 'Moonshot (Kimi)', placeholder: 'sk-...', color: '#f78166' },
  { key: 'gemini', label: 'Google (Gemini)', placeholder: 'AIza...', color: '#58a6ff' },
]

const DEFAULT_SYSTEM_PROMPT = 'You are Orion AI by Bebut, an expert coding assistant integrated into a code editor IDE. You help with code analysis, debugging, feature implementation, and code explanations. Be concise and helpful. Use markdown formatting for code blocks. Respond in the same language the user uses.'
const DEFAULT_USER_TEMPLATE = '{message}'

type CategoryId = 'general' | 'editor' | 'ai' | 'theme' | 'terminal' | 'shortcuts' | 'profiles'

type AutoSaveMode = 'off' | 'afterDelay' | 'onFocusChange' | 'onWindowChange'

type EditorCursorStyle = 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin'
type RenderWhitespace = 'none' | 'boundary' | 'selection' | 'trailing' | 'all'

interface EditorSettings {
  fontSize: number
  fontFamily: string
  lineHeight: number
  fontLigatures: boolean
  letterSpacing: number
  cursorStyle: EditorCursorStyle
  renderWhitespace: RenderWhitespace
  wordWrap: boolean
  minimap: boolean
  autoSave: boolean // kept for backward compat
  autoSaveMode: AutoSaveMode
  autoSaveDelay: number
  tabSize: number
  lineNumbers: boolean
  bracketPairColorization: boolean
  stickyScroll: boolean
  formatOnSave: boolean
}

const FONT_FAMILIES = [
  'Cascadia Code',
  'Fira Code',
  'JetBrains Mono',
  'Source Code Pro',
  'Consolas',
  'Monaco',
  'Menlo',
  'Ubuntu Mono',
  'IBM Plex Mono',
  'Hack',
]

interface TerminalSettings {
  fontSize: number
  cursorStyle: 'block' | 'bar' | 'underline'
  scrollback: number
}

/* ---- Toggle Component ---- */
const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
  <button
    onClick={() => onChange(!checked)}
    style={{
      width: 36,
      height: 20,
      borderRadius: 10,
      border: 'none',
      background: checked ? 'var(--accent-blue, #388bfd)' : 'var(--bg-tertiary, #2d333b)',
      cursor: 'pointer',
      position: 'relative',
      transition: 'background 0.2s',
      flexShrink: 0,
    }}
  >
    <div
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: '#fff',
        position: 'absolute',
        top: 3,
        left: checked ? 19 : 3,
        transition: 'left 0.2s',
      }}
    />
  </button>
)

/* ---- Setting Row Component ---- */
const SettingRow = ({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)', gap: 16 }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{label}</div>
      {description && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{description}</div>}
    </div>
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
      {children}
    </div>
  </div>
)

/* ---- Section Header Component ---- */
const SectionHeader = ({ title }: { title: string }) => (
  <div style={{
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--text-muted)',
    marginTop: 8,
    marginBottom: 4,
    paddingBottom: 6,
  }}>
    {title}
  </div>
)

/* ---- Number Stepper Component ---- */
const NumberStepper = ({ value, onChange, min, max, step = 1 }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <button
      onClick={() => onChange(Math.max(min, value - step))}
      style={{
        width: 26, height: 26, borderRadius: 6,
        background: 'var(--bg-primary)', border: '1px solid var(--border)',
        color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >-</button>
    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', minWidth: 28, textAlign: 'center' }}>{value}</span>
    <button
      onClick={() => onChange(Math.min(max, value + step))}
      style={{
        width: 26, height: 26, borderRadius: 6,
        background: 'var(--bg-primary)', border: '1px solid var(--border)',
        color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >+</button>
  </div>
)

/* ---- Select Dropdown Component ---- */
const SelectDropdown = ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    style={{
      padding: '5px 10px',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      color: 'var(--text-primary)',
      fontSize: 12,
      outline: 'none',
      cursor: 'pointer',
    }}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>{o.label}</option>
    ))}
  </select>
)

/* ---- Pill Toggle Component ---- */
const PillToggle = ({ value, onChange, options }: { value: number; onChange: (v: number) => void; options: number[] }) => (
  <div style={{ display: 'flex', gap: 4 }}>
    {options.map(n => (
      <button key={n}
        onClick={() => onChange(n)}
        style={{
          width: 32, height: 26, borderRadius: 6, fontSize: 12, fontWeight: 600,
          background: value === n ? 'var(--accent-blue, #388bfd)' : 'var(--bg-primary)',
          color: value === n ? '#fff' : 'var(--text-secondary)',
          border: value === n ? 'none' : '1px solid var(--border)',
          cursor: 'pointer', transition: 'background 0.15s',
        }}>{n}</button>
    ))}
  </div>
)

/* ---- Sidebar Categories ---- */
const categories: { id: CategoryId; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Settings size={15} /> },
  { id: 'editor', label: 'Editor', icon: <Code size={15} /> },
  { id: 'ai', label: 'AI / Models', icon: <Sparkles size={15} /> },
  { id: 'theme', label: 'Theme', icon: <Palette size={15} /> },
  { id: 'terminal', label: 'Terminal', icon: <Terminal size={15} /> },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: <Keyboard size={15} /> },
  { id: 'profiles', label: 'Profiles', icon: <User size={15} /> },
]

/* ============================================================ */
/*  Main Settings Modal                                         */
/* ============================================================ */

export default function SettingsModal({ open, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState<CategoryId>('general')
  const [keys, setKeys] = useState<Record<string, string>>({
    anthropic: '', openai: '', nvidia: '', kimi: '', gemini: '',
  })
  const [showKey, setShowKey] = useState<Record<string, boolean>>({})
  const [systemPrompt, setSystemPrompt] = useState('')
  const [userTemplate, setUserTemplate] = useState('')
  const [saved, setSaved] = useState(false)
  const [editorSettings, setEditorSettings] = useState<EditorSettings>({
    fontSize: 14, fontFamily: 'Cascadia Code', lineHeight: 1.5, fontLigatures: true,
    letterSpacing: 0, cursorStyle: 'line', renderWhitespace: 'selection',
    wordWrap: false, minimap: true, autoSave: true,
    autoSaveMode: 'afterDelay', autoSaveDelay: 1000, tabSize: 2, lineNumbers: true,
    bracketPairColorization: true, stickyScroll: true, formatOnSave: false,
  })
  const [terminalSettings, setTerminalSettings] = useState<TerminalSettings>({
    fontSize: 13, cursorStyle: 'block', scrollback: 1000,
  })

  // Workspace settings
  const rootPath = useFileStore((s) => s.rootPath)
  const wsSettings = useWorkspaceStore((s) => s.settings)
  const wsIsWorkspaceLevel = useWorkspaceStore((s) => s.isWorkspaceLevel)
  const [wsLocal, setWsLocal] = useState<WorkspaceSettings>({ ...DEFAULT_WORKSPACE_SETTINGS })
  const [newExclude, setNewExclude] = useState('')
  const [newAssocExt, setNewAssocExt] = useState('')
  const [newAssocLang, setNewAssocLang] = useState('')
  const [wsSaved, setWsSaved] = useState(false)

  useEffect(() => {
    if (open) {
      try {
        const storedKeys = localStorage.getItem('orion-api-keys')
        if (storedKeys) setKeys(JSON.parse(storedKeys))
        const storedPrompts = localStorage.getItem('orion-prompts')
        if (storedPrompts) {
          const p = JSON.parse(storedPrompts)
          setSystemPrompt(p.systemPrompt || '')
          setUserTemplate(p.userPromptTemplate || '')
        }
        const storedEditor = localStorage.getItem('orion-editor-settings')
        if (storedEditor) {
          const parsed = JSON.parse(storedEditor)
          // Migrate old boolean autoSave to autoSaveMode
          if (parsed.autoSave !== undefined && !parsed.autoSaveMode) {
            parsed.autoSaveMode = parsed.autoSave ? 'afterDelay' : 'off'
          }
          setEditorSettings(prev => ({ ...prev, ...parsed }))
        }
        const storedTerminal = localStorage.getItem('orion-terminal-settings')
        if (storedTerminal) setTerminalSettings(prev => ({ ...prev, ...JSON.parse(storedTerminal) }))
      } catch {}
      // Load workspace settings
      if (rootPath) {
        useWorkspaceStore.getState().loadWorkspaceSettings(rootPath)
      }
      setSaved(false)
      setWsSaved(false)
    }
  }, [open])

  // Keep local workspace state in sync when store updates
  useEffect(() => {
    if (open) {
      setWsLocal({ ...wsSettings })
    }
  }, [wsSettings, open])

  const handleSave = async () => {
    localStorage.setItem('orion-api-keys', JSON.stringify(keys))
    await window.api?.omoSetApiKeys(keys)

    const prompts = {
      systemPrompt: systemPrompt || '',
      userPromptTemplate: userTemplate || '',
    }
    localStorage.setItem('orion-prompts', JSON.stringify(prompts))
    await window.api?.omoSetPrompts(prompts)

    localStorage.setItem('orion-editor-settings', JSON.stringify(editorSettings))
    localStorage.setItem('orion-terminal-settings', JSON.stringify(terminalSettings))
    // Dispatch editor config update event
    window.dispatchEvent(new CustomEvent('orion:editor-config', { detail: editorSettings }))
    window.dispatchEvent(new CustomEvent('orion:terminal-config', { detail: terminalSettings }))

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        className="anim-scale-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720, maxHeight: '85vh',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
        }}>
          <Settings size={16} style={{ color: 'var(--accent)', marginRight: 10 }} />
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            Settings
          </h2>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto', padding: 4, borderRadius: 4,
              color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Sidebar + Content */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Sidebar */}
          <div style={{
            width: 180, flexShrink: 0,
            borderRight: '1px solid var(--border)',
            padding: '8px 0',
            overflowY: 'auto',
            background: 'var(--bg-primary)',
          }}>
            {categories.map((cat) => {
              const isActive = cat.id === activeCategory
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%',
                    padding: '9px 16px',
                    fontSize: 12, fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                    background: isActive ? 'var(--bg-secondary)' : 'transparent',
                    border: 'none',
                    borderLeft: isActive ? '2px solid var(--accent-blue, #388bfd)' : '2px solid transparent',
                    cursor: 'pointer',
                    transition: 'background 0.15s, color 0.15s',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  {cat.icon}
                  {cat.label}
                </button>
              )
            })}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
            {/* ---- GENERAL ---- */}
            {activeCategory === 'general' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <SectionHeader title="Workspace" />
                <SettingRow label="Workspace Folder" description={rootPath || 'No folder open'}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rootPath ? rootPath.split(/[\\/]/).pop() : '--'}
                  </span>
                </SettingRow>

                <SectionHeader title="Prompts" />
                <div style={{ paddingTop: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>System Prompt</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
                    Instructions that define how the AI behaves. Leave empty to use default.
                  </div>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder={DEFAULT_SYSTEM_PROMPT}
                    rows={4}
                    style={{
                      width: '100%', padding: '10px 12px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 8, outline: 'none',
                      fontSize: 12, color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono, monospace)',
                      resize: 'vertical', minHeight: 70, maxHeight: 180,
                      lineHeight: 1.5, boxSizing: 'border-box',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue, #388bfd)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                  />
                </div>

                <div style={{ paddingTop: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>User Prompt Template</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
                    Template prepended to your messages. Use <code style={{
                      background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: 3,
                      fontFamily: 'var(--font-mono, monospace)', fontSize: 11,
                    }}>{'{message}'}</code> as placeholder.
                  </div>
                  <textarea
                    value={userTemplate}
                    onChange={(e) => setUserTemplate(e.target.value)}
                    placeholder={DEFAULT_USER_TEMPLATE}
                    rows={2}
                    style={{
                      width: '100%', padding: '10px 12px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 8, outline: 'none',
                      fontSize: 12, color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono, monospace)',
                      resize: 'vertical', minHeight: 50, maxHeight: 120,
                      lineHeight: 1.5, boxSizing: 'border-box',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue, #388bfd)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                  />
                </div>

                <SectionHeader title="Workspace Settings" />
                {wsIsWorkspaceLevel && (
                  <div style={{ fontSize: 11, color: 'var(--accent-green)', marginBottom: 4 }}>
                    Loaded from .orion/settings.json
                  </div>
                )}

                {/* Exclude Patterns */}
                <div style={{ paddingTop: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>Exclude Patterns</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                    Glob patterns for files/folders hidden in the explorer.
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {wsLocal.excludePatterns.map((pat) => (
                      <span key={pat} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '3px 8px', borderRadius: 4,
                        background: 'var(--bg-primary)', border: '1px solid var(--border)',
                        fontSize: 11, color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}>
                        {pat}
                        <button
                          onClick={() => setWsLocal(s => ({
                            ...s,
                            excludePatterns: s.excludePatterns.filter(p => p !== pat),
                          }))}
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: 'var(--text-muted)', padding: 0, display: 'flex',
                          }}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      value={newExclude}
                      onChange={(e) => setNewExclude(e.target.value)}
                      placeholder="e.g. *.log, build, .cache"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newExclude.trim()) {
                          setWsLocal(s => ({
                            ...s,
                            excludePatterns: [...s.excludePatterns, newExclude.trim()],
                          }))
                          setNewExclude('')
                        }
                      }}
                      style={{
                        flex: 1, padding: '6px 10px',
                        background: 'var(--bg-primary)', border: '1px solid var(--border)',
                        borderRadius: 6, outline: 'none',
                        fontSize: 12, color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    />
                    <button
                      onClick={() => {
                        if (newExclude.trim()) {
                          setWsLocal(s => ({
                            ...s,
                            excludePatterns: [...s.excludePatterns, newExclude.trim()],
                          }))
                          setNewExclude('')
                        }
                      }}
                      style={{
                        padding: '6px 10px', borderRadius: 6, border: 'none',
                        background: 'var(--accent-blue, #388bfd)', color: '#fff', cursor: 'pointer',
                        fontSize: 12, display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </div>

                {/* Workspace toggles */}
                {([
                  ['autoSave', 'Auto Save', 'Automatically save files when switching tabs'],
                  ['formatOnSave', 'Format on Save', 'Format the file each time it is saved'],
                  ['insertSpaces', 'Insert Spaces', 'Use spaces instead of tabs for indentation'],
                ] as const).map(([key, label, desc]) => (
                  <SettingRow key={key} label={label} description={desc}>
                    <Toggle checked={!!wsLocal[key]} onChange={(v) => setWsLocal(s => ({ ...s, [key]: v }))} />
                  </SettingRow>
                ))}

                {/* Workspace Tab Size */}
                <SettingRow label="Tab Size" description="Number of spaces per tab (workspace)">
                  <PillToggle value={wsLocal.tabSize} onChange={(v) => setWsLocal(s => ({ ...s, tabSize: v }))} options={[2, 4, 8]} />
                </SettingRow>

                {/* File Associations */}
                <div style={{ paddingTop: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>File Associations</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                    Map file extensions to language modes.
                  </div>
                  {Object.entries(wsLocal.fileAssociations).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                      {Object.entries(wsLocal.fileAssociations).map(([ext, lang]) => (
                        <div key={ext} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '4px 8px', borderRadius: 4,
                          background: 'var(--bg-primary)', border: '1px solid var(--border)',
                          fontSize: 11,
                        }}>
                          <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--accent-blue, #388bfd)' }}>.{ext}</span>
                          <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                          <span style={{ color: 'var(--text-primary)', flex: 1 }}>{lang}</span>
                          <button
                            onClick={() => setWsLocal(s => {
                              const fa = { ...s.fileAssociations }
                              delete fa[ext]
                              return { ...s, fileAssociations: fa }
                            })}
                            style={{
                              background: 'transparent', border: 'none', cursor: 'pointer',
                              color: 'var(--text-muted)', padding: 0, display: 'flex',
                            }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      value={newAssocExt}
                      onChange={(e) => setNewAssocExt(e.target.value)}
                      placeholder="ext (e.g. mdx)"
                      style={{
                        width: 80, padding: '6px 10px',
                        background: 'var(--bg-primary)', border: '1px solid var(--border)',
                        borderRadius: 6, outline: 'none',
                        fontSize: 12, color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    />
                    <input
                      value={newAssocLang}
                      onChange={(e) => setNewAssocLang(e.target.value)}
                      placeholder="language (e.g. markdown)"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newAssocExt.trim() && newAssocLang.trim()) {
                          setWsLocal(s => ({
                            ...s,
                            fileAssociations: { ...s.fileAssociations, [newAssocExt.trim().replace(/^\./, '')]: newAssocLang.trim() },
                          }))
                          setNewAssocExt('')
                          setNewAssocLang('')
                        }
                      }}
                      style={{
                        flex: 1, padding: '6px 10px',
                        background: 'var(--bg-primary)', border: '1px solid var(--border)',
                        borderRadius: 6, outline: 'none',
                        fontSize: 12, color: 'var(--text-primary)',
                      }}
                    />
                    <button
                      onClick={() => {
                        if (newAssocExt.trim() && newAssocLang.trim()) {
                          setWsLocal(s => ({
                            ...s,
                            fileAssociations: { ...s.fileAssociations, [newAssocExt.trim().replace(/^\./, '')]: newAssocLang.trim() },
                          }))
                          setNewAssocExt('')
                          setNewAssocLang('')
                        }
                      }}
                      style={{
                        padding: '6px 10px', borderRadius: 6, border: 'none',
                        background: 'var(--accent-blue, #388bfd)', color: '#fff', cursor: 'pointer',
                        fontSize: 12, display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </div>

                {/* Save workspace settings button */}
                <div style={{ paddingTop: 12 }}>
                  <button
                    disabled={!rootPath}
                    onClick={async () => {
                      if (!rootPath) return
                      useWorkspaceStore.getState().setSettings(wsLocal)
                      await useWorkspaceStore.getState().saveWorkspaceSettings(rootPath)
                      setWsSaved(true)
                      setTimeout(() => setWsSaved(false), 2000)
                    }}
                    style={{
                      padding: '8px 16px', borderRadius: 6,
                      fontSize: 12, fontWeight: 600,
                      background: wsSaved ? 'var(--accent-green)' : !rootPath ? 'var(--bg-hover)' : 'var(--accent-blue, #388bfd)',
                      color: !rootPath ? 'var(--text-muted)' : '#fff',
                      border: 'none', cursor: rootPath ? 'pointer' : 'not-allowed',
                      transition: 'background 0.2s',
                    }}
                  >
                    {wsSaved ? '\u2713 Workspace Settings Saved' : 'Save to .orion/settings.json'}
                  </button>
                </div>
              </div>
            )}

            {/* ---- EDITOR ---- */}
            {activeCategory === 'editor' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <SectionHeader title="Font & Display" />

                <SettingRow label="Font Family" description="Primary editor font face">
                  <SelectDropdown
                    value={editorSettings.fontFamily}
                    onChange={(v) => setEditorSettings(s => ({ ...s, fontFamily: v }))}
                    options={FONT_FAMILIES.map(f => ({ value: f, label: f }))}
                  />
                </SettingRow>

                <SettingRow label="Font Size" description="Editor font size in pixels (10-30)">
                  <NumberStepper value={editorSettings.fontSize} onChange={(v) => setEditorSettings(s => ({ ...s, fontSize: v }))} min={10} max={30} />
                </SettingRow>

                <SettingRow label="Line Height" description="Line height multiplier (1.0-3.0)">
                  <NumberStepper value={editorSettings.lineHeight} onChange={(v) => setEditorSettings(s => ({ ...s, lineHeight: parseFloat(v.toFixed(1)) }))} min={1.0} max={3.0} step={0.1} />
                </SettingRow>

                <SettingRow label="Letter Spacing" description="Additional space between characters (-1 to 5)">
                  <NumberStepper value={editorSettings.letterSpacing} onChange={(v) => setEditorSettings(s => ({ ...s, letterSpacing: parseFloat(v.toFixed(1)) }))} min={-1} max={5} step={0.5} />
                </SettingRow>

                <SettingRow label="Font Ligatures" description="Enable ligatures for supported fonts (e.g. => != ===)">
                  <Toggle checked={editorSettings.fontLigatures} onChange={(v) => setEditorSettings(s => ({ ...s, fontLigatures: v }))} />
                </SettingRow>

                {/* Live font preview */}
                <div style={{
                  marginTop: 8, marginBottom: 8, padding: 12,
                  background: 'var(--bg-primary)', border: '1px solid var(--border)',
                  borderRadius: 8, overflow: 'hidden',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Font Preview</div>
                  <pre style={{
                    fontFamily: `'${editorSettings.fontFamily}', monospace`,
                    fontSize: Math.min(editorSettings.fontSize, 18),
                    lineHeight: editorSettings.lineHeight,
                    letterSpacing: editorSettings.letterSpacing,
                    fontVariantLigatures: editorSettings.fontLigatures ? 'normal' : 'none',
                    color: 'var(--text-primary)',
                    margin: 0, whiteSpace: 'pre', overflowX: 'auto',
                  }}>
{`const fn = (x) => x !== null;
if (a === b && c >= d) {
  return arr.map(i => i * 2);
}`}
                  </pre>
                </div>

                <SettingRow label="Tab Size" description="Number of spaces per tab">
                  <PillToggle value={editorSettings.tabSize} onChange={(v) => setEditorSettings(s => ({ ...s, tabSize: v }))} options={[2, 4, 8]} />
                </SettingRow>

                <SettingRow label="Cursor Style" description="Shape of the editor cursor">
                  <SelectDropdown
                    value={editorSettings.cursorStyle}
                    onChange={(v) => setEditorSettings(s => ({ ...s, cursorStyle: v as EditorCursorStyle }))}
                    options={[
                      { value: 'line', label: 'Line' },
                      { value: 'block', label: 'Block' },
                      { value: 'underline', label: 'Underline' },
                      { value: 'line-thin', label: 'Line Thin' },
                      { value: 'block-outline', label: 'Block Outline' },
                      { value: 'underline-thin', label: 'Underline Thin' },
                    ]}
                  />
                </SettingRow>

                <SettingRow label="Render Whitespace" description="Controls how whitespace is rendered">
                  <SelectDropdown
                    value={editorSettings.renderWhitespace}
                    onChange={(v) => setEditorSettings(s => ({ ...s, renderWhitespace: v as RenderWhitespace }))}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'boundary', label: 'Boundary' },
                      { value: 'selection', label: 'Selection' },
                      { value: 'trailing', label: 'Trailing' },
                      { value: 'all', label: 'All' },
                    ]}
                  />
                </SettingRow>

                <SectionHeader title="Text" />

                <SettingRow label="Word Wrap" description="Wrap long lines at the editor width">
                  <Toggle checked={editorSettings.wordWrap} onChange={(v) => setEditorSettings(s => ({ ...s, wordWrap: v }))} />
                </SettingRow>

                <SettingRow label="Line Numbers" description="Show line numbers in the gutter">
                  <Toggle checked={editorSettings.lineNumbers} onChange={(v) => setEditorSettings(s => ({ ...s, lineNumbers: v }))} />
                </SettingRow>

                <SectionHeader title="Navigation" />

                <SettingRow label="Minimap" description="Show code overview on the right side">
                  <Toggle checked={editorSettings.minimap} onChange={(v) => setEditorSettings(s => ({ ...s, minimap: v }))} />
                </SettingRow>

                <SettingRow label="Sticky Scroll" description="Pin parent scopes at the top while scrolling">
                  <Toggle checked={editorSettings.stickyScroll} onChange={(v) => setEditorSettings(s => ({ ...s, stickyScroll: v }))} />
                </SettingRow>

                <SettingRow label="Bracket Pair Colorization" description="Colorize matching bracket pairs">
                  <Toggle checked={editorSettings.bracketPairColorization} onChange={(v) => setEditorSettings(s => ({ ...s, bracketPairColorization: v }))} />
                </SettingRow>

                <SectionHeader title="Save" />

                <SettingRow label="Auto Save" description="Controls when files are automatically saved">
                  <select
                    value={editorSettings.autoSaveMode}
                    onChange={(e) => {
                      const mode = e.target.value as AutoSaveMode
                      setEditorSettings(s => ({
                        ...s,
                        autoSaveMode: mode,
                        autoSave: mode !== 'off',
                      }))
                    }}
                    style={{
                      padding: '4px 8px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      outline: 'none',
                      fontSize: 12,
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="off">Off</option>
                    <option value="afterDelay">After Delay</option>
                    <option value="onFocusChange">On Focus Change</option>
                    <option value="onWindowChange">On Window Change</option>
                  </select>
                </SettingRow>

                {editorSettings.autoSaveMode === 'afterDelay' && (
                  <SettingRow label="Auto Save Delay" description="Delay in milliseconds before auto-saving">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="number"
                        value={editorSettings.autoSaveDelay}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10)
                          if (!isNaN(v) && v >= 200) setEditorSettings(s => ({ ...s, autoSaveDelay: v }))
                        }}
                        style={{
                          width: 70, padding: '4px 8px',
                          background: 'var(--bg-primary)', border: '1px solid var(--border)',
                          borderRadius: 6, outline: 'none',
                          fontSize: 12, color: 'var(--text-primary)',
                          textAlign: 'center',
                        }}
                      />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ms</span>
                    </div>
                  </SettingRow>
                )}

                <SettingRow label="Format on Save" description="Automatically format the file when saving">
                  <Toggle checked={editorSettings.formatOnSave} onChange={(v) => setEditorSettings(s => ({ ...s, formatOnSave: v }))} />
                </SettingRow>

                <SettingRow label="Trim Trailing Whitespace" description="Remove trailing whitespace from lines when saving">
                  <Toggle checked={editorSettings.trimTrailingWhitespace ?? true} onChange={(v) => setEditorSettings(s => ({ ...s, trimTrailingWhitespace: v }))} />
                </SettingRow>

                <SettingRow label="Insert Final Newline" description="Ensure files end with a newline when saving">
                  <Toggle checked={editorSettings.insertFinalNewline ?? true} onChange={(v) => setEditorSettings(s => ({ ...s, insertFinalNewline: v }))} />
                </SettingRow>
              </div>
            )}

            {/* ---- AI / MODELS ---- */}
            {activeCategory === 'ai' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <SectionHeader title="API Keys" />
                <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
                  Enter your API keys to enable AI responses. Keys are stored locally.
                </p>
                {providers.map(({ key, label, placeholder, color }) => (
                  <div key={key} style={{ marginBottom: 12 }}>
                    <label style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
                      marginBottom: 6,
                    }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: keys[key] ? color : 'var(--text-muted)',
                      }} />
                      {label}
                      {keys[key] && <Check size={12} style={{ color: 'var(--accent-green)', marginLeft: 4 }} />}
                    </label>
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 8, overflow: 'hidden',
                    }}>
                      <input
                        type={showKey[key] ? 'text' : 'password'}
                        value={keys[key]}
                        onChange={(e) => setKeys({ ...keys, [key]: e.target.value })}
                        placeholder={placeholder}
                        style={{
                          flex: 1, padding: '8px 12px',
                          background: 'transparent', border: 'none', outline: 'none',
                          fontSize: 12, color: 'var(--text-primary)',
                          fontFamily: 'var(--font-mono, monospace)',
                        }}
                      />
                      <button
                        onClick={() => setShowKey({ ...showKey, [key]: !showKey[key] })}
                        style={{ padding: '8px 10px', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                      >
                        {showKey[key] ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ---- THEME ---- */}
            {activeCategory === 'theme' && <ThemePicker />}

            {/* ---- TERMINAL ---- */}
            {activeCategory === 'terminal' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <SectionHeader title="Terminal Appearance" />

                <SettingRow label="Font Size" description="Terminal font size in pixels">
                  <NumberStepper value={terminalSettings.fontSize} onChange={(v) => setTerminalSettings(s => ({ ...s, fontSize: v }))} min={10} max={24} />
                </SettingRow>

                <SettingRow label="Cursor Style" description="Shape of the terminal cursor">
                  <SelectDropdown
                    value={terminalSettings.cursorStyle}
                    onChange={(v) => setTerminalSettings(s => ({ ...s, cursorStyle: v as TerminalSettings['cursorStyle'] }))}
                    options={[
                      { value: 'block', label: 'Block' },
                      { value: 'bar', label: 'Bar' },
                      { value: 'underline', label: 'Underline' },
                    ]}
                  />
                </SettingRow>

                <SectionHeader title="Buffer" />

                <SettingRow label="Scrollback" description="Number of lines retained in the terminal buffer">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="number"
                      value={terminalSettings.scrollback}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10)
                        if (!isNaN(v) && v >= 100 && v <= 100000) setTerminalSettings(s => ({ ...s, scrollback: v }))
                      }}
                      style={{
                        width: 80, padding: '4px 8px',
                        background: 'var(--bg-primary)', border: '1px solid var(--border)',
                        borderRadius: 6, outline: 'none',
                        fontSize: 12, color: 'var(--text-primary)',
                        textAlign: 'center',
                      }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>lines</span>
                  </div>
                </SettingRow>
              </div>
            )}

            {/* ---- PROFILES ---- */}
            {activeCategory === 'profiles' && <ProfilesPanel />}

            {/* ---- KEYBOARD SHORTCUTS ---- */}
            {activeCategory === 'shortcuts' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <SectionHeader title="Keyboard Shortcuts" />
                <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
                  Default keyboard shortcuts. Custom keybinding support coming soon.
                </p>

                {([
                  ['Ctrl+Shift+P', 'Command Palette'],
                  ['Ctrl+P', 'Quick Open File'],
                  ['Ctrl+,', 'Open Settings'],
                  ['Ctrl+B', 'Toggle Sidebar'],
                  ['Ctrl+J', 'Toggle Panel'],
                  ['Ctrl+`', 'Toggle Terminal'],
                  ['Ctrl+Shift+E', 'Focus Explorer'],
                  ['Ctrl+Shift+F', 'Focus Search'],
                  ['Ctrl+Shift+G', 'Focus Source Control'],
                  ['Ctrl+S', 'Save File'],
                  ['Ctrl+W', 'Close Tab'],
                  ['Ctrl+Tab', 'Switch Tab'],
                  ['Ctrl+/', 'Toggle Line Comment'],
                  ['Ctrl+Shift+K', 'Delete Line'],
                  ['Alt+Up', 'Move Line Up'],
                  ['Alt+Down', 'Move Line Down'],
                  ['Ctrl+D', 'Select Next Occurrence'],
                  ['Ctrl+Shift+L', 'Select All Occurrences'],
                  ['F2', 'Rename Symbol'],
                  ['F12', 'Go to Definition'],
                  ['Ctrl+Z', 'Undo'],
                  ['Ctrl+Shift+Z', 'Redo'],
                ] as const).map(([shortcut, action]) => (
                  <div key={shortcut} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--border)',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{action}</span>
                    <kbd style={{
                      fontSize: 11,
                      fontFamily: 'var(--font-mono, monospace)',
                      padding: '3px 8px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      color: 'var(--text-secondary)',
                    }}>{shortcut}</kbd>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '12px 20px',
          borderTop: '1px solid var(--border)',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px', borderRadius: 6,
              fontSize: 12, color: 'var(--text-secondary)',
              background: 'var(--bg-hover)', border: 'none', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '6px 16px', borderRadius: 6,
              fontSize: 12, fontWeight: 600,
              background: saved ? 'var(--accent-green)' : 'var(--accent-blue, #388bfd)',
              color: '#fff', border: 'none', cursor: 'pointer',
              transition: 'background 0.2s',
            }}
          >
            {saved ? '\u2713 Saved' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- */
/*  Profiles Panel sub-component (rendered in the Profiles tab) */
/* ----------------------------------------------------------- */

function ProfilesPanel() {
  const { profiles, activeProfileId, createProfile, switchProfile, updateProfile, deleteProfile, renameProfile, exportProfile, importProfile, _load } = useProfileStore()
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('\u{1F4BB}')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [importJson, setImportJson] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [feedback, setFeedback] = useState('')

  useEffect(() => { _load() }, [])

  const iconOptions = ['\u{1F4BB}', '\u{1F3E0}', '\u{1F680}', '\u{1F3A8}', '\u2699\uFE0F', '\u{1F4DA}', '\u{1F4A1}', '\u26A1', '\u{1F527}', '\u{1F9EA}', '\u{1F33F}', '\u{1F525}']

  const showFeedback = (msg: string) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(''), 2000)
  }

  const handleCreate = () => {
    const name = newName.trim() || `Profile ${profiles.length + 1}`
    createProfile(name, newIcon)
    setNewName('')
    showFeedback(`Created "${name}"`)
  }

  const handleExport = (id: string) => {
    const json = exportProfile(id)
    if (json) {
      navigator.clipboard.writeText(json).then(() => showFeedback('Copied to clipboard'))
    }
  }

  const handleImport = () => {
    const result = importProfile(importJson)
    if (result) {
      setImportJson('')
      setShowImport(false)
      showFeedback(`Imported "${result.name}"`)
    } else {
      showFeedback('Invalid profile JSON')
    }
  }

  const activeProfile = profiles.find(p => p.id === activeProfileId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <SectionHeader title="Active Profile" />

      {/* Active profile card */}
      {activeProfile && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px',
          background: 'rgba(56,139,253,0.06)',
          border: '1.5px solid var(--accent-blue, #388bfd)',
          borderRadius: 10,
          marginBottom: 4,
        }}>
          <span style={{ fontSize: 28 }}>{activeProfile.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              {activeProfile.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Theme: {activeProfile.theme} &middot; Created {new Date(activeProfile.createdAt).toLocaleDateString()}
            </div>
          </div>
          {activeProfile.isDefault && (
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 4,
              background: 'rgba(56,139,253,0.15)', color: 'var(--accent-blue, #388bfd)',
              fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
            }}>Default</span>
          )}
        </div>
      )}

      <SectionHeader title="All Profiles" />

      {/* Profile list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {profiles.map((profile) => {
          const isActive = profile.id === activeProfileId
          const isRenaming = renamingId === profile.id
          return (
            <div key={profile.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px',
              background: isActive ? 'rgba(56,139,253,0.04)' : 'var(--bg-primary)',
              border: isActive ? '1px solid var(--accent-blue, #388bfd)' : '1px solid var(--border)',
              borderRadius: 8,
              transition: 'background 0.15s',
            }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{profile.icon}</span>

              {isRenaming ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && renameValue.trim()) {
                      renameProfile(profile.id, renameValue.trim())
                      setRenamingId(null)
                    }
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={() => {
                    if (renameValue.trim()) renameProfile(profile.id, renameValue.trim())
                    setRenamingId(null)
                  }}
                  style={{
                    flex: 1, padding: '3px 8px', fontSize: 12,
                    background: 'var(--bg-secondary)', border: '1px solid var(--accent-blue, #388bfd)',
                    borderRadius: 4, outline: 'none', color: 'var(--text-primary)',
                  }}
                />
              ) : (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {profile.name}
                    {isActive && <Check size={12} style={{ color: 'var(--accent-blue, #388bfd)' }} />}
                    {profile.isDefault && (
                      <span style={{
                        fontSize: 9, padding: '1px 5px', borderRadius: 3,
                        background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)',
                        fontWeight: 600,
                      }}>DEFAULT</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                    {profile.theme} &middot; {new Date(profile.createdAt).toLocaleDateString()}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                {!isActive && (
                  <button
                    onClick={() => switchProfile(profile.id)}
                    title="Switch to this profile"
                    style={{
                      padding: '4px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: 'var(--accent-blue, #388bfd)', color: '#fff',
                      border: 'none', cursor: 'pointer',
                    }}
                  >Switch</button>
                )}
                {isActive && (
                  <button
                    onClick={() => { updateProfile(profile.id); showFeedback('Profile updated') }}
                    title="Update with current settings"
                    style={{
                      padding: '4px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: 'var(--accent-green, #3fb950)', color: '#fff',
                      border: 'none', cursor: 'pointer',
                    }}
                  >Update</button>
                )}
                <button
                  onClick={() => { setRenamingId(profile.id); setRenameValue(profile.name) }}
                  title="Rename"
                  style={{
                    padding: '4px 6px', borderRadius: 4,
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center',
                  }}
                ><Pencil size={11} /></button>
                <button
                  onClick={() => handleExport(profile.id)}
                  title="Export (copy JSON)"
                  style={{
                    padding: '4px 6px', borderRadius: 4,
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center',
                  }}
                ><Copy size={11} /></button>
                {!profile.isDefault && (
                  <button
                    onClick={() => { deleteProfile(profile.id); showFeedback('Profile deleted') }}
                    title="Delete profile"
                    style={{
                      padding: '4px 6px', borderRadius: 4,
                      background: 'transparent', border: '1px solid var(--border)',
                      color: 'var(--accent-red, #f85149)', cursor: 'pointer', display: 'flex', alignItems: 'center',
                    }}
                  ><Trash2 size={11} /></button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Feedback */}
      {feedback && (
        <div style={{
          fontSize: 12, color: 'var(--accent-green, #3fb950)', fontWeight: 600,
          padding: '6px 0', textAlign: 'center',
        }}>{feedback}</div>
      )}

      <SectionHeader title="Create Profile" />
      <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 8 }}>
        Save a snapshot of your current settings and theme as a new profile.
      </p>

      {/* Icon picker */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {iconOptions.map((icon) => (
          <button
            key={icon}
            onClick={() => setNewIcon(icon)}
            style={{
              width: 32, height: 32, borderRadius: 6,
              fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: newIcon === icon ? 'rgba(56,139,253,0.12)' : 'var(--bg-primary)',
              border: newIcon === icon ? '1.5px solid var(--accent-blue, #388bfd)' : '1px solid var(--border)',
              cursor: 'pointer', transition: 'background 0.15s',
            }}
          >{icon}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Profile name..."
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
          style={{
            flex: 1, padding: '8px 12px',
            background: 'var(--bg-primary)', border: '1px solid var(--border)',
            borderRadius: 6, outline: 'none',
            fontSize: 12, color: 'var(--text-primary)',
          }}
        />
        <button
          onClick={handleCreate}
          style={{
            padding: '8px 14px', borderRadius: 6, border: 'none',
            background: 'var(--accent-blue, #388bfd)', color: '#fff', cursor: 'pointer',
            fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <Plus size={13} /> Create
        </button>
      </div>

      <SectionHeader title="Import / Export" />
      <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 8 }}>
        Export profiles as JSON to share, or import profiles from JSON.
      </p>

      {!showImport ? (
        <button
          onClick={() => setShowImport(true)}
          style={{
            padding: '8px 14px', borderRadius: 6,
            background: 'var(--bg-primary)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', cursor: 'pointer',
            fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Download size={13} /> Import Profile from JSON
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            placeholder="Paste exported profile JSON here..."
            rows={5}
            style={{
              width: '100%', padding: '10px 12px',
              background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: 8, outline: 'none',
              fontSize: 11, color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono, monospace)',
              resize: 'vertical', boxSizing: 'border-box',
              lineHeight: 1.5,
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleImport}
              disabled={!importJson.trim()}
              style={{
                padding: '6px 14px', borderRadius: 6, border: 'none',
                background: importJson.trim() ? 'var(--accent-blue, #388bfd)' : 'var(--bg-hover)',
                color: importJson.trim() ? '#fff' : 'var(--text-muted)',
                cursor: importJson.trim() ? 'pointer' : 'not-allowed',
                fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <Upload size={12} /> Import
            </button>
            <button
              onClick={() => { setShowImport(false); setImportJson('') }}
              style={{
                padding: '6px 14px', borderRadius: 6, border: 'none',
                background: 'var(--bg-hover)', color: 'var(--text-secondary)',
                cursor: 'pointer', fontSize: 12,
              }}
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ----------------------------------------------------------- */
/*  Theme Picker sub-component (rendered in the Theme tab)     */
/* ----------------------------------------------------------- */

/** The six representative color keys shown as swatches on each card. */
const SWATCH_KEYS = [
  '--bg-primary',
  '--bg-secondary',
  '--accent',
  '--accent-green',
  '--accent-purple',
  '--accent-orange',
] as const

/** Sample code used for the theme preview panel. */
const PREVIEW_CODE = `import { useState } from 'react'

interface User {
  name: string
  age: number
  active: boolean
}

// Fetch user data from API
async function getUser(id: number): Promise<User> {
  const res = await fetch(\`/api/users/\${id}\`)
  return res.json()
}

export default function App() {
  const [count, setCount] = useState(0)
  const msg = "Hello, World!"
  return <div onClick={() => setCount(c => c + 1)}>{msg}</div>
}`

function ThemePreviewPanel({ theme }: { theme: { colors: Record<string, string> } }) {
  const lines = PREVIEW_CODE.split('\n')
  const kw = theme.colors['--accent-purple'] || '#c678dd'
  const str = theme.colors['--accent-green'] || '#98c379'
  const fn = theme.colors['--accent'] || '#61afef'
  const tp = theme.colors['--accent-cyan'] || '#56b6c2'
  const cm = theme.colors['--text-muted'] || '#5c6370'
  const fg = theme.colors['--text-primary'] || '#abb2bf'
  const num = theme.colors['--accent-orange'] || '#d19a66'

  const colorize = (line: string) => {
    return line
      .replace(/(\/\/.*)/g, `<span style="color:${cm};font-style:italic">$1</span>`)
      .replace(/\b(import|from|export|default|const|let|var|function|return|async|await|interface|type|new|if|else|typeof)\b/g, `<span style="color:${kw}">$1</span>`)
      .replace(/\b(string|number|boolean|Promise|void|null|undefined|true|false)\b/g, `<span style="color:${tp}">$1</span>`)
      .replace(/\b(useState|fetch|setCount|getUser)\b/g, `<span style="color:${fn}">$1</span>`)
      .replace(/"([^"]*)"/g, `<span style="color:${str}">"$1"</span>`)
      .replace(/'([^']*)'/g, `<span style="color:${str}">'$1'</span>`)
      .replace(/`([^`]*)`/g, `<span style="color:${str}">\`$1\`</span>`)
      .replace(/\b(\d+)\b/g, `<span style="color:${num}">$1</span>`)
  }

  return (
    <div style={{
      background: theme.colors['--bg-primary'] || '#1e1e1e',
      border: `1px solid ${theme.colors['--border'] || '#333'}`,
      borderRadius: 8,
      padding: '10px 0',
      fontFamily: '"Fira Code", "Cascadia Code", Consolas, monospace',
      fontSize: 11,
      lineHeight: 1.6,
      overflow: 'hidden',
      marginTop: 8,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 12px 8px',
        borderBottom: `1px solid ${theme.colors['--border'] || '#333'}`,
        marginBottom: 8,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: theme.colors['--accent-red'] || '#f44' }} />
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: theme.colors['--accent-orange'] || '#fa0' }} />
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: theme.colors['--accent-green'] || '#4f4' }} />
        <span style={{ flex: 1, textAlign: 'center', fontSize: 10, color: theme.colors['--text-muted'] || '#666' }}>preview.tsx</span>
      </div>
      <div style={{ padding: '0 12px', overflowX: 'auto' }}>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, whiteSpace: 'pre' }}>
            <span style={{ color: theme.colors['--text-muted'] || '#555', userSelect: 'none', minWidth: 20, textAlign: 'right' }}>{i + 1}</span>
            <span style={{ color: fg }} dangerouslySetInnerHTML={{ __html: colorize(line) }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function ThemePicker() {
  const { themes: allThemes, activeThemeId, setTheme, previewTheme, previewThemeId } = useThemeStore()
  const [selectedForPreview, setSelectedForPreview] = useState<string | null>(null)

  const previewId = previewThemeId || selectedForPreview || activeThemeId
  const previewThemeObj = allThemes.find((t) => t.id === previewId) || allThemes[0]

  const darkThemes = allThemes.filter((t) => t.type === 'dark')
  const lightThemes = allThemes.filter((t) => t.type === 'light')

  const renderThemeButton = (theme: typeof allThemes[0]) => {
    const isActive = theme.id === activeThemeId
    const isPreviewed = theme.id === previewId
    return (
      <button
        key={theme.id}
        onClick={() => { setTheme(theme.id); setSelectedForPreview(theme.id) }}
        onMouseEnter={() => { previewTheme(theme.id); setSelectedForPreview(theme.id) }}
        onMouseLeave={() => { previewTheme(null) }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 12px',
          background: isActive ? 'rgba(56,139,253,0.08)' : isPreviewed ? 'rgba(56,139,253,0.04)' : 'var(--bg-primary)',
          border: isActive ? '1.5px solid var(--accent-blue, #388bfd)' : isPreviewed ? '1px solid var(--border-bright)' : '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'pointer',
          transition: 'background 0.15s, border-color 0.15s',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {/* Color swatches */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {SWATCH_KEYS.map((key) => (
            <span
              key={key}
              style={{
                width: 16, height: 16, borderRadius: 4,
                background: theme.colors[key] || '#333',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            />
          ))}
        </div>

        {/* Label + type badge */}
        <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {theme.name}
          <span style={{
            fontSize: 9, padding: '1px 5px', borderRadius: 4,
            background: theme.type === 'light' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.25)',
            color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600,
          }}>
            {theme.type}
          </span>
        </span>

        {/* Checkmark */}
        {isActive && (
          <Check size={14} style={{ color: 'var(--accent-blue, #388bfd)', flexShrink: 0 }} />
        )}
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <SectionHeader title="Color Theme" />
      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
        Choose a color theme. Hover over a theme to preview it live. Click to apply.
      </p>

      {/* Theme preview panel */}
      <ThemePreviewPanel theme={previewThemeObj} />

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Dark themes */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Dark Themes ({darkThemes.length})
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {darkThemes.map(renderThemeButton)}
          </div>
        </div>

        {/* Light themes */}
        {lightThemes.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Light Themes ({lightThemes.length})
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lightThemes.map(renderThemeButton)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
