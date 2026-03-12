import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  Play,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  MoreHorizontal,
  Settings,
  Square,
  RotateCw,
  StepForward,
  StepBack,
  ArrowDownToLine,
  Bug,
  X,
  Pause,
  Circle,
  Eye,
  Edit3,
  RefreshCw,
  FileText,
  Check,
  AlertCircle,
  MessageSquare,
} from 'lucide-react'

/* ── Types ─────────────────────────────────────────────────────── */

interface CollapsibleSectionProps {
  title: string
  defaultOpen?: boolean
  actions?: React.ReactNode
  children: React.ReactNode
  badge?: number
}

interface LaunchConfig {
  name: string
  type: string
  request: 'launch' | 'attach'
  icon: string
}

interface VariableNode {
  name: string
  value: string
  type: string
  children?: VariableNode[]
}

interface ScopeData {
  name: string
  variables: VariableNode[]
}

interface WatchEntry {
  expression: string
  value: string
  type: string
  error?: boolean
}

interface CallFrame {
  id: number
  name: string
  file: string
  line: number
  column: number
  isCurrentFrame?: boolean
}

interface ThreadInfo {
  id: number
  name: string
  stopped: boolean
  frames: CallFrame[]
}

interface Breakpoint {
  id: number
  file: string
  line: number
  enabled: boolean
  verified: boolean
  condition?: string
  hitCondition?: string
  logMessage?: string
  hitCount?: number
}

type DebugState = 'idle' | 'running' | 'paused' | 'stopped'

/* ── Simulated Data ────────────────────────────────────────────── */

const LAUNCH_CONFIGS: LaunchConfig[] = [
  { name: 'Launch Program', type: 'node', request: 'launch', icon: '🟢' },
  { name: 'Launch via NPM', type: 'node', request: 'launch', icon: '🟢' },
  { name: 'Attach to Process', type: 'node', request: 'attach', icon: '🟢' },
  { name: 'Launch Chrome', type: 'chrome', request: 'launch', icon: '🔵' },
  { name: 'Python: Current File', type: 'python', request: 'launch', icon: '🟡' },
  { name: 'Python: Remote Attach', type: 'python', request: 'attach', icon: '🟡' },
  { name: '.NET Core Attach', type: 'coreclr', request: 'attach', icon: '🟣' },
]

const SIMULATED_SCOPES: ScopeData[] = [
  {
    name: 'Local',
    variables: [
      { name: 'this', value: 'AppComponent', type: 'object', children: [
        { name: 'props', value: '{...}', type: 'object', children: [
          { name: 'title', value: '"Orion IDE"', type: 'string' },
          { name: 'version', value: '"2.1.0"', type: 'string' },
          { name: 'isDebug', value: 'true', type: 'boolean' },
        ]},
        { name: 'state', value: '{...}', type: 'object', children: [
          { name: 'count', value: '42', type: 'number' },
          { name: 'items', value: 'Array(3)', type: 'array', children: [
            { name: '0', value: '"alpha"', type: 'string' },
            { name: '1', value: '"beta"', type: 'string' },
            { name: '2', value: '"gamma"', type: 'string' },
          ]},
          { name: 'isLoading', value: 'false', type: 'boolean' },
        ]},
        { name: 'render', value: 'f render()', type: 'function' },
      ]},
      { name: 'event', value: 'MouseEvent', type: 'object', children: [
        { name: 'type', value: '"click"', type: 'string' },
        { name: 'clientX', value: '245', type: 'number' },
        { name: 'clientY', value: '183', type: 'number' },
        { name: 'target', value: '<button>', type: 'object' },
      ]},
      { name: 'index', value: '3', type: 'number' },
      { name: 'result', value: 'undefined', type: 'undefined' },
      { name: 'message', value: '"Processing request..."', type: 'string' },
      { name: 'data', value: 'Array(5)', type: 'array', children: [
        { name: '0', value: '{id: 1, name: "Item 1"}', type: 'object', children: [
          { name: 'id', value: '1', type: 'number' },
          { name: 'name', value: '"Item 1"', type: 'string' },
        ]},
        { name: '1', value: '{id: 2, name: "Item 2"}', type: 'object', children: [
          { name: 'id', value: '2', type: 'number' },
          { name: 'name', value: '"Item 2"', type: 'string' },
        ]},
        { name: '2', value: '{id: 3, name: "Item 3"}', type: 'object' },
        { name: '3', value: '{id: 4, name: "Item 4"}', type: 'object' },
        { name: '4', value: '{id: 5, name: "Item 5"}', type: 'object' },
      ]},
      { name: 'callback', value: 'f () => {...}', type: 'function' },
    ],
  },
  {
    name: 'Closure',
    variables: [
      { name: 'dispatch', value: 'f dispatch(action)', type: 'function' },
      { name: 'navigate', value: 'f navigate(path)', type: 'function' },
      { name: 'config', value: '{...}', type: 'object', children: [
        { name: 'apiUrl', value: '"https://api.example.com"', type: 'string' },
        { name: 'timeout', value: '5000', type: 'number' },
        { name: 'retries', value: '3', type: 'number' },
      ]},
    ],
  },
  {
    name: 'Global',
    variables: [
      { name: 'window', value: 'Window', type: 'object' },
      { name: 'document', value: '#document', type: 'object' },
      { name: 'console', value: 'Console', type: 'object' },
      { name: 'navigator', value: 'Navigator', type: 'object' },
      { name: 'localStorage', value: 'Storage', type: 'object' },
      { name: 'performance', value: 'Performance', type: 'object' },
      { name: 'JSON', value: 'JSON', type: 'object' },
      { name: 'Math', value: 'Math', type: 'object' },
      { name: 'Promise', value: 'f Promise()', type: 'function' },
      { name: 'Map', value: 'f Map()', type: 'function' },
      { name: 'Set', value: 'f Set()', type: 'function' },
    ],
  },
]

