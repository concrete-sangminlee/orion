/**
 * Orion CLI - AI-Powered Git Blame Analysis
 * Deep blame analysis with author tracking, change history, and hotspot detection.
 *
 * Usage:
 *   orion blame src/app.ts                 # AI summarizes ownership & change history
 *   orion blame src/app.ts --line 42       # Explain why line 42 was changed
 *   orion blame src/app.ts --hotspots      # Find most frequently changed sections
 */

import * as fs from 'fs';
import * as path from 'path';
import { askAI } from '../ai-client.js';
import {
  colors,
  startSpinner,
  stopSpinner,
  isGitRepo,
  runGitCommand,
  loadProjectContext,
} from '../utils.js';
import { printCommandError, readAndValidateFile } from '../shared.js';
import { renderMarkdown } from '../markdown.js';
import { commandHeader, badge, divider, palette, table as uiTable, statusLine } from '../ui.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface BlameLine {
  commitHash: string;
  author: string;
  authorMail: string;
  authorTime: number;
  summary: string;
  lineNumber: number;
  content: string;
}

interface AuthorStats {
  author: string;
  lines: number;
  percentage: number;
  latestCommit: string;
  latestDate: Date;
  commits: Set<string>;
}

interface Hotspot {
  startLine: number;
  endLine: number;
  uniqueAuthors: number;
  uniqueCommits: number;
  latestChange: Date;
  authors: string[];
  preview: string;
}

export interface BlameOptions {
  line?: number;
  hotspots?: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const AUTHOR_COLORS = [
  '#7C5CFC', '#38BDF8', '#22C55E', '#F59E0B', '#EF4444',
  '#D4A574', '#74AA9C', '#9B59B6', '#E879F9', '#06B6D4',
  '#F97316', '#84CC16', '#FB923C', '#A78BFA', '#34D399',
];

const BLAME_SUMMARY_PROMPT = `You are Orion, an expert software analyst specializing in code ownership and change history.
Analyze the following git blame data for a file and provide insights.

Structure your response:

## Ownership Overview
Summarize who owns which parts of the file and what their contributions focus on.

## Change History Insights
- When was the file most actively modified?
- Are there patterns in the changes (e.g., bug fixes concentrated in one area)?
- Are there stale sections that haven't been touched in a long time?

## Code Quality Signals
- Are there too many authors touching the same section (high churn)?
- Are there sections with very recent rapid changes (potential instability)?
- Any signs of knowledge silos (only one person maintains a section)?

## Recommendations
Actionable suggestions based on the analysis (e.g., "Consider extracting lines 50-80 into a separate module" or "Section owned by a single author - consider knowledge sharing").

Be specific: reference line numbers, author names, and dates.`;

const LINE_EXPLAIN_PROMPT = `You are Orion, an expert software analyst. A developer wants to understand why a specific line was changed.

Given the git blame data for a specific line (commit hash, author, date, commit message, and surrounding context), explain:

1. **What Changed**: What does this line do?
2. **Why It Changed**: Based on the commit message and context, why was this change made?
3. **Who Made It**: Who authored this change and when?
4. **Impact**: How does this line relate to the surrounding code?
5. **Context**: Any relevant observations about the change pattern.

Be concise but insightful. Reference the commit hash and date.`;

const HOTSPOT_PROMPT = `You are Orion, an expert software analyst. Analyze these code hotspots - sections of a file with high change frequency and multiple authors.

For each hotspot, explain:
1. **Why is this a hotspot?** - What makes this section change frequently?
2. **Risk Assessment** - Is this normal or a sign of instability?
3. **Suggestions** - How to reduce churn (extract module, add tests, refactor, etc.)

Rate each hotspot: STABLE (normal churn) / WATCH (moderate concern) / CRITICAL (needs attention).

Be specific with line numbers and author names.`;

// ─── Blame Parsing ──────────────────────────────────────────────────────────

function parseBlameOutput(raw: string): BlameLine[] {
  const lines: BlameLine[] = [];
  const chunks = raw.split('\n');

  let currentHash = '';
  let currentAuthor = '';
  let currentMail = '';
  let currentTime = 0;
  let currentSummary = '';
  let lineNumber = 0;

  for (const chunk of chunks) {
    // Commit header line: <hash> <orig-line> <final-line> [<group-count>]
    const headerMatch = chunk.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)/);
    if (headerMatch) {
      currentHash = headerMatch[1];
      lineNumber = parseInt(headerMatch[3], 10);
      continue;
    }

