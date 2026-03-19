/**
 * Orion CLI - AI-Powered Debugging Assistant
 * Analyzes files for potential bugs, diagnoses errors, and parses stack traces.
 *
 * Usage:
 *   orion debug src/app.ts              # Analyze file for potential bugs
 *   orion debug --error "TypeError: ..."  # Diagnose a specific error
 *   orion debug --stacktrace              # Paste a stack trace for analysis
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { askAI } from '../ai-client.js';
import {
  colors,
  startSpinner,
  loadProjectContext,
} from '../utils.js';
import {
  createStreamHandler,
  readAndValidateFile,
  printCommandError,
} from '../shared.js';
import { readStdin } from '../stdin.js';
import { commandHeader, badge, divider, palette } from '../ui.js';
import { renderMarkdown } from '../markdown.js';

// ─── System Prompts ──────────────────────────────────────────────────────────

const DEBUG_FILE_PROMPT = `You are Orion, an expert debugging assistant. Analyze the provided source code for potential bugs, logic errors, and runtime issues.

For each issue found, classify its severity and format as follows:

[CRITICAL] <title>
Description of the bug, why it happens, and the impact.
**Root Cause:** Explain the fundamental reason.
**Fix:** Show the corrected code.
**Prevention:** How to prevent this class of bug.

[WARNING] <title>
Description and details in the same format.

[INFO] <title>
Description and details in the same format.

Categories to check:
- Null/undefined reference errors
- Off-by-one errors and boundary conditions
- Race conditions and async bugs
- Type coercion pitfalls
- Unhandled promise rejections
- Resource leaks (memory, file handles, connections)
- Incorrect error handling (swallowed errors, wrong catch scope)
- Logic errors (wrong operators, inverted conditions)
- Security issues (injection, XSS, prototype pollution)

End with a summary: total issues found per severity, and an overall reliability score (1-10).
Use markdown formatting for readability.`;

const DEBUG_ERROR_PROMPT = `You are Orion, an expert debugging assistant. A developer encountered the following error. Diagnose it thoroughly.

Provide your analysis in this structure:

## Root Cause
Explain exactly why this error occurs.

## Affected Code
Show what code pattern typically triggers this error with an example.

## Fix Suggestion
Provide the corrected code with explanation.

## Prevention Tips
- List best practices to avoid this class of error in the future.

## Related Issues
Mention any related errors or edge cases the developer should watch for.

Be specific, actionable, and use markdown formatting.`;

const DEBUG_STACKTRACE_PROMPT = `You are Orion, an expert debugging assistant. Analyze the following stack trace and provide a thorough diagnosis.

Provide your analysis in this structure:

## Error Summary
One-line description of what went wrong.

## Stack Trace Analysis
Walk through the stack trace from top to bottom, explaining each frame and identifying the origin of the error.

## Root Cause
Explain the fundamental reason this error occurred.

## Fix Suggestion
Provide specific code changes to resolve the issue.

## Prevention Tips
- List practices to avoid this type of error.

Be specific about file names, line numbers, and function names from the stack trace.
Use markdown formatting.`;

// ─── Severity Badge Rendering ────────────────────────────────────────────────

function renderDebugOutput(text: string): void {
  const lines = text.split('\n');
  const buffer: string[] = [];

  function flushBuffer(): void {
    if (buffer.length > 0) {
      const block = buffer.join('\n');
      if (block.trim()) {
        console.log(renderMarkdown(block));
      }
      buffer.length = 0;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('[CRITICAL]')) {
      flushBuffer();
      const title = trimmed.replace('[CRITICAL] ', '');
      console.log(`  ${badge('CRITICAL', '#DC2626')} ${palette.red.bold(title)}`);
    } else if (trimmed.startsWith('[WARNING]')) {
      flushBuffer();
      const title = trimmed.replace('[WARNING] ', '');
      console.log(`  ${badge('WARNING', '#F59E0B')} ${palette.yellow(title)}`);
    } else if (trimmed.startsWith('[INFO]')) {
      flushBuffer();
      const title = trimmed.replace('[INFO] ', '');
      console.log(`  ${badge('INFO', '#3B82F6')} ${palette.blue(title)}`);
    } else {
      buffer.push(line);
    }
  }

  flushBuffer();
}

// ─── Interactive Stack Trace Input ───────────────────────────────────────────

async function readStackTraceInteractive(): Promise<string> {
  console.log();
  console.log(`  ${palette.violet.bold('Paste your stack trace below.')}`);
  console.log(`  ${palette.dim('Press Enter on an empty line when done.')}`);
  console.log(divider());
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const lines: string[] = [];

  return new Promise((resolve) => {
    rl.on('line', (line) => {
      if (line === '' && lines.length > 0) {
        rl.close();
        resolve(lines.join('\n'));
      } else {
        lines.push(line);
      }
    });

    rl.on('close', () => {
      resolve(lines.join('\n'));
    });
  });
}

// ─── Command Entry Points ────────────────────────────────────────────────────

async function debugFile(filePath: string): Promise<void> {
  const file = readAndValidateFile(filePath);
  if (!file) {
    process.exit(1);
  }

  console.log(commandHeader('Orion Debug Assistant', [
    ['File', colors.file(file.resolvedPath)],
    ['Language', `${file.language} \u00B7 ${file.lineCount} lines`],
    ['Mode', 'Bug Analysis'],
  ]));
  console.log();

  const spinner = startSpinner('Scanning for potential bugs...');

  try {
    const projectContext = loadProjectContext();
    const fullSystemPrompt = projectContext
      ? DEBUG_FILE_PROMPT + '\n\nProject context:\n' + projectContext
      : DEBUG_FILE_PROMPT;

    const userMessage = `Analyze this ${file.language} file for potential bugs (${file.fileName}):\n\n\`\`\`${file.language}\n${file.content}\n\`\`\``;

    let fullResponse = '';

    await askAI(fullSystemPrompt, userMessage, {
      onToken(token: string) {
        fullResponse += token;
      },
      onComplete(text: string) {
        spinner.stop();
        console.log();
        renderDebugOutput(text);
        console.log();
      },
      onError(error: Error) {
        spinner.fail(colors.error(error.message));
      },
    });
  } catch (err: any) {
    spinner.stop();
    printCommandError(err, 'debug', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}

async function debugError(errorMessage: string): Promise<void> {
  console.log(commandHeader('Orion Debug Assistant', [
    ['Error', palette.red(errorMessage)],
    ['Mode', 'Error Diagnosis'],
  ]));
  console.log();

  const spinner = startSpinner('Diagnosing error...');

  const { callbacks } = createStreamHandler(spinner, {
    markdown: true,
  });

  try {
    const projectContext = loadProjectContext();
    const fullSystemPrompt = projectContext
      ? DEBUG_ERROR_PROMPT + '\n\nProject context:\n' + projectContext
      : DEBUG_ERROR_PROMPT;

    const userMessage = `Diagnose this error:\n\n\`\`\`\n${errorMessage}\n\`\`\``;

    await askAI(fullSystemPrompt, userMessage, callbacks);
    console.log();
  } catch (err: any) {
    printCommandError(err, 'debug', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}

async function debugStackTrace(stacktrace?: string): Promise<void> {
  let traceContent = stacktrace;

  // Try stdin first
  if (!traceContent) {
    const stdinData = await readStdin();
    if (stdinData) {
      traceContent = stdinData;
    }
  }

  // Fall back to interactive input
  if (!traceContent) {
    traceContent = await readStackTraceInteractive();
  }

  if (!traceContent || !traceContent.trim()) {
    console.log();
    console.log(`  ${colors.error('No stack trace provided.')}`);
    console.log(`  ${palette.dim('Usage: orion debug --stacktrace')}`);
    console.log(`  ${palette.dim('       some-command 2>&1 | orion debug --stacktrace')}`);
    console.log();
    process.exit(1);
  }

  console.log(commandHeader('Orion Debug Assistant', [
    ['Lines', String(traceContent.split('\n').length)],
    ['Mode', 'Stack Trace Analysis'],
  ]));
  console.log();

  const spinner = startSpinner('Analyzing stack trace...');

  const { callbacks } = createStreamHandler(spinner, {
    markdown: true,
  });

  try {
    const projectContext = loadProjectContext();
    const fullSystemPrompt = projectContext
      ? DEBUG_STACKTRACE_PROMPT + '\n\nProject context:\n' + projectContext
      : DEBUG_STACKTRACE_PROMPT;

    const userMessage = `Analyze this stack trace:\n\n\`\`\`\n${traceContent}\n\`\`\``;

    await askAI(fullSystemPrompt, userMessage, callbacks);
    console.log();
  } catch (err: any) {
    printCommandError(err, 'debug', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}

// ─── Exported Command ────────────────────────────────────────────────────────

export async function debugCommand(
  file?: string,
  options?: { error?: string; stacktrace?: boolean }
): Promise<void> {
  if (options?.error) {
    await debugError(options.error);
  } else if (options?.stacktrace) {
    await debugStackTrace();
  } else if (file) {
    await debugFile(file);
  } else {
    // Check for piped input (treat as stack trace)
    const stdinData = await readStdin();
    if (stdinData) {
      await debugStackTrace(stdinData);
    } else {
      console.log();
      console.log(`  ${colors.error('Please provide a file, error message, or stack trace.')}`);
      console.log();
      console.log(`  ${palette.violet.bold('Usage:')}`);
      console.log(`  ${palette.dim('  orion debug src/app.ts                          # Analyze file for bugs')}`);
      console.log(`  ${palette.dim('  orion debug --error "TypeError: x is not a fn"  # Diagnose an error')}`);
      console.log(`  ${palette.dim('  orion debug --stacktrace                        # Paste a stack trace')}`);
      console.log(`  ${palette.dim('  some-cmd 2>&1 | orion debug                     # Pipe error output')}`);
      console.log();
      process.exit(1);
    }
  }
}
