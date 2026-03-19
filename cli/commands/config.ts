/**
 * Orion CLI - Configuration Command
 * Manage API keys, default model, and preferences.
 * Loops back to menu after each action. Validates model names.
 */

import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import {
  colors,
  printHeader,
  printDivider,
  printInfo,
  printSuccess,
  printWarning,
  printKeyValue,
  readConfig,
  writeConfig,
  getConfigPath,
  maskApiKey,
  validateModelName,
} from '../utils.js';
import { initProjectContext } from './context.js';
import { commandHeader, keyValue, divider, palette } from '../ui.js';

function showCurrentConfig(): void {
  const config = readConfig();

  console.log();
  console.log(divider('Current Configuration'));
  console.log();
  console.log(keyValue([
    ['Config file', colors.file(getConfigPath())],
    ['Provider', config.provider || 'auto'],
    ['Model', config.model || 'default'],
    ['Anthropic Key', config.anthropicApiKey ? palette.green(maskApiKey(config.anthropicApiKey)) : palette.dim('not set')],
    ['OpenAI Key', config.openaiApiKey ? palette.green(maskApiKey(config.openaiApiKey)) : palette.dim('not set')],
    ['Ollama Host', config.ollamaHost || 'http://localhost:11434'],
    ['Max Tokens', String(config.maxTokens || 4096)],
    ['Temperature', String(config.temperature || 0.7)],
  ]));
  console.log();
}

export async function configCommand(): Promise<void> {
  console.log(commandHeader('Orion Configuration'));

  // Show current config clearly before any changes
  showCurrentConfig();

  // Loop until user exits
  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to configure?',
        choices: [
          { name: 'Set AI Provider', value: 'provider' },
          { name: 'Set Anthropic API Key', value: 'anthropic_key' },
          { name: 'Set OpenAI API Key', value: 'openai_key' },
          { name: 'Set Default Model', value: 'model' },
          { name: 'Set Ollama Host', value: 'ollama_host' },
          { name: 'Set Max Tokens', value: 'max_tokens' },
          { name: 'Set Temperature', value: 'temperature' },
          new inquirer.Separator(),
          { name: 'Show current config', value: 'show' },
          { name: 'Reset to defaults', value: 'reset' },
          new inquirer.Separator(),
          { name: 'Back to main menu / Exit', value: 'exit' },
        ],
      },
    ]);

    if (action === 'exit') {
      console.log();
      printInfo('Configuration saved. Goodbye!');
      console.log();
      return;
    }

    const config = readConfig();

    switch (action) {
      case 'provider': {
        const { provider } = await inquirer.prompt([
          {
            type: 'list',
            name: 'provider',
            message: 'Select AI provider:',
            choices: [
              { name: 'Ollama (local, free)', value: 'ollama' },
              { name: 'Anthropic (Claude)', value: 'anthropic' },
              { name: 'OpenAI (GPT)', value: 'openai' },
            ],
            default: config.provider,
          },
        ]);
        config.provider = provider;
        writeConfig(config);
        printSuccess(`Provider set to: ${provider}`);
        break;
      }

      case 'anthropic_key': {
        const { key } = await inquirer.prompt([
          {
            type: 'password',
            name: 'key',
            message: 'Enter your Anthropic API key:',
            mask: '*',
          },
        ]);
        if (key.trim()) {
          if (!key.trim().startsWith('sk-ant-')) {
            printWarning('Anthropic API keys typically start with "sk-ant-". Saving anyway.');
          }
          config.anthropicApiKey = key.trim();
          writeConfig(config);
          printSuccess(`Anthropic API key saved (${maskApiKey(key.trim())})`);
        } else {
          printInfo('No key entered. Unchanged.');
        }
        break;
      }

      case 'openai_key': {
        const { key } = await inquirer.prompt([
          {
            type: 'password',
            name: 'key',
            message: 'Enter your OpenAI API key:',
            mask: '*',
          },
        ]);
        if (key.trim()) {
          if (!key.trim().startsWith('sk-')) {
            printWarning('OpenAI API keys typically start with "sk-". Saving anyway.');
          }
          config.openaiApiKey = key.trim();
          writeConfig(config);
          printSuccess(`OpenAI API key saved (${maskApiKey(key.trim())})`);
        } else {
          printInfo('No key entered. Unchanged.');
        }
        break;
      }

      case 'model': {
        const { model } = await inquirer.prompt([
          {
            type: 'input',
            name: 'model',
            message: 'Enter model name (e.g., claude-sonnet-4-20250514, gpt-4o, llama3):',
            default: config.model,
            validate: (input: string) => {
              if (!input.trim()) return 'Model name cannot be empty.';
              return true;
            },
          },
        ]);
        const trimmed = model.trim();
        const validation = validateModelName(trimmed, config.provider);
        if (!validation.valid) {
          printWarning(validation.suggestion || 'Invalid model name.');
        } else {
          if (validation.suggestion) {
            printInfo(validation.suggestion);
          }
          config.model = trimmed;
          writeConfig(config);
          printSuccess(`Model set to: ${trimmed}`);
        }
        break;
      }

      case 'ollama_host': {
        const { host } = await inquirer.prompt([
          {
            type: 'input',
            name: 'host',
            message: 'Enter Ollama host URL:',
            default: config.ollamaHost || 'http://localhost:11434',
            validate: (input: string) => {
              if (!input.trim()) return 'URL cannot be empty.';
              if (!input.startsWith('http://') && !input.startsWith('https://')) {
                return 'URL must start with http:// or https://';
              }
              return true;
            },
          },
        ]);
        config.ollamaHost = host.trim();
        writeConfig(config);
        printSuccess(`Ollama host set to: ${host.trim()}`);
        break;
      }

      case 'max_tokens': {
        const { tokens } = await inquirer.prompt([
          {
            type: 'number',
            name: 'tokens',
            message: 'Enter max tokens (256-32768):',
            default: config.maxTokens || 4096,
            validate: (val: number) => (val >= 256 && val <= 32768) || 'Must be between 256 and 32768.',
          },
        ]);
        config.maxTokens = tokens;
        writeConfig(config);
        printSuccess(`Max tokens set to: ${tokens}`);
        break;
      }

      case 'temperature': {
        const { temp } = await inquirer.prompt([
          {
            type: 'number',
            name: 'temp',
            message: 'Enter temperature (0.0-2.0):',
            default: config.temperature || 0.7,
            validate: (val: number) => (val >= 0 && val <= 2) || 'Must be between 0.0 and 2.0.',
          },
        ]);
        config.temperature = temp;
        writeConfig(config);
        printSuccess(`Temperature set to: ${temp}`);
        break;
      }

      case 'show':
        showCurrentConfig();
        break;

      case 'reset': {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'Reset all settings to defaults? This will clear API keys.',
            default: false,
          },
        ]);
        if (confirm) {
          writeConfig({});
          printSuccess('Configuration reset to defaults.');
        } else {
          printInfo('Reset cancelled.');
        }
        break;
      }
    }

    // Show a blank line before looping back to the menu
    console.log();
  }
}

