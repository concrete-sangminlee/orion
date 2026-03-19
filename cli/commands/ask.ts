/**
 * Orion CLI - Quick Ask Command
 * One-shot AI question with streaming response and markdown rendering
 * Supports @file references for multi-file context (like Aider / Claude Code)
 */

import * as path from 'path';
import { askAI } from '../ai-client.js';
import {
  colors,
  printDivider,
  startSpinner,
  getCurrentDirectoryContext,
  loadProjectContext,
  detectLanguage,
} from '../utils.js';
import { createStreamHandler, readAndValidateFile, printCommandError } from '../shared.js';
import { readStdin } from '../stdin.js';
import { commandHeader, box, palette, statusLine } from '../ui.js';

const SYSTEM_PROMPT = `You are Orion, an expert AI coding assistant.
Answer the user's question concisely and accurately.
Use code examples when helpful, formatted in markdown code blocks.
Be direct - this is a quick question mode, not a conversation.
When file contents are provided as context, reference them by name and line number.

Workspace context:
`;

/**
 * Parse arguments into question text and @file references.
 * Anything starting with @ is treated as a file path.
 */
function parseAskArgs(args: string[]): { question: string; filePaths: string[] } {
  const filePaths: string[] = [];
  const questionParts: string[] = [];

  for (const arg of args) {
    if (arg.startsWith('@')) {
      filePaths.push(arg.slice(1));
    } else {
      questionParts.push(arg);
    }
  }

  return { question: questionParts.join(' '), filePaths };
}

/**
 * Load file contents and build a context block for the AI prompt.
 */
function loadFileContexts(filePaths: string[]): { contextBlock: string; loaded: string[]; failed: string[] } {
  const loaded: string[] = [];
  const failed: string[] = [];
  const blocks: string[] = [];

  for (const fp of filePaths) {
    const file = readAndValidateFile(fp);
    if (file) {
      loaded.push(file.resolvedPath);
      blocks.push(
        `--- File: ${file.resolvedPath} (${file.language}, ${file.lineCount} lines) ---\n` +
        `\`\`\`${file.language}\n${file.content}\n\`\`\``
      );
    } else {
      failed.push(fp);
    }
  }

  return {
    contextBlock: blocks.length > 0
      ? '\n\nReferenced files:\n\n' + blocks.join('\n\n')
      : '',
    loaded,
    failed,
  };
}

export interface AskOptions {
  systemPrompt?: string;
  maxTurns?: number;
  outputFormat?: 'text' | 'json' | 'stream-json';
}

