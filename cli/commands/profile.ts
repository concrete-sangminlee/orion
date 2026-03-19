/**
 * Orion CLI - Profile Management Command
 * Create, list, switch, delete, export, and import configuration profiles.
 * Profiles are stored in ~/.orion/profiles/<name>.json
 *
 * Usage:
 *   orion profile list                     # List all profiles
 *   orion profile create work              # Create a profile named "work"
 *   orion profile use work                 # Switch to "work" profile
 *   orion profile delete work              # Delete a profile
 *   orion profile export work              # Export profile as JSON
 *   orion profile import profile.json      # Import profile from JSON
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import inquirer from 'inquirer';
import {
  colors,
  printInfo,
  printSuccess,
  printError,
  printWarning,
  readConfig,
  writeConfig,
  ensureConfigDir,
  maskApiKey,
  type OrionConfig,
} from '../utils.js';
import {
  commandHeader,
  statusLine,
  divider,
  palette,
  table as uiTable,
  badge,
  keyValue,
  timeAgo,
} from '../ui.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const PROFILES_DIR = path.join(os.homedir(), '.orion', 'profiles');
const ACTIVE_PROFILE_FILE = path.join(os.homedir(), '.orion', 'active-profile');
const DEFAULT_PROFILE_NAME = 'default';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ProfileData {
  name: string;
  createdAt: string;
  updatedAt: string;
  config: OrionConfig;
}

// ─── Profile Storage ────────────────────────────────────────────────────────

function ensureProfilesDir(): void {
  ensureConfigDir();
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getProfilePath(name: string): string {
  return path.join(PROFILES_DIR, `${sanitizeName(name)}.json`);
}

function loadProfile(name: string): ProfileData | null {
  const filePath = getProfilePath(name);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ProfileData;
  } catch {
    return null;
  }
}

function saveProfile(profile: ProfileData): void {
  ensureProfilesDir();
  profile.updatedAt = new Date().toISOString();
  const filePath = getProfilePath(profile.name);
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf-8');
}

function deleteProfileFile(name: string): boolean {
  const filePath = getProfilePath(name);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

function loadAllProfiles(): ProfileData[] {
  ensureProfilesDir();
  const profiles: ProfileData[] = [];

  try {
    const files = fs.readdirSync(PROFILES_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(PROFILES_DIR, file), 'utf-8');
        profiles.push(JSON.parse(raw) as ProfileData);
      } catch { /* skip corrupt files */ }
    }
  } catch { /* directory not readable */ }

  return profiles;
}

function getActiveProfileName(): string {
  try {
    if (fs.existsSync(ACTIVE_PROFILE_FILE)) {
      const name = fs.readFileSync(ACTIVE_PROFILE_FILE, 'utf-8').trim();
      if (name) return name;
    }
  } catch { /* ignore */ }
  return DEFAULT_PROFILE_NAME;
}

function setActiveProfileName(name: string): void {
  ensureConfigDir();
  fs.writeFileSync(ACTIVE_PROFILE_FILE, sanitizeName(name), 'utf-8');
}

// ─── Profile Display Helpers ────────────────────────────────────────────────

function formatProviderInfo(config: OrionConfig): string {
  const provider = config.provider || 'ollama';
  const model = config.model || 'default';
  return `${provider} / ${model}`;
}

function formatApiKeyStatus(config: OrionConfig): string {
  const keys: string[] = [];
  if (config.anthropicApiKey) keys.push('Anthropic');
  if (config.openaiApiKey) keys.push('OpenAI');
  if (keys.length === 0) return palette.dim('none');
  return palette.green(keys.join(', '));
}

// ─── Subcommands ────────────────────────────────────────────────────────────

async function listAction(): Promise<void> {
  console.log(commandHeader('Orion Profiles', [
    ['Store', PROFILES_DIR],
  ]));

  const profiles = loadAllProfiles();
  const activeProfile = getActiveProfileName();

  if (profiles.length === 0) {
    console.log();
    console.log(statusLine('i', palette.dim('No profiles found.')));
    console.log(`  ${palette.dim('Create one with: orion profile create "work"')}`);
    console.log();

    // Show current config as the implicit default
    const currentConfig = readConfig();
    console.log(divider('Active Configuration (no profile)'));
    console.log();
    console.log(keyValue([
      ['Provider', currentConfig.provider || 'ollama'],
      ['Model', currentConfig.model || 'default'],
      ['Max Tokens', String(currentConfig.maxTokens || 4096)],
      ['Temperature', String(currentConfig.temperature || 0.7)],
    ]));
    console.log();
    return;
  }

  const headers = ['Name', 'Provider', 'Model', 'API Keys', 'Updated', 'Status'];
  const rows: string[][] = [];

  for (const p of profiles) {
    const isActive = sanitizeName(p.name) === sanitizeName(activeProfile);
    rows.push([
      isActive ? palette.violet.bold(p.name) : p.name,
      p.config.provider || 'ollama',
      p.config.model || 'default',
      formatApiKeyStatus(p.config),
      timeAgo(new Date(p.updatedAt)),
      isActive ? palette.green('active') : palette.dim('--'),
    ]);
  }

  console.log();
  console.log(uiTable(headers, rows));
  console.log();
  console.log(`  ${palette.dim(`${profiles.length} profile(s) total`)}`);
  console.log(`  ${palette.dim(`Active: ${activeProfile}`)}`);
  console.log();
}

