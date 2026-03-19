import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  TEMPLATES,
  listTemplates,
  writeTemplateFiles,
  boilerplateCommand,
  type BoilerplateTemplate,
} from '../commands/boilerplate.js';
import { setPipelineOptions } from '../pipeline.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;

function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-boilerplate-test-'));
  return tmpDir;
}

function cleanTmpDir(): void {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const VALID_CATEGORIES = ['backend', 'frontend', 'devops', 'docs', 'testing', 'config'] as const;

const EXPECTED_IDS = [
  'express-api',
  'react-component',
  'dockerfile',
  'github-actions',
  'readme',
  'tsconfig',
  'eslint',
  'vitest',
  'gitignore',
  'prettier',
  'jest',
  'editorconfig',
  'license-mit',
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('boilerplate', () => {
  // ── TEMPLATES registry ────────────────────────────────────────────────────

  describe('TEMPLATES registry', () => {
    it('has at least 13 templates', () => {
      const keys = Object.keys(TEMPLATES);
      expect(keys.length).toBeGreaterThanOrEqual(13);
    });

    it('contains all expected template IDs', () => {
      const keys = Object.keys(TEMPLATES);
      for (const id of EXPECTED_IDS) {
        expect(keys).toContain(id);
      }
    });

    it('has unique template IDs (no duplicates)', () => {
      const keys = Object.keys(TEMPLATES);
      const unique = new Set(keys);
      expect(unique.size).toBe(keys.length);
    });

    it('each template has a non-empty name', () => {
      for (const [id, tpl] of Object.entries(TEMPLATES)) {
        expect(tpl.name, `template "${id}" should have a name`).toBeTruthy();
        expect(typeof tpl.name).toBe('string');
        expect(tpl.name.length).toBeGreaterThan(0);
      }
    });

    it('each template has a non-empty description', () => {
      for (const [id, tpl] of Object.entries(TEMPLATES)) {
        expect(tpl.description, `template "${id}" should have a description`).toBeTruthy();
        expect(typeof tpl.description).toBe('string');
        expect(tpl.description.length).toBeGreaterThan(0);
      }
    });

    it('each template has a valid category', () => {
      for (const [id, tpl] of Object.entries(TEMPLATES)) {
        expect(
          (VALID_CATEGORIES as readonly string[]).includes(tpl.category),
          `template "${id}" has invalid category "${tpl.category}"`,
        ).toBe(true);
      }
    });

    it('each template has a files array', () => {
      for (const [id, tpl] of Object.entries(TEMPLATES)) {
        expect(Array.isArray(tpl.files), `template "${id}" files should be an array`).toBe(true);
      }
    });

    it('each template has at least one file', () => {
      for (const [id, tpl] of Object.entries(TEMPLATES)) {
        expect(tpl.files.length, `template "${id}" should have at least one file`).toBeGreaterThanOrEqual(1);
      }
    });

    it('every file has a non-empty path string', () => {
      for (const [id, tpl] of Object.entries(TEMPLATES)) {
        for (const file of tpl.files) {
          expect(typeof file.path).toBe('string');
          expect(file.path.length, `file in "${id}" should have a non-empty path`).toBeGreaterThan(0);
        }
      }
    });

    it('every file has a non-empty content string', () => {
      for (const [id, tpl] of Object.entries(TEMPLATES)) {
        for (const file of tpl.files) {
          expect(typeof file.content).toBe('string');
          expect(file.content.length, `file "${file.path}" in "${id}" should have non-empty content`).toBeGreaterThan(0);
        }
      }
    });

    it('all six categories are represented', () => {
      const categories = new Set(Object.values(TEMPLATES).map(t => t.category));
      for (const cat of VALID_CATEGORIES) {
        expect(categories.has(cat), `category "${cat}" should be present`).toBe(true);
      }
    });

    it('express-api template is in backend category', () => {
      expect(TEMPLATES['express-api'].category).toBe('backend');
    });

    it('react-component template is in frontend category', () => {
      expect(TEMPLATES['react-component'].category).toBe('frontend');
    });

    it('dockerfile template is in devops category', () => {
      expect(TEMPLATES['dockerfile'].category).toBe('devops');
    });

    it('readme template is in docs category', () => {
      expect(TEMPLATES['readme'].category).toBe('docs');
    });

    it('vitest template is in testing category', () => {
      expect(TEMPLATES['vitest'].category).toBe('testing');
    });

    it('tsconfig template is in config category', () => {
      expect(TEMPLATES['tsconfig'].category).toBe('config');
    });
  });

  // ── listTemplates ─────────────────────────────────────────────────────────

  describe('listTemplates', () => {
    it('returns an array', () => {
      const result = listTemplates();
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns one entry per template', () => {
      const result = listTemplates();
      expect(result.length).toBe(Object.keys(TEMPLATES).length);
    });

    it('each entry has name, description, and category', () => {
      const result = listTemplates();
      for (const entry of result) {
        expect(entry).toHaveProperty('name');
        expect(entry).toHaveProperty('description');
        expect(entry).toHaveProperty('category');
      }
    });

    it('entry names match template keys', () => {
      const result = listTemplates();
      const names = result.map(e => e.name);
      for (const key of Object.keys(TEMPLATES)) {
        expect(names).toContain(key);
      }
    });

    it('entry descriptions match template descriptions', () => {
      const result = listTemplates();
      for (const entry of result) {
        const tpl = TEMPLATES[entry.name];
        expect(entry.description).toBe(tpl.description);
      }
    });

    it('entry categories match template categories', () => {
      const result = listTemplates();
      for (const entry of result) {
        const tpl = TEMPLATES[entry.name];
        expect(entry.category).toBe(tpl.category);
      }
    });
  });

  // ── writeTemplateFiles ────────────────────────────────────────────────────

  describe('writeTemplateFiles', () => {
    beforeEach(() => {
      makeTmpDir();
    });

    afterEach(() => {
      cleanTmpDir();
    });

    it('creates files for a valid template', () => {
      const { created, skipped } = writeTemplateFiles('tsconfig', tmpDir);
      expect(created.length).toBeGreaterThan(0);
      expect(skipped.length).toBe(0);
    });

    it('created files actually exist on disk', () => {
      const { created } = writeTemplateFiles('tsconfig', tmpDir);
      for (const rel of created) {
        const full = path.join(tmpDir, rel);
        expect(fs.existsSync(full), `file "${rel}" should exist`).toBe(true);
      }
    });

    it('file contents match template contents', () => {
      writeTemplateFiles('eslint', tmpDir);
      const tpl = TEMPLATES['eslint'];
      for (const file of tpl.files) {
        const written = fs.readFileSync(path.join(tmpDir, file.path), 'utf-8');
        expect(written).toBe(file.content);
      }
    });

    it('creates nested directories automatically', () => {
      writeTemplateFiles('github-actions', tmpDir);
      const tpl = TEMPLATES['github-actions'];
      for (const file of tpl.files) {
        const dir = path.dirname(path.join(tmpDir, file.path));
        expect(fs.existsSync(dir), `directory for "${file.path}" should exist`).toBe(true);
      }
    });

    it('skips existing files without --force', () => {
      // Write once
      writeTemplateFiles('gitignore', tmpDir);
      // Write again without force
      const { created, skipped } = writeTemplateFiles('gitignore', tmpDir);
      expect(created.length).toBe(0);
      expect(skipped.length).toBeGreaterThan(0);
    });

    it('overwrites existing files with --force', () => {
      // Write once
      writeTemplateFiles('gitignore', tmpDir);
      // Overwrite with force
      const { created, skipped } = writeTemplateFiles('gitignore', tmpDir, { force: true });
      expect(created.length).toBeGreaterThan(0);
      expect(skipped.length).toBe(0);
    });

    it('throws on unknown template', () => {
      expect(() => writeTemplateFiles('nonexistent-template', tmpDir)).toThrow('Unknown template');
    });

    it('throws with template name in error message', () => {
      expect(() => writeTemplateFiles('fake-tpl', tmpDir)).toThrow('fake-tpl');
    });

    it('handles multi-file templates correctly', () => {
      const { created } = writeTemplateFiles('express-api', tmpDir);
      const tpl = TEMPLATES['express-api'];
      expect(created.length).toBe(tpl.files.length);
    });

    it('handles prettier template with two files', () => {
      const { created } = writeTemplateFiles('prettier', tmpDir);
      expect(created.length).toBe(2);
      expect(fs.existsSync(path.join(tmpDir, '.prettierrc'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.prettierignore'))).toBe(true);
    });
  });

  // ── boilerplateCommand ────────────────────────────────────────────────────

  describe('boilerplateCommand', () => {
    beforeEach(() => {
      makeTmpDir();
      // Reset pipeline to defaults
      setPipelineOptions({
        json: false,
        yes: false,
        noColor: false,
        quiet: false,
        dryRun: false,
      });
      // Suppress console output during command tests
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      cleanTmpDir();
      vi.restoreAllMocks();
    });

    it('is exported and is a function', () => {
      expect(boilerplateCommand).toBeDefined();
      expect(typeof boilerplateCommand).toBe('function');
    });

    it('--list flag shows templates without writing files', async () => {
      await boilerplateCommand(undefined, { list: true });
      // Should not throw and console.log should have been called
      expect(console.log).toHaveBeenCalled();
    });

    it('calling with no arguments shows template list', async () => {
      await boilerplateCommand(undefined, undefined);
      expect(console.log).toHaveBeenCalled();
    });

    it('generates files with a valid template and --output', async () => {
      await boilerplateCommand('tsconfig', { output: tmpDir });
      const tpl = TEMPLATES['tsconfig'];
      for (const file of tpl.files) {
        expect(fs.existsSync(path.join(tmpDir, file.path))).toBe(true);
      }
    });

    it('--force flag overwrites existing files', async () => {
      // First write
      await boilerplateCommand('gitignore', { output: tmpDir });
      // Overwrite
      const marker = 'MARKER_CONTENT';
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), marker, 'utf-8');
      await boilerplateCommand('gitignore', { output: tmpDir, force: true });
      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
      expect(content).not.toBe(marker);
    });

    it('--dry-run shows preview without creating files', async () => {
      setPipelineOptions({ dryRun: true });
      const outDir = path.join(tmpDir, 'dryrun-sub');
      await boilerplateCommand('eslint', { output: outDir });
      // The output directory should not even exist
      const tpl = TEMPLATES['eslint'];
      for (const file of tpl.files) {
        expect(fs.existsSync(path.join(outDir, file.path))).toBe(false);
      }
    });

    it('handles unknown template gracefully', async () => {
      await boilerplateCommand('does-not-exist', { output: tmpDir });
      // Should not throw, just print error info
      expect(console.log).toHaveBeenCalled();
    });

    it('generates express-api with correct file count', async () => {
      await boilerplateCommand('express-api', { output: tmpDir });
      const tpl = TEMPLATES['express-api'];
      for (const file of tpl.files) {
        expect(fs.existsSync(path.join(tmpDir, file.path))).toBe(true);
      }
    });

    it('generates react-component with both files', async () => {
      await boilerplateCommand('react-component', { output: tmpDir });
      expect(fs.existsSync(path.join(tmpDir, 'Component.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'Component.test.tsx'))).toBe(true);
    });

    it('generates dockerfile template', async () => {
      await boilerplateCommand('dockerfile', { output: tmpDir });
      expect(fs.existsSync(path.join(tmpDir, 'Dockerfile'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.dockerignore'))).toBe(true);
    });

    it('skips existing files without --force flag', async () => {
      await boilerplateCommand('editorconfig', { output: tmpDir });
      const original = fs.readFileSync(path.join(tmpDir, '.editorconfig'), 'utf-8');
      // Modify the file
      fs.writeFileSync(path.join(tmpDir, '.editorconfig'), 'CHANGED', 'utf-8');
      // Re-run without force
      await boilerplateCommand('editorconfig', { output: tmpDir });
      const afterSecondRun = fs.readFileSync(path.join(tmpDir, '.editorconfig'), 'utf-8');
      expect(afterSecondRun).toBe('CHANGED');
    });
  });

  // ── Individual template structure checks ──────────────────────────────────

  describe('individual template structures', () => {
    it('express-api has src/index.ts and package.json', () => {
      const files = TEMPLATES['express-api'].files.map(f => f.path);
      expect(files).toContain('src/index.ts');
      expect(files).toContain('package.json');
    });

    it('github-actions has workflow yml file', () => {
      const files = TEMPLATES['github-actions'].files.map(f => f.path);
      expect(files.some(f => f.endsWith('.yml'))).toBe(true);
    });

    it('vitest template has config and example test', () => {
      const files = TEMPLATES['vitest'].files.map(f => f.path);
      expect(files).toContain('vitest.config.ts');
      expect(files.length).toBeGreaterThanOrEqual(2);
    });

    it('jest template has jest.config.ts', () => {
      const files = TEMPLATES['jest'].files.map(f => f.path);
      expect(files).toContain('jest.config.ts');
    });

    it('license-mit template has LICENSE file', () => {
      const files = TEMPLATES['license-mit'].files.map(f => f.path);
      expect(files).toContain('LICENSE');
    });

    it('license-mit content contains "MIT License"', () => {
      const tpl = TEMPLATES['license-mit'];
      const licenseFile = tpl.files.find(f => f.path === 'LICENSE');
      expect(licenseFile).toBeDefined();
      expect(licenseFile!.content).toContain('MIT License');
    });

    it('readme template has README.md', () => {
      const files = TEMPLATES['readme'].files.map(f => f.path);
      expect(files).toContain('README.md');
    });

    it('editorconfig template has .editorconfig', () => {
      const files = TEMPLATES['editorconfig'].files.map(f => f.path);
      expect(files).toContain('.editorconfig');
    });
  });
});
