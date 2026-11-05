/**
 * Builds the `window.api` object exposed by the preload script.
 *
 * Kept free of `electron` imports so that:
 *  - the renderer can derive `window.api`'s type from `ElectronAPI` without
 *    pulling Electron/Node typings into the DOM program, and
 *  - unit tests can drive it with a fake `ipcRenderer` and assert exactly
 *    which channel and argument list each method forwards.
 *
 * Every call goes through `invoke` / `send` / `subscribe`, which are typed
 * against `shared/ipc-contract.ts`.
 */

import type {
  GitCleanOptions,
  GitConfigScope,
  GitLogPageOptions,
  GitResetMode,
  GitSequencerOptions,
  GitStashApplyOptions,
  GitStashSaveOptions,
  IpcEventArgs,
  IpcEventChannel,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult,
  IpcSendArgs,
  IpcSendChannel,
  FileSearchOptions,
  OmoBridgeMessage,
  OmoPrompts,
  ApiKeyPatch,
  TaskRunArgs,
  TerminalShellOptions,
  AppSettings,
  WorkspaceSettingsFile,
} from '../shared/ipc-contract'

type IpcListener = (event: unknown, ...args: unknown[]) => void

/** The subset of Electron's `ipcRenderer` the API needs. */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  send(channel: string, ...args: unknown[]): void
  on(channel: string, listener: IpcListener): unknown
  removeListener(channel: string, listener: IpcListener): unknown
}

export type Unsubscribe = () => void

export interface GitCreateTagOptions {
  message?: string
  hash?: string
  force?: boolean
}

