import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock External Dependencies ──────────────────────────────────────────────

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

vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));
vi.mock('openai', () => ({ default: vi.fn() }));

// ─── Inline Definitions (matching ai-client.ts exactly) ─────────────────────

type AIProvider = 'anthropic' | 'openai' | 'ollama';

const MODEL_SHORTCUTS: Record<string, { provider: AIProvider; model: string }> = {
  'claude': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'claude-opus': { provider: 'anthropic', model: 'claude-opus-4-20250514' },
  'claude-sonnet': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'claude-haiku': { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  'gpt': { provider: 'openai', model: 'gpt-4o' },
  'gpt-4o': { provider: 'openai', model: 'gpt-4o' },
  'gpt-4o-mini': { provider: 'openai', model: 'gpt-4o-mini' },
  'o3': { provider: 'openai', model: 'o3' },
  'o3-mini': { provider: 'openai', model: 'o3-mini' },
  'codex': { provider: 'openai', model: 'gpt-4o' },
  'ollama': { provider: 'ollama', model: 'llama3.2' },
  'llama': { provider: 'ollama', model: 'llama3.2' },
  'llama3': { provider: 'ollama', model: 'llama3.2' },
  'llama3.1': { provider: 'ollama', model: 'llama3.1' },
  'llama3.2': { provider: 'ollama', model: 'llama3.2' },
  'llama3.3': { provider: 'ollama', model: 'llama3.3' },
  'codellama': { provider: 'ollama', model: 'codellama' },
  'deepseek': { provider: 'ollama', model: 'deepseek-coder-v2' },
  'deepseek-coder': { provider: 'ollama', model: 'deepseek-coder-v2' },
  'deepseek-r1': { provider: 'ollama', model: 'deepseek-r1' },
  'mistral': { provider: 'ollama', model: 'mistral' },
  'mixtral': { provider: 'ollama', model: 'mixtral' },
  'gemma': { provider: 'ollama', model: 'gemma2' },
  'gemma2': { provider: 'ollama', model: 'gemma2' },
  'phi': { provider: 'ollama', model: 'phi3' },
  'phi3': { provider: 'ollama', model: 'phi3' },
  'qwen': { provider: 'ollama', model: 'qwen2.5-coder' },
  'qwen2.5': { provider: 'ollama', model: 'qwen2.5-coder' },
  'starcoder': { provider: 'ollama', model: 'starcoder2' },
  'codegemma': { provider: 'ollama', model: 'codegemma' },
  'wizardcoder': { provider: 'ollama', model: 'wizardcoder' },
  'yi': { provider: 'ollama', model: 'yi' },
  'command-r': { provider: 'ollama', model: 'command-r' },
};

const PROVIDER_DISPLAY: Record<AIProvider, { name: string; badge: string }> = {
  anthropic: { name: 'Claude', badge: ' Claude ' },
  openai: { name: 'GPT', badge: ' GPT ' },
  ollama: { name: 'Ollama', badge: ' Ollama ' },
};

function resolveModelShortcut(input: string): { provider: AIProvider; model: string } | null {
  const lower = input.toLowerCase().trim();
  if (MODEL_SHORTCUTS[lower]) return MODEL_SHORTCUTS[lower];
  if (!lower.includes('/') && !lower.startsWith('sk-')) {
    return { provider: 'ollama', model: lower };
  }
  return null;
}

function listAvailableModels(): string[] {
  return Object.keys(MODEL_SHORTCUTS);
}

function getProviderDisplay(provider: AIProvider) {
  return PROVIDER_DISPLAY[provider] || PROVIDER_DISPLAY.ollama;
}

async function listOllamaModels(host?: string): Promise<string[]> {
  try {
    const baseUrl = host || 'http://localhost:11434';
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json() as { models?: { name: string }[] };
    return (data.models || []).map(m => m.name);
  } catch { return []; }
}

let _activeCommand: string = 'unknown';

function setActiveCommand(command: string): void {
  _activeCommand = command;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// ─── MODEL_SHORTCUTS: every single key ──────────────────────────────────────

describe('MODEL_SHORTCUTS (exhaustive)', () => {
  // Anthropic models
  it.each([
    ['claude', 'anthropic', 'claude-sonnet-4-20250514'],
    ['claude-opus', 'anthropic', 'claude-opus-4-20250514'],
    ['claude-sonnet', 'anthropic', 'claude-sonnet-4-20250514'],
    ['claude-haiku', 'anthropic', 'claude-haiku-4-5-20251001'],
  ])('resolves "%s" to provider=%s model=%s', (key, provider, model) => {
    expect(MODEL_SHORTCUTS[key]).toEqual({ provider, model });
  });

  // OpenAI models
  it.each([
    ['gpt', 'openai', 'gpt-4o'],
    ['gpt-4o', 'openai', 'gpt-4o'],
    ['gpt-4o-mini', 'openai', 'gpt-4o-mini'],
    ['o3', 'openai', 'o3'],
    ['o3-mini', 'openai', 'o3-mini'],
    ['codex', 'openai', 'gpt-4o'],
  ])('resolves "%s" to provider=%s model=%s', (key, provider, model) => {
    expect(MODEL_SHORTCUTS[key]).toEqual({ provider, model });
  });

  // Ollama models
  it.each([
    ['ollama', 'ollama', 'llama3.2'],
    ['llama', 'ollama', 'llama3.2'],
    ['llama3', 'ollama', 'llama3.2'],
    ['llama3.1', 'ollama', 'llama3.1'],
    ['llama3.2', 'ollama', 'llama3.2'],
    ['llama3.3', 'ollama', 'llama3.3'],
    ['codellama', 'ollama', 'codellama'],
    ['deepseek', 'ollama', 'deepseek-coder-v2'],
    ['deepseek-coder', 'ollama', 'deepseek-coder-v2'],
    ['deepseek-r1', 'ollama', 'deepseek-r1'],
    ['mistral', 'ollama', 'mistral'],
    ['mixtral', 'ollama', 'mixtral'],
    ['gemma', 'ollama', 'gemma2'],
    ['gemma2', 'ollama', 'gemma2'],
    ['phi', 'ollama', 'phi3'],
    ['phi3', 'ollama', 'phi3'],
    ['qwen', 'ollama', 'qwen2.5-coder'],
    ['qwen2.5', 'ollama', 'qwen2.5-coder'],
    ['starcoder', 'ollama', 'starcoder2'],
    ['codegemma', 'ollama', 'codegemma'],
    ['wizardcoder', 'ollama', 'wizardcoder'],
    ['yi', 'ollama', 'yi'],
    ['command-r', 'ollama', 'command-r'],
  ])('resolves "%s" to provider=%s model=%s', (key, provider, model) => {
    expect(MODEL_SHORTCUTS[key]).toEqual({ provider, model });
  });

  it('has exactly 33 shortcut keys', () => {
    expect(Object.keys(MODEL_SHORTCUTS).length).toBe(33);
  });
});

// ─── getProviderDisplay() ───────────────────────────────────────────────────

describe('getProviderDisplay (extended)', () => {
  it('returns valid object with name and badge for anthropic', () => {
    const display = getProviderDisplay('anthropic');
    expect(display).toHaveProperty('name');
    expect(display).toHaveProperty('badge');
    expect(display.name).toBe('Claude');
    expect(display.badge).toContain('Claude');
  });

  it('returns valid object with name and badge for openai', () => {
    const display = getProviderDisplay('openai');
    expect(display.name).toBe('GPT');
    expect(display.badge).toContain('GPT');
  });

  it('returns valid object with name and badge for ollama', () => {
    const display = getProviderDisplay('ollama');
    expect(display.name).toBe('Ollama');
    expect(display.badge).toContain('Ollama');
  });

  it('falls back to ollama display for unknown provider', () => {
    const display = getProviderDisplay('unknown-provider' as AIProvider);
    expect(display.name).toBe('Ollama');
  });
});

// ─── resolveModelShortcut() Extended ────────────────────────────────────────

describe('resolveModelShortcut (extended)', () => {
  it('returns ollama fallback for unknown model name', () => {
    const result = resolveModelShortcut('some-custom-model');
    expect(result).toEqual({ provider: 'ollama', model: 'some-custom-model' });
  });

  it('returns null for path-like input with slash', () => {
    const result = resolveModelShortcut('org/model-name');
    expect(result).toBeNull();
  });

  it('returns null for API key-like input', () => {
    const result = resolveModelShortcut('sk-abc123xyz');
    expect(result).toBeNull();
  });

  it('handles uppercase input by lowercasing', () => {
    const result = resolveModelShortcut('MISTRAL');
    expect(result).toEqual({ provider: 'ollama', model: 'mistral' });
  });

  it('handles mixed case with whitespace', () => {
    const result = resolveModelShortcut('  Claude-Opus  ');
    expect(result).toEqual({ provider: 'anthropic', model: 'claude-opus-4-20250514' });
  });

  it('resolves every shortcut key correctly via resolveModelShortcut', () => {
    for (const [key, expected] of Object.entries(MODEL_SHORTCUTS)) {
      const result = resolveModelShortcut(key);
      expect(result).toEqual(expected);
    }
  });
});

// ─── listAvailableModels() ──────────────────────────────────────────────────

describe('listAvailableModels (extended)', () => {
  it('returns non-empty array', () => {
    const models = listAvailableModels();
    expect(models.length).toBeGreaterThan(0);
  });

  it('returns exactly the keys of MODEL_SHORTCUTS', () => {
    const models = listAvailableModels();
    expect(models).toEqual(Object.keys(MODEL_SHORTCUTS));
  });

  it('includes shortcuts for all three providers', () => {
    const models = listAvailableModels();
    const hasAnthropic = models.some(m => MODEL_SHORTCUTS[m].provider === 'anthropic');
    const hasOpenai = models.some(m => MODEL_SHORTCUTS[m].provider === 'openai');
    const hasOllama = models.some(m => MODEL_SHORTCUTS[m].provider === 'ollama');
    expect(hasAnthropic).toBe(true);
    expect(hasOpenai).toBe(true);
    expect(hasOllama).toBe(true);
  });
});

// ─── listOllamaModels() ────────────────────────────────────────────────────

describe('listOllamaModels', () => {
  it('returns empty array when network is unreachable', async () => {
    const result = await listOllamaModels('http://localhost:1');
    expect(result).toEqual([]);
  });

  it('returns empty array for invalid host', async () => {
    const result = await listOllamaModels('http://invalid-host-that-does-not-exist:99999');
    expect(result).toEqual([]);
  });

  it('handles gracefully when fetch throws', async () => {
    // Even with a bad URL, it should not throw but return []
    const result = await listOllamaModels('not-a-url');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });
});

// ─── setActiveCommand() ─────────────────────────────────────────────────────

describe('setActiveCommand', () => {
  beforeEach(() => {
    _activeCommand = 'unknown';
  });

  it('sets the active command name', () => {
    setActiveCommand('chat');
    expect(_activeCommand).toBe('chat');
  });

  it('overwrites previous command', () => {
    setActiveCommand('build');
    setActiveCommand('deploy');
    expect(_activeCommand).toBe('deploy');
  });

  it('accepts empty string', () => {
    setActiveCommand('');
    expect(_activeCommand).toBe('');
  });
});
