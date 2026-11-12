/**
 * Orion CLI - AI-Powered Code Migration
 * Converts code between languages, frameworks, and patterns using AI.
 * Supports: JS->TS, Python2->3, Class->Hooks, Callbacks->Async/Await, and more.
 */

import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { askAI } from '../ai-client.js';
import {
  colors,
  printInfo,
  printSuccess,
  printError,
  printWarning,
  startSpinner,
  writeFileContent,
  loadProjectContext,
} from '../utils.js';
import {
  createSilentStreamHandler,
  readAndValidateFile,
  printCommandError,
} from '../shared.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';
import { commandHeader, diffBlock, divider, palette } from '../ui.js';
import { createBackup } from '../backup.js';

// ─── Migration Types ─────────────────────────────────────────────────────────

const MIGRATION_TARGETS: Record<string, { label: string; description: string }> = {
  typescript: { label: 'TypeScript', description: 'Convert JavaScript to TypeScript with proper types' },
  python3: { label: 'Python 3', description: 'Migrate Python 2 code to Python 3' },
  hooks: { label: 'React Hooks', description: 'Convert class components to functional components with hooks' },
  async: { label: 'Async/Await', description: 'Convert callbacks and promises to async/await' },
  esm: { label: 'ES Modules', description: 'Convert CommonJS require/module.exports to ES import/export' },
  composition: { label: 'Composition API', description: 'Convert Vue Options API to Composition API' },
};

// ─── System Prompts ──────────────────────────────────────────────────────────