    if (chunk.startsWith('author ')) {
      currentAuthor = chunk.replace('author ', '');
    } else if (chunk.startsWith('author-mail ')) {
      currentMail = chunk.replace('author-mail ', '');
    } else if (chunk.startsWith('author-time ')) {
      currentTime = parseInt(chunk.replace('author-time ', ''), 10);
    } else if (chunk.startsWith('summary ')) {
      currentSummary = chunk.replace('summary ', '');
    } else if (chunk.startsWith('\t')) {
      // Content line (starts with tab)
      lines.push({
        commitHash: currentHash,
        author: currentAuthor,
        authorMail: currentMail,
        authorTime: currentTime,
        summary: currentSummary,
        lineNumber,
        content: chunk.substring(1), // strip leading tab
      });
    }
  }

  return lines;
}

// ─── Author Analysis ────────────────────────────────────────────────────────

function analyzeAuthors(blameLines: BlameLine[]): AuthorStats[] {
  const authorMap = new Map<string, AuthorStats>();

  for (const line of blameLines) {
    const existing = authorMap.get(line.author);
    const lineDate = new Date(line.authorTime * 1000);

    if (existing) {
      existing.lines++;
      existing.commits.add(line.commitHash);
      if (lineDate > existing.latestDate) {
        existing.latestDate = lineDate;
        existing.latestCommit = line.commitHash.substring(0, 7);
      }
    } else {
      authorMap.set(line.author, {
        author: line.author,
        lines: 1,
        percentage: 0,
        latestCommit: line.commitHash.substring(0, 7),
        latestDate: lineDate,
        commits: new Set([line.commitHash]),
      });
    }
  }

  const total = blameLines.length;
  const stats = Array.from(authorMap.values());
  for (const stat of stats) {
    stat.percentage = Math.round((stat.lines / total) * 100);
  }

  return stats.sort((a, b) => b.lines - a.lines);
}

// ─── Hotspot Detection ──────────────────────────────────────────────────────

function detectHotspots(blameLines: BlameLine[], windowSize = 10): Hotspot[] {
  if (blameLines.length < windowSize) return [];

  const hotspots: Hotspot[] = [];

  for (let i = 0; i <= blameLines.length - windowSize; i += Math.max(1, Math.floor(windowSize / 2))) {
    const window = blameLines.slice(i, i + windowSize);
    const uniqueAuthors = new Set(window.map(l => l.author));
    const uniqueCommits = new Set(window.map(l => l.commitHash));

    // A hotspot has multiple authors AND multiple commits in a small window
    if (uniqueAuthors.size >= 2 && uniqueCommits.size >= 3) {
      const latestChange = new Date(Math.max(...window.map(l => l.authorTime * 1000)));
      const preview = window
        .slice(0, 3)
        .map(l => l.content.trim())
        .filter(c => c.length > 0)
        .join(' | ');

      hotspots.push({
        startLine: window[0].lineNumber,
        endLine: window[window.length - 1].lineNumber,
        uniqueAuthors: uniqueAuthors.size,
        uniqueCommits: uniqueCommits.size,
        latestChange,
        authors: Array.from(uniqueAuthors),
        preview: preview.length > 80 ? preview.substring(0, 77) + '...' : preview,
      });
    }
  }

  // Merge overlapping hotspots
  const merged: Hotspot[] = [];
  for (const spot of hotspots) {
    const last = merged[merged.length - 1];
    if (last && spot.startLine <= last.endLine) {
      last.endLine = Math.max(last.endLine, spot.endLine);
      last.uniqueAuthors = Math.max(last.uniqueAuthors, spot.uniqueAuthors);
      last.uniqueCommits = Math.max(last.uniqueCommits, spot.uniqueCommits);
      if (spot.latestChange > last.latestChange) {
        last.latestChange = spot.latestChange;
      }
      const allAuthors = new Set([...last.authors, ...spot.authors]);
      last.authors = Array.from(allAuthors);
    } else {
      merged.push({ ...spot });
    }
  }

  return merged.sort((a, b) => b.uniqueCommits - a.uniqueCommits).slice(0, 10);
}

