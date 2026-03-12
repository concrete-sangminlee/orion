/**
 * Debug Adapter Protocol (DAP) client implementation.
 * Wraps IPC calls with proper error handling and session management.
 *
 * The actual transport / IPC communication is delegated to the main process
 * via `(window as any).api?.debugXxx()` calls, keeping this module purely
 * typed for the renderer side.
 */

/* ── DAP Message Types ────────────────────────────────── */

export interface DAPRequest {
  seq: number
  type: 'request'
  command: string
  arguments?: Record<string, unknown>
}

export interface DAPResponse {
  seq: number
  type: 'response'
  request_seq: number
  command: string
  success: boolean
  message?: string
  body?: Record<string, unknown>
}

export interface DAPEvent {
  seq: number
  type: 'event'
  event: string
  body?: Record<string, unknown>
}

export type DAPMessage = DAPRequest | DAPResponse | DAPEvent

/* ── Core Types ───────────────────────────────────────── */

export type BreakpointType = 'line' | 'conditional' | 'logpoint' | 'hitCount'

export interface Breakpoint {
  id: string
  file: string
  line: number
  column?: number
  enabled: boolean
  verified: boolean
  type: BreakpointType
  condition?: string
  hitCondition?: string
  logMessage?: string
  hitCount: number
}

export interface DebugThread {
  id: number
  name: string
  stopped: boolean
  stoppedReason?: string
}

export interface StackFrame {
  id: number
  name: string
  source?: SourceReference
  line: number
  column: number
  endLine?: number
  endColumn?: number
  moduleId?: string
  presentationHint?: 'normal' | 'label' | 'subtle'
}

export interface SourceReference {
  name: string
  path?: string
  sourceReference?: number
  origin?: string
}

export interface Scope {
  name: string
  variablesReference: number
  namedVariables?: number
  indexedVariables?: number
  expensive: boolean
  source?: SourceReference
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

export interface Variable {
  name: string
  value: string
  type?: string
  variablesReference: number
  namedVariables?: number
  indexedVariables?: number
  evaluateName?: string
  memoryReference?: string
  presentationHint?: VariablePresentationHint
}

export interface VariablePresentationHint {
  kind?: string
  attributes?: string[]
  visibility?: 'public' | 'private' | 'protected' | 'internal'
}

export interface WatchExpression {
  id: string
  expression: string
  value?: string
  type?: string
  error?: string
}

export type DebugState =
  | 'inactive'
  | 'initializing'
  | 'running'
  | 'stopped'
  | 'terminated'

export interface DebugEvent {
  type:
    | 'stopped'
    | 'continued'
    | 'exited'
    | 'terminated'
    | 'thread'
    | 'output'
    | 'breakpoint'
    | 'module'
    | 'loadedSource'
    | 'process'
    | 'capabilities'
    | 'invalidated'
  body: Record<string, unknown>
  sessionId: string
  timestamp: number
}

export interface DebugAdapterDescriptor {
  type: 'executable' | 'server' | 'namedPipe'
  /** Path to the adapter executable (for type 'executable') */
  command?: string
  args?: string[]
  /** Host/port for server-based adapters */
  host?: string
  port?: number
  /** Pipe name for named-pipe adapters */
  pipeName?: string
}

export interface LaunchConfig {
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
  stopOnEntry?: boolean
  console?: 'internalConsole' | 'integratedTerminal' | 'externalTerminal'
  preLaunchTask?: string
  postDebugTask?: string
  /** Adapter-specific settings not covered above */
  [key: string]: unknown
}

/* ── Helpers ──────────────────────────────────────────── */

const api = () => (window as any).api as Record<string, (...args: any[]) => Promise<any>> | undefined

let nextSeqId = 1

function nextSeq(): number {
  return nextSeqId++
}

function generateBreakpointId(file: string, line: number): string {
  return `bp_${file.replace(/[^a-zA-Z0-9]/g, '_')}_${line}`
}

function generateWatchId(expression: string): string {
  return `watch_${Date.now()}_${expression.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '_')}`
}

/* ── Debug Session ────────────────────────────────────── */

export class DebugSession {
  readonly id: string
  readonly config: LaunchConfig

