/**
 * Orion CLI - Unified AI Client
 * Supports Anthropic, OpenAI, and Ollama providers
 * Hot-switching between providers with conversation preservation
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import chalk from 'chalk';
import { readConfig, colors } from './utils.js';

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
};

export function getProviderDisplay(provider: AIProvider) {
  return PROVIDER_DISPLAY[provider] || PROVIDER_DISPLAY.ollama;
}

export function resolveModelShortcut(input: string): { provider: AIProvider; model: string } | null {
  const lower = input.toLowerCase().trim();
  return MODEL_SHORTCUTS[lower] || null;
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
      model: config.provider === 'anthropic' && config.model ? config.model : 'claude-sonnet-4-20250514',
      available: !!anthropicKey,
      reason: anthropicKey ? undefined : 'No ANTHROPIC_API_KEY',
    },
    {
      provider: 'openai',
      model: config.provider === 'openai' && config.model ? config.model : 'gpt-4o',
      available: !!openaiKey,
      reason: openaiKey ? undefined : 'No OPENAI_API_KEY',
    },
    {
      provider: 'ollama',
      model: config.provider === 'ollama' && config.model ? config.model : 'llama3.2',
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
  const maxTokens = config.maxTokens || 4096;
  const temperature = config.temperature || 0.7;

  const targetProvider = overrideProvider || config.provider;

  if (targetProvider === 'anthropic' && anthropicKey) {
    return {
      provider: 'anthropic',
      model: overrideModel || config.model || 'claude-sonnet-4-20250514',
      apiKey: anthropicKey,
      maxTokens,
      temperature,
    };
  }

  if (targetProvider === 'openai' && openaiKey) {
    return {
      provider: 'openai',
      model: overrideModel || config.model || 'gpt-4o',
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
        model: overrideModel || config.model || 'llama3.2',
        baseUrl: ollamaHost,
        maxTokens,
        temperature,
      };
    }
  }

  // Auto-detect: try Anthropic first (best quality), then OpenAI, then Ollama
  if (anthropicKey) {
    return { provider: 'anthropic', model: overrideModel || 'claude-sonnet-4-20250514', apiKey: anthropicKey, maxTokens, temperature };
  }
  if (openaiKey) {
    return { provider: 'openai', model: overrideModel || 'gpt-4o', apiKey: openaiKey, maxTokens, temperature };
  }
  const ollamaUp = await isOllamaAvailable(ollamaHost);
  if (ollamaUp) {
    return { provider: 'ollama', model: overrideModel || 'llama3.2', baseUrl: ollamaHost, maxTokens, temperature };
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
): Promise<string> {
  const client = new Anthropic({ apiKey: config.apiKey });

  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  let fullText = '';

  const stream = await client.messages.stream({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: systemMsg?.content || '',
    messages: chatMessages,
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const token = event.delta.text;
      fullText += token;
      callbacks.onToken?.(token);
    }
  }

  callbacks.onComplete?.(fullText);
  return fullText;
}

// ─── Stream via OpenAI ───────────────────────────────────────────────────────

async function streamOpenAI(
  messages: AIMessage[],
  config: ProviderConfig,
  callbacks: AIStreamCallbacks
): Promise<string> {
  const client = new OpenAI({ apiKey: config.apiKey });

  let fullText = '';

  const stream = await client.chat.completions.create({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: true,
  });

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content || '';
    if (token) {
      fullText += token;
      callbacks.onToken?.(token);
    }
  }

  callbacks.onComplete?.(fullText);
  return fullText;
}

// ─── Stream via Ollama ───────────────────────────────────────────────────────

async function streamOllama(
  messages: AIMessage[],
  config: ProviderConfig,
  callbacks: AIStreamCallbacks
): Promise<string> {
  const baseUrl = config.baseUrl || 'http://localhost:11434';
  let fullText = '';

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

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            fullText += data.message.content;
            callbacks.onToken?.(data.message.content);
          }
        } catch { /* skip */ }
      }
    }
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

    const data = await response.json() as { message?: { content?: string } };
    fullText = data.message?.content || '';
    callbacks.onToken?.(fullText);
  }

  callbacks.onComplete?.(fullText);
  return fullText;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function streamChat(
  messages: AIMessage[],
  callbacks: AIStreamCallbacks = {},
  overrideProvider?: AIProvider,
  overrideModel?: string
): Promise<string> {
  const config = await resolveProviderConfig(overrideProvider, overrideModel);

  try {
    switch (config.provider) {
      case 'anthropic':
        return await streamAnthropic(messages, config, callbacks);
      case 'openai':
        return await streamOpenAI(messages, config, callbacks);
      case 'ollama':
        return await streamOllama(messages, config, callbacks);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  } catch (err: any) {
    callbacks.onError?.(err);
    throw err;
  }
}

export async function askAI(
  systemPrompt: string,
  userMessage: string,
  callbacks: AIStreamCallbacks = {}
): Promise<string> {
  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
  return streamChat(messages, callbacks);
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
