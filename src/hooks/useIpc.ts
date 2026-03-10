import { useEffect } from 'react'
import { useFileStore } from '@/store/files'

export function useFileWatcher() {
  const { rootPath, setFileTree } = useFileStore()

  useEffect(() => {
    if (!rootPath) return

    const cleanup = window.api.onFsChange(async () => {
      const tree = await window.api.readDir(rootPath)
      setFileTree(tree)
    })

    return cleanup
  }, [rootPath, setFileTree])
}
