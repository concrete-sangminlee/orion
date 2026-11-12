/**
 * Orion CLI - AI-Powered Refactoring Command
 * Rename symbols across codebase, extract functions, simplify code, find unused exports
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
  writeFileContent,
  readFileContent,
  fileExists,
  loadProjectContext,
} from '../utils.js';
import {
  createSilentStreamHandler,
  readAndValidateFile,
  printCommandError,
} from '../shared.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';
import { commandHeader, diffBlock, divider, statusLine, palette } from '../ui.js';
import { createBackup } from '../backup.js';

// ─── System Prompts ──────────────────────────────────────────────────────────

const RENAME_SYSTEM_PROMPT = `You are Orion, an expert refactoring assistant. The user wants to rename a symbol across their codebase.

You will receive:
1. The old name and the new name
2. Multiple files that reference the old name

For EACH file that contains the old name, output the complete modified file content with all occurrences renamed.

Use this exact format for each file:

===FILE: <filepath>===
<complete file content with renames applied>
===END FILE===

Rules:
- Rename all occurrences of the old symbol (declarations, references, imports, exports, comments, strings)
- Do NOT rename partial matches (e.g., renaming "get" should not affect "getAll")
- Preserve all formatting, indentation, and line endings
- Only output files that actually changed
- Do NOT include markdown code fences or explanations`;

const EXTRACT_SYSTEM_PROMPT = `You are Orion, an expert refactoring assistant. The user wants to extract a section of code into a new function.

You will receive:
1. The file content
2. The name for the new function

Output the complete modified file with the specified code extracted into a well-typed function.

Rules:
1. Output ONLY the complete modified file content
2. Do NOT include any explanation, markdown formatting, or code fences
3. Identify the most appropriate code block to extract based on the function name
4. Create a properly typed function with correct parameters and return type
5. Replace the original code with a call to the new function
6. Place the new function in a logical location (near the original code or at module level)
7. Preserve all imports and existing code`;

const SIMPLIFY_SYSTEM_PROMPT = `You are Orion, an expert refactoring assistant. The user wants to simplify complex code.

Analyze the code and simplify it by:
- Reducing nesting and cyclomatic complexity
- Replacing verbose patterns with idiomatic alternatives
- Extracting repeated logic into helper functions
- Simplifying conditionals and control flow
- Using modern language features where appropriate

First, list the simplifications you made:
[SIMPLIFY] <description of change>

Then output a separator line: ---REFACTORED---

Then output ONLY the complete simplified file content.
Do NOT wrap the code in code fences or markdown.
Output raw code after the ---REFACTORED--- separator.`;

const UNUSED_SYSTEM_PROMPT = `You are Orion, an expert code analyzer. The user wants to find unused exports and imports in their codebase.

You will receive multiple files from a directory. Analyze them and identify:
1. Exported functions, classes, types, or constants that are never imported by other files in the set
2. Imported symbols that are never used within the importing file
3. Dead code (unreachable code blocks)

Output your findings using this exact format:
[UNUSED EXPORT] <filepath>: <symbol name> - exported but never imported by other files
[UNUSED IMPORT] <filepath>: <symbol name> - imported but never used
[DEAD CODE] <filepath>: line ~<N> - <description>

At the end, provide a summary count.
Do NOT suggest fixes or output modified code. Only report findings.`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Recursively collect source files from a directory (non-binary, reasonable size).
 */
function collectSourceFiles(dirPath: string, maxFiles = 200): string[] {
  const sourceExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
    '.cs', '.rb', '.php', '.swift', '.kt', '.scala',
    '.vue', '.svelte', '.dart', '.ex', '.exs',
  ]);

  const ignoreDirs = new Set(['node_modules', 'dist', 'build', '.git', '.orion', '__pycache__', '.next', 'coverage']);
  const files: string[] = [];

  function walk(dir: string) {
    if (files.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (sourceExtensions.has(ext)) {
          const fullPath = path.join(dir, entry.name);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size <= 512 * 1024) { // Skip files > 512KB
              files.push(fullPath);
            }
          } catch { /* skip */ }
        }
      }
    }
  }

  walk(dirPath);
  return files;
}

/**
 * Search for files containing a specific string.
 */
function findFilesContaining(searchDir: string, searchStr: string, maxFiles = 100): string[] {
  const allFiles = collectSourceFiles(searchDir);
  const matches: string[] = [];

  for (const filePath of allFiles) {
    if (matches.length >= maxFiles) break;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes(searchStr)) {
        matches.push(filePath);
      }
    } catch { /* skip unreadable files */ }
  }

  return matches;
}

