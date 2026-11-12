import { describe, expect, it } from 'vitest'
import {
  UnsafeShellOptionsError,
  isTerminalId,
  parseTerminalSize,
  validateShellOptions,
  validateTerminalSize,
} from './terminal-options-guard'

describe('validateTerminalSize', () => {
  it('treats a missing size as "use the default"', () => {
    expect(validateTerminalSize(undefined)).toBeUndefined()
    expect(validateTerminalSize(null)).toBeUndefined()
  })

  it('accepts a positive integer grid', () => {
    expect(validateTerminalSize({ cols: 140, rows: 12 })).toEqual({ cols: 140, rows: 12 })
  })

  it('rejects anything node-pty could choke on', () => {
    for (const bad of [{ cols: 0, rows: 24 }, { cols: 80, rows: -1 }, { cols: 80.5, rows: 24 },
      { cols: '80', rows: 24 }, { cols: Number.NaN, rows: 24 }, { cols: 1e9, rows: 24 }, [80, 24], 'big']) {
      expect(() => validateTerminalSize(bad)).toThrow(UnsafeShellOptionsError)
    }
  })

  it('parseTerminalSize returns null instead of throwing (for fire-and-forget resize)', () => {
    expect(parseTerminalSize(120, 30)).toEqual({ cols: 120, rows: 30 })
    expect(parseTerminalSize(120, Infinity)).toBeNull()
  })
})

describe('isTerminalId', () => {
  it('accepts short non-empty strings only', () => {
    expect(isTerminalId('3f2b-term')).toBe(true)
    expect(isTerminalId('')).toBe(false)
    expect(isTerminalId(7)).toBe(false)
    expect(isTerminalId('x'.repeat(129))).toBe(false)
  })
})

describe('validateShellOptions', () => {
  it('returns an empty object for undefined input', () => {
    expect(validateShellOptions(undefined)).toEqual({})
  })

  it('returns an empty object for null input', () => {
    expect(validateShellOptions(null)).toEqual({})
  })

  it('accepts well-formed Windows shell profiles', () => {
    expect(validateShellOptions({ shellPath: 'powershell.exe' })).toEqual({ shellPath: 'powershell.exe' })
    expect(validateShellOptions({ shellPath: 'cmd.exe', shellArgs: [] })).toEqual({ shellPath: 'cmd.exe', shellArgs: [] })
    expect(validateShellOptions({ shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe', shellArgs: ['--login', '-i'] }))
      .toEqual({ shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe', shellArgs: ['--login', '-i'] })
  })

  it('accepts well-formed Unix shell profiles', () => {
    expect(validateShellOptions({ shellPath: '/bin/bash', shellArgs: ['--login'] }))
      .toEqual({ shellPath: '/bin/bash', shellArgs: ['--login'] })
    expect(validateShellOptions({ shellPath: '/bin/zsh' })).toEqual({ shellPath: '/bin/zsh' })
  })

  it('trims surrounding whitespace from shellPath', () => {
    expect(validateShellOptions({ shellPath: '  /bin/bash  ' })).toEqual({ shellPath: '/bin/bash' })
  })

  it('rejects non-object shellOptions', () => {
    expect(() => validateShellOptions('cmd.exe')).toThrow(UnsafeShellOptionsError)
    expect(() => validateShellOptions(123)).toThrow('must be an object')
    expect(() => validateShellOptions(['cmd.exe'])).toThrow('must be an object')
  })

  it('rejects non-string shellPath', () => {
    expect(() => validateShellOptions({ shellPath: 123 })).toThrow('shellPath must be a string')
    expect(() => validateShellOptions({ shellPath: null })).toThrow('shellPath must be a string')
    expect(() => validateShellOptions({ shellPath: ['cmd.exe'] })).toThrow('shellPath must be a string')
  })

  it('rejects empty / whitespace-only shellPath', () => {
    expect(() => validateShellOptions({ shellPath: '' })).toThrow('must not be empty')
    expect(() => validateShellOptions({ shellPath: '   ' })).toThrow('must not be empty')
    expect(() => validateShellOptions({ shellPath: '\t\n' })).toThrow('must not be empty')
  })

  it('rejects shellPath with NUL or control characters', () => {
    expect(() => validateShellOptions({ shellPath: 'cmd\x00.exe' })).toThrow('control characters')
    expect(() => validateShellOptions({ shellPath: 'cmd\x07.exe' })).toThrow('control characters')
    expect(() => validateShellOptions({ shellPath: 'cmd\x1b.exe' })).toThrow('control characters')
  })

  it('rejects non-array shellArgs', () => {
    expect(() => validateShellOptions({ shellArgs: '--login' })).toThrow('must be an array')
    expect(() => validateShellOptions({ shellArgs: { 0: '--login' } })).toThrow('must be an array')
  })

  it('rejects non-string shellArgs entries', () => {
    expect(() => validateShellOptions({ shellArgs: ['--login', 123] })).toThrow('entries must be strings')
    expect(() => validateShellOptions({ shellArgs: [null] })).toThrow('entries must be strings')
  })

  it('rejects shellArgs entries containing NUL', () => {
    expect(() => validateShellOptions({ shellArgs: ['--login', 'foo\x00bar'] })).toThrow('NUL bytes')
  })

  it('preserves non-NUL control characters in shellArgs entries', () => {
    // A tab inside an arg is a legitimate thing the user might want passed
    // through (e.g. a value containing a literal tab).
    const result = validateShellOptions({ shellArgs: ['-c', 'echo a\tb'] })
    expect(result.shellArgs).toEqual(['-c', 'echo a\tb'])
  })
})
