/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StatusBar from './StatusBar'
import { useFileStore } from '@/store/files'
import { useToastStore } from '@/store/toast'
import { useAgentStore } from '@/store/agents'
import { useProblemsStore } from '@/store/problems'
import { useEditorStore } from '@/store/editor'

const api = {
  gitStatus: vi.fn(),
  gitBranches: vi.fn(),
  gitCheckout: vi.fn(),
  shellOpenExternal: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: typeof api }).api = api
  api.gitStatus.mockResolvedValue({ isRepo: true, branch: 'main', files: [], ahead: 0, behind: 0 })
  api.gitCheckout.mockResolvedValue(undefined)
  useFileStore.setState({ rootPath: '/repo' })
  useToastStore.setState({ toasts: [], queuedToasts: [], notifications: [], doNotDisturb: false })
  useAgentStore.setState({ agents: [], logs: [] })
  useProblemsStore.setState({ problems: [] })
  useEditorStore.setState({ openFiles: [], activeFilePath: null })
})

afterEach(cleanup)

async function openBranchPicker() {
  render(<StatusBar />)
  const branch = await screen.findByText('main')
  fireEvent.click(branch)
}

describe('StatusBar branch picker', () => {
  it('checks out a remote-tracking ref as a local branch that tracks it, not a detached HEAD', async () => {
    api.gitBranches.mockResolvedValue([
      { name: 'main', current: true },
      { name: 'upstream/feature', current: false, remote: 'upstream' },
    ])
    await openBranchPicker()
    fireEvent.click(await screen.findByText('upstream/feature'))

    await waitFor(() => expect(api.gitCheckout).toHaveBeenCalledWith('/repo', 'feature', 'upstream/feature'))
    expect(useToastStore.getState().notifications[0]?.message).toBe('Created branch feature tracking upstream/feature')
  })

  it('switches to the existing local branch for a remote ref that has one', async () => {
    api.gitBranches.mockResolvedValue([
      { name: 'main', current: true },
      { name: 'dev', current: false },
      { name: 'origin/dev', current: false, remote: 'origin' },
    ])
    await openBranchPicker()
    fireEvent.click(await screen.findByText('origin/dev'))
    await waitFor(() => expect(api.gitCheckout).toHaveBeenCalledWith('/repo', 'dev', undefined))
  })

  it('says why a checkout failed instead of doing nothing', async () => {
    api.gitBranches.mockResolvedValue([{ name: 'main', current: true }, { name: 'dev', current: false }])
    api.gitCheckout.mockRejectedValue(new Error("Error invoking remote method 'git:checkout': Error: local changes would be overwritten"))
    await openBranchPicker()
    fireEvent.click(await screen.findByText('dev'))
    await waitFor(() =>
      expect(useToastStore.getState().notifications[0]?.message).toBe('Could not switch to dev: local changes would be overwritten'),
    )
  })
})

describe('StatusBar notification bell', () => {
  const badge = () => screen.queryByTitle(/notification/)?.textContent ?? ''

  it('counts unread notifications as they arrive and clears when they are read', async () => {
    render(<StatusBar />)
    expect(screen.getByTitle('No notifications')).toBeTruthy()

    act(() => {
      useToastStore.getState().addToast({ type: 'info', message: 'one' })
      useToastStore.getState().addToast({ type: 'info', message: 'two' })
    })
    expect(screen.getByTitle('2 notification(s)')).toBeTruthy()
    expect(badge()).toContain('2')

    act(() => useToastStore.getState().markAllRead())
    expect(screen.getByTitle('No notifications')).toBeTruthy()
  })

  it('does not count agents or errors that are not notifications', () => {
    useAgentStore.setState({
      agents: [{ id: 'a', name: 'Agent', status: 'working' }] as never,
      logs: [{ id: 'l', type: 'error', message: 'x', timestamp: 0 }] as never,
    })
    render(<StatusBar />)
    expect(screen.getByTitle('No notifications')).toBeTruthy()
  })
})

describe('StatusBar language picker', () => {
  it("opens for the palette's Change Language Mode", async () => {
    useEditorStore.setState({
      openFiles: [{ path: '/repo/a.ts', name: 'a.ts', content: '', language: 'typescript', isModified: false, aiModified: false }],
      activeFilePath: '/repo/a.ts',
    })
    render(<StatusBar />)
    act(() => { window.dispatchEvent(new Event('orion:change-language-mode')) })
    expect(await screen.findByPlaceholderText('Search...')).toBeTruthy()
    expect(screen.getByText('Python')).toBeTruthy()
  })
})
