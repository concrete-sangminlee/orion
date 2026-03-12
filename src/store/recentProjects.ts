/**
 * Recent projects and workspaces store.
 * Tracks opened projects, pinned workspaces, workspace sessions,
 * and provides quick-switch functionality.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/* ── Types ─────────────────────────────────────────────── */

export interface RecentProject {
  path: string
  name: string
  lastOpened: number
  openCount: number
  pinned: boolean
  tags: string[]
  icon?: string
  gitBranch?: string
  gitRemote?: string
  description?: string
  framework?: string
  language?: string
}

export interface WorkspaceSession {
  projectPath: string
  openFiles: string[]
  activeFile?: string
  sidebarWidth?: number
  bottomPanelHeight?: number
  activeSidePanel?: string
  cursorPositions?: Record<string, { line: number; column: number }>
  scrollPositions?: Record<string, number>
  timestamp: number
}

export type ProjectSortBy = 'recent' | 'name' | 'frequency' | 'pinned'
export type ProjectFilter = 'all' | 'pinned' | 'git' | 'tagged'

/* ── Store ─────────────────────────────────────────────── */

interface RecentProjectsState {
  projects: RecentProject[]
  sessions: Map<string, WorkspaceSession>
  maxProjects: number
  maxSessions: number
  sortBy: ProjectSortBy
  filter: ProjectFilter
  searchQuery: string

  // Project management
  addProject: (path: string, meta?: Partial<RecentProject>) => void
  removeProject: (path: string) => void
  pinProject: (path: string) => void
  unpinProject: (path: string) => void
  togglePin: (path: string) => void
  tagProject: (path: string, tags: string[]) => void
  updateProject: (path: string, updates: Partial<RecentProject>) => void
  clearUnpinned: () => void
  clearAll: () => void

  // Session management
  saveSession: (projectPath: string, session: Omit<WorkspaceSession, 'projectPath' | 'timestamp'>) => void
  getSession: (projectPath: string) => WorkspaceSession | undefined
  clearSession: (projectPath: string) => void
  clearAllSessions: () => void

  // Queries
  getFilteredProjects: () => RecentProject[]
  getSortedProjects: () => RecentProject[]
  getProjectByPath: (path: string) => RecentProject | undefined
  getAllTags: () => string[]
  getProjectsByTag: (tag: string) => RecentProject[]
  getMostFrequent: (limit?: number) => RecentProject[]

  // Settings
  setSortBy: (sort: ProjectSortBy) => void
  setFilter: (filter: ProjectFilter) => void
  setSearchQuery: (query: string) => void
  setMaxProjects: (max: number) => void
}

/* ── Helpers ───────────────────────────────────────────── */

function getProjectName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path
}

function detectFramework(path: string, name: string): string | undefined {
  const lower = name.toLowerCase()
  if (lower.includes('next')) return 'Next.js'
  if (lower.includes('nuxt')) return 'Nuxt'
  if (lower.includes('react')) return 'React'
  if (lower.includes('vue')) return 'Vue'
  if (lower.includes('angular')) return 'Angular'
  if (lower.includes('svelte')) return 'Svelte'
  if (lower.includes('express')) return 'Express'
  if (lower.includes('fastapi')) return 'FastAPI'
  if (lower.includes('django')) return 'Django'
  if (lower.includes('flask')) return 'Flask'
  if (lower.includes('electron')) return 'Electron'
  return undefined
}

/* ── Store Implementation ──────────────────────────────── */

