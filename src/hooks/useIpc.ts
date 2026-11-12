import { useEffect } from 'react'
import { useFileStore } from '@/store/files'
import { useEditorStore } from '@/store/editor'

/** Quiet time after the last file-system event before the explorer re-lists the workspace. */
export const FILE_TREE_REFRESH_DELAY_MS = 150

export function useFileWatcher() {
  const { rootPath, setFileTree } = useFileStore()

  useEffect(() => {
    if (!rootPath || !window.api) return

    // One refresh per burst: a checkout or an install fires hundreds of
    // events, and each refresh lists the whole workspace.
    let timer: ReturnType<typeof setTimeout> | null = null
    let disposed = false
    const cleanup = window.api.onFsChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        timer = null
        try {
          const tree = await window.api.readDir(rootPath)
          if (!disposed) setFileTree(tree)
        } catch {
          // Transient (for example the folder is being replaced): keep the last tree.
        }
      }, FILE_TREE_REFRESH_DELAY_MS)
    })

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      cleanup()
    }
  }, [rootPath, setFileTree])
}

export function useExternalFileWatcher() {
  useEffect(() => {
    if (!window.api?.onExternalFileChange) return

    const cleanup = window.api.onExternalFileChange(async (data) => {
      const { path: changedPath, type } = data
      const store = useEditorStore.getState()
      const openFile = store.openFiles.find(
        (f) => f.path.replace(/\\/g, '/') === changedPath
      )

      // Only act on files that are currently open in the editor
      if (!openFile) return

      if (type === 'delete') {
        store.markDeletedOnDisk(openFile.path)
        return
      }

      if (type === 'change' || type === 'add') {
        // Unsaved edits: never replace them, and never let a save silently
        // overwrite the new disk content. Flag the tab for the user to decide.
        if (openFile.isModified) {
          store.markExternalChange(openFile.path)
          return
        }
        try {
          const result = await window.api.readFile(openFile.path)
          if (!result.binary) store.reloadFileContent(openFile.path, result.content)
        } catch {
          // The new content cannot be shown (unreadable, or no longer text).
          // The tab is stale, so it must not be saved over the file unnoticed.
          store.markExternalChange(openFile.path)
        }
      }
    })

    return cleanup
  }, [])
}
