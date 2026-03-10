import { create } from 'zustand'
import type { FileNode } from '@shared/types'

interface FileStore {
  rootPath: string | null
  fileTree: FileNode[]
  expandedDirs: Set<string>
  setRootPath: (path: string) => void
  setFileTree: (tree: FileNode[]) => void
  toggleDir: (path: string) => void
}

export const useFileStore = create<FileStore>((set) => ({
  rootPath: null,
  fileTree: [],
  expandedDirs: new Set<string>(),

  setRootPath: (path) => set({ rootPath: path }),

  setFileTree: (tree) => set({ fileTree: tree }),

  toggleDir: (path) =>
    set((state) => {
      const next = new Set(state.expandedDirs)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return { expandedDirs: next }
    }),
}))
