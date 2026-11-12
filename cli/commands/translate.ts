/**
 * Orion CLI - Code/Comment Translation Command
 * AI-powered translation of comments and human-readable text in code files.
 * Preserves code structure, only translates human-readable content.
 *
 * Usage:
 *   orion translate src/app.ts --to korean       # Translate comments to Korean
 *   orion translate src/app.ts --to english      # Translate comments to English
 *   orion translate src/app.ts --to japanese     # Translate comments to Japanese
 *   orion translate "How to implement auth?" --to korean   # Translate text
 */

import * as path from 'path';
import { askAI } from '../ai-client.js';
import {
  colors,
  printInfo,
  printSuccess,
  printError,
  startSpinner,
  readFileContent,
  fileExists,
  formatDiff,
  writeFileContent,
} from '../utils.js';
import { createSilentStreamHandler, printCommandError } from '../shared.js';
import { commandHeader, divider, box, palette } from '../ui.js';

// ─── Supported Languages ─────────────────────────────────────────────────────

const SUPPORTED_LANGUAGES: Record<string, string> = {
  english: 'English',
  korean: 'Korean (한국어)',
  japanese: 'Japanese (日本語)',
  chinese: 'Chinese (中文)',
  spanish: 'Spanish (Español)',
  french: 'French (Français)',
  german: 'German (Deutsch)',
};

// ─── System Prompts ──────────────────────────────────────────────────────────

function getFileTranslatePrompt(targetLang: string, langLabel: string, codeLang: string): string {
  return `You are Orion, an expert code translator. Translate all comments, docstrings, and human-readable string literals in the provided ${codeLang} file to ${langLabel}.

CRITICAL RULES:
1. ONLY translate comments (single-line, multi-line, docstrings) and user-facing string literals
2. NEVER change variable names, function names, class names, import paths, or any code logic
3. NEVER change code structure, indentation, or formatting
4. Keep technical terms (API names, library names, type names) in their original form
5. Preserve all comment markers exactly (// , /* */, #, /** */, ''', """, <!-- --> etc.)
6. Translate JSDoc/TSDoc @param, @returns, @example descriptions but keep the tags themselves
7. Do NOT translate strings that are clearly code identifiers, URLs, file paths, or format strings
8. Return the COMPLETE file content with only the human-readable text translated

Output ONLY the translated file content. No explanations, no markdown code fences, no preamble.`;
}

const TEXT_TRANSLATE_PROMPT = `You are Orion, a precise translator. Translate the provided text accurately while preserving any technical terminology, code references, or formatting.

Output ONLY the translated text. No explanations, no preamble.`;

// ─── Options ─────────────────────────────────────────────────────────────────

export interface TranslateOptions {
  to: string;
  apply?: boolean;
}

// ─── File Translation ────────────────────────────────────────────────────────

