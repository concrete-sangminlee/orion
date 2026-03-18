/**
 * Orion CLI - File Explanation Command
 * AI-powered code explanation with markdown-rendered output
 */

import { askAI } from '../ai-client.js';
import {
  colors,
  printHeader,
  printDivider,
  printInfo,
  startSpinner,
  loadProjectContext,
} from '../utils.js';
import {
  createStreamHandler,
  readAndValidateFile,
  printFileInfo,
  printCommandError,
} from '../shared.js';
import { readStdin } from '../stdin.js';
import { commandHeader, divider, palette } from '../ui.js';

const EXPLAIN_SYSTEM_PROMPT = `You are Orion, an expert code explainer. Explain what the provided file does clearly and concisely.

Structure your explanation as:
1. **Overview** - What this file/module does in 1-2 sentences
2. **Key Components** - Main functions, classes, exports
3. **How It Works** - The logic flow and important patterns
4. **Dependencies** - Notable imports and external dependencies
5. **Usage** - How this file is typically used

Use simple language. Be thorough but not verbose.
Format using markdown for readability.`;

export async function explainCommand(filePath?: string): Promise<void> {
  // Check for piped stdin data
  const stdinData = await readStdin();

  let userMessage: string;

  if (filePath) {
    const file = readAndValidateFile(filePath);
    if (!file) {
      process.exit(1);
    }

    console.log(commandHeader('Orion Code Explainer', [
      ['File', colors.file(file.resolvedPath)],
      ['Language', `${file.language} \u00B7 ${file.lineCount} lines`],
    ]));
    console.log();

    userMessage = `Explain this ${file.language} file (${file.fileName}):\n\n\`\`\`${file.language}\n${file.content}\n\`\`\``;
  } else if (stdinData) {
    const lineCount = stdinData.split('\n').length;
    console.log(commandHeader('Orion Code Explainer', [
      ['Source', 'piped input'],
      ['Lines', String(lineCount)],
    ]));
    console.log();

    userMessage = `Explain this code:\n\n\`\`\`\n${stdinData}\n\`\`\``;
  } else {
    console.log();
    console.log(`  ${colors.error('Please provide a file path or pipe content via stdin.')}`);
    console.log(`  ${palette.dim('Usage: orion explain <file>')}`);
    console.log(`  ${palette.dim('       cat app.ts | orion explain')}`);
    console.log();
    process.exit(1);
  }

  const spinner = startSpinner('Analyzing code...');

  const { callbacks } = createStreamHandler(spinner, {
    markdown: true,
  });

  try {
    const projectContext = loadProjectContext();
    const fullSystemPrompt = projectContext
      ? EXPLAIN_SYSTEM_PROMPT + '\n\nProject context:\n' + projectContext
      : EXPLAIN_SYSTEM_PROMPT;

    await askAI(fullSystemPrompt, userMessage, callbacks);
    console.log();
  } catch (err: any) {
    printCommandError(err, 'explain', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}
