/**
 * Orion CLI - AI Usage Cost Tracker (inspired by Codex's cost tracking)
 * Tracks estimated costs per AI call based on provider pricing.
 *
 * Usage:
 *   orion cost                    # Show cost summary
 *   orion cost --detailed         # Per-command breakdown
 *   orion cost --reset            # Reset cost tracking
 *   orion cost --budget 10.00     # Set monthly budget alert
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  colors,
  printSuccess,
  printError,
  printInfo,
  printWarning,
  ensureConfigDir,
} from '../utils.js';
import {
  commandHeader,
  divider,
  statusLine,
  palette,
  table as uiTable,
  keyValue,
  progressBar,
  box,
  badge,
} from '../ui.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const COSTS_FILE = path.join(os.homedir(), '.orion', 'costs.json');

// Pricing per 1M tokens (USD) as of 2025
export const PROVIDER_PRICING: Record<string, { input: number; output: number; label: string }> = {
  // Anthropic
  'claude-sonnet-4-20250514':     { input: 3.00,  output: 15.00, label: 'Claude Sonnet 4' },
  'claude-opus-4-20250514':       { input: 15.00, output: 75.00, label: 'Claude Opus 4' },
  'claude-haiku-4-5-20251001':    { input: 0.80,  output: 4.00,  label: 'Claude Haiku 4.5' },
  'claude-3-5-sonnet-20241022':   { input: 3.00,  output: 15.00, label: 'Claude 3.5 Sonnet' },
  'claude-3-haiku-20240307':      { input: 0.25,  output: 1.25,  label: 'Claude 3 Haiku' },
  // OpenAI
  'gpt-4o':       { input: 2.50,  output: 10.00, label: 'GPT-4o' },
  'gpt-4o-mini':  { input: 0.15,  output: 0.60,  label: 'GPT-4o Mini' },
  'gpt-4-turbo':  { input: 10.00, output: 30.00, label: 'GPT-4 Turbo' },
  'gpt-4':        { input: 30.00, output: 60.00, label: 'GPT-4' },
  'gpt-3.5-turbo':{ input: 0.50,  output: 1.50,  label: 'GPT-3.5 Turbo' },
  'o3':           { input: 10.00, output: 40.00, label: 'o3' },
  'o3-mini':      { input: 1.10,  output: 4.40,  label: 'o3-mini' },
  'o1':           { input: 15.00, output: 60.00, label: 'o1' },
  'o1-mini':      { input: 3.00,  output: 12.00, label: 'o1-mini' },
};

// Default pricing for unknown models by provider
const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  anthropic: { input: 3.00, output: 15.00 },
  openai:    { input: 2.50, output: 10.00 },
  ollama:    { input: 0.00, output: 0.00 },
};

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CostEntry {
  timestamp: string;
  provider: string;
  model: string;
  command: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface CostData {
  version: number;
  budget: number | null;
  entries: CostEntry[];
}

// ─── Cost File I/O ──────────────────────────────────────────────────────────

function loadCosts(): CostData {
  const empty: CostData = { version: 1, budget: null, entries: [] };

  if (!fs.existsSync(COSTS_FILE)) return empty;

  try {
    const raw = fs.readFileSync(COSTS_FILE, 'utf-8');
    const data = JSON.parse(raw) as CostData;
    return {
      version: data.version || 1,
      budget: data.budget ?? null,
      entries: Array.isArray(data.entries) ? data.entries : [],
    };
  } catch {
    return empty;
  }
}

function saveCosts(data: CostData): void {
  ensureConfigDir();
  fs.writeFileSync(COSTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Cost Calculation ────────────────────────────────────────────────────────

export function calculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  // Ollama is always free (local)
  if (provider === 'ollama') return 0;

  const pricing = PROVIDER_PRICING[model] || DEFAULT_PRICING[provider] || { input: 0, output: 0 };
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return inputCost + outputCost;
}

// ─── Token Estimation ────────────────────────────────────────────────────────

/**
 * Rough token estimation from text length.
 * Average: ~4 characters per token for English text.
 * This is a heuristic - actual tokenization varies by model.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ─── Track Cost (called from ai-client.ts) ───────────────────────────────────

export function trackCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  command: string = 'unknown'
): void {
  try {
    const data = loadCosts();
    const cost = calculateCost(provider, model, inputTokens, outputTokens);

    data.entries.push({
      timestamp: new Date().toISOString(),
      provider,
      model,
      command,
      inputTokens,
      outputTokens,
      estimatedCost: cost,
    });

    saveCosts(data);

    // Check budget
    if (data.budget !== null && data.budget > 0) {
      const monthTotal = getMonthlyTotal(data);
      if (monthTotal >= data.budget) {
        console.log();
        printWarning(
          colors.warning(`Budget alert: Monthly spending ($${monthTotal.toFixed(4)}) has reached your budget ($${data.budget.toFixed(2)})!`)
        );
      } else if (monthTotal >= data.budget * 0.8) {
        console.log();
        printWarning(
          colors.warning(`Budget warning: Monthly spending ($${monthTotal.toFixed(4)}) is at ${((monthTotal / data.budget) * 100).toFixed(0)}% of budget ($${data.budget.toFixed(2)}).`)
        );
      }
    }
  } catch {
    // Never break the actual command due to cost tracking errors
  }
}

// ─── Aggregation Helpers ─────────────────────────────────────────────────────

function getMonthlyTotal(data: CostData): number {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  return data.entries
    .filter(e => e.timestamp >= monthStart)
    .reduce((sum, e) => sum + e.estimatedCost, 0);
}

function getDailyTotals(data: CostData, days: number = 30): Map<string, number> {
  const totals = new Map<string, number>();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();

  for (const entry of data.entries) {
    if (entry.timestamp < cutoffStr) continue;
    const day = entry.timestamp.split('T')[0];
    totals.set(day, (totals.get(day) || 0) + entry.estimatedCost);
  }

  return totals;
}

function getByProvider(data: CostData): Map<string, { cost: number; calls: number; inputTokens: number; outputTokens: number }> {
  const byProvider = new Map<string, { cost: number; calls: number; inputTokens: number; outputTokens: number }>();

  for (const entry of data.entries) {
    const existing = byProvider.get(entry.provider) || { cost: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
    existing.cost += entry.estimatedCost;
    existing.calls++;
    existing.inputTokens += entry.inputTokens;
    existing.outputTokens += entry.outputTokens;
    byProvider.set(entry.provider, existing);
  }

  return byProvider;
}

function getByCommand(data: CostData): Map<string, { cost: number; calls: number }> {
  const byCommand = new Map<string, { cost: number; calls: number }>();

  for (const entry of data.entries) {
    const existing = byCommand.get(entry.command) || { cost: 0, calls: 0 };
    existing.cost += entry.estimatedCost;
    existing.calls++;
    byCommand.set(entry.command, existing);
  }

  return byCommand;
}

function getByModel(data: CostData): Map<string, { cost: number; calls: number }> {
  const byModel = new Map<string, { cost: number; calls: number }>();

  for (const entry of data.entries) {
    const label = PROVIDER_PRICING[entry.model]?.label || entry.model;
    const existing = byModel.get(label) || { cost: 0, calls: 0 };
    existing.cost += entry.estimatedCost;
    existing.calls++;
    byModel.set(label, existing);
  }

  return byModel;
}

// ─── Display Helpers ─────────────────────────────────────────────────────────

function formatDollars(amount: number): string {
  if (amount === 0) return palette.green('$0.00');
  if (amount < 0.01) return palette.green(`$${amount.toFixed(6)}`);
  if (amount < 1) return palette.yellow(`$${amount.toFixed(4)}`);
  return palette.red(`$${amount.toFixed(2)}`);
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

// ─── Main Command ────────────────────────────────────────────────────────────

export async function costCommand(options: {
  detailed?: boolean;
  reset?: boolean;
  budget?: string;
}): Promise<void> {
  const pipeline = getPipelineOptions();

  // Handle --reset
  if (options.reset) {
    if (fs.existsSync(COSTS_FILE)) {
      const data = loadCosts();
      const budgetBackup = data.budget;
      saveCosts({ version: 1, budget: budgetBackup, entries: [] });
      printSuccess('Cost tracking data has been reset. Budget setting preserved.');
    } else {
      printInfo('No cost data to reset.');
    }
    console.log();
    return;
  }

  // Handle --budget
  if (options.budget) {
    const amount = parseFloat(options.budget);
    if (isNaN(amount) || amount < 0) {
      printError('Budget must be a positive number (e.g., --budget 10.00).');
      process.exit(1);
    }

    const data = loadCosts();
    data.budget = amount;
    saveCosts(data);

    console.log();
    printSuccess(`Monthly budget set to $${amount.toFixed(2)}.`);
    const monthTotal = getMonthlyTotal(data);
    printInfo(`Current month spending: $${monthTotal.toFixed(4)}`);
    if (amount > 0) {
      const pct = Math.min((monthTotal / amount) * 100, 100);
      console.log(progressBar(monthTotal, amount));
      printInfo(`${pct.toFixed(1)}% of budget used.`);
    }
    console.log();
    return;
  }

  // Load data
  const data = loadCosts();

  // JSON output mode
  if (pipeline.json) {
    const byProvider = Object.fromEntries(getByProvider(data));
    const byCommand = Object.fromEntries(getByCommand(data));
    jsonOutput('cost', {
      totalCost: data.entries.reduce((s, e) => s + e.estimatedCost, 0),
      monthlyTotal: getMonthlyTotal(data),
      budget: data.budget,
      totalCalls: data.entries.length,
      byProvider,
      byCommand,
    });
    return;
  }

  // No data yet
  if (data.entries.length === 0) {
    console.log();
    console.log(commandHeader('AI Cost Tracker'));
    console.log();
    printInfo('No AI usage recorded yet. Costs will be tracked automatically.');
    printInfo('Run any AI command (chat, ask, review, etc.) to start tracking.');
    console.log();
    return;
  }

  // Calculate aggregates
  const totalCost = data.entries.reduce((s, e) => s + e.estimatedCost, 0);
  const totalInputTokens = data.entries.reduce((s, e) => s + e.inputTokens, 0);
  const totalOutputTokens = data.entries.reduce((s, e) => s + e.outputTokens, 0);
  const totalCalls = data.entries.length;
  const monthTotal = getMonthlyTotal(data);
  const dailyTotals = getDailyTotals(data, 30);
  const dailyAvg = dailyTotals.size > 0
    ? [...dailyTotals.values()].reduce((s, v) => s + v, 0) / dailyTotals.size
    : 0;

  // Header
  const meta: [string, string][] = [
    ['Total Cost', formatDollars(totalCost)],
    ['This Month', formatDollars(monthTotal)],
    ['Total Calls', String(totalCalls)],
  ];
  if (data.budget !== null) {
    meta.push(['Budget', `$${data.budget.toFixed(2)}/month`]);
  }

  console.log(commandHeader('AI Cost Tracker', meta));
  console.log('');

  // Budget progress bar
  if (data.budget !== null && data.budget > 0) {
    const budgetPct = Math.min((monthTotal / data.budget) * 100, 100);
    console.log(`  ${palette.violet.bold('Monthly Budget')}`);
    console.log(progressBar(monthTotal, data.budget));
    const remaining = Math.max(data.budget - monthTotal, 0);
    console.log(`  ${palette.dim('Remaining:')} ${formatDollars(remaining)} ${palette.dim(`(${budgetPct.toFixed(1)}% used)`)}`);
    console.log('');
  }

  // Summary dashboard
  console.log(divider('Summary'));
  console.log('');
  console.log(keyValue([
    ['Total Spent', formatDollars(totalCost)],
    ['This Month', formatDollars(monthTotal)],
    ['Daily Average', formatDollars(dailyAvg)],
    ['Input Tokens', formatTokens(totalInputTokens)],
    ['Output Tokens', formatTokens(totalOutputTokens)],
    ['Total Calls', String(totalCalls)],
  ]));
  console.log('');

  // Cost by provider
  const byProvider = getByProvider(data);
  if (byProvider.size > 0) {
    console.log(divider('By Provider'));
    console.log('');
    const provHeaders = ['Provider', 'Calls', 'Input Tokens', 'Output Tokens', 'Cost'];
    const provRows = [...byProvider.entries()]
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([prov, d]) => [
        prov.charAt(0).toUpperCase() + prov.slice(1),
        String(d.calls),
        formatTokens(d.inputTokens),
        formatTokens(d.outputTokens),
        formatDollars(d.cost),
      ]);
    console.log(uiTable(provHeaders, provRows));
    console.log('');
  }

  // Cost by model
  const byModel = getByModel(data);
  if (byModel.size > 0) {
    console.log(divider('By Model'));
    console.log('');
    const modelHeaders = ['Model', 'Calls', 'Cost'];
    const modelRows = [...byModel.entries()]
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([model, d]) => [model, String(d.calls), formatDollars(d.cost)]);
    console.log(uiTable(modelHeaders, modelRows));
    console.log('');
  }

  // Detailed: cost by command
  if (options.detailed) {
    const byCommand = getByCommand(data);
    if (byCommand.size > 0) {
      console.log(divider('By Command'));
      console.log('');
      const cmdHeaders = ['Command', 'Calls', 'Cost'];
      const cmdRows = [...byCommand.entries()]
        .sort((a, b) => b[1].cost - a[1].cost)
        .map(([cmd, d]) => [cmd, String(d.calls), formatDollars(d.cost)]);
      console.log(uiTable(cmdHeaders, cmdRows));
      console.log('');
    }

    // Daily breakdown (last 14 days)
    const recentDays = [...dailyTotals.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 14);

    if (recentDays.length > 0) {
      console.log(divider('Daily Costs (Last 14 Days)'));
      console.log('');
      const dayHeaders = ['Date', 'Cost'];
      const dayRows = recentDays.map(([day, cost]) => [day, formatDollars(cost)]);
      console.log(uiTable(dayHeaders, dayRows));
      console.log('');
    }

    // Recent entries (last 10)
    const recentEntries = data.entries.slice(-10).reverse();
    if (recentEntries.length > 0) {
      console.log(divider('Recent Calls'));
      console.log('');
      const entryHeaders = ['Time', 'Provider', 'Model', 'Command', 'Tokens', 'Cost'];
      const entryRows = recentEntries.map(e => {
        const time = e.timestamp.split('T')[1]?.substring(0, 8) || '';
        const date = e.timestamp.split('T')[0] || '';
        const modelLabel = PROVIDER_PRICING[e.model]?.label || e.model;
        const tokens = `${formatTokens(e.inputTokens)}/${formatTokens(e.outputTokens)}`;
        return [
          `${date} ${time}`,
          e.provider,
          modelLabel,
          e.command,
          tokens,
          formatDollars(e.estimatedCost),
        ];
      });
      console.log(uiTable(entryHeaders, entryRows));
      console.log('');
    }
  }

  // Pricing reference
  console.log(divider('Pricing Reference'));
  console.log('');
  console.log(`  ${palette.dim('Provider pricing per 1M tokens (USD):')}`);
  console.log(`  ${palette.dim('Claude Sonnet 4:  $3.00 input / $15.00 output')}`);
  console.log(`  ${palette.dim('GPT-4o:           $2.50 input / $10.00 output')}`);
  console.log(`  ${palette.dim('Ollama (local):   Free')}`);
  console.log(`  ${palette.dim('Costs are estimated based on character-to-token heuristics.')}`);
  console.log('');
}
