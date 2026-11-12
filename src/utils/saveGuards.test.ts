import { describe, expect, it, vi } from 'vitest'
import { canAutoSave, confirmOverwriteIfChangedOnDisk, needsSaveLocation } from './saveGuards'

const file = (overrides: Record<string, unknown> = {}) => ({
  path: '/w/notes.ts',
  name: 'notes.ts',
  isModified: true,
  hasExternalChange: false,
  isDeletedOnDisk: false,
  ...overrides,
})

describe('canAutoSave', () => {
  it('saves modified files that are in sync with disk', () => {
    expect(canAutoSave(file())).toBe(true)
    expect(canAutoSave(file({ path: 'C:\\w\\notes.ts' }))).toBe(true)
  })

  it('never overwrites a file that changed or was deleted on disk', () => {
    expect(canAutoSave(file({ hasExternalChange: true }))).toBe(false)
    expect(canAutoSave(file({ isDeletedOnDisk: true }))).toBe(false)
  })

  it('skips unmodified or missing files', () => {
    expect(canAutoSave(file({ isModified: false }))).toBe(false)
    expect(canAutoSave(undefined)).toBe(false)
  })

  it('leaves untitled buffers for an explicit save (fs:write-file rejects their relative path)', () => {
    expect(canAutoSave(file({ path: 'untitled-1700000000000', name: 'Untitled' }))).toBe(false)
  })
})

describe('needsSaveLocation', () => {
  it('is true only for buffers without an absolute file path', () => {
    expect(needsSaveLocation('untitled-1700000000000')).toBe(true)
    expect(needsSaveLocation('notes.ts')).toBe(true)
    expect(needsSaveLocation('/w/notes.ts')).toBe(false)
    expect(needsSaveLocation('C:\\w\\notes.ts')).toBe(false)
    expect(needsSaveLocation('d:/w/notes.ts')).toBe(false)
    expect(needsSaveLocation('\\\\server\\share\\notes.ts')).toBe(false)
  })
})

describe('confirmOverwriteIfChangedOnDisk', () => {
  it('does not ask when the file is in sync with disk', () => {
    const confirm = vi.fn(() => false)
    expect(confirmOverwriteIfChangedOnDisk(file(), confirm)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks before overwriting an external change and respects the answer', () => {
    expect(confirmOverwriteIfChangedOnDisk(file({ hasExternalChange: true }), () => true)).toBe(true)
    const decline = vi.fn((_message: string) => false)
    expect(confirmOverwriteIfChangedOnDisk(file({ hasExternalChange: true }), decline)).toBe(false)
    expect(decline.mock.calls[0][0]).toContain('notes.ts')
  })
})
