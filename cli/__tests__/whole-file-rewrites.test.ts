/**
 * format / docs / translate --apply also replace a file with the model's
 * reply. They must ask for a complete reply: the mocked client below behaves
 * like the real one, returning a reply cut off at max_tokens unless the caller
 * sets requireComplete, in which case it rejects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mocks = vi.hoisted(() => ({ reply: '', askAI: vi.fn() }));

vi.mock('inquirer', () => ({ default: { prompt: vi.fn() } }));
vi.mock('readline', () => ({
  createInterface: () => ({ question: (_q: string, answer: (a: string) => void) => answer('y'), close() {} }),
}));
vi.mock('../ai-client.js', () => ({ askAI: mocks.askAI }));
vi.mock('../utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils.js')>()),
  loadProjectContext: () => '',
}));

import { formatCommand } from '../commands/format.js';
import { docsCommand } from '../commands/docs.js';
import { translateCommand } from '../commands/translate.js';
import { setPipelineOptions } from '../pipeline.js';

const ORIGINAL = '// a comment\nexport function add(a, b) {\n  return a + b;\n}\n';
const TRUNCATED = '// un comentario\nexport function add(a, b) {\n  ret';

let tmp: string;
let savedCwd: string;
let file: string;

class ExitError extends Error {}

/** Run a command; process.exit (mocked to throw, as the real one never returns) ends it. */
async function run(command: Promise<void>): Promise<void> {
  await command.catch((err) => { if (!(err instanceof ExitError)) throw err; });
}

beforeEach(() => {
  savedCwd = process.cwd();
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orion-rewrite-')));
  fs.mkdirSync(path.join(tmp, 'src'));
  file = path.join(tmp, 'src', 'a.js');
  fs.writeFileSync(file, ORIGINAL);
  process.chdir(tmp);

  mocks.reply = TRUNCATED;
  mocks.askAI.mockReset().mockImplementation(async (_sys, _user, callbacks, options) => {
    if (options?.requireComplete && mocks.reply === TRUNCATED) {
      throw new Error('The AI response hit the 4096-token output limit and is incomplete');
    }
    callbacks.onComplete?.(mocks.reply);
    return mocks.reply;
  });
  setPipelineOptions({ yes: true, dryRun: false, json: false, quiet: true });
  vi.spyOn(process, 'exit').mockImplementation(((code: number) => { throw new ExitError(`exit ${code}`); }) as never);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  process.chdir(savedCwd);
  setPipelineOptions({ yes: false, quiet: false });
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('whole-file rewrites refuse a truncated reply', () => {
  it('orion format <file>', async () => {
    await run(formatCommand('src/a.js'));
    expect(fs.readFileSync(file, 'utf-8')).toBe(ORIGINAL);
  });

  it('orion format <dir> (writes without a prompt)', async () => {
    await run(formatCommand('src'));
    expect(fs.readFileSync(file, 'utf-8')).toBe(ORIGINAL);
  });

  it('orion format <dir> does not empty a file on an empty reply', async () => {
    mocks.reply = '';
    await run(formatCommand('src'));
    expect(fs.readFileSync(file, 'utf-8')).toBe(ORIGINAL);
  });

  it('orion docs <file>', async () => {
    await run(docsCommand('src/a.js'));
    expect(fs.readFileSync(file, 'utf-8')).toBe(ORIGINAL);
  });

  it('orion translate <file> --apply', async () => {
    await run(translateCommand('src/a.js', { to: 'spanish', apply: true }));
    expect(fs.readFileSync(file, 'utf-8')).toBe(ORIGINAL);
  });
});
