/**
 * Orion CLI - Interactive Chat with Hot-Switch & Persistent History
 * Tab to switch between Claude / GPT / Ollama instantly
 * Conversation history preserved across switches
 * /save, /history, /load commands for session persistence
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import {
  streamChat,
  askAI,
  getAvailableProviders,
  getProviderDisplay,
  resolveModelShortcut,
  listAvailableModels,
  listOllamaModels,
  type AIMessage,
  type AIProvider,
} from '../ai-client.js';
import {
  colors,
  printHeader,
  printDivider,
  printInfo,
  printSuccess,
  printWarning,
  printError,
  startSpinner,
  stopSpinner,
  getCurrentDirectoryContext,
  loadProjectContext,
  readConfig,
  writeConfig,
  readFileContent,
  writeFileContent,
  fileExists,
  saveChatSession,
  loadChatSession,
  listChatSessions,
  type ChatSession,
} from '../utils.js';
import { renderMarkdown } from '../markdown.js';
import {
  providerStatusList,
  userMessageBox,
  aiResponseHeader,
  tokenCountFooter,
  divider,
  errorDisplay,
  table as uiTable,
  providerBadge,
  palette,
} from '../ui.js';
import { fetchUrl, stripHtmlTags } from './fetch.js';

const SYSTEM_PROMPT = `You are Orion, an expert AI coding assistant running in a terminal CLI.
You help developers with coding questions, debugging, architecture, and best practices.

Guidelines:
- Be concise but thorough
- Use code examples when helpful
- Format code in markdown code blocks with language tags
- When suggesting file changes, show the relevant code
- Be direct and actionable
- Respond in the same language the user uses

Current workspace context:
`;

// ─── Conversation Compaction ──────────────────────────────────────────────────

const COMPACTION_THRESHOLD = 20;
const RECENT_MESSAGES_TO_KEEP = 6;

/**
 * Rough token estimation: ~4 characters per token for English text.
 */
function estimateTokens(messages: AIMessage[]): number {
  return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
}

/**
 * When conversation history gets too long (>20 messages or >8000 estimated
 * tokens), compact older messages by summarizing them via AI.
 * The most recent messages are kept as-is for context continuity.
 */
async function compactHistory(history: AIMessage[]): Promise<AIMessage[]> {
  if (history.length < COMPACTION_THRESHOLD && estimateTokens(history) < 8000) {
    return history;
  }

  // Keep last N messages as-is
  const recent = history.slice(-RECENT_MESSAGES_TO_KEEP);
  const older = history.slice(0, -RECENT_MESSAGES_TO_KEEP);

  if (older.length === 0) return history;

  // Build a text representation of the older messages for summarization
  const olderText = older
    .map(m => `${m.role}: ${m.content}`)
    .join('\n\n');

  try {
    let summary = '';
    await askAI(
      'Summarize the following conversation concisely but thoroughly. Preserve key decisions, code changes, file paths, technical context, and any instructions the user gave. Output only the summary, no preamble.',
      olderText,
      {
        onToken(token: string) {
          summary += token;
        },
        onComplete(text: string) {
          summary = text;
        },
      },
    );

    return [
      { role: 'system' as const, content: `Previous conversation summary:\n${summary}` },
      ...recent,
    ];
  } catch {
    // If summarization fails, fall back to just keeping recent messages
    return recent;
  }
}