const SIMULATED_THREADS: ThreadInfo[] = [
  {
    id: 1,
    name: 'Main Thread',
    stopped: true,
    frames: [
      { id: 1, name: 'handleClick', file: 'src/components/App.tsx', line: 42, column: 8, isCurrentFrame: true },
      { id: 2, name: 'processEvent', file: 'src/utils/events.ts', line: 128, column: 12 },
      { id: 3, name: 'dispatch', file: 'src/store/index.ts', line: 56, column: 4 },
      { id: 4, name: 'executeAction', file: 'src/store/middleware.ts', line: 23, column: 16 },
      { id: 5, name: 'render', file: 'node_modules/react-dom/cjs/react-dom.development.js', line: 3420, column: 20 },
      { id: 6, name: 'workLoop', file: 'node_modules/react-dom/cjs/react-dom.development.js', line: 4521, column: 10 },
    ],
  },
  {
    id: 2,
    name: 'Worker Thread #1',
    stopped: false,
    frames: [
      { id: 7, name: 'processQueue', file: 'src/workers/processor.ts', line: 15, column: 4 },
      { id: 8, name: 'onMessage', file: 'src/workers/processor.ts', line: 8, column: 2 },
    ],
  },
  {
    id: 3,
    name: 'Worker Thread #2',
    stopped: false,
    frames: [
      { id: 9, name: 'parseDocument', file: 'src/workers/parser.ts', line: 88, column: 6 },
      { id: 10, name: 'tokenize', file: 'src/workers/parser.ts', line: 34, column: 12 },
    ],
  },
]

const SIMULATED_BREAKPOINTS: Breakpoint[] = [
  { id: 1, file: 'src/components/App.tsx', line: 42, enabled: true, verified: true, hitCount: 3 },
  { id: 2, file: 'src/components/App.tsx', line: 67, enabled: true, verified: true, condition: 'index > 5' },
  { id: 3, file: 'src/utils/events.ts', line: 128, enabled: false, verified: true },
  { id: 4, file: 'src/store/index.ts', line: 56, enabled: true, verified: true },
  { id: 5, file: 'src/store/middleware.ts', line: 23, enabled: true, verified: false },
  { id: 6, file: 'src/hooks/useData.ts', line: 15, enabled: true, verified: true, logMessage: 'Request received: {url}' },
  { id: 7, file: 'src/hooks/useData.ts', line: 34, enabled: true, verified: true, hitCondition: '> 10' },
]

const WATCH_DEFAULTS: WatchEntry[] = [
  { expression: 'this.state.count', value: '42', type: 'number' },
  { expression: 'data.length', value: '5', type: 'number' },
  { expression: 'message', value: '"Processing request..."', type: 'string' },
  { expression: 'result', value: 'undefined', type: 'undefined' },
]

/* ── Color helpers ─────────────────────────────────────────────── */

function getTypeColor(type: string): string {
  switch (type) {
    case 'string': return 'var(--debug-string, #ce9178)'
    case 'number': return 'var(--debug-number, #b5cea8)'
    case 'boolean': return 'var(--debug-boolean, #569cd6)'
    case 'function': return 'var(--debug-function, #dcdcaa)'
    case 'undefined': return 'var(--debug-undefined, #808080)'
    case 'null': return 'var(--debug-null, #808080)'
    case 'object': return 'var(--debug-object, #4ec9b0)'
    case 'array': return 'var(--debug-array, #4ec9b0)'
    default: return 'var(--text-secondary)'
  }
}

function getConfigTypeColor(type: string): string {
  switch (type) {
    case 'node': return '#3fb950'
    case 'chrome': return '#388bfd'
    case 'python': return '#f0c74f'
    case 'coreclr': return '#c678dd'
    default: return 'var(--text-muted)'
  }
}

/* ── Collapsible Section ───────────────────────────────────────── */

function CollapsibleSection({ title, defaultOpen = false, actions, children, badge }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          padding: '6px 8px',
          background: 'var(--bg-tertiary)',
          border: 'none',
          color: 'var(--text-primary)',
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          cursor: 'pointer',
          gap: 4,
          userSelect: 'none',
        }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{ flex: 1, textAlign: 'left' }}>{title}</span>
        {badge !== undefined && badge > 0 && (
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            background: 'var(--accent-blue, #388bfd)',
            color: '#fff',
            borderRadius: 8,
            padding: '0 5px',
            minWidth: 16,
            textAlign: 'center',
            lineHeight: '16px',
          }}>{badge}</span>
        )}
        {actions && (
          <span
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', gap: 2 }}
          >
            {actions}
          </span>
        )}
      </button>
      {open && (
        <div style={{ padding: '4px 0' }}>
          {children}
        </div>
      )}
    </div>
  )
}

