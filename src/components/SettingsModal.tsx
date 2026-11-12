import { useState, useEffect, useCallback } from 'react'
import { X, Check, Eye, EyeOff, Sparkles, Code, Palette, Plus, Trash2, Terminal, Keyboard, Settings, User, Download, Upload, Pencil, Copy, FileText, Info, RotateCcw } from 'lucide-react'
import { useThemeStore } from '@/store/theme'
import { useWorkspaceStore, DEFAULT_WORKSPACE_SETTINGS } from '@/store/workspace'
import { useFileStore } from '@/store/files'
import { useProfileStore } from '@/store/profiles'
import type { AppInfo, WorkspaceSettings } from '@shared/types'
import type { ApiKeyPatch, ApiKeyProvider, ApiKeyStatus } from '@shared/ipc-contract'
import type { CompletionProviderSetting } from '@/store/completion'
import {
  applyUserSettings, DEFAULT_USER_SETTINGS, readStoredSettings,
  type AiSettings, type AutoSaveMode, type CursorBlinking, type EditorCursorStyle, type EditorSettings,
  type LineNumbersMode, type MinimapSide, type RenderWhitespace, type TerminalSettings, type WordWrapMode,
} from '@/store/settingsPersistence'
import { cleanApiKeyInput, saveApiKeys } from '@/utils/apiKeys'
import { ipcErrorMessage } from '@/utils/ipcResult'
import { PROJECT_LINKS } from '@/utils/projectLinks'

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
] satisfies { key: ApiKeyProvider; label: string; placeholder: string; color: string }[]

const DEFAULT_SYSTEM_PROMPT = 'You are Orion AI by Bebut, an expert coding assistant integrated into a code editor IDE. You help with code analysis, debugging, feature implementation, and code explanations. Be concise and helpful. Use markdown formatting for code blocks. Respond in the same language the user uses.'
const DEFAULT_USER_TEMPLATE = '{message}'

type CategoryId = 'general' | 'editor' | 'ai' | 'appearance' | 'terminal' | 'files' | 'shortcuts' | 'profiles' | 'about'

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

const TERMINAL_SHELLS = [
  { value: 'default', label: 'System Default' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'cmd', label: 'Command Prompt' },
  { value: 'bash', label: 'Git Bash' },
  { value: 'wsl', label: 'WSL' },
  { value: 'zsh', label: 'Zsh' },
]

