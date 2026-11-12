/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeTerminal, fireResizeObservers, installTerminalApi, liveTerminals, mockLayoutFromDisplay, resetFakes,
} from './__tests__/fakeXterm'
import { useFileStore } from '@/store/files'
import TerminalPanel from './TerminalPanel'

vi.mock('@xterm/xterm', async () => (await import('./__tests__/fakeXterm')).xtermModule)
vi.mock('@xterm/addon-fit', async () => (await import('./__tests__/fakeXterm')).fitModule)
vi.mock('@xterm/addon-search', async () => (await import('./__tests__/fakeXterm')).searchModule)
vi.mock('@xterm/addon-web-links', async () => (await import('./__tests__/fakeXterm')).webLinksModule)

let api: ReturnType<typeof installTerminalApi>

beforeEach(() => {
  resetFakes()
  localStorage.clear()
  api = installTerminalApi()
})

afterEach(() => {
  cleanup()
})

function keydown(init: KeyboardEventInit) {
  return new KeyboardEvent('keydown', init)
}

describe('TerminalPanel', () => {
  it('keeps inner terminals alive when another one is added or shown', async () => {
    render(<TerminalPanel sessionId="s1" />)
    fireEvent.click(screen.getByTitle('New Terminal'))
    expect(liveTerminals()).toHaveLength(2)

    // Back to the first tab, then to the second again.
    fireEvent.click(screen.getByText('Terminal 1'))
    fireEvent.click(screen.getByText('Terminal 2'))

    expect(FakeTerminal.instances.filter((t) => t.disposed)).toHaveLength(0)
    expect(api.termKill).not.toHaveBeenCalled()
    await waitFor(() => expect(api.termCreate).toHaveBeenCalledTimes(2))
  })

  it('does not fit a hidden terminal to its display:none box, and refits it when shown', () => {
    const restoreLayout = mockLayoutFromDisplay()
    try {
      render(<TerminalPanel sessionId="s1" />)
      fireEvent.click(screen.getByTitle('New Terminal'))
      const [hidden, shown] = FakeTerminal.instances
      hidden.fit.mockClear()
      shown.fit.mockClear()

      // Hiding fires the ResizeObserver; FitAddon would shrink the shell to ~10x6.
      act(() => fireResizeObservers())
      expect(hidden.fit).not.toHaveBeenCalled()
      expect(shown.fit).toHaveBeenCalled()

      fireEvent.click(screen.getByText('Terminal 1'))
      expect(hidden.fit).toHaveBeenCalled()
    } finally {
      restoreLayout()
    }
  })

  it('kills the shell when its tab is closed', () => {
    render(<TerminalPanel sessionId="s1" />)
    fireEvent.click(screen.getByTitle('New Terminal'))
    const secondId = api.termCreate.mock.calls[1][0]
    fireEvent.click(screen.getByTitle('Kill Terminal'))
    expect(api.termKill).toHaveBeenCalledWith(secondId)
    expect(api.termKill).not.toHaveBeenCalledWith('s1')
  })

  it('starts the pty at the size xterm was fitted to', () => {
    render(<TerminalPanel sessionId="s1" />)
    expect(api.termCreate).toHaveBeenCalledWith('s1', undefined, { cols: 120, rows: 18 })
  })

  it('tells the user when the shell exits', async () => {
    render(<TerminalPanel sessionId="s1" />)
    await waitFor(() => expect(api.termCreate).toHaveBeenCalled())
    act(() => api.emitExit('s1', 127))
    act(() => api.emitExit('other', 1))
    expect(FakeTerminal.instances[0].written.join('')).toContain('[Process exited with code 127]')
    expect(FakeTerminal.instances[0].written.join('')).not.toContain('code 1]')
  })

  it('applies Settings > Terminal on creation and when they change', () => {
    localStorage.setItem('orion-terminal-settings', JSON.stringify({
      defaultShell: 'zsh', fontFamily: 'Fira Code', fontSize: 16, cursorStyle: 'underline', scrollback: 4000,
    }))
    render(<TerminalPanel sessionId="s1" />)
    const term = FakeTerminal.instances[0]
    expect(term.options).toMatchObject({
      fontFamily: '"Fira Code", monospace', fontSize: 16, cursorStyle: 'underline', scrollback: 4000,
    })
    expect(api.termCreate).toHaveBeenCalledWith('s1', { shellPath: '/bin/zsh', shellArgs: ['--login'] }, expect.anything())

    act(() => {
      window.dispatchEvent(new CustomEvent('orion:terminal-config', {
        detail: { defaultShell: 'zsh', fontFamily: 'Menlo', fontSize: 20, cursorStyle: 'bar', scrollback: 500 },
      }))
    })
    expect(term.options).toMatchObject({ fontFamily: '"Menlo", monospace', fontSize: 20, cursorStyle: 'bar', scrollback: 500 })
  })

  it('an explicit shell profile wins over the default-shell setting', () => {
    localStorage.setItem('orion-terminal-settings', JSON.stringify({ defaultShell: 'zsh' }))
    render(<TerminalPanel sessionId="s1" shellPath="/bin/bash" shellArgs={['--login']} />)
    expect(api.termCreate).toHaveBeenCalledWith('s1', { shellPath: '/bin/bash', shellArgs: ['--login'] }, expect.anything())
  })

  it('keeps a name the user gave a tab when the shell sets its title', () => {
    render(<TerminalPanel sessionId="s1" />)
    const term = FakeTerminal.instances[0]
    act(() => term.emitTitle('user@host: ~'))
    expect(screen.getByText('user@host: ~')).toBeTruthy()

    fireEvent.doubleClick(screen.getByText('user@host: ~'))
    const input = screen.getByDisplayValue('user@host: ~')
    fireEvent.change(input, { target: { value: 'server' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    act(() => term.emitTitle('user@host: ~/project'))
    expect(screen.getByText('server')).toBeTruthy()
    expect(screen.queryByText('user@host: ~/project')).toBeNull()
  })

  it('has no Ctrl+K command generator and passes Ctrl+K to the shell', () => {
    render(<TerminalPanel sessionId="s1" />)
    const handler = FakeTerminal.instances[0].keyHandler!
    expect(handler(keydown({ key: 'k', ctrlKey: true }))).toBe(true)
    expect(screen.queryByPlaceholderText('Describe what you want to do...')).toBeNull()
  })

  it('leaves Ctrl+Shift+` (e.key is "~" with Shift) to the panel', () => {
    render(<TerminalPanel sessionId="s1" />)
    const handler = FakeTerminal.instances[0].keyHandler!
    expect(handler(keydown({ key: '~', code: 'Backquote', ctrlKey: true, shiftKey: true }))).toBe(false)
  })

  it('has no Maximize Terminal button (nothing could maximize it)', () => {
    render(<TerminalPanel sessionId="s1" />)
    expect(screen.queryByTitle('Maximize Terminal')).toBeNull()
  })

  it('opens a file link from the output in the editor, at its line', async () => {
    useFileStore.setState({ rootPath: '/ws' })
    const goToLine = vi.fn()
    window.addEventListener('orion:go-to-line', goToLine)
    try {
      render(<TerminalPanel sessionId="s1" />)
      const [link] = FakeTerminal.instances[0].linksFor('error in src/app.ts:12:3 here')
      expect(link.text).toBe('src/app.ts:12:3')
      link.activate()
      await waitFor(() => expect(api.readFile).toHaveBeenCalledWith('/ws/src/app.ts'))
      await waitFor(() => expect(goToLine).toHaveBeenCalled())
      expect((goToLine.mock.calls[0][0] as CustomEvent).detail).toEqual({ line: 12, column: 3 })
    } finally {
      window.removeEventListener('orion:go-to-line', goToLine)
      useFileStore.setState({ rootPath: null })
    }
  })

  it('under StrictMode ends with one live terminal backed by a fresh pty', async () => {
    render(<StrictMode><TerminalPanel sessionId="s1" initialCommand="npm test" /></StrictMode>)
    expect(liveTerminals()).toHaveLength(1)
    // The simulated unmount killed the first pty; the re-run created it again.
    expect(api.termKill).toHaveBeenCalledWith('s1')
    expect(api.termCreate).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(api.termWrite).toHaveBeenCalledWith('s1', 'npm test\r'))
    expect(api.termWrite).toHaveBeenCalledTimes(1)
  })

  it('types the initial command once the shell has started', async () => {
    render(<TerminalPanel sessionId="s1" initialCommand="npm run build" />)
    await waitFor(() => expect(api.termWrite).toHaveBeenCalledWith('s1', 'npm run build\r'))
    expect(api.termWrite).toHaveBeenCalledTimes(1)
  })
})