async function createAction(name: string): Promise<void> {
  const sanitized = sanitizeName(name);
  if (!sanitized) {
    printError('Invalid profile name. Use alphanumeric characters, hyphens, and underscores.');
    process.exit(1);
  }

  const existing = loadProfile(sanitized);
  if (existing) {
    printWarning(`Profile "${sanitized}" already exists. Use ${colors.command(`orion profile use ${sanitized}`)} to switch.`);
    process.exit(1);
  }

  console.log(commandHeader('Orion Profile: Create', [
    ['Name', sanitized],
  ]));

  // Interactive prompts to configure the profile
  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Select AI provider for this profile:',
      choices: [
        { name: 'Ollama (local, free, private)', value: 'ollama' },
        { name: 'Anthropic (Claude)', value: 'anthropic' },
        { name: 'OpenAI (GPT)', value: 'openai' },
      ],
    },
  ]);

  const { model } = await inquirer.prompt([
    {
      type: 'input',
      name: 'model',
      message: 'Default model:',
      default: provider === 'anthropic' ? 'claude-sonnet-4-20250514'
        : provider === 'openai' ? 'gpt-4o'
        : 'llama3.2',
    },
  ]);

  const config: OrionConfig = {
    provider,
    model: model.trim(),
    maxTokens: 4096,
    temperature: 0.7,
  };

  // Ask for API key if cloud provider
  if (provider === 'anthropic') {
    const { key } = await inquirer.prompt([
      {
        type: 'password',
        name: 'key',
        message: 'Anthropic API key (Enter to skip):',
        mask: '*',
      },
    ]);
    if (key.trim()) config.anthropicApiKey = key.trim();
  } else if (provider === 'openai') {
    const { key } = await inquirer.prompt([
      {
        type: 'password',
        name: 'key',
        message: 'OpenAI API key (Enter to skip):',
        mask: '*',
      },
    ]);
    if (key.trim()) config.openaiApiKey = key.trim();
  } else {
    const { host } = await inquirer.prompt([
      {
        type: 'input',
        name: 'host',
        message: 'Ollama host URL:',
        default: 'http://localhost:11434',
      },
    ]);
    config.ollamaHost = host.trim();
  }

  // Temperature and max tokens
  const { maxTokens } = await inquirer.prompt([
    {
      type: 'number',
      name: 'maxTokens',
      message: 'Max tokens (256-32768):',
      default: 4096,
      validate: (val: number) => (val >= 256 && val <= 32768) || 'Must be between 256 and 32768.',
    },
  ]);
  config.maxTokens = maxTokens;

  const { temperature } = await inquirer.prompt([
    {
      type: 'number',
      name: 'temperature',
      message: 'Temperature (0.0-2.0):',
      default: 0.7,
      validate: (val: number) => (val >= 0 && val <= 2) || 'Must be between 0.0 and 2.0.',
    },
  ]);
  config.temperature = temperature;

  const now = new Date().toISOString();
  const profile: ProfileData = {
    name: sanitized,
    createdAt: now,
    updatedAt: now,
    config,
  };

  saveProfile(profile);

  console.log();
  console.log(statusLine('\u2713', palette.green(`Profile "${sanitized}" created`)));
  console.log(`    ${palette.dim('Provider:')} ${config.provider}`);
  console.log(`    ${palette.dim('Model:')} ${config.model}`);
  console.log(`    ${palette.dim('Max Tokens:')} ${config.maxTokens}`);
  console.log(`    ${palette.dim('Temperature:')} ${config.temperature}`);
  console.log(`    ${palette.dim('Stored in:')} ${getProfilePath(sanitized)}`);
  console.log();
  printInfo(`Switch to this profile: ${colors.command(`orion profile use ${sanitized}`)}`);
  console.log();
}

