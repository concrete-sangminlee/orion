/**
 * Performance monitoring and profiling utilities.
 * Tracks startup time, memory usage, frame rate, operation latency,
 * and provides performance budgets with alerting.
 */

/* ── Types ─────────────────────────────────────────────── */

export interface PerfMark {
  name: string
  start: number
  end?: number
  duration?: number
  metadata?: Record<string, unknown>
}

export interface PerfMetric {
  name: string
  value: number
  unit: 'ms' | 'bytes' | 'fps' | 'count' | 'percent'
  timestamp: number
  category: MetricCategory
}

export type MetricCategory =
  | 'startup'
  | 'editor'
  | 'rendering'
  | 'network'
  | 'memory'
  | 'io'
  | 'extension'
  | 'ai'
  | 'user'

export interface PerfBudget {
  metric: string
  threshold: number
  unit: 'ms' | 'bytes' | 'fps'
  action: 'warn' | 'error' | 'throttle'
}

export interface PerfReport {
  timestamp: number
  duration: number
  metrics: PerfMetric[]
  marks: PerfMark[]
  violations: BudgetViolation[]
  memory: MemorySnapshot
  fps: FPSData
}

export interface BudgetViolation {
  budget: PerfBudget
  actual: number
  overBy: number
  timestamp: number
}

export interface MemorySnapshot {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
  domNodeCount: number
  listenerCount: number
}

export interface FPSData {
  current: number
  average: number
  min: number
  max: number
  droppedFrames: number
}

/* ── Performance Monitor ───────────────────────────────── */

class PerformanceMonitorImpl {
  private marks = new Map<string, PerfMark>()
  private completedMarks: PerfMark[] = []
  private metrics: PerfMetric[] = []
  private budgets: PerfBudget[] = []
  private violations: BudgetViolation[] = []
  private fpsFrames: number[] = []
  private fpsAnimationId: number | null = null
  private lastFrameTime = 0
  private listeners = new Map<string, Set<(data: any) => void>>()
  private maxHistory = 5000
  private enabled = true

  /** Start a performance mark */
  mark(name: string, metadata?: Record<string, unknown>): () => number {
    if (!this.enabled) return () => 0

    const start = performance.now()
    const mark: PerfMark = { name, start, metadata }
    this.marks.set(name, mark)

    // Return a function that ends the mark and returns duration
    return () => {
      const end = performance.now()
      mark.end = end
      mark.duration = end - start
      this.completedMarks.push(mark)
      this.marks.delete(name)

      this.trimHistory()
      this.emit('mark', mark)
      this.checkBudgets(name, mark.duration, 'ms')

      return mark.duration
    }
  }

  /** Measure async operation */
  async measure<T>(name: string, fn: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
    const end = this.mark(name, metadata)
    try {
      const result = await fn()
      const duration = end()
      this.recordMetric(name, duration, 'ms', this.categorize(name))
      return result
    } catch (err) {
      end()
      throw err
    }
  }

  /** Measure sync operation */
  measureSync<T>(name: string, fn: () => T, metadata?: Record<string, unknown>): T {
    const end = this.mark(name, metadata)
    try {
      const result = fn()
      const duration = end()
      this.recordMetric(name, duration, 'ms', this.categorize(name))
      return result
    } catch (err) {
      end()
      throw err
    }
  }

  /** Record a metric value */
  recordMetric(name: string, value: number, unit: PerfMetric['unit'], category: MetricCategory = 'user'): void {
    if (!this.enabled) return

    const metric: PerfMetric = {
      name,
      value,
      unit,
      timestamp: Date.now(),
      category,
    }

    this.metrics.push(metric)
    this.trimHistory()
    this.emit('metric', metric)
    this.checkBudgets(name, value, unit)
  }

  /** Set a performance budget */
  setBudget(budget: PerfBudget): void {
    const existing = this.budgets.findIndex(b => b.metric === budget.metric)
    if (existing >= 0) {
      this.budgets[existing] = budget
    } else {
      this.budgets.push(budget)
    }
  }

  /** Remove a budget */
  removeBudget(metric: string): void {
    this.budgets = this.budgets.filter(b => b.metric !== metric)
  }

