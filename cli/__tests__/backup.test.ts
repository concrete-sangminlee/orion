import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;

function setupTmpProject() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-backup-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
}

function teardownTmpProject() {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

/**
 * Create a sample file inside the temp directory.
 * Returns the absolute path.
 */
function createSampleFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('backup', () => {
  beforeEach(() => {
    setupTmpProject();
  });

  afterEach(() => {
    teardownTmpProject();
  });

  // We re-import each time so that the module picks up the new cwd.
  async function loadBackup() {
    // Dynamic import to get a fresh module evaluation per test is not needed
    // because the functions read process.cwd() at call time, not import time.
    return await import('../backup.js');
  }

  // ── createBackup ────────────────────────────────────────────────────────────

  describe('createBackup', () => {
    it('creates a .bak file in .orion/backups/', async () => {
      const { createBackup } = await loadBackup();
      const srcFile = createSampleFile('hello.txt', 'Hello World');

      const backupPath = createBackup(srcFile);

      expect(fs.existsSync(backupPath)).toBe(true);
      expect(backupPath).toContain('.orion');
      expect(backupPath).toContain('backups');
      expect(backupPath.endsWith('.bak')).toBe(true);
    });

    it('backup content matches the original file', async () => {
      const { createBackup } = await loadBackup();
      const content = 'line1\nline2\nline3';
      const srcFile = createSampleFile('data.txt', content);

      const backupPath = createBackup(srcFile);
      const backed = fs.readFileSync(backupPath, 'utf-8');

      expect(backed).toBe(content);
    });

    it('creates a .meta sidecar with correct metadata', async () => {
      const { createBackup } = await loadBackup();
      const srcFile = createSampleFile('meta-test.txt', 'meta content');

      const backupPath = createBackup(srcFile);
      const metaPath = backupPath + '.meta';

      expect(fs.existsSync(metaPath)).toBe(true);

      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      expect(meta.originalPath).toBe(path.resolve(srcFile));
      expect(meta.fileName).toBe('meta-test.txt');
      expect(typeof meta.timestamp).toBe('number');
      expect(typeof meta.createdAt).toBe('string');
      expect(meta.size).toBeGreaterThan(0);
    });

    it('throws when the source file does not exist', async () => {
      const { createBackup } = await loadBackup();
      expect(() => createBackup(path.join(tmpDir, 'nonexistent.txt'))).toThrow(
        /Cannot backup: file not found/
      );
    });
  });

  // ── listBackups ─────────────────────────────────────────────────────────────

  describe('listBackups', () => {
    it('returns an empty array when no backups exist', async () => {
      const { listBackups } = await loadBackup();
      const entries = listBackups();
      expect(entries).toEqual([]);
    });

    it('returns entries for all backups created', async () => {
      const { createBackup, listBackups } = await loadBackup();
      const f1 = createSampleFile('a.txt', 'aaa');
      const f2 = createSampleFile('b.txt', 'bbb');

      createBackup(f1);
      createBackup(f2);

      const entries = listBackups();
      expect(entries.length).toBe(2);
    });

    it('entries are sorted newest first', async () => {
      const { createBackup, listBackups } = await loadBackup();
      const f = createSampleFile('order.txt', 'v1');

      createBackup(f);
      // Slight delay to ensure different timestamps
      fs.writeFileSync(f, 'v2', 'utf-8');
      createBackup(f);

      const entries = listBackups();
      expect(entries.length).toBe(2);
      // Newest first
      expect(entries[0].date.getTime()).toBeGreaterThanOrEqual(entries[1].date.getTime());
    });

    it('filters by original file path when specified', async () => {
      const { createBackup, listBackups } = await loadBackup();
      const f1 = createSampleFile('x.txt', 'xxx');
      const f2 = createSampleFile('y.txt', 'yyy');

      createBackup(f1);
      createBackup(f2);

      const filtered = listBackups(f1);
      expect(filtered.length).toBe(1);
      expect(filtered[0].original).toBe(path.resolve(f1));
    });
  });

  // ── getMostRecentBackup ─────────────────────────────────────────────────────

  describe('getMostRecentBackup', () => {
    it('returns null when there are no backups', async () => {
      const { getMostRecentBackup } = await loadBackup();
      expect(getMostRecentBackup()).toBeNull();
    });

    it('returns the latest backup entry', async () => {
      const { createBackup, getMostRecentBackup } = await loadBackup();
      const f = createSampleFile('recent.txt', 'first');
      createBackup(f);

      fs.writeFileSync(f, 'second', 'utf-8');
      const latestPath = createBackup(f);

      const recent = getMostRecentBackup();
      expect(recent).not.toBeNull();
      expect(recent!.path).toBe(latestPath);
    });

    it('filters by file when a path is specified', async () => {
      const { createBackup, getMostRecentBackup } = await loadBackup();
      const f1 = createSampleFile('one.txt', '1');
      const f2 = createSampleFile('two.txt', '2');

      createBackup(f1);
      const f2Backup = createBackup(f2);

      const recent = getMostRecentBackup(f2);
      expect(recent).not.toBeNull();
      expect(recent!.path).toBe(f2Backup);
    });
  });

  // ── cleanOldBackups ─────────────────────────────────────────────────────────

  describe('cleanOldBackups', () => {
    it('returns 0 when no backups directory exists', async () => {
      const { cleanOldBackups } = await loadBackup();
      const removed = cleanOldBackups();
      expect(removed).toBe(0);
    });

    it('removes backups older than the specified age', async () => {
      const { cleanOldBackups, listBackups } = await loadBackup();

      // Manually create a "very old" backup (timestamp from 30 days ago)
      const backupsDir = path.join(tmpDir, '.orion', 'backups');
      fs.mkdirSync(backupsDir, { recursive: true });

      const oldTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const oldBakFile = path.join(backupsDir, `old.${oldTimestamp}.bak`);
      const oldMetaFile = oldBakFile + '.meta';

      fs.writeFileSync(oldBakFile, 'old content', 'utf-8');
      fs.writeFileSync(oldMetaFile, JSON.stringify({
        originalPath: '/fake/old.txt',
        fileName: 'old.txt',
        timestamp: oldTimestamp,
        createdAt: new Date(oldTimestamp).toISOString(),
        size: 11,
      }), 'utf-8');

      // Also create a "recent" backup (from right now)
      const newTimestamp = Date.now();
      const newBakFile = path.join(backupsDir, `new.${newTimestamp}.bak`);
      const newMetaFile = newBakFile + '.meta';

      fs.writeFileSync(newBakFile, 'new content', 'utf-8');
      fs.writeFileSync(newMetaFile, JSON.stringify({
        originalPath: '/fake/new.txt',
        fileName: 'new.txt',
        timestamp: newTimestamp,
        createdAt: new Date(newTimestamp).toISOString(),
        size: 11,
      }), 'utf-8');

      // Clean with default (7 days) - should remove the 30-day-old one
      const removed = cleanOldBackups(7);
      expect(removed).toBe(1);

      // The recent one should still be there
      const remaining = listBackups();
      expect(remaining.length).toBe(1);
    });

    it('does not remove recent backups', async () => {
      const { createBackup, cleanOldBackups, listBackups } = await loadBackup();
      const f = createSampleFile('keep.txt', 'keep me');
      createBackup(f);

      const removed = cleanOldBackups(7);
      expect(removed).toBe(0);

      const remaining = listBackups();
      expect(remaining.length).toBe(1);
    });
  });
});
