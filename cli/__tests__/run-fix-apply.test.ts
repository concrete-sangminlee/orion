/**
 * `orion run --fix` writes whole files the model returns. It must not write a
 * block the reply never finished, must back up what it overwrites, must honour
 * --dry-run, and must exit non-zero when the wrapped command failed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mocks = vi.hoisted(() => ({ reply: '', askAI: vi.fn() }));

vi.mock('inquirer', () => ({ default: { prompt: vi.fn() } }));
vi.mock('../ai-client.js', () => ({ askAI: mocks.askAI }));
vi.mock('../utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils.js')>()),
  loadProjectContext: () => '',
}));

import { parseFixResponse, runCommand } from '../commands/run.js';
import { setPipelineOptions } from '../pipeline.js';

const ORIGINAL = 'export const broken = ;\n';
const FIXED = 'export const broken = 1;';

let tmp: string;
let savedCwd: string;
let logs: string[];

function backups(): string[] {
  const dir = path.join(tmp, '.orion', 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.bak')) : [];
}

beforeEach(() => {
  savedCwd = process.cwd();
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orion-run-fix-')));
  fs.mkdirSync(path.join(tmp, 'src'));
  fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), ORIGINAL);
  process.chdir(tmp);

  mocks.askAI.mockReset().mockImplementation(async (_sys, _user, callbacks) => {
    callbacks.onComplete?.(mocks.reply);
    return mocks.reply;
  });
  setPipelineOptions({ yes: true, dryRun: false, json: false, quiet: false });
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  process.chdir(savedCwd);
  process.exitCode = undefined;
  setPipelineOptions({ yes: false, dryRun: false, json: false });
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('parseFixResponse', () => {
  it('drops a FILE block with no ---END FILE--- and reports it as incomplete', () => {
    const { files, incomplete } = parseFixResponse('---FILE: src/a.ts---\nexport const half', tmp);
    expect(files).toEqual([]);
    expect(incomplete).toEqual(['src/a.ts']);
  });
});

describe('runCommand --fix', () => {
  it('does not write a fix whose FILE block was cut off', async () => {
    mocks.reply = 'Missing value.\n---FILE: src/a.ts---\nexport const bro';

    await runCommand('exit 2', { fix: true });

    expect(fs.readFileSync(path.join(tmp, 'src', 'a.ts'), 'utf-8')).toBe(ORIGINAL);
  });

  it('asks the AI for a complete reply', async () => {
    mocks.reply = 'nothing to change';

    await runCommand('exit 2', { fix: true });

    expect(mocks.askAI.mock.calls[0][3]).toEqual({ requireComplete: true });
  });

  it('backs up the original before overwriting it and shows a diff', async () => {
    mocks.reply = `---FILE: src/a.ts---\n${FIXED}\n---END FILE---`;

    await runCommand('exit 2', { fix: true });

    expect(fs.readFileSync(path.join(tmp, 'src', 'a.ts'), 'utf-8')).toBe(FIXED);
    const [bak] = backups();
    expect(bak).toBeDefined();
    expect(fs.readFileSync(path.join(tmp, '.orion', 'backups', bak), 'utf-8')).toBe(ORIGINAL);
    expect(logs.join('\n')).toContain(`+ ${FIXED}`);
  });

  it('writes nothing under --dry-run', async () => {
    setPipelineOptions({ dryRun: true });
    mocks.reply = `---FILE: src/a.ts---\n${FIXED}\n---END FILE---`;

    await runCommand('exit 2', { fix: true });

    expect(fs.readFileSync(path.join(tmp, 'src', 'a.ts'), 'utf-8')).toBe(ORIGINAL);
    expect(backups()).toEqual([]);
  });

  it('reports only the fixes it actually wrote', async () => {
    setPipelineOptions({ json: true });
    mocks.reply = [
      `---FILE: src/a.ts---\n${FIXED}\n---END FILE---`,
      '---FILE: ../escape.ts---\npwned\n---END FILE---',
    ].join('\n');

    await runCommand('exit 2', { fix: true });

    const result = logs.map(l => { try { return JSON.parse(l); } catch { return null; } })
      .find(j => j?.type === 'run_result');
    expect(result.data.fixesApplied).toBe(1);
    expect(fs.existsSync(path.join(tmp, '..', 'escape.ts'))).toBe(false);
  });
});

describe('runCommand exit status', () => {
  it('exits with the wrapped command\'s status when it fails', async () => {
    mocks.reply = 'Root cause: it exits 3.';

    await runCommand('exit 3');

    expect(process.exitCode).toBe(3);
  });

  it('leaves the exit status alone when the command succeeds', async () => {
    await runCommand('exit 0');

    expect(process.exitCode).toBeUndefined();
    expect(mocks.askAI).not.toHaveBeenCalled();
  });
});