/* ── Small Icon Button ─────────────────────────────────────────── */

function IconBtn({ icon: Icon, title, onClick, size = 14, color, disabled = false }: {
  icon: typeof Plus
  title: string
  onClick?: () => void
  size?: number
  color?: string
  disabled?: boolean
}) {
  return (
    <button
      title={title}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        background: 'none',
        border: 'none',
        color: disabled ? 'var(--text-muted)' : (color || 'var(--text-muted)'),
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 2,
        borderRadius: 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.color = color || 'var(--text-primary)'; if (!disabled) e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.06))' }}
      onMouseLeave={(e) => { e.currentTarget.style.color = disabled ? 'var(--text-muted)' : (color || 'var(--text-muted)'); e.currentTarget.style.background = 'none' }}
    >
      <Icon size={size} strokeWidth={1.6} />
    </button>
  )
}

/* ── Variable Tree Node ────────────────────────────────────────── */

function VariableTreeNode({ variable, depth = 0, isDebugging }: {
  variable: VariableNode
  depth?: number
  isDebugging: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(variable.value)
  const [currentValue, setCurrentValue] = useState(variable.value)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasChildren = variable.children && variable.children.length > 0

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleDoubleClick = useCallback(() => {
    if (!isDebugging) return
    if (variable.type === 'function' || variable.type === 'object' || variable.type === 'array') return
    setEditValue(currentValue)
    setEditing(true)
  }, [isDebugging, variable.type, currentValue])

  const commitEdit = useCallback(() => {
    setCurrentValue(editValue)
    setEditing(false)
  }, [editValue])

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '1px 0',
          paddingLeft: depth * 16 + 8,
          fontSize: 12,
          cursor: hasChildren ? 'pointer' : 'default',
          lineHeight: '20px',
          minHeight: 20,
        }}
        onClick={() => hasChildren && setExpanded(!expanded)}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.04))' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {hasChildren ? (
            expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : null}
        </span>
        <span style={{
          color: 'var(--debug-property, #9cdcfe)',
          fontFamily: 'var(--font-mono, monospace)',
          marginRight: 4,
          flexShrink: 0,
        }}>
          {variable.name}
        </span>
        <span style={{ color: 'var(--text-muted)', marginRight: 4, flexShrink: 0 }}>:</span>
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit()
              if (e.key === 'Escape') setEditing(false)
            }}
            onBlur={commitEdit}
            style={{
              flex: 1,
              background: 'var(--bg-primary)',
              color: getTypeColor(variable.type),
              border: '1px solid var(--accent-blue, #388bfd)',
              borderRadius: 2,
              padding: '0 4px',
              fontSize: 12,
              fontFamily: 'var(--font-mono, monospace)',
              outline: 'none',
              lineHeight: '18px',
            }}
          />
        ) : (
          <span style={{
            color: getTypeColor(variable.type),
            fontFamily: 'var(--font-mono, monospace)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}>
            {currentValue}
          </span>
        )}
        {!editing && (
          <span style={{
            color: 'var(--text-muted)',
            fontSize: 10,
            marginLeft: 6,
            flexShrink: 0,
            opacity: 0.7,
            fontStyle: 'italic',
          }}>
            {variable.type}
          </span>
        )}
      </div>
      {expanded && hasChildren && variable.children!.map((child, i) => (
        <VariableTreeNode key={`${child.name}-${i}`} variable={child} depth={depth + 1} isDebugging={isDebugging} />
      ))}
    </div>
  )
}

/* ── Scope Section ─────────────────────────────────────────────── */

function ScopeSection({ scope, isDebugging }: { scope: ScopeData; isDebugging: boolean }) {
  const [expanded, setExpanded] = useState(scope.name === 'Local')

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 8px',
          color: 'var(--text-primary)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.04))' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{scope.name}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 400 }}>
          ({scope.variables.length})
        </span>
      </div>
      {expanded && scope.variables.map((v, i) => (
        <VariableTreeNode key={`${v.name}-${i}`} variable={v} depth={1} isDebugging={isDebugging} />
      ))}
    </div>
  )
}

/* ── Debug Toolbar ─────────────────────────────────────────────── */

function DebugToolbar({ debugState, onAction }: {
  debugState: DebugState
  onAction: (action: string) => void
}) {
  const isActive = debugState === 'running' || debugState === 'paused'
  const isPaused = debugState === 'paused'

  const buttons = [
    {
      icon: isPaused ? Play : Pause,
      title: isPaused ? 'Continue (F5)' : 'Pause (F6)',
      action: isPaused ? 'continue' : 'pause',
      color: 'var(--accent-green, #3fb950)',
      enabled: isActive,
    },
    { icon: StepForward, title: 'Step Over (F10)', action: 'stepOver', color: undefined, enabled: isPaused },
    { icon: ArrowDownToLine, title: 'Step Into (F11)', action: 'stepInto', color: undefined, enabled: isPaused },
    { icon: StepBack, title: 'Step Out (Shift+F11)', action: 'stepOut', color: undefined, enabled: isPaused },
    { icon: RotateCw, title: 'Restart (Ctrl+Shift+F5)', action: 'restart', color: 'var(--accent-green, #3fb950)', enabled: isActive },
    { icon: Square, title: 'Stop (Shift+F5)', action: 'stop', color: 'var(--accent-red, #f85149)', enabled: isActive },
  ]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        padding: '4px 8px',
        borderBottom: '1px solid var(--border)',
        background: isActive
          ? 'var(--debug-toolbar-bg, rgba(252, 186, 3, 0.08))'
          : 'var(--bg-tertiary)',
        transition: 'background 0.2s',
      }}
    >
      {buttons.map(({ icon: Icon, title, action, color, enabled }, i) => (
        <button
          key={i}
          title={title}
          disabled={!enabled}
          onClick={() => enabled && onAction(action)}
          style={{
            background: 'none',
            border: 'none',
            color: enabled ? (color || 'var(--text-secondary)') : 'var(--text-muted)',
            cursor: enabled ? 'pointer' : 'not-allowed',
            padding: '3px 4px',
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: enabled ? 1 : 0.35,
            transition: 'opacity 0.15s, background 0.15s',
          }}
          onMouseEnter={(e) => { if (enabled) e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.1))' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
        >
          <Icon size={15} strokeWidth={1.6} />
        </button>
      ))}
    </div>
  )
}

