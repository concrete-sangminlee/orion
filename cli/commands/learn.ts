/**
 * Orion CLI - Learn Command
 * Analyzes codebase patterns and generates .orion/patterns.md
 * This document is auto-injected into all future AI prompts for improved accuracy.
 *
 * Detects: indentation style, naming conventions, framework patterns,
 * error handling patterns, common imports, architecture layout.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { askAI } from '../ai-client.js';
import {
  colors,
  printHeader,
  printInfo,
  printSuccess,
  printWarning,
  printError,
  startSpinner,
  stopSpinner,
  getCurrentDirectoryContext,
  loadProjectContext,
} from '../utils.js';
import { commandHeader, divider, statusLine, palette } from '../ui.js';
import { renderMarkdown } from '../markdown.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LearnOptions {
  update?: boolean;
  auto?: boolean;
}

interface PatternScan {
  indentation: 'tabs' | 'spaces-2' | 'spaces-4' | 'mixed' | 'unknown';
  naming: ('camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case' | 'SCREAMING_SNAKE')[];
  frameworks: string[];
  errorPatterns: string[];
  commonImports: string[];
  fileStructure: string[];
  languageBreakdown: Record<string, number>;
  sampleFiles: { path: string; content: string; language: string }[];
}

// ─── File Scanning ──────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.orion', 'dist', 'build', 'out', '.next',
  '.nuxt', '.svelte-kit', 'coverage', '__pycache__', '.venv', 'venv',
  'vendor', '.cache', '.turbo', '.parcel-cache', 'target', 'bin', 'obj',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
  '.c', '.cpp', '.h', '.hpp', '.cs',
  '.vue', '.svelte', '.astro',
  '.css', '.scss', '.less', '.sass',
  '.json', '.yaml', '.yml', '.toml',
  '.sh', '.bash', '.zsh',
  '.sql', '.graphql', '.gql',
  '.md', '.mdx',
]);

const MAX_FILES_TO_SCAN = 200;
const MAX_SAMPLE_FILES = 15;
const MAX_FILE_SIZE = 50 * 1024; // 50KB per file

function collectFiles(dir: string, files: string[] = [], depth = 0): string[] {
  if (depth > 8 || files.length >= MAX_FILES_TO_SCAN) return files;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (files.length >= MAX_FILES_TO_SCAN) break;

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        collectFiles(path.join(dir, entry.name), files, depth + 1);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (CODE_EXTENSIONS.has(ext)) {
        const fullPath = path.join(dir, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 0 && stat.size <= MAX_FILE_SIZE) {
            files.push(fullPath);
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  return files;
}

function detectIndentation(content: string): 'tabs' | 'spaces-2' | 'spaces-4' | 'mixed' | 'unknown' {
  const lines = content.split('\n').filter(l => l.length > 0 && /^\s+/.test(l));
  let tabs = 0;
  let spaces2 = 0;
  let spaces4 = 0;

  for (const line of lines.slice(0, 100)) {
    const match = line.match(/^(\s+)/);
    if (!match) continue;
    const ws = match[1];
    if (ws.includes('\t')) {
      tabs++;
    } else if (ws.length % 4 === 0) {
      spaces4++;
    } else if (ws.length % 2 === 0) {
      spaces2++;
    }
  }

  const total = tabs + spaces2 + spaces4;
  if (total === 0) return 'unknown';
  if (tabs > total * 0.6) return 'tabs';
  if (spaces4 > total * 0.5) return 'spaces-4';
  if (spaces2 > total * 0.5) return 'spaces-2';
  if (tabs > 0 && (spaces2 > 0 || spaces4 > 0)) return 'mixed';
  return 'spaces-2';
}

function detectNamingConventions(content: string): Set<string> {
  const conventions = new Set<string>();

  // Variable/function declarations
  const camelCase = /(?:let|const|var|function)\s+([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)/g;
  const snake_case = /(?:let|const|var|function|def)\s+([a-z][a-z0-9]*_[a-z0-9_]*)/g;
  const PascalCase = /(?:class|interface|type|enum|struct)\s+([A-Z][a-zA-Z0-9]+)/g;
  const SCREAMING = /(?:const|let|var)\s+([A-Z][A-Z0-9_]+)\s*=/g;

  if (camelCase.test(content)) conventions.add('camelCase');
  if (snake_case.test(content)) conventions.add('snake_case');
  if (PascalCase.test(content)) conventions.add('PascalCase');
  if (SCREAMING.test(content)) conventions.add('SCREAMING_SNAKE');

  // Check file names for kebab-case (handled separately in scanFiles)
  return conventions;
}

function detectFrameworks(files: string[], contents: Map<string, string>): string[] {
  const frameworks: Set<string> = new Set();

  // Check package.json
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const depNames = Object.keys(allDeps);

      if (depNames.includes('react')) frameworks.add('React');
      if (depNames.includes('next')) frameworks.add('Next.js');
      if (depNames.includes('vue')) frameworks.add('Vue.js');
      if (depNames.includes('nuxt')) frameworks.add('Nuxt');
      if (depNames.includes('svelte')) frameworks.add('Svelte');
      if (depNames.includes('@angular/core')) frameworks.add('Angular');
      if (depNames.includes('express')) frameworks.add('Express');
      if (depNames.includes('fastify')) frameworks.add('Fastify');
      if (depNames.includes('nestjs') || depNames.includes('@nestjs/core')) frameworks.add('NestJS');
      if (depNames.includes('prisma') || depNames.includes('@prisma/client')) frameworks.add('Prisma');
      if (depNames.includes('mongoose')) frameworks.add('Mongoose');
      if (depNames.includes('sequelize')) frameworks.add('Sequelize');
      if (depNames.includes('typeorm')) frameworks.add('TypeORM');
      if (depNames.includes('drizzle-orm')) frameworks.add('Drizzle');
      if (depNames.includes('tailwindcss')) frameworks.add('Tailwind CSS');
      if (depNames.includes('jest')) frameworks.add('Jest');
      if (depNames.includes('vitest')) frameworks.add('Vitest');
      if (depNames.includes('mocha')) frameworks.add('Mocha');
      if (depNames.includes('typescript')) frameworks.add('TypeScript');
      if (depNames.includes('eslint')) frameworks.add('ESLint');
      if (depNames.includes('prettier')) frameworks.add('Prettier');
      if (depNames.includes('zod')) frameworks.add('Zod');
      if (depNames.includes('trpc') || depNames.includes('@trpc/server')) frameworks.add('tRPC');
      if (depNames.includes('redux') || depNames.includes('@reduxjs/toolkit')) frameworks.add('Redux');
      if (depNames.includes('zustand')) frameworks.add('Zustand');
      if (depNames.includes('jotai')) frameworks.add('Jotai');
      if (depNames.includes('electron')) frameworks.add('Electron');
    } catch {
      // skip
    }
  }

  // Check for Python frameworks
  const requirementsTxt = path.join(process.cwd(), 'requirements.txt');
  const pyprojectToml = path.join(process.cwd(), 'pyproject.toml');
  if (fs.existsSync(requirementsTxt) || fs.existsSync(pyprojectToml)) {
    for (const [, content] of contents) {
      if (content.includes('from flask')) frameworks.add('Flask');
      if (content.includes('from django')) frameworks.add('Django');
      if (content.includes('from fastapi')) frameworks.add('FastAPI');
    }
  }

  // Check for Go modules
  if (fs.existsSync(path.join(process.cwd(), 'go.mod'))) {
    frameworks.add('Go');
  }

  // Check for Rust
  if (fs.existsSync(path.join(process.cwd(), 'Cargo.toml'))) {
    frameworks.add('Rust/Cargo');
  }

  return Array.from(frameworks).sort();
}

function detectErrorPatterns(contents: Map<string, string>): string[] {
  const patterns: Set<string> = new Set();

  for (const [, content] of contents) {
    if (/try\s*\{[\s\S]*?\}\s*catch/.test(content)) patterns.add('try/catch blocks');
    if (/\.catch\(/.test(content)) patterns.add('Promise .catch()');
    if (/\.then\([\s\S]*?,\s*(?:err|error)/.test(content)) patterns.add('Promise error callbacks');
    if (/if\s*\(\s*(?:err|error)\s*\)/.test(content)) patterns.add('Error-first callbacks');
    if (/Result<|Ok\(|Err\(/.test(content)) patterns.add('Result type pattern');
    if (/throwError|throwException/.test(content)) patterns.add('Explicit error throwing');
    if (/class\s+\w+Error\s+extends/.test(content)) patterns.add('Custom error classes');
    if (/(?:log|logger|console)\.(error|warn)/.test(content)) patterns.add('Error logging');
    if (/process\.exit\(1\)/.test(content)) patterns.add('Process exit on error');
    if (/\.finally\(/.test(content)) patterns.add('Promise .finally()');
  }

  return Array.from(patterns);
}

function detectCommonImports(contents: Map<string, string>): string[] {
  const importCounts: Record<string, number> = {};

  for (const [, content] of contents) {
    // ES imports
    const esImports = content.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g);
    for (const match of esImports) {
      const pkg = match[1];
      if (!pkg.startsWith('.') && !pkg.startsWith('/')) {
        importCounts[pkg] = (importCounts[pkg] || 0) + 1;
      }
    }

    // CommonJS require
    const cjsImports = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of cjsImports) {
      const pkg = match[1];
      if (!pkg.startsWith('.') && !pkg.startsWith('/')) {
        importCounts[pkg] = (importCounts[pkg] || 0) + 1;
      }
    }

    // Python imports
    const pyImports = content.matchAll(/(?:from|import)\s+([\w.]+)/g);
    for (const match of pyImports) {
      const pkg = match[1].split('.')[0];
      if (!['os', 'sys', 'typing', 'collections', 'abc', 'json', 're'].includes(pkg)) {
        importCounts[pkg] = (importCounts[pkg] || 0) + 1;
      }
    }
  }

  return Object.entries(importCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([pkg, count]) => `${pkg} (${count} files)`);
}

function getLanguageBreakdown(files: string[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  const extToLang: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript (JSX)', '.js': 'JavaScript',
    '.jsx': 'JavaScript (JSX)', '.mjs': 'JavaScript (ESM)', '.cjs': 'JavaScript (CJS)',
    '.py': 'Python', '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust',
    '.java': 'Java', '.kt': 'Kotlin', '.scala': 'Scala',
    '.c': 'C', '.cpp': 'C++', '.h': 'C/C++ Header', '.cs': 'C#',
    '.vue': 'Vue', '.svelte': 'Svelte', '.astro': 'Astro',
    '.css': 'CSS', '.scss': 'SCSS', '.less': 'Less',
    '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
    '.sh': 'Shell', '.sql': 'SQL', '.graphql': 'GraphQL',
    '.md': 'Markdown', '.mdx': 'MDX',
  };

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const lang = extToLang[ext] || ext;
    breakdown[lang] = (breakdown[lang] || 0) + 1;
  }

  return breakdown;
}

function getFileStructure(files: string[], rootDir: string): string[] {
  const dirs = new Set<string>();

  for (const file of files) {
    const rel = path.relative(rootDir, file);
    const parts = rel.split(path.sep);
    if (parts.length > 1) {
      dirs.add(parts[0] + '/');
      if (parts.length > 2) {
        dirs.add(parts[0] + '/' + parts[1] + '/');
      }
    }
  }

  return Array.from(dirs).sort().slice(0, 30);
}

function scanCodebase(): PatternScan {
  const rootDir = process.cwd();
  const files = collectFiles(rootDir);
  const contents = new Map<string, string>();
  const allNaming = new Set<string>();
  const indentations: string[] = [];

  // Read file contents
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      contents.set(file, content);
    } catch {
      // skip
    }
  }

  // Detect indentation across all files
  for (const [, content] of contents) {
    indentations.push(detectIndentation(content));
  }

  // Detect naming conventions
  for (const [, content] of contents) {
    for (const conv of detectNamingConventions(content)) {
      allNaming.add(conv);
    }
  }

  // Check for kebab-case file names
  const hasKebab = files.some(f => {
    const base = path.basename(f, path.extname(f));
    return /^[a-z]+(-[a-z]+)+$/.test(base);
  });
  if (hasKebab) allNaming.add('kebab-case');

  // Count indentation types
  const indentCounts: Record<string, number> = {};
  for (const ind of indentations) {
    indentCounts[ind] = (indentCounts[ind] || 0) + 1;
  }
  const predominantIndent = Object.entries(indentCounts)
    .filter(([key]) => key !== 'unknown')
    .sort((a, b) => b[1] - a[1])[0]?.[0] as PatternScan['indentation'] || 'unknown';

  // Select representative sample files
  const sampleFiles: PatternScan['sampleFiles'] = [];
  const samplePaths = files.slice(0, MAX_SAMPLE_FILES);
  for (const filePath of samplePaths) {
    const content = contents.get(filePath);
    if (content) {
      const truncated = content.length > 3000 ? content.substring(0, 3000) + '\n// ... truncated ...' : content;
      const ext = path.extname(filePath).toLowerCase();
      sampleFiles.push({
        path: path.relative(rootDir, filePath),
        content: truncated,
        language: ext.replace('.', ''),
      });
    }
  }

  return {
    indentation: predominantIndent,
    naming: Array.from(allNaming) as PatternScan['naming'],
    frameworks: detectFrameworks(files, contents),
    errorPatterns: detectErrorPatterns(contents),
    commonImports: detectCommonImports(contents),
    fileStructure: getFileStructure(files, rootDir),
    languageBreakdown: getLanguageBreakdown(files),
    sampleFiles,
  };
}

// ─── AI Analysis ────────────────────────────────────────────────────────────

const LEARN_SYSTEM_PROMPT = `You are Orion, an expert code analyst. Your job is to analyze a codebase scan and produce a comprehensive "patterns document" that captures all coding conventions, architectural patterns, and style decisions used in this project.

The output should be a well-structured Markdown document that can be injected into future AI prompts to ensure generated code matches the project's existing style perfectly.

Be specific and concrete. Instead of saying "uses consistent naming", say "uses camelCase for variables/functions, PascalCase for classes/types, SCREAMING_SNAKE_CASE for constants".

Include sections for:
1. **Code Style** - Indentation, quotes, semicolons, trailing commas, line length
2. **Naming Conventions** - Variables, functions, classes, files, directories
3. **Architecture** - Project structure, module organization, layer separation
4. **Patterns** - Common design patterns, error handling, state management
5. **Imports & Dependencies** - Import style, key libraries, module resolution
6. **Framework Conventions** - Framework-specific patterns and idioms
7. **Testing** - Test structure, naming, assertion style
8. **Other Conventions** - Anything else notable

Format the output as clean Markdown. Start with a title "# Project Patterns" and a brief description.`;

async function generatePatternsDocument(scan: PatternScan, existingPatterns?: string): Promise<string> {
  const scanSummary = `
## Automated Scan Results

**Indentation:** ${scan.indentation}
**Naming conventions detected:** ${scan.naming.join(', ') || 'none detected'}
**Frameworks/Libraries:** ${scan.frameworks.join(', ') || 'none detected'}
**Error handling patterns:** ${scan.errorPatterns.join(', ') || 'none detected'}
**Common imports:** ${scan.commonImports.join(', ') || 'none detected'}

**Language breakdown:**
${Object.entries(scan.languageBreakdown).map(([lang, count]) => `- ${lang}: ${count} files`).join('\n')}

**Project structure (top-level directories):**
${scan.fileStructure.map(d => `- ${d}`).join('\n')}

## Sample Files

${scan.sampleFiles.map(f => `### ${f.path}\n\`\`\`${f.language}\n${f.content}\n\`\`\``).join('\n\n')}
`;

  const userMessage = existingPatterns
    ? `Update the following existing patterns document based on the latest codebase scan. Preserve any manually added notes. Incorporate new findings.\n\n**Existing document:**\n${existingPatterns}\n\n**New scan:**\n${scanSummary}`
    : `Analyze this codebase scan and generate a comprehensive patterns document.\n\n${scanSummary}`;

  let result = '';
  await askAI(LEARN_SYSTEM_PROMPT, userMessage, {
    onToken(token: string) {
      result += token;
    },
    onComplete(text: string) {
      result = text;
    },
    onError(error: Error) {
      throw error;
    },
  });

  return result;
}

// ─── Auto-Learn (Pattern Detection from AI Interactions) ─────────────────────

const AUTO_LEARN_SYSTEM_PROMPT = `You are a pattern detector. Given an AI interaction (the user's question and the AI's response), determine if the AI discovered or recommended a notable coding pattern, convention, or practice specific to this project.

If a pattern was discovered, output it in this exact format:
PATTERN: <short title>
DETAIL: <one or two sentence description of the pattern>

If no notable pattern was discovered, output exactly:
NO_PATTERN

Only detect patterns that are specific, actionable conventions — not general programming knowledge. Examples of good patterns:
- "This project uses barrel exports in index.ts files"
- "Error handling uses custom AppError class with error codes"
- "API routes follow /api/v1/<resource> naming"

Do NOT detect vague patterns like "uses TypeScript" or "has tests".`;

/**
 * Analyze an AI interaction and auto-append any discovered pattern to .orion/patterns.md.
 * Lightweight: only appends, never rewrites. Called after each AI interaction in auto mode.
 */
