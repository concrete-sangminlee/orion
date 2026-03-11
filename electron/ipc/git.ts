import { ipcMain } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

async function runGit(cwd: string, args: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git ${args}`, { cwd, timeout: 10000 })
    return stdout.trim()
  } catch (err: any) {
    if (err.stderr) return ''
    return ''
  }
}

export function registerGitHandlers() {
  ipcMain.handle('git:status', async (_, cwd: string) => {
    const branch = await runGit(cwd, 'branch --show-current')
    const statusRaw = await runGit(cwd, 'status --porcelain')
    const isRepo = branch !== '' || statusRaw !== ''

    if (!isRepo) {
      const check = await runGit(cwd, 'rev-parse --is-inside-work-tree')
      if (check !== 'true') return { isRepo: false, branch: '', files: [], ahead: 0, behind: 0 }
    }

    const files = statusRaw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const status = line.substring(0, 2).trim()
        const path = line.substring(3)
        let state: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' = 'modified'
        if (status === '??') state = 'untracked'
        else if (status.includes('A')) state = 'added'
        else if (status.includes('D')) state = 'deleted'
        else if (status.includes('R')) state = 'renamed'
        return { path, state }
      })

    // Get ahead/behind counts
    let ahead = 0, behind = 0
    try {
      const ab = await runGit(cwd, 'rev-list --left-right --count HEAD...@{upstream}')
      if (ab) {
        const [a, b] = ab.split('\t').map(Number)
        ahead = a || 0
        behind = b || 0
      }
    } catch {}

    return { isRepo: true, branch: branch || 'main', files, ahead, behind }
  })

  ipcMain.handle('git:diff', async (_, cwd: string, filePath?: string) => {
    const args = filePath ? `diff -- "${filePath}"` : 'diff'
    return await runGit(cwd, args)
  })

  ipcMain.handle('git:log', async (_, cwd: string, count: number = 20) => {
    const raw = await runGit(cwd, `log --oneline -${count} --format="%h|%s|%an|%ar"`)
    if (!raw) return []
    return raw.split('\n').filter(Boolean).map((line) => {
      const [hash, message, author, date] = line.split('|')
      return { hash, message, author, date }
    })
  })

  ipcMain.handle('git:stage', async (_, cwd: string, filePath: string) => {
    await runGit(cwd, `add "${filePath}"`)
    return true
  })

  ipcMain.handle('git:unstage', async (_, cwd: string, filePath: string) => {
    await runGit(cwd, `reset HEAD "${filePath}"`)
    return true
  })

  ipcMain.handle('git:commit', async (_, cwd: string, message: string) => {
    const result = await runGit(cwd, `commit -m "${message.replace(/"/g, '\\"')}"`)
    return result !== ''
  })

  ipcMain.handle('git:checkout', async (_, cwd: string, branch: string) => {
    return await runGit(cwd, `checkout "${branch}"`)
  })

  ipcMain.handle('git:branches', async (_, cwd: string) => {
    const raw = await runGit(cwd, 'branch -a --format="%(refname:short)|%(HEAD)"')
    if (!raw) return []
    return raw.split('\n').filter(Boolean).map((line) => {
      const [name, head] = line.split('|')
      return { name, current: head === '*' }
    })
  })
}
