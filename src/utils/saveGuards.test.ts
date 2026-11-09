import { describe, expect, it, vi } from 'vitest'
import { canAutoSave, confirmOverwriteIfChangedOnDisk } from './saveGuards'

const file = (overrides: Record<string, unknown> = {}) => ({
  name: 'notes.ts',
  isModified: true,
  hasExternalChange: false,
  isDeletedOnDisk: false,
  ...overrides,
})

describe('canAutoSave', () => {
  it('saves modified files that are in sync with disk', () => {
    expect(canAutoSave(file())).toBe(true)
  })

  it('never overwrites a file that changed or was deleted on disk', () => {
    expect(canAutoSave(file({ hasExternalChange: true }))).toBe(false)
    expect(canAutoSave(file({ isDeletedOnDisk: true }))).toBe(false)
  })

  it('skips unmodified or missing files', () => {
    expect(canAutoSave(file({ isModified: false }))).toBe(false)
    expect(canAutoSave(undefined)).toBe(false)
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