export async function initCommand(): Promise<void> {
  console.log(commandHeader('Orion Project Init'));

  printInfo('Initializing Orion in current project...');
  console.log();

  const config = readConfig();

  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Select your preferred AI provider:',
      choices: [
        { name: 'Ollama (local, free, private)', value: 'ollama' },
        { name: 'Anthropic (Claude - best for coding)', value: 'anthropic' },
        { name: 'OpenAI (GPT-4)', value: 'openai' },
      ],
    },
  ]);

  config.provider = provider;

  if (provider === 'anthropic') {
    const { key } = await inquirer.prompt([
      {
        type: 'password',
        name: 'key',
        message: 'Enter your Anthropic API key (or press Enter to skip):',
        mask: '*',
      },
    ]);
    if (key.trim()) config.anthropicApiKey = key.trim();
  } else if (provider === 'openai') {
    const { key } = await inquirer.prompt([
      {
        type: 'password',
        name: 'key',
        message: 'Enter your OpenAI API key (or press Enter to skip):',
        mask: '*',
      },
    ]);
    if (key.trim()) config.openaiApiKey = key.trim();
  }

  writeConfig(config);

  // Create .orion/ directory and context.md in current project
  console.log();
  initProjectContext();

  // Create .orion/rules/ directory with a sample rule file
  const orionDir = path.join(process.cwd(), '.orion');
  const rulesDir = path.join(orionDir, 'rules');
  if (!fs.existsSync(rulesDir)) {
    fs.mkdirSync(rulesDir, { recursive: true });
    printSuccess(`Created ${colors.file('.orion/rules/')} directory`);
  } else {
    printInfo(`${colors.file('.orion/rules/')} directory already exists`);
  }

  const sampleRulePath = path.join(rulesDir, 'general.md');
  if (!fs.existsSync(sampleRulePath)) {
    const sampleRule = `---
glob: "*"
description: "General project conventions"
---
Follow the existing code style and conventions in this project.
Use descriptive variable names and add comments for complex logic.
Prefer small, focused functions over large monolithic ones.
`;
    fs.writeFileSync(sampleRulePath, sampleRule, 'utf-8');
    printSuccess(`Created ${colors.file('.orion/rules/general.md')} sample rule`);
  } else {
    printWarning(`${colors.file('.orion/rules/general.md')} already exists, skipping`);
  }

  console.log();
  printSuccess('Orion initialized successfully!');
  printInfo(`Config saved to: ${colors.file(getConfigPath())}`);
  printInfo(`Project context: ${colors.file('.orion/context.md')}`);
  printInfo(`Custom commands: ${colors.file('.orion/commands/')}`);
  printInfo(`Rules directory: ${colors.file('.orion/rules/')}`);
  console.log();
  printInfo('Quick start:');
  console.log(`    ${colors.command('orion chat')}        Start an interactive AI chat`);
  console.log(`    ${colors.command('orion ask "..."')}   Ask a quick question`);
  console.log(`    ${colors.command('orion review')}      Review code in current directory`);
  console.log(`    ${colors.command('orion commit')}      Generate AI commit message`);
  console.log();
  printInfo('Edit .orion/context.md to add project-specific AI context.');
  printInfo('Add .md files to .orion/commands/ to create custom slash commands.');
  printInfo('Add .md files to .orion/rules/ to create path-scoped rules.');
  console.log();
}
