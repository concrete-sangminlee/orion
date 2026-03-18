/**
 * Orion CLI - Shared Utilities
 * Config management, formatting helpers, git runner, file utilities
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, exec } from 'child_process';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';

// ─── Config Management ──────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.orion');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface OrionConfig {
  provider?: 'anthropic' | 'openai' | 'ollama';
  model?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  ollamaHost?: string;
  theme?: 'dark' | 'light';
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_CONFIG: OrionConfig = {
  provider: 'ollama',
  model: 'llama3.2',
  ollamaHost: 'http://localhost:11434',
  theme: 'dark',
  maxTokens: 4096,
  temperature: 0.7,
};

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function readConfig(): OrionConfig {
  ensureConfigDir();
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }
  return { ...DEFAULT_CONFIG };
}

export function writeConfig(config: OrionConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

// ─── Spinner Management ─────────────────────────────────────────────────────

let activeSpinner: Ora | null = null;

export function startSpinner(text: string): Ora {
  if (activeSpinner) {
    activeSpinner.stop();
  }
  activeSpinner = ora({
    text: chalk.dim(text),
    spinner: 'dots',
    color: 'magenta',
    prefixText: '  ',
  }).start();
  return activeSpinner;
}

export function stopSpinner(spinner?: Ora, text?: string, success = true): void {
  const s = spinner || activeSpinner;
  if (s) {
    if (text) {
      success
        ? s.succeed(chalk.hex('#22C55E')(text))
        : s.fail(chalk.hex('#EF4444')(text));
    } else {
      s.stop();
    }
    if (s === activeSpinner) activeSpinner = null;
  }
}

// ─── Color Formatting Helpers ────────────────────────────────────────────────

export const colors = {
  // Semantic colors
  primary: chalk.hex('#7C5CFC'),
  secondary: chalk.hex('#38BDF8'),
  success: chalk.hex('#22C55E'),
  warning: chalk.hex('#F59E0B'),
  error: chalk.hex('#EF4444'),
  info: chalk.hex('#3B82F6'),
  dim: chalk.dim,

  // Text roles
  user: chalk.cyan.bold,
  ai: chalk.green,
  code: chalk.yellow,
  file: chalk.hex('#38BDF8').underline,
  command: chalk.hex('#C084FC'),
  label: chalk.hex('#7C5CFC').bold,
  muted: chalk.gray,

  // Severity
  severityError: chalk.bgRed.white.bold,
  severityWarning: chalk.bgYellow.black.bold,
  severityInfo: chalk.bgBlue.white.bold,
};

export function printHeader(text: string): void {
  console.log();
  console.log(`  ${chalk.hex('#9B59B6')('\u2726')} ${colors.primary.bold(text)}`);
  console.log(`  ${colors.dim('\u2500'.repeat(Math.min((process.stdout.columns || 80) - 4, 60)))}`);
}

export function printDivider(): void {
  console.log(`  ${colors.dim('\u2500'.repeat(Math.min((process.stdout.columns || 80) - 4, 60)))}`);
}

export function printKeyValue(key: string, value: string): void {
  console.log(`  ${colors.label(key + ':')} ${value}`);
}

export function printSuccess(text: string): void {
  console.log(`  ${chalk.hex('#22C55E')('\u2713')} ${text}`);
}

export function printError(text: string): void {
  console.log(`  ${chalk.hex('#EF4444')('\u2717')} ${text}`);
}

export function printWarning(text: string): void {
  console.log(`  ${chalk.hex('#F59E0B')('!')} ${text}`);
}

export function printInfo(text: string): void {
  console.log(`  ${chalk.hex('#38BDF8')('i')} ${text}`);
}

// ─── Premium Banner ──────────────────────────────────────────────────────────

export function printBanner(): void {
  const star = chalk.hex('#9B59B6');
  const violet = chalk.hex('#7C5CFC');
  const lavender = chalk.hex('#8B5CF6');
  const dm = chalk.dim;

  const platform = process.platform === 'win32' ? 'Windows'
    : process.platform === 'darwin' ? 'macOS'
    : 'Linux';

  console.log();
  console.log(`  ${star('\u2726')}  ${violet.bold('O R I O N')}`);
  console.log(`  ${dm('\u00B7')}  ${lavender('AI-Powered Coding Assistant')}`);
  console.log(`  ${dm('\u00B7')}  ${dm('v2.0.0 \u00B7 ' + platform)}`);
  console.log(`  ${dm('\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578\u2578')}`);
  console.log();
}

// ─── Git Command Runner ──────────────────────────────────────────────────────

export function runGitCommand(args: string): string {
  try {
    return execSync(`git ${args}`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      cwd: process.cwd(),
    }).trim();
  } catch (err: any) {
    if (err.stderr) {
      throw new Error(`Git error: ${err.stderr.toString().trim()}`);
    }
    throw err;
  }
}

export function isGitRepo(): boolean {
  try {
    runGitCommand('rev-parse --is-inside-work-tree');
    return true;
  } catch {
    return false;
  }
}

export function getStagedDiff(): string {
  return runGitCommand('diff --cached');
}

export function getStagedFiles(): string[] {
  const output = runGitCommand('diff --cached --name-only');
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

export function commitWithMessage(message: string): string {
  const tmpFile = path.join(os.tmpdir(), `orion-commit-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, message, 'utf-8');
  try {
    return runGitCommand(`commit -F "${tmpFile}"`);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ─── File Utilities ──────────────────────────────────────────────────────────

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.r': 'r',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'zsh',
  '.ps1': 'powershell',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.md': 'markdown',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.env': 'env',
  '.dockerfile': 'dockerfile',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.lua': 'lua',
  '.dart': 'dart',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.ml': 'ocaml',
  '.clj': 'clojure',
  '.lisp': 'lisp',
};

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (LANGUAGE_MAP[ext]) return LANGUAGE_MAP[ext];

  const basename = path.basename(filePath).toLowerCase();
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';
  if (basename === '.gitignore') return 'gitignore';

  return 'text';
}

export function readFileContent(filePath: string): { content: string; language: string } {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const stat = fs.statSync(resolvedPath);
  if (stat.size > 1024 * 1024) {
    throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max 1MB.`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const language = detectLanguage(resolvedPath);
  return { content, language };
}

export function writeFileContent(filePath: string, content: string): void {
  const resolvedPath = path.resolve(filePath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(resolvedPath, content, 'utf-8');
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(path.resolve(filePath));
}

// ─── Diff Formatting ─────────────────────────────────────────────────────────

export function formatDiff(original: string, modified: string, filename?: string): string {
  const origLines = original.split(/\r?\n/);
  const modLines = modified.split(/\r?\n/);
  const output: string[] = [];
  const green = chalk.hex('#22C55E');
  const red = chalk.hex('#EF4444');
  const dm = chalk.dim;

  const maxLines = Math.max(origLines.length, modLines.length);

  for (let i = 0; i < maxLines; i++) {
    const origLine = origLines[i];
    const modLine = modLines[i];

    if (origLine === undefined && modLine !== undefined) {
      output.push('  ' + green('+ ' + modLine));
    } else if (origLine !== undefined && modLine === undefined) {
      output.push('  ' + red('- ' + origLine));
    } else if (origLine !== modLine) {
      output.push('  ' + red('- ' + origLine));
      output.push('  ' + green('+ ' + modLine));
    } else {
      output.push('  ' + dm('  ' + origLine));
    }
  }

  return output.join('\n');
}

// ─── Prompt Helpers ──────────────────────────────────────────────────────────

export function getCurrentDirectoryContext(): string {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);
  let context = `Current directory: ${cwd}\nProject: ${projectName}\n`;

  // Check for package.json
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      context += `Package: ${pkg.name || 'unknown'} v${pkg.version || '0.0.0'}\n`;
      if (pkg.description) context += `Description: ${pkg.description}\n`;
    } catch { /* ignore */ }
  }

  // Check for common config files
  const configs = ['tsconfig.json', '.eslintrc', 'vite.config.ts', 'webpack.config.js', 'Cargo.toml', 'go.mod', 'requirements.txt'];
  const found = configs.filter(c => fs.existsSync(path.join(cwd, c)));
  if (found.length > 0) {
    context += `Config files: ${found.join(', ')}\n`;
  }

  return context;
}

