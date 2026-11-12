import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercises the real cli/ai-client.ts: a reply cut off at max_tokens must be
// rejected when the caller is going to save it as a whole file.

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

import { askAI } from '../ai-client.js';

function iterate<T>(items: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

function anthropicReply(text: string, stopReason: string) {
  return iterate([
    { type: 'content_block_delta', delta: { type: 'text_delta', text } },
    { type: 'message_delta', delta: { stop_reason: stopReason } },
  ]);
}

function openaiReply(text: string, finishReason: string) {
  return iterate([
    { choices: [{ delta: { content: text }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: finishReason }] },
  ]);
}

function ollamaFetch(doneReason: string) {
  const lines = [
    JSON.stringify({ message: { content: 'partial' }, done: false }),
    JSON.stringify({ message: { content: '' }, done: true, done_reason: doneReason }),
  ].join('\n');
  return vi.fn(async (url: string) => {
    if (url.endsWith('/api/tags')) return new Response('{"models":[]}', { status: 200 });
    return new Response(lines, { status: 200 });
  });
}

const savedEnv = { ...process.env };

beforeEach(() => {
  mocks.config = {};
  mocks.anthropicStream.mockReset();
  mocks.openaiCreate.mockReset();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.unstubAllGlobals();
});

describe('askAI truncation guard', () => {
  it('rejects an Anthropic reply that stopped at max_tokens when requireComplete is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    mocks.config = { provider: 'anthropic', maxTokens: 4096 };
    mocks.anthropicStream.mockImplementation(() => anthropicReply('half a fi', 'max_tokens'));
    const onComplete = vi.fn();
    const onError = vi.fn();

    await expect(askAI('sys', 'rewrite', { onComplete, onError }, { requireComplete: true }))
      .rejects.toThrow(/4096-token output limit/);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('still returns a truncated Anthropic reply to callers that did not ask for a complete one', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    mocks.config = { provider: 'anthropic' };
    mocks.anthropicStream.mockImplementation(() => anthropicReply('long answer', 'max_tokens'));

    await expect(askAI('sys', 'chat')).resolves.toBe('long answer');
  });

  it('accepts a complete Anthropic reply', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    mocks.config = { provider: 'anthropic' };
    mocks.anthropicStream.mockImplementation(() => anthropicReply('whole file', 'end_turn'));
    const onComplete = vi.fn();

    await expect(askAI('sys', 'rewrite', { onComplete }, { requireComplete: true })).resolves.toBe('whole file');
    expect(onComplete).toHaveBeenCalledWith('whole file');
  });

  it('rejects an OpenAI reply with finish_reason "length"', async () => {
    process.env.OPENAI_API_KEY = 'sk-oa';
    mocks.config = { provider: 'openai' };
    mocks.openaiCreate.mockResolvedValue(openaiReply('half', 'length'));

    await expect(askAI('sys', 'rewrite', {}, { requireComplete: true })).rejects.toThrow(/incomplete/);
  });

  it('accepts an OpenAI reply with finish_reason "stop"', async () => {
    process.env.OPENAI_API_KEY = 'sk-oa';
    mocks.config = { provider: 'openai' };
    mocks.openaiCreate.mockResolvedValue(openaiReply('done', 'stop'));

    await expect(askAI('sys', 'rewrite', {}, { requireComplete: true })).resolves.toBe('done');
  });

  it('rejects an Ollama reply with done_reason "length"', async () => {
    mocks.config = { provider: 'ollama' };
    vi.stubGlobal('fetch', ollamaFetch('length'));

    await expect(askAI('sys', 'rewrite', {}, { requireComplete: true })).rejects.toThrow(/incomplete/);
  });

  it('reads Ollama lines that a network read split in two', async () => {
    mocks.config = { provider: 'ollama' };
    const body = [
      JSON.stringify({ message: { content: 'const a' }, done: false }),
      JSON.stringify({ message: { content: ' = 1;' }, done: false }),
      JSON.stringify({ message: { content: '' }, done: true, done_reason: 'length' }),
    ].join('\n');
    // Cut inside the second token line and inside the final done line.
    const cuts = [body.indexOf(' = 1;') - 3, body.indexOf('done_reason') + 4];
    const parts = [body.slice(0, cuts[0]), body.slice(cuts[0], cuts[1]), body.slice(cuts[1])];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/api/tags')) return new Response('{"models":[]}', { status: 200 });
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(encoder.encode(part));
          controller.close();
        },
      }), { status: 200 });
    }));

    await expect(askAI('sys', 'chat')).resolves.toBe('const a = 1;');
    await expect(askAI('sys', 'rewrite', {}, { requireComplete: true })).rejects.toThrow(/incomplete/);
  });

  it('accepts an Ollama reply with done_reason "stop"', async () => {
    mocks.config = { provider: 'ollama' };
    vi.stubGlobal('fetch', ollamaFetch('stop'));

    await expect(askAI('sys', 'rewrite', {}, { requireComplete: true })).resolves.toBe('partial');
  });
});