/**
 * Parse multi-file AI response with ===FILE: <path>=== delimiters.
 */
function parseMultiFileResponse(response: string): Map<string, string> {
  const fileMap = new Map<string, string>();
  const regex = /===FILE:\s*(.+?)===\n([\s\S]*?)===END FILE===/g;

  let match;
  while ((match = regex.exec(response)) !== null) {
    const filePath = match[1].trim();
    let content = match[2];
    // Remove trailing newline if present
    if (content.endsWith('\n')) {
      content = content.slice(0, -1);
    }
    fileMap.set(filePath, content);
  }

  return fileMap;
}

/**
 * Keep only AI edits to files we actually sent it, keyed by absolute path.
 * The `===FILE:` paths come from the model and are untrusted (a comment in any
 * scanned file can steer them), so `../` escapes, absolute paths and new files
 * are refused. Every sent file was found by walking searchDir without
 * following symlinks, so this also confines writes to searchDir.
 */
export function confineRenameChanges(
  fileChanges: Map<string, string>,
  searchDir: string,
  sentFiles: string[],
): { allowed: Map<string, string>; refused: string[] } {
  const sent = new Set(sentFiles.map(f => path.resolve(f)));
  const allowed = new Map<string, string>();
  const refused: string[] = [];
  for (const [aiPath, content] of fileChanges) {
    const absPath = path.resolve(searchDir, aiPath);
    if (sent.has(absPath)) {
      allowed.set(absPath, content);
    } else {
      refused.push(aiPath);
    }
  }
  return { allowed, refused };
}

// ─── Rename Refactor ─────────────────────────────────────────────────────────

