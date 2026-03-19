import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Constants ───────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CLI_DIR = path.join(PROJECT_ROOT, 'cli');
const COMMANDS_DIR = path.join(CLI_DIR, 'commands');
const DIST_CLI_DIR = path.join(PROJECT_ROOT, 'dist-cli');
const BUILT_INDEX = path.join(DIST_CLI_DIR, 'index.js');
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');

// ─── Helper ──────────────────────────────────────────────────────────────────

function readPackageJson(): Record<string, any> {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CLI build output', () => {
  it('dist-cli directory exists', () => {
    expect(fs.existsSync(DIST_CLI_DIR)).toBe(true);
  });

  it('dist-cli/index.js exists', () => {
    expect(fs.existsSync(BUILT_INDEX)).toBe(true);
  });

  it('built file starts with a shebang line', () => {
    const content = fs.readFileSync(BUILT_INDEX, 'utf-8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('built file contains "use strict"', () => {
    const content = fs.readFileSync(BUILT_INDEX, 'utf-8');
    expect(content).toContain('"use strict"');
  });

  it('built file is valid JavaScript (after stripping shebang)', () => {
    const content = fs.readFileSync(BUILT_INDEX, 'utf-8');
    // Strip all shebang lines (there may be duplicates from esbuild banner + source)
    const stripped = content.replace(/^#!.*\n/gm, '');
    // If it can be parsed by Function constructor, it is valid JS
    // We just check that it does not throw a SyntaxError when evaluated in a basic way
    expect(() => {
      new Function(stripped);
    }).not.toThrow();
  });

  it('built file is reasonably sized (> 10KB)', () => {
    const stat = fs.statSync(BUILT_INDEX);
    expect(stat.size).toBeGreaterThan(10 * 1024);
  });

  it('built file is not excessively large (< 5MB)', () => {
    const stat = fs.statSync(BUILT_INDEX);
    expect(stat.size).toBeLessThan(5 * 1024 * 1024);
  });

  it('built file contains the version string', () => {
    const content = fs.readFileSync(BUILT_INDEX, 'utf-8');
    const pkg = readPackageJson();
    expect(content).toContain(pkg.version);
  });
});

describe('package.json configuration', () => {
  it('has a bin field', () => {
    const pkg = readPackageJson();
    expect(pkg.bin).toBeDefined();
  });

  it('bin field maps "orion" to dist-cli/index.js', () => {
    const pkg = readPackageJson();
    expect(pkg.bin.orion).toBe('./dist-cli/index.js');
  });

  it('has a name field set to "orion-ide"', () => {
    const pkg = readPackageJson();
    expect(pkg.name).toBe('orion-ide');
  });

  it('version field matches CURRENT_VERSION in index.ts', () => {
    const pkg = readPackageJson();
    const indexSource = fs.readFileSync(path.join(CLI_DIR, 'index.ts'), 'utf-8');
    const match = indexSource.match(/const CURRENT_VERSION = '([^']+)'/);
    expect(match).not.toBeNull();
    expect(pkg.version).toBe(match![1]);
  });

  it('has test script configured', () => {
    const pkg = readPackageJson();
    expect(pkg.scripts.test).toBeDefined();
    expect(pkg.scripts.test).toContain('vitest');
  });

  it('has cli:build script configured', () => {
    const pkg = readPackageJson();
    expect(pkg.scripts['cli:build']).toBeDefined();
    expect(pkg.scripts['cli:build']).toContain('esbuild');
  });

  it('has test:cli script configured', () => {
    const pkg = readPackageJson();
    expect(pkg.scripts['test:cli']).toBeDefined();
    expect(pkg.scripts['test:cli']).toContain('cli/__tests__');
  });

  it('has type set to "module" (ESM)', () => {
    const pkg = readPackageJson();
    expect(pkg.type).toBe('module');
  });

  it('requires Node.js >= 18', () => {
    const pkg = readPackageJson();
    expect(pkg.engines.node).toContain('18');
  });
});

describe('command file structure', () => {
  /**
   * All command files that should exist in cli/commands/
   */
  const EXPECTED_COMMAND_FILES = [
    'agent.ts', 'alias.ts', 'api-lookup.ts', 'ask.ts', 'benchmark.ts',
    'changelog.ts', 'chat.ts', 'clean.ts', 'commit.ts', 'compare.ts',
    'completions.ts', 'config.ts', 'context-cmd.ts', 'context.ts',
    'cron-helper.ts', 'debug.ts', 'deps.ts', 'diff.ts', 'docs.ts',
    'doctor.ts', 'edit.ts', 'env.ts', 'examples.ts', 'explain.ts',
    'fetch.ts', 'fix.ts', 'format.ts', 'generate.ts', 'hooks.ts',
    'learn.ts', 'log.ts', 'metrics.ts', 'migrate.ts', 'pair.ts',
    'pipe.ts', 'plan.ts', 'plugin.ts', 'pr.ts', 'profile.ts',
    'refactor.ts', 'regex.ts', 'review.ts', 'run.ts', 'scaffold.ts',
    'search.ts', 'security.ts', 'session.ts', 'shell.ts', 'snippet.ts',
    'status.ts', 'summarize.ts', 'test.ts', 'todo.ts', 'translate.ts',
    'tutorial.ts', 'typecheck.ts', 'undo.ts', 'update.ts', 'version.ts',
    'watch.ts',
  ];

  for (const file of EXPECTED_COMMAND_FILES) {
    it(`cli/commands/${file} exists`, () => {
      expect(fs.existsSync(path.join(COMMANDS_DIR, file))).toBe(true);
    });
  }

  it('commands directory contains only TypeScript files', () => {
    const files = fs.readdirSync(COMMANDS_DIR);
    for (const file of files) {
      expect(file.endsWith('.ts')).toBe(true);
    }
  });
});

