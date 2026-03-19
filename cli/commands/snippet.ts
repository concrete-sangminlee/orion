/**
 * Orion CLI - Code Snippet Manager Command
 * Save, list, search, use, and AI-generate code snippets.
 * Snippets are stored in ~/.orion/snippets/ as JSON files.
 *
 * Usage:
 *   orion snippet save "auth middleware" --file src/auth.ts --lines 10-25
 *   orion snippet list                     # List saved snippets
 *   orion snippet search "auth"            # Search snippets
 *   orion snippet use "auth middleware"     # Output snippet to stdout
 *   orion snippet generate "Express error handler"  # AI generates snippet
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { askAI } from '../ai-client.js';
import {
  colors,
  startSpinner,
  stopSpinner,
  detectLanguage,
  loadProjectContext,
  ensureConfigDir,
} from '../utils.js';
import { printCommandError } from '../shared.js';
import { commandHeader, statusLine, badge, divider, palette, table as uiTable, truncate, timeAgo } from '../ui.js';
import { renderMarkdown } from '../markdown.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const SNIPPETS_DIR = path.join(os.homedir(), '.orion', 'snippets');

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Snippet {
  id: string;
  name: string;
  description?: string;
  language: string;
  code: string;
  tags: string[];
  sourceFile?: string;
  sourceLines?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SnippetOptions {
  file?: string;
  lines?: string;
  tag?: string;
}

// ─── Snippet Storage ────────────────────────────────────────────────────────

function ensureSnippetsDir(): void {
  ensureConfigDir();
  if (!fs.existsSync(SNIPPETS_DIR)) {
    fs.mkdirSync(SNIPPETS_DIR, { recursive: true });
  }
}

function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

function getSnippetPath(id: string): string {
  return path.join(SNIPPETS_DIR, `${id}.json`);
}

function saveSnippet(snippet: Snippet): void {
  ensureSnippetsDir();
  const filePath = getSnippetPath(snippet.id);
  fs.writeFileSync(filePath, JSON.stringify(snippet, null, 2), 'utf-8');
}

function loadSnippet(id: string): Snippet | null {
  const filePath = getSnippetPath(id);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Snippet;
  } catch {
    return null;
  }
}

function loadAllSnippets(): Snippet[] {
  ensureSnippetsDir();
  const snippets: Snippet[] = [];

  try {
    const files = fs.readdirSync(SNIPPETS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(SNIPPETS_DIR, file), 'utf-8');
        snippets.push(JSON.parse(content) as Snippet);
      } catch { /* skip corrupt files */ }
    }
  } catch { /* directory not readable */ }

  // Sort by updatedAt descending
  snippets.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return snippets;
}

function deleteSnippet(id: string): boolean {
  const filePath = getSnippetPath(id);
  if (!fs.existsSync(filePath)) return false;
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// ─── Line Range Parser ──────────────────────────────────────────────────────

function parseLineRange(lines: string): { start: number; end: number } | null {
  const match = lines.match(/^(\d+)-(\d+)$/);
  if (match) {
    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);
    if (start > 0 && end >= start) {
      return { start, end };
    }
  }

  // Single line
  const single = parseInt(lines, 10);
  if (!isNaN(single) && single > 0) {
    return { start: single, end: single };
  }

  return null;
}

function extractLines(content: string, range: { start: number; end: number }): string {
  const lines = content.split(/\r?\n/);
  const startIdx = Math.max(0, range.start - 1);
  const endIdx = Math.min(lines.length, range.end);
  return lines.slice(startIdx, endIdx).join('\n');
}

// ─── AI Snippet Generation ──────────────────────────────────────────────────

const GENERATE_SYSTEM_PROMPT = `You are Orion, an expert programmer who creates high-quality, production-ready code snippets.

When asked to generate a code snippet:
1. Write clean, well-documented code
2. Follow best practices for the language/framework
3. Include proper error handling
4. Add helpful comments explaining key decisions
5. Make the code immediately usable (no placeholders like "your logic here")

Output ONLY the code block in the appropriate language. Do not add explanatory text before or after.
Use proper indentation and formatting.`;

