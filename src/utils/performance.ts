/**
 * Performance utilities for production IDE.
 * Virtual scrolling, caching, debounce/throttle, monitoring.
 */

/* ── Debounce / Throttle ───────────────────────────────── */

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  ms: number,
  opts: { leading?: boolean; trailing?: boolean } = {},
): T & { cancel: () => void; flush: () => void } {
  const { leading = false, trailing = true } = opts
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null
  let lastThis: any = null
  let result: ReturnType<T>

  function debounced(this: any, ...args: Parameters<T>) {
    lastArgs = args
    lastThis = this

    if (timer === null && leading) {
      result = fn.apply(lastThis, lastArgs)
    }

    if (timer !== null) clearTimeout(timer)

    timer = setTimeout(() => {
      timer = null
      if (trailing && lastArgs) {
        result = fn.apply(lastThis, lastArgs)
        lastArgs = null
        lastThis = null
      }
    }, ms)

    return result
  }

  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    lastArgs = null
    lastThis = null
  }

  debounced.flush = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
      if (lastArgs) {
        result = fn.apply(lastThis, lastArgs)
        lastArgs = null
        lastThis = null
      }
    }
  }

  return debounced as any
}

export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  ms: number,
): T & { cancel: () => void } {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null

  function throttled(this: any, ...args: Parameters<T>) {
    const now = Date.now()
    const remaining = ms - (now - last)
    lastArgs = args

    if (remaining <= 0) {
      if (timer) { clearTimeout(timer); timer = null }
      last = now
      return fn.apply(this, args)
    }

    if (!timer) {
      timer = setTimeout(() => {
        last = Date.now()
        timer = null
        if (lastArgs) fn.apply(this, lastArgs)
      }, remaining)
    }
  }

  throttled.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    lastArgs = null
    last = 0
  }

  return throttled as any
}

/* ── LRU Cache ─────────────────────────────────────────── */

export class LRUCache<K, V> {
  private map = new Map<K, { value: V; expires: number }>()
  private maxSize: number
  private ttl: number
  hits = 0
  misses = 0

  constructor(maxSize = 128, ttlMs = 0) {
    this.maxSize = maxSize
    this.ttl = ttlMs
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key)
    if (!entry) { this.misses++; return undefined }
    if (this.ttl > 0 && Date.now() > entry.expires) {
      this.map.delete(key)
      this.misses++
      return undefined
    }
    // Move to end (most recent)
    this.map.delete(key)
    this.map.set(key, entry)
    this.hits++
    return entry.value
  }

  set(key: K, value: V): void {
    this.map.delete(key)
    if (this.map.size >= this.maxSize) {
      // Delete oldest (first entry)
      const firstKey = this.map.keys().next().value
      if (firstKey !== undefined) this.map.delete(firstKey)
    }
    this.map.set(key, {
      value,
      expires: this.ttl > 0 ? Date.now() + this.ttl : Infinity,
    })
  }

  has(key: K): boolean {
    const entry = this.map.get(key)
    if (!entry) return false
    if (this.ttl > 0 && Date.now() > entry.expires) {
      this.map.delete(key)
      return false
    }
    return true
  }

  delete(key: K): boolean {
    return this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
    this.hits = 0
    this.misses = 0
  }

  get size(): number { return this.map.size }
  get hitRate(): number {
    const total = this.hits + this.misses
    return total === 0 ? 0 : this.hits / total
  }
}

/* ── Object Pool ───────────────────────────────────────── */

export class ObjectPool<T> {
  private pool: T[] = []
  private factory: () => T
  private reset: (obj: T) => void

  constructor(factory: () => T, reset: (obj: T) => void, initialSize = 10) {
    this.factory = factory
    this.reset = reset
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(factory())
    }
  }

  acquire(): T {
    return this.pool.length > 0 ? this.pool.pop()! : this.factory()
  }

  release(obj: T): void {
    this.reset(obj)
    if (this.pool.length < 100) {
      this.pool.push(obj)
    }
  }

  get available(): number { return this.pool.length }
}

/* ── Batch Processor ───────────────────────────────────── */

export class BatchProcessor<T> {
  private queue: T[] = []
  private scheduled = false
  private processor: (batch: T[]) => void
  private batchSize: number

  constructor(processor: (batch: T[]) => void, batchSize = 50) {
    this.processor = processor
    this.batchSize = batchSize
  }

  add(item: T): void {
    this.queue.push(item)
    if (!this.scheduled) {
      this.scheduled = true
      requestAnimationFrame(() => this.flush())
    }
  }

  private flush(): void {
    this.scheduled = false
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize)
      this.processor(batch)
    }
  }

  get pending(): number { return this.queue.length }
}

/* ── Performance Monitor ───────────────────────────────── */

interface PerfEntry {
  name: string
  duration: number
  timestamp: number
}

