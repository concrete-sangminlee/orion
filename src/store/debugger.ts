/**
 * Debugger state management store.
 * Manages debug sessions, breakpoints, call stacks, and variable inspection.
 */

import { create } from 'zustand'

/* ── Types ─────────────────────────────────────────────── */

export type DebugState = 'inactive' | 'initializing' | 'running' | 'paused' | 'stopped'

export interface Breakpoint {
  id: string
  file: string
  line: number
  enabled: boolean
  condition?: string
  hitCount?: string
  logMessage?: string
  verified: boolean
  hitCountValue: number
}

export interface StackFrame {
  id: number
  name: string
  file: string
  line: number
  column: number
  source?: string
  moduleId?: string
  presentationHint?: 'normal' | 'label' | 'subtle'
}

export interface DebugThread {
  id: number
  name: string
  status: 'running' | 'paused' | 'stopped'
  stackFrames: StackFrame[]
}

export interface DebugVariable {
  name: string
  value: string
  type?: string
  variablesReference: number
  children?: DebugVariable[]
  evaluateName?: string
  presentationHint?: {
    kind?: string
    attributes?: string[]
    visibility?: string
  }
}

export interface DebugScope {
  name: string
  variablesReference: number
  expensive: boolean
  variables: DebugVariable[]
}

export interface WatchExpression {
  id: string
  expression: string
  value?: string
  type?: string
  error?: string
}

export interface DebugConsoleEntry {
  id: string
  type: 'input' | 'output' | 'error' | 'warning' | 'info'
  text: string
  timestamp: number
  source?: string
}

export interface LaunchConfiguration {
  name: string
  type: string
  request: 'launch' | 'attach'
  program?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  port?: number
  host?: string
  sourceMaps?: boolean
  outFiles?: string[]
  preLaunchTask?: string
  postDebugTask?: string
  console?: 'internalConsole' | 'integratedTerminal' | 'externalTerminal'
  [key: string]: any
}

export interface DebugSession {
  id: string
  name: string
  type: string
  state: DebugState
  config: LaunchConfiguration
  threads: DebugThread[]
  activeThreadId?: number
  activeFrameId?: number
  scopes: DebugScope[]
  startTime: number
  capabilities: DebugCapabilities
}

export interface DebugCapabilities {
  supportsConditionalBreakpoints: boolean
  supportsHitConditionalBreakpoints: boolean
  supportsLogPoints: boolean
  supportsEvaluateForHovers: boolean
  supportsStepBack: boolean
  supportsRestartFrame: boolean
  supportsExceptionInfoRequest: boolean
  supportsTerminateRequest: boolean
  supportsDataBreakpoints: boolean
  supportsSetVariable: boolean
}

/* ── Store ─────────────────────────────────────────────── */

interface DebuggerStore {
  // State
  sessions: DebugSession[]
  activeSessionId: string | null
  breakpoints: Breakpoint[]
  watchExpressions: WatchExpression[]
  consoleEntries: DebugConsoleEntry[]
  exceptionBreakpoints: { filter: string; enabled: boolean }[]
  showDebugToolbar: boolean
  lastUsedConfig: string | null
  configurations: LaunchConfiguration[]

  // Session management
  startSession: (config: LaunchConfiguration) => string
  stopSession: (sessionId?: string) => void
  pauseSession: (sessionId?: string) => void
  continueSession: (sessionId?: string) => void
  restartSession: (sessionId?: string) => void
  setSessionState: (sessionId: string, state: DebugState) => void
  setActiveSession: (sessionId: string) => void

  // Execution control
  stepOver: (sessionId?: string) => void
  stepInto: (sessionId?: string) => void
  stepOut: (sessionId?: string) => void
  stepBack: (sessionId?: string) => void
  runToCursor: (file: string, line: number) => void

  // Thread management
  setThreads: (sessionId: string, threads: DebugThread[]) => void
  setActiveThread: (threadId: number) => void
  setActiveFrame: (frameId: number) => void
  setScopes: (sessionId: string, scopes: DebugScope[]) => void

