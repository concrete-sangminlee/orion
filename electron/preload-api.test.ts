import { describe, expect, it, vi } from 'vitest'
import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS, IPC_SEND_CHANNELS } from '../shared/ipc-channels'
import { createElectronApi, type IpcRendererLike } from './preload-api'

type Listener = (event: unknown, ...args: unknown[]) => void

function createFakeIpc() {
  const invoked: Array<{ channel: string; args: unknown[] }> = []
  const sent: Array<{ channel: string; args: unknown[] }> = []
  const listeners = new Map<string, Set<Listener>>()

  const ipc: IpcRendererLike = {
    invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
      invoked.push({ channel, args })
      return `result:${channel}`
    }),
    send: vi.fn((channel: string, ...args: unknown[]) => {
      sent.push({ channel, args })
    }),
    on: vi.fn((channel: string, listener: Listener) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set())
      listeners.get(channel)!.add(listener)
    }),
    removeListener: vi.fn((channel: string, listener: Listener) => {
      listeners.get(channel)?.delete(listener)
    }),
  }

  const dispatch = (channel: string, ...args: unknown[]) => {
    for (const listener of listeners.get(channel) ?? []) listener({ sender: 'fake-event' }, ...args)
  }

  return { ipc, invoked, sent, listeners, dispatch }
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort()

describe('createElectronApi — contract coverage', () => {
  // Drive every exposed method once and record which channel it hits. This
  // proves the preload exposes every contract channel and nothing else.
  const fake = createFakeIpc()
  const host = { getPathForFile: () => '/dropped/item' }
  const api = createElectronApi(fake.ipc, host) as unknown as Record<string, (...args: unknown[]) => unknown>
  const subscribed: string[] = []

  for (const [name, method] of Object.entries(api)) {
    if (/^on[A-Z]/.test(name)) {
      const before = new Set(fake.listeners.keys())
      method(() => {})
      for (const channel of fake.listeners.keys()) if (!before.has(channel)) subscribed.push(channel)
    } else {
      void method('a', 'b', 'c', 'd', 'e')
    }
  }

  it('invokes exactly the contract invoke channels', () => {
    expect(sorted(fake.invoked.map((c) => c.channel))).toEqual(sorted(IPC_INVOKE_CHANNELS))
  })

  it('sends exactly the contract send channels', () => {
    expect(sorted(fake.sent.map((c) => c.channel))).toEqual(sorted(IPC_SEND_CHANNELS))
  })

  it('subscribes to exactly the contract event channels', () => {
    expect(sorted(subscribed)).toEqual(sorted(IPC_EVENT_CHANNELS))
  })
})

describe('createElectronApi — dropped files', () => {
  it('reports the path Electron resolved for an OS file and returns it', () => {
    const fake = createFakeIpc()
    const file = { name: 'notes.md' }
    const getPathForFile = vi.fn(() => '/home/me/notes.md')
    const api = createElectronApi(fake.ipc, { getPathForFile })

    expect(api.pathForDroppedFile(file)).toBe('/home/me/notes.md')
    expect(getPathForFile).toHaveBeenCalledWith(file)
    expect(fake.sent).toEqual([{ channel: 'fs:grant-dropped-path', args: ['/home/me/notes.md'] }])
  })

  it('grants nothing for a File that does not come from the OS', () => {
    const fake = createFakeIpc()
    const api = createElectronApi(fake.ipc, { getPathForFile: () => '' })
    expect(api.pathForDroppedFile({})).toBe('')
    expect(fake.sent).toEqual([])
  })

  it('never takes the path from page code', () => {
    // The page passes a File; a forged `path` property on it is ignored.
    const fake = createFakeIpc()
    const api = createElectronApi(fake.ipc, { getPathForFile: () => '' })
    expect(api.pathForDroppedFile({ path: '/etc/shadow' })).toBe('')
    expect(fake.sent).toEqual([])
  })
})

