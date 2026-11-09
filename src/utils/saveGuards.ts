import type { OpenFile } from '@shared/types'

type SaveCandidate = Pick<OpenFile, 'name' | 'isModified' | 'hasExternalChange' | 'isDeletedOnDisk'>

/**
 * Auto-save must never resolve a conflict on the user's behalf. A file that
 * changed or disappeared on disk since it was opened is left for the user
 * (reload, or save explicitly); writing the buffer would silently discard the
 * other version.
 */
export function canAutoSave(file: SaveCandidate | undefined): boolean {
  return Boolean(file && file.isModified && !file.hasExternalChange && !file.isDeletedOnDisk)
}

/**
 * For an explicit save, ask before overwriting a version that changed on disk
 * after the file was opened. Returns true when the save may proceed.
 */
export function confirmOverwriteIfChangedOnDisk(
  file: SaveCandidate,
  confirm: (message: string) => boolean = (message) => window.confirm(message),
): boolean {
  if (!file.hasExternalChange) return true
  return confirm(`"${file.name}" was changed on disk after you opened it.\n\nOverwrite the version on disk with yours?`)
}
