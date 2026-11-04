import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'

function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || filePath
}

/**
 * Read a file through the main process and open it as a pinned editor tab.
 * Shows a toast and resolves `false` when the file cannot be read, instead of
 * opening an empty buffer.
 */
export async function openFileInEditor(filePath: string): Promise<boolean> {
  try {
    const { content, language } = await window.api.readFile(filePath)
    useEditorStore.getState().openFile(
      { path: filePath, name: baseName(filePath), content, language, isModified: false, aiModified: false },
      { preview: false },
    )
    return true
  } catch (err) {
    const reason = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)
    useToastStore.getState().addToast({ type: 'error', message: `Failed to open ${baseName(filePath)}: ${reason}` })
    return false
  }
}

/** Show the native file picker and open every chosen file. */
export async function pickAndOpenFiles(): Promise<void> {
  const filePaths = await window.api.openFileDialog()
  for (const filePath of filePaths) {
    await openFileInEditor(filePath)
  }
}
