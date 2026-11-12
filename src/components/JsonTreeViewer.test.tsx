/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import JsonTreeViewer, { editedLiteral, replaceJsonValue } from './JsonTreeViewer'

const DOC = '{\n    "port": "3000",\n    "big": 12345678901234567890,\n    "a.b": { "list": [1, "x", true] },\n    "flag": false\n}\n'

describe('replaceJsonValue', () => {
  it('rewrites only the edited value, keeping formatting and big integers byte-identical', () => {
    expect(replaceJsonValue(DOC, ['flag'], 'true')).toBe(DOC.replace('"flag": false', '"flag": true'))
    expect(replaceJsonValue(DOC, ['a.b', 'list', 1], '"y"')).toBe(DOC.replace('"x"', '"y"'))
  })

  it('follows JSON.parse for duplicate keys and returns null for a missing path', () => {
    expect(replaceJsonValue('{"k": 1, "k": 2}', ['k'], '3')).toBe('{"k": 1, "k": 3}')
    expect(replaceJsonValue(DOC, ['missing'], '1')).toBeNull()
    expect(replaceJsonValue(DOC, ['a.b', 'list', 9], '1')).toBeNull()
  })

  it('skips nested containers and escaped quotes in strings', () => {
    const text = '[{"s": "a\\"]}"}, [1, [2]], 7]'
    expect(replaceJsonValue(text, [2], '8')).toBe('[{"s": "a\\"]}"}, [1, [2]], 8]')
  })
})

describe('editedLiteral', () => {
  it('is null when nothing changed', () => {
    expect(editedLiteral('3000', '3000')).toBeNull()
    expect(editedLiteral(12, '12')).toBeNull()
    expect(editedLiteral(null, 'null')).toBeNull()
  })

  it('keeps strings as strings even when they look like numbers, booleans or null', () => {
    expect(editedLiteral('a', '01234')).toBe('"01234"')
    expect(editedLiteral('a', 'true')).toBe('"true"')
    expect(editedLiteral('a', 'null')).toBe('"null"')
  })

  it('takes typed literals for non-string values', () => {
    expect(editedLiteral(1, ' 2 ')).toBe('2')
    expect(editedLiteral(false, 'true')).toBe('true')
    expect(editedLiteral(1, 'hello')).toBe('"hello"')
  })
})

describe('JsonTreeViewer editing', () => {
  afterEach(() => cleanup())

  it('does not write anything when a value is clicked and left unchanged', () => {
    const onChange = vi.fn()
    render(<JsonTreeViewer content={DOC} onChange={onChange} />)
    fireEvent.click(screen.getByText('"3000"'))
    fireEvent.blur(screen.getByDisplayValue('3000'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('writes a targeted edit and keeps the edited string a string', () => {
    const onChange = vi.fn()
    render(<JsonTreeViewer content={DOC} onChange={onChange} />)
    fireEvent.click(screen.getByText('"3000"'))
    const input = screen.getByDisplayValue('3000')
    fireEvent.change(input, { target: { value: '4000' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(DOC.replace('"3000"', '"4000"'))
  })

  it('discards the edit on Escape even if the input then blurs', () => {
    const onChange = vi.fn()
    render(<JsonTreeViewer content={DOC} onChange={onChange} />)
    fireEvent.click(screen.getByText('false'))
    const input = screen.getByDisplayValue('false')
    fireEvent.change(input, { target: { value: 'true' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })
})
