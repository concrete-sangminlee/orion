/**
 * Orion CLI - AI-Powered Performance Optimization Suggestions
 * Analyzes code for optimization opportunities across multiple dimensions:
 * general performance, bundle size, SQL queries, and React rendering.
 *
 * Usage:
 *   orion optimize src/app.ts              # General optimization
 *   orion optimize src/ --bundle           # Bundle size optimization
 *   orion optimize src/app.ts --sql        # SQL query optimization
 *   orion optimize src/app.ts --react      # React-specific optimization
 */

import * as fs from 'fs';
import * as path from 'path';
import { askAI } from '../ai-client.js';
import {
  colors,
  startSpinner,
  stopSpinner,
  detectLanguage,
  loadProjectContext,
} from '../utils.js';
import { readAndValidateFile, printCommandError } from '../shared.js';
import { renderMarkdown } from '../markdown.js';
import { commandHeader, badge, divider, palette, table as uiTable, statusLine } from '../ui.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OptimizeOptions {
  bundle?: boolean;
  sql?: boolean;
  react?: boolean;
}

interface FileEntry {
  relativePath: string;
  content: string;
  language: string;
  lineCount: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SCANNABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.rb', '.php', '.swift', '.kt', '.scala',
  '.sql', '.vue', '.svelte',
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.cache', 'coverage', '.nyc_output', '.turbo',
  '.svelte-kit', '.output', 'target', 'vendor', '.venv', 'venv',
  'env', '.tox', '.eggs', '.orion',
]);

const MAX_FILE_SIZE = 256 * 1024; // 256 KB
const MAX_FILES = 30;
const MAX_TOTAL_CHARS = 60000;

// ─── Impact Rating Colors ───────────────────────────────────────────────────

const IMPACT_COLORS: Record<string, string> = {
  HIGH: '#EF4444',
  MEDIUM: '#F59E0B',
  LOW: '#22C55E',
};

// ─── System Prompts ─────────────────────────────────────────────────────────

const GENERAL_OPTIMIZE_PROMPT = `You are Orion, an expert performance engineer. Analyze the provided code and suggest optimizations.

Structure your response EXACTLY as follows:

## Performance Analysis

| Category | Status | Priority |
|----------|--------|----------|
| Algorithm Efficiency | <Optimal/Needs Work/Critical> | <HIGH/MEDIUM/LOW> |
| Memory Usage | <status> | <priority> |
| I/O Operations | <status> | <priority> |
| Caching Opportunities | <status> | <priority> |
| Async/Concurrency | <status> | <priority> |

## Optimization Suggestions

For EACH suggestion, use this EXACT format:

### [HIGH] <title>
- **Location:** <file:line or function name>
- **Issue:** <what's slow and why>
- **Before:**
\`\`\`
<current code>
\`\`\`
- **After:**
\`\`\`
<optimized code>
\`\`\`
- **Expected Impact:** <quantified improvement estimate>

### [MEDIUM] <title>
...

### [LOW] <title>
...

## Quick Wins
Bulleted list of easy optimizations that can be done in < 5 minutes.

Order all suggestions by impact (HIGH first, then MEDIUM, then LOW).
Be specific: reference exact line numbers, function names, and variable names.
Only suggest changes that would make a measurable difference.`;

const BUNDLE_OPTIMIZE_PROMPT = `You are Orion, an expert in JavaScript/TypeScript bundle optimization. Analyze the code for bundle size issues.

Focus on:
1. **Heavy imports**: Look for large libraries imported but only partially used (lodash, moment, etc.)
2. **Tree-shaking blockers**: Barrel exports, CommonJS requires, side effects
3. **Dynamic imports**: Opportunities to code-split with lazy loading
4. **Duplicate code**: Code that could be shared or deduplicated
5. **Dead code**: Exported functions/classes that appear unused
6. **Asset optimization**: Large inline strings, base64 data, embedded JSON

Structure your response:

## Bundle Analysis

| Issue | Files Affected | Estimated Size Impact |
|-------|---------------|----------------------|
| ... | ... | ... |

## Import Optimization

For each heavy/problematic import:

### [HIGH] <import issue title>
- **File:** <path>
- **Current:**
\`\`\`
<current import>
\`\`\`
- **Suggested:**
\`\`\`
<optimized import>
\`\`\`
- **Size Savings:** <estimated KB saved>

## Code Splitting Opportunities
List components/routes that should be lazy-loaded with code examples.

## Tree-Shaking Fixes
Specific changes to enable better tree-shaking.

## Quick Wins
Bullet list of easy size reductions.

Order by size impact (largest savings first).`;

