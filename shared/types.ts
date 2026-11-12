// ---------------------------------------------------------------------------
// Error handling types
// ---------------------------------------------------------------------------

/** Standardized error codes for IPC and application-level errors. */
export type AppErrorCode =
  | 'FILE_NOT_FOUND'
  | 'FILE_ALREADY_EXISTS'
  | 'PERMISSION_DENIED'
  | 'DIRECTORY_NOT_EMPTY'
  | 'INVALID_PATH'
  | 'FILE_TOO_LARGE'
  | 'ENCODING_ERROR'
  | 'GIT_ERROR'
  | 'GIT_CONFLICT'
  | 'GIT_NOT_REPO'
  | 'TERMINAL_ERROR'
  | 'AI_CONNECTION_ERROR'
  | 'AI_RATE_LIMIT'
  | 'AI_INVALID_KEY'
  | 'AI_MODEL_NOT_FOUND'
  | 'SETTINGS_INVALID'
  | 'SETTINGS_MIGRATION_FAILED'
  | 'WORKSPACE_NOT_FOUND'
  | 'IPC_TIMEOUT'
  | 'UNKNOWN_ERROR'

/** Structured error returned from IPC handlers. */
export interface AppError {
  code: AppErrorCode
  message: string
  detail?: string
  /** The original error stack, if available (not sent to renderer in production). */
  stack?: string
}

/** Generic result wrapper used by IPC handlers. */
export interface IpcResult<T = void> {
  success: boolean
  data?: T
  error?: string
  errorCode?: AppErrorCode
}

// ---------------------------------------------------------------------------
// Notification types (shared between main and renderer)
// ---------------------------------------------------------------------------

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

export type NotificationSource =
  | 'system'
  | 'editor'
  | 'git'
  | 'ai'
  | 'extension'
  | 'terminal'
  | 'debug'
  | 'build'
  | 'test'

export interface NotificationAction {
  label: string
  /** Unique identifier for the action (used for IPC callback routing). */
  actionId?: string
  primary?: boolean
  icon?: string
}

export interface NotificationPayload {
  level: NotificationLevel
  source: NotificationSource
  title: string
  message?: string
  detail?: string
  actions?: NotificationAction[]
  autoHide?: boolean
  hideAfterMs?: number
  groupKey?: string
}

// ---------------------------------------------------------------------------
// Agent types
// ---------------------------------------------------------------------------
export type AgentStatus = 'active' | 'working' | 'idle' | 'error'

export interface Agent {
  id: string
  name: string
  role: string
  status: AgentStatus
  currentTask?: string
  progress?: number // 0-100
  model?: string
}

export interface AgentLogEntry {
  id: string
  agentId: string
  timestamp: number
  message: string
  type: 'info' | 'action' | 'delegation' | 'error'
}

// File types
export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflict'
}

export interface OpenFile {
  path: string
  name: string
  content: string
  language: string
  isModified: boolean
  aiModified: boolean
  isPinned?: boolean
  hasExternalChange?: boolean
  isDeletedOnDisk?: boolean
}

// Chat types
export type ChatMode = 'agent' | 'chat'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentName?: string
  model?: string
  timestamp: number
  taskProgress?: TaskProgress[]
}

export interface TaskProgress {
  name: string
  status: 'done' | 'working' | 'pending'
}

// Terminal types
export interface TerminalSession {
  id: string
  name: string
  type: 'shell' | 'agent-output'
  shellPath?: string
}

// Settings types
export interface ModelConfig {
  provider: string
  modelId: string
  apiKey: string
  temperature?: number
  maxTokens?: number
}

export interface AppSettings {
  theme: 'dark'
  fontSize: number
  fontFamily: string
  models: ModelConfig[]
  activeModelId: string
  agentModelMapping: Record<string, string>
}

// Workspace settings types
export interface WorkspaceSettings {
  excludePatterns: string[]
  searchExcludes: string[]
  autoSave: boolean
  formatOnSave: boolean
  tabSize: number
  insertSpaces: boolean
  fileAssociations: Record<string, string>
}

