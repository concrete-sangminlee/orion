import { useChatStore } from '@/store/chat'
import { useAgentStore } from '@/store/agents'
import {
  Bot, Cpu, Zap, AlertCircle, Workflow,
  Server, Activity, CircleDot,
} from 'lucide-react'
import type { Agent, AgentStatus } from '@shared/types'

/* ── Status config ─────────────────────────────────────── */

const statusConfig: Record<AgentStatus, {
  color: string
  bgColor: string
  borderColor: string
  Icon: typeof Bot
  label: string
}> = {
  active: {
    color: '#3fb950',
    bgColor: 'rgba(63,185,80,0.08)',
    borderColor: 'rgba(63,185,80,0.2)',
    Icon: Zap,
    label: 'Active',
  },
  working: {
    color: '#58a6ff',
    bgColor: 'rgba(88,166,255,0.08)',
    borderColor: 'rgba(88,166,255,0.2)',
    Icon: Cpu,
    label: 'Working',
  },
  idle: {
    color: '#484f58',
    bgColor: 'transparent',
    borderColor: 'var(--border)',
    Icon: Bot,
    label: 'Idle',
  },
  error: {
    color: '#f85149',
    bgColor: 'rgba(248,81,73,0.06)',
    borderColor: 'rgba(248,81,73,0.2)',
    Icon: AlertCircle,
    label: 'Error',
  },
}

/* ── Agent card ────────────────────────────────────────── */