const TERMINAL_FONTS = [
  'Cascadia Code',
  'Cascadia Mono',
  'Consolas',
  'Courier New',
  'Fira Code',
  'JetBrains Mono',
  'Menlo',
  'Monaco',
  'Source Code Pro',
  'Ubuntu Mono',
]

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
  { id: 'appearance', label: 'Appearance', icon: <Palette size={15} /> },
  { id: 'terminal', label: 'Terminal', icon: <Terminal size={15} /> },
  { id: 'files', label: 'Files', icon: <FileText size={15} /> },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: <Keyboard size={15} /> },
  { id: 'profiles', label: 'Profiles', icon: <User size={15} /> },
  { id: 'about', label: 'About', icon: <Info size={15} /> },
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
  // Keys are write-only from the renderer: the main process stores them
  // encrypted and only reports which providers are configured.
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null)
  const refreshKeyStatus = useCallback(async () => {
    try {
      setKeyStatus(await window.api.omoGetApiKeyStatus())
    } catch {
      setKeyStatus(null)
    }
  }, [])
  const removeApiKey = async (provider: string) => {
    await window.api.omoSetApiKeys({ [provider]: null } as ApiKeyPatch)
    setKeys((prev) => ({ ...prev, [provider]: '' }))
    await refreshKeyStatus()
  }
  const [systemPrompt, setSystemPrompt] = useState('')
  const [userTemplate, setUserTemplate] = useState('')
  const [saved, setSaved] = useState(false)
  // Why the last Save or Reset did not fully apply; shown in the footer.
  const [saveError, setSaveError] = useState<string | null>(null)
  // Per provider: why its typed key was not saved (the input keeps the key).
  const [keyErrors, setKeyErrors] = useState<Partial<Record<ApiKeyProvider, string>>>({})
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(DEFAULT_USER_SETTINGS.editor)
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_USER_SETTINGS.ai)
  const [terminalSettings, setTerminalSettings] = useState<TerminalSettings>(DEFAULT_USER_SETTINGS.terminal)
  const [newRuler, setNewRuler] = useState('')

  // Reset confirmation
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Workspace settings
  const rootPath = useFileStore((s) => s.rootPath)
  const wsSettings = useWorkspaceStore((s) => s.settings)
  const wsIsWorkspaceLevel = useWorkspaceStore((s) => s.isWorkspaceLevel)
  const wsLoadError = useWorkspaceStore((s) => s.loadError)
  const [wsLocal, setWsLocal] = useState<WorkspaceSettings>({ ...DEFAULT_WORKSPACE_SETTINGS })
  const [newExclude, setNewExclude] = useState('')
  const [wsSaved, setWsSaved] = useState(false)
  const [wsSaveError, setWsSaveError] = useState<string | null>(null)
  // Versions for the About tab, from the main process.
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)

  /** Show what is stored; also after a profile switch, so Save cannot write the old values back. */
  const loadStoredSettings = useCallback(() => {
    const stored = readStoredSettings()
    setEditorSettings(stored.editor)
    setTerminalSettings(stored.terminal)
    setAiSettings(stored.ai)
    setSystemPrompt(stored.prompts.systemPrompt)
    setUserTemplate(stored.prompts.userPromptTemplate)
  }, [])

  useEffect(() => {
    if (open) {
      void refreshKeyStatus()
      window.api.appGetInfo().then(setAppInfo, () => setAppInfo(null))
      loadStoredSettings()
      // Load workspace settings
      if (rootPath) {
        useWorkspaceStore.getState().loadWorkspaceSettings(rootPath)
      }
      setSaved(false)
      setSaveError(null)
      setKeyErrors({})
      setWsSaved(false)
      setWsSaveError(null)
    }
  }, [open])

  // Keep local workspace state in sync when store updates
  useEffect(() => {
    if (open) {
      setWsLocal({ ...wsSettings })
    }
  }, [wsSettings, open])

  const handleSave = async () => {
    setSaved(false)
    // Errors of an earlier save no longer apply once the key was cleared or replaced.
    setKeyErrors({})
    const problems: string[] = []

    // Send only keys the user typed; blank inputs leave stored keys alone.
    const enteredKeys = Object.fromEntries(Object.entries(keys).filter(([, value]) => cleanApiKeyInput(value)))
    if (Object.keys(enteredKeys).length > 0) {
      const errors = await saveApiKeys(enteredKeys)
      setKeyErrors(errors)
      // Clear the saved inputs; a rejected key stays so it can be corrected.
      setKeys((prev) => Object.fromEntries(Object.entries(prev).map(([provider, value]) => [provider, provider in errors ? value : ''])))
      const rejected = providers.filter((p) => p.key in errors).map((p) => p.label)
      if (rejected.length > 0) problems.push(`API key not saved for ${rejected.join(', ')}`)
      await refreshKeyStatus()
    }

    try {
      await applyUserSettings({
        editor: editorSettings,
        terminal: terminalSettings,
        ai: aiSettings,
        prompts: { systemPrompt, userPromptTemplate: userTemplate },
      })
    } catch (err) {
      problems.push(`Settings not applied: ${ipcErrorMessage(err)}`)
    }

    if (problems.length > 0) {
      setSaveError(problems.join('. '))
      return
    }
    setSaveError(null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  /** Store and apply the defaults right away, as Save would; Cancel cannot undo a confirmed reset. */
  const handleResetAll = async () => {
    setShowResetConfirm(false)
    setSaved(false)
    const defaults = DEFAULT_USER_SETTINGS
    setEditorSettings(defaults.editor)
    setTerminalSettings(defaults.terminal)
    setAiSettings(defaults.ai)
    setSystemPrompt(defaults.prompts.systemPrompt)
    setUserTemplate(defaults.prompts.userPromptTemplate)
    try {
      await applyUserSettings(defaults)
      setSaveError(null)
    } catch (err) {
      setSaveError(`Reset not applied: ${ipcErrorMessage(err)}`)
    }
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
                <SectionHeader title="Auto Save" />

                <SettingRow label="Auto Save Mode" description="Controls when files are automatically saved">
                  <SelectDropdown
                    value={editorSettings.autoSaveMode}
                    onChange={(v) => {
                      const mode = v as AutoSaveMode
                      setEditorSettings(s => ({ ...s, autoSaveMode: mode, autoSave: mode !== 'off' }))
                    }}
                    options={[
                      { value: 'off', label: 'Off' },
                      { value: 'afterDelay', label: 'After Delay' },
                      { value: 'onFocusChange', label: 'On Focus Change' },
                      { value: 'onWindowChange', label: 'On Window Change' },
                    ]}
                  />
                </SettingRow>

                {editorSettings.autoSaveMode === 'afterDelay' && (
                  <SettingRow label="Auto Save Delay" description="Delay before auto-saving after the last edit">
                    <SelectDropdown
                      value={String(editorSettings.autoSaveDelay)}
                      onChange={(v) => setEditorSettings(s => ({ ...s, autoSaveDelay: parseInt(v, 10) }))}
                      options={[
                        { value: '1000', label: '1 second' },
                        { value: '5000', label: '5 seconds' },
                        { value: '10000', label: '10 seconds' },
                        { value: '30000', label: '30 seconds' },
                      ]}
                    />
                  </SettingRow>
                )}

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
                    Text added before each message you send. Put <code style={{
                      background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: 3,
                      fontFamily: 'var(--font-mono, monospace)', fontSize: 11,
                    }}>{'{message}'}</code> in it to place your message somewhere else.
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
                {wsLoadError && (
                  <div role="alert" style={{ fontSize: 11, color: 'var(--accent-red, #f85149)', marginBottom: 4, lineHeight: 1.4 }}>
                    .orion/settings.json could not be read ({wsLoadError}). Fix the file and reopen Settings; it will not be overwritten until then.
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

                {/* Save workspace settings button */}
                <div style={{ paddingTop: 12 }}>
                  <button
                    disabled={!rootPath || !!wsLoadError}
                    onClick={async () => {
                      if (!rootPath) return
                      setWsSaveError(null)
                      try {
                        await useWorkspaceStore.getState().saveWorkspaceSettings(rootPath, wsLocal)
                        setWsSaved(true)
                        setTimeout(() => setWsSaved(false), 2000)
                      } catch (err) {
                        setWsSaveError(ipcErrorMessage(err))
                      }
                    }}
                    style={{
                      padding: '8px 16px', borderRadius: 6,
                      fontSize: 12, fontWeight: 600,
                      background: wsSaved ? 'var(--accent-green)' : !rootPath || wsLoadError ? 'var(--bg-hover)' : 'var(--accent-blue, #388bfd)',
                      color: !rootPath || wsLoadError ? 'var(--text-muted)' : '#fff',
                      border: 'none', cursor: rootPath && !wsLoadError ? 'pointer' : 'not-allowed',
                      transition: 'background 0.2s',
                    }}
                  >
                    {wsSaved ? '\u2713 Workspace Settings Saved' : 'Save to .orion/settings.json'}
                  </button>
                  {wsSaveError && (
                    <div role="alert" style={{ fontSize: 11, color: 'var(--accent-red, #f85149)', marginTop: 6, lineHeight: 1.4 }}>
                      Not saved: {wsSaveError}
                    </div>
                  )}
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

                <SettingRow label="Font Size" description="Editor font size in pixels (8-32)">
                  <NumberStepper value={editorSettings.fontSize} onChange={(v) => setEditorSettings(s => ({ ...s, fontSize: v }))} min={8} max={32} />
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

                <SectionHeader title="Indentation" />

                <SettingRow label="Tab Size" description="Number of spaces per tab">
                  <PillToggle value={editorSettings.tabSize} onChange={(v) => setEditorSettings(s => ({ ...s, tabSize: v }))} options={[2, 4, 8]} />
                </SettingRow>

                <SettingRow label="Insert Spaces" description="Use spaces instead of tab characters for indentation">
                  <Toggle checked={editorSettings.insertSpaces} onChange={(v) => setEditorSettings(s => ({ ...s, insertSpaces: v }))} />
                </SettingRow>

                <SectionHeader title="Cursor" />

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

                <SettingRow label="Cursor Blinking" description="Controls the cursor animation style">
                  <SelectDropdown
                    value={editorSettings.cursorBlinking}
                    onChange={(v) => setEditorSettings(s => ({ ...s, cursorBlinking: v as CursorBlinking }))}
                    options={[
                      { value: 'blink', label: 'Blink' },
                      { value: 'smooth', label: 'Smooth' },
                      { value: 'expand', label: 'Expand' },
                      { value: 'solid', label: 'Solid' },
                      { value: 'phase', label: 'Phase' },
                    ]}
                  />
                </SettingRow>

                <SectionHeader title="Text & Wrapping" />

                <SettingRow label="Word Wrap" description="Controls how long lines are wrapped in the editor">
                  <SelectDropdown
                    value={editorSettings.wordWrapMode}
                    onChange={(v) => {
                      const mode = v as WordWrapMode
                      setEditorSettings(s => ({ ...s, wordWrapMode: mode, wordWrap: mode !== 'off' }))
                    }}
                    options={[
                      { value: 'off', label: 'Off' },
                      { value: 'on', label: 'On' },
                      { value: 'wordWrapColumn', label: 'Wrap at Column' },
                      { value: 'bounded', label: 'Bounded' },
                    ]}
                  />
                </SettingRow>

                {(editorSettings.wordWrapMode === 'wordWrapColumn' || editorSettings.wordWrapMode === 'bounded') && (
                  <SettingRow label="Wrap Column" description="Column at which to wrap lines">
                    <NumberStepper value={editorSettings.wordWrapColumn} onChange={(v) => setEditorSettings(s => ({ ...s, wordWrapColumn: v }))} min={40} max={200} step={10} />
                  </SettingRow>
                )}

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

                <SettingRow label="Line Numbers" description="Controls line number display in the gutter">
                  <SelectDropdown
                    value={editorSettings.lineNumbersMode}
                    onChange={(v) => {
                      const mode = v as LineNumbersMode
                      setEditorSettings(s => ({ ...s, lineNumbersMode: mode, lineNumbers: mode !== 'off' }))
                    }}
                    options={[
                      { value: 'on', label: 'On' },
                      { value: 'off', label: 'Off' },
                      { value: 'relative', label: 'Relative' },
                      { value: 'interval', label: 'Interval (every 10)' },
                    ]}
                  />
                </SettingRow>

                <SectionHeader title="Rulers (Column Guides)" />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {(editorSettings.rulers || []).map((col) => (
                    <span key={col} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '3px 8px', borderRadius: 4,
                      background: 'var(--bg-primary)', border: '1px solid var(--border)',
                      fontSize: 11, color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)',
                    }}>
                      {col}
                      <button
                        onClick={() => setEditorSettings(s => ({ ...s, rulers: s.rulers.filter(r => r !== col) }))}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  {(editorSettings.rulers || []).length === 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No rulers configured</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input
                    value={newRuler}
                    onChange={(e) => setNewRuler(e.target.value)}
                    placeholder="Column (e.g. 80)"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = parseInt(newRuler, 10)
                        if (!isNaN(v) && v > 0 && v <= 300 && !(editorSettings.rulers || []).includes(v)) {
                          setEditorSettings(s => ({ ...s, rulers: [...(s.rulers || []), v].sort((a, b) => a - b) }))
                          setNewRuler('')
                        }
                      }
                    }}
                    style={{
                      width: 100, padding: '6px 10px',
                      background: 'var(--bg-primary)', border: '1px solid var(--border)',
                      borderRadius: 6, outline: 'none', fontSize: 12, color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  />
                  <button
                    onClick={() => {
                      const v = parseInt(newRuler, 10)
                      if (!isNaN(v) && v > 0 && v <= 300 && !(editorSettings.rulers || []).includes(v)) {
                        setEditorSettings(s => ({ ...s, rulers: [...(s.rulers || []), v].sort((a, b) => a - b) }))
                        setNewRuler('')
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

                <SectionHeader title="Navigation" />

                <SettingRow label="Minimap" description="Show code overview minimap">
                  <Toggle checked={editorSettings.minimap} onChange={(v) => setEditorSettings(s => ({ ...s, minimap: v }))} />
                </SettingRow>

                {editorSettings.minimap && (
                  <>
                    <SettingRow label="Minimap Side" description="Render minimap on the left or right">
                      <SelectDropdown
                        value={editorSettings.minimapSide}
                        onChange={(v) => setEditorSettings(s => ({ ...s, minimapSide: v as MinimapSide }))}
                        options={[
                          { value: 'right', label: 'Right' },
                          { value: 'left', label: 'Left' },
                        ]}
                      />
                    </SettingRow>

                    <SettingRow label="Minimap Max Column" description="Limit the width of the minimap rendering">
                      <NumberStepper value={editorSettings.minimapMaxColumn} onChange={(v) => setEditorSettings(s => ({ ...s, minimapMaxColumn: v }))} min={40} max={300} step={20} />
                    </SettingRow>
                  </>
                )}

                <SettingRow label="Sticky Scroll" description="Pin parent scopes at the top while scrolling">
                  <Toggle checked={editorSettings.stickyScroll} onChange={(v) => setEditorSettings(s => ({ ...s, stickyScroll: v }))} />
                </SettingRow>

                <SettingRow label="Smooth Scrolling" description="Animate scrolling in the editor">
                  <Toggle checked={editorSettings.smoothScrolling} onChange={(v) => setEditorSettings(s => ({ ...s, smoothScrolling: v }))} />
                </SettingRow>

                <SettingRow label="Bracket Pair Colorization" description="Colorize matching bracket pairs">
                  <Toggle checked={editorSettings.bracketPairColorization} onChange={(v) => setEditorSettings(s => ({ ...s, bracketPairColorization: v }))} />
                </SettingRow>

                <SectionHeader title="Save" />

                <SettingRow label="Format on Save" description="Automatically format the file when saving">
                  <Toggle checked={editorSettings.formatOnSave} onChange={(v) => setEditorSettings(s => ({ ...s, formatOnSave: v }))} />
                </SettingRow>

                <SettingRow label="Format on Paste" description="Automatically format pasted content">
                  <Toggle checked={editorSettings.formatOnPaste} onChange={(v) => setEditorSettings(s => ({ ...s, formatOnPaste: v }))} />
                </SettingRow>

                <SettingRow label="Trim Trailing Whitespace" description="Remove trailing whitespace from lines when saving">
                  <Toggle checked={editorSettings.trimTrailingWhitespace} onChange={(v) => setEditorSettings(s => ({ ...s, trimTrailingWhitespace: v }))} />
                </SettingRow>

                <SettingRow label="Insert Final Newline" description="Ensure files end with a newline when saving">
                  <Toggle checked={editorSettings.insertFinalNewline} onChange={(v) => setEditorSettings(s => ({ ...s, insertFinalNewline: v }))} />
                </SettingRow>
              </div>
            )}

            {/* ---- AI / MODELS ---- */}
            {activeCategory === 'ai' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 4 }}>
                  The chat model is chosen with the model selector in the chat panel.
                </p>

                <SectionHeader title="Inline Completions" />

                <SettingRow label="Ghost Text Completions" description="Show AI-powered inline code suggestions as you type">
                  <Toggle checked={aiSettings.ghostTextEnabled} onChange={(v) => setAiSettings(s => ({ ...s, ghostTextEnabled: v }))} />
                </SettingRow>

                {aiSettings.ghostTextEnabled && (
                  <SettingRow
                    label="Completion Provider"
                    description={
                      aiSettings.completionProvider === 'anthropic'
                        ? 'Claude Haiku 5.5 with your Anthropic API key. Every typing pause sends a billed request.'
                        : 'Local (Ollama) is free and keeps your code on this machine. Needs Ollama running with a model installed.'
                    }
                  >
                    <SelectDropdown
                      value={aiSettings.completionProvider}
                      onChange={(v) => setAiSettings(s => ({ ...s, completionProvider: v as CompletionProviderSetting }))}
                      options={[
                        { value: 'ollama', label: 'Local (Ollama)' },
                        { value: 'anthropic', label: 'Claude Haiku 5.5 (API key, billed)' },
                      ]}
                    />
                  </SettingRow>
                )}

                {aiSettings.ghostTextEnabled && (
                  <SettingRow label="Completion Delay" description="Delay in ms before showing inline suggestions">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="number"
                        value={aiSettings.completionDelay}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10)
                          if (!isNaN(v) && v >= 50 && v <= 3000) setAiSettings(s => ({ ...s, completionDelay: v }))
                        }}
                        style={{
                          width: 70, padding: '4px 8px',
                          background: 'var(--bg-primary)', border: '1px solid var(--border)',
                          borderRadius: 6, outline: 'none', fontSize: 12, color: 'var(--text-primary)',
                          textAlign: 'center',
                        }}
                      />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ms</span>
                    </div>
                  </SettingRow>
                )}

                <SectionHeader title="API Keys" />
                <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
                  Enter your API keys to enable AI responses. Keys are encrypted with your operating system&apos;s keychain,
                  are never shown again after saving, and are never sent to Orion servers.
                </p>
                {keyStatus && !keyStatus.encryptionAvailable && (
                  <p style={{ fontSize: 12, color: 'var(--accent-orange, #d29922)', lineHeight: 1.5, marginBottom: 8 }}>
                    OS encryption is unavailable, so keys are kept only until Orion quits.
                  </p>
                )}
                {providers.map(({ key, label, placeholder, color }) => {
                  const saved = Boolean(keyStatus?.configured[key])
                  const keyError = keyErrors[key]
                  return (
                  <div key={key} style={{ marginBottom: 12 }}>
                    <label style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
                      marginBottom: 6,
                    }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: keys[key] || saved ? color : 'var(--text-muted)',
                      }} />
                      {label}
                      {saved && <Check size={12} style={{ color: 'var(--accent-green)', marginLeft: 4 }} />}
                      {saved && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>saved</span>}
                    </label>
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 8, overflow: 'hidden',
                    }}>
                      <input
                        type={showKey[key] ? 'text' : 'password'}
                        value={keys[key] || ''}
                        onChange={(e) => setKeys({ ...keys, [key]: e.target.value })}
                        placeholder={saved ? 'Saved — paste a new key to replace it' : placeholder}
                        autoComplete="off"
                        spellCheck={false}
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
                      {saved && (
                        <button
                          onClick={() => void removeApiKey(key)}
                          title={`Remove saved ${label} key`}
                          aria-label={`Remove saved ${label} key`}
                          style={{ padding: '8px 10px', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    {keyError && (
                      <div role="alert" style={{ fontSize: 11, color: 'var(--accent-red, #f85149)', marginTop: 4 }}>
                        Not saved: {keyError}
                      </div>
                    )}
                  </div>
                  )
                })}
                {/* Earlier versions offered a Custom Provider key that nothing ever used; it can still be removed. */}
                {keyStatus?.configured.custom && (
                  <SettingRow label="Old Custom Provider key" description="Saved by an earlier version of Orion. Nothing uses it.">
                    <button
                      onClick={() => void removeApiKey('custom')}
                      aria-label="Remove saved Custom Provider key"
                      style={{
                        padding: '5px 12px', borderRadius: 6, fontSize: 11,
                        background: 'transparent', border: '1px solid var(--border)',
                        color: 'var(--accent-red, #f85149)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                  </SettingRow>
                )}
              </div>
            )}

            {/* ---- APPEARANCE (replaces Theme) ---- */}
            {activeCategory === 'appearance' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <ThemePicker />
              </div>
            )}

            {/* ---- TERMINAL ---- */}
            {activeCategory === 'terminal' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <SectionHeader title="Shell" />

                <SettingRow label="Default Shell" description="Shell program to launch in new terminal instances">
                  <SelectDropdown
                    value={terminalSettings.defaultShell}
                    onChange={(v) => setTerminalSettings(s => ({ ...s, defaultShell: v }))}
                    options={TERMINAL_SHELLS}
                  />
                </SettingRow>

                <SectionHeader title="Terminal Appearance" />

                <SettingRow label="Font Family" description="Font face used in the terminal">
                  <SelectDropdown
                    value={terminalSettings.fontFamily}
                    onChange={(v) => setTerminalSettings(s => ({ ...s, fontFamily: v }))}
                    options={TERMINAL_FONTS.map(f => ({ value: f, label: f }))}
                  />
                </SettingRow>

                <SettingRow label="Font Size" description="Terminal font size in pixels">
                  <NumberStepper value={terminalSettings.fontSize} onChange={(v) => setTerminalSettings(s => ({ ...s, fontSize: v }))} min={8} max={28} />
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

            {/* ---- FILES ---- */}
            {activeCategory === 'files' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <SectionHeader title="Auto Save" />

                <SettingRow label="Auto Save Mode" description="Controls when files are automatically saved">
                  <SelectDropdown
                    value={editorSettings.autoSaveMode}
                    onChange={(v) => {
                      const mode = v as AutoSaveMode
                      setEditorSettings(s => ({ ...s, autoSaveMode: mode, autoSave: mode !== 'off' }))
                    }}
                    options={[
                      { value: 'off', label: 'Off' },
                      { value: 'afterDelay', label: 'After Delay' },
                      { value: 'onFocusChange', label: 'On Focus Change' },
                      { value: 'onWindowChange', label: 'On Window Change' },
                    ]}
                  />
                </SettingRow>

                {editorSettings.autoSaveMode === 'afterDelay' && (
                  <SettingRow label="Auto Save Delay" description="Delay before auto-saving after the last edit">
                    <SelectDropdown
                      value={String(editorSettings.autoSaveDelay)}
                      onChange={(v) => setEditorSettings(s => ({ ...s, autoSaveDelay: parseInt(v, 10) }))}
                      options={[
                        { value: '1000', label: '1 second' },
                        { value: '5000', label: '5 seconds' },
                        { value: '10000', label: '10 seconds' },
                        { value: '30000', label: '30 seconds' },
                      ]}
                    />
                  </SettingRow>
                )}

                <SectionHeader title="Save Behavior" />

                <SettingRow label="Trim Trailing Whitespace" description="Remove trailing whitespace from lines when saving">
                  <Toggle checked={editorSettings.trimTrailingWhitespace} onChange={(v) => setEditorSettings(s => ({ ...s, trimTrailingWhitespace: v }))} />
                </SettingRow>

                <SettingRow label="Insert Final Newline" description="Ensure files end with a newline character when saving">
                  <Toggle checked={editorSettings.insertFinalNewline} onChange={(v) => setEditorSettings(s => ({ ...s, insertFinalNewline: v }))} />
                </SettingRow>

                <SettingRow label="Format on Save" description="Automatically format the file when saving">
                  <Toggle checked={editorSettings.formatOnSave} onChange={(v) => setEditorSettings(s => ({ ...s, formatOnSave: v }))} />
                </SettingRow>
              </div>
            )}

            {/* ---- PROFILES ---- */}
            {activeCategory === 'profiles' && <ProfilesPanel onProfileSwitched={loadStoredSettings} />}

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

            {/* ---- ABOUT ---- */}
            {activeCategory === 'about' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <SectionHeader title="Application" />

                <div style={{
                  display: 'flex', alignItems: 'center', gap: 16,
                  padding: '20px 16px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  marginBottom: 8,
                }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 12,
                    background: 'linear-gradient(135deg, var(--accent-blue, #388bfd), var(--accent-purple, #a371f7))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 22, fontWeight: 700, color: '#fff',
                    flexShrink: 0,
                  }}>
                    O
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                      Orion IDE
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      Version {appInfo?.version || 'N/A'}
                    </div>
                  </div>
                </div>

                <SettingRow label="Version" description="Current application version">
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary)' }}>{appInfo?.version || 'N/A'}</span>
                </SettingRow>

                <SettingRow label="Electron" description="Electron runtime version">
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary)' }}>{appInfo?.electron || 'N/A'}</span>
                </SettingRow>

                <SettingRow label="Chrome" description="Chromium engine version">
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary)' }}>{navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || 'N/A'}</span>
                </SettingRow>

                <SettingRow label="Platform" description="Operating system">
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary)' }}>{navigator.platform || 'N/A'}</span>
                </SettingRow>

                <SectionHeader title="System" />

                <SettingRow label="Language" description="System language">
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary)' }}>{navigator.language}</span>
                </SettingRow>

                <SettingRow label="Logical Processors" description="Available CPU cores">
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary)' }}>{navigator.hardwareConcurrency || 'N/A'}</span>
                </SettingRow>

                <SettingRow label="Memory" description="Device memory (approximate)">
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary)' }}>{(navigator as unknown as Record<string, unknown>).deviceMemory ? `${(navigator as unknown as Record<string, unknown>).deviceMemory} GB` : 'N/A'}</span>
                </SettingRow>

                <SectionHeader title="Links" />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                  {([
                    ['Documentation', PROJECT_LINKS.readme],
                    ['Report Issue', PROJECT_LINKS.issues],
                    ['Release Notes', PROJECT_LINKS.releases],
                    ['License', PROJECT_LINKS.license],
                  ] as const).map(([label, url]) => (
                    <a
                      key={label}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 12, color: 'var(--accent-blue, #388bfd)',
                        textDecoration: 'none', padding: '4px 0',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline' }}
                      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none' }}
                    >
                      {label}
                    </a>
                  ))}
                </div>

                <SectionHeader title="Legal" />
                <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Copyright 2024-2026 Orion Team. All rights reserved.
                  <br />
                  Built with Electron, React, and Monaco Editor.
                </p>
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
          {/* Reset to Defaults button */}
          {!showResetConfirm ? (
            <button
              onClick={() => setShowResetConfirm(true)}
              style={{
                padding: '6px 16px', borderRadius: 6,
                fontSize: 12, color: 'var(--accent-red, #f85149)',
                background: 'transparent', border: '1px solid var(--accent-red, #f85149)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                marginRight: 'auto',
              }}
            >
              <RotateCcw size={12} /> Reset to Defaults
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 'auto' }}>
              <span style={{ fontSize: 11, color: 'var(--accent-red, #f85149)', fontWeight: 600 }}>Reset editor, terminal, completion and prompt settings?</span>
              <button
                onClick={() => void handleResetAll()}
                style={{
                  padding: '5px 12px', borderRadius: 6,
                  fontSize: 11, fontWeight: 600,
                  background: 'var(--accent-red, #f85149)', color: '#fff',
                  border: 'none', cursor: 'pointer',
                }}
              >
                Confirm
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                style={{
                  padding: '5px 12px', borderRadius: 6,
                  fontSize: 11,
                  background: 'var(--bg-hover)', color: 'var(--text-secondary)',
                  border: 'none', cursor: 'pointer',
                }}
              >
                No
              </button>
            </div>
          )}
          {saveError && (
            <span role="alert" style={{ fontSize: 11, color: 'var(--accent-red, #f85149)', alignSelf: 'center', maxWidth: 320 }}>
              {saveError}
            </span>
          )}
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
            onClick={() => void handleSave()}
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

