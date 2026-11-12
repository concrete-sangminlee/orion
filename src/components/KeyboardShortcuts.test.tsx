/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import KeyboardShortcuts, { shortcutEntries } from './KeyboardShortcuts'
import { getCommand } from '@/commands/registry'

afterEach(cleanup)

describe('KeyboardShortcuts', () => {
  it('lists the keybindings of real commands, and nothing that does not exist', () => {
    const entries = shortcutEntries()
    expect(entries.find((e) => e.id === 'file.save')).toMatchObject({ title: 'Save', keybinding: 'Ctrl+S' })
    for (const entry of entries) {
      if (entry.id.startsWith('other.')) continue
      expect(getCommand(entry.id)?.keybinding, entry.id).toBe(entry.keybinding)
    }
    expect(entries.filter((e) => /extension|debug|breakpoint/i.test(e.title))).toEqual([])
  })

  it('offers no shortcut editing, which nothing would apply', () => {
    render(<KeyboardShortcuts open onClose={() => {}} />)
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Close'])
  })

  it('filters by command or key', () => {
    render(<KeyboardShortcuts open onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('Search by command or key'), { target: { value: 'ctrl+k ctrl+s' } })
    expect(screen.getAllByTestId('shortcut-row').map((row) => row.firstChild?.textContent)).toEqual(['Keyboard Shortcuts'])
  })
})
