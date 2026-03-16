/**
 * Orion CLI - Interactive Chat with Hot-Switch
 * Tab to switch between Claude / GPT / Ollama instantly
 * Conversation history preserved across switches
 */

import * as readline from 'readline';
import chalk from 'chalk';
import {
  streamChat,
  getProviderInfo,
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
  startSpinner,
  stopSpinner,
  getCurrentDirectoryContext,
  readConfig,
  writeConfig,
} from '../utils.js';

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

export async function chatCommand(): Promise<void> {
  printHeader('Orion Interactive Chat');

  // Detect all available providers
  const providers = await getAvailableProviders();
  const available = providers.filter(p => p.available);

  if (available.length === 0) {
    console.log(colors.error('\n  No AI providers available.'));
    console.log(colors.dim('  Run: orion config'));
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
      ? chalk.green('●') + ' ' + display.color(display.name) + chalk.dim(` (${p.model})`)
      : chalk.red('○') + ' ' + chalk.dim(display.name + (p.reason ? ` - ${p.reason}` : ''));
    const active = p.provider === activeProvider ? chalk.yellow(' ← active') : '';
    console.log(`    ${status}${active}`);
  }
  console.log();

  // Show controls
  const switchProviders = available.map(p => getProviderDisplay(p.provider).name).join('/');
  printInfo(`${colors.command('Tab')} Switch provider (${switchProviders})`);
  printInfo(`${colors.command('/model <name>')} Switch to specific model`);
  printInfo(`${colors.command('/help')} All commands`);
  console.log();

  const history: AIMessage[] = [];
  const context = getCurrentDirectoryContext();
  const systemMessage: AIMessage = {
    role: 'system',
    content: SYSTEM_PROMPT + context,
  };

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
    console.log(`\n  ${chalk.yellow('⟳')} Switched to ${display.badge} ${chalk.dim(activeModel)}`);

    // Save preference
    const cfg = readConfig();
    cfg.provider = activeProvider;
    cfg.model = activeModel;
    writeConfig(cfg);
  }

  // Intercept Tab key for provider switching
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.setRawMode(false);
    // Use readline's keypress detection
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.setRawMode) {
      // We'll handle Tab via the line handler with a special approach
    }
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
  ${colors.command('/stats')}         Show conversation statistics
  ${colors.command('/clear')}         Clear conversation history
  ${colors.command('/help')}          Show this help message
  ${colors.command('/exit')}          Exit the chat session

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
      case '/q':
        // Show stats before exit
        const totalMessages = Object.values(stats).reduce((s, v) => s + v.messages, 0);
        if (totalMessages > 0) {
          console.log(`\n${colors.label('Session Stats:')}`);
          for (const [prov, s] of Object.entries(stats)) {
            const display = getProviderDisplay(prov as AIProvider);
            console.log(`  ${display.badge} ${s.messages} messages, ~${s.tokens} tokens`);
          }
        }
        console.log(`\n${colors.dim('Goodbye! Happy coding.')}\n`);
        rl.close();
        process.exit(0);
        return true;

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
          // Treat as raw model name for current provider
          activeModel = modelArg;
          const display = getProviderDisplay(activeProvider);
          console.log(`  ${chalk.yellow('⟳')} Model set to ${display.badge} ${chalk.dim(activeModel)}`);
        }
        prompt();
        return true;
      }

      case '/models':
        console.log(`\n${colors.label('Available Model Shortcuts:')}`);
        for (const name of listAvailableModels()) {
          const info = resolveModelShortcut(name)!;
          const display = getProviderDisplay(info.provider);
          console.log(`  ${colors.command(name.padEnd(16))} → ${display.color(display.name)} ${chalk.dim(info.model)}`);
        }
        prompt();
        return true;

      case '/providers': {
        console.log(`\n${colors.label('Provider Status:')}`);
        getAvailableProviders().then(provs => {
          for (const p of provs) {
            const display = getProviderDisplay(p.provider);
            const status = p.available ? chalk.green('● available') : chalk.red(`○ ${p.reason || 'unavailable'}`);
            const active = p.provider === activeProvider ? chalk.yellow(' ← active') : '';
            console.log(`  ${display.badge} ${status}${active}`);
          }
          prompt();
        });
        return true;
      }

      case '/stats': {
        const total = Object.values(stats).reduce((s, v) => s + v.messages, 0);
        console.log(`\n${colors.label('Session Statistics:')}`);
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
        console.log(colors.success('  Conversation history cleared.'));
        prompt();
        return true;

      case '/help':
        console.log(HELP_TEXT);
        prompt();
        return true;

      default:
        if (command.startsWith('/')) {
          // Try as model shortcut
          const shortcut = resolveModelShortcut(command.slice(1));
          if (shortcut) {
            switchToProvider(shortcut.provider, shortcut.model);
            prompt();
            return true;
          }
          console.log(colors.warning(`  Unknown command: ${command}. Type /help for available commands.`));
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
      return;
    }
    activeProvider = provider;
    activeModel = model || target.model;
    const display = getProviderDisplay(activeProvider);
    console.log(`  ${chalk.yellow('⟳')} Switched to ${display.badge} ${chalk.dim(activeModel)}`);

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

    const display = getProviderDisplay(activeProvider);

    try {
      const messages: AIMessage[] = [systemMessage, ...history];

      process.stdout.write(`\n  ${display.color(display.name + ':')} `);

      const response = await streamChat(messages, {
        onToken(token: string) {
          if (firstToken) {
            stopSpinner(spinner);
            firstToken = false;
          }
          process.stdout.write(colors.ai(token));
        },
        onComplete(fullText: string) {
          if (firstToken) stopSpinner(spinner);
          process.stdout.write('\n');
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
    console.log(`\n${colors.dim('Session ended.')}\n`);
    process.exit(0);
  });
}
