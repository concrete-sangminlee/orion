import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Inline implementations matching utils.ts logic ─────────────────────────

const DEFAULT_CONFIG = {
  provider: 'ollama' as const,
  model: 'llama3.2',
  ollamaHost: 'http://localhost:11434',
  theme: 'dark' as const,
  maxTokens: 4096,
  temperature: 0.7,
};

interface OrionConfig {
  provider?: 'anthropic' | 'openai' | 'ollama';
  model?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  ollamaHost?: string;
  theme?: 'dark' | 'light';
  maxTokens?: number;
  temperature?: number;
}

/**
 * Simulates ensureConfigDir behavior: creates the config directory if missing.
 */
function ensureConfigDir(configDir: string): void {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Simulates readConfig behavior: read + merge with defaults.
 */
function readConfig(configFile: string, configDir: string): OrionConfig {
  ensureConfigDir(configDir);
  if (fs.existsSync(configFile)) {
    try {
      const raw = fs.readFileSync(configFile, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Simulates writeConfig behavior: ensure dir + write JSON.
 */
function writeConfig(config: OrionConfig, configFile: string, configDir: string): void {
  ensureConfigDir(configDir);
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Simulates maskApiKey behavior.
 */
function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '****';
  return key.substring(0, 4) + '****' + key.substring(key.length - 4);
}

/**
 * Simulates loadProjectContext behavior.
 */
function loadProjectContext(globalCtxPath: string, projectCtxPath: string): string {
  let context = '';
  if (fs.existsSync(globalCtxPath)) {
    context += fs.readFileSync(globalCtxPath, 'utf-8') + '\n\n';
  }
  if (fs.existsSync(projectCtxPath)) {
    context += fs.readFileSync(projectCtxPath, 'utf-8') + '\n\n';
  }
  return context;
}

/**
 * Simulates validateModelName behavior.
 */
const KNOWN_MODELS: Record<string, string[]> = {
  anthropic: [
    'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
    'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-20241022',
    'claude-3-haiku-20240307',
  ],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o3', 'o3-mini', 'o1', 'o1-mini'],
  ollama: ['llama3.2', 'llama3.1', 'llama3', 'codellama', 'mistral', 'mixtral', 'phi3', 'gemma2', 'qwen2', 'deepseek-coder'],
};

function validateModelName(model: string, provider?: string): { valid: boolean; suggestion?: string } {
  if (!model || !model.trim()) {
    return { valid: false, suggestion: 'Model name cannot be empty.' };
  }
  if (provider && KNOWN_MODELS[provider]) {
    const known = KNOWN_MODELS[provider];
    if (known.includes(model)) {
      return { valid: true };
    }
    const lower = model.toLowerCase();
    const match = known.find(m => m.toLowerCase().includes(lower) || lower.includes(m.toLowerCase()));
    if (match) {
      return { valid: true, suggestion: `Did you mean "${match}"?` };
    }
    return { valid: true, suggestion: `"${model}" is not a recognized ${provider} model. Proceeding anyway.` };
  }
  return { valid: true };
}

// ─── Test fixtures ───────────────────────────────────────────────────────────

let tmpDir: string;
let configDir: string;
let configFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-config-test-'));
  configDir = path.join(tmpDir, '.orion');
  configFile = path.join(configDir, 'config.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ensureConfigDir', () => {
  it('creates the config directory if it does not exist', () => {
    expect(fs.existsSync(configDir)).toBe(false);
    ensureConfigDir(configDir);
    expect(fs.existsSync(configDir)).toBe(true);
  });

  it('does not throw if the directory already exists', () => {
    fs.mkdirSync(configDir, { recursive: true });
    expect(() => ensureConfigDir(configDir)).not.toThrow();
  });

  it('creates nested directories recursively', () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c');
    ensureConfigDir(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });
});

describe('readConfig', () => {
  it('returns default config when config file does not exist', () => {
    const config = readConfig(configFile, configDir);
    expect(config.provider).toBe('ollama');
    expect(config.model).toBe('llama3.2');
    expect(config.maxTokens).toBe(4096);
    expect(config.temperature).toBe(0.7);
    expect(config.theme).toBe('dark');
    expect(config.ollamaHost).toBe('http://localhost:11434');
  });

  it('returns default config when config file is corrupted JSON', () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configFile, '{{{{not valid json}}}', 'utf-8');
    const config = readConfig(configFile, configDir);
    expect(config.provider).toBe('ollama');
    expect(config.model).toBe('llama3.2');
  });

  it('merges partial config with defaults', () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ provider: 'openai', model: 'gpt-4o' }), 'utf-8');
    const config = readConfig(configFile, configDir);
    expect(config.provider).toBe('openai');
    expect(config.model).toBe('gpt-4o');
    // Defaults preserved
    expect(config.maxTokens).toBe(4096);
    expect(config.temperature).toBe(0.7);
    expect(config.theme).toBe('dark');
  });

  it('reads anthropic config with API key', () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      anthropicApiKey: 'sk-ant-test123',
    }), 'utf-8');
    const config = readConfig(configFile, configDir);
    expect(config.provider).toBe('anthropic');
    expect(config.anthropicApiKey).toBe('sk-ant-test123');
  });

  it('handles empty JSON object by returning all defaults', () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configFile, '{}', 'utf-8');
    const config = readConfig(configFile, configDir);
    expect(config.provider).toBe('ollama');
    expect(config.model).toBe('llama3.2');
    expect(config.maxTokens).toBe(4096);
  });

  it('creates config directory as side effect when directory is missing', () => {
    expect(fs.existsSync(configDir)).toBe(false);
    readConfig(configFile, configDir);
    expect(fs.existsSync(configDir)).toBe(true);
  });
});