export function createElectronApi(ipc: IpcRendererLike) {
  const invoke = <C extends IpcInvokeChannel>(channel: C, ...args: IpcInvokeArgs<C>) =>
    ipc.invoke(channel, ...args) as Promise<Awaited<IpcInvokeResult<C>>>

  const send = <C extends IpcSendChannel>(channel: C, ...args: IpcSendArgs<C>): void => {
    ipc.send(channel, ...args)
  }

  const subscribe = <C extends IpcEventChannel>(
    channel: C,
    callback: (...args: IpcEventArgs<C>) => void,
  ): Unsubscribe => {
    const listener: IpcListener = (_event, ...args) => callback(...(args as IpcEventArgs<C>))
    ipc.on(channel, listener)
    return () => {
      ipc.removeListener(channel, listener)
    }
  }

  /** Subscribe helper for argument-less menu events. */
  const onSignal = (channel: Extract<IpcEventChannel, `app:${string}`>) => (callback: () => void): Unsubscribe =>
    subscribe(channel, () => callback())

  return {
    // =====================================================================
    // Filesystem (electron/ipc/filesystem.ts)
    // =====================================================================
    readFile: (filePath: string) => invoke('fs:read-file', filePath),
    writeFile: (filePath: string, content: string) => invoke('fs:write-file', filePath, content),
    saveFile: (filePath: string, content: string) => invoke('fs:write-file', filePath, content),
    deleteFile: (filePath: string) => invoke('fs:delete', filePath),
    renameFile: (oldPath: string, newPath: string) => invoke('fs:rename', oldPath, newPath),
    openWorkspace: (rootPath: string) => invoke('fs:open-workspace', rootPath),
    readDir: (dirPath: string) => invoke('fs:read-dir', dirPath),
    openFolder: () => invoke('fs:open-folder'),
    openFileDialog: () => invoke('fs:open-file-dialog'),
    createFile: (filePath: string, content = '') => invoke('fs:create-file', filePath, content),
    createDir: (dirPath: string) => invoke('fs:create-dir', dirPath),
    searchFiles: (rootPath: string, query: string, options?: FileSearchOptions) =>
      invoke('fs:search', rootPath, query, options),
    trashItem: (filePath: string) => invoke('fs:trash', filePath),
    copyPathToClipboard: (filePath: string) => invoke('fs:copy-path', filePath),
    duplicateFile: (filePath: string) => invoke('fs:duplicate', filePath),
    showItemInFolder: (filePath: string) => invoke('fs:show-item', filePath),
    copyFile: (srcPath: string, destDir: string) => invoke('fs:copy-file', srcPath, destDir),

    watchStart: (dirPath: string) => send('fs:watch-start', dirPath),
    watchStop: () => send('fs:watch-stop'),
    onFsChange: (callback: (...args: IpcEventArgs<'fs:change'>) => void) => subscribe('fs:change', callback),
    onExternalFileChange: (callback: (...args: IpcEventArgs<'fs:external-change'>) => void) =>
      subscribe('fs:external-change', callback),

    // =====================================================================
    // File operations (electron/ipc/file-operations.ts)
    // =====================================================================
    fileRename: (oldPath: string, newPath: string) => invoke('file:rename', oldPath, newPath),
    fileCopy: (sourcePath: string, destPath: string) => invoke('file:copy', sourcePath, destPath),
    fileMove: (sourcePath: string, destPath: string) => invoke('file:move', sourcePath, destPath),
    fileStat: (filePath: string) => invoke('file:stat', filePath),
    fileExists: (filePath: string) => invoke('file:exists', filePath),
    fileCreateDirectory: (dirPath: string) => invoke('file:create-directory', dirPath),
    fileDeleteDirectory: (dirPath: string) => invoke('file:delete-directory', dirPath),
    fileWatch: (watchPath: string) => invoke('file:watch', watchPath),
    fileUnwatch: (watchPath: string) => invoke('file:unwatch', watchPath),
    fileUnwatchAll: () => invoke('file:unwatch-all'),
    onFileWatchEvent: (callback: (...args: IpcEventArgs<'file:watch-event'>) => void) =>
      subscribe('file:watch-event', callback),
    fileReadBinary: (filePath: string) => invoke('file:read-binary', filePath),

    // =====================================================================
    // Clipboard (electron/ipc/clipboard.ts)
    // =====================================================================
    clipboardReadText: () => invoke('clipboard:read-text'),
    clipboardWriteText: (text: string) => invoke('clipboard:write-text', text),
    clipboardReadImage: () => invoke('clipboard:read-image'),

    // =====================================================================
    // Shell (electron/ipc/shell.ts)
    // =====================================================================
    shellOpenExternal: (url: string) => invoke('shell:open-external', url),
    shellShowItemInFolder: (filePath: string) => invoke('shell:show-item-in-folder', filePath),
    shellOpenPath: (filePath: string) => invoke('shell:open-path', filePath),

    // =====================================================================
    // Git (electron/ipc/git.ts)
    // =====================================================================
    gitStatus: (cwd: string) => invoke('git:status', cwd),
    gitLog: (cwd: string, count?: number) => invoke('git:log', cwd, count),
    gitLogPage: (cwd: string, options?: GitLogPageOptions) => invoke('git:log-page', cwd, options),
    gitFileLog: (cwd: string, options?: GitLogPageOptions) => invoke('git:file-log', cwd, options),
    gitDiffCommits: (cwd: string, commitA: string, commitB: string) =>
      invoke('git:diff-commits', cwd, commitA, commitB),
    gitDiff: (cwd: string, filePath?: string) => invoke('git:diff', cwd, filePath),
    gitStage: (cwd: string, filePath: string) => invoke('git:stage', cwd, filePath),
    gitUnstage: (cwd: string, filePath: string) => invoke('git:unstage', cwd, filePath),
    gitCommit: (cwd: string, message: string, amend = false) => invoke('git:commit', cwd, message, amend),
    gitCommitAmend: (cwd: string, message?: string) => invoke('git:commit-amend', cwd, message),
    gitDiscard: (cwd: string, filePath: string) => invoke('git:discard', cwd, filePath),
    gitBranches: (cwd: string) => invoke('git:branches', cwd),
    gitCheckout: (cwd: string, branch: string) => invoke('git:checkout', cwd, branch),
    gitShow: (cwd: string, hash: string) => invoke('git:show', cwd, hash),
    gitBlame: (cwd: string, filePath: string) => invoke('git:blame', cwd, filePath),
    gitFileDiff: (cwd: string, filePath: string) => invoke('git:file-diff', cwd, filePath),
    gitDiffFile: (cwd: string, filePath: string) => invoke('git:diff-file', cwd, filePath),
    gitPush: (cwd: string, remote = 'origin', branch?: string, force = false) =>
      invoke('git:push', cwd, remote, branch, force),
    gitPull: (cwd: string, remote = 'origin', branch?: string) => invoke('git:pull', cwd, remote, branch),
    gitFetch: (cwd: string) => invoke('git:fetch', cwd),
    gitStash: (cwd: string) => invoke('git:stash', cwd),
    gitStashPop: (cwd: string, index?: number) => invoke('git:stash-pop', cwd, index),
    gitStashList: (cwd: string) => invoke('git:stash-list', cwd),
    gitStashDrop: (cwd: string, index: number) => invoke('git:stash-drop', cwd, index),
    gitStashApply: (cwd: string, index: number, options?: GitStashApplyOptions) =>
      invoke('git:stash-apply', cwd, index, options),
    gitStashSave: (cwd: string, messageOrOptions?: string | GitStashSaveOptions) =>
      invoke('git:stash-save', cwd, messageOrOptions),
    gitStashClear: (cwd: string) => invoke('git:stash-clear', cwd),
    gitStashShow: (cwd: string, index: number) => invoke('git:stash-show', cwd, index),
    gitStashBranch: (cwd: string, index: number, branchName: string) =>
      invoke('git:stash-branch', cwd, index, branchName),
    gitMergeStatus: (cwd: string) => invoke('git:merge-status', cwd),
    gitRebaseStatus: (cwd: string) => invoke('git:rebase-status', cwd),
    gitConflictFiles: (cwd: string) => invoke('git:conflict-files', cwd),
    gitMergeAbort: (cwd: string) => invoke('git:merge-abort', cwd),
    gitMerge: (cwd: string, branchName: string) => invoke('git:merge', cwd, branchName),
    gitDeleteBranch: (cwd: string, branchName: string) => invoke('git:delete-branch', cwd, branchName),
    gitCherryPick: (cwd: string, commitHash: string, options?: GitSequencerOptions) =>
      invoke('git:cherry-pick', cwd, commitHash, options),
    gitRevert: (cwd: string, commitHash: string, options?: GitSequencerOptions) =>
      invoke('git:revert', cwd, commitHash, options),
    gitReset: (cwd: string, mode: GitResetMode, ref?: string) => invoke('git:reset', cwd, mode, ref),
    gitClean: (cwd: string, options?: GitCleanOptions) => invoke('git:clean', cwd, options),
    gitTags: (cwd: string) => invoke('git:tags', cwd),
    gitCreateTag: (cwd: string, name: string, options?: GitCreateTagOptions) =>
      invoke('git:create-tag', cwd, name, options?.message, options?.hash, options?.force),
    gitDeleteTag: (cwd: string, name: string) => invoke('git:delete-tag', cwd, name),
    gitCreateBranch: (cwd: string, branchName: string) => invoke('git:create-branch', cwd, branchName),
    gitStageAll: (cwd: string) => invoke('git:stage-all', cwd),
    gitUnstageAll: (cwd: string) => invoke('git:unstage-all', cwd),
    gitRemotes: (cwd: string) => invoke('git:remotes', cwd),
    gitAddRemote: (cwd: string, name: string, url: string) => invoke('git:add-remote', cwd, name, url),
    gitRemoveRemote: (cwd: string, name: string) => invoke('git:remove-remote', cwd, name),
    gitConfigGet: (cwd: string, key: string, scope?: GitConfigScope) => invoke('git:config-get', cwd, key, scope),
    gitConfigSet: (cwd: string, key: string, value: string, scope?: Exclude<GitConfigScope, 'system'>) =>
      invoke('git:config-set', cwd, key, value, scope),
    gitWorktreeList: (cwd: string) => invoke('git:worktree-list', cwd),
    gitSubmoduleStatus: (cwd: string) => invoke('git:submodule-status', cwd),
    gitCheckIgnored: (cwd: string, filePaths: string[]) => invoke('git:check-ignored', cwd, filePaths),

    // =====================================================================
    // Terminal (electron/ipc/terminal.ts)
    // =====================================================================
    termCreate: (id: string, shellOptions?: TerminalShellOptions) => invoke('term:create', id, shellOptions),
    termWrite: (id: string, data: string) => send('term:write', id, data),
    termResize: (id: string, cols: number, rows: number) => send('term:resize', id, cols, rows),
    termKill: (id: string) => send('term:kill', id),
    onTermData: (callback: (...args: IpcEventArgs<'term:data'>) => void) => subscribe('term:data', callback),

    // =====================================================================
    // Settings (electron/ipc/settings.ts)
    // =====================================================================
    getSettings: () => invoke('settings:get'),
    setSettings: (settings: Partial<AppSettings>) => invoke('settings:set', settings),

    // =====================================================================
    // Workspace settings (electron/ipc/workspace.ts)
    // =====================================================================
    workspaceReadSettings: (rootPath: string) => invoke('workspace:read-settings', rootPath),
    workspaceWriteSettings: (rootPath: string, settings: WorkspaceSettingsFile) =>
      invoke('workspace:write-settings', rootPath, settings),

    // =====================================================================
    // AI assistant (electron/ipc/omo.ts)
    // =====================================================================
    omoStart: () => invoke('omo:start'),
    omoStop: () => invoke('omo:stop'),
    omoSend: (message: OmoBridgeMessage) => send('omo:send', message),
    omoSetApiKeys: (keys: ApiKeyPatch) => invoke('omo:set-api-keys', keys),
    omoGetApiKeyStatus: () => invoke('omo:get-api-key-status'),
    omoSetPrompts: (prompts: OmoPrompts) => invoke('omo:set-prompts', prompts),
    onOmoMessage: (callback: (...args: IpcEventArgs<'omo:message'>) => void) => subscribe('omo:message', callback),

    // =====================================================================
    // Tasks (electron/ipc/tasks.ts)
    // =====================================================================
    taskRun: (args: TaskRunArgs) => invoke('task:run', args),
    taskKill: (taskId: string) => invoke('task:kill', taskId),
    taskListScripts: (cwd: string) => invoke('task:list-scripts', cwd),
    onTaskOutput: (callback: (...args: IpcEventArgs<'task:output'>) => void) => subscribe('task:output', callback),
    onTaskComplete: (callback: (...args: IpcEventArgs<'task:complete'>) => void) =>
      subscribe('task:complete', callback),

    // =====================================================================
    // Window + app (electron/main.ts)
    // =====================================================================
    minimize: () => send('win:minimize'),
    maximize: () => send('win:maximize'),
    close: () => send('win:close'),
    appNewWindow: () => send('app:new-window'),
    appCheckForUpdates: () => invoke('app:check-for-updates'),
    appGetInfo: () => invoke('app:get-info'),

    // =====================================================================
    // Menu / OS events pushed from the main process
    // =====================================================================
    onAppOpenFile: (callback: (...args: IpcEventArgs<'app:open-file'>) => void) =>
      subscribe('app:open-file', callback),
    onAppOpenFolder: (callback: (...args: IpcEventArgs<'app:open-folder'>) => void) =>
      subscribe('app:open-folder', callback),
    onAppToggleSidebar: (callback: (...args: IpcEventArgs<'app:toggle-sidebar'>) => void) =>
      subscribe('app:toggle-sidebar', callback),
    onAppUpdateStatus: (callback: (...args: IpcEventArgs<'app:update-status'>) => void) =>
      subscribe('app:update-status', callback),
    onAppOpenAbout: onSignal('app:open-about'),
    onAppNewFile: onSignal('app:new-file'),
    onAppSave: onSignal('app:save'),
    onAppSaveAs: onSignal('app:save-as'),
    onAppSaveAll: onSignal('app:save-all'),
    onAppOpenSettings: onSignal('app:open-settings'),
    onAppFind: onSignal('app:find'),
    onAppReplace: onSignal('app:replace'),
    onAppFindInFiles: onSignal('app:find-in-files'),
    onAppReplaceInFiles: onSignal('app:replace-in-files'),
    onAppCommandPalette: onSignal('app:command-palette'),
    onAppTogglePanel: onSignal('app:toggle-panel'),
    onAppQuickOpen: onSignal('app:quick-open'),
    onAppGoToSymbol: onSignal('app:go-to-symbol'),
    onAppGoToLine: onSignal('app:go-to-line'),
    onAppGoBack: onSignal('app:go-back'),
    onAppGoForward: onSignal('app:go-forward'),
    onAppGoToDefinition: onSignal('app:go-to-definition'),
    onAppPeekDefinition: onSignal('app:peek-definition'),
    onAppStartDebugging: onSignal('app:start-debugging'),
    onAppRunWithoutDebugging: onSignal('app:run-without-debugging'),
    onAppStopDebugging: onSignal('app:stop-debugging'),
    onAppRestartDebugging: onSignal('app:restart-debugging'),
    onAppToggleBreakpoint: onSignal('app:toggle-breakpoint'),
    onAppRunTask: onSignal('app:run-task'),
    onAppRunBuildTask: onSignal('app:run-build-task'),
    onAppNewTerminal: onSignal('app:new-terminal'),
    onAppSplitTerminal: onSignal('app:split-terminal'),
    onAppRunActiveFile: onSignal('app:run-active-file'),
    onAppRunSelectedText: onSignal('app:run-selected-text'),
    onAppShowWelcome: onSignal('app:show-welcome'),
    onAppShowReleaseNotes: onSignal('app:show-release-notes'),
    onAppShowKeybindings: onSignal('app:show-keybindings'),
  }
}

export type ElectronAPI = ReturnType<typeof createElectronApi>