/* ── Breakpoint Row ────────────────────────────────────────────── */

function BreakpointRow({ bp, onToggle, onRemove, onEditCondition }: {
  bp: Breakpoint
  onToggle: () => void
  onRemove: () => void
  onEditCondition: () => void
}) {
  const fileName = bp.file.split('/').pop() || bp.file
  const isLogPoint = !!bp.logMessage
  const isConditional = !!bp.condition || !!bp.hitCondition

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '2px 8px 2px 4px',
        fontSize: 12,
        gap: 4,
        cursor: 'pointer',
        minHeight: 22,
        opacity: bp.enabled ? 1 : 0.55,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.04))' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      onContextMenu={(e) => {
        e.preventDefault()
        onEditCondition()
      }}
    >
      <input
        type="checkbox"
        checked={bp.enabled}
        onChange={onToggle}
        style={{
          accentColor: 'var(--accent-blue, #388bfd)',
          cursor: 'pointer',
          margin: 0,
          flexShrink: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      />
      {/* Breakpoint type icon */}
      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        {isLogPoint ? (
          <MessageSquare size={12} strokeWidth={1.6} style={{ color: 'var(--debug-logpoint, #fcba03)' }} />
        ) : isConditional ? (
          <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Circle size={12} fill={bp.verified ? 'var(--accent-red, #f85149)' : 'var(--text-muted)'} stroke="none" />
            <span style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              fontSize: 8,
              fontWeight: 700,
              color: '#fff',
              lineHeight: 1,
            }}>=</span>
          </span>
        ) : (
          <Circle size={12} fill={bp.verified ? 'var(--accent-red, #f85149)' : 'var(--text-muted)'} stroke="none" />
        )}
      </span>
      <span style={{
        fontFamily: 'var(--font-mono, monospace)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
      }}>
        {fileName}
      </span>
      <span style={{
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 11,
        flexShrink: 0,
      }}>
        :{bp.line}
      </span>
      {bp.hitCount !== undefined && (
        <span style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          background: 'var(--bg-tertiary)',
          padding: '0 4px',
          borderRadius: 4,
          flexShrink: 0,
        }}>
          hits: {bp.hitCount}
        </span>
      )}
      <IconBtn icon={X} title="Remove Breakpoint" size={12} onClick={onRemove} />
    </div>
  )
}

/* ── Breakpoint Detail Line ────────────────────────────────────── */

function BreakpointDetail({ bp }: { bp: Breakpoint }) {
  if (bp.condition) {
    return (
      <div style={{ paddingLeft: 44, fontSize: 11, color: 'var(--debug-logpoint, #fcba03)', fontFamily: 'var(--font-mono, monospace)', lineHeight: '16px' }}>
        Condition: {bp.condition}
      </div>
    )
  }
  if (bp.hitCondition) {
    return (
      <div style={{ paddingLeft: 44, fontSize: 11, color: 'var(--debug-logpoint, #fcba03)', fontFamily: 'var(--font-mono, monospace)', lineHeight: '16px' }}>
        Hit Count: {bp.hitCondition}
      </div>
    )
  }
  if (bp.logMessage) {
    return (
      <div style={{ paddingLeft: 44, fontSize: 11, color: 'var(--debug-logpoint, #fcba03)', fontFamily: 'var(--font-mono, monospace)', lineHeight: '16px' }}>
        Log: {bp.logMessage}
      </div>
    )
  }
  return null
}

/* ── Condition Editor Inline ───────────────────────────────────── */

