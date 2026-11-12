/**
 * Single source of truth for the Electron IPC boundary.
 *
 * Every channel the renderer can reach is declared here exactly once:
 *
 *   - `IpcInvokeContract` — request/response channels (`ipcRenderer.invoke`
 *     ↔ `ipcMain.handle`).
 *   - `IpcSendContract`   — fire-and-forget renderer → main channels
 *     (`ipcRenderer.send` ↔ `ipcMain.on`).
 *   - `IpcEventContract`  — main → renderer push channels
 *     (`webContents.send` ↔ `ipcRenderer.on`).
 *
 * The main process registers handlers through `electron/ipc/typed-ipc.ts`,
 * the preload builds `window.api` through `electron/preload-api.ts`, and the
 * renderer's `window.api` type is derived from that preload factory. A
 * mismatch in channel name, argument order, or payload shape on any side is
 * therefore a compile error instead of a silent runtime no-op.
 *
 * Argument types describe what a well-behaved renderer sends. Handlers MUST
 * still validate them at runtime: a compromised renderer can send anything.
 *
 * This module is type-only and must stay free of runtime imports so it can be
 * shared by the main, preload, and renderer programs.
 */

import type {
  AppInfo,
  AppSettings,
  ExternalFileChange,
  FileNode,
  FileStat,
  FileWatchEvent,
  TaskCompleteData,
  TaskOutputData,
  TaskRunArgs,
  TaskRunResult,
  TaskScript,
  WorkspaceSettings,
} from './types'

export type {
  AppInfo,
  AppSettings,
  ExternalFileChange,
  FileNode,
  FileStat,
  FileWatchEvent,
  TaskCompleteData,
  TaskOutputData,
  TaskRunArgs,
  TaskRunResult,
  TaskScript,
  WorkspaceSettings,
}

// ---------------------------------------------------------------------------
// Common result envelopes
// ---------------------------------------------------------------------------

export interface OperationResult {
  success: boolean
  error?: string
}

