import { create } from 'zustand'

/** Something the Source Control panel was asked to show. */
export type ScmViewRequest = 'history' | 'commit'

interface ScmState {
  /**
   * Kept until the panel handles it: the panel is lazy and mounts only while
   * its view is open, so a one-shot window event sent while switching to it
   * was lost.
   */
  pendingRequest: ScmViewRequest | null
  /** Bumped when a git command run outside the panel changed the repository. */
  revision: number
  request: (request: ScmViewRequest) => void
  clearRequest: () => void
  notifyChanged: () => void
}

export const useScmStore = create<ScmState>((set) => ({
  pendingRequest: null,
  revision: 0,
  request: (request) => set({ pendingRequest: request }),
  clearRequest: () => set({ pendingRequest: null }),
  notifyChanged: () => set((s) => ({ revision: s.revision + 1 })),
}))
