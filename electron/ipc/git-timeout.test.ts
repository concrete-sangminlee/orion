import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

interface ExecCall {
  args: string[]
  options: { timeout?: number }
}

const exec = vi.hoisted(() => ({
  calls: [] as ExecCall[],
  /** What the next git invocation does; resolves with stdout or rejects. */
  next: (_call: ExecCall): Promise<{ stdout: string; stderr: string }> => Promise.resolve({ stdout: '', stderr: '' }),
}))

vi.mock('child_process', async () => {
  const { promisify: p } = await import('node:util')
  const execFile = (() => {
    throw new Error('callback form is not used')
  }) as unknown as typeof import('child_process').execFile
  Object.assign(execFile, {
    [p.custom]: (_file: string, args: string[], options: { timeout?: number }) => {
      const call = { args, options }
      exec.calls.push(call)
      return exec.next(call)
    },
  })
  return { execFile }
})
vi.mock('./typed-ipc', () => ({
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
}))
vi.mock('./git-cwd-guard', () => ({
  resolveGitCwd: async (cwd: string) => cwd,
  resolveGitInternalPath: async () => '/nonexistent',
}))

const { registerGitHandlers, MUTATION_TIMEOUT_MS } = await import('./git')
registerGitHandlers()

const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, '/repo', ...args)

/** The error execFile produces when it kills git at the timeout. */
function killedByTimeout(): Error {
  return Object.assign(new Error('Command failed: git commit -m msg\nhusky > lint-staged running...'), {
    killed: true,
    signal: 'SIGTERM',
    code: null,
    stdout: '',
    stderr: 'husky > lint-staged running...',
  })
}

beforeEach(() => {
  exec.calls.length = 0
  exec.next = () => Promise.resolve({ stdout: '', stderr: '' })
})

describe('git timeouts', () => {
  it.each([
    ['git:commit', ['msg']],
    ['git:checkout', ['feature']],
    ['git:merge', ['feature']],
    ['git:stash', []],
    ['git:stage-all', []],
    ['git:cherry-pick', ['abc1234']],
  ])('gives the local mutation %s the long timeout, not the query one', async (channel, args) => {
    await invoke(channel, ...args)
    expect(exec.calls.at(-1)!.options.timeout).toBe(MUTATION_TIMEOUT_MS)
    expect(MUTATION_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * 60_000)
  })

  it.each([
    ['git:commit-amend', []],
    ['git:revert', ['abc1234']],
    ['git:reset', ['hard', 'HEAD']],
  ])('gives %s the mutation timeout too', async (channel, args) => {
    await invoke(channel, ...args)
    expect(exec.calls.at(-1)!.options.timeout).toBe(MUTATION_TIMEOUT_MS)
  })

  it('keeps the short timeout for read-only queries', async () => {
    await invoke('git:log', 5)
    expect(exec.calls.at(-1)!.options.timeout).toBe(10_000)
  })

  it('says the command timed out instead of showing the partial hook output', async () => {
    exec.next = () => Promise.reject(killedByTimeout())
    await expect(invoke('git:commit', 'msg')).rejects.toThrow(`git commit timed out after ${MUTATION_TIMEOUT_MS / 1000} s`)
  })

  it('still reports git\'s own message for ordinary failures', async () => {
    exec.next = () =>
      Promise.reject(Object.assign(new Error('Command failed'), { code: 1, stdout: '', stderr: 'error: pathspec did not match' }))
    await expect(invoke('git:checkout', 'nope')).rejects.toThrow('error: pathspec did not match')
  })
})
