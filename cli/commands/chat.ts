/**
 * Orion CLI - Interactive Chat with Hot-Switch & Persistent History
 * Tab to switch between Claude / GPT / Ollama instantly
 * Conversation history preserved across switches
 * /save, /history, /load commands for session persistence
 */

import * as readline from 'readline';
import chalk from 'chalk';
import {
  streamChat,
  getAvailableProviders,
  getProviderDisplay,
  resolveModelShortcut,
  listAvailableModels,
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
  startSpinner,
  stopSpinner,
  getCurrentDirectoryContext,
  loadProjectContext,
  readConfig,
  writeConfig,
  saveChatSession,
  loadChatSession,
  listChatSessions,
  type ChatSession,
} from '../utils.js';
import { renderMarkdown } from '../markdown.js';

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
    console.log();
    console.log(colors.error('  No AI providers available.'));
    printInfo('Run `orion config` to set up API keys or start Ollama.');
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

  // Show available providers
  console.log();
  printInfo('Available providers:');
  for (const p of providers) {
    const display = getProviderDisplay(p.provider);
    const status = p.available
      ? chalk.green('\u25CF') + ' ' + display.color(display.name) + chalk.dim(` (${p.model})`)
      : chalk.red('\u25CB') + ' ' + chalk.dim(display.name + (p.reason ? ` - ${p.reason}` : ''));
    const active = p.provider === activeProvider ? chalk.yellow(' <- active') : '';
    console.log(`    ${status}${active}`);
  }
  console.log();

  // Show controls
  const switchProviders = available.map(p => getProviderDisplay(p.provider).name).join('/');
  printInfo(`${colors.command('Tab')} Switch provider (${switchProviders})`);
  printInfo(`${colors.command('/model <name>')} Switch to specific model`);
  printInfo(`${colors.command('/save')} Save session  ${colors.command('/history')} List sessions  ${colors.command('/load <id>')} Load session`);
  printInfo(`${colors.command('/help')} All commands`);
  console.log();

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
    const display = getProviderDisplay(activeProvider);
    return display.badge + chalk.dim(` ${activeModel}`);
  }

  function prompt(): void {
    process.stdout.write(`\n  ${getProviderBadge()}\n${colors.user('  You:')} `);
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
    console.log(`\n${colors.label('  Saved Sessions:')}`);
    console.log();
    for (const session of sessions) {
      const date = new Date(session.timestamp).toLocaleString();
      const provDisplay = getProviderDisplay(session.provider as AIProvider);
      console.log(
        `  ${colors.command(session.id)}  ${chalk.dim(date)}  ` +
        `${provDisplay.color(provDisplay.name)} ${chalk.dim(`(${session.messageCount} msgs)`)}`
      );
      console.log(`    ${chalk.dim(session.preview)}`);
    }
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
          console.log(`  ${colors.command(name.padEnd(16))} -> ${display.color(display.name)} ${chalk.dim(info.model)}`);
        }
        prompt();
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

      case '/help':
        console.log(HELP_TEXT);
        prompt();
        return true;

      default:
        if (command.startsWith('/')) {
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

    history.push({ role: 'user', content: trimmed });

    const spinner = startSpinner('Thinking...');
    let firstToken = true;
    let responseBuffer = '';

    const display = getProviderDisplay(activeProvider);

    try {
      const messages: AIMessage[] = [systemMessage, ...history];

      process.stdout.write(`\n  ${display.color(display.name + ':')} `);

      await streamChat(messages, {
        onToken(token: string) {
          if (firstToken) {
            stopSpinner(spinner);
            firstToken = false;
          }
          responseBuffer += token;
          // Stream raw tokens for real-time feedback
          process.stdout.write(chalk.dim(token));
        },
        onComplete(fullText: string) {
          if (firstToken) stopSpinner(spinner);

          // Clear streaming output and render as markdown
          process.stdout.write('\r\x1b[K');
          console.log();
          console.log(renderMarkdown(fullText));

          history.push({ role: 'assistant', content: fullText });

          // Update stats
          if (!stats[activeProvider]) stats[activeProvider] = { messages: 0, tokens: 0 };
          stats[activeProvider].messages++;
          stats[activeProvider].tokens += Math.ceil(fullText.length / 4);
        },
        onError(error: Error) {
          stopSpinner(spinner, error.message, false);
        },
      }, activeProvider, activeModel);
    } catch (err: any) {
      if (firstToken) stopSpinner(spinner, err.message, false);
      console.error(colors.error(`\n  Error: ${err.message}`));
      printInfo('Check your provider configuration with `orion config`.');
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
