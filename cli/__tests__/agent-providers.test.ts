/**
 * `orion agent` must run each task on the provider it assigned (and that
 * provider's model), reject providers it cannot use, and exit non-zero when a
 * task failed, so the saved report names the providers really called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mocks = vi.hoisted(() => ({ streamChat: vi.fn(), getAvailableProviders: vi.fn() }));

vi.mock('../ai-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai-client.js')>()),
  streamChat: mocks.streamChat,
  getAvailableProviders: mocks.getAvailableProviders,
}));
vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>();
  return {
    ...actual,
    loadProjectContext: () => '',
    // The user's configured provider: a free local model.
    readConfig: () => ({ ...actual.readConfig(), provider: 'ollama' }),
  };
});

import { agentCommand } from '../commands/agent.js';

const PROVIDERS = [
  { provider: 'anthropic', model: 'claude-opus-5-5', available: true },
  { provider: 'openai', model: 'gpt-4o', available: false, reason: 'No OPENAI_API_KEY' },
  { provider: 'ollama', model: 'llama3.2', available: true },
];

let tmp: string;
let savedCwd: string;
let logs: string[];

function savedReport() {
  const dir = path.join(tmp, '.orion', 'agents');
  const json = fs.readdirSync(dir).find(f => f.endsWith('.json'))!;
  return JSON.parse(fs.readFileSync(path.join(dir, json), 'utf-8'));
}

beforeEach(() => {
  savedCwd = process.cwd();
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orion-agent-')));
  process.chdir(tmp);
  mocks.getAvailableProviders.mockReset().mockResolvedValue(PROVIDERS);
  mocks.streamChat.mockReset().mockImplementation(async (_messages, callbacks) => {
    callbacks.onComplete?.('done');
    return 'done';
  });
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process, 'exit').mockImplementation(((code: number) => { throw new Error(`exit ${code}`); }) as never);
});

afterEach(() => {
  process.chdir(savedCwd);
  process.exitCode = undefined;
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('orion agent providers', () => {
  it('runs every task on the provider and model named by --provider', async () => {
    await agentCommand(['a', 'b'], { provider: 'ollama' });

    expect(mocks.streamChat).toHaveBeenCalledTimes(2);
    for (const call of mocks.streamChat.mock.calls) {
      expect(call.slice(2, 4)).toEqual(['ollama', 'llama3.2']);
    }
    expect(savedReport().tasks.map((t: { provider: string }) => t.provider)).toEqual(['ollama', 'ollama']);
  });

  it('uses only the configured provider by default, even when paid ones are available', async () => {
    await agentCommand(['a', 'b', 'c'], { parallel: 1 });

    const used = mocks.streamChat.mock.calls.map(call => call.slice(2, 4));
    expect(used).toEqual([['ollama', 'llama3.2'], ['ollama', 'llama3.2'], ['ollama', 'llama3.2']]);
  });

  it('refuses to fall back to another provider when the configured one is not available', async () => {
    mocks.getAvailableProviders.mockResolvedValue(PROVIDERS.map(p => (p.provider === 'ollama' ? { ...p, available: false, reason: 'Ollama not running' } : p)));
    await expect(agentCommand(['a'], {})).rejects.toThrow('exit 1');
    expect(mocks.streamChat).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Provider "ollama" is not available (the configured provider; use --provider or --round-robin to run elsewhere): Ollama not running.');
  });

  it('round-robins tasks across the available providers with --round-robin', async () => {
    await agentCommand(['a', 'b', 'c'], { parallel: 1, roundRobin: true });

    const used = mocks.streamChat.mock.calls.map(call => call.slice(2, 4));
    expect(used).toEqual([
      ['anthropic', 'claude-opus-5-5'],
      ['ollama', 'llama3.2'],
      ['anthropic', 'claude-opus-5-5'],
    ]);
  });

  it('rejects an unknown provider before running anything', async () => {
    await expect(agentCommand(['a'], { provider: 'gemini' })).rejects.toThrow('exit 1');
    expect(mocks.streamChat).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Unknown provider "gemini". Use one of: anthropic, openai, ollama.');
  });

  it('rejects a provider that is not available instead of silently using another', async () => {
    await expect(agentCommand(['a'], { provider: 'openai' })).rejects.toThrow('exit 1');
    expect(mocks.streamChat).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Provider "openai" is not available: No OPENAI_API_KEY.');
  });

  it('exits non-zero when a task fails', async () => {
    mocks.streamChat.mockRejectedValueOnce(new Error('boom'));

    await agentCommand(['a', 'b'], { parallel: 1, save: false });

    expect(process.exitCode).toBe(1);
  });

  it('leaves the exit status alone when every task succeeds', async () => {
    await agentCommand(['a'], { save: false });

    expect(process.exitCode).toBeUndefined();
  });
});
