/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@monaco-editor/react', () => ({ loader: { __getMonacoInstance: () => null } }))

import SnippetManager from './SnippetManager'
import { useSnippetStore } from '@/store/snippets'
import { useToastStore } from '@/store/toast'

const ROW_TITLE = 'Click to preview, double-click to insert at cursor'

function storedUsage(): number {
  const meta = JSON.parse(localStorage.getItem('orion-snippet-meta') || '{}') as Record<string, { usageCount: number }>
  return Object.values(meta).reduce((sum, m) => sum + m.usageCount, 0)
}

describe('SnippetManager insert', () => {
  const realInsert = useSnippetStore.getState().insertSnippetAtCursor

  beforeEach(() => {
    localStorage.clear()
    useToastStore.setState({ toasts: [], notifications: [] })
  })
  afterEach(() => {
    cleanup()
    useSnippetStore.setState({ insertSnippetAtCursor: realInsert })
  })

  it('counts usage and closes only when the snippet really reached the editor', () => {
    const insert = vi.fn().mockReturnValue(true)
    useSnippetStore.setState({ insertSnippetAtCursor: insert })
    const onClose = vi.fn()
    render(<SnippetManager open onClose={onClose} />)

    fireEvent.doubleClick(screen.getAllByTitle(ROW_TITLE)[0])

    expect(insert).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(storedUsage()).toBe(1)
  })

  it('tells the user and records nothing when no editor can take the snippet', () => {
    useSnippetStore.setState({ insertSnippetAtCursor: vi.fn().mockReturnValue(false) })
    const onClose = vi.fn()
    render(<SnippetManager open onClose={onClose} />)

    fireEvent.doubleClick(screen.getAllByTitle(ROW_TITLE)[0])

    expect(onClose).not.toHaveBeenCalled()
    expect(storedUsage()).toBe(0)
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('Open a file in the editor to insert a snippet.')
  })

  it('has no per-snippet keybinding field (it could only fire while this dialog was open)', () => {
    render(<SnippetManager open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    expect(screen.getByText('Category')).toBeTruthy()
    expect(screen.queryByText('Keybinding')).toBeNull()
  })
})
