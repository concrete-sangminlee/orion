/**
 * Orion CLI - AI-Powered Type Analysis Command
 * Analyzes type usage and suggests improvements:
 * missing types, any->proper types, interface improvements, generic usage, JS->TS conversion
 *
 * Usage:
 *   orion typecheck src/app.ts             # Analyze types and suggest improvements
 *   orion typecheck src/ --strict          # Strict mode analysis
 *   orion typecheck src/app.js --convert   # Suggest TypeScript conversion
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
import {
  readAndValidateFile,
  printCommandError,
} from '../shared.js';
import { commandHeader, statusLine, badge, divider, palette, table as uiTable } from '../ui.js';
import { renderMarkdown } from '../markdown.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const TYPEABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.go', '.rs', '.java', '.cs', '.kt', '.scala',
  '.dart', '.swift',
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.cache', 'coverage', '.orion',
  'target', 'vendor', '.venv', 'venv',
]);

const MAX_FILE_SIZE = 512 * 1024;
const MAX_FILES = 100;

// ─── System Prompts ─────────────────────────────────────────────────────────

const TYPECHECK_SYSTEM_PROMPT = `You are Orion, an expert type system analyst. Analyze the provided code for type safety issues and suggest improvements.

For each finding, use this exact format:
[ERROR] <title>: <description and suggested fix>
[WARNING] <title>: <description and suggested fix>
[INFO] <title>: <description and suggested fix>

Focus on:
1. **Missing Type Annotations**: Parameters, return types, variables without explicit types
2. **\`any\` Type Usage**: Replace \`any\` with proper types, suggest specific interfaces/types
3. **Interface Improvements**: Extract inline types to named interfaces, use proper generics
4. **Generic Usage**: Suggest where generics would improve reusability and type safety
5. **Type Narrowing**: Suggest type guards, discriminated unions, assertion functions
6. **Null Safety**: Optional chaining, nullish coalescing, strict null checks
7. **Enum vs Union Types**: When to use each pattern

For each suggestion:
- Reference the exact line number
- Show the current code
- Show the improved code with proper types
- Explain why the change improves type safety

End with:
- Type Safety Score (1-10)
- Summary of improvements
- Number of \`any\` types found vs. fixed`;

const STRICT_TYPECHECK_PROMPT = `You are Orion, an expert type system analyst performing a STRICT mode type audit. Apply the most rigorous type safety standards.

For each finding, use this exact format:
[ERROR] <title>: <description and fix>
[WARNING] <title>: <description and fix>
[INFO] <title>: <description and fix>

In strict mode, also flag:
1. **All \`any\` types** - every single one must be replaced
2. **Implicit return types** - all functions must have explicit return types
3. **Type assertions** - flag \`as\` casts and suggest type guards instead
4. **Non-null assertions** - flag all \`!\` operators and suggest alternatives
5. **Index signatures** - use Record<K,V> or Map instead of {[key: string]: T}
6. **Missing readonly** - properties that should be readonly
7. **Mutable arrays** - suggest ReadonlyArray where applicable
8. **Loose equality** - flag == vs ===
9. **Unknown vs any** - prefer \`unknown\` for truly unknown types
10. **Branded types** - suggest nominal typing for IDs, tokens, etc.

Be extremely thorough. Every function, parameter, variable, and return type must be checked.
Provide the complete improved type signatures for every finding.

End with:
- Strict Type Safety Score (1-10)
- Total issues found by category
- Priority fix list (top 5 most impactful changes)`;

const CONVERT_SYSTEM_PROMPT = `You are Orion, an expert at JavaScript-to-TypeScript conversion. Analyze the provided JavaScript code and produce a complete TypeScript conversion plan.

Provide:

1. **Type Definitions**
   - All interfaces/types needed for the conversion
   - Include JSDoc-derived types if JSDoc comments exist
   - Export types that other modules would need

2. **File Conversion**
   - Show the complete converted TypeScript code
   - Add proper type annotations to all functions, parameters, and return types
   - Convert CommonJS require() to ESM imports where applicable
   - Replace var with const/let
   - Add generics where appropriate

3. **Configuration Changes**
   - Any tsconfig.json settings needed
   - Package dependency changes (@types/* packages needed)
   - File rename suggestions (.js -> .ts / .jsx -> .tsx)

4. **Migration Notes**
   - Breaking changes to watch for
   - Runtime behavior differences
   - Third-party library type support

Show the COMPLETE converted file, not just snippets.
Preserve all functionality while adding full type safety.`;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TypecheckOptions {
  strict?: boolean;
  convert?: boolean;
}

// ─── Type Issue Heuristics ──────────────────────────────────────────────────

interface TypeIssue {
  line: number;
  type: 'any' | 'missing-return' | 'missing-param' | 'implicit' | 'assertion';
  snippet: string;
}

function quickTypeAnalysis(content: string, language: string): TypeIssue[] {
  const issues: TypeIssue[] = [];
  const lines = content.split(/\r?\n/);

  if (language !== 'typescript' && language !== 'javascript') {
    return issues;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    // Find `any` usage
    if (/\bany\b/.test(trimmed) && !trimmed.startsWith('//')) {
      issues.push({
        line: i + 1,
        type: 'any',
        snippet: trimmed,
      });
    }

    // Find type assertions (as X)
    if (/\bas\s+\w/.test(trimmed) && language === 'typescript') {
      issues.push({
        line: i + 1,
        type: 'assertion',
        snippet: trimmed,
      });
    }

    // Find functions without return types (TypeScript)
    if (language === 'typescript') {
      // Match function declarations and arrow functions without explicit return type
      if (/(?:function\s+\w+|(?:async\s+)?(?:\w+|\([^)]*\)))\s*\([^)]*\)\s*\{/.test(trimmed)) {
        if (!/\)\s*:\s*\w/.test(trimmed)) {
          issues.push({
            line: i + 1,
            type: 'missing-return',
            snippet: trimmed,
          });
        }
      }
    }
  }

  return issues;
}

// ─── File Discovery ─────────────────────────────────────────────────────────

function discoverFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(currentDir: string, depth: number): void {
    if (depth > 6 || files.length >= MAX_FILES) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;

      const name = entry.name;
      if (name.startsWith('.')) continue;

      const fullPath = path.join(currentDir, name);

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(name)) {
          walk(fullPath, depth + 1);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (TYPEABLE_EXTENSIONS.has(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size <= MAX_FILE_SIZE) {
              files.push(fullPath);
            }
          } catch { /* skip */ }
        }
      }
    }
  }

  walk(dir, 0);
  return files;
}

