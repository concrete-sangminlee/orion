/**
 * Orion CLI - Examples Command
 * Show comprehensive usage examples for any command, grouped by category.
 * Beautiful formatted output with command + description.
 */

import chalk from 'chalk';
import { colors } from '../utils.js';
import { commandHeader, divider, box, badge, palette } from '../ui.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface Example {
  command: string;
  description: string;
}

interface CommandExamples {
  name: string;
  summary: string;
  category: string;
  examples: Example[];
}

// ── Examples Database ────────────────────────────────────────────────────────

const EXAMPLES_DB: CommandExamples[] = [
  // ── Core ──────────────────────────────────────────────────────────────────
  {
    name: 'chat',
    summary: 'Start an interactive AI chat session with provider hot-switching',
    category: 'Core',
    examples: [
      { command: 'orion chat', description: 'Start interactive chat with default provider' },
      { command: '/tab', description: 'Switch AI provider mid-conversation (in chat)' },
      { command: '/model llama3.2', description: 'Change active model (in chat)' },
      { command: '/save', description: 'Save current session (in chat)' },
      { command: '/load', description: 'Load a previous session (in chat)' },
      { command: '/history', description: 'View conversation history (in chat)' },
    ],
  },
  {
    name: 'ask',
    summary: 'Ask a quick one-shot question with optional file context',
    category: 'Core',
    examples: [
      { command: 'orion ask "What is a closure in JavaScript?"', description: 'Simple knowledge question' },
      { command: 'orion ask "What does this function do?" @src/utils.ts', description: 'Question with file context' },
      { command: 'orion ask "Find bugs" @app.ts @server.ts', description: 'Question with multiple files' },
      { command: 'cat error.log | orion ask "What went wrong?"', description: 'Pipe input for analysis' },
      { command: 'orion ask "Convert this to TypeScript" @script.js', description: 'Code transformation request' },
      { command: 'git diff | orion ask "Summarize these changes"', description: 'Pipe git diff as context' },
    ],
  },
  {
    name: 'explain',
    summary: 'AI-powered code explanation for any file',
    category: 'Core',
    examples: [
      { command: 'orion explain src/index.ts', description: 'Explain a TypeScript file' },
      { command: 'orion explain Dockerfile', description: 'Explain a Dockerfile' },
      { command: 'cat complex.py | orion explain', description: 'Explain piped content' },
      { command: 'orion explain package.json', description: 'Explain project configuration' },
    ],
  },
  {
    name: 'review',
    summary: 'AI code review for files or the current directory',
    category: 'Core',
    examples: [
      { command: 'orion review src/api.ts', description: 'Review a specific file' },
      { command: 'orion review', description: 'Review current directory' },
      { command: 'git diff | orion review', description: 'Review changes from git diff' },
    ],
  },
  {
    name: 'fix',
    summary: 'Find and fix issues in code with optional auto-test loop',
    category: 'Core',
    examples: [
      { command: 'orion fix src/utils.ts', description: 'Find and fix issues in a file' },
      { command: 'orion fix --auto src/api.ts', description: 'Fix, test, iterate until passing' },
      { command: 'orion fix --auto --max-iterations 5 app.ts', description: 'Auto-fix with max 5 iterations' },
      { command: 'orion fix --no-commit src/index.ts', description: 'Fix without auto-commit prompt' },
      { command: 'cat broken.py | orion fix', description: 'Fix piped input' },
    ],
  },
  {
    name: 'edit',
    summary: 'AI-assisted file editing with natural language instructions',
    category: 'Core',
    examples: [
      { command: 'orion edit src/app.ts', description: 'Edit a file with AI assistance' },
      { command: 'orion edit --no-commit styles.css', description: 'Edit without commit prompt' },
    ],
  },
  {
    name: 'commit',
    summary: 'Generate AI commit messages from staged changes',
    category: 'Core',
    examples: [
      { command: 'git add . && orion commit', description: 'Stage all and generate commit message' },
      { command: 'orion commit', description: 'Generate commit for already staged files' },
    ],
  },

  // ── Code ──────────────────────────────────────────────────────────────────
  {
    name: 'search',
    summary: 'Search the codebase for patterns with AI analysis',
    category: 'Code',
    examples: [
      { command: 'orion search "TODO"', description: 'Search for all TODOs in codebase' },
      { command: 'orion search "async function" --type code', description: 'Search only in code' },
      { command: 'orion search "deprecated" --max 50', description: 'Limit to 50 results' },
      { command: 'orion search "API_KEY" --no-ai', description: 'Search without AI analysis' },
    ],
  },
  {
    name: 'diff',
    summary: 'Review git diffs with AI-powered analysis',
    category: 'Code',
    examples: [
      { command: 'orion diff', description: 'Review uncommitted changes' },
      { command: 'orion diff --staged', description: 'Review only staged changes' },
      { command: 'orion diff HEAD~3', description: 'Review last 3 commits' },
      { command: 'orion diff main', description: 'Review changes since main branch' },
    ],
  },
  {
    name: 'pr',
    summary: 'AI-powered pull request helper',
    category: 'Code',
    examples: [
      { command: 'orion pr', description: 'Generate full PR description' },
      { command: 'orion pr --title', description: 'Generate PR title only' },
      { command: 'orion pr --review', description: 'AI reviews all branch changes' },
    ],
  },
  {
    name: 'run',
    summary: 'Run a command with AI error analysis on failure',
    category: 'Code',
    examples: [
      { command: 'orion run "npm test"', description: 'Run tests, AI analyzes failures' },
      { command: 'orion run --fix "npm run build"', description: 'Run and auto-apply AI fixes' },
      { command: 'orion run "python main.py"', description: 'Run any command with AI error help' },
    ],
  },
  {
    name: 'test',
    summary: 'Run tests with AI failure analysis or generate tests',
    category: 'Code',
    examples: [
      { command: 'orion test', description: 'Run project tests, AI analyzes failures' },
      { command: 'orion test --generate src/utils.ts', description: 'Generate tests for a file' },
    ],
  },
  {
    name: 'agent',
    summary: 'Run multiple AI tasks in parallel',
    category: 'Code',
    examples: [
      { command: 'orion agent "review auth.ts" "find bugs in api.ts"', description: 'Run two tasks in parallel' },
      { command: 'orion agent --parallel 5 "task1" "task2" "task3"', description: 'Set max concurrency' },
      { command: 'orion agent --provider anthropic "analyze code"', description: 'Force a specific provider' },
    ],
  },
  {
    name: 'refactor',
    summary: 'AI-powered code refactoring',
    category: 'Code',
    examples: [
      { command: 'orion refactor src/ --rename oldFunc newFunc', description: 'Rename symbol across codebase' },
      { command: 'orion refactor utils.ts --extract handleError', description: 'Extract code into a function' },
      { command: 'orion refactor complex.ts --simplify', description: 'Simplify complex code' },
      { command: 'orion refactor src/ --unused', description: 'Find unused exports and imports' },
    ],
  },

  // ── Generate ──────────────────────────────────────────────────────────────
  {
    name: 'plan',
    summary: 'Generate a multi-step implementation plan from a task',
    category: 'Generate',
    examples: [
      { command: 'orion plan "Add user authentication with JWT"', description: 'Plan a feature implementation' },
      { command: 'orion plan "Migrate database from MySQL to PostgreSQL"', description: 'Plan a migration' },
    ],
  },
  {
    name: 'generate',
    summary: 'Generate boilerplate code for common patterns',
    category: 'Generate',
    examples: [
      { command: 'orion generate component UserProfile', description: 'Generate a UI component' },
      { command: 'orion generate api /users', description: 'Generate an API endpoint' },
      { command: 'orion generate model User', description: 'Generate a data model' },
      { command: 'orion generate hook useAuth', description: 'Generate a custom React hook' },
      { command: 'orion generate test src/utils.ts', description: 'Generate tests for a file' },
      { command: 'orion generate service Payment', description: 'Generate a service class' },
      { command: 'orion generate middleware auth', description: 'Generate middleware' },
      { command: 'orion generate --force component Nav', description: 'Overwrite existing files' },
    ],
  },
  {
    name: 'docs',
    summary: 'AI-powered documentation generator',
    category: 'Generate',
    examples: [
      { command: 'orion docs src/api.ts', description: 'Generate JSDoc/docstrings' },
      { command: 'orion docs src/ --readme', description: 'Generate README for directory' },
      { command: 'orion docs src/api.ts --api', description: 'Generate API documentation' },
    ],
  },

  // ── Tools ─────────────────────────────────────────────────────────────────
  {
    name: 'shell',
    summary: 'AI-enhanced interactive shell for natural language commands',
    category: 'Tools',
    examples: [
      { command: 'orion shell', description: 'Start AI-enhanced shell' },
      { command: '"find large files over 100MB"', description: 'Natural language (in shell)' },
      { command: '"list all running Docker containers"', description: 'Natural language (in shell)' },
    ],
  },
  {
    name: 'todo',
    summary: 'Scan codebase for TODO/FIXME/HACK comments',
    category: 'Tools',
    examples: [
      { command: 'orion todo', description: 'List all TODO/FIXME/HACK comments' },
      { command: 'orion todo --fix', description: 'AI suggests fixes for each TODO' },
      { command: 'orion todo --prioritize', description: 'AI ranks TODOs by importance' },
    ],
  },
  {
    name: 'fetch',
    summary: 'Fetch URL content for AI context',
    category: 'Tools',
    examples: [
      { command: 'orion fetch https://docs.example.com/api', description: 'Fetch and display text content' },
      { command: 'orion fetch https://example.com --raw', description: 'Fetch raw content (no HTML strip)' },
      { command: 'orion fetch https://api.docs.com | orion ask "How to use?"', description: 'Pipe to ask for analysis' },
    ],
  },
  {
    name: 'changelog',
    summary: 'Generate a categorized changelog from git history',
    category: 'Tools',
    examples: [
      { command: 'orion changelog', description: 'Generate changelog from all commits' },
      { command: 'orion changelog --since v1.0.0', description: 'Changelog since a specific tag' },
      { command: 'orion changelog --days 7', description: 'Changelog for the last 7 days' },
      { command: 'orion changelog --output CHANGELOG.md', description: 'Write changelog to a file' },
    ],
  },
  {
    name: 'migrate',
    summary: 'AI-powered code migration between technologies',
    category: 'Tools',
    examples: [
      { command: 'orion migrate app.js --to typescript', description: 'Convert JavaScript to TypeScript' },
      { command: 'orion migrate Component.tsx --to hooks', description: 'Class components to hooks' },
      { command: 'orion migrate legacy.js --to async', description: 'Callbacks to async/await' },
      { command: 'orion migrate app.js --to esm', description: 'CommonJS to ES modules' },
    ],
  },
  {
    name: 'deps',
    summary: 'AI-powered dependency analysis',
    category: 'Tools',
    examples: [
      { command: 'orion deps', description: 'Full dependency analysis' },
      { command: 'orion deps --security', description: 'Security vulnerability audit' },
      { command: 'orion deps --outdated', description: 'Find outdated packages' },
      { command: 'orion deps --unused', description: 'Detect unused dependencies' },
    ],
  },
  {
    name: 'snippet',
    summary: 'Manage reusable code snippets',
    category: 'Tools',
    examples: [
      { command: 'orion snippet save "auth-middleware" --file src/auth.ts --lines 10-25', description: 'Save a code snippet' },
      { command: 'orion snippet list', description: 'List all saved snippets' },
      { command: 'orion snippet search "auth"', description: 'Search snippets by keyword' },
      { command: 'orion snippet use "auth-middleware"', description: 'Output snippet to stdout' },
      { command: 'orion snippet generate "express error handler"', description: 'AI-generate a snippet' },
    ],
  },
  {
    name: 'compare',
    summary: 'Compare files or technology approaches with AI',
    category: 'Tools',
    examples: [
      { command: 'orion compare old.ts new.ts', description: 'Compare two files with AI analysis' },
      { command: 'orion compare --approach "React vs Vue for a dashboard"', description: 'Compare tech approaches' },
      { command: 'orion compare --approach "REST vs GraphQL for mobile API"', description: 'Architecture decision help' },
    ],
  },

  // ── Analysis ──────────────────────────────────────────────────────────────
  {
    name: 'debug',
    summary: 'AI-powered debugging assistant',
    category: 'Analysis',
    examples: [
      { command: 'orion debug src/api.ts', description: 'Analyze file for potential bugs' },
      { command: 'orion debug --error "Cannot read property of undefined"', description: 'Diagnose a specific error' },
      { command: 'orion debug --stacktrace', description: 'Paste a stack trace for analysis' },
    ],
  },
  {
    name: 'benchmark',
    summary: 'AI-powered performance analysis',
    category: 'Analysis',
    examples: [
      { command: 'orion benchmark src/heavy.ts', description: 'Full performance analysis' },
      { command: 'orion benchmark --memory src/cache.ts', description: 'Focus on memory usage' },
      { command: 'orion benchmark --complexity src/sort.ts', description: 'Time/space complexity analysis' },
    ],
  },
  {
    name: 'security',
    summary: 'Scan for security vulnerabilities',
    category: 'Analysis',
    examples: [
      { command: 'orion security src/', description: 'Scan directory for vulnerabilities' },
      { command: 'orion security src/api.ts', description: 'Scan a specific file' },
      { command: 'orion security --owasp', description: 'Audit against OWASP Top 10' },
    ],
  },
  {
    name: 'typecheck',
    summary: 'AI-powered type analysis and improvements',
    category: 'Analysis',
    examples: [
      { command: 'orion typecheck src/utils.ts', description: 'Analyze types, suggest improvements' },
      { command: 'orion typecheck src/api.ts --strict', description: 'Strict type safety audit' },
      { command: 'orion typecheck legacy.js --convert', description: 'Full JS-to-TypeScript conversion' },
    ],
  },

  // ── Safety ────────────────────────────────────────────────────────────────
  {
    name: 'undo',
    summary: 'Undo file changes and manage backups',
    category: 'Safety',
    examples: [
      { command: 'orion undo', description: 'Undo last file change' },
      { command: 'orion undo --list', description: 'List available backups' },
      { command: 'orion undo --file src/app.ts', description: 'Undo a specific file' },
      { command: 'orion undo --checkpoint', description: 'Restore a workspace checkpoint' },
      { command: 'orion undo --clean', description: 'Remove backups older than 7 days' },
    ],
  },
  {
    name: 'status',
    summary: 'Show Orion environment status',
    category: 'Safety',
    examples: [
      { command: 'orion status', description: 'Full environment status overview' },
    ],
  },
  {
    name: 'doctor',
    summary: 'Full health check of the Orion environment',
    category: 'Safety',
    examples: [
      { command: 'orion doctor', description: 'Run all health checks' },
    ],
  },

  // ── Session & Config ──────────────────────────────────────────────────────
  {
    name: 'session',
    summary: 'Manage named AI sessions',
    category: 'Session',
    examples: [
      { command: 'orion session new my-feature', description: 'Create a new named session' },
      { command: 'orion session list', description: 'List all sessions' },
      { command: 'orion session resume my-feature', description: 'Resume a saved session' },
      { command: 'orion session export my-feature', description: 'Export session to file' },
      { command: 'orion session delete old-session', description: 'Delete a session' },
    ],
  },
  {
    name: 'watch',
    summary: 'Watch files and auto-run AI actions on change',
    category: 'Session',
    examples: [
      { command: 'orion watch "src/**/*.ts"', description: 'Watch TypeScript files' },
      { command: 'orion watch "*.py" --on-change fix', description: 'Auto-fix Python files on save' },
      { command: 'orion watch "src/**" --debounce 500', description: 'Watch with custom debounce' },
      { command: 'orion watch "**/*.ts" --ignore "dist,test"', description: 'Watch with ignore patterns' },
    ],
  },
  {
    name: 'config',
    summary: 'Configure API keys and preferences',
    category: 'Session',
    examples: [
      { command: 'orion config', description: 'Interactive configuration wizard' },
    ],
  },
  {
    name: 'init',
    summary: 'Initialize Orion config in current project',
    category: 'Session',
    examples: [
      { command: 'orion init', description: 'Initialize .orion/ in current directory' },
    ],
  },
  {
    name: 'completions',
    summary: 'Generate shell completion scripts',
    category: 'Session',
    examples: [
      { command: 'orion completions bash', description: 'Generate bash completions' },
      { command: 'orion completions zsh', description: 'Generate zsh completions' },
      { command: 'orion completions fish', description: 'Generate fish completions' },
      { command: 'orion completions powershell', description: 'Generate PowerShell completions' },
    ],
  },
];

