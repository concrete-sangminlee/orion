import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercises the real cli/ai-client.ts (not an inline copy) with the SDKs and
// config mocked, so model IDs and request parameters are checked as shipped.

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  anthropicStream: vi.fn(),
  openaiCreate: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: mocks.anthropicStream };
  },
}));

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.openaiCreate } };
  },
}));

vi.mock('../utils.js', () => ({
  readConfig: () => ({ ...mocks.config }),
  trackCost: vi.fn(),
  estimateTokens: (text: string) => Math.ceil(text.length / 4),
  colors: new Proxy({}, { get: () => (s: string) => s }),
}));

import {
  ANTHROPIC_MODELS,
  DEFAULT_MODELS,
  FAST_MODELS,
  anthropicAcceptsSampling,
  getAvailableProviders,
  listAvailableModels,
  resolveModelShortcut,
  resolveProviderConfig,
  streamChat,
} from '../ai-client.js';

function textStream(text: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
    },
  };
}

const savedEnv = { ...process.env };

beforeEach(() => {
  mocks.config = {};
  mocks.anthropicStream.mockReset().mockImplementation(() => textStream('ok'));
  mocks.openaiCreate.mockReset();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.unstubAllGlobals();
});

describe('Claude model shortcuts', () => {
  it.each([
    ['claude', 'claude-opus-5-5'],
    ['claude-opus', 'claude-opus-5-5'],
    ['claude-sonnet', 'claude-sonnet-5-5'],
    ['claude-haiku', 'claude-haiku-5-5'],
    ['claude-fable', 'claude-fable-5-1'],
    ['  Claude-Sonnet ', 'claude-sonnet-5-5'],
  ])('resolves "%s" to %s', (input, model) => {
    expect(resolveModelShortcut(input)).toEqual({ provider: 'anthropic', model });
  });

  it('defaults to Claude Opus 5.5 and uses Haiku 5.5 as the fast model', () => {
    expect(DEFAULT_MODELS.anthropic).toBe('claude-opus-5-5');
    expect(FAST_MODELS.anthropic).toBe('claude-haiku-5-5');
    expect(ANTHROPIC_MODELS).toEqual({
      opus: 'claude-opus-5-5',
      sonnet: 'claude-sonnet-5-5',
      haiku: 'claude-haiku-5-5',
      fable: 'claude-fable-5-1',
    });
  });

  it('never resolves a shortcut to a dated or retired Claude ID', () => {
    for (const name of listAvailableModels()) {
      const resolved = resolveModelShortcut(name);
      if (resolved?.provider !== 'anthropic') continue;
      expect(resolved.model, name).toMatch(/^claude-[a-z]+-\d+(-\d)?$/);
      expect(resolved.model, name).not.toMatch(/-20\d{6}$/);
    }
  });
});

describe('anthropicAcceptsSampling', () => {
  it.each([
    'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-fable-5',
    'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-mythos-5-1',
    'anthropic.claude-opus-5-5', 'claude-opus-6',
  ])('omits temperature for %s', (model) => {
    expect(anthropicAcceptsSampling(model)).toBe(false);
  });

  it.each([
    'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001',
    'claude-sonnet-4-20250514', 'claude-opus-4-1-20250805', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307',
  ])('keeps temperature for %s', (model) => {
    expect(anthropicAcceptsSampling(model)).toBe(true);
  });
});

describe('resolveProviderConfig', () => {
  it('auto-detects Anthropic with the current default model', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    const config = await resolveProviderConfig();
    expect(config).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', maxTokens: 4096, temperature: 0.7 });
  });

  it('keeps an explicit temperature of 0 and an explicit maxTokens', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    mocks.config = { provider: 'anthropic', temperature: 0, maxTokens: 1024 };
    const config = await resolveProviderConfig();
    expect(config.temperature).toBe(0);
    expect(config.maxTokens).toBe(1024);
  });

  it('still uses a model named in the config', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    mocks.config = { provider: 'anthropic', model: 'claude-sonnet-4-6' };
    expect((await resolveProviderConfig()).model).toBe('claude-sonnet-4-6');
  });

  it('reports the current Anthropic default in getAvailableProviders', async () => {
    const providers = await getAvailableProviders();
    expect(providers.find(p => p.provider === 'anthropic')?.model).toBe('claude-opus-5-5');
  });
});

describe('streamChat → Anthropic request', () => {
  const messages = [
    { role: 'system' as const, content: 'sys' },
    { role: 'user' as const, content: 'hi' },
  ];

  it('does not send temperature to Claude Opus 5.5', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    mocks.config = { provider: 'anthropic', temperature: 0.7 };
    const text = await streamChat(messages);

    expect(text).toBe('ok');
    const [request] = mocks.anthropicStream.mock.calls[0];
    expect(request).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 4096, system: 'sys' });
    expect(request).not.toHaveProperty('temperature');
  });

  it('forwards temperature 0 to a model that still accepts it', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    mocks.config = { provider: 'anthropic', temperature: 0 };
    await streamChat(messages, {}, 'anthropic', 'claude-sonnet-4-6');

    const [request] = mocks.anthropicStream.mock.calls[0];
    expect(request).toMatchObject({ model: 'claude-sonnet-4-6', temperature: 0 });
  });
});
