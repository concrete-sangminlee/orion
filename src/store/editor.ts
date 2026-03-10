import { create } from 'zustand'
import type { OpenFile } from '@shared/types'

interface EditorStore {
  openFiles: OpenFile[]
  activeFilePath: string | null
  openFile: (file: OpenFile) => void
  closeFile: (path: string) => void
  setActiveFile: (path: string) => void
  updateFileContent: (path: string, content: string) => void
  markAiModified: (path: string) => void
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
}))
