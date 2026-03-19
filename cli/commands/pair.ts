/**
 * Orion CLI - Pair Programming Command
 * Enhanced AI pair programming mode that watches files in real-time,
 * auto-reviews changes as you code, and suggests improvements.
 *
 * Uses chokidar for cross-platform file watching with debouncing.
 * Supports /pause and /resume to control AI commentary.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import { askAI, streamChat, type AIMessage } from '../ai-client.js';
import {
  colors,
  printHeader,
  printInfo,
  printSuccess,
  printWarning,
  printError,
  startSpinner,
  stopSpinner,
  getCurrentDirectoryContext,
  loadProjectContext,
  readFileContent,
} from '../utils.js';
import { commandHeader, divider, statusLine, palette } from '../ui.js';
import { renderMarkdown } from '../markdown.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileSnapshot {
  content: string;
  mtime: number;
}

interface PairState {
  paused: boolean;
  fileSnapshots: Map<string, FileSnapshot>;
  changeHistory: { file: string; time: Date; summary: string }[];
  conversationHistory: AIMessage[];
  reviewCount: number;
  suggestCount: number;
  sessionStart: Date;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.orion', 'dist', 'build', 'out', '.next',
  '.nuxt', '.svelte-kit', 'coverage', '__pycache__', '.venv', 'venv',
  'vendor', '.cache', '.turbo', '.parcel-cache',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.cpp', '.h', '.hpp', '.cs',
  '.vue', '.svelte', '.astro',
  '.css', '.scss', '.less',
  '.json', '.yaml', '.yml',
]);

const DEBOUNCE_MS = 1500;
const MAX_HISTORY_MESSAGES = 30;

// ─── System Prompt ──────────────────────────────────────────────────────────

const PAIR_SYSTEM_PROMPT = `You are Orion, an expert AI pair programmer working alongside a developer in real-time.

Your role:
- Review code changes as the developer saves files
- Point out bugs, issues, and improvements concisely
- Suggest better approaches when you see patterns that could be improved
- Be encouraging but honest about issues
- Keep responses SHORT (3-8 lines max) since this runs on every save
- Only comment when you have something genuinely useful to say
- If the code looks good, say so briefly or stay quiet

Format:
- Use bullet points for multiple suggestions
- Reference specific line numbers when possible
- Show brief code snippets only when the fix is non-obvious
- Prioritize: bugs > security > performance > style

When the developer asks you questions directly (not file changes), give thorough answers.`;

// ─── Diff Generation ────────────────────────────────────────────────────────

function generateSimpleDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diff: string[] = [];

  const maxLines = Math.max(oldLines.length, newLines.length);
  let changesFound = 0;

  for (let i = 0; i < maxLines && changesFound < 50; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined && newLine !== undefined) {
      diff.push(`+${i + 1}: ${newLine}`);
      changesFound++;
    } else if (oldLine !== undefined && newLine === undefined) {
      diff.push(`-${i + 1}: ${oldLine}`);
      changesFound++;
    } else if (oldLine !== newLine) {
      diff.push(`-${i + 1}: ${oldLine}`);
      diff.push(`+${i + 1}: ${newLine}`);
      changesFound++;
    }
  }

  if (changesFound >= 50) {
    diff.push('... (more changes truncated)');
  }

  return diff.join('\n');
}

// ─── File Change Handler ────────────────────────────────────────────────────

async function handleFileChange(
  filePath: string,
  state: PairState,
  projectContext: string,
): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  if (!CODE_EXTENSIONS.has(ext)) return;

  // Read current file
  let currentContent: string;
  try {
    currentContent = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }

  const relPath = path.relative(process.cwd(), filePath);
  const previousSnapshot = state.fileSnapshots.get(filePath);

  // Update snapshot
  state.fileSnapshots.set(filePath, {
    content: currentContent,
    mtime: Date.now(),
  });

  // Skip if this is the first time seeing this file (no diff to show)
  if (!previousSnapshot) return;

  // Skip if content didn't actually change
  if (previousSnapshot.content === currentContent) return;

  // Generate diff
  const diff = generateSimpleDiff(previousSnapshot.content, currentContent);
  if (!diff.trim()) return;

  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log();
  console.log(`  ${palette.blue('\u25B8')} ${colors.file(relPath)} ${palette.dim('saved at ' + timestamp)}`);

  // Build AI message
  const userMessage = `File changed: ${relPath}

Changes:
\`\`\`diff
${diff}
\`\`\`

Current file content (relevant section):
\`\`\`${ext.replace('.', '')}
${currentContent.length > 4000 ? currentContent.substring(0, 4000) + '\n// ... truncated ...' : currentContent}
\`\`\`

Briefly review these changes. Only comment if you see something worth mentioning.`;

  // Add to conversation history
  state.conversationHistory.push({ role: 'user', content: userMessage });

  // Trim history if too long
  if (state.conversationHistory.length > MAX_HISTORY_MESSAGES) {
    state.conversationHistory = state.conversationHistory.slice(-MAX_HISTORY_MESSAGES);
  }

  const spinner = startSpinner(chalk.dim('Reviewing...'));

  try {
    const systemContent = PAIR_SYSTEM_PROMPT
      + '\n\nWorkspace context:\n' + getCurrentDirectoryContext()
      + (projectContext ? '\n\nProject context:\n' + projectContext : '');

    const messages: AIMessage[] = [
      { role: 'system', content: systemContent },
      ...state.conversationHistory,
    ];

    let fullResponse = '';
    await streamChat(messages, {
      onToken(token: string) {
        fullResponse += token;
      },
      onComplete(text: string) {
        stopSpinner(spinner);
        fullResponse = text;

        // Only show if AI had something meaningful to say
        const trimmed = text.trim().toLowerCase();
        const isEmptyResponse = trimmed.length < 10
          || trimmed === 'looks good.'
          || trimmed === 'no issues.'
          || trimmed === 'lgtm';

        if (!isEmptyResponse) {
          console.log();
          console.log(`  ${palette.violet('\u2728 Orion:')}`);
          // Indent the markdown output
          const rendered = renderMarkdown(text);
          const lines = rendered.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              console.log(`  ${line}`);
            }
          }
          state.suggestCount++;
        } else {
          console.log(`  ${palette.dim('\u2713 Looks good')}`);
        }

        state.conversationHistory.push({ role: 'assistant', content: text });
        state.reviewCount++;
        state.changeHistory.push({
          file: relPath,
          time: new Date(),
          summary: text.substring(0, 100),
        });
      },
      onError(error: Error) {
        stopSpinner(spinner, error.message, false);
      },
    });
  } catch (err: any) {
    stopSpinner(spinner);
    printError(`Review failed: ${err.message}`);
  }

  // Re-show the prompt indicator
  process.stdout.write(`\n  ${palette.dim('Pair>')} `);
}

// ─── Interactive Input Handler ──────────────────────────────────────────────

async function handleUserInput(
  input: string,
  state: PairState,
  projectContext: string,
  rl: readline.Interface,
): Promise<boolean> {
  const trimmed = input.trim();
  if (!trimmed) return false;

  // Handle slash commands
  switch (trimmed.toLowerCase()) {
    case '/pause':
      state.paused = true;
      console.log(`\n  ${palette.yellow('\u23F8')} AI commentary paused. Type ${colors.command('/resume')} to resume.`);
      return false;

    case '/resume':
      state.paused = false;
      console.log(`\n  ${palette.green('\u25B6')} AI commentary resumed. Watching for changes...`);
      return false;

    case '/status': {
      const elapsed = Math.floor((Date.now() - state.sessionStart.getTime()) / 60000);
      console.log();
      console.log(divider('Pair Session Status'));
      console.log();
      console.log(`  ${palette.blue('Duration:')}      ${elapsed} minutes`);
      console.log(`  ${palette.blue('Reviews:')}       ${state.reviewCount}`);
      console.log(`  ${palette.blue('Suggestions:')}   ${state.suggestCount}`);
      console.log(`  ${palette.blue('Files tracked:')} ${state.fileSnapshots.size}`);
      console.log(`  ${palette.blue('Paused:')}        ${state.paused ? 'Yes' : 'No'}`);
      console.log();
      if (state.changeHistory.length > 0) {
        console.log(`  ${palette.blue('Recent changes:')}`);
        for (const change of state.changeHistory.slice(-5)) {
          const time = change.time.toLocaleTimeString('en-US', { hour12: false });
          console.log(`    ${palette.dim(time)} ${colors.file(change.file)}`);
        }
      }
      console.log();
      return false;
    }

    case '/clear':
      state.conversationHistory = [];
      console.log(`\n  ${palette.green('\u2713')} Conversation history cleared.`);
      return false;

    case '/help':
      console.log();
      console.log(`  ${palette.violet.bold('Pair Programming Commands:')}`);
      console.log();
      console.log(`  ${colors.command('/pause')}     Pause AI commentary on file changes`);
      console.log(`  ${colors.command('/resume')}    Resume AI commentary`);
      console.log(`  ${colors.command('/status')}    Show session statistics`);
      console.log(`  ${colors.command('/clear')}     Clear conversation history`);
      console.log(`  ${colors.command('/help')}      Show this help message`);
      console.log(`  ${colors.command('/exit')}      End pair session`);
      console.log();
      console.log(`  ${palette.dim('Type any message to ask the AI a question.')}`);
      console.log(`  ${palette.dim('Edit files normally - AI will review changes on save.')}`);
      console.log();
      return false;

    case '/exit':
    case '/quit':
    case '/q':
      return true; // signal exit

    default:
      break;
  }

  // Handle direct questions to the AI
  console.log();
  state.conversationHistory.push({ role: 'user', content: trimmed });

  if (state.conversationHistory.length > MAX_HISTORY_MESSAGES) {
    state.conversationHistory = state.conversationHistory.slice(-MAX_HISTORY_MESSAGES);
  }

  const spinner = startSpinner('Thinking...');

  try {
    const systemContent = PAIR_SYSTEM_PROMPT
      + '\n\nThe developer is asking you a direct question (not a file change review). Give a thorough, helpful answer.'
      + '\n\nWorkspace context:\n' + getCurrentDirectoryContext()
      + (projectContext ? '\n\nProject context:\n' + projectContext : '');

    const messages: AIMessage[] = [
      { role: 'system', content: systemContent },
      ...state.conversationHistory,
    ];

    let fullResponse = '';
    await streamChat(messages, {
      onToken(token: string) {
        fullResponse += token;
      },
      onComplete(text: string) {
        stopSpinner(spinner);
        fullResponse = text;
        console.log();
        console.log(`  ${palette.violet('\u2728 Orion:')}`);
        console.log();
        console.log(renderMarkdown(text));
        state.conversationHistory.push({ role: 'assistant', content: text });
      },
      onError(error: Error) {
        stopSpinner(spinner, error.message, false);
      },
    });
  } catch (err: any) {
    stopSpinner(spinner);
    printError(`AI response failed: ${err.message}`);
  }

  return false;
}

// ─── Main Command ───────────────────────────────────────────────────────────

export async function pairCommand(): Promise<void> {
  console.log(commandHeader('Orion Pair Programming'));

  // Load project context
  const projectContext = loadProjectContext() || '';

  // Load patterns if available (from orion learn)
  let patternsContext = '';
  const patternsFile = path.join(process.cwd(), '.orion', 'patterns.md');
  if (fs.existsSync(patternsFile)) {
    try {
      patternsContext = fs.readFileSync(patternsFile, 'utf-8');
      printInfo(`Loaded project patterns from ${colors.file('.orion/patterns.md')}`);
    } catch {
      // skip
    }
  }

  const fullProjectContext = projectContext
    + (patternsContext ? '\n\nProject Patterns:\n' + patternsContext : '');

  // Initialize state
  const state: PairState = {
    paused: false,
    fileSnapshots: new Map(),
    changeHistory: [],
    conversationHistory: [],
    reviewCount: 0,
    suggestCount: 0,
    sessionStart: new Date(),
  };

  // Set up file watcher using chokidar
  let chokidar: any;
  try {
    chokidar = await import('chokidar');
  } catch {
    printError('chokidar is required for pair programming mode.');
    printInfo('Install it with: npm install chokidar');
    process.exit(1);
    return;
  }

  const ignorePatterns = Array.from(IGNORE_DIRS).map(d => `**/${d}/**`);
  ignorePatterns.push('**/*.map', '**/*.lock', '**/*.log', '**/.DS_Store');

  const watcher = chokidar.watch('.', {
    ignored: ignorePatterns,
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
    depth: 6,
  });

  // Debounce map for file changes
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Handle initial file discovery (build snapshots)
  watcher.on('add', (filePath: string) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) return;

    try {
      const fullPath = path.resolve(filePath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      state.fileSnapshots.set(fullPath, {
        content,
        mtime: Date.now(),
      });
    } catch {
      // skip
    }
  });

  // Handle file changes
  watcher.on('change', (filePath: string) => {
    if (state.paused) return;

    const fullPath = path.resolve(filePath);
    const ext = path.extname(fullPath).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) return;

    // Debounce
    const existing = debounceTimers.get(fullPath);
    if (existing) clearTimeout(existing);

    debounceTimers.set(fullPath, setTimeout(() => {
      debounceTimers.delete(fullPath);
      handleFileChange(fullPath, state, fullProjectContext);
    }, DEBOUNCE_MS));
  });

  // Show welcome
  console.log();
  console.log(`  ${palette.violet.bold('Pair programming session started!')}`);
  console.log();
  console.log(`  ${palette.dim('\u2022')} AI will review your changes on every file save`);
  console.log(`  ${palette.dim('\u2022')} Type questions directly to ask the AI`);
  console.log(`  ${palette.dim('\u2022')} Use ${colors.command('/pause')} to silence, ${colors.command('/resume')} to restart`);
  console.log(`  ${palette.dim('\u2022')} Use ${colors.command('/status')} for session stats, ${colors.command('/exit')} to end`);
  console.log();
  printInfo(`Watching ${colors.file(process.cwd())} for changes...`);
  console.log();

  // Set up readline for user input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
    terminal: true,
  });

  process.stdout.write(`  ${palette.dim('Pair>')} `);

  rl.on('line', async (line: string) => {
    const shouldExit = await handleUserInput(line, state, fullProjectContext, rl);
    if (shouldExit) {
      // Show session summary
      const elapsed = Math.floor((Date.now() - state.sessionStart.getTime()) / 60000);
      console.log();
      console.log(divider('Session Summary'));
      console.log();
      console.log(`  ${palette.blue('Duration:')}      ${elapsed} minutes`);
      console.log(`  ${palette.blue('Reviews:')}       ${state.reviewCount}`);
      console.log(`  ${palette.blue('Suggestions:')}   ${state.suggestCount}`);
      console.log(`  ${palette.blue('Files tracked:')} ${state.fileSnapshots.size}`);
      console.log();

      await watcher.close();
      rl.close();
      printSuccess('Pair programming session ended.');
      console.log();
      process.exit(0);
    } else {
      process.stdout.write(`\n  ${palette.dim('Pair>')} `);
    }
  });

  rl.on('close', async () => {
    await watcher.close();
    console.log();
    printInfo('Pair programming session ended.');
    console.log();
    process.exit(0);
  });
}