const SQL_OPTIMIZE_PROMPT = `You are Orion, an expert database performance engineer. Find SQL queries in the code and suggest optimizations.

Focus on:
1. **N+1 queries**: Queries inside loops that should be batched
2. **Missing indexes**: Queries that would benefit from database indexes
3. **SELECT ***: Queries selecting all columns when only a few are needed
4. **Unbounded queries**: Missing LIMIT clauses on potentially large result sets
5. **String concatenation in queries**: SQL injection risks and performance
6. **Missing JOINs**: Multiple queries that could be combined
7. **Inefficient WHERE clauses**: Non-sargable predicates, function calls on columns
8. **Missing transactions**: Related writes not wrapped in transactions

Structure your response:

## SQL Performance Audit

| Issue | Severity | Location |
|-------|----------|----------|
| ... | HIGH/MEDIUM/LOW | file:line |

## Query Optimizations

For each issue:

### [HIGH] <title>
- **Location:** <file:line>
- **Current query:**
\`\`\`sql
<current query>
\`\`\`
- **Optimized query:**
\`\`\`sql
<optimized query>
\`\`\`
- **Why:** <explanation of the performance gain>
- **Suggested index:**
\`\`\`sql
CREATE INDEX ... ON ...;
\`\`\`

## N+1 Query Detection
List all N+1 patterns found with batched alternatives.

## Index Recommendations
\`\`\`sql
-- Recommended indexes based on query patterns
CREATE INDEX ...;
\`\`\`

## Quick Wins
Easy query optimizations that can be done immediately.`;

const REACT_OPTIMIZE_PROMPT = `You are Orion, an expert React performance engineer. Analyze React components for rendering performance issues.

Focus on:
1. **Unnecessary re-renders**: Components re-rendering when props haven't changed
2. **Missing memoization**: Components/values/callbacks that should use React.memo, useMemo, useCallback
3. **State management**: State that should be lifted, colocated, or externalized
4. **Heavy computations in render**: Expensive operations on every render cycle
5. **Key prop issues**: Missing or unstable keys in lists
6. **Context overuse**: Context providers causing cascading re-renders
7. **Effect dependencies**: useEffect with missing or excessive dependencies
8. **Bundle issues**: Components that should be lazy-loaded

Structure your response:

## React Performance Audit

| Component | Issue | Impact | Fix Complexity |
|-----------|-------|--------|---------------|
| ... | ... | HIGH/MEDIUM/LOW | Easy/Moderate/Hard |

## Re-render Optimizations

For each issue:

### [HIGH] <component/issue title>
- **Component:** <ComponentName> at <file:line>
- **Issue:** <what causes unnecessary re-renders>
- **Before:**
\`\`\`tsx
<current code>
\`\`\`
- **After:**
\`\`\`tsx
<optimized code with memo/useMemo/useCallback>
\`\`\`
- **Impact:** <expected rendering improvement>

## State Architecture
Suggestions for state management improvements.

## Lazy Loading Opportunities
Components that should be code-split.

## Quick Wins
Easy React performance improvements.

Order by impact. Be specific with component names and line numbers.`;

// ─── File Scanning ──────────────────────────────────────────────────────────

