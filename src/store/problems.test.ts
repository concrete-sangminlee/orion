import { describe, expect, it } from 'vitest'
import { scanLintHints } from './problems'

describe('scanLintHints', () => {
  it('reports nothing for valid code the old bracket matcher flagged as errors', () => {
    expect(scanLintHints("const s = text.replace(/'/g, \"x\")\nconst re = /[(]/\nif (a) { b() }")).toEqual([])
  })

  it('finds TODO comments and leftover debugging code, as hints only', () => {
    const hints = scanLintHints([
      '// FIXME: broken',
      '  console.log(value)',
      '  debugger',
      '// console.log(commented out)',
      'try { run() } catch (e) {}',
      '// @ts-ignore',
    ].join('\n'))

    expect(hints.map(({ line, message, severity, source }) => ({ line, message, severity, source }))).toEqual([
      { line: 1, message: 'FIXME: broken', severity: 'warning', source: 'todo' },
      { line: 2, message: 'console.log statement', severity: 'info', source: 'lint-hint' },
      { line: 3, message: 'debugger statement', severity: 'warning', source: 'lint-hint' },
      { line: 5, message: 'Empty catch block', severity: 'warning', source: 'lint-hint' },
      { line: 6, message: 'Type checking suppressed with @ts-ignore', severity: 'warning', source: 'lint-hint' },
    ])
    expect(hints[1]).toMatchObject({ column: 3, endColumn: 15 })
    expect(hints[2]).toMatchObject({ column: 3, endColumn: 11 })
  })
})
