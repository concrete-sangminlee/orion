import { useState, useEffect } from 'react'
import { X, Key, Check, Eye, EyeOff, MessageSquare, Sparkles, Code, Monitor, Palette, FolderCog, Plus, Trash2 } from 'lucide-react'
import { useThemeStore } from '@/store/theme'
import { useWorkspaceStore, DEFAULT_WORKSPACE_SETTINGS } from '@/store/workspace'
import { useFileStore } from '@/store/files'
import type { Theme } from '@/themes'
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

type TabId = 'keys' | 'prompts' | 'editor' | 'themes' | 'workspace'

interface EditorSettings {
  fontSize: number
  wordWrap: boolean
  minimap: boolean
  autoSave: boolean
  tabSize: number
  lineNumbers: boolean
  bracketPairColorization: boolean
}

export default function SettingsModal({ open, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('keys')
  const [keys, setKeys] = useState<Record<string, string>>({
    anthropic: '', openai: '', nvidia: '', kimi: '', gemini: '',
  })
  const [showKey, setShowKey] = useState<Record<string, boolean>>({})
  const [systemPrompt, setSystemPrompt] = useState('')
  const [userTemplate, setUserTemplate] = useState('')
  const [saved, setSaved] = useState(false)
  const [editorSettings, setEditorSettings] = useState<EditorSettings>({
    fontSize: 13, wordWrap: false, minimap: true, autoSave: true,
    tabSize: 2, lineNumbers: true, bracketPairColorization: true,
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
        if (storedEditor) setEditorSettings({ ...editorSettings, ...JSON.parse(storedEditor) })
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
    // Dispatch editor config update event
    window.dispatchEvent(new CustomEvent('orion:editor-config', { detail: editorSettings }))

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!open) return null

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'keys', label: 'API Keys', icon: <Key size={13} /> },
    { id: 'prompts', label: 'Prompts', icon: <MessageSquare size={13} /> },
    { id: 'editor', label: 'Editor', icon: <Code size={13} /> },
    { id: 'themes', label: 'Themes', icon: <Palette size={13} /> },
    { id: 'workspace', label: 'Workspace', icon: <FolderCog size={13} /> },
  ]

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
          width: 520, maxHeight: '85vh',
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
          <Sparkles size={16} style={{ color: 'var(--accent)', marginRight: 10 }} />
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

        {/* Tabs */}
        <div style={{
          display: 'flex', borderBottom: '1px solid var(--border)',
          padding: '0 16px',
        }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 14px',
                fontSize: 12, fontWeight: activeTab === tab.id ? 600 : 400,
                color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                background: 'transparent', border: 'none', borderBottomStyle: 'solid',
                cursor: 'pointer',
                transition: 'color 0.15s',
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {activeTab === 'keys' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Enter your API keys to enable AI responses. Keys are stored locally.
              </p>
              {providers.map(({ key, label, placeholder, color }) => (
                <div key={key}>
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

          {activeTab === 'editor' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Customize the code editor appearance and behavior.
              </p>

              {/* Font Size */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Font Size</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Editor font size in pixels</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => setEditorSettings(s => ({ ...s, fontSize: Math.max(10, s.fontSize - 1) }))}
                    style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>-</button>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', minWidth: 28, textAlign: 'center' }}>{editorSettings.fontSize}</span>
                  <button onClick={() => setEditorSettings(s => ({ ...s, fontSize: Math.min(28, s.fontSize + 1) }))}
                    style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                </div>
              </div>

              {/* Tab Size */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Tab Size</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Number of spaces per tab</div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[2, 4, 8].map(n => (
                    <button key={n}
                      onClick={() => setEditorSettings(s => ({ ...s, tabSize: n }))}
                      style={{
                        width: 32, height: 28, borderRadius: 6, fontSize: 12, fontWeight: 600,
                        background: editorSettings.tabSize === n ? 'var(--accent)' : 'var(--bg-primary)',
                        color: editorSettings.tabSize === n ? '#fff' : 'var(--text-secondary)',
                        border: editorSettings.tabSize === n ? 'none' : '1px solid var(--border)',
                        cursor: 'pointer', transition: 'background 0.15s',
                      }}>{n}</button>
                  ))}
                </div>
              </div>

              {/* Toggle Settings */}
              {([
                ['wordWrap', 'Word Wrap', 'Wrap long lines at the editor width'],
                ['minimap', 'Minimap', 'Show code overview on the right side'],
                ['autoSave', 'Auto Save', 'Automatically save files after 2 seconds'],
                ['lineNumbers', 'Line Numbers', 'Show line numbers in the gutter'],
                ['bracketPairColorization', 'Bracket Colorization', 'Colorize matching brackets'],
              ] as const).map(([key, label, desc]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{desc}</div>
                  </div>
                  <button
                    onClick={() => setEditorSettings(s => ({ ...s, [key]: !s[key] }))}
                    style={{
                      width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
                      background: editorSettings[key] ? 'var(--accent)' : 'var(--bg-hover)',
                      position: 'relative', transition: 'background 0.2s',
                      flexShrink: 0,
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 3, left: editorSettings[key] ? 21 : 3,
                      width: 16, height: 16, borderRadius: '50%',
                      background: '#fff', transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                    }} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'prompts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Customize how the AI behaves and responds. Changes apply to new conversations.
              </p>

              {/* System Prompt */}
              <div>
                <label style={{
                  display: 'block', fontSize: 12, fontWeight: 600,
                  color: 'var(--text-primary)', marginBottom: 4,
                }}>
                  System Prompt
                </label>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
                  Instructions that define how the AI behaves. Leave empty to use default.
                </p>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder={DEFAULT_SYSTEM_PROMPT}
                  rows={5}
                  style={{
                    width: '100%', padding: '10px 12px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 8, outline: 'none',
                    fontSize: 12, color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono, monospace)',
                    resize: 'vertical', minHeight: 80, maxHeight: 200,
                    lineHeight: 1.5,
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                />
              </div>

              {/* User Prompt Template */}
              <div>
                <label style={{
                  display: 'block', fontSize: 12, fontWeight: 600,
                  color: 'var(--text-primary)', marginBottom: 4,
                }}>
                  User Prompt Template
                </label>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
                  Template prepended to your messages. Use <code style={{
                    background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: 3,
                    fontFamily: 'var(--font-mono, monospace)', fontSize: 11,
                  }}>{'{message}'}</code> as placeholder for your input.
                </p>
                <textarea
                  value={userTemplate}
                  onChange={(e) => setUserTemplate(e.target.value)}
                  placeholder={DEFAULT_USER_TEMPLATE}
                  rows={3}
                  style={{
                    width: '100%', padding: '10px 12px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 8, outline: 'none',
                    fontSize: 12, color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono, monospace)',
                    resize: 'vertical', minHeight: 60, maxHeight: 150,
                    lineHeight: 1.5,
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                />
              </div>
            </div>
          )}

          {activeTab === 'themes' && <ThemePicker />}

          {activeTab === 'workspace' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Workspace-specific settings{rootPath ? '' : ' (open a folder first)'}.
                {wsIsWorkspaceLevel && (
                  <span style={{ color: 'var(--accent-green)', marginLeft: 6, fontSize: 11 }}>
                    Loaded from .orion/settings.json
                  </span>
                )}
              </p>

              {/* Exclude Patterns */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                  Exclude Patterns
                </div>
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
                      background: 'var(--accent)', color: '#fff', cursor: 'pointer',
                      fontSize: 12, display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
              </div>

              {/* Toggle settings */}
              {([
                ['autoSave', 'Auto Save', 'Automatically save files when switching tabs'],
                ['formatOnSave', 'Format on Save', 'Format the file each time it is saved'],
                ['insertSpaces', 'Insert Spaces', 'Use spaces instead of tabs for indentation'],
              ] as const).map(([key, label, desc]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{desc}</div>
                  </div>
                  <button
                    onClick={() => setWsLocal(s => ({ ...s, [key]: !s[key] }))}
                    style={{
                      width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
                      background: wsLocal[key] ? 'var(--accent)' : 'var(--bg-hover)',
                      position: 'relative', transition: 'background 0.2s',
                      flexShrink: 0,
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 3, left: wsLocal[key] ? 21 : 3,
                      width: 16, height: 16, borderRadius: '50%',
                      background: '#fff', transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                    }} />
                  </button>
                </div>
              ))}

              {/* Tab Size */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Tab Size</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Number of spaces per tab (workspace)</div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[2, 4, 8].map(n => (
                    <button key={n}
                      onClick={() => setWsLocal(s => ({ ...s, tabSize: n }))}
                      style={{
                        width: 32, height: 28, borderRadius: 6, fontSize: 12, fontWeight: 600,
                        background: wsLocal.tabSize === n ? 'var(--accent)' : 'var(--bg-primary)',
                        color: wsLocal.tabSize === n ? '#fff' : 'var(--text-secondary)',
                        border: wsLocal.tabSize === n ? 'none' : '1px solid var(--border)',
                        cursor: 'pointer', transition: 'background 0.15s',
                      }}>{n}</button>
                  ))}
                </div>
              </div>

              {/* File Associations */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                  File Associations
                </div>
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
                        <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--accent)' }}>.{ext}</span>
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
                      background: 'var(--accent)', color: '#fff', cursor: 'pointer',
                      fontSize: 12, display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
              </div>

              {/* Save workspace settings button */}
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
                  background: wsSaved ? 'var(--accent-green)' : !rootPath ? 'var(--bg-hover)' : 'var(--accent)',
                  color: !rootPath ? 'var(--text-muted)' : '#fff',
                  border: 'none', cursor: rootPath ? 'pointer' : 'not-allowed',
                  transition: 'background 0.2s',
                  alignSelf: 'flex-start',
                }}
              >
                {wsSaved ? '\u2713 Workspace Settings Saved' : 'Save to .orion/settings.json'}
              </button>
            </div>
          )}
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
              background: saved ? 'var(--accent-green)' : 'var(--accent)',
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
/*  Theme Picker sub-component (rendered in the Themes tab)    */
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

function ThemePicker() {
  const { themes: allThemes, activeThemeId, setTheme } = useThemeStore()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Choose a color theme. The change is applied immediately.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {allThemes.map((theme) => {
          const isActive = theme.id === activeThemeId
          return (
            <button
              key={theme.id}
              onClick={() => setTheme(theme.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                background: isActive ? 'rgba(88,166,255,0.08)' : 'var(--bg-primary)',
                border: isActive ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'background 0.15s, border-color 0.15s',
                width: '100%',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.borderColor = 'var(--border-bright)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.borderColor = 'var(--border)'
              }}
            >
              {/* Color swatches */}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {SWATCH_KEYS.map((key) => (
                  <span
                    key={key}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      background: theme.colors[key] || '#333',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  />
                ))}
              </div>

              {/* Label */}
              <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                {theme.name}
              </span>

              {/* Checkmark */}
              {isActive && (
                <Check size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
