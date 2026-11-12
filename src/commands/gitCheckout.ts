import type { GitBranch } from '@shared/ipc-contract'

/** What checking out a branch picker entry switches to. */
export interface CheckoutTarget {
  /** The local branch to switch to. */
  branch: string
  /** Remote-tracking ref to create `branch` from when it does not exist yet. */
  track?: string
}

/**
 * A remote-tracking ref (`origin/x`) checks out as a detached HEAD. Switch to
 * the local branch of that name instead, or create one that tracks the ref.
 */
export function checkoutTargetFor(branch: GitBranch, all: readonly GitBranch[]): CheckoutTarget {
  if (!branch.remote) return { branch: branch.name }
  const local = branch.name.slice(branch.remote.length + 1)
  return all.some((b) => !b.remote && b.name === local) ? { branch: local } : { branch: local, track: branch.name }
}
