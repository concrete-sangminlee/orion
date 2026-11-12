/**
 * edit / fix / migrate save the model's reply as the whole file. They must ask
 * for a complete (not max_tokens-truncated) reply, never save an empty one,
 * and the `fix --auto` retries must get the same checks as the first fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mocks = vi.hoisted(() => ({ replies: [] as string[], askAI: vi.fn(), prompt: vi.fn() }));

vi.mock('inquirer', () => ({ default: { prompt: mocks.prompt } }));
vi.mock('../ai-client.js', () => ({ askAI: mocks.askAI }));
vi.mock('../stdin.js', () => ({ readStdin: async () => null }));
vi.mock('../utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils.js')>()),
  loadProjectContext: () => '',
}));

import { editCommand } from '../commands/edit.js';
import { fixCommand } from '../commands/fix.js';
import { migrateCommand } from '../commands/migrate.js';
import { setPipelineOptions } from '../pipeline.js';

const ORIGINAL = 'const a = 1\n';

let tmp: string;
let savedCwd: string;
let file: string;
let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  savedCwd = process.cwd();
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orion-whole-file-')));
  file = path.join(tmp, 'a.js');
  fs.writeFileSync(file, ORIGINAL);
  process.chdir(tmp);

  mocks.replies = [];
  mocks.askAI.mockReset().mockImplementation(async (_sys, _user, callbacks) => {
    const reply = mocks.replies.shift() ?? '';
    callbacks.onComplete?.(reply);
    return reply;
  });
  mocks.prompt.mockReset();
  setPipelineOptions({ yes: true, dryRun: false, json: false, quiet: true });
  exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  process.chdir(savedCwd);
  setPipelineOptions({ yes: false, quiet: false });
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('orion edit', () => {
  beforeEach(() => {
    mocks.prompt.mockResolvedValueOnce({ instruction: 'add a semicolon' });
  });

  it('asks for a complete reply', async () => {
    mocks.replies = ['const a = 1;'];

    await editCommand('a.js', { noCommit: true });

    expect(mocks.askAI.mock.calls[0][3]).toEqual({ requireComplete: true });
    expect(fs.readFileSync(file, 'utf-8')).toBe('const a = 1;');
  });

  it('does not overwrite the file with an empty reply', async () => {
    mocks.replies = ['  \n'];

    await editCommand('a.js', { noCommit: true });

    expect(fs.readFileSync(file, 'utf-8')).toBe(ORIGINAL);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('orion migrate', () => {
  it('asks for a complete reply', async () => {
    mocks.replies = ['---MIGRATED---\nexport const a = 1;'];

    await migrateCommand('a.js', { to: 'esm' });

    expect(mocks.askAI.mock.calls[0][3]).toEqual({ requireComplete: true });
    expect(fs.readFileSync(file, 'utf-8')).toBe('export const a = 1;');
  });

  it('does not overwrite the file with an empty reply', async () => {
    mocks.replies = ['[MIGRATION NOTE] none\n---MIGRATED---\n'];

    await migrateCommand('a.js', { to: 'esm' });

    expect(fs.readFileSync(file, 'utf-8')).toBe(ORIGINAL);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('orion fix', () => {
  const FIRST_FIX = '[ERROR] missing semicolon (line ~1)\n---FIX---\nconst a = 1;';

  it('asks for a complete reply', async () => {
    mocks.replies = [FIRST_FIX];

    await fixCommand('a.js', { noCommit: true });

    expect(mocks.askAI.mock.calls[0][3]).toEqual({ requireComplete: true });
    expect(fs.readFileSync(file, 'utf-8')).toBe('const a = 1;');
  });

  it('does not empty the file when the fix is only a code fence', async () => {
    mocks.replies = ['[ERROR] missing semicolon (line ~1)\n---FIX---\n```js\n```'];

    await fixCommand('a.js', { noCommit: true });

    expect(fs.readFileSync(file, 'utf-8')).toBe(ORIGINAL);
  });

  describe('--auto retries', () => {
    beforeEach(() => {
      // A test script that always fails, so the loop asks for another fix.
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ scripts: { test: 'exit 1' } }));
    });

    it('asks for a complete reply and never saves an empty retry', async () => {
      mocks.replies = [FIRST_FIX, ''];

      await fixCommand('a.js', { auto: true, maxIterations: 2, noCommit: true });

      expect(mocks.askAI).toHaveBeenCalledTimes(2);
      expect(mocks.askAI.mock.calls[1][3]).toEqual({ requireComplete: true });
      expect(fs.readFileSync(file, 'utf-8')).toBe('const a = 1;');
    });

    it('asks before applying a retry when --yes is not given', async () => {
      setPipelineOptions({ yes: false });
      mocks.replies = [FIRST_FIX, 'const a = 2;'];
      mocks.prompt
        .mockResolvedValueOnce({ action: 'apply' })
        .mockResolvedValueOnce({ apply: false });

      await fixCommand('a.js', { auto: true, maxIterations: 2, noCommit: true });

      expect(mocks.prompt).toHaveBeenCalledTimes(2);
      expect(fs.readFileSync(file, 'utf-8')).toBe('const a = 1;');
    });

    it('applies a confirmed retry', async () => {
      setPipelineOptions({ yes: false });
      mocks.replies = [FIRST_FIX, 'const a = 2;'];
      mocks.prompt
        .mockResolvedValueOnce({ action: 'apply' })
        .mockResolvedValueOnce({ apply: true });

      await fixCommand('a.js', { auto: true, maxIterations: 2, noCommit: true });

      expect(fs.readFileSync(file, 'utf-8')).toBe('const a = 2;');
    });
  });
});
