/**
 * Runs the built CLI (npm test builds it first) to check how words that are
 * not built-in commands are dispatched. A root-level .action() used to make
 * commander reject every such word with "too many arguments", so aliases
 * created with `orion alias set` and plugin commands never ran.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const CLI = path.resolve(__dirname, '../../dist-cli/index.mjs')
let home: string

function orion(...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: home,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1', CI: '1', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
  })
  return { code: result.status, output: `${result.stdout}${result.stderr}` }
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-cli-dispatch-'))
})

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true })
})

describe.runIf(fs.existsSync(CLI))('CLI command dispatch', () => {
  it('runs a user alias', () => {
    expect(orion('alias', 'set', 'ex', 'examples').code).toBe(0)
    const { code, output } = orion('ex')
    expect(output).not.toContain('too many arguments')
    expect(output).toContain('Alias: ex => examples')
    expect(code).toBe(0)
  })

  it('suggests the intended command for a typo and exits non-zero', () => {
    const { code, output } = orion('exampels')
    expect(output).not.toContain('too many arguments')
    expect(output).toContain('Unknown command: exampels')
    expect(output).toMatch(/Did you mean orion examples/)
    expect(code).toBe(1)
  })

  it('still shows the quick reference for a bare `orion`', () => {
    const { code, output } = orion()
    expect(code).toBe(0)
    expect(output).toContain('Commands')
  })
})