// ─── Author Color Assignment ────────────────────────────────────────────────

function getAuthorColor(author: string, authorColorMap: Map<string, string>): string {
  if (!authorColorMap.has(author)) {
    const idx = authorColorMap.size % AUTHOR_COLORS.length;
    authorColorMap.set(author, AUTHOR_COLORS[idx]);
  }
  return authorColorMap.get(author)!;
}

// ─── Display Functions ──────────────────────────────────────────────────────

function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function displayAuthorTable(stats: AuthorStats[], authorColorMap: Map<string, string>): void {
  console.log();
  console.log(`  ${palette.violet.bold('Author Ownership')}`);
  console.log();

  const headers = ['Author', 'Lines', '%', 'Commits', 'Last Active'];
  const rows: string[][] = [];

  for (const stat of stats.slice(0, 15)) {
    const colorHex = getAuthorColor(stat.author, authorColorMap);
    const colorFn = palette.violet; // fallback
    const bar = '\u2588'.repeat(Math.max(1, Math.round(stat.percentage / 5)));

    rows.push([
      stat.author,
      String(stat.lines),
      `${stat.percentage}% ${palette.dim(bar)}`,
      String(stat.commits.size),
      formatDate(stat.latestDate),
    ]);
  }

  console.log(uiTable(headers, rows));
}

function displayLineBlame(
  blameLines: BlameLine[],
  targetLine: number,
  authorColorMap: Map<string, string>
): void {
  const line = blameLines.find(l => l.lineNumber === targetLine);
  if (!line) {
    console.log();
    console.log(`  ${palette.red('Line ' + targetLine + ' not found in blame data.')}`);
    console.log(`  ${palette.dim('File has ' + blameLines.length + ' lines.')}`);
    console.log();
    return;
  }

  const commitDate = new Date(line.authorTime * 1000);
  const colorHex = getAuthorColor(line.author, authorColorMap);

  console.log();
  console.log(`  ${palette.violet.bold('Line ' + targetLine + ' Blame Detail')}`);
  console.log();
  console.log(`  ${palette.dim('Commit')}   ${badge(line.commitHash.substring(0, 7), colorHex)}`);
  console.log(`  ${palette.dim('Author')}   ${palette.bold(line.author)} ${palette.dim(line.authorMail)}`);
  console.log(`  ${palette.dim('Date')}     ${commitDate.toISOString().split('T')[0]} ${palette.dim('(' + formatDate(commitDate) + ')')}`);
  console.log(`  ${palette.dim('Message')}  ${line.summary}`);
  console.log();

  // Show surrounding context (5 lines before and after)
  const contextStart = Math.max(0, blameLines.findIndex(l => l.lineNumber === targetLine) - 5);
  const contextEnd = Math.min(blameLines.length, contextStart + 11);
  const contextLines = blameLines.slice(contextStart, contextEnd);

  console.log(`  ${palette.dim('\u2500'.repeat(60))}`);
  for (const cl of contextLines) {
    const lineNum = String(cl.lineNumber).padStart(4);
    const marker = cl.lineNumber === targetLine ? palette.yellow('\u25B6') : ' ';
    const authorTag = badge(cl.author.split(' ')[0].substring(0, 8), getAuthorColor(cl.author, authorColorMap));
    const highlight = cl.lineNumber === targetLine ? palette.bold : palette.dim;
    console.log(`  ${marker} ${palette.dim(lineNum)} ${authorTag} ${highlight(cl.content)}`);
  }
  console.log(`  ${palette.dim('\u2500'.repeat(60))}`);
  console.log();
}

