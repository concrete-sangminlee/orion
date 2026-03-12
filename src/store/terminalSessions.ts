import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export type ShellType = 'bash' | 'zsh' | 'powershell' | 'cmd' | 'fish' | 'sh' | 'custom'
export type SessionStatus = 'running' | 'stopped' | 'error'
export type SplitDirection = 'horizontal' | 'vertical' | null
export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface TerminalSession {
  id: string
  name: string
  shellType: ShellType
  cwd: string
  env: Record<string, string>
  pid: number | null
  status: SessionStatus
  createdAt: number
  profile: string | null
  linkedGroup: string | null
  commandHistory: string[]
  scrollbackBuffer: string[]
  tabGroupId: string | null
}

export interface TerminalPane {
  id: string
  sessionId: string | null
  splitDirection: SplitDirection
  children: string[]
  size: number // percentage 0-100
  parentId: string | null
}

export interface TerminalProfile {
  id: string
  name: string
  shell: ShellType
  args: string[]
  env: Record<string, string>
  icon: string
  color: string
  defaultCwd?: string
}

export interface TerminalTabGroup {
  id: string
  name: string
  sessionIds: string[]
  activeSessionId: string | null
}

export interface TerminalLayout {
  rootPaneId: string | null
  panes: Record<string, TerminalPane>
  tabGroups: Record<string, TerminalTabGroup>
}

export interface BackgroundTask {
  id: string
  sessionId: string
  command: string
  status: TaskStatus
  startedAt: number
  completedAt: number | null
  output: string[]
  exitCode: number | null
}

export interface LinkedGroup {
  id: string
  name: string
  sessionIds: string[]
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'terminal-session-layout'

function persistLayout(layout: TerminalLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // silently ignore quota errors
  }
}

