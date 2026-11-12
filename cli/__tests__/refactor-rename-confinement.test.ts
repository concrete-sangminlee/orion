/**
 * `orion refactor --rename` writes the files the model returns in
 * `===FILE: <path>===` blocks. Those paths are untrusted, so only files that
 * were sent to the model (the ones containing the old name) may be written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mocks = vi.hoisted(() => ({ reply: '', askAI: vi.fn() }));

vi.mock('inquirer', () => ({ default: { prompt: vi.fn() } }));
vi.mock('../ai-client.js', () => ({ askAI: mocks.askAI }));
vi.mock('../backup.js', () => ({ createBackup: vi.fn() }));
vi.mock('../utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils.js')>()),
  loadProjectContext: () => '',
}));

import { confineRenameChanges, refactorCommand } from '../commands/refactor.js';
import { setPipelineOptions } from '../pipeline.js';

let tmp: string;
let srcDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-refactor-'));
  srcDir = path.join(tmp, 'src');
  fs.mkdirSync(srcDir);
  fs.writeFileSync(path.join(srcDir, 'a.ts'), 'export const oldName = 1;');
  fs.writeFileSync(path.join(tmp, 'outside.txt'), 'safe');

  mocks.askAI.mockReset().mockImplementation(async (_sys, _user, callbacks) => {
    callbacks.onComplete?.(mocks.reply);
    return mocks.reply;
  });
  setPipelineOptions({ yes: true, quiet: true, dryRun: false, json: false });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  setPipelineOptions({ yes: false, quiet: false });
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('refactor --rename path confinement', () => {
  it('writes the sent file and refuses traversal, absolute and new-file paths', async () => {
    const absTarget = path.join(tmp, 'abs.txt');
    mocks.reply = [
      '===FILE: a.ts===',
      'export const newName = 1;',
      '===END FILE===',
      '===FILE: ../outside.txt===',
      'pwned',
      '===END FILE===',
      `===FILE: ${absTarget}===`,
      'pwned',
      '===END FILE===',
      '===FILE: brand-new.ts===',
      'pwned',
      '===END FILE===',
    ].join('\n');

    await refactorCommand(srcDir, { rename: ['oldName', 'newName'] });

    expect(fs.readFileSync(path.join(srcDir, 'a.ts'), 'utf-8')).toBe('export const newName = 1;');
    expect(fs.readFileSync(path.join(tmp, 'outside.txt'), 'utf-8')).toBe('safe');
    expect(fs.existsSync(absTarget)).toBe(false);
    expect(fs.existsSync(path.join(srcDir, 'brand-new.ts'))).toBe(false);
  });

  it('asks for a complete reply so a truncated rename is never applied', async () => {
    mocks.reply = '===FILE: a.ts===\nexport const newName = 1;\n===END FILE===';

    await refactorCommand(srcDir, { rename: ['oldName', 'newName'] });

    expect(mocks.askAI.mock.calls[0][3]).toEqual({ requireComplete: true });
  });
});

describe('confineRenameChanges', () => {
  it('keys allowed edits by absolute path and lists refused AI paths', () => {
    const sent = path.join(srcDir, 'a.ts');
    const changes = new Map([
      ['./a.ts', 'x'],
      ['../outside.txt', 'y'],
      ['/etc/passwd', 'z'],
    ]);

    const { allowed, refused } = confineRenameChanges(changes, srcDir, [sent]);

    expect([...allowed.keys()]).toEqual([sent]);
    expect(refused).toEqual(['../outside.txt', '/etc/passwd']);
  });
});

describe('refactor --extract / --simplify', () => {
  it('requires a complete reply and refuses to write an empty one', async () => {
    const file = path.join(srcDir, 'a.ts');
    mocks.reply = '   ';
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await refactorCommand(file, { extract: 'helper' });

    expect(mocks.askAI.mock.calls[0][3]).toEqual({ requireComplete: true });
    expect(fs.readFileSync(file, 'utf-8')).toBe('export const oldName = 1;');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('simplify requires a complete reply', async () => {
    mocks.reply = '[SIMPLIFY] tidy\n---REFACTORED---\nexport const oldName = 1;';

    await refactorCommand(path.join(srcDir, 'a.ts'), { simplify: true });

    expect(mocks.askAI.mock.calls[0][3]).toEqual({ requireComplete: true });
  });

  it('simplify does not empty the file when the code is only a fence', async () => {
    const file = path.join(srcDir, 'a.ts');
    mocks.reply = '[SIMPLIFY] tidy\n---REFACTORED---\n```ts\n```';

    await refactorCommand(file, { simplify: true });

    expect(fs.readFileSync(file, 'utf-8')).toBe('export const oldName = 1;');
  });
});