function displayHotspots(hotspots: Hotspot[], authorColorMap: Map<string, string>): void {
  if (hotspots.length === 0) {
    console.log();
    console.log(`  ${palette.green('\u2713')} ${palette.bold('No hotspots detected.')} The file has stable ownership patterns.`);
    console.log();
    return;
  }

  console.log();
  console.log(`  ${palette.violet.bold('Change Hotspots')} ${palette.dim('(sections with high author/commit churn)')}`);
  console.log();

  for (let i = 0; i < hotspots.length; i++) {
    const spot = hotspots[i];
    const severity = spot.uniqueCommits >= 5 ? 'CRITICAL' : spot.uniqueCommits >= 4 ? 'WATCH' : 'STABLE';
    const severityColor = severity === 'CRITICAL' ? '#EF4444' : severity === 'WATCH' ? '#F59E0B' : '#22C55E';

    console.log(`  ${badge(severity, severityColor)} ${palette.bold('Lines ' + spot.startLine + '-' + spot.endLine)}`);
    console.log(`    ${palette.dim('Authors:')} ${spot.authors.map(a => badge(a.split(' ')[0], getAuthorColor(a, authorColorMap))).join(' ')}`);
    console.log(`    ${palette.dim('Commits:')} ${spot.uniqueCommits} unique  ${palette.dim('|')}  ${palette.dim('Last changed:')} ${formatDate(spot.latestChange)}`);
    console.log(`    ${palette.dim('Preview:')} ${palette.dim(spot.preview)}`);
    if (i < hotspots.length - 1) console.log();
  }
  console.log();
}

// ─── AI Analysis ────────────────────────────────────────────────────────────

function buildBlameSummaryForAI(blameLines: BlameLine[], stats: AuthorStats[]): string {
  const parts: string[] = [];

  parts.push(`File has ${blameLines.length} lines with ${stats.length} unique authors.`);
  parts.push('');
  parts.push('Author breakdown:');
  for (const s of stats) {
    parts.push(`  - ${s.author}: ${s.lines} lines (${s.percentage}%), ${s.commits.size} commits, last active ${formatDate(s.latestDate)}`);
  }
  parts.push('');

  // Sample blame entries (every Nth line to stay within token limits)
  const sampleInterval = Math.max(1, Math.floor(blameLines.length / 50));
  parts.push('Sample blame data (line, author, date, commit, content):');
  for (let i = 0; i < blameLines.length; i += sampleInterval) {
    const l = blameLines[i];
    const date = new Date(l.authorTime * 1000).toISOString().split('T')[0];
    parts.push(`  L${l.lineNumber}: [${l.commitHash.substring(0, 7)}] ${l.author} (${date}) "${l.summary}" | ${l.content.trim().substring(0, 80)}`);
  }

  return parts.join('\n');
}

function buildLineContextForAI(blameLines: BlameLine[], targetLine: number): string {
  const line = blameLines.find(l => l.lineNumber === targetLine);
  if (!line) return `Line ${targetLine} not found.`;

  const idx = blameLines.findIndex(l => l.lineNumber === targetLine);
  const contextStart = Math.max(0, idx - 10);
  const contextEnd = Math.min(blameLines.length, idx + 11);
  const context = blameLines.slice(contextStart, contextEnd);

  const parts: string[] = [];
  parts.push(`Target line ${targetLine}:`);
  parts.push(`  Commit: ${line.commitHash}`);
  parts.push(`  Author: ${line.author} ${line.authorMail}`);
  parts.push(`  Date: ${new Date(line.authorTime * 1000).toISOString()}`);
  parts.push(`  Message: ${line.summary}`);
  parts.push(`  Content: ${line.content}`);
  parts.push('');
  parts.push('Surrounding context:');
  for (const cl of context) {
    const marker = cl.lineNumber === targetLine ? '>>>' : '   ';
    const date = new Date(cl.authorTime * 1000).toISOString().split('T')[0];
    parts.push(`${marker} L${cl.lineNumber}: [${cl.commitHash.substring(0, 7)}] (${cl.author}, ${date}) ${cl.content}`);
  }

  return parts.join('\n');
}

