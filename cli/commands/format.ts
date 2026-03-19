/**
 * Orion CLI - Code Formatter with AI Fallback
 * Detects and runs the project's native formatter, or uses AI to format code.
 *
 * Usage:
 *   orion format src/app.ts                # Auto-format a file
 *   orion format src/ --check              # Check formatting without changing
 *   orion format src/ --style airbnb       # Format with specific style guide
 */

import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { askAI } from '../ai-client.js';
import {
  colors,
  printInfo,
  printSuccess,
  printError,
  printWarning,
  startSpinner,
  stopSpinner,
  readFileContent,
  writeFileContent,
  detectLanguage,
  loadProjectContext,
  runShellCommand,
} from '../utils.js';
import {
  createSilentStreamHandler,
  readAndValidateFile,
} from '../shared.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';
import {
  commandHeader,
  divider,
  diffBlock,
  palette,
  badge,
} from '../ui.js';
import { createBackup } from '../backup.js';

// ─── Formatter Definitions ────────────────────────────────────────────────

interface FormatterInfo {
  name: string;
  label: string;
  configFiles: string[];
  formatCommand: (target: string) => string;
  checkCommand: (target: string) => string;
  languages: string[];
}

const FORMATTERS: FormatterInfo[] = [
  {
    name: 'prettier',
    label: 'Prettier',
    configFiles: ['.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.yaml', '.prettierrc.yml', '.prettierrc.toml', 'prettier.config.js', 'prettier.config.cjs'],
    formatCommand: (target: string) => `npx prettier --write "${target}"`,
    checkCommand: (target: string) => `npx prettier --check "${target}"`,
    languages: ['typescript', 'javascript', 'css', 'scss', 'less', 'html', 'json', 'yaml', 'markdown', 'vue', 'svelte'],
  },
  {
    name: 'eslint',
    label: 'ESLint',
    configFiles: ['.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs'],
    formatCommand: (target: string) => `npx eslint --fix "${target}"`,
    checkCommand: (target: string) => `npx eslint "${target}"`,
    languages: ['typescript', 'javascript', 'vue', 'svelte'],
  },
  {
    name: 'black',
    label: 'Black',
    configFiles: ['pyproject.toml'],
    formatCommand: (target: string) => `python -m black "${target}"`,
    checkCommand: (target: string) => `python -m black --check "${target}"`,
    languages: ['python'],
  },
  {
    name: 'rustfmt',
    label: 'rustfmt',
    configFiles: ['rustfmt.toml', '.rustfmt.toml'],
    formatCommand: (target: string) => `rustfmt "${target}"`,
    checkCommand: (target: string) => `rustfmt --check "${target}"`,
    languages: ['rust'],
  },
  {
    name: 'gofmt',
    label: 'gofmt',
    configFiles: ['go.mod'],
    formatCommand: (target: string) => `gofmt -w "${target}"`,
    checkCommand: (target: string) => `gofmt -l "${target}"`,
    languages: ['go'],
  },
];

// ─── Style Guides ─────────────────────────────────────────────────────────

const STYLE_GUIDES: Record<string, { label: string; description: string }> = {
  airbnb: { label: 'Airbnb', description: 'Airbnb JavaScript/TypeScript style guide (2-space indent, trailing commas, single quotes)' },
  google: { label: 'Google', description: 'Google style guide (2-space indent, JSDoc, const by default)' },
  standard: { label: 'Standard', description: 'Standard style (no semicolons, 2-space indent, single quotes)' },
};

// ─── Formatter Detection ──────────────────────────────────────────────────

interface DetectedFormatter {
  formatter: FormatterInfo;
  configPath?: string;
}

function detectFormatter(language: string): DetectedFormatter | null {
  const cwd = process.cwd();

  // Check each formatter in priority order
  for (const formatter of FORMATTERS) {
    if (!formatter.languages.includes(language)) continue;

    // Check for config files
    for (const configFile of formatter.configFiles) {
      const configPath = path.join(cwd, configFile);
      if (fs.existsSync(configPath)) {
        // Special case: pyproject.toml should only match black if it contains [tool.black]
        if (formatter.name === 'black' && configFile === 'pyproject.toml') {
          try {
            const content = fs.readFileSync(configPath, 'utf-8');
            if (!content.includes('[tool.black]') && !content.includes('black')) continue;
          } catch { continue; }
        }
        return { formatter, configPath };
      }
    }

    // Special checks for formatters available via package.json
    if (['prettier', 'eslint'].includes(formatter.name)) {
      const pkgPath = path.join(cwd, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
          if (allDeps[formatter.name]) {
            return { formatter };
          }
          // Check for prettier key in package.json
          if (formatter.name === 'prettier' && pkg.prettier) {
            return { formatter, configPath: pkgPath };
          }
        } catch { /* ignore */ }
      }
    }

    // Check for go.mod (gofmt is always available with Go)
    if (formatter.name === 'gofmt' && fs.existsSync(path.join(cwd, 'go.mod'))) {
      return { formatter };
    }

    // Check for Cargo.toml (rustfmt is part of the Rust toolchain)
    if (formatter.name === 'rustfmt' && fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
      return { formatter };
    }
  }

  return null;
}

