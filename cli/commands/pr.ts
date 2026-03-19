/**
 * Orion CLI - PR (Pull Request) Helper Command
 * Generate PR descriptions, titles, and AI-powered branch reviews.
 *
 * Usage:
 *   orion pr                  # Generate PR description from current branch
 *   orion pr --title          # Generate PR title only
 *   orion pr --review         # Review current branch changes as if reviewing a PR
 */

import { askAI } from '../ai-client.js';
import {
  colors,
  startSpinner,
  isGitRepo,
  runGitCommand,
  getCurrentDirectoryContext,
  loadProjectContext,
  printError,
  printInfo,
  printWarning,
} from '../utils.js';
import { createStreamHandler, createSilentStreamHandler, printCommandError } from '../shared.js';
import { renderMarkdown } from '../markdown.js';
import { commandHeader, divider, palette, severityBadge, table } from '../ui.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';

// ─── System Prompts ──────────────────────────────────────────────────────────

const PR_DESCRIPTION_PROMPT = `You are Orion, an expert developer writing a pull request description.
Given a branch name, commit log, and diff, generate a well-structured PR description in markdown.

Output format:
## Title
<A concise, descriptive PR title (max 72 chars). Use conventional format like "feat:", "fix:", "refactor:" etc.>

## Summary
<1-3 sentence overview of what this PR does and why>

## Changes
<Bullet list of key changes, grouped by category if there are many>

## Testing
<Suggested testing approach or checklist>

## Notes
<Any migration steps, breaking changes, or reviewer notes. Omit this section if not applicable.>

Be specific and reference actual file names and functionality from the diff.
Do NOT invent changes that aren't in the diff. Be concise but thorough.`;

const PR_TITLE_PROMPT = `You are Orion, an expert developer writing a pull request title.
Given a branch name, commit log, and diff summary, generate ONLY a PR title.

Rules:
1. Max 72 characters
2. Use conventional commit prefix: feat:, fix:, refactor:, docs:, chore:, perf:, test:, style:, ci:, build:
3. Be specific about what changed
4. Output ONLY the title text, nothing else (no quotes, no markdown, no explanation)`;

const PR_REVIEW_PROMPT = `You are Orion, a senior code reviewer performing a thorough pull request review.
Review all changes on this branch compared to the base branch.

For each finding, use this exact severity format:
[ERROR] <title>: <description>
[WARNING] <title>: <description>
[INFO] <title>: <description>

Review categories:
- **Bugs & Logic**: Logic errors, edge cases, null safety, off-by-one errors
- **Security**: Exposed secrets, injection risks, auth issues, input validation
- **Performance**: N+1 queries, unnecessary allocations, blocking calls, complexity
- **Code Quality**: Naming, duplication, dead code, magic numbers, error handling
- **Architecture**: Separation of concerns, coupling, SOLID violations
- **Testing**: Missing tests, untested edge cases, test quality

End with:
1. **Overall Assessment**: A 1-paragraph summary of the branch quality
2. **Risk Level**: LOW / MEDIUM / HIGH / CRITICAL
3. **Verdict**: APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION
4. **Top Priorities**: Numbered list of the most important items to address (max 5)

Be fair: if the code is well-written, say so. Don't invent problems.
Reference specific files and line contexts when possible.`;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PrCommandOptions {
  title?: boolean;
  review?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectBaseBranch(): string {
  // Try main first, then master
  try {
    runGitCommand('rev-parse --verify main');
    return 'main';
  } catch {
    try {
      runGitCommand('rev-parse --verify master');
      return 'master';
    } catch {
      // Fallback: try to find the default branch from remote
      try {
        const remoteBranch = runGitCommand('symbolic-ref refs/remotes/origin/HEAD');
        return remoteBranch.replace('refs/remotes/origin/', '');
      } catch {
        return 'main'; // ultimate fallback
      }
    }
  }
}

function getCurrentBranch(): string {
  return runGitCommand('rev-parse --abbrev-ref HEAD');
}

function getBranchLog(baseBranch: string): string {
  try {
    return runGitCommand(`log ${baseBranch}..HEAD --oneline`);
  } catch {
    return '';
  }
}

function getBranchDiff(baseBranch: string): string {
  try {
    return runGitCommand(`diff ${baseBranch}..HEAD`);
  } catch {
    return '';
  }
}

function getBranchDiffStat(baseBranch: string): string {
  try {
    return runGitCommand(`diff ${baseBranch}..HEAD --stat`);
  } catch {
    return '';
  }
}

// ─── Severity Renderer ──────────────────────────────────────────────────────

function renderReviewOutput(text: string): void {
  const lines = text.split('\n');
  const nonSeverityLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[ERROR]')) {
      flushMarkdown(nonSeverityLines);
      console.log(`  ${severityBadge('error')} ${palette.red(trimmed.replace('[ERROR] ', ''))}`);
    } else if (trimmed.startsWith('[WARNING]')) {
      flushMarkdown(nonSeverityLines);
      console.log(`  ${severityBadge('warning')} ${palette.yellow(trimmed.replace('[WARNING] ', ''))}`);
    } else if (trimmed.startsWith('[INFO]')) {
      flushMarkdown(nonSeverityLines);
      console.log(`  ${severityBadge('info')} ${palette.blue(trimmed.replace('[INFO] ', ''))}`);
    } else {
      nonSeverityLines.push(line);
    }
  }

  flushMarkdown(nonSeverityLines);
}