  private _state: DebugState = 'inactive'
  private _threads: Map<number, DebugThread> = new Map()
  private _breakpoints: Map<string, Breakpoint> = new Map()
  private _watchExpressions: Map<string, WatchExpression> = new Map()
  private _eventListeners: Map<string, Array<(event: DebugEvent) => void>> = new Map()
  private _capabilities: Record<string, unknown> = {}
  private _activeThreadId: number | null = null
  private _activeFrameId: number | null = null

  constructor(id: string, config: LaunchConfig) {
    this.id = id
    this.config = config
  }

  /* ── State ──────────────────────────────────────── */

  get state(): DebugState {
    return this._state
  }

  get threads(): DebugThread[] {
    return Array.from(this._threads.values())
  }

  get breakpoints(): Breakpoint[] {
    return Array.from(this._breakpoints.values())
  }

  get watchExpressions(): WatchExpression[] {
    return Array.from(this._watchExpressions.values())
  }

  get activeThreadId(): number | null {
    return this._activeThreadId
  }

  get activeFrameId(): number | null {
    return this._activeFrameId
  }

  get capabilities(): Record<string, unknown> {
    return { ...this._capabilities }
  }

  /* ── Lifecycle ──────────────────────────────────── */

  async initialize(): Promise<boolean> {
    this._state = 'initializing'
    try {
      const response = await api()?.debugInitialize(this.id, {
        clientID: 'cursor-clone',
        clientName: 'Cursor Clone IDE',
        adapterID: this.config.type,
        locale: 'en-US',
        linesStartAt1: true,
        columnsStartAt1: true,
        pathFormat: 'path',
        supportsVariableType: true,
        supportsVariablePaging: true,
        supportsRunInTerminalRequest: true,
        supportsMemoryReferences: true,
        supportsInvalidatedEvent: true,
      })
      if (response?.success) {
        this._capabilities = response.body ?? {}
        return true
      }
      return false
    } catch {
      this._state = 'inactive'
      return false
    }
  }

  async launch(): Promise<boolean> {
    try {
      const response = await api()?.debugLaunch(this.id, {
        ...this.config,
        __restart: undefined,
      })
      if (response?.success) {
        this._state = 'running'
        this.emit('process', { sessionId: this.id, timestamp: Date.now() })
        return true
      }
      return false
    } catch {
      this._state = 'terminated'
      return false
    }
  }

  async attach(): Promise<boolean> {
    try {
      const response = await api()?.debugAttach(this.id, {
        ...this.config,
      })
      if (response?.success) {
        this._state = 'running'
        return true
      }
      return false
    } catch {
      this._state = 'terminated'
      return false
    }
  }

  async configurationDone(): Promise<void> {
    await api()?.debugConfigurationDone(this.id)
  }

  async disconnect(restart = false): Promise<void> {
    try {
      await api()?.debugDisconnect(this.id, { restart, terminateDebuggee: true })
    } finally {
      if (!restart) {
        this._state = 'terminated'
        this._threads.clear()
      }
    }
  }

  async terminate(): Promise<void> {
    try {
      await api()?.debugTerminate(this.id, { restart: false })
    } finally {
      this._state = 'terminated'
    }
  }

  async restart(): Promise<boolean> {
    try {
      const response = await api()?.debugRestart(this.id, {
        arguments: this.config,
      })
      if (response?.success) {
        this._state = 'running'
        this._threads.clear()
        return true
      }
      return false
    } catch {
      return false
    }
  }

  /* ── Execution Control ──────────────────────────── */

  async continue(threadId?: number): Promise<boolean> {
    const tid = threadId ?? this._activeThreadId
    if (tid === null) return false
    try {
      const response = await api()?.debugContinue(this.id, { threadId: tid })
      if (response?.success) {
        const allContinued = response.body?.allThreadsContinued ?? true
        if (allContinued) {
          for (const t of this._threads.values()) {
            t.stopped = false
            t.stoppedReason = undefined
          }
        } else {
          const thread = this._threads.get(tid)
          if (thread) {
            thread.stopped = false
            thread.stoppedReason = undefined
          }
        }
        this._state = 'running'
        return true
      }
      return false
    } catch {
      return false
    }
  }

