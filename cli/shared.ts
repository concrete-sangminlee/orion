/**
 * Orion CLI - Shared Utilities & Patterns
 * Eliminates duplicated code across commands.
 * Provides: stream handler factory, spinner wrapper, file validation.
 */

import * as path from 'path';
import chalk from 'chalk';
import type { Ora } from 'ora';
import { askAI, type AIStreamCallbacks } from './ai-client.js';
import { renderMarkdown } from './markdown.js';
import {
  colors,
  startSpinner,
  stopSpinner,
  readFileContent,
  fileExists,
  printError,
  printInfo,
} from './utils.js';

// ─── Stream Handler Factory ─────────────────────────────────────────────────

export interface StreamHandlerOptions {
  /** Label printed before the AI response (e.g., "Orion:") */
  label?: string;
  /** Whether to render the final output as markdown (default: true) */
  markdown?: boolean;
  /** Whether to print streaming tokens to stdout (default: true) */
  showStreaming?: boolean;
  /** Callback to run with the full response text after streaming completes */
  onResponse?: (fullText: string) => void;
}

export interface StreamHandlerResult {
  callbacks: AIStreamCallbacks;
  /** Call this to get the full response text after streaming is done */
  getResponse: () => string;
}

/**
 * Factory function that creates standard onToken/onComplete/onError callbacks.
 * Handles spinner lifecycle, streaming output, and markdown rendering.
 *
 * Usage:
 *   const { callbacks } = createStreamHandler(spinner, { label: 'Orion:' });
 *   await askAI(systemPrompt, userMessage, callbacks);
 */
export function createStreamHandler(
  spinner: Ora,
  options: StreamHandlerOptions = {}
): StreamHandlerResult {
  const {
    label,
    markdown = true,
    showStreaming = true,
    onResponse,
  } = options;

  let firstToken = true;
  let fullText = '';

  const callbacks: AIStreamCallbacks = {
    onToken(token: string) {
      if (firstToken) {
        stopSpinner(spinner);
        firstToken = false;
        if (label) {
          process.stdout.write(`\n  ${colors.label(label)} `);
        }
      }
      fullText += token;
      if (showStreaming) {
        process.stdout.write(chalk.dim(token));
      }
    },

    onComplete(text: string) {
      if (firstToken) stopSpinner(spinner);
      fullText = text;

      if (showStreaming && markdown) {
        // Clear the raw streamed text and re-render as markdown
        // Move to a new line after streaming output
        process.stdout.write('\r\x1b[K'); // clear current line
      }

      if (markdown) {
        // Print the full rendered markdown
        console.log();
        console.log(renderMarkdown(text));
      } else if (!showStreaming) {
        console.log();
      } else {
        console.log();
      }

      onResponse?.(text);
    },

    onError(error: Error) {
      stopSpinner(spinner, error.message, false);
    },
  };

  return {
    callbacks,
    getResponse: () => fullText,
  };
}

// ─── Silent Stream Handler (collect response only, no output) ────────────────

/**
 * Creates a stream handler that silently collects the response.
 * Used by fix, edit, and commit commands that need the raw text.
 */
export function createSilentStreamHandler(
  spinner: Ora,
  spinnerSuccessText?: string
): StreamHandlerResult {
  let fullText = '';

  const callbacks: AIStreamCallbacks = {
    onToken(token: string) {
      fullText += token;
    },
    onComplete(text: string) {
      fullText = text;
      if (spinnerSuccessText) {
        stopSpinner(spinner, spinnerSuccessText);
      } else {
        stopSpinner(spinner);
      }
    },
    onError(error: Error) {
      stopSpinner(spinner, error.message, false);
    },
  };

  return {
    callbacks,
    getResponse: () => fullText,
  };
}

// ─── Spinner Wrapper ─────────────────────────────────────────────────────────

/**
 * Wraps an async operation with a spinner.
 * Starts spinner, runs fn, stops spinner on success/error.
 *
 * Usage:
 *   const result = await withSpinner('Loading...', async () => {
 *     return await someAsyncOperation();
 *   });
 */
export async function withSpinner<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const spinner = startSpinner(label);
  try {
    const result = await fn();
    stopSpinner(spinner);
    return result;
  } catch (err: any) {
    stopSpinner(spinner, err.message, false);
    throw err;
  }
}

// ─── File Validation ─────────────────────────────────────────────────────────

export interface ValidatedFile {
  content: string;
  language: string;
  resolvedPath: string;
  lineCount: number;
  fileName: string;
}

/**
 * Reads and validates a file, printing informative error messages on failure.
 * Combines readFileContent + fileExists + error messaging.
 *
 * Usage:
 *   const file = readAndValidateFile('src/index.ts');
 *   if (!file) return; // error was already printed
 */
export function readAndValidateFile(filePath: string): ValidatedFile | null {
  const resolvedPath = path.resolve(filePath);

  if (!fileExists(filePath)) {
    console.log();
    printError(`File not found: ${resolvedPath}`);
    printInfo(`Check the path and try again.`);
    printInfo(`Tip: Use tab completion or provide an absolute path.`);
    console.log();
    return null;
  }

  try {
    const { content, language } = readFileContent(filePath);
    const lineCount = content.split('\n').length;
    const fileName = path.basename(filePath);

    return { content, language, resolvedPath, lineCount, fileName };
  } catch (err: any) {
    console.log();
    printError(err.message);
    if (err.message.includes('too large')) {
      printInfo(`Try splitting the file or reviewing specific sections.`);
    }
    console.log();
    return null;
  }
}

// ─── File Info Display ───────────────────────────────────────────────────────

/**
 * Prints standardized file information.
 */
export function printFileInfo(file: ValidatedFile): void {
  printInfo(`File: ${colors.file(file.resolvedPath)}`);
  printInfo(`Language: ${file.language} | Lines: ${file.lineCount}`);
}

// ─── Error Display ───────────────────────────────────────────────────────────

/**
 * Prints a formatted error with actionable suggestion and help hint.
 */
export function printCommandError(
  err: Error,
  command: string,
  suggestion?: string
): void {
  console.log();
  printError(err.message);
  if (suggestion) {
    printInfo(suggestion);
  }
  printInfo(`Run ${colors.command(`orion ${command} --help`)} for usage.`);
  console.log();
}