export interface OperationResultWithPath extends OperationResult {
  newPath?: string
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

/**
 * `fs:read-file` rejects when the file cannot be read or is not text the
 * editor can save back unchanged (binary, or not UTF-8/UTF-16).
 */
export interface ReadFileResult {
  content: string
  language: string
  /** An image shown as a preview: `content` is empty and the file cannot be saved. */
  binary?: boolean
}

export interface FileSearchOptions {
  caseSensitive?: boolean
  regex?: boolean
}

export interface FileSearchMatch {
  file: string
  line: number
  content: string
}

export type FsChangeKind = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface FileWatchEventPayload {
  watchPath: string
  event: FsChangeKind
  path: string
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export type GitFileState = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'

export interface GitStatusFile {
  path: string
  state: GitFileState
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

export interface GitLogPageOptions {
  offset?: number
  limit?: number
  file?: string
  author?: string
  since?: string
  until?: string
  search?: string
}

export interface GitLogPage {
  commits: GitLogEntry[]
  hasMore: boolean
}

export interface GitBlameEntry {
  hash: string
  author: string
  date: string
  line: number
  content: string
}

export interface GitShowResult extends GitLogEntry {
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
  branch?: string
  date?: string
  author?: string
  untracked?: boolean
}

export type GitStashMode = 'all' | 'staged' | 'keep-index'

export interface GitStashSaveOptions {
  message?: string
  mode?: GitStashMode
  includeUntracked?: boolean
}

export interface GitStashApplyOptions {
  drop?: boolean
}

export interface GitStashDetails {
  stashId: string
  files: Array<{
    path: string
    status: 'modified' | 'added' | 'deleted' | 'renamed'
    insertions: number
    deletions: number
  }>
  hunks: Array<{
    header: string
    lines: Array<{
      type: 'context' | 'addition' | 'deletion' | 'header'
      content: string
      oldLineNumber?: number
      newLineNumber?: number
    }>
  }>
  rawDiff: string
}

export interface GitRebaseStatus {
  rebasing: boolean
  currentStep?: number
  totalSteps?: number
  headName?: string
}

export interface GitSequencerOptions {
  noCommit?: boolean
  mainline?: number
}

export interface GitTag {
  name: string
  hash: string
  targetHash?: string
  message: string
  tagger?: string
  taggerEmail?: string
  date: string
  isAnnotated: boolean
}

export interface GitRemote {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface GitWorktree {
  path: string
  head: string
  branch: string
  bare: boolean
}

export interface GitSubmodule {
  path: string
  hash: string
  status: 'initialized' | 'uninitialized' | 'out-of-date' | 'merge-conflict'
  describe: string
}

export interface GitCommandResult extends OperationResult {
  output?: string
}

export type GitResetMode = 'soft' | 'mixed' | 'hard'

export interface GitCleanOptions {
  directories?: boolean
  force?: boolean
  dryRun?: boolean
  ignored?: boolean
}

export interface GitCleanResult extends OperationResult {
  removedFiles: string[]
}

export type GitConfigScope = 'local' | 'global' | 'system'

export interface GitConfigGetResult extends OperationResult {
  value?: string | null
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

export interface TerminalShellOptions {
  shellPath?: string
  shellArgs?: string[]
}

// ---------------------------------------------------------------------------
// Workspace settings
// ---------------------------------------------------------------------------

export interface WorkspaceExtensionRecommendations {
  recommendations: Array<{ id: string; displayName?: string; description?: string }>
  unwantedRecommendations?: string[]
}

/**
 * Contents of `<workspace>/.orion/settings.json`: per-workspace overrides of
 * the user-level settings, plus extension recommendations.
 */
export type WorkspaceSettingsFile = Partial<WorkspaceSettings> & {
  __extensions?: WorkspaceExtensionRecommendations
}

export interface WorkspaceSettingsReadResult {
  settings: WorkspaceSettingsFile | null
  error?: string
}

// ---------------------------------------------------------------------------
// AI assistant (OMO bridge)
// ---------------------------------------------------------------------------

export interface OmoBridgeMessage {
  type: 'chat' | 'agent-command' | 'cancel'
  payload: {
    message?: string
    mode?: 'agent' | 'chat'
    model?: string
    projectPath?: string
    files?: string[]
  }
}

export interface OmoEvent {
  type:
    | 'agent-status'
    | 'agent-log'
    | 'file-edit'
    | 'chat-response'
    | 'chat-stream'
    | 'task-complete'
    | 'error'
    | 'ollama-status'
  payload: unknown
}

/** Providers whose API keys the main process stores (encrypted). */
export type ApiKeyProvider = 'anthropic' | 'openai' | 'kimi' | 'gemini' | 'nvidia' | 'custom'

/** `string` sets or replaces a key, `null` removes it; omitted providers stay as they are. */
export type ApiKeyPatch = Partial<Record<ApiKeyProvider, string | null>>

/** What the renderer may learn about stored keys: never the keys themselves. */
export interface ApiKeyStatus {
  configured: Record<ApiKeyProvider, boolean>
  /** False when the OS keychain is unavailable; keys then last for this session only. */
  encryptionAvailable: boolean
}

export interface ApiKeyUpdateResult extends OperationResult, Partial<ApiKeyStatus> {
  /** False when the keys were kept in memory only. */
  persisted?: boolean
}

/** Where inline ("ghost text") completions come from. */
export type InlineCompletionProvider = 'ollama' | 'anthropic'

export interface InlineCompletionRequest {
  provider: InlineCompletionProvider
  /** Text before the caret (the main process keeps only the part nearest to it). */
  prefix: string
  /** Text after the caret. */
  suffix: string
  language: string
  fileName: string
  maxTokens?: number
}

export interface InlineCompletionResult {
  /** Text to insert at the caret; empty when there is no suggestion. */
  text: string
  model?: string
  /** Why there is no suggestion (provider unavailable, no key, cancelled, ...). */
  reason?: string
}

export interface OmoPrompts {
  systemPrompt?: string
  userPromptTemplate?: string
}

// ---------------------------------------------------------------------------
// Channel contracts
// ---------------------------------------------------------------------------

/** Request/response channels: renderer `invoke` ↔ main `handle`. */
export interface IpcInvokeContract {
  // Filesystem
  'fs:read-file': (filePath: string) => ReadFileResult
  'fs:write-file': (filePath: string, content: string) => OperationResult
  'fs:delete': (itemPath: string) => OperationResult
  'fs:rename': (oldPath: string, newPath: string) => OperationResult
  /** Rejects when `rootPath` is not a folder that can be listed. */
  'fs:open-workspace': (rootPath: string) => FileNode[]
  /** Rejects when `dirPath` is not a listable folder inside the workspace. */
  'fs:read-dir': (dirPath: string) => FileNode[]
  'fs:open-folder': () => string | null
  /** Native multi-select file picker; the chosen files become readable/savable. */
  'fs:open-file-dialog': () => string[]
  'fs:create-file': (filePath: string, content?: string) => OperationResult
  'fs:create-dir': (dirPath: string) => OperationResult
  'fs:search': (rootPath: string, query: string, options?: FileSearchOptions) => FileSearchMatch[]
  'fs:trash': (itemPath: string) => OperationResult
  'fs:copy-path': (itemPath: string) => OperationResult
  'fs:duplicate': (srcPath: string) => OperationResultWithPath
  'fs:show-item': (itemPath: string) => OperationResult
  'fs:copy-file': (srcPath: string, destDir: string) => OperationResultWithPath

  // File operations
  'file:rename': (oldPath: string, newPath: string) => OperationResult
  'file:copy': (sourcePath: string, destPath: string) => OperationResult
  'file:move': (sourcePath: string, destPath: string) => OperationResult
  'file:stat': (filePath: string) => OperationResult & { stat?: FileStat }
  'file:exists': (filePath: string) => boolean
  'file:create-directory': (dirPath: string) => OperationResult
  'file:delete-directory': (dirPath: string) => OperationResult
  'file:watch': (watchPath: string) => OperationResult
  'file:unwatch': (watchPath: string) => OperationResult
  'file:unwatch-all': () => OperationResult
  'file:read-binary': (filePath: string) => OperationResult & { data?: string }

  // Clipboard
  'clipboard:read-text': () => OperationResult & { text?: string }
  'clipboard:write-text': (text: string) => OperationResult
  'clipboard:read-image': () => OperationResult & { data?: string | null }

  // Shell
  'shell:open-external': (url: string) => OperationResult
  'shell:show-item-in-folder': (filePath: string) => OperationResult
  'shell:open-path': (filePath: string) => OperationResult

  // Git — queries (degrade to empty results outside a repository)
  'git:status': (cwd: string) => GitStatusResult
  'git:diff': (cwd: string, filePath?: string) => string
  'git:log': (cwd: string, count?: number) => GitLogEntry[]
  'git:log-page': (cwd: string, options?: GitLogPageOptions) => GitLogPage
  'git:file-log': (cwd: string, options?: GitLogPageOptions) => GitLogPage
  'git:diff-commits': (cwd: string, commitA: string, commitB: string) => { diff: string; filesChanged: number }
  'git:blame': (cwd: string, filePath: string) => GitBlameEntry[]
  'git:show': (cwd: string, hash: string) => GitShowResult | null
  'git:branches': (cwd: string) => GitBranch[]
  'git:file-diff': (cwd: string, filePath: string) => GitDiffHunk[]
  'git:diff-file': (cwd: string, filePath: string) => GitDiffHunk[]
  'git:stash-list': (cwd: string) => GitStashEntry[]
  'git:stash-show': (cwd: string, index: number) => GitStashDetails | null
  'git:merge-status': (cwd: string) => { merging: boolean }
  'git:rebase-status': (cwd: string) => GitRebaseStatus
  'git:conflict-files': (cwd: string) => string[]
  'git:tags': (cwd: string) => GitTag[]
  'git:remotes': (cwd: string) => GitRemote[]
  'git:worktree-list': (cwd: string) => GitWorktree[]
  'git:submodule-status': (cwd: string) => GitSubmodule[]
  'git:check-ignored': (cwd: string, filePaths: string[]) => string[]
  'git:config-get': (cwd: string, key: string, scope?: GitConfigScope) => GitConfigGetResult

  // Git — mutations (reject with git's stderr when the command fails)
  'git:stage': (cwd: string, filePath: string) => boolean
  'git:unstage': (cwd: string, filePath: string) => boolean
  'git:stage-all': (cwd: string) => boolean
  'git:unstage-all': (cwd: string) => boolean
  'git:discard': (cwd: string, filePath: string) => boolean
  'git:commit': (cwd: string, message: string, amend?: boolean) => boolean
  'git:checkout': (cwd: string, branch: string) => string
  'git:create-branch': (cwd: string, branchName: string) => string
  'git:push': (cwd: string, remote?: string, branch?: string, force?: boolean) => string
  'git:pull': (cwd: string, remote?: string, branch?: string) => string
  'git:fetch': (cwd: string) => string
  'git:stash': (cwd: string) => string
  'git:stash-pop': (cwd: string, index?: number) => string
  'git:stash-drop': (cwd: string, index: number) => string
  'git:stash-apply': (cwd: string, index: number, options?: GitStashApplyOptions) => string
  'git:stash-save': (cwd: string, messageOrOptions?: string | GitStashSaveOptions) => string
  'git:stash-clear': (cwd: string) => string
  'git:stash-branch': (cwd: string, index: number, branchName: string) => string
  'git:merge': (cwd: string, branchName: string) => string
  'git:merge-abort': (cwd: string) => string
  'git:delete-branch': (cwd: string, branchName: string) => string
  'git:cherry-pick': (cwd: string, commitHash: string, options?: GitSequencerOptions) => string

  // Git — mutations reporting through a result envelope
  'git:revert': (cwd: string, commitHash: string, options?: GitSequencerOptions) => GitCommandResult
  'git:commit-amend': (cwd: string, message?: string) => GitCommandResult
  'git:reset': (cwd: string, mode: GitResetMode, ref?: string) => GitCommandResult
  'git:clean': (cwd: string, options?: GitCleanOptions) => GitCleanResult
  'git:create-tag': (cwd: string, tagName: string, message?: string, commitHash?: string, force?: boolean) => OperationResult
  'git:delete-tag': (cwd: string, tagName: string) => OperationResult
  'git:add-remote': (cwd: string, name: string, url: string) => OperationResult
  'git:remove-remote': (cwd: string, name: string) => OperationResult
  'git:config-set': (cwd: string, key: string, value: string, scope?: Exclude<GitConfigScope, 'system'>) => OperationResult

  // Terminal
  'term:create': (id: string, shellOptions?: TerminalShellOptions) => OperationResult

  // Settings
  'settings:get': () => AppSettings
  'settings:set': (settings: Partial<AppSettings>) => AppSettings

  // Workspace settings
  'workspace:read-settings': (rootPath: string) => WorkspaceSettingsReadResult
  'workspace:write-settings': (rootPath: string, settings: WorkspaceSettingsFile) => OperationResult

  // AI assistant
  'omo:start': () => void
  'omo:stop': () => void
  'omo:set-api-keys': (keys: ApiKeyPatch) => ApiKeyUpdateResult
  'omo:get-api-key-status': () => ApiKeyStatus
  'omo:set-prompts': (prompts: OmoPrompts) => OperationResult
  'ai:complete': (request: InlineCompletionRequest) => InlineCompletionResult

  // Tasks
  'task:run': (args: TaskRunArgs) => TaskRunResult
  'task:kill': (taskId: string) => OperationResult
  'task:list-scripts': (cwd: string) => TaskScript[]

  // App
  'app:get-info': () => AppInfo
}

/** Fire-and-forget channels: renderer `send` ↔ main `on`. */
export interface IpcSendContract {
  'fs:watch-start': (dirPath: string) => void
  'fs:watch-stop': () => void
  /**
   * Sent by the preload (never by page code) with the real path of something
   * the user dropped onto the window, so that one item can be opened.
   */
  'fs:grant-dropped-path': (itemPath: string) => void
  'term:write': (id: string, data: string) => void
  'term:resize': (id: string, cols: number, rows: number) => void
  'term:kill': (id: string) => void
  'omo:send': (message: OmoBridgeMessage) => void
  'win:minimize': () => void
  'win:maximize': () => void
  'win:close': () => void
}

/** Push channels: main `webContents.send` ↔ renderer `on`. */
export interface IpcEventContract {
  'fs:change': (kind: FsChangeKind, filePath: string) => void
  'fs:external-change': (change: ExternalFileChange) => void
  'file:watch-event': (event: FileWatchEventPayload) => void
  'term:data': (id: string, data: string) => void
  'omo:message': (event: OmoEvent) => void
  'task:output': (data: TaskOutputData) => void
  'task:complete': (data: TaskCompleteData) => void

  // Menu / OS integration
  'app:open-file': (filePath: string) => void
  'app:open-folder': (folderPath: string) => void
  'app:open-about': () => void
  'app:new-file': () => void
  'app:save': () => void
  'app:save-as': () => void
  'app:save-all': () => void
  'app:open-settings': () => void
  'app:find': () => void
  'app:replace': () => void
  'app:find-in-files': () => void
  'app:replace-in-files': () => void
  'app:command-palette': () => void
  'app:toggle-sidebar': (panel?: string) => void
  'app:toggle-panel': () => void
  'app:quick-open': () => void
  'app:go-to-symbol': () => void
  'app:go-to-line': () => void
  'app:go-back': () => void
  'app:go-forward': () => void
  'app:go-to-definition': () => void
  'app:peek-definition': () => void
  'app:start-debugging': () => void
  'app:run-without-debugging': () => void
  'app:stop-debugging': () => void
  'app:restart-debugging': () => void
  'app:toggle-breakpoint': () => void
  'app:run-task': () => void
  'app:run-build-task': () => void
  'app:new-terminal': () => void
  'app:split-terminal': () => void
  'app:run-active-file': () => void
  'app:run-selected-text': () => void
  'app:show-welcome': () => void
  'app:show-release-notes': () => void
  'app:show-keybindings': () => void
}

// ---------------------------------------------------------------------------
// Derived helper types
// ---------------------------------------------------------------------------

export type IpcInvokeChannel = keyof IpcInvokeContract
export type IpcInvokeArgs<C extends IpcInvokeChannel> = Parameters<IpcInvokeContract[C]>
export type IpcInvokeResult<C extends IpcInvokeChannel> = ReturnType<IpcInvokeContract[C]>

export type IpcSendChannel = keyof IpcSendContract
export type IpcSendArgs<C extends IpcSendChannel> = Parameters<IpcSendContract[C]>

export type IpcEventChannel = keyof IpcEventContract
export type IpcEventArgs<C extends IpcEventChannel> = Parameters<IpcEventContract[C]>

export type IpcChannel = IpcInvokeChannel | IpcSendChannel | IpcEventChannel