  async pause(threadId?: number): Promise<boolean> {
    const tid = threadId ?? this._activeThreadId
    if (tid === null) return false
    try {
      const response = await api()?.debugPause(this.id, { threadId: tid })
      return response?.success ?? false
    } catch {
      return false
    }
  }

  async stepOver(threadId?: number, granularity: 'statement' | 'line' | 'instruction' = 'line'): Promise<boolean> {
    const tid = threadId ?? this._activeThreadId
    if (tid === null) return false
    try {
      const response = await api()?.debugNext(this.id, { threadId: tid, granularity })
      if (response?.success) {
        this._state = 'running'
        return true
      }
      return false
    } catch {
      return false
    }
  }

  async stepInto(threadId?: number, targetId?: number): Promise<boolean> {
    const tid = threadId ?? this._activeThreadId
    if (tid === null) return false
    try {
      const response = await api()?.debugStepIn(this.id, {
        threadId: tid,
        targetId,
        granularity: 'line',
      })
      if (response?.success) {
        this._state = 'running'
        return true
      }
      return false
    } catch {
      return false
    }
  }

  async stepOut(threadId?: number): Promise<boolean> {
    const tid = threadId ?? this._activeThreadId
    if (tid === null) return false
    try {
      const response = await api()?.debugStepOut(this.id, { threadId: tid, granularity: 'line' })
      if (response?.success) {
        this._state = 'running'
        return true
      }
      return false
    } catch {
      return false
    }
  }

  /* ── Threads & Stack Frames ─────────────────────── */

  async fetchThreads(): Promise<DebugThread[]> {
    try {
      const response = await api()?.debugThreads(this.id)
      if (response?.success && response.body?.threads) {
        const threads = response.body.threads as Array<{ id: number; name: string }>
        this._threads.clear()
        for (const t of threads) {
          this._threads.set(t.id, {
            id: t.id,
            name: t.name,
            stopped: false,
          })
        }
        return this.threads
      }
      return []
    } catch {
      return []
    }
  }

  async getStackTrace(
    threadId: number,
    startFrame = 0,
    levels = 20,
  ): Promise<{ frames: StackFrame[]; totalFrames: number }> {
    try {
      const response = await api()?.debugStackTrace(this.id, {
        threadId,
        startFrame,
        levels,
      })
      if (response?.success && response.body) {
        const rawFrames = (response.body.stackFrames ?? []) as any[]
        const frames: StackFrame[] = rawFrames.map((f: any) => ({
          id: f.id,
          name: f.name,
          source: f.source
            ? {
                name: f.source.name,
                path: f.source.path,
                sourceReference: f.source.sourceReference,
                origin: f.source.origin,
              }
            : undefined,
          line: f.line,
          column: f.column,
          endLine: f.endLine,
          endColumn: f.endColumn,
          moduleId: f.moduleId,
          presentationHint: f.presentationHint,
        }))
        return { frames, totalFrames: (response.body.totalFrames as number) ?? frames.length }
      }
      return { frames: [], totalFrames: 0 }
    } catch {
      return { frames: [], totalFrames: 0 }
    }
  }

  async getScopes(frameId: number): Promise<Scope[]> {
    try {
      const response = await api()?.debugScopes(this.id, { frameId })
      if (response?.success && response.body?.scopes) {
        return (response.body.scopes as any[]).map((s: any) => ({
          name: s.name,
          variablesReference: s.variablesReference,
          namedVariables: s.namedVariables,
          indexedVariables: s.indexedVariables,
          expensive: s.expensive ?? false,
          source: s.source,
          line: s.line,
          column: s.column,
          endLine: s.endLine,
          endColumn: s.endColumn,
        }))
      }
      return []
    } catch {
      return []
    }
  }