function generateSessionId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export async function chatCommand(): Promise<void> {
  printHeader('Orion Interactive Chat');

  // Detect all available providers
  const providers = await getAvailableProviders();
  const available = providers.filter(p => p.available);

  if (available.length === 0) {
    console.log(errorDisplay('No AI provider available', [
      'Set ANTHROPIC_API_KEY',
      'Set OPENAI_API_KEY',
      'Start Ollama (ollama serve)',
      'Run: orion config',
    ]));
    console.log();
    process.exit(1);
  }

  // Current active provider state
  let activeProvider: AIProvider = available[0].provider;
  let activeModel = available[0].model;

  // Try to use config preference
  const cfg = readConfig();
  if (cfg.provider) {
    const pref = available.find(p => p.provider === cfg.provider);
    if (pref) {
      activeProvider = pref.provider;
      activeModel = pref.model;
    }
  }

  // Show available providers with premium status display
  console.log();
  console.log(providerStatusList(providers.map(p => {
    const display = getProviderDisplay(p.provider);
    return {
      name: display.name,
      provider: p.provider,
      model: p.model,
      available: p.available,
      active: p.provider === activeProvider,
      reason: p.reason,
    };
  })));
  console.log();

  // Show controls
  const switchProviders = available.map(p => getProviderDisplay(p.provider).name).join('/');
  printInfo(`${colors.command('Tab')} Switch provider (${switchProviders})`);
  printInfo(`${colors.command('/model <name>')} Switch to specific model`);
  printInfo(`${colors.command('/save')} Save session  ${colors.command('/history')} List sessions  ${colors.command('/load <id>')} Load session`);
  printInfo(`${colors.command('/help')} All commands`);
  console.log();

  // ── Scan .orion/commands/ for custom slash commands ────────
  const customCommands = new Map<string, string>();
  const commandsDir = path.join(process.cwd(), '.orion', 'commands');
  if (fs.existsSync(commandsDir)) {
    try {
      const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const cmdName = path.basename(file, '.md');
        const cmdContent = fs.readFileSync(path.join(commandsDir, file), 'utf-8');
        customCommands.set(cmdName, cmdContent);
      }
      if (customCommands.size > 0) {
        printInfo(`Loaded ${customCommands.size} custom command${customCommands.size > 1 ? 's' : ''} from ${colors.file('.orion/commands/')}`);
      }
    } catch { /* ignore read errors */ }
  }

  const history: AIMessage[] = [];
  const context = getCurrentDirectoryContext();
  const projectContext = loadProjectContext();
  const fullSystemContent = projectContext
    ? SYSTEM_PROMPT + context + '\n\nProject context:\n' + projectContext
    : SYSTEM_PROMPT + context;
  const systemMessage: AIMessage = {
    role: 'system',
    content: fullSystemContent,
  };

  // ── Effort Level State ─────────────────────────────────────────────────────
  type EffortLevel = 'low' | 'medium' | 'high' | 'max';
  const EFFORT_PROMPTS: Record<EffortLevel, string> = {
    low: 'Be very concise, one-liner answers.',
    medium: 'Be clear and thorough.',
    high: 'Think step by step, consider edge cases.',
    max: 'Think deeply, consider all angles, provide comprehensive analysis.',
  };
  let currentEffort: EffortLevel = 'medium';

  // Session tracking
  const sessionId = generateSessionId();
  let sessionSaved = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
    terminal: true,
  });

  // Track token counts per provider for stats
  const stats: Record<string, { messages: number; tokens: number }> = {};

  function getProviderBadge(): string {
    return providerBadge(activeProvider, activeModel);
  }

  function prompt(): void {
    const effortTag = currentEffort !== 'medium'
      ? ` ${chalk.dim(`[effort:${currentEffort}]`)}`
      : '';
    process.stdout.write(`\n  ${getProviderBadge()}${effortTag}\n${palette.blue.bold('  You:')} `);
  }

  function switchToNextProvider(): void {
    const currentIdx = available.findIndex(p => p.provider === activeProvider);
    const nextIdx = (currentIdx + 1) % available.length;
    activeProvider = available[nextIdx].provider;
    activeModel = available[nextIdx].model;

    const display = getProviderDisplay(activeProvider);
    console.log(`\n  ${chalk.yellow('\u27F3')} Switched to ${display.badge} ${chalk.dim(activeModel)}`);

    const cfg = readConfig();
    cfg.provider = activeProvider;
    cfg.model = activeModel;
    writeConfig(cfg);
  }

  // ── Session persistence helpers ─────────────────────────────

  function saveCurrentSession(): string {
    const preview = history
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .slice(0, 2)
      .join(' | ')
      .substring(0, 80);

    const session: ChatSession = {
      id: sessionId,
      timestamp: new Date().toISOString(),
      provider: activeProvider,
      model: activeModel,
      messageCount: history.length,
      messages: history.map(m => ({ role: m.role, content: m.content })),
      preview: preview || '(empty session)',
    };

    const filepath = saveChatSession(session);
    sessionSaved = true;
    return filepath;
  }

  function handleSaveCommand(): void {
    if (history.length === 0) {
      printWarning('No messages to save.');
      return;
    }
    const filepath = saveCurrentSession();
    printSuccess(`Session saved: ${sessionId}`);
    printInfo(`File: ${colors.file(filepath)}`);
  }

  function handleHistoryCommand(): void {
    const sessions = listChatSessions();
    if (sessions.length === 0) {
      printInfo('No saved sessions found.');
      printInfo('Use /save to save the current session.');
      return;
    }
    console.log();
    console.log(uiTable(
      ['Session ID', 'Date', 'Provider', 'Messages'],
      sessions.map(s => {
        const date = new Date(s.timestamp).toLocaleDateString();
        const provDisplay = getProviderDisplay(s.provider as AIProvider);
        return [
          colors.command(s.id),
          palette.dim(date),
          provDisplay.color(provDisplay.name),
          palette.dim(String(s.messageCount)),
        ];
      })
    ));
    console.log();
    printInfo('Use /load <id> to load a session.');
  }

  function handleLoadCommand(idArg: string): void {
    if (!idArg) {
      printWarning('Usage: /load <session-id>');
      printInfo('Use /history to see available sessions.');
      return;
    }

    const session = loadChatSession(idArg);
    if (!session) {
      printWarning(`Session not found: ${idArg}`);
      printInfo('Use /history to see available sessions.');
      return;
    }

    // Restore history
    history.length = 0;
    for (const msg of session.messages) {
      history.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
    }

    printSuccess(`Loaded session: ${session.id} (${session.messageCount} messages)`);
    printInfo(`Provider: ${session.provider} / ${session.model}`);

    // Show last few exchanges
    const recentMessages = history.slice(-4);
    if (recentMessages.length > 0) {
      console.log();
      console.log(colors.dim('  Recent messages:'));
      for (const msg of recentMessages) {
        const prefix = msg.role === 'user' ? colors.user('  You:') : colors.label('  AI:');
        const preview = msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : '');
        console.log(`  ${prefix} ${chalk.dim(preview)}`);
      }
    }
  }

  // Intercept Tab key for provider switching
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true);
    process.stdin.setRawMode(false);
    readline.emitKeypressEvents(process.stdin);
  }

  const HELP_TEXT = `
${colors.label('Chat Commands:')}
  ${colors.command('Tab')}            Switch to next AI provider
  ${colors.command('/switch')}        Switch to next AI provider
  ${colors.command('/claude')}        Switch to Claude (Anthropic)
  ${colors.command('/gpt')}           Switch to GPT (OpenAI)
  ${colors.command('/ollama')}        Switch to Ollama (local)
  ${colors.command('/model <name>')}  Switch to specific model
  ${colors.command('/models')}        List available model shortcuts
  ${colors.command('/providers')}     Show provider status

${colors.label('Session Commands:')}
  ${colors.command('/save')}          Save current session to disk
  ${colors.command('/history')}       List saved sessions
  ${colors.command('/load <id>')}     Load a previous session
  ${colors.command('/stats')}         Show conversation statistics
  ${colors.command('/clear')}         Clear conversation history

${colors.label('Context & Effort:')}
  ${colors.command('/compact')}       Manually compact conversation history
  ${colors.command('/context')}       Show context usage estimation (tokens)
  ${colors.command('/effort <lvl>')}  Set effort level: low, medium, high, max

${colors.label('File & Shell:')}
  ${colors.command('/read <file>')}   Read a file and add it to conversation context
  ${colors.command('/write <file>')}  Write AI's last code block to a file
  ${colors.command('/run <command>')} Run a shell command and show output
  ${colors.command('/fetch <url>')}   Fetch a URL and add content to context
  ${colors.command('/ls [dir]')}      List directory contents
  ${colors.command('/cat <file>')}    Show file contents with line numbers
  ${colors.command('/pwd')}           Show current working directory
  ${colors.command('/cd <dir>')}      Change working directory

${colors.label('Custom Commands:')}
  ${chalk.dim('Place .md files in .orion/commands/ to create custom slash commands.')}
  ${chalk.dim('Example: .orion/commands/review-pr.md -> /review-pr')}
  ${chalk.dim('Supports {{file}} and {{selection}} placeholders.')}

${colors.label('General:')}
  ${colors.command('/help')}          Show this help message
  ${colors.command('/exit')}          Exit the chat session (auto-saves)

${colors.label('Model Shortcuts:')}
  ${chalk.dim('claude, claude-opus, claude-sonnet, claude-haiku')}
  ${chalk.dim('gpt, gpt-4o, gpt-4o-mini, o3, o3-mini, codex')}
  ${chalk.dim('ollama, llama')}
`;

  function handleSlashCommand(cmd: string): boolean {
    const parts = cmd.trim().split(/\s+/);
    const command = parts[0].toLowerCase();

    switch (command) {
      case '/exit':
      case '/quit':
      case '/q': {
        // Auto-save on exit
        if (history.length > 0 && !sessionSaved) {
          saveCurrentSession();
          printSuccess(`Session auto-saved: ${sessionId}`);
        }
        // Show stats before exit
        const totalMessages = Object.values(stats).reduce((s, v) => s + v.messages, 0);
        if (totalMessages > 0) {
          console.log(`\n${colors.label('  Session Stats:')}`);
          for (const [prov, s] of Object.entries(stats)) {
            const display = getProviderDisplay(prov as AIProvider);
            console.log(`  ${display.badge} ${s.messages} messages, ~${s.tokens} tokens`);
          }
        }
        console.log(`\n${colors.dim('  Goodbye! Happy coding.')}\n`);
        rl.close();
        process.exit(0);
        return true;
      }

      case '/switch':
      case '/tab':
        switchToNextProvider();
        prompt();
        return true;

      case '/claude':
        switchToProvider('anthropic', parts[1]);
        prompt();
        return true;

      case '/gpt':
      case '/codex':
        switchToProvider('openai', parts[1]);
        prompt();
        return true;

      case '/ollama':
      case '/llama':
        switchToProvider('ollama', parts[1]);
        prompt();
        return true;

      case '/model': {
        const modelArg = parts.slice(1).join(' ');
        if (!modelArg) {
          printInfo(`Current: ${getProviderBadge()}`);
          console.log(chalk.dim('  Usage: /model <name>  (e.g., /model claude-opus, /model gpt-4o)'));
          prompt();
          return true;
        }
        const shortcut = resolveModelShortcut(modelArg);
        if (shortcut) {
          switchToProvider(shortcut.provider, shortcut.model);
        } else {
          activeModel = modelArg;
          const display = getProviderDisplay(activeProvider);
          console.log(`  ${chalk.yellow('\u27F3')} Model set to ${display.badge} ${chalk.dim(activeModel)}`);
        }
        prompt();
        return true;
      }

      case '/models':
        console.log(`\n${colors.label('  Available Model Shortcuts:')}`);
        for (const name of listAvailableModels()) {
          const info = resolveModelShortcut(name)!;
          const display = getProviderDisplay(info.provider);
          console.log(`    ${colors.command(name.padEnd(18))} ${display.color(display.name.padEnd(8))} ${chalk.dim(info.model)}`);
        }
        // Show locally installed Ollama models
        listOllamaModels().then(models => {
          if (models.length > 0) {
            console.log(`\n${colors.label('  Installed Ollama Models:')}`);
            for (const m of models) {
              const active = m.replace(':latest', '') === activeModel || m === activeModel;
              console.log(`    ${active ? chalk.green('\u25CF') : chalk.dim('\u25CB')} ${active ? chalk.white(m) : chalk.dim(m)}${active ? chalk.yellow(' \u2190 active') : ''}`);
            }
            console.log(chalk.dim(`\n    Use /model <name> with any installed model name`));
            console.log(chalk.dim(`    Install new: ollama pull <model>`));
          }
          prompt();
        });
        return true;

      case '/providers': {
        console.log(`\n${colors.label('  Provider Status:')}`);
        getAvailableProviders().then(provs => {
          for (const p of provs) {
            const display = getProviderDisplay(p.provider);
            const status = p.available ? chalk.green('\u25CF available') : chalk.red(`\u25CB ${p.reason || 'unavailable'}`);
            const active = p.provider === activeProvider ? chalk.yellow(' <- active') : '';
            console.log(`  ${display.badge} ${status}${active}`);
          }
          prompt();
        });
        return true;
      }

      case '/save':
        handleSaveCommand();
        prompt();
        return true;

      case '/history':
        handleHistoryCommand();
        prompt();
        return true;

      case '/load':
        handleLoadCommand(parts.slice(1).join(' '));
        prompt();
        return true;

      case '/stats': {
        const total = Object.values(stats).reduce((s, v) => s + v.messages, 0);
        console.log(`\n${colors.label('  Session Statistics:')}`);
        console.log(`  Session ID: ${colors.command(sessionId)}`);
        console.log(`  Total messages: ${total}`);
        console.log(`  Conversation length: ${history.length} messages`);
        for (const [prov, s] of Object.entries(stats)) {
          const display = getProviderDisplay(prov as AIProvider);
          console.log(`  ${display.badge} ${s.messages} messages, ~${s.tokens} tokens`);
        }
        prompt();
        return true;
      }

      case '/clear':
        history.length = 0;
        printSuccess('Conversation history cleared.');
        prompt();
        return true;

      // ── Context & Effort commands ──────────────────────────────
      case '/compact': {
        if (history.length < 2) {
          printInfo('Nothing to compact (conversation too short).');
          prompt();
          return true;
        }
        const beforeCount = history.length;
        const beforeTokens = estimateTokens(history);
        const compactSpinner = startSpinner('Compacting conversation history...');
        compactHistory(history).then(compacted => {
          stopSpinner(compactSpinner, 'History compacted');
          history.length = 0;
          history.push(...compacted);
          const afterTokens = estimateTokens(history);
          printSuccess(`Compacted: ${beforeCount} messages -> ${history.length} messages`);
          printInfo(`Tokens: ~${beforeTokens.toLocaleString()} -> ~${afterTokens.toLocaleString()} (saved ~${(beforeTokens - afterTokens).toLocaleString()})`);
          prompt();
        }).catch(() => {
          stopSpinner(compactSpinner, 'Compaction failed', false);
          printWarning('Could not compact history. Continuing with full history.');
          prompt();
        });
        return true;
      }

      case '/context': {
        const systemTokens = estimateTokens([systemMessage]);
        const projectCtxTokens = projectContext ? Math.ceil(projectContext.length / 4) : 0;
        const historyTokens = estimateTokens(history);
        const historyMsgCount = history.length;
        const totalTokens = systemTokens + historyTokens;

        // Determine context limit based on active provider
        const contextLimits: Record<string, number> = {
          anthropic: 200000,
          openai: 128000,
          ollama: 128000,
        };
        const limit = contextLimits[activeProvider] || 128000;
        const usagePercent = Math.min(100, (totalTokens / limit) * 100);

        // Build progress bar (20 chars wide)
        const filledCount = Math.round(usagePercent / 5);
        const emptyCount = 20 - filledCount;
        const barColor = usagePercent < 50 ? chalk.green : usagePercent < 80 ? chalk.yellow : chalk.red;
        const progressBar = barColor('\u2588'.repeat(filledCount)) + chalk.dim('\u2591'.repeat(emptyCount));

        console.log();
        console.log(colors.label('  Context Usage:'));
        console.log(`    System prompt:     ${chalk.white('~' + systemTokens.toLocaleString() + ' tokens')}`);
        if (projectCtxTokens > 0) {
          console.log(`    Project context:   ${chalk.white('~' + projectCtxTokens.toLocaleString() + ' tokens')}`);
        }
        console.log(`    Chat history:      ${chalk.white('~' + historyTokens.toLocaleString() + ' tokens')} ${chalk.dim('(' + historyMsgCount + ' messages)')}`);
        console.log(chalk.dim('    ' + '\u2500'.repeat(35)));
        console.log(`    Total:             ${chalk.bold('~' + totalTokens.toLocaleString() + ' tokens')}`);
        console.log(`    Limit:             ${chalk.dim(limit.toLocaleString())} ${chalk.dim('(' + getProviderDisplay(activeProvider).name + ')')}`);
        console.log(`    Usage:             ${usagePercent < 50 ? chalk.green(usagePercent.toFixed(1) + '%') : usagePercent < 80 ? chalk.yellow(usagePercent.toFixed(1) + '%') : chalk.red(usagePercent.toFixed(1) + '%')}`);
        console.log(`    ${progressBar} ${chalk.dim(Math.round(usagePercent) + '%')}`);
        console.log();
        prompt();
        return true;
      }

      case '/effort': {
        const levelArg = parts[1]?.toLowerCase();
        const validLevels: EffortLevel[] = ['low', 'medium', 'high', 'max'];
        if (!levelArg) {
          console.log();
          console.log(colors.label('  Effort Level:'));
          for (const lvl of validLevels) {
            const marker = lvl === currentEffort ? chalk.green(' \u25CF ') : chalk.dim(' \u25CB ');
            const label = lvl === currentEffort ? chalk.white.bold(lvl) : chalk.dim(lvl);
            console.log(`  ${marker}${label.padEnd(lvl === currentEffort ? 8 : 8)} ${chalk.dim(EFFORT_PROMPTS[lvl])}`);
          }
          console.log();
          printInfo('Usage: /effort <low|medium|high|max>');
          prompt();
          return true;
        }
        if (!validLevels.includes(levelArg as EffortLevel)) {
          printWarning(`Invalid effort level: ${levelArg}. Use: low, medium, high, max`);
          prompt();
          return true;
        }
        currentEffort = levelArg as EffortLevel;
        const emoji = { low: '\u26A1', medium: '\u2696', high: '\uD83E\uDDE0', max: '\uD83D\uDD2C' }[currentEffort];
        printSuccess(`Effort set to ${chalk.bold(currentEffort)} ${emoji} - ${EFFORT_PROMPTS[currentEffort]}`);
        prompt();
        return true;
      }

      // ── File & Shell tool-use commands ────────────────────────
      case '/read': {
        const filePath = parts.slice(1).join(' ');
        if (!filePath) {
          printWarning('Usage: /read <file>');
          prompt();
          return true;
        }
        try {
          const resolved = path.resolve(filePath);
          const { content, language } = readFileContent(resolved);
          const lineCount = content.split('\n').length;
          const contextMsg = `File content of ${resolved}:\n\`\`\`${language}\n${content}\n\`\`\``;
          history.push({ role: 'user', content: contextMsg });
          printSuccess(`Added ${chalk.bold(filePath)} to context (${lineCount} lines)`);
        } catch (err: any) {
          printError(err.message);
        }
        prompt();
        return true;
      }

      case '/write': {
        const writeTarget = parts.slice(1).join(' ');
        if (!writeTarget) {
          printWarning('Usage: /write <file>');
          printInfo('Writes the last code block from the AI response to a file.');
          prompt();
          return true;
        }
        // Find the last assistant message
        const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
        if (!lastAssistant) {
          printWarning('No AI response to extract code from.');
          prompt();
          return true;
        }
        // Extract the last code block (``` ... ```)
        const codeBlockRegex = /```[\w]*\n([\s\S]*?)```/g;
        const matches = [...lastAssistant.content.matchAll(codeBlockRegex)];
        if (matches.length === 0) {
          printWarning('No code block found in the last AI response.');
          prompt();
          return true;
        }
        const codeContent = matches[matches.length - 1][1];
        const resolvedWrite = path.resolve(writeTarget);
        try {
          // Create backup if file exists
          if (fileExists(resolvedWrite)) {
            const backupPath = resolvedWrite + '.bak';
            fs.copyFileSync(resolvedWrite, backupPath);
            printInfo(`Backup created: ${chalk.dim(backupPath)}`);
          }
          writeFileContent(resolvedWrite, codeContent);
          const writeLineCount = codeContent.split('\n').length;
          printSuccess(`Wrote ${writeLineCount} lines to ${chalk.bold(writeTarget)}`);
        } catch (err: any) {
          printError(err.message);
        }
        prompt();
        return true;
      }

      case '/run': {
        const shellCmd = parts.slice(1).join(' ');
        if (!shellCmd) {
          printWarning('Usage: /run <command>');
          prompt();
          return true;
        }
        try {
          const result = execSync(shellCmd, {
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            cwd: process.cwd(),
            timeout: 30000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          const output = result.trim();
          if (output) {
            console.log(`\n${chalk.dim('  $')} ${chalk.white(shellCmd)}`);
            console.log(chalk.dim('  ' + output.split('\n').join('\n  ')));
          } else {
            console.log(`\n${chalk.dim('  $')} ${chalk.white(shellCmd)}`);
            printInfo('(no output)');
          }
          // Add output to conversation context so AI knows the result
          const contextMsg = `Shell command: ${shellCmd}\nOutput:\n\`\`\`\n${output}\n\`\`\``;
          history.push({ role: 'user', content: contextMsg });
        } catch (err: any) {
          const stderr = (err.stderr || '').toString().trim();
          const stdout = (err.stdout || '').toString().trim();
          console.log(`\n${chalk.dim('  $')} ${chalk.white(shellCmd)}`);
          if (stdout) console.log(chalk.dim('  ' + stdout.split('\n').join('\n  ')));
          if (stderr) console.log(chalk.red('  ' + stderr.split('\n').join('\n  ')));
          if (err.killed) printWarning('Command timed out (30s limit).');
          // Still add to context even on failure
          const contextMsg = `Shell command: ${shellCmd}\nExit code: ${err.status ?? 1}\n${stderr ? 'Stderr:\n```\n' + stderr + '\n```' : ''}${stdout ? '\nStdout:\n```\n' + stdout + '\n```' : ''}`;
          history.push({ role: 'user', content: contextMsg });
        }
        prompt();
        return true;
      }

      case '/ls': {
        const lsDir = parts[1] ? path.resolve(parts.slice(1).join(' ')) : process.cwd();
        try {
          if (!fs.existsSync(lsDir)) {
            printError(`Directory not found: ${lsDir}`);
            prompt();
            return true;
          }
          const entries = fs.readdirSync(lsDir, { withFileTypes: true });
          console.log(`\n  ${chalk.bold(lsDir)}`);
          console.log();
          for (const entry of entries) {
            const fullPath = path.join(lsDir, entry.name);
            try {
              const stat = fs.statSync(fullPath);
              if (entry.isDirectory()) {
                console.log(`  ${chalk.blue(entry.name + '/')}${chalk.dim(''.padStart(Math.max(1, 40 - entry.name.length)))}${chalk.dim('<dir>')}`);
              } else {
                const size = stat.size;
                const sizeStr = size < 1024 ? `${size}B`
                  : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)}K`
                  : `${(size / 1024 / 1024).toFixed(1)}M`;
                console.log(`  ${chalk.white(entry.name)}${chalk.dim(''.padStart(Math.max(1, 40 - entry.name.length)))}${chalk.dim(sizeStr)}`);
              }
            } catch {
              console.log(`  ${chalk.dim(entry.name)}`);
            }
          }
          console.log(chalk.dim(`\n  ${entries.length} items`));
        } catch (err: any) {
          printError(err.message);
        }
        prompt();
        return true;
      }

      case '/cat': {
        const catFile = parts.slice(1).join(' ');
        if (!catFile) {
          printWarning('Usage: /cat <file>');
          prompt();
          return true;
        }
        try {
          const resolved = path.resolve(catFile);
          const { content, language } = readFileContent(resolved);
          const lines = content.split('\n');
          const lineNumWidth = String(lines.length).length;
          console.log(`\n  ${chalk.bold(resolved)} ${chalk.dim(`(${lines.length} lines, ${language})`)}`);
          console.log();
          lines.forEach((line, i) => {
            const lineNum = String(i + 1).padStart(lineNumWidth, ' ');
            console.log(`  ${chalk.dim(lineNum + ' |')} ${line}`);
          });
          console.log();
        } catch (err: any) {
          printError(err.message);
        }
        prompt();
        return true;
      }

      case '/pwd':
        console.log(`\n  ${chalk.bold(process.cwd())}\n`);
        prompt();
        return true;

      case '/cd': {
        const cdDir = parts.slice(1).join(' ');
        if (!cdDir) {
          printWarning('Usage: /cd <dir>');
          prompt();
          return true;
        }
        try {
          const resolved = path.resolve(cdDir);
          if (!fs.existsSync(resolved)) {
            printError(`Directory not found: ${resolved}`);
            prompt();
            return true;
          }
          if (!fs.statSync(resolved).isDirectory()) {
            printError(`Not a directory: ${resolved}`);
            prompt();
            return true;
          }
          process.chdir(resolved);
          printSuccess(`Changed directory to ${chalk.bold(resolved)}`);
        } catch (err: any) {
          printError(err.message);
        }
        prompt();
        return true;
      }

      case '/fetch': {
        const fetchUrlArg = parts.slice(1).join(' ');
        if (!fetchUrlArg) {
          printWarning('Usage: /fetch <url>');
          printInfo('Fetches a URL and adds the text content to conversation context.');
          prompt();
          return true;
        }
        const spinner = startSpinner(`Fetching ${fetchUrlArg}...`);
        fetchUrl(fetchUrlArg).then(result => {
          stopSpinner(spinner);
          if (result.error) {
            printError(`Failed to fetch: ${result.error}`);
          } else {
            const content = result.content || '';
            const truncated = content.length > 50 * 1024
              ? content.substring(0, 50 * 1024) + '\n\n[Content truncated at 50KB]'
              : content;
            const contextMsg = `Fetched content from ${fetchUrlArg} (${result.contentType || 'unknown'}):\n\`\`\`\n${truncated}\n\`\`\``;
            history.push({ role: 'user', content: contextMsg });
            const lines = truncated.split('\n').length;
            printSuccess(`Added ${lines} lines from ${colors.file(fetchUrlArg)} to context`);
            if (content.length > 50 * 1024) {
              printWarning('Content was truncated to 50KB.');
            }
          }
          prompt();
        }).catch((err: any) => {
          stopSpinner(spinner, err.message, false);
          printError(`Fetch failed: ${err.message}`);
          prompt();
        });
        return true;
      }

      case '/help':
        console.log(HELP_TEXT);
        // List custom commands if any
        if (customCommands.size > 0) {
          console.log(`${colors.label('Custom Commands (from .orion/commands/):')}`);
          for (const [name] of customCommands) {
            console.log(`  ${colors.command('/' + name)}`);
          }
          console.log();
        }
        prompt();
        return true;

      default:
        if (command.startsWith('/')) {
          // Check custom commands from .orion/commands/
          const customCmdName = command.slice(1); // remove leading /
          if (customCommands.has(customCmdName)) {
            let template = customCommands.get(customCmdName)!;
            // Support {{file}} placeholder - use current working directory context
            template = template.replace(/\{\{file\}\}/g, process.cwd());
            // Support {{selection}} placeholder - empty in interactive mode
            template = template.replace(/\{\{selection\}\}/g, '');
            printInfo(`Running custom command: ${colors.command('/' + customCmdName)}`);
            processInput(template);
            return true;
          }

          const shortcut = resolveModelShortcut(command.slice(1));
          if (shortcut) {
            switchToProvider(shortcut.provider, shortcut.model);
            prompt();
            return true;
          }
          printWarning(`Unknown command: ${command}. Type /help for available commands.`);
          prompt();
          return true;
        }
        return false;
    }
  }

  function switchToProvider(provider: AIProvider, model?: string): void {
    const target = available.find(p => p.provider === provider);
    if (!target) {
      console.log(colors.error(`  ${getProviderDisplay(provider).name} is not available.`));
      printInfo('Run `orion config` to set up this provider.');
      return;
    }
    activeProvider = provider;
    activeModel = model || target.model;
    const display = getProviderDisplay(activeProvider);
    console.log(`  ${chalk.yellow('\u27F3')} Switched to ${display.badge} ${chalk.dim(activeModel)}`);

    const cfg = readConfig();
    cfg.provider = activeProvider;
    cfg.model = activeModel;
    writeConfig(cfg);
  }

  async function processInput(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) {
      prompt();
      return;
    }

    // Handle /switch shorthand
    if (trimmed === '\t' || trimmed === 'Tab') {
      switchToNextProvider();
      prompt();
      return;
    }

    if (handleSlashCommand(trimmed)) return;

    // Display user message in a box
    console.log();
    console.log(userMessageBox(trimmed));

    history.push({ role: 'user', content: trimmed });

    // Compact conversation history if it has grown too long
    if (history.length >= COMPACTION_THRESHOLD || estimateTokens(history) >= 8000) {
      const compactSpinner = startSpinner('Compacting conversation history...');
      try {
        const compacted = await compactHistory(history);
        stopSpinner(compactSpinner, 'History compacted');
        // Replace the history array contents in-place
        history.length = 0;
        history.push(...compacted);
      } catch {
        stopSpinner(compactSpinner);
        // Compaction failed silently; continue with full history
      }
    }

    const spinner = startSpinner('Thinking...');
    let firstToken = true;
    let responseBuffer = '';

    const display = getProviderDisplay(activeProvider);
    const responseStart = new Date();

    try {
      // Prepend effort-level modifier to system prompt when not default
      const effectiveSystem: AIMessage = currentEffort !== 'medium'
        ? { role: 'system', content: `[Effort: ${currentEffort}] ${EFFORT_PROMPTS[currentEffort]}\n\n${systemMessage.content}` }
        : systemMessage;
      const messages: AIMessage[] = [effectiveSystem, ...history];

      await streamChat(messages, {
        onToken(token: string) {
          responseBuffer += token;
        },
        onComplete(fullText: string) {
          stopSpinner(spinner);

          // Show AI response header
          console.log();
          console.log(aiResponseHeader(activeProvider, activeModel, responseStart));

          // Render as markdown (single output, no duplication)
          console.log(renderMarkdown(fullText));

          // Show token count
          const tokens = Math.ceil(fullText.length / 4);
          console.log(tokenCountFooter(tokens));

          history.push({ role: 'assistant', content: fullText });

          // Update stats
          if (!stats[activeProvider]) stats[activeProvider] = { messages: 0, tokens: 0 };
          stats[activeProvider].messages++;
          stats[activeProvider].tokens += tokens;
        },
        onError(error: Error) {
          stopSpinner(spinner, error.message, false);
        },
      }, activeProvider, activeModel);
    } catch (err: any) {
      if (firstToken) stopSpinner(spinner, err.message, false);
      console.log(errorDisplay(err.message, [
        'Check your provider configuration with `orion config`.',
      ]));
      // Remove the failed user message from history
      if (history.length > 0 && history[history.length - 1].role === 'user') {
        history.pop();
      }
    }

    prompt();
  }

  // Start
  prompt();

  rl.on('line', (line: string) => {
    processInput(line);
  });

  rl.on('close', () => {
    // Auto-save on close (Ctrl+C, etc.)
    if (history.length > 0 && !sessionSaved) {
      try {
        saveCurrentSession();
        console.log(`\n  ${colors.success('Session auto-saved:')} ${sessionId}`);
      } catch { /* best effort */ }
    }
    console.log(`\n${colors.dim('  Session ended.')}\n`);
    process.exit(0);
  });
}