export const useRecentProjectsStore = create<RecentProjectsState>()(
  persist(
    (set, get) => ({
      projects: [],
      sessions: new Map(),
      maxProjects: 50,
      maxSessions: 20,
      sortBy: 'recent' as ProjectSortBy,
      filter: 'all' as ProjectFilter,
      searchQuery: '',

      addProject: (path, meta = {}) => {
        set(s => {
          const existing = s.projects.find(p => p.path === path)
          if (existing) {
            return {
              projects: s.projects.map(p =>
                p.path === path
                  ? {
                      ...p,
                      lastOpened: Date.now(),
                      openCount: p.openCount + 1,
                      gitBranch: meta.gitBranch || p.gitBranch,
                      gitRemote: meta.gitRemote || p.gitRemote,
                      ...meta,
                    }
                  : p
              ),
            }
          }

          const name = meta.name || getProjectName(path)
          const project: RecentProject = {
            path,
            name,
            lastOpened: Date.now(),
            openCount: 1,
            pinned: false,
            tags: [],
            framework: meta.framework || detectFramework(path, name),
            ...meta,
          }

          let projects = [project, ...s.projects]

          // Trim to max (keep pinned)
          if (projects.length > s.maxProjects) {
            const pinned = projects.filter(p => p.pinned)
            const unpinned = projects.filter(p => !p.pinned)
            projects = [...pinned, ...unpinned.slice(0, s.maxProjects - pinned.length)]
          }

          return { projects }
        })
      },

      removeProject: (path) => {
        set(s => ({
          projects: s.projects.filter(p => p.path !== path),
        }))
      },

      pinProject: (path) => {
        set(s => ({
          projects: s.projects.map(p => p.path === path ? { ...p, pinned: true } : p),
        }))
      },

      unpinProject: (path) => {
        set(s => ({
          projects: s.projects.map(p => p.path === path ? { ...p, pinned: false } : p),
        }))
      },

      togglePin: (path) => {
        const project = get().getProjectByPath(path)
        if (project?.pinned) {
          get().unpinProject(path)
        } else {
          get().pinProject(path)
        }
      },

      tagProject: (path, tags) => {
        set(s => ({
          projects: s.projects.map(p => p.path === path ? { ...p, tags } : p),
        }))
      },

      updateProject: (path, updates) => {
        set(s => ({
          projects: s.projects.map(p => p.path === path ? { ...p, ...updates } : p),
        }))
      },

      clearUnpinned: () => {
        set(s => ({ projects: s.projects.filter(p => p.pinned) }))
      },

      clearAll: () => set({ projects: [] }),

      // Session management
      saveSession: (projectPath, session) => {
        set(s => {
          const sessions = new Map(s.sessions)
          sessions.set(projectPath, {
            ...session,
            projectPath,
            timestamp: Date.now(),
          })

          // Trim old sessions
          if (sessions.size > s.maxSessions) {
            const sorted = [...sessions.entries()].sort(
              (a, b) => b[1].timestamp - a[1].timestamp
            )
            const trimmed = new Map(sorted.slice(0, s.maxSessions))
            return { sessions: trimmed }
          }

          return { sessions }
        })
      },

      getSession: (projectPath) => {
        return get().sessions.get(projectPath)
      },

      clearSession: (projectPath) => {
        set(s => {
          const sessions = new Map(s.sessions)
          sessions.delete(projectPath)
          return { sessions }
        })
      },

      clearAllSessions: () => set({ sessions: new Map() }),

      // Queries
      getFilteredProjects: () => {
        const { projects, filter, searchQuery } = get()
        let filtered = projects

        switch (filter) {
          case 'pinned':
            filtered = filtered.filter(p => p.pinned)
            break
          case 'git':
            filtered = filtered.filter(p => p.gitRemote)
            break
          case 'tagged':
            filtered = filtered.filter(p => p.tags.length > 0)
            break
        }

        if (searchQuery) {
          const q = searchQuery.toLowerCase()
          filtered = filtered.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.path.toLowerCase().includes(q) ||
            p.tags.some(t => t.toLowerCase().includes(q)) ||
            (p.framework || '').toLowerCase().includes(q)
          )
        }

        return filtered
      },

      getSortedProjects: () => {
        const filtered = get().getFilteredProjects()
        const { sortBy } = get()

        return [...filtered].sort((a, b) => {
          // Pinned always first
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1

          switch (sortBy) {
            case 'recent': return b.lastOpened - a.lastOpened
            case 'name': return a.name.localeCompare(b.name)
            case 'frequency': return b.openCount - a.openCount
            case 'pinned': return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.lastOpened - a.lastOpened
            default: return 0
          }
        })
      },

      getProjectByPath: (path) => {
        return get().projects.find(p => p.path === path)
      },

      getAllTags: () => {
        const tags = new Set<string>()
        get().projects.forEach(p => p.tags.forEach(t => tags.add(t)))
        return [...tags].sort()
      },

      getProjectsByTag: (tag) => {
        return get().projects.filter(p => p.tags.includes(tag))
      },

      getMostFrequent: (limit = 5) => {
        return [...get().projects]
          .sort((a, b) => b.openCount - a.openCount)
          .slice(0, limit)
      },

      // Settings
      setSortBy: (sort) => set({ sortBy: sort }),
      setFilter: (filter) => set({ filter }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setMaxProjects: (max) => set({ maxProjects: max }),
    }),
    {
      name: 'orion-recent-projects',
      partialize: (state) => ({
        projects: state.projects,
        sessions: Object.fromEntries(state.sessions),
        maxProjects: state.maxProjects,
        sortBy: state.sortBy,
      }),
      merge: (persisted: any, current) => ({
        ...current,
        ...(persisted as any),
        sessions: new Map(Object.entries((persisted as any)?.sessions || {})),
      }),
    }
  )
)
