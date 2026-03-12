import { create } from 'zustand'

/* ── Types ──────────────────────────────────────────────── */

export type OutputLineType = 'info' | 'warn' | 'error' | 'success'

export interface OutputLine {
  id: number
  text: string
  type: OutputLineType
  timestamp: number
}

const DEFAULT_CHANNELS = ['Main', 'Git', 'AI', 'Extensions'] as const
export type DefaultChannel = (typeof DEFAULT_CHANNELS)[number]

const MAX_LINES_PER_CHANNEL = 1000

/* ── Store interface ────────────────────────────────────── */

interface OutputStore {
  channels: Map<string, OutputLine[]>
  activeChannel: string

  appendOutput: (channel: string, text: string, type?: OutputLineType) => void
  clearChannel: (channel: string) => void
  setActiveChannel: (channel: string) => void
}

/* ── Counter for stable line ids ────────────────────────── */

let lineIdCounter = 0

/* ── Store ──────────────────────────────────────────────── */

export const useOutputStore = create<OutputStore>((set) => {
  // Initialize default channels
  const initial = new Map<string, OutputLine[]>()
  for (const ch of DEFAULT_CHANNELS) {
    initial.set(ch, [])
  }

  return {
    channels: initial,
    activeChannel: 'Main',

    appendOutput: (channel, text, type = 'info') =>
      set((state) => {
        const channels = new Map(state.channels)
        const existing = channels.get(channel) ?? []

        // Split multi-line text into separate lines
        const lines = text.split('\n')
        const newLines: OutputLine[] = lines.map((line) => ({
          id: ++lineIdCounter,
          text: line,
          type,
          timestamp: Date.now(),
        }))

        // Append and enforce max limit
        const combined = [...existing, ...newLines]
        const trimmed =
          combined.length > MAX_LINES_PER_CHANNEL
            ? combined.slice(combined.length - MAX_LINES_PER_CHANNEL)
            : combined

        channels.set(channel, trimmed)
        return { channels }
      }),

    clearChannel: (channel) =>
      set((state) => {
        const channels = new Map(state.channels)
        channels.set(channel, [])
        return { channels }
      }),

    setActiveChannel: (channel) => set({ activeChannel: channel }),
  }
})
