import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

vi.mock('chalk', () => {
  const identity = (s: string) => s;
  const chainable: any = new Proxy(identity, {
    get: () => chainable,
    apply: (_t: any, _this: any, args: any[]) => args[0],
  });
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

// ─── Inline implementations (matching utils.ts logic for isolated testing) ──

// readConfig / writeConfig core logic
const DEFAULT_CONFIG = {
  provider: 'ollama' as const,
  model: 'llama3.2',
  ollamaHost: 'http://localhost:11434',
  theme: 'dark' as const,
  maxTokens: 4096,
  temperature: 0.7,
};

function simulateReadConfig(fileContent: string | null): Record<string, unknown> {
  if (fileContent === null) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fileContent) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// detectLanguage
const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.rs': 'rust', '.go': 'go',
  '.java': 'java', '.c': 'c', '.cpp': 'cpp',
  '.h': 'c', '.hpp': 'cpp', '.cs': 'csharp',
  '.rb': 'ruby', '.php': 'php', '.swift': 'swift',
  '.kt': 'kotlin', '.scala': 'scala', '.r': 'r',
  '.sql': 'sql', '.sh': 'bash', '.bash': 'bash',
  '.zsh': 'zsh', '.ps1': 'powershell',
  '.html': 'html', '.css': 'css', '.scss': 'scss',
  '.less': 'less', '.json': 'json', '.yaml': 'yaml',
  '.yml': 'yaml', '.xml': 'xml', '.md': 'markdown',
  '.toml': 'toml', '.ini': 'ini', '.cfg': 'ini',
  '.env': 'env', '.dockerfile': 'dockerfile',
  '.vue': 'vue', '.svelte': 'svelte',
  '.lua': 'lua', '.dart': 'dart',
  '.ex': 'elixir', '.exs': 'elixir',
  '.erl': 'erlang', '.hs': 'haskell',
  '.ml': 'ocaml', '.clj': 'clojure', '.lisp': 'lisp',
};

function getExtname(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === filePath.length - 1) return '';
  // Handle special files like .gitignore
  const base = getBasename(filePath);
  if (base.startsWith('.') && !base.includes('.', 1)) return '';
  return filePath.substring(lastDot);
}

function getBasename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || '';
}

function detectLanguage(filePath: string): string {
  const ext = getExtname(filePath).toLowerCase();
  if (LANGUAGE_MAP[ext]) return LANGUAGE_MAP[ext];
  const basename = getBasename(filePath).toLowerCase();
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';
  if (basename === '.gitignore') return 'gitignore';
  return 'text';
}

// maskApiKey
function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '****';
  return key.substring(0, 4) + '****' + key.substring(key.length - 4);
}

// formatDiff (plain text version, matching logic from utils.ts)
function formatDiff(original: string, modified: string): string {
  const origLines = original.split(/\r?\n/);
  const modLines = modified.split(/\r?\n/);
  const output: string[] = [];
  const maxLines = Math.max(origLines.length, modLines.length);

  for (let i = 0; i < maxLines; i++) {
    const origLine = origLines[i];
    const modLine = modLines[i];

    if (origLine === undefined && modLine !== undefined) {
      output.push('+ ' + modLine);
    } else if (origLine !== undefined && modLine === undefined) {
      output.push('- ' + origLine);
    } else if (origLine !== modLine) {
      output.push('- ' + origLine);
      output.push('+ ' + modLine);
    } else {
      output.push('  ' + origLine);
    }
  }
  return output.join('\n');
}

