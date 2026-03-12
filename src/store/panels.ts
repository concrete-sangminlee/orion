/**
 * Panel management store.
 * Manages panel visibility, positions, sizes, and provides
 * panel registration for extensibility.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/* ── Types ─────────────────────────────────────────────── */

export type PanelPosition = 'left' | 'right' | 'bottom' | 'floating'
export type PanelSize = 'small' | 'medium' | 'large' | 'full'

export interface PanelDefinition {
  id: string
  label: string
  icon: string
  position: PanelPosition
  defaultVisible: boolean
  priority: number
  badge?: number | string
  category?: string
  component?: string  // lazy component path
  canClose?: boolean
  canMove?: boolean
  canFloat?: boolean
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
}

export interface PanelState {
  id: string
  visible: boolean
  position: PanelPosition
  width?: number
  height?: number
  zIndex?: number
  floatingX?: number
  floatingY?: number
  collapsed?: boolean
  pinned?: boolean
}

export interface FloatingPanelConfig {
  x: number
  y: number
  width: number
  height: number
}

/* ── Store ─────────────────────────────────────────────── */

interface PanelStoreState {
  definitions: PanelDefinition[]
  states: Record<string, PanelState>
  activeLeftPanel: string | null
  activeRightPanel: string | null
  activeBottomPanel: string | null
  floatingPanels: string[]
  focusedPanel: string | null

  // Registration
  registerPanel: (def: PanelDefinition) => void
  unregisterPanel: (id: string) => void
  updateDefinition: (id: string, updates: Partial<PanelDefinition>) => void

  // Visibility
  showPanel: (id: string) => void
  hidePanel: (id: string) => void
  togglePanel: (id: string) => void
  isPanelVisible: (id: string) => boolean

  // Position
  movePanel: (id: string, position: PanelPosition) => void
  floatPanel: (id: string, config?: Partial<FloatingPanelConfig>) => void
  dockPanel: (id: string, position: PanelPosition) => void

  // Size
  setPanelSize: (id: string, width?: number, height?: number) => void

  // Focus
  focusPanel: (id: string) => void
  blurPanel: () => void

  // Active panel management
  setActivePanel: (position: PanelPosition, panelId: string | null) => void
  getActivePanel: (position: PanelPosition) => string | null

  // Badges
  setBadge: (id: string, badge: number | string | undefined) => void

  // Pin
  togglePinPanel: (id: string) => void

  // Queries
  getPanelsByPosition: (position: PanelPosition) => PanelDefinition[]
  getVisiblePanels: () => PanelDefinition[]
  getFloatingPanels: () => (PanelDefinition & PanelState)[]
  getPanelState: (id: string) => PanelState | undefined

  // Bulk operations
  hideAllPanels: (position?: PanelPosition) => void
  resetLayout: () => void
}

/* ── Default Panels ────────────────────────────────────── */

const DEFAULT_PANELS: PanelDefinition[] = [
  // Left sidebar
  { id: 'explorer', label: 'Explorer', icon: 'files', position: 'left', defaultVisible: true, priority: 1, category: 'navigation' },
  { id: 'search', label: 'Search', icon: 'search', position: 'left', defaultVisible: false, priority: 2, category: 'navigation' },
  { id: 'source-control', label: 'Source Control', icon: 'git-branch', position: 'left', defaultVisible: false, priority: 3, category: 'navigation' },
  { id: 'debug', label: 'Run and Debug', icon: 'play', position: 'left', defaultVisible: false, priority: 4, category: 'development' },
  { id: 'extensions', label: 'Extensions', icon: 'extensions', position: 'left', defaultVisible: false, priority: 5, category: 'management' },
  { id: 'testing', label: 'Testing', icon: 'beaker', position: 'left', defaultVisible: false, priority: 6, category: 'development' },
  { id: 'remote-explorer', label: 'Remote Explorer', icon: 'remote', position: 'left', defaultVisible: false, priority: 7, category: 'remote' },

  // Right sidebar
  { id: 'chat', label: 'AI Chat', icon: 'comment-discussion', position: 'right', defaultVisible: false, priority: 1, category: 'ai' },
  { id: 'composer', label: 'AI Composer', icon: 'sparkle', position: 'right', defaultVisible: false, priority: 2, category: 'ai' },
  { id: 'outline', label: 'Outline', icon: 'symbol-class', position: 'right', defaultVisible: false, priority: 3, category: 'navigation' },
  { id: 'timeline', label: 'Timeline', icon: 'history', position: 'right', defaultVisible: false, priority: 4, category: 'navigation' },

  // Bottom panel
  { id: 'terminal', label: 'Terminal', icon: 'terminal', position: 'bottom', defaultVisible: false, priority: 1, category: 'development' },
  { id: 'problems', label: 'Problems', icon: 'warning', position: 'bottom', defaultVisible: false, priority: 2, category: 'development' },
  { id: 'output', label: 'Output', icon: 'output', position: 'bottom', defaultVisible: false, priority: 3, category: 'development' },
  { id: 'debug-console', label: 'Debug Console', icon: 'debug-console', position: 'bottom', defaultVisible: false, priority: 4, category: 'development' },
  { id: 'ports', label: 'Ports', icon: 'plug', position: 'bottom', defaultVisible: false, priority: 5, category: 'remote' },
]

function getDefaultStates(): Record<string, PanelState> {
  const states: Record<string, PanelState> = {}
  for (const panel of DEFAULT_PANELS) {
    states[panel.id] = {
      id: panel.id,
      visible: panel.defaultVisible,
      position: panel.position,
    }
  }
  return states
}

