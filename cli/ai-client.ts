/**
 * Orion CLI - Unified AI Client
 * Supports Anthropic, OpenAI, and Ollama providers
 * Hot-switching between providers with conversation preservation
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import chalk from 'chalk';
import { readConfig, colors, trackCost, estimateTokens } from './utils.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIStreamCallbacks {
  onToken?: (token: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

export type AIProvider = 'anthropic' | 'openai' | 'ollama';

export interface AIRequestOptions {
  /**
   * Reject a reply the provider cut off at the output-token limit. Commands
   * that save the reply as a whole file set this so a truncated file is never
   * written over the original.
   */
  requireComplete?: boolean;
}

/** What a provider stream produced, and whether it stopped at max tokens. */
interface StreamResult {
  text: string;
  truncated: boolean;
}

interface ProviderConfig {
  provider: AIProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
}

// ─── Provider Display Names & Colors ─────────────────────────────────────────

const PROVIDER_DISPLAY: Record<AIProvider, { name: string; color: (s: string) => string; badge: string }> = {
  anthropic: { name: 'Claude', color: chalk.hex('#D4A574'), badge: chalk.bgHex('#D4A574').black.bold(' Claude ') },
  openai: { name: 'GPT', color: chalk.hex('#74AA9C'), badge: chalk.bgHex('#74AA9C').black.bold(' GPT ') },
  ollama: { name: 'Ollama', color: chalk.hex('#FFFFFF'), badge: chalk.bgWhite.black.bold(' Ollama ') },
};

// ─── Model IDs ───────────────────────────────────────────────────────────────

/** Current Anthropic model IDs (aliases, no date suffix). */
export const ANTHROPIC_MODELS = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
  fable: 'claude-fable-5-1',
} as const;

/** Default model per provider when neither the user nor the config names one. */
export const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: ANTHROPIC_MODELS.opus,
  openai: 'gpt-4o',
  ollama: 'llama3.2',
};

/** Lighter model per cloud provider, used by the chat `/fast` toggle. */
export const FAST_MODELS = {
  anthropic: ANTHROPIC_MODELS.haiku,
  openai: 'gpt-4o-mini',
} as const;

/**
 * Whether an Anthropic model still accepts the sampling parameters
 * (`temperature`, `top_p`, `top_k`). Claude 4.7 and later (Opus 4.7+,
 * Sonnet 5+, Haiku 5+, and the Fable / Mythos lines) reject them or accept
 * only the default value, so they must be omitted for those models. Older
 * models (Claude 3.x, Opus/Sonnet 4.0-4.6, Haiku 4.5) still accept them.
 */
export function anthropicAcceptsSampling(model: string): boolean {
  const id = model.toLowerCase();
  if (/claude-(fable|mythos)\b/.test(id)) return false;
  // Family-first IDs: claude-<family>-<major>[-<minor>][-<yyyymmdd>]. The minor
  // is one or two digits so a date suffix is never mistaken for it.
  const m = /claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(id);
  if (!m) return true;
  const major = Number(m[1]);
  const minor = m[2] !== undefined ? Number(m[2]) : 0;
  return major < 4 || (major === 4 && minor < 7);
}

