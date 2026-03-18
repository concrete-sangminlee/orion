/**
 * Orion CLI - Session Management Command
 * Create, list, resume, export, and delete named AI sessions.
 * Sessions persist conversation history, provider info, and file context.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { streamChat, type AIMessage, type AIProvider, getProviderInfo } from '../ai-client.js';
import {
  colors,
  printHeader,
  printDivider,
  printInfo,
  printSuccess,
  printError,
  printWarning,
  startSpinner,
  stopSpinner,
  getCurrentDirectoryContext,
  loadProjectContext,
} from '../utils.js';
import { renderMarkdown } from '../markdown.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionData {
  name: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  cwd: string;
  messages: AIMessage[];
  filesTouched: string[];
  tags: string[];
}

// ─── Session Storage ─────────────────────────────────────────────────────────

function getSessionsDir(): string {
  const dir = path.join(os.homedir(), '.orion', 'sessions');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function getSessionPath(name: string): string {
  return path.join(getSessionsDir(), `${sanitizeName(name)}.json`);
}

function loadSession(name: string): SessionData | null {
  const filePath = getSessionPath(name);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

function saveSession(session: SessionData): void {
  session.updatedAt = new Date().toISOString();
  const filePath = getSessionPath(session.name);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
}

function deleteSessionFile(name: string): boolean {
  const filePath = getSessionPath(name);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

function listAllSessions(): SessionData[] {
  const dir = getSessionsDir();
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();

    const sessions: SessionData[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
        sessions.push(JSON.parse(raw) as SessionData);
      } catch { /* skip corrupt files */ }
    }
    return sessions;
  } catch {
    return [];
  }
}

// ─── Session Actions ─────────────────────────────────────────────────────────

async function newSession(name: string): Promise<void> {
  printHeader('Orion Session: New');

  const sanitized = sanitizeName(name);
  if (!sanitized) {
    printError('Invalid session name. Use alphanumeric characters, hyphens, and underscores.');
    process.exit(1);
  }

  const existing = loadSession(sanitized);
  if (existing) {
    printWarning(`Session "${sanitized}" already exists. Use ${colors.command(`orion session resume ${sanitized}`)} to continue.`);
    process.exit(1);
  }

  const providerInfo = await getProviderInfo();

  const session: SessionData = {
    name: sanitized,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: providerInfo.provider,
    model: providerInfo.model,
    cwd: process.cwd(),
    messages: [
      {
        role: 'system',
        content: `You are Orion, an expert AI coding assistant in a persistent session named "${sanitized}". ` +
          `Remember the conversation history and maintain context across messages. ` +
          `Be concise and actionable.\n\nWorkspace: ${getCurrentDirectoryContext()}\n\n${loadProjectContext()}`,
      },
    ],
    filesTouched: [],
    tags: [],
  };

  saveSession(session);

  printSuccess(`Session "${colors.label(sanitized)}" created`);
  printInfo(`Provider: ${providerInfo.provider} (${providerInfo.model})`);
  printInfo(`Directory: ${colors.file(process.cwd())}`);
  console.log();
  printInfo(`Start chatting with: ${colors.command(`orion session resume ${sanitized}`)}`);
  console.log();
}

async function listSessions(): Promise<void> {
  printHeader('Orion Sessions');

  const sessions = listAllSessions();

  if (sessions.length === 0) {
    console.log();
    printInfo('No sessions found.');
    printInfo(`Create one with: ${colors.command('orion session new "my-session"')}`);
    console.log();
    return;
  }

  console.log();
  console.log(`  ${colors.label('Name')}                 ${colors.label('Messages')}  ${colors.label('Provider')}     ${colors.label('Updated')}`);
  printDivider();

  for (const session of sessions) {
    const name = session.name.padEnd(20);
    const msgCount = String(session.messages.filter(m => m.role !== 'system').length).padEnd(10);
    const provider = `${session.provider}`.padEnd(13);
    const updated = new Date(session.updatedAt).toLocaleDateString();

    console.log(`  ${colors.primary(name)} ${chalk.dim(msgCount)} ${chalk.dim(provider)} ${chalk.dim(updated)}`);
  }

  console.log();
  printInfo(`${sessions.length} session(s) total`);
  printInfo(`Resume with: ${colors.command('orion session resume <name>')}`);
  console.log();
}

