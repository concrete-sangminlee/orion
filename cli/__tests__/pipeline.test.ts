import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setPipelineOptions,
  getPipelineOptions,
  jsonOutput,
  type PipelineOptions,
} from '../pipeline.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('pipeline', () => {
  // Reset options to defaults before each test
  beforeEach(() => {
    setPipelineOptions({
      json: false,
      yes: false,
      noColor: false,
      quiet: false,
      dryRun: false,
    });
  });

  // ── Defaults ──────────────────────────────────────────────────────────────

  describe('default options', () => {
    it('all flags default to false', () => {
      const opts = getPipelineOptions();
      expect(opts.json).toBe(false);
      expect(opts.yes).toBe(false);
      expect(opts.noColor).toBe(false);
      expect(opts.quiet).toBe(false);
      expect(opts.dryRun).toBe(false);
    });
  });

  // ── setPipelineOptions / getPipelineOptions ───────────────────────────────

  describe('setPipelineOptions / getPipelineOptions', () => {
    it('sets and retrieves a single option', () => {
      setPipelineOptions({ json: true });
      const opts = getPipelineOptions();
      expect(opts.json).toBe(true);
      // Others remain false
      expect(opts.yes).toBe(false);
      expect(opts.quiet).toBe(false);
    });

    it('sets multiple options at once', () => {
      setPipelineOptions({ json: true, yes: true, quiet: true });
      const opts = getPipelineOptions();
      expect(opts.json).toBe(true);
      expect(opts.yes).toBe(true);
      expect(opts.quiet).toBe(true);
      expect(opts.noColor).toBe(false);
      expect(opts.dryRun).toBe(false);
    });

    it('merges partial updates with existing values', () => {
      setPipelineOptions({ dryRun: true });
      setPipelineOptions({ quiet: true });
      const opts = getPipelineOptions();
      expect(opts.dryRun).toBe(true);
      expect(opts.quiet).toBe(true);
    });

    it('can toggle an option back to false', () => {
      setPipelineOptions({ json: true });
      expect(getPipelineOptions().json).toBe(true);

      setPipelineOptions({ json: false });
      expect(getPipelineOptions().json).toBe(false);
    });

    it('returns the correct PipelineOptions shape', () => {
      const opts = getPipelineOptions();
      const keys = Object.keys(opts).sort();
      expect(keys).toEqual(['dryRun', 'json', 'noColor', 'quiet', 'yes']);
    });
  });

  // ── jsonOutput ────────────────────────────────────────────────────────────

  describe('jsonOutput', () => {
    it('does not print when json mode is off', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      setPipelineOptions({ json: false });

      jsonOutput('test', { value: 42 });

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('prints valid JSON when json mode is on', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      setPipelineOptions({ json: true });

      jsonOutput('result', { answer: 'hello' });

      expect(spy).toHaveBeenCalledTimes(1);

      const output = spy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.type).toBe('result');
      expect(parsed.data).toEqual({ answer: 'hello' });
      expect(typeof parsed.timestamp).toBe('string');

      spy.mockRestore();
    });

    it('includes an ISO timestamp in the output', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      setPipelineOptions({ json: true });

      jsonOutput('ts-check', {});

      const output = spy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);

      // Validate ISO 8601 format
      const date = new Date(parsed.timestamp);
      expect(date.toString()).not.toBe('Invalid Date');

      spy.mockRestore();
    });

    it('handles complex nested data', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      setPipelineOptions({ json: true });

      const data = {
        files: ['a.ts', 'b.ts'],
        stats: { lines: 100, errors: 0 },
        nested: { deep: { value: true } },
      };

      jsonOutput('complex', data);

      const output = spy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.data).toEqual(data);

      spy.mockRestore();
    });

    it('handles null and undefined data gracefully', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      setPipelineOptions({ json: true });

      jsonOutput('null-check', null);

      const output = spy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.data).toBeNull();

      spy.mockRestore();
    });
  });
});
