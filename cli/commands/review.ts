/**
 * Orion CLI - Code Review Command
 * AI-powered code review with severity levels and markdown rendering
 */

import * as fs from 'fs';
import * as path from 'path';
import { askAI } from '../ai-client.js';
import {
  colors,
  printHeader,
  printDivider,
  printInfo,
  printWarning,
  startSpinner,
  stopSpinner,
  loadProjectContext,
} from '../utils.js';
import { renderMarkdown } from '../markdown.js';
import {
  readAndValidateFile,
  printFileInfo,
  printCommandError,
} from '../shared.js';
import { readStdin } from '../stdin.js';

const REVIEW_SYSTEM_PROMPT = `You are Orion, an expert code reviewer. Analyze the provided code and give a thorough review.

For each finding, use this exact format:
[ERROR] <title>: <description>
[WARNING] <title>: <description>
[INFO] <title>: <description>

Categories to check:
- Bugs and logic errors
- Security vulnerabilities
- Performance issues
- Code style and readability
- Best practices violations
- Missing error handling
- Type safety issues
- Potential race conditions

End with a brief summary and overall quality score (1-10).
Be specific: reference line numbers and variable names when possible.`;

function colorizeSeverity(line: string): string {
  if (line.startsWith('[ERROR]')) {
    return colors.severityError(' ERROR ') + ' ' + colors.error(line.replace('[ERROR] ', ''));
  }
  if (line.startsWith('[WARNING]')) {
    return colors.severityWarning(' WARN  ') + ' ' + colors.warning(line.replace('[WARNING] ', ''));
  }
  if (line.startsWith('[INFO]')) {
    return colors.severityInfo(' INFO  ') + ' ' + colors.info(line.replace('[INFO] ', ''));
  }
  return line;
}

function renderReviewOutput(text: string): void {
  const lines = text.split('\n');
  const nonSeverityLines: string[] = [];
  let hasSeverityLines = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[ERROR]') || trimmed.startsWith('[WARNING]') || trimmed.startsWith('[INFO]')) {
      // Flush any accumulated non-severity text as markdown
      if (nonSeverityLines.length > 0) {
        const mdBlock = nonSeverityLines.join('\n');
        if (mdBlock.trim()) {
          console.log(renderMarkdown(mdBlock));
        }
        nonSeverityLines.length = 0;
      }
      console.log(`  ${colorizeSeverity(trimmed)}`);
      hasSeverityLines = true;
    } else {
      nonSeverityLines.push(line);
    }
  }

  // Flush remaining non-severity text
  if (nonSeverityLines.length > 0) {
    const mdBlock = nonSeverityLines.join('\n');
    if (mdBlock.trim()) {
      console.log(renderMarkdown(mdBlock));
    }
  }
}

async function reviewSingleFile(filePath: string): Promise<void> {
  const file = readAndValidateFile(filePath);
  if (!file) return;

  printFileInfo(file);
  printDivider();
  console.log();

  const spinner = startSpinner('Analyzing code...');

  try {
    const userMessage = `Review this ${file.language} file (${file.fileName}):\n\n\`\`\`${file.language}\n${file.content}\n\`\`\``;

    const projectContext = loadProjectContext();
    const fullSystemPrompt = projectContext
      ? REVIEW_SYSTEM_PROMPT + '\n\nProject context:\n' + projectContext
      : REVIEW_SYSTEM_PROMPT;

    let fullResponse = '';

    await askAI(fullSystemPrompt, userMessage, {
      onToken(token: string) {
        stopSpinner(spinner);
        fullResponse += token;
      },
      onComplete(text: string) {
        console.log();
        renderReviewOutput(text);
        console.log();
      },
      onError(error: Error) {
        stopSpinner(spinner, error.message, false);
      },
    });
  } catch (err: any) {
    stopSpinner(spinner, err.message, false);
    printCommandError(err, 'review', 'Run `orion config` to check your AI provider settings.');
  }
}

async function reviewDirectory(): Promise<void> {
  const cwd = process.cwd();
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp'];
  const ignorePatterns = ['node_modules', 'dist', 'build', '.git', '__pycache__', '.next'];

  const files: string[] = [];

  function scanDir(dir: string, depth: number = 0): void {
    if (depth > 3) return;
    if (files.length >= 10) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignorePatterns.some(p => entry.name === p)) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath, depth + 1);
        } else if (extensions.some(ext => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    } catch { /* skip inaccessible dirs */ }
  }

  scanDir(cwd);

  if (files.length === 0) {
    console.log();
    printWarning('No reviewable files found in current directory.');
    printInfo('Navigate to a project directory with source files and try again.');
    console.log();
    return;
  }

  printInfo(`Found ${files.length} file(s) to review`);
  console.log();

  for (const file of files.slice(0, 5)) {
    await reviewSingleFile(file);
    printDivider();
  }
}

async function reviewStdinContent(content: string): Promise<void> {
  const lineCount = content.split('\n').length;
  printInfo(`Reviewing piped input... (${lineCount} lines)`);
  printDivider();
  console.log();

  const spinner = startSpinner('Analyzing code...');

  try {
    const userMessage = `Review this code:\n\n\`\`\`\n${content}\n\`\`\``;

    const projectContext = loadProjectContext();
    const fullSystemPrompt = projectContext
      ? REVIEW_SYSTEM_PROMPT + '\n\nProject context:\n' + projectContext
      : REVIEW_SYSTEM_PROMPT;

    let fullResponse = '';

    await askAI(fullSystemPrompt, userMessage, {
      onToken(token: string) {
        stopSpinner(spinner);
        fullResponse += token;
      },
      onComplete(text: string) {
        console.log();
        renderReviewOutput(text);
        console.log();
      },
      onError(error: Error) {
        stopSpinner(spinner, error.message, false);
      },
    });
  } catch (err: any) {
    stopSpinner(spinner, err.message, false);
    printCommandError(err, 'review', 'Run `orion config` to check your AI provider settings.');
  }
}

export async function reviewCommand(filePath?: string): Promise<void> {
  printHeader('Orion Code Review');

  // Check for piped stdin data
  const stdinData = await readStdin();

  if (filePath) {
    await reviewSingleFile(filePath);
  } else if (stdinData) {
    await reviewStdinContent(stdinData);
  } else {
    printInfo('Scanning current directory for files to review...');
    await reviewDirectory();
  }
}
