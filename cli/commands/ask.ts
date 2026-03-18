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
import { readStdin } from '../stdin.js';
import { commandHeader, box, palette } from '../ui.js';

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

  // Read piped stdin data if available
  const stdinData = await readStdin();

  // Build the user message, prepending stdin context if present
  let userMessage = question;
  if (stdinData) {
    userMessage = `Context from stdin:\n---\n${stdinData}\n---\n\nQuestion: ${question}`;
  }

  console.log(commandHeader('Orion Quick Ask'));
  console.log(box(question, { title: 'Question', color: '#38BDF8', padding: 0 }));
  if (stdinData) {
    console.log(`  ${palette.dim(`(with ${stdinData.split('\n').length} lines of piped input)`)}`);
  }
  console.log();

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
    await askAI(fullSystemPrompt, userMessage, callbacks);
    console.log();
  } catch (err: any) {
    printCommandError(err, 'ask', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}
