import { useEffect } from 'react'
import { useFileStore } from '@/store/files'
import { useScmStore, type ScmViewRequest } from '@/store/scm'
import { useToastStore } from '@/store/toast'
import { ipcErrorMessage } from '@/utils/ipcResult'

interface GitCommandOutcome {
  type: 'success' | 'info'
  message: string
}

/** The remote a branch without an upstream is published to. */
async function remoteForNewUpstream(rootPath: string): Promise<string> {
  const remotes = await window.api.gitRemotes(rootPath)
  if (remotes.length === 0) throw new Error('No git remote is configured')
  const remote = remotes.find((r) => r.name === 'origin') ?? (remotes.length === 1 ? remotes[0] : undefined)
  if (!remote) {
    throw new Error(
      `The branch has no upstream and there are several remotes (${remotes.map((r) => r.name).join(', ')}), none called origin: set its upstream in a terminal first`,
    )
  }
  return remote.name
}

async function currentBranchStatus(rootPath: string, action: string) {
  const status = await window.api.gitStatus(rootPath)
  if (!status.isRepo) throw new Error('Not a git repository')
  if (status.detached) throw new Error(`HEAD is detached at ${status.head}: switch to a branch to ${action}`)
  return status
}

/**
 * Push the current branch. A branch without an upstream (one created in Orion)
 * is published with --set-upstream; a plain push of it fails in git.
 */
export async function pushCurrentBranch(rootPath: string): Promise<string> {
  const status = await currentBranchStatus(rootPath, 'push')
  if (status.upstream) {
    await window.api.gitPush(rootPath)
    return `Pushed ${status.branch} to ${status.upstream}`
  }
  const remote = await remoteForNewUpstream(rootPath)
  await window.api.gitPush(rootPath, remote, status.branch, false, true)
  return `Published ${status.branch} to ${remote}`
}

/** Pull into the current branch, from its upstream or else its namesake on the remote. */
export async function pullCurrentBranch(rootPath: string): Promise<string> {
  const status = await currentBranchStatus(rootPath, 'pull')
  if (status.upstream) {
    await window.api.gitPull(rootPath)
    return `Pulled ${status.upstream} into ${status.branch}`
  }
  const remote = await remoteForNewUpstream(rootPath)
  await window.api.gitPull(rootPath, remote, status.branch)
  return `Pulled ${remote}/${status.branch} into ${status.branch}`
}

/**
 * Stash the local changes. Resolves false when there was nothing to stash:
 * `git stash` then exits 0 without creating one.
 */
export async function stashChanges(rootPath: string, message?: string): Promise<boolean> {
  const before = (await window.api.gitStashList(rootPath)).length
  if (message) await window.api.gitStashSave(rootPath, message)
  else await window.api.gitStash(rootPath)
  return (await window.api.gitStashList(rootPath)).length > before
}

const success = (message: string): GitCommandOutcome => ({ type: 'success', message })

/** Command-palette events that run a git command directly. */
const GIT_COMMANDS: Record<string, { label: string; run: (rootPath: string) => Promise<GitCommandOutcome> }> = {
  'orion:git-stage-all': {
    label: 'Stage all',
    run: async (rootPath) => {
      await window.api.gitStageAll(rootPath)
      return success('Staged all changes')
    },
  },
  'orion:git-unstage-all': {
    label: 'Unstage all',
    run: async (rootPath) => {
      await window.api.gitUnstageAll(rootPath)
      return success('Unstaged all changes')
    },
  },
  'orion:git-push': { label: 'Push', run: async (rootPath) => success(await pushCurrentBranch(rootPath)) },
  'orion:git-pull': { label: 'Pull', run: async (rootPath) => success(await pullCurrentBranch(rootPath)) },
  'orion:git-fetch': {
    label: 'Fetch',
    run: async (rootPath) => {
      await window.api.gitFetch(rootPath)
      return success('Fetched from all remotes')
    },
  },
  'orion:git-stash': {
    label: 'Stash',
    run: async (rootPath) =>
      (await stashChanges(rootPath)) ? success('Changes stashed') : { type: 'info', message: 'No local changes to stash' },
  },
}

/** Command-palette events that need the Source Control panel. */
const SCM_VIEW_REQUESTS: Record<string, ScmViewRequest> = {
  'orion:git-commit': 'commit',
  'orion:git-show-history': 'history',
}

async function runGitCommand(label: string, run: (rootPath: string) => Promise<GitCommandOutcome>): Promise<void> {
  const { addToast } = useToastStore.getState()
  const rootPath = useFileStore.getState().rootPath
  if (!rootPath) {
    addToast({ type: 'info', message: 'Open a folder to use Git commands' })
    return
  }
  try {
    addToast(await run(rootPath))
  } catch (err) {
    addToast({ type: 'error', message: `${label} failed: ${ipcErrorMessage(err)}` })
  } finally {
    useScmStore.getState().notifyChanged()
  }
}

/**
 * Handles the command palette's Git commands. Mount once, in a component that
 * is always rendered: the Source Control panel is not.
 */
export function useGitCommands(): void {
  useEffect(() => {
    const listeners: Array<[string, () => void]> = [
      ...Object.entries(GIT_COMMANDS).map(([event, { label, run }]): [string, () => void] => [
        event,
        () => void runGitCommand(label, run),
      ]),
      ...Object.entries(SCM_VIEW_REQUESTS).map(([event, request]): [string, () => void] => [
        event,
        () => {
          useScmStore.getState().request(request)
          window.dispatchEvent(new Event('orion:show-git'))
        },
      ]),
    ]
    for (const [event, listener] of listeners) window.addEventListener(event, listener)
    return () => {
      for (const [event, listener] of listeners) window.removeEventListener(event, listener)
    }
  }, [])
}