// ── Category Colors ──────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  Core: '#7C5CFC',
  Code: '#38BDF8',
  Generate: '#22C55E',
  Tools: '#F59E0B',
  Analysis: '#EF4444',
  Safety: '#D4A574',
  Session: '#9B59B6',
};

// ── Render Helpers ───────────────────────────────────────────────────────────

function renderCommandExamples(cmd: CommandExamples): void {
  const catColor = CATEGORY_COLORS[cmd.category] || '#7C5CFC';
  const catBadge = badge(cmd.category, catColor);

  console.log();
  console.log(`  ${catBadge}  ${palette.violet.bold('orion ' + cmd.name)}`);
  console.log(`  ${palette.dim(cmd.summary)}`);
  console.log();

  for (const ex of cmd.examples) {
    const cmdStr = colors.command(ex.command);
    console.log(`    ${cmdStr}`);
    console.log(`      ${palette.dim(ex.description)}`);
  }
}

function renderCategoryExamples(categoryName: string, commands: CommandExamples[]): void {
  const catColor = CATEGORY_COLORS[categoryName] || '#7C5CFC';

  console.log();
  console.log(`  ${badge(categoryName, catColor)}`);
  console.log(divider());

  for (const cmd of commands) {
    console.log();
    console.log(`  ${palette.violet.bold('orion ' + cmd.name)} ${palette.dim('- ' + cmd.summary)}`);
    console.log();

    for (const ex of cmd.examples) {
      const cmdStr = colors.command(ex.command);
      console.log(`    ${cmdStr}`);
      console.log(`      ${palette.dim(ex.description)}`);
    }
  }
}