function getMigrationSystemPrompt(target: string): string {
  const base = `You are Orion, an expert code migration assistant. You will receive a source file and must convert it to the specified target format.

Rules:
1. Output the COMPLETE migrated file content
2. Preserve all functionality - the migrated code must be functionally equivalent
3. Preserve comments (translate if needed)
4. Use idiomatic patterns for the target format
5. Add appropriate type annotations, imports, or boilerplate as needed
6. Do NOT include explanations or markdown formatting
7. Do NOT wrap the output in code fences
8. Output ONLY the raw migrated code

If there are important migration notes (breaking changes, manual steps needed), output them BEFORE the code using this format:
[MIGRATION NOTE] <description>

Then output a separator line: ---MIGRATED---

Then output the complete migrated file content.`;

  const targetSpecific: Record<string, string> = {
    typescript: `
Migration target: JavaScript to TypeScript
- Add type annotations to function parameters and return types
- Convert .js imports to .ts (remove .js extensions if present)
- Add interface/type definitions for objects
- Use proper TypeScript features (enum, generics, etc.) where appropriate
- Add 'strict' compatible types (avoid 'any' where possible)
- Convert require() to import statements`,

    python3: `
Migration target: Python 2 to Python 3
- Convert print statements to print() function calls
- Update unicode/string handling (u"" prefixes, bytes vs str)
- Convert dict.has_key() to 'in' operator
- Update exception syntax (except Error, e -> except Error as e)
- Convert xrange to range
- Update division operators (// for integer division)
- Convert raw_input() to input()
- Update import paths (e.g., urllib, configparser)`,

    hooks: `
Migration target: React Class Components to Hooks
- Convert class extends Component to function component
- Convert this.state and this.setState to useState hooks
- Convert lifecycle methods:
  - componentDidMount -> useEffect(..., [])
  - componentDidUpdate -> useEffect with dependencies
  - componentWillUnmount -> useEffect cleanup function
- Convert this.props to destructured function parameters
- Convert class methods to const functions or useCallback
- Convert createRef/ref callbacks to useRef
- Preserve PropTypes or TypeScript types`,

    async: `
Migration target: Callbacks/Promises to Async/Await
- Convert callback-style functions to async functions
- Convert .then()/.catch() chains to try/catch with await
- Convert nested callbacks to sequential await statements
- Preserve error handling semantics
- Add async keyword to function declarations
- Convert Promise.all patterns appropriately
- Handle callback error-first patterns (err, result)`,

    esm: `
Migration target: CommonJS to ES Modules
- Convert require() to import statements
- Convert module.exports to export/export default
- Convert exports.name to export const name
- Handle dynamic require() with import()
- Add file extensions to relative imports if needed
- Convert __dirname and __filename to import.meta equivalents`,

    composition: `
Migration target: Vue Options API to Composition API
- Convert data() to ref/reactive in setup()
- Convert computed properties to computed()
- Convert methods to regular functions in setup()
- Convert watch options to watch/watchEffect
- Convert lifecycle hooks (mounted -> onMounted, etc.)
- Convert props definition to defineProps
- Convert emits to defineEmits
- Return all reactive state and methods from setup()`,
  };

  return base + (targetSpecific[target] || '');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function suggestOutputFilename(inputPath: string, target: string): string {
  const dir = path.dirname(inputPath);
  const basename = path.basename(inputPath, path.extname(inputPath));
  const ext = path.extname(inputPath);

  switch (target) {
    case 'typescript':
      if (ext === '.jsx') return path.join(dir, `${basename}.tsx`);
      return path.join(dir, `${basename}.ts`);
    case 'esm':
      if (ext === '.cjs') return path.join(dir, `${basename}.mjs`);
      return inputPath;
    default:
      return inputPath;
  }
}

// ─── Main Command ────────────────────────────────────────────────────────────

export interface MigrateCommandOptions {
  to: string;
}

export async function migrateCommand(filePath: string, options: MigrateCommandOptions): Promise<void> {
  const pipelineOpts = getPipelineOptions();
  const target = options.to.toLowerCase();

  // Validate migration target
  if (!MIGRATION_TARGETS[target]) {
    console.log();
    printError(`Unknown migration target: "${options.to}"`);
    console.log();
    printInfo('Available migration targets:');
    for (const [key, info] of Object.entries(MIGRATION_TARGETS)) {
      console.log(`    ${colors.command(key.padEnd(14))} ${palette.dim(info.description)}`);
    }
    console.log();
    printInfo(`Usage: ${colors.command('orion migrate <file> --to <target>')}`);
    console.log();
    process.exit(1);
  }

  // Read and validate source file
  const file = readAndValidateFile(filePath);
  if (!file) {
    process.exit(1);
  }

  const targetInfo = MIGRATION_TARGETS[target];
  const outputPath = suggestOutputFilename(file.resolvedPath, target);
  const isSameFile = path.resolve(outputPath) === file.resolvedPath;

  console.log(commandHeader('Orion Migrate', [
    ['Source', colors.file(file.resolvedPath)],
    ['Target', palette.green(targetInfo.label)],
    ['Language', `${file.language} \u00B7 ${file.lineCount} lines`],
    ['Output', colors.file(outputPath) + (isSameFile ? palette.dim(' (in-place)') : palette.dim(' (new file)'))],
  ]));

  // Run migration through AI
  const spinner = startSpinner(`Migrating to ${targetInfo.label}...`);

  try {
    const userMessage =
      `Migrate the following ${file.language} file to ${targetInfo.label}.\n\n` +
      `File: ${file.fileName}\n\n` +
      `\`\`\`${file.language}\n${file.content}\n\`\`\``;

    const projectContext = loadProjectContext();
    const systemPrompt = getMigrationSystemPrompt(target);
    const fullSystemPrompt = projectContext
      ? systemPrompt + '\n\nProject context:\n' + projectContext
      : systemPrompt;

    const { callbacks, getResponse } = createSilentStreamHandler(spinner, 'Migration complete');

    await askAI(fullSystemPrompt, userMessage, callbacks, { requireComplete: true });

    const fullResponse = getResponse();

    // Parse response: look for migration notes and separator
    let migrationNotes: string[] = [];
    let migratedContent: string;

    if (fullResponse.includes('---MIGRATED---')) {
      const parts = fullResponse.split('---MIGRATED---');
      const notesPart = parts[0]?.trim() || '';
      migratedContent = parts[1]?.trim() || '';

      // Extract migration notes
      const noteLines = notesPart.split('\n');
      for (const line of noteLines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[MIGRATION NOTE]')) {
          migrationNotes.push(trimmed.replace('[MIGRATION NOTE] ', ''));
        }
      }
    } else {
      migratedContent = fullResponse.trim();
    }

    // Clean up potential code fences
    if (migratedContent.startsWith('```')) {
      const lines = migratedContent.split('\n');
      lines.shift();
      if (lines[lines.length - 1]?.trim() === '```') {
        lines.pop();
      }
      migratedContent = lines.join('\n');
    }

    if (!migratedContent.trim()) {
      throw new Error('The AI returned an empty file. Nothing was written.');
    }

    // Show migration notes
    if (migrationNotes.length > 0 && !pipelineOpts.quiet) {
      console.log();
      console.log(divider('Migration Notes'));
      console.log();
      for (const note of migrationNotes) {
        console.log(`  ${palette.yellow('!')} ${note}`);
      }
    }

    // Show diff preview
    if (!pipelineOpts.quiet) {
      console.log();
      console.log(diffBlock(file.content, migratedContent, `${file.fileName} -> ${path.basename(outputPath)}`));
      console.log();
    }

    jsonOutput('migrate_preview', {
      source: file.resolvedPath,
      target: targetInfo.label,
      output: outputPath,
      migrationNotes,
    });

    // Confirm application
    let action: string;
    if (pipelineOpts.yes) {
      action = 'apply';
    } else {
      const answer = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: `Apply migration (${file.fileName} -> ${targetInfo.label})?`,
        choices: [
          { name: 'Apply migration', value: 'apply' },
          { name: 'Cancel', value: 'cancel' },
        ],
      }]);
      action = answer.action;
    }

    if (action === 'apply') {
      if (pipelineOpts.dryRun) {
        printInfo('Dry run: no files were modified.');
        jsonOutput('migrate_result', { success: true, dryRun: true });
        return;
      }

      // Create backup of the original file
      try {
        createBackup(file.resolvedPath);
        printInfo('Backup of original file saved.');
      } catch (backupErr: any) {
        printWarning(`Backup skipped: ${backupErr.message}`);
      }

      // Write migrated content
      writeFileContent(outputPath, migratedContent);
      printSuccess(`Migrated: ${colors.file(outputPath)}`);

      if (!isSameFile) {
        printInfo(`Original file preserved at ${colors.file(file.resolvedPath)}`);
      }

      jsonOutput('migrate_result', {
        success: true,
        source: file.resolvedPath,
        output: outputPath,
        target: targetInfo.label,
      });
    } else {
      printInfo('Migration cancelled. No files changed.');
    }

    console.log();

  } catch (err: any) {
    printCommandError(err, 'migrate', 'Run `orion config` to check your AI provider settings.');
    process.exit(1);
  }
}
