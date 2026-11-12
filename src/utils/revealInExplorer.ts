import { create } from 'zustand'
import { useFileStore } from '@/store/files'
import { useToastStore } from '@/store/toast'

/** The file the Explorer scrolls to the next time it renders it. */
export const useRevealStore = create<{ target: string | null }>(() => ({ target: null }))

/**
 * The folders from `root` (exclusive) down to the folder holding `filePath`,
 * or null when `filePath` is not inside `root`.
 */
export function ancestorFolders(root: string, filePath: string): string[] | null {
  const base = root.replace(/[\\/]+$/, '')
  const sep = filePath.charAt(base.length)
  if (!filePath.startsWith(base) || (sep !== '/' && sep !== '\\')) return null
  const folders: string[] = []
  let current = base
  for (const part of filePath.slice(base.length + 1).split(sep).slice(0, -1)) {
    current += sep + part
    folders.push(current)
  }
  return folders
}

/** Show the Explorer with the folders around `filePath` expanded, scrolled to it. */
export function revealInExplorer(filePath: string): void {
  const { rootPath, expandedDirs } = useFileStore.getState()
  const folders = rootPath ? ancestorFolders(rootPath, filePath) : null
  if (!folders) {
    const name = filePath.split(/[\\/]/).pop() || filePath
    useToastStore.getState().addToast({ type: 'info', message: `${name} is not in the open folder` })
    return
  }
  useFileStore.setState({ expandedDirs: new Set([...expandedDirs, ...folders]) })
  useRevealStore.setState({ target: filePath })
  // App shows the sidebar with the Explorer, which then picks up the target.
  window.dispatchEvent(new Event('orion:show-explorer'))
}
