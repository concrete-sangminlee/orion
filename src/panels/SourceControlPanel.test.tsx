/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitBranch, GitStashEntry, GitStatusResult } from '@shared/ipc-contract'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { useScmStore } from '@/store/scm'
import { useToastStore } from '@/store/toast'
import SourceControlPanel from './SourceControlPanel'

let status: GitStatusResult
let stashes: GitStashEntry[]
let branches: GitBranch[]
let merging: boolean
let conflicts: string[]
let disk: Record<string, string>

const api = {
  gitStatus: vi.fn(async () => status),
  gitStashList: vi.fn(async () => stashes),
  gitMergeStatus: vi.fn(async () => ({ merging })),
  gitConflictFiles: vi.fn(async () => conflicts),
  gitRebaseStatus: vi.fn(async () => ({ rebasing: false })),
  gitTags: vi.fn(async () => []),
  gitLog: vi.fn(async () => []),
  gitDiff: vi.fn(async (_root: string, _file?: string, _staged?: boolean) => ''),
  gitDiscard: vi.fn(async () => true),
  gitStage: vi.fn(async () => true),
  gitStashDrop: vi.fn(async () => ''),
  gitStash: vi.fn(async () => ''),
  gitStashSave: vi.fn(async () => ''),
  gitStashApply: vi.fn(async () => ''),
  gitBranches: vi.fn(async () => branches),
  gitCheckout: vi.fn(async () => ''),
  gitPush: vi.fn(async () => ''),
  gitPull: vi.fn(async () => ''),
  gitRemotes: vi.fn(async () => [{ name: 'origin', fetchUrl: 'u', pushUrl: 'u' }]),
  gitCommit: vi.fn(async () => true),
  readFile: vi.fn(async (filePath: string) => {
    if (!(filePath in disk)) throw new Error('ENOENT')
    return { content: disk[filePath], language: 'typescript' }
  }),
}
const addToast = vi.fn()
let confirmAnswer: boolean
const confirm = vi.fn(() => confirmAnswer)

function statusWith(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    isRepo: true, branch: 'main', detached: false, head: '', upstream: 'origin/main',
    files: [], staged: [], unstaged: [], ahead: 0, behind: 0, ...overrides,
  }
}

async function renderPanel() {
  render(<SourceControlPanel />)
  await waitFor(() => expect(api.gitStatus).toHaveBeenCalled())
  await act(async () => {})
}

const diffFor = (lines: string) => `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n${lines}`

beforeEach(() => {
  status = statusWith()
  stashes = []
  branches = []
  merging = false
  conflicts = []
  disk = {}
  confirmAnswer = true
  Object.values(api).forEach((fn) => fn.mockClear())
  confirm.mockClear()
  addToast.mockReset()
  Object.assign(window, { api, confirm })
  useToastStore.setState({ addToast })
  useFileStore.setState({ rootPath: '/w' })
  useEditorStore.setState({ openFiles: [], activeFilePath: null, previewPath: null, pinnedTabs: [] })
  useScmStore.setState({ pendingRequest: null, revision: 0 })
})

afterEach(() => cleanup())

