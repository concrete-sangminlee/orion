/**
 * Orion CLI - AI-Assisted File Editing
 * Read file, get edit instructions, preview diff, apply changes
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
import {
  createSilentStreamHandler,
  readAndValidateFile,
  printFileInfo,
  printCommandError,
} from '../shared.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';

const EDIT_SYSTEM_PROMPT = `You are Orion, an expert code editor. The user will provide a file and editing instructions.

Rules:
1. Output ONLY the complete modified file content
2. Do NOT include any explanation, markdown formatting, or code fences
3. Do NOT add \`\`\` markers around the code
4. Preserve the original file's formatting style (indentation, line endings)
5. Only make the changes the user requested
6. Keep all existing code that wasn't asked to be changed
7. Output the raw file content, ready to be written to disk`;

export async function editCommand(filePath: string): Promise<void> {
  printHeader('Orion AI Edit');

  const file = readAndValidateFile(filePath);
  if (!file) {
    process.exit(1);
  }

  printFileInfo(file);
  console.log();

  // Show a preview of the file
  const previewLines = file.content.split('\n').slice(0, 20);
  console.log(colors.dim('  File preview (first 20 lines):'));
  previewLines.forEach((line, i) => {
    const lineNum = colors.dim(String(i + 1).padStart(4, ' ') + ' |');
    console.log(`  ${lineNum} ${colors.code(line)}`);
  });
  if (file.lineCount > 20) {
    console.log(colors.dim(`  ... and ${file.lineCount - 20} more lines`));
  }
  console.log();

  // Ask what to change
  const { instruction } = await inquirer.prompt([
    {
      type: 'input',
      name: 'instruction',
      message: 'What would you like to change?',
      validate: (input: string) => input.trim().length > 0 || 'Please describe the change.',
    },
  ]);

  // Send to AI
  const spinner = startSpinner('Generating edit...');

  try {
    const userMessage = `File: ${file.fileName} (${file.language})\n\nInstruction: ${instruction}\n\nOriginal file content:\n${file.content}`;

    const projectContext = loadProjectContext();
    const fullSystemPrompt = projectContext
      ? EDIT_SYSTEM_PROMPT + '\n\nProject context:\n' + projectContext
      : EDIT_SYSTEM_PROMPT;

    const { callbacks, getResponse } = createSilentStreamHandler(spinner, 'Edit generated');

    await askAI(fullSystemPrompt, userMessage, callbacks);

    let modifiedContent = getResponse().trim();

    // Clean up the response (remove potential code fences)
    if (modifiedContent.startsWith('```')) {
      const lines = modifiedContent.split('\n');
      lines.shift();
      if (lines[lines.length - 1]?.trim() === '```') {
        lines.pop();
      }
      modifiedContent = lines.join('\n');
    }

    // Show diff
    const pipelineOpts = getPipelineOptions();

    if (pipelineOpts.json) {
      jsonOutput('edit_preview', { file: file.resolvedPath, original: file.content, modified: modifiedContent });
    }

    if (!pipelineOpts.quiet) {
      console.log();
      printDivider();
      console.log(colors.label('  Changes Preview:'));
      console.log();
      console.log(formatDiff(file.content, modifiedContent));
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
          message: 'Apply these changes?',
          choices: [
            { name: 'Apply changes', value: 'apply' },
            { name: 'Try different instructions', value: 'retry' },
            { name: 'Cancel', value: 'cancel' },
          ],
        },
      ]);
      action = answer.action;
    }

    if (action === 'apply') {
      writeFileContent(filePath, modifiedContent);
      printSuccess(`File updated: ${file.resolvedPath}`);
      jsonOutput('edit_result', { success: true, file: file.resolvedPath });
    } else if (action === 'retry') {
      await editCommand(filePath);
    } else {
      printInfo('Edit cancelled. File unchanged.');
    }
  } catch (err: any) {
    printCommandError(err, 'edit', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}