describe('command exports', () => {
  /**
   * Map from command file to the primary exported function(s).
   * We verify the export pattern exists in the source.
   */
  const COMMAND_EXPORT_MAP: Record<string, string[]> = {
    'chat.ts': ['chatCommand'],
    'ask.ts': ['askCommand'],
    'review.ts': ['reviewCommand'],
    'fix.ts': ['fixCommand'],
    'edit.ts': ['editCommand'],
    'commit.ts': ['commitCommand'],
    'explain.ts': ['explainCommand'],
    'search.ts': ['searchCommand'],
    'diff.ts': ['diffCommand'],
    'pr.ts': ['prCommand'],
    'run.ts': ['runCommand'],
    'test.ts': ['testCommand'],
    'agent.ts': ['agentCommand'],
    'refactor.ts': ['refactorCommand'],
    'compare.ts': ['compareCommand'],
    'plan.ts': ['planCommand'],
    'generate.ts': ['generateCommand'],
    'docs.ts': ['docsCommand'],
    'snippet.ts': ['snippetCommand'],
    'scaffold.ts': ['scaffoldCommand'],
    'config.ts': ['configCommand', 'initCommand'],
    'alias.ts': ['aliasCommand'],
    'plugin.ts': ['pluginCommand'],
    'version.ts': ['versionCommand'],
  };

  for (const [file, fns] of Object.entries(COMMAND_EXPORT_MAP)) {
    for (const fn of fns) {
      it(`${file} exports ${fn}`, () => {
        const content = fs.readFileSync(path.join(COMMANDS_DIR, file), 'utf-8');
        const pattern = new RegExp(`export\\s+(async\\s+)?function\\s+${fn}\\b`);
        expect(content).toMatch(pattern);
      });
    }
  }
});

describe('source file consistency', () => {
  it('cli/index.ts exists', () => {
    expect(fs.existsSync(path.join(CLI_DIR, 'index.ts'))).toBe(true);
  });

  it('cli/utils.ts exists', () => {
    expect(fs.existsSync(path.join(CLI_DIR, 'utils.ts'))).toBe(true);
  });

  it('cli/shared.ts exists', () => {
    expect(fs.existsSync(path.join(CLI_DIR, 'shared.ts'))).toBe(true);
  });

  it('cli/ai-client.ts exists', () => {
    expect(fs.existsSync(path.join(CLI_DIR, 'ai-client.ts'))).toBe(true);
  });

  it('cli/stdin.ts exists', () => {
    expect(fs.existsSync(path.join(CLI_DIR, 'stdin.ts'))).toBe(true);
  });

  it('cli/pipeline.ts exists', () => {
    expect(fs.existsSync(path.join(CLI_DIR, 'pipeline.ts'))).toBe(true);
  });

  it('cli/markdown.ts exists', () => {
    expect(fs.existsSync(path.join(CLI_DIR, 'markdown.ts'))).toBe(true);
  });

  it('cli/ui.ts exists', () => {
    expect(fs.existsSync(path.join(CLI_DIR, 'ui.ts'))).toBe(true);
  });

  it('cli/tsconfig.json exists', () => {
    expect(fs.existsSync(path.join(CLI_DIR, 'tsconfig.json'))).toBe(true);
  });
});

describe('no circular dependencies in imports', () => {
  /**
   * Verify that shared utility files do not import from command files.
   * This is a basic static check that prevents circular dependency patterns.
   */
  const UTILITY_FILES = ['utils.ts', 'shared.ts', 'pipeline.ts', 'stdin.ts', 'markdown.ts'];

  for (const utilFile of UTILITY_FILES) {
    it(`${utilFile} does not import from commands/`, () => {
      const content = fs.readFileSync(path.join(CLI_DIR, utilFile), 'utf-8');
      expect(content).not.toMatch(/from\s+['"]\.\/commands\//);
      expect(content).not.toMatch(/import\s.*['"]\.\/commands\//);
    });
  }

  it('ui.ts does not import from commands/', () => {
    const content = fs.readFileSync(path.join(CLI_DIR, 'ui.ts'), 'utf-8');
    expect(content).not.toMatch(/from\s+['"]\.\/commands\//);
  });

  it('ai-client.ts does not import from commands/', () => {
    const content = fs.readFileSync(path.join(CLI_DIR, 'ai-client.ts'), 'utf-8');
    expect(content).not.toMatch(/from\s+['"]\.\/commands\//);
  });
});

describe('dist-cli build artifacts', () => {
  it('dist-cli/utils.js exists', () => {
    expect(fs.existsSync(path.join(DIST_CLI_DIR, 'utils.js'))).toBe(true);
  });

  it('dist-cli/shared.js exists', () => {
    expect(fs.existsSync(path.join(DIST_CLI_DIR, 'shared.js'))).toBe(true);
  });

  it('dist-cli/ai-client.js exists', () => {
    expect(fs.existsSync(path.join(DIST_CLI_DIR, 'ai-client.js'))).toBe(true);
  });

  it('dist-cli/pipeline.js exists', () => {
    expect(fs.existsSync(path.join(DIST_CLI_DIR, 'pipeline.js'))).toBe(true);
  });

  it('dist-cli/ui.js exists', () => {
    expect(fs.existsSync(path.join(DIST_CLI_DIR, 'ui.js'))).toBe(true);
  });

  it('dist-cli/markdown.js exists', () => {
    expect(fs.existsSync(path.join(DIST_CLI_DIR, 'markdown.js'))).toBe(true);
  });

  it('dist-cli/stdin.js exists', () => {
    expect(fs.existsSync(path.join(DIST_CLI_DIR, 'stdin.js'))).toBe(true);
  });
});