async function handleRename(
  filePath: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const resolvedPath = path.resolve(filePath);

  // Determine search directory: if a file is given, search from its parent; if directory, search there
  let searchDir: string;
  try {
    const stat = fs.statSync(resolvedPath);
    searchDir = stat.isDirectory() ? resolvedPath : path.dirname(resolvedPath);
  } catch {
    printError(`Path not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(commandHeader('Orion Refactor: Rename', [
    ['Rename', `${palette.red(oldName)} -> ${palette.green(newName)}`],
    ['Search', colors.file(searchDir)],
  ]));

  const spinner = startSpinner(`Searching for "${oldName}" across codebase...`);

  const matchingFiles = findFilesContaining(searchDir, oldName);

  if (matchingFiles.length === 0) {
    spinner.stop();
    console.log();
    printWarning(`No files found containing "${oldName}".`);
    console.log();
    return;
  }

  spinner.text = `Found ${matchingFiles.length} file(s). Generating renames...`;

  // Build context for AI
  const fileContents = matchingFiles.map(f => {
    const content = fs.readFileSync(f, 'utf-8');
    const relative = path.relative(searchDir, f);
    return `===FILE: ${relative}===\n${content}\n===END FILE===`;
  }).join('\n\n');

  const userMessage =
    `Rename the symbol "${oldName}" to "${newName}" in all the following files.\n\n` +
    `Only output files that actually changed.\n\n${fileContents}`;

  const projectContext = loadProjectContext();
  const fullPrompt = projectContext
    ? RENAME_SYSTEM_PROMPT + '\n\nProject context:\n' + projectContext
    : RENAME_SYSTEM_PROMPT;

  const { callbacks, getResponse } = createSilentStreamHandler(spinner, `Rename plan generated`);

  await askAI(fullPrompt, userMessage, callbacks, { requireComplete: true });

  const response = getResponse();
  const { allowed: fileChanges, refused } = confineRenameChanges(
    parseMultiFileResponse(response),
    searchDir,
    matchingFiles,
  );

  for (const aiPath of refused) {
    printError(`Refusing to write ${aiPath}: it is not one of the files that contain "${oldName}".`);
  }

  if (fileChanges.size === 0) {
    console.log();
    printWarning('AI did not produce any usable file changes. The symbol may not exist or may be a partial match.');
    console.log();
    return;
  }

  // Show diff preview for each file
  const pipelineOpts = getPipelineOptions();

  console.log();
  console.log(divider(`Changes in ${fileChanges.size} file(s)`));

  for (const [absPath, newContent] of fileChanges) {
    if (!pipelineOpts.quiet) {
      console.log(diffBlock(fs.readFileSync(absPath, 'utf-8'), newContent, path.relative(searchDir, absPath)));
    }
  }

  jsonOutput('refactor_rename_preview', {
    oldName,
    newName,
    filesChanged: fileChanges.size,
    files: Array.from(fileChanges.keys(), absPath => path.relative(searchDir, absPath)),
  });

  // Confirm
  let action: string;
  if (pipelineOpts.yes) {
    action = 'apply';
  } else {
    const answer = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: `Apply rename across ${fileChanges.size} file(s)?`,
      choices: [
        { name: 'Apply all renames', value: 'apply' },
        { name: 'Cancel', value: 'cancel' },
      ],
    }]);
    action = answer.action;
  }

  if (action === 'apply') {
    if (pipelineOpts.dryRun) {
      printInfo('Dry run: no files were modified.');
      jsonOutput('refactor_rename_result', { success: true, dryRun: true });
      return;
    }

    // Create backups and apply
    for (const [absPath, newContent] of fileChanges) {
      const relativePath = path.relative(searchDir, absPath);
      try {
        createBackup(absPath);
      } catch (backupErr: any) {
        printWarning(`Backup skipped for ${relativePath}: ${backupErr.message}`);
      }
      writeFileContent(absPath, newContent);
      printSuccess(`Updated: ${relativePath}`);
    }

    console.log();
    printSuccess(`Renamed "${oldName}" to "${newName}" across ${fileChanges.size} file(s).`);
    jsonOutput('refactor_rename_result', { success: true, filesChanged: fileChanges.size });
  } else {
    printInfo('Rename cancelled. No files changed.');
  }

  console.log();
}

// ─── Extract Refactor ────────────────────────────────────────────────────────

async function handleExtract(filePath: string, functionName: string): Promise<void> {
  const file = readAndValidateFile(filePath);
  if (!file) {
    process.exit(1);
  }

  console.log(commandHeader('Orion Refactor: Extract Function', [
    ['File', colors.file(file.resolvedPath)],
    ['Function', palette.green(functionName)],
    ['Language', `${file.language} \u00B7 ${file.lineCount} lines`],
  ]));

  const spinner = startSpinner('Analyzing code for extraction...');

  const userMessage =
    `Extract a function named "${functionName}" from the following ${file.language} file.\n\n` +
    `File: ${file.fileName}\n\n${file.content}`;

  const projectContext = loadProjectContext();
  const fullPrompt = projectContext
    ? EXTRACT_SYSTEM_PROMPT + '\n\nProject context:\n' + projectContext
    : EXTRACT_SYSTEM_PROMPT;

  const { callbacks, getResponse } = createSilentStreamHandler(spinner, 'Extraction plan generated');

  await askAI(fullPrompt, userMessage, callbacks, { requireComplete: true });

  let modifiedContent = getResponse().trim();

  // Clean up potential code fences
  if (modifiedContent.startsWith('```')) {
    const lines = modifiedContent.split('\n');
    lines.shift();
    if (lines[lines.length - 1]?.trim() === '```') {
      lines.pop();
    }
    modifiedContent = lines.join('\n');
  }

  if (!modifiedContent.trim()) {
    throw new Error('The AI returned an empty file. Nothing was written.');
  }

  const pipelineOpts = getPipelineOptions();

  if (!pipelineOpts.quiet) {
    console.log();
    console.log(diffBlock(file.content, modifiedContent, file.fileName));
    console.log();
  }

  jsonOutput('refactor_extract_preview', {
    file: file.resolvedPath,
    functionName,
  });

  // Confirm
  let action: string;
  if (pipelineOpts.yes) {
    action = 'apply';
  } else {
    const answer = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Apply extraction?',
      choices: [
        { name: 'Apply changes', value: 'apply' },
        { name: 'Cancel', value: 'cancel' },
      ],
    }]);
    action = answer.action;
  }

  if (action === 'apply') {
    if (pipelineOpts.dryRun) {
      printInfo('Dry run: no files were modified.');
      jsonOutput('refactor_extract_result', { success: true, dryRun: true });
      return;
    }

    try {
      createBackup(filePath);
      printInfo(`Backup saved.`);
    } catch (backupErr: any) {
      printWarning(`Backup skipped: ${backupErr.message}`);
    }

    writeFileContent(filePath, modifiedContent);
    printSuccess(`Extracted function "${functionName}" in ${file.fileName}`);
    jsonOutput('refactor_extract_result', { success: true, file: file.resolvedPath });
  } else {
    printInfo('Extraction cancelled. File unchanged.');
  }

  console.log();
}

// ─── Simplify Refactor ───────────────────────────────────────────────────────

