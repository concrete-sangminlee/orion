import { create } from 'zustand'
import { useThemeStore } from './theme'
import { applyUserSettings, normalizeSettings, readStoredSettings, SETTINGS_STORAGE_KEYS } from './settingsPersistence'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Profile {
  id: string
  name: string
  icon: string            // emoji or icon name
  settings: Record<string, any>  // snapshot of settings from localStorage
  theme: string           // theme ID
  createdAt: string
  isDefault: boolean
}

interface ProfileStore {
  profiles: Profile[]
  activeProfileId: string
  createProfile: (name: string, icon: string) => Profile
  /** Applies the profile's settings everywhere; rejects (and stays on the current profile) when they could not be applied. */
  switchProfile: (id: string) => Promise<void>
  updateProfile: (id: string) => void
  deleteProfile: (id: string) => boolean
  renameProfile: (id: string, name: string) => void
  exportProfile: (id: string) => string | null
  importProfile: (json: string) => Profile | null
  _load: () => void
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'orion-profiles'
const ACTIVE_KEY = 'orion-active-profile'

function generateId(): string {
  return `profile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * The settings a profile carries, saved under their localStorage keys (the
 * format profiles have always been stored and exported in).
 */
const PROFILE_GROUPS = ['editor', 'terminal', 'prompts'] as const

/**
 * The effective settings, defaults included: a profile made before anything
 * was saved must still restore those defaults when switched back to.
 */
function snapshotSettings(): Record<string, any> {
  const current = readStoredSettings()
  return Object.fromEntries(PROFILE_GROUPS.map((group) => [SETTINGS_STORAGE_KEYS[group], current[group]]))
}

/**
 * Apply a snapshot everywhere, prompts included. A group the snapshot lacks
 * (older profiles saved {}) gets the defaults instead of keeping the previous
 * profile's values.
 */
function applySettings(settings: Record<string, any>): Promise<void> {
  const read = <G extends (typeof PROFILE_GROUPS)[number]>(group: G) => normalizeSettings(group, settings[SETTINGS_STORAGE_KEYS[group]])
  return applyUserSettings({ editor: read('editor'), terminal: read('terminal'), prompts: read('prompts') })
}

function persist(profiles: Profile[], activeId: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles))
    localStorage.setItem(ACTIVE_KEY, activeId)
  } catch { /* storage full, etc. */ }
}

function loadProfiles(): { profiles: Profile[]; activeProfileId: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const activeId = localStorage.getItem(ACTIVE_KEY)
    if (raw) {
      const profiles: Profile[] = JSON.parse(raw)
      return {
        profiles,
        activeProfileId: activeId || profiles.find(p => p.isDefault)?.id || profiles[0]?.id || '',
      }
    }
  } catch { /* ignore */ }

  // First run: create a default profile
  const defaultProfile: Profile = {
    id: generateId(),
    name: 'Default',
    icon: '\u2699\uFE0F',
    settings: snapshotSettings(),
    theme: useThemeStore.getState().activeThemeId,
    createdAt: new Date().toISOString(),
    isDefault: true,
  }
  persist([defaultProfile], defaultProfile.id)
  return { profiles: [defaultProfile], activeProfileId: defaultProfile.id }
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export const useProfileStore = create<ProfileStore>((set, get) => {
  const initial = loadProfiles()

  return {
    ...initial,

    /** Reload from localStorage (useful when SettingsModal opens). */
    _load: () => {
      const data = loadProfiles()
      set(data)
    },

    createProfile: (name, icon) => {
      const profile: Profile = {
        id: generateId(),
        name,
        icon,
        settings: snapshotSettings(),
        theme: useThemeStore.getState().activeThemeId,
        createdAt: new Date().toISOString(),
        isDefault: false,
      }
      const profiles = [...get().profiles, profile]
      persist(profiles, get().activeProfileId)
      set({ profiles })
      return profile
    },

    switchProfile: async (id) => {
      const profile = get().profiles.find(p => p.id === id)
      if (!profile) return
      await applySettings(profile.settings)
      // Switch theme
      useThemeStore.getState().setTheme(profile.theme)
      persist(get().profiles, id)
      set({ activeProfileId: id })
    },

    updateProfile: (id) => {
      const profiles = get().profiles.map(p =>
        p.id === id
          ? { ...p, settings: snapshotSettings(), theme: useThemeStore.getState().activeThemeId }
          : p
      )
      persist(profiles, get().activeProfileId)
      set({ profiles })
    },

    deleteProfile: (id) => {
      const profile = get().profiles.find(p => p.id === id)
      if (!profile || profile.isDefault) return false
      const profiles = get().profiles.filter(p => p.id !== id)
      const activeProfileId = get().activeProfileId === id
        ? (profiles.find(p => p.isDefault)?.id || profiles[0]?.id || '')
        : get().activeProfileId
      persist(profiles, activeProfileId)
      set({ profiles, activeProfileId })
      return true
    },

    renameProfile: (id, name) => {
      const profiles = get().profiles.map(p =>
        p.id === id ? { ...p, name } : p
      )
      persist(profiles, get().activeProfileId)
      set({ profiles })
    },

    exportProfile: (id) => {
      const profile = get().profiles.find(p => p.id === id)
      if (!profile) return null
      const exportData = {
        name: profile.name,
        icon: profile.icon,
        settings: profile.settings,
        theme: profile.theme,
        exportedAt: new Date().toISOString(),
      }
      return JSON.stringify(exportData, null, 2)
    },

    importProfile: (json) => {
      try {
        const data = JSON.parse(json)
        if (!data.name || !data.settings) return null
        const profile: Profile = {
          id: generateId(),
          name: data.name + ' (imported)',
          icon: data.icon || '\u{1F4E6}',
          settings: data.settings,
          theme: data.theme || 'github-dark',
          createdAt: new Date().toISOString(),
          isDefault: false,
        }
        const profiles = [...get().profiles, profile]
        persist(profiles, get().activeProfileId)
        set({ profiles })
        return profile
      } catch {
        return null
      }
    },
  }
})
