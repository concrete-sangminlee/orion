/**
 * Test doubles for the terminal panels: a fake xterm (jsdom has no canvas or
 * layout) and a fake `window.api` terminal bridge.
 *
 * Use from a test file with:
 *   vi.mock('@xterm/xterm', async () => (await import('./__tests__/fakeXterm')).xtermModule)
 *   vi.mock('@xterm/addon-fit', async () => (await import('./__tests__/fakeXterm')).fitModule)
 *   vi.mock('@xterm/addon-search', async () => (await import('./__tests__/fakeXterm')).searchModule)
 *   vi.mock('@xterm/addon-web-links', async () => (await import('./__tests__/fakeXterm')).webLinksModule)
 */
import { vi } from 'vitest'

type Listener<T> = (value: T) => void

interface LinkProvider {
  provideLinks(line: number, callback: (links: Array<{ text: string; activate: () => void }> | undefined) => void): void
}

export class FakeTerminal {
  static instances: FakeTerminal[] = []

  options: Record<string, unknown>
  cols = 120
  rows = 18
  disposed = false
  written: string[] = []
  clear = vi.fn()
  keyHandler: ((event: KeyboardEvent) => boolean) | null = null
  linkProvider: LinkProvider | null = null
  /** Text of buffer line 0, read by the file-link provider. */
  lineText = ''
  addons: unknown[] = []
  private titleListeners: Array<Listener<string>> = []
  private dataListeners: Array<Listener<string>> = []

  buffer = {
    active: {
      getLine: (index: number) => (index === 0 ? { translateToString: () => this.lineText } : undefined),
    },
  }

  constructor(options: Record<string, unknown>) {
    this.options = { ...options }
    FakeTerminal.instances.push(this)
  }

  loadAddon(addon: unknown) { this.addons.push(addon) }
  open() {}
  paste() {}
  getSelection() { return '' }
  registerLinkProvider(provider: LinkProvider) { this.linkProvider = provider; return { dispose() {} } }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) { this.keyHandler = handler }
  onTitleChange(cb: Listener<string>) { this.titleListeners.push(cb); return { dispose() {} } }
  onData(cb: Listener<string>) { this.dataListeners.push(cb); return { dispose() {} } }
  onResize() { return { dispose() {} } }
  write(data: string) { this.written.push(data) }
  writeln(data: string) { this.written.push(`${data}\n`) }
  dispose() { this.disposed = true }

  /** Simulate the shell setting the window title (OSC 0/2). */
  emitTitle(title: string) { for (const cb of this.titleListeners) cb(title) }
  /** Simulate the user typing. */
  type(data: string) { for (const cb of this.dataListeners) cb(data) }

  /** The links the file-link provider finds on a line of output. */
  linksFor(text: string): Array<{ text: string; activate: () => void }> {
    this.lineText = text
    let found: Array<{ text: string; activate: () => void }> = []
    this.linkProvider?.provideLinks(1, (links) => { found = links ?? [] })
    return found
  }

  /** The fit() spy of this terminal's FitAddon. */
  get fit(): ReturnType<typeof vi.fn> {
    return (this.addons.find((a) => a instanceof FakeFitAddon) as FakeFitAddon).fit
  }
}

export class FakeFitAddon {
  fit = vi.fn()
}

export const xtermModule = { Terminal: FakeTerminal }
export const fitModule = { FitAddon: FakeFitAddon }
export const searchModule = { SearchAddon: class { findNext() { return false } findPrevious() { return false } } }
export const webLinksModule = { WebLinksAddon: class {} }

export function liveTerminals(): FakeTerminal[] {
  return FakeTerminal.instances.filter((t) => !t.disposed)
}

export function installTerminalApi() {
  const dataListeners = new Set<(id: string, data: string) => void>()
  const exitListeners = new Set<(id: string, exitCode: number) => void>()
  const api = {
    termCreate: vi.fn(async (_id: string, _shell?: unknown, _size?: unknown) => ({ success: true }) as { success: boolean; error?: string }),
    termWrite: vi.fn(),
    termResize: vi.fn(),
    termKill: vi.fn(),
    onTermData: vi.fn((cb: (id: string, data: string) => void) => { dataListeners.add(cb); return () => dataListeners.delete(cb) }),
    onTermExit: vi.fn((cb: (id: string, exitCode: number) => void) => { exitListeners.add(cb); return () => exitListeners.delete(cb) }),
    taskListScripts: vi.fn(async (_cwd: string) => [] as Array<{ name: string; command: string }>),
    readFile: vi.fn(async (_path: string) => ({ content: 'x', language: 'typescript' })),
    emitExit: (id: string, exitCode: number) => { for (const cb of exitListeners) cb(id, exitCode) },
  }
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true })
  return api
}

const resizeCallbacks = new Set<() => void>()

/** Run every live ResizeObserver callback, as the browser does after a layout change. */
export function fireResizeObservers() {
  for (const cb of [...resizeCallbacks]) cb()
}

/**
 * jsdom has no layout: give elements a size unless they or an ancestor are
 * display:none, as Chromium does. Returns the restore function.
 */
export function mockLayoutFromDisplay(): () => void {
  const shown = (el: HTMLElement) => {
    for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n.style.display === 'none') return false
    return true
  }
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    .mockImplementation(function (this: HTMLElement) { return shown(this) ? 800 : 0 })
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    .mockImplementation(function (this: HTMLElement) { return shown(this) ? 300 : 0 })
  return () => { width.mockRestore(); height.mockRestore() }
}

export function resetFakes() {
  FakeTerminal.instances.length = 0
  resizeCallbacks.clear()
  globalThis.ResizeObserver = class {
    private cb: () => void
    constructor(cb: () => void) { this.cb = cb }
    observe() { resizeCallbacks.add(this.cb) }
    unobserve() {}
    disconnect() { resizeCallbacks.delete(this.cb) }
  } as unknown as typeof ResizeObserver
}
