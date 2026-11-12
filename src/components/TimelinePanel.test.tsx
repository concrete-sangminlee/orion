/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TimelinePanel from './TimelinePanel'
import { useEditorStore } from '@/store/editor'
import { useFileStore } from '@/store/files'
import { useFileHistoryStore } from '@/store/fileHistory'

describe('TimelinePanel git commits', () => {
  const gitFileLog = vi.fn()

  beforeEach(() => {
    gitFileLog.mockReset().mockResolvedValue({
      commits: [{
        fullHash: 'a'.repeat(40), hash: 'aaaaaaa', author: 'Ada', email: 'ada@example.com',
        date: '2024-01-02 03:04:05 +0000', message: 'Fix the parser',
      }],
      hasMore: false,
    })
    ;(window as unknown as { api: unknown }).api = { gitFileLog }
    useFileHistoryStore.setState({ gitCommits: new Map(), snapshots: new Map() })
    useFileStore.setState({ rootPath: '/w' })
    useEditorStore.setState({
      openFiles: [{ path: '/w/a.ts', name: 'a.ts', content: 'x', language: 'typescript', isModified: false, aiModified: false }],
      activeFilePath: '/w/a.ts',
    })
  })
  afterEach(() => cleanup())

  it('shows the active file\'s real commits, and the toggle hides them', async () => {
    await act(async () => {
      render(<TimelinePanel />)
    })

    expect(gitFileLog).toHaveBeenCalledWith('/w', { file: '/w/a.ts', limit: 20 })
    expect(screen.getByText('Fix the parser')).toBeTruthy()
    expect(useFileHistoryStore.getState().gitCommits.get('/w/a.ts')?.[0]).toMatchObject({
      hash: 'aaaaaaa', author: 'Ada', timestamp: Date.UTC(2024, 0, 2, 3, 4, 5),
    })

    fireEvent.click(screen.getByTitle('Hide git commits'))
    expect(screen.queryByText('Fix the parser')).toBeNull()
  })

  it('keeps showing local history when the folder is not a git repository', async () => {
    gitFileLog.mockRejectedValue(new Error('not a git repository'))
    await act(async () => {
      render(<TimelinePanel />)
    })
    expect(useFileHistoryStore.getState().gitCommits.get('/w/a.ts')).toBeUndefined()
  })
})
