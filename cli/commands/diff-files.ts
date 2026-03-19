/**
 * Orion CLI - Diff Files Command
 * Compare any two files with side-by-side diff and AI-powered explanation.
 *
 * Usage:
 *   orion diff-files old.ts new.ts            # Side-by-side diff with AI explanation
 *   orion diff-files v1/api.ts v2/api.ts --explain   # Explain what changed and why
 */

import * as fs from 'fs';
import * as path from 'path';
import { askAI } from '../ai-client.js';
import {
  colors,
  startSpinner,
  loadProjectContext,
  getCurrentDirectoryContext,
  printError,
  printInfo,
} from '../utils.js';
import { createStreamHandler, readAndValidateFile, printCommandError } from '../shared.js';
import { commandHeader, divider, table as uiTable, palette, badge } from '../ui.js';
import { renderMarkdown } from '../markdown.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_FILE_CHARS = 20000; // Max chars per file for AI context
const MAX_DIFF_LINES = 200;   // Max diff lines to display

// ─── System Prompts ──────────────────────────────────────────────────────────

const DIFF_EXPLAIN_PROMPT = `You are Orion, an expert code analyst specializing in understanding code changes.
Given two versions of a file, provide a detailed analysis of what changed and why.

You MUST structure your response with these exact sections:

## Change Summary
<1-2 sentence high-level summary of what changed>

## Changes Breakdown

For each significant change:
### <number>. <change title>
- **Type**: Added | Removed | Modified | Refactored | Moved
- **Location**: <function/section reference>
- **What**: <what specifically changed>
- **Why**: <inferred reason for the change>
- **Impact**: <effect on behavior, performance, or API>

## Statistics

| Metric | Value |
|--------|-------|
| Lines added | <count> |
| Lines removed | <count> |
| Functions affected | <count> |
| Breaking changes | Yes/No |

## Risk Assessment
- **Risk Level**: LOW / MEDIUM / HIGH
- **Concerns**: <any potential issues with these changes>
- **Suggestions**: <improvements or things to watch out for>

Be precise: reference actual function names, variable names, and line-level details.
If the changes are straightforward and clean, say so. Don't invent issues.`;

const DIFF_BASIC_PROMPT = `You are Orion, a code analyst. Given two versions of a file, provide a concise summary of the differences.

Structure your response as:

## Summary
<Brief overview of the changes>

## Key Changes
1. <change 1>
2. <change 2>
...

## Impact
<Brief assessment of the impact of these changes>

Be concise but thorough. Reference specific code elements.`;

// ─── Diff Engine ─────────────────────────────────────────────────────────────

interface DiffLine {
  type: 'same' | 'add' | 'remove' | 'modify';
  lineA?: number;
  lineB?: number;
  contentA?: string;
  contentB?: string;
}

