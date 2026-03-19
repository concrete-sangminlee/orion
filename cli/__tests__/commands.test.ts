import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Test Data ──────────────────────────────────────────────────────────────

/**
 * All command names registered in cli/index.ts.
 * Extracted from the source by reading .command('name') calls.
 */
const ALL_COMMAND_NAMES = [
  'chat', 'ask', 'explain', 'review', 'fix', 'edit', 'commit',
  'search', 'diff', 'pr', 'run', 'test', 'agent', 'refactor', 'compare',
  'plan', 'generate', 'docs', 'snippet', 'scaffold',
  'shell', 'todo', 'fetch', 'changelog', 'log', 'summarize', 'migrate',
  'deps', 'format', 'translate', 'env',
  'debug', 'benchmark', 'security', 'typecheck',
  'undo', 'status', 'doctor', 'clean',
  'session', 'watch', 'config', 'init', 'gui', 'completions',
  'hooks', 'alias',
  'learn', 'pair', 'context',
  'plugin', 'api', 'regex', 'cron',
  'tutorial', 'examples', 'update', 'info',
];

/**
 * Command categories as defined in the help text of cli/index.ts.
 */
const COMMAND_CATEGORIES: Record<string, string[]> = {
  Core: ['chat', 'ask', 'explain', 'review', 'fix', 'edit', 'commit'],
  Code: ['search', 'diff', 'pr', 'run', 'test', 'agent', 'refactor', 'compare'],
  Generate: ['plan', 'generate', 'docs', 'snippet', 'scaffold'],
  Tools: ['shell', 'todo', 'fetch', 'changelog', 'log', 'summarize', 'migrate', 'deps', 'format', 'translate', 'env'],
  Analysis: ['debug', 'benchmark', 'security', 'typecheck'],
  Safety: ['undo', 'status', 'doctor', 'clean'],
  Session: ['session', 'watch', 'config', 'init', 'gui', 'completions'],
  Git: ['hooks', 'alias'],
  AI: ['learn', 'pair', 'context'],
  Extend: ['plugin', 'api', 'regex', 'cron'],
  Help: ['tutorial', 'examples', 'update', 'info'],
};

/**
 * Map of command name -> expected export function name from its command file.
 * We verify that each command in index.ts has a corresponding file with the right export.
 */
const COMMAND_EXPORTS: Record<string, { file: string; fn: string }> = {
  chat: { file: 'chat.ts', fn: 'chatCommand' },
  ask: { file: 'ask.ts', fn: 'askCommand' },
  explain: { file: 'explain.ts', fn: 'explainCommand' },
  review: { file: 'review.ts', fn: 'reviewCommand' },
  fix: { file: 'fix.ts', fn: 'fixCommand' },
  edit: { file: 'edit.ts', fn: 'editCommand' },
  commit: { file: 'commit.ts', fn: 'commitCommand' },
  search: { file: 'search.ts', fn: 'searchCommand' },
  diff: { file: 'diff.ts', fn: 'diffCommand' },
  pr: { file: 'pr.ts', fn: 'prCommand' },
  run: { file: 'run.ts', fn: 'runCommand' },
  test: { file: 'test.ts', fn: 'testCommand' },
  agent: { file: 'agent.ts', fn: 'agentCommand' },
  refactor: { file: 'refactor.ts', fn: 'refactorCommand' },
  compare: { file: 'compare.ts', fn: 'compareCommand' },
  plan: { file: 'plan.ts', fn: 'planCommand' },
  generate: { file: 'generate.ts', fn: 'generateCommand' },
  docs: { file: 'docs.ts', fn: 'docsCommand' },
  snippet: { file: 'snippet.ts', fn: 'snippetCommand' },
  scaffold: { file: 'scaffold.ts', fn: 'scaffoldCommand' },
  shell: { file: 'shell.ts', fn: 'shellCommand' },
  todo: { file: 'todo.ts', fn: 'todoCommand' },
  fetch: { file: 'fetch.ts', fn: 'fetchCommand' },
  changelog: { file: 'changelog.ts', fn: 'changelogCommand' },
  log: { file: 'log.ts', fn: 'logCommand' },
  summarize: { file: 'summarize.ts', fn: 'summarizeCommand' },
  migrate: { file: 'migrate.ts', fn: 'migrateCommand' },
  deps: { file: 'deps.ts', fn: 'depsCommand' },
  format: { file: 'format.ts', fn: 'formatCommand' },
  translate: { file: 'translate.ts', fn: 'translateCommand' },
  env: { file: 'env.ts', fn: 'envCommand' },
  debug: { file: 'debug.ts', fn: 'debugCommand' },
  benchmark: { file: 'benchmark.ts', fn: 'benchmarkCommand' },
  security: { file: 'security.ts', fn: 'securityCommand' },
  typecheck: { file: 'typecheck.ts', fn: 'typecheckCommand' },
};

