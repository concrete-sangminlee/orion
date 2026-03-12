import { ipcMain } from 'electron'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

/**
 * Run git using execFile with an array of arguments.
 * Throws on non-zero exit so callers can report errors.
 */
async function runGitExec(
  cwd: string,
  args: string[],
  options?: { timeout?: number; maxBuffer?: number }
): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: options?.timeout ?? 10000,
    maxBuffer: options?.maxBuffer ?? 1024 * 1024 * 5,
  })
  return stdout.trim()
}

async function runGit(cwd: string, args: string, options?: { timeout?: number; maxBuffer?: number }): Promise<string> {
  try {
    const { stdout } = await execAsync(`git ${args}`, {
      cwd,
      timeout: options?.timeout ?? 10000,
      maxBuffer: options?.maxBuffer ?? 1024 * 1024 * 5, // 5MB default
    })
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
      if (check !== 'true') return { isRepo: false, branch: '', files: [], staged: [], unstaged: [], ahead: 0, behind: 0 }
    }

    const files: { path: string; state: string }[] = []
    const staged: { path: string; state: string }[] = []
    const unstaged: { path: string; state: string }[] = []

    statusRaw
      .split('\n')
      .filter(Boolean)
      .forEach((line) => {
        const x = line[0] // index (staging area) status
        const y = line[1] // working tree status
        const path = line.substring(3)

        // Determine overall state for backward compat
        let state: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' = 'modified'
        if (x === '?' && y === '?') state = 'untracked'
        else if (x === 'A' || y === 'A') state = 'added'
        else if (x === 'D' || y === 'D') state = 'deleted'
        else if (x === 'R' || y === 'R') state = 'renamed'
        files.push({ path, state })

        // Staged: X has a non-space, non-? value
        if (x !== ' ' && x !== '?') {
          let sState: string = 'modified'
          if (x === 'A') sState = 'added'
          else if (x === 'D') sState = 'deleted'
          else if (x === 'R') sState = 'renamed'
          staged.push({ path, state: sState })
        }

        // Unstaged: Y has a non-space value, or untracked
        if (y !== ' ' || (x === '?' && y === '?')) {
          let uState: string = 'modified'
          if (x === '?' && y === '?') uState = 'untracked'
          else if (y === 'D') uState = 'deleted'
          unstaged.push({ path, state: uState })
        }
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

    return { isRepo: true, branch: branch || 'main', files, staged, unstaged, ahead, behind }
  })

  ipcMain.handle('git:diff', async (_, cwd: string, filePath?: string) => {
    const args = filePath ? `diff -- "${filePath}"` : 'diff'
    return await runGit(cwd, args)
  })

  ipcMain.handle('git:log', async (_, cwd: string, count: number = 50) => {
    // Use ASCII record/unit separators to avoid conflicts with commit message content
    const SEP = '\x1f' // unit separator
    const REC = '\x1e' // record separator
    const format = `%H${SEP}%h${SEP}%an${SEP}%ae${SEP}%ai${SEP}%s${REC}`
    const raw = await runGit(cwd, `log --pretty=format:"${format}" -${count}`)
    if (!raw) return []
    return raw.split(REC).filter(s => s.trim()).map((record) => {
      const parts = record.trim().split(SEP)
      return {
        fullHash: parts[0] || '',
        hash: parts[1] || '',
        author: parts[2] || '',
        email: parts[3] || '',
        date: parts[4] || '',
        message: parts[5] || '',
      }
    })
  })

  ipcMain.handle('git:blame', async (_, cwd: string, filePath: string) => {
    const raw = await runGit(cwd, `blame --porcelain "${filePath}"`, { timeout: 30000, maxBuffer: 1024 * 1024 * 10 })
    if (!raw) return []

    const lines = raw.split('\n')
    const result: { hash: string; author: string; date: string; line: number; content: string }[] = []
    let currentHash = ''
    let currentAuthor = ''
    let currentDate = ''
    let currentLine = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Header line: <hash> <orig-line> <final-line> [<num-lines>]
      const headerMatch = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/)
      if (headerMatch) {
        currentHash = headerMatch[1]
        currentLine = parseInt(headerMatch[2], 10)
        continue
      }
      if (line.startsWith('author ')) {
        currentAuthor = line.substring(7)
        continue
      }
      if (line.startsWith('author-time ')) {
        const timestamp = parseInt(line.substring(12), 10)
        currentDate = new Date(timestamp * 1000).toISOString()
        continue
      }
      // Content line starts with a tab
      if (line.startsWith('\t')) {
        result.push({
          hash: currentHash.substring(0, 8),
          author: currentAuthor,
          date: currentDate,
          line: currentLine,
          content: line.substring(1),
        })
      }
    }
    return result
  })

  ipcMain.handle('git:show', async (_, cwd: string, hash: string) => {
    // Sanitize hash - only allow hex chars
    const safeHash = hash.replace(/[^0-9a-fA-F]/g, '')
    if (!safeHash) return null

    const SEP = '\x1f'
    const format = `%H${SEP}%h${SEP}%an${SEP}%ae${SEP}%ai${SEP}%s`
    const headerRaw = await runGit(cwd, `show ${safeHash} --quiet --pretty=format:"${format}"`)
    const statRaw = await runGit(cwd, `show ${safeHash} --stat --format=""`)

    if (!headerRaw) return null

    const parts = headerRaw.trim().split(SEP)
    const filesChanged: { file: string; changes: string }[] = []
    let summary = ''

    if (statRaw) {
      const statLines = statRaw.trim().split('\n')
      for (const sl of statLines) {
        // Match file stat lines like: " src/file.ts | 10 ++++----"
        const fileMatch = sl.match(/^\s*(.+?)\s+\|\s+(.+)$/)
        if (fileMatch) {
          filesChanged.push({ file: fileMatch[1].trim(), changes: fileMatch[2].trim() })
        }
        // Match summary line like: " 3 files changed, 10 insertions(+), 5 deletions(-)"
        if (sl.match(/\d+\s+file/)) {
          summary = sl.trim()
        }
      }
    }

    return {
      fullHash: parts[0] || '',
      hash: parts[1] || '',
      author: parts[2] || '',
      email: parts[3] || '',
      date: parts[4] || '',
      message: parts[5] || '',
      filesChanged,
      summary,
    }
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

  ipcMain.handle('git:discard', async (_, cwd: string, filePath: string) => {
    await runGit(cwd, `checkout -- "${filePath}"`)
    // Also handle untracked files
    await runGit(cwd, `clean -f -- "${filePath}"`)
    return true
  })

  ipcMain.handle('git:branches', async (_, cwd: string) => {
    const raw = await runGit(cwd, 'branch -a --format="%(refname:short)|%(HEAD)"')
    if (!raw) return []
    return raw.split('\n').filter(Boolean).map((line) => {
      const [name, head] = line.split('|')
      return { name, current: head === '*' }
    })
  })

  // Return parsed diff hunks for a specific file (used for git gutter decorations)
  ipcMain.handle('git:file-diff', async (_, cwd: string, filePath: string) => {
    const raw = await runGit(cwd, `diff -U0 -- "${filePath}"`)
    if (!raw) return []

    const hunks: { type: 'added' | 'modified' | 'deleted'; startLine: number; count: number }[] = []
    const lines = raw.split('\n')
    for (const line of lines) {
      // Parse hunk headers like @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (match) {
        const oldStart = parseInt(match[1], 10)
        const oldCount = parseInt(match[2] ?? '1', 10)
        const newStart = parseInt(match[3], 10)
        const newCount = parseInt(match[4] ?? '1', 10)

        if (oldCount === 0 && newCount > 0) {
          // Pure addition
          hunks.push({ type: 'added', startLine: newStart, count: newCount })
        } else if (newCount === 0 && oldCount > 0) {
          // Pure deletion
          hunks.push({ type: 'deleted', startLine: newStart, count: 1 })
        } else {
          // Modification (changed lines)
          hunks.push({ type: 'modified', startLine: newStart, count: newCount })
        }
      }
    }
    return hunks
  })

  // Return combined unified diff (staged + unstaged) for a specific file
  ipcMain.handle('git:diff-file', async (_, cwd: string, filePath: string) => {
    // Get unstaged changes
    const unstaged = await runGit(cwd, `diff -U0 -- "${filePath}"`)
    // Get staged (cached) changes
    const staged = await runGit(cwd, `diff --cached -U0 -- "${filePath}"`)

    // Combine both diffs and parse hunks
    const combined = [unstaged, staged].filter(Boolean).join('\n')
    if (!combined) return []

    const hunks: { type: 'added' | 'modified' | 'deleted'; startLine: number; count: number }[] = []
    const lines = combined.split('\n')
    for (const line of lines) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (match) {
        const oldCount = parseInt(match[2] ?? '1', 10)
        const newStart = parseInt(match[3], 10)
        const newCount = parseInt(match[4] ?? '1', 10)

        if (oldCount === 0 && newCount > 0) {
          hunks.push({ type: 'added', startLine: newStart, count: newCount })
        } else if (newCount === 0 && oldCount > 0) {
          hunks.push({ type: 'deleted', startLine: newStart, count: 1 })
        } else {
          hunks.push({ type: 'modified', startLine: newStart, count: newCount })
        }
      }
    }

    // Deduplicate overlapping hunks (same line ranges from staged + unstaged)
    const seen = new Set<string>()
    return hunks.filter((h) => {
      const key = `${h.type}:${h.startLine}:${h.count}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })

  ipcMain.handle('git:push', async (_, cwd: string) => {
    const result = await runGit(cwd, 'push')
    return result
  })

  ipcMain.handle('git:pull', async (_, cwd: string) => {
    const result = await runGit(cwd, 'pull')
    return result
  })

  ipcMain.handle('git:fetch', async (_, cwd: string) => {
    const result = await runGit(cwd, 'fetch --all')
    return result
  })

  ipcMain.handle('git:stash', async (_, cwd: string) => {
    const result = await runGit(cwd, 'stash')
    return result
  })

  ipcMain.handle('git:stash-pop', async (_, cwd: string) => {
    const result = await runGit(cwd, 'stash pop')
    return result
  })

  ipcMain.handle('git:create-branch', async (_, cwd: string, branchName: string) => {
    const result = await runGit(cwd, `checkout -b "${branchName}"`)
    return result
  })

  ipcMain.handle('git:stage-all', async (_, cwd: string) => {
    await runGit(cwd, 'add -A')
    return true
  })

  ipcMain.handle('git:unstage-all', async (_, cwd: string) => {
    await runGit(cwd, 'reset HEAD')
    return true
  })

  ipcMain.handle('git:stash-list', async (_, cwd: string) => {
    const SEP = '\x1f'
    const raw = await runGit(cwd, `stash list --pretty=format:"%H${SEP}%s"`)
    if (!raw) return []
    return raw.split('\n').filter(Boolean).map((line, index) => {
      const parts = line.split(SEP)
      return {
        index,
        hash: (parts[0] || '').substring(0, 8),
        message: parts[1] || `stash@{${index}}`,
      }
    })
  })

  ipcMain.handle('git:stash-drop', async (_, cwd: string, index: number) => {
    const result = await runGit(cwd, `stash drop stash@{${index}}`)
    return result
  })

  ipcMain.handle('git:stash-apply', async (_, cwd: string, index: number) => {
    const result = await runGit(cwd, `stash apply stash@{${index}}`)
    return result
  })

  ipcMain.handle('git:stash-save', async (_, cwd: string, message: string) => {
    const safeMsg = message.replace(/"/g, '\\"')
    const result = await runGit(cwd, `stash push -m "${safeMsg}"`)
    return result
  })

  ipcMain.handle('git:merge-status', async (_, cwd: string) => {
    try {
      // Check for .git/MERGE_HEAD to detect active merge
      const gitDir = await runGit(cwd, 'rev-parse --git-dir')
      if (!gitDir) return { merging: false }
      const mergeHeadPath = path.resolve(cwd, gitDir, 'MERGE_HEAD')
      const exists = fs.existsSync(mergeHeadPath)
      return { merging: exists }
    } catch {
      return { merging: false }
    }
  })

  ipcMain.handle('git:conflict-files', async (_, cwd: string) => {
    const raw = await runGit(cwd, 'diff --name-only --diff-filter=U')
    if (!raw) return []
    return raw.split('\n').filter(Boolean)
  })

  ipcMain.handle('git:merge-abort', async (_, cwd: string) => {
    const result = await runGit(cwd, 'merge --abort')
    return result
  })

  // ── Cherry-pick ──────────────────────────────────────────────────────

  ipcMain.handle('git:cherry-pick', async (_, cwd: string, commitHash: string) => {
    const safeHash = commitHash.replace(/[^0-9a-fA-F]/g, '')
    if (!safeHash) return { success: false, error: 'Invalid commit hash' }
    try {
      const result = await runGitExec(cwd, ['cherry-pick', safeHash])
      return { success: true, output: result }
    } catch (err: any) {
      return { success: false, error: err.stderr?.trim() || err.message }
    }
  })

  // ── Revert ───────────────────────────────────────────────────────────

  ipcMain.handle('git:revert', async (_, cwd: string, commitHash: string) => {
    const safeHash = commitHash.replace(/[^0-9a-fA-F]/g, '')
    if (!safeHash) return { success: false, error: 'Invalid commit hash' }
    try {
      const result = await runGitExec(cwd, ['revert', '--no-edit', safeHash])
      return { success: true, output: result }
    } catch (err: any) {
      return { success: false, error: err.stderr?.trim() || err.message }
    }
  })

  // ── Interactive rebase status ────────────────────────────────────────

  ipcMain.handle('git:rebase-status', async (_, cwd: string) => {
    try {
      const gitDir = await runGitExec(cwd, ['rev-parse', '--git-dir'])
      if (!gitDir) return { rebasing: false }

      const rebaseMergePath = path.resolve(cwd, gitDir, 'rebase-merge')
      const rebaseApplyPath = path.resolve(cwd, gitDir, 'rebase-apply')
      const isRebasing = fs.existsSync(rebaseMergePath) || fs.existsSync(rebaseApplyPath)

      if (!isRebasing) return { rebasing: false }

      // Determine which directory is active
      const activeDir = fs.existsSync(rebaseMergePath) ? rebaseMergePath : rebaseApplyPath

      let currentStep = 0
      let totalSteps = 0
      let headName = ''

      const msgNumPath = path.join(activeDir, 'msgnum')
      const endPath = path.join(activeDir, 'end')
      const headNamePath = path.join(activeDir, 'head-name')

      if (fs.existsSync(msgNumPath)) {
        currentStep = parseInt(fs.readFileSync(msgNumPath, 'utf-8').trim(), 10) || 0
      }
      if (fs.existsSync(endPath)) {
        totalSteps = parseInt(fs.readFileSync(endPath, 'utf-8').trim(), 10) || 0
      }
      if (fs.existsSync(headNamePath)) {
        headName = fs.readFileSync(headNamePath, 'utf-8').trim().replace(/^refs\/heads\//, '')
      }

      return { rebasing: true, currentStep, totalSteps, headName }
    } catch {
      return { rebasing: false }
    }
  })

  // ── Tags ─────────────────────────────────────────────────────────────

  ipcMain.handle('git:tags', async (_, cwd: string) => {
    try {
      const raw = await runGitExec(cwd, ['tag', '--sort=-creatordate', '--format=%(refname:short)\x1f%(objectname:short)\x1f%(creatordate:iso)'])
      if (!raw) return []
      return raw.split('\n').filter(Boolean).map((line) => {
        const [name, hash, date] = line.split('\x1f')
        return { name: name || '', hash: hash || '', date: date || '' }
      })
    } catch {
      return []
    }
  })

  ipcMain.handle('git:create-tag', async (_, cwd: string, tagName: string, message?: string, commitHash?: string) => {
    try {
      const args = ['tag']
      if (message) {
        args.push('-a', tagName, '-m', message)
      } else {
        args.push(tagName)
      }
      if (commitHash) {
        const safeHash = commitHash.replace(/[^0-9a-fA-F]/g, '')
        if (safeHash) args.push(safeHash)
      }
      await runGitExec(cwd, args)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.stderr?.trim() || err.message }
    }
  })

  ipcMain.handle('git:delete-tag', async (_, cwd: string, tagName: string) => {
    try {
      await runGitExec(cwd, ['tag', '-d', tagName])
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.stderr?.trim() || err.message }
    }
  })

  // ── Remote management ────────────────────────────────────────────────

  ipcMain.handle('git:remotes', async (_, cwd: string) => {
    try {
      const raw = await runGitExec(cwd, ['remote', '-v'])
      if (!raw) return []
      const remotes = new Map<string, { name: string; fetchUrl: string; pushUrl: string }>()
      raw.split('\n').filter(Boolean).forEach((line) => {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
        if (match) {
          const [, name, url, type] = match
          if (!remotes.has(name)) {
            remotes.set(name, { name, fetchUrl: '', pushUrl: '' })
          }
          const entry = remotes.get(name)!
          if (type === 'fetch') entry.fetchUrl = url
          else entry.pushUrl = url
        }
      })
      return Array.from(remotes.values())
    } catch {
      return []
    }
  })

  ipcMain.handle('git:add-remote', async (_, cwd: string, name: string, url: string) => {
    try {
      await runGitExec(cwd, ['remote', 'add', name, url])
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.stderr?.trim() || err.message }
    }
  })

  ipcMain.handle('git:remove-remote', async (_, cwd: string, name: string) => {
    try {
      await runGitExec(cwd, ['remote', 'remove', name])
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.stderr?.trim() || err.message }
    }
  })

  // ── Git config ───────────────────────────────────────────────────────

  ipcMain.handle('git:config-get', async (_, cwd: string, key: string, scope?: 'local' | 'global' | 'system') => {
    try {
      const args = ['config']
      if (scope) args.push(`--${scope}`)
      args.push('--get', key)
      const value = await runGitExec(cwd, args)
      return { success: true, value }
    } catch (err: any) {
      // Exit code 1 means key not found, which is not really an error
      return { success: false, value: null, error: err.stderr?.trim() || err.message }
    }
  })

  ipcMain.handle('git:config-set', async (_, cwd: string, key: string, value: string, scope?: 'local' | 'global') => {
    try {
      const args = ['config']
      if (scope) args.push(`--${scope}`)
      args.push(key, value)
      await runGitExec(cwd, args)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.stderr?.trim() || err.message }
    }
  })

  // ── Worktree ─────────────────────────────────────────────────────────

  ipcMain.handle('git:worktree-list', async (_, cwd: string) => {
    try {
      const raw = await runGitExec(cwd, ['worktree', 'list', '--porcelain'])
      if (!raw) return []

      const worktrees: { path: string; head: string; branch: string; bare: boolean }[] = []
      let current: { path: string; head: string; branch: string; bare: boolean } = { path: '', head: '', branch: '', bare: false }

      for (const line of raw.split('\n')) {
        if (line.startsWith('worktree ')) {
          current = { path: line.substring(9), head: '', branch: '', bare: false }
        } else if (line.startsWith('HEAD ')) {
          current.head = line.substring(5)
        } else if (line.startsWith('branch ')) {
          current.branch = line.substring(7).replace(/^refs\/heads\//, '')
        } else if (line === 'bare') {
          current.bare = true
        } else if (line === '') {
          if (current.path) worktrees.push({ ...current })
        }
      }
      // Push last entry if file doesn't end with blank line
      if (current.path && !worktrees.find((w) => w.path === current.path)) {
        worktrees.push({ ...current })
      }

      return worktrees
    } catch {
      return []
    }
  })

  // ── Submodules ───────────────────────────────────────────────────────

  ipcMain.handle('git:submodule-status', async (_, cwd: string) => {
    try {
      const raw = await runGitExec(cwd, ['submodule', 'status'])
      if (!raw) return []

      return raw.split('\n').filter(Boolean).map((line) => {
        // Format: [+-U ]<sha1> <path> [(describe)]
        const match = line.match(/^([+-U ]?)([0-9a-f]+)\s+(\S+)(?:\s+\((.+)\))?$/)
        if (!match) return null
        const [, statusChar, hash, subPath, describe] = match
        let status = 'initialized'
        if (statusChar === '-') status = 'uninitialized'
        else if (statusChar === '+') status = 'out-of-date'
        else if (statusChar === 'U') status = 'merge-conflict'
        return { path: subPath, hash: hash.substring(0, 8), status, describe: describe || '' }
      }).filter(Boolean)
    } catch {
      return []
    }
  })

  // ── Git ignore ───────────────────────────────────────────────────────

  ipcMain.handle('git:check-ignored', async (_, cwd: string, filePaths: string[]) => {
    if (!filePaths || filePaths.length === 0) return []
    try {
      const result = await runGitExec(cwd, ['check-ignore', ...filePaths])
      return result.split('\n').filter(Boolean)
    } catch {
      // Exit code 1 means no files are ignored, which is expected
      return []
    }
  })

  // ── Commit amend ─────────────────────────────────────────────────────

  ipcMain.handle('git:commit-amend', async (_, cwd: string, message?: string) => {
    try {
      const args = ['commit', '--amend']
      if (message) {
        args.push('-m', message)
      } else {
        args.push('--no-edit')
      }
      const result = await runGitExec(cwd, args)
      return { success: true, output: result }
    } catch (err: any) {
      return { success: false, error: err.stderr?.trim() || err.message }
    }
  })

  // ── Reset ────────────────────────────────────────────────────────────

  ipcMain.handle('git:reset', async (_, cwd: string, mode: 'soft' | 'mixed' | 'hard', ref?: string) => {
    const validModes = ['soft', 'mixed', 'hard']
    if (!validModes.includes(mode)) {
      return { success: false, error: `Invalid reset mode: ${mode}` }
    }
    try {
      const args = ['reset', `--${mode}`]
      if (ref) {
        // Sanitize ref: allow hex, branch names, HEAD~N, etc.
        const safeRef = ref.replace(/[;&|`$(){}]/g, '')
        if (safeRef) args.push(safeRef)
      }
      const result = await runGitExec(cwd, args)
      return { success: true, output: result }
    } catch (err: any) {
      return { success: false, error: err.stderr?.trim() || err.message }
    }
  })

  // ── Clean ────────────────────────────────────────────────────────────

  ipcMain.handle('git:clean', async (_, cwd: string, options?: { directories?: boolean; force?: boolean; dryRun?: boolean }) => {
    try {
      const args = ['clean']
      // Always require at least -f or -n to prevent accidental data loss
      if (options?.dryRun) {
        args.push('-n')
      } else {
        args.push('-f')
      }
      if (options?.directories) {
        args.push('-d')
      }
      const result = await runGitExec(cwd, args)
      const removedFiles = result.split('\n').filter(Boolean).map((line) => {
        // Lines look like "Removing path/to/file" or "Would remove path/to/file"
        return line.replace(/^(Removing|Would remove)\s+/, '')
      })
      return { success: true, removedFiles }
    } catch (err: any) {
      return { success: false, error: err.stderr?.trim() || err.message, removedFiles: [] }
    }
  })
}