  /** Start FPS monitoring */
  startFPSMonitoring(): void {
    if (this.fpsAnimationId !== null) return

    this.lastFrameTime = performance.now()
    const tick = (now: number) => {
      const delta = now - this.lastFrameTime
      if (delta > 0) {
        this.fpsFrames.push(1000 / delta)
        if (this.fpsFrames.length > 300) this.fpsFrames.shift()
      }
      this.lastFrameTime = now
      this.fpsAnimationId = requestAnimationFrame(tick)
    }
    this.fpsAnimationId = requestAnimationFrame(tick)
  }

  /** Stop FPS monitoring */
  stopFPSMonitoring(): void {
    if (this.fpsAnimationId !== null) {
      cancelAnimationFrame(this.fpsAnimationId)
      this.fpsAnimationId = null
    }
  }

  /** Get current FPS data */
  getFPS(): FPSData {
    if (this.fpsFrames.length === 0) {
      return { current: 0, average: 0, min: 0, max: 0, droppedFrames: 0 }
    }

    const current = this.fpsFrames[this.fpsFrames.length - 1] || 0
    const sum = this.fpsFrames.reduce((a, b) => a + b, 0)
    const average = sum / this.fpsFrames.length
    const min = Math.min(...this.fpsFrames)
    const max = Math.max(...this.fpsFrames)
    const droppedFrames = this.fpsFrames.filter(f => f < 30).length

    return {
      current: Math.round(current),
      average: Math.round(average),
      min: Math.round(min),
      max: Math.round(max),
      droppedFrames,
    }
  }

  /** Get memory snapshot */
  getMemory(): MemorySnapshot {
    const perf = (performance as any)
    const memory = perf.memory || {}

    return {
      usedJSHeapSize: memory.usedJSHeapSize || 0,
      totalJSHeapSize: memory.totalJSHeapSize || 0,
      jsHeapSizeLimit: memory.jsHeapSizeLimit || 0,
      domNodeCount: document.getElementsByTagName('*').length,
      listenerCount: 0, // Not easily accessible
    }
  }

  /** Generate a performance report */
  generateReport(windowMs = 60000): PerfReport {
    const now = Date.now()
    const cutoff = now - windowMs

    return {
      timestamp: now,
      duration: windowMs,
      metrics: this.metrics.filter(m => m.timestamp > cutoff),
      marks: this.completedMarks.filter(m => (m.end || 0) > performance.now() - windowMs),
      violations: this.violations.filter(v => v.timestamp > cutoff),
      memory: this.getMemory(),
      fps: this.getFPS(),
    }
  }

  /** Get metrics for a specific category */
  getMetricsByCategory(category: MetricCategory): PerfMetric[] {
    return this.metrics.filter(m => m.category === category)
  }

  /** Get average value for a named metric */
  getAverage(name: string, windowMs = 60000): number {
    const cutoff = Date.now() - windowMs
    const matching = this.metrics.filter(m => m.name === name && m.timestamp > cutoff)
    if (matching.length === 0) return 0
    return matching.reduce((sum, m) => sum + m.value, 0) / matching.length
  }

  /** Get P95 for a named metric */
  getP95(name: string, windowMs = 60000): number {
    const cutoff = Date.now() - windowMs
    const values = this.metrics
      .filter(m => m.name === name && m.timestamp > cutoff)
      .map(m => m.value)
      .sort((a, b) => a - b)

    if (values.length === 0) return 0
    const idx = Math.floor(values.length * 0.95)
    return values[idx]
  }

  /** Subscribe to performance events */
  on(event: string, handler: (data: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler)
    return () => this.listeners.get(event)?.delete(handler)
  }

