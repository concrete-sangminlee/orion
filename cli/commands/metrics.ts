/**
 * Orion CLI - Usage Metrics Command
 * Track and display usage statistics: commands run, tokens used, files touched.
 * Metrics are stored in ~/.orion/metrics.json
 *
 * Usage:
 *   orion metrics                          # Show usage statistics
 *   orion metrics --reset                  # Reset all metrics
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import inquirer from 'inquirer';
import {
  colors,
  printInfo,
  printSuccess,
  printError,
  printWarning,
  ensureConfigDir,
} from '../utils.js';
import {
  commandHeader,
  statusLine,
  divider,
  palette,
  table as uiTable,
  badge,
  keyValue,
  progressBar,
  box,
} from '../ui.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const METRICS_FILE = path.join(os.homedir(), '.orion', 'metrics.json');

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MetricsData {
  firstUseDate: string;
  lastUseDate: string;
  sessionsCount: number;
  commandsRun: Record<string, number>;
  tokensUsed: Record<string, number>;
  filesEdited: number;
  filesReviewed: number;
  filesFixed: number;
}

// ─── Metrics Storage ────────────────────────────────────────────────────────

function createEmptyMetrics(): MetricsData {
  const now = new Date().toISOString();
  return {
    firstUseDate: now,
    lastUseDate: now,
    sessionsCount: 0,
    commandsRun: {},
    tokensUsed: {},
    filesEdited: 0,
    filesReviewed: 0,
    filesFixed: 0,
  };
}

export function loadMetrics(): MetricsData {
  ensureConfigDir();
  if (fs.existsSync(METRICS_FILE)) {
    try {
      const raw = fs.readFileSync(METRICS_FILE, 'utf-8');
      const data = JSON.parse(raw) as MetricsData;
      // Ensure all fields exist (handle partial/corrupt data)
      return {
        firstUseDate: data.firstUseDate || new Date().toISOString(),
        lastUseDate: data.lastUseDate || new Date().toISOString(),
        sessionsCount: data.sessionsCount || 0,
        commandsRun: data.commandsRun || {},
        tokensUsed: data.tokensUsed || {},
        filesEdited: data.filesEdited || 0,
        filesReviewed: data.filesReviewed || 0,
        filesFixed: data.filesFixed || 0,
      };
    } catch {
      return createEmptyMetrics();
    }
  }
  return createEmptyMetrics();
}

export function saveMetrics(metrics: MetricsData): void {
  ensureConfigDir();
  fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), 'utf-8');
}

// ─── Formatting Helpers ─────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatDuration(startDate: string): string {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? '1 month' : `${months} months`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year' : `${years} years`;
}

function getTopCommands(commandsRun: Record<string, number>, limit: number): [string, number][] {
  return Object.entries(commandsRun)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);
}

function getTotalCommands(commandsRun: Record<string, number>): number {
  return Object.values(commandsRun).reduce((sum, count) => sum + count, 0);
}

function getTotalTokens(tokensUsed: Record<string, number>): number {
  return Object.values(tokensUsed).reduce((sum, count) => sum + count, 0);
}

// ─── Dashboard Display ──────────────────────────────────────────────────────

function showDashboard(metrics: MetricsData): void {
  console.log(commandHeader('Orion Usage Metrics'));

  const totalCommands = getTotalCommands(metrics.commandsRun);
  const totalTokens = getTotalTokens(metrics.tokensUsed);
  const totalFiles = metrics.filesEdited + metrics.filesReviewed + metrics.filesFixed;
  const usageDuration = formatDuration(metrics.firstUseDate);

  // ─── Overview Section ───────────────────────────────────────────────
  console.log();
  console.log(divider('Overview'));
  console.log();
  console.log(keyValue([
    ['Active for', usageDuration],
    ['First used', new Date(metrics.firstUseDate).toLocaleDateString()],
    ['Last used', new Date(metrics.lastUseDate).toLocaleDateString()],
    ['Sessions', String(metrics.sessionsCount)],
  ]));
  console.log();

  // ─── Summary Badges ─────────────────────────────────────────────────
  const summaryLine = [
    badge(formatNumber(totalCommands) + ' cmds', '#7C5CFC'),
    badge(formatNumber(totalTokens) + ' tokens', '#38BDF8'),
    badge(formatNumber(totalFiles) + ' files', '#22C55E'),
  ].join('  ');
  console.log(`  ${summaryLine}`);
  console.log();

  // ─── Commands Breakdown ─────────────────────────────────────────────
  console.log(divider('Commands'));
  console.log();

  const commandEntries = Object.entries(metrics.commandsRun);
  if (commandEntries.length === 0) {
    console.log(statusLine('i', palette.dim('No commands recorded yet.')));
  } else {
    const topCommands = getTopCommands(metrics.commandsRun, 10);
    const maxCount = topCommands.length > 0 ? topCommands[0][1] : 1;

    const cmdHeaders = ['Command', 'Count', 'Usage'];
    const cmdRows: string[][] = [];

    for (const [cmd, count] of topCommands) {
      const barWidth = 20;
      const filled = Math.max(1, Math.round((count / maxCount) * barWidth));
      const bar = palette.violet('\u2588'.repeat(filled)) + palette.dim('\u2591'.repeat(barWidth - filled));
      cmdRows.push([
        cmd,
        String(count),
        bar,
      ]);
    }

    console.log(uiTable(cmdHeaders, cmdRows));

    if (commandEntries.length > 10) {
      console.log(`  ${palette.dim(`... and ${commandEntries.length - 10} more commands`)}`);
    }
  }
  console.log();

  // ─── Tokens by Provider ─────────────────────────────────────────────
  console.log(divider('Tokens by Provider'));
  console.log();

  const tokenEntries = Object.entries(metrics.tokensUsed);
  if (tokenEntries.length === 0) {
    console.log(statusLine('i', palette.dim('No token usage recorded yet.')));
  } else {
    const maxTokens = Math.max(...tokenEntries.map(([, v]) => v));

    for (const [provider, tokens] of tokenEntries.sort(([, a], [, b]) => b - a)) {
      const pct = totalTokens > 0 ? Math.round((tokens / totalTokens) * 100) : 0;
      const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
      console.log(`  ${palette.violet(providerLabel.padEnd(12))} ${formatNumber(tokens).padStart(8)}  ${palette.dim(`(${pct}%)`)}`);
      console.log(progressBar(tokens, maxTokens, 30));
    }
  }
  console.log();

  // ─── Files Section ──────────────────────────────────────────────────
  console.log(divider('Files'));
  console.log();

  if (totalFiles === 0) {
    console.log(statusLine('i', palette.dim('No file operations recorded yet.')));
  } else {
    console.log(keyValue([
      ['Edited', `${metrics.filesEdited} file(s)`],
      ['Reviewed', `${metrics.filesReviewed} file(s)`],
      ['Fixed', `${metrics.filesFixed} file(s)`],
      ['Total', `${totalFiles} file(s)`],
    ]));
  }
  console.log();

  // ─── Stored At ──────────────────────────────────────────────────────
  console.log(`  ${palette.dim('Metrics stored at: ' + METRICS_FILE)}`);
  console.log();
}

// ─── Reset ──────────────────────────────────────────────────────────────────

async function resetMetrics(): Promise<void> {
  console.log(commandHeader('Orion Metrics: Reset'));

  const metrics = loadMetrics();
  const totalCommands = getTotalCommands(metrics.commandsRun);
  const totalTokens = getTotalTokens(metrics.tokensUsed);

  if (totalCommands === 0 && totalTokens === 0 && metrics.sessionsCount === 0) {
    printInfo('Metrics are already empty. Nothing to reset.');
    console.log();
    return;
  }

  console.log();
  printWarning(`This will permanently erase all usage data:`);
  console.log(`    ${palette.dim('Commands:')} ${totalCommands}`);
  console.log(`    ${palette.dim('Tokens:')} ${formatNumber(totalTokens)}`);
  console.log(`    ${palette.dim('Sessions:')} ${metrics.sessionsCount}`);
  console.log(`    ${palette.dim('Since:')} ${new Date(metrics.firstUseDate).toLocaleDateString()}`);
  console.log();

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Reset all metrics?',
      default: false,
    },
  ]);

  if (confirm) {
    const freshMetrics = createEmptyMetrics();
    saveMetrics(freshMetrics);
    printSuccess('All metrics have been reset.');
  } else {
    printInfo('Reset cancelled.');
  }
  console.log();
}

// ─── Command Entry Point ────────────────────────────────────────────────────

export async function metricsCommand(options: { reset?: boolean } = {}): Promise<void> {
  if (options.reset) {
    await resetMetrics();
    return;
  }

  const metrics = loadMetrics();
  showDashboard(metrics);
}
