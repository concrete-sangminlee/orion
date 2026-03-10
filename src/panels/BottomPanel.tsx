import { useState } from 'react'
import TerminalPanel from './TerminalPanel'
import { useAgentStore } from '@/store/agents'
import {
  Terminal, Activity, AlertTriangle, FileOutput,
  ChevronRight, AlertCircle, Info, Zap,
} from 'lucide-react'

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

export default function BottomPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('terminal')
  const logs = useAgentStore((s) => s.logs)

  // Counts for badges
  const errorCount = logs.filter((l) => l.type === 'error').length
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
              ? errorCount
              : id === 'agent-log'
                ? logCount
                : 0

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
              {label}

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

        {/* Right side spacer / extra controls could go here */}
        <div className="ml-auto" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'terminal' && <TerminalPanel />}

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

        {activeTab === 'problems' && (
          <EmptyTabContent
            Icon={AlertTriangle}
            message="No problems detected"
            sub="Errors and warnings from your workspace will appear here"
          />
        )}

        {activeTab === 'output' && (
          <EmptyTabContent
            Icon={FileOutput}
            message="No output"
            sub="Extension and task output will appear here"
          />
        )}
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