// ─── Subcommands ────────────────────────────────────────────────────────────

async function saveAction(name: string, options: SnippetOptions): Promise<void> {
  if (!options.file) {
    console.log();
    console.log(`  ${colors.error('--file is required for save.')}`);
    console.log(`  ${palette.dim('Usage: orion snippet save "name" --file src/auth.ts --lines 10-25')}`);
    console.log();
    process.exit(1);
  }

  const resolvedFile = path.resolve(options.file);
  if (!fs.existsSync(resolvedFile)) {
    console.log();
    console.log(`  ${colors.error('File not found:')} ${resolvedFile}`);
    console.log();
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(resolvedFile, 'utf-8');
  } catch (err: any) {
    console.log();
    console.log(`  ${colors.error('Cannot read file:')} ${err.message}`);
    console.log();
    return;
  }

  // Extract specified lines or use entire file
  let code = content;
  let sourceLines: string | undefined;

  if (options.lines) {
    const range = parseLineRange(options.lines);
    if (!range) {
      console.log();
      console.log(`  ${colors.error('Invalid line range:')} ${options.lines}`);
      console.log(`  ${palette.dim('Use format: 10-25 or 42')}`);
      console.log();
      return;
    }
    code = extractLines(content, range);
    sourceLines = options.lines;
  }

  const language = detectLanguage(resolvedFile);
  const id = nameToId(name);
  const now = new Date().toISOString();

  const tags: string[] = [language];
  if (options.tag) {
    tags.push(...options.tag.split(',').map(t => t.trim()).filter(Boolean));
  }

  const snippet: Snippet = {
    id,
    name,
    language,
    code,
    tags,
    sourceFile: path.relative(process.cwd(), resolvedFile),
    sourceLines,
    createdAt: now,
    updatedAt: now,
  };

  saveSnippet(snippet);

  console.log(commandHeader('Orion Snippet Manager', [
    ['Action', 'Save'],
  ]));

  console.log(statusLine('\u2713', palette.green(`Snippet saved: "${name}"`)));
  console.log(`    ${palette.dim('ID:')} ${id}`);
  console.log(`    ${palette.dim('Language:')} ${language}`);
  console.log(`    ${palette.dim('Source:')} ${snippet.sourceFile}${sourceLines ? ` (lines ${sourceLines})` : ''}`);
  console.log(`    ${palette.dim('Lines:')} ${code.split('\n').length}`);
  console.log(`    ${palette.dim('Stored in:')} ${getSnippetPath(id)}`);
  console.log();
}

async function listAction(): Promise<void> {
  console.log(commandHeader('Orion Snippet Manager', [
    ['Action', 'List'],
    ['Store', SNIPPETS_DIR],
  ]));

  const snippets = loadAllSnippets();

  if (snippets.length === 0) {
    console.log(statusLine('i', palette.dim('No snippets saved yet.')));
    console.log(`  ${palette.dim('Use: orion snippet save "name" --file <file> --lines 10-25')}`);
    console.log(`  ${palette.dim(' or: orion snippet generate "Express error handler"')}`);
    console.log();
    return;
  }

  const headers = ['Name', 'Language', 'Lines', 'Tags', 'Updated'];
  const rows: string[][] = [];

  for (const s of snippets) {
    const lineCount = s.code.split('\n').length;
    const updated = timeAgo(new Date(s.updatedAt));
    rows.push([
      truncate(s.name, 30),
      s.language,
      String(lineCount),
      s.tags.join(', '),
      updated,
    ]);
  }

  console.log(uiTable(headers, rows));
  console.log();
  console.log(`  ${palette.dim(`${snippets.length} snippet(s) total`)}`);
  console.log();
}

