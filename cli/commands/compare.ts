/**
 * Orion CLI - Compare Command
 * AI-powered file comparison and technology approach analysis.
 *
 * Usage:
 *   orion compare file1.ts file2.ts                          # Compare two files
 *   orion compare --approach "Redux vs Zustand for this project"  # Compare tech approaches
 */

import * as path from 'path';
import { askAI } from '../ai-client.js';
import {
  colors,
  startSpinner,
  getCurrentDirectoryContext,
  loadProjectContext,
  printError,
  printInfo,
} from '../utils.js';
import { readAndValidateFile, createStreamHandler, printCommandError } from '../shared.js';
import { renderMarkdown } from '../markdown.js';
import { commandHeader, divider, table, palette } from '../ui.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';

// ─── System Prompts ──────────────────────────────────────────────────────────

const FILE_COMPARE_PROMPT = `You are Orion, an expert code analyst specializing in comparing code files.
Given two files, provide a thorough, structured comparison.

Your analysis MUST include these sections:

## Overview
<1-2 sentence summary of what each file does and their relationship>

## Comparison Table
Create a markdown table with these columns: Aspect, File A, File B
Include rows for: Purpose, Size/Complexity, Design Pattern, Error Handling, Performance, Readability, Testability

## Key Differences
<Numbered list of the most significant differences, with specific code references>

## Similarities
<What the files have in common>

## Pros & Cons

### File A: <filename>
**Pros:**
- <list>

**Cons:**
- <list>

### File B: <filename>
**Pros:**
- <list>

**Cons:**
- <list>

## Recommendation
<Which approach is better and why, or when to use each. Be specific and actionable.>

Be precise: reference actual functions, patterns, and line-level details from the code.
If the files serve different purposes, note that and compare their quality independently.`;

const APPROACH_COMPARE_PROMPT = `You are Orion, a senior architect providing expert analysis on technology decisions.
Given a comparison question and project context, provide a thorough, balanced analysis.

Your analysis MUST include these sections:

## Overview
<Brief explanation of what is being compared and why it matters>

## Comparison Table
Create a markdown table comparing key aspects. Use columns for each option being compared.
Include rows for: Learning Curve, Performance, Bundle Size, Community/Ecosystem, TypeScript Support, Scalability, Developer Experience, Maturity

## Detailed Analysis

### Option A: <name>
**Strengths:**
- <list with explanations>

**Weaknesses:**
- <list with explanations>

**Best for:**
- <use cases>

### Option B: <name>
**Strengths:**
- <list with explanations>

**Weaknesses:**
- <list with explanations>

**Best for:**
- <use cases>

## For This Project
<Specific recommendation based on the project context provided. Reference the project's tech stack, size, and requirements.>

## Migration Considerations
<If switching from one to the other, what's involved?>

## Verdict
<Clear recommendation with reasoning. Don't sit on the fence - pick one and explain why.>

Be honest about trade-offs. Avoid generic advice - tailor recommendations to the specific project context.`;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CompareCommandOptions {
  approach?: string;
}

// ─── Command Entry Point ────────────────────────────────────────────────────

export async function compareCommand(
  files: string[],
  options: CompareCommandOptions = {}
): Promise<void> {
  const pipelineOpts = getPipelineOptions();

  // ─── Approach Comparison Mode ─────────────────────────────────────────
  if (options.approach) {
    await compareApproaches(options.approach);
    return;
  }

  // ─── File Comparison Mode ─────────────────────────────────────────────
  if (files.length < 2) {
    console.log();
    printError('Two files are required for comparison.');
    printInfo('Usage: orion compare <file1> <file2>');
    printInfo('  or:  orion compare --approach "Option A vs Option B"');
    console.log();
    process.exit(1);
  }

  await compareFiles(files[0], files[1]);
}

// ─── File Comparison ────────────────────────────────────────────────────────

