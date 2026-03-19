import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../markdown.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('renderMarkdown', () => {
  // ── Headers ─────────────────────────────────────────────────────────────────

  describe('headers', () => {
    it('renders h1 headers', () => {
      const result = renderMarkdown('# Hello World');
      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(0);
      // The rendered output should contain the header text
      expect(result).toContain('Hello World');
    });

    it('renders h2 headers', () => {
      const result = renderMarkdown('## Subtitle');
      expect(result).toContain('Subtitle');
    });

    it('renders h3 headers', () => {
      const result = renderMarkdown('### Deep Heading');
      expect(result).toContain('Deep Heading');
    });

    it('renders multiple headers', () => {
      const md = '# Title\n\n## Section\n\n### Sub';
      const result = renderMarkdown(md);
      expect(result).toContain('Title');
      expect(result).toContain('Section');
      expect(result).toContain('Sub');
    });
  });

  // ── Code Blocks ─────────────────────────────────────────────────────────────

  describe('code blocks', () => {
    it('renders fenced code blocks', () => {
      const md = '```\nconsole.log("hi");\n```';
      const result = renderMarkdown(md);
      expect(result).toContain('console.log');
    });

    it('renders code blocks with language hints', () => {
      const md = '```typescript\nconst x: number = 42;\n```';
      const result = renderMarkdown(md);
      expect(result).toContain('const x');
    });

    it('renders inline code', () => {
      const md = 'Use `npm install` to install.';
      const result = renderMarkdown(md);
      expect(result).toContain('npm install');
    });

    it('renders multi-line code blocks', () => {
      const md = '```\nline1\nline2\nline3\n```';
      const result = renderMarkdown(md);
      expect(result).toContain('line1');
      expect(result).toContain('line2');
      expect(result).toContain('line3');
    });
  });

  // ── Empty Input ─────────────────────────────────────────────────────────────

  describe('empty input', () => {
    it('returns empty string for empty input', () => {
      expect(renderMarkdown('')).toBe('');
    });

    it('returns empty string for whitespace-only input', () => {
      expect(renderMarkdown('   ')).toBe('');
      expect(renderMarkdown('\n\n')).toBe('');
      expect(renderMarkdown('\t')).toBe('');
    });

    it('returns empty string for null-like falsy input', () => {
      // The function checks !text first
      expect(renderMarkdown(undefined as unknown as string)).toBe('');
      expect(renderMarkdown(null as unknown as string)).toBe('');
    });
  });

  // ── Malformed / Edge-case Markdown ──────────────────────────────────────────

  describe('malformed markdown', () => {
    it('handles unclosed code blocks without crashing', () => {
      const md = '```\nunclosed code block';
      const result = renderMarkdown(md);
      // Should not throw; should return something
      expect(typeof result).toBe('string');
    });

    it('handles deeply nested headers', () => {
      const md = '###### Very Deep';
      const result = renderMarkdown(md);
      expect(result).toContain('Very Deep');
    });

    it('handles text with no markdown syntax', () => {
      const md = 'Just plain text without any formatting.';
      const result = renderMarkdown(md);
      expect(result).toContain('Just plain text');
    });

    it('handles mixed bold, italic, and code', () => {
      const md = '**bold** *italic* `code`';
      const result = renderMarkdown(md);
      expect(result).toContain('bold');
      expect(result).toContain('italic');
      expect(result).toContain('code');
    });

    it('handles stray # symbols in the middle of text', () => {
      const md = 'This has a # in the middle.';
      const result = renderMarkdown(md);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles consecutive blank lines gracefully', () => {
      const md = 'Paragraph 1\n\n\n\n\n\nParagraph 2';
      const result = renderMarkdown(md);
      expect(result).toContain('Paragraph 1');
      expect(result).toContain('Paragraph 2');
    });

    it('handles very long single lines', () => {
      const md = 'A'.repeat(500);
      const result = renderMarkdown(md);
      expect(result).toContain('A');
    });
  });

  // ── Lists and Other Elements ───────────────────────────────────────────────

  describe('other elements', () => {
    it('renders unordered lists', () => {
      const md = '- Item 1\n- Item 2\n- Item 3';
      const result = renderMarkdown(md);
      expect(result).toContain('Item 1');
      expect(result).toContain('Item 2');
      expect(result).toContain('Item 3');
    });

    it('renders blockquotes', () => {
      const md = '> This is a quote';
      const result = renderMarkdown(md);
      expect(result).toContain('This is a quote');
    });

    it('renders links', () => {
      const md = '[Click here](https://example.com)';
      const result = renderMarkdown(md);
      expect(result).toContain('Click here');
    });
  });
});
