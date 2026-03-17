/**
 * Orion CLI - File Explanation Command
 * AI-powered code explanation with markdown-rendered output
 */

import { askAI } from '../ai-client.js';
import {
  printHeader,
  printDivider,
  startSpinner,
  loadProjectContext,
} from '../utils.js';
import {
  createStreamHandler,
  readAndValidateFile,
  printFileInfo,
  printCommandError,
} from '../shared.js';

const EXPLAIN_SYSTEM_PROMPT = `You are Orion, an expert code explainer. Explain what the provided file does clearly and concisely.

Structure your explanation as:
1. **Overview** - What this file/module does in 1-2 sentences
2. **Key Components** - Main functions, classes, exports
3. **How It Works** - The logic flow and important patterns
4. **Dependencies** - Notable imports and external dependencies
5. **Usage** - How this file is typically used

Use simple language. Be thorough but not verbose.
Format using markdown for readability.`;

export async function explainCommand(filePath: string): Promise<void> {
  printHeader('Orion Code Explainer');

  const file = readAndValidateFile(filePath);
  if (!file) {
    process.exit(1);
  }

  printFileInfo(file);
  printDivider();
  console.log();

  const spinner = startSpinner('Analyzing code...');

  const { callbacks } = createStreamHandler(spinner, {
    markdown: true,
  });

  try {
    const userMessage = `Explain this ${file.language} file (${file.fileName}):\n\n\`\`\`${file.language}\n${file.content}\n\`\`\``;

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