export async function autoLearnFromInteraction(userMessage: string, aiResponse: string): Promise<string | null> {
  const interactionSummary = `User asked:\n${userMessage.substring(0, 500)}\n\nAI responded:\n${aiResponse.substring(0, 1500)}`;

  let result = '';
  try {
    await askAI(AUTO_LEARN_SYSTEM_PROMPT, interactionSummary, {
      onToken(token: string) {
        result += token;
      },
      onComplete(text: string) {
        result = text;
      },
      onError() {
        // silently ignore
      },
    });
  } catch {
    return null;
  }

  // Check if a pattern was found
  const trimmed = result.trim();
  if (trimmed === 'NO_PATTERN' || !trimmed.startsWith('PATTERN:')) {
    return null;
  }

  const patternMatch = trimmed.match(/PATTERN:\s*(.+)/);
  const detailMatch = trimmed.match(/DETAIL:\s*(.+)/);

  if (!patternMatch) return null;

  const patternTitle = patternMatch[1].trim();
  const patternDetail = detailMatch ? detailMatch[1].trim() : patternTitle;

  // Append to .orion/patterns.md
  const orionDir = path.join(process.cwd(), '.orion');
  if (!fs.existsSync(orionDir)) {
    fs.mkdirSync(orionDir, { recursive: true });
  }

  const patternsFile = path.join(orionDir, 'patterns.md');
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const entry = `\n\n### ${patternTitle}\n_Auto-detected on ${timestamp}_\n\n${patternDetail}\n`;

  // Append (create file if it doesn't exist)
  if (fs.existsSync(patternsFile)) {
    fs.appendFileSync(patternsFile, entry, 'utf-8');
  } else {
    const header = `<!-- Generated by Orion Auto-Learn -->\n<!-- This file is auto-injected into AI prompts for better accuracy -->\n\n# Project Patterns\n`;
    fs.writeFileSync(patternsFile, header + entry, 'utf-8');
  }

  return patternTitle;
}

