import { describe, expect, it } from 'vitest'
import { editDistance, suggestCommands } from '../suggest.js'

const commands = ['status', 'stats', 'review', 'refactor', 'run', 'chat', 'commit', 'config', 'doctor']

describe('editDistance', () => {
  it('counts insertions, deletions, substitutions and adjacent swaps', () => {
    expect(editDistance('status', 'status')).toBe(0)
    expect(editDistance('statsu', 'status')).toBe(1)
    expect(editDistance('revew', 'review')).toBe(1)
    expect(editDistance('cat', 'chat')).toBe(1)
    expect(editDistance('', 'run')).toBe(3)
  })
})

describe('suggestCommands', () => {
  it('suggests the intended command for common typos', () => {
    expect(suggestCommands('statsu', commands)).toContain('status')
    expect(suggestCommands('revew', commands)).toEqual(['review'])
    expect(suggestCommands('comit', commands)).toEqual(['commit'])
    expect(suggestCommands('doctr', commands)).toEqual(['doctor'])
  })

  it('suggests commands that the input is a prefix of', () => {
    expect(suggestCommands('ref', commands)).toEqual(['refactor'])
  })

  it('stays quiet for unrelated words and caps the list', () => {
    expect(suggestCommands('kubernetes', commands)).toEqual([])
    expect(suggestCommands('stat', commands).length).toBeLessThanOrEqual(2)
  })
})
