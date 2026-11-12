import { describe, expect, it } from 'vitest'
import { detectLanguage } from './operations'

describe('detectLanguage', () => {
  it('returns Monaco language ids for React files, which Monaco would otherwise show as plain text', () => {
    expect(detectLanguage('/proj/src/App.tsx')).toBe('typescript')
    expect(detectLanguage('/proj/src/App.jsx')).toBe('javascript')
    expect(detectLanguage('/proj/src/a.ts')).toBe('typescript')
    expect(detectLanguage('/proj/src/a.JS')).toBe('javascript')
  })

  it('falls back to plaintext for unknown extensions', () => {
    expect(detectLanguage('/proj/notes.unknownext')).toBe('plaintext')
  })
})
