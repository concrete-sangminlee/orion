/**
 * Orion CLI - Context Management Command
 * Manages which files are permanently included in AI prompts.
 *
 * Stored in .orion/context-files.json
 * Shows estimated token counts for context budgeting.
 *
 * Note: This is different from context.ts which handles project init context.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import {
  colors,
  printHeader,
  printInfo,
  printSuccess,
  printWarning,
  printError,
  getCurrentDirectoryContext,
  loadProjectContext,
  readFileContent,
  fileExists,
} from '../utils.js';
import { commandHeader, divider, statusLine, palette, table as uiTable } from '../ui.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ContextConfig {
  files: string[];
  addedAt: Record<string, string>; // file -> ISO timestamp
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ORION_DIR = '.orion';
const CONTEXT_FILES_JSON = 'context-files.json';
const CHARS_PER_TOKEN = 4; // rough estimate: ~4 characters per token

// ─── Context File Management ────────────────────────────────────────────────

function getContextFilePath(): string {
  return path.join(process.cwd(), ORION_DIR, CONTEXT_FILES_JSON);
}

function ensureOrionDir(): void {
  const orionDir = path.join(process.cwd(), ORION_DIR);
  if (!fs.existsSync(orionDir)) {
    fs.mkdirSync(orionDir, { recursive: true });
  }
}

function loadContextConfig(): ContextConfig {
  const configPath = getContextFilePath();
  if (!fs.existsSync(configPath)) {
    return { files: [], addedAt: {} };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      files: Array.isArray(parsed.files) ? parsed.files : [],
      addedAt: parsed.addedAt || {},
    };
  } catch {
    return { files: [], addedAt: {} };
  }
}

function saveContextConfig(config: ContextConfig): void {
  ensureOrionDir();
  const configPath = getContextFilePath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function resolveFilePath(input: string): string {
  const resolved = path.resolve(input);
  return path.relative(process.cwd(), resolved);
}

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ─── Subcommands ────────────────────────────────────────────────────────────

function showContext(): void {
  console.log(commandHeader('Orion Context - Current State'));

  const config = loadContextConfig();
  const workspaceContext = getCurrentDirectoryContext();
  const projectContext = loadProjectContext() || '';

  // Load patterns if available
  let patternsContext = '';
  const patternsFile = path.join(process.cwd(), '.orion', 'patterns.md');
  if (fs.existsSync(patternsFile)) {
    try {
      patternsContext = fs.readFileSync(patternsFile, 'utf-8');
    } catch {
      // skip
    }
  }

  console.log();
  console.log(divider('System Context'));
  console.log();

  // Workspace context
  const wsTokens = estimateTokenCount(workspaceContext);
  console.log(`  ${palette.blue('Workspace info:')}   ~${wsTokens} tokens`);
  console.log(`  ${palette.dim(workspaceContext.substring(0, 200))}${workspaceContext.length > 200 ? '...' : ''}`);
  console.log();

  // Project context (.orion/context.md)
  if (projectContext) {
    const pcTokens = estimateTokenCount(projectContext);
    console.log(`  ${palette.blue('Project context:')}  ~${pcTokens} tokens ${palette.dim('(.orion/context.md)')}`);
    console.log(`  ${palette.dim(projectContext.substring(0, 200))}${projectContext.length > 200 ? '...' : ''}`);
    console.log();
  } else {
    console.log(`  ${palette.blue('Project context:')}  ${palette.dim('none (.orion/context.md not found)')}`);
    console.log();
  }

  // Patterns context
  if (patternsContext) {
    const patTokens = estimateTokenCount(patternsContext);
    console.log(`  ${palette.blue('Patterns:')}         ~${patTokens} tokens ${palette.dim('(.orion/patterns.md)')}`);
    console.log();
  }

  // Context files
  console.log(divider('Context Files'));
  console.log();

  if (config.files.length === 0) {
    console.log(`  ${palette.dim('No files added to context.')}`);
    console.log(`  ${palette.dim('Use `orion context add <file>` to add files.')}`);
  } else {
    let totalFileTokens = 0;

    for (const file of config.files) {
      const fullPath = path.resolve(file);
      if (fileExists(fullPath)) {
        try {
          const { content, language } = readFileContent(fullPath);
          const tokens = estimateTokenCount(content);
          totalFileTokens += tokens;
          const lines = content.split('\n').length;
          console.log(`  ${palette.green('\u25CF')} ${colors.file(file)}`);
          console.log(`    ${palette.dim(`${lines} lines, ~${tokens} tokens, ${language}`)}`);
        } catch (err: any) {
          console.log(`  ${palette.red('\u25CF')} ${colors.file(file)} ${palette.dim('(read error)')}`);
        }
      } else {
        console.log(`  ${palette.red('\u25CF')} ${colors.file(file)} ${palette.dim('(file not found)')}`);
      }
    }

    console.log();
    console.log(`  ${palette.blue('Total file context:')} ~${totalFileTokens} tokens across ${config.files.length} files`);
  }

  // Total estimate
  console.log();
  console.log(divider('Total Estimate'));
  console.log();

  let totalTokens = estimateTokenCount(workspaceContext);
  if (projectContext) totalTokens += estimateTokenCount(projectContext);
  if (patternsContext) totalTokens += estimateTokenCount(patternsContext);

  for (const file of config.files) {
    const fullPath = path.resolve(file);
    if (fileExists(fullPath)) {
      try {
        const { content } = readFileContent(fullPath);
        totalTokens += estimateTokenCount(content);
      } catch {
        // skip
      }
    }
  }

  const tokenBar = palette.violet('\u2588'.repeat(Math.min(Math.floor(totalTokens / 500), 40)));
  console.log(`  ${palette.blue('Total context:')} ~${totalTokens} tokens`);
  console.log(`  ${tokenBar}`);
  console.log();

  // Budget warnings
  if (totalTokens > 100000) {
    printWarning('Context exceeds 100K tokens. Consider removing some files to reduce costs.');
  } else if (totalTokens > 50000) {
    printInfo('Context is large (>50K tokens). This may increase API costs.');
  } else {
    printInfo('Context size is within normal range.');
  }
  console.log();
}

function addFile(filePath: string): void {
  const relative = resolveFilePath(filePath);
  const fullPath = path.resolve(filePath);

  if (!fileExists(fullPath)) {
    printError(`File not found: ${colors.file(filePath)}`);
    printInfo('Make sure the file exists relative to the current directory.');
    return;
  }

  const config = loadContextConfig();

  // Check for duplicates
  if (config.files.includes(relative)) {
    printWarning(`${colors.file(relative)} is already in context.`);
    return;
  }

  config.files.push(relative);
  config.addedAt[relative] = new Date().toISOString();
  saveContextConfig(config);

  // Show info about added file
  try {
    const { content, language } = readFileContent(fullPath);
    const tokens = estimateTokenCount(content);
    const lines = content.split('\n').length;
    printSuccess(`Added ${colors.file(relative)} to context`);
    printInfo(`${lines} lines, ~${tokens} tokens, ${language}`);
  } catch {
    printSuccess(`Added ${colors.file(relative)} to context`);
  }
}

function removeFile(filePath: string): void {
  const relative = resolveFilePath(filePath);
  const config = loadContextConfig();

  // Try exact match first, then try the input as-is
  let idx = config.files.indexOf(relative);
  if (idx === -1) {
    idx = config.files.indexOf(filePath);
  }
  // Try matching without leading ./
  if (idx === -1) {
    const normalized = filePath.replace(/^\.[\\/]/, '');
    idx = config.files.findIndex(f => f === normalized || f.replace(/^\.[\\/]/, '') === normalized);
  }

  if (idx === -1) {
    printError(`${colors.file(filePath)} is not in the context list.`);
    printInfo('Use `orion context list` to see current context files.');
    return;
  }

  const removed = config.files[idx];
  config.files.splice(idx, 1);
  delete config.addedAt[removed];
  saveContextConfig(config);

  printSuccess(`Removed ${colors.file(removed)} from context`);
}

function listFiles(): void {
  console.log(commandHeader('Orion Context - File List'));

  const config = loadContextConfig();

  if (config.files.length === 0) {
    console.log();
    console.log(`  ${palette.dim('No files in context.')}`);
    console.log();
    printInfo(`Use ${colors.command('orion context add <file>')} to add files.`);
    console.log();
    return;
  }

  console.log();

  const rows: string[][] = [];

  for (const file of config.files) {
    const fullPath = path.resolve(file);
    const addedAt = config.addedAt[file]
      ? new Date(config.addedAt[file]).toLocaleDateString()
      : palette.dim('unknown');

    if (fileExists(fullPath)) {
      try {
        const { content, language } = readFileContent(fullPath);
        const tokens = estimateTokenCount(content);
        const lines = content.split('\n').length;
        rows.push([
          colors.file(file),
          language,
          String(lines),
          `~${tokens}`,
          addedAt,
        ]);
      } catch {
        rows.push([
          colors.file(file),
          palette.dim('error'),
          '-',
          '-',
          addedAt,
        ]);
      }
    } else {
      rows.push([
        chalk.red(file),
        palette.dim('missing'),
        '-',
        '-',
        addedAt,
      ]);
    }
  }

  console.log(uiTable(
    ['File', 'Language', 'Lines', 'Tokens', 'Added'],
    rows,
  ));
  console.log();

  // Total
  let totalTokens = 0;
  for (const file of config.files) {
    const fullPath = path.resolve(file);
    if (fileExists(fullPath)) {
      try {
        const { content } = readFileContent(fullPath);
        totalTokens += estimateTokenCount(content);
      } catch {
        // skip
      }
    }
  }

  console.log(`  ${palette.blue('Total:')} ${config.files.length} files, ~${totalTokens} tokens`);
  console.log();
}

function estimateContext(): void {
  console.log(commandHeader('Orion Context - Token Estimate'));

  const config = loadContextConfig();
  const workspaceContext = getCurrentDirectoryContext();
  const projectContext = loadProjectContext() || '';

  // Load patterns
  let patternsContext = '';
  const patternsFile = path.join(process.cwd(), '.orion', 'patterns.md');
  if (fs.existsSync(patternsFile)) {
    try {
      patternsContext = fs.readFileSync(patternsFile, 'utf-8');
    } catch {
      // skip
    }
  }

  console.log();

  const breakdown: { label: string; tokens: number; source: string }[] = [];

  // System prompt (approximate)
  breakdown.push({
    label: 'System prompt',
    tokens: estimateTokenCount('You are Orion, an expert AI coding assistant running in a terminal CLI. You help developers with coding questions, debugging, architecture, and best practices.'),
    source: 'built-in',
  });

  // Workspace context
  breakdown.push({
    label: 'Workspace info',
    tokens: estimateTokenCount(workspaceContext),
    source: 'auto-detected',
  });

  // Project context
  if (projectContext) {
    breakdown.push({
      label: 'Project context',
      tokens: estimateTokenCount(projectContext),
      source: '.orion/context.md',
    });
  }

  // Patterns
  if (patternsContext) {
    breakdown.push({
      label: 'Code patterns',
      tokens: estimateTokenCount(patternsContext),
      source: '.orion/patterns.md',
    });
  }

  // Context files
  for (const file of config.files) {
    const fullPath = path.resolve(file);
    if (fileExists(fullPath)) {
      try {
        const { content } = readFileContent(fullPath);
        breakdown.push({
          label: file,
          tokens: estimateTokenCount(content),
          source: 'context file',
        });
      } catch {
        breakdown.push({
          label: file,
          tokens: 0,
          source: 'read error',
        });
      }
    } else {
      breakdown.push({
        label: file,
        tokens: 0,
        source: 'file missing',
      });
    }
  }

  // Display breakdown
  const maxLabelLen = Math.max(...breakdown.map(b => b.label.length), 10);
  let totalTokens = 0;

  for (const item of breakdown) {
    totalTokens += item.tokens;
    const bar = palette.violet('\u2588'.repeat(Math.min(Math.floor(item.tokens / 200), 30)));
    const tokenStr = item.tokens > 0 ? `~${item.tokens}` : '-';
    console.log(`  ${colors.file(item.label.padEnd(maxLabelLen + 2))} ${tokenStr.padStart(8)} ${bar} ${palette.dim(item.source)}`);
  }

  console.log();
  console.log(divider());
  console.log(`  ${'Total'.padEnd(maxLabelLen + 2)} ${('~' + totalTokens).padStart(8)}`);
  console.log();

  // Model context window comparison
  console.log(`  ${palette.blue('Context window usage:')}`);
  console.log();

  const models = [
    { name: 'Claude 3 Haiku', window: 200000 },
    { name: 'Claude 3.5 Sonnet', window: 200000 },
    { name: 'GPT-4o', window: 128000 },
    { name: 'GPT-4o mini', window: 128000 },
    { name: 'Llama 3 (8B)', window: 8192 },
  ];

  for (const model of models) {
    const pct = Math.min((totalTokens / model.window) * 100, 100);
    const barLen = Math.floor(pct / 5);
    const bar = pct > 80
      ? chalk.red('\u2588'.repeat(barLen))
      : pct > 50
        ? chalk.yellow('\u2588'.repeat(barLen))
        : palette.green('\u2588'.repeat(barLen));
    const remaining = 20 - barLen;
    const emptyBar = palette.dim('\u2591'.repeat(Math.max(remaining, 0)));
    console.log(`  ${model.name.padEnd(20)} ${bar}${emptyBar} ${pct.toFixed(1)}%`);
  }

  console.log();

  if (totalTokens > 100000) {
    printWarning('Context is very large. Consider removing some files to save on API costs.');
  } else if (totalTokens > 50000) {
    printInfo('Context is moderately large. Works well with Claude/GPT-4o but may be too large for smaller models.');
  } else {
    printSuccess('Context size is efficient and works with all major models.');
  }
  console.log();
}

// ─── Main Command ───────────────────────────────────────────────────────────

export async function contextCmdCommand(action: string, target?: string): Promise<void> {
  switch (action) {
    case 'show':
      showContext();
      break;

    case 'add':
      if (!target) {
        printError('File path required.');
        printInfo(`Usage: ${colors.command('orion context add <file>')}`);
        console.log();
        return;
      }
      addFile(target);
      console.log();
      break;

    case 'remove':
    case 'rm':
      if (!target) {
        printError('File path required.');
        printInfo(`Usage: ${colors.command('orion context remove <file>')}`);
        console.log();
        return;
      }
      removeFile(target);
      console.log();
      break;

    case 'list':
    case 'ls':
      listFiles();
      break;

    case 'estimate':
    case 'tokens':
      estimateContext();
      break;

    default:
      printError(`Unknown action: ${action}`);
      console.log();
      console.log(`  ${palette.violet.bold('Available actions:')}`);
      console.log();
      console.log(`  ${colors.command('orion context show')}              Show all context being sent to AI`);
      console.log(`  ${colors.command('orion context add <file>')}        Add a file to permanent context`);
      console.log(`  ${colors.command('orion context remove <file>')}     Remove a file from context`);
      console.log(`  ${colors.command('orion context list')}              List all context files`);
      console.log(`  ${colors.command('orion context estimate')}          Estimate token count`);
      console.log();
      break;
  }
}