// ─── Collect Files in Directory ───────────────────────────────────────────

function collectFiles(targetPath: string, language?: string): string[] {
  const resolvedPath = path.resolve(targetPath);
  const stat = fs.statSync(resolvedPath);

  if (stat.isFile()) {
    return [resolvedPath];
  }

  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  const ignorePatterns = ['node_modules', 'dist', 'build', '.git', '.next', '.svelte-kit', '__pycache__', 'target', 'vendor', '.orion'];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (ignorePatterns.includes(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.eslintrc.js') continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const lang = detectLanguage(fullPath);
        if (lang === 'text') continue; // Skip unknown file types
        if (language && lang !== language) continue; // Filter by language if specified
        files.push(fullPath);
      }
    }
  }

  walk(resolvedPath);
  return files;
}

// ─── AI Formatting Prompt ─────────────────────────────────────────────────

function buildFormatPrompt(language: string, style?: string): string {
  const styleInfo = style && STYLE_GUIDES[style]
    ? `\n\nApply the ${STYLE_GUIDES[style].label} style guide: ${STYLE_GUIDES[style].description}`
    : '';

  return `You are Orion, an expert code formatter. Format the given ${language} code according to best practices and community conventions.${styleInfo}

Rules:
1. Output ONLY the formatted code - no explanations, no markdown fences
2. Preserve all functionality - formatting only, no logic changes
3. Preserve all comments
4. Apply consistent indentation (2 spaces for JS/TS, 4 spaces for Python, tabs for Go)
5. Normalize whitespace, trailing commas, and semicolons
6. Sort imports when appropriate
7. Ensure consistent line length (80-120 chars)
8. Apply language-specific formatting conventions
9. Do NOT add or remove code logic
10. Do NOT wrap output in code fences`;
}

// ─── Format Single File with AI ───────────────────────────────────────────

async function aiFormatFile(filePath: string, style?: string): Promise<string> {
  const { content, language } = readFileContent(filePath);

  const systemPrompt = buildFormatPrompt(language, style);
  const projectContext = loadProjectContext();
  const fullPrompt = projectContext
    ? systemPrompt + '\n\nProject context:\n' + projectContext
    : systemPrompt;

  const userMessage = `Format this ${language} file:\n\nFile: ${path.basename(filePath)}\n\n${content}`;

  const spinner = startSpinner(`AI formatting ${path.basename(filePath)}...`);
  const { callbacks, getResponse } = createSilentStreamHandler(spinner, 'Formatted');

  await askAI(fullPrompt, userMessage, callbacks);

  let formatted = getResponse().trim();

  // Clean up potential code fences
  if (formatted.startsWith('```')) {
    const lines = formatted.split('\n');
    lines.shift();
    if (lines[lines.length - 1]?.trim() === '```') {
      lines.pop();
    }
    formatted = lines.join('\n');
  }

  return formatted;
}

// ─── Format with Native Formatter ─────────────────────────────────────────

function nativeFormat(target: string, detected: DetectedFormatter, checkOnly: boolean): { success: boolean; output: string; changed: boolean } {
  const cmd = checkOnly
    ? detected.formatter.checkCommand(target)
    : detected.formatter.formatCommand(target);

  const result = runShellCommand(cmd);

  if (checkOnly) {
    // For check mode, exit code 0 = already formatted, non-zero = needs formatting
    return {
      success: true,
      output: result.stdout || result.stderr,
      changed: result.exitCode !== 0,
    };
  }

  return {
    success: result.exitCode === 0,
    output: result.stdout || result.stderr,
    changed: true,
  };
}

// ─── Formatter Badge ──────────────────────────────────────────────────────

function formatterBadge(name: string): string {
  const colorMap: Record<string, string> = {
    prettier: '#F7B93E',
    eslint: '#4B32C3',
    black: '#000000',
    rustfmt: '#DEA584',
    gofmt: '#00ADD8',
    'ai-format': '#7C5CFC',
  };
  return badge(name, colorMap[name] || '#7C5CFC');
}

// ─── Main Command ─────────────────────────────────────────────────────────

export interface FormatCommandOptions {
  check?: boolean;
  style?: string;
}