async function searchAction(query: string): Promise<void> {
  console.log(commandHeader('Orion Snippet Manager', [
    ['Action', 'Search'],
    ['Query', `"${query}"`],
  ]));

  const snippets = loadAllSnippets();
  const lowerQuery = query.toLowerCase();

  const matches = snippets.filter(s =>
    s.name.toLowerCase().includes(lowerQuery) ||
    s.code.toLowerCase().includes(lowerQuery) ||
    s.tags.some(t => t.toLowerCase().includes(lowerQuery)) ||
    (s.description && s.description.toLowerCase().includes(lowerQuery)) ||
    (s.sourceFile && s.sourceFile.toLowerCase().includes(lowerQuery))
  );

  if (matches.length === 0) {
    console.log(statusLine('i', palette.dim(`No snippets matching "${query}"`)));
    console.log(`  ${palette.dim('Try a different search term or list all with: orion snippet list')}`);
    console.log();
    return;
  }

  console.log(statusLine('\u2713', palette.green(`Found ${matches.length} matching snippet(s)`)));
  console.log();

  for (const s of matches) {
    const lineCount = s.code.split('\n').length;
    console.log(`  ${palette.violet.bold(s.name)} ${palette.dim(`(${s.language}, ${lineCount} lines)`)}`);
    if (s.sourceFile) {
      console.log(`    ${palette.dim('Source:')} ${s.sourceFile}${s.sourceLines ? ` lines ${s.sourceLines}` : ''}`);
    }
    console.log(`    ${palette.dim('Tags:')} ${s.tags.join(', ')}`);

    // Show first 3 lines of code as preview
    const previewLines = s.code.split('\n').slice(0, 3);
    for (const line of previewLines) {
      console.log(`    ${palette.dim('|')} ${palette.dim(line.substring(0, 80))}`);
    }
    if (s.code.split('\n').length > 3) {
      console.log(`    ${palette.dim('| ...')}`);
    }
    console.log();
  }
}

async function useAction(name: string): Promise<void> {
  const id = nameToId(name);
  let snippet = loadSnippet(id);

  // If not found by ID, try searching by name
  if (!snippet) {
    const all = loadAllSnippets();
    snippet = all.find(s => s.name.toLowerCase() === name.toLowerCase()) || null;
  }

  if (!snippet) {
    console.log();
    console.log(`  ${colors.error('Snippet not found:')} "${name}"`);
    console.log(`  ${palette.dim('Run `orion snippet list` to see available snippets.')}`);
    console.log();
    return;
  }

  // Output code to stdout (for piping)
  process.stdout.write(snippet.code);

  // If stdout is a TTY, add some formatting
  if (process.stdout.isTTY) {
    console.log();
    console.log();
    console.log(`  ${palette.dim('---')}`);
    console.log(statusLine('i', palette.dim(`Snippet: ${snippet.name} (${snippet.language}, ${snippet.code.split('\n').length} lines)`)));
    console.log();
  }
}

async function generateAction(description: string): Promise<void> {
  console.log(commandHeader('Orion Snippet Manager', [
    ['Action', 'Generate'],
    ['Description', `"${description}"`],
  ]));

  const projectContext = loadProjectContext();
  const fullSystemPrompt = projectContext
    ? GENERATE_SYSTEM_PROMPT + '\n\nProject context:\n' + projectContext
    : GENERATE_SYSTEM_PROMPT;

  const userMessage = `Generate a production-ready code snippet for: ${description}

Consider the project context and use appropriate language/framework conventions.
Output ONLY the code, wrapped in a markdown code block with the language specified.`;

  const aiSpinner = startSpinner('Generating snippet with AI...');

  try {
    let generatedCode = '';

    await askAI(fullSystemPrompt, userMessage, {
      onToken(token: string) {
        generatedCode += token;
      },
      onComplete(text: string) {
        stopSpinner(aiSpinner);

        // Extract code from markdown code block
        const codeMatch = text.match(/```(\w+)?\n([\s\S]*?)```/);
        const language = codeMatch?.[1] || 'text';
        const code = codeMatch?.[2]?.trim() || text.trim();

        console.log();
        console.log(renderMarkdown(text));
        console.log();

        // Auto-save the generated snippet
        const id = nameToId(description);
        const now = new Date().toISOString();

        const snippet: Snippet = {
          id,
          name: description,
          description: `AI-generated: ${description}`,
          language,
          code,
          tags: [language, 'ai-generated'],
          createdAt: now,
          updatedAt: now,
        };

        saveSnippet(snippet);

        console.log(statusLine('\u2713', palette.green(`Snippet auto-saved as "${description}"`)));
        console.log(`    ${palette.dim('ID:')} ${id}`);
        console.log(`    ${palette.dim('Use:')} orion snippet use "${description}"`);
        console.log();
      },
      onError(error: Error) {
        stopSpinner(aiSpinner, error.message, false);
      },
    });
  } catch (err: any) {
    stopSpinner(aiSpinner, err.message, false);
    printCommandError(err, 'snippet generate', 'Run `orion config` to check your AI provider settings.');
  }
}

