/**
 * Orion CLI - AI-Powered Plan Command
 * Takes a high-level task description and generates a detailed, multi-step
 * implementation plan using AI analysis of the current project structure.
 *
 * Usage:
 *   orion plan "Add authentication to the Express app"
 *   orion plan "Refactor the database layer to use Prisma"
 */

import * as fs from 'fs';
import * as path from 'path';
import { askAI } from '../ai-client.js';
import {
  colors,
  printInfo,
  printError,
  printDivider,
  startSpinner,
  stopSpinner,
  getCurrentDirectoryContext,
  loadProjectContext,
} from '../utils.js';
import { renderMarkdown } from '../markdown.js';
import { createSilentStreamHandler } from '../shared.js';
import { jsonOutput } from '../pipeline.js';
import {
  commandHeader,
  table as uiTable,
  divider,
  statusLine,
  badge,
  box,
  palette,
} from '../ui.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlanStep {
  number: number;
  title: string;
  files: string[];
  complexity: 'Low' | 'Medium' | 'High';
  description: string;
}

interface Plan {
  task: string;
  steps: PlanStep[];
  rawMarkdown: string;
  timestamp: string;
}

// ─── System Prompt ───────────────────────────────────────────────────────────

const PLAN_SYSTEM_PROMPT = `You are a senior software architect. Given a project context and a task description, create a detailed implementation plan.

Analyze the project structure, dependencies, and existing code patterns to produce a realistic, actionable plan.

Format your response EXACTLY as follows (this format is machine-parsed):

## Step 1: [Title]
**Files:** file1.ts, file2.ts
**Complexity:** Low
**Description:** What to do in this step. Be specific about the changes needed.

## Step 2: [Title]
**Files:** file3.ts
**Complexity:** Medium
**Description:** What to do in this step. Reference specific functions, classes, or patterns.

## Step 3: [Title]
**Files:** file4.ts, file5.ts
**Complexity:** High
**Description:** What to do in this step. Include implementation details.

Rules:
- Each step should be independently actionable
- Order steps logically (setup first, then core logic, then integration, then tests)
- Be specific about which files to create vs modify
- Reference existing project patterns and conventions
- Complexity: Low = simple change, Medium = moderate effort, High = significant work
- Include a testing step if appropriate
- Keep step count between 3 and 10 steps
- Use real file paths relative to the project root`;

// ─── Plan Parser ─────────────────────────────────────────────────────────────