// OMO types
export interface OmoMessage {
  type: 'agent-status' | 'agent-log' | 'file-edit' | 'task-complete' | 'error'
  payload: unknown
}

// ---------------------------------------------------------------------------
// Git types (shared shapes used across renderer and main)
// ---------------------------------------------------------------------------

export interface GitStatusFile {
  path: string
  state: string
}

export interface GitStatusResult {
  isRepo: boolean
  branch: string
  files: GitStatusFile[]
  staged: GitStatusFile[]
  unstaged: GitStatusFile[]
  ahead: number
  behind: number
}

export interface GitLogEntry {
  fullHash: string
  hash: string
  author: string
  email: string
  date: string
  message: string
}

export interface GitBlameEntry {
  hash: string
  author: string
  date: string
  line: number
  content: string
}

export interface GitShowResult {
  fullHash: string
  hash: string
  author: string
  email: string
  date: string
  message: string
  filesChanged: { file: string; changes: string }[]
  summary: string
}

export interface GitDiffHunk {
  type: 'added' | 'modified' | 'deleted'
  startLine: number
  count: number
}

export interface GitBranch {
  name: string
  current: boolean
}

export interface GitStashEntry {
  index: number
  hash: string
  message: string
}

export interface GitMergeStatus {
  merging: boolean
}

// ---------------------------------------------------------------------------
// Theme types
// ---------------------------------------------------------------------------

export type ThemeMode = 'dark' | 'light' | 'high-contrast' | 'high-contrast-light'

export type ColorThemeId =
  | 'dark'
  | 'light'
  | 'high-contrast'
  | 'high-contrast-light'
  | 'solarized-dark'
  | 'monokai'
  | 'dracula'
  | 'nord'

export type IconThemeId = 'seti' | 'material' | 'material-icon-theme' | 'vscode-icons' | 'none'

export interface TokenColorSetting {
  scope: string | string[]
  settings: {
    foreground?: string
    background?: string
    fontStyle?: string
  }
}

// ---------------------------------------------------------------------------
// Search / file search types
// ---------------------------------------------------------------------------

export interface SearchMatch {
  file: string
  line: number
  column?: number
  content: string
  matchLength?: number
}

export interface SearchOptions {
  caseSensitive?: boolean
  regex?: boolean
  wholeWord?: boolean
  includePattern?: string
  excludePattern?: string
  maxResults?: number
}

// ---------------------------------------------------------------------------
// File stat types
// ---------------------------------------------------------------------------

export interface FileStat {
  size: number
  created: string
  modified: string
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink: boolean
}

// ---------------------------------------------------------------------------
// Task types
// ---------------------------------------------------------------------------

export interface TaskRunArgs {
  command: string
  cwd: string
  label: string
}

export interface TaskRunResult {
  taskId: string
  label: string
  command: string
}

export interface TaskOutputData {
  taskId: string
  data: string
  stream: 'stdout' | 'stderr'
}

export interface TaskCompleteData {
  taskId: string
  code: number
}

export interface TaskScript {
  name: string
  command: string
}

// ---------------------------------------------------------------------------
// File watcher types
// ---------------------------------------------------------------------------

export interface FileWatchEvent {
  watchPath: string
  event: string
  path: string
}

export type ExternalFileChangeType = 'change' | 'delete' | 'add'

export interface ExternalFileChange {
  path: string
  type: ExternalFileChangeType
}

// ---------------------------------------------------------------------------
// Dialog types
// ---------------------------------------------------------------------------

export interface MessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  title?: string
  message: string
  detail?: string
  buttons?: string[]
  defaultId?: number
  cancelId?: number
  noLink?: boolean
}

export interface MessageBoxResult {
  response: number
  checkboxChecked: boolean
}

// ---------------------------------------------------------------------------
// System info types
// ---------------------------------------------------------------------------

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  v8: string
  platform: string
  arch: string
}

export interface SystemInfo {
  platform: string
  arch: string
  osVersion: string
  totalMemory: number
  freeMemory: number
  cpus: { model: string; speed: number }[]
  uptime: number
}

export interface PlatformInfo {
  platform: string
  arch: string
  osVersion: string
}