interface DiffResult {
  lines: DiffLine[];
  stats: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

/**
 * Simple line-based diff using longest common subsequence.
 */
function computeDiff(contentA: string, contentB: string): DiffResult {
  const linesA = contentA.split('\n');
  const linesB = contentB.split('\n');

  // LCS table
  const m = linesA.length;
  const n = linesB.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const diffLines: DiffLine[] = [];
  let i = m;
  let j = n;

  const rawDiff: Array<{ type: 'same' | 'add' | 'remove'; line: string; idxA?: number; idxB?: number }> = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      rawDiff.unshift({ type: 'same', line: linesA[i - 1], idxA: i, idxB: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawDiff.unshift({ type: 'add', line: linesB[j - 1], idxB: j });
      j--;
    } else if (i > 0) {
      rawDiff.unshift({ type: 'remove', line: linesA[i - 1], idxA: i });
      i--;
    }
  }

  // Convert to DiffLine format
  let stats = { added: 0, removed: 0, modified: 0, unchanged: 0 };

  for (const entry of rawDiff) {
    if (entry.type === 'same') {
      diffLines.push({
        type: 'same',
        lineA: entry.idxA,
        lineB: entry.idxB,
        contentA: entry.line,
        contentB: entry.line,
      });
      stats.unchanged++;
    } else if (entry.type === 'add') {
      diffLines.push({
        type: 'add',
        lineB: entry.idxB,
        contentB: entry.line,
      });
      stats.added++;
    } else {
      diffLines.push({
        type: 'remove',
        lineA: entry.idxA,
        contentA: entry.line,
      });
      stats.removed++;
    }
  }

  return { lines: diffLines, stats };
}

// ─── Display ─────────────────────────────────────────────────────────────────

function displayDiff(diff: DiffResult, fileA: string, fileB: string): void {
  const nameA = path.basename(fileA);
  const nameB = path.basename(fileB);

  // Show diff with colored output
  const changelines = diff.lines.filter(l => l.type !== 'same');
  const displayLines = diff.lines.length > MAX_DIFF_LINES
    ? diff.lines.filter(l => l.type !== 'same').slice(0, MAX_DIFF_LINES)
    : diff.lines;

  // Group consecutive changes with context
  let contextWindow = 3; // lines of context around changes
  const visibleLines: Set<number> = new Set();

  diff.lines.forEach((line, idx) => {
    if (line.type !== 'same') {
      for (let c = Math.max(0, idx - contextWindow); c <= Math.min(diff.lines.length - 1, idx + contextWindow); c++) {
        visibleLines.add(c);
      }
    }
  });

  let lastPrinted = -2;
  let lineCount = 0;

  for (let idx = 0; idx < diff.lines.length; idx++) {
    if (!visibleLines.has(idx)) continue;
    if (lineCount >= MAX_DIFF_LINES) {
      console.log(`  ${palette.dim('  ...')}`);
      console.log(`  ${palette.yellow(`  (${changelines.length - lineCount} more changes not shown)`)}`);
      break;
    }

    if (idx - lastPrinted > 1 && lastPrinted >= 0) {
      console.log(`  ${palette.dim('  ...')}`);
    }
    lastPrinted = idx;

    const line = diff.lines[idx];
    const lineNumA = line.lineA ? String(line.lineA).padStart(4) : '    ';
    const lineNumB = line.lineB ? String(line.lineB).padStart(4) : '    ';

    switch (line.type) {
      case 'same':
        console.log(`  ${palette.dim(`${lineNumA} ${lineNumB}  `)}${palette.dim(line.contentA || '')}`);
        break;
      case 'add':
        console.log(`  ${palette.dim(`     ${lineNumB}`)} ${palette.green('+ ' + (line.contentB || ''))}`);
        lineCount++;
        break;
      case 'remove':
        console.log(`  ${palette.dim(`${lineNumA}     `)} ${palette.red('- ' + (line.contentA || ''))}`);
        lineCount++;
        break;
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

// ─── Command Entry Point ────────────────────────────────────────────────────

export interface DiffFilesOptions {
  explain?: boolean;
}

export async function diffFilesCommand(
  fileA?: string,
  fileB?: string,
  options: DiffFilesOptions = {}
): Promise<void> {
  if (!fileA || !fileB) {
    console.log();
    printError('Two files are required for comparison.');
    console.log();
    console.log(`  ${palette.violet.bold('Usage:')}`);
    console.log(`  ${palette.dim('  orion diff-files old.ts new.ts                 # Side-by-side diff with AI summary')}`);
    console.log(`  ${palette.dim('  orion diff-files v1/api.ts v2/api.ts --explain # Detailed AI explanation')}`);
    console.log();
    process.exit(1);
    return;
  }

  // Read both files
  const resolvedA = path.resolve(fileA);
  const resolvedB = path.resolve(fileB);

  if (!fs.existsSync(resolvedA)) {
    printError(`File not found: ${resolvedA}`);
    process.exit(1);
    return;
  }

  if (!fs.existsSync(resolvedB)) {
    printError(`File not found: ${resolvedB}`);
    process.exit(1);
    return;
  }

  const contentA = fs.readFileSync(resolvedA, 'utf-8');
  const contentB = fs.readFileSync(resolvedB, 'utf-8');
  const linesA = contentA.split('\n').length;
  const linesB = contentB.split('\n').length;
  const sizeA = Buffer.byteLength(contentA, 'utf-8');
  const sizeB = Buffer.byteLength(contentB, 'utf-8');

  // Compute diff
  const diff = computeDiff(contentA, contentB);

  // Display header
  console.log(commandHeader('Orion File Diff', [
    ['File A', colors.file(resolvedA)],
    ['File B', colors.file(resolvedB)],
  ]));

  // File comparison table
  console.log(uiTable(
    ['Attribute', path.basename(fileA), path.basename(fileB)],
    [
      ['Lines', String(linesA), String(linesB)],
      ['Size', formatSize(sizeA), formatSize(sizeB)],
    ]
  ));
  console.log();

  // Stats badges
  const statsLine = [
    badge(`+${diff.stats.added}`, '#22C55E'),
    badge(`-${diff.stats.removed}`, '#EF4444'),
    badge(`${diff.stats.unchanged} unchanged`, '#7C5CFC'),
  ].join('  ');
  console.log(`  ${statsLine}`);
  console.log();

  // Check if files are identical
  if (diff.stats.added === 0 && diff.stats.removed === 0) {
    console.log(`  ${palette.green('Files are identical. No differences found.')}`);
    console.log();
    return;
  }

  // Display diff
  console.log(divider('Diff'));
  console.log();
  displayDiff(diff, fileA, fileB);
  console.log();

  // AI analysis
  console.log(divider('AI Analysis'));
  console.log();

  const spinner = startSpinner(
    options.explain
      ? 'AI is analyzing changes in detail...'
      : 'AI is summarizing differences...'
  );

  // Prepare content for AI
  let contentForAI_A = contentA;
  let contentForAI_B = contentB;
  let truncated = false;

  if (contentForAI_A.length > MAX_FILE_CHARS) {
    contentForAI_A = contentForAI_A.substring(0, MAX_FILE_CHARS);
    truncated = true;
  }
  if (contentForAI_B.length > MAX_FILE_CHARS) {
    contentForAI_B = contentForAI_B.substring(0, MAX_FILE_CHARS);
    truncated = true;
  }

  if (truncated) {
    console.log(`  ${palette.yellow('! Files truncated to ~20K chars for AI analysis.')}`);
    console.log();
  }

  const context = getCurrentDirectoryContext();
  const projectContext = loadProjectContext();
  const systemPrompt = options.explain ? DIFF_EXPLAIN_PROMPT : DIFF_BASIC_PROMPT;
  const fullSystemPrompt = projectContext
    ? systemPrompt + '\n\nWorkspace context:\n' + context + '\n\nProject context:\n' + projectContext
    : systemPrompt + '\n\nWorkspace context:\n' + context;

  const nameA = path.basename(fileA);
  const nameB = path.basename(fileB);

  const userMessage =
    `Compare these two file versions:\n\n` +
    `### File A: ${nameA} (${linesA} lines)\n` +
    `\`\`\`\n${contentForAI_A}\n\`\`\`\n\n` +
    `### File B: ${nameB} (${linesB} lines)\n` +
    `\`\`\`\n${contentForAI_B}\n\`\`\`\n\n` +
    `Diff stats: +${diff.stats.added} added, -${diff.stats.removed} removed, ${diff.stats.unchanged} unchanged`;

  try {
    const { callbacks, getResponse } = createStreamHandler(spinner, {
      markdown: true,
    });

    await askAI(fullSystemPrompt, userMessage, callbacks);

    jsonOutput('diff-files', {
      fileA: { path: resolvedA, lines: linesA, size: sizeA },
      fileB: { path: resolvedB, lines: linesB, size: sizeB },
      stats: diff.stats,
      analysis: getResponse(),
    });
  } catch (err: any) {
    printCommandError(err, 'diff-files', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}
