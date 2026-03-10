import { create } from 'zustand'
import type { TerminalSession } from '@shared/types'

interface TerminalStore {
  sessions: TerminalSession[]
  activeSessionId: string | null
  addSession: (session: TerminalSession) => void
  removeSession: (id: string) => void
  setActiveSession: (id: string) => void
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  sessions: [],
  activeSessionId: null,

  addSession: (session) =>
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: session.id,
    })),

  removeSession: (id) =>
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== id)
      return {
        sessions,
        activeSessionId:
          state.activeSessionId === id
            ? sessions[sessions.length - 1]?.id ?? null
            : state.activeSessionId,
      }
    }),

  setActiveSession: (id) => set({ activeSessionId: id }),
}))
