/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NotificationCenter from './NotificationCenter'
import { useToastStore } from '@/store/toast'

describe('NotificationCenter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [], queuedToasts: [], notifications: [], doNotDisturb: false })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows nothing invented when there are no notifications', () => {
    render(<NotificationCenter open onClose={() => {}} />)
    expect(screen.getByText('No notifications yet')).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(useToastStore.getState().notifications).toHaveLength(0)
  })

  it('lists the real toast history and clears the unread badge when opened', () => {
    const retry = vi.fn()
    act(() => {
      useToastStore.getState().addToast({ type: 'error', message: 'Push failed: rejected', action: { label: 'Retry', onClick: retry } })
      useToastStore.getState().addToast({ type: 'success', message: 'Saved a.ts' })
    })
    expect(useToastStore.getState().getUnreadCount()).toBe(2)

    render(<NotificationCenter open onClose={() => {}} />)

    expect(screen.getByText('Push failed: rejected')).toBeTruthy()
    expect(screen.getByText('Saved a.ts')).toBeTruthy()
    expect(useToastStore.getState().getUnreadCount()).toBe(0)

    fireEvent.click(screen.getByText('Retry'))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('filters by type and clears the history', () => {
    act(() => {
      useToastStore.getState().addToast({ type: 'error', message: 'Build broke' })
      useToastStore.getState().addToast({ type: 'info', message: 'Opened folder' })
    })
    render(<NotificationCenter open onClose={() => {}} />)

    fireEvent.click(screen.getByText('Error (1)'))
    expect(screen.queryByText('Opened folder')).toBeNull()
    expect(screen.getByText('Build broke')).toBeTruthy()

    fireEvent.click(screen.getByTitle('Clear all notifications'))
    expect(useToastStore.getState().notifications).toHaveLength(0)
    expect(screen.getByText('No notifications yet')).toBeTruthy()
  })
})
