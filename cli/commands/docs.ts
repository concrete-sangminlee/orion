/**
 * Orion CLI - AI-Powered Documentation Generator
 * Generates JSDoc/docstrings, README files, and API documentation.
 *
 * Usage:
 *   orion docs src/api.ts               # Generate JSDoc/docstrings
 *   orion docs src/ --readme            # Generate README for a directory
 *   orion docs src/app.ts --api         # Generate API documentation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { askAI } from '../ai-client.js';
import {
  colors,
  startSpinner,
  stopSpinner,
  loadProjectContext,
  writeFileContent,
} from '../utils.js';
import {
  createStreamHandler,
  createSilentStreamHandler,
  readAndValidateFile,
  printCommandError,
} from '../shared.js';
import { readStdin } from '../stdin.js';
import { commandHeader, badge, divider, box, palette } from '../ui.js';
import { renderMarkdown } from '../markdown.js';

// ─── System Prompts ──────────────────────────────────────────────────────────

const DOCS_JSDOC_PROMPT = `You are Orion, an expert documentation writer. Generate comprehensive inline documentation for the provided source code.

Rules:
- Add JSDoc (/** ... */) for TypeScript/JavaScript, docstrings for Python, doc comments for Rust/Go/Java
- Document every exported function, class, interface, type, and constant
- Include @param, @returns, @throws, @example tags where appropriate
- Add brief module-level documentation at the top
- Keep descriptions concise but complete
- Preserve the original code exactly; only add documentation comments
- Use the language's idiomatic documentation style

Output the COMPLETE file with documentation added. Do not omit any original code.
Wrap the output in a single code block with the appropriate language tag.`;

const DOCS_README_PROMPT = `You are Orion, an expert technical writer. Generate a comprehensive README.md for the project based on the provided file listing and source files.

Include these sections:
# Project Name

## Overview
Brief description of what the project does.

## Features
- Key features as bullet points

## Installation
\`\`\`bash
# Installation commands
\`\`\`

## Usage
\`\`\`bash
# Usage examples
\`\`\`

## Project Structure
\`\`\`
directory/
  file.ts        # description
  ...
\`\`\`

## API Reference
Brief overview of main exports/endpoints.

## Configuration
Document configuration options if applicable.

## Contributing
Basic contribution guidelines.

## License
License information if detectable.

Make it professional, clear, and well-structured. Use markdown formatting.
Infer project details from the source code, package.json, config files, etc.`;

const DOCS_API_PROMPT = `You are Orion, an expert API documentation writer. Generate comprehensive API documentation for the provided source code.

Structure the documentation as:

# API Documentation

## Overview
Brief description of the API module.

## Endpoints / Functions

For each exported function, class, or API endpoint:

### \`functionName(params)\`
**Description:** What it does.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| param1 | string | Yes | Description |

**Returns:** \`ReturnType\` - Description

**Throws:**
- \`ErrorType\` - When this happens

**Example:**
\`\`\`typescript
// Usage example
\`\`\`

---

## Types / Interfaces

For each exported type:
### \`TypeName\`
\`\`\`typescript
interface TypeName { ... }
\`\`\`
Description of the type and its fields.

## Error Handling
Document error patterns and common error codes.

## Rate Limits / Constraints
Document any limits or constraints if applicable.

Use markdown formatting. Be thorough and precise with types.`;

// ─── Directory Scanner ───────────────────────────────────────────────────────

interface ScannedFile {
  relativePath: string;
  absolutePath: string;
  language: string;
  size: number;
}

function scanDirectory(dirPath: string): { files: ScannedFile[]; tree: string } {
  const resolvedDir = path.resolve(dirPath);
  const ignorePatterns = ['node_modules', 'dist', 'build', '.git', '__pycache__', '.next', '.orion', 'coverage', '.cache'];
  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.rb', '.php', '.swift', '.kt'];

  const files: ScannedFile[] = [];
  const treeLines: string[] = [];

  function walk(dir: string, prefix: string, depth: number): void {
    if (depth > 4) return;
    if (files.length >= 50) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort: directories first, then files
    const sorted = entries
      .filter(e => !ignorePatterns.includes(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i];
      const isLast = i === sorted.length - 1;
      const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
      const childPrefix = isLast ? '    ' : '\u2502   ';
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        treeLines.push(prefix + connector + entry.name + '/');
        walk(fullPath, prefix + childPrefix, depth + 1);
      } else {
        treeLines.push(prefix + connector + entry.name);
        const ext = path.extname(entry.name).toLowerCase();
        if (codeExtensions.includes(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size <= 512 * 1024) { // Max 512KB per file
              files.push({
                relativePath: path.relative(resolvedDir, fullPath),
                absolutePath: fullPath,
                language: ext.replace('.', ''),
                size: stat.size,
              });
            }
          } catch { /* skip */ }
        }
      }
    }
  }

  const dirName = path.basename(resolvedDir);
  treeLines.push(dirName + '/');
  walk(resolvedDir, '', 0);

  return { files, tree: treeLines.join('\n') };
}