export async function formatCommand(
  target: string,
  options?: FormatCommandOptions
): Promise<void> {
  const pipelineOpts = getPipelineOptions();
  const checkOnly = options?.check || false;
  const style = options?.style?.toLowerCase();

  // Validate style guide if provided
  if (style && !STYLE_GUIDES[style]) {
    console.log(commandHeader('Orion Format'));
    console.log();
    printError(`Unknown style guide: "${options?.style}"`);
    console.log();
    printInfo('Available style guides:');
    for (const [key, info] of Object.entries(STYLE_GUIDES)) {
      console.log(`    ${colors.command(key.padEnd(12))} ${palette.dim(info.description)}`);
    }
    console.log();
    process.exit(1);
  }

  // Validate target
  const resolvedTarget = path.resolve(target);
  if (!fs.existsSync(resolvedTarget)) {
    console.log(commandHeader('Orion Format'));
    console.log();
    printError(`Target not found: ${resolvedTarget}`);
    printInfo('Provide a file or directory path.');
    console.log();
    process.exit(1);
  }

  const isDir = fs.statSync(resolvedTarget).isDirectory();
  const relativeTarget = path.relative(process.cwd(), resolvedTarget) || '.';

  // Detect language for formatter selection (use first file if directory)
  let primaryLanguage = 'typescript';
  if (!isDir) {
    primaryLanguage = detectLanguage(resolvedTarget);
  } else {
    const sampleFiles = collectFiles(resolvedTarget).slice(0, 5);
    if (sampleFiles.length > 0) {
      primaryLanguage = detectLanguage(sampleFiles[0]);
    }
  }

  // Detect native formatter
  const detectedSpinner = startSpinner('Detecting formatter...');
  const detected = detectFormatter(primaryLanguage);
  const formatterName = detected ? detected.formatter.label : 'AI Format';
  stopSpinner(detectedSpinner, `Formatter: ${formatterName}`);

  console.log(commandHeader(`Orion Format${checkOnly ? ' (Check)' : ''}`, [
    ['Target', colors.file(relativeTarget) + (isDir ? palette.dim(' (directory)') : '')],
    ['Formatter', formatterBadge(detected ? detected.formatter.name : 'ai-format')],
    ['Mode', checkOnly ? palette.yellow('check only') : palette.green('format')],
    ...(style ? [['Style', palette.violet(STYLE_GUIDES[style].label)] as [string, string]] : []),
  ]));

  // ─── Native Formatter Path ────────────────────────────────────────────

  if (detected && !style) {
    // Use the native formatter (unless a specific style is requested, which needs AI)
    const formatSpinner = startSpinner(`Running ${detected.formatter.label}...`);

    try {
      const result = nativeFormat(resolvedTarget, detected, checkOnly);
      stopSpinner(formatSpinner, checkOnly
        ? (result.changed ? 'Formatting issues found' : 'All files formatted correctly')
        : 'Formatting complete'
      );

      if (!pipelineOpts.quiet && result.output) {
        console.log();
        console.log(divider(`${detected.formatter.label} Output`));
        console.log();
        const outputLines = result.output.split('\n').slice(0, 30);
        for (const line of outputLines) {
          console.log(`  ${palette.dim(line)}`);
        }
        if (result.output.split('\n').length > 30) {
          console.log(palette.dim(`  ... and more`));
        }
        console.log();
      }

      if (checkOnly) {
        if (result.changed) {
          printWarning('Some files need formatting.');
          printInfo(`Run ${colors.command(`orion format ${relativeTarget}`)} to fix.`);
        } else {
          printSuccess('All files are properly formatted.');
        }
      } else {
        printSuccess(`Formatted with ${detected.formatter.label}.`);
      }

      console.log();

      jsonOutput('format', {
        target: resolvedTarget,
        formatter: detected.formatter.name,
        check: checkOnly,
        needsFormatting: checkOnly ? result.changed : false,
        native: true,
      });

      if (checkOnly && result.changed) {
        process.exit(1); // Non-zero exit for CI check mode failures
      }

      return;
    } catch (err: any) {
      stopSpinner(formatSpinner, `${detected.formatter.label} failed, falling back to AI`, false);
      printWarning(`Native formatter error: ${err.message}`);
      printInfo('Falling back to AI formatting...');
      console.log();
    }
  }

  // ─── AI Formatter Path ────────────────────────────────────────────────

  if (isDir) {
    // Directory-wide AI formatting
    const files = collectFiles(resolvedTarget);

    if (files.length === 0) {
      printInfo('No formattable files found in the directory.');
      console.log();
      return;
    }

    console.log();
    printInfo(`Found ${files.length} file${files.length > 1 ? 's' : ''} to format.`);
    console.log();

    let formattedCount = 0;
    let unchangedCount = 0;
    let errorCount = 0;
    const changedFiles: string[] = [];

    for (const filePath of files) {
      const relative = path.relative(process.cwd(), filePath);

      try {
        const original = fs.readFileSync(filePath, 'utf-8');
        const formatted = await aiFormatFile(filePath, style);

        if (formatted === original || formatted.trim() === original.trim()) {
          unchangedCount++;
          continue;
        }

        if (checkOnly) {
          changedFiles.push(relative);
          formattedCount++;
          continue;
        }

        // Backup and write
        try { createBackup(filePath); } catch { /* skip backup on error */ }
        writeFileContent(filePath, formatted);
        changedFiles.push(relative);
        formattedCount++;
      } catch {
        errorCount++;
        if (!pipelineOpts.quiet) {
          printWarning(`Failed to format: ${relative}`);
        }
      }
    }

    // Summary
    console.log();
    console.log(divider('Format Summary'));
    console.log();

    if (changedFiles.length > 0 && !pipelineOpts.quiet) {
      for (const file of changedFiles.slice(0, 20)) {
        const icon = checkOnly ? palette.yellow('~') : palette.green('+');
        console.log(`  ${icon} ${colors.file(file)}`);
      }
      if (changedFiles.length > 20) {
        console.log(palette.dim(`  ... and ${changedFiles.length - 20} more`));
      }
      console.log();
    }

    printInfo(`Changed: ${formattedCount}`);
    printInfo(`Unchanged: ${unchangedCount}`);
    if (errorCount > 0) {
      printWarning(`Errors: ${errorCount}`);
    }
    console.log();

    if (checkOnly && formattedCount > 0) {
      printWarning(`${formattedCount} file${formattedCount > 1 ? 's' : ''} need formatting.`);
      printInfo(`Run ${colors.command(`orion format ${relativeTarget}`)} to fix.`);
    } else if (!checkOnly && formattedCount > 0) {
      printSuccess(`Formatted ${formattedCount} file${formattedCount > 1 ? 's' : ''} with AI.`);
    } else {
      printSuccess('All files are properly formatted.');
    }

    console.log();

    jsonOutput('format', {
      target: resolvedTarget,
      formatter: 'ai',
      check: checkOnly,
      style: style || null,
      filesProcessed: files.length,
      filesChanged: formattedCount,
      filesUnchanged: unchangedCount,
      errors: errorCount,
    });

    if (checkOnly && formattedCount > 0) {
      process.exit(1);
    }

    return;
  }

  // ─── Single File AI Format ────────────────────────────────────────────

  const file = readAndValidateFile(target);
  if (!file) {
    process.exit(1);
  }

  try {
    const formatted = await aiFormatFile(file.resolvedPath, style);

    // Check if anything changed
    if (formatted === file.content || formatted.trim() === file.content.trim()) {
      printSuccess('File is already properly formatted. No changes needed.');
      console.log();

      jsonOutput('format', {
        target: file.resolvedPath,
        formatter: 'ai',
        check: checkOnly,
        style: style || null,
        changed: false,
      });

      return;
    }

    // Show diff preview
    if (!pipelineOpts.quiet) {
      console.log();
      console.log(diffBlock(file.content, formatted, file.fileName));
      console.log();
    }

    if (checkOnly) {
      printWarning('File needs formatting.');
      printInfo(`Run ${colors.command(`orion format ${target}`)} to apply.`);
      console.log();

      jsonOutput('format', {
        target: file.resolvedPath,
        formatter: 'ai',
        check: true,
        style: style || null,
        changed: true,
      });

      process.exit(1);
    }

    // Confirm before writing (unless --yes)
    let shouldWrite = false;

    if (pipelineOpts.yes) {
      shouldWrite = true;
    } else {
      const answer = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'Apply formatting?',
        choices: [
          { name: 'Apply changes', value: 'apply' },
          { name: 'Cancel', value: 'cancel' },
        ],
      }]);
      shouldWrite = answer.action === 'apply';
    }

    if (shouldWrite) {
      if (pipelineOpts.dryRun) {
        printInfo('Dry run: no files were modified.');
        jsonOutput('format', { target: file.resolvedPath, formatter: 'ai', dryRun: true });
        console.log();
        return;
      }

      // Backup and write
      try {
        createBackup(file.resolvedPath);
        printInfo('Backup saved.');
      } catch (backupErr: any) {
        printWarning(`Backup skipped: ${backupErr.message}`);
      }

      writeFileContent(file.resolvedPath, formatted);
      printSuccess(`Formatted: ${colors.file(file.resolvedPath)}`);

      jsonOutput('format', {
        target: file.resolvedPath,
        formatter: 'ai',
        style: style || null,
        changed: true,
      });
    } else {
      printInfo('Formatting cancelled. No changes applied.');
    }

    console.log();
  } catch (err: any) {
    printError(`Formatting failed: ${err.message}`);
    printInfo('Run `orion config` to check your AI provider settings.');
    console.log();
    process.exit(1);
  }
}