  async getVariables(
    variablesReference: number,
    filter?: 'indexed' | 'named',
    start?: number,
    count?: number,
  ): Promise<Variable[]> {
    try {
      const response = await api()?.debugVariables(this.id, {
        variablesReference,
        filter,
        start,
        count,
      })
      if (response?.success && response.body?.variables) {
        return (response.body.variables as any[]).map((v: any) => ({
          name: v.name,
          value: v.value,
          type: v.type,
          variablesReference: v.variablesReference ?? 0,
          namedVariables: v.namedVariables,
          indexedVariables: v.indexedVariables,
          evaluateName: v.evaluateName,
          memoryReference: v.memoryReference,
          presentationHint: v.presentationHint,
        }))
      }
      return []
    } catch {
      return []
    }
  }

  setActiveThread(threadId: number): void {
    this._activeThreadId = threadId
  }

  setActiveFrame(frameId: number): void {
    this._activeFrameId = frameId
  }

  /* ── Breakpoint Management ──────────────────────── */

  addBreakpoint(bp: Breakpoint): void {
    this._breakpoints.set(bp.id, bp)
  }

  removeBreakpoint(id: string): boolean {
    return this._breakpoints.delete(id)
  }

  toggleBreakpoint(id: string): boolean {
    const bp = this._breakpoints.get(id)
    if (!bp) return false
    bp.enabled = !bp.enabled
    return true
  }

  getBreakpointsForFile(file: string): Breakpoint[] {
    return this.breakpoints.filter((bp) => bp.file === file)
  }

  async sendBreakpoints(file: string): Promise<Breakpoint[]> {
    const fileBps = this.getBreakpointsForFile(file).filter((bp) => bp.enabled)
    const sourceBreakpoints = fileBps.map((bp) => {
      const sbp: Record<string, unknown> = { line: bp.line }
      if (bp.column !== undefined) sbp.column = bp.column
      if (bp.condition) sbp.condition = bp.condition
      if (bp.hitCondition) sbp.hitCondition = bp.hitCondition
      if (bp.logMessage) sbp.logMessage = bp.logMessage
      return sbp
    })

    try {
      const response = await api()?.debugSetBreakpoints(this.id, {
        source: { path: file },
        breakpoints: sourceBreakpoints,
        sourceModified: false,
      })
      if (response?.success && response.body?.breakpoints) {
        const verified = response.body.breakpoints as any[]
        for (let i = 0; i < Math.min(verified.length, fileBps.length); i++) {
          fileBps[i].verified = verified[i].verified ?? false
          if (verified[i].line !== undefined) fileBps[i].line = verified[i].line
        }
      }
      return fileBps
    } catch {
      return fileBps
    }
  }

  async clearAllBreakpoints(): Promise<void> {
    const files = new Set(this.breakpoints.map((bp) => bp.file))
    this._breakpoints.clear()
    for (const file of files) {
      await api()?.debugSetBreakpoints(this.id, {
        source: { path: file },
        breakpoints: [],
        sourceModified: false,
      })
    }
  }

  /* ── Watch Expressions ──────────────────────────── */

  addWatch(expression: string): WatchExpression {
    const watch: WatchExpression = {
      id: generateWatchId(expression),
      expression,
    }
    this._watchExpressions.set(watch.id, watch)
    return watch
  }

  removeWatch(id: string): boolean {
    return this._watchExpressions.delete(id)
  }

  async evaluateWatch(id: string, frameId?: number): Promise<WatchExpression | null> {
    const watch = this._watchExpressions.get(id)
    if (!watch) return null
    try {
      const response = await api()?.debugEvaluate(this.id, {
        expression: watch.expression,
        frameId: frameId ?? this._activeFrameId ?? undefined,
        context: 'watch',
      })
      if (response?.success && response.body) {
        watch.value = response.body.result as string
        watch.type = response.body.type as string | undefined
        watch.error = undefined
      } else {
        watch.error = response?.message ?? 'Evaluation failed'
        watch.value = undefined
      }
    } catch (err: any) {
      watch.error = err?.message ?? 'Evaluation failed'
      watch.value = undefined
    }
    return watch
  }

  async evaluateAllWatches(frameId?: number): Promise<WatchExpression[]> {
    const results: WatchExpression[] = []
    for (const id of this._watchExpressions.keys()) {
      const result = await this.evaluateWatch(id, frameId)
      if (result) results.push(result)
    }
    return results
  }

