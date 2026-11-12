/**
 * `orion test`: failing tests must fail the process, and `--generate` must
 * honour --dry-run, back up a test file it replaces, and never save an empty
 * or truncated reply.
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

import { testCommand } from '../commands/test.js';
import { setPipelineOptions } from '../pipeline.js';

const OLD_TESTS = 'it("old", () => {});\n';
const NEW_TESTS = 'it("new", () => {});';

let tmp: string;
let savedCwd: string;
let testFile: string;

function backups(): string[] {
  const dir = path.join(tmp, '.orion', 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.bak')) : [];
}

beforeEach(() => {
  savedCwd = process.cwd();
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orion-test-cmd-')));
  fs.mkdirSync(path.join(tmp, 'src'));
  fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), 'export const a = 1;\n');
  testFile = path.join(tmp, 'src', 'a.test.ts');
  fs.writeFileSync(testFile, OLD_TESTS);
  process.chdir(tmp);

  mocks.askAI.mockReset().mockImplementation(async (_sys, _user, callbacks) => {
    callbacks.onComplete?.(mocks.reply);
    return mocks.reply;
  });
  setPipelineOptions({ yes: true, dryRun: false, json: false, quiet: false });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  process.chdir(savedCwd);
  process.exitCode = undefined;
  setPipelineOptions({ yes: false, dryRun: false });
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('orion test --generate', () => {
  it('backs up an existing test file before replacing it', async () => {
    mocks.reply = NEW_TESTS;

    await testCommand({ generate: 'src/a.ts' });

    expect(fs.readFileSync(testFile, 'utf-8')).toBe(NEW_TESTS);
    const [bak] = backups();
    expect(bak).toBeDefined();
    expect(fs.readFileSync(path.join(tmp, '.orion', 'backups', bak), 'utf-8')).toBe(OLD_TESTS);
  });

  it('writes nothing under --dry-run', async () => {
    setPipelineOptions({ dryRun: true });
    mocks.reply = NEW_TESTS;

    await testCommand({ generate: 'src/a.ts' });

    expect(fs.readFileSync(testFile, 'utf-8')).toBe(OLD_TESTS);
    expect(backups()).toEqual([]);
  });

  it('asks for a complete reply and does not save an empty one', async () => {
    mocks.reply = '';
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await testCommand({ generate: 'src/a.ts' });

    expect(mocks.askAI.mock.calls[0][3]).toEqual({ requireComplete: true });
    expect(fs.readFileSync(testFile, 'utf-8')).toBe(OLD_TESTS);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('orion test exit status', () => {
  it('exits with the test runner\'s status when tests fail', async () => {
    // A Gradle project whose wrapper fails, so the runner is deterministic.
    // Both wrappers, as Gradle generates them: the shell script and gradlew.bat.
    fs.writeFileSync(path.join(tmp, 'build.gradle'), '');
    fs.writeFileSync(path.join(tmp, 'gradlew'), '#!/bin/sh\nexit 5\n', { mode: 0o755 });
    fs.writeFileSync(path.join(tmp, 'gradlew.bat'), '@exit /b 5\r\n');
    mocks.reply = 'The tests fail.';

    await testCommand();

    expect(mocks.askAI).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(5);
  });
});
