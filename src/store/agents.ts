import { create } from 'zustand'
import type { Agent, AgentLogEntry } from '@shared/types'

interface AgentStore {
  agents: Agent[]
  logs: AgentLogEntry[]
  setAgents: (agents: Agent[]) => void
  updateAgent: (id: string, update: Partial<Agent>) => void
  addLog: (entry: AgentLogEntry) => void
  clearLogs: () => void
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: [],
  logs: [],

  setAgents: (agents) => set({ agents }),

  updateAgent: (id, update) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.id === id ? { ...a, ...update } : a)),
    })),

  addLog: (entry) =>
    set((state) => ({ logs: [...state.logs.slice(-200), entry] })),

  clearLogs: () => set({ logs: [] }),
}))
