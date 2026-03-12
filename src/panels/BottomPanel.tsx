import { useState, useCallback } from 'react'
import TerminalPanel from './TerminalPanel'
import ProblemsPanel from './ProblemsPanel'
import OutputPanel from './OutputPanel'
import { useAgentStore } from '@/store/agents'
import { useProblemsStore } from '@/store/problems'
import { useOutputStore } from '@/store/output'
import {
  Terminal, Activity, AlertTriangle, FileOutput,
  ChevronRight, AlertCircle, Info, Zap, Plus, X, Trash2,
} from 'lucide-react'
import { v4 as uuid } from 'uuid'

type Tab = 'terminal' | 'agent-log' | 'problems' | 'output'

const tabs: { id: Tab; label: string; Icon: typeof Terminal }[] = [
  { id: 'terminal', label: 'Terminal', Icon: Terminal },
  { id: 'agent-log', label: 'Agent Log', Icon: Activity },
  { id: 'problems', label: 'Problems', Icon: AlertTriangle },
  { id: 'output', label: 'Output', Icon: FileOutput },
]

/* ── Log type styling ──────────────────────────────────── */

const logTypeConfig: Record<string, { color: string; borderColor: string; Icon: typeof Info }> = {
  info:       { color: 'var(--accent)',        borderColor: 'rgba(88,166,255,0.3)',  Icon: Info },
  action:     { color: 'var(--accent-green)',  borderColor: 'rgba(63,185,80,0.3)',   Icon: Zap },
  delegation: { color: 'var(--accent-purple)', borderColor: 'rgba(188,140,255,0.3)', Icon: ChevronRight },
  error:      { color: 'var(--accent-red)',    borderColor: 'rgba(248,81,73,0.3)',   Icon: AlertCircle },
}

/* ── Main component ────────────────────────────────────── */

interface TermInstance {
  id: string
  name: string
}

