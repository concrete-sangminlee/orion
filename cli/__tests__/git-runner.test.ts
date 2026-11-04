/**
 * Regression tests for the git command runner.
 *
 * runGitCommand must invoke git as `execFileSync('git', [...args])`, NEVER as a
 * single shell string. This guarantees that user-controlled arguments (refs,
 * branch names, author filters, etc.) cannot inject shell commands via
 * `;`, `|`, `&`, backticks, `$()`, redirections, or quoting tricks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type ExecMock = (file: string, args?: readonly string[], options?: unknown) => string | Buffer;
const execFileSyncMock = vi.fn<ExecMock>(() => '');
const execSyncMock = vi.fn<ExecMock>(() => '');

vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
  execSync: execSyncMock,
  exec: vi.fn(),
}));

vi.mock('chalk', () => {
  const identity = (s: string) => s;
  const chainable: any = new Proxy(identity, {
    get: () => chainable,
    apply: (_t: any, _this: any, args: any[]) => args[0],
  });
  return { default: chainable };
});

vi.mock('ora', () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

describe('runGitCommand', () => {
  beforeEach(() => {
    execFileSyncMock.mockClear();
    execSyncMock.mockClear();
  });

  it('invokes git via execFileSync (no shell)', async () => {
    const { runGitCommand } = await import('../utils.js');
    runGitCommand('status', '--short');
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const [bin, args] = execFileSyncMock.mock.calls[0];
    expect(bin).toBe('git');
    expect(args).toEqual(['status', '--short']);
  });

  it('never invokes execSync (which would go through a shell)', async () => {
    const { runGitCommand } = await import('../utils.js');
    runGitCommand('log', '--oneline');
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it('treats shell metacharacters in args as literal text', async () => {
    const { runGitCommand } = await import('../utils.js');
    const malicious = '; rm -rf ~';
    runGitCommand('log', malicious);
    const [, args] = execFileSyncMock.mock.calls[0];
    // The malicious string must arrive as a single argv entry, not split or expanded.
    expect(args).toEqual(['log', '; rm -rf ~']);
  });

  it('passes command substitution syntax as literal', async () => {
    const { runGitCommand } = await import('../utils.js');
    runGitCommand('log', '--format=$(whoami)');
    const [, args] = execFileSyncMock.mock.calls[0];
    expect(args).toEqual(['log', '--format=$(whoami)']);
  });

  it('passes backtick injection attempts as literal', async () => {
    const { runGitCommand } = await import('../utils.js');
    runGitCommand('log', '--author=`whoami`');
    const [, args] = execFileSyncMock.mock.calls[0];
    expect(args).toEqual(['log', '--author=`whoami`']);
  });

  it('uses pipe stdio (does not inherit terminal)', async () => {
    const { runGitCommand } = await import('../utils.js');
    runGitCommand('status');
    const [, , opts] = execFileSyncMock.mock.calls[0];
    expect(opts).toMatchObject({
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
    // stdio must be pipe so stderr is captured (for error messages), not inherited
    expect((opts as any).stdio).toEqual(['pipe', 'pipe', 'pipe']);
  });

  it('rethrows git errors with stderr context', async () => {
    execFileSyncMock.mockImplementationOnce(() => {
      const err: any = new Error('Command failed');
      err.stderr = Buffer.from('fatal: not a git repository');
      throw err;
    });
    const { runGitCommand } = await import('../utils.js');
    expect(() => runGitCommand('status')).toThrow(/Git error: fatal: not a git repository/);
  });
});
