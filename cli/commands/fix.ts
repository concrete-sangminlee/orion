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
  startSpinner,
  writeFileContent,
  formatDiff,
  loadProjectContext,
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

export async function fixCommand(filePath?: string): Promise<void> {
  // Check for piped stdin data
  const stdinData = await readStdin();
  const isStdinMode = !filePath && !!stdinData;

  printHeader('Orion Auto-Fix');

  let originalContent: string;
  let userMessage: string;
  let fileLabel: string;

  if (filePath) {
    const file = readAndValidateFile(filePath);
    if (!file) {
      process.exit(1);
    }

    printFileInfo(file);
    console.log();

    originalContent = file.content;
    userMessage = `Fix issues in this ${file.language} file (${file.fileName}):\n\n\`\`\`${file.language}\n${file.content}\n\`\`\``;
    fileLabel = file.resolvedPath;
  } else if (stdinData) {
    const lineCount = stdinData.split('\n').length;
    printInfo(`Fixing piped input... (${lineCount} lines)`);
    console.log();

    originalContent = stdinData;
    userMessage = `Fix issues in this code:\n\n\`\`\`\n${stdinData}\n\`\`\``;
    fileLabel = '(stdin)';
  } else {
    console.log();
    console.log(`  ${colors.error('Please provide a file path or pipe content via stdin.')}`);
    console.log(`  ${colors.dim('Usage: orion fix <file>')}`);
    console.log(`  ${colors.dim('       cat app.ts | orion fix')}`);
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

    await askAI(fullSystemPrompt, userMessage, callbacks);

    const fullResponse = getResponse();

    // Parse the response
    const parts = fullResponse.split('---FIX---');
    const analysis = parts[0]?.trim() || '';
    let fixedContent = parts[1]?.trim() || '';

    // Show analysis with severity coloring (to stderr so stdout stays clean for piping)
    const output = isStdinMode ? process.stderr : process.stdout;
    const log = (...args: any[]) => output.write(args.join(' ') + '\n');

    log();
    log(colors.dim('─'.repeat(60)));
    log(colors.label('  Issues Found:'));
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
        log(`  ${colors.severityError(' ERROR ')} ${colors.error(trimmed.replace('[ERROR] ', ''))}`);
      } else if (trimmed.startsWith('[WARNING]')) {
        warningCount++;
        log(`  ${colors.severityWarning(' WARN  ')} ${colors.warning(trimmed.replace('[WARNING] ', ''))}`);
      } else if (trimmed.startsWith('[INFO]')) {
        infoCount++;
        log(`  ${colors.severityInfo(' INFO  ')} ${colors.info(trimmed.replace('[INFO] ', ''))}`);
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
      `  Summary: ${colors.error(`${errorCount} errors`)} | ` +
      `${colors.warning(`${warningCount} warnings`)} | ` +
      `${colors.info(`${infoCount} suggestions`)}`
    );

    if (!fixedContent) {
      log();
      process.stderr.write(`  ${colors.info('i')} No fixable issues found, or AI did not provide fixes.\n`);
      return;
    }

    // Clean up potential code fences
    if (fixedContent.startsWith('```')) {
      const lines = fixedContent.split('\n');
      lines.shift();
      if (lines[lines.length - 1]?.trim() === '```') {
        lines.pop();
      }
      fixedContent = lines.join('\n');
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
      printDivider();
      console.log(colors.label('  Proposed Fixes:'));
      console.log();
      console.log(formatDiff(originalContent, fixedContent));
      console.log();
      printDivider();
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
      writeFileContent(filePath!, fixedContent);
      printSuccess(`Fixed file saved: ${fileLabel}`);
      jsonOutput('fix_result', { success: true, file: fileLabel });
    } else {
      printInfo('Fixes discarded. File unchanged.');
    }
  } catch (err: any) {
    printCommandError(err, 'fix', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}