  /* ── Variable Inspection ────────────────────────── */

  async expandVariable(variablesReference: number): Promise<Variable[]> {
    if (variablesReference === 0) return []
    return this.getVariables(variablesReference)
  }

  async setVariable(
    variablesReference: number,
    name: string,
    value: string,
  ): Promise<Variable | null> {
    try {
      const response = await api()?.debugSetVariable(this.id, {
        variablesReference,
        name,
        value,
      })
      if (response?.success && response.body) {
        return {
          name,
          value: (response.body.value as string) ?? value,
          type: response.body.type as string | undefined,
          variablesReference: (response.body.variablesReference as number) ?? 0,
          namedVariables: response.body.namedVariables as number | undefined,
          indexedVariables: response.body.indexedVariables as number | undefined,
        }
      }
      return null
    } catch {
      return null
    }
  }

  /* ── Debug Console ──────────────────────────────── */

  async evaluateInConsole(expression: string, frameId?: number): Promise<{
    result: string
    type?: string
    variablesReference: number
  } | null> {
    try {
      const response = await api()?.debugEvaluate(this.id, {
        expression,
        frameId: frameId ?? this._activeFrameId ?? undefined,
        context: 'repl',
      })
      if (response?.success && response.body) {
        return {
          result: response.body.result as string,
          type: response.body.type as string | undefined,
          variablesReference: (response.body.variablesReference as number) ?? 0,
        }
      }
      return null
    } catch {
      return null
    }
  }

  async evaluateHover(expression: string, frameId?: number): Promise<{
    result: string
    type?: string
  } | null> {
    try {
      const response = await api()?.debugEvaluate(this.id, {
        expression,
        frameId: frameId ?? this._activeFrameId ?? undefined,
        context: 'hover',
      })
      if (response?.success && response.body) {
        return {
          result: response.body.result as string,
          type: response.body.type as string | undefined,
        }
      }
      return null
    } catch {
      return null
    }
  }

  /* ── Events ─────────────────────────────────────── */

  on(event: string, listener: (event: DebugEvent) => void): () => void {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, [])
    }
    this._eventListeners.get(event)!.push(listener)
    return () => {
      const listeners = this._eventListeners.get(event)
      if (listeners) {
        const idx = listeners.indexOf(listener)
        if (idx >= 0) listeners.splice(idx, 1)
      }
    }
  }

  private emit(type: string, body: Record<string, unknown> = {}): void {
    const debugEvent: DebugEvent = {
      type: type as DebugEvent['type'],
      body,
      sessionId: this.id,
      timestamp: Date.now(),
    }
    const listeners = this._eventListeners.get(type) ?? []
    for (const listener of listeners) {
      try {
        listener(debugEvent)
      } catch {
        // swallow listener errors
      }
    }
  }

  handleDAPEvent(event: DAPEvent): void {
    switch (event.event) {
      case 'stopped': {
        const threadId = (event.body?.threadId as number) ?? 0
        const thread = this._threads.get(threadId)
        if (thread) {
          thread.stopped = true
          thread.stoppedReason = event.body?.reason as string
        }
        this._state = 'stopped'
        this._activeThreadId = threadId
        break
      }
      case 'continued': {
        const threadId = (event.body?.threadId as number) ?? 0
        const allContinued = event.body?.allThreadsContinued ?? false
        if (allContinued) {
          for (const t of this._threads.values()) {
            t.stopped = false
          }
        } else {
          const thread = this._threads.get(threadId)
          if (thread) thread.stopped = false
        }
        this._state = 'running'
        break
      }
      case 'terminated':
        this._state = 'terminated'
        break
      case 'exited':
        this._state = 'terminated'
        break
      case 'thread': {
        const threadId = (event.body?.threadId as number) ?? 0
        const reason = event.body?.reason as string
        if (reason === 'started') {
          this._threads.set(threadId, {
            id: threadId,
            name: `Thread ${threadId}`,
            stopped: false,
          })
        } else if (reason === 'exited') {
          this._threads.delete(threadId)
        }
        break
      }
    }
    this.emit(event.event, event.body ?? {})
  }
}