  /** Enable/disable monitoring */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.stopFPSMonitoring()
    }
  }

  /** Clear all data */
  reset(): void {
    this.marks.clear()
    this.completedMarks = []
    this.metrics = []
    this.violations = []
    this.fpsFrames = []
  }

  /** Get all budget violations */
  getViolations(windowMs = 60000): BudgetViolation[] {
    const cutoff = Date.now() - windowMs
    return this.violations.filter(v => v.timestamp > cutoff)
  }

  private checkBudgets(name: string, value: number, unit: string): void {
    for (const budget of this.budgets) {
      if (budget.metric === name && budget.unit === unit) {
        if (value > budget.threshold) {
          const violation: BudgetViolation = {
            budget,
            actual: value,
            overBy: value - budget.threshold,
            timestamp: Date.now(),
          }
          this.violations.push(violation)
          this.emit('violation', violation)

          if (budget.action === 'error') {
            console.error(`[Perf] Budget exceeded: ${name} = ${value.toFixed(1)}${unit} (limit: ${budget.threshold}${unit})`)
          } else if (budget.action === 'warn') {
            console.warn(`[Perf] Budget warning: ${name} = ${value.toFixed(1)}${unit} (limit: ${budget.threshold}${unit})`)
          }
        }
      }
    }
  }

  private categorize(name: string): MetricCategory {
    if (name.startsWith('startup.') || name.includes('init') || name.includes('boot')) return 'startup'
    if (name.startsWith('editor.') || name.includes('monaco')) return 'editor'
    if (name.startsWith('render.') || name.includes('paint') || name.includes('layout')) return 'rendering'
    if (name.startsWith('fetch.') || name.includes('api') || name.includes('request')) return 'network'
    if (name.includes('memory') || name.includes('gc') || name.includes('heap')) return 'memory'
    if (name.includes('file') || name.includes('read') || name.includes('write') || name.includes('fs')) return 'io'
    if (name.includes('extension') || name.includes('plugin')) return 'extension'
    if (name.includes('ai') || name.includes('completion') || name.includes('llm')) return 'ai'
    return 'user'
  }

  private emit(event: string, data: any): void {
    this.listeners.get(event)?.forEach(h => {
      try { h(data) } catch {}
    })
  }

  private trimHistory(): void {
    if (this.completedMarks.length > this.maxHistory) {
      this.completedMarks = this.completedMarks.slice(-this.maxHistory)
    }
    if (this.metrics.length > this.maxHistory) {
      this.metrics = this.metrics.slice(-this.maxHistory)
    }
    if (this.violations.length > this.maxHistory) {
      this.violations = this.violations.slice(-this.maxHistory)
    }
  }
}

/* ── Singleton & Export ────────────────────────────────── */

export const perfMonitor = new PerformanceMonitorImpl()

/* ── Startup Timer ─────────────────────────────────────── */

export class StartupTimer {
  private phases: { name: string; start: number; end?: number }[] = []
  private startTime = performance.now()

  addPhase(name: string): () => void {
    const phase = { name, start: performance.now() }
    this.phases.push(phase)

    return () => {
      phase.end = performance.now()
      const duration = phase.end - phase.start
      perfMonitor.recordMetric(`startup.${name}`, duration, 'ms', 'startup')
    }
  }

  getTotalTime(): number {
    return performance.now() - this.startTime
  }

  getPhases(): { name: string; duration: number }[] {
    return this.phases
      .filter(p => p.end !== undefined)
      .map(p => ({ name: p.name, duration: p.end! - p.start }))
  }

  report(): string {
    const total = this.getTotalTime()
    const phases = this.getPhases()
    const lines = [
      `Startup: ${total.toFixed(0)}ms`,
      ...phases.map(p => `  ${p.name}: ${p.duration.toFixed(0)}ms`),
    ]
    return lines.join('\n')
  }
}

/* ── Debounced Performance Observer ────────────────────── */

export class LayoutShiftObserver {
  private observer: PerformanceObserver | null = null
  private totalCLS = 0

  start(): void {
    if (typeof PerformanceObserver === 'undefined') return

    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry as any).hadRecentInput) {
            this.totalCLS += (entry as any).value || 0
          }
        }
        perfMonitor.recordMetric('cls', this.totalCLS, 'count', 'rendering')
      })
      this.observer.observe({ type: 'layout-shift', buffered: true })
    } catch {
      // Not supported in this environment
    }
  }

  getCLS(): number {
    return this.totalCLS
  }

  stop(): void {
    this.observer?.disconnect()
    this.observer = null
  }
}

/* ── Long Task Observer ────────────────────────────────── */

