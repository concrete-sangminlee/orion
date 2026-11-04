import type { BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { IPC } from '../../shared/ipc-channels'
import { resolveActiveWorkspacePath } from './workspace-path-guard'
import { handle, emit } from './typed-ipc'

const runningTasks = new Map<string, ChildProcess>()
let taskCounter = 0

function isLikelyCommand(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  // Reject NUL bytes (some shells parse the byte and silently truncate, so
  // an attacker can hide a tail of the command past the NUL). We deliberately
  // do NOT filter other control characters or metacharacters — running a
  // user-supplied command line through `cmd /c` / `sh -c` is the documented
  // contract of task:run.
  if (/\x00/.test(trimmed)) return false
  return true
}

export function registerTaskHandlers(getWindow: () => BrowserWindow | null) {
  handle(
    IPC.TASK_RUN,
    async (_event, args: { command: string; cwd: string; label: string }) => {
      const taskId = `task-${++taskCounter}-${Date.now()}`
      const { command, cwd, label } = args ?? ({} as { command?: string; cwd?: string; label?: string })
      const safeLabel = typeof label === 'string' ? label : 'task'

      const emitFailure = (message: string) => {
        const win = getWindow()
        emit(win, IPC.TASK_OUTPUT, {
          taskId,
          data: `Error: ${message}\n`,
          stream: 'stderr',
        })
        emit(win, IPC.TASK_COMPLETE, { taskId, code: 1 })
        return { taskId, label: safeLabel, command: typeof command === 'string' ? command : '' }
      }

      if (!isLikelyCommand(command)) {
        return emitFailure('Refused to run task: command is empty, non-string, or contains NUL')
      }

      let safeCwd: string
      try {
        safeCwd = await resolveActiveWorkspacePath(cwd, 'task cwd')
      } catch (err: any) {
        return emitFailure(`Refused to run task: ${err.message}`)
      }

      const isWindows = process.platform === 'win32'
      const shell = isWindows ? 'cmd.exe' : '/bin/sh'
      const shellArgs = isWindows ? ['/c', command] : ['-c', command]

      const child = spawn(shell, shellArgs, {
        cwd: safeCwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      runningTasks.set(taskId, child)

      const win = getWindow()

      child.stdout?.on('data', (data: Buffer) => {
        emit(win, IPC.TASK_OUTPUT, {
          taskId,
          data: data.toString(),
          stream: 'stdout',
        })
      })

      child.stderr?.on('data', (data: Buffer) => {
        emit(win, IPC.TASK_OUTPUT, {
          taskId,
          data: data.toString(),
          stream: 'stderr',
        })
      })

      child.on('close', (code) => {
        runningTasks.delete(taskId)
        emit(win, IPC.TASK_COMPLETE, {
          taskId,
          code: code ?? 1,
        })
      })

      child.on('error', (err) => {
        runningTasks.delete(taskId)
        emit(win, IPC.TASK_OUTPUT, {
          taskId,
          data: `Error: ${err.message}\n`,
          stream: 'stderr',
        })
        emit(win, IPC.TASK_COMPLETE, {
          taskId,
          code: 1,
        })
      })

      return { taskId, label: safeLabel, command }
    }
  )

  handle(IPC.TASK_KILL, async (_event, taskId: string) => {
    const child = runningTasks.get(taskId)
    if (!child) return { success: false, error: 'Task not found' }

    try {
      // On Windows, use taskkill to kill the process tree. child.pid comes
      // from our own runningTasks map, not from the renderer, so it's safe
      // to interpolate.
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        child.kill('SIGTERM')
      }
      runningTasks.delete(taskId)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  handle(IPC.TASK_LIST_SCRIPTS, async (_event, cwd: string) => {
    let safeCwd: string
    try {
      safeCwd = await resolveActiveWorkspacePath(cwd, 'scripts cwd')
    } catch {
      return []
    }
    try {
      const pkgPath = path.join(safeCwd, 'package.json')
      const content = fs.readFileSync(pkgPath, 'utf-8')
      const pkg = JSON.parse(content)
      const scripts = pkg.scripts || {}

      return Object.entries(scripts).map(([name, command]) => ({
        name,
        command: command as string,
      }))
    } catch {
      return []
    }
  })
}