function parsePlan(rawResponse: string, task: string): Plan {
  const steps: PlanStep[] = [];
  const stepRegex = /## Step (\d+):\s*(.+?)(?:\n|\r\n)/g;
  const sections = rawResponse.split(/## Step \d+:/);

  // Skip the first section (preamble before Step 1)
  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];

    // Parse title from the first line
    const titleMatch = section.match(/^\s*(.+?)(?:\n|\r\n)/);
    const title = titleMatch ? titleMatch[1].trim() : `Step ${i}`;

    // Parse files
    const filesMatch = section.match(/\*\*Files:\*\*\s*(.+?)(?:\n|\r\n)/);
    const filesStr = filesMatch ? filesMatch[1].trim() : '';
    const files = filesStr
      .split(/,\s*/)
      .map(f => f.trim())
      .filter(f => f.length > 0 && f !== 'None' && f !== 'N/A');

    // Parse complexity
    const complexityMatch = section.match(/\*\*Complexity:\*\*\s*(Low|Medium|High)/i);
    const complexityRaw = complexityMatch ? complexityMatch[1] : 'Medium';
    const complexity = (complexityRaw.charAt(0).toUpperCase() + complexityRaw.slice(1).toLowerCase()) as 'Low' | 'Medium' | 'High';

    // Parse description
    const descMatch = section.match(/\*\*Description:\*\*\s*([\s\S]*?)(?=\n## Step|\n---|\s*$)/);
    const description = descMatch ? descMatch[1].trim() : section.trim();

    steps.push({
      number: i,
      title,
      files,
      complexity,
      description,
    });
  }

  // Fallback: if no steps were parsed, create a single step from the raw response
  if (steps.length === 0) {
    steps.push({
      number: 1,
      title: 'Implementation',
      files: [],
      complexity: 'Medium',
      description: rawResponse.trim(),
    });
  }

  return {
    task,
    steps,
    rawMarkdown: rawResponse,
    timestamp: new Date().toISOString(),
  };
}

// ─── Project Scanner ─────────────────────────────────────────────────────────

function scanProjectStructure(): string {
  const cwd = process.cwd();
  const lines: string[] = [];

  // Read package.json if present
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      lines.push('## package.json');
      if (pkg.name) lines.push(`Name: ${pkg.name}`);
      if (pkg.version) lines.push(`Version: ${pkg.version}`);
      if (pkg.description) lines.push(`Description: ${pkg.description}`);

      if (pkg.dependencies) {
        const deps = Object.keys(pkg.dependencies).slice(0, 20);
        lines.push(`Dependencies: ${deps.join(', ')}`);
      }
      if (pkg.devDependencies) {
        const devDeps = Object.keys(pkg.devDependencies).slice(0, 15);
        lines.push(`Dev Dependencies: ${devDeps.join(', ')}`);
      }
      if (pkg.scripts) {
        const scripts = Object.entries(pkg.scripts)
          .slice(0, 10)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join('\n');
        lines.push(`Scripts:\n${scripts}`);
      }
      lines.push('');
    } catch { /* ignore */ }
  }

  // Scan top-level directory structure (max 2 levels deep)
  lines.push('## Project Structure');
  const IGNORE = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
    'coverage', '.nyc_output', '.cache', '__pycache__', '.tox',
    'target', 'vendor', '.orion', '.vscode', '.idea',
  ]);

  function listDir(dir: string, prefix: string, depth: number): void {
    if (depth > 2) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.') || e.name === '.env.example')
        .filter(e => !IGNORE.has(e.name))
        .sort((a, b) => {
          // Directories first
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 30); // Limit entries per level

      for (const entry of entries) {
        const isDir = entry.isDirectory();
        lines.push(`${prefix}${isDir ? entry.name + '/' : entry.name}`);
        if (isDir) {
          listDir(path.join(dir, entry.name), prefix + '  ', depth + 1);
        }
      }
    } catch { /* ignore permission errors */ }
  }

  listDir(cwd, '  ', 0);
  lines.push('');

  // Detect common config files
  const configFiles = [
    'tsconfig.json', '.eslintrc.js', '.eslintrc.json', '.prettierrc',
    'vite.config.ts', 'vite.config.js', 'webpack.config.js', 'next.config.js',
    'tailwind.config.js', 'tailwind.config.ts', 'jest.config.js', 'vitest.config.ts',
    'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt',
    'Dockerfile', 'docker-compose.yml', '.github/workflows',
  ];
  const foundConfigs = configFiles.filter(c => fs.existsSync(path.join(cwd, c)));
  if (foundConfigs.length > 0) {
    lines.push(`## Configuration Files Found`);
    lines.push(foundConfigs.join(', '));
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Complexity Badge ────────────────────────────────────────────────────────

function complexityBadge(level: string): string {
  switch (level.toLowerCase()) {
    case 'low': return badge('LOW', '#22C55E');
    case 'medium': return badge('MED', '#F59E0B');
    case 'high': return badge('HIGH', '#EF4444');
    default: return badge(level, '#7C5CFC');
  }
}

// ─── Save Plan to Disk ──────────────────────────────────────────────────────

function savePlan(plan: Plan): string {
  const plansDir = path.join(process.cwd(), '.orion', 'plans');
  if (!fs.existsSync(plansDir)) {
    fs.mkdirSync(plansDir, { recursive: true });
  }

  const timestamp = plan.timestamp.replace(/[:.]/g, '-');
  const safeTask = plan.task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .substring(0, 40)
    .replace(/-$/, '');
  const filename = `plan-${timestamp}-${safeTask}.md`;
  const filepath = path.join(plansDir, filename);

  const lines: string[] = [];
  lines.push(`# Plan: ${plan.task}`);
  lines.push(`**Generated:** ${new Date(plan.timestamp).toLocaleString()}`);
  lines.push(`**Steps:** ${plan.steps.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const step of plan.steps) {
    lines.push(`## Step ${step.number}: ${step.title}`);
    lines.push(`**Files:** ${step.files.length > 0 ? step.files.join(', ') : 'N/A'}`);
    lines.push(`**Complexity:** ${step.complexity}`);
    lines.push(`**Description:** ${step.description}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('*Generated by Orion CLI*');

  fs.writeFileSync(filepath, lines.join('\n'), 'utf-8');
  return filepath;
}

// ─── Display Plan ───────────────────────────────────────────────────────────

function displayPlan(plan: Plan): void {
  // Summary table
  const rows = plan.steps.map(step => [
    palette.violet.bold(String(step.number)),
    step.title.length > 30 ? step.title.substring(0, 29) + '\u2026' : step.title,
    step.files.length > 0
      ? step.files.slice(0, 2).join(', ') + (step.files.length > 2 ? ` +${step.files.length - 2}` : '')
      : palette.dim('TBD'),
    complexityBadge(step.complexity),
  ]);

  console.log();
  console.log(uiTable(
    ['#', 'Step', 'Files', 'Complexity'],
    rows,
  ));
  console.log();

  // Detailed breakdown
  console.log(divider('Details'));
  console.log();

  for (const step of plan.steps) {
    console.log(`  ${palette.violet.bold(`Step ${step.number}:`)} ${palette.bold(step.title)}`);

    if (step.files.length > 0) {
      console.log(`  ${palette.dim('Files:')} ${step.files.map(f => colors.file(f)).join(', ')}`);
    }

    console.log(`  ${palette.dim('Complexity:')} ${complexityBadge(step.complexity)}`);
    console.log(`  ${palette.dim('Description:')}`);

    // Word-wrap description at ~70 chars
    const words = step.description.split(/\s+/);
    let line = '    ';
    for (const word of words) {
      if (line.length + word.length > 72) {
        console.log(line);
        line = '    ' + word;
      } else {
        line += (line.trim() ? ' ' : '') + word;
      }
    }
    if (line.trim()) console.log(line);

    console.log();
  }

  // Effort summary
  const lowCount = plan.steps.filter(s => s.complexity === 'Low').length;
  const medCount = plan.steps.filter(s => s.complexity === 'Medium').length;
  const highCount = plan.steps.filter(s => s.complexity === 'High').length;
  const allFiles = [...new Set(plan.steps.flatMap(s => s.files))];

  console.log(divider('Summary'));
  console.log();
  console.log(`  ${palette.dim('Total Steps:')} ${palette.violet.bold(String(plan.steps.length))}`);
  console.log(`  ${palette.dim('Files:')}       ${palette.violet.bold(String(allFiles.length))} unique files`);
  console.log(`  ${palette.dim('Effort:')}      ${palette.green(`${lowCount} low`)} | ${palette.yellow(`${medCount} medium`)} | ${palette.red(`${highCount} high`)}`);
  console.log();
}

// ─── Main Command ───────────────────────────────────────────────────────────

export async function planCommand(task: string): Promise<void> {
  if (!task || !task.trim()) {
    console.log(commandHeader('Orion Plan'));
    console.log();
    printError('No task description provided.');
    console.log();
    console.log(`  ${palette.dim('Usage:')}`);
    console.log(`    ${colors.command('orion plan')} ${palette.dim('"Add authentication to the Express app"')}`);
    console.log(`    ${colors.command('orion plan')} ${palette.dim('"Refactor database layer to use Prisma"')}`);
    console.log();
    process.exit(1);
  }

  console.log(commandHeader('Orion Plan', [
    ['Task', task],
  ]));

  // Scan project structure
  const projectScanSpinner = startSpinner('Scanning project structure...');
  const projectStructure = scanProjectStructure();
  const dirContext = getCurrentDirectoryContext();
  const projectContext = loadProjectContext();
  stopSpinner(projectScanSpinner, 'Project scanned');

  // Generate the plan via AI
  const planSpinner = startSpinner('Generating implementation plan...');

  try {
    const userMessage = [
      `Task: ${task}`,
      '',
      `Project Information:`,
      dirContext,
      '',
      projectStructure,
    ].join('\n');

    const fullPrompt = projectContext
      ? PLAN_SYSTEM_PROMPT + '\n\nExisting project context:\n' + projectContext
      : PLAN_SYSTEM_PROMPT;

    const { callbacks, getResponse } = createSilentStreamHandler(planSpinner, 'Plan generated');
    await askAI(fullPrompt, userMessage, callbacks);

    const rawResponse = getResponse();
    const plan = parsePlan(rawResponse, task);

    // Display the plan
    displayPlan(plan);

    // Save the plan to disk
    const planPath = savePlan(plan);
    printInfo(`Plan saved: ${colors.file(path.relative(process.cwd(), planPath))}`);
    console.log();

    // JSON output for pipeline mode
    jsonOutput('plan', {
      task,
      stepCount: plan.steps.length,
      steps: plan.steps.map(s => ({
        number: s.number,
        title: s.title,
        files: s.files,
        complexity: s.complexity,
      })),
      savedTo: planPath,
    });
  } catch (err: any) {
    stopSpinner(planSpinner, err.message, false);
    printError(`Plan generation failed: ${err.message}`);
    printInfo('Run `orion config` to check your AI provider settings.');
    console.log();
    process.exit(1);
  }
}
