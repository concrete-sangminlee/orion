/**
 * Orion CLI - Project Statistics Command
 * Comprehensive project statistics: LOC by language, file counts, complexity analysis.
 *
 * Usage:
 *   orion stats                    # Full project statistics dashboard
 *   orion stats --loc              # Lines of code by language
 *   orion stats --complexity       # AI-powered code complexity analysis
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
import { createStreamHandler, printCommandError } from '../shared.js';
import {
  commandHeader,
  divider,
  table as uiTable,
  palette,
  badge,
  keyValue,
  progressBar,
  box,
} from '../ui.js';
import { renderMarkdown } from '../markdown.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '__pycache__', '.cache', '.output', '.vercel',
  '.turbo', 'vendor', 'target', 'out', '.svelte-kit',
  '.orion', '.vscode', '.idea', 'bower_components',
]);

const IGNORE_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'composer.lock', 'Cargo.lock', 'Gemfile.lock',
]);

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (JSX)',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (JSX)',
  '.mjs': 'JavaScript (ESM)',
  '.cjs': 'JavaScript (CJS)',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.c': 'C',
  '.cpp': 'C++',
  '.h': 'C/C++ Header',
  '.hpp': 'C++ Header',
  '.cs': 'C#',
  '.php': 'PHP',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'Sass',
  '.less': 'Less',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.xml': 'XML',
  '.md': 'Markdown',
  '.mdx': 'MDX',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Bash',
  '.zsh': 'Zsh',
  '.ps1': 'PowerShell',
  '.r': 'R',
  '.lua': 'Lua',
  '.dart': 'Dart',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.erl': 'Erlang',
  '.hs': 'Haskell',
  '.ml': 'OCaml',
  '.clj': 'Clojure',
  '.scala': 'Scala',
  '.tf': 'Terraform',
  '.proto': 'Protocol Buffers',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
  '.dockerfile': 'Dockerfile',
};

// ─── System Prompts ──────────────────────────────────────────────────────────

const COMPLEXITY_PROMPT = `You are Orion, an expert software architect specializing in code quality and complexity analysis.
Given project statistics and sample file contents, analyze the codebase complexity.

You MUST structure your response with these exact sections:

## Complexity Overview

| Metric | Rating | Details |
|--------|--------|---------|
| Overall Complexity | <Low/Medium/High/Very High> | <brief explanation> |
| Maintainability | <1-10>/10 | <brief explanation> |
| Technical Debt | <Low/Medium/High> | <brief explanation> |
| Architecture Quality | <1-10>/10 | <brief explanation> |

## Complexity Hotspots

Identify the most complex areas (top 5):
### <number>. <file or module name>
- **Complexity Score**: <1-10>
- **Issues**: <what makes it complex>
- **Recommendation**: <how to simplify>

## Architecture Analysis

- **Project Type**: <web app, API, library, CLI, monorepo, etc.>
- **Main Languages**: <primary languages and their roles>
- **Design Patterns**: <patterns observed in the codebase>
- **Separation of Concerns**: <Good/Fair/Poor> - <explanation>

## Recommendations

Priority-ordered list of improvements:
1. <highest priority recommendation>
2. <recommendation>
3. <recommendation>

## Health Score: <1-10>/10

<One-sentence overall assessment>

Be specific and reference actual file names and patterns from the project data.`;

// ─── Types ──────────────────────────────────────────────────────────────────

interface FileInfo {
  path: string;
  ext: string;
  language: string;
  lines: number;
  size: number;
  blankLines: number;
  commentLines: number;
}

interface LanguageStats {
  language: string;
  files: number;
  lines: number;
  blankLines: number;
  commentLines: number;
  codeLines: number;
  size: number;
}

interface ProjectStats {
  rootDir: string;
  totalFiles: number;
  totalLines: number;
  totalCodeLines: number;
  totalBlankLines: number;
  totalCommentLines: number;
  totalSize: number;
  languages: LanguageStats[];
  largestFiles: FileInfo[];
  avgFileSize: number;
  avgFileLines: number;
}

// ─── File Scanning ───────────────────────────────────────────────────────────

function isCommentLine(line: string, ext: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // C-style comments
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.java', '.go', '.rs',
       '.c', '.cpp', '.h', '.hpp', '.cs', '.kt', '.swift', '.scala', '.dart',
       '.php', '.vue', '.svelte', '.css', '.scss', '.less'].includes(ext)) {
    return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
  }

  // Hash comments
  if (['.py', '.rb', '.sh', '.bash', '.zsh', '.yaml', '.yml', '.toml', '.r',
       '.ex', '.exs', '.erl', '.clj', '.tf', '.ps1'].includes(ext)) {
    return trimmed.startsWith('#');
  }

  // HTML comments
  if (['.html', '.xml', '.md', '.mdx', '.svg'].includes(ext)) {
    return trimmed.startsWith('<!--');
  }

  // Lua comments
  if (ext === '.lua') {
    return trimmed.startsWith('--');
  }

  // Haskell comments
  if (ext === '.hs' || ext === '.ml') {
    return trimmed.startsWith('--') || trimmed.startsWith('{-');
  }

  return false;
}

function scanFile(filePath: string): FileInfo | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;

    // Skip binary-like files (> 1MB)
    if (stat.size > 1024 * 1024) return null;

    const ext = path.extname(filePath).toLowerCase();
    const language = LANGUAGE_MAP[ext];
    if (!language) return null;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let blankLines = 0;
    let commentLines = 0;

    for (const line of lines) {
      if (!line.trim()) {
        blankLines++;
      } else if (isCommentLine(line, ext)) {
        commentLines++;
      }
    }

    return {
      path: filePath,
      ext,
      language,
      lines: lines.length,
      size: stat.size,
      blankLines,
      commentLines,
    };
  } catch {
    return null;
  }
}

function scanDirectory(dir: string): FileInfo[] {
  const files: FileInfo[] = [];

  function walk(currentDir: string, depth: number): void {
    if (depth > 15) return; // Max depth guard

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(fullPath, depth + 1);
        }
      } else if (entry.isFile()) {
        if (IGNORE_FILES.has(entry.name)) continue;
        const info = scanFile(fullPath);
        if (info) files.push(info);
      }
    }
  }

  walk(dir, 0);
  return files;
}

// ─── Statistics Computation ──────────────────────────────────────────────────

function computeStats(rootDir: string, files: FileInfo[]): ProjectStats {
  // Aggregate by language
  const langMap = new Map<string, LanguageStats>();

  for (const file of files) {
    let stats = langMap.get(file.language);
    if (!stats) {
      stats = {
        language: file.language,
        files: 0,
        lines: 0,
        blankLines: 0,
        commentLines: 0,
        codeLines: 0,
        size: 0,
      };
      langMap.set(file.language, stats);
    }

    stats.files++;
    stats.lines += file.lines;
    stats.blankLines += file.blankLines;
    stats.commentLines += file.commentLines;
    stats.codeLines += file.lines - file.blankLines - file.commentLines;
    stats.size += file.size;
  }

  // Sort by lines of code (descending)
  const languages = Array.from(langMap.values())
    .sort((a, b) => b.codeLines - a.codeLines);

  // Totals
  const totalFiles = files.length;
  const totalLines = files.reduce((s, f) => s + f.lines, 0);
  const totalBlankLines = files.reduce((s, f) => s + f.blankLines, 0);
  const totalCommentLines = files.reduce((s, f) => s + f.commentLines, 0);
  const totalCodeLines = totalLines - totalBlankLines - totalCommentLines;
  const totalSize = files.reduce((s, f) => s + f.size, 0);

  // Largest files
  const largestFiles = [...files]
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 10);

  return {
    rootDir,
    totalFiles,
    totalLines,
    totalCodeLines,
    totalBlankLines,
    totalCommentLines,
    totalSize,
    languages,
    largestFiles,
    avgFileSize: totalFiles > 0 ? totalSize / totalFiles : 0,
    avgFileLines: totalFiles > 0 ? totalLines / totalFiles : 0,
  };
}

// ─── Display Functions ───────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function showFullDashboard(stats: ProjectStats): void {
  console.log(commandHeader('Orion Project Statistics', [
    ['Root', colors.file(stats.rootDir)],
    ['Files', formatNumber(stats.totalFiles)],
    ['Total Size', formatSize(stats.totalSize)],
  ]));

  // ─── Overview Badges ─────────────────────────────────────────────────
  const overviewLine = [
    badge(`${formatNumber(stats.totalCodeLines)} code`, '#7C5CFC'),
    badge(`${formatNumber(stats.totalCommentLines)} comments`, '#38BDF8'),
    badge(`${formatNumber(stats.totalBlankLines)} blank`, '#6B7280'),
    badge(`${formatNumber(stats.totalFiles)} files`, '#22C55E'),
  ].join('  ');
  console.log(`  ${overviewLine}`);
  console.log();

  // ─── Summary ──────────────────────────────────────────────────────────
  console.log(divider('Summary'));
  console.log();
  console.log(keyValue([
    ['Total lines', formatNumber(stats.totalLines)],
    ['Code lines', formatNumber(stats.totalCodeLines)],
    ['Comment lines', formatNumber(stats.totalCommentLines)],
    ['Blank lines', formatNumber(stats.totalBlankLines)],
    ['Comment ratio', stats.totalCodeLines > 0
      ? `${((stats.totalCommentLines / stats.totalCodeLines) * 100).toFixed(1)}%`
      : '0%'],
    ['Average file', `${Math.round(stats.avgFileLines)} lines / ${formatSize(stats.avgFileSize)}`],
    ['Languages', `${stats.languages.length}`],
  ]));
  console.log();

  // ─── Lines of Code by Language ─────────────────────────────────────────
  showLocByLanguage(stats);

  // ─── Largest Files ─────────────────────────────────────────────────────
  console.log(divider('Largest Files'));
  console.log();

  if (stats.largestFiles.length > 0) {
    const fileHeaders = ['File', 'Language', 'Lines', 'Size'];
    const fileRows = stats.largestFiles.map(f => [
      path.relative(stats.rootDir, f.path),
      f.language,
      formatNumber(f.lines),
      formatSize(f.size),
    ]);
    console.log(uiTable(fileHeaders, fileRows));
  } else {
    console.log(`  ${palette.dim('No files found.')}`);
  }
  console.log();
}

function showLocByLanguage(stats: ProjectStats): void {
  console.log(divider('Lines of Code by Language'));
  console.log();

  if (stats.languages.length === 0) {
    console.log(`  ${palette.dim('No source files found.')}`);
    console.log();
    return;
  }

  const maxLines = stats.languages[0]?.codeLines || 1;

  const headers = ['Language', 'Files', 'Code', 'Comments', 'Blank', 'Total', 'Distribution'];
  const rows = stats.languages.map(lang => {
    const pct = stats.totalCodeLines > 0
      ? ((lang.codeLines / stats.totalCodeLines) * 100).toFixed(1) + '%'
      : '0%';

    const barWidth = 15;
    const filled = Math.max(1, Math.round((lang.codeLines / maxLines) * barWidth));
    const bar = palette.violet('\u2588'.repeat(filled)) + palette.dim('\u2591'.repeat(barWidth - filled));

    return [
      lang.language,
      String(lang.files),
      formatNumber(lang.codeLines),
      formatNumber(lang.commentLines),
      formatNumber(lang.blankLines),
      formatNumber(lang.lines),
      `${bar} ${pct}`,
    ];
  });

  console.log(uiTable(headers, rows));
  console.log();
}

// ─── Complexity Analysis ─────────────────────────────────────────────────────

async function analyzeComplexity(stats: ProjectStats, files: FileInfo[]): Promise<void> {
  showFullDashboard(stats);

  console.log(divider('AI Complexity Analysis'));
  console.log();

  const spinner = startSpinner('AI is analyzing code complexity...');

  // Prepare summary for AI
  const languageSummary = stats.languages
    .map(l => `  ${l.language}: ${l.codeLines} lines across ${l.files} files`)
    .join('\n');

  const largestFilesSummary = stats.largestFiles
    .map(f => `  ${path.relative(stats.rootDir, f.path)} (${f.language}, ${f.lines} lines)`)
    .join('\n');

  // Read samples of the largest files for context
  const sampleFiles: string[] = [];
  for (const file of stats.largestFiles.slice(0, 5)) {
    try {
      const content = fs.readFileSync(file.path, 'utf-8');
      const truncated = content.length > 3000 ? content.substring(0, 3000) + '\n...(truncated)' : content;
      sampleFiles.push(`### ${path.relative(stats.rootDir, file.path)} (${file.language}, ${file.lines} lines)\n\`\`\`\n${truncated}\n\`\`\``);
    } catch {
      // Skip unreadable files
    }
  }

  const context = getCurrentDirectoryContext();
  const projectContext = loadProjectContext();
  const fullSystemPrompt = projectContext
    ? COMPLEXITY_PROMPT + '\n\nWorkspace context:\n' + context + '\n\nProject context:\n' + projectContext
    : COMPLEXITY_PROMPT + '\n\nWorkspace context:\n' + context;

  const userMessage =
    `Analyze this project's complexity:\n\n` +
    `## Project Stats\n` +
    `- Total files: ${stats.totalFiles}\n` +
    `- Total code lines: ${stats.totalCodeLines}\n` +
    `- Total comment lines: ${stats.totalCommentLines}\n` +
    `- Languages: ${stats.languages.length}\n` +
    `- Average file size: ${Math.round(stats.avgFileLines)} lines\n\n` +
    `## Languages\n${languageSummary}\n\n` +
    `## Largest Files\n${largestFilesSummary}\n\n` +
    `## Sample Code\n${sampleFiles.join('\n\n')}`;

  try {
    const { callbacks, getResponse } = createStreamHandler(spinner, {
      markdown: true,
    });

    await askAI(fullSystemPrompt, userMessage, callbacks);

    jsonOutput('stats-complexity', {
      stats: {
        totalFiles: stats.totalFiles,
        totalCodeLines: stats.totalCodeLines,
        totalCommentLines: stats.totalCommentLines,
        languages: stats.languages.length,
      },
      analysis: getResponse(),
    });
  } catch (err: any) {
    printCommandError(err, 'stats', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}

// ─── Command Entry Point ────────────────────────────────────────────────────

export interface StatsCommandOptions {
  loc?: boolean;
  complexity?: boolean;
}

export async function statsCommand(
  options: StatsCommandOptions = {}
): Promise<void> {
  const rootDir = process.cwd();

  const spinner = startSpinner('Scanning project files...');
  const files = scanDirectory(rootDir);

  if (files.length === 0) {
    spinner.fail(palette.red('No source files found'));
    console.log();
    printError('No recognized source files found in the current directory.');
    printInfo('Make sure you are in a project directory with source code.');
    console.log();
    process.exit(1);
    return;
  }

  const stats = computeStats(rootDir, files);
  spinner.succeed(palette.green(`Scanned ${formatNumber(stats.totalFiles)} files (${formatNumber(stats.totalCodeLines)} lines of code)`));
  console.log();

  // Route to the appropriate mode
  if (options.complexity) {
    await analyzeComplexity(stats, files);
  } else if (options.loc) {
    console.log(commandHeader('Orion LOC Report', [
      ['Root', colors.file(rootDir)],
      ['Files', formatNumber(stats.totalFiles)],
    ]));
    showLocByLanguage(stats);

    jsonOutput('stats-loc', {
      rootDir,
      totalFiles: stats.totalFiles,
      totalCodeLines: stats.totalCodeLines,
      languages: stats.languages.map(l => ({
        language: l.language,
        files: l.files,
        codeLines: l.codeLines,
        commentLines: l.commentLines,
        blankLines: l.blankLines,
      })),
    });
  } else {
    showFullDashboard(stats);

    jsonOutput('stats-full', {
      rootDir,
      totalFiles: stats.totalFiles,
      totalLines: stats.totalLines,
      totalCodeLines: stats.totalCodeLines,
      totalCommentLines: stats.totalCommentLines,
      totalBlankLines: stats.totalBlankLines,
      totalSize: stats.totalSize,
      avgFileLines: Math.round(stats.avgFileLines),
      avgFileSize: stats.avgFileSize,
      languages: stats.languages.map(l => ({
        language: l.language,
        files: l.files,
        codeLines: l.codeLines,
        commentLines: l.commentLines,
        blankLines: l.blankLines,
      })),
      largestFiles: stats.largestFiles.map(f => ({
        path: path.relative(rootDir, f.path),
        language: f.language,
        lines: f.lines,
        size: f.size,
      })),
    });
  }
}
