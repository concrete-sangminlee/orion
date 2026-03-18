/**
 * Orion CLI - Multi-Agent Parallel Execution Command
 * Runs multiple AI tasks in parallel with a live status dashboard.
 * Competitive advantage over CMUX: cross-platform, built-in AI, not just a shell wrapper.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { askAI, type AIProvider, resolveProviderConfig, getAvailableProviders } from '../ai-client.js';
import {
  colors,
  printHeader,
  printDivider,
  printInfo,
  printSuccess,
  printError,
  ensureConfigDir,
  getCurrentDirectoryContext,
  loadProjectContext,
} from '../utils.js';
import { renderMarkdown } from '../markdown.js';
import { commandHeader, table as uiTable, statusLine, divider, palette } from '../ui.js';

// ─── Types ───────────────────────────────────────────────────────────────────

type AgentStatus = 'queued' | 'running' | 'complete' | 'error';

interface AgentTask {
  id: number;
  description: string;
  status: AgentStatus;
  provider?: AIProvider;
  result?: string;
  error?: string;
  startTime?: number;
  endTime?: number;
}

interface AgentOptions {
  parallel?: number;
  provider?: string;
  save?: boolean;
}

// ─── Status Icons ────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<AgentStatus, string> = {
  queued: palette.dim('\u25CB'),
  running: palette.blue('\u25CF'),
  complete: palette.green('\u2713'),
  error: palette.red('\u2717'),
};

const STATUS_LABELS: Record<AgentStatus, (s: string) => string> = {
  queued: (s: string) => palette.dim(`Queued: ${s}`),
  running: (s: string) => palette.blue(`${s}...`),
  complete: (s: string) => palette.green(`Done: ${s}`),
  error: (s: string) => palette.red(`Failed: ${s}`),
};

// ─── Dashboard Renderer ──────────────────────────────────────────────────────

function renderDashboard(tasks: AgentTask[], final: boolean = false): string {
  const width = 56;
  const dm = palette.dim;
  const lines: string[] = [];

  lines.push('  ' + dm('\u256D\u2500') + palette.violet.bold(' Agent Dashboard ') + dm('\u2500'.repeat(width - 21)) + dm('\u256E'));

  for (const task of tasks) {
    const icon = STATUS_ICONS[task.status];
    const idTag = dm(`[${task.id}]`);
    const maxLabelLen = width - 10;
    const plainLabel = task.description;
    const displayLabel = plainLabel.length > maxLabelLen
      ? plainLabel.substring(0, maxLabelLen - 1) + '\u2026'
      : plainLabel;

    const statusText = STATUS_LABELS[task.status](displayLabel);
    lines.push('  ' + dm('\u2502') + ` ${idTag} ${icon} ${statusText}`.padEnd(width) + dm('\u2502'));
  }

  lines.push('  ' + dm('\u2570' + '\u2500'.repeat(width) + '\u256F'));

  return lines.join('\n');
}

function clearLines(count: number): void {
  for (let i = 0; i < count; i++) {
    process.stdout.write('\x1b[1A\x1b[2K');
  }
}

// ─── Agent Results Storage ───────────────────────────────────────────────────

function getAgentsDir(): string {
  const dir = path.join(process.cwd(), '.orion', 'agents');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function saveAgentResults(tasks: AgentTask[]): string {
  const dir = getAgentsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultFile = path.join(dir, `agent-run-${timestamp}.json`);

  const report = {
    timestamp: new Date().toISOString(),
    taskCount: tasks.length,
    completed: tasks.filter(t => t.status === 'complete').length,
    failed: tasks.filter(t => t.status === 'error').length,
    tasks: tasks.map(t => ({
      id: t.id,
      description: t.description,
      status: t.status,
      provider: t.provider,
      duration: t.startTime && t.endTime ? `${((t.endTime - t.startTime) / 1000).toFixed(1)}s` : null,
      result: t.result,
      error: t.error,
    })),
  };

  fs.writeFileSync(resultFile, JSON.stringify(report, null, 2), 'utf-8');
  return resultFile;
}

function saveAgentMarkdownReport(tasks: AgentTask[]): string {
  const dir = getAgentsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportFile = path.join(dir, `agent-run-${timestamp}.md`);

  const lines: string[] = [];
  lines.push(`# Orion Agent Run Report`);
  lines.push(`**Date:** ${new Date().toLocaleString()}`);
  lines.push(`**Tasks:** ${tasks.length} | **Completed:** ${tasks.filter(t => t.status === 'complete').length} | **Failed:** ${tasks.filter(t => t.status === 'error').length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const task of tasks) {
    const duration = task.startTime && task.endTime
      ? `${((task.endTime - task.startTime) / 1000).toFixed(1)}s`
      : 'N/A';
    const statusEmoji = task.status === 'complete' ? '[DONE]' : '[FAIL]';

    lines.push(`## Task ${task.id}: ${task.description}`);
    lines.push(`**Status:** ${statusEmoji} | **Duration:** ${duration} | **Provider:** ${task.provider || 'auto'}`);
    lines.push('');

    if (task.result) {
      lines.push(task.result);
    } else if (task.error) {
      lines.push(`**Error:** ${task.error}`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  fs.writeFileSync(reportFile, lines.join('\n'), 'utf-8');
  return reportFile;
}

// ─── Task Execution ──────────────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `You are Orion, an expert AI coding assistant executing a specific task.
Complete the task thoroughly and provide actionable output.
If the task involves code, include code examples in markdown code blocks.
Be concise but thorough. Focus on delivering the requested result.

Workspace context:
`;

async function executeTask(task: AgentTask, context: string, projectContext: string): Promise<void> {
  task.status = 'running';
  task.startTime = Date.now();

  const fullSystemPrompt = projectContext
    ? AGENT_SYSTEM_PROMPT + context + '\n\nProject context:\n' + projectContext
    : AGENT_SYSTEM_PROMPT + context;

  try {
    let result = '';
    await askAI(fullSystemPrompt, task.description, {
      onToken(token: string) {
        result += token;
      },
      onComplete(text: string) {
        result = text;
      },
      onError(error: Error) {
        throw error;
      },
    });

    task.result = result;
    task.status = 'complete';
    task.endTime = Date.now();
  } catch (err: any) {
    task.status = 'error';
    task.error = err.message || 'Unknown error';
    task.endTime = Date.now();
  }
}

// ─── Concurrency Limiter ─────────────────────────────────────────────────────

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  onProgress?: () => void,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
      onProgress?.();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

// ─── Round-Robin Provider Assignment ─────────────────────────────────────────

async function assignProviders(tasks: AgentTask[], requestedProvider?: string): Promise<void> {
  if (requestedProvider) {
    // All tasks use the same provider
    for (const task of tasks) {
      task.provider = requestedProvider as AIProvider;
    }
    return;
  }

  // Round-robin across available providers
  try {
    const providers = await getAvailableProviders();
    const available = providers.filter(p => p.available);

    if (available.length === 0) {
      // Let each task fail individually with proper error messages
      return;
    }

    for (let i = 0; i < tasks.length; i++) {
      tasks[i].provider = available[i % available.length].provider;
    }
  } catch {
    // Provider detection failed; let tasks use default resolution
  }
}

// ─── Main Command ────────────────────────────────────────────────────────────

export async function agentCommand(taskDescriptions: string[], options: AgentOptions = {}): Promise<void> {
  const maxParallel = options.parallel || 3;
  const shouldSave = options.save !== false; // default true

  console.log(commandHeader('Orion Multi-Agent'));

  if (taskDescriptions.length === 0) {
    console.log();
    printError('No tasks provided.');
    console.log(`  ${palette.dim('Usage: orion agent "task 1" "task 2" "task 3"')}`);
    console.log(`  ${palette.dim('       orion agent "refactor auth" "add tests" --parallel 2')}`);
    console.log();
    process.exit(1);
  }

  // Create task objects
  const tasks: AgentTask[] = taskDescriptions.map((desc, i) => ({
    id: i + 1,
    description: desc,
    status: 'queued' as AgentStatus,
  }));

  // Assign providers (round-robin or user choice)
  await assignProviders(tasks, options.provider);

  // Show initial dashboard
  printInfo(`Running ${tasks.length} task(s) with concurrency limit: ${maxParallel}`);
  console.log();

  const dashboardText = renderDashboard(tasks);
  console.log(dashboardText);
  const dashboardLineCount = dashboardText.split('\n').length;

  // Prepare context
  const context = getCurrentDirectoryContext();
  const projectContext = loadProjectContext();

  // Build task runners
  const taskRunners = tasks.map((task) => {
    return async () => {
      await executeTask(task, context, projectContext);
      return task;
    };
  });

  // Run with concurrency limit and live dashboard updates
  const updateDashboard = () => {
    clearLines(dashboardLineCount);
    const updated = renderDashboard(tasks);
    console.log(updated);
  };

  await runWithConcurrency(taskRunners, maxParallel, updateDashboard);

  // Final dashboard update
  clearLines(dashboardLineCount);
  console.log(renderDashboard(tasks, true));
  console.log();

  // Summary
  const completed = tasks.filter(t => t.status === 'complete').length;
  const failed = tasks.filter(t => t.status === 'error').length;

  console.log(divider('Results'));
  console.log();
  console.log(uiTable(
    ['Task', 'Description', 'Status', 'Time'],
    tasks.map(t => {
      const duration = t.startTime && t.endTime
        ? `${((t.endTime - t.startTime) / 1000).toFixed(1)}s`
        : '-';
      const statusStr = t.status === 'complete'
        ? palette.green('\u2713 Done')
        : palette.red('\u2717 Failed');
      return [
        palette.dim(String(t.id)),
        t.description.length > 25 ? t.description.substring(0, 24) + '\u2026' : t.description,
        statusStr,
        palette.dim(duration),
      ];
    })
  ));
  console.log();

  console.log(`  ${palette.green(`${completed} completed`)} | ${palette.red(`${failed} failed`)} | ${palette.dim(`${tasks.length} total`)}`);
  console.log();

  // Show individual results
  for (const task of tasks) {
    const duration = task.startTime && task.endTime
      ? palette.dim(` (${((task.endTime - task.startTime) / 1000).toFixed(1)}s)`)
      : '';

    if (task.status === 'complete') {
      console.log(`  ${palette.green('\u2713')} ${palette.violet.bold(`Task ${task.id}:`)} ${task.description}${duration}`);
      console.log(divider());
      if (task.result) {
        console.log(renderMarkdown(task.result));
      }
      console.log();
    } else if (task.status === 'error') {
      console.log(`  ${palette.red('\u2717')} ${palette.violet.bold(`Task ${task.id}:`)} ${task.description}${duration}`);
      printError(task.error || 'Unknown error');
      console.log();
    }
  }

  // Save results
  if (shouldSave) {
    try {
      const jsonPath = saveAgentResults(tasks);
      const mdPath = saveAgentMarkdownReport(tasks);
      printDivider();
      printInfo(`Results saved to ${colors.file('.orion/agents/')}`);
      printInfo(`  JSON: ${colors.dim(path.basename(jsonPath))}`);
      printInfo(`  Report: ${colors.dim(path.basename(mdPath))}`);
    } catch (err: any) {
      printInfo(`Could not save results: ${err.message}`);
    }
  }

  console.log();
}
