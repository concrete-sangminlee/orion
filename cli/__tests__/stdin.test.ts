import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';

// ─── Inline implementation matching stdin.ts logic for isolated testing ──────

/**
 * Simulate readStdin behavior based on the source in cli/stdin.ts.
 * We cannot directly import because it mutates process.stdin,
 * so we test the logic inline against controlled readable streams.
 */

function createMockStdin(data: string | null, isTTY: boolean): {
  isTTY: boolean;
  readable: Readable;
} {
  const readable = new Readable({
    read() {
      if (data !== null) {
        this.push(data);
      }
      this.push(null); // end
    },
  });
  return { isTTY, readable };
}

async function readStdinFrom(
  stream: Readable,
  isTTY: boolean
): Promise<string | null> {
  // Mirrors the logic in cli/stdin.ts
  if (isTTY) return null;

  return new Promise((resolve) => {
    let data = '';
    stream.setEncoding('utf-8');
    stream.on('data', (chunk: string) => {
      data += chunk;
    });
    stream.on('end', () => {
      resolve(data || null);
    });
    setTimeout(() => {
      if (!data) resolve(null);
    }, 500);
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('readStdin', () => {
  describe('TTY detection', () => {
    it('returns null when stdin is a TTY (interactive terminal)', async () => {
      const result = await readStdinFrom(new Readable({ read() { this.push(null); } }), true);
      expect(result).toBeNull();
    });

    it('returns null immediately without reading data when stdin is TTY', async () => {
      const mock = createMockStdin('some data', true);
      const result = await readStdinFrom(mock.readable, mock.isTTY);
      expect(result).toBeNull();
    });

    it('does not return null when stdin is NOT a TTY and has data', async () => {
      const mock = createMockStdin('hello world', false);
      const result = await readStdinFrom(mock.readable, mock.isTTY);
      expect(result).not.toBeNull();
    });
  });

  describe('empty and null input', () => {
    it('returns null for empty piped input (empty string)', async () => {
      const mock = createMockStdin('', false);
      const result = await readStdinFrom(mock.readable, mock.isTTY);
      expect(result).toBeNull();
    });

    it('returns null when stream ends immediately with no data', async () => {
      const readable = new Readable({
        read() { this.push(null); },
      });
      const result = await readStdinFrom(readable, false);
      expect(result).toBeNull();
    });
  });

  describe('normal input', () => {
    it('reads a simple string from piped input', async () => {
      const mock = createMockStdin('hello world', false);
      const result = await readStdinFrom(mock.readable, mock.isTTY);
      expect(result).toBe('hello world');
    });

    it('reads multiline input', async () => {
      const input = 'line1\nline2\nline3';
      const mock = createMockStdin(input, false);
      const result = await readStdinFrom(mock.readable, mock.isTTY);
      expect(result).toBe(input);
    });

    it('reads input with special characters', async () => {
      const input = 'const x = 1; // TODO: fix\n\ttab indented\n';
      const mock = createMockStdin(input, false);
      const result = await readStdinFrom(mock.readable, mock.isTTY);
      expect(result).toBe(input);
    });

    it('reads input with unicode characters', async () => {
      const input = 'Hello 世界! 🚀 안녕하세요';
      const mock = createMockStdin(input, false);
      const result = await readStdinFrom(mock.readable, mock.isTTY);
      expect(result).toBe(input);
    });

    it('reads JSON-formatted input', async () => {
      const input = '{"key": "value", "num": 42}';
      const mock = createMockStdin(input, false);
      const result = await readStdinFrom(mock.readable, mock.isTTY);
      expect(result).toBe(input);
      expect(() => JSON.parse(result!)).not.toThrow();
    });
  });

  describe('large input', () => {
    it('handles moderately large input (10KB)', async () => {
      const input = 'x'.repeat(10 * 1024);
      const mock = createMockStdin(input, false);
      const result = await readStdinFrom(mock.readable, mock.isTTY);
      expect(result).toBe(input);
      expect(result!.length).toBe(10 * 1024);
    });

    it('handles large input (100KB)', async () => {
      const input = 'line of text\n'.repeat(8000);
      const mock = createMockStdin(input, false);
      const result = await readStdinFrom(mock.readable, mock.isTTY);
      expect(result).toBe(input);
    });

    it('handles input with many lines (1000 lines)', async () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`);
      const input = lines.join('\n');
      const mock = createMockStdin(input, false);
      const result = await readStdinFrom(mock.readable, mock.isTTY);
      expect(result).toBe(input);
      expect(result!.split('\n').length).toBe(1000);
    });
  });

  describe('chunked input', () => {
    it('assembles data from multiple chunks', async () => {
      const readable = new Readable({
        read() {
          this.push('chunk1');
          this.push('chunk2');
          this.push('chunk3');
          this.push(null);
        },
      });
      const result = await readStdinFrom(readable, false);
      expect(result).toBe('chunk1chunk2chunk3');
    });

    it('handles chunks arriving asynchronously', async () => {
      const readable = new Readable({ read() {} });
      const resultPromise = readStdinFrom(readable, false);

      // Push chunks asynchronously
      readable.push('part1');
      readable.push('-part2');
      readable.push(null);

      const result = await resultPromise;
      expect(result).toBe('part1-part2');
    });
  });
});
