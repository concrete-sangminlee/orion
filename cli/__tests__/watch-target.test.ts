/**
 * `orion watch <glob>` with chokidar 4, which has no glob support: the command
 * watches the glob's base directory and filters events itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { watch, type FSWatcher } from 'chokidar';
import { globBase, resolveWatchTarget, watchCommand, watchMatchingFiles } from '../commands/watch.js';

const IGNORE = ['node_modules', 'dist', '.git'];

describe('globBase', () => {
  it.each([
    ['*.ts', '.'],
    ['src/**', 'src'],
    ['src/**/*.ts', 'src'],
    ['test/unit/*.spec.ts', 'test/unit'],
    ['/abs/dir/*.ts', '/abs/dir'],
    ['/*.ts', '/'],
    ['src/app.ts', 'src/app.ts'],
  ])('%s -> %s', (pattern, base) => {
    expect(globBase(pattern)).toBe(base);
  });
});

describe('resolveWatchTarget', () => {
  const cwd = path.resolve('/project');

  it('matches a basename glob at any depth and a directory glob under its base', () => {
    const ts = resolveWatchTarget('*.ts', IGNORE, cwd);
    expect(ts.base).toBe('.');
    expect(ts.matches('a.ts')).toBe(true);
    expect(ts.matches(path.join('src', 'deep', 'b.ts'))).toBe(true);
    expect(ts.matches('a.md')).toBe(false);

    const src = resolveWatchTarget('./src/**', IGNORE, cwd);
    expect(src.base).toBe('src');
    expect(src.matches(path.join('src', 'x', 'y.js'))).toBe(true);
    expect(src.matches(path.join('lib', 'y.js'))).toBe(false);
  });

  it('lets `**/` match zero directories, as in the documented `src/**/*.ts`', () => {
    const srcTs = resolveWatchTarget('src/**/*.ts', IGNORE, cwd);
    expect(srcTs.matches(path.join('src', 'app.ts'))).toBe(true);
    expect(srcTs.matches(path.join('src', 'a', 'b', 'c.ts'))).toBe(true);
    expect(srcTs.matches(path.join('lib', 'app.ts'))).toBe(false);
    expect(srcTs.matches(path.join('src', 'app.js'))).toBe(false);

    const anyTs = resolveWatchTarget('**/*.ts', IGNORE, cwd);
    expect(anyTs.matches('root.ts')).toBe(true);
    expect(anyTs.matches(path.join('src', 'a.ts'))).toBe(true);
  });

  it('ignores paths with an ignored segment below cwd only', () => {
    const target = resolveWatchTarget('*.ts', IGNORE, cwd);
    expect(target.ignored(path.join(cwd, 'node_modules', 'pkg', 'index.ts'))).toBe(true);
    expect(target.ignored(path.join('src', 'dist', 'a.ts'))).toBe(true);
    expect(target.ignored(path.join(cwd, 'src', 'a.ts'))).toBe(false);
    // A project that itself lives under a directory named like an ignore entry.
    const nested = resolveWatchTarget('*.ts', IGNORE, path.resolve('/home/dist/project'));
    expect(nested.ignored(path.resolve('/home/dist/project/src/a.ts'))).toBe(false);
  });
});

describe('watchCommand', () => {
  afterEach(() => vi.restoreAllMocks());

  it('exits with an error when the pattern\'s base directory does not exist', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new Error(`exit ${code}`);
    }) as never);

    await expect(watchCommand('no-such-dir-for-orion-watch/**')).rejects.toThrow('exit 1');
    expect(exit).toHaveBeenCalledWith(1);
  }, 3_000);
});

describe('watchMatchingFiles (real chokidar)', () => {
  let tmp: string;
  let watcher: FSWatcher | undefined;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orion-watch-')));
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.mkdirSync(path.join(tmp, 'node_modules'));
  });

  afterEach(async () => {
    await watcher?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports added and changed files that match a glob, and nothing else', async () => {
    const events: string[] = [];
    let seen: () => void = () => {};
    const done = new Promise<void>(resolve => { seen = resolve; });
    const target = resolveWatchTarget('*.ts', IGNORE, tmp);

    watcher = watchMatchingFiles(watch, target, tmp, (filePath, event) => {
      events.push(`${event}:${filePath.replace(/\\/g, '/')}`);
      if (events.some(e => e.startsWith('change:'))) seen();
    });
    await new Promise<void>(resolve => watcher!.on('ready', () => resolve()));

    fs.writeFileSync(path.join(tmp, 'node_modules', 'dep.ts'), 'ignored');
    fs.writeFileSync(path.join(tmp, 'notes.md'), 'not a match');
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), 'one');
    await new Promise(resolve => setTimeout(resolve, 700));
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), 'two');
    await Promise.race([done, new Promise(resolve => setTimeout(resolve, 4000))]);

    expect(events).toContain('add:src/a.ts');
    expect(events).toContain('change:src/a.ts');
    expect(events.filter(e => !e.endsWith(':src/a.ts'))).toEqual([]);
  }, 10_000);
});