export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '****';
  return key.substring(0, 4) + '****' + key.substring(key.length - 4);
}

// ─── Project Context (Memory) ────────────────────────────────────────────────

/**
 * Loads project context from hierarchical context files.
 * 1. Global context: ~/.orion/global-context.md
 * 2. Project context: .orion/context.md (in current working directory)
 *
 * Returns the combined context string, ready to inject into system prompts.
 */
export function loadProjectContext(): string {
  let context = '';

  // 1. Global context
  const globalCtx = path.join(os.homedir(), '.orion', 'global-context.md');
  if (fs.existsSync(globalCtx)) {
    context += fs.readFileSync(globalCtx, 'utf-8') + '\n\n';
  }

  // 2. Project context
  const projectCtx = path.join(process.cwd(), '.orion', 'context.md');
  if (fs.existsSync(projectCtx)) {
    context += fs.readFileSync(projectCtx, 'utf-8') + '\n\n';
  }

  return context;
}

// ─── Chat History Management ─────────────────────────────────────────────────

const HISTORY_DIR = path.join(CONFIG_DIR, 'history');

export function ensureHistoryDir(): void {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

export function getHistoryDir(): string {
  return HISTORY_DIR;
}

export interface ChatSession {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  messageCount: number;
  messages: Array<{ role: string; content: string }>;
  preview: string;
}

export function saveChatSession(session: ChatSession): string {
  ensureHistoryDir();
  const filename = `${session.id}.json`;
  const filepath = path.join(HISTORY_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(session, null, 2), 'utf-8');
  return filepath;
}

export function loadChatSession(id: string): ChatSession | null {
  ensureHistoryDir();
  const filepath = path.join(HISTORY_DIR, `${id}.json`);
  if (!fs.existsSync(filepath)) return null;
  try {
    const raw = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(raw) as ChatSession;
  } catch {
    return null;
  }
}

export function listChatSessions(): ChatSession[] {
  ensureHistoryDir();
  try {
    const files = fs.readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();

    const sessions: ChatSession[] = [];
    for (const file of files.slice(0, 20)) {
      try {
        const raw = fs.readFileSync(path.join(HISTORY_DIR, file), 'utf-8');
        const session = JSON.parse(raw) as ChatSession;
        sessions.push(session);
      } catch { /* skip corrupt files */ }
    }
    return sessions;
  } catch {
    return [];
  }
}

// ─── Model Validation ────────────────────────────────────────────────────────

const KNOWN_MODELS: Record<string, string[]> = {
  anthropic: [
    'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
    'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-20241022',
    'claude-3-haiku-20240307',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
    'o3',
    'o3-mini',
    'o1',
    'o1-mini',
  ],
  ollama: [
    'llama3.2',
    'llama3.1',
    'llama3',
    'codellama',
    'mistral',
    'mixtral',
    'phi3',
    'gemma2',
    'qwen2',
    'deepseek-coder',
  ],
};

export function validateModelName(model: string, provider?: string): { valid: boolean; suggestion?: string } {
  if (!model || !model.trim()) {
    return { valid: false, suggestion: 'Model name cannot be empty.' };
  }

  // If provider is specified, check against known models
  if (provider && KNOWN_MODELS[provider]) {
    const known = KNOWN_MODELS[provider];
    if (known.includes(model)) {
      return { valid: true };
    }
    // Find closest match
    const lower = model.toLowerCase();
    const match = known.find(m => m.toLowerCase().includes(lower) || lower.includes(m.toLowerCase()));
    if (match) {
      return { valid: true, suggestion: `Did you mean "${match}"?` };
    }
    // Allow unknown models (custom/fine-tuned) but warn
    return { valid: true, suggestion: `"${model}" is not a recognized ${provider} model. Proceeding anyway.` };
  }

  return { valid: true };
}