function flushMarkdown(lines: string[]): void {
  if (lines.length === 0) return;
  const block = lines.join('\n');
  if (block.trim()) {
    console.log(renderMarkdown(block));
  }
  lines.length = 0;
}

// ─── Command Entry Point ────────────────────────────────────────────────────

export async function prCommand(options: PrCommandOptions = {}): Promise<void> {
  const pipelineOpts = getPipelineOptions();

  // Verify git repo
  if (!isGitRepo()) {
    console.log();
    printError('Not a git repository.');
    printInfo('Run this command inside a git project.');
    console.log();
    process.exit(1);
  }

  // Detect base branch and current branch
  const spinner = startSpinner('Analyzing branch...');
  let baseBranch: string;
  let currentBranch: string;

  try {
    baseBranch = detectBaseBranch();
    currentBranch = getCurrentBranch();
  } catch (err: any) {
    spinner.fail(palette.red('Failed to detect branches'));
    console.log(`  ${palette.dim(err.message)}`);
    console.log();
    process.exit(1);
    return;
  }

  if (currentBranch === baseBranch) {
    spinner.fail(palette.red(`Already on ${baseBranch}`));
    console.log();
    printWarning(`You are on the base branch (${baseBranch}). Switch to a feature branch first.`);
    printInfo('Example: git checkout -b feature/my-feature');
    console.log();
    return;
  }

  // Get commit log and diff
  const commitLog = getBranchLog(baseBranch);
  const diff = getBranchDiff(baseBranch);
  const diffStat = getBranchDiffStat(baseBranch);

  if (!commitLog && !diff) {
    spinner.fail(palette.red('No changes found'));
    console.log();
    printWarning(`No commits or changes found between ${currentBranch} and ${baseBranch}.`);
    printInfo('Make sure you have committed changes on this branch.');
    console.log();
    return;
  }

  const commitCount = commitLog ? commitLog.trim().split('\n').filter(Boolean).length : 0;
  spinner.succeed(palette.green(`Found ${commitCount} commit(s) on ${currentBranch}`));

  // ─── Title Only Mode ────────────────────────────────────────────────────
  if (options.title) {
    console.log(commandHeader('Orion PR Title Generator', [
      ['Branch', `${currentBranch} -> ${baseBranch}`],
      ['Commits', `${commitCount}`],
    ]));

    const titleSpinner = startSpinner('Generating PR title...');

    const context = getCurrentDirectoryContext();
    const projectContext = loadProjectContext();
    const fullSystemPrompt = projectContext
      ? PR_TITLE_PROMPT + '\n\nWorkspace context:\n' + context + '\n\nProject context:\n' + projectContext
      : PR_TITLE_PROMPT + '\n\nWorkspace context:\n' + context;

    const userMessage = `Generate a PR title for this branch.\n\nBranch: ${currentBranch}\nBase: ${baseBranch}\n\nCommit log:\n${commitLog}\n\nDiff summary:\n${diffStat}`;

    try {
      const { callbacks, getResponse } = createSilentStreamHandler(titleSpinner, 'Title generated');
      await askAI(fullSystemPrompt, userMessage, callbacks);

      const title = getResponse().trim().replace(/^["']|["']$/g, '');

      console.log();
      console.log(`  ${palette.violet.bold('PR Title:')}`);
      console.log(`  ${palette.white(title)}`);
      console.log();

      jsonOutput('pr-title', { branch: currentBranch, baseBranch, title });
    } catch (err: any) {
      printCommandError(err, 'pr', 'Run `orion config` to check your AI provider settings.');
      process.exit(1);
    }

    return;
  }

  // ─── Review Mode ────────────────────────────────────────────────────────
  if (options.review) {
    console.log(commandHeader('Orion PR Review', [
      ['Branch', `${currentBranch} -> ${baseBranch}`],
      ['Commits', `${commitCount}`],
    ]));

    // Truncate large diffs
    const MAX_DIFF_CHARS = 30000;
    let diffForAI = diff;
    let truncated = false;
    if (diff.length > MAX_DIFF_CHARS) {
      diffForAI = diff.substring(0, MAX_DIFF_CHARS);
      truncated = true;
      console.log(`  ${palette.yellow('! Diff truncated to ~30K chars for AI review. Full diff has ' + diff.length.toLocaleString() + ' chars.')}`);
      console.log();
    }

    const reviewSpinner = startSpinner('AI is reviewing branch changes...');

    const context = getCurrentDirectoryContext();
    const projectContext = loadProjectContext();
    const fullSystemPrompt = projectContext
      ? PR_REVIEW_PROMPT + '\n\nWorkspace context:\n' + context + '\n\nProject context:\n' + projectContext
      : PR_REVIEW_PROMPT + '\n\nWorkspace context:\n' + context;

    const userMessage = truncated
      ? `Review all changes on branch "${currentBranch}" (vs ${baseBranch}). Note: diff was truncated due to size.\n\nCommit log:\n${commitLog}\n\nDiff:\n\`\`\`diff\n${diffForAI}\n\`\`\``
      : `Review all changes on branch "${currentBranch}" (vs ${baseBranch}).\n\nCommit log:\n${commitLog}\n\nDiff:\n\`\`\`diff\n${diffForAI}\n\`\`\``;

    try {
      let fullResponse = '';

      await askAI(fullSystemPrompt, userMessage, {
        onToken(token: string) {
          reviewSpinner.stop();
          fullResponse += token;
        },
        onComplete(text: string) {
          console.log();
          renderReviewOutput(text);
          console.log();
        },
        onError(error: Error) {
          reviewSpinner.fail(palette.red(error.message));
        },
      });

      jsonOutput('pr-review', { branch: currentBranch, baseBranch, commitCount });
    } catch (err: any) {
      printCommandError(err, 'pr', 'Run `orion config` to check your AI provider settings.');
      process.exit(1);
    }

    return;
  }

  // ─── Default: Generate Full PR Description ──────────────────────────────

  console.log(commandHeader('Orion PR Description Generator', [
    ['Branch', `${currentBranch} -> ${baseBranch}`],
    ['Commits', `${commitCount}`],
  ]));

  // Show commit log
  if (!pipelineOpts.quiet && commitLog) {
    console.log(`  ${palette.violet.bold('Commits')}`);
    const commitLines = commitLog.trim().split('\n');
    for (const line of commitLines.slice(0, 15)) {
      const [hash, ...rest] = line.split(' ');
      console.log(`  ${palette.dim(hash)} ${rest.join(' ')}`);
    }
    if (commitLines.length > 15) {
      console.log(`  ${palette.dim(`...and ${commitLines.length - 15} more`)}`);
    }
    console.log();
    console.log(divider());
    console.log();
  }

  // Truncate large diffs
  const MAX_DIFF_CHARS = 30000;
  let diffForAI = diff;
  let truncated = false;
  if (diff.length > MAX_DIFF_CHARS) {
    diffForAI = diff.substring(0, MAX_DIFF_CHARS);
    truncated = true;
    console.log(`  ${palette.yellow('! Diff truncated to ~30K chars for AI analysis. Full diff has ' + diff.length.toLocaleString() + ' chars.')}`);
    console.log();
  }

  const aiSpinner = startSpinner('Generating PR description...');

  const context = getCurrentDirectoryContext();
  const projectContext = loadProjectContext();
  const fullSystemPrompt = projectContext
    ? PR_DESCRIPTION_PROMPT + '\n\nWorkspace context:\n' + context + '\n\nProject context:\n' + projectContext
    : PR_DESCRIPTION_PROMPT + '\n\nWorkspace context:\n' + context;

  const userMessage = truncated
    ? `Generate a PR description for branch "${currentBranch}" (target: ${baseBranch}). Note: diff was truncated due to size.\n\nCommit log:\n${commitLog}\n\nDiff stat:\n${diffStat}\n\nDiff:\n\`\`\`diff\n${diffForAI}\n\`\`\``
    : `Generate a PR description for branch "${currentBranch}" (target: ${baseBranch}).\n\nCommit log:\n${commitLog}\n\nDiff stat:\n${diffStat}\n\nDiff:\n\`\`\`diff\n${diffForAI}\n\`\`\``;

  try {
    const { callbacks, getResponse } = createStreamHandler(aiSpinner, {
      markdown: true,
    });

    await askAI(fullSystemPrompt, userMessage, callbacks);

    const description = getResponse();

    jsonOutput('pr-description', {
      branch: currentBranch,
      baseBranch,
      commitCount,
      description,
    });
  } catch (err: any) {
    printCommandError(err, 'pr', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}
