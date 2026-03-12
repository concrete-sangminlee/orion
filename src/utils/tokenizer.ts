/**
 * Simple token counting utilities for AI features.
 * Provides approximate token counting for OpenAI/Anthropic models
 * without requiring the full tiktoken library.
 */

/* ── Types ─────────────────────────────────────────────── */

export interface TokenCount {
  tokens: number
  characters: number
  words: number
  lines: number
}

export interface TokenBudget {
  maxTokens: number
  usedTokens: number
  remainingTokens: number
  percentage: number
}

export type ModelFamily = 'gpt4' | 'gpt3.5' | 'claude' | 'gemini' | 'llama' | 'mistral'

/* ── Token Counting ────────────────────────────────────── */

/**
 * Approximate token count using a simple heuristic.
 * This is ~85-95% accurate compared to actual BPE tokenization.
 *
 * Rules of thumb:
 * - ~4 characters per token for English text
 * - ~3.5 characters per token for code
 * - Special tokens and non-ASCII increase the ratio
 */
export function countTokens(text: string, model: ModelFamily = 'claude'): number {
  if (!text) return 0

  // Different models have slightly different tokenization
  const charsPerToken = getCharsPerToken(model)

  // Base estimate from character count
  let estimate = text.length / charsPerToken

  // Adjust for code patterns (more tokens for special chars)
  const codeChars = (text.match(/[{}()\[\]<>:;.,!@#$%^&*+=|\\/?~`'"]/g) || []).length
  estimate += codeChars * 0.3

  // Adjust for whitespace-heavy content (indentation)
  const whitespaceRatio = (text.match(/\s/g) || []).length / text.length
  if (whitespaceRatio > 0.3) {
    estimate *= 0.85
  }

  // Adjust for non-ASCII (typically more tokens)
  const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length
  estimate += nonAscii * 0.5

  // Newlines are typically their own token
  const newlines = (text.match(/\n/g) || []).length
  estimate += newlines * 0.3

  return Math.ceil(estimate)
}

/** Get detailed token statistics */
export function getTokenStats(text: string, model: ModelFamily = 'claude'): TokenCount {
  return {
    tokens: countTokens(text, model),
    characters: text.length,
    words: text.split(/\s+/).filter(Boolean).length,
    lines: text.split('\n').length,
  }
}

/** Calculate token budget usage */
export function getTokenBudget(
  usedText: string,
  maxTokens: number,
  model: ModelFamily = 'claude'
): TokenBudget {
  const used = countTokens(usedText, model)
  return {
    maxTokens,
    usedTokens: used,
    remainingTokens: Math.max(0, maxTokens - used),
    percentage: Math.min(100, (used / maxTokens) * 100),
  }
}

/** Check if text fits within token limit */
export function fitsInTokenLimit(text: string, maxTokens: number, model: ModelFamily = 'claude'): boolean {
  return countTokens(text, model) <= maxTokens
}

/* ── Context Window Management ─────────────────────────── */

/** Model context window sizes */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-3-opus': 200000,
  'claude-3.5-sonnet': 200000,
  'claude-3-haiku': 200000,
  'claude-4-opus': 200000,
  'claude-4-sonnet': 200000,
  'gpt-4o': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16385,
  'gemini-pro': 1000000,
  'gemini-1.5-pro': 2000000,
  'llama-3-70b': 8192,
  'llama-3-8b': 8192,
  'mistral-large': 32768,
  'mixtral-8x7b': 32768,
}

export function getContextWindowSize(modelId: string): number {
  // Direct match
  if (MODEL_CONTEXT_WINDOWS[modelId]) return MODEL_CONTEXT_WINDOWS[modelId]

  // Partial match
  const lower = modelId.toLowerCase()
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (lower.includes(key) || key.includes(lower)) return value
  }

  // Default
  return 8192
}

/** Truncate text to fit within token limit */
export function truncateToFit(
  text: string,
  maxTokens: number,
  model: ModelFamily = 'claude',
  strategy: 'end' | 'middle' | 'start' = 'end'
): string {
  if (fitsInTokenLimit(text, maxTokens, model)) return text

  const charsPerToken = getCharsPerToken(model)
  const targetChars = Math.floor(maxTokens * charsPerToken * 0.9) // 90% to be safe

  switch (strategy) {
    case 'end':
      return text.slice(0, targetChars) + '\n...[truncated]'

    case 'start':
      return '[truncated]...\n' + text.slice(-targetChars)

    case 'middle': {
      const half = Math.floor(targetChars / 2)
      return text.slice(0, half) + '\n...[truncated]...\n' + text.slice(-half)
    }
  }
}

/** Split text into chunks that fit within token limit */
export function splitIntoChunks(
  text: string,
  maxTokensPerChunk: number,
  model: ModelFamily = 'claude',
  overlapLines = 3
): string[] {
  const lines = text.split('\n')
  const chunks: string[] = []
  let currentChunk: string[] = []
  let currentTokens = 0

  for (let i = 0; i < lines.length; i++) {
    const lineTokens = countTokens(lines[i], model) + 1 // +1 for newline
    if (currentTokens + lineTokens > maxTokensPerChunk && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'))

      // Keep overlap lines
      const overlap = currentChunk.slice(-overlapLines)
      currentChunk = overlap
      currentTokens = countTokens(overlap.join('\n'), model)
    }

    currentChunk.push(lines[i])
    currentTokens += lineTokens
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'))
  }

  return chunks
}

/* ── Cost Estimation ───────────────────────────────────── */

export interface CostEstimate {
  inputTokens: number
  outputTokens: number
  inputCost: number
  outputCost: number
  totalCost: number
  currency: string
}

/** Pricing per 1M tokens (USD) as of early 2025 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-opus': { input: 15, output: 75 },
  'claude-3.5-sonnet': { input: 3, output: 15 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'gemini-pro': { input: 0.5, output: 1.5 },
}

export function estimateCost(
  inputText: string,
  estimatedOutputTokens: number,
  modelId: string,
  model: ModelFamily = 'claude'
): CostEstimate {
  const inputTokens = countTokens(inputText, model)
  const pricing = MODEL_PRICING[modelId] || { input: 3, output: 15 }

  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (estimatedOutputTokens / 1_000_000) * pricing.output

  return {
    inputTokens,
    outputTokens: estimatedOutputTokens,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency: 'USD',
  }
}

/** Format cost as a readable string */
export function formatCost(cost: number): string {
  if (cost < 0.001) return '< $0.001'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

/** Format token count */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return `${tokens}`
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

/* ── Helpers ───────────────────────────────────────────── */

function getCharsPerToken(model: ModelFamily): number {
  switch (model) {
    case 'gpt4':
    case 'gpt3.5': return 4.0
    case 'claude': return 3.5
    case 'gemini': return 4.0
    case 'llama': return 3.8
    case 'mistral': return 3.8
    default: return 4.0
  }
}