function buildHotspotsForAI(hotspots: Hotspot[], blameLines: BlameLine[]): string {
  const parts: string[] = [];
  parts.push(`Found ${hotspots.length} hotspots in a file with ${blameLines.length} lines.`);
  parts.push('');

  for (let i = 0; i < hotspots.length; i++) {
    const spot = hotspots[i];
    parts.push(`Hotspot #${i + 1}: Lines ${spot.startLine}-${spot.endLine}`);
    parts.push(`  Authors: ${spot.authors.join(', ')}`);
    parts.push(`  Unique commits: ${spot.uniqueCommits}`);
    parts.push(`  Last change: ${spot.latestChange.toISOString().split('T')[0]}`);
    parts.push(`  Preview: ${spot.preview}`);

    // Include the actual lines for this hotspot
    const hotspotLines = blameLines.filter(l => l.lineNumber >= spot.startLine && l.lineNumber <= spot.endLine);
    for (const hl of hotspotLines.slice(0, 15)) {
      const date = new Date(hl.authorTime * 1000).toISOString().split('T')[0];
      parts.push(`    L${hl.lineNumber}: [${hl.commitHash.substring(0, 7)}] ${hl.author} (${date}) ${hl.content.trim().substring(0, 60)}`);
    }
    if (hotspotLines.length > 15) {
      parts.push(`    ... and ${hotspotLines.length - 15} more lines`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

// ─── Command Entry Point ────────────────────────────────────────────────────

export async function blameCommand(filePath: string, options: BlameOptions = {}): Promise<void> {
  // Verify git repo
  if (!isGitRepo()) {
    console.log();
    console.log(`  ${palette.red('Not a git repository.')}`);
    console.log(`  ${palette.dim('Run this command inside a git project.')}`);
    console.log();
    process.exit(1);
  }

  // Validate file exists
  const file = readAndValidateFile(filePath);
  if (!file) return;

  const resolvedPath = path.resolve(filePath);
  const relativePath = path.relative(process.cwd(), resolvedPath);

  // Run git blame
  const spinner = startSpinner('Running git blame...');
  let blameRaw: string;

  try {
    blameRaw = runGitCommand(`blame --porcelain "${relativePath}"`);
  } catch (err: any) {
    stopSpinner(spinner, 'Failed to run git blame', false);
    console.log();
    console.log(`  ${palette.dim(err.message)}`);
    console.log(`  ${palette.dim('Make sure the file is tracked by git.')}`);
    console.log();
    return;
  }

  if (!blameRaw || !blameRaw.trim()) {
    stopSpinner(spinner, 'No blame data found', false);
    console.log();
    console.log(`  ${palette.dim('The file may be untracked or newly created.')}`);
    console.log();
    return;
  }

  // Parse blame
  const blameLines = parseBlameOutput(blameRaw);
  if (blameLines.length === 0) {
    stopSpinner(spinner, 'Could not parse blame data', false);
    return;
  }

  const stats = analyzeAuthors(blameLines);
  const authorColorMap = new Map<string, string>();

  // Pre-assign colors by ownership order
  for (const s of stats) {
    getAuthorColor(s.author, authorColorMap);
  }

  stopSpinner(spinner, `Parsed ${blameLines.length} lines, ${stats.length} authors`);

  // ─── Mode: Single Line ────────────────────────────────────────────────
  if (options.line !== undefined) {
    const meta: [string, string][] = [
      ['File', colors.file(relativePath)],
      ['Line', String(options.line)],
      ['Authors', String(stats.length)],
    ];
    console.log(commandHeader('Orion Blame Analysis', meta));

    displayLineBlame(blameLines, options.line, authorColorMap);

    // AI explanation
    const aiSpinner = startSpinner('AI analyzing line history...');
    const lineContext = buildLineContextForAI(blameLines, options.line);
    const projectContext = loadProjectContext();
    const systemPrompt = projectContext
      ? LINE_EXPLAIN_PROMPT + '\n\nProject context:\n' + projectContext
      : LINE_EXPLAIN_PROMPT;

    try {
      let fullResponse = '';
      await askAI(systemPrompt, `Explain why this line was changed:\n\n${lineContext}`, {
        onToken(token: string) {
          aiSpinner.stop();
          fullResponse += token;
        },
        onComplete(text: string) {
          console.log();
          console.log(renderMarkdown(text));
          console.log();
        },
        onError(error: Error) {
          aiSpinner.fail(palette.red(error.message));
        },
      });
    } catch (err: any) {
      printCommandError(err, 'blame', 'Run `orion config` to check your AI provider settings.');
    }

    return;
  }

  // ─── Mode: Hotspots ───────────────────────────────────────────────────
  if (options.hotspots) {
    const meta: [string, string][] = [
      ['File', colors.file(relativePath)],
      ['Lines', String(blameLines.length)],
      ['Authors', String(stats.length)],
    ];
    console.log(commandHeader('Orion Blame Hotspots', meta));

    const hotspots = detectHotspots(blameLines);
    displayHotspots(hotspots, authorColorMap);

    if (hotspots.length > 0) {
      console.log(divider());
      console.log();

      const aiSpinner = startSpinner('AI analyzing hotspots...');
      const hotspotData = buildHotspotsForAI(hotspots, blameLines);
      const projectContext = loadProjectContext();
      const systemPrompt = projectContext
        ? HOTSPOT_PROMPT + '\n\nProject context:\n' + projectContext
        : HOTSPOT_PROMPT;

      try {
        let fullResponse = '';
        await askAI(systemPrompt, `Analyze these code hotspots:\n\n${hotspotData}`, {
          onToken(token: string) {
            aiSpinner.stop();
            fullResponse += token;
          },
          onComplete(text: string) {
            console.log();
            console.log(renderMarkdown(text));
            console.log();
          },
          onError(error: Error) {
            aiSpinner.fail(palette.red(error.message));
          },
        });
      } catch (err: any) {
        printCommandError(err, 'blame', 'Run `orion config` to check your AI provider settings.');
      }
    }

    return;
  }

  // ─── Mode: Full Summary (default) ─────────────────────────────────────
  const meta: [string, string][] = [
    ['File', colors.file(relativePath)],
    ['Lines', String(blameLines.length)],
    ['Authors', String(stats.length)],
    ['Commits', String(new Set(blameLines.map(l => l.commitHash)).size)],
  ];
  console.log(commandHeader('Orion Blame Analysis', meta));

  displayAuthorTable(stats, authorColorMap);
  console.log(divider());
  console.log();

  // AI analysis
  const aiSpinner = startSpinner('AI analyzing ownership and history...');
  const summaryData = buildBlameSummaryForAI(blameLines, stats);
  const projectContext = loadProjectContext();
  const systemPrompt = projectContext
    ? BLAME_SUMMARY_PROMPT + '\n\nProject context:\n' + projectContext
    : BLAME_SUMMARY_PROMPT;

  try {
    let fullResponse = '';
    await askAI(systemPrompt, `Analyze the blame data for ${relativePath}:\n\n${summaryData}`, {
      onToken(token: string) {
        aiSpinner.stop();
        fullResponse += token;
      },
      onComplete(text: string) {
        console.log();
        console.log(renderMarkdown(text));
        console.log();
      },
      onError(error: Error) {
        aiSpinner.fail(palette.red(error.message));
      },
    });
  } catch (err: any) {
    printCommandError(err, 'blame', 'Run `orion config` to check your AI provider settings.');
  }
}