const MODEL_SHORTCUTS: Record<string, { provider: AIProvider; model: string }> = {
  'claude': { provider: 'anthropic', model: DEFAULT_MODELS.anthropic },
  'claude-opus': { provider: 'anthropic', model: ANTHROPIC_MODELS.opus },
  'claude-sonnet': { provider: 'anthropic', model: ANTHROPIC_MODELS.sonnet },
  'claude-haiku': { provider: 'anthropic', model: ANTHROPIC_MODELS.haiku },
  'claude-fable': { provider: 'anthropic', model: ANTHROPIC_MODELS.fable },
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

export function getProviderDisplay(provider: AIProvider) {
  return PROVIDER_DISPLAY[provider] || PROVIDER_DISPLAY.ollama;
}

export function resolveModelShortcut(input: string): { provider: AIProvider; model: string } | null {
  const lower = input.toLowerCase().trim();
  // Check static shortcuts first
  if (MODEL_SHORTCUTS[lower]) return MODEL_SHORTCUTS[lower];
  // Any unknown name → treat as Ollama model (user can install any model)
  if (!lower.includes('/') && !lower.startsWith('sk-')) {
    return { provider: 'ollama', model: lower };
  }
  return null;
}

/** List Ollama models installed locally */
export async function listOllamaModels(host?: string): Promise<string[]> {
  try {
    const baseUrl = host || 'http://localhost:11434';
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json() as { models?: { name: string }[] };
    return (data.models || []).map(m => m.name);
  } catch { return []; }
}

export function listAvailableModels(): string[] {
  return Object.keys(MODEL_SHORTCUTS);
}

// ─── Ollama Detection ────────────────────────────────────────────────────────

async function isOllamaAvailable(host: string = 'http://localhost:11434'): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${host}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

// ─── Available Providers ─────────────────────────────────────────────────────

export interface AvailableProvider {
  provider: AIProvider;
  model: string;
  available: boolean;
  reason?: string;
}

export async function getAvailableProviders(): Promise<AvailableProvider[]> {
  const config = readConfig();
  const anthropicKey = process.env.ANTHROPIC_API_KEY || config.anthropicApiKey;
  const openaiKey = process.env.OPENAI_API_KEY || config.openaiApiKey;
  const ollamaHost = config.ollamaHost || 'http://localhost:11434';
  const ollamaUp = await isOllamaAvailable(ollamaHost);

  return [
    {
      provider: 'anthropic',
      model: config.provider === 'anthropic' && config.model ? config.model : DEFAULT_MODELS.anthropic,
      available: !!anthropicKey,
      reason: anthropicKey ? undefined : 'No ANTHROPIC_API_KEY',
    },
    {
      provider: 'openai',
      model: config.provider === 'openai' && config.model ? config.model : DEFAULT_MODELS.openai,
      available: !!openaiKey,
      reason: openaiKey ? undefined : 'No OPENAI_API_KEY',
    },
    {
      provider: 'ollama',
      model: config.provider === 'ollama' && config.model ? config.model : DEFAULT_MODELS.ollama,
      available: ollamaUp,
      reason: ollamaUp ? undefined : 'Ollama not running',
    },
  ];
}

// ─── Resolve Provider Config ─────────────────────────────────────────────────

export async function resolveProviderConfig(overrideProvider?: AIProvider, overrideModel?: string): Promise<ProviderConfig> {
  const config = readConfig();

  const anthropicKey = process.env.ANTHROPIC_API_KEY || config.anthropicApiKey;
  const openaiKey = process.env.OPENAI_API_KEY || config.openaiApiKey;
  const ollamaHost = config.ollamaHost || 'http://localhost:11434';
  // `??` so an explicit 0 (e.g. temperature 0 for deterministic output) is kept.
  const maxTokens = config.maxTokens ?? 4096;
  const temperature = config.temperature ?? 0.7;

  const targetProvider = overrideProvider || config.provider;

  if (targetProvider === 'anthropic' && anthropicKey) {
    return {
      provider: 'anthropic',
      model: overrideModel || config.model || DEFAULT_MODELS.anthropic,
      apiKey: anthropicKey,
      maxTokens,
      temperature,
    };
  }

  if (targetProvider === 'openai' && openaiKey) {
    return {
      provider: 'openai',
      model: overrideModel || config.model || DEFAULT_MODELS.openai,
      apiKey: openaiKey,
      maxTokens,
      temperature,
    };
  }

  if (targetProvider === 'ollama') {
    const available = await isOllamaAvailable(ollamaHost);
    if (available) {
      return {
        provider: 'ollama',
        model: overrideModel || config.model || DEFAULT_MODELS.ollama,
        baseUrl: ollamaHost,
        maxTokens,
        temperature,
      };
    }
  }

  // Auto-detect: try Anthropic first (best quality), then OpenAI, then Ollama
  if (anthropicKey) {
    return { provider: 'anthropic', model: overrideModel || DEFAULT_MODELS.anthropic, apiKey: anthropicKey, maxTokens, temperature };
  }
  if (openaiKey) {
    return { provider: 'openai', model: overrideModel || DEFAULT_MODELS.openai, apiKey: openaiKey, maxTokens, temperature };
  }
  const ollamaUp = await isOllamaAvailable(ollamaHost);
  if (ollamaUp) {
    return { provider: 'ollama', model: overrideModel || DEFAULT_MODELS.ollama, baseUrl: ollamaHost, maxTokens, temperature };
  }

  throw new Error(
    `No AI provider available. ` +
    `Set ANTHROPIC_API_KEY, OPENAI_API_KEY, start Ollama, or run orion config.`
  );
}

// ─── Stream via Anthropic ────────────────────────────────────────────────────

async function streamAnthropic(
  messages: AIMessage[],
  config: ProviderConfig,
  callbacks: AIStreamCallbacks
): Promise<StreamResult> {
  const client = new Anthropic({ apiKey: config.apiKey });

  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  let fullText = '';
  let truncated = false;

  const stream = client.messages.stream({
    model: config.model,
    max_tokens: config.maxTokens,
    // Claude 4.7+ rejects sampling parameters; only forward them to older models.
    ...(anthropicAcceptsSampling(config.model) ? { temperature: config.temperature } : {}),
    system: systemMsg?.content || '',
    messages: chatMessages,
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const token = event.delta.text;
      fullText += token;
      callbacks.onToken?.(token);
    } else if (event.type === 'message_delta' && event.delta.stop_reason === 'max_tokens') {
      truncated = true;
    }
  }

  return { text: fullText, truncated };
}

// ─── Stream via OpenAI ───────────────────────────────────────────────────────

async function streamOpenAI(
  messages: AIMessage[],
  config: ProviderConfig,
  callbacks: AIStreamCallbacks
): Promise<StreamResult> {
  const client = new OpenAI({ apiKey: config.apiKey });

  let fullText = '';
  let truncated = false;

  const stream = await client.chat.completions.create({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: true,
  });

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    const token = choice?.delta?.content || '';
    if (token) {
      fullText += token;
      callbacks.onToken?.(token);
    }
    if (choice?.finish_reason === 'length') truncated = true;
  }

  return { text: fullText, truncated };
}

