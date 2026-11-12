/**
 * Regression tests for path validation in `orion run --fix`.
 *
 * AI output of the form
 *   ---FILE: <path> ---
 *   ...content...
 *   ---END FILE---
 * gets parsed and (after user confirmation) written to disk. Any path that
 * resolves outside the project root must be flagged so the writer can refuse,
 * otherwise a compromised provider or prompt-injected error stream could ask
 * us to overwrite arbitrary files.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Stub out everything the command module pulls in at import time. We're only
// testing the pure parser/helper exports.
vi.mock('inquirer', () => ({ default: { prompt: vi.fn() } }));
vi.mock('../ai-client.js', () => ({ askAI: vi.fn() }));
vi.mock('../utils.js', async () => {
  const chalkIdentity = (s: string) => s;
  return {
    colors: { file: chalkIdentity, command: chalkIdentity, ai: chalkIdentity },
    printHeader: vi.fn(),
    printInfo: vi.fn(),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    startSpinner: vi.fn(() => ({ stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() })),
    stopSpinner: vi.fn(),
    writeFileContent: vi.fn(),
    loadProjectContext: vi.fn(() => ''),
    getCurrentDirectoryContext: vi.fn(() => ''),
  };
});
vi.mock('../markdown.js', () => ({ renderMarkdown: (s: string) => s }));
vi.mock('../shared.js', () => ({
  createStreamHandler: vi.fn(),
  createSilentStreamHandler: vi.fn(),
}));
vi.mock('../pipeline.js', () => ({
  getPipelineOptions: () => ({ json: false, yes: false }),
  jsonOutput: vi.fn(),
}));
vi.mock('../ui.js', () => ({
  commandHeader: vi.fn(() => ''),
  divider: (s: string) => s,
  palette: new Proxy({}, { get: () => (s: string) => s }) as any,
  statusLine: vi.fn(),
  box: vi.fn(),
}));

const ROOT = path.resolve('/project/root');

describe('isWithinProjectRoot', () => {
  it('accepts relative paths inside the project', async () => {
    const { isWithinProjectRoot } = await import('../commands/run.js');
    expect(isWithinProjectRoot('src/index.ts', ROOT)).toBe(true);
    expect(isWithinProjectRoot('./README.md', ROOT)).toBe(true);
    expect(isWithinProjectRoot('a/b/c.txt', ROOT)).toBe(true);
  });

  it('rejects paths escaping the project root via ..', async () => {
    const { isWithinProjectRoot } = await import('../commands/run.js');
    expect(isWithinProjectRoot('../outside.txt', ROOT)).toBe(false);
    expect(isWithinProjectRoot('../../../etc/passwd', ROOT)).toBe(false);
    expect(isWithinProjectRoot('src/../../escape.txt', ROOT)).toBe(false);
  });

  it('rejects absolute paths', async () => {
    const { isWithinProjectRoot } = await import('../commands/run.js');
    const elsewhere = process.platform === 'win32' ? 'C:\\Windows\\System32\\evil.dll' : '/etc/passwd';
    expect(isWithinProjectRoot(elsewhere, ROOT)).toBe(false);
  });

  it('rejects the project root itself (must be a child path)', async () => {
    const { isWithinProjectRoot } = await import('../commands/run.js');
    expect(isWithinProjectRoot('.', ROOT)).toBe(false);
    expect(isWithinProjectRoot('', ROOT)).toBe(false);
  });

  it('handles paths that normalize back inside the root', async () => {
    const { isWithinProjectRoot } = await import('../commands/run.js');
    expect(isWithinProjectRoot('src/../README.md', ROOT)).toBe(true);
    expect(isWithinProjectRoot('./a/../b/file.ts', ROOT)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('rejects writes through a symlink that leads out of the project', async () => {
    const { isWithinProjectRoot } = await import('../commands/run.js');
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orion-symlink-')));
    try {
      const project = path.join(tmp, 'project');
      const outside = path.join(tmp, 'outside');
      fs.mkdirSync(path.join(project, 'src'), { recursive: true });
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
      fs.symlinkSync(outside, path.join(project, 'linked-dir'));
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(project, 'linked-file.txt'));

      expect(isWithinProjectRoot('linked-dir/new.txt', project)).toBe(false);
      expect(isWithinProjectRoot('linked-dir/deep/new.txt', project)).toBe(false);
      expect(isWithinProjectRoot('linked-file.txt', project)).toBe(false);
      // Ordinary paths, existing or not, are still allowed, also when the
      // project is reached through a symlink itself.
      expect(isWithinProjectRoot('src/new/file.ts', project)).toBe(true);
      fs.symlinkSync(project, path.join(tmp, 'project-link'));
      expect(isWithinProjectRoot('src/new/file.ts', path.join(tmp, 'project-link'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('parseFixResponse', () => {
  it('marks paths inside the project as safe', async () => {
    const { parseFixResponse } = await import('../commands/run.js');
    const response = [
      'Here is the fix:',
      '---FILE: src/foo.ts ---',
      'export const x = 1;',
      '---END FILE---',
    ].join('\n');

    const { files } = parseFixResponse(response, ROOT);
    expect(files).toHaveLength(1);
    expect(files[0].filepath).toBe('src/foo.ts');
    expect(files[0].outsideProject).toBe(false);
    expect(files[0].content).toBe('export const x = 1;');
  });

  it('flags path-traversal targets as outsideProject', async () => {
    const { parseFixResponse } = await import('../commands/run.js');
    const response = [
      '---FILE: ../../../etc/passwd ---',
      'pwned',
      '---END FILE---',
    ].join('\n');

    const { files } = parseFixResponse(response, ROOT);
    expect(files).toHaveLength(1);
    expect(files[0].outsideProject).toBe(true);
  });

  it('flags absolute paths as outsideProject', async () => {
    const { parseFixResponse } = await import('../commands/run.js');
    const evil = process.platform === 'win32' ? 'C:\\Windows\\evil.dll' : '/tmp/evil';
    const response = [
      `---FILE: ${evil} ---`,
      'payload',
      '---END FILE---',
    ].join('\n');

    const { files } = parseFixResponse(response, ROOT);
    expect(files).toHaveLength(1);
    expect(files[0].outsideProject).toBe(true);
  });

  it('extracts command blocks alongside file blocks', async () => {
    const { parseFixResponse } = await import('../commands/run.js');
    const response = [
      '---FILE: a.ts ---',
      'code',
      '---END FILE---',
      '---COMMAND---',
      'npm install',
      '---END COMMAND---',
    ].join('\n');

    const { files, commands } = parseFixResponse(response, ROOT);
    expect(files).toHaveLength(1);
    expect(commands).toEqual([{ command: 'npm install' }]);
  });

  it('returns the surrounding text as explanation', async () => {
    const { parseFixResponse } = await import('../commands/run.js');
    const response = [
      'Root cause: typo on line 5.',
      '',
      '---FILE: src/foo.ts ---',
      'fixed code',
      '---END FILE---',
      '',
      'Run npm test to verify.',
    ].join('\n');

    const { explanation } = parseFixResponse(response, ROOT);
    expect(explanation).toContain('Root cause');
    expect(explanation).toContain('Run npm test');
  });
});
