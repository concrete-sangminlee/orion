import { create } from 'zustand'
import type { AppSettings, ModelConfig } from '@shared/types'
import { DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY } from '@shared/constants'

interface SettingsStore {
  settings: AppSettings
  setSettings: (settings: AppSettings) => void
  addModel: (model: ModelConfig) => void
  removeModel: (modelId: string) => void
  setActiveModel: (modelId: string) => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: {
    theme: 'dark',
    fontSize: DEFAULT_FONT_SIZE,
    fontFamily: DEFAULT_FONT_FAMILY,
    models: [],
    activeModelId: '',
    agentModelMapping: {},
  },

  setSettings: (settings) => set({ settings }),

  addModel: (model) =>
    set((state) => ({
      settings: { ...state.settings, models: [...state.settings.models, model] },
    })),

  removeModel: (modelId) =>
    set((state) => ({
      settings: {
        ...state.settings,
        models: state.settings.models.filter((m) => m.modelId !== modelId),
      },
    })),

  setActiveModel: (modelId) =>
    set((state) => ({
      settings: { ...state.settings, activeModelId: modelId },
    })),
}))