async function deleteAction(name: string): Promise<void> {
  const id = nameToId(name);
  let found = loadSnippet(id);

  if (!found) {
    const all = loadAllSnippets();
    found = all.find(s => s.name.toLowerCase() === name.toLowerCase()) || null;
    if (found) {
      deleteSnippet(found.id);
    }
  } else {
    deleteSnippet(id);
  }

  if (found) {
    console.log();
    console.log(statusLine('\u2713', palette.green(`Deleted snippet: "${found.name}"`)));
    console.log();
  } else {
    console.log();
    console.log(`  ${colors.error('Snippet not found:')} "${name}"`);
    console.log(`  ${palette.dim('Run `orion snippet list` to see available snippets.')}`);
    console.log();
  }
}

// ─── Command Entry Point ────────────────────────────────────────────────────

export async function snippetCommand(
  action: string,
  nameOrQuery?: string,
  options: SnippetOptions = {}
): Promise<void> {
  switch (action) {
    case 'save':
      if (!nameOrQuery) {
        console.log();
        console.log(`  ${colors.error('Snippet name is required.')}`);
        console.log(`  ${palette.dim('Usage: orion snippet save "auth middleware" --file src/auth.ts --lines 10-25')}`);
        console.log();
        process.exit(1);
      }
      await saveAction(nameOrQuery, options);
      break;

    case 'list':
    case 'ls':
      await listAction();
      break;

    case 'search':
    case 'find':
      if (!nameOrQuery) {
        console.log();
        console.log(`  ${colors.error('Search query is required.')}`);
        console.log(`  ${palette.dim('Usage: orion snippet search "auth"')}`);
        console.log();
        process.exit(1);
      }
      await searchAction(nameOrQuery);
      break;

    case 'use':
    case 'get':
      if (!nameOrQuery) {
        console.log();
        console.log(`  ${colors.error('Snippet name is required.')}`);
        console.log(`  ${palette.dim('Usage: orion snippet use "auth middleware"')}`);
        console.log();
        process.exit(1);
      }
      await useAction(nameOrQuery);
      break;

    case 'generate':
    case 'gen':
      if (!nameOrQuery) {
        console.log();
        console.log(`  ${colors.error('Description is required.')}`);
        console.log(`  ${palette.dim('Usage: orion snippet generate "Express error handler"')}`);
        console.log();
        process.exit(1);
      }
      await generateAction(nameOrQuery);
      break;

    case 'delete':
    case 'rm':
      if (!nameOrQuery) {
        console.log();
        console.log(`  ${colors.error('Snippet name is required.')}`);
        console.log(`  ${palette.dim('Usage: orion snippet delete "auth middleware"')}`);
        console.log();
        process.exit(1);
      }
      await deleteAction(nameOrQuery);
      break;

    default:
      console.log();
      console.log(`  ${colors.error('Unknown action:')} "${action}"`);
      console.log();
      console.log(`  ${palette.violet.bold('Available actions:')}`);
      console.log(`    ${palette.dim('save')}       Save code from a file as a snippet`);
      console.log(`    ${palette.dim('list')}       List all saved snippets`);
      console.log(`    ${palette.dim('search')}     Search snippets by keyword`);
      console.log(`    ${palette.dim('use')}        Output a snippet to stdout`);
      console.log(`    ${palette.dim('generate')}   AI-generate a new snippet`);
      console.log(`    ${palette.dim('delete')}     Delete a saved snippet`);
      console.log();
      console.log(`  ${palette.dim('Example: orion snippet save "auth middleware" --file src/auth.ts --lines 10-25')}`);
      console.log();
      process.exit(1);
  }
}