  // Breakpoints
  addBreakpoint: (file: string, line: number) => Breakpoint
  removeBreakpoint: (id: string) => void
  toggleBreakpoint: (file: string, line: number) => void
  setBreakpointCondition: (id: string, condition: string) => void
  setBreakpointHitCount: (id: string, hitCount: string) => void
  setBreakpointLogMessage: (id: string, logMessage: string) => void
  enableBreakpoint: (id: string, enabled: boolean) => void
  removeAllBreakpoints: () => void
  removeBreakpointsInFile: (file: string) => void
  getBreakpointsForFile: (file: string) => Breakpoint[]

  // Watch expressions
  addWatch: (expression: string) => void
  removeWatch: (id: string) => void
  editWatch: (id: string, expression: string) => void
  updateWatchValue: (id: string, value: string, type?: string) => void
  setWatchError: (id: string, error: string) => void
  refreshWatches: () => void

  // Console
  addConsoleEntry: (type: DebugConsoleEntry['type'], text: string, source?: string) => void
  clearConsole: () => void
  evaluateInConsole: (expression: string) => void

  // Variables
  expandVariable: (scopeRef: number, variableRef: number) => void
  setVariableValue: (variableRef: number, name: string, value: string) => void

  // Configuration
  addConfiguration: (config: LaunchConfiguration) => void
  removeConfiguration: (name: string) => void
  updateConfiguration: (name: string, config: Partial<LaunchConfiguration>) => void
  setLastUsedConfig: (name: string) => void

  // Exception breakpoints
  setExceptionBreakpoints: (filters: { filter: string; enabled: boolean }[]) => void
  toggleExceptionBreakpoint: (filter: string) => void

  // Helpers
  getActiveSession: () => DebugSession | undefined
  isDebugging: () => boolean
  isPaused: () => boolean
}

const api = () => (window as any).api

let nextBreakpointId = 1
let nextWatchId = 1
let nextConsoleId = 1
let nextSessionId = 1

const DEFAULT_CAPABILITIES: DebugCapabilities = {
  supportsConditionalBreakpoints: true,
  supportsHitConditionalBreakpoints: true,
  supportsLogPoints: true,
  supportsEvaluateForHovers: true,
  supportsStepBack: false,
  supportsRestartFrame: true,
  supportsExceptionInfoRequest: true,
  supportsTerminateRequest: true,
  supportsDataBreakpoints: false,
  supportsSetVariable: true,
}

const DEFAULT_CONFIGS: LaunchConfiguration[] = [
  {
    name: 'Node.js: Current File',
    type: 'node',
    request: 'launch',
    program: '${file}',
    console: 'integratedTerminal',
    sourceMaps: true,
  },
  {
    name: 'Node.js: npm start',
    type: 'node',
    request: 'launch',
    program: '${workspaceFolder}/node_modules/.bin/ts-node',
    args: ['${workspaceFolder}/src/index.ts'],
    console: 'integratedTerminal',
    sourceMaps: true,
  },
  {
    name: 'Python: Current File',
    type: 'python',
    request: 'launch',
    program: '${file}',
    console: 'integratedTerminal',
  },
  {
    name: 'Chrome: Launch',
    type: 'chrome',
    request: 'launch',
    url: 'http://localhost:3000',
    sourceMaps: true,
  },
  {
    name: 'Node.js: Attach',
    type: 'node',
    request: 'attach',
    port: 9229,
  },
  {
    name: 'Go: Debug',
    type: 'go',
    request: 'launch',
    program: '${workspaceFolder}',
  },
]

const EXCEPTION_FILTERS = [
  { filter: 'uncaught', enabled: true },
  { filter: 'caught', enabled: false },
]

