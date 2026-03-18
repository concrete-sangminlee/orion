/**
 * Orion CLI - AI Commit Message Generator
 * Generates conventional commit messages from staged changes
 */

import inquirer from 'inquirer';
import { askAI } from '../ai-client.js';
import {
  colors,
  printHeader,
  printDivider,
  printInfo,
  printSuccess,
  printError,
  printWarning,
  startSpinner,
  stopSpinner,
  isGitRepo,
  getStagedDiff,
  getStagedFiles,
  commitWithMessage,
  loadProjectContext,
} from '../utils.js';
import { createSilentStreamHandler, printCommandError } from '../shared.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';
import { commandHeader, box, errorDisplay, palette } from '../ui.js';

const COMMIT_SYSTEM_PROMPT = `You are a git commit message generator. Analyze the provided diff and generate a conventional commit message.

Rules:
1. Use conventional commit format: type(scope): description
2. Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
3. Keep the first line under 72 characters
4. Add a blank line then a body if the changes are complex
5. Be specific about what changed and why
6. Do NOT use markdown formatting
7. Output ONLY the commit message, nothing else

Examples:
- feat(auth): add JWT token refresh mechanism
- fix(api): handle null response in user endpoint
- refactor(utils): extract date formatting to shared helper`;

export async function commitCommand(): Promise<void> {
  console.log(commandHeader('Orion AI Commit'));

  // Check if we're in a git repo
  if (!isGitRepo()) {
    console.log(errorDisplay('Not a git repository', [
      'Run this command inside a git project directory.',
      `Run ${colors.command('git init')} to initialize a repository.`,
    ]));
    console.log();
    process.exit(1);
  }

  // Get staged changes
  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) {
    console.log(errorDisplay('No staged changes found', [
      `${colors.command('git add <files>')}   Stage specific files`,
      `${colors.command('git add -p')}        Stage interactively`,
    ]));
    console.log();
    process.exit(1);
  }

  // Show staged files
  printInfo(`Staged files (${stagedFiles.length}):`);
  for (const file of stagedFiles) {
    console.log(`    ${palette.blue(file)}`);
  }
  console.log();

  // Get the diff
  const diff = getStagedDiff();
  if (!diff) {
    printWarning('Staged diff is empty.');
    printInfo('Your staged files may contain only whitespace changes.');
    process.exit(1);
  }

  // Truncate very large diffs
  const maxDiffLength = 8000;
  const truncatedDiff = diff.length > maxDiffLength
    ? diff.substring(0, maxDiffLength) + '\n\n... [diff truncated for AI processing]'
    : diff;

  // Generate commit message
  const spinner = startSpinner('Generating commit message...');

  try {
    const userMessage = `Generate a commit message for these changes:\n\nStaged files:\n${stagedFiles.join('\n')}\n\nDiff:\n${truncatedDiff}`;

    const projectContext = loadProjectContext();
    const fullSystemPrompt = projectContext
      ? COMMIT_SYSTEM_PROMPT + '\n\nProject context:\n' + projectContext
      : COMMIT_SYSTEM_PROMPT;

    const { callbacks, getResponse } = createSilentStreamHandler(spinner, 'Commit message generated');

    await askAI(fullSystemPrompt, userMessage, callbacks);

    const commitMessage = getResponse().trim();

    // Display the suggested message
    const pipelineOpts = getPipelineOptions();

    if (pipelineOpts.json) {
      jsonOutput('commit_message', { message: commitMessage, files: stagedFiles });
    }

    if (!pipelineOpts.quiet) {
      console.log();
      console.log(box(commitMessage, { title: 'Generated Commit Message', color: '#22C55E', padding: 1 }));
      console.log();
    }

    // Auto-confirm when --yes is set (non-interactive / pipeline mode)
    let action: string;
    if (pipelineOpts.yes) {
      action = 'commit';
    } else {
      const answer = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { name: 'Commit with this message', value: 'commit' },
            { name: 'Edit the message', value: 'edit' },
            { name: 'Regenerate', value: 'regenerate' },
            { name: 'Cancel', value: 'cancel' },
          ],
        },
      ]);
      action = answer.action;
    }

    if (action === 'commit') {
      const commitSpinner = startSpinner('Committing...');
      try {
        const result = commitWithMessage(commitMessage);
        stopSpinner(commitSpinner, 'Committed successfully!');
        if (!pipelineOpts.quiet) {
          console.log(colors.dim(`  ${result}`));
        }
        jsonOutput('commit_result', { success: true, result });
      } catch (err: any) {
        stopSpinner(commitSpinner, `Commit failed: ${err.message}`, false);
        printInfo('Check that your staged files are valid and try again.');
        jsonOutput('commit_result', { success: false, error: err.message });
        process.exit(1);
      }
    } else if (action === 'edit') {
      const { editedMessage } = await inquirer.prompt([
        {
          type: 'editor',
          name: 'editedMessage',
          message: 'Edit your commit message:',
          default: commitMessage,
        },
      ]);

      if (editedMessage.trim()) {
        const commitSpinner = startSpinner('Committing...');
        try {
          const result = commitWithMessage(editedMessage.trim());
          stopSpinner(commitSpinner, 'Committed successfully!');
          console.log(colors.dim(`  ${result}`));
        } catch (err: any) {
          stopSpinner(commitSpinner, `Commit failed: ${err.message}`, false);
          process.exit(1);
        }
      } else {
        printWarning('Empty message. Commit cancelled.');
      }
    } else if (action === 'regenerate') {
      await commitCommand();
    } else {
      printInfo('Commit cancelled.');
    }
  } catch (err: any) {
    printCommandError(err, 'commit', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}