async function resumeSession(name: string): Promise<void> {
  const sanitized = sanitizeName(name);
  const session = loadSession(sanitized);

  if (!session) {
    printError(`Session "${name}" not found.`);
    printInfo(`Create it with: ${colors.command(`orion session new "${name}"`)}`);
    const sessions = listAllSessions();
    if (sessions.length > 0) {
      printInfo(`Available sessions: ${sessions.map(s => colors.primary(s.name)).join(', ')}`);
    }
    process.exit(1);
  }

  printHeader(`Session: ${session.name}`);
  const userMsgCount = session.messages.filter(m => m.role !== 'system').length;
  printInfo(`Resuming session with ${userMsgCount} previous message(s)`);
  printInfo(`Provider: ${session.provider} (${session.model})`);
  console.log();

  // Show last few messages for context
  const recentMessages = session.messages.filter(m => m.role !== 'system').slice(-4);
  if (recentMessages.length > 0) {
    console.log(chalk.dim('  --- Recent History ---'));
    for (const msg of recentMessages) {
      if (msg.role === 'user') {
        console.log(`  ${colors.user('You:')} ${chalk.dim(msg.content.substring(0, 80))}${msg.content.length > 80 ? '...' : ''}`);
      } else {
        console.log(`  ${colors.ai('Orion:')} ${chalk.dim(msg.content.substring(0, 80))}${msg.content.length > 80 ? '...' : ''}`);
      }
    }
    console.log(chalk.dim('  ─────────────────────'));
    console.log();
  }

  // Interactive loop
  printInfo(`Type your message. Use ${colors.command('/quit')} to exit, ${colors.command('/export')} to export.`);
  console.log();

  while (true) {
    const { input } = await inquirer.prompt([
      {
        type: 'input',
        name: 'input',
        message: colors.user('You:'),
        prefix: ' ',
      },
    ]);

    const trimmed = (input as string).trim();
    if (!trimmed) continue;

    // Handle special commands
    if (trimmed === '/quit' || trimmed === '/exit') {
      saveSession(session);
      console.log();
      printSuccess('Session saved.');
      break;
    }

    if (trimmed === '/export') {
      const exportPath = exportSessionToMarkdown(session);
      printSuccess(`Exported to: ${colors.file(exportPath)}`);
      continue;
    }

    if (trimmed === '/history') {
      for (const msg of session.messages.filter(m => m.role !== 'system')) {
        const role = msg.role === 'user' ? colors.user('You') : colors.ai('Orion');
        console.log(`  ${role}: ${chalk.dim(msg.content.substring(0, 100))}${msg.content.length > 100 ? '...' : ''}`);
      }
      continue;
    }

    // Add user message
    session.messages.push({ role: 'user', content: trimmed });

    // Track file references
    const fileRefs = trimmed.match(/[\w./\\-]+\.\w+/g);
    if (fileRefs) {
      for (const ref of fileRefs) {
        if (!session.filesTouched.includes(ref)) {
          session.filesTouched.push(ref);
        }
      }
    }

    const spinner = startSpinner('Thinking...');

    try {
      let fullResponse = '';
      let firstToken = true;

      await streamChat(session.messages, {
        onToken(token: string) {
          if (firstToken) {
            stopSpinner(spinner);
            firstToken = false;
            process.stdout.write(`\n  ${colors.label('Orion:')} `);
          }
          fullResponse += token;
          process.stdout.write(chalk.dim(token));
        },
        onComplete(text: string) {
          if (firstToken) stopSpinner(spinner);
          fullResponse = text;
          // Re-render as markdown
          process.stdout.write('\r\x1b[K');
          console.log();
          console.log(renderMarkdown(text));
        },
        onError(error: Error) {
          stopSpinner(spinner, error.message, false);
        },
      });

      // Add assistant message to history
      session.messages.push({ role: 'assistant', content: fullResponse });
      saveSession(session);
      console.log();

    } catch (err: any) {
      stopSpinner(spinner);
      printError(err.message || 'AI request failed.');
      console.log();
    }
  }
}

