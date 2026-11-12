import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: any[]) => any>()
const emitted: unknown[][] = []
const emitTargets: unknown[] = []

vi.mock('./typed-ipc', () => ({
  handle: (channel: string, fn: (...args: any[]) => any) => handlers.set(channel, fn),
  listen: (channel: string, fn: (...args: any[]) => any) => handlers.set(channel, fn),
  emit: (target: unknown, ...rest: unknown[]) => { emitTargets.push(target); emitted.push(rest) },
}))

const manager = vi.hoisted(() => ({
  createTerminal: vi.fn(async () => ({ success: true })),
  writeToTerminal: vi.fn(),
  resizeTerminal: vi.fn(),
  killTerminal: vi.fn(),
  killTerminalsOwnedBy: vi.fn(),
}))
vi.mock('../terminal/manager', () => manager)

const { registerTerminalHandlers } = await import('./terminal')
registerTerminalHandlers()

function fakeSender(id: number) {
  const listeners = new Map<string, () => void>()
  return {
    id,
    once: vi.fn((name: string, cb: () => void) => listeners.set(name, cb)),
    fire: (name: string) => listeners.get(name)?.(),
  }
}

const call = (channel: string, event: unknown, ...args: unknown[]) => handlers.get(channel)!(event, ...args)

beforeEach(() => {
  vi.clearAllMocks()
  emitted.length = 0
  emitTargets.length = 0
})

describe('terminal IPC handlers', () => {
  it('passes the validated initial size to the pty', async () => {
    const sender = fakeSender(1)
    await call('term:create', { sender }, 't1', { shellPath: '/bin/bash' }, { cols: 140, rows: 12 })
    expect(manager.createTerminal).toHaveBeenCalledWith(
      't1', expect.anything(), { shellPath: '/bin/bash' }, { cols: 140, rows: 12 }, 1,
    )
  })

  it('rejects a malformed size or id without spawning', async () => {
    const sender = fakeSender(1)
    await expect(call('term:create', { sender }, 't1', undefined, { cols: -1, rows: 'x' }))
      .resolves.toMatchObject({ success: false })
    await expect(call('term:create', { sender }, 42)).resolves.toMatchObject({ success: false })
    expect(manager.createTerminal).not.toHaveBeenCalled()
  })

  it('forwards output and a shell exit to the window that created the shell', async () => {
    const sender = fakeSender(1)
    await call('term:create', { sender }, 't1')
    const [, callbacks] = manager.createTerminal.mock.calls[0] as unknown as [string, { onData: (data: string) => void; onExit: (code: number) => void }]
    callbacks.onData('hi')
    callbacks.onExit(2)
    expect(emitted).toEqual([['term:data', 't1', 'hi'], ['term:exit', 't1', 2]])
    expect(emitTargets).toEqual([sender, sender])
  })

  it('kills the shells of a window when its webContents is destroyed, hooking it once', async () => {
    const sender = fakeSender(7)
    await call('term:create', { sender }, 'a')
    await call('term:create', { sender }, 'b')
    expect(sender.once).toHaveBeenCalledTimes(1)
    sender.fire('destroyed')
    expect(manager.killTerminalsOwnedBy).toHaveBeenCalledWith(7)
  })

  it('ignores resize requests that are not a positive integer grid', () => {
    call('term:resize', {}, 't1', 0, 24)
    call('term:resize', {}, 't1', 80.5, 24)
    call('term:resize', {}, 't1', '80', 24)
    expect(manager.resizeTerminal).not.toHaveBeenCalled()
    call('term:resize', {}, 't1', 120, 30)
    expect(manager.resizeTerminal).toHaveBeenCalledWith('t1', 120, 30)
  })

  it('ignores writes that are not strings', () => {
    call('term:write', {}, 't1', { toString: () => 'rm -rf /' })
    expect(manager.writeToTerminal).not.toHaveBeenCalled()
  })
})