function loadPersistedLayout(): TerminalLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return JSON.parse(raw) as TerminalLayout
    }
  } catch {
    // corrupted data – ignore
  }
  return null
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let nextId = 1
function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${nextId++}`
}

// ---------------------------------------------------------------------------
// Built-in profiles
// ---------------------------------------------------------------------------

const DEFAULT_PROFILES: TerminalProfile[] = [
  {
    id: 'profile-node',
    name: 'Node.js',
    shell: 'bash',
    args: [],
    env: { NODE_ENV: 'development' },
    icon: 'node',
    color: '#68A063',
  },
  {
    id: 'profile-python',
    name: 'Python',
    shell: 'bash',
    args: [],
    env: { VIRTUAL_ENV: '' },
    icon: 'python',
    color: '#3776AB',
  },
  {
    id: 'profile-docker',
    name: 'Docker',
    shell: 'bash',
    args: [],
    env: { DOCKER_BUILDKIT: '1' },
    icon: 'docker',
    color: '#2496ED',
  },
  {
    id: 'profile-ssh',
    name: 'SSH',
    shell: 'bash',
    args: ['-c', 'ssh'],
    env: {},
    icon: 'terminal',
    color: '#4EAA25',
  },
  {
    id: 'profile-powershell',
    name: 'PowerShell',
    shell: 'powershell',
    args: [],
    env: {},
    icon: 'powershell',
    color: '#012456',
  },
]

// ---------------------------------------------------------------------------
// Store state
// ---------------------------------------------------------------------------

const MAX_HISTORY = 100

interface TerminalSessionState {
  sessions: Record<string, TerminalSession>
  activeSessionId: string | null
  panes: Record<string, TerminalPane>
  rootPaneId: string | null
  profiles: Record<string, TerminalProfile>
  tabGroups: Record<string, TerminalTabGroup>
  backgroundTasks: Record<string, BackgroundTask>
  linkedGroups: Record<string, LinkedGroup>

  // Session actions
  createSession: (opts?: Partial<Pick<TerminalSession, 'name' | 'shellType' | 'cwd' | 'env' | 'profile'>>) => string
  closeSession: (sessionId: string) => void
  renameSession: (sessionId: string, name: string) => void
  setActiveSession: (sessionId: string) => void
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void
  setSessionCwd: (sessionId: string, cwd: string) => void
  pushCommand: (sessionId: string, command: string) => void
  setSessionEnv: (sessionId: string, key: string, value: string) => void
  removeSessionEnv: (sessionId: string, key: string) => void

  // Pane actions
  splitPane: (paneId: string, direction: 'horizontal' | 'vertical', newSessionId?: string) => string | null
  closeSplitPane: (paneId: string) => void
  resizePane: (paneId: string, size: number) => void

  // Tab group actions
  createTabGroup: (name: string) => string
  addSessionToTabGroup: (groupId: string, sessionId: string) => void
  removeSessionFromTabGroup: (groupId: string, sessionId: string) => void
  setTabGroupActiveSession: (groupId: string, sessionId: string) => void
  removeTabGroup: (groupId: string) => void

  // Profile actions
  addProfile: (profile: Omit<TerminalProfile, 'id'>) => string
  removeProfile: (profileId: string) => void
  updateProfile: (profileId: string, updates: Partial<Omit<TerminalProfile, 'id'>>) => void

  // Linking actions
  linkSessions: (groupName: string, sessionIds: string[]) => string
  unlinkSessions: (groupId: string) => void
  addToLinkedGroup: (groupId: string, sessionId: string) => void
  removeFromLinkedGroup: (groupId: string, sessionId: string) => void
  broadcastInput: (groupId: string, input: string) => string[]

  // Layout persistence
  saveLayout: () => void
  restoreLayout: () => boolean

  // Background task actions
  addBackgroundTask: (sessionId: string, command: string) => string
  updateBackgroundTask: (taskId: string, updates: Partial<Pick<BackgroundTask, 'status' | 'output' | 'exitCode'>>) => void
  cancelBackgroundTask: (taskId: string) => void
  removeBackgroundTask: (taskId: string) => void
  getSessionTasks: (sessionId: string) => BackgroundTask[]
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useTerminalSessionStore = create<TerminalSessionState>((set, get) => {
  // Seed built-in profiles
  const initialProfiles: Record<string, TerminalProfile> = {}
  for (const p of DEFAULT_PROFILES) {
    initialProfiles[p.id] = p
  }

  return {
    sessions: {},
    activeSessionId: null,
    panes: {},
    rootPaneId: null,
    profiles: initialProfiles,
    tabGroups: {},
    backgroundTasks: {},
    linkedGroups: {},

    // -----------------------------------------------------------------------
    // Session actions
    // -----------------------------------------------------------------------

    createSession(opts = {}) {
      const id = uid('sess')
      const profileId = opts.profile ?? null
      const profile = profileId ? get().profiles[profileId] : null

      const session: TerminalSession = {
        id,
        name: opts.name ?? profile?.name ?? `Terminal ${Object.keys(get().sessions).length + 1}`,
        shellType: opts.shellType ?? profile?.shell ?? 'bash',
        cwd: opts.cwd ?? profile?.defaultCwd ?? process.cwd?.() ?? '~',
        env: { ...(profile?.env ?? {}), ...(opts.env ?? {}) },
        pid: null,
        status: 'running',
        createdAt: Date.now(),
        profile: profileId,
        linkedGroup: null,
        commandHistory: [],
        scrollbackBuffer: [],
        tabGroupId: null,
      }

      set((state) => ({
        sessions: { ...state.sessions, [id]: session },
        activeSessionId: state.activeSessionId ?? id,
      }))

      return id
    },

    closeSession(sessionId) {
      set((state) => {
        const { [sessionId]: removed, ...remainingSessions } = state.sessions
        if (!removed) return state

        // Remove from any linked group
        const updatedLinkedGroups = { ...state.linkedGroups }
        if (removed.linkedGroup && updatedLinkedGroups[removed.linkedGroup]) {
          const group = { ...updatedLinkedGroups[removed.linkedGroup] }
          group.sessionIds = group.sessionIds.filter((id) => id !== sessionId)
          if (group.sessionIds.length === 0) {
            delete updatedLinkedGroups[removed.linkedGroup]
          } else {
            updatedLinkedGroups[removed.linkedGroup] = group
          }
        }

        // Remove from tab groups
        const updatedTabGroups = { ...state.tabGroups }
        if (removed.tabGroupId && updatedTabGroups[removed.tabGroupId]) {
          const tg = { ...updatedTabGroups[removed.tabGroupId] }
          tg.sessionIds = tg.sessionIds.filter((id) => id !== sessionId)
          if (tg.activeSessionId === sessionId) {
            tg.activeSessionId = tg.sessionIds[0] ?? null
          }
          updatedTabGroups[removed.tabGroupId] = tg
        }

        // Pick a new active session if needed
        const remainingIds = Object.keys(remainingSessions)
        const newActive =
          state.activeSessionId === sessionId
            ? remainingIds[0] ?? null
            : state.activeSessionId

        return {
          sessions: remainingSessions,
          activeSessionId: newActive,
          linkedGroups: updatedLinkedGroups,
          tabGroups: updatedTabGroups,
        }
      })
    },

    renameSession(sessionId, name) {
      set((state) => {
        const session = state.sessions[sessionId]
        if (!session) return state
        return {
          sessions: { ...state.sessions, [sessionId]: { ...session, name } },
        }
      })
    },

    setActiveSession(sessionId) {
      if (get().sessions[sessionId]) {
        set({ activeSessionId: sessionId })
      }
    },

    updateSessionStatus(sessionId, status) {
      set((state) => {
        const session = state.sessions[sessionId]
        if (!session) return state
        return {
          sessions: { ...state.sessions, [sessionId]: { ...session, status } },
        }
      })
    },

    setSessionCwd(sessionId, cwd) {
      set((state) => {
        const session = state.sessions[sessionId]
        if (!session) return state
        return {
          sessions: { ...state.sessions, [sessionId]: { ...session, cwd } },
        }
      })
    },

    pushCommand(sessionId, command) {
      set((state) => {
        const session = state.sessions[sessionId]
        if (!session) return state
        const history = [...session.commandHistory, command].slice(-MAX_HISTORY)
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: { ...session, commandHistory: history },
          },
        }
      })
    },

    setSessionEnv(sessionId, key, value) {
      set((state) => {
        const session = state.sessions[sessionId]
        if (!session) return state
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: { ...session, env: { ...session.env, [key]: value } },
          },
        }
      })
    },

    removeSessionEnv(sessionId, key) {
      set((state) => {
        const session = state.sessions[sessionId]
        if (!session) return state
        const { [key]: _, ...rest } = session.env
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: { ...session, env: rest },
          },
        }
      })
    },

    // -----------------------------------------------------------------------
    // Pane actions
    // -----------------------------------------------------------------------

    splitPane(paneId, direction, newSessionId) {
      const state = get()
      const existingPane = state.panes[paneId]
      if (!existingPane) return null

      // Create a new session for the new pane if none provided
      const sessionId = newSessionId ?? get().createSession()

      const newPaneId = uid('pane')
      const newPane: TerminalPane = {
        id: newPaneId,
        sessionId,
        splitDirection: null,
        children: [],
        size: 50,
        parentId: paneId,
      }

      // Transform the existing pane into a split container
      set((state) => {
        const current = state.panes[paneId]
        if (!current) return state

        // Create a child pane to hold the original session
        const originalChildId = uid('pane')
        const originalChild: TerminalPane = {
          id: originalChildId,
          sessionId: current.sessionId,
          splitDirection: null,
          children: [],
          size: 50,
          parentId: paneId,
        }

        const updatedParent: TerminalPane = {
          ...current,
          sessionId: null,
          splitDirection: direction,
          children: [originalChildId, newPaneId],
        }

        return {
          panes: {
            ...state.panes,
            [paneId]: updatedParent,
            [originalChildId]: originalChild,
            [newPaneId]: newPane,
          },
        }
      })

      return newPaneId
    },

    closeSplitPane(paneId) {
      set((state) => {
        const pane = state.panes[paneId]
        if (!pane) return state

        const updatedPanes = { ...state.panes }

        // If the pane has a parent, remove it from the parent's children
        if (pane.parentId) {
          const parent = updatedPanes[pane.parentId]
          if (parent) {
            const remainingChildren = parent.children.filter((id) => id !== paneId)
            if (remainingChildren.length === 1) {
              // Collapse: promote the remaining child into the parent's position
              const remaining = updatedPanes[remainingChildren[0]]
              if (remaining) {
                updatedPanes[pane.parentId] = {
                  ...parent,
                  sessionId: remaining.sessionId,
                  splitDirection: remaining.splitDirection,
                  children: remaining.children,
                }
                // Re-parent grandchildren
                for (const childId of remaining.children) {
                  if (updatedPanes[childId]) {
                    updatedPanes[childId] = {
                      ...updatedPanes[childId],
                      parentId: pane.parentId,
                    }
                  }
                }
                delete updatedPanes[remaining.id]
              }
            } else {
              updatedPanes[pane.parentId] = {
                ...parent,
                children: remainingChildren,
              }
            }
          }
        }

        // Recursively remove child panes
        const removeChildren = (id: string) => {
          const p = updatedPanes[id]
          if (p) {
            for (const childId of p.children) {
              removeChildren(childId)
            }
            delete updatedPanes[id]
          }
        }
        removeChildren(paneId)
        delete updatedPanes[paneId]

        // If we removed the root, clear it
        const newRoot = state.rootPaneId === paneId ? null : state.rootPaneId

        return { panes: updatedPanes, rootPaneId: newRoot }
      })
    },

    resizePane(paneId, size) {
      const clamped = Math.max(5, Math.min(95, size))
      set((state) => {
        const pane = state.panes[paneId]
        if (!pane) return state

        const updatedPanes = { ...state.panes, [paneId]: { ...pane, size: clamped } }

        // If the pane has a sibling, adjust the sibling to complement
        if (pane.parentId) {
          const parent = state.panes[pane.parentId]
          if (parent) {
            const siblingId = parent.children.find((id) => id !== paneId)
            if (siblingId && updatedPanes[siblingId]) {
              updatedPanes[siblingId] = {
                ...updatedPanes[siblingId],
                size: 100 - clamped,
              }
            }
          }
        }

        return { panes: updatedPanes }
      })
    },

    // -----------------------------------------------------------------------
    // Tab group actions
    // -----------------------------------------------------------------------

    createTabGroup(name) {
      const id = uid('tabgrp')
      const group: TerminalTabGroup = {
        id,
        name,
        sessionIds: [],
        activeSessionId: null,
      }
      set((state) => ({
        tabGroups: { ...state.tabGroups, [id]: group },
      }))
      return id
    },

    addSessionToTabGroup(groupId, sessionId) {
      set((state) => {
        const group = state.tabGroups[groupId]
        const session = state.sessions[sessionId]
        if (!group || !session) return state
        if (group.sessionIds.includes(sessionId)) return state

        return {
          tabGroups: {
            ...state.tabGroups,
            [groupId]: {
              ...group,
              sessionIds: [...group.sessionIds, sessionId],
              activeSessionId: group.activeSessionId ?? sessionId,
            },
          },
          sessions: {
            ...state.sessions,
            [sessionId]: { ...session, tabGroupId: groupId },
          },
        }
      })
    },

    removeSessionFromTabGroup(groupId, sessionId) {
      set((state) => {
        const group = state.tabGroups[groupId]
        const session = state.sessions[sessionId]
        if (!group) return state

        const newIds = group.sessionIds.filter((id) => id !== sessionId)
        const newActive =
          group.activeSessionId === sessionId ? newIds[0] ?? null : group.activeSessionId

        return {
          tabGroups: {
            ...state.tabGroups,
            [groupId]: { ...group, sessionIds: newIds, activeSessionId: newActive },
          },
          sessions: session
            ? { ...state.sessions, [sessionId]: { ...session, tabGroupId: null } }
            : state.sessions,
        }
      })
    },

    setTabGroupActiveSession(groupId, sessionId) {
      set((state) => {
        const group = state.tabGroups[groupId]
        if (!group || !group.sessionIds.includes(sessionId)) return state
        return {
          tabGroups: {
            ...state.tabGroups,
            [groupId]: { ...group, activeSessionId: sessionId },
          },
        }
      })
    },

    removeTabGroup(groupId) {
      set((state) => {
        const { [groupId]: removed, ...rest } = state.tabGroups
        if (!removed) return state

        // Clear tabGroupId from sessions
        const updatedSessions = { ...state.sessions }
        for (const sid of removed.sessionIds) {
          if (updatedSessions[sid]) {
            updatedSessions[sid] = { ...updatedSessions[sid], tabGroupId: null }
          }
        }

        return { tabGroups: rest, sessions: updatedSessions }
      })
    },

    // -----------------------------------------------------------------------
    // Profile actions
    // -----------------------------------------------------------------------

    addProfile(profile) {
      const id = uid('prof')
      const full: TerminalProfile = { ...profile, id }
      set((state) => ({
        profiles: { ...state.profiles, [id]: full },
      }))
      return id
    },

    removeProfile(profileId) {
      set((state) => {
        const { [profileId]: _, ...rest } = state.profiles
        return { profiles: rest }
      })
    },

    updateProfile(profileId, updates) {
      set((state) => {
        const existing = state.profiles[profileId]
        if (!existing) return state
        return {
          profiles: {
            ...state.profiles,
            [profileId]: { ...existing, ...updates },
          },
        }
      })
    },

    // -----------------------------------------------------------------------
    // Linking actions
    // -----------------------------------------------------------------------

    linkSessions(groupName, sessionIds) {
      const id = uid('link')
      const group: LinkedGroup = { id, name: groupName, sessionIds: [...sessionIds] }

      set((state) => {
        const updatedSessions = { ...state.sessions }
        for (const sid of sessionIds) {
          if (updatedSessions[sid]) {
            updatedSessions[sid] = { ...updatedSessions[sid], linkedGroup: id }
          }
        }
        return {
          linkedGroups: { ...state.linkedGroups, [id]: group },
          sessions: updatedSessions,
        }
      })

      return id
    },

    unlinkSessions(groupId) {
      set((state) => {
        const group = state.linkedGroups[groupId]
        if (!group) return state

        const updatedSessions = { ...state.sessions }
        for (const sid of group.sessionIds) {
          if (updatedSessions[sid]) {
            updatedSessions[sid] = { ...updatedSessions[sid], linkedGroup: null }
          }
        }

        const { [groupId]: _, ...rest } = state.linkedGroups
        return { linkedGroups: rest, sessions: updatedSessions }
      })
    },

    addToLinkedGroup(groupId, sessionId) {
      set((state) => {
        const group = state.linkedGroups[groupId]
        const session = state.sessions[sessionId]
        if (!group || !session) return state
        if (group.sessionIds.includes(sessionId)) return state

        return {
          linkedGroups: {
            ...state.linkedGroups,
            [groupId]: { ...group, sessionIds: [...group.sessionIds, sessionId] },
          },
          sessions: {
            ...state.sessions,
            [sessionId]: { ...session, linkedGroup: groupId },
          },
        }
      })
    },

    removeFromLinkedGroup(groupId, sessionId) {
      set((state) => {
        const group = state.linkedGroups[groupId]
        const session = state.sessions[sessionId]
        if (!group) return state

        const newIds = group.sessionIds.filter((id) => id !== sessionId)
        const updatedLinked = { ...state.linkedGroups }
        if (newIds.length === 0) {
          delete updatedLinked[groupId]
        } else {
          updatedLinked[groupId] = { ...group, sessionIds: newIds }
        }

        return {
          linkedGroups: updatedLinked,
          sessions: session
            ? { ...state.sessions, [sessionId]: { ...session, linkedGroup: null } }
            : state.sessions,
        }
      })
    },

    broadcastInput(groupId, input) {
      const state = get()
      const group = state.linkedGroups[groupId]
      if (!group) return []

      // Push the command to every linked session's history
      for (const sid of group.sessionIds) {
        get().pushCommand(sid, input)
      }

      // Return the list of session IDs that received the broadcast
      return [...group.sessionIds]
    },

    // -----------------------------------------------------------------------
    // Layout persistence
    // -----------------------------------------------------------------------

    saveLayout() {
      const state = get()
      const layout: TerminalLayout = {
        rootPaneId: state.rootPaneId,
        panes: state.panes,
        tabGroups: state.tabGroups,
      }
      persistLayout(layout)
    },

    restoreLayout() {
      const layout = loadPersistedLayout()
      if (!layout) return false

      set({
        rootPaneId: layout.rootPaneId,
        panes: layout.panes,
        tabGroups: layout.tabGroups,
      })
      return true
    },

    // -----------------------------------------------------------------------
    // Background task actions
    // -----------------------------------------------------------------------

    addBackgroundTask(sessionId, command) {
      const id = uid('task')
      const task: BackgroundTask = {
        id,
        sessionId,
        command,
        status: 'running',
        startedAt: Date.now(),
        completedAt: null,
        output: [],
        exitCode: null,
      }
      set((state) => ({
        backgroundTasks: { ...state.backgroundTasks, [id]: task },
      }))
      return id
    },

    updateBackgroundTask(taskId, updates) {
      set((state) => {
        const task = state.backgroundTasks[taskId]
        if (!task) return state

        const merged: BackgroundTask = { ...task }
        if (updates.status !== undefined) merged.status = updates.status
        if (updates.output !== undefined) merged.output = updates.output
        if (updates.exitCode !== undefined) merged.exitCode = updates.exitCode
        if (updates.status === 'completed' || updates.status === 'failed') {
          merged.completedAt = Date.now()
        }

        return {
          backgroundTasks: { ...state.backgroundTasks, [taskId]: merged },
        }
      })
    },

    cancelBackgroundTask(taskId) {
      set((state) => {
        const task = state.backgroundTasks[taskId]
        if (!task || task.status !== 'running') return state
        return {
          backgroundTasks: {
            ...state.backgroundTasks,
            [taskId]: { ...task, status: 'cancelled', completedAt: Date.now() },
          },
        }
      })
    },

    removeBackgroundTask(taskId) {
      set((state) => {
        const { [taskId]: _, ...rest } = state.backgroundTasks
        return { backgroundTasks: rest }
      })
    },

    getSessionTasks(sessionId) {
      return Object.values(get().backgroundTasks).filter(
        (task) => task.sessionId === sessionId
      )
    },
  }
})
