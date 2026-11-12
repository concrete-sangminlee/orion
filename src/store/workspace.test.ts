/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_WORKSPACE_SETTINGS, useWorkspaceStore } from './workspace'

const api = {
  workspaceReadSettings: vi.fn(),
  workspaceWriteSettings: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: unknown }).api = api
  api.workspaceWriteSettings.mockResolvedValue({ success: true })
  useWorkspaceStore.setState({
    settings: { ...DEFAULT_WORKSPACE_SETTINGS },
    workspaceOverrides: {},
    isWorkspaceLevel: false,
    loadError: null,
  })
})

describe('workspace settings that could not be read', () => {
  it('keep the read error and refuse to overwrite the file', async () => {
    api.workspaceReadSettings.mockResolvedValue({ settings: null, error: 'Unexpected token / in JSON at position 4' })
    await useWorkspaceStore.getState().loadWorkspaceSettings('/proj')
    expect(useWorkspaceStore.getState().loadError).toBe('Unexpected token / in JSON at position 4')

    const edited = { ...useWorkspaceStore.getState().settings, excludePatterns: ['build'] }
    await expect(useWorkspaceStore.getState().saveWorkspaceSettings('/proj', edited)).rejects.toThrow(/could not be read/)
    expect(api.workspaceWriteSettings).not.toHaveBeenCalled()
  })

  it('treat a rejected read as unreadable too', async () => {
    api.workspaceReadSettings.mockRejectedValue(new Error("Error invoking remote method 'workspace:read-settings': Error: boom"))
    await useWorkspaceStore.getState().loadWorkspaceSettings('/proj')
    expect(useWorkspaceStore.getState().loadError).toBe('boom')
  })
})

describe('saveWorkspaceSettings', () => {
  it('rejects with the reason when the main process did not write the file', async () => {
    api.workspaceReadSettings.mockResolvedValue({ settings: null })
    await useWorkspaceStore.getState().loadWorkspaceSettings('/proj')
    api.workspaceWriteSettings.mockResolvedValue({ success: false, error: 'EACCES: permission denied' })

    const edited = { ...useWorkspaceStore.getState().settings, excludePatterns: ['build'] }
    await expect(useWorkspaceStore.getState().saveWorkspaceSettings('/proj', edited)).rejects.toThrow('EACCES: permission denied')
    expect(useWorkspaceStore.getState().isWorkspaceLevel).toBe(false)
  })

  it('writes the keys the file sets and the changed ones, not the merged defaults', async () => {
    api.workspaceReadSettings.mockResolvedValue({ settings: { tabSize: 4, 'my.tool': { on: true } } })
    await useWorkspaceStore.getState().loadWorkspaceSettings('/proj')

    const edited = { ...useWorkspaceStore.getState().settings, excludePatterns: ['build'] }
    await useWorkspaceStore.getState().saveWorkspaceSettings('/proj', edited)

    expect(api.workspaceWriteSettings).toHaveBeenCalledWith('/proj', {
      tabSize: 4,
      'my.tool': { on: true },
      excludePatterns: ['build'],
    })
    expect(useWorkspaceStore.getState()).toMatchObject({
      isWorkspaceLevel: true,
      settings: { ...DEFAULT_WORKSPACE_SETTINGS, tabSize: 4, excludePatterns: ['build'] },
    })
  })
})

describe('settings of one folder', () => {
  it('do not carry over to a folder without .orion/settings.json', async () => {
    api.workspaceReadSettings.mockResolvedValueOnce({ settings: null })
    await useWorkspaceStore.getState().loadWorkspaceSettings('/a')
    const edited = { ...useWorkspaceStore.getState().settings, excludePatterns: ['a-only'] }
    await useWorkspaceStore.getState().saveWorkspaceSettings('/a', edited)

    api.workspaceReadSettings.mockResolvedValueOnce({ settings: null })
    await useWorkspaceStore.getState().loadWorkspaceSettings('/b')
    expect(useWorkspaceStore.getState().settings).toEqual(DEFAULT_WORKSPACE_SETTINGS)
    expect(localStorage.getItem('orion-workspace-settings')).toBeNull()
  })

  it('left in localStorage by earlier versions are dropped on load', async () => {
    localStorage.setItem('orion-workspace-settings', JSON.stringify({ excludePatterns: ['leaked'] }))
    vi.resetModules()
    const fresh = await import('./workspace')
    expect(localStorage.getItem('orion-workspace-settings')).toBeNull()
    expect(fresh.useWorkspaceStore.getState().settings.excludePatterns).toEqual(DEFAULT_WORKSPACE_SETTINGS.excludePatterns)
  })
})