// ─── Read index.ts content once ──────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CLI_DIR = path.join(PROJECT_ROOT, 'cli');
let indexSource: string;

beforeAll(() => {
  indexSource = fs.readFileSync(path.join(CLI_DIR, 'index.ts'), 'utf-8');
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('command registration in index.ts', () => {
  describe('all commands are registered', () => {
    for (const cmd of ALL_COMMAND_NAMES) {
      it(`registers the "${cmd}" command`, () => {
        // Each command should appear as .command('name') or .command('name <arg>') etc.
        const pattern = new RegExp(`\\.command\\(['"]${cmd}(\\s|['"])`);
        expect(indexSource).toMatch(pattern);
      });
    }
  });

  describe('command categories contain expected commands', () => {
    for (const [category, commands] of Object.entries(COMMAND_CATEGORIES)) {
      it(`category "${category}" has ${commands.length} commands`, () => {
        expect(commands.length).toBeGreaterThan(0);
        // Verify each command in this category is in the master list
        for (const cmd of commands) {
          expect(ALL_COMMAND_NAMES).toContain(cmd);
        }
      });
    }
  });

  it('total registered commands is at least 53', () => {
    // The package description says "53+ commands"
    expect(ALL_COMMAND_NAMES.length).toBeGreaterThanOrEqual(53);
  });
});

describe('version configuration', () => {
  it('index.ts contains CURRENT_VERSION set to 2.1.0', () => {
    expect(indexSource).toContain("const CURRENT_VERSION = '2.1.0'");
  });

  it('CURRENT_VERSION matches package.json version', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    const versionMatch = indexSource.match(/const CURRENT_VERSION = '([^']+)'/);
    expect(versionMatch).not.toBeNull();
    expect(versionMatch![1]).toBe(pkg.version);
  });

  it('program is configured with .version()', () => {
    expect(indexSource).toMatch(/\.version\(CURRENT_VERSION/);
  });

  it('version flag includes -v shorthand', () => {
    expect(indexSource).toContain('-v, --version');
  });
});

describe('help text configuration', () => {
  it('program has a description', () => {
    expect(indexSource).toMatch(/\.description\(/);
  });

  it('program is named "orion"', () => {
    expect(indexSource).toContain(".name('orion')");
  });

  it('help text includes all category labels', () => {
    for (const category of Object.keys(COMMAND_CATEGORIES)) {
      expect(indexSource).toContain(category);
    }
  });

  it('addHelpText is configured for beforeAll', () => {
    expect(indexSource).toContain("addHelpText('beforeAll'");
  });
});

describe('global options', () => {
  it('supports --json flag', () => {
    expect(indexSource).toContain("'--json'");
  });

  it('supports -y/--yes flag', () => {
    expect(indexSource).toContain("'-y, --yes'");
  });

  it('supports --no-color flag', () => {
    expect(indexSource).toContain("'--no-color'");
  });

  it('supports --quiet flag', () => {
    expect(indexSource).toContain("'--quiet'");
  });

  it('supports --dry-run flag', () => {
    expect(indexSource).toContain("'--dry-run'");
  });
});

describe('unknown command handling', () => {
  it('index.ts contains unknown command error messaging', () => {
    expect(indexSource).toContain('Unknown command');
  });

  it('suggests running --help for unknown commands', () => {
    expect(indexSource).toContain('orion --help');
  });

  it('suggests creating an alias for unknown commands', () => {
    expect(indexSource).toContain('orion alias');
  });
});

describe('command file exports match registrations', () => {
  for (const [cmd, info] of Object.entries(COMMAND_EXPORTS)) {
    it(`"${cmd}" command file ${info.file} exports ${info.fn}`, () => {
      const filePath = path.join(CLI_DIR, 'commands', info.file);
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      // Check that the expected function is exported
      const exportPattern = new RegExp(
        `export\\s+(async\\s+)?function\\s+${info.fn}\\b`
      );
      expect(content).toMatch(exportPattern);
    });
  }
});

describe('preAction hook', () => {
  it('sets pipeline options in preAction', () => {
    expect(indexSource).toContain("hook('preAction'");
    expect(indexSource).toContain('setPipelineOptions');
  });
});