export const useDebuggerStore = create<DebuggerStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  breakpoints: [],
  watchExpressions: [],
  consoleEntries: [],
  exceptionBreakpoints: [...EXCEPTION_FILTERS],
  showDebugToolbar: false,
  lastUsedConfig: null,
  configurations: [...DEFAULT_CONFIGS],

  /* ── Session Management ──────────────────────────── */

  startSession: (config) => {
    const id = `session-${nextSessionId++}`
    const session: DebugSession = {
      id,
      name: config.name,
      type: config.type,
      state: 'initializing',
      config,
      threads: [],
      scopes: [],
      startTime: Date.now(),
      capabilities: { ...DEFAULT_CAPABILITIES },
    }

    set(s => ({
      sessions: [...s.sessions, session],
      activeSessionId: id,
      showDebugToolbar: true,
    }))

    // IPC: start debug session
    api()?.debugStart?.(config).then(() => {
      set(s => ({
        sessions: s.sessions.map(sess =>
          sess.id === id ? { ...sess, state: 'running' as const } : sess
        ),
      }))
    }).catch(() => {
      get().addConsoleEntry('error', `Failed to start debug session: ${config.name}`)
      set(s => ({
        sessions: s.sessions.map(sess =>
          sess.id === id ? { ...sess, state: 'stopped' as const } : sess
        ),
      }))
    })

    get().setLastUsedConfig(config.name)
    return id
  },

  stopSession: (sessionId) => {
    const id = sessionId || get().activeSessionId
    if (!id) return
    api()?.debugStop?.(id)
    set(s => ({
      sessions: s.sessions.filter(sess => sess.id !== id),
      activeSessionId: s.sessions.length > 1
        ? s.sessions.find(sess => sess.id !== id)?.id || null
        : null,
      showDebugToolbar: s.sessions.length > 1,
    }))
  },

  pauseSession: (sessionId) => {
    const id = sessionId || get().activeSessionId
    if (!id) return
    api()?.debugPause?.(id)
    set(s => ({
      sessions: s.sessions.map(sess =>
        sess.id === id ? { ...sess, state: 'paused' as const } : sess
      ),
    }))
  },

  continueSession: (sessionId) => {
    const id = sessionId || get().activeSessionId
    if (!id) return
    api()?.debugContinue?.(id)
    set(s => ({
      sessions: s.sessions.map(sess =>
        sess.id === id ? { ...sess, state: 'running' as const } : sess
      ),
    }))
  },

  restartSession: (sessionId) => {
    const id = sessionId || get().activeSessionId
    if (!id) return
    const session = get().sessions.find(s => s.id === id)
    if (!session) return
    get().stopSession(id)
    setTimeout(() => get().startSession(session.config), 500)
  },

  setSessionState: (sessionId, state) => {
    set(s => ({
      sessions: s.sessions.map(sess =>
        sess.id === sessionId ? { ...sess, state } : sess
      ),
    }))
  },

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  /* ── Execution Control ──────────────────────────── */

  stepOver: (sessionId) => {
    const id = sessionId || get().activeSessionId
    if (id) api()?.debugStepOver?.(id, get().sessions.find(s => s.id === id)?.activeThreadId)
  },

  stepInto: (sessionId) => {
    const id = sessionId || get().activeSessionId
    if (id) api()?.debugStepInto?.(id, get().sessions.find(s => s.id === id)?.activeThreadId)
  },

  stepOut: (sessionId) => {
    const id = sessionId || get().activeSessionId
    if (id) api()?.debugStepOut?.(id, get().sessions.find(s => s.id === id)?.activeThreadId)
  },

  stepBack: (sessionId) => {
    const id = sessionId || get().activeSessionId
    if (id) api()?.debugStepBack?.(id)
  },

  runToCursor: (file, line) => {
    const id = get().activeSessionId
    if (id) api()?.debugRunToCursor?.(id, file, line)
  },

  /* ── Thread Management ──────────────────────────── */

  setThreads: (sessionId, threads) => {
    set(s => ({
      sessions: s.sessions.map(sess =>
        sess.id === sessionId ? { ...sess, threads } : sess
      ),
    }))
  },

  setActiveThread: (threadId) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    set(s => ({
      sessions: s.sessions.map(sess =>
        sess.id === sessionId ? { ...sess, activeThreadId: threadId } : sess
      ),
    }))
  },

  setActiveFrame: (frameId) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    set(s => ({
      sessions: s.sessions.map(sess =>
        sess.id === sessionId ? { ...sess, activeFrameId: frameId } : sess
      ),
    }))
  },

  setScopes: (sessionId, scopes) => {
    set(s => ({
      sessions: s.sessions.map(sess =>
        sess.id === sessionId ? { ...sess, scopes } : sess
      ),
    }))
  },

  /* ── Breakpoints ────────────────────────────────── */

  addBreakpoint: (file, line) => {
    const bp: Breakpoint = {
      id: `bp-${nextBreakpointId++}`,
      file,
      line,
      enabled: true,
      verified: false,
      hitCountValue: 0,
    }
    set(s => ({ breakpoints: [...s.breakpoints, bp] }))
    api()?.debugSetBreakpoint?.(file, line)
    return bp
  },

  removeBreakpoint: (id) => {
    const bp = get().breakpoints.find(b => b.id === id)
    if (bp) api()?.debugRemoveBreakpoint?.(bp.file, bp.line)
    set(s => ({ breakpoints: s.breakpoints.filter(b => b.id !== id) }))
  },

  toggleBreakpoint: (file, line) => {
    const existing = get().breakpoints.find(b => b.file === file && b.line === line)
    if (existing) {
      get().removeBreakpoint(existing.id)
    } else {
      get().addBreakpoint(file, line)
    }
  },

  setBreakpointCondition: (id, condition) => {
    set(s => ({
      breakpoints: s.breakpoints.map(b => b.id === id ? { ...b, condition } : b),
    }))
  },

  setBreakpointHitCount: (id, hitCount) => {
    set(s => ({
      breakpoints: s.breakpoints.map(b => b.id === id ? { ...b, hitCount } : b),
    }))
  },

  setBreakpointLogMessage: (id, logMessage) => {
    set(s => ({
      breakpoints: s.breakpoints.map(b => b.id === id ? { ...b, logMessage } : b),
    }))
  },

  enableBreakpoint: (id, enabled) => {
    set(s => ({
      breakpoints: s.breakpoints.map(b => b.id === id ? { ...b, enabled } : b),
    }))
  },

  removeAllBreakpoints: () => set({ breakpoints: [] }),

  removeBreakpointsInFile: (file) => {
    set(s => ({ breakpoints: s.breakpoints.filter(b => b.file !== file) }))
  },

  getBreakpointsForFile: (file) => {
    return get().breakpoints.filter(b => b.file === file)
  },

  /* ── Watch Expressions ──────────────────────────── */

  addWatch: (expression) => {
    const id = `watch-${nextWatchId++}`
    set(s => ({
      watchExpressions: [...s.watchExpressions, { id, expression }],
    }))
    // Evaluate immediately if debugging
    if (get().isPaused()) {
      api()?.debugEvaluate?.(get().activeSessionId, expression).then((result: any) => {
        get().updateWatchValue(id, result?.value || 'undefined', result?.type)
      }).catch(() => {
        get().setWatchError(id, 'Unable to evaluate')
      })
    }
  },

  removeWatch: (id) => {
    set(s => ({
      watchExpressions: s.watchExpressions.filter(w => w.id !== id),
    }))
  },

  editWatch: (id, expression) => {
    set(s => ({
      watchExpressions: s.watchExpressions.map(w =>
        w.id === id ? { ...w, expression, value: undefined, error: undefined } : w
      ),
    }))
  },

  updateWatchValue: (id, value, type) => {
    set(s => ({
      watchExpressions: s.watchExpressions.map(w =>
        w.id === id ? { ...w, value, type, error: undefined } : w
      ),
    }))
  },

  setWatchError: (id, error) => {
    set(s => ({
      watchExpressions: s.watchExpressions.map(w =>
        w.id === id ? { ...w, error, value: undefined } : w
      ),
    }))
  },

  refreshWatches: () => {
    const state = get()
    if (!state.isPaused()) return
    for (const watch of state.watchExpressions) {
      api()?.debugEvaluate?.(state.activeSessionId, watch.expression).then((result: any) => {
        get().updateWatchValue(watch.id, result?.value || 'undefined', result?.type)
      }).catch(() => {
        get().setWatchError(watch.id, 'Unable to evaluate')
      })
    }
  },

  /* ── Console ────────────────────────────────────── */

  addConsoleEntry: (type, text, source) => {
    const entry: DebugConsoleEntry = {
      id: `console-${nextConsoleId++}`,
      type,
      text,
      timestamp: Date.now(),
      source,
    }
    set(s => ({
      consoleEntries: [...s.consoleEntries.slice(-999), entry],
    }))
  },

  clearConsole: () => set({ consoleEntries: [] }),

  evaluateInConsole: (expression) => {
    get().addConsoleEntry('input', expression)
    const sessionId = get().activeSessionId
    if (!sessionId || !get().isPaused()) {
      get().addConsoleEntry('error', 'Not paused in debug session')
      return
    }
    api()?.debugEvaluate?.(sessionId, expression).then((result: any) => {
      get().addConsoleEntry('output', result?.value || 'undefined')
    }).catch((err: any) => {
      get().addConsoleEntry('error', err?.message || 'Evaluation failed')
    })
  },

  /* ── Variables ──────────────────────────────────── */

  expandVariable: (scopeRef, variableRef) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    api()?.debugGetVariables?.(sessionId, variableRef).then((vars: DebugVariable[]) => {
      set(s => ({
        sessions: s.sessions.map(sess => {
          if (sess.id !== sessionId) return sess
          return {
            ...sess,
            scopes: sess.scopes.map(scope => ({
              ...scope,
              variables: expandVarsRecursive(scope.variables, variableRef, vars),
            })),
          }
        }),
      }))
    })
  },

  setVariableValue: (variableRef, name, value) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    api()?.debugSetVariable?.(sessionId, variableRef, name, value)
  },

  /* ── Configuration ──────────────────────────────── */

  addConfiguration: (config) => {
    set(s => ({
      configurations: [...s.configurations, config],
    }))
  },

  removeConfiguration: (name) => {
    set(s => ({
      configurations: s.configurations.filter(c => c.name !== name),
    }))
  },

  updateConfiguration: (name, config) => {
    set(s => ({
      configurations: s.configurations.map(c =>
        c.name === name ? { ...c, ...config } : c
      ),
    }))
  },

  setLastUsedConfig: (name) => {
    set({ lastUsedConfig: name })
    try { localStorage.setItem('orion:last-debug-config', name) } catch {}
  },

  /* ── Exception Breakpoints ──────────────────────── */

  setExceptionBreakpoints: (filters) => set({ exceptionBreakpoints: filters }),

  toggleExceptionBreakpoint: (filter) => {
    set(s => ({
      exceptionBreakpoints: s.exceptionBreakpoints.map(eb =>
        eb.filter === filter ? { ...eb, enabled: !eb.enabled } : eb
      ),
    }))
  },

  /* ── Helpers ────────────────────────────────────── */

  getActiveSession: () => {
    const state = get()
    return state.sessions.find(s => s.id === state.activeSessionId)
  },

  isDebugging: () => get().sessions.some(s => s.state !== 'inactive' && s.state !== 'stopped'),

  isPaused: () => {
    const session = get().getActiveSession()
    return session?.state === 'paused'
  },
}))

/* ── Helpers ──────────────────────────────────────────── */

function expandVarsRecursive(
  variables: DebugVariable[],
  targetRef: number,
  children: DebugVariable[]
): DebugVariable[] {
  return variables.map(v => {
    if (v.variablesReference === targetRef) {
      return { ...v, children }
    }
    if (v.children) {
      return { ...v, children: expandVarsRecursive(v.children, targetRef, children) }
    }
    return v
  })
}