export class LongTaskObserver {
  private observer: PerformanceObserver | null = null
  private longTasks: { duration: number; timestamp: number }[] = []

  start(threshold = 50): void {
    if (typeof PerformanceObserver === 'undefined') return

    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > threshold) {
            this.longTasks.push({
              duration: entry.duration,
              timestamp: Date.now(),
            })
            perfMonitor.recordMetric('longTask', entry.duration, 'ms', 'rendering')
          }
        }
      })
      this.observer.observe({ type: 'longtask', buffered: true })
    } catch {
      // Not supported
    }
  }

  getLongTasks(windowMs = 60000): { duration: number; timestamp: number }[] {
    const cutoff = Date.now() - windowMs
    return this.longTasks.filter(t => t.timestamp > cutoff)
  }

  stop(): void {
    this.observer?.disconnect()
    this.observer = null
  }
}

/* ── Resource Timing ───────────────────────────────────── */

export function getResourceTimings(filter?: string): { name: string; duration: number; size: number }[] {
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]

  return entries
    .filter(e => !filter || e.name.includes(filter))
    .map(e => ({
      name: e.name.split('/').pop() || e.name,
      duration: e.duration,
      size: e.transferSize || 0,
    }))
    .sort((a, b) => b.duration - a.duration)
}

/* ── Default Budgets ───────────────────────────────────── */

export function setDefaultBudgets(): void {
  perfMonitor.setBudget({ metric: 'startup.total', threshold: 3000, unit: 'ms', action: 'warn' })
  perfMonitor.setBudget({ metric: 'editor.openFile', threshold: 500, unit: 'ms', action: 'warn' })
  perfMonitor.setBudget({ metric: 'editor.save', threshold: 200, unit: 'ms', action: 'warn' })
  perfMonitor.setBudget({ metric: 'search.query', threshold: 1000, unit: 'ms', action: 'warn' })
  perfMonitor.setBudget({ metric: 'ai.completion', threshold: 5000, unit: 'ms', action: 'warn' })
  perfMonitor.setBudget({ metric: 'render.frame', threshold: 16, unit: 'ms', action: 'throttle' })
  perfMonitor.setBudget({ metric: 'longTask', threshold: 100, unit: 'ms', action: 'warn' })
}

/* ── Convenience Decorators ────────────────────────────── */

export function timed(target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
  const original = descriptor.value
  descriptor.value = function (...args: any[]) {
    const end = perfMonitor.mark(`${target.constructor.name}.${propertyKey}`)
    try {
      const result = original.apply(this, args)
      if (result instanceof Promise) {
        return result.finally(end)
      }
      end()
      return result
    } catch (err) {
      end()
      throw err
    }
  }
  return descriptor
}

/* ── Memory Leak Detection ─────────────────────────────── */

export class MemoryLeakDetector {
  private snapshots: { timestamp: number; heapSize: number }[] = []
  private intervalId: ReturnType<typeof setInterval> | null = null

  start(intervalMs = 30000): void {
    this.stop()
    this.intervalId = setInterval(() => {
      const memory = (performance as any).memory
      if (memory) {
        this.snapshots.push({
          timestamp: Date.now(),
          heapSize: memory.usedJSHeapSize,
        })
        // Keep last 100 snapshots
        if (this.snapshots.length > 100) this.snapshots.shift()

        // Check for leak pattern: monotonically increasing heap over 10+ snapshots
        if (this.snapshots.length >= 10) {
          const recent = this.snapshots.slice(-10)
          const isIncreasing = recent.every((s, i) =>
            i === 0 || s.heapSize > recent[i - 1].heapSize
          )
          if (isIncreasing) {
            const growth = recent[recent.length - 1].heapSize - recent[0].heapSize
            console.warn(`[Perf] Potential memory leak detected: heap grew ${(growth / 1024 / 1024).toFixed(1)}MB over ${(recent.length * intervalMs / 1000).toFixed(0)}s`)
            perfMonitor.recordMetric('memoryLeak.suspected', growth, 'bytes', 'memory')
          }
        }
      }
    }, intervalMs)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  getSnapshots(): { timestamp: number; heapSize: number }[] {
    return [...this.snapshots]
  }
}