// ─── User Confirmation ───────────────────────────────────────────────────────

async function confirmWrite(targetPath: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  return new Promise((resolve) => {
    const exists = fs.existsSync(targetPath);
    const prompt = exists
      ? `  ${palette.yellow('!')} File exists: ${colors.file(targetPath)}\n  Overwrite? (y/N): `
      : `  Write to ${colors.file(targetPath)}? (y/N): `;

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ─── Command Modes ───────────────────────────────────────────────────────────

async function generateJSDoc(filePath: string): Promise<void> {
  const file = readAndValidateFile(filePath);
  if (!file) {
    process.exit(1);
  }

  console.log(commandHeader('Orion Documentation Generator', [
    ['File', colors.file(file.resolvedPath)],
    ['Language', `${file.language} \u00B7 ${file.lineCount} lines`],
    ['Mode', 'Inline Documentation'],
  ]));
  console.log();

  const spinner = startSpinner('Generating documentation...');

  try {
    const projectContext = loadProjectContext();
    const fullSystemPrompt = projectContext
      ? DOCS_JSDOC_PROMPT + '\n\nProject context:\n' + projectContext
      : DOCS_JSDOC_PROMPT;

    const userMessage = `Add comprehensive documentation to this ${file.language} file (${file.fileName}):\n\n\`\`\`${file.language}\n${file.content}\n\`\`\``;

    const { callbacks, getResponse } = createSilentStreamHandler(spinner, 'Documentation generated');

    await askAI(fullSystemPrompt, userMessage, callbacks);

    const response = getResponse();

    // Extract code from response
    const codeMatch = response.match(/```[\w]*\n([\s\S]*?)```/);
    const documentedCode = codeMatch ? codeMatch[1].trimEnd() + '\n' : response;

    // Show preview
    console.log();
    console.log(`  ${palette.violet.bold('Preview:')}`);
    console.log(divider());
    console.log(renderMarkdown('```' + file.language + '\n' + documentedCode.substring(0, 2000) + (documentedCode.length > 2000 ? '\n// ... (truncated)' : '') + '\n```'));
    console.log(divider());

    // Confirm write
    const shouldWrite = await confirmWrite(file.resolvedPath);

    if (shouldWrite) {
      writeFileContent(file.resolvedPath, documentedCode);
      console.log(`  ${palette.green('\u2713')} Documentation written to ${colors.file(file.resolvedPath)}`);
    } else {
      console.log(`  ${palette.dim('Skipped. No changes written.')}`);
    }

    console.log();
  } catch (err: any) {
    printCommandError(err, 'docs', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}

async function generateReadme(dirPath: string): Promise<void> {
  const resolvedDir = path.resolve(dirPath);

  if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
    console.log();
    console.log(`  ${colors.error('Directory not found: ' + resolvedDir)}`);
    console.log(`  ${palette.dim('Provide a valid directory path.')}`);
    console.log();
    process.exit(1);
  }

  console.log(commandHeader('Orion Documentation Generator', [
    ['Directory', colors.file(resolvedDir)],
    ['Mode', 'README Generation'],
  ]));
  console.log();

  const spinner = startSpinner('Scanning directory structure...');

  const { files, tree } = scanDirectory(resolvedDir);

  stopSpinner(spinner, `Found ${files.length} source file(s)`);
  console.log();

  // Read a sample of files for context (up to 5 files, prioritize entry points)
  const priorityNames = ['index', 'main', 'app', 'server', 'mod', 'lib'];
  const sortedFiles = [...files].sort((a, b) => {
    const aName = path.basename(a.relativePath, path.extname(a.relativePath)).toLowerCase();
    const bName = path.basename(b.relativePath, path.extname(b.relativePath)).toLowerCase();
    const aPriority = priorityNames.findIndex(p => aName.includes(p));
    const bPriority = priorityNames.findIndex(p => bName.includes(p));
    if (aPriority >= 0 && bPriority < 0) return -1;
    if (aPriority < 0 && bPriority >= 0) return 1;
    return a.size - b.size; // smaller files first
  });

  const sampleFiles: { path: string; content: string }[] = [];
  let totalSize = 0;

  for (const f of sortedFiles.slice(0, 8)) {
    if (totalSize > 30000) break; // Limit total context
    try {
      const content = fs.readFileSync(f.absolutePath, 'utf-8');
      sampleFiles.push({ path: f.relativePath, content });
      totalSize += content.length;
    } catch { /* skip */ }
  }

  // Also read package.json if it exists
  const pkgPath = path.join(resolvedDir, 'package.json');
  let pkgContent = '';
  if (fs.existsSync(pkgPath)) {
    try {
      pkgContent = fs.readFileSync(pkgPath, 'utf-8');
    } catch { /* skip */ }
  }

  const spinner2 = startSpinner('Generating README...');

  try {
    const projectContext = loadProjectContext();
    const fullSystemPrompt = projectContext
      ? DOCS_README_PROMPT + '\n\nProject context:\n' + projectContext
      : DOCS_README_PROMPT;

    let userMessage = `Generate a README.md for this project.\n\n`;
    userMessage += `## Directory Structure\n\`\`\`\n${tree}\n\`\`\`\n\n`;

    if (pkgContent) {
      userMessage += `## package.json\n\`\`\`json\n${pkgContent}\n\`\`\`\n\n`;
    }

    userMessage += `## Source Files\n\n`;
    for (const f of sampleFiles) {
      const ext = path.extname(f.path).replace('.', '');
      userMessage += `### ${f.path}\n\`\`\`${ext}\n${f.content}\n\`\`\`\n\n`;
    }

    const { callbacks, getResponse } = createSilentStreamHandler(spinner2, 'README generated');

    await askAI(fullSystemPrompt, userMessage, callbacks);

    const readmeContent = getResponse();

    // Show preview
    console.log();
    console.log(`  ${palette.violet.bold('Preview:')}`);
    console.log(divider());
    console.log(renderMarkdown(readmeContent.substring(0, 3000) + (readmeContent.length > 3000 ? '\n\n*... (truncated)*' : '')));
    console.log(divider());

    // Confirm write
    const targetPath = path.join(resolvedDir, 'README.md');
    const shouldWrite = await confirmWrite(targetPath);

    if (shouldWrite) {
      writeFileContent(targetPath, readmeContent);
      console.log(`  ${palette.green('\u2713')} README written to ${colors.file(targetPath)}`);
    } else {
      console.log(`  ${palette.dim('Skipped. No changes written.')}`);
    }

    console.log();
  } catch (err: any) {
    printCommandError(err, 'docs', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}

async function generateApiDocs(filePath: string): Promise<void> {
  const file = readAndValidateFile(filePath);
  if (!file) {
    process.exit(1);
  }

  console.log(commandHeader('Orion Documentation Generator', [
    ['File', colors.file(file.resolvedPath)],
    ['Language', `${file.language} \u00B7 ${file.lineCount} lines`],
    ['Mode', 'API Documentation'],
  ]));
  console.log();

  const spinner = startSpinner('Generating API documentation...');

  const { callbacks } = createStreamHandler(spinner, {
    markdown: true,
  });

  try {
    const projectContext = loadProjectContext();
    const fullSystemPrompt = projectContext
      ? DOCS_API_PROMPT + '\n\nProject context:\n' + projectContext
      : DOCS_API_PROMPT;

    const userMessage = `Generate API documentation for this ${file.language} file (${file.fileName}):\n\n\`\`\`${file.language}\n${file.content}\n\`\`\``;

    await askAI(fullSystemPrompt, userMessage, callbacks);
    console.log();
  } catch (err: any) {
    printCommandError(err, 'docs', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}

// ─── Exported Command ────────────────────────────────────────────────────────

export async function docsCommand(
  target?: string,
  options?: { readme?: boolean; api?: boolean }
): Promise<void> {
  if (options?.readme) {
    // README generation for a directory
    const dirPath = target || '.';
    await generateReadme(dirPath);
  } else if (options?.api && target) {
    // API documentation for a file
    await generateApiDocs(target);
  } else if (target) {
    // Check if target is a directory or file
    const resolvedTarget = path.resolve(target);
    if (fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isDirectory()) {
      // If it's a directory, default to README generation
      await generateReadme(target);
    } else {
      // It's a file - generate inline documentation
      await generateJSDoc(target);
    }
  } else {
    // Check for piped input
    const stdinData = await readStdin();
    if (stdinData) {
      // Treat piped input as a file to document
      console.log(commandHeader('Orion Documentation Generator', [
        ['Source', 'piped input'],
        ['Lines', String(stdinData.split('\n').length)],
        ['Mode', 'Inline Documentation'],
      ]));
      console.log();

      const spinner = startSpinner('Generating documentation...');

      const { callbacks } = createStreamHandler(spinner, {
        markdown: true,
      });

      try {
        await askAI(DOCS_JSDOC_PROMPT, `Add comprehensive documentation to this code:\n\n\`\`\`\n${stdinData}\n\`\`\``, callbacks);
        console.log();
      } catch (err: any) {
        printCommandError(err, 'docs', 'Run `orion config` to check your AI provider settings.');
        process.exit(1);
      }
    } else {
      console.log();
      console.log(`  ${colors.error('Please provide a file or directory path.')}`);
      console.log();
      console.log(`  ${palette.violet.bold('Usage:')}`);
      console.log(`  ${palette.dim('  orion docs src/api.ts               # Generate JSDoc/docstrings')}`);
      console.log(`  ${palette.dim('  orion docs src/ --readme            # Generate README for a directory')}`);
      console.log(`  ${palette.dim('  orion docs src/app.ts --api         # Generate API documentation')}`);
      console.log(`  ${palette.dim('  cat file.ts | orion docs            # Pipe content for documentation')}`);
      console.log();
      process.exit(1);
    }
  }
}
