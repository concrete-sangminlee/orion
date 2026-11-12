/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitRemote, GitStatusResult } from '@shared/ipc-contract'
import { useFileStore } from '@/store/files'
import { useScmStore } from '@/store/scm'
import { useToastStore } from '@/store/toast'
import { pullCurrentBranch, pushCurrentBranch, useGitCommands } from './useGitCommands'

let status: GitStatusResult
let remotes: GitRemote[]
let stashCount: number

const api = {
  gitStatus: vi.fn(async () => status),
  gitRemotes: vi.fn(async () => remotes),
  gitStageAll: vi.fn(async () => true),
  gitUnstageAll: vi.fn(async () => true),
  gitPush: vi.fn(async () => ''),
  gitPull: vi.fn(async () => ''),
  gitFetch: vi.fn(async () => ''),
  gitStash: vi.fn(async () => ''),
  gitStashList: vi.fn(async () => Array.from({ length: stashCount }, (_, index) => ({ index, hash: 'h', message: 'm' }))),
}
const addToast = vi.fn()

function statusWith(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    isRepo: true, branch: 'main', detached: false, head: '', upstream: 'origin/main',
    files: [], staged: [], unstaged: [], ahead: 0, behind: 0, ...overrides,
  }
}

const remote = (name: string): GitRemote => ({ name, fetchUrl: `${name}-url`, pushUrl: `${name}-url` })

async function fire(event: string) {
  await act(async () => {
    window.dispatchEvent(new Event(event))
  })
  await waitFor(() => expect(addToast).toHaveBeenCalled())
}

beforeEach(() => {
  status = statusWith()
  remotes = [remote('origin')]
  stashCount = 0
  Object.values(api).forEach((fn) => fn.mockClear())
  addToast.mockReset()
  Object.assign(window, { api })
  useToastStore.setState({ addToast })
  useFileStore.setState({ rootPath: '/w' })
  useScmStore.setState({ pendingRequest: null, revision: 0 })
})

afterEach(() => cleanup())

describe('pushCurrentBranch', () => {
  it('pushes a tracking branch with a plain push, to its upstream', async () => {
    expect(await pushCurrentBranch('/w')).toBe('Pushed main to origin/main')
    expect(api.gitPush).toHaveBeenCalledWith('/w')
  })

  it('publishes a branch without an upstream and sets it', async () => {
    status = statusWith({ branch: 'topic', upstream: '' })
    expect(await pushCurrentBranch('/w')).toBe('Published topic to origin')
    expect(api.gitPush).toHaveBeenCalledWith('/w', 'origin', 'topic', false, true)
  })

  it('uses the only remote when it is not called origin', async () => {
    status = statusWith({ branch: 'topic', upstream: '' })
    remotes = [remote('github')]
    await pushCurrentBranch('/w')
    expect(api.gitPush).toHaveBeenCalledWith('/w', 'github', 'topic', false, true)
  })

  it('does not guess between several remotes', async () => {
    status = statusWith({ branch: 'topic', upstream: '' })
    remotes = [remote('a'), remote('b')]
    await expect(pushCurrentBranch('/w')).rejects.toThrow('several remotes (a, b)')
    expect(api.gitPush).not.toHaveBeenCalled()
  })

  it('refuses on a detached HEAD', async () => {
    status = statusWith({ branch: 'HEAD', detached: true, head: 'abc1234', upstream: '' })
    await expect(pushCurrentBranch('/w')).rejects.toThrow('HEAD is detached at abc1234')
    expect(api.gitPush).not.toHaveBeenCalled()
  })

  it('reports a missing remote', async () => {
    status = statusWith({ branch: 'topic', upstream: '' })
    remotes = []
    await expect(pushCurrentBranch('/w')).rejects.toThrow('No git remote is configured')
  })
})

describe('pullCurrentBranch', () => {
  it('pulls a tracking branch from its upstream', async () => {
    await pullCurrentBranch('/w')
    expect(api.gitPull).toHaveBeenCalledWith('/w')
  })

  it('pulls a branch without an upstream from its namesake on the remote', async () => {
    status = statusWith({ branch: 'topic', upstream: '' })
    await pullCurrentBranch('/w')
    expect(api.gitPull).toHaveBeenCalledWith('/w', 'origin', 'topic')
  })
})

describe('useGitCommands', () => {
  beforeEach(() => {
    renderHook(() => useGitCommands())
  })

  it.each([
    ['orion:git-stage-all', 'gitStageAll', 'Staged all changes'],
    ['orion:git-unstage-all', 'gitUnstageAll', 'Unstaged all changes'],
    ['orion:git-fetch', 'gitFetch', 'Fetched from all remotes'],
    ['orion:git-push', 'gitPush', 'Pushed main to origin/main'],
    ['orion:git-pull', 'gitPull', 'Pulled origin/main into main'],
  ] as const)('runs %s from the command palette', async (event, method, message) => {
    await fire(event)
    expect(api[method]).toHaveBeenCalledWith('/w')
    expect(addToast).toHaveBeenCalledWith({ type: 'success', message })
  })

  it('tells the panel to refresh after a command', async () => {
    await fire('orion:git-stage-all')
    expect(useScmStore.getState().revision).toBe(1)
  })

  it('reports a failure with git\'s reason', async () => {
    api.gitStageAll.mockRejectedValueOnce(new Error("Error invoking remote method 'git:stage-all': Error: fatal: index.lock exists"))
    await fire('orion:git-stage-all')
    expect(addToast).toHaveBeenCalledWith({ type: 'error', message: 'Stage all failed: fatal: index.lock exists' })
  })

  it('does not claim a stash was made when there was nothing to stash', async () => {
    await fire('orion:git-stash')
    expect(api.gitStash).toHaveBeenCalledWith('/w')
    expect(addToast).toHaveBeenCalledWith({ type: 'info', message: 'No local changes to stash' })
  })

  it('reports a stash that was made', async () => {
    api.gitStash.mockImplementationOnce(async () => {
      stashCount = 1
      return ''
    })
    await fire('orion:git-stash')
    expect(addToast).toHaveBeenCalledWith({ type: 'success', message: 'Changes stashed' })
  })

  it('needs an open folder', async () => {
    useFileStore.setState({ rootPath: null })
    await fire('orion:git-stage-all')
    expect(api.gitStageAll).not.toHaveBeenCalled()
    expect(addToast).toHaveBeenCalledWith({ type: 'info', message: 'Open a folder to use Git commands' })
  })

  it.each([
    ['orion:git-show-history', 'history'],
    ['orion:git-commit', 'commit'],
  ] as const)('opens Source Control for %s and leaves the request for the panel', (event, request) => {
    const showGit = vi.fn()
    window.addEventListener('orion:show-git', showGit)
    try {
      act(() => {
        window.dispatchEvent(new Event(event))
      })
      expect(useScmStore.getState().pendingRequest).toBe(request)
      expect(showGit).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('orion:show-git', showGit)
    }
  })
})