class PerformanceMonitorImpl {
  private entries: PerfEntry[] = []
  private fpsFrames: number[] = []
  private longTasks: PerfEntry[] = []
  private _enabled = true

  mark(name: string): void {
    if (this._enabled) performance.mark(`orion:${name}`)
  }

  measure(name: string, startMark: string, endMark?: string): number {
    if (!this._enabled) return 0
    try {
      const m = endMark
        ? performance.measure(`orion:${name}`, `orion:${startMark}`, `orion:${endMark}`)
        : performance.measure(`orion:${name}`, `orion:${startMark}`)
      const duration = m.duration
      this.entries.push({ name, duration, timestamp: Date.now() })
      if (duration > 50) {
        this.longTasks.push({ name, duration, timestamp: Date.now() })
      }
      return duration
    } catch {
      return 0
    }
  }

  time<R>(name: string, fn: () => R): R {
    const start = performance.now()
    const result = fn()
    const duration = performance.now() - start
    this.entries.push({ name, duration, timestamp: Date.now() })
    if (duration > 50) {
      this.longTasks.push({ name, duration, timestamp: Date.now() })
    }
    return result
  }

  async timeAsync<R>(name: string, fn: () => Promise<R>): Promise<R> {
    const start = performance.now()
    const result = await fn()
    const duration = performance.now() - start
    this.entries.push({ name, duration, timestamp: Date.now() })
    if (duration > 50) {
      this.longTasks.push({ name, duration, timestamp: Date.now() })
    }
    return result
  }

  trackFPS(): () => void {
    let running = true
    const loop = () => {
      if (!running) return
      this.fpsFrames.push(performance.now())
      // Keep only last 2 seconds
      const cutoff = performance.now() - 2000
      while (this.fpsFrames.length > 0 && this.fpsFrames[0] < cutoff) {
        this.fpsFrames.shift()
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
    return () => { running = false }
  }

  get fps(): number {
    if (this.fpsFrames.length < 2) return 0
    const elapsed = this.fpsFrames[this.fpsFrames.length - 1] - this.fpsFrames[0]
    return elapsed > 0 ? Math.round((this.fpsFrames.length - 1) / (elapsed / 1000)) : 0
  }

  get memoryUsage(): { usedMB: number; totalMB: number } | null {
    const mem = (performance as any).memory
    if (!mem) return null
    return {
      usedMB: Math.round(mem.usedJSHeapSize / 1048576),
      totalMB: Math.round(mem.totalJSHeapSize / 1048576),
    }
  }

  getReport(): {
    entries: PerfEntry[]
    longTasks: PerfEntry[]
    fps: number
    memory: { usedMB: number; totalMB: number } | null
  } {
    return {
      entries: [...this.entries],
      longTasks: [...this.longTasks],
      fps: this.fps,
      memory: this.memoryUsage,
    }
  }

  clear(): void {
    this.entries = []
    this.longTasks = []
    this.fpsFrames = []
  }

  set enabled(v: boolean) { this._enabled = v }
  get enabled(): boolean { return this._enabled }
}

export const perfMonitor = new PerformanceMonitorImpl()

/* ── Memoized Selector ─────────────────────────────────── */

export function createMemoizedSelector<TState, TResult>(
  selector: (state: TState) => TResult,
  equalityFn: (a: TResult, b: TResult) => boolean = Object.is,
): (state: TState) => TResult {
  let lastState: TState | undefined
  let lastResult: TResult | undefined
  let initialized = false

  return (state: TState): TResult => {
    if (initialized && state === lastState) return lastResult!

    const newResult = selector(state)
    if (initialized && equalityFn(lastResult!, newResult)) {
      lastState = state
      return lastResult!
    }

    lastState = state
    lastResult = newResult
    initialized = true
    return newResult
  }
}

/* ── Virtual List Helpers ──────────────────────────────── */

export interface VirtualRange {
  startIndex: number
  endIndex: number
  offsetTop: number
}

export function computeVirtualRange(
  scrollTop: number,
  viewportHeight: number,
  itemCount: number,
  itemHeight: number,
  overscan = 5,
): VirtualRange {
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const endIndex = Math.min(
    itemCount - 1,
    Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan,
  )
  return { startIndex, endIndex, offsetTop: startIndex * itemHeight }
}

/* ── Lazy Import with Retry ────────────────────────────── */

export function lazyImport<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  retries = 3,
  retryDelay = 1000,
): React.LazyExoticComponent<T> {
  const React = require('react')
  return React.lazy(() =>
    new Promise<{ default: T }>((resolve, reject) => {
      let attempts = 0
      const tryLoad = () => {
        factory()
          .then(resolve)
          .catch((err: Error) => {
            attempts++
            if (attempts < retries) {
              setTimeout(tryLoad, retryDelay * attempts)
            } else {
              reject(err)
            }
          })
      }
      tryLoad()
    }),
  )
}