export default function BottomPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('terminal')
  const [terminals, setTerminals] = useState<TermInstance[]>([{ id: uuid(), name: 'Terminal 1' }])
  const [activeTerminal, setActiveTerminal] = useState<string>(() => terminals[0]?.id || '')
  const logs = useAgentStore((s) => s.logs)

  const addTerminal = useCallback(() => {
    const num = terminals.length + 1
    const t: TermInstance = { id: uuid(), name: `Terminal ${num}` }
    setTerminals(prev => [...prev, t])
    setActiveTerminal(t.id)
    setActiveTab('terminal')
  }, [terminals.length])

  const closeTerminal = useCallback((id: string) => {
    setTerminals(prev => {
      const next = prev.filter(t => t.id !== id)
      if (next.length === 0) {
        const t: TermInstance = { id: uuid(), name: 'Terminal 1' }
        setActiveTerminal(t.id)
        return [t]
      }
      if (activeTerminal === id) setActiveTerminal(next[0].id)
      return next
    })
  }, [activeTerminal])

  // Output channel info
  const outputActiveChannel = useOutputStore((s) => s.activeChannel)
  const outputChannels = useOutputStore((s) => s.channels)
  const outputLineCount = outputChannels.get(outputActiveChannel)?.length ?? 0

  // Counts for badges
  const problems = useProblemsStore((s) => s.problems)
  const problemsErrorCount = problems.filter((p) => p.severity === 'error').length
  const problemsWarningCount = problems.filter((p) => p.severity === 'warning').length
  const problemsBadge = problemsErrorCount + problemsWarningCount
  const logCount = logs.length

  return (
    <div
      className="h-full flex flex-col"
      style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-primary)',
      }}
    >
      {/* Tab Bar */}
      <div
        className="shrink-0 flex items-center px-1 gap-0"
        style={{
          height: 32,
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {tabs.map(({ id, label, Icon }) => {
          const isActive = activeTab === id
          const badge =
            id === 'problems'
              ? problemsBadge
              : id === 'agent-log'
                ? logCount
                : id === 'output'
                  ? outputLineCount
                  : 0
          // Show channel name in Output tab when not Main
          const displayLabel =
            id === 'output' && outputActiveChannel !== 'Main'
              ? `${label}: ${outputActiveChannel}`
              : label

          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex items-center gap-1.5 transition-colors duration-100 relative"
              style={{
                height: 32,
                padding: '0 12px',
                fontSize: 11,
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: isActive ? 500 : 400,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--text-muted)'
              }}
            >
              <Icon size={12} />
              {displayLabel}

              {/* Badge */}
              {badge > 0 && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 4px',
                    background:
                      id === 'problems'
                        ? 'rgba(248,81,73,0.15)'
                        : 'rgba(88,166,255,0.12)',
                    color:
                      id === 'problems'
                        ? 'var(--accent-red)'
                        : 'var(--accent)',
                    fontFamily: 'var(--font-mono, monospace)',
                  }}
                >
                  {badge > 99 ? '99+' : badge}
                </span>
              )}

              {/* Active bottom accent line */}
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 8,
                    right: 8,
                    height: 2,
                    background: 'var(--accent)',
                    borderRadius: '2px 2px 0 0',
                  }}
                />
              )}
            </button>
          )
        })}

        {/* Right side: terminal sub-tabs + controls */}
        <div className="ml-auto flex items-center gap-1" style={{ paddingRight: 4 }}>
          {activeTab === 'terminal' && (
            <>
              {terminals.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTerminal(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    height: 22, padding: '0 6px',
                    fontSize: 10, borderRadius: 3,
                    color: activeTerminal === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
                    background: activeTerminal === t.id ? 'rgba(255,255,255,0.06)' : 'transparent',
                    border: 'none', cursor: 'pointer',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (activeTerminal !== t.id) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                  onMouseLeave={e => { if (activeTerminal !== t.id) e.currentTarget.style.background = 'transparent' }}
                >
                  <Terminal size={10} />
                  {t.name}
                  {terminals.length > 1 && (
                    <span
                      onClick={e => { e.stopPropagation(); closeTerminal(t.id) }}
                      style={{ display: 'flex', marginLeft: 2, opacity: 0.5, cursor: 'pointer' }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0.5' }}
                    >
                      <X size={10} />
                    </span>
                  )}
                </button>
              ))}
              <button
                onClick={addTerminal}
                title="New Terminal"
                style={{
                  width: 22, height: 22,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 3, border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', background: 'transparent',
                  transition: 'background 0.1s, color 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                <Plus size={12} />
              </button>
              <button
                onClick={() => closeTerminal(activeTerminal)}
                title="Kill Terminal"
                style={{
                  width: 22, height: 22,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 3, border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', background: 'transparent',
                  transition: 'background 0.1s, color 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                <Trash2 size={12} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'terminal' && terminals.map(t => (
          <div key={t.id} style={{ height: '100%', display: activeTerminal === t.id ? 'block' : 'none' }}>
            <TerminalPanel key={t.id} sessionId={t.id} />
          </div>
        ))}

        {activeTab === 'agent-log' && (
          <div
            className="h-full overflow-y-auto"
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 11,
              padding: '4px 0',
            }}
          >
            {logs.length === 0 ? (
              <EmptyTabContent
                Icon={Activity}
                message="No agent activity yet"
                sub="Agent actions and decisions will appear here"
              />
            ) : (
              logs.map((log) => {
                const config = logTypeConfig[log.type] || logTypeConfig.info
                return (
                  <div
                    key={log.id}
                    className="flex items-start gap-2"
                    style={{
                      padding: '4px 10px 4px 10px',
                      borderLeft: `2px solid ${config.borderColor}`,
                      marginLeft: 4,
                      marginBottom: 1,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    {/* Timestamp */}
                    <span
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 10,
                        flexShrink: 0,
                        width: 62,
                        opacity: 0.6,
                        paddingTop: 1,
                      }}
                    >
                      {new Date(log.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>

                    {/* Type icon */}
                    <config.Icon
                      size={11}
                      style={{
                        color: config.color,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    />

                    {/* Agent name */}
                    <span
                      style={{
                        flexShrink: 0,
                        fontWeight: 600,
                        color: 'var(--accent)',
                        fontSize: 11,
                        minWidth: 60,
                      }}
                    >
                      {log.agentId}
                    </span>

                    {/* Message */}
                    <span
                      style={{
                        color: 'var(--text-secondary)',
                        lineHeight: 1.5,
                        wordBreak: 'break-word',
                      }}
                    >
                      {log.message}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        )}

        {activeTab === 'problems' && <ProblemsPanel />}

        {activeTab === 'output' && <OutputPanel />}
      </div>
    </div>
  )
}

/* ── Empty tab content ─────────────────────────────────── */

function EmptyTabContent({
  Icon,
  message,
  sub,
}: {
  Icon: typeof Terminal
  message: string
  sub: string
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2">
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={18} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
      </div>
      <p
        style={{
          color: 'var(--text-muted)',
          fontSize: 12,
          fontWeight: 500,
          marginTop: 4,
        }}
      >
        {message}
      </p>
      <p
        style={{
          color: 'var(--text-muted)',
          fontSize: 11,
          opacity: 0.5,
        }}
      >
        {sub}
      </p>
    </div>
  )
}