// ─── Main Command ───────────────────────────────────────────────────────────

export async function learnCommand(options: LearnOptions = {}): Promise<void> {
  // ── Auto-learn watch mode ───────────────────────────────────────────
  if (options.auto) {
    console.log(commandHeader('Orion Learn - Auto Mode', [
      ['Mode', 'Watching for patterns'],
    ]));

    printInfo('Auto-learn mode enabled.');
    printInfo('Patterns will be appended to .orion/patterns.md after each AI interaction.');
    console.log();

    const orionDir = path.join(process.cwd(), '.orion');
    if (!fs.existsSync(orionDir)) {
      fs.mkdirSync(orionDir, { recursive: true });
    }

    const patternsFile = path.join(orionDir, 'patterns.md');
    if (!fs.existsSync(patternsFile)) {
      const header = `<!-- Generated by Orion Auto-Learn -->\n<!-- This file is auto-injected into AI prompts for better accuracy -->\n\n# Project Patterns\n`;
      fs.writeFileSync(patternsFile, header, 'utf-8');
      printSuccess(`Created ${colors.file('.orion/patterns.md')}`);
    } else {
      printInfo(`${colors.file('.orion/patterns.md')} already exists, will append new patterns.`);
    }

    printSuccess('Auto-learn is now active for this session.');
    printInfo('Detected patterns will be automatically appended to .orion/patterns.md.');
    printInfo('Press Ctrl+C to stop watching.');
    console.log();

    // Keep the process alive - in practice this flag is read by chat/ask commands
    // to call autoLearnFromInteraction() after each response.
    // Here we just confirm the mode is ready.
    return;
  }

  console.log(commandHeader('Orion Learn', [
    ['Mode', options.update ? 'Update patterns' : 'Full analysis'],
  ]));

  const orionDir = path.join(process.cwd(), '.orion');
  const patternsFile = path.join(orionDir, 'patterns.md');
  const isUpdate = options.update;

  // Check for existing patterns on update
  let existingPatterns: string | undefined;
  if (isUpdate) {
    if (fs.existsSync(patternsFile)) {
      existingPatterns = fs.readFileSync(patternsFile, 'utf-8');
      printInfo(`Updating existing patterns from ${colors.file('.orion/patterns.md')}`);
    } else {
      printWarning('No existing patterns found. Running full analysis instead.');
    }
  }

  // Phase 1: Scan codebase
  const scanSpinner = startSpinner('Scanning codebase for patterns...');
  let scan: PatternScan;
  try {
    scan = scanCodebase();
    stopSpinner(scanSpinner, `Scanned ${Object.values(scan.languageBreakdown).reduce((a, b) => a + b, 0)} files`);
  } catch (err: any) {
    stopSpinner(scanSpinner, err.message, false);
    printError(`Scan failed: ${err.message}`);
    process.exit(1);
    return; // unreachable but satisfies TS
  }

  // Show scan summary
  console.log();
  console.log(divider('Scan Results'));
  console.log();

  console.log(`  ${palette.blue('Indentation:')}   ${scan.indentation}`);
  console.log(`  ${palette.blue('Naming:')}        ${scan.naming.join(', ') || chalk.dim('none detected')}`);
  console.log(`  ${palette.blue('Frameworks:')}    ${scan.frameworks.join(', ') || chalk.dim('none detected')}`);
  console.log(`  ${palette.blue('Error handling:')} ${scan.errorPatterns.slice(0, 4).join(', ') || chalk.dim('none detected')}`);
  console.log();

  if (Object.keys(scan.languageBreakdown).length > 0) {
    console.log(`  ${palette.blue('Languages:')}`);
    const sorted = Object.entries(scan.languageBreakdown).sort((a, b) => b[1] - a[1]);
    for (const [lang, count] of sorted.slice(0, 8)) {
      const bar = palette.violet('\u2588'.repeat(Math.min(count, 30)));
      console.log(`    ${lang.padEnd(22)} ${bar} ${chalk.dim(String(count))}`);
    }
    console.log();
  }

  // Phase 2: AI analysis
  const aiSpinner = startSpinner('AI analyzing patterns...');
  let patternsDoc: string;
  try {
    patternsDoc = await generatePatternsDocument(scan, existingPatterns);
    stopSpinner(aiSpinner, 'Analysis complete');
  } catch (err: any) {
    stopSpinner(aiSpinner, err.message, false);
    printError(`AI analysis failed: ${err.message}`);
    printInfo('Check your AI provider configuration with `orion config`.');
    process.exit(1);
    return;
  }

  // Phase 3: Save patterns
  if (!fs.existsSync(orionDir)) {
    fs.mkdirSync(orionDir, { recursive: true });
  }

  // Add generation metadata
  const metadata = `<!-- Generated by Orion Learn on ${new Date().toISOString()} -->\n<!-- This file is auto-injected into AI prompts for better accuracy -->\n<!-- Run 'orion learn --update' to refresh patterns -->\n\n`;

  fs.writeFileSync(patternsFile, metadata + patternsDoc, 'utf-8');

  console.log();
  console.log(divider('Output'));
  console.log();
  console.log(renderMarkdown(patternsDoc.substring(0, 2000) + (patternsDoc.length > 2000 ? '\n\n...' : '')));
  console.log();

  printSuccess(`Patterns saved to ${colors.file('.orion/patterns.md')}`);
  printInfo('This document will be auto-injected into all future AI prompts.');
  printInfo(`Run ${colors.command('orion learn --update')} to refresh after code changes.`);
  console.log();
}