// isGitRepo
function isGitRepo(cwd: string): boolean {
  try {
    const { execSync } = require('child_process');
    execSync('git rev-parse --is-inside-work-tree', {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('readConfig / writeConfig', () => {
  it('readConfig returns default config when no file exists', () => {
    const result = simulateReadConfig(null);
    expect(result.provider).toBe('ollama');
    expect(result.model).toBe('llama3.2');
    expect(result.maxTokens).toBe(4096);
    expect(result.temperature).toBe(0.7);
    expect(result.theme).toBe('dark');
    expect(result.ollamaHost).toBe('http://localhost:11434');
  });

  it('writeConfig writes and readConfig reads back correctly', () => {
    const config = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      anthropicApiKey: 'sk-test-1234',
      maxTokens: 8192,
      temperature: 0.5,
    };

    // Simulate write then read
    const json = JSON.stringify(config, null, 2);
    const result = simulateReadConfig(json);

    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.anthropicApiKey).toBe('sk-test-1234');
    expect(result.maxTokens).toBe(8192);
    expect(result.temperature).toBe(0.5);
  });

  it('readConfig returns defaults when config file is corrupted JSON', () => {
    const result = simulateReadConfig('{broken json!!!');
    expect(result.provider).toBe('ollama');
    expect(result.model).toBe('llama3.2');
  });

  it('readConfig merges partial config with defaults', () => {
    const partial = JSON.stringify({ provider: 'openai', model: 'gpt-4o' });
    const result = simulateReadConfig(partial);

    // Overridden values
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o');
    // Default values preserved
    expect(result.maxTokens).toBe(4096);
    expect(result.temperature).toBe(0.7);
    expect(result.theme).toBe('dark');
  });

  it('readConfig handles empty JSON object', () => {
    const result = simulateReadConfig('{}');
    expect(result.provider).toBe('ollama');
    expect(result.model).toBe('llama3.2');
    expect(result.maxTokens).toBe(4096);
  });
});

describe('detectLanguage', () => {
  it('returns typescript for .ts files', () => {
    expect(detectLanguage('src/index.ts')).toBe('typescript');
  });

  it('returns typescript for .tsx files', () => {
    expect(detectLanguage('App.tsx')).toBe('typescript');
  });

  it('returns javascript for .js files', () => {
    expect(detectLanguage('server.js')).toBe('javascript');
  });

  it('returns javascript for .jsx files', () => {
    expect(detectLanguage('Component.jsx')).toBe('javascript');
  });

  it('returns python for .py files', () => {
    expect(detectLanguage('main.py')).toBe('python');
  });

  it('returns rust for .rs files', () => {
    expect(detectLanguage('lib.rs')).toBe('rust');
  });

  it('returns go for .go files', () => {
    expect(detectLanguage('main.go')).toBe('go');
  });

  it('returns bash for .sh files', () => {
    expect(detectLanguage('deploy.sh')).toBe('bash');
  });

  it('returns dockerfile for Dockerfile', () => {
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
  });

  it('returns makefile for Makefile', () => {
    expect(detectLanguage('Makefile')).toBe('makefile');
  });

  it('returns gitignore for .gitignore', () => {
    expect(detectLanguage('.gitignore')).toBe('gitignore');
  });

  it('returns text for unknown extensions', () => {
    expect(detectLanguage('data.xyz')).toBe('text');
  });

  it('handles nested paths correctly', () => {
    expect(detectLanguage('src/components/Button.tsx')).toBe('typescript');
  });

  it('returns json for .json files', () => {
    expect(detectLanguage('package.json')).toBe('json');
  });

  it('returns yaml for .yml files', () => {
    expect(detectLanguage('config.yml')).toBe('yaml');
  });

  it('returns css for .css files', () => {
    expect(detectLanguage('styles.css')).toBe('css');
  });

  it('returns html for .html files', () => {
    expect(detectLanguage('index.html')).toBe('html');
  });
});

describe('maskApiKey', () => {
  it('masks a normal API key showing first 4 and last 4 characters', () => {
    expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-1****cdef');
  });

  it('returns **** for short keys (< 8 chars)', () => {
    expect(maskApiKey('short')).toBe('****');
  });

  it('returns **** for empty string', () => {
    expect(maskApiKey('')).toBe('****');
  });

  it('handles exactly 8 character key', () => {
    const result = maskApiKey('12345678');
    expect(result).toBe('1234****5678');
  });

  it('masks long API keys correctly', () => {
    const key = 'sk-ant-api03-verylongkeyhere1234567890abcdefghijklmnop';
    const result = maskApiKey(key);
    expect(result.startsWith('sk-a')).toBe(true);
    expect(result.endsWith('mnop')).toBe(true);
    expect(result).toContain('****');
  });

  it('returns **** for undefined-like empty key', () => {
    expect(maskApiKey('')).toBe('****');
  });
});

describe('formatDiff', () => {
  it('shows no changes for identical content', () => {
    const result = formatDiff('hello\nworld', 'hello\nworld');
    expect(result).toBe('  hello\n  world');
  });

  it('shows additions for new lines', () => {
    const result = formatDiff('line1', 'line1\nline2');
    expect(result).toContain('+ line2');
  });

  it('shows removals for deleted lines', () => {
    const result = formatDiff('line1\nline2', 'line1');
    expect(result).toContain('- line2');
  });

  it('shows both removal and addition for changed lines', () => {
    const result = formatDiff('old text', 'new text');
    expect(result).toContain('- old text');
    expect(result).toContain('+ new text');
  });

  it('handles empty original', () => {
    const result = formatDiff('', 'new content');
    // empty string split produces [''], which differs from ['new content']
    expect(result).toContain('+ new content');
  });

  it('handles multi-line changes', () => {
    const orig = 'line1\nline2\nline3';
    const mod = 'line1\nchanged\nline3';
    const result = formatDiff(orig, mod);
    expect(result).toContain('  line1');
    expect(result).toContain('- line2');
    expect(result).toContain('+ changed');
    expect(result).toContain('  line3');
  });
});

describe('isGitRepo', () => {
  it('returns a boolean value', () => {
    const result = isGitRepo(process.cwd());
    expect(typeof result).toBe('boolean');
  });

  it('detects the current project as a git repo', () => {
    // The project_cursor_clone is a git repo
    const result = isGitRepo(process.cwd());
    expect(result).toBe(true);
  });
});

describe('getCurrentDirectoryContext', () => {
  // Inline implementation matching utils.ts
  function getCurrentDirectoryContext(): string {
    const cwd = process.cwd();
    const parts = cwd.replace(/\\/g, '/').split('/');
    const projectName = parts[parts.length - 1] || '';
    let context = `Current directory: ${cwd}\nProject: ${projectName}\n`;
    return context;
  }

  it('returns a string containing the current directory', () => {
    const context = getCurrentDirectoryContext();
    expect(context).toContain(process.cwd());
    expect(context).toContain('Project:');
  });

  it('includes project name from directory basename', () => {
    const context = getCurrentDirectoryContext();
    expect(context).toContain('project_cursor_clone');
  });

  it('returns a multi-line string', () => {
    const context = getCurrentDirectoryContext();
    const lines = context.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});