async function useAction(name: string): Promise<void> {
  const sanitized = sanitizeName(name);
  const profile = loadProfile(sanitized);

  if (!profile) {
    printError(`Profile "${name}" not found.`);
    const profiles = loadAllProfiles();
    if (profiles.length > 0) {
      printInfo(`Available profiles: ${profiles.map(p => colors.primary(p.name)).join(', ')}`);
    } else {
      printInfo(`Create one with: ${colors.command(`orion profile create "${name}"`)}`);
    }
    process.exit(1);
  }

  console.log(commandHeader('Orion Profile: Switch', [
    ['Profile', sanitized],
  ]));

  // Copy profile config to the active Orion config
  const currentConfig = readConfig();
  const mergedConfig: OrionConfig = {
    ...currentConfig,
    provider: profile.config.provider,
    model: profile.config.model,
    maxTokens: profile.config.maxTokens,
    temperature: profile.config.temperature,
  };

  // Only override API keys if they are set in the profile
  if (profile.config.anthropicApiKey) {
    mergedConfig.anthropicApiKey = profile.config.anthropicApiKey;
  }
  if (profile.config.openaiApiKey) {
    mergedConfig.openaiApiKey = profile.config.openaiApiKey;
  }
  if (profile.config.ollamaHost) {
    mergedConfig.ollamaHost = profile.config.ollamaHost;
  }

  writeConfig(mergedConfig);
  setActiveProfileName(sanitized);

  console.log(statusLine('\u2713', palette.green(`Switched to profile "${sanitized}"`)));
  console.log();
  console.log(keyValue([
    ['Provider', mergedConfig.provider || 'ollama'],
    ['Model', mergedConfig.model || 'default'],
    ['Max Tokens', String(mergedConfig.maxTokens || 4096)],
    ['Temperature', String(mergedConfig.temperature || 0.7)],
  ]));
  console.log();
  printSuccess('Active config updated.');
  console.log();
}

async function deleteAction(name: string): Promise<void> {
  const sanitized = sanitizeName(name);

  if (sanitized === DEFAULT_PROFILE_NAME) {
    printError('Cannot delete the default profile.');
    process.exit(1);
  }

  if (!loadProfile(sanitized)) {
    printError(`Profile "${name}" not found.`);
    process.exit(1);
  }

  console.log(commandHeader('Orion Profile: Delete'));

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Delete profile "${sanitized}" permanently?`,
      default: false,
    },
  ]);

  if (confirm) {
    deleteProfileFile(sanitized);

    // If the deleted profile was active, revert to default
    const activeProfile = getActiveProfileName();
    if (sanitizeName(activeProfile) === sanitized) {
      setActiveProfileName(DEFAULT_PROFILE_NAME);
      printInfo(`Active profile reverted to "${DEFAULT_PROFILE_NAME}".`);
    }

    printSuccess(`Profile "${sanitized}" deleted.`);
  } else {
    printInfo('Cancelled.');
  }
  console.log();
}

async function exportAction(name: string): Promise<void> {
  const sanitized = sanitizeName(name);
  const profile = loadProfile(sanitized);

  if (!profile) {
    printError(`Profile "${name}" not found.`);
    const profiles = loadAllProfiles();
    if (profiles.length > 0) {
      printInfo(`Available profiles: ${profiles.map(p => colors.primary(p.name)).join(', ')}`);
    }
    process.exit(1);
  }

  console.log(commandHeader('Orion Profile: Export', [
    ['Profile', sanitized],
  ]));

  // Create an export-safe copy with masked API keys
  const exportData = {
    name: profile.name,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    config: {
      provider: profile.config.provider,
      model: profile.config.model,
      maxTokens: profile.config.maxTokens,
      temperature: profile.config.temperature,
      ollamaHost: profile.config.ollamaHost,
      // API keys are included in the export (user's choice to share)
      anthropicApiKey: profile.config.anthropicApiKey,
      openaiApiKey: profile.config.openaiApiKey,
    },
  };

  const exportPath = path.join(process.cwd(), `${sanitized}-profile.json`);
  fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2), 'utf-8');

  console.log(statusLine('\u2713', palette.green(`Profile "${sanitized}" exported`)));
  console.log(`    ${palette.dim('File:')} ${colors.file(exportPath)}`);
  console.log(`    ${palette.dim('Provider:')} ${profile.config.provider}`);
  console.log(`    ${palette.dim('Model:')} ${profile.config.model}`);
  console.log();

  if (profile.config.anthropicApiKey || profile.config.openaiApiKey) {
    printWarning('This export contains API keys. Be careful when sharing.');
  }
  console.log();
}

async function importAction(filePath: string): Promise<void> {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    printError(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(commandHeader('Orion Profile: Import', [
    ['File', path.basename(resolvedPath)],
  ]));

  let importData: ProfileData;
  try {
    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    importData = JSON.parse(raw) as ProfileData;
  } catch (err: any) {
    printError(`Failed to parse profile JSON: ${err.message}`);
    process.exit(1);
    return; // unreachable but helps TypeScript
  }

  // Validate required fields
  if (!importData.name || !importData.config) {
    printError('Invalid profile format. Must contain "name" and "config" fields.');
    process.exit(1);
  }

  const sanitized = sanitizeName(importData.name);

  // Validate config fields
  if (importData.config.provider && !['anthropic', 'openai', 'ollama'].includes(importData.config.provider)) {
    printWarning(`Unknown provider "${importData.config.provider}". Importing anyway.`);
  }

  // Check for existing profile
  const existing = loadProfile(sanitized);
  if (existing) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Profile "${sanitized}" already exists. Overwrite?`,
        default: false,
      },
    ]);
    if (!overwrite) {
      printInfo('Import cancelled.');
      console.log();
      return;
    }
  }

  const now = new Date().toISOString();
  const profile: ProfileData = {
    name: sanitized,
    createdAt: importData.createdAt || now,
    updatedAt: now,
    config: {
      provider: importData.config.provider || 'ollama',
      model: importData.config.model || 'llama3.2',
      maxTokens: importData.config.maxTokens || 4096,
      temperature: importData.config.temperature ?? 0.7,
      anthropicApiKey: importData.config.anthropicApiKey,
      openaiApiKey: importData.config.openaiApiKey,
      ollamaHost: importData.config.ollamaHost,
    },
  };

  saveProfile(profile);

  console.log(statusLine('\u2713', palette.green(`Profile "${sanitized}" imported successfully`)));
  console.log(`    ${palette.dim('Provider:')} ${profile.config.provider}`);
  console.log(`    ${palette.dim('Model:')} ${profile.config.model}`);
  console.log(`    ${palette.dim('Max Tokens:')} ${profile.config.maxTokens}`);
  console.log(`    ${palette.dim('Temperature:')} ${profile.config.temperature}`);
  if (profile.config.anthropicApiKey) {
    console.log(`    ${palette.dim('Anthropic Key:')} ${palette.green(maskApiKey(profile.config.anthropicApiKey))}`);
  }
  if (profile.config.openaiApiKey) {
    console.log(`    ${palette.dim('OpenAI Key:')} ${palette.green(maskApiKey(profile.config.openaiApiKey))}`);
  }
  console.log(`    ${palette.dim('Stored in:')} ${getProfilePath(sanitized)}`);
  console.log();
  printInfo(`Activate with: ${colors.command(`orion profile use ${sanitized}`)}`);
  console.log();
}

