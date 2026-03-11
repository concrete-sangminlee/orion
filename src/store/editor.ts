import { create } from 'zustand'
import type { OpenFile } from '@shared/types'

interface EditorStore {
  openFiles: OpenFile[]
  activeFilePath: string | null
  openFile: (file: OpenFile) => void
  closeFile: (path: string) => void
  closeAllFiles: () => void
  setActiveFile: (path: string) => void
  updateFileContent: (path: string, content: string) => void
  markAiModified: (path: string) => void
  reorderFiles: (fromIndex: number, toIndex: number) => void
}

export const useEditorStore = create<EditorStore>((set) => ({
  openFiles: [],
  activeFilePath: null,

  openFile: (file) =>
    set((state) => {
      const exists = state.openFiles.find((f) => f.path === file.path)
      if (exists) return { activeFilePath: file.path }
      return { openFiles: [...state.openFiles, file], activeFilePath: file.path }
    }),

  closeFile: (path) =>
    set((state) => {
      const files = state.openFiles.filter((f) => f.path !== path)
      const activePath =
        state.activeFilePath === path
          ? files[files.length - 1]?.path ?? null
          : state.activeFilePath
      return { openFiles: files, activeFilePath: activePath }
    }),

  setActiveFile: (path) => set({ activeFilePath: path }),

  updateFileContent: (path, content) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, content, isModified: true } : f
      ),
    })),

  markAiModified: (path) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, aiModified: true } : f
      ),
    })),

  closeAllFiles: () => set({ openFiles: [], activeFilePath: null }),

  reorderFiles: (fromIndex, toIndex) =>
    set((state) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= state.openFiles.length ||
        toIndex >= state.openFiles.length ||
        fromIndex === toIndex
      ) {
        return state
      }
      const files = [...state.openFiles]
      const [moved] = files.splice(fromIndex, 1)
      files.splice(toIndex, 0, moved)
      return { openFiles: files }
    }),
}))
