/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { getRecoveryEntries, useAutoSave } from './useAutoSave'
import { useEditorStore } from '@/store/editor'

/** Auto-save runs for files open in the editor with unsaved changes. */
function openModifiedFiles(...paths: string[]) {
  useEditorStore.setState({
    openFiles: paths.map((path) => ({
      path,
      name: path.split('/').pop() ?? path,
      content: '',
      language: 'typescript',
      isModified: true,
      aiModified: false,
    })),
  })
}

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    ;(globalThis as unknown as { api: { writeFile: ReturnType<typeof vi.fn> } }).api = {
      writeFile: vi.fn().mockResolvedValue({ success: true }),
    }
    openModifiedFiles('/workspace/a.ts', '/workspace/b.ts')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('schedules auto-save independently per file', async () => {
    const { result } = renderHook(() => useAutoSave())
    const apiWrite = (globalThis as unknown as { api: { writeFile: ReturnType<typeof vi.fn> } }).api.writeFile

    act(() => {
      result.current.scheduleAutoSave('/workspace/a.ts', 'A')
      result.current.scheduleAutoSave('/workspace/b.ts', 'B')
      vi.advanceTimersByTime(999)
    })
    expect(apiWrite).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
      // timer callbacks are async; flush promise queue
      await Promise.resolve()
    })

    expect(apiWrite).toHaveBeenCalledTimes(2)
    expect(apiWrite).toHaveBeenNthCalledWith(1, '/workspace/a.ts', 'A')
    expect(apiWrite).toHaveBeenNthCalledWith(2, '/workspace/b.ts', 'B')
  })

  it('does not overwrite a file that changed on disk after the save was scheduled', async () => {
    const { result } = renderHook(() => useAutoSave())
    const apiWrite = (globalThis as unknown as { api: { writeFile: ReturnType<typeof vi.fn> } }).api.writeFile

    act(() => {
      result.current.scheduleAutoSave('/workspace/a.ts', 'local edit')
      result.current.scheduleAutoSave('/workspace/b.ts', 'other edit')
      // The watcher reports an external change to a.ts before the timer fires.
      useEditorStore.getState().markExternalChange('/workspace/a.ts')
      useEditorStore.getState().markDeletedOnDisk('/workspace/b.ts')
    })

    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })

    expect(apiWrite).not.toHaveBeenCalled()
  })

  it('keeps an untitled buffer for an explicit Save As instead of writing a relative path', async () => {
    openModifiedFiles('untitled-1700000000000')
    const { result } = renderHook(() => useAutoSave())
    const apiWrite = (globalThis as unknown as { api: { writeFile: ReturnType<typeof vi.fn> } }).api.writeFile

    act(() => {
      result.current.scheduleAutoSave('untitled-1700000000000', 'draft')
    })
    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })

    expect(apiWrite).not.toHaveBeenCalled()
    // Its text is still kept for crash recovery.
    expect(getRecoveryEntries()).toEqual([expect.objectContaining({ path: 'untitled-1700000000000', content: 'draft' })])
  })

  it('debounces repeated changes for the same file', async () => {
    const { result } = renderHook(() => useAutoSave())
    const apiWrite = (globalThis as unknown as { api: { writeFile: ReturnType<typeof vi.fn> } }).api.writeFile

    act(() => {
      result.current.scheduleAutoSave('/workspace/a.ts', 'first')
      vi.advanceTimersByTime(500)
      result.current.scheduleAutoSave('/workspace/a.ts', 'second')
      vi.advanceTimersByTime(500)
    })
    expect(apiWrite).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(apiWrite).toHaveBeenCalledTimes(1)
    expect(apiWrite).toHaveBeenLastCalledWith('/workspace/a.ts', 'second')
  })

  it('cancels all pending timers when hook unmounts', async () => {
    const { result, unmount } = renderHook(() => useAutoSave())
    const apiWrite = (globalThis as unknown as { api: { writeFile: ReturnType<typeof vi.fn> } }).api.writeFile

    act(() => {
      result.current.scheduleAutoSave('/workspace/a.ts', 'A')
      result.current.scheduleAutoSave('/workspace/b.ts', 'B')
    })

    unmount()

    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
    })

    expect(apiWrite).not.toHaveBeenCalled()
  })

  it('uses defaults for invalid persisted autoSaveDelay values', async () => {
    localStorage.setItem(
      'orion-editor-settings',
      JSON.stringify({ autoSaveMode: 'afterDelay', autoSaveDelay: 'abc' })
    )

    const { result } = renderHook(() => useAutoSave())
    const apiWrite = (globalThis as unknown as { api: { writeFile: ReturnType<typeof vi.fn> } }).api.writeFile

    act(() => {
      result.current.scheduleAutoSave('/workspace/a.ts', 'A')
      vi.advanceTimersByTime(0)
    })
    expect(apiWrite).toHaveBeenCalledTimes(0)

    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })

    expect(apiWrite).toHaveBeenCalledTimes(1)
  })

  it('ignores invalid autoSaveDelay events and keeps the previous delay', async () => {
    const { result } = renderHook(() => useAutoSave())
    const apiWrite = (globalThis as unknown as { api: { writeFile: ReturnType<typeof vi.fn> } }).api.writeFile

    act(() => {
      window.dispatchEvent(
        new CustomEvent('orion:editor-config', {
          detail: { autoSaveMode: 'afterDelay', autoSaveDelay: -100 },
        })
      )
      result.current.scheduleAutoSave('/workspace/a.ts', 'A')
      vi.advanceTimersByTime(0)
    })

    expect(apiWrite).toHaveBeenCalledTimes(0)
    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })
    expect(apiWrite).toHaveBeenCalledTimes(1)
  })

  it('evicts the oldest recovery entry by timestamp when capacity is exceeded', async () => {
    const nowValues = [
      1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900,
      2000, 2100, 2200, 2300,
    ]
    let nowIndex = 0
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
      const value = nowValues[nowIndex]
      nowIndex += 1
      return value
    })

    const { result, unmount } = renderHook(() => useAutoSave())

    act(() => {
      for (let i = 1; i <= 10; i++) {
        result.current.scheduleAutoSave(`/workspace/file-${i}.ts`, `v${i}`)
      }
      // Refresh the oldest path so it should not be evicted on overflow.
      result.current.scheduleAutoSave('/workspace/file-1.ts', 'v1-updated')
      result.current.scheduleAutoSave('/workspace/file-11.ts', 'v11')
    })

    const entries = getRecoveryEntries()
    expect(entries).toHaveLength(10)
    expect(entries.some((entry) => entry.path === '/workspace/file-1.ts')).toBe(true)
    expect(entries.some((entry) => entry.path === '/workspace/file-2.ts')).toBe(false)
    expect(entries.some((entry) => entry.path === '/workspace/file-11.ts')).toBe(true)

    unmount()
    spy.mockRestore()
  })

  it('removes stale recovery entries when stored recovery payload is invalid', async () => {
    const { result, unmount } = renderHook(() => useAutoSave())
    const recoveryKey = '/workspace/stale.ts'

    act(() => {
      result.current.scheduleAutoSave(recoveryKey, 'stale')
      vi.advanceTimersByTime(0)
    })

    const recoveryIndex = JSON.parse(localStorage.getItem('orion-recovery-index') || '{}') as Record<string, string>
    const entryKey = recoveryIndex[recoveryKey]
    expect(entryKey).toBeTruthy()

    localStorage.setItem(entryKey, '{broken-json')

    const entries = getRecoveryEntries()
    expect(entries).toHaveLength(0)
    expect(localStorage.getItem(entryKey)).toBeNull()
    expect(localStorage.getItem('orion-recovery-index')).toBe('{}')

    unmount()
  })
})
