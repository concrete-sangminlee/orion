/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElectronApi, type IpcRendererLike } from '../../electron/preload-api'
import { subscribeNativeMenu } from './nativeMenu'

type Listener = (event: unknown, ...args: unknown[]) => void

function fakeIpc() {
  const listeners = new Map<string, Set<Listener>>()
  const ipc: IpcRendererLike = {
    invoke: async () => undefined,
    send: () => {},
    on: (channel, listener) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set())
      listeners.get(channel)!.add(listener)
    },
    removeListener: (channel, listener) => listeners.get(channel)?.delete(listener),
  }
  const fromMain = (channel: string, ...args: unknown[]) => listeners.get(channel)?.forEach((l) => l({}, ...args))
  return { ipc, listeners, fromMain }
}

/** The orion:* window events (and their detail) dispatched while `fn` runs. */
function windowEvents(fn: () => void): Array<[string, unknown]> {
  const seen: Array<[string, unknown]> = []
  const original = window.dispatchEvent.bind(window)
  const spy = vi.spyOn(window, 'dispatchEvent').mockImplementation((event) => {
    if (event.type.startsWith('orion:')) seen.push([event.type, (event as CustomEvent).detail])
    return original(event)
  })
  try {
    fn()
  } finally {
    spy.mockRestore()
  }
  return seen
}

describe('native menu → commands', () => {
  const stops: Array<() => void> = []
  afterEach(() => stops.splice(0).forEach((stop) => stop()))

  function setup() {
    const fake = fakeIpc()
    stops.push(subscribeNativeMenu(createElectronApi(fake.ipc)))
    return fake
  }

  it.each([
    ['app:save', 'orion:save-file'],
    ['app:save-as', 'orion:save-file-as'],
    ['app:close-editor', 'orion:close-tab'],
    ['app:open-settings', 'orion:open-settings'],
    ['app:find', 'orion:editor-find'],
    ['app:replace', 'orion:editor-replace'],
    ['app:find-in-files', 'orion:show-search'],
    ['app:toggle-panel', 'orion:toggle-terminal'],
    ['app:go-to-line', 'orion:go-to-line'],
    ['app:new-terminal', 'orion:new-terminal'],
    ['app:split-terminal', 'orion:split-terminal'],
    ['app:run-task', 'orion:run-task'],
    ['app:run-build-task', 'orion:run-build'],
    ['app:show-keybindings', 'orion:keyboard-shortcuts'],
    ['app:open-about', 'orion:about'],
  ])('%s runs the command that dispatches %s', (channel, event) => {
    const { fromMain } = setup()
    expect(windowEvents(() => fromMain(channel)).map(([type]) => type)).toEqual([event])
  })

  it('opens the palette in the mode the menu item names', () => {
    const { fromMain } = setup()
    expect(windowEvents(() => fromMain('app:command-palette'))).toEqual([['orion:open-palette', { mode: 'commands' }]])
    expect(windowEvents(() => fromMain('app:quick-open'))).toEqual([['orion:open-palette', { mode: 'files' }]])
    expect(windowEvents(() => fromMain('app:go-to-symbol'))).toEqual([['orion:open-palette', { mode: 'symbols' }]])
  })

  it('shows the view app:toggle-sidebar names, and toggles the sidebar without one', () => {
    const { fromMain } = setup()
    expect(windowEvents(() => fromMain('app:toggle-sidebar', 'git')).map(([t]) => t)).toEqual(['orion:show-git'])
    expect(windowEvents(() => fromMain('app:toggle-sidebar', 'explorer')).map(([t]) => t)).toEqual(['orion:show-explorer'])
    expect(windowEvents(() => fromMain('app:toggle-sidebar')).map(([t]) => t)).toEqual(['orion:toggle-sidebar'])
    expect(windowEvents(() => fromMain('app:toggle-sidebar', { bogus: true })).map(([t]) => t)).toEqual(['orion:toggle-sidebar'])
  })

  it('unsubscribes from every channel', () => {
    const fake = fakeIpc()
    const stop = subscribeNativeMenu(createElectronApi(fake.ipc))
    expect([...fake.listeners.values()].some((set) => set.size > 0)).toBe(true)
    stop()
    expect([...fake.listeners.values()].every((set) => set.size === 0)).toBe(true)
  })
})
