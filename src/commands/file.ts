import type { OpenFile } from '@shared/types'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { clearRecovery } from '@/hooks/useAutoSave'
import { ipcErrorMessage, writeFileChecked } from '@/utils/ipcResult'
import { confirmOverwriteIfChangedOnDisk, needsSaveLocation } from '@/utils/saveGuards'

/** A new, empty buffer with no file yet; saving it asks where to write it. */
export function newUntitledFile(): void {
  const id = Date.now()
  useEditorStore.getState().openFile({
    path: `untitled-${id}`,
    name: `Untitled-${id}`,
    content: '',
    language: 'plaintext',
    isModified: false,
    aiModified: false,
  })
}

/** Write every modified buffer that has a file; untitled ones need Save As. */
export async function saveAllFiles(): Promise<void> {
  const { openFiles, markSaved } = useEditorStore.getState()
  const { addToast } = useToastStore.getState()
  const bufferOf = (path: string) => useEditorStore.getState().openFiles.find((f) => f.path === path)
  const modified = openFiles.filter((f: OpenFile) => f.isModified && !needsSaveLocation(f.path)).map((f) => f.path)
  const untitled = openFiles.filter((f: OpenFile) => f.isModified && needsSaveLocation(f.path)).length
  let savedCount = 0
  let failedCount = 0

  for (const path of modified) {
    // The buffer as it is now: the user can keep typing while earlier files are written.
    const file = bufferOf(path)
    if (!file?.isModified || !confirmOverwriteIfChangedOnDisk(file)) continue
    try {
      await writeFileChecked(file.path, file.content, `Save ${file.name}`)
    } catch {
      failedCount++
      continue
    }
    savedCount++
    // Edits typed while the write was in flight are still unsaved.
    if (bufferOf(path)?.content === file.content) {
      markSaved(path)
      clearRecovery(path)
    }
  }

  if (savedCount > 0) addToast({ type: 'success', message: `Saved ${savedCount} file(s)` })
  if (failedCount > 0) addToast({ type: 'error', message: `Failed to save ${failedCount} file(s)` })
  if (untitled > 0) addToast({ type: 'info', message: `${untitled} untitled file(s) need Save As` })
}

/** File > Revert File: replace the active buffer with the file on disk. */
export async function revertActiveFile(): Promise<void> {
  const { openFiles, activeFilePath, reloadFileContent } = useEditorStore.getState()
  const { addToast } = useToastStore.getState()
  const file = openFiles.find((f) => f.path === activeFilePath)
  if (!file) {
    addToast({ type: 'info', message: 'Revert File: no file is open' })
    return
  }
  if (needsSaveLocation(file.path)) {
    addToast({ type: 'info', message: `${file.name} has never been saved, so there is nothing to revert to` })
    return
  }
  try {
    const result = await window.api.readFile(file.path)
    if (result.binary) throw new Error('it is not a text file any more')
    reloadFileContent(file.path, result.content)
    clearRecovery(file.path)
  } catch (err) {
    addToast({ type: 'error', message: `Could not revert ${file.name}: ${ipcErrorMessage(err)}` })
  }
}
