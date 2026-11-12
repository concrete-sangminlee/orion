import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitBranch, GitStatusResult } from '../../shared/ipc-contract'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('./typed-ipc', () => ({
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
}))

const { registerGitHandlers } = await import('./git')
const { setProjectPath } = await import('../workspace/project-path')

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

let root: string
let work: string
let remote: string

const savedEnv = { ...process.env }

function git(args: string[], cwd = work): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
}

function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  return handlers.get(channel)!({}, work, ...args) as Promise<T>
}

describe.runIf(hasGit())('git IPC handlers against a real repository', () => {
  beforeAll(() => {
    // The handlers spawn git with process.env: give commits an identity and
    // keep the developer's own config out of the way.
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orion-git-handlers-')))
    // An empty file, not os.devNull: git on Windows cannot open '\\.\nul' as
    // a config file and fails every command.
    const emptyConfig = path.join(root, 'gitconfig')
    fs.writeFileSync(emptyConfig, '')
    Object.assign(process.env, {
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_TERMINAL_PROMPT: '0',
    })
    remote = path.join(root, 'remote.git')
    work = path.join(root, 'work')
    git(['init', '-q', '--bare', remote], root)
    git(['init', '-q', '-b', 'main', work], root)
    fs.writeFileSync(path.join(work, 'a.txt'), 'one\n')
    git(['add', 'a.txt'])
    git(['commit', '-q', '-m', 'init'])
    // Deliberately not called "origin": nothing may assume that name.
    git(['remote', 'add', 'upstream', remote])
    git(['push', '-q', '-u', 'upstream', 'main'])
    git(['remote', 'set-head', 'upstream', 'main'])
    git(['push', '-q', 'upstream', 'main:feature'])
    git(['fetch', '-q', 'upstream'])
    setProjectPath(work)
    registerGitHandlers()
  })

  afterAll(() => {
    process.env = savedEnv
    fs.rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    git(['checkout', '-q', 'main'])
    git(['reset', '-q', '--hard'])
    git(['clean', '-qfd'])
  })

  describe('git:status', () => {
    it('reports the branch and its upstream', async () => {
      const status = await call<GitStatusResult>('git:status')
      expect(status).toMatchObject({ isRepo: true, branch: 'main', detached: false, head: '', upstream: 'upstream/main' })
    })

    it('reports a detached HEAD instead of calling it main', async () => {
      git(['checkout', '-q', '--detach'])
      const status = await call<GitStatusResult>('git:status')
      expect(status).toMatchObject({ isRepo: true, branch: 'HEAD', detached: true, upstream: '' })
      expect(status.head).toBe(git(['rev-parse', '--short', 'HEAD']))
    })

    it('reports no upstream for a branch that was never pushed', async () => {
      git(['checkout', '-q', '-b', 'local-only'])
      try {
        expect(await call<GitStatusResult>('git:status')).toMatchObject({ branch: 'local-only', upstream: '', ahead: 0, behind: 0 })
      } finally {
        git(['checkout', '-q', 'main'])
        git(['branch', '-q', '-D', 'local-only'])
      }
    })
  })

  describe('git:branches', () => {
    it('marks remote-tracking refs and leaves out symbolic refs and the detached entry', async () => {
      git(['checkout', '-q', '--detach'])
      const branches = await call<GitBranch[]>('git:branches')
      expect(branches).toEqual([
        { name: 'main', current: false },
        { name: 'upstream/feature', current: false, remote: 'upstream' },
        { name: 'upstream/main', current: false, remote: 'upstream' },
      ])
    })

    it('marks the current local branch', async () => {
      const branches = await call<GitBranch[]>('git:branches')
      expect(branches.find((b) => b.name === 'main')).toEqual({ name: 'main', current: true })
    })

    it('creates a local branch tracking the remote ref the picker names, even when several remotes have it', async () => {
      const fork = path.join(root, 'fork.git')
      git(['init', '-q', '--bare', fork], root)
      git(['remote', 'add', 'fork', fork])
      try {
        git(['push', '-q', 'fork', 'main:feature'])
        git(['fetch', '-q', 'fork'])
        // Git's by-name guess cannot choose between upstream/feature and fork/feature.
        await expect(call('git:checkout', 'feature')).rejects.toThrow(/matched multiple/)

        await call('git:checkout', 'feature', 'fork/feature')
        const status = await call<GitStatusResult>('git:status')
        expect(status).toMatchObject({ branch: 'feature', detached: false, upstream: 'fork/feature' })
      } finally {
        git(['checkout', '-q', 'main'])
        try {
          git(['branch', '-q', '-D', 'feature'])
        } catch {
          // never created
        }
        git(['remote', 'remove', 'fork'])
        fs.rmSync(fork, { recursive: true, force: true })
      }
    })

    it('rejects an option-like remote ref to track', async () => {
      await expect(call('git:checkout', 'feature', '--upload-pack=touch x')).rejects.toThrow(/Invalid remote branch/)
    })
  })

  describe('git:diff', () => {
    it('returns the staged diff with staged=true and the unstaged one without', async () => {
      fs.writeFileSync(path.join(work, 'a.txt'), 'two\n')
      git(['add', 'a.txt'])
      fs.writeFileSync(path.join(work, 'a.txt'), 'three\n')
      const staged = await call<string>('git:diff', 'a.txt', true)
      const unstaged = await call<string>('git:diff', 'a.txt')
      expect(staged).toContain('-one')
      expect(staged).toContain('+two')
      expect(unstaged).toContain('-two')
      expect(unstaged).toContain('+three')
    })

    it('shows a fully staged new file only in the staged diff', async () => {
      fs.writeFileSync(path.join(work, 'new.txt'), 'hello\n')
      git(['add', 'new.txt'])
      expect(await call<string>('git:diff', 'new.txt', true)).toContain('+hello')
      expect(await call<string>('git:diff', 'new.txt')).toBe('')
    })

    it('shows an untracked file as added', async () => {
      fs.writeFileSync(path.join(work, 'u.txt'), 'brand new\n')
      const diff = await call<string>('git:diff', 'u.txt')
      expect(diff).toContain('new file mode')
      expect(diff).toContain('+brand new')
    })

    it('shows every file of an untracked folder', async () => {
      fs.mkdirSync(path.join(work, 'dir', 'sub'), { recursive: true })
      fs.writeFileSync(path.join(work, 'dir', 'x.txt'), 'x\n')
      fs.writeFileSync(path.join(work, 'dir', 'sub', 'y.txt'), 'y\n')
      const diff = await call<string>('git:diff', 'dir/')
      expect(diff).toContain('+++ b/dir/x.txt')
      expect(diff).toContain('+++ b/dir/sub/y.txt')
    })

    it('rejects a non-string path', async () => {
      await expect(call('git:diff', ['a.txt'])).rejects.toThrow(/Invalid path/)
    })
  })

  describe('git:push / git:pull', () => {
    it('publishes a new branch with setUpstream so later pushes and pulls work without arguments', async () => {
      git(['checkout', '-q', '-b', 'topic'])
      try {
        fs.writeFileSync(path.join(work, 'a.txt'), 'topic\n')
        git(['commit', '-q', '-am', 'topic'])

        // Without an upstream, a plain push fails the way the panel used to.
        await expect(call('git:push')).rejects.toThrow(/no upstream branch/)

        await call('git:push', 'upstream', 'topic', false, true)
        expect(git(['rev-parse', '--abbrev-ref', 'topic@{upstream}'])).toBe('upstream/topic')
        expect(git(['rev-parse', 'refs/heads/topic'], remote)).toBe(git(['rev-parse', 'HEAD']))

        fs.writeFileSync(path.join(work, 'a.txt'), 'topic 2\n')
        git(['commit', '-q', '-am', 'topic 2'])
        await call('git:push')
        expect(git(['rev-parse', 'refs/heads/topic'], remote)).toBe(git(['rev-parse', 'HEAD']))

        await expect(call('git:pull')).resolves.toBeDefined()
      } finally {
        git(['checkout', '-q', '-f', 'main'])
        git(['branch', '-q', '-D', 'topic'])
        try {
          git(['push', '-q', 'upstream', '--delete', 'topic'])
        } catch {
          // never published
        }
        git(['fetch', '-q', '--prune', 'upstream'])
      }
    })
  })
})
