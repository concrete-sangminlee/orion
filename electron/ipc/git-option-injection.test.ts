import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  UnsafeGitRefError,
  buildRemoteArgs,
  normalizeGitConfigKey,
  normalizeGitPathspec,
  normalizeGitRefspec,
  normalizeGitRemote,
  normalizeWritableGitConfigKey,
} from './git-ref-guard'

describe('normalizeGitRemote', () => {
  it('accepts remote names and URLs', () => {
    expect(normalizeGitRemote('origin')).toBe('origin')
    expect(normalizeGitRemote(' upstream ')).toBe('upstream')
    expect(normalizeGitRemote('https://github.com/o/r.git')).toBe('https://github.com/o/r.git')
    expect(normalizeGitRemote('git@github.com:o/r.git')).toBe('git@github.com:o/r.git')
    expect(normalizeGitRemote('../local-repo.git')).toBe('../local-repo.git')
  })

  it.each([
    ['--upload-pack=touch /tmp/pwned'],
    ['--receive-pack=touch /tmp/pwned'],
    ['-o'],
    ['ext::sh -c touch% /tmp/pwned'],
    ['EXT::anything'],
    ['fd::3'],
    ['origin main'],
    ['origin\nmain'],
    [''],
    ['   '],
    [42],
    [undefined],
  ])('rejects %j', (value) => {
    expect(() => normalizeGitRemote(value)).toThrow(UnsafeGitRefError)
  })
})

describe('normalizeGitRefspec', () => {
  it('accepts refs and refspecs', () => {
    for (const ref of ['main', 'feature/x', 'HEAD~2', 'HEAD:refs/heads/main', '+main:main', 'v1.2.3']) {
      expect(normalizeGitRefspec(ref)).toBe(ref)
    }
  })

  it('rejects option-like and whitespace values', () => {
    for (const ref of ['--hard', '-f', 'a b', 'a\tb', '\u0000', '']) {
      expect(() => normalizeGitRefspec(ref)).toThrow(UnsafeGitRefError)
    }
  })
})

describe('normalizeGitPathspec', () => {
  it('passes option-like file names through (they are placed after --)', () => {
    expect(normalizeGitPathspec('--weird-name.txt')).toBe('--weird-name.txt')
    expect(normalizeGitPathspec('dir with space/a.ts')).toBe('dir with space/a.ts')
  })

  it('rejects NUL, empty, and non-string values', () => {
    expect(() => normalizeGitPathspec('a\0b')).toThrow(UnsafeGitRefError)
    expect(() => normalizeGitPathspec('')).toThrow(UnsafeGitRefError)
    expect(() => normalizeGitPathspec(['a'])).toThrow(UnsafeGitRefError)
  })
})

describe('buildRemoteArgs', () => {
  it('ends option parsing before the remote', () => {
    expect(buildRemoteArgs('origin', 'main')).toEqual(['--', 'origin', 'main'])
    expect(buildRemoteArgs('origin')).toEqual(['--', 'origin'])
    expect(buildRemoteArgs('origin', '')).toEqual(['--', 'origin'])
  })

  it('omits everything when no remote is given', () => {
    expect(buildRemoteArgs(undefined)).toEqual([])
    expect(buildRemoteArgs('')).toEqual([])
  })

  it('refuses a refspec without a remote', () => {
    expect(() => buildRemoteArgs('', 'main')).toThrow(UnsafeGitRefError)
  })

  it('refuses the upload-pack / receive-pack payloads', () => {
    expect(() => buildRemoteArgs('--upload-pack=touch /tmp/x; false', '.')).toThrow(UnsafeGitRefError)
    expect(() => buildRemoteArgs('origin', '--receive-pack=touch /tmp/x')).toThrow(UnsafeGitRefError)
  })
})

describe('git config key guards', () => {
  it('allows ordinary keys to be read', () => {
    expect(normalizeGitConfigKey('remote.origin.url')).toBe('remote.origin.url')
    expect(normalizeGitConfigKey('core.fsmonitor')).toBe('core.fsmonitor')
  })

  it('allows writing identity and workflow keys', () => {
    for (const key of ['user.name', 'user.email', 'User.Email', 'pull.rebase', 'branch.feature/x.remote']) {
      expect(normalizeWritableGitConfigKey(key)).toBe(key)
    }
  })

  it.each([
    'core.fsmonitor',
    'core.sshCommand',
    'core.pager',
    'core.editor',
    'core.hooksPath',
    'alias.st',
    'filter.lfs.smudge',
    'credential.helper',
    'gpg.program',
    'diff.external',
    'sequence.editor',
    '--global',
  ])('refuses to write %s', (key) => {
    expect(() => normalizeWritableGitConfigKey(key)).toThrow(UnsafeGitRefError)
  })
})

// ---------------------------------------------------------------------------
// End-to-end: prove the argv we now build is inert against a real git.
// ---------------------------------------------------------------------------

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.runIf(hasGit())('git option injection against a real repository', () => {
  let root: string
  let repo: string

  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: repo,
      stdio: 'pipe',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
    })

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-git-inject-'))
    repo = path.join(root, 'repo')
    fs.mkdirSync(repo)
    git(['init', '-q'])
    git(['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'])
  })

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('the legacy argv for git:pull executes the payload (documents the vulnerability)', () => {
    const marker = path.join(root, 'legacy-pwned')
    try {
      git(['pull', `--upload-pack=touch ${JSON.stringify(marker)}; false`, '.'])
    } catch {
      // the fake upload-pack exits non-zero; only the side effect matters
    }
    expect(fs.existsSync(marker)).toBe(true)
  })

  it('`--` alone does NOT protect git:pull — pull re-invokes fetch without it', () => {
    // This is why remotes/refspecs are validated instead of relying on `--`.
    const marker = path.join(root, 'pull-dashdash-pwned')
    try {
      git(['pull', '--', `--upload-pack=touch ${JSON.stringify(marker)}; false`, '.'])
    } catch {
      // expected to fail; only the side effect matters
    }
    expect(fs.existsSync(marker)).toBe(true)
  })

  it('`--` keeps the receive-pack payload inert for git:push', () => {
    const marker = path.join(root, 'push-dashdash-pwned')
    expect(() => git(['push', '--', `--receive-pack=touch ${JSON.stringify(marker)}; false`, '.'])).toThrow()
    expect(fs.existsSync(marker)).toBe(false)
  })

  it('the hardened builder never produces the payload argv', () => {
    const marker = path.join(root, 'hardened-pwned')
    expect(() => buildRemoteArgs(`--upload-pack=touch ${marker}; false`, '.')).toThrow(UnsafeGitRefError)
    expect(fs.existsSync(marker)).toBe(false)
  })
})
