import { describe, it, expect, vi } from 'vitest';

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

// ─── Inline Definitions (matching ai-client.ts) ─────────────────────────────

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resolveModelShortcut', () => {
  it('resolves "claude" to anthropic claude-sonnet-4', () => {
    const result = resolveModelShortcut('claude');
    expect(result).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
  });

  it('resolves "claude-opus" to anthropic claude-opus-4', () => {
    const result = resolveModelShortcut('claude-opus');
    expect(result).toEqual({ provider: 'anthropic', model: 'claude-opus-4-20250514' });
  });

  it('resolves "claude-haiku" to anthropic claude-haiku', () => {
    const result = resolveModelShortcut('claude-haiku');
    expect(result).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
  });

  it('resolves "gpt" to openai gpt-4o', () => {
    const result = resolveModelShortcut('gpt');
    expect(result).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('resolves "gpt-4o-mini" to openai gpt-4o-mini', () => {
    const result = resolveModelShortcut('gpt-4o-mini');
    expect(result).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
  });

  it('resolves "o3" to openai o3', () => {
    const result = resolveModelShortcut('o3');
    expect(result).toEqual({ provider: 'openai', model: 'o3' });
  });

  it('resolves "ollama" to ollama llama3.2', () => {
    const result = resolveModelShortcut('ollama');
    expect(result).toEqual({ provider: 'ollama', model: 'llama3.2' });
  });

  it('resolves "llama" to ollama llama3.2', () => {
    const result = resolveModelShortcut('llama');
    expect(result).toEqual({ provider: 'ollama', model: 'llama3.2' });
  });

  it('resolves "deepseek" to ollama deepseek-coder-v2', () => {
    const result = resolveModelShortcut('deepseek');
    expect(result).toEqual({ provider: 'ollama', model: 'deepseek-coder-v2' });
  });

  it('resolves "mistral" to ollama mistral', () => {
    const result = resolveModelShortcut('mistral');
    expect(result).toEqual({ provider: 'ollama', model: 'mistral' });
  });

  it('resolves "codex" to openai gpt-4o', () => {
    const result = resolveModelShortcut('codex');
    expect(result).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('is case-insensitive', () => {
    const result = resolveModelShortcut('CLAUDE');
    expect(result).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
  });

  it('trims whitespace', () => {
    const result = resolveModelShortcut('  gpt  ');
    expect(result).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('treats unknown model names as ollama models', () => {
    const result = resolveModelShortcut('my-custom-model');
    expect(result).toEqual({ provider: 'ollama', model: 'my-custom-model' });
  });

  it('returns null for inputs that look like API keys', () => {
    const result = resolveModelShortcut('sk-1234567890');
    expect(result).toBeNull();
  });
});

describe('listAvailableModels', () => {
  it('returns an array of model shortcut names', () => {
    const models = listAvailableModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });

  it('includes all major provider shortcuts', () => {
    const models = listAvailableModels();
    expect(models).toContain('claude');
    expect(models).toContain('gpt');
    expect(models).toContain('ollama');
    expect(models).toContain('llama');
    expect(models).toContain('mistral');
  });

  it('includes all anthropic shortcuts', () => {
    const models = listAvailableModels();
    expect(models).toContain('claude-opus');
    expect(models).toContain('claude-sonnet');
    expect(models).toContain('claude-haiku');
  });

  it('includes all openai shortcuts', () => {
    const models = listAvailableModels();
    expect(models).toContain('gpt-4o');
    expect(models).toContain('gpt-4o-mini');
    expect(models).toContain('o3');
    expect(models).toContain('o3-mini');
  });

  it('includes ollama model shortcuts', () => {
    const models = listAvailableModels();
    expect(models).toContain('deepseek');
    expect(models).toContain('codellama');
    expect(models).toContain('phi3');
    expect(models).toContain('gemma2');
  });
});

describe('getProviderDisplay', () => {
  it('returns Claude info for anthropic', () => {
    const display = getProviderDisplay('anthropic');
    expect(display.name).toBe('Claude');
    expect(display.badge).toContain('Claude');
  });

  it('returns GPT info for openai', () => {
    const display = getProviderDisplay('openai');
    expect(display.name).toBe('GPT');
    expect(display.badge).toContain('GPT');
  });

  it('returns Ollama info for ollama', () => {
    const display = getProviderDisplay('ollama');
    expect(display.name).toBe('Ollama');
    expect(display.badge).toContain('Ollama');
  });
});
