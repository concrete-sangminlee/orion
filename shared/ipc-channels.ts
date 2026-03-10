export const IPC = {
  // Filesystem
  FS_READ_FILE: 'fs:read-file',
  FS_WRITE_FILE: 'fs:write-file',
  FS_DELETE: 'fs:delete',
  FS_RENAME: 'fs:rename',
  FS_READ_DIR: 'fs:read-dir',
  FS_WATCH_START: 'fs:watch-start',
  FS_WATCH_STOP: 'fs:watch-stop',
  FS_CHANGE: 'fs:change',
  FS_OPEN_FOLDER: 'fs:open-folder',

  // Terminal
  TERM_CREATE: 'term:create',
  TERM_WRITE: 'term:write',
  TERM_RESIZE: 'term:resize',
  TERM_KILL: 'term:kill',
  TERM_DATA: 'term:data',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // OMO
  OMO_START: 'omo:start',
  OMO_STOP: 'omo:stop',
  OMO_SEND: 'omo:send',
  OMO_MESSAGE: 'omo:message',

  // Window
  WIN_MINIMIZE: 'win:minimize',
  WIN_MAXIMIZE: 'win:maximize',
  WIN_CLOSE: 'win:close',
} as const