function exportSessionToMarkdown(session: SessionData): string {
  const dir = getSessionsDir();
  const exportFile = path.join(dir, `${session.name}-export.md`);

  const lines: string[] = [];
  lines.push(`# Session: ${session.name}`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Created | ${new Date(session.createdAt).toLocaleString()} |`);
  lines.push(`| Updated | ${new Date(session.updatedAt).toLocaleString()} |`);
  lines.push(`| Provider | ${session.provider} |`);
  lines.push(`| Model | ${session.model} |`);
  lines.push(`| Directory | ${session.cwd} |`);
  lines.push(`| Messages | ${session.messages.filter(m => m.role !== 'system').length} |`);

  if (session.filesTouched.length > 0) {
    lines.push(`| Files Touched | ${session.filesTouched.join(', ')} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Conversation');
  lines.push('');

  for (const msg of session.messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      lines.push(`### User`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');
    } else {
      lines.push(`### Orion`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  lines.push('');
  lines.push(`*Exported from Orion CLI on ${new Date().toLocaleString()}*`);

  fs.writeFileSync(exportFile, lines.join('\n'), 'utf-8');
  return exportFile;
}

async function exportSession(name: string): Promise<void> {
  const sanitized = sanitizeName(name);
  const session = loadSession(sanitized);

  if (!session) {
    printError(`Session "${name}" not found.`);
    process.exit(1);
  }

  printHeader('Orion Session: Export');

  const exportPath = exportSessionToMarkdown(session);

  printSuccess(`Session "${session.name}" exported successfully`);
  printInfo(`File: ${colors.file(exportPath)}`);
  printInfo(`Messages: ${session.messages.filter(m => m.role !== 'system').length}`);
  console.log();
}

async function deleteSession(name: string): Promise<void> {
  const sanitized = sanitizeName(name);

  printHeader('Orion Session: Delete');

  if (!loadSession(sanitized)) {
    printError(`Session "${name}" not found.`);
    process.exit(1);
  }

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Delete session "${sanitized}" permanently?`,
      default: false,
    },
  ]);

  if (confirm) {
    deleteSessionFile(sanitized);
    printSuccess(`Session "${sanitized}" deleted.`);
  } else {
    printInfo('Cancelled.');
  }
  console.log();
}

// ─── Main Command Router ─────────────────────────────────────────────────────

export async function sessionCommand(action: string, nameOrArg?: string): Promise<void> {
  switch (action) {
    case 'new':
    case 'create':
      if (!nameOrArg) {
        printError('Session name required.');
        printInfo(`Usage: ${colors.command('orion session new "my-session"')}`);
        process.exit(1);
      }
      await newSession(nameOrArg);
      break;

    case 'list':
    case 'ls':
      await listSessions();
      break;

    case 'resume':
    case 'continue':
    case 'open':
      if (!nameOrArg) {
        printError('Session name required.');
        printInfo(`Usage: ${colors.command('orion session resume <name>')}`);
        process.exit(1);
      }
      await resumeSession(nameOrArg);
      break;

    case 'export':
      if (!nameOrArg) {
        printError('Session name required.');
        printInfo(`Usage: ${colors.command('orion session export <name>')}`);
        process.exit(1);
      }
      await exportSession(nameOrArg);
      break;

    case 'delete':
    case 'rm':
    case 'remove':
      if (!nameOrArg) {
        printError('Session name required.');
        printInfo(`Usage: ${colors.command('orion session delete <name>')}`);
        process.exit(1);
      }
      await deleteSession(nameOrArg);
      break;

    default:
      console.log();
      printError(`Unknown session action: "${action}"`);
      console.log();
      console.log(`  ${colors.label('Available actions:')}`);
      console.log(`    ${colors.command('orion session new <name>')}       Create a named session`);
      console.log(`    ${colors.command('orion session list')}             List all sessions`);
      console.log(`    ${colors.command('orion session resume <name>')}    Resume a session`);
      console.log(`    ${colors.command('orion session export <name>')}    Export session as markdown`);
      console.log(`    ${colors.command('orion session delete <name>')}    Delete a session`);
      console.log();
      process.exit(1);
  }
}
