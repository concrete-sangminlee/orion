import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

const id = (s: any) => String(s ?? '');

// Mock chalk fully
vi.mock('chalk', () => {
  const handler: ProxyHandler<any> = {
    get(_t: any, _p: string | symbol) { return chainable; },
    apply(_t: any, _this: any, args: any[]) { return args.length > 0 ? String(args[0] ?? '') : ''; },
  };
  const chainable: any = new Proxy(function () {} as any, handler);
  return { default: chainable };
});

vi.mock('ora', () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

vi.mock('../markdown.js', () => ({
  renderMarkdown: (text: string) => text || '',
  printMarkdown: vi.fn(),
}));

vi.mock('../ai-client.js', () => ({
  askAI: vi.fn(),
  streamChat: vi.fn(),
  getAvailableProviders: vi.fn().mockResolvedValue([]),
  getProviderDisplay: vi.fn().mockReturnValue({ name: 'Claude', color: id, badge: 'Claude' }),
  resolveModelShortcut: vi.fn((input: string) => {
    const shortcuts: Record<string, { provider: string; model: string }> = {
      'claude': { provider: 'anthropic', model: 'claude-opus-5-5' },
      'claude-opus': { provider: 'anthropic', model: 'claude-opus-5-5' },
      'gpt': { provider: 'openai', model: 'gpt-4o' },
      'gpt-4o-mini': { provider: 'openai', model: 'gpt-4o-mini' },
      'ollama': { provider: 'ollama', model: 'llama3.2' },
    };
    return shortcuts[input.toLowerCase()] || null;
  }),
  listAvailableModels: vi.fn().mockReturnValue([]),
  listOllamaModels: vi.fn().mockResolvedValue([]),
  DEFAULT_MODELS: { anthropic: 'claude-opus-5-5', openai: 'gpt-4o', ollama: 'llama3.2' },
  FAST_MODELS: { anthropic: 'claude-haiku-5-5', openai: 'gpt-4o-mini' },
}));

vi.mock('../ui.js', () => ({
  errorDisplay: (msg: string, fixes?: string[]) => {
    let out = `ERROR: ${msg}`;
    if (fixes) out += '\n' + fixes.join('\n');
    return out;
  },
  palette: new Proxy({}, {
    get() { return (s: any) => String(s ?? ''); },
  }),
  providerStatusList: vi.fn(() => ''),
  userMessageBox: vi.fn(() => ''),
  aiResponseHeader: vi.fn(() => ''),
  tokenCountFooter: vi.fn(() => ''),
  divider: vi.fn(() => ''),
  table: vi.fn(() => ''),
  providerBadge: vi.fn(() => ''),
}));

vi.mock('../utils.js', () => {
  const id = (s: any) => String(s ?? '');
  return {
    colors: new Proxy({}, {
      get() { return id; },
    }),
    printHeader: vi.fn(),
    printDivider: vi.fn(),
    printInfo: vi.fn(),
    printSuccess: vi.fn(),
    printWarning: vi.fn(),
    printError: vi.fn(),
    startSpinner: vi.fn().mockReturnValue({}),
    stopSpinner: vi.fn(),
    getCurrentDirectoryContext: vi.fn().mockReturnValue(''),
    loadProjectContext: vi.fn().mockReturnValue(null),
    readConfig: vi.fn().mockReturnValue({}),
    writeConfig: vi.fn(),
    readFileContent: vi.fn().mockReturnValue({ content: 'file content', language: 'ts' }),
    writeFileContent: vi.fn(),
    fileExists: vi.fn().mockReturnValue(false),
    saveChatSession: vi.fn(),
    loadChatSession: vi.fn(),
    listChatSessions: vi.fn().mockReturnValue([]),
    trackCost: vi.fn(),
    estimateTokens: vi.fn().mockReturnValue(0),
  };
});

vi.mock('./fetch.js', () => ({
  fetchUrl: vi.fn(),
  stripHtmlTags: vi.fn((s: string) => s),
}));

// ─── Read chat.ts source to test slash command logic ──────────────────────

const CLI_DIR = path.resolve(__dirname, '..');
const chatSource = fs.readFileSync(path.join(CLI_DIR, 'commands', 'chat.ts'), 'utf-8');

// ─── Tests ────────────────────────────────────────────────────────────────

describe('chat slash command parsing', () => {
  describe('/help command', () => {
    it('help text is defined as HELP_TEXT constant', () => {
      expect(chatSource).toContain('const HELP_TEXT');
    });

    it('/help case returns true (handled)', () => {
      expect(chatSource).toMatch(/case '\/help'/);
    });

    it('help text includes Chat Commands section', () => {
      expect(chatSource).toContain('Chat Commands');
    });

    it('help text includes Session Commands section', () => {
      expect(chatSource).toContain('Session Commands');
    });

    it('help text includes Context & Effort section', () => {
      expect(chatSource).toContain('Context & Effort');
    });

    it('help text includes File & Shell section', () => {
      expect(chatSource).toContain('File & Shell');
    });
  });

  describe('/clear command', () => {
    it('clears history by setting length to 0', () => {
      expect(chatSource).toContain("case '/clear'");
      expect(chatSource).toContain('history.length = 0');
    });

    it('prints success message after clearing', () => {
      expect(chatSource).toContain("printSuccess('Conversation history cleared.')");
    });
  });

  describe('unknown /command handling', () => {
    it('shows warning for unknown slash commands', () => {
      expect(chatSource).toContain('Unknown command');
      expect(chatSource).toContain('/help for available commands');
    });

    it('checks for model shortcut before declaring unknown', () => {
      const defaultSection = chatSource.slice(chatSource.indexOf("default:"));
      expect(defaultSection).toContain('resolveModelShortcut');
    });

    it('checks custom commands from .orion/commands/', () => {
      expect(chatSource).toContain('customCommands.has');
    });
  });

  describe('/model command', () => {
    it('resolves known model shortcuts via resolveModelShortcut', () => {
      expect(chatSource).toContain("case '/model'");
      expect(chatSource).toContain('resolveModelShortcut(modelArg)');
    });

    it('shows usage when no argument provided', () => {
      expect(chatSource).toContain('Usage: /model <name>');
    });

    it('switches provider when shortcut resolves', () => {
      expect(chatSource).toContain('switchToProvider(shortcut.provider, shortcut.model)');
    });

    it('falls back to treating argument as model name for unknown shortcuts', () => {
      expect(chatSource).toContain('activeModel = modelArg');
    });
  });

  describe('/effort command', () => {
    it('defines valid effort levels: low, medium, high, max', () => {
      expect(chatSource).toContain("type EffortLevel = 'low' | 'medium' | 'high' | 'max'");
    });

    it('defaults to medium effort', () => {
      expect(chatSource).toContain("let currentEffort: EffortLevel = 'medium'");
    });

    it('shows current effort levels when no argument given', () => {
      expect(chatSource).toContain("case '/effort'");
      expect(chatSource).toContain("if (!levelArg)");
    });

    it('prints warning for invalid effort level', () => {
      expect(chatSource).toContain('Invalid effort level');
    });

    it('sets effort with printSuccess on valid level', () => {
      expect(chatSource).toContain('Effort set to');
    });

    it('has prompt text for each effort level', () => {
      expect(chatSource).toContain("low: 'Be very concise, one-liner answers.'");
      expect(chatSource).toContain("medium: 'Be clear and thorough.'");
      expect(chatSource).toContain("high: 'Think step by step, consider edge cases.'");
      expect(chatSource).toContain("max: 'Think deeply, consider all angles, provide comprehensive analysis.'");
    });
  });

  describe('/compact command', () => {
    it('checks minimum history length before compacting', () => {
      expect(chatSource).toContain("case '/compact'");
      expect(chatSource).toContain('history.length < 2');
    });

    it('shows info message when conversation is too short', () => {
      expect(chatSource).toContain('Nothing to compact (conversation too short)');
    });

    it('uses compactHistory function', () => {
      expect(chatSource).toContain('compactHistory(history)');
    });

    it('defines COMPACTION_THRESHOLD constant', () => {
      expect(chatSource).toContain('const COMPACTION_THRESHOLD = 20');
    });

    it('defines RECENT_MESSAGES_TO_KEEP constant', () => {
      expect(chatSource).toContain('const RECENT_MESSAGES_TO_KEEP = 6');
    });
  });

  describe('/context command', () => {
    it('shows token estimates for system prompt, history, and project context', () => {
      expect(chatSource).toContain("case '/context'");
      expect(chatSource).toContain('estimateTokens');
    });

    it('calculates context limits per provider', () => {
      expect(chatSource).toContain('anthropic: 200000');
      expect(chatSource).toContain('openai: 128000');
      expect(chatSource).toContain('ollama: 128000');
    });

    it('displays usage percentage', () => {
      expect(chatSource).toContain('usagePercent');
    });

    it('displays progress bar visualization', () => {
      expect(chatSource).toContain('progressBar');
    });
  });

  describe('/copy command', () => {
    it('handles missing response with warning', () => {
      expect(chatSource).toContain("case '/copy'");
      expect(chatSource).toContain('No AI response to copy');
    });

    it('uses platform-specific clipboard command', () => {
      expect(chatSource).toContain("process.platform === 'win32'");
      expect(chatSource).toContain("'clip'");
      expect(chatSource).toContain("'pbcopy'");
      expect(chatSource).toContain("'xclip -selection clipboard'");
    });

    it('falls back when clipboard is not available', () => {
      expect(chatSource).toContain('Clipboard not available');
    });
  });

  describe('/btw command', () => {
    it('processes side question without adding to main history', () => {
      expect(chatSource).toContain("case '/btw'");
      // It calls askAI directly, not adding to history array
      expect(chatSource).toContain("await askAI('Answer briefly.', sideQ)");
    });

    it('shows usage when no argument provided', () => {
      expect(chatSource).toContain("Usage: /btw <question>");
    });

    it('displays response with [btw] prefix', () => {
      expect(chatSource).toContain('[btw]');
    });
  });

  describe('/fast command', () => {
    it('toggles to lighter model for anthropic', () => {
      expect(chatSource).toContain("case '/fast'");
      expect(chatSource).toContain('activeModel = FAST_MODELS.anthropic');
    });

    it('toggles to lighter model for openai', () => {
      expect(chatSource).toContain('activeModel = FAST_MODELS.openai');
    });

    it('treats opus, sonnet and fable as full models', () => {
      const fastSection = chatSource.slice(chatSource.indexOf("case '/fast'"));
      expect(fastSection).toContain("['opus', 'sonnet', 'fable', '4o']");
    });

    it('restores full model when toggled off (anthropic)', () => {
      expect(chatSource).toContain('activeModel = DEFAULT_MODELS.anthropic');
    });

    it('restores full model when toggled off (openai)', () => {
      const fastSection = chatSource.slice(chatSource.indexOf("case '/fast'"));
      expect(fastSection).toContain('activeModel = DEFAULT_MODELS.openai');
    });

    it('does not hard-code retired Claude model IDs', () => {
      expect(chatSource).not.toMatch(/claude-(sonnet|opus)-4-2025\d{4}/);
    });

    it('shows fast mode ON/OFF message', () => {
      expect(chatSource).toContain('Fast mode ON');
      expect(chatSource).toContain('Fast mode OFF');
    });
  });

  describe('/read command', () => {
    it('handles missing file argument with usage warning', () => {
      expect(chatSource).toContain("case '/read'");
      expect(chatSource).toContain("Usage: /read <file>");
    });

    it('resolves file path and reads content', () => {
      expect(chatSource).toContain('path.resolve(filePath)');
      expect(chatSource).toContain('readFileContent(resolved)');
    });

    it('adds file content to conversation history', () => {
      const readSection = chatSource.slice(
        chatSource.indexOf("case '/read'"),
        chatSource.indexOf("case '/write'")
      );
      expect(readSection).toContain("history.push");
    });

    it('catches errors when file cannot be read', () => {
      const readSection = chatSource.slice(
        chatSource.indexOf("case '/read'"),
        chatSource.indexOf("case '/write'")
      );
      expect(readSection).toContain('catch (err');
      expect(readSection).toContain('printError');
    });
  });

  describe('/write command', () => {
    it('handles no response with warning', () => {
      expect(chatSource).toContain("case '/write'");
      expect(chatSource).toContain('No AI response to extract code from');
    });

    it('shows usage when no file argument provided', () => {
      expect(chatSource).toContain("Usage: /write <file>");
    });

    it('extracts last code block from assistant response', () => {
      expect(chatSource).toContain('codeBlockRegex');
      expect(chatSource).toContain('matchAll(codeBlockRegex)');
    });

    it('creates backup of existing file before writing', () => {
      expect(chatSource).toContain("resolvedWrite + '.bak'");
      expect(chatSource).toContain('fs.copyFileSync');
    });

    it('warns when no code block found', () => {
      expect(chatSource).toContain('No code block found in the last AI response');
    });
  });

  describe('/run command', () => {
    it('handles timeout with 30s limit', () => {
      expect(chatSource).toContain("case '/run'");
      expect(chatSource).toContain('timeout: 30000');
    });

    it('shows usage when no command provided', () => {
      expect(chatSource).toContain("Usage: /run <command>");
    });

    it('adds command output to conversation context', () => {
      const runSection = chatSource.slice(
        chatSource.indexOf("case '/run'"),
        chatSource.indexOf("case '/ls'")
      );
      expect(runSection).toContain("history.push");
    });

    it('detects killed (timed out) commands', () => {
      expect(chatSource).toContain('err.killed');
      expect(chatSource).toContain('Command timed out');
    });
  });

  describe('/ls command', () => {
    it('defaults to current working directory', () => {
      expect(chatSource).toContain("case '/ls'");
      expect(chatSource).toContain('process.cwd()');
    });

    it('handles missing directory with error', () => {
      const lsSection = chatSource.slice(
        chatSource.indexOf("case '/ls'"),
        chatSource.indexOf("case '/cat'")
      );
      expect(lsSection).toContain('Directory not found');
    });

    it('lists directory entries with file sizes', () => {
      expect(chatSource).toContain('readdirSync');
      expect(chatSource).toContain('withFileTypes: true');
    });

    it('shows item count at the end', () => {
      expect(chatSource).toContain('items');
    });
  });

  describe('/cd command', () => {
    it('handles invalid path with error', () => {
      expect(chatSource).toContain("case '/cd'");
      expect(chatSource).toContain('Directory not found');
    });

    it('shows usage when no argument provided', () => {
      expect(chatSource).toContain("Usage: /cd <dir>");
    });

    it('validates that target is a directory, not a file', () => {
      expect(chatSource).toContain('Not a directory');
      expect(chatSource).toContain('.isDirectory()');
    });

    it('calls process.chdir on success', () => {
      expect(chatSource).toContain('process.chdir(resolved)');
    });

    it('prints success message with new directory', () => {
      expect(chatSource).toContain('Changed directory to');
    });
  });

  describe('slash command parsing structure', () => {
    it('handleSlashCommand is an async function', () => {
      expect(chatSource).toContain('async function handleSlashCommand(cmd: string): Promise<boolean>');
    });

    it('splits command into parts on whitespace', () => {
      expect(chatSource).toContain("cmd.trim().split(/\\s+/)");
    });

    it('converts command to lowercase for comparison', () => {
      expect(chatSource).toContain('parts[0].toLowerCase()');
    });

    it('uses switch statement for command dispatch', () => {
      expect(chatSource).toContain('switch (command)');
    });

    it('returns true for handled commands, false otherwise', () => {
      expect(chatSource).toContain('return true');
      expect(chatSource).toContain('return false');
    });
  });

  describe('session commands', () => {
    it('/exit auto-saves and shows stats', () => {
      expect(chatSource).toContain("case '/exit'");
      expect(chatSource).toContain('Auto-save on exit');
    });

    it('/save saves current session', () => {
      expect(chatSource).toContain("case '/save'");
      expect(chatSource).toContain('handleSaveCommand');
    });

    it('/history lists saved sessions', () => {
      expect(chatSource).toContain("case '/history'");
      expect(chatSource).toContain('handleHistoryCommand');
    });

    it('/load restores a previous session', () => {
      expect(chatSource).toContain("case '/load'");
      expect(chatSource).toContain('handleLoadCommand');
    });

    it('/stats shows conversation statistics', () => {
      expect(chatSource).toContain("case '/stats'");
      expect(chatSource).toContain('Session Statistics');
    });
  });
});

describe('chat estimateTokens function', () => {
  it('estimateTokens is defined in chat.ts', () => {
    expect(chatSource).toContain('function estimateTokens');
  });

  it('uses ~4 characters per token estimation', () => {
    expect(chatSource).toContain('m.content.length / 4');
  });
});

describe('chat compactHistory function', () => {
  it('compactHistory is an async function', () => {
    expect(chatSource).toContain('async function compactHistory');
  });

  it('checks both message count and token count thresholds', () => {
    expect(chatSource).toContain('history.length < COMPACTION_THRESHOLD');
    expect(chatSource).toContain('estimateTokens(history) < 8000');
  });

  it('keeps recent messages and summarizes older ones', () => {
    expect(chatSource).toContain('history.slice(-RECENT_MESSAGES_TO_KEEP)');
    expect(chatSource).toContain('history.slice(0, -RECENT_MESSAGES_TO_KEEP)');
  });

  it('falls back to recent-only on summarization failure', () => {
    expect(chatSource).toContain('return recent');
  });
});

describe('chat system prompt', () => {
  it('defines SYSTEM_PROMPT', () => {
    expect(chatSource).toContain('const SYSTEM_PROMPT');
  });

  it('identifies as Orion coding assistant', () => {
    expect(chatSource).toContain('You are Orion');
  });

  it('instructs to use markdown code blocks', () => {
    expect(chatSource).toContain('markdown code blocks');
  });
});
