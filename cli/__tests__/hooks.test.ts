/**
 * The installed git hooks must call real CLI invocations and must not block
 * git when the Orion CLI fails: `orion diff` / `orion security` exit 0
 * whatever they find, so a non-zero status only means the CLI could not run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hooksCommand } from '../commands/hooks.js';

let tmp: string;
let repo: string;
let argsLog: string;
let env: NodeJS.ProcessEnv;
let savedCwd: string;

function git(...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repo,
    encoding: 'utf-8',
  });
}

function runHook(name: string, ...args: string[]) {
  return spawnSync('sh', [path.join(repo, '.git', 'hooks', name), ...args], { cwd: repo, env, encoding: 'utf-8' });
}

beforeEach(async () => {
  savedCwd = process.cwd();
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orion-hooks-')));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git('init', '-q');

  // A stand-in `orion` that records its arguments and fails, as the real CLI
  // does when no AI provider is configured.
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  argsLog = path.join(tmp, 'orion-args.log');
  fs.writeFileSync(path.join(bin, 'orion'), '#!/bin/sh\necho "$@" >> "$ORION_ARGS_LOG"\nexit 1\n', { mode: 0o755 });
  env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, ORION_ARGS_LOG: argsLog };

  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.chdir(repo);
  await hooksCommand('install');
});

afterEach(() => {
  process.chdir(savedCwd);
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('orion git hooks', () => {
  it('pre-commit reviews the staged diff and lets the commit through when the CLI fails', () => {
    fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n');
    git('add', 'a.ts');

    const result = runHook('pre-commit');

    expect(fs.readFileSync(argsLog, 'utf-8').trim()).toBe('diff --staged');
    expect(result.status).toBe(0);
  });

  it('pre-push scans and lets the push through when the CLI fails', () => {
    fs.writeFileSync(path.join(repo, 'a.ts'), 'one\n');
    git('add', 'a.ts');
    git('commit', '-q', '--no-verify', '-m', 'one');
    git('branch', '-M', 'main');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    fs.writeFileSync(path.join(repo, 'b.ts'), 'two\n');
    git('add', 'b.ts');
    git('commit', '-q', '--no-verify', '-m', 'two');

    const result = runHook('pre-push', 'origin', 'https://example.invalid/repo.git');

    expect(fs.readFileSync(argsLog, 'utf-8').trim()).toBe('security');
    expect(result.status).toBe(0);
  });
});
