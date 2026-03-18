#!/usr/bin/env node

/**
 * Orion CLI - AI-Powered Coding Assistant
 *
 * A premium terminal tool for AI-assisted development.
 * Supports Anthropic Claude, OpenAI GPT, and local Ollama models.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { printBanner, colors, printError, printInfo } from './utils.js';
import { chatCommand } from './commands/chat.js';
import { askCommand } from './commands/ask.js';
import { reviewCommand } from './commands/review.js';
import { commitCommand } from './commands/commit.js';
import { editCommand } from './commands/edit.js';
import { explainCommand } from './commands/explain.js';
import { fixCommand } from './commands/fix.js';
import { configCommand, initCommand } from './commands/config.js';
import { agentCommand } from './commands/agent.js';
import { sessionCommand } from './commands/session.js';
import { watchCommand } from './commands/watch.js';
import { setPipelineOptions } from './pipeline.js';
import { errorDisplay, palette } from './ui.js';

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
  .version('2.0.0', '-v, --version', 'Show Orion CLI version')
  .description('AI-powered coding assistant for the terminal')
  .option('--json', 'Output structured JSON to stdout (for CI/CD pipelines)')
  .option('-y, --yes', 'Auto-confirm all prompts (non-interactive mode)')
  .option('--no-color', 'Disable color output')
  .option('--quiet', 'Minimal output')
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
    });
  });

// ─── Commands ────────────────────────────────────────────────────────────────

program
  .command('chat')
  .description('Start an interactive AI chat session')
  .action(async () => {
    try {
      await chatCommand();
    } catch (err: any) {
      handleCommandError(err, 'chat', 'Run `orion config` to set up API keys.');
    }
  });

program
  .command('ask <question>')
  .description('Ask a quick one-shot question')
  .action(async (question: string) => {
    try {
      await askCommand(question);
    } catch (err: any) {
      handleCommandError(err, 'ask', 'Ensure your AI provider is configured. Run `orion config`.');
    }
  });

program
  .command('edit <file>')
  .description('AI-assisted file editing')
  .action(async (file: string) => {
    try {
      await editCommand(file);
    } catch (err: any) {
      handleCommandError(err, 'edit', 'Check that the file exists and your AI provider is configured.');
    }
  });

program
  .command('review [file]')
  .description('AI code review (file or current directory)')
  .action(async (file?: string) => {
    try {
      await reviewCommand(file);
    } catch (err: any) {
      handleCommandError(err, 'review', 'Ensure the file exists or run from a project directory.');
    }
  });

program
  .command('commit')
  .description('Generate AI commit message from staged changes')
  .action(async () => {
    try {
      await commitCommand();
    } catch (err: any) {
      handleCommandError(err, 'commit', 'Stage changes with `git add` first, then run `orion commit`.');
    }
  });

program
  .command('explain [file]')
  .description('AI-powered code explanation (accepts piped input)')
  .action(async (file?: string) => {
    try {
      await explainCommand(file);
    } catch (err: any) {
      handleCommandError(err, 'explain', 'Check that the file exists and your AI provider is configured.');
    }
  });

program
  .command('fix [file]')
  .description('Find and fix issues in a file (accepts piped input)')
  .action(async (file?: string) => {
    try {
      await fixCommand(file);
    } catch (err: any) {
      handleCommandError(err, 'fix', 'Check that the file exists and your AI provider is configured.');
    }
  });

program
  .command('init')
  .description('Initialize Orion config in current project')
  .action(async () => {
    try {
      await initCommand();
    } catch (err: any) {
      handleCommandError(err, 'init', 'Make sure you have write permissions in the current directory.');
    }
  });

program
  .command('gui')
  .description('Launch the Orion desktop app (Electron)')
  .action(() => {
    console.log();
    console.log(colors.primary.bold('  Launching Orion IDE...'));
    console.log();

    try {
      const { execSync } = require('child_process');
      execSync('npm run electron:dev', {
        stdio: 'inherit',
        cwd: __dirname.includes('dist-cli')
          ? require('path').resolve(__dirname, '..')
          : process.cwd(),
      });
    } catch {
      console.log();
      printError('Could not launch Electron app.');
      printInfo('Make sure you are in the Orion project directory.');
      printInfo(`Run ${colors.command('npm run electron:dev')} manually.`);
      console.log();
    }
  });

program
  .command('config')
  .description('Configure API keys and preferences')
  .action(async () => {
    try {
      await configCommand();
    } catch (err: any) {
      handleCommandError(err, 'config', 'Check file permissions for ~/.orion/config.json.');
    }
  });

// ─── Multi-Agent & Competitive Features ──────────────────────────────────────

program
  .command('agent')
  .description('Run multiple AI tasks in parallel (multi-agent)')
  .argument('<tasks...>', 'Task descriptions to run in parallel')
  .option('--parallel <n>', 'Max concurrent tasks (default: 3)', '3')
  .option('--provider <name>', 'Force a specific AI provider for all tasks')
  .option('--no-save', 'Do not save results to .orion/agents/')
  .action(async (tasks: string[], options: { parallel?: string; provider?: string; save?: boolean }) => {
    try {
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
  .command('session')
  .description('Manage named AI sessions')
  .argument('<action>', 'Action: new, list, resume, export, delete')
  .argument('[name]', 'Session name (required for new, resume, export, delete)')
  .action(async (action: string, name?: string) => {
    try {
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
      await watchCommand(pattern, {
        onChange: options.onChange,
        debounce: parseInt(options.debounce || '300', 10),
        ignore: options.ignore,
      });
    } catch (err: any) {
      handleCommandError(err, 'watch', 'Ensure chokidar is installed and your AI provider is configured.');
    }
  });

// ─── Default Action (no command) ─────────────────────────────────────────────

program.action(() => {
  printBanner();

  const cmd = (name: string, args: string, desc: string) => {
    const cmdStr = colors.command(name);
    const argStr = args ? ' ' + palette.dim(args) : '';
    const padLen = 28 - name.length - (args ? args.length + 1 : 0);
    return `    ${cmdStr}${argStr}${' '.repeat(Math.max(padLen, 2))}${palette.dim(desc)}`;
  };

  console.log(palette.violet.bold('  Core Commands'));
  console.log();
  console.log(cmd('orion chat', '', 'Interactive AI chat session'));
  console.log(cmd('orion ask', '"question"', 'Quick one-shot AI question'));
  console.log(cmd('orion edit', '<file>', 'AI-assisted file editing'));
  console.log(cmd('orion review', '[file]', 'AI code review'));
  console.log(cmd('orion commit', '', 'Generate AI commit message'));
  console.log(cmd('orion explain', '[file]', 'Explain what a file does'));
  console.log(cmd('orion fix', '[file]', 'Find and fix issues'));
  console.log();
  console.log(palette.violet.bold('  Multi-Agent & Automation'));
  console.log();
  console.log(cmd('orion agent', '<tasks...>', 'Run AI tasks in parallel'));
  console.log(cmd('orion session', '<action>', 'Manage named AI sessions'));
  console.log(cmd('orion watch', '<pattern>', 'Watch files & auto-run AI'));
  console.log();
  console.log(palette.violet.bold('  Setup'));
  console.log();
  console.log(cmd('orion init', '', 'Initialize Orion config'));
  console.log(cmd('orion gui', '', 'Launch desktop app'));
  console.log(cmd('orion config', '', 'Configure API keys'));
  console.log();
  console.log(palette.violet.bold('  Pipe Support'));
  console.log();
  console.log(`    ${palette.dim('cat file.ts | orion ask "What\'s wrong?"')}`);
  console.log(`    ${palette.dim('git diff | orion review')}`);
  console.log(`    ${palette.dim('cat app.ts | orion explain')}`);
  console.log();
  console.log(palette.dim('  Run orion <command> --help for more info on a command.'));
  console.log();
});

// ─── Parse & Run ─────────────────────────────────────────────────────────────

program.parse(process.argv);