export async function askCommand(question: string, extraArgs: string[] = [], options: AskOptions = {}): Promise<void> {
  // Parse @file references from extra arguments
  const parsed = parseAskArgs(extraArgs);
  const filePaths = parsed.filePaths;
  // If extra args contained non-file text, append to question
  const fullQuestion = parsed.question
    ? `${question} ${parsed.question}`.trim()
    : question;

  if (!fullQuestion.trim()) {
    console.log();
    console.log(`  ${colors.error('Please provide a question.')}`);
    console.log(`  ${colors.dim('Usage: orion ask "How do I sort an array in TypeScript?"')}`);
    console.log(`  ${colors.dim('       orion ask "Explain auth flow" @src/auth.ts @src/middleware.ts')}`);
    console.log();
    process.exit(1);
  }

  // Read piped stdin data if available
  const stdinData = await readStdin();

  // Load referenced files
  let fileContext = '';
  if (filePaths.length > 0) {
    const { contextBlock, loaded, failed } = loadFileContexts(filePaths);
    fileContext = contextBlock;

    // Display loaded files
    if (loaded.length > 0) {
      console.log();
      console.log(`  ${palette.violet.bold('Referenced Files')}`);
      for (const f of loaded) {
        const lang = detectLanguage(f);
        console.log(statusLine('\u2713' as any, `${colors.file(path.basename(f))} ${palette.dim(`(${lang})`)}`));
      }
    }
    if (failed.length > 0) {
      for (const f of failed) {
        console.log(statusLine('\u2717' as any, `${palette.red(f)} ${palette.dim('not found')}`));
      }
    }
  }

  // Build the user message
  let userMessage = fullQuestion;
  if (stdinData) {
    userMessage = `Context from stdin:\n---\n${stdinData}\n---\n\nQuestion: ${fullQuestion}`;
  }
  if (fileContext) {
    userMessage += fileContext;
  }

  const isHeadless = options.outputFormat === 'json' || options.outputFormat === 'stream-json' || (options.maxTurns && options.maxTurns > 1);

  if (!isHeadless) {
    console.log(commandHeader('Orion Quick Ask'));
    console.log(box(fullQuestion, { title: 'Question', color: '#38BDF8', padding: 0 }));
    if (stdinData) {
      console.log(`  ${palette.dim(`(with ${stdinData.split('\n').length} lines of piped input)`)}`);
    }
    if (filePaths.length > 0) {
      console.log(`  ${palette.dim(`(with ${filePaths.length} file reference${filePaths.length > 1 ? 's' : ''})`)}`);
    }
    console.log();
  }

  const spinner = isHeadless ? null : startSpinner('Thinking...');
  const context = getCurrentDirectoryContext();
  const projectContext = loadProjectContext();

  const { callbacks } = createStreamHandler(spinner!, {
    label: 'Orion:',
    markdown: true,
  });

  const baseSystemPrompt = options.systemPrompt || SYSTEM_PROMPT;
  const fullSystemPrompt = projectContext
    ? baseSystemPrompt + context + '\n\nProject context:\n' + projectContext
    : baseSystemPrompt + context;

  // ── JSON output mode (headless) ─────────────────────────────────────────
  if (options.outputFormat === 'json' || options.outputFormat === 'stream-json') {
    const startTime = Date.now();
    let responseText = '';
    let inputTokenEst = Math.ceil((fullSystemPrompt.length + userMessage.length) / 4);

    try {
      await askAI(fullSystemPrompt, userMessage, {
        onToken(token: string) {
          responseText += token;
          if (options.outputFormat === 'stream-json') {
            // Emit each token as a stream-json line
            process.stdout.write(JSON.stringify({ type: 'token', content: token }) + '\n');
          }
        },
        onComplete(text: string) {
          responseText = text;
        },
        onError(error: Error) {
          const errJson = { type: 'error', error: error.message };
          process.stdout.write(JSON.stringify(errJson) + '\n');
        },
      });

      const durationMs = Date.now() - startTime;
      const outputTokenEst = Math.ceil(responseText.length / 4);

      const result = {
        role: 'assistant',
        content: responseText,
        tokens: { input: inputTokenEst, output: outputTokenEst },
        model: 'auto',
        duration_ms: durationMs,
      };

      if (options.outputFormat === 'stream-json') {
        process.stdout.write(JSON.stringify({ type: 'result', ...result }) + '\n');
      } else {
        process.stdout.write(JSON.stringify(result) + '\n');
      }
    } catch (err: any) {
      const errJson = { role: 'error', error: err.message, duration_ms: Date.now() - startTime };
      process.stdout.write(JSON.stringify(errJson) + '\n');
      process.exit(1);
    }
    return;
  }

  // ── Multi-turn headless mode ────────────────────────────────────────────
  if (options.maxTurns && options.maxTurns > 1) {
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    const messages: { role: string; content: string }[] = [
      { role: 'user', content: userMessage },
    ];
    let turn = 0;

    // First turn
    try {
      let response = '';
      await askAI(fullSystemPrompt, userMessage, {
        onToken(token: string) { response += token; },
        onComplete(text: string) { response = text; },
      });
      turn++;
      console.log(response);
      messages.push({ role: 'assistant', content: response });
    } catch (err: any) {
      printCommandError(err, 'ask', 'Run `orion config` to check your AI provider settings.');
      process.exit(1);
    }

    // Subsequent turns from stdin
    if (turn < options.maxTurns) {
      for await (const line of rl) {
        if (turn >= options.maxTurns) break;
        const trimmed = line.trim();
        if (!trimmed || trimmed === '/exit' || trimmed === '/quit') break;

        messages.push({ role: 'user', content: trimmed });
        const historyContext = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');

        try {
          let response = '';
          await askAI(fullSystemPrompt, historyContext + '\n\nuser: ' + trimmed, {
            onToken(token: string) { response += token; },
            onComplete(text: string) { response = text; },
          });
          turn++;
          console.log(response);
          messages.push({ role: 'assistant', content: response });
        } catch (err: any) {
          printCommandError(err, 'ask', 'Run `orion config` to check your AI provider settings.');
          break;
        }
      }
    }
    rl.close();
    return;
  }

  // ── Standard text output ────────────────────────────────────────────────
  try {
    await askAI(fullSystemPrompt, userMessage, callbacks);
    console.log();
  } catch (err: any) {
    printCommandError(err, 'ask', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}