// ─── Display Helpers ────────────────────────────────────────────────────────

function displayQuickAnalysis(issues: TypeIssue[], filePath: string): void {
  if (issues.length === 0) {
    console.log(statusLine('\u2713', palette.green('No obvious type issues detected by quick scan')));
    console.log();
    return;
  }

  const counts: Record<string, number> = {};
  for (const issue of issues) {
    counts[issue.type] = (counts[issue.type] || 0) + 1;
  }

  const parts: string[] = [];
  if (counts['any']) parts.push(`${badge('any', '#EF4444')} ${counts['any']}`);
  if (counts['missing-return']) parts.push(`${badge('MISSING RETURN', '#F59E0B')} ${counts['missing-return']}`);
  if (counts['assertion']) parts.push(`${badge('TYPE ASSERTION', '#F97316')} ${counts['assertion']}`);
  if (counts['implicit']) parts.push(`${badge('IMPLICIT', '#3B82F6')} ${counts['implicit']}`);

  console.log(`  ${parts.join('  ')}`);
  console.log();

  // Show first few issues
  const preview = issues.slice(0, 8);
  for (const issue of preview) {
    const typeLabel = issue.type === 'any' ? palette.red('any usage')
      : issue.type === 'missing-return' ? palette.yellow('missing return type')
      : issue.type === 'assertion' ? palette.orange('type assertion')
      : palette.blue('implicit type');

    console.log(`    Line ${palette.white(String(issue.line))} ${typeLabel}`);
    console.log(`      ${palette.dim(issue.snippet.substring(0, 100))}`);
  }

  if (issues.length > 8) {
    console.log(`    ${palette.dim(`... and ${issues.length - 8} more`)}`);
  }
  console.log();
}

