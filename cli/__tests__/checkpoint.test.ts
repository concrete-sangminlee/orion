import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;

function setupTmpProject() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-checkpoint-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
}

function teardownTmpProject() {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

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

describe('checkpoint', () => {
  beforeEach(() => {
    setupTmpProject();
  });

  afterEach(() => {
    teardownTmpProject();
  });

  async function loadCheckpoint() {
    return await import('../checkpoint.js');
  }

  // ── createCheckpoint ──────────────────────────────────────────────────────

  describe('createCheckpoint', () => {
    it('returns a string checkpoint ID', async () => {
      const { createCheckpoint } = await loadCheckpoint();
      const f = createSampleFile('foo.txt', 'hello');
      const id = createCheckpoint('test checkpoint', [f]);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('saves a JSON file in .orion/checkpoints/', async () => {
      const { createCheckpoint } = await loadCheckpoint();
      const f = createSampleFile('bar.txt', 'world');
      const id = createCheckpoint('my cp', [f]);

      const cpDir = path.join(tmpDir, '.orion', 'checkpoints');
      const cpFile = path.join(cpDir, `${id}.json`);
      expect(fs.existsSync(cpFile)).toBe(true);
    });

    it('records file content for existing files', async () => {
      const { createCheckpoint } = await loadCheckpoint();
      const content = 'line1\nline2';
      const f = createSampleFile('existing.txt', content);
      const id = createCheckpoint('capture', [f]);

      const cpDir = path.join(tmpDir, '.orion', 'checkpoints');
      const record = JSON.parse(fs.readFileSync(path.join(cpDir, `${id}.json`), 'utf-8'));

      expect(record.files.length).toBe(1);
      expect(record.files[0].content).toBe(content);
      expect(record.files[0].existed).toBe(true);
    });

    it('records existed=false for non-existent files', async () => {
      const { createCheckpoint } = await loadCheckpoint();
      const fakePath = path.join(tmpDir, 'does-not-exist.txt');
      const id = createCheckpoint('new file marker', [fakePath]);

      const cpDir = path.join(tmpDir, '.orion', 'checkpoints');
      const record = JSON.parse(fs.readFileSync(path.join(cpDir, `${id}.json`), 'utf-8'));

      expect(record.files.length).toBe(1);
      expect(record.files[0].existed).toBe(false);
      expect(record.files[0].content).toBe('');
    });

    it('captures multiple files in one checkpoint', async () => {
      const { createCheckpoint } = await loadCheckpoint();
      const f1 = createSampleFile('a.txt', 'aaa');
      const f2 = createSampleFile('b.txt', 'bbb');
      const f3 = path.join(tmpDir, 'c.txt'); // does not exist

      const id = createCheckpoint('multi', [f1, f2, f3]);

      const cpDir = path.join(tmpDir, '.orion', 'checkpoints');
      const record = JSON.parse(fs.readFileSync(path.join(cpDir, `${id}.json`), 'utf-8'));

      expect(record.files.length).toBe(3);
      expect(record.description).toBe('multi');
    });

    it('stores timestamp and description in the record', async () => {
      const { createCheckpoint } = await loadCheckpoint();
      const f = createSampleFile('ts.txt', 'x');
      const before = new Date().toISOString();
      const id = createCheckpoint('desc-test', [f]);
      const after = new Date().toISOString();

      const cpDir = path.join(tmpDir, '.orion', 'checkpoints');
      const record = JSON.parse(fs.readFileSync(path.join(cpDir, `${id}.json`), 'utf-8'));

      expect(record.description).toBe('desc-test');
      expect(record.timestamp >= before).toBe(true);
      expect(record.timestamp <= after).toBe(true);
    });
  });

  // ── listCheckpoints ───────────────────────────────────────────────────────

  describe('listCheckpoints', () => {
    it('returns an empty array when no checkpoints exist', async () => {
      const { listCheckpoints } = await loadCheckpoint();
      expect(listCheckpoints()).toEqual([]);
    });

    it('returns all checkpoints that were created', async () => {
      const { createCheckpoint, listCheckpoints } = await loadCheckpoint();
      const f = createSampleFile('list.txt', 'data');

      createCheckpoint('first', [f]);
      createCheckpoint('second', [f]);

      const cps = listCheckpoints();
      expect(cps.length).toBe(2);
    });

    it('returns checkpoints sorted newest first', async () => {
      const { createCheckpoint, listCheckpoints } = await loadCheckpoint();
      const f = createSampleFile('sort.txt', 'v');

      createCheckpoint('older', [f]);
      createCheckpoint('newer', [f]);

      const cps = listCheckpoints();
      expect(cps[0].timestamp.getTime()).toBeGreaterThanOrEqual(cps[1].timestamp.getTime());
    });

    it('each entry has id, timestamp, description, and files', async () => {
      const { createCheckpoint, listCheckpoints } = await loadCheckpoint();
      const f = createSampleFile('shape.txt', 'content');
      createCheckpoint('shape test', [f]);

      const cps = listCheckpoints();
      expect(cps.length).toBe(1);

      const cp = cps[0];
      expect(typeof cp.id).toBe('string');
      expect(cp.timestamp instanceof Date).toBe(true);
      expect(cp.description).toBe('shape test');
      expect(Array.isArray(cp.files)).toBe(true);
    });
  });

  // ── deleteCheckpoint ──────────────────────────────────────────────────────

  describe('deleteCheckpoint', () => {
    it('removes the checkpoint JSON file', async () => {
      const { createCheckpoint, deleteCheckpoint, listCheckpoints } = await loadCheckpoint();
      const f = createSampleFile('del.txt', 'bye');
      const id = createCheckpoint('to delete', [f]);

      expect(listCheckpoints().length).toBe(1);

      deleteCheckpoint(id);

      expect(listCheckpoints().length).toBe(0);
    });

    it('throws when the checkpoint does not exist', async () => {
      const { deleteCheckpoint } = await loadCheckpoint();
      expect(() => deleteCheckpoint('nonexistent-id')).toThrow(/Checkpoint not found/);
    });

    it('only removes the targeted checkpoint', async () => {
      const { createCheckpoint, deleteCheckpoint, listCheckpoints } = await loadCheckpoint();
      const f = createSampleFile('multi.txt', 'x');

      const id1 = createCheckpoint('keep', [f]);
      const id2 = createCheckpoint('remove', [f]);

      expect(listCheckpoints().length).toBe(2);

      deleteCheckpoint(id2);

      const remaining = listCheckpoints();
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe(id1);
    });
  });
});
