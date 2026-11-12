/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@shared/types'
import { useEditorStore } from '@/store/editor'
import { useToastStore } from '@/store/toast'
import { getRecoveryEntries, useAutoSave } from '@/hooks/useAutoSave'
import { installWindowCloseGuard, saveAndCloseRequested } from './closeGuard'

const file = (path: string, overrides: Partial<OpenFile> = {}): OpenFile => ({
  path,
  name: path.split('/').pop()!,
  content: `saved ${path}`,
  language: 'typescript',
  isModified: false,
  aiModified: false,
  ...overrides,
})

let api: {
  writeFile: ReturnType<typeof vi.fn>
  readFile: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  reloadWindow: ReturnType<typeof vi.fn>
  onAppSaveAndClose: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  localStorage.clear()
  api = {
    writeFile: vi.fn().mockResolvedValue({ success: true }),
    readFile: vi.fn().mockRejectedValue(new Error('not needed')),
    close: vi.fn(),
    reloadWindow: vi.fn(),
    onAppSaveAndClose: vi.fn(() => () => {}),
  }
  ;(globalThis as unknown as { api: typeof api }).api = api
  useToastStore.setState({ toasts: [] })
  useEditorStore.setState({
    openFiles: [file('/w/a.ts', { content: 'edited', isModified: true }), file('/w/b.ts')],
    activeFilePath: '/w/a.ts',
    previewPath: null,
    pinnedTabs: [],
    closeRequest: null,
  })
})

const openPaths = () => useEditorStore.getState().openFiles.map((f) => f.path)

describe('saveAndCloseRequested', () => {
  it('saves the unsaved tabs of the request, then closes them', async () => {
    useEditorStore.getState().closeAllFiles()
    await saveAndCloseRequested()
    expect(api.writeFile).toHaveBeenCalledWith('/w/a.ts', 'edited')
    expect(openPaths()).toEqual([])
    expect(useEditorStore.getState().closeRequest).toBeNull()
  })

  it('keeps the tab and the question when the save fails', async () => {
    api.writeFile.mockResolvedValue({ success: false, error: 'disk full' })
    useEditorStore.getState().closeFile('/w/a.ts')
    await saveAndCloseRequested()
    expect(openPaths()).toContain('/w/a.ts')
    expect(useEditorStore.getState().openFiles[0].isModified).toBe(true)
    expect(useEditorStore.getState().closeRequest).not.toBeNull()
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['Failed to save a.ts: disk full'])
  })
})

describe('installWindowCloseGuard', () => {
  let uninstall: () => void
  beforeEach(() => {
    uninstall = installWindowCloseGuard()
  })
  afterEach(() => uninstall())

  const fireBeforeUnload = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event
  }

  it('refuses the unload while a tab has unsaved edits, so the main process asks', () => {
    expect(fireBeforeUnload().defaultPrevented).toBe(true)
    useEditorStore.getState().markSaved('/w/a.ts')
    expect(fireBeforeUnload().defaultPrevented).toBe(false)
  })

  it("forgets the recovery copies when the page unloads after Don't Save", () => {
    const { result } = renderHook(() => useAutoSave())
    act(() => result.current.scheduleAutoSave('/w/a.ts', 'edited'))
    expect(getRecoveryEntries()).toHaveLength(1)
    window.dispatchEvent(new Event('pagehide'))
    expect(getRecoveryEntries()).toEqual([])
  })

  it('on Save, saves every unsaved tab and closes the window only if all were saved', async () => {
    const onSaveAndClose = api.onAppSaveAndClose.mock.calls[0][0] as (then: 'close' | 'reload') => void

    api.writeFile.mockResolvedValueOnce({ success: false, error: 'read-only' })
    onSaveAndClose('close')
    await vi.waitFor(() => expect(api.writeFile).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(api.close).not.toHaveBeenCalled()

    onSaveAndClose('close')
    await vi.waitFor(() => expect(api.close).toHaveBeenCalledTimes(1))
    expect(api.writeFile).toHaveBeenLastCalledWith('/w/a.ts', 'edited')
    expect(useEditorStore.getState().openFiles[0].isModified).toBe(false)
  })

  it('on Save during a reload (Reload Window), saves and then reloads instead of closing', async () => {
    const onSaveAndClose = api.onAppSaveAndClose.mock.calls[0][0] as (then: 'close' | 'reload') => void
    onSaveAndClose('reload')
    // Through the main process again, so it knows this unload is a reload.
    await vi.waitFor(() => expect(api.reloadWindow).toHaveBeenCalledTimes(1))
    expect(api.writeFile).toHaveBeenCalledWith('/w/a.ts', 'edited')
    expect(api.close).not.toHaveBeenCalled()
  })

  it('removes its listeners when uninstalled', () => {
    const unsubscribe = vi.fn()
    api.onAppSaveAndClose.mockReturnValueOnce(unsubscribe)
    const uninstallSecond = installWindowCloseGuard()
    uninstallSecond()
    expect(unsubscribe).toHaveBeenCalled()
    uninstall()
    expect(fireBeforeUnload().defaultPrevented).toBe(false)
    uninstall = () => {}
  })
})
