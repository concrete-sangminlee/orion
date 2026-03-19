#!/usr/bin/env node

/**
 * Orion CLI - AI-Powered Coding Assistant
 *
 * A premium terminal tool for AI-assisted development.
 * Supports Anthropic Claude, OpenAI GPT, and local Ollama models.
 *
 * Startup optimizations:
 * - Lazy imports: command modules loaded only when invoked
 * - Non-blocking version check after command execution
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { printBanner, colors, printError, printInfo } from './utils.js';
import { setPipelineOptions } from './pipeline.js';
import { errorDisplay, palette } from './ui.js';

// ─── Version Check (non-blocking) ───────────────────────────────────────────

const CURRENT_VERSION = '2.2.0';
const PACKAGE_NAME = 'orion-ide';
const VERSION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface VersionCheckCache {
  lastCheck: number;
  latestVersion: string | null;
}

async function checkForUpdates(): Promise<void> {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const cacheDir = path.join(os.homedir(), '.orion');
    const cacheFile = path.join(cacheDir, 'version-check.json');

    // Read cache
    let cache: VersionCheckCache | null = null;
    try {
      if (fs.existsSync(cacheFile)) {
        cache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      }
    } catch {
      // Ignore corrupted cache
    }

    // Skip if checked recently
    if (cache && Date.now() - cache.lastCheck < VERSION_CHECK_INTERVAL_MS) {
      if (cache.latestVersion && cache.latestVersion !== CURRENT_VERSION) {
        printUpdateNotice(cache.latestVersion);
      }
      return;
    }

    // Fetch latest version from npm (with short timeout)
    const { execSync } = await import('child_process');
    let latestVersion: string | null = null;
    try {
      latestVersion = execSync(`npm view ${PACKAGE_NAME} version`, {
        timeout: 5000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      // Network error or npm not available - silently skip
      latestVersion = null;
    }

    // Write cache
    try {
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      const newCache: VersionCheckCache = {
        lastCheck: Date.now(),
        latestVersion,
      };
      fs.writeFileSync(cacheFile, JSON.stringify(newCache, null, 2));
    } catch {
      // Ignore write errors
    }

    // Show notice if newer version is available
    if (latestVersion && latestVersion !== CURRENT_VERSION) {
      printUpdateNotice(latestVersion);
    }
  } catch {
    // Never let version check break the CLI
  }
}

function printUpdateNotice(latestVersion: string): void {
  console.log();
  console.log(
    chalk.yellow(`  Update available: ${CURRENT_VERSION} \u2192 ${latestVersion}. Run: npm i -g ${PACKAGE_NAME}`)
  );
}

// ─── Error Handler Factory ──────────────────────────────────────────────────

function handleCommandError(err: any, command: string, suggestion?: string): void {
  const fixes = [];
  if (suggestion) fixes.push(suggestion);
  fixes.push(`Run ${colors.command(`orion ${command} --help`)} for usage.`);

  console.log(errorDisplay(
    err.message || 'An unexpected error occurred.',
    fixes
  ));
  console.log();
  process.exit(1);
}

// ─── Program Setup ──────────────────────────────────────────────────────────

const program = new Command();

program
  .name('orion')
  .version(CURRENT_VERSION, '-v, --version', 'Show Orion CLI version')
  .description('AI-powered coding assistant for the terminal')
  .option('--json', 'Output structured JSON to stdout (for CI/CD pipelines)')
  .option('-y, --yes', 'Auto-confirm all prompts (non-interactive mode)')
  .option('--no-color', 'Disable color output')
  .option('--quiet', 'Minimal output')
  .option('--dry-run', 'Show what would be changed without writing files')
  .addHelpText('beforeAll', () => {
    printBanner();
    return '';
  })
  .hook('preAction', () => {
    const opts = program.opts();
    setPipelineOptions({
      json: opts.json || false,
      yes: opts.yes || false,
      noColor: opts.color === false,
      quiet: opts.quiet || false,
      dryRun: opts.dryRun || false,
    });
  });

// ─── Core Commands ───────────────────────────────────────────────────────────
// chat · ask · explain · review · fix · edit · commit

program
  .command('chat')
  .description('Start an interactive AI chat session')
  .action(async () => {
    try {
      const { chatCommand } = await import('./commands/chat.js');
      await chatCommand();
    } catch (err: any) {
      handleCommandError(err, 'chat', 'Run `orion config` to set up API keys.');
    }
  });

program
  .command('ask <question>')
  .description('Ask a quick one-shot question (supports @file references)')
  .argument('[refs...]', 'Optional @file references for multi-file context')
  .action(async (question: string, refs: string[]) => {
    try {
      const { askCommand } = await import('./commands/ask.js');
      await askCommand(question, refs);
    } catch (err: any) {
      handleCommandError(err, 'ask', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('explain [file]')
  .description('AI-powered code explanation (accepts piped input)')
  .action(async (file?: string) => {
    try {
      const { explainCommand } = await import('./commands/explain.js');
      await explainCommand(file);
    } catch (err: any) {
      handleCommandError(err, 'explain', 'Check that the file exists and your AI provider is configured.');
    }
  });

program
  .command('review [file]')
  .description('AI code review (file or current directory)')
  .action(async (file?: string) => {
    try {
      const { reviewCommand } = await import('./commands/review.js');
      await reviewCommand(file);
    } catch (err: any) {
      handleCommandError(err, 'review', 'Ensure the file exists or run from a project directory.');
    }
  });

program
  .command('fix [file]')
  .description('Find and fix issues in a file (accepts piped input)')
  .option('--auto', 'Auto-run tests after fix; re-fix on failure (edit-lint-test loop)')
  .option('--max-iterations <n>', 'Max fix-test iterations for --auto (default: 3)')
  .option('--no-commit', 'Skip the auto-commit prompt after applying fixes')
  .action(async (file?: string, opts?: { auto?: boolean; maxIterations?: string; commit?: boolean }) => {
    try {
      const { fixCommand } = await import('./commands/fix.js');
      await fixCommand(file, {
        auto: opts?.auto,
        maxIterations: opts?.maxIterations ? parseInt(opts.maxIterations, 10) : undefined,
        noCommit: opts?.commit === false,
      });
    } catch (err: any) {
      handleCommandError(err, 'fix', 'Check that the file exists and your AI provider is configured.');
    }
  });

program
  .command('edit <file>')
  .description('AI-assisted file editing')
  .option('--no-commit', 'Skip the auto-commit prompt after applying edits')
  .action(async (file: string, opts?: { commit?: boolean }) => {
    try {
      const { editCommand } = await import('./commands/edit.js');
      await editCommand(file, {
        noCommit: opts?.commit === false,
      });
    } catch (err: any) {
      handleCommandError(err, 'edit', 'Check that the file exists and your AI provider is configured.');
    }
  });

program
  .command('commit')
  .description('Generate AI commit message from staged changes')
  .action(async () => {
    try {
      const { commitCommand } = await import('./commands/commit.js');
      await commitCommand();
    } catch (err: any) {
      handleCommandError(err, 'commit', 'Stage changes with `git add` first, then run `orion commit`.');
    }
  });

// ─── Code Commands ───────────────────────────────────────────────────────────
// search · diff · pr · run · test · agent · refactor · compare

program
  .command('search <pattern>')
  .description('Search codebase for a pattern and get AI analysis')
  .option('--type <type>', 'Filter by type: comment, code, all (default: all)', 'all')
  .option('--max <n>', 'Max results to return (default: 100)', '100')
  .option('--no-ai', 'Skip AI analysis, just show search results')
  .action(async (pattern: string, options: { type?: string; max?: string; ai?: boolean }) => {
    try {
      const { searchCommand } = await import('./commands/search.js');
      await searchCommand(pattern, {
        type: options.type,
        maxResults: parseInt(options.max || '100', 10),
        noAi: options.ai === false,
      });
    } catch (err: any) {
      handleCommandError(err, 'search', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('diff [ref]')
  .description('Review git diff with AI analysis')
  .option('--staged', 'Review only staged changes')
  .action(async (ref: string | undefined, options: { staged?: boolean }) => {
    try {
      const { diffCommand } = await import('./commands/diff.js');
      await diffCommand(ref, { staged: options.staged });
    } catch (err: any) {
      handleCommandError(err, 'diff', 'Ensure you are in a git repository and your AI provider is configured.');
    }
  });

program
  .command('pr')
  .description('AI-powered pull request helper (generate description, title, or review)')
  .option('--title', 'Generate PR title only')
  .option('--review', 'Review current branch changes as a PR')
  .action(async (options: { title?: boolean; review?: boolean }) => {
    try {
      const { prCommand } = await import('./commands/pr.js');
      await prCommand({
        title: options.title,
        review: options.review,
      });
    } catch (err: any) {
      handleCommandError(err, 'pr', 'Ensure you are in a git repository and your AI provider is configured.');
    }
  });

program
  .command('run <command>')
  .description('Run a command with AI error analysis')
  .option('--fix', 'Auto-apply AI-suggested fixes on failure')
  .action(async (command: string, options: { fix?: boolean }) => {
    try {
      const { runCommand } = await import('./commands/run.js');
      await runCommand(command, { fix: options.fix });
    } catch (err: any) {
      handleCommandError(err, 'run', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('test')
  .description('Run tests with AI failure analysis or generate tests')
  .option('--generate <file>', 'Generate tests for a source file')
  .action(async (options: { generate?: string }) => {
    try {
      const { testCommand } = await import('./commands/test.js');
      await testCommand({ generate: options.generate });
    } catch (err: any) {
      handleCommandError(err, 'test', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('agent')
  .description('Run multiple AI tasks in parallel (multi-agent)')
  .argument('<tasks...>', 'Task descriptions to run in parallel')
  .option('--parallel <n>', 'Max concurrent tasks (default: 3)', '3')
  .option('--provider <name>', 'Force a specific AI provider for all tasks')
  .option('--no-save', 'Do not save results to .orion/agents/')
  .action(async (tasks: string[], options: { parallel?: string; provider?: string; save?: boolean }) => {
    try {
      const { agentCommand } = await import('./commands/agent.js');
      await agentCommand(tasks, {
        parallel: parseInt(options.parallel || '3', 10),
        provider: options.provider,
        save: options.save,
      });
    } catch (err: any) {
      handleCommandError(err, 'agent', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('refactor <target>')
  .description('AI-powered code refactoring (rename, extract, simplify, unused)')
  .option('--rename <names...>', 'Rename a symbol across the codebase (oldName newName)')
  .option('--extract <name>', 'Extract code into a new function')
  .option('--simplify', 'Simplify complex code')
  .option('--unused', 'Find unused exports and imports')
  .action(async (target: string, options: { rename?: string[]; extract?: string; simplify?: boolean; unused?: boolean }) => {
    try {
      const { refactorCommand } = await import('./commands/refactor.js');
      await refactorCommand(target, {
        rename: options.rename,
        extract: options.extract,
        simplify: options.simplify,
        unused: options.unused,
      });
    } catch (err: any) {
      handleCommandError(err, 'refactor', 'Ensure the file/directory exists and your AI provider is configured.');
    }
  });

program
  .command('compare [files...]')
  .description('Compare two files or technology approaches with AI analysis')
  .option('--approach <question>', 'Compare technology approaches instead of files')
  .action(async (files: string[], options: { approach?: string }) => {
    try {
      const { compareCommand } = await import('./commands/compare.js');
      await compareCommand(files, {
        approach: options.approach,
      });
    } catch (err: any) {
      handleCommandError(err, 'compare', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

// ─── Generate Commands ───────────────────────────────────────────────────────
// plan · generate · docs · snippet · scaffold

program
  .command('plan <task>')
  .description('Generate a multi-step implementation plan from a task description')
  .option('--execute', 'Execute the plan immediately after generating it')
  .action(async (task: string, options: { execute?: boolean }) => {
    try {
      const { planCommand } = await import('./commands/plan.js');
      await planCommand(task, { execute: options.execute });
    } catch (err: any) {
      handleCommandError(err, 'plan', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('generate <type> <name>')
  .description('Generate boilerplate code (component, api, model, hook, test, middleware, page, service)')
  .option('--force', 'Overwrite existing files without prompting')
  .action(async (type: string, name: string, options: { force?: boolean }) => {
    try {
      const { generateCommand } = await import('./commands/generate.js');
      await generateCommand(type, name, { force: options.force });
    } catch (err: any) {
      handleCommandError(err, 'generate', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('docs [target]')
  .description('AI-powered documentation generator (JSDoc, README, API docs)')
  .option('--readme', 'Generate a README.md for the directory')
  .option('--api', 'Generate API documentation')
  .action(async (target?: string, options?: { readme?: boolean; api?: boolean }) => {
    try {
      const { docsCommand } = await import('./commands/docs.js');
      await docsCommand(target, {
        readme: options?.readme,
        api: options?.api,
      });
    } catch (err: any) {
      handleCommandError(err, 'docs', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('snippet <action> [name]')
  .description('Manage code snippets (save, list, search, use, generate)')
  .option('--file <file>', 'Source file to extract snippet from')
  .option('--lines <range>', 'Line range to extract (e.g., 10-25)')
  .option('--tag <tags>', 'Comma-separated tags for the snippet')
  .action(async (action: string, name: string | undefined, options: { file?: string; lines?: string; tag?: string }) => {
    try {
      const { snippetCommand } = await import('./commands/snippet.js');
      await snippetCommand(action, name, {
        file: options.file,
        lines: options.lines,
        tag: options.tag,
      });
    } catch (err: any) {
      handleCommandError(err, 'snippet', 'Run `orion snippet --help` for usage.');
    }
  });

program
  .command('scaffold [template] [project-name]')
  .description('Scaffold a new project from a template (react, next, express, etc.)')
  .option('--list', 'List all available templates')
  .option('--description <desc>', 'Project description for AI customization')
  .action(async (template?: string, projectName?: string, options?: { list?: boolean; description?: string }) => {
    try {
      const { scaffoldCommand } = await import('./commands/scaffold.js');
      await scaffoldCommand(template, projectName, {
        list: options?.list,
        description: options?.description,
      });
    } catch (err: any) {
      handleCommandError(err, 'scaffold', 'Run `orion scaffold --list` to see available templates.');
    }
  });

// ─── Tools Commands ──────────────────────────────────────────────────────────
// shell · todo · fetch · changelog · log · summarize · migrate · deps · format · translate · env

program
  .command('shell')
  .description('Start an AI-enhanced interactive shell (natural language to commands)')
  .action(async () => {
    try {
      const { shellCommand } = await import('./commands/shell.js');
      await shellCommand();
    } catch (err: any) {
      handleCommandError(err, 'shell', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('todo')
  .description('Scan codebase for TODO/FIXME/HACK comments')
  .option('--fix', 'AI suggests fixes for each TODO')
  .option('--prioritize', 'AI prioritizes TODOs by importance')
  .action(async (options: { fix?: boolean; prioritize?: boolean }) => {
    try {
      const { todoCommand } = await import('./commands/todo.js');
      await todoCommand({
        fix: options.fix,
        prioritize: options.prioritize,
      });
    } catch (err: any) {
      handleCommandError(err, 'todo', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('fetch <url>')
  .description('Fetch a URL and display text content (pipe to orion ask for AI analysis)')
  .option('--raw', 'Show raw content without HTML tag stripping')
  .action(async (url: string, options: { raw?: boolean }) => {
    try {
      const { fetchCommand } = await import('./commands/fetch.js');
      await fetchCommand(url, { raw: options.raw });
    } catch (err: any) {
      handleCommandError(err, 'fetch', 'Check the URL and your network connection.');
    }
  });

program
  .command('changelog')
  .description('Generate a categorized changelog from git commit history')
  .option('--since <ref>', 'Generate changelog since a tag or commit ref')
  .option('--days <n>', 'Generate changelog for the last N days')
  .option('--output <file>', 'Write changelog to a file')
  .action(async (options: { since?: string; days?: string; output?: string }) => {
    try {
      const { changelogCommand } = await import('./commands/changelog.js');
      await changelogCommand({
        since: options.since,
        days: options.days ? parseInt(options.days, 10) : undefined,
        output: options.output,
      });
    } catch (err: any) {
      handleCommandError(err, 'changelog', 'Ensure you are in a git repository and your AI provider is configured.');
    }
  });

program
  .command('log')
  .description('AI-enhanced git log with summaries and impact analysis')
  .option('--author <name>', 'Filter commits by author name')
  .option('--since <time>', 'Filter commits by time (e.g., "1 week ago", "2024-01-01")')
  .option('--count <n>', 'Number of commits to show (default: 20)')
  .option('--impact', 'AI analyzes the impact level of each commit')
  .action(async (options: { author?: string; since?: string; count?: string; impact?: boolean }) => {
    try {
      const { logCommand } = await import('./commands/log.js');
      await logCommand({
        author: options.author,
        since: options.since,
        count: options.count ? parseInt(options.count, 10) : undefined,
        impact: options.impact,
      });
    } catch (err: any) {
      handleCommandError(err, 'log', 'Ensure you are in a git repository and your AI provider is configured.');
    }
  });

program
  .command('summarize [target]')
  .description('AI-powered content summarizer (files, directories, piped input)')
  .option('--meeting', 'Summarize as meeting notes (decisions, action items, follow-ups)')
  .option('--bullet', 'Output summary as bullet points')
  .option('--length <size>', 'Summary length: short, medium, or long (default: medium)')
  .action(async (target?: string, options?: { meeting?: boolean; bullet?: boolean; length?: string }) => {
    try {
      const { summarizeCommand } = await import('./commands/summarize.js');
      await summarizeCommand(target, {
        meeting: options?.meeting,
        bullet: options?.bullet,
        length: (options?.length as 'short' | 'medium' | 'long') || undefined,
      });
    } catch (err: any) {
      handleCommandError(err, 'summarize', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('migrate <file>')
  .description('AI-powered code migration (JS->TS, Python2->3, class->hooks, callbacks->async)')
  .requiredOption('--to <target>', 'Migration target: typescript, python3, hooks, async, esm, composition')
  .action(async (file: string, options: { to: string }) => {
    try {
      const { migrateCommand } = await import('./commands/migrate.js');
      await migrateCommand(file, { to: options.to });
    } catch (err: any) {
      handleCommandError(err, 'migrate', 'Check that the file exists and your AI provider is configured.');
    }
  });

program
  .command('deps')
  .description('AI-powered dependency analysis (security, outdated, unused)')
  .option('--security', 'Audit dependencies for security vulnerabilities')
  .option('--outdated', 'Find outdated packages with upgrade recommendations')
  .option('--unused', 'Detect unused dependencies in the project')
  .action(async (options: { security?: boolean; outdated?: boolean; unused?: boolean }) => {
    try {
      const { depsCommand } = await import('./commands/deps.js');
      await depsCommand({
        security: options.security,
        outdated: options.outdated,
        unused: options.unused,
      });
    } catch (err: any) {
      handleCommandError(err, 'deps', 'Ensure a dependency manifest (package.json, etc.) exists and your AI provider is configured.');
    }
  });

program
  .command('format <target>')
  .description('Format code using native formatter or AI (supports --check and --style)')
  .option('--check', 'Check formatting without applying changes')
  .option('--style <guide>', 'Enforce a specific style guide (airbnb, google, standard)')
  .action(async (target: string, options: { check?: boolean; style?: string }) => {
    try {
      const { formatCommand } = await import('./commands/format.js');
      await formatCommand(target, {
        check: options.check,
        style: options.style,
      });
    } catch (err: any) {
      handleCommandError(err, 'format', 'Ensure the file/directory exists and your AI provider is configured.');
    }
  });

program
  .command('translate <input>')
  .description('Translate code comments/strings or text to another language')
  .requiredOption('--to <language>', 'Target language: english, korean, japanese, chinese, spanish, french, german')
  .option('--apply', 'Apply translation directly to the file')
  .action(async (input: string, options: { to: string; apply?: boolean }) => {
    try {
      const { translateCommand } = await import('./commands/translate.js');
      await translateCommand(input, {
        to: options.to,
        apply: options.apply,
      });
    } catch (err: any) {
      handleCommandError(err, 'translate', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('env <action>')
  .description('Environment variable management (check, suggest, template, validate)')
  .action(async (action: string) => {
    try {
      const { envCommand } = await import('./commands/env.js');
      await envCommand(action);
    } catch (err: any) {
      handleCommandError(err, 'env', 'Run `orion env --help` for usage.');
    }
  });

// ─── Analysis Commands ───────────────────────────────────────────────────────
// debug · benchmark · security · typecheck · optimize

program
  .command('debug [file]')
  .description('AI-powered debugging assistant (analyze files, diagnose errors, parse stack traces)')
  .option('--error <message>', 'Diagnose a specific error message')
  .option('--stacktrace', 'Paste a stack trace for analysis')
  .action(async (file?: string, options?: { error?: string; stacktrace?: boolean }) => {
    try {
      const { debugCommand } = await import('./commands/debug.js');
      await debugCommand(file, {
        error: options?.error,
        stacktrace: options?.stacktrace,
      });
    } catch (err: any) {
      handleCommandError(err, 'debug', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('benchmark [file]')
  .description('AI-powered performance analysis (bottlenecks, complexity, memory)')
  .option('--memory', 'Focus on memory usage analysis')
  .option('--complexity', 'Focus on time/space complexity analysis')
  .action(async (file?: string, options?: { memory?: boolean; complexity?: boolean }) => {
    try {
      const { benchmarkCommand } = await import('./commands/benchmark.js');
      await benchmarkCommand(file, {
        memory: options?.memory,
        complexity: options?.complexity,
      });
    } catch (err: any) {
      handleCommandError(err, 'benchmark', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('security [target]')
  .description('Scan for security vulnerabilities (SQL injection, XSS, secrets, etc.)')
  .option('--owasp', 'Check against OWASP Top 10 categories')
  .action(async (target: string | undefined, options: { owasp?: boolean }) => {
    try {
      const { securityCommand } = await import('./commands/security.js');
      await securityCommand(target, { owasp: options.owasp });
    } catch (err: any) {
      handleCommandError(err, 'security', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('typecheck <target>')
  .description('AI-powered type analysis and improvement suggestions')
  .option('--strict', 'Strict mode: flag all type safety issues')
  .option('--convert', 'Suggest full JS-to-TypeScript conversion')
  .action(async (target: string, options: { strict?: boolean; convert?: boolean }) => {
    try {
      const { typecheckCommand } = await import('./commands/typecheck.js');
      await typecheckCommand(target, {
        strict: options.strict,
        convert: options.convert,
      });
    } catch (err: any) {
      handleCommandError(err, 'typecheck', 'Ensure the file exists and your AI provider is configured.');
    }
  });

program
  .command('optimize <target>')
  .description('AI-powered performance optimization suggestions (bundle, SQL, React)')
  .option('--bundle', 'Bundle size optimization (imports, tree-shaking, lazy loading)')
  .option('--sql', 'SQL query optimization (indexes, N+1, parameterization)')
  .option('--react', 'React-specific optimization (memo, useMemo, useCallback)')
  .action(async (target: string, options: { bundle?: boolean; sql?: boolean; react?: boolean }) => {
    try {
      const { optimizeCommand } = await import('./commands/optimize.js');
      await optimizeCommand(target, {
        bundle: options.bundle,
        sql: options.sql,
        react: options.react,
      });
    } catch (err: any) {
      handleCommandError(err, 'optimize', 'Ensure the file/directory exists and your AI provider is configured.');
    }
  });

// ─── Safety Commands ─────────────────────────────────────────────────────────
// undo · status · doctor · clean

program
  .command('undo')
  .description('Undo last file change (restore from backup or checkpoint)')
  .option('--list', 'List available backups')
  .option('--file <file>', 'Undo a specific file')
  .option('--clean', 'Remove old backups (older than 7 days)')
  .option('--checkpoint', 'List and restore workspace checkpoints (multi-file undo)')
  .action(async (options: { list?: boolean; file?: string; clean?: boolean; checkpoint?: boolean }) => {
    try {
      const { undoCommand } = await import('./commands/undo.js');
      await undoCommand(options);
    } catch (err: any) {
      handleCommandError(err, 'undo', 'Check that backups exist in .orion/backups/.');
    }
  });

program
  .command('status')
  .description('Show Orion environment status')
  .action(async () => {
    try {
      const { statusCommand } = await import('./commands/status.js');
      await statusCommand();
    } catch (err: any) {
      handleCommandError(err, 'status');
    }
  });

program
  .command('doctor')
  .description('Run a full health check of the Orion environment')
  .action(async () => {
    try {
      const { doctorCommand } = await import('./commands/doctor.js');
      await doctorCommand();
    } catch (err: any) {
      handleCommandError(err, 'doctor');
    }
  });

program
  .command('clean')
  .description('Clean up Orion data (backups, history, checkpoints)')
  .option('--backups', 'Remove all backups')
  .option('--history', 'Remove chat history')
  .option('--checkpoints', 'Remove checkpoints')
  .option('--all', 'Remove everything')
  .option('--dry-run', 'Show what would be removed without deleting')
  .action(async (options: { backups?: boolean; history?: boolean; checkpoints?: boolean; all?: boolean; dryRun?: boolean }) => {
    try {
      const { cleanCommand } = await import('./commands/clean.js');
      await cleanCommand({
        backups: options.backups,
        history: options.history,
        checkpoints: options.checkpoints,
        all: options.all,
        dryRun: options.dryRun,
      });
    } catch (err: any) {
      handleCommandError(err, 'clean');
    }
  });

// ─── Session Commands ────────────────────────────────────────────────────────
// session · watch · config · init · gui · completions

program
  .command('session')
  .description('Manage named AI sessions')
  .argument('<action>', 'Action: new, list, resume, export, delete')
  .argument('[name]', 'Session name (required for new, resume, export, delete)')
  .action(async (action: string, name?: string) => {
    try {
      const { sessionCommand } = await import('./commands/session.js');
      await sessionCommand(action, name);
    } catch (err: any) {
      handleCommandError(err, 'session', 'Check file permissions for ~/.orion/sessions/.');
    }
  });

program
  .command('watch')
  .description('Watch files and auto-run AI actions on change')
  .argument('<pattern>', 'Glob pattern for files to watch (e.g., "*.ts", "src/**")')
  .option('--on-change <action>', 'Action to run: review, fix, explain, ask (default: review)', 'review')
  .option('--debounce <ms>', 'Debounce delay in ms (default: 300)', '300')
  .option('--ignore <patterns>', 'Comma-separated ignore patterns', 'node_modules,dist,build,.git,.orion')
  .action(async (pattern: string, options: { onChange?: string; debounce?: string; ignore?: string }) => {
    try {
      const { watchCommand } = await import('./commands/watch.js');
      await watchCommand(pattern, {
        onChange: options.onChange,
        debounce: parseInt(options.debounce || '300', 10),
        ignore: options.ignore,
      });
    } catch (err: any) {
      handleCommandError(err, 'watch', 'Ensure chokidar is installed and your AI provider is configured.');
    }
  });

program
  .command('config')
  .description('Configure API keys and preferences')
  .action(async () => {
    try {
      const { configCommand } = await import('./commands/config.js');
      await configCommand();
    } catch (err: any) {
      handleCommandError(err, 'config', 'Check file permissions for ~/.orion/config.json.');
    }
  });

program
  .command('init')
  .description('Initialize Orion config in current project')
  .action(async () => {
    try {
      const { initCommand } = await import('./commands/config.js');
      await initCommand();
    } catch (err: any) {
      handleCommandError(err, 'init', 'Make sure you have write permissions in the current directory.');
    }
  });

program
  .command('gui')
  .description('Launch the Orion desktop app (Electron)')
  .action(async () => {
    console.log();
    console.log(colors.primary.bold('  Launching Orion IDE...'));
    console.log();

    try {
      const { execSync } = await import('child_process');
      const path = await import('path');
      execSync('npm run electron:dev', {
        stdio: 'inherit',
        cwd: __dirname.includes('dist-cli')
          ? path.resolve(__dirname, '..')
          : process.cwd(),
      });
    } catch (err: any) {
      handleCommandError(err, 'gui', 'Make sure you are in the Orion project directory. Run `npm run electron:dev` manually.');
    }
  });

program
  .command('completions <shell>')
  .description('Generate shell completion scripts (bash, zsh, fish, powershell)')
  .action(async (shell: string) => {
    try {
      const { completionsCommand } = await import('./commands/completions.js');
      await completionsCommand(shell);
    } catch (err: any) {
      handleCommandError(err, 'completions', 'Supported shells: bash, zsh, fish, powershell');
    }
  });

// ─── Git Commands ────────────────────────────────────────────────────────────
// hooks · alias · blame

program
  .command('hooks <action>')
  .description('Manage Orion git hooks (install, uninstall, list)')
  .option('--hook <name>', 'Target a specific hook (pre-commit, commit-msg, pre-push)')
  .option('--force', 'Overwrite existing non-Orion hooks')
  .action(async (action: string, options: { hook?: string; force?: boolean }) => {
    try {
      const { hooksCommand } = await import('./commands/hooks.js');
      await hooksCommand(action, {
        hook: options.hook,
        force: options.force,
      });
    } catch (err: any) {
      handleCommandError(err, 'hooks', 'Ensure you are in a git repository.');
    }
  });

program
  .command('alias <action> [name] [expansion]')
  .description('Manage command aliases (set, list, remove)')
  .action(async (action: string, name?: string, expansion?: string) => {
    try {
      const { aliasCommand } = await import('./commands/alias.js');
      await aliasCommand(action, name, expansion);
    } catch (err: any) {
      handleCommandError(err, 'alias', 'Run `orion alias --help` for usage.');
    }
  });

program
  .command('blame <file>')
  .description('AI-powered git blame analysis (ownership, history, hotspots)')
  .option('--line <n>', 'Explain why a specific line was changed')
  .option('--hotspots', 'Find most frequently changed sections')
  .action(async (file: string, options: { line?: string; hotspots?: boolean }) => {
    try {
      const { blameCommand } = await import('./commands/blame.js');
      await blameCommand(file, {
        line: options.line ? parseInt(options.line, 10) : undefined,
        hotspots: options.hotspots,
      });
    } catch (err: any) {
      handleCommandError(err, 'blame', 'Ensure you are in a git repository and the file is tracked.');
    }
  });

// ─── AI Commands ─────────────────────────────────────────────────────────────
// learn · pair · context (management)

program
  .command('learn')
  .description('Analyze codebase patterns and generate .orion/patterns.md for AI accuracy')
  .option('--update', 'Update patterns from recent changes instead of full re-analysis')
  .action(async (options: { update?: boolean }) => {
    try {
      const { learnCommand } = await import('./commands/learn.js');
      await learnCommand({ update: options.update });
    } catch (err: any) {
      handleCommandError(err, 'learn', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('pair')
  .description('Start AI pair programming - watches files, auto-reviews changes in real-time')
  .action(async () => {
    try {
      const { pairCommand } = await import('./commands/pair.js');
      await pairCommand();
    } catch (err: any) {
      handleCommandError(err, 'pair', 'Ensure chokidar is installed and your AI provider is configured.');
    }
  });

program
  .command('context <action> [target]')
  .description('Manage AI context files (show, add, remove, list, estimate)')
  .action(async (action: string, target?: string) => {
    try {
      const { contextCmdCommand } = await import('./commands/context-cmd.js');
      await contextCmdCommand(action, target);
    } catch (err: any) {
      handleCommandError(err, 'context', 'Run `orion context --help` for usage.');
    }
  });

// ─── Extensibility Commands ──────────────────────────────────────────────────
// plugin · api · regex · cron

program
  .command('plugin <action> [target]')
  .description('Manage Orion plugins (list, install, remove, create)')
  .action(async (action: string, target?: string) => {
    try {
      const { pluginCommand } = await import('./commands/plugin.js');
      await pluginCommand(action, target);
    } catch (err: any) {
      handleCommandError(err, 'plugin', 'Run `orion plugin --help` for usage.');
    }
  });

program
  .command('api [query]')
  .description('AI-powered API documentation lookup')
  .argument('[words...]', 'Additional query words')
  .action(async (query?: string, words?: string[]) => {
    try {
      const { apiLookupCommand } = await import('./commands/api-lookup.js');
      await apiLookupCommand(query, words);
    } catch (err: any) {
      handleCommandError(err, 'api', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('regex [description]')
  .description('AI regex helper (generate, explain, test)')
  .option('--explain <pattern>', 'Explain a regex pattern')
  .option('--test <pattern>', 'Test a regex pattern against a string')
  .argument('[testString]', 'Test string for --test mode')
  .action(async (description?: string, testString?: string, options?: { explain?: string; test?: string }) => {
    try {
      const { regexCommand } = await import('./commands/regex.js');
      await regexCommand(description, {
        explain: options?.explain,
        test: options?.test,
        testString,
      });
    } catch (err: any) {
      handleCommandError(err, 'regex', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('cron [description]')
  .description('Cron expression helper (generate, explain, next executions)')
  .option('--explain <expression>', 'Explain a cron expression')
  .option('--next <expression>', 'Show next execution times for a cron expression')
  .argument('[count]', 'Number of executions to show (for --next mode)')
  .action(async (description?: string, count?: string, options?: { explain?: string; next?: string }) => {
    try {
      const { cronHelperCommand } = await import('./commands/cron-helper.js');
      await cronHelperCommand(description, {
        explain: options?.explain,
        next: options?.next,
        count,
      });
    } catch (err: any) {
      handleCommandError(err, 'cron', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

// ─── Insights Commands ───────────────────────────────────────────────────────
// map · cost

program
  .command('map')
  .description('Generate repository structure map (like Aider\'s repo-map)')
  .option('--symbols', 'Include function/class/interface symbols')
  .option('--deps', 'Include dependency graph between files')
  .option('--output <file>', 'Save map to a file (markdown format)')
  .action(async (options: { symbols?: boolean; deps?: boolean; output?: string }) => {
    try {
      const { mapCommand } = await import('./commands/map.js');
      await mapCommand({
        symbols: options.symbols,
        deps: options.deps,
        output: options.output,
      });
    } catch (err: any) {
      handleCommandError(err, 'map', 'Run from a project directory.');
    }
  });

program
  .command('cost')
  .description('AI usage cost tracker with budget alerts')
  .option('--detailed', 'Show per-command breakdown and recent calls')
  .option('--reset', 'Reset cost tracking data')
  .option('--budget <amount>', 'Set monthly budget alert (USD)')
  .action(async (options: { detailed?: boolean; reset?: boolean; budget?: string }) => {
    try {
      const { costCommand } = await import('./commands/cost.js');
      await costCommand({
        detailed: options.detailed,
        reset: options.reset,
        budget: options.budget,
      });
    } catch (err: any) {
      handleCommandError(err, 'cost', 'Cost data is stored in ~/.orion/costs.json.');
    }
  });

// ─── Help Commands ───────────────────────────────────────────────────────────
// tutorial · examples · update · version

program
  .command('tutorial')
  .description('Interactive getting-started tutorial')
  .option('--skip', 'Show quick summary instead of full interactive walkthrough')
  .action(async (options: { skip?: boolean }) => {
    try {
      const { tutorialCommand } = await import('./commands/tutorial.js');
      await tutorialCommand({ skip: options.skip });
    } catch (err: any) {
      handleCommandError(err, 'tutorial');
    }
  });

program
  .command('examples [command]')
  .description('Show usage examples for any command')
  .action(async (command?: string) => {
    try {
      const { examplesCommand } = await import('./commands/examples.js');
      await examplesCommand(command);
    } catch (err: any) {
      handleCommandError(err, 'examples');
    }
  });

program
  .command('update')
  .description('Check for updates and show upgrade instructions')
  .action(async () => {
    try {
      console.log();
      console.log(colors.primary.bold(`  Orion CLI v${CURRENT_VERSION}`));
      console.log();
      const { execSync } = await import('child_process');
      let latestVersion: string | null = null;
      try {
        latestVersion = execSync(`npm view ${PACKAGE_NAME} version`, {
          timeout: 10000,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch {
        latestVersion = null;
      }
      if (latestVersion && latestVersion !== CURRENT_VERSION) {
        console.log(chalk.yellow(`  Update available: ${CURRENT_VERSION} \u2192 ${latestVersion}`));
        console.log(chalk.dim(`  Run: npm i -g ${PACKAGE_NAME}`));
      } else if (latestVersion) {
        console.log(chalk.green('  You are on the latest version.'));
      } else {
        console.log(chalk.dim('  Could not check for updates (network error or npm unavailable).'));
      }
      console.log();
    } catch (err: any) {
      handleCommandError(err, 'update', 'Check your network connection.');
    }
  });

program
  .command('info')
  .description('Show detailed version and environment info')
  .option('--json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const { versionCommand } = await import('./commands/version.js');
      await versionCommand({ json: options.json });
    } catch (err: any) {
      handleCommandError(err, 'info');
    }
  });

// ─── Default Action (no command) ─────────────────────────────────────────────

program.action(() => {
  printBanner();

  // ─── Categorized Quick Reference ────────────────────────────────────────
  const category = (label: string, cmds: string) => {
    const padded = (label + ':').padEnd(12);
    return `    ${palette.violet.bold(padded)}${cmds}`;
  };

  const cn = (name: string) => colors.command(name);
  const sep = palette.dim(' \u00B7 ');

  console.log(palette.violet.bold('  Commands'));
  console.log();
  console.log(category('Core', [cn('chat'), cn('ask'), cn('explain'), cn('review'), cn('fix'), cn('edit'), cn('commit')].join(sep)));
  console.log(category('Code', [cn('search'), cn('diff'), cn('pr'), cn('run'), cn('test'), cn('agent'), cn('refactor'), cn('compare')].join(sep)));
  console.log(category('Generate', [cn('plan'), cn('generate'), cn('docs'), cn('snippet'), cn('scaffold')].join(sep)));
  console.log(category('Tools', [cn('shell'), cn('todo'), cn('fetch'), cn('changelog'), cn('log'), cn('summarize'), cn('migrate'), cn('deps'), cn('format'), cn('translate'), cn('env')].join(sep)));
  console.log(category('Analysis', [cn('debug'), cn('benchmark'), cn('security'), cn('typecheck'), cn('optimize')].join(sep)));
  console.log(category('Safety', [cn('undo'), cn('status'), cn('doctor'), cn('clean')].join(sep)));
  console.log(category('Session', [cn('session'), cn('watch'), cn('config'), cn('init'), cn('gui'), cn('completions')].join(sep)));
  console.log(category('Git', [cn('hooks'), cn('alias'), cn('blame')].join(sep)));
  console.log(category('AI', [cn('learn'), cn('pair'), cn('context')].join(sep)));
  console.log(category('Extend', [cn('plugin'), cn('api'), cn('regex'), cn('cron')].join(sep)));
  console.log(category('Insights', [cn('map'), cn('cost')].join(sep)));
  console.log(category('Help', [cn('tutorial'), cn('examples'), cn('update'), cn('info')].join(sep)));
  console.log();

  // ─── Detailed Command List ──────────────────────────────────────────────
  const cmd = (name: string, args: string, desc: string) => {
    const cmdStr = colors.command(name);
    const argStr = args ? ' ' + palette.dim(args) : '';
    const padLen = 28 - name.length - (args ? args.length + 1 : 0);
    return `    ${cmdStr}${argStr}${' '.repeat(Math.max(padLen, 2))}${palette.dim(desc)}`;
  };

  console.log(palette.violet.bold('  Core'));
  console.log();
  console.log(cmd('orion chat', '', 'Interactive AI chat session'));
  console.log(cmd('orion ask', '"q" @files', 'AI question with file context'));
  console.log(cmd('orion explain', '[file]', 'Explain what a file does'));
  console.log(cmd('orion review', '[file]', 'AI code review'));
  console.log(cmd('orion fix', '[file]', 'Find and fix issues'));
  console.log(cmd('orion fix', '--auto [file]', 'Fix, test, iterate until passing'));
  console.log(cmd('orion edit', '<file>', 'AI-assisted file editing'));
  console.log(cmd('orion commit', '', 'AI commit message from staged changes'));
  console.log();
  console.log(palette.violet.bold('  Code'));
  console.log();
  console.log(cmd('orion search', '"pattern"', 'Search codebase + AI analysis'));
  console.log(cmd('orion diff', '[ref]', 'AI-powered diff review'));
  console.log(cmd('orion pr', '', 'Generate PR description from branch'));
  console.log(cmd('orion pr', '--title', 'Generate PR title only'));
  console.log(cmd('orion pr', '--review', 'AI reviews all branch changes'));
  console.log(cmd('orion run', '"command"', 'Run command, AI analyzes errors'));
  console.log(cmd('orion run', '--fix "cmd"', 'Run & auto-apply AI fixes'));
  console.log(cmd('orion test', '', 'Run tests, AI analyzes failures'));
  console.log(cmd('orion test', '--generate <f>', 'Generate tests for a file'));
  console.log(cmd('orion agent', '<tasks...>', 'Run AI tasks in parallel'));
  console.log(cmd('orion refactor', '<target> --rename', 'Rename symbol across codebase'));
  console.log(cmd('orion refactor', '<file> --extract', 'Extract code into a function'));
  console.log(cmd('orion refactor', '<file> --simplify', 'Simplify complex code'));
  console.log(cmd('orion refactor', '<dir> --unused', 'Find unused exports/imports'));
  console.log(cmd('orion compare', '<f1> <f2>', 'Compare two files with AI'));
  console.log(cmd('orion compare', '--approach "Q"', 'Compare tech approaches'));
  console.log();
  console.log(palette.violet.bold('  Generate'));
  console.log();
  console.log(cmd('orion plan', '"task"', 'AI implementation plan from task'));
  console.log(cmd('orion plan', '--execute "task"', 'Plan and execute immediately'));
  console.log(cmd('orion generate', 'component Name', 'Generate UI component'));
  console.log(cmd('orion generate', 'api /route', 'Generate API endpoint'));
  console.log(cmd('orion generate', 'model Name', 'Generate data model'));
  console.log(cmd('orion generate', 'hook useName', 'Generate custom hook'));
  console.log(cmd('orion generate', 'test file.ts', 'Generate tests for a file'));
  console.log(cmd('orion generate', 'service Name', 'Generate service class'));
  console.log(cmd('orion docs', '<file>', 'Generate JSDoc/docstrings'));
  console.log(cmd('orion docs', '<dir> --readme', 'Generate README for directory'));
  console.log(cmd('orion docs', '<file> --api', 'Generate API documentation'));
  console.log(cmd('orion snippet', 'save "name" --file f', 'Save code snippet from file'));
  console.log(cmd('orion snippet', 'list', 'List all saved snippets'));
  console.log(cmd('orion snippet', 'search "query"', 'Search snippets by keyword'));
  console.log(cmd('orion snippet', 'use "name"', 'Output snippet to stdout'));
  console.log(cmd('orion snippet', 'generate "desc"', 'AI-generate a new snippet'));
  console.log(cmd('orion scaffold', '', 'Interactive project creation wizard'));
  console.log(cmd('orion scaffold', 'react my-app', 'Create React project'));
  console.log(cmd('orion scaffold', 'next my-app', 'Create Next.js project'));
  console.log(cmd('orion scaffold', 'express my-api', 'Create Express API'));
  console.log(cmd('orion scaffold', '--list', 'List available templates'));
  console.log();
  console.log(palette.violet.bold('  Tools'));
  console.log();
  console.log(cmd('orion shell', '', 'AI-enhanced interactive shell'));
  console.log(cmd('orion todo', '', 'Scan for TODO/FIXME/HACK comments'));
  console.log(cmd('orion todo', '--fix', 'AI suggests fixes for TODOs'));
  console.log(cmd('orion todo', '--prioritize', 'AI ranks TODOs by importance'));
  console.log(cmd('orion fetch', '<url>', 'Fetch URL content for context'));
  console.log(cmd('orion fetch', '<url> --raw', 'Fetch raw content (no HTML strip)'));
  console.log(cmd('orion changelog', '', 'Generate changelog from git commits'));
  console.log(cmd('orion changelog', '--since v1.0', 'Changelog since a tag'));
  console.log(cmd('orion changelog', '--days 7', 'Changelog for last 7 days'));
  console.log(cmd('orion log', '', 'AI-enhanced git log with summary'));
  console.log(cmd('orion log', '--author "name"', 'Filter log by author'));
  console.log(cmd('orion log', '--since "1 week ago"', 'Filter log by time'));
  console.log(cmd('orion log', '--impact', 'AI rates each commit\'s impact'));
  console.log(cmd('orion summarize', '<file>', 'AI-powered file summary'));
  console.log(cmd('orion summarize', '<dir>', 'Summarize a directory/project'));
  console.log(cmd('orion summarize', '--meeting notes.md', 'Summarize meeting notes'));
  console.log(cmd('orion summarize', '--bullet --length short', 'Bullet points, short length'));
  console.log(cmd('orion migrate', '<file> --to ts', 'Migrate JS to TypeScript'));
  console.log(cmd('orion migrate', '<file> --to hooks', 'Class components to hooks'));
  console.log(cmd('orion migrate', '<file> --to async', 'Callbacks to async/await'));
  console.log(cmd('orion deps', '', 'Analyze project dependencies'));
  console.log(cmd('orion deps', '--security', 'Security vulnerability audit'));
  console.log(cmd('orion deps', '--outdated', 'Find outdated packages'));
  console.log(cmd('orion deps', '--unused', 'Find unused dependencies'));
  console.log(cmd('orion format', '<file>', 'Auto-format a file'));
  console.log(cmd('orion format', '<dir> --check', 'Check formatting without changes'));
  console.log(cmd('orion format', '<dir> --style airbnb', 'Format with specific style guide'));
  console.log(cmd('orion translate', '<file> --to korean', 'Translate comments to Korean'));
  console.log(cmd('orion translate', '<file> --to english', 'Translate comments to English'));
  console.log(cmd('orion translate', '"text" --to korean', 'Translate text to Korean'));
  console.log(cmd('orion env', 'check', 'Check env vars used in codebase'));
  console.log(cmd('orion env', 'suggest', 'AI suggests needed env vars'));
  console.log(cmd('orion env', 'template', 'Generate .env.example from .env'));
  console.log(cmd('orion env', 'validate', 'Validate .env against .env.example'));
  console.log();
  console.log(palette.violet.bold('  Analysis'));
  console.log();
  console.log(cmd('orion debug', '<file>', 'Analyze file for potential bugs'));
  console.log(cmd('orion debug', '--error "msg"', 'Diagnose a specific error'));
  console.log(cmd('orion debug', '--stacktrace', 'Paste stack trace for analysis'));
  console.log(cmd('orion benchmark', '<file>', 'Analyze file for performance'));
  console.log(cmd('orion benchmark', '--memory <f>', 'Memory usage analysis'));
  console.log(cmd('orion benchmark', '--complexity <f>', 'Time complexity analysis'));
  console.log(cmd('orion security', '<path>', 'Scan for security vulnerabilities'));
  console.log(cmd('orion security', '--owasp', 'OWASP Top 10 audit'));
  console.log(cmd('orion typecheck', '<file>', 'Analyze types, suggest improvements'));
  console.log(cmd('orion typecheck', '<file> --strict', 'Strict type safety audit'));
  console.log(cmd('orion typecheck', '<file> --convert', 'JS to TypeScript conversion'));
  console.log(cmd('orion optimize', '<file>', 'General optimization suggestions'));
  console.log(cmd('orion optimize', '<dir> --bundle', 'Bundle size optimization'));
  console.log(cmd('orion optimize', '<file> --sql', 'SQL query optimization'));
  console.log(cmd('orion optimize', '<file> --react', 'React rendering optimization'));
  console.log();
  console.log(palette.violet.bold('  Safety'));
  console.log();
  console.log(cmd('orion undo', '', 'Undo last file change'));
  console.log(cmd('orion undo', '--checkpoint', 'Restore a workspace checkpoint'));
  console.log(cmd('orion status', '', 'Show environment status'));
  console.log(cmd('orion doctor', '', 'Full health check'));
  console.log(cmd('orion clean', '', 'Interactive cleanup'));
  console.log(cmd('orion clean', '--all', 'Remove all Orion data'));
  console.log(cmd('orion clean', '--dry-run', 'Show what would be removed'));
  console.log();
  console.log(palette.violet.bold('  Session'));
  console.log();
  console.log(cmd('orion session', '<action>', 'Manage named AI sessions'));
  console.log(cmd('orion watch', '<pattern>', 'Watch files & auto-run AI'));
  console.log(cmd('orion config', '', 'Configure API keys'));
  console.log(cmd('orion init', '', 'Initialize Orion config'));
  console.log(cmd('orion gui', '', 'Launch Orion desktop app'));
  console.log(cmd('orion completions', '<shell>', 'Generate shell completions'));
  console.log();
  console.log(palette.violet.bold('  Git'));
  console.log();
  console.log(cmd('orion hooks', 'install', 'Install Orion git hooks'));
  console.log(cmd('orion hooks', 'uninstall', 'Remove Orion git hooks'));
  console.log(cmd('orion hooks', 'list', 'Show installed hooks'));
  console.log(cmd('orion hooks', 'install --hook X', 'Install a specific hook'));
  console.log(cmd('orion alias', 'set r "review"', 'Create command alias'));
  console.log(cmd('orion alias', 'list', 'List all aliases'));
  console.log(cmd('orion alias', 'remove r', 'Remove an alias'));
  console.log(cmd('orion blame', '<file>', 'AI blame analysis & ownership'));
  console.log(cmd('orion blame', '<file> --line 42', 'Explain why line 42 changed'));
  console.log(cmd('orion blame', '<file> --hotspots', 'Find high-churn sections'));
  console.log();
  console.log(palette.violet.bold('  Help'));
  console.log();
  console.log(cmd('orion tutorial', '', 'Interactive getting-started tutorial'));
  console.log(cmd('orion tutorial', '--skip', 'Quick summary (non-interactive)'));
  console.log(cmd('orion examples', '', 'Show all usage examples'));
  console.log(cmd('orion examples', '<command>', 'Examples for a specific command'));
  console.log(cmd('orion update', '', 'Check for latest version'));
  console.log(cmd('orion info', '', 'Detailed version & environment'));
  console.log(cmd('orion info', '--json', 'Version info as JSON'));
  console.log();
  console.log(palette.violet.bold('  AI'));
  console.log();
  console.log(cmd('orion learn', '', 'Analyze codebase, generate patterns'));
  console.log(cmd('orion learn', '--update', 'Update patterns from recent changes'));
  console.log(cmd('orion pair', '', 'Start AI pair programming session'));
  console.log(cmd('orion context', 'show', 'Show current AI context'));
  console.log(cmd('orion context', 'add <file>', 'Add file to permanent context'));
  console.log(cmd('orion context', 'remove <file>', 'Remove file from context'));
  console.log(cmd('orion context', 'list', 'List all context files'));
  console.log(cmd('orion context', 'estimate', 'Estimate token count of context'));
  console.log();
  console.log(palette.violet.bold('  Extensibility'));
  console.log();
  console.log(cmd('orion plugin', 'list', 'List installed plugins'));
  console.log(cmd('orion plugin', 'install ./p.js', 'Install a local plugin'));
  console.log(cmd('orion plugin', 'remove <name>', 'Remove an installed plugin'));
  console.log(cmd('orion plugin', 'create <name>', 'Scaffold a new plugin'));
  console.log(cmd('orion api', '<query>', 'Look up API documentation'));
  console.log(cmd('orion api', '"react useState"', 'Look up React hook docs'));
  console.log(cmd('orion api', 'node fs', 'Look up Node.js fs module'));
  console.log(cmd('orion regex', '"match emails"', 'AI generates regex pattern'));
  console.log(cmd('orion regex', '--explain "/pat/"', 'Explain a regex'));
  console.log(cmd('orion regex', '--test "/p/" "str"', 'Test regex against string'));
  console.log(cmd('orion cron', '"every mon 9am"', 'Generate cron expression'));
  console.log(cmd('orion cron', '--explain "0 9 * * 1"', 'Explain cron expression'));
  console.log(cmd('orion cron', '--next "0 9 * * 1" 5', 'Show next 5 executions'));
  console.log();
  console.log(palette.violet.bold('  Insights'));
  console.log();
  console.log(cmd('orion map', '', 'Generate repository structure map'));
  console.log(cmd('orion map', '--symbols', 'Include function/class symbols'));
  console.log(cmd('orion map', '--deps', 'Include dependency graph'));
  console.log(cmd('orion map', '--output map.md', 'Save map to file'));
  console.log(cmd('orion cost', '', 'Show AI usage cost summary'));
  console.log(cmd('orion cost', '--detailed', 'Per-command cost breakdown'));
  console.log(cmd('orion cost', '--reset', 'Reset cost tracking data'));
  console.log(cmd('orion cost', '--budget 10.00', 'Set monthly budget alert'));
  console.log();
  console.log(palette.violet.bold('  Pipe Support'));
  console.log();
  console.log(`    ${palette.dim('cat file.ts | orion ask "What\'s wrong?"')}`);
  console.log(`    ${palette.dim('git diff | orion review')}`);
  console.log(`    ${palette.dim('orion run "npm test"')}`);
  console.log(`    ${palette.dim('cat long-doc.md | orion summarize')}`);
  console.log(`    ${palette.dim('orion fetch https://docs.example.com/api | orion ask "How do I use this?"')}`);
  console.log();
  console.log(palette.violet.bold('  Global Flags'));
  console.log();
  console.log(`    ${palette.dim('--dry-run     Show changes without writing files')}`);
  console.log(`    ${palette.dim('--json        Output structured JSON (CI/CD)')}`);
  console.log(`    ${palette.dim('-y, --yes     Auto-confirm all prompts')}`);
  console.log(`    ${palette.dim('--quiet       Minimal output')}`);
  console.log();
  console.log(palette.dim('  Run orion <command> --help for more info on a command.'));
  console.log();
});

// ─── Alias Resolution for Unknown Commands ──────────────────────────────────

program.on('command:*', async (operands: string[]) => {
  const unknownCmd = operands[0];
  if (!unknownCmd) return;

  try {
    const { resolveAlias } = await import('./commands/alias.js');
    const expansion = resolveAlias(unknownCmd);

    if (expansion) {
      // Rebuild argv: replace the alias with the expanded command tokens
      const expandedTokens = expansion.split(/\s+/);
      const remainingArgs = process.argv.slice(3); // args after the alias name
      const newArgv = [process.argv[0], process.argv[1], ...expandedTokens, ...remainingArgs];

      console.log(chalk.dim(`  Alias: ${unknownCmd} => ${expansion}`));
      console.log();

      await program.parseAsync(newArgv);
      return;
    }
  } catch {
    // Alias module not available, fall through
  }

  // Try plugin commands (format: plugin-name:command)
  if (unknownCmd.includes(':')) {
    try {
      const { executePluginCommand } = await import('./commands/plugin.js');
      const remainingArgs = process.argv.slice(3);
      const handled = await executePluginCommand(unknownCmd, remainingArgs);
      if (handled) return;
    } catch {
      // Plugin module not available, fall through
    }
  }

  // No alias or plugin found - show error with suggestion
  console.log();
  printError(`Unknown command: ${colors.command(unknownCmd)}`);
  printInfo(`Run ${colors.command('orion --help')} for a list of commands.`);
  printInfo(`Or create an alias: ${colors.command(`orion alias set ${unknownCmd} "<command>"`)}`);
  console.log();
  process.exit(1);
});

// ─── Parse & Run ─────────────────────────────────────────────────────────────

program.parseAsync(process.argv).then(() => {
  // Non-blocking version check after command execution
  checkForUpdates().catch(() => {
    // Silently ignore version check failures
  });
});