async function handleSimplify(filePath: string): Promise<void> {
  const file = readAndValidateFile(filePath);
  if (!file) {
    process.exit(1);
  }

  console.log(commandHeader('Orion Refactor: Simplify', [
    ['File', colors.file(file.resolvedPath)],
    ['Language', `${file.language} \u00B7 ${file.lineCount} lines`],
  ]));

  const spinner = startSpinner('Analyzing complexity...');

  const userMessage =
    `Simplify the following ${file.language} file. Reduce complexity and improve readability.\n\n` +
    `File: ${file.fileName}\n\n\`\`\`${file.language}\n${file.content}\n\`\`\``;

  const projectContext = loadProjectContext();
  const fullPrompt = projectContext
    ? SIMPLIFY_SYSTEM_PROMPT + '\n\nProject context:\n' + projectContext
    : SIMPLIFY_SYSTEM_PROMPT;

  const { callbacks, getResponse } = createSilentStreamHandler(spinner, 'Simplification complete');

  await askAI(fullPrompt, userMessage, callbacks, { requireComplete: true });

  const fullResponse = getResponse();
  const parts = fullResponse.split('---REFACTORED---');
  const analysis = parts[0]?.trim() || '';
  let simplifiedContent = parts[1]?.trim() || '';

  // Show simplifications found
  console.log();
  console.log(divider('Simplifications'));
  console.log();

  const analysisLines = analysis.split('\n');
  let simplifyCount = 0;

  for (const line of analysisLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[SIMPLIFY]')) {
      simplifyCount++;
      console.log(statusLine('\u2713' as any, palette.green(trimmed.replace('[SIMPLIFY] ', ''))));
    } else if (trimmed) {
      console.log(`  ${palette.dim(trimmed)}`);
    }
  }

  if (simplifyCount === 0) {
    console.log(statusLine('i' as any, 'No significant simplifications found.'));
  }

  // Clean up potential code fences
  if (simplifiedContent.startsWith('```')) {
    const lines = simplifiedContent.split('\n');
    lines.shift();
    if (lines[lines.length - 1]?.trim() === '```') {
      lines.pop();
    }
    simplifiedContent = lines.join('\n');
  }

  // Checked after removing fences: a reply of only a fence is an empty file.
  if (!simplifiedContent.trim()) {
    console.log();
    printInfo('No refactored code produced. The code may already be well-structured.');
    console.log();
    return;
  }

  const pipelineOpts = getPipelineOptions();

  if (!pipelineOpts.quiet) {
    console.log();
    console.log(diffBlock(file.content, simplifiedContent, file.fileName));
    console.log();
  }

  jsonOutput('refactor_simplify_preview', {
    file: file.resolvedPath,
    simplifications: simplifyCount,
  });

  // Confirm
  let action: string;
  if (pipelineOpts.yes) {
    action = 'apply';
  } else {
    const answer = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Apply simplified code?',
      choices: [
        { name: 'Apply changes', value: 'apply' },
        { name: 'Cancel', value: 'cancel' },
      ],
    }]);
    action = answer.action;
  }

  if (action === 'apply') {
    if (pipelineOpts.dryRun) {
      printInfo('Dry run: no files were modified.');
      jsonOutput('refactor_simplify_result', { success: true, dryRun: true });
      return;
    }

    try {
      createBackup(filePath);
      printInfo(`Backup saved.`);
    } catch (backupErr: any) {
      printWarning(`Backup skipped: ${backupErr.message}`);
    }

    writeFileContent(filePath, simplifiedContent);
    printSuccess(`Simplified: ${file.resolvedPath}`);
    jsonOutput('refactor_simplify_result', { success: true, file: file.resolvedPath, simplifications: simplifyCount });
  } else {
    printInfo('Simplification cancelled. File unchanged.');
  }

  console.log();
}

// ─── Unused Exports/Imports ──────────────────────────────────────────────────