async function compareFiles(filePathA: string, filePathB: string): Promise<void> {
  // Read and validate both files
  const fileA = readAndValidateFile(filePathA);
  if (!fileA) {
    process.exit(1);
    return;
  }

  const fileB = readAndValidateFile(filePathB);
  if (!fileB) {
    process.exit(1);
    return;
  }

  // Display header
  console.log(commandHeader('Orion File Comparison', [
    ['File A', colors.file(fileA.resolvedPath)],
    ['File B', colors.file(fileB.resolvedPath)],
  ]));

  // Show file info table
  console.log(table(
    ['Attribute', fileA.fileName, fileB.fileName],
    [
      ['Language', fileA.language, fileB.language],
      ['Lines', `${fileA.lineCount}`, `${fileB.lineCount}`],
      ['Size', formatSize(fileA.content.length), formatSize(fileB.content.length)],
    ]
  ));
  console.log();
  console.log(divider());
  console.log();

  // Truncate files if too large
  const MAX_FILE_CHARS = 15000;
  let contentA = fileA.content;
  let contentB = fileB.content;
  let truncated = false;

  if (contentA.length > MAX_FILE_CHARS) {
    contentA = contentA.substring(0, MAX_FILE_CHARS);
    truncated = true;
  }
  if (contentB.length > MAX_FILE_CHARS) {
    contentB = contentB.substring(0, MAX_FILE_CHARS);
    truncated = true;
  }

  if (truncated) {
    console.log(`  ${palette.yellow('! One or both files truncated to ~15K chars for AI analysis.')}`);
    console.log();
  }

  // Send to AI
  const spinner = startSpinner('AI is comparing files...');

  const context = getCurrentDirectoryContext();
  const projectContext = loadProjectContext();
  const fullSystemPrompt = projectContext
    ? FILE_COMPARE_PROMPT + '\n\nWorkspace context:\n' + context + '\n\nProject context:\n' + projectContext
    : FILE_COMPARE_PROMPT + '\n\nWorkspace context:\n' + context;

  const userMessage =
    `Compare these two files:\n\n` +
    `### File A: ${fileA.fileName} (${fileA.language}, ${fileA.lineCount} lines)\n` +
    `\`\`\`${fileA.language}\n${contentA}\n\`\`\`\n\n` +
    `### File B: ${fileB.fileName} (${fileB.language}, ${fileB.lineCount} lines)\n` +
    `\`\`\`${fileB.language}\n${contentB}\n\`\`\``;

  try {
    const { callbacks, getResponse } = createStreamHandler(spinner, {
      markdown: true,
    });

    await askAI(fullSystemPrompt, userMessage, callbacks);

    const analysis = getResponse();

    jsonOutput('compare-files', {
      fileA: { path: fileA.resolvedPath, language: fileA.language, lines: fileA.lineCount },
      fileB: { path: fileB.resolvedPath, language: fileB.language, lines: fileB.lineCount },
      analysis,
    });
  } catch (err: any) {
    printCommandError(err, 'compare', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}

// ─── Approach Comparison ────────────────────────────────────────────────────

async function compareApproaches(question: string): Promise<void> {
  console.log(commandHeader('Orion Approach Comparison', [
    ['Question', question],
  ]));

  const spinner = startSpinner('AI is analyzing approaches...');

  const context = getCurrentDirectoryContext();
  const projectContext = loadProjectContext();
  const fullSystemPrompt = projectContext
    ? APPROACH_COMPARE_PROMPT + '\n\nWorkspace context:\n' + context + '\n\nProject context:\n' + projectContext
    : APPROACH_COMPARE_PROMPT + '\n\nWorkspace context:\n' + context;

  const userMessage =
    `Compare and analyze the following:\n\n${question}\n\n` +
    `Provide a thorough comparison tailored to this specific project and its tech stack.`;

  try {
    const { callbacks, getResponse } = createStreamHandler(spinner, {
      markdown: true,
    });

    await askAI(fullSystemPrompt, userMessage, callbacks);

    const analysis = getResponse();

    jsonOutput('compare-approaches', {
      question,
      analysis,
    });
  } catch (err: any) {
    printCommandError(err, 'compare', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}
