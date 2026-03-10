import os from 'os'
import path from 'path'

interface PtyProcess {
  onData: (callback: (data: string) => void) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
}

const terminals = new Map<string, PtyProcess>()
let currentProjectPath: string | null = null

export function setProjectPath(projectPath: string) {
  currentProjectPath = projectPath
}

function detectShell(): string {
  if (process.platform === 'win32') {
    return 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

function loadNodePty() {
  try {
    return require('node-pty')
  } catch {
    const modulePath = path.join(process.cwd(), 'node_modules', 'node-pty')
    return require(modulePath)
  }
}

export async function createTerminal(
  id: string,
  onData: (data: string) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    const pty = loadNodePty()

    const shell = detectShell()
    const cwd = currentProjectPath || os.homedir()
    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>,
      useConpty: false,
    })

    term.onData(onData)
    terminals.set(id, term)
    return { success: true }
  } catch (err: any) {
    console.error('Failed to create terminal:', err.message)
    return { success: false, error: err.message }
  }
}

export function writeToTerminal(id: string, data: string) {
  terminals.get(id)?.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number) {
  terminals.get(id)?.resize(cols, rows)
}

export function killTerminal(id: string) {
  const term = terminals.get(id)
  if (term) {
    term.kill()
    terminals.delete(id)
  }
}

export function killAllTerminals() {
  for (const [id, term] of terminals) {
    term.kill()
    terminals.delete(id)
  }
}
