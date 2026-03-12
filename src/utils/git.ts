/**
 * Git utility helpers for the renderer process.
 * Wraps IPC calls with proper error handling and caching.
 */

import { LRUCache } from './performance'

/* ── Types ─────────────────────────────────────────────── */

export interface GitStatus {
  branch: string
  upstream?: string
  ahead: number
  behind: number
  staged: GitFileChange[]
  unstaged: GitFileChange[]
  untracked: string[]
  conflicted: string[]
  stashCount: number
  isRebasing: boolean
  isMerging: boolean
  isBisecting: boolean
}

export interface GitFileChange {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied'
  oldPath?: string
  additions?: number
  deletions?: number
}

export interface GitLogEntry {
  hash: string
  shortHash: string
  message: string
  author: string
  email: string
  date: string
  refs: string[]
}

export interface GitBlameEntry {
  hash: string
  author: string
  date: string
  line: number
  content: string
}

export interface GitDiffStat {
  file: string
  additions: number
  deletions: number
  binary: boolean
}

/* ── Cache ─────────────────────────────────────────────── */

const blameCache = new LRUCache<string, GitBlameEntry[]>(32, 30000) // 30s TTL
const diffStatCache = new LRUCache<string, GitDiffStat[]>(16, 10000)

/* ── API Helpers ───────────────────────────────────────── */

const api = () => (window as any).api

/** Get current git status for a repo */
export async function getGitStatus(rootPath: string): Promise<GitStatus | null> {
  try {
    const result = await api()?.gitStatus?.(rootPath)
    return result || null
  } catch {
    return null
  }
}

/** Get git log entries */
export async function getGitLog(rootPath: string, count = 50, branch?: string): Promise<GitLogEntry[]> {
  try {
    const result = await api()?.gitLog?.(rootPath, count, branch)
    return result || []
  } catch {
    return []
  }
}

/** Get blame for a file */
export async function getGitBlame(rootPath: string, filePath: string): Promise<GitBlameEntry[]> {
  const cacheKey = `${rootPath}:${filePath}`
  const cached = blameCache.get(cacheKey)
  if (cached) return cached

  try {
    const result = await api()?.gitBlame?.(rootPath, filePath)
    if (result) blameCache.set(cacheKey, result)
    return result || []
  } catch {
    return []
  }
}

/** Get diff stats for staged/unstaged changes */
export async function getGitDiffStats(rootPath: string, staged = false): Promise<GitDiffStat[]> {
  const cacheKey = `${rootPath}:${staged ? 'staged' : 'unstaged'}`
  const cached = diffStatCache.get(cacheKey)
  if (cached) return cached

  try {
    const result = await api()?.gitDiffStat?.(rootPath, staged)
    if (result) diffStatCache.set(cacheKey, result)
    return result || []
  } catch {
    return []
  }
}

/** Stage specific files */
export async function gitStageFiles(rootPath: string, files: string[]): Promise<boolean> {
  try {
    await api()?.gitStage?.(rootPath, files)
    return true
  } catch {
    return false
  }
}

/** Unstage specific files */
export async function gitUnstageFiles(rootPath: string, files: string[]): Promise<boolean> {
  try {
    await api()?.gitUnstage?.(rootPath, files)
    return true
  } catch {
    return false
  }
}

/** Commit staged changes */
export async function gitCommit(rootPath: string, message: string, amend = false): Promise<boolean> {
  try {
    await api()?.gitCommit?.(rootPath, message, amend)
    return true
  } catch {
    return false
  }
}

/** Push to remote */
export async function gitPush(rootPath: string, remote = 'origin', branch?: string, force = false): Promise<boolean> {
  try {
    await api()?.gitPush?.(rootPath, remote, branch, force)
    return true
  } catch {
    return false
  }
}

/** Pull from remote */
export async function gitPull(rootPath: string, remote = 'origin', branch?: string): Promise<boolean> {
  try {
    await api()?.gitPull?.(rootPath, remote, branch)
    return true
  } catch {
    return false
  }
}

/** Create a new branch */
export async function gitCreateBranch(rootPath: string, name: string, checkout = true): Promise<boolean> {
  try {
    await api()?.gitCreateBranch?.(rootPath, name, checkout)
    return true
  } catch {
    return false
  }
}

/** Switch to a branch */
export async function gitCheckout(rootPath: string, branch: string): Promise<boolean> {
  try {
    await api()?.gitCheckout?.(rootPath, branch)
    return true
  } catch {
    return false
  }
}

/** List branches */
export async function gitListBranches(rootPath: string): Promise<{ local: string[]; remote: string[]; current: string }> {
  try {
    const result = await api()?.gitBranches?.(rootPath)
    return result || { local: [], remote: [], current: '' }
  } catch {
    return { local: [], remote: [], current: '' }
  }
}

/** Stash changes */
export async function gitStash(rootPath: string, message?: string): Promise<boolean> {
  try {
    if (message) {
      await api()?.gitStashSave?.(rootPath, message)
    } else {
      await api()?.gitStash?.(rootPath)
    }
    return true
  } catch {
    return false
  }
}

/** Pop the latest stash */
export async function gitStashPop(rootPath: string, index = 0): Promise<boolean> {
  try {
    await api()?.gitStashPop?.(rootPath, index)
    return true
  } catch {
    return false
  }
}

/** Check if a path is inside a git repository */
export async function isGitRepo(path: string): Promise<boolean> {
  try {
    const result = await api()?.gitStatus?.(path)
    return !!result
  } catch {
    return false
  }
}

/** Invalidate all caches */
export function clearGitCaches(): void {
  blameCache.clear()
  diffStatCache.clear()
}
