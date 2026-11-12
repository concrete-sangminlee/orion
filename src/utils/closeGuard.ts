import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { clearRecovery } from '@/hooks/useAutoSave'
import { ipcErrorMessage, writeFileChecked } from '@/utils/ipcResult'
import { confirmOverwriteIfChangedOnDisk, needsSaveLocation } from '@/utils/saveGuards'

/**
 * Write the unsaved edits of the open files at `paths`. Resolves true when all
 * of them are saved; each one that is not gets a toast saying why.
 */
export async function saveOpenFiles(paths: readonly string[]): Promise<boolean> {
  const { addToast } = useToastStore.getState()
  let allSaved = true
  for (const path of paths) {
    const file = useEditorStore.getState().openFiles.find((f) => f.path === path)
    if (!file?.isModified) continue
    if (needsSaveLocation(file.path)) {
      addToast({ type: 'info', message: `${file.name} has not been saved yet: use Save As to choose where it goes` })
      allSaved = false
      continue
    }
    if (!confirmOverwriteIfChangedOnDisk(file)) {
      allSaved = false
      continue
    }
    try {
      await writeFileChecked(file.path, file.content, `Save ${file.name}`)
    } catch (err) {
      addToast({ type: 'error', message: `Failed to save ${file.name}: ${ipcErrorMessage(err)}` })
      allSaved = false
      continue
    }
    // Edits typed while the write was in flight are still unsaved.
    if (useEditorStore.getState().openFiles.find((f) => f.path === path)?.content === file.content) {
      useEditorStore.getState().markSaved(path)
    } else {
      allSaved = false
    }
  }
  return allSaved
}

/** "Save" for the pending close request: save its unsaved tabs, then close. */
export async function saveAndCloseRequested(): Promise<void> {
  const request = useEditorStore.getState().closeRequest
  if (!request) return
  const saved = await saveOpenFiles(request.unsaved)
  // Unless the request was answered or replaced while saving.
  if (saved && useEditorStore.getState().closeRequest === request) {
    useEditorStore.getState().confirmCloseRequest()
  }
}

function unsavedFiles() {
  return useEditorStore.getState().openFiles.filter((f) => f.isModified)
}

/**
 * Keep the window from closing, quitting or reloading over unsaved edits.
 * While a tab has unsaved edits beforeunload refuses the unload, and the main
 * process asks Save / Don't Save / Cancel (will-prevent-unload). Save comes
 * back as app:save-and-close, naming the close or reload to redo once all is
 * saved; Don't Save lets the page unload.
 * Returns a function that removes the guard.
 */
export function installWindowCloseGuard(): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (unsavedFiles().length === 0) return
    event.preventDefault()
    // What Electron documents for refusing the unload.
    event.returnValue = false
  }
  // The page only unloads with unsaved edits once the user chose Don't Save:
  // forget their recovery copies, or the next launch would offer them again.
  const onPageHide = () => {
    for (const file of unsavedFiles()) clearRecovery(file.path)
  }
  const unsubscribe = window.api.onAppSaveAndClose((then) => {
    void saveOpenFiles(unsavedFiles().map((f) => f.path)).then((saved) => {
      if (!saved) return
      // Redo the unload the question interrupted.
      if (then === 'reload') window.api.reloadWindow()
      else window.api.close()
    })
  })
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('pagehide', onPageHide)
  return () => {
    window.removeEventListener('beforeunload', onBeforeUnload)
    window.removeEventListener('pagehide', onPageHide)
    unsubscribe()
  }
}