function AgentCard({ agent }: { agent: Agent }) {
  const c = statusConfig[agent.status]

  return (
    <div
      className="transition-all duration-200"
      style={{
        background: c.bgColor,
        border: `1px solid ${c.borderColor}`,
        borderRadius: 10,
        padding: '10px 12px',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = c.color + '50'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = c.borderColor
      }}
    >
      <div className="flex items-center gap-2.5">
        {/* Icon */}
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: c.color + '12',
            border: `1px solid ${c.color}20`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <c.Icon size={14} style={{ color: c.color }} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color:
                  agent.status === 'idle'
                    ? 'var(--text-secondary)'
                    : 'var(--text-primary)',
              }}
            >
              {agent.name}
            </span>

            {/* Pulsing status dot */}
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: c.color,
                flexShrink: 0,
                boxShadow:
                  agent.status === 'active' || agent.status === 'working'
                    ? `0 0 8px ${c.color}80`
                    : 'none',
                animation:
                  agent.status === 'active' || agent.status === 'working'
                    ? 'agent-pulse 2s ease-in-out infinite'
                    : 'none',
              }}
            />

            {/* Status label */}
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 9,
                fontWeight: 500,
                color: c.color,
                background: c.color + '12',
                padding: '2px 7px',
                borderRadius: 4,
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
              }}
            >
              {c.label}
            </span>
          </div>
          <span
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              display: 'block',
              marginTop: 1,
            }}
          >
            {agent.role}
          </span>
        </div>
      </div>

      {/* Current task */}
      {agent.currentTask && (
        <div
          style={{
            marginTop: 8,
            marginLeft: 40,
            padding: '6px 10px',
            background: 'rgba(255,255,255,0.02)',
            borderRadius: 6,
            borderLeft: `2px solid ${c.color}40`,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono, monospace)',
              lineHeight: 1.5,
              wordBreak: 'break-word',
            }}
          >
            {agent.currentTask}
          </span>
        </div>
      )}

      {/* Progress bar */}
      {agent.status === 'working' && agent.progress !== undefined && (
        <div style={{ marginTop: 8, marginLeft: 40 }}>
          <div
            className="flex items-center justify-between"
            style={{ marginBottom: 4 }}
          >
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
              Progress
            </span>
            <span
              style={{
                fontSize: 9,
                color: c.color,
                fontFamily: 'var(--font-mono, monospace)',
                fontWeight: 600,
              }}
            >
              {agent.progress}%
            </span>
          </div>
          <div
            style={{
              height: 4,
              borderRadius: 2,
              background: 'rgba(255,255,255,0.04)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                borderRadius: 2,
                width: `${agent.progress}%`,
                background: `linear-gradient(90deg, ${c.color}, ${c.color}cc)`,
                transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: `0 0 8px ${c.color}40`,
              }}
            />
          </div>
        </div>
      )}

      <style>{`
        @keyframes agent-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}

/* ── Main panel ────────────────────────────────────────── */

export default function AgentPanel() {
  const agents = useAgentStore((s) => s.agents)
  const logs = useAgentStore((s) => s.logs)
  const { ollamaAvailable, ollamaModels } = useChatStore()
  const activeCount = agents.filter((a) => a.status !== 'idle').length
  const workingCount = agents.filter((a) => a.status === 'working').length

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Header */}
      <div
        className="shrink-0 flex items-center px-4"
        style={{
          height: 34,
          color: 'var(--text-secondary)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Workflow size={12} style={{ marginRight: 6, opacity: 0.7 }} />
        AI AGENTS
        {activeCount > 0 && (
          <span
            className="ml-auto flex items-center gap-1.5"
            style={{
              color: 'var(--accent-green)',
              fontWeight: 500,
              letterSpacing: 0,
              fontSize: 10,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--accent-green)',
                boxShadow: '0 0 8px rgba(63,185,80,0.5)',
                animation: 'agent-pulse 2s ease-in-out infinite',
              }}
            />
            {activeCount} active
          </span>
        )}
      </div>

      {/* Agent Cards */}
      <div
        style={{
          padding: '6px 8px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          maxHeight: 280,
          overflowY: 'auto',
        }}
      >
        {agents.length === 0 ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Bot
                size={20}
                style={{ color: 'var(--text-muted)', opacity: 0.4 }}
              />
            </div>
            <div className="text-center">
              <p
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                No agents running
              </p>
              <p
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 11,
                  opacity: 0.5,
                  marginTop: 2,
                }}
              >
                Start a task in Agent mode
              </p>
            </div>
          </div>
        ) : (
          agents.map((a) => <AgentCard key={a.id} agent={a} />)
        )}
      </div>

      {/* System status section */}
      <div
        style={{
          borderTop: '1px solid var(--border)',
          padding: '8px 12px',
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--text-muted)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            marginBottom: 6,
          }}
        >
          System Status
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {/* Ollama status */}
          <StatusRow
            Icon={Server}
            label="Ollama"
            value={ollamaAvailable ? 'Connected' : 'Unavailable'}
            valueColor={
              ollamaAvailable ? 'var(--accent-green)' : 'var(--text-muted)'
            }
            dotColor={ollamaAvailable ? '#3fb950' : '#484f58'}
          />

          {/* Models count */}
          <StatusRow
            Icon={CircleDot}
            label="Models"
            value={
              ollamaAvailable
                ? `${ollamaModels.length} loaded`
                : 'None'
            }
            valueColor="var(--text-secondary)"
            dotColor="var(--accent)"
          />

          {/* Agent activity */}
          <StatusRow
            Icon={Activity}
            label="Activity"
            value={
              agents.length === 0
                ? 'No agents'
                : `${activeCount} active, ${workingCount} working`
            }
            valueColor="var(--text-secondary)"
            dotColor={activeCount > 0 ? '#3fb950' : '#484f58'}
          />
        </div>
      </div>
    </div>
  )
}

/* ── Status row component ──────────────────────────────── */

function StatusRow({
  Icon,
  label,
  value,
  valueColor,
  dotColor,
}: {
  Icon: typeof Server
  label: string
  value: string
  valueColor: string
  dotColor: string
}) {
  return (
    <div
      className="flex items-center gap-2"
      style={{
        fontSize: 11,
        padding: '3px 4px',
        borderRadius: 4,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
        }}
      />
      <Icon
        size={11}
        style={{ color: 'var(--text-muted)', flexShrink: 0 }}
      />
      <span style={{ color: 'var(--text-muted)', flex: 1 }}>{label}</span>
      <span
        style={{
          color: valueColor,
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 10,
          fontWeight: 500,
        }}
      >
        {value}
      </span>
    </div>
  )
}