function ConditionEditor({ initialCondition, initialLogMessage, initialHitCondition, onSave, onCancel }: {
  initialCondition?: string
  initialLogMessage?: string
  initialHitCondition?: string
  onSave: (condition?: string, logMessage?: string, hitCondition?: string) => void
  onCancel: () => void
}) {
  type TabType = 'expression' | 'hitCount' | 'logMessage'
  const [tab, setTab] = useState<TabType>(
    initialLogMessage ? 'logMessage' : initialHitCondition ? 'hitCount' : 'expression'
  )
  const [condition, setCondition] = useState(initialCondition || '')
  const [logMessage, setLogMessage] = useState(initialLogMessage || '')
  const [hitCondition, setHitCondition] = useState(initialHitCondition || '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [tab])

  const handleSave = () => {
    onSave(
      tab === 'expression' ? condition || undefined : undefined,
      tab === 'logMessage' ? logMessage || undefined : undefined,
      tab === 'hitCount' ? hitCondition || undefined : undefined,
    )
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 8px',
    fontSize: 11,
    background: active ? 'var(--bg-primary)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    border: 'none',
    borderBottom: active ? '2px solid var(--accent-blue, #388bfd)' : '2px solid transparent',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  })

  const currentValue = tab === 'expression' ? condition : tab === 'hitCount' ? hitCondition : logMessage
  const currentSetter = tab === 'expression' ? setCondition : tab === 'hitCount' ? setHitCondition : setLogMessage
  const placeholder = tab === 'expression'
    ? 'Expression, e.g. x > 5'
    : tab === 'hitCount'
    ? 'Hit count, e.g. > 10'
    : 'Log message, e.g. value is {x}'

  return (
    <div style={{
      background: 'var(--bg-primary)',
      border: '1px solid var(--accent-blue, #388bfd)',
      borderRadius: 4,
      margin: '4px 8px',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        <button style={tabStyle(tab === 'expression')} onClick={() => setTab('expression')}>Expression</button>
        <button style={tabStyle(tab === 'hitCount')} onClick={() => setTab('hitCount')}>Hit Count</button>
        <button style={tabStyle(tab === 'logMessage')} onClick={() => setTab('logMessage')}>Log Message</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px', gap: 4 }}>
        <input
          ref={inputRef}
          value={currentValue}
          onChange={(e) => currentSetter(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') onCancel()
          }}
          style={{
            flex: 1,
            background: 'transparent',
            color: 'var(--text-primary)',
            border: 'none',
            padding: '2px 4px',
            fontSize: 12,
            fontFamily: 'var(--font-mono, monospace)',
            outline: 'none',
          }}
        />
        <IconBtn icon={Check} title="Save" size={14} color="var(--accent-green, #3fb950)" onClick={handleSave} />
        <IconBtn icon={X} title="Cancel" size={14} onClick={onCancel} />
      </div>
    </div>
  )
}

/* ── Main Debug Panel ──────────────────────────────────────────── */

export default function DebugPanel() {
  const [selectedConfig, setSelectedConfig] = useState(0)
  const [debugState, setDebugState] = useState<DebugState>('idle')
  const [watchEntries, setWatchEntries] = useState<WatchEntry[]>([])
  const [watchExpression, setWatchExpression] = useState('')
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>(SIMULATED_BREAKPOINTS)
  const [caughtExceptions, setCaughtExceptions] = useState(true)
  const [uncaughtExceptions, setUncaughtExceptions] = useState(true)
  const [selectedThread, setSelectedThread] = useState(1)
  const [selectedFrame, setSelectedFrame] = useState(1)
  const [editingBpId, setEditingBpId] = useState<number | null>(null)
  const [showAddConfig, setShowAddConfig] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isDebugging = debugState === 'running' || debugState === 'paused'
  const isPaused = debugState === 'paused'

  const currentThread = useMemo(() =>
    SIMULATED_THREADS.find(t => t.id === selectedThread),
    [selectedThread]
  )

  // Simulate evaluating watch expressions
  const evaluateExpression = useCallback((expr: string): WatchEntry => {
    const simulated: Record<string, { value: string; type: string }> = {
      'this.state.count': { value: '42', type: 'number' },
      'data.length': { value: '5', type: 'number' },
      'message': { value: '"Processing request..."', type: 'string' },
      'result': { value: 'undefined', type: 'undefined' },
      'index': { value: '3', type: 'number' },
      'this.props.title': { value: '"Orion IDE"', type: 'string' },
      'config.apiUrl': { value: '"https://api.example.com"', type: 'string' },
      'data[0]': { value: '{id: 1, name: "Item 1"}', type: 'object' },
      'callback': { value: 'f () => {...}', type: 'function' },
      'event.type': { value: '"click"', type: 'string' },
    }
    const found = simulated[expr]
    if (found) return { expression: expr, ...found }
    if (isPaused) return { expression: expr, value: 'ReferenceError: ' + expr + ' is not defined', type: 'string', error: true }
    return { expression: expr, value: 'not available', type: 'undefined', error: false }
  }, [isPaused])

  const addWatch = useCallback(() => {
    const expr = watchExpression.trim()
    if (expr && !watchEntries.find(w => w.expression === expr)) {
      setWatchEntries((prev) => [...prev, evaluateExpression(expr)])
      setWatchExpression('')
    }
  }, [watchExpression, watchEntries, evaluateExpression])

  const removeWatch = useCallback((index: number) => {
    setWatchEntries((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const refreshWatches = useCallback(() => {
    setWatchEntries(prev => prev.map(w => evaluateExpression(w.expression)))
  }, [evaluateExpression])

  const handleStartDebug = useCallback(() => {
    setDebugState('running')
    // Simulate hitting a breakpoint after a short delay
    timerRef.current = setTimeout(() => {
      setDebugState('paused')
      if (watchEntries.length === 0) {
        setWatchEntries(WATCH_DEFAULTS)
      }
    }, 800)
  }, [watchEntries.length])

  const handleDebugAction = useCallback((action: string) => {
    switch (action) {
      case 'continue':
        setDebugState('running')
        timerRef.current = setTimeout(() => setDebugState('paused'), 600)
        break
      case 'pause':
        setDebugState('paused')
        break
      case 'stepOver':
      case 'stepInto':
      case 'stepOut':
        // Quick running flash then re-pause
        setDebugState('running')
        timerRef.current = setTimeout(() => setDebugState('paused'), 200)
        break
      case 'restart':
        setDebugState('running')
        timerRef.current = setTimeout(() => setDebugState('paused'), 800)
        break
      case 'stop':
        setDebugState('idle')
        break
    }
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const toggleBreakpoint = useCallback((id: number) => {
    setBreakpoints(prev => prev.map(bp => bp.id === id ? { ...bp, enabled: !bp.enabled } : bp))
  }, [])

  const removeBreakpoint = useCallback((id: number) => {
    setBreakpoints(prev => prev.filter(bp => bp.id !== id))
    if (editingBpId === id) setEditingBpId(null)
  }, [editingBpId])

  const removeAllBreakpoints = useCallback(() => {
    setBreakpoints([])
    setEditingBpId(null)
  }, [])

  const saveBreakpointCondition = useCallback((id: number, condition?: string, logMessage?: string, hitCondition?: string) => {
    setBreakpoints(prev => prev.map(bp =>
      bp.id === id ? { ...bp, condition, logMessage, hitCondition } : bp
    ))
    setEditingBpId(null)
  }, [])

  const config = LAUNCH_CONFIGS[selectedConfig]

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
      }}
    >
      {/* ── Panel Header ──────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <Bug size={14} strokeWidth={1.6} style={{ color: 'var(--accent-orange, #d29922)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Run and Debug
        </span>
        {isDebugging && (
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: 8,
            background: debugState === 'paused'
              ? 'var(--accent-orange, rgba(210, 153, 34, 0.2))'
              : 'var(--accent-green-bg, rgba(63, 185, 80, 0.2))',
            color: debugState === 'paused'
              ? 'var(--accent-orange, #d29922)'
              : 'var(--accent-green, #3fb950)',
          }}>
            {debugState === 'paused' ? 'PAUSED' : 'RUNNING'}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <IconBtn icon={Settings} title="Open launch.json" />
        <IconBtn icon={MoreHorizontal} title="More Actions" />
      </div>

      {/* ── Launch Configuration ──────────────────────────────── */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select
            value={selectedConfig}
            onChange={(e) => setSelectedConfig(Number(e.target.value))}
            style={{
              flex: 1,
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              padding: '4px 8px',
              fontSize: 12,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {LAUNCH_CONFIGS.map((cfg, i) => (
              <option key={i} value={i}>{cfg.name}</option>
            ))}
          </select>
          {isDebugging ? (
            <button
              title="Stop Debugging (Shift+F5)"
              onClick={() => handleDebugAction('stop')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                background: 'var(--accent-red, #f85149)',
                color: '#fff',
                border: 'none',
                borderRadius: 3,
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <Square size={13} strokeWidth={2} fill="#fff" />
              Stop
            </button>
          ) : (
            <button
              title="Start Debugging (F5)"
              onClick={handleStartDebug}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                background: 'var(--accent-green, #3fb950)',
                color: '#fff',
                border: 'none',
                borderRadius: 3,
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <Play size={13} strokeWidth={2} fill="#fff" />
              Start
            </button>
          )}
        </div>

        {/* Config details */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 6,
          fontSize: 11,
          color: 'var(--text-muted)',
        }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '1px 6px',
            background: 'var(--bg-tertiary)',
            borderRadius: 3,
            fontFamily: 'var(--font-mono, monospace)',
          }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: getConfigTypeColor(config.type),
              display: 'inline-block',
              flexShrink: 0,
            }} />
            {config.type}
          </span>
          <span style={{
            padding: '1px 6px',
            background: 'var(--bg-tertiary)',
            borderRadius: 3,
            fontFamily: 'var(--font-mono, monospace)',
          }}>
            {config.request}
          </span>
        </div>

        {/* Add Configuration / Edit launch.json */}
        <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
          <span
            onClick={() => setShowAddConfig(!showAddConfig)}
            style={{
              fontSize: 11,
              color: 'var(--accent-blue, #388bfd)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline' }}
            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none' }}
          >
            <Plus size={11} /> Add Configuration
          </span>
          <span
            style={{
              fontSize: 11,
              color: 'var(--accent-blue, #388bfd)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline' }}
            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none' }}
          >
            <FileText size={11} /> Edit launch.json
          </span>
        </div>

        {/* Add Configuration dropdown */}
        {showAddConfig && (
          <div style={{
            marginTop: 6,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            overflow: 'hidden',
          }}>
            {[
              { label: 'Node.js: Launch Program', type: 'node' },
              { label: 'Node.js: Attach to Process', type: 'node' },
              { label: 'Python: Current File', type: 'python' },
              { label: 'Python: Remote Attach', type: 'python' },
              { label: 'Chrome: Launch', type: 'chrome' },
              { label: '.NET Core: Attach', type: 'coreclr' },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                }}
                onClick={() => setShowAddConfig(false)}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-blue, #388bfd)'; e.currentTarget.style.color = '#fff' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-primary)' }}
              >
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: getConfigTypeColor(item.type),
                  flexShrink: 0,
                }} />
                {item.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Debug Toolbar ──────────────────────────────────────── */}
      <DebugToolbar debugState={debugState} onAction={handleDebugAction} />

      {/* ── Scrollable sections ─────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Variables */}
        <CollapsibleSection
          title="Variables"
          defaultOpen
          badge={isPaused ? SIMULATED_SCOPES.reduce((n, s) => n + s.variables.length, 0) : undefined}
        >
          {!isPaused ? (
            <div style={{
              padding: '8px 20px',
              color: 'var(--text-muted)',
              fontSize: 12,
              fontStyle: 'italic',
            }}>
              {isDebugging ? 'Program is running...' : 'Not available while not debugging.'}
            </div>
          ) : (
            <div>
              {SIMULATED_SCOPES.map((scope) => (
                <ScopeSection key={scope.name} scope={scope} isDebugging={isPaused} />
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* Watch */}
        <CollapsibleSection
          title="Watch"
          defaultOpen
          badge={watchEntries.length || undefined}
          actions={
            <>
              <IconBtn icon={Plus} title="Add Expression" onClick={() => {
                const input = document.getElementById('debug-watch-input')
                input?.focus()
              }} />
              <IconBtn icon={RefreshCw} title="Refresh All" size={12} onClick={refreshWatches} disabled={!isPaused} />
            </>
          }
        >
          <div style={{ padding: '2px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <input
                id="debug-watch-input"
                type="text"
                placeholder="Add expression..."
                value={watchExpression}
                onChange={(e) => setWatchExpression(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addWatch()
                }}
                style={{
                  flex: 1,
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  padding: '3px 6px',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono, monospace)',
                  outline: 'none',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue, #388bfd)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
              />
              <IconBtn icon={Plus} title="Add" onClick={addWatch} />
            </div>
            {watchEntries.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: '2px 0', fontStyle: 'italic' }}>
                No expressions added. Type above and press Enter.
              </div>
            ) : (
              watchEntries.map((entry, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '2px 0',
                    fontSize: 12,
                    gap: 6,
                    minHeight: 22,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.04))' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <Eye size={11} strokeWidth={1.4} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{
                    color: 'var(--debug-property, #9cdcfe)',
                    fontFamily: 'var(--font-mono, monospace)',
                    flexShrink: 0,
                    maxWidth: '40%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {entry.expression}
                  </span>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>=</span>
                  <span style={{
                    color: entry.error
                      ? 'var(--accent-red, #f85149)'
                      : (isPaused ? getTypeColor(entry.type) : 'var(--text-muted)'),
                    fontFamily: 'var(--font-mono, monospace)',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontStyle: entry.error ? 'italic' : 'normal',
                  }}>
                    {isPaused ? entry.value : 'not available'}
                  </span>
                  <IconBtn icon={X} title="Remove" size={12} onClick={() => removeWatch(i)} />
                </div>
              ))
            )}
          </div>
        </CollapsibleSection>

        {/* Call Stack */}
        <CollapsibleSection
          title="Call Stack"
          defaultOpen
          badge={isPaused ? (currentThread?.frames.length) : undefined}
        >
          {!isPaused ? (
            <div style={{
              padding: '8px 20px',
              color: 'var(--text-muted)',
              fontSize: 12,
              fontStyle: 'italic',
            }}>
              {isDebugging ? 'Program is running...' : 'Not available while not debugging.'}
            </div>
          ) : (
            <div>
              {/* Thread selector */}
              {SIMULATED_THREADS.length > 1 && (
                <div style={{ padding: '2px 8px 4px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.3px',
                    marginBottom: 2,
                  }}>Threads</div>
                  {SIMULATED_THREADS.map((thread) => (
                    <div
                      key={thread.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '2px 4px',
                        fontSize: 12,
                        cursor: 'pointer',
                        borderRadius: 3,
                        background: selectedThread === thread.id ? 'var(--accent-blue-bg, rgba(56, 139, 253, 0.15))' : 'transparent',
                        color: selectedThread === thread.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                      }}
                      onClick={() => { setSelectedThread(thread.id); setSelectedFrame(thread.frames[0]?.id || 0) }}
                      onMouseEnter={(e) => { if (selectedThread !== thread.id) e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.04))' }}
                      onMouseLeave={(e) => { if (selectedThread !== thread.id) e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: thread.stopped ? 'var(--accent-orange, #d29922)' : 'var(--accent-green, #3fb950)',
                        flexShrink: 0,
                      }} />
                      <span style={{ fontWeight: selectedThread === thread.id ? 600 : 400 }}>
                        {thread.name}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        {thread.stopped ? 'Paused' : 'Running'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Call frames */}
              <div style={{ padding: '2px 0' }}>
                {currentThread?.frames.map((frame, i) => {
                  const isActive = selectedFrame === frame.id
                  const isExternal = frame.file.includes('node_modules')
                  const fileName = frame.file.split('/').pop() || frame.file
                  return (
                    <div
                      key={frame.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '2px 8px 2px 12px',
                        fontSize: 12,
                        cursor: 'pointer',
                        background: isActive ? 'var(--accent-blue-bg, rgba(56, 139, 253, 0.15))' : 'transparent',
                        borderLeft: isActive ? '2px solid var(--accent-blue, #388bfd)' : '2px solid transparent',
                        opacity: isExternal ? 0.6 : 1,
                        gap: 4,
                        minHeight: 22,
                      }}
                      onClick={() => setSelectedFrame(frame.id)}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.04))' }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                    >
                      {i === 0 && (
                        <span style={{ color: 'var(--accent-orange, #d29922)', marginRight: 2, flexShrink: 0 }}>
                          <AlertCircle size={11} strokeWidth={2} />
                        </span>
                      )}
                      <span style={{
                        fontFamily: 'var(--font-mono, monospace)',
                        color: isActive ? 'var(--accent-blue, #388bfd)' : 'var(--text-primary)',
                        fontWeight: isActive ? 600 : 400,
                        flexShrink: 0,
                      }}>
                        {frame.name}
                      </span>
                      <span style={{
                        color: 'var(--text-muted)',
                        fontSize: 11,
                        marginLeft: 'auto',
                        fontFamily: 'var(--font-mono, monospace)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flexShrink: 1,
                        minWidth: 0,
                      }}>
                        {fileName}:{frame.line}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CollapsibleSection>

        {/* Breakpoints */}
        <CollapsibleSection
          title="Breakpoints"
          defaultOpen
          badge={breakpoints.filter(bp => bp.enabled).length || undefined}
          actions={
            <>
              <IconBtn icon={Plus} title="Add Function Breakpoint" />
              <IconBtn icon={Trash2} title="Remove All Breakpoints" onClick={removeAllBreakpoints} />
            </>
          }
        >
          <div style={{ padding: '2px 0' }}>
            {/* Exception Breakpoints */}
            <div style={{ padding: '0 12px 4px' }}>
              <div style={{
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--text-muted)',
                marginBottom: 2,
                textTransform: 'uppercase',
                letterSpacing: '0.3px',
              }}>
                Exception Breakpoints
              </div>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 0',
                fontSize: 12,
                color: 'var(--text-primary)',
                cursor: 'pointer',
                userSelect: 'none',
              }}>
                <input
                  type="checkbox"
                  checked={caughtExceptions}
                  onChange={(e) => setCaughtExceptions(e.target.checked)}
                  style={{ accentColor: 'var(--accent-blue, #388bfd)', cursor: 'pointer', margin: 0 }}
                />
                Caught Exceptions
              </label>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 0',
                fontSize: 12,
                color: 'var(--text-primary)',
                cursor: 'pointer',
                userSelect: 'none',
              }}>
                <input
                  type="checkbox"
                  checked={uncaughtExceptions}
                  onChange={(e) => setUncaughtExceptions(e.target.checked)}
                  style={{ accentColor: 'var(--accent-blue, #388bfd)', cursor: 'pointer', margin: 0 }}
                />
                Uncaught Exceptions
              </label>
            </div>

            {/* Breakpoint list */}
            <div style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 4,
            }}>
              {breakpoints.length === 0 ? (
                <div style={{
                  padding: '8px 12px',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                  fontStyle: 'italic',
                }}>
                  No breakpoints set. Click in the editor gutter to add one.
                </div>
              ) : (
                breakpoints.map((bp) => (
                  <div key={bp.id}>
                    <BreakpointRow
                      bp={bp}
                      onToggle={() => toggleBreakpoint(bp.id)}
                      onRemove={() => removeBreakpoint(bp.id)}
                      onEditCondition={() => setEditingBpId(editingBpId === bp.id ? null : bp.id)}
                    />
                    <BreakpointDetail bp={bp} />
                    {editingBpId === bp.id && (
                      <ConditionEditor
                        initialCondition={bp.condition}
                        initialLogMessage={bp.logMessage}
                        initialHitCondition={bp.hitCondition}
                        onSave={(cond, log, hit) => saveBreakpointCondition(bp.id, cond, log, hit)}
                        onCancel={() => setEditingBpId(null)}
                      />
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Add Function Breakpoint button */}
            <div style={{ padding: '4px 12px 4px' }}>
              <button
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                  cursor: 'pointer',
                  width: '100%',
                  justifyContent: 'center',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-tertiary)'
                  e.currentTarget.style.color = 'var(--text-primary)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'none'
                  e.currentTarget.style.color = 'var(--text-secondary)'
                }}
              >
                <Bug size={12} strokeWidth={1.6} />
                Add Function Breakpoint
              </button>
            </div>
          </div>
        </CollapsibleSection>
      </div>

      {/* ── Footer hint ───────────────────────────────────────── */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--border)',
          fontSize: 11,
          color: 'var(--text-muted)',
          textAlign: 'center',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        {isDebugging ? (
          <>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: debugState === 'paused' ? 'var(--accent-orange, #d29922)' : 'var(--accent-green, #3fb950)',
              display: 'inline-block',
              animation: debugState === 'running' ? undefined : undefined,
            }} />
            {debugState === 'paused' ? 'Paused on breakpoint' : 'Debugging in progress...'}
            {' '}
            <kbd style={{
              padding: '1px 4px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              fontSize: 10,
              fontFamily: 'var(--font-mono, monospace)',
            }}>Shift+F5</kbd> to stop
          </>
        ) : (
          <>
            Press <kbd style={{
              padding: '1px 4px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              fontSize: 10,
              fontFamily: 'var(--font-mono, monospace)',
            }}>F5</kbd> to start debugging
          </>
        )}
      </div>
    </div>
  )
}
