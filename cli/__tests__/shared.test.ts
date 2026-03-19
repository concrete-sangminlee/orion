import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

// Create a reusable identity function for chalk-like color functions
const id = (s: any) => String(s ?? '');

// Mock chalk fully: every property access and function call returns an identity function
vi.mock('chalk', () => {
  const handler: ProxyHandler<any> = {
    get(_t: any, _p: string | symbol) { return chainable; },
    apply(_t: any, _this: any, args: any[]) { return args.length > 0 ? String(args[0] ?? '') : ''; },
  };
  const chainable: any = new Proxy(function () {} as any, handler);
  return { default: chainable };
});

vi.mock('ora', () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

// Mock markdown to avoid its module-level chalk usage
vi.mock('../markdown.js', () => ({
  renderMarkdown: (text: string) => text || '',
  printMarkdown: vi.fn(),
}));

// Mock ai-client
vi.mock('../ai-client.js', () => ({
  askAI: vi.fn(),
}));

// Mock ui module
vi.mock('../ui.js', () => ({
  errorDisplay: (msg: string, fixes?: string[]) => {
    let out = `ERROR: ${msg}`;
    if (fixes) out += '\n' + fixes.join('\n');
    return out;
  },
  palette: new Proxy({}, {
    get() { return (s: any) => String(s ?? ''); },
  }),
}));

// Mock utils.js to provide identity-function versions of all the used exports
// This avoids chalk.hex() calls happening at module scope in utils.ts
vi.mock('../utils.js', async () => {
  const actualFs = await import('node:fs');
  const actualPath = await import('node:path');
  const id = (s: any) => String(s ?? '');
  return {
    colors: new Proxy({}, {
      get() { return id; },
    }),
    startSpinner: vi.fn().mockReturnValue({
      start: vi.fn().mockReturnThis(),
      stop: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    }),
    stopSpinner: vi.fn(),
    readFileContent: (filePath: string) => {
      const resolvedPath = actualPath.resolve(filePath);
      if (!actualFs.existsSync(resolvedPath)) {
        throw new Error(`File not found: ${resolvedPath}`);
      }
      const stat = actualFs.statSync(resolvedPath);
      if (stat.size > 1024 * 1024) {
        throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max 1MB.`);
      }
      const content = actualFs.readFileSync(resolvedPath, 'utf-8');
      // Detect language from extension
      const LANG_MAP: Record<string, string> = {
        '.ts': 'typescript', '.tsx': 'typescript',
        '.js': 'javascript', '.jsx': 'javascript',
        '.py': 'python', '.rs': 'rust', '.go': 'go',
        '.java': 'java', '.c': 'c', '.cpp': 'cpp',
        '.json': 'json', '.md': 'markdown', '.html': 'html',
        '.css': 'css', '.sh': 'bash',
      };
      const ext = actualPath.extname(resolvedPath).toLowerCase();
      const language = LANG_MAP[ext] || 'text';
      return { content, language };
    },
    fileExists: (filePath: string) => actualFs.existsSync(actualPath.resolve(filePath)),
    printError: (text: string) => console.log(`  X ${text}`),
    printInfo: (text: string) => console.log(`  i ${text}`),
    printSuccess: (text: string) => console.log(`  V ${text}`),
    printWarning: (text: string) => console.log(`  ! ${text}`),
    printHeader: vi.fn(),
    printDivider: vi.fn(),
    printKeyValue: vi.fn(),
    printBanner: vi.fn(),
    detectLanguage: (filePath: string) => {
      const LANG_MAP: Record<string, string> = {
        '.ts': 'typescript', '.tsx': 'typescript',
        '.js': 'javascript', '.jsx': 'javascript',
        '.py': 'python', '.rs': 'rust', '.go': 'go',
      };
      const ext = actualPath.extname(filePath).toLowerCase();
      return LANG_MAP[ext] || 'text';
    },
    readConfig: () => ({ provider: 'ollama', model: 'llama3.2' }),
    writeConfig: vi.fn(),
    runGitCommand: vi.fn(),
    isGitRepo: () => true,
    getCurrentDirectoryContext: () => `Current directory: ${process.cwd()}\n`,
    maskApiKey: (key: string) => key ? '****' : '****',
    formatDiff: vi.fn(),
  };
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('shared', () => {
  // ── readAndValidateFile ─────────────────────────────────────────────────────

  describe('readAndValidateFile', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-shared-test-'));
    });

    it('returns null for a file that does not exist', async () => {
      const { readAndValidateFile } = await import('../shared.js');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = readAndValidateFile(path.join(tmpDir, 'nonexistent.ts'));

      expect(result).toBeNull();
      spy.mockRestore();
    });

    it('reads and returns a ValidatedFile for a valid file', async () => {
      const { readAndValidateFile } = await import('../shared.js');

      const filePath = path.join(tmpDir, 'valid.ts');
      fs.writeFileSync(filePath, 'const x = 1;\nconst y = 2;\n', 'utf-8');

      const result = readAndValidateFile(filePath);

      expect(result).not.toBeNull();
      expect(result!.content).toBe('const x = 1;\nconst y = 2;\n');
      expect(result!.language).toBe('typescript');
      expect(result!.lineCount).toBe(3);
      expect(result!.fileName).toBe('valid.ts');
      expect(result!.resolvedPath).toBe(path.resolve(filePath));
    });

    it('returns correct language for .py files', async () => {
      const { readAndValidateFile } = await import('../shared.js');

      const filePath = path.join(tmpDir, 'script.py');
      fs.writeFileSync(filePath, 'print("hello")\n', 'utf-8');

      const result = readAndValidateFile(filePath);

      expect(result).not.toBeNull();
      expect(result!.language).toBe('python');
    });

    it('returns correct lineCount', async () => {
      const { readAndValidateFile } = await import('../shared.js');

      const filePath = path.join(tmpDir, 'lines.js');
      fs.writeFileSync(filePath, 'a\nb\nc\nd\ne', 'utf-8');

      const result = readAndValidateFile(filePath);

      expect(result).not.toBeNull();
      expect(result!.lineCount).toBe(5);
    });

    it('returns fileName as just the basename', async () => {
      const { readAndValidateFile } = await import('../shared.js');

      const nested = path.join(tmpDir, 'sub', 'dir');
      fs.mkdirSync(nested, { recursive: true });
      const filePath = path.join(nested, 'deep.rs');
      fs.writeFileSync(filePath, 'fn main() {}', 'utf-8');

      const result = readAndValidateFile(filePath);

      expect(result).not.toBeNull();
      expect(result!.fileName).toBe('deep.rs');
    });
  });

  // ── printCommandError ───────────────────────────────────────────────────────

  describe('printCommandError', () => {
    it('does not throw', async () => {
      const { printCommandError } = await import('../shared.js');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

      expect(() => {
        printCommandError(new Error('something broke'), 'review');
      }).not.toThrow();

      spy.mockRestore();
    });

    it('does not throw when a suggestion is provided', async () => {
      const { printCommandError } = await import('../shared.js');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

      expect(() => {
        printCommandError(
          new Error('file not found'),
          'edit',
          'Check that the file path is correct.'
        );
      }).not.toThrow();

      spy.mockRestore();
    });

    it('prints output containing the error message', async () => {
      const { printCommandError } = await import('../shared.js');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

      printCommandError(new Error('test error msg'), 'fix');

      expect(spy).toHaveBeenCalled();

      const allOutput = spy.mock.calls.map(c => String(c[0])).join('\n');
      expect(allOutput).toContain('test error msg');

      spy.mockRestore();
    });

    it('includes the command name in help hint', async () => {
      const { printCommandError } = await import('../shared.js');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

      printCommandError(new Error('oops'), 'refactor');

      const allOutput = spy.mock.calls.map(c => String(c[0])).join('\n');
      expect(allOutput).toContain('refactor');

      spy.mockRestore();
    });
  });
});
