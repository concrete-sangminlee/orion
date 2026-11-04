import { useEffect } from 'react'
import { useFileStore } from '@/store/files'
import { useEditorStore } from '@/store/editor'

export function useFileWatcher() {
  const { rootPath, setFileTree } = useFileStore()

  useEffect(() => {
    if (!rootPath || !window.api) return

    const cleanup = window.api.onFsChange(async () => {
      const tree = await window.api.readDir(rootPath)
      setFileTree(tree)
    })

    return cleanup
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
        // Read the new content from disk
        try {
          const result = await window.api.readFile(openFile.path)

          // If the file has unsaved modifications, flag it for user decision
          if (openFile.isModified) {
            store.markExternalChange(openFile.path)
          } else {
            // No unsaved changes -- silently reload
            store.reloadFileContent(openFile.path, result.content)
          }
        } catch {
          // Read failed, ignore
        }
      }
    })

    return cleanup
  }, [])
}