/* ── Factory Functions ────────────────────────────────── */

let sessionCounter = 0

export function createDebugSession(config: LaunchConfig): DebugSession {
  const id = `debug_session_${++sessionCounter}_${Date.now()}`
  return new DebugSession(id, config)
}

/* ── Breakpoint Parsing ───────────────────────────────── */

export function parseBreakpoint(
  line: number,
  file: string,
  condition?: string,
): Breakpoint {
  let bpType: BreakpointType = 'line'
  let logMessage: string | undefined
  let hitCondition: string | undefined

  if (condition) {
    if (condition.startsWith('log:')) {
      bpType = 'logpoint'
      logMessage = condition.slice(4).trim()
      condition = undefined
    } else if (condition.startsWith('hit:')) {
      bpType = 'hitCount'
      hitCondition = condition.slice(4).trim()
      condition = undefined
    } else {
      bpType = 'conditional'
    }
  }

  return {
    id: generateBreakpointId(file, line),
    file,
    line,
    enabled: true,
    verified: false,
    type: bpType,
    condition,
    hitCondition,
    logMessage,
    hitCount: 0,
  }
}

/* ── Launch Configuration Parsing ─────────────────────── */

export function parseLaunchConfig(content: string): LaunchConfig[] {
  try {
    // Strip comments (line comments starting with //) for lenient JSON parsing
    const stripped = content.replace(/\/\/.*$/gm, '').replace(/,\s*([\]}])/g, '$1')
    const parsed = JSON.parse(stripped)

    if (!parsed || !Array.isArray(parsed.configurations)) {
      return []
    }

    return parsed.configurations.map((cfg: any): LaunchConfig => ({
      name: cfg.name ?? 'Unnamed',
      type: cfg.type ?? 'unknown',
      request: cfg.request ?? 'launch',
      program: cfg.program,
      args: cfg.args,
      cwd: cfg.cwd,
      env: cfg.env,
      port: cfg.port,
      host: cfg.host,
      sourceMaps: cfg.sourceMaps,
      outFiles: cfg.outFiles,
      stopOnEntry: cfg.stopOnEntry,
      console: cfg.console,
      preLaunchTask: cfg.preLaunchTask,
      postDebugTask: cfg.postDebugTask,
      ...cfg,
    }))
  } catch {
    return []
  }
}

/* ── Default Launch Configurations ────────────────────── */

const DEFAULT_CONFIGS: Record<string, LaunchConfig[]> = {
  node: [
    {
      name: 'Launch Node.js Program',
      type: 'node',
      request: 'launch',
      program: '${workspaceFolder}/src/index.js',
      cwd: '${workspaceFolder}',
      sourceMaps: true,
      outFiles: ['${workspaceFolder}/dist/**/*.js'],
      console: 'integratedTerminal',
      env: {},
    },
    {
      name: 'Launch via npm',
      type: 'node',
      request: 'launch',
      cwd: '${workspaceFolder}',
      runtimeExecutable: 'npm',
      runtimeArgs: ['run-script', 'start'],
      console: 'integratedTerminal',
    },
    {
      name: 'Attach to Node.js',
      type: 'node',
      request: 'attach',
      port: 9229,
      host: 'localhost',
      sourceMaps: true,
    },
    {
      name: 'Node.js: Mocha Tests',
      type: 'node',
      request: 'launch',
      program: '${workspaceFolder}/node_modules/mocha/bin/_mocha',
      args: ['--timeout', '10000', '--recursive', '${workspaceFolder}/test/**/*.test.js'],
      cwd: '${workspaceFolder}',
      console: 'integratedTerminal',
    },
  ],
  python: [
    {
      name: 'Launch Python File',
      type: 'python',
      request: 'launch',
      program: '${file}',
      cwd: '${workspaceFolder}',
      console: 'integratedTerminal',
      justMyCode: true,
    },
    {
      name: 'Python: Django',
      type: 'python',
      request: 'launch',
      program: '${workspaceFolder}/manage.py',
      args: ['runserver', '--noreload'],
      cwd: '${workspaceFolder}',
      console: 'integratedTerminal',
      django: true,
    },
    {
      name: 'Python: Flask',
      type: 'python',
      request: 'launch',
      program: '${workspaceFolder}/app.py',
      cwd: '${workspaceFolder}',
      env: { FLASK_APP: 'app.py', FLASK_ENV: 'development' },
      console: 'integratedTerminal',
    },
    {
      name: 'Attach to Python (Remote)',
      type: 'python',
      request: 'attach',
      host: 'localhost',
      port: 5678,
      pathMappings: [{ localRoot: '${workspaceFolder}', remoteRoot: '.' }],
    },
  ],
  chrome: [
    {
      name: 'Launch Chrome',
      type: 'chrome',
      request: 'launch',
      url: 'http://localhost:3000',
      webRoot: '${workspaceFolder}/src',
      sourceMaps: true,
    },
    {
      name: 'Attach to Chrome',
      type: 'chrome',
      request: 'attach',
      port: 9222,
      webRoot: '${workspaceFolder}/src',
      sourceMaps: true,
    },
  ],
  go: [
    {
      name: 'Launch Go Program',
      type: 'go',
      request: 'launch',
      program: '${workspaceFolder}',
      mode: 'auto',
      console: 'integratedTerminal',
    },
    {
      name: 'Launch Go Test',
      type: 'go',
      request: 'launch',
      program: '${workspaceFolder}',
      mode: 'test',
      console: 'integratedTerminal',
    },
    {
      name: 'Attach to Go Process',
      type: 'go',
      request: 'attach',
      mode: 'local',
      processId: 0,
    },
  ],
}

