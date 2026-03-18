/**
 * Orion CLI - Watch Mode Command
 * Watches files for changes and automatically runs AI actions.
 * Uses chokidar for cross-platform file watching with debouncing.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { askAI, type AIStreamCallbacks } from '../ai-client.js';
import {
  colors,
  printHeader,
  printDivider,
  printInfo,
  printSuccess,
  printError,
  printWarning,
  startSpinner,
  stopSpinner,
  readFileContent,
  fileExists,
  getCurrentDirectoryContext,
  loadProjectContext,
} from '../utils.js';
import { renderMarkdown } from '../markdown.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface WatchOptions {
  onChange?: string;
  debounce?: number;
  ignore?: string;
}

type WatchAction = 'review' | 'fix' | 'explain' | 'ask';

// ─── Action Prompts ──────────────────────────────────────────────────────────

const ACTION_PROMPTS: Record<WatchAction, string> = {
  review: `You are Orion, a code reviewer watching for file changes.
Briefly review the changed file. Focus on:
- New issues introduced by the changes
- Quick suggestions for improvement
Keep it concise (3-5 bullet points max). This is a watch mode response.`,

  fix: `You are Orion, an auto-fix assistant watching for file changes.
Analyze the changed file and suggest specific fixes.
Focus on bugs, type errors, and obvious issues.
Be concise and actionable. List specific line-level fixes.`,

  explain: `You are Orion, a code explainer watching for file changes.
Briefly explain what changed in this file and why the changes matter.
Focus on the high-level impact. Keep it to 2-3 sentences.`,

  ask: `You are Orion, an AI coding assistant watching for file changes.
The user wants to know about changes to this file.
Provide a brief, helpful response about the file content.`,
};

// ─── Status Display ──────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour12: false });
}

function printWatchStatus(pattern: string, action: string, lastChange?: string, actionCount?: number): void {
  const now = formatTime(new Date());
  const countStr = actionCount ? chalk.dim(` | Actions: ${actionCount}`) : '';
  const lastStr = lastChange ? chalk.dim(` | Last: ${lastChange}`) : chalk.dim(' | Waiting...');

  process.stdout.write(`\r\x1b[K  ${chalk.cyan('eye')} ${colors.dim(now)} Watching ${colors.primary(pattern)} -> ${colors.command(action)}${lastStr}${countStr}`);
}

// ─── File Change Handler ─────────────────────────────────────────────────────

async function handleFileChange(
  filePath: string,
  action: WatchAction,
  context: string,
  projectContext: string,
): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath);

  // Skip non-code files and common generated files
  const skipExtensions = ['.map', '.lock', '.log', '.min.js', '.min.css'];
  if (skipExtensions.includes(ext)) return;

  // Read file content
  if (!fileExists(filePath)) return;

  let content: string;
  let language: string;
  try {
    const fileData = readFileContent(filePath);
    content = fileData.content;
    language = fileData.language;
  } catch {
    return; // Skip unreadable files
  }

  console.log();
  console.log();
  printDivider();
  console.log(`  ${chalk.cyan('>>>')} ${colors.file(fileName)} changed at ${formatTime(new Date())}`);
  printDivider();

  const systemPrompt = (ACTION_PROMPTS[action] || ACTION_PROMPTS.review)
    + '\n\nWorkspace context:\n' + context
    + (projectContext ? '\n\nProject context:\n' + projectContext : '');

  const userMessage = `File changed: ${fileName}\n\n\`\`\`${language}\n${content}\n\`\`\``;

  const spinner = startSpinner(`Running ${action} on ${fileName}...`);

  try {
    let fullResponse = '';
    let firstToken = true;

    await askAI(systemPrompt, userMessage, {
      onToken(token: string) {
        if (firstToken) {
          stopSpinner(spinner);
          firstToken = false;
        }
        fullResponse += token;
      },
      onComplete(text: string) {
        if (firstToken) stopSpinner(spinner);
        fullResponse = text;
        console.log();
        console.log(renderMarkdown(text));
      },
      onError(error: Error) {
        stopSpinner(spinner, error.message, false);
      },
    });

    console.log();
    printDivider();
  } catch (err: any) {
    stopSpinner(spinner);
    printError(`${action} failed: ${err.message}`);
    console.log();
  }
}

// ─── Main Command ────────────────────────────────────────────────────────────

export async function watchCommand(pattern: string, options: WatchOptions = {}): Promise<void> {
  printHeader('Orion Watch Mode');

  if (!pattern) {
    printError('File pattern required.');
    console.log(`  ${colors.dim('Usage: orion watch "*.ts" --on-change review')}`);
    console.log(`  ${colors.dim('       orion watch "src/**" --on-change fix')}`);
    console.log(`  ${colors.dim('       orion watch "test/**" --on-change explain')}`);
    console.log();
    process.exit(1);
  }

  const action = (options.onChange || 'review') as WatchAction;
  const debounceMs = options.debounce || 300;
  const ignorePatterns = (options.ignore || 'node_modules,dist,build,.git,.orion').split(',').map(p => p.trim());

  // Validate action
  const validActions: WatchAction[] = ['review', 'fix', 'explain', 'ask'];
  if (!validActions.includes(action)) {
    printError(`Unknown action: "${action}"`);
    printInfo(`Valid actions: ${validActions.map(a => colors.command(a)).join(', ')}`);
    process.exit(1);
  }

  // Prepare context
  const context = getCurrentDirectoryContext();
  const projectContext = loadProjectContext();

  printInfo(`Pattern: ${colors.primary(pattern)}`);
  printInfo(`Action: ${colors.command(action)}`);
  printInfo(`Debounce: ${debounceMs}ms`);
  printInfo(`Ignoring: ${ignorePatterns.join(', ')}`);
  console.log();
  printInfo(`Press ${colors.command('Ctrl+C')} to stop watching.`);
  console.log();

  // Dynamically import chokidar
  let chokidar: any;
  try {
    chokidar = await import('chokidar');
  } catch {
    printError('chokidar is required for watch mode.');
    printInfo(`It should already be installed. Try: ${colors.command('npm install chokidar')}`);
    process.exit(1);
  }

  // Debounce tracking
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let actionCount = 0;
  let lastChangedFile = '';

  // Build ignore list for chokidar
  const ignored = ignorePatterns.map(p => `**/${p}/**`);

  // Create watcher
  const watcher = chokidar.watch(pattern, {
    ignored,
    persistent: true,
    ignoreInitial: true,
    cwd: process.cwd(),
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  });

  // Print initial status
  printWatchStatus(pattern, action);

  watcher.on('change', (filePath: string) => {
    // Clear existing debounce for this file
    if (debounceTimers.has(filePath)) {
      clearTimeout(debounceTimers.get(filePath)!);
    }

    // Set new debounce timer
    debounceTimers.set(filePath, setTimeout(async () => {
      debounceTimers.delete(filePath);
      lastChangedFile = filePath;
      actionCount++;

      await handleFileChange(filePath, action, context, projectContext);

      // Restore status line
      printWatchStatus(pattern, action, path.basename(filePath), actionCount);
    }, debounceMs));
  });

  watcher.on('add', (filePath: string) => {
    // Only trigger for new files if pattern matches
    if (debounceTimers.has(filePath)) {
      clearTimeout(debounceTimers.get(filePath)!);
    }

    debounceTimers.set(filePath, setTimeout(async () => {
      debounceTimers.delete(filePath);
      lastChangedFile = filePath;
      actionCount++;

      console.log();
      printInfo(`New file detected: ${colors.file(filePath)}`);
      await handleFileChange(filePath, action, context, projectContext);

      printWatchStatus(pattern, action, path.basename(filePath), actionCount);
    }, debounceMs));
  });

  watcher.on('error', (error: Error) => {
    printError(`Watcher error: ${error.message}`);
  });

  // Keep the process alive
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log();
      console.log();
      watcher.close();
      printDivider();
      printSuccess(`Watch mode ended. ${actionCount} action(s) performed.`);
      console.log();
      resolve();
    });
  });
}