function colorizeTypeOutput(text: string): void {
  const lines = text.split('\n');
  const nonSeverityLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^\[(ERROR|WARNING|INFO)\]\s*(.*)/);

    if (match) {
      if (nonSeverityLines.length > 0) {
        const mdBlock = nonSeverityLines.join('\n');
        if (mdBlock.trim()) console.log(renderMarkdown(mdBlock));
        nonSeverityLines.length = 0;
      }

      const sev = match[1];
      const rest = match[2];
      const sevColor = sev === 'ERROR' ? '#EF4444' : sev === 'WARNING' ? '#F59E0B' : '#3B82F6';
      console.log(`  ${badge(sev, sevColor)} ${rest}`);
    } else {
      nonSeverityLines.push(line);
    }
  }

  if (nonSeverityLines.length > 0) {
    const mdBlock = nonSeverityLines.join('\n');
    if (mdBlock.trim()) console.log(renderMarkdown(mdBlock));
  }
}

// ─── Command Logic ──────────────────────────────────────────────────────────

async function analyzeFile(filePath: string, options: TypecheckOptions): Promise<void> {
  const file = readAndValidateFile(filePath);
  if (!file) return;

  const lang = file.language;

  // Quick heuristic scan
  console.log(`  ${palette.violet.bold('Quick Scan')}`);
  console.log(divider());
  const quickIssues = quickTypeAnalysis(file.content, lang);
  displayQuickAnalysis(quickIssues, filePath);

  // AI deep analysis
  console.log(`  ${palette.violet.bold('AI Type Analysis')}`);
  console.log(divider());

  let systemPrompt: string;
  let userMessage: string;

  if (options.convert) {
    systemPrompt = CONVERT_SYSTEM_PROMPT;
    userMessage = `Convert this ${lang} file (${file.fileName}) to TypeScript with full type annotations:\n\n\`\`\`${lang}\n${file.content}\n\`\`\``;
  } else if (options.strict) {
    systemPrompt = STRICT_TYPECHECK_PROMPT;
    userMessage = `Perform a STRICT type safety audit on this ${lang} file (${file.fileName}):\n\n\`\`\`${lang}\n${file.content}\n\`\`\``;
  } else {
    systemPrompt = TYPECHECK_SYSTEM_PROMPT;
    userMessage = `Analyze types in this ${lang} file (${file.fileName}) and suggest improvements:\n\n\`\`\`${lang}\n${file.content}\n\`\`\``;
  }

  const projectContext = loadProjectContext();
  const fullSystemPrompt = projectContext
    ? systemPrompt + '\n\nProject context:\n' + projectContext
    : systemPrompt;

  const aiSpinner = startSpinner(
    options.convert ? 'Generating TypeScript conversion...'
    : options.strict ? 'Running strict type analysis...'
    : 'Analyzing types...'
  );

  try {
    let fullResponse = '';

    await askAI(fullSystemPrompt, userMessage, {
      onToken(token: string) {
        fullResponse += token;
      },
      onComplete(text: string) {
        stopSpinner(aiSpinner);
        console.log();
        if (options.convert) {
          // Conversion output is mostly code, render as markdown
          console.log(renderMarkdown(text));
        } else {
          colorizeTypeOutput(text);
        }
        console.log();
      },
      onError(error: Error) {
        stopSpinner(aiSpinner, error.message, false);
      },
    });
  } catch (err: any) {
    stopSpinner(aiSpinner, err.message, false);
    printCommandError(err, 'typecheck', 'Run `orion config` to check your AI provider settings.');
  }
}

