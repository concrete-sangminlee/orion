/**
 * Debug Console Panel — REPL-style debug output with expression evaluation.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  ChevronRight, ChevronDown, Terminal, Trash2, Filter, ArrowDown,
  AlertCircle, Info, AlertTriangle, Play,
} from 'lucide-react'

type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'input' | 'output'

interface DebugLogEntry {
  id: string
  level: LogLevel
  message: string
  timestamp: number
  source?: string
  expandable?: boolean
  details?: string
  evaluated?: boolean
}

let nextId = 0

const DEMO_ENTRIES: DebugLogEntry[] = [
  { id: `d-${nextId++}`, level: 'info', message: 'Debugger attached.', timestamp: Date.now() - 10000, source: 'DAP' },
  { id: `d-${nextId++}`, level: 'log', message: 'Application started on port 3000', timestamp: Date.now() - 9000 },
  { id: `d-${nextId++}`, level: 'debug', message: 'Loading configuration from ./config/default.json', timestamp: Date.now() - 8000 },
  { id: `d-${nextId++}`, level: 'warn', message: 'Deprecation warning: Buffer() is deprecated', timestamp: Date.now() - 7000, source: 'node:buffer' },
  { id: `d-${nextId++}`, level: 'log', message: '> Connected to database: postgres://localhost:5432/myapp', timestamp: Date.now() - 6000 },
  { id: `d-${nextId++}`, level: 'error', message: 'TypeError: Cannot read properties of undefined (reading \'id\')', timestamp: Date.now() - 4000, source: 'src/handlers/user.ts:42', expandable: true, details: '  at getUserById (src/handlers/user.ts:42:15)\n  at processRequest (src/server.ts:128:22)\n  at Layer.handle (node_modules/express/lib/router/layer.js:95:5)' },
  { id: `d-${nextId++}`, level: 'input', message: 'process.env.NODE_ENV', timestamp: Date.now() - 3000, evaluated: true },
  { id: `d-${nextId++}`, level: 'output', message: '"development"', timestamp: Date.now() - 3000 },
  { id: `d-${nextId++}`, level: 'log', message: 'Request: GET /api/users - 200 (45ms)', timestamp: Date.now() - 2000 },
]

export default function DebugConsolePanel() {
  const [entries, setEntries] = useState<DebugLogEntry[]>(DEMO_ENTRIES)
  const [expression, setExpression] = useState('')
  const [filterText, setFilterText] = useState('')
  const [showFilter, setShowFilter] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [levelFilter, setLevelFilter] = useState<Set<LogLevel>>(new Set(['log', 'info', 'warn', 'error', 'debug', 'input', 'output']))
  const [autoScroll, setAutoScroll] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries, autoScroll])

  const evaluateExpression = useCallback(() => {
    const expr = expression.trim()
    if (!expr) return

    historyRef.current.unshift(expr)
    historyIndexRef.current = -1

    const inputEntry: DebugLogEntry = {
      id: `d-${nextId++}`,
      level: 'input',
      message: expr,
      timestamp: Date.now(),
      evaluated: true,
    }

    // Simulate evaluation
    let result: string
    try {
      // In real implementation, send to debug adapter
      if (expr === 'process.env.NODE_ENV') result = '"development"'
      else if (expr.match(/^\d+[\+\-\*\/]\d+$/)) result = String(eval(expr))
      else if (expr === 'Date.now()') result = String(Date.now())
      else if (expr === 'Math.PI') result = String(Math.PI)
      else result = `undefined`
    } catch (e: any) {
      result = `Error: ${e.message}`
    }

    const outputEntry: DebugLogEntry = {
      id: `d-${nextId++}`,
      level: result.startsWith('Error') ? 'error' : 'output',
      message: result,
      timestamp: Date.now(),
    }

    setEntries(prev => [...prev, inputEntry, outputEntry])
    setExpression('')
  }, [expression])

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearConsole = () => setEntries([])

  const levelColor = (level: LogLevel) => {
    switch (level) {
      case 'error': return '#f85149'
      case 'warn': return '#f78166'
      case 'info': return '#58a6ff'
      case 'debug': return '#8b949e'
      case 'input': return '#bc8cff'
      case 'output': return '#3fb950'
      default: return 'var(--text-primary)'
    }
  }

  const levelIcon = (level: LogLevel) => {
    switch (level) {
      case 'error': return <AlertCircle size={12} style={{ color: '#f85149' }} />
      case 'warn': return <AlertTriangle size={12} style={{ color: '#f78166' }} />
      case 'info': return <Info size={12} style={{ color: '#58a6ff' }} />
      case 'input': return <ChevronRight size={12} style={{ color: '#bc8cff' }} />
      case 'output': return <ChevronDown size={12} style={{ color: '#3fb950', transform: 'rotate(-90deg)' }} />
      default: return null
    }
  }

  const filtered = entries.filter(e => {
    if (!levelFilter.has(e.level)) return false
    if (filterText && !e.message.toLowerCase().includes(filterText.toLowerCase())) return false
    return true
  })

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderBottom: '1px solid var(--border)',
      }}>
        <button
          onClick={clearConsole}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-muted)' }}
          title="Clear Console"
        >
          <Trash2 size={14} />
        </button>
        <button
          onClick={() => setShowFilter(!showFilter)}
          style={{
            background: showFilter ? 'rgba(88,166,255,0.1)' : 'none',
            border: 'none', cursor: 'pointer', padding: 2,
            color: showFilter ? 'var(--accent)' : 'var(--text-muted)',
          }}
          title="Filter"
        >
          <Filter size={14} />
        </button>
        <div style={{ flex: 1 }} />

        {/* Level toggles */}
        {(['error', 'warn', 'info', 'log'] as LogLevel[]).map(level => {
          const count = entries.filter(e => e.level === level).length
          const active = levelFilter.has(level)
          return (
            <button
              key={level}
              onClick={() => {
                setLevelFilter(prev => {
                  const next = new Set(prev)
                  if (next.has(level)) next.delete(level)
                  else next.add(level)
                  return next
                })
              }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '1px 6px',
                fontSize: 10, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 3,
                color: active ? levelColor(level) : 'var(--text-muted)',
                opacity: active ? 1 : 0.5,
              }}
            >
              {count} {level}
            </button>
          )
        })}

        <button
          onClick={() => setAutoScroll(!autoScroll)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 2,
            color: autoScroll ? 'var(--accent)' : 'var(--text-muted)',
          }}
          title="Auto-scroll"
        >
          <ArrowDown size={14} />
        </button>
      </div>

      {/* Filter bar */}
      {showFilter && (
        <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter output..."
            style={{
              width: '100%', padding: '3px 8px', background: 'var(--bg-primary)',
              border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)',
              fontSize: 12, outline: 'none',
            }}
          />
        </div>
      )}

      {/* Log output */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
        {filtered.map((entry) => (
          <div
            key={entry.id}
            style={{
              display: 'flex', gap: 8, padding: '2px 8px', minHeight: 20, alignItems: 'flex-start',
              borderBottom: '1px solid rgba(255,255,255,0.02)',
              background: entry.level === 'error' ? 'rgba(248,81,73,0.05)' : entry.level === 'warn' ? 'rgba(247,129,102,0.03)' : 'transparent',
            }}
          >
            {/* Icon */}
            <span style={{ width: 16, flexShrink: 0, paddingTop: 2 }}>
              {entry.expandable ? (
                <button
                  onClick={() => toggleExpand(entry.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)' }}
                >
                  {expandedIds.has(entry.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              ) : levelIcon(entry.level)}
            </span>

            {/* Timestamp */}
            <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0, fontFamily: 'monospace', width: 80 }}>
              {formatTime(entry.timestamp)}
            </span>

            {/* Message */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                color: levelColor(entry.level),
                fontStyle: entry.evaluated ? 'italic' : 'normal',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
                {entry.message}
              </span>
              {entry.expandable && expandedIds.has(entry.id) && entry.details && (
                <pre style={{
                  margin: '4px 0', padding: 8, background: 'var(--bg-primary)',
                  borderRadius: 4, fontSize: 11, color: 'var(--text-secondary)',
                  overflow: 'auto', whiteSpace: 'pre-wrap',
                }}>
                  {entry.details}
                </pre>
              )}
            </div>

            {/* Source */}
            {entry.source && (
              <span
                style={{
                  color: 'var(--text-muted)', fontSize: 10, flexShrink: 0,
                  cursor: entry.source.includes(':') ? 'pointer' : 'default',
                }}
                onClick={() => {
                  if (entry.source?.includes(':')) {
                    window.dispatchEvent(new CustomEvent('orion:open-file-at-line', { detail: { source: entry.source } }))
                  }
                }}
              >
                {entry.source}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* REPL input */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 8px', borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
      }}>
        <ChevronRight size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') evaluateExpression()
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              if (historyRef.current.length > 0) {
                historyIndexRef.current = Math.min(historyIndexRef.current + 1, historyRef.current.length - 1)
                setExpression(historyRef.current[historyIndexRef.current])
              }
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              if (historyIndexRef.current > 0) {
                historyIndexRef.current--
                setExpression(historyRef.current[historyIndexRef.current])
              } else {
                historyIndexRef.current = -1
                setExpression('')
              }
            }
          }}
          placeholder="Evaluate expression..."
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text-primary)', fontSize: 12, fontFamily: 'monospace',
          }}
        />
        <button
          onClick={evaluateExpression}
          disabled={!expression.trim()}
          style={{
            background: 'none', border: 'none', cursor: expression.trim() ? 'pointer' : 'default',
            color: expression.trim() ? 'var(--accent)' : 'var(--text-muted)', padding: 2,
          }}
        >
          <Play size={14} />
        </button>
      </div>
    </div>
  )
}