export function getDefaultLaunchConfigs(projectType: string): LaunchConfig[] {
  const key = projectType.toLowerCase()
  // Allow common aliases
  if (key === 'javascript' || key === 'typescript' || key === 'js' || key === 'ts') {
    return [...(DEFAULT_CONFIGS.node ?? [])]
  }
  if (key === 'py') {
    return [...(DEFAULT_CONFIGS.python ?? [])]
  }
  if (key === 'golang') {
    return [...(DEFAULT_CONFIGS.go ?? [])]
  }
  if (key === 'chromium' || key === 'browser' || key === 'web') {
    return [...(DEFAULT_CONFIGS.chrome ?? [])]
  }
  return [...(DEFAULT_CONFIGS[key] ?? [])]
}

/* ── Variable Formatting ──────────────────────────────── */

export function formatVariable(variable: Variable, depth = 0): string {
  const indent = '  '.repeat(depth)
  const typeAnnotation = variable.type ? `: ${variable.type}` : ''
  const expandable = variable.variablesReference > 0 ? ' {...}' : ''
  const visibility = variable.presentationHint?.visibility
    ? `[${variable.presentationHint.visibility}] `
    : ''

  let value = variable.value
  // Truncate very long values for display
  if (value && value.length > 200) {
    value = value.slice(0, 197) + '...'
  }

  return `${indent}${visibility}${variable.name}${typeAnnotation} = ${value}${expandable}`
}

/* ── Adapter Descriptor Helpers ───────────────────────── */

export function resolveAdapterDescriptor(
  adapterType: string,
): DebugAdapterDescriptor | null {
  switch (adapterType) {
    case 'node':
      return {
        type: 'executable',
        command: 'node',
        args: ['${extensionPath}/out/src/nodeDebug.js'],
      }
    case 'python':
      return {
        type: 'executable',
        command: 'python',
        args: ['-m', 'debugpy.adapter'],
      }
    case 'chrome':
      return {
        type: 'server',
        host: '127.0.0.1',
        port: 9222,
      }
    case 'go':
      return {
        type: 'executable',
        command: 'dlv',
        args: ['dap'],
      }
    default:
      return null
  }
}

/* ── Convenience: Full Debug Flow ─────────────────────── */

export async function startDebugging(config: LaunchConfig): Promise<DebugSession | null> {
  const session = createDebugSession(config)
  const initialized = await session.initialize()
  if (!initialized) return null

  const launched =
    config.request === 'attach' ? await session.attach() : await session.launch()
  if (!launched) return null

  await session.configurationDone()
  return session
}
