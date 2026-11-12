import { describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_SETTINGS, mergeSettings } from './workspace'

describe('mergeSettings', () => {
  it('keeps overrides of the right type', () => {
    const merged = mergeSettings({ excludePatterns: ['dist'], tabSize: 4, insertSpaces: false, fileAssociations: { '*.mdx': 'markdown' } })
    expect(merged).toMatchObject({ excludePatterns: ['dist'], tabSize: 4, insertSpaces: false, fileAssociations: { '*.mdx': 'markdown' } })
  })

  it('ignores hand-written values of the wrong type instead of passing them on to crash the UI', () => {
    const merged = mergeSettings({
      excludePatterns: 'dist',
      searchExcludes: [1, 2],
      autoSave: 'yes',
      tabSize: 0,
      fileAssociations: { '*.mdx': 42, '*.x': 'xml' },
    })
    expect(merged.excludePatterns).toEqual(DEFAULT_WORKSPACE_SETTINGS.excludePatterns)
    expect(merged.searchExcludes).toEqual(DEFAULT_WORKSPACE_SETTINGS.searchExcludes)
    expect(merged.autoSave).toBe(DEFAULT_WORKSPACE_SETTINGS.autoSave)
    expect(merged.tabSize).toBe(DEFAULT_WORKSPACE_SETTINGS.tabSize)
    expect(merged.fileAssociations).toEqual({ '*.x': 'xml' })
  })
})