describe('writeConfig', () => {
  it('creates config directory and writes config file', () => {
    expect(fs.existsSync(configDir)).toBe(false);
    writeConfig({ provider: 'openai', model: 'gpt-4o' }, configFile, configDir);
    expect(fs.existsSync(configFile)).toBe(true);
  });

  it('writes valid JSON that can be parsed back', () => {
    writeConfig({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' }, configFile, configDir);
    const content = fs.readFileSync(configFile, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.provider).toBe('anthropic');
    expect(parsed.model).toBe('claude-sonnet-4-20250514');
  });

  it('overwrites existing config file', () => {
    writeConfig({ provider: 'ollama', model: 'llama3.2' }, configFile, configDir);
    writeConfig({ provider: 'openai', model: 'gpt-4o' }, configFile, configDir);
    const config = readConfig(configFile, configDir);
    expect(config.provider).toBe('openai');
    expect(config.model).toBe('gpt-4o');
  });
});

describe('maskApiKey', () => {
  it('masks a standard API key (shows first 4 and last 4)', () => {
    expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-1****cdef');
  });

  it('returns **** for empty string', () => {
    expect(maskApiKey('')).toBe('****');
  });

  it('returns **** for short keys (fewer than 8 characters)', () => {
    expect(maskApiKey('abc')).toBe('****');
    expect(maskApiKey('1234567')).toBe('****');
  });

  it('handles exactly 8 character key', () => {
    const result = maskApiKey('12345678');
    expect(result).toBe('1234****5678');
    expect(result.length).toBe(12);
  });

  it('masks long Anthropic-style API keys correctly', () => {
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234';
    const result = maskApiKey(key);
    expect(result.startsWith('sk-a')).toBe(true);
    expect(result.endsWith('1234')).toBe(true);
    expect(result).toContain('****');
  });

  it('masks OpenAI-style API keys correctly', () => {
    const key = 'sk-proj-AbCdEfGhIjKlMnOpQrSt';
    const result = maskApiKey(key);
    expect(result.startsWith('sk-p')).toBe(true);
    expect(result.endsWith('QrSt')).toBe(true);
  });
});

describe('loadProjectContext', () => {
  it('returns empty string when no context files exist', () => {
    const result = loadProjectContext(
      path.join(tmpDir, 'nonexistent-global.md'),
      path.join(tmpDir, 'nonexistent-project.md')
    );
    expect(result).toBe('');
  });

  it('loads global context when only global file exists', () => {
    const globalFile = path.join(tmpDir, 'global-context.md');
    fs.writeFileSync(globalFile, 'Global context content', 'utf-8');
    const result = loadProjectContext(globalFile, path.join(tmpDir, 'nonexistent.md'));
    expect(result).toContain('Global context content');
  });

  it('loads project context when only project file exists', () => {
    const projectFile = path.join(tmpDir, 'project-context.md');
    fs.writeFileSync(projectFile, 'Project context content', 'utf-8');
    const result = loadProjectContext(path.join(tmpDir, 'nonexistent.md'), projectFile);
    expect(result).toContain('Project context content');
  });

  it('combines both global and project context', () => {
    const globalFile = path.join(tmpDir, 'global.md');
    const projectFile = path.join(tmpDir, 'project.md');
    fs.writeFileSync(globalFile, 'GLOBAL', 'utf-8');
    fs.writeFileSync(projectFile, 'PROJECT', 'utf-8');
    const result = loadProjectContext(globalFile, projectFile);
    expect(result).toContain('GLOBAL');
    expect(result).toContain('PROJECT');
    // Global comes before project
    expect(result.indexOf('GLOBAL')).toBeLessThan(result.indexOf('PROJECT'));
  });
});

describe('validateModelName', () => {
  it('rejects empty model name', () => {
    const result = validateModelName('');
    expect(result.valid).toBe(false);
    expect(result.suggestion).toContain('empty');
  });

  it('rejects whitespace-only model name', () => {
    const result = validateModelName('   ');
    expect(result.valid).toBe(false);
  });

  it('validates known anthropic model', () => {
    const result = validateModelName('claude-opus-4-20250514', 'anthropic');
    expect(result.valid).toBe(true);
    expect(result.suggestion).toBeUndefined();
  });

  it('validates known openai model', () => {
    const result = validateModelName('gpt-4o', 'openai');
    expect(result.valid).toBe(true);
  });

  it('validates known ollama model', () => {
    const result = validateModelName('llama3.2', 'ollama');
    expect(result.valid).toBe(true);
  });

  it('accepts unknown model with suggestion when provider is specified', () => {
    const result = validateModelName('my-custom-model', 'anthropic');
    expect(result.valid).toBe(true);
    expect(result.suggestion).toContain('not a recognized');
  });

  it('accepts any model name when no provider is specified', () => {
    const result = validateModelName('anything-goes');
    expect(result.valid).toBe(true);
    expect(result.suggestion).toBeUndefined();
  });
});