describe('createElectronApi — argument forwarding', () => {
  it('forwards git:create-tag options positionally in handler order', async () => {
    const fake = createFakeIpc()
    const api = createElectronApi(fake.ipc)
    await api.gitCreateTag('/repo', 'v1.0.0', { message: 'release', hash: 'abc1234', force: true })
    expect(fake.invoked).toEqual([
      { channel: 'git:create-tag', args: ['/repo', 'v1.0.0', 'release', 'abc1234', true] },
    ])
  })

  it('applies push/pull/commit defaults the main handlers expect', async () => {
    const fake = createFakeIpc()
    const api = createElectronApi(fake.ipc)
    await api.gitPush('/repo')
    await api.gitPush('/repo', 'origin', 'feature', false, true)
    await api.gitPull('/repo')
    await api.gitCommit('/repo', 'msg')
    expect(fake.invoked).toEqual([
      // No remote: main runs plain `git push`/`git pull`, following the upstream.
      { channel: 'git:push', args: ['/repo', undefined, undefined, false, false] },
      { channel: 'git:push', args: ['/repo', 'origin', 'feature', false, true] },
      { channel: 'git:pull', args: ['/repo', undefined, undefined] },
      { channel: 'git:commit', args: ['/repo', 'msg', false] },
    ])
  })

  it('forwards the remote ref a checkout should track', async () => {
    const fake = createFakeIpc()
    const api = createElectronApi(fake.ipc)
    await api.gitCheckout('/repo', 'feature', 'origin/feature')
    expect(fake.invoked).toEqual([{ channel: 'git:checkout', args: ['/repo', 'feature', 'origin/feature'] }])
  })

  it('defaults createFile content to an empty string', async () => {
    const fake = createFakeIpc()
    const api = createElectronApi(fake.ipc)
    await api.createFile('/ws/new.ts')
    expect(fake.invoked).toEqual([{ channel: 'fs:create-file', args: ['/ws/new.ts', ''] }])
  })

  it('resolves with the handler result', async () => {
    const fake = createFakeIpc()
    const api = createElectronApi(fake.ipc)
    await expect(api.gitStatus('/repo')).resolves.toBe('result:git:status')
  })

  it('forwards the initial terminal size with term:create', async () => {
    const fake = createFakeIpc()
    const api = createElectronApi(fake.ipc)
    await api.termCreate('term-1', { shellPath: '/bin/bash' }, { cols: 140, rows: 12 })
    expect(fake.invoked).toEqual([
      { channel: 'term:create', args: ['term-1', { shellPath: '/bin/bash' }, { cols: 140, rows: 12 }] },
    ])
  })

  it('sends the chat cancel message on omo:send', () => {
    const fake = createFakeIpc()
    const api = createElectronApi(fake.ipc)
    api.omoSend({ type: 'cancel', payload: {} })
    expect(fake.sent).toEqual([{ channel: 'omo:send', args: [{ type: 'cancel', payload: {} }] }])
  })
})

describe('createElectronApi — event subscriptions', () => {
  it('strips the IPC event object and forwards all payload arguments', () => {
    const fake = createFakeIpc()
    const api = createElectronApi(fake.ipc)
    const onData = vi.fn()
    api.onTermData(onData)
    fake.dispatch('term:data', 'term-1', 'hello')
    expect(onData).toHaveBeenCalledWith('term-1', 'hello')
  })

  it('forwards the terminal id and exit code of term:exit', () => {
    const fake = createFakeIpc()
    const api = createElectronApi(fake.ipc)
    const onExit = vi.fn()
    api.onTermExit(onExit)
    fake.dispatch('term:exit', 'term-1', 130)
    expect(onExit).toHaveBeenCalledWith('term-1', 130)
  })

  it('calls argument-less menu callbacks without leaking payloads', () => {
    const fake = createFakeIpc()
    const api = createElectronApi(fake.ipc)
    const onSave = vi.fn()
    api.onAppSave(onSave)
    fake.dispatch('app:save', 'unexpected')
    expect(onSave).toHaveBeenCalledWith()
  })

  it('unsubscribe removes exactly the registered listener', () => {
    const fake = createFakeIpc()
    const api = createElectronApi(fake.ipc)
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = api.onAppOpenFile(first)
    api.onAppOpenFile(second)
    unsubscribeFirst()
    fake.dispatch('app:open-file', '/tmp/a.ts')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('/tmp/a.ts')
  })
})