function scanDirectory(dirPath: string): FileEntry[] {
  const files: FileEntry[] = [];
  let totalChars = 0;

  function walk(dir: string, depth: number): void {
    if (depth > 5 || files.length >= MAX_FILES || totalChars >= MAX_TOTAL_CHARS) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES || totalChars >= MAX_TOTAL_CHARS) break;
      if (IGNORE_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SCANNABLE_EXTENSIONS.has(ext)) continue;

        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > MAX_FILE_SIZE) continue;

          const content = fs.readFileSync(fullPath, 'utf-8');
          if (totalChars + content.length > MAX_TOTAL_CHARS) continue;

          totalChars += content.length;
          files.push({
            relativePath: path.relative(process.cwd(), fullPath),
            content,
            language: detectLanguage(fullPath),
            lineCount: content.split('\n').length,
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walk(dirPath, 0);
  return files;
}

// ─── Pre-analysis Heuristics ────────────────────────────────────────────────

interface HeuristicFinding {
  type: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  file: string;
  line: number;
  snippet: string;
}

function runHeuristics(files: FileEntry[], mode: 'general' | 'bundle' | 'sql' | 'react'): HeuristicFinding[] {
  const findings: HeuristicFinding[] = [];

  for (const file of files) {
    const lines = file.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      if (mode === 'general' || mode === 'bundle') {
        // Heavy imports
        if (/import\s+.*\s+from\s+['"]lodash['"]/.test(line)) {
          findings.push({ type: 'Heavy import: lodash (use lodash-es or cherry-pick)', impact: 'HIGH', file: file.relativePath, line: lineNum, snippet: line.trim() });
        }
        if (/import\s+.*\s+from\s+['"]moment['"]/.test(line)) {
          findings.push({ type: 'Heavy import: moment.js (consider date-fns or dayjs)', impact: 'HIGH', file: file.relativePath, line: lineNum, snippet: line.trim() });
        }
        if (/require\s*\(/.test(line) && /\.(ts|tsx|mjs)$/.test(file.relativePath)) {
          findings.push({ type: 'CommonJS require in ES module (blocks tree-shaking)', impact: 'MEDIUM', file: file.relativePath, line: lineNum, snippet: line.trim() });
        }
      }

      if (mode === 'general' || mode === 'sql') {
        // SQL patterns
        if (/SELECT\s+\*/i.test(line)) {
          findings.push({ type: 'SELECT * (select only needed columns)', impact: 'MEDIUM', file: file.relativePath, line: lineNum, snippet: line.trim() });
        }
        if (/query\s*\(.*\+\s*|query\s*\(`.*\$\{/i.test(line)) {
          findings.push({ type: 'SQL string concatenation (use parameterized queries)', impact: 'HIGH', file: file.relativePath, line: lineNum, snippet: line.trim() });
        }
      }

      if (mode === 'general' || mode === 'react') {
        // React patterns
        if (/new\s+Array\(|\.map\(.*\.map\(/i.test(line)) {
          findings.push({ type: 'Nested iteration (consider flattening or memoization)', impact: 'MEDIUM', file: file.relativePath, line: lineNum, snippet: line.trim() });
        }
        if (/JSON\.parse\(JSON\.stringify/.test(line)) {
          findings.push({ type: 'JSON deep clone (use structuredClone or spread)', impact: 'LOW', file: file.relativePath, line: lineNum, snippet: line.trim() });
        }
        if (/useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*\},\s*\[\s*\]\s*\)/.test(line)) {
          // empty deps - fine, but noting for analysis
        }
        if (/style\s*=\s*\{\s*\{/.test(line)) {
          findings.push({ type: 'Inline style object (creates new object every render)', impact: 'LOW', file: file.relativePath, line: lineNum, snippet: line.trim() });
        }
      }

      // General patterns
      if (mode === 'general') {
        if (/\.forEach\(/.test(line) && /await\s/.test(line)) {
          findings.push({ type: 'await in forEach (use for...of or Promise.all)', impact: 'HIGH', file: file.relativePath, line: lineNum, snippet: line.trim() });
        }
        if (/new RegExp\(/.test(line) && !/const\s|let\s|var\s/.test(line)) {
          findings.push({ type: 'RegExp created in hot path (compile once, reuse)', impact: 'MEDIUM', file: file.relativePath, line: lineNum, snippet: line.trim() });
        }
      }
    }
  }

  return findings.slice(0, 30); // Limit findings
}

// ─── Display Functions ──────────────────────────────────────────────────────

function displayHeuristicFindings(findings: HeuristicFinding[]): void {
  if (findings.length === 0) return;

  console.log();
  console.log(`  ${palette.violet.bold('Pre-scan Findings')} ${palette.dim('(static analysis)')}`);
  console.log();

  const headers = ['Impact', 'Issue', 'Location'];
  const rows: string[][] = [];

  for (const f of findings) {
    const impactColor = IMPACT_COLORS[f.impact] || '#22C55E';
    rows.push([
      f.impact,
      f.type,
      `${f.file}:${f.line}`,
    ]);
  }

  console.log(uiTable(headers, rows));
}

function displayModeInfo(mode: string, fileCount: number, totalLines: number): void {
  const modeDescriptions: Record<string, string> = {
    general: 'General performance optimization',
    bundle: 'Bundle size optimization',
    sql: 'SQL query optimization',
    react: 'React rendering optimization',
  };

  const modeColors: Record<string, string> = {
    general: '#7C5CFC',
    bundle: '#38BDF8',
    sql: '#F59E0B',
    react: '#22C55E',
  };

  console.log(`  ${badge(mode.toUpperCase(), modeColors[mode] || '#7C5CFC')} ${palette.dim(modeDescriptions[mode] || mode)}`);
  console.log(`  ${palette.dim('Files:')} ${fileCount}  ${palette.dim('|')}  ${palette.dim('Lines:')} ${totalLines.toLocaleString()}`);
  console.log();
}

// ─── Build AI Prompt Content ────────────────────────────────────────────────

function buildCodeContext(files: FileEntry[], maxChars: number): string {
  const parts: string[] = [];
  let totalChars = 0;

  for (const file of files) {
    const header = `\n--- ${file.relativePath} (${file.language}, ${file.lineCount} lines) ---\n`;
    const content = file.content;

    if (totalChars + header.length + content.length > maxChars) {
      // Truncate this file
      const remaining = maxChars - totalChars - header.length - 50;
      if (remaining > 200) {
        parts.push(header);
        parts.push(content.substring(0, remaining));
        parts.push('\n... (truncated)');
        totalChars = maxChars;
      }
      break;
    }

    parts.push(header);
    parts.push(content);
    totalChars += header.length + content.length;
  }

  return parts.join('');
}

function buildHeuristicsContext(findings: HeuristicFinding[]): string {
  if (findings.length === 0) return '';

  const lines = ['\n\nPre-scan heuristic findings:'];
  for (const f of findings) {
    lines.push(`  [${f.impact}] ${f.type} at ${f.file}:${f.line} - ${f.snippet}`);
  }
  return lines.join('\n');
}

// ─── Command Entry Point ────────────────────────────────────────────────────

export async function optimizeCommand(target: string, options: OptimizeOptions = {}): Promise<void> {
  const resolvedPath = path.resolve(target);

  // Determine mode
  const mode = options.bundle ? 'bundle'
    : options.sql ? 'sql'
    : options.react ? 'react'
    : 'general';

  const systemPrompt = options.bundle ? BUNDLE_OPTIMIZE_PROMPT
    : options.sql ? SQL_OPTIMIZE_PROMPT
    : options.react ? REACT_OPTIMIZE_PROMPT
    : GENERAL_OPTIMIZE_PROMPT;

  // Gather files
  const spinner = startSpinner('Scanning files...');
  let files: FileEntry[] = [];

  try {
    const stat = fs.statSync(resolvedPath);

    if (stat.isDirectory()) {
      files = scanDirectory(resolvedPath);
    } else if (stat.isFile()) {
      const validated = readAndValidateFile(target);
      if (!validated) {
        stopSpinner(spinner, 'File validation failed', false);
        return;
      }
      files = [{
        relativePath: path.relative(process.cwd(), validated.resolvedPath),
        content: validated.content,
        language: validated.language,
        lineCount: validated.lineCount,
      }];
    }
  } catch (err: any) {
    stopSpinner(spinner, 'Failed to read target', false);
    console.log();
    console.log(`  ${palette.red('Cannot access:')} ${resolvedPath}`);
    console.log(`  ${palette.dim(err.message)}`);
    console.log();
    return;
  }

  if (files.length === 0) {
    stopSpinner(spinner, 'No analyzable files found', false);
    console.log();
    console.log(`  ${palette.dim('No source files found in the target path.')}`);
    console.log(`  ${palette.dim('Supported extensions: ' + Array.from(SCANNABLE_EXTENSIONS).join(', '))}`);
    console.log();
    return;
  }

  const totalLines = files.reduce((sum, f) => sum + f.lineCount, 0);
  stopSpinner(spinner, `Found ${files.length} file(s), ${totalLines.toLocaleString()} lines`);

  // Display header
  const meta: [string, string][] = [
    ['Target', colors.file(path.relative(process.cwd(), resolvedPath) || '.')],
    ['Mode', mode.charAt(0).toUpperCase() + mode.slice(1)],
    ['Files', String(files.length)],
    ['Lines', totalLines.toLocaleString()],
  ];
  console.log(commandHeader('Orion Optimize', meta));

  displayModeInfo(mode, files.length, totalLines);

  // Run heuristic pre-scan
  const findings = runHeuristics(files, mode);
  displayHeuristicFindings(findings);

  if (findings.length > 0) {
    console.log(divider());
    console.log();
  }

  // Build code context for AI
  const codeContext = buildCodeContext(files, 40000);
  const heuristicsContext = buildHeuristicsContext(findings);

  // Send to AI
  const aiSpinner = startSpinner('AI analyzing for optimizations...');

  const projectContext = loadProjectContext();
  const fullSystemPrompt = projectContext
    ? systemPrompt + '\n\nProject context:\n' + projectContext
    : systemPrompt;

  const userMessage = `Analyze this code for ${mode} optimizations:\n${codeContext}${heuristicsContext}`;

  try {
    let fullResponse = '';

    await askAI(fullSystemPrompt, userMessage, {
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
    printCommandError(err, 'optimize', 'Run `orion config` to check your AI provider settings.');
  }
}