async function translateFile(filePath: string, options: TranslateOptions): Promise<void> {
  const resolvedPath = path.resolve(filePath);

  if (!fileExists(filePath)) {
    console.log();
    printError(`File not found: ${resolvedPath}`);
    printInfo('Check the path and try again.');
    console.log();
    process.exit(1);
  }

  const targetLang = options.to.toLowerCase();
  const langLabel = SUPPORTED_LANGUAGES[targetLang];

  if (!langLabel) {
    console.log();
    printError(`Unsupported language: "${options.to}"`);
    printInfo(`Supported languages: ${Object.keys(SUPPORTED_LANGUAGES).join(', ')}`);
    console.log();
    process.exit(1);
  }

  // Read the source file
  const { content: originalContent, language: codeLang } = readFileContent(filePath);
  const lineCount = originalContent.split('\n').length;
  const fileName = path.basename(filePath);

  console.log(commandHeader('Orion Code Translator', [
    ['File', colors.file(resolvedPath)],
    ['Language', `${codeLang} \u00B7 ${lineCount} lines`],
    ['Target', langLabel],
  ]));
  console.log();

  // Send to AI for translation
  const spinner = startSpinner(`Translating comments to ${langLabel}...`);

  const systemPrompt = getFileTranslatePrompt(targetLang, langLabel, codeLang);
  const userMessage = `Translate all comments and human-readable strings in this ${codeLang} file to ${langLabel}:\n\n${originalContent}`;

  const { callbacks, getResponse } = createSilentStreamHandler(spinner, `Translation to ${langLabel} complete`);

  try {
    // With --apply the reply replaces the whole file, so a truncated one must not be used.
    await askAI(systemPrompt, userMessage, callbacks, { requireComplete: true });
  } catch (err: any) {
    printCommandError(err, 'translate', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }

  const translatedContent = getResponse();

  if (!translatedContent || translatedContent.trim().length === 0) {
    console.log();
    printError('AI returned an empty translation. Please try again.');
    console.log();
    process.exit(1);
  }

  // Clean up any accidental markdown fences the AI may have added
  let cleanContent = translatedContent.trim();
  const fencePattern = /^```[\w]*\n?([\s\S]*?)\n?```$/;
  const fenceMatch = cleanContent.match(fencePattern);
  if (fenceMatch) {
    cleanContent = fenceMatch[1];
  }

  // Show diff preview
  console.log();
  console.log(`  ${colors.label('Preview (diff):')}`);
  console.log(divider('Changes'));
  console.log(formatDiff(originalContent, cleanContent, fileName));
  console.log(divider('End'));
  console.log();

  // Count changes
  const origLines = originalContent.split('\n');
  const transLines = cleanContent.split('\n');
  let changedLines = 0;
  const maxLen = Math.max(origLines.length, transLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (origLines[i] !== transLines[i]) {
      changedLines++;
    }
  }

  console.log(`  ${colors.label('Lines changed:')} ${changedLines} of ${lineCount}`);
  console.log(`  ${colors.label('Target language:')} ${langLabel}`);
  console.log();

  if (changedLines === 0) {
    printInfo('No changes detected. The file may already be in the target language.');
    console.log();
    return;
  }

  // Apply changes
  if (options.apply) {
    writeFileContent(filePath, cleanContent);
    printSuccess(`Applied translation to ${colors.file(resolvedPath)}`);
    console.log();
  } else {
    // Show instructions for applying
    console.log(box(
      [
        `${palette.bold('To apply this translation:')}`,
        '',
        `  ${palette.dim(`orion translate ${filePath} --to ${targetLang} --apply`)}`,
        '',
        `${palette.dim('Or use --apply flag to write changes directly.')}`,
      ].join('\n'),
      { title: 'Next Steps', color: '#7C5CFC' }
    ));
    console.log();
  }
}

// ─── Text Translation ────────────────────────────────────────────────────────

async function translateText(text: string, options: TranslateOptions): Promise<void> {
  const targetLang = options.to.toLowerCase();
  const langLabel = SUPPORTED_LANGUAGES[targetLang];

  if (!langLabel) {
    console.log();
    printError(`Unsupported language: "${options.to}"`);
    printInfo(`Supported languages: ${Object.keys(SUPPORTED_LANGUAGES).join(', ')}`);
    console.log();
    process.exit(1);
  }

  console.log(commandHeader('Orion Text Translator', [
    ['Input', text.length > 50 ? text.substring(0, 50) + '...' : text],
    ['Target', langLabel],
  ]));
  console.log();

  const spinner = startSpinner(`Translating to ${langLabel}...`);

  const userMessage = `Translate the following text to ${langLabel}:\n\n${text}`;

  const { callbacks, getResponse } = createSilentStreamHandler(spinner, `Translation complete`);

  try {
    await askAI(TEXT_TRANSLATE_PROMPT, userMessage, callbacks);
  } catch (err: any) {
    printCommandError(err, 'translate', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }

  const result = getResponse();

  if (!result || result.trim().length === 0) {
    console.log();
    printError('AI returned an empty translation. Please try again.');
    console.log();
    process.exit(1);
  }

  console.log();
  console.log(`  ${colors.label('Original:')}`);
  console.log(`  ${palette.dim(text)}`);
  console.log();
  console.log(`  ${colors.label(`${langLabel}:`)}`);
  console.log(`  ${colors.ai(result.trim())}`);
  console.log();
}

// ─── Command Entry Point ────────────────────────────────────────────────────

export async function translateCommand(
  input: string,
  options: TranslateOptions
): Promise<void> {
  if (!input || !input.trim()) {
    console.log();
    printError('Please provide a file path or text to translate.');
    console.log(`  ${palette.dim('Usage: orion translate <file> --to <language>')}`);
    console.log(`  ${palette.dim('       orion translate "text" --to <language>')}`);
    console.log();
    console.log(`  ${palette.dim('Supported languages:')}`);
    for (const [key, label] of Object.entries(SUPPORTED_LANGUAGES)) {
      console.log(`    ${colors.command(key.padEnd(10))} ${palette.dim(label)}`);
    }
    console.log();
    process.exit(1);
  }

  if (!options.to) {
    console.log();
    printError('Please specify a target language with --to <language>.');
    console.log(`  ${palette.dim('Supported languages: ' + Object.keys(SUPPORTED_LANGUAGES).join(', '))}`);
    console.log();
    process.exit(1);
  }

  // Determine if input is a file path or text
  const resolvedPath = path.resolve(input);
  const isFile = fileExists(input) || (
    !input.includes(' ') && (
      input.includes('/') ||
      input.includes('\\') ||
      input.includes('.') && path.extname(input).length > 0
    )
  );

  if (isFile && fileExists(input)) {
    await translateFile(input, options);
  } else if (isFile && !fileExists(input)) {
    // Looks like a file path but doesn't exist
    console.log();
    printError(`File not found: ${resolvedPath}`);
    printInfo('If you meant to translate text, wrap it in quotes.');
    console.log(`  ${palette.dim(`orion translate "${input}" --to ${options.to}`)}`);
    console.log();
    process.exit(1);
  } else {
    await translateText(input, options);
  }
}
