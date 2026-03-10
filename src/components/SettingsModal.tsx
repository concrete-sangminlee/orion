import { useState, useEffect } from 'react'
import { X, Key, Check, Eye, EyeOff, MessageSquare, Sparkles } from 'lucide-react'

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

type TabId = 'keys' | 'prompts'

export default function SettingsModal({ open, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('keys')
  const [keys, setKeys] = useState<Record<string, string>>({
    anthropic: '', openai: '', nvidia: '', kimi: '', gemini: '',
  })
  const [showKey, setShowKey] = useState<Record<string, boolean>>({})
  const [systemPrompt, setSystemPrompt] = useState('')
  const [userTemplate, setUserTemplate] = useState('')
  const [saved, setSaved] = useState(false)

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
      } catch {}
      setSaved(false)
    }
  }, [open])

  const handleSave = async () => {
    localStorage.setItem('orion-api-keys', JSON.stringify(keys))
    await window.api?.omoSetApiKeys(keys)

    const prompts = {
      systemPrompt: systemPrompt || '',
      userPromptTemplate: userTemplate || '',
    }
    localStorage.setItem('orion-prompts', JSON.stringify(prompts))
    await window.api?.omoSetPrompts(prompts)

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!open) return null

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'keys', label: 'API Keys', icon: <Key size={13} /> },
    { id: 'prompts', label: 'Prompts', icon: <MessageSquare size={13} /> },
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
