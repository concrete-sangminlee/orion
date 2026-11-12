import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakePty {
  file: string
  args: string[]
  options: { cols: number; rows: number }
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  onData: (cb: (data: string) => void) => void
  onExit: (cb: (event: { exitCode: number }) => void) => void
  emitExit: (exitCode: number) => void
}

const spawned: FakePty[] = []

function spawn(file: string, args: string[], options: { cols: number; rows: number }): FakePty {
  let exitListener: ((event: { exitCode: number }) => void) | undefined
  const pty: FakePty = {
    file,
    args,
    options,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: () => {},
    onExit: (cb) => { exitListener = cb },
    emitExit: (exitCode) => exitListener?.({ exitCode }),
  }
  spawned.push(pty)
  return pty
}

// manager.ts loads the native addon through createRequire; hand it a fake.
vi.mock('module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('module')>()
  return { ...actual, createRequire: () => (id: string) => (id === 'node-pty' ? { spawn } : actual.createRequire(import.meta.url)(id)) }
})

const manager = await import('./manager')

function callbacks() {
  return { onData: vi.fn(), onExit: vi.fn() }
}

beforeEach(() => {
  manager.killAllTerminals()
  spawned.length = 0
})

describe('terminal manager', () => {
  it('spawns the pty at the size of the view', async () => {
    await manager.createTerminal('t1', callbacks(), { shellPath: '/bin/bash' }, { cols: 140, rows: 12 })
    expect(spawned[0].options).toMatchObject({ cols: 140, rows: 12 })
  })

  it('falls back to 80x24 when no size is given', async () => {
    await manager.createTerminal('t1', callbacks(), { shellPath: '/bin/bash' })
    expect(spawned[0].options).toMatchObject({ cols: 80, rows: 24 })
  })

  it('reports a shell that exits by itself and forgets it', async () => {
    const cb = callbacks()
    await manager.createTerminal('t1', cb, { shellPath: '/bin/bash' })
    spawned[0].emitExit(3)
    expect(cb.onExit).toHaveBeenCalledWith(3)
    manager.writeToTerminal('t1', 'ls\r')
    expect(spawned[0].write).not.toHaveBeenCalled()
  })

  it('does not report an exit for a terminal that was killed on purpose', async () => {
    const cb = callbacks()
    await manager.createTerminal('t1', cb, { shellPath: '/bin/bash' })
    manager.killTerminal('t1')
    spawned[0].emitExit(0)
    expect(spawned[0].kill).toHaveBeenCalledTimes(1)
    expect(cb.onExit).not.toHaveBeenCalled()
  })

  it('kills the old shell when an id is created again, and ignores its late exit', async () => {
    const first = callbacks()
    const second = callbacks()
    await manager.createTerminal('t1', first, { shellPath: '/bin/bash' })
    await manager.createTerminal('t1', second, { shellPath: '/bin/bash' })
    expect(spawned[0].kill).toHaveBeenCalledTimes(1)
    spawned[0].emitExit(0)
    expect(first.onExit).not.toHaveBeenCalled()
    expect(second.onExit).not.toHaveBeenCalled()
    manager.writeToTerminal('t1', 'x')
    expect(spawned[1].write).toHaveBeenCalledWith('x')
  })

  it('kills only the terminals of the window that went away', async () => {
    await manager.createTerminal('a', callbacks(), { shellPath: '/bin/bash' }, undefined, 1)
    await manager.createTerminal('b', callbacks(), { shellPath: '/bin/bash' }, undefined, 2)
    manager.killTerminalsOwnedBy(1)
    expect(spawned[0].kill).toHaveBeenCalledTimes(1)
    expect(spawned[1].kill).not.toHaveBeenCalled()
  })

  it('killAllTerminals kills every shell', async () => {
    await manager.createTerminal('a', callbacks(), { shellPath: '/bin/bash' }, undefined, 1)
    await manager.createTerminal('b', callbacks(), { shellPath: '/bin/bash' }, undefined, 2)
    manager.killAllTerminals()
    expect(spawned.map((p) => p.kill.mock.calls.length)).toEqual([1, 1])
  })

  it('survives a resize racing with the shell exiting', async () => {
    await manager.createTerminal('t1', callbacks(), { shellPath: '/bin/bash' })
    spawned[0].resize.mockImplementation(() => { throw new Error('ioctl(2) failed, EBADF') })
    expect(() => manager.resizeTerminal('t1', 100, 30)).not.toThrow()
  })
})
