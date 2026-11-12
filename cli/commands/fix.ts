/**
 * Orion CLI - Auto-Fix Command
 * AI-powered code fixing with diff preview, severity display, and confirmation
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
  writeFileContent,
  readFileContent,
  formatDiff,
  loadProjectContext,
  detectTestCommand,
  runShellCommand,
  isGitRepo,
  gitAutoCommit,
} from '../utils.js';
import { renderMarkdown } from '../markdown.js';
import {
  createSilentStreamHandler,
  readAndValidateFile,
  printFileInfo,
  printCommandError,
} from '../shared.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';
import { readStdin } from '../stdin.js';
import { commandHeader, severityBadge, diffBlock, divider, palette } from '../ui.js';
import { createBackup } from '../backup.js';

const FIX_ANALYSIS_PROMPT = `You are Orion, an expert code fixer. Analyze the provided code for issues.

First, list all issues found using this format:
[ERROR] <issue description> (line ~N)
[WARNING] <issue description> (line ~N)
[INFO] <suggestion> (line ~N)

Then output a separator line: ---FIX---

Then output ONLY the complete fixed file content with all issues resolved.
Do NOT wrap the fixed code in code fences or markdown.
Output raw code after the ---FIX--- separator.

Focus on:
- Bugs and logic errors
- Type errors and null safety
- Missing error handling
- Security issues
- Performance problems
- Best practice violations`;

export interface FixCommandOptions {
  auto?: boolean;
  maxIterations?: number;
  noCommit?: boolean;
}

export async function fixCommand(filePath?: string, options?: FixCommandOptions): Promise<void> {
  // Check for piped stdin data
  const stdinData = await readStdin();
  const isStdinMode = !filePath && !!stdinData;

  let originalContent: string;
  let userMessage: string;
  let fileLabel: string;

  if (filePath) {
    const file = readAndValidateFile(filePath);
    if (!file) {
      process.exit(1);
    }

    console.log(commandHeader('Orion Auto-Fix', [
      ['File', colors.file(file.resolvedPath)],
      ['Language', `${file.language} \u00B7 ${file.lineCount} lines`],
    ]));

    originalContent = file.content;
    userMessage = `Fix issues in this ${file.language} file (${file.fileName}):\n\n\`\`\`${file.language}\n${file.content}\n\`\`\``;
    fileLabel = file.resolvedPath;
  } else if (stdinData) {
    const lineCount = stdinData.split('\n').length;
    console.log(commandHeader('Orion Auto-Fix', [
      ['Source', 'piped input'],
      ['Lines', String(lineCount)],
    ]));

    originalContent = stdinData;
    userMessage = `Fix issues in this code:\n\n\`\`\`\n${stdinData}\n\`\`\``;
    fileLabel = '(stdin)';
  } else {
    console.log(commandHeader('Orion Auto-Fix'));
    console.log();
    console.log(`  ${colors.error('Please provide a file path or pipe content via stdin.')}`);
    console.log(`  ${palette.dim('Usage: orion fix <file>')}`);
    console.log(`  ${palette.dim('       cat app.ts | orion fix')}`);
    console.log();
    process.exit(1);
  }

  const spinner = startSpinner('Scanning for issues...');

  try {
    const projectContext = loadProjectContext();
    const fullSystemPrompt = projectContext
      ? FIX_ANALYSIS_PROMPT + '\n\nProject context:\n' + projectContext
      : FIX_ANALYSIS_PROMPT;

    const { callbacks, getResponse } = createSilentStreamHandler(spinner, 'Analysis complete');

    await askAI(fullSystemPrompt, userMessage, callbacks, { requireComplete: true });

    const fullResponse = getResponse();

    // Parse the response
    const parts = fullResponse.split('---FIX---');
    const analysis = parts[0]?.trim() || '';
    let fixedContent = parts[1]?.trim() || '';

    // Show analysis with severity coloring (to stderr so stdout stays clean for piping)
    const output = isStdinMode ? process.stderr : process.stdout;
    const log = (...args: any[]) => output.write(args.join(' ') + '\n');

    log();
    log(divider('Issues Found'));
    log();

    const analysisLines = analysis.split('\n');
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    const otherLines: string[] = [];

    for (const line of analysisLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[ERROR]')) {
        errorCount++;
        log(`  ${severityBadge('error')} ${palette.red(trimmed.replace('[ERROR] ', ''))}`);
      } else if (trimmed.startsWith('[WARNING]')) {
        warningCount++;
        log(`  ${severityBadge('warning')} ${palette.yellow(trimmed.replace('[WARNING] ', ''))}`);
      } else if (trimmed.startsWith('[INFO]')) {
        infoCount++;
        log(`  ${severityBadge('info')} ${palette.blue(trimmed.replace('[INFO] ', ''))}`);
      } else if (trimmed) {
        otherLines.push(line);
      }
    }

    // Render any non-severity text as markdown
    if (otherLines.length > 0) {
      const mdText = otherLines.join('\n').trim();
      if (mdText) {
        log(renderMarkdown(mdText));
      }
    }

    log();
    log(
      `  Summary: ${palette.red(`${errorCount} errors`)} | ` +
      `${palette.yellow(`${warningCount} warnings`)} | ` +
      `${palette.blue(`${infoCount} suggestions`)}`
    );

    // Clean up potential code fences
    if (fixedContent.startsWith('```')) {
      const lines = fixedContent.split('\n');
      lines.shift();
      if (lines[lines.length - 1]?.trim() === '```') {
        lines.pop();
      }
      fixedContent = lines.join('\n');
    }

    // Checked after removing fences: a reply of only a fence is an empty file.
    if (!fixedContent.trim()) {
      log();
      process.stderr.write(`  ${colors.info('i')} No fixable issues found, or AI did not provide fixes.\n`);
      return;
    }

    const pipelineOpts = getPipelineOptions();

    // In stdin mode, output fixed content to stdout for piping (e.g., cat app.ts | orion fix > fixed.ts)
    if (isStdinMode) {
      if (pipelineOpts.json) {
        jsonOutput('fix_analysis', {
          file: fileLabel,
          errors: errorCount,
          warnings: warningCount,
          suggestions: infoCount,
        });
      }
      process.stdout.write(fixedContent);
      return;
    }

    // File mode: show diff and prompt for confirmation
    if (pipelineOpts.json) {
      jsonOutput('fix_analysis', {
        file: fileLabel,
        errors: errorCount,
        warnings: warningCount,
        suggestions: infoCount,
      });
    }

    if (!pipelineOpts.quiet) {
      console.log();
      console.log(diffBlock(originalContent, fixedContent, filePath || '(stdin)'));
      console.log();
    }

    // Auto-confirm when --yes is set (non-interactive / pipeline mode)
    let action: string;
    if (pipelineOpts.yes) {
      action = 'apply';
    } else {
      const answer = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'Apply these fixes?',
          choices: [
            { name: 'Apply all fixes', value: 'apply' },
            { name: 'Cancel', value: 'cancel' },
          ],
        },
      ]);
      action = answer.action;
    }

    if (action === 'apply') {
      // Dry-run mode: show what would change without writing
      if (pipelineOpts.dryRun) {
        printInfo('Dry run: no files were modified.');
        jsonOutput('fix_result', { success: true, file: fileLabel, dryRun: true });
      } else {
        // Create backup before modifying the file
        try {
          const backupPath = createBackup(filePath!);
          printInfo(`Backup saved: ${palette.dim(backupPath)}`);
        } catch (backupErr: any) {
          printInfo(`Backup skipped: ${backupErr.message}`);
        }

        writeFileContent(filePath!, fixedContent);
        printSuccess(`Fixed file saved: ${fileLabel}`);
        jsonOutput('fix_result', { success: true, file: fileLabel });

        // ─── Auto Edit-Lint-Test Loop (--auto) ──────────────────────────
        if (options?.auto && filePath) {
          const maxIter = options.maxIterations ?? 3;
          const testCmd = detectTestCommand();

          if (!testCmd) {
            printWarning('No test command detected. Skipping auto-test loop.');
            printInfo('Tip: Add a "test" script to package.json, or use pytest/cargo test/go test.');
          } else {
            printInfo(`Test runner detected: ${palette.bold(testCmd)}`);
            console.log();

            let testsPass = false;

            for (let iteration = 1; iteration <= maxIter; iteration++) {
              const iterLabel = `Iteration ${iteration}/${maxIter}`;
              process.stdout.write(`  ${palette.violet(iterLabel)}: Testing... `);

              const testResult = runShellCommand(testCmd);

              if (testResult.exitCode === 0) {
                console.log(palette.green('\u2713 All tests pass'));
                testsPass = true;
                break;
              }

              // Parse failure count from output (best effort)
              const failMatch = (testResult.stdout + testResult.stderr).match(/(\d+)\s+fail/i);
              const failCount = failMatch ? failMatch[1] : '?';
              console.log(palette.red(`\u2717 ${failCount} failure(s)`));

              if (iteration === maxIter) {
                printWarning(`Max iterations (${maxIter}) reached. Tests still failing.`);
                break;
              }

              // Send test errors back to AI for another fix attempt
              process.stdout.write(`  ${palette.violet(iterLabel)}: Fixing... `);

              const currentContent = readFileContent(filePath).content;
              const retryMessage =
                `The previous fix was applied but tests are still failing.\n\n` +
                `Test command: ${testCmd}\n` +
                `Test output:\n\`\`\`\n${(testResult.stdout + '\n' + testResult.stderr).trim()}\n\`\`\`\n\n` +
                `Current file content:\n\`\`\`\n${currentContent}\n\`\`\`\n\n` +
                `Fix the remaining issues so the tests pass. Output ONLY the complete fixed file content.`;

              const retrySpinner = startSpinner('');
              const { callbacks: retryCallbacks, getResponse: getRetryResponse } =
                createSilentStreamHandler(retrySpinner, '');

              await askAI(
                'You are Orion, an expert code fixer. Output ONLY the complete fixed file content. No markdown, no code fences, no explanation.',
                retryMessage,
                retryCallbacks,
                { requireComplete: true },
              );

              let retryContent = getRetryResponse().trim();

              // Clean up potential code fences
              if (retryContent.startsWith('```')) {
                const rLines = retryContent.split('\n');
                rLines.shift();
                if (rLines[rLines.length - 1]?.trim() === '```') {
                  rLines.pop();
                }
                retryContent = rLines.join('\n');
              }

              console.log();
              if (!retryContent.trim()) {
                printWarning('The AI returned an empty file. Stopping; the file keeps the previous fix.');
                break;
              }

              // Each retry rewrites the whole file, so it gets the same review
              // as the first fix: a diff, and a prompt unless --yes was given.
              if (!pipelineOpts.quiet) {
                console.log(diffBlock(currentContent, retryContent, filePath));
              }
              let applyRetry = pipelineOpts.yes;
              if (!applyRetry) {
                const retryAnswer = await inquirer.prompt([{
                  type: 'confirm',
                  name: 'apply',
                  message: `Apply fix attempt ${iteration + 1}?`,
                  default: false,
                }]);
                applyRetry = retryAnswer.apply;
              }
              if (!applyRetry) {
                printInfo('Stopped; the file keeps the previous fix.');
                break;
              }

              writeFileContent(filePath, retryContent);
              printSuccess(`Fix attempt ${iteration + 1} saved.`);
            }

            if (testsPass) {
              printSuccess('Auto-fix loop complete: all tests passing.');
            }
          }
        }

        // ─── Git Auto-Commit ────────────────────────────────────────────
        if (filePath && !options?.noCommit && !pipelineOpts.dryRun) {
          if (isGitRepo()) {
            let shouldCommit = false;

            if (pipelineOpts.yes) {
              shouldCommit = true;
            } else {
              const commitAnswer = await inquirer.prompt([
                {
                  type: 'confirm',
                  name: 'commit',
                  message: 'Changes applied. Auto-commit?',
                  default: true,
                },
              ]);
              shouldCommit = commitAnswer.commit;
            }

            if (shouldCommit) {
              try {
                const commitDesc = `fix issues in ${fileLabel}`;
                gitAutoCommit(filePath, commitDesc);
                printSuccess(`Committed: ai(orion): ${commitDesc}`);
              } catch (commitErr: any) {
                printWarning(`Auto-commit failed: ${commitErr.message}`);
              }
            }
          }
        }
      }
    } else {
      printInfo('Fixes discarded. File unchanged.');
    }
  } catch (err: any) {
    printCommandError(err, 'fix', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}
