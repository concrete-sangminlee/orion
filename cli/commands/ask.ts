/**
 * Orion CLI - Quick Ask Command
 * One-shot AI question with streaming response and markdown rendering
 */

import { askAI } from '../ai-client.js';
import {
  colors,
  printDivider,
  startSpinner,
  getCurrentDirectoryContext,
  loadProjectContext,
} from '../utils.js';
import { createStreamHandler, printCommandError } from '../shared.js';

const SYSTEM_PROMPT = `You are Orion, an expert AI coding assistant.
Answer the user's question concisely and accurately.
Use code examples when helpful, formatted in markdown code blocks.
Be direct - this is a quick question mode, not a conversation.

Workspace context:
`;

export async function askCommand(question: string): Promise<void> {
  if (!question.trim()) {
    console.log();
    console.log(`  ${colors.error('Please provide a question.')}`);
    console.log(`  ${colors.dim('Usage: orion ask "How do I sort an array in TypeScript?"')}`);
    console.log();
    process.exit(1);
  }

  console.log();
  console.log(`  ${colors.user('Q:')} ${question}`);
  printDivider();

  const spinner = startSpinner('Thinking...');
  const context = getCurrentDirectoryContext();
  const projectContext = loadProjectContext();

  const { callbacks } = createStreamHandler(spinner, {
    label: 'Orion:',
    markdown: true,
  });

  const fullSystemPrompt = projectContext
    ? SYSTEM_PROMPT + context + '\n\nProject context:\n' + projectContext
    : SYSTEM_PROMPT + context;

  try {
    await askAI(fullSystemPrompt, question, callbacks);
    console.log();
  } catch (err: any) {
    printCommandError(err, 'ask', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}