describe('discarding changes', () => {
  it('asks before discarding, and does nothing when cancelled', async () => {
    status = statusWith({ unstaged: [{ path: 'src/a.ts', state: 'modified' }] })
    await renderPanel()
    confirmAnswer = false
    fireEvent.click(await screen.findByTitle('Discard Changes'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Discard your changes to src/a.ts'))
    expect(api.gitDiscard).not.toHaveBeenCalled()

    confirmAnswer = true
    await act(async () => { fireEvent.click(screen.getByTitle('Discard Changes')) })
    expect(api.gitDiscard).toHaveBeenCalledWith('/w', 'src/a.ts')
  })

  it('says an untracked folder will be permanently deleted', async () => {
    status = statusWith({ unstaged: [{ path: 'newdir/', state: 'untracked' }] })
    await renderPanel()
    confirmAnswer = false
    fireEvent.click(await screen.findByTitle('Delete Untracked'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Permanently delete the untracked folder newdir/'))
    expect(api.gitDiscard).not.toHaveBeenCalled()
  })
})

describe('stashes', () => {
  beforeEach(() => {
    stashes = [
      { index: 0, hash: 'aaaa', message: 'WIP on main: first' },
      { index: 1, hash: 'bbbb', message: 'WIP on main: second' },
    ]
  })

  async function openStashes() {
    await renderPanel()
    await act(async () => { fireEvent.click(screen.getByText('Stashes')) })
    await screen.findByText('WIP on main: first')
  }

  it('asks before dropping a stash', async () => {
    await openStashes()
    confirmAnswer = false
    await act(async () => { fireEvent.click(screen.getAllByTitle('Drop (delete stash)')[0]) })
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('stash@{0} "WIP on main: first"'))
    expect(api.gitStashDrop).not.toHaveBeenCalled()
  })

  it('takes no second stash action while one is running (indices shift after a drop)', async () => {
    await openStashes()
    let finishDrop!: () => void
    api.gitStashDrop.mockImplementationOnce(() => new Promise<string>((resolve) => { finishDrop = () => resolve('') }))
    await act(async () => { fireEvent.click(screen.getAllByTitle('Drop (delete stash)')[0]) })
    const [drop] = screen.getAllByTitle('Drop (delete stash)')
    expect(drop).toHaveProperty('disabled', true)
    fireEvent.click(drop)
    fireEvent.click(screen.getAllByTitle('Pop (apply & remove)')[0])
    expect(api.gitStashDrop).toHaveBeenCalledTimes(1)
    expect(api.gitStashApply).not.toHaveBeenCalled()

    await act(async () => finishDrop())
    await waitFor(() => expect(screen.getAllByTitle('Drop (delete stash)')[0]).toHaveProperty('disabled', false))
  })

  async function stashFromPanel(message: string) {
    await renderPanel()
    await act(async () => { fireEvent.click(screen.getByTitle('Stash All Changes')) })
    fireEvent.change(screen.getByPlaceholderText('Stash message (optional)...'), { target: { value: message } })
    await act(async () => { fireEvent.click(screen.getByTitle('Stash')) })
  }

  it('does not claim a stash was made when git had nothing to stash', async () => {
    await stashFromPanel('')
    expect(api.gitStash).toHaveBeenCalledWith('/w')
    expect(addToast).toHaveBeenLastCalledWith({ type: 'info', message: 'No local changes to stash' })
  })

  it('reports a stash that was made', async () => {
    api.gitStashSave.mockImplementationOnce(async () => {
      stashes = [{ index: 0, hash: 'cccc', message: 'On main: wip' }, ...stashes]
      return ''
    })
    await stashFromPanel('wip')
    expect(api.gitStashSave).toHaveBeenCalledWith('/w', 'wip')
    expect(addToast).toHaveBeenLastCalledWith({ type: 'success', message: 'Changes stashed' })
  })
})

describe('merge conflicts', () => {
  beforeEach(() => {
    merging = true
    conflicts = ['src/a.ts']
    disk = { '/w/src/a.ts': '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature\n' }
  })

  it('opens a conflicted file with its content from disk', async () => {
    await renderPanel()
    await act(async () => { fireEvent.click(await screen.findByTitle('src/a.ts')) })
    expect(api.readFile).toHaveBeenCalledWith('/w/src/a.ts')
    expect(useEditorStore.getState().openFiles).toEqual([
      expect.objectContaining({ path: '/w/src/a.ts', content: disk['/w/src/a.ts'], isModified: false }),
    ])
  })

  it('offers no resolve buttons that have nothing behind them', async () => {
    await renderPanel()
    await screen.findByTitle('src/a.ts')
    expect(screen.queryByTitle('Accept Current')).toBeNull()
    expect(screen.queryByTitle('Accept Incoming')).toBeNull()
    expect(screen.queryByTitle('Accept Both')).toBeNull()
  })
})

describe('inline diffs', () => {
  it('shows hunks without a Stage Hunk button that would stage the whole file', async () => {
    status = statusWith({ unstaged: [{ path: 'a.ts', state: 'modified' }] })
    api.gitDiff.mockResolvedValue(diffFor('-old\n+new'))
    await renderPanel()
    await act(async () => { fireEvent.click(screen.getByTitle('a.ts')) })
    await screen.findByText('+new')
    expect(screen.queryByText('Stage Hunk')).toBeNull()
  })

  it('asks for the staged diff under Staged Changes and the worktree diff under Changes', async () => {
    status = statusWith({
      staged: [{ path: 'a.ts', state: 'modified' }],
      unstaged: [{ path: 'a.ts', state: 'modified' }],
    })
    api.gitDiff.mockImplementation(async (_root, _file, staged) => diffFor(staged ? '+staged line' : '+worktree line'))
    await renderPanel()
    const [stagedRow, unstagedRow] = screen.getAllByTitle('a.ts')
    await act(async () => { fireEvent.click(stagedRow) })
    expect(api.gitDiff).toHaveBeenLastCalledWith('/w', 'a.ts', true)
    await screen.findByText('+staged line')
    await act(async () => { fireEvent.click(unstagedRow) })
    expect(api.gitDiff).toHaveBeenLastCalledWith('/w', 'a.ts', false)
    await screen.findByText('+worktree line')
  })

  it('fetches the diff again on every expand instead of showing a stale one', async () => {
    status = statusWith({ unstaged: [{ path: 'a.ts', state: 'modified' }] })
    api.gitDiff.mockResolvedValueOnce(diffFor('+first'))
    await renderPanel()
    const row = screen.getByTitle('a.ts')
    await act(async () => { fireEvent.click(row) })
    await screen.findByText('+first')
    await act(async () => { fireEvent.click(row) })
    api.gitDiff.mockResolvedValueOnce(diffFor('+second'))
    await act(async () => { fireEvent.click(row) })
    await screen.findByText('+second')
    expect(api.gitDiff).toHaveBeenCalledTimes(2)
  })

  it('labels each file of an untracked folder and keeps file headers out of the previous file', async () => {
    status = statusWith({ unstaged: [{ path: 'dir/', state: 'untracked' }] })
    const newFile = (name: string, line: string) =>
      `diff --git a/${name} b/${name}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1 @@\n${line}`
    api.gitDiff.mockResolvedValueOnce([newFile('dir/x.txt', '+x'), newFile('dir/sub/y.txt', '+y'), '3 more untracked files not shown'].join('\n'))
    await renderPanel()
    await act(async () => { fireEvent.click(screen.getByTitle('dir/')) })

    expect(await screen.findByText('dir/x.txt @@ -0,0 +1 @@')).toBeTruthy()
    expect(screen.getByText('dir/sub/y.txt @@ -0,0 +1 @@')).toBeTruthy()
    expect(screen.getByText('+y')).toBeTruthy()
    // Shown as file content, these looked like a removed and an added line.
    expect(screen.queryByText('--- /dev/null')).toBeNull()
    expect(screen.queryByText('+++ b/dir/sub/y.txt')).toBeNull()
    expect(screen.queryByText('diff --git a/dir/sub/y.txt b/dir/sub/y.txt')).toBeNull()
    expect(screen.queryByText('new file mode 100644')).toBeNull()
    // The note is a heading of its own, not a line of y.txt.
    expect(screen.getByText('3 more untracked files not shown').tagName).not.toBe('PRE')
  })

  it('does not bring a row back expanded with the diff it had before it left the list', async () => {
    status = statusWith({ unstaged: [{ path: 'a.ts', state: 'modified' }] })
    api.gitDiff.mockResolvedValueOnce(diffFor('+before staging'))
    await renderPanel()
    await act(async () => { fireEvent.click(screen.getByTitle('a.ts')) })
    await screen.findByText('+before staging')

    // Staged, then edited again: the file is back under Changes with a new diff.
    status = statusWith({ staged: [{ path: 'a.ts', state: 'modified' }] })
    await act(async () => useScmStore.getState().notifyChanged())
    status = statusWith({ staged: [{ path: 'a.ts', state: 'modified' }], unstaged: [{ path: 'a.ts', state: 'modified' }] })
    await act(async () => useScmStore.getState().notifyChanged())

    expect(screen.getAllByTitle('a.ts')).toHaveLength(2)
    expect(screen.queryByText('+before staging')).toBeNull()
  })
})

describe('branches', () => {
  async function openPicker() {
    await act(async () => { fireEvent.click(screen.getByText(status.detached ? `detached @${status.head}` : status.branch)) })
  }

  it('creates a local branch tracking a remote-tracking ref instead of detaching HEAD', async () => {
    branches = [
      { name: 'main', current: true },
      { name: 'origin/feature', current: false, remote: 'origin' },
    ]
    await renderPanel()
    await openPicker()
    await act(async () => { fireEvent.click(await screen.findByText('origin/feature')) })
    expect(api.gitCheckout).toHaveBeenCalledWith('/w', 'feature', 'origin/feature')
    expect(addToast).toHaveBeenLastCalledWith({ type: 'success', message: 'Created branch feature tracking origin/feature' })
  })

  it('switches to the existing local branch for a remote-tracking ref', async () => {
    branches = [
      { name: 'main', current: true },
      { name: 'feature', current: false },
      { name: 'origin/feature', current: false, remote: 'origin' },
    ]
    await renderPanel()
    await openPicker()
    await act(async () => { fireEvent.click(await screen.findByText('origin/feature')) })
    expect(api.gitCheckout).toHaveBeenCalledWith('/w', 'feature', undefined)
  })

  it('offers no delete button for remote-tracking refs', async () => {
    branches = [
      { name: 'main', current: true },
      { name: 'topic', current: false },
      { name: 'origin/feature', current: false, remote: 'origin' },
    ]
    await renderPanel()
    await openPicker()
    await screen.findByText('origin/feature')
    expect(screen.getAllByTitle('Delete branch')).toHaveLength(1)
  })

  it('shows a detached HEAD as such, and warns before committing there', async () => {
    status = statusWith({ branch: 'HEAD', detached: true, head: 'abc1234', upstream: '', staged: [{ path: 'a.ts', state: 'modified' }] })
    await renderPanel()
    expect(screen.getByText('detached @abc1234')).toBeTruthy()
    expect(screen.queryByText('main')).toBeNull()

    confirmAnswer = false
    fireEvent.change(screen.getByPlaceholderText('Message (Ctrl+Enter to commit)'), { target: { value: 'msg' } })
    await act(async () => { fireEvent.click(screen.getByText('Commit')) })
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('HEAD is detached at abc1234'))
    expect(api.gitCommit).not.toHaveBeenCalled()
  })

  it('warns before switching away from a detached HEAD', async () => {
    status = statusWith({ branch: 'HEAD', detached: true, head: 'abc1234', upstream: '' })
    branches = [{ name: 'main', current: false }]
    await renderPanel()
    await openPicker()
    confirmAnswer = false
    await act(async () => { fireEvent.click(await screen.findByText('main')) })
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('HEAD is detached at abc1234'))
    expect(api.gitCheckout).not.toHaveBeenCalled()
  })
})

describe('push and pull', () => {
  it('publishes a branch without an upstream and sets it', async () => {
    status = statusWith({ branch: 'topic', upstream: '' })
    await renderPanel()
    await act(async () => { fireEvent.click(screen.getByTitle('Push')) })
    expect(api.gitPush).toHaveBeenCalledWith('/w', 'origin', 'topic', false, true)
    expect(addToast).toHaveBeenLastCalledWith({ type: 'success', message: 'Published topic to origin' })
  })

  it('pushes and pulls a tracking branch through its upstream', async () => {
    await renderPanel()
    await act(async () => { fireEvent.click(screen.getByTitle('Push')) })
    expect(api.gitPush).toHaveBeenCalledWith('/w')
    await act(async () => { fireEvent.click(screen.getByTitle('Pull')) })
    expect(api.gitPull).toHaveBeenCalledWith('/w')
  })
})

describe('requests from the command palette', () => {
  it('opens on the History tab when Git: Show Log was asked for before it mounted', async () => {
    useScmStore.getState().request('history')
    await renderPanel()
    await waitFor(() => expect(api.gitLog).toHaveBeenCalled())
    expect(useScmStore.getState().pendingRequest).toBeNull()
  })

  it('focuses the commit message for Git: Commit', async () => {
    useScmStore.getState().request('commit')
    await renderPanel()
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Message (Ctrl+Enter to commit)'))
  })

  it('refreshes right away when a palette command changed the repository', async () => {
    await renderPanel()
    const calls = api.gitStatus.mock.calls.length
    await act(async () => useScmStore.getState().notifyChanged())
    expect(api.gitStatus.mock.calls.length).toBe(calls + 1)
  })
})