/* ── Store Implementation ──────────────────────────────── */

export const usePanelStore = create<PanelStoreState>()(
  persist(
    (set, get) => ({
      definitions: DEFAULT_PANELS,
      states: getDefaultStates(),
      activeLeftPanel: 'explorer',
      activeRightPanel: null,
      activeBottomPanel: 'terminal',
      floatingPanels: [],
      focusedPanel: null,

      registerPanel: (def) => {
        set(s => {
          const existing = s.definitions.find(d => d.id === def.id)
          if (existing) return s

          return {
            definitions: [...s.definitions, def],
            states: {
              ...s.states,
              [def.id]: {
                id: def.id,
                visible: def.defaultVisible,
                position: def.position,
              },
            },
          }
        })
      },

      unregisterPanel: (id) => {
        set(s => ({
          definitions: s.definitions.filter(d => d.id !== id),
          floatingPanels: s.floatingPanels.filter(p => p !== id),
        }))
      },

      updateDefinition: (id, updates) => {
        set(s => ({
          definitions: s.definitions.map(d => d.id === id ? { ...d, ...updates } : d),
        }))
      },

      showPanel: (id) => {
        const def = get().definitions.find(d => d.id === id)
        if (!def) return

        set(s => ({
          states: {
            ...s.states,
            [id]: { ...s.states[id], id, visible: true, position: s.states[id]?.position || def.position },
          },
        }))

        // Set as active in its position
        const state = get().states[id]
        if (state && state.position !== 'floating') {
          get().setActivePanel(state.position, id)
        }
      },

      hidePanel: (id) => {
        set(s => ({
          states: {
            ...s.states,
            [id]: { ...s.states[id], id, visible: false },
          },
        }))
      },

      togglePanel: (id) => {
        const state = get().states[id]
        if (state?.visible) {
          get().hidePanel(id)
        } else {
          get().showPanel(id)
        }
      },

      isPanelVisible: (id) => {
        return get().states[id]?.visible || false
      },

      movePanel: (id, position) => {
        set(s => ({
          states: {
            ...s.states,
            [id]: { ...s.states[id], id, position },
          },
          floatingPanels: position === 'floating'
            ? [...new Set([...s.floatingPanels, id])]
            : s.floatingPanels.filter(p => p !== id),
        }))
      },

      floatPanel: (id, config) => {
        set(s => ({
          states: {
            ...s.states,
            [id]: {
              ...s.states[id],
              id,
              position: 'floating',
              floatingX: config?.x || 100,
              floatingY: config?.y || 100,
              width: config?.width || 400,
              height: config?.height || 300,
            },
          },
          floatingPanels: [...new Set([...s.floatingPanels, id])],
        }))
      },

      dockPanel: (id, position) => {
        set(s => ({
          states: {
            ...s.states,
            [id]: { ...s.states[id], id, position },
          },
          floatingPanels: s.floatingPanels.filter(p => p !== id),
        }))
      },

      setPanelSize: (id, width, height) => {
        set(s => ({
          states: {
            ...s.states,
            [id]: {
              ...s.states[id],
              id,
              ...(width !== undefined && { width }),
              ...(height !== undefined && { height }),
            },
          },
        }))
      },

      focusPanel: (id) => set({ focusedPanel: id }),
      blurPanel: () => set({ focusedPanel: null }),

      setActivePanel: (position, panelId) => {
        switch (position) {
          case 'left': set({ activeLeftPanel: panelId }); break
          case 'right': set({ activeRightPanel: panelId }); break
          case 'bottom': set({ activeBottomPanel: panelId }); break
        }
      },

      getActivePanel: (position) => {
        switch (position) {
          case 'left': return get().activeLeftPanel
          case 'right': return get().activeRightPanel
          case 'bottom': return get().activeBottomPanel
          default: return null
        }
      },

      setBadge: (id, badge) => {
        set(s => ({
          definitions: s.definitions.map(d => d.id === id ? { ...d, badge } : d),
        }))
      },

      togglePinPanel: (id) => {
        set(s => ({
          states: {
            ...s.states,
            [id]: { ...s.states[id], id, pinned: !s.states[id]?.pinned },
          },
        }))
      },

      getPanelsByPosition: (position) => {
        return get().definitions
          .filter(d => (get().states[d.id]?.position || d.position) === position)
          .sort((a, b) => a.priority - b.priority)
      },

      getVisiblePanels: () => {
        return get().definitions.filter(d => get().states[d.id]?.visible)
      },

      getFloatingPanels: () => {
        return get().floatingPanels.map(id => {
          const def = get().definitions.find(d => d.id === id)
          const state = get().states[id]
          return def && state ? { ...def, ...state } : null
        }).filter(Boolean) as (PanelDefinition & PanelState)[]
      },

      getPanelState: (id) => get().states[id],

      hideAllPanels: (position) => {
        set(s => {
          const newStates = { ...s.states }
          for (const [id, state] of Object.entries(newStates)) {
            if (!position || state.position === position) {
              newStates[id] = { ...state, visible: false }
            }
          }
          return { states: newStates }
        })
      },

      resetLayout: () => {
        set({
          states: getDefaultStates(),
          activeLeftPanel: 'explorer',
          activeRightPanel: null,
          activeBottomPanel: 'terminal',
          floatingPanels: [],
          focusedPanel: null,
        })
      },
    }),
    {
      name: 'orion-panels',
      partialize: (state) => ({
        states: state.states,
        activeLeftPanel: state.activeLeftPanel,
        activeRightPanel: state.activeRightPanel,
        activeBottomPanel: state.activeBottomPanel,
      }),
    }
  )
)
