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

export async function fixCommand(filePath: string): Promise<void> {
  printHeader('Orion Auto-Fix');

  const file = readAndValidateFile(filePath);
  if (!file) {
    process.exit(1);
  }

  printFileInfo(file);
  console.log();

  const spinner = startSpinner('Scanning for issues...');

  try {
    const userMessage = `Fix issues in this ${file.language} file (${file.fileName}):\n\n\`\`\`${file.language}\n${file.content}\n\`\`\``;

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

    // Show analysis with severity coloring
    console.log();
    printDivider();
    console.log(colors.label('  Issues Found:'));
    console.log();

    const analysisLines = analysis.split('\n');
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    const otherLines: string[] = [];

    for (const line of analysisLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[ERROR]')) {
        errorCount++;
        console.log(`  ${colors.severityError(' ERROR ')} ${colors.error(trimmed.replace('[ERROR] ', ''))}`);
      } else if (trimmed.startsWith('[WARNING]')) {
        warningCount++;
        console.log(`  ${colors.severityWarning(' WARN  ')} ${colors.warning(trimmed.replace('[WARNING] ', ''))}`);
      } else if (trimmed.startsWith('[INFO]')) {
        infoCount++;
        console.log(`  ${colors.severityInfo(' INFO  ')} ${colors.info(trimmed.replace('[INFO] ', ''))}`);
      } else if (trimmed) {
        otherLines.push(line);
      }
    }

    // Render any non-severity text as markdown
    if (otherLines.length > 0) {
      const mdText = otherLines.join('\n').trim();
      if (mdText) {
        console.log(renderMarkdown(mdText));
      }
    }

    console.log();
    console.log(
      `  Summary: ${colors.error(`${errorCount} errors`)} | ` +
      `${colors.warning(`${warningCount} warnings`)} | ` +
      `${colors.info(`${infoCount} suggestions`)}`
    );

    if (!fixedContent) {
      console.log();
      printInfo('No fixable issues found, or AI did not provide fixes.');
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

    // Show diff
    const pipelineOpts = getPipelineOptions();

    if (pipelineOpts.json) {
      jsonOutput('fix_analysis', {
        file: file.resolvedPath,
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
      console.log(formatDiff(file.content, fixedContent));
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
      writeFileContent(filePath, fixedContent);
      printSuccess(`Fixed file saved: ${file.resolvedPath}`);
      jsonOutput('fix_result', { success: true, file: file.resolvedPath });
    } else {
      printInfo('Fixes discarded. File unchanged.');
    }
  } catch (err: any) {
    printCommandError(err, 'fix', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}