// ─── Stream via Ollama ───────────────────────────────────────────────────────

async function streamOllama(
  messages: AIMessage[],
  config: ProviderConfig,
  callbacks: AIStreamCallbacks
): Promise<StreamResult> {
  const baseUrl = config.baseUrl || 'http://localhost:11434';
  let fullText = '';
  let truncated = false;

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        options: { temperature: config.temperature, num_predict: config.maxTokens },
      }),
    });

    if (!response.ok) throw new Error(`${response.status}`);

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No body');

    const handleLine = (line: string) => {
      try {
        const data = JSON.parse(line);
        if (data.message?.content) {
          fullText += data.message.content;
          callbacks.onToken?.(data.message.content);
        }
        if (data.done_reason === 'length') truncated = true;
      } catch { /* skip */ }
    };

    // A network read can end mid-line; keep the partial line for the next
    // read, or its tokens (or the final done_reason) would be lost.
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      lines.filter(Boolean).forEach(handleLine);
    }
    pending += decoder.decode();
    if (pending.trim()) handleLine(pending);
  } catch {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
        options: { temperature: config.temperature, num_predict: config.maxTokens },
      }),
    });

    if (!response.ok) throw new Error(`Ollama error: ${response.status} ${response.statusText}`);

    const data = await response.json() as { message?: { content?: string }; done_reason?: string };
    fullText = data.message?.content || '';
    truncated = data.done_reason === 'length';
    callbacks.onToken?.(fullText);
  }

  return { text: fullText, truncated };
}

// ─── Public API ──────────────────────────────────────────────────────────────

// ─── Active Command Tracking (for cost attribution) ──────────────────────────

let _activeCommand: string = 'unknown';

/** Set the active command name for cost tracking attribution. */
export function setActiveCommand(command: string): void {
  _activeCommand = command;
}

export async function streamChat(
  messages: AIMessage[],
  callbacks: AIStreamCallbacks = {},
  overrideProvider?: AIProvider,
  overrideModel?: string,
  options: AIRequestOptions = {}
): Promise<string> {
  const config = await resolveProviderConfig(overrideProvider, overrideModel);

  // Estimate input tokens from all messages
  const inputText = messages.map(m => m.content).join('');
  const inputTokens = estimateTokens(inputText);

  try {
    let result: StreamResult;
    switch (config.provider) {
      case 'anthropic':
        result = await streamAnthropic(messages, config, callbacks);
        break;
      case 'openai':
        result = await streamOpenAI(messages, config, callbacks);
        break;
      case 'ollama':
        result = await streamOllama(messages, config, callbacks);
        break;
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }

    // The tokens were spent even if the reply is rejected below.
    const outputTokens = estimateTokens(result.text);
    trackCost(config.provider, config.model, inputTokens, outputTokens, _activeCommand);

    if (result.truncated && options.requireComplete) {
      throw new Error(
        `The AI response hit the ${config.maxTokens}-token output limit and is incomplete, so it was not used. ` +
        'Raise "Max Tokens" with `orion config`, or work on a smaller file.'
      );
    }

    callbacks.onComplete?.(result.text);
    return result.text;
  } catch (err: any) {
    callbacks.onError?.(err);
    throw err;
  }
}

export async function askAI(
  systemPrompt: string,
  userMessage: string,
  callbacks: AIStreamCallbacks = {},
  options: AIRequestOptions = {}
): Promise<string> {
  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
  return streamChat(messages, callbacks, undefined, undefined, options);
}

export async function getProviderInfo(overrideProvider?: AIProvider): Promise<{ provider: AIProvider; model: string }> {
  try {
    const config = await resolveProviderConfig(overrideProvider);
    return { provider: config.provider, model: config.model };
  } catch {
    return { provider: 'ollama', model: 'none' };
  }
}

export function createTerminalStreamCallbacks(): AIStreamCallbacks {
  return {
    onToken(token: string) {
      process.stdout.write(colors.ai(token));
    },
    onComplete() {
      process.stdout.write('\n');
    },
    onError(error: Error) {
      console.error(colors.error(`\nAI Error: ${error.message}`));
    },
  };
}