function ProfilesPanel({ onProfileSwitched }: { onProfileSwitched: () => void }) {
  const { profiles, activeProfileId, createProfile, switchProfile, updateProfile, deleteProfile, renameProfile, exportProfile, importProfile, _load } = useProfileStore()
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('\u{1F4BB}')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [importJson, setImportJson] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)

  useEffect(() => { _load() }, [])

  const iconOptions = ['\u{1F4BB}', '\u{1F3E0}', '\u{1F680}', '\u{1F3A8}', '\u2699\uFE0F', '\u{1F4DA}', '\u{1F4A1}', '\u26A1', '\u{1F527}', '\u{1F9EA}', '\u{1F33F}', '\u{1F525}']

  const showFeedback = (text: string, error = false) => {
    setFeedback({ text, error })
    setTimeout(() => setFeedback(null), 2000)
  }

  const handleSwitch = async (id: string) => {
    try {
      await switchProfile(id)
    } catch (err) {
      showFeedback(`Could not switch profile: ${ipcErrorMessage(err)}`, true)
    } finally {
      // The modal's other tabs must show the values now stored.
      onProfileSwitched()
    }
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
                    onClick={() => void handleSwitch(profile.id)}
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
          fontSize: 12, color: feedback.error ? 'var(--accent-red, #f85149)' : 'var(--accent-green, #3fb950)', fontWeight: 600,
          padding: '6px 0', textAlign: 'center',
        }}>{feedback.text}</div>
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
                border: '1px solid var(--border)',
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