async function analyzeDirectory(dirPath: string, options: TypecheckOptions): Promise<void> {
  const scanSpinner = startSpinner('Scanning directory...');
  const files = discoverFiles(dirPath);

  if (files.length === 0) {
    scanSpinner.fail(palette.red('No type-checkable files found'));
    console.log(`  ${palette.dim('Supported extensions: .ts, .tsx, .js, .jsx, .py, .go, .rs, .java, .cs')}`);
    console.log();
    return;
  }

  scanSpinner.succeed(palette.green(`Found ${files.length} files to analyze`));
  console.log();

  // Aggregate quick scan across all files
  let totalIssues = 0;
  const issuesByType: Record<string, number> = {};

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    const lang = detectLanguage(file);
    const issues = quickTypeAnalysis(content, lang);
    totalIssues += issues.length;
    for (const issue of issues) {
      issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1;
    }
  }

  console.log(`  ${palette.violet.bold('Quick Scan Summary')}`);
  console.log(divider());
  if (totalIssues > 0) {
    const parts: string[] = [];
    if (issuesByType['any']) parts.push(`${badge('any', '#EF4444')} ${issuesByType['any']}`);
    if (issuesByType['missing-return']) parts.push(`${badge('MISSING RETURN', '#F59E0B')} ${issuesByType['missing-return']}`);
    if (issuesByType['assertion']) parts.push(`${badge('TYPE ASSERTION', '#F97316')} ${issuesByType['assertion']}`);
    console.log(`  ${parts.join('  ')}`);
    console.log(`  ${palette.dim(`${totalIssues} total issues across ${files.length} files`)}`);
  } else {
    console.log(statusLine('\u2713', palette.green('No obvious type issues found')));
  }
  console.log();

  // AI analysis on a subset of files
  console.log(`  ${palette.violet.bold('AI Type Analysis')}`);
  console.log(divider());

  const filesToAnalyze = files.slice(0, 10);
  const cwd = process.cwd();
  const codeParts: string[] = [];
  for (const file of filesToAnalyze) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const relPath = path.relative(cwd, file);
    const lang = detectLanguage(file);
    codeParts.push(`--- ${relPath} (${lang}) ---\n\`\`\`${lang}\n${content}\n\`\`\``);
  }

  const systemPrompt = options.strict ? STRICT_TYPECHECK_PROMPT : TYPECHECK_SYSTEM_PROMPT;
  const projectContext = loadProjectContext();
  const fullSystemPrompt = projectContext
    ? systemPrompt + '\n\nProject context:\n' + projectContext
    : systemPrompt;

  const userMessage = `Analyze types across these ${filesToAnalyze.length} files and suggest improvements:\n\n${codeParts.join('\n\n')}`;

  const aiSpinner = startSpinner(options.strict ? 'Running strict type analysis...' : 'Analyzing types...');

  try {
    let fullResponse = '';

    await askAI(fullSystemPrompt, userMessage, {
      onToken(token: string) {
        fullResponse += token;
      },
      onComplete(text: string) {
        stopSpinner(aiSpinner);
        console.log();
        colorizeTypeOutput(text);
        console.log();
      },
      onError(error: Error) {
        stopSpinner(aiSpinner, error.message, false);
      },
    });
  } catch (err: any) {
    stopSpinner(aiSpinner, err.message, false);
    printCommandError(err, 'typecheck', 'Run `orion config` to check your AI provider settings.');
  }
}

// ─── Command Entry Point ────────────────────────────────────────────────────

export async function typecheckCommand(target: string, options: TypecheckOptions = {}): Promise<void> {
  if (!target || !target.trim()) {
    console.log();
    console.log(`  ${colors.error('Please provide a file or directory to analyze.')}`);
    console.log(`  ${palette.dim('Usage: orion typecheck src/app.ts')}`);
    console.log(`  ${palette.dim('       orion typecheck src/ --strict')}`);
    console.log(`  ${palette.dim('       orion typecheck src/app.js --convert')}`);
    console.log();
    process.exit(1);
  }

  const resolvedTarget = path.resolve(target);

  let isDirectory = false;
  try {
    const stat = fs.statSync(resolvedTarget);
    isDirectory = stat.isDirectory();
  } catch {
    console.log();
    console.log(`  ${colors.error('Target not found:')} ${resolvedTarget}`);
    console.log(`  ${palette.dim('Provide a valid file or directory path.')}`);
    console.log();
    return;
  }

  let modeLabel = 'Type Analysis';
  if (options.strict) modeLabel = 'Strict Type Analysis';
  if (options.convert) modeLabel = 'TypeScript Conversion';

  console.log(commandHeader('Orion Type Checker', [
    ['Mode', modeLabel],
    [isDirectory ? 'Directory' : 'File', resolvedTarget],
  ]));

  if (isDirectory) {
    await analyzeDirectory(resolvedTarget, options);
  } else {
    await analyzeFile(target, options);
  }
}