// ─── Command Entry Point ────────────────────────────────────────────────────

export async function profileCommand(action: string, nameOrPath?: string): Promise<void> {
  switch (action) {
    case 'list':
    case 'ls':
      await listAction();
      break;

    case 'create':
    case 'new':
    case 'add':
      if (!nameOrPath) {
        console.log();
        printError('Profile name is required.');
        console.log(`  ${palette.dim('Usage: orion profile create "work"')}`);
        console.log();
        process.exit(1);
      }
      await createAction(nameOrPath);
      break;

    case 'use':
    case 'switch':
    case 'activate':
      if (!nameOrPath) {
        console.log();
        printError('Profile name is required.');
        console.log(`  ${palette.dim('Usage: orion profile use "work"')}`);
        console.log();
        process.exit(1);
      }
      await useAction(nameOrPath);
      break;

    case 'delete':
    case 'rm':
    case 'remove':
      if (!nameOrPath) {
        console.log();
        printError('Profile name is required.');
        console.log(`  ${palette.dim('Usage: orion profile delete "work"')}`);
        console.log();
        process.exit(1);
      }
      await deleteAction(nameOrPath);
      break;

    case 'export':
      if (!nameOrPath) {
        console.log();
        printError('Profile name is required.');
        console.log(`  ${palette.dim('Usage: orion profile export "work"')}`);
        console.log();
        process.exit(1);
      }
      await exportAction(nameOrPath);
      break;

    case 'import':
      if (!nameOrPath) {
        console.log();
        printError('Profile JSON file is required.');
        console.log(`  ${palette.dim('Usage: orion profile import profile.json')}`);
        console.log();
        process.exit(1);
      }
      await importAction(nameOrPath);
      break;

    default:
      console.log();
      printError(`Unknown profile action: "${action}"`);
      console.log();
      console.log(`  ${palette.violet.bold('Available actions:')}`);
      console.log(`    ${palette.dim('list')}       List all profiles`);
      console.log(`    ${palette.dim('create')}     Create a new profile`);
      console.log(`    ${palette.dim('use')}        Switch to a profile`);
      console.log(`    ${palette.dim('delete')}     Delete a profile`);
      console.log(`    ${palette.dim('export')}     Export profile as JSON`);
      console.log(`    ${palette.dim('import')}     Import profile from JSON file`);
      console.log();
      console.log(`  ${palette.dim('Example: orion profile create work')}`);
      console.log(`  ${palette.dim('         orion profile use work')}`);
      console.log();
      process.exit(1);
  }
}