// ── Main Examples Command ────────────────────────────────────────────────────

export async function examplesCommand(commandName?: string): Promise<void> {
  // Show examples for a specific command
  if (commandName) {
    const cmd = EXAMPLES_DB.find(
      (c) => c.name.toLowerCase() === commandName.toLowerCase()
    );

    if (!cmd) {
      console.log(commandHeader('Orion Examples'));
      console.log();
      console.log(`  ${palette.red('\u2717')} Unknown command: ${palette.white.bold(commandName)}`);
      console.log();

      // Find close matches
      const lower = commandName.toLowerCase();
      const matches = EXAMPLES_DB.filter(
        (c) => c.name.includes(lower) || lower.includes(c.name)
      );

      if (matches.length > 0) {
        console.log(`  ${palette.dim('Did you mean:')}`);
        for (const m of matches) {
          console.log(`    ${colors.command('orion examples ' + m.name)}`);
        }
        console.log();
      }

      // List all available
      console.log(`  ${palette.dim('Available commands:')}`);
      const names = EXAMPLES_DB.map((c) => colors.command(c.name));
      const chunkSize = 6;
      for (let i = 0; i < names.length; i += chunkSize) {
        const chunk = names.slice(i, i + chunkSize);
        console.log(`    ${chunk.join(palette.dim(' \u00B7 '))}`);
      }
      console.log();
      return;
    }

    console.log(commandHeader(`Examples: orion ${cmd.name}`));
    renderCommandExamples(cmd);
    console.log();
    console.log(`  ${palette.dim('Run')} ${colors.command('orion ' + cmd.name + ' --help')} ${palette.dim('for full usage details.')}`);
    console.log();
    return;
  }

  // Show all examples grouped by category
  console.log(commandHeader('Orion Examples', [['Tip', `Run ${colors.command('orion examples <command>')} for specific examples`]]));

  const categories = [
    'Core',
    'Code',
    'Generate',
    'Tools',
    'Analysis',
    'Safety',
    'Session',
  ];

  for (const cat of categories) {
    const commands = EXAMPLES_DB.filter((c) => c.category === cat);
    if (commands.length > 0) {
      renderCategoryExamples(cat, commands);
    }
  }

  console.log();
  console.log(divider('Pipe Support'));
  console.log();
  console.log(`    ${colors.command('cat file.ts | orion ask "What\'s wrong?"')}`);
  console.log(`      ${palette.dim('Pipe file content as context to a question')}`);
  console.log();
  console.log(`    ${colors.command('git diff | orion review')}`);
  console.log(`      ${palette.dim('Review git changes with AI')}`);
  console.log();
  console.log(`    ${colors.command('orion run "npm test"')}`);
  console.log(`      ${palette.dim('Run command with AI error analysis')}`);
  console.log();
  console.log(`    ${colors.command('orion fetch https://docs.example.com | orion ask "How to use?"')}`);
  console.log(`      ${palette.dim('Fetch docs and ask AI about them')}`);
  console.log();

  console.log(divider('Global Flags'));
  console.log();
  console.log(`    ${palette.dim('--dry-run     Show changes without writing files')}`);
  console.log(`    ${palette.dim('--json        Output structured JSON (CI/CD)')}`);
  console.log(`    ${palette.dim('-y, --yes     Auto-confirm all prompts')}`);
  console.log(`    ${palette.dim('--quiet       Minimal output')}`);
  console.log();
}