async function handleUnused(targetPath: string): Promise<void> {
  const resolvedPath = path.resolve(targetPath);

  let scanDir: string;
  try {
    const stat = fs.statSync(resolvedPath);
    scanDir = stat.isDirectory() ? resolvedPath : path.dirname(resolvedPath);
  } catch {
    printError(`Path not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(commandHeader('Orion Refactor: Unused Exports/Imports', [
    ['Directory', colors.file(scanDir)],
  ]));

  const spinner = startSpinner('Collecting source files...');

  const sourceFiles = collectSourceFiles(scanDir, 100);

  if (sourceFiles.length === 0) {
    spinner.stop();
    console.log();
    printWarning('No source files found in the specified path.');
    console.log();
    return;
  }

  spinner.text = `Analyzing ${sourceFiles.length} file(s) for unused exports/imports...`;

  // Build context: all file contents
  const fileContents = sourceFiles.map(f => {
    const content = fs.readFileSync(f, 'utf-8');
    const relative = path.relative(scanDir, f);
    return `===FILE: ${relative}===\n${content}\n===END FILE===`;
  }).join('\n\n');

  const userMessage =
    `Analyze the following ${sourceFiles.length} files for unused exports, unused imports, and dead code.\n\n${fileContents}`;

  const projectContext = loadProjectContext();
  const fullPrompt = projectContext
    ? UNUSED_SYSTEM_PROMPT + '\n\nProject context:\n' + projectContext
    : UNUSED_SYSTEM_PROMPT;

  const { callbacks, getResponse } = createSilentStreamHandler(spinner, 'Analysis complete');

  await askAI(fullPrompt, userMessage, callbacks);

  const response = getResponse();

  // Parse and display results
  console.log();
  console.log(divider('Unused Code Analysis'));
  console.log();

  const lines = response.split('\n');
  let unusedExports = 0;
  let unusedImports = 0;
  let deadCode = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[UNUSED EXPORT]')) {
      unusedExports++;
      console.log(statusLine('!' as any, palette.yellow(trimmed.replace('[UNUSED EXPORT] ', ''))));
    } else if (trimmed.startsWith('[UNUSED IMPORT]')) {
      unusedImports++;
      console.log(statusLine('!' as any, palette.orange(trimmed.replace('[UNUSED IMPORT] ', ''))));
    } else if (trimmed.startsWith('[DEAD CODE]')) {
      deadCode++;
      console.log(statusLine('\u2717' as any, palette.red(trimmed.replace('[DEAD CODE] ', ''))));
    } else if (trimmed) {
      console.log(`  ${palette.dim(trimmed)}`);
    }
  }

  console.log();
  console.log(
    `  Summary: ${palette.yellow(`${unusedExports} unused exports`)} | ` +
    `${palette.orange(`${unusedImports} unused imports`)} | ` +
    `${palette.red(`${deadCode} dead code blocks`)}`
  );
  console.log();

  jsonOutput('refactor_unused', {
    directory: scanDir,
    filesScanned: sourceFiles.length,
    unusedExports,
    unusedImports,
    deadCode,
  });
}

// ─── Main Refactor Command ───────────────────────────────────────────────────

export interface RefactorCommandOptions {
  rename?: string[];
  extract?: string;
  simplify?: boolean;
  unused?: boolean;
}

export async function refactorCommand(
  targetPath: string,
  options: RefactorCommandOptions,
): Promise<void> {
  try {
    if (options.rename && options.rename.length === 2) {
      const [oldName, newName] = options.rename;
      await handleRename(targetPath, oldName, newName);
    } else if (options.rename) {
      printError('--rename requires exactly two arguments: --rename <oldName> <newName>');
      printInfo('Example: orion refactor src/utils.ts --rename oldFunc newFunc');
      console.log();
      process.exit(1);
    } else if (options.extract) {
      await handleExtract(targetPath, options.extract);
    } else if (options.simplify) {
      await handleSimplify(targetPath);
    } else if (options.unused) {
      await handleUnused(targetPath);
    } else {
      console.log(commandHeader('Orion Refactor'));
      console.log();
      console.log(`  ${palette.dim('Usage:')}`);
      console.log(`    ${colors.command('orion refactor')} ${palette.dim('<file|dir>')} ${palette.dim('--rename <old> <new>')}`);
      console.log(`    ${colors.command('orion refactor')} ${palette.dim('<file>')} ${palette.dim('--extract <functionName>')}`);
      console.log(`    ${colors.command('orion refactor')} ${palette.dim('<file>')} ${palette.dim('--simplify')}`);
      console.log(`    ${colors.command('orion refactor')} ${palette.dim('<dir>')} ${palette.dim('--unused')}`);
      console.log();
      console.log(`  ${palette.dim('Examples:')}`);
      console.log(`    ${palette.dim('orion refactor src/utils.ts --rename oldFunc newFunc')}`);
      console.log(`    ${palette.dim('orion refactor src/auth.ts --extract handleLogin')}`);
      console.log(`    ${palette.dim('orion refactor src/app.ts --simplify')}`);
      console.log(`    ${palette.dim('orion refactor src/ --unused')}`);
      console.log();
      process.exit(1);
    }
  } catch (err: any) {
    printCommandError(err, 'refactor', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}
