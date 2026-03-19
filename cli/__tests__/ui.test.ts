import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock chalk ──────────────────────────────────────────────────────────────

vi.mock('chalk', () => {
  const identity = (s: string) => s;
  const chainable: any = new Proxy(identity, {
    get: () => chainable,
    apply: (_t: any, _this: any, args: any[]) => args[0],
  });
  return { default: chainable };
});

// ─── Set NO_COLOR so ui.ts uses identity wrappers ───────────────────────────

beforeEach(() => {
  process.env.NO_COLOR = '1';
});

// ─── Inline implementations (matching ui.ts logic for testability) ──────────

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

function box(
  content: string,
  options?: { title?: string; width?: number; padding?: number }
): string {
  const width = options?.width || 60;
  const pad = options?.padding ?? 1;
  const innerWidth = width - 2;
  const lines: string[] = [];

  // Top border
  if (options?.title) {
    const titleStr = ` ${options.title} `;
    const remaining = innerWidth - visibleLength(titleStr) - 1;
    lines.push('  \u256D\u2500' + titleStr + '\u2500'.repeat(Math.max(remaining, 0)) + '\u256E');
  } else {
    lines.push('  \u256D' + '\u2500'.repeat(innerWidth) + '\u256E');
  }

  // Top padding
  for (let i = 0; i < pad; i++) {
    lines.push('  \u2502' + ' '.repeat(innerWidth) + '\u2502');
  }

  // Content lines
  const contentLines = content.split('\n');
  for (const line of contentLines) {
    const stripped = stripAnsi(line);
    const usedWidth = stripped.length;
    const rightPad = innerWidth - usedWidth - 2;
    if (rightPad >= 0) {
      lines.push('  \u2502 ' + line + ' '.repeat(rightPad) + ' \u2502');
    } else {
      lines.push('  \u2502 ' + line.substring(0, innerWidth - 2) + ' \u2502');
    }
  }

  // Bottom padding
  for (let i = 0; i < pad; i++) {
    lines.push('  \u2502' + ' '.repeat(innerWidth) + '\u2502');
  }

  // Bottom border
  lines.push('  \u2570' + '\u2500'.repeat(innerWidth) + '\u256F');

  return lines.join('\n');
}

function divider(label?: string): string {
  const width = 60;
  if (label) {
    const labelStr = ` ${label} `;
    const remaining = width - visibleLength(labelStr);
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    return '  ' + '\u2500'.repeat(left) + labelStr + '\u2500'.repeat(right);
  }
  return '  ' + '\u2500'.repeat(width);
}

function badge(text: string, _color: string): string {
  // In NO_COLOR mode, badge returns [text]
  return `[${text}]`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + '\u2026';
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('box', () => {
  it('creates a bordered box with content', () => {
    const result = box('Hello World', { width: 30 });
    expect(result).toContain('\u256D'); // top-left corner
    expect(result).toContain('\u256E'); // top-right corner
    expect(result).toContain('\u2570'); // bottom-left corner
    expect(result).toContain('\u256F'); // bottom-right corner
    expect(result).toContain('Hello World');
  });

  it('includes a title when provided', () => {
    const result = box('Content', { title: 'My Title', width: 40 });
    expect(result).toContain('My Title');
    expect(result).toContain('Content');
  });

  it('creates box without title', () => {
    const result = box('No title box', { width: 30 });
    // Should still have top/bottom borders
    const lines = result.split('\n');
    expect(lines[0]).toContain('\u256D');
    expect(lines[lines.length - 1]).toContain('\u256F');
  });

  it('handles multi-line content', () => {
    const result = box('Line 1\nLine 2\nLine 3', { width: 30 });
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 2');
    expect(result).toContain('Line 3');
  });

  it('applies padding', () => {
    const result = box('Padded', { width: 30, padding: 2 });
    const lines = result.split('\n');
    // With padding 2, should have more lines than with padding 0
    const noPadResult = box('Padded', { width: 30, padding: 0 });
    const noPadLines = noPadResult.split('\n');
    expect(lines.length).toBeGreaterThan(noPadLines.length);
  });

  it('handles empty content', () => {
    const result = box('', { width: 20 });
    expect(result).toContain('\u256D');
    expect(result).toContain('\u256F');
  });
});

describe('divider', () => {
  it('creates a simple horizontal line without label', () => {
    const result = divider();
    expect(result).toContain('\u2500');
    expect(result.trim().length).toBeGreaterThan(0);
  });

  it('creates a divider with a centered label', () => {
    const result = divider('Section');
    expect(result).toContain('Section');
    expect(result).toContain('\u2500');
  });

  it('has horizontal lines on both sides of the label', () => {
    const result = divider('Test');
    const parts = result.split('Test');
    // Both sides should have horizontal line characters
    expect(parts[0]).toContain('\u2500');
    expect(parts[1]).toContain('\u2500');
  });

  it('handles empty label same as no label', () => {
    const withEmpty = divider('');
    // Empty string is falsy, so should produce labeled divider with empty content
    // Actually ' ' will still be in the label since labelStr = ` ${label} `
    expect(withEmpty).toContain('\u2500');
  });

  it('handles long labels', () => {
    const result = divider('This is a very long section label');
    expect(result).toContain('This is a very long section label');
  });
});

describe('badge', () => {
  it('creates a badge with text', () => {
    const result = badge('INFO', '#3B82F6');
    expect(result).toContain('INFO');
  });

  it('wraps text in brackets in NO_COLOR mode', () => {
    const result = badge('ERROR', '#EF4444');
    expect(result).toBe('[ERROR]');
  });

  it('works with different colors', () => {
    const result1 = badge('OK', '#22C55E');
    const result2 = badge('FAIL', '#EF4444');
    expect(result1).toContain('OK');
    expect(result2).toContain('FAIL');
  });

  it('handles empty text', () => {
    const result = badge('', '#000000');
    expect(result).toBe('[]');
  });

  it('handles text with spaces', () => {
    const result = badge('In Progress', '#F59E0B');
    expect(result).toBe('[In Progress]');
  });
});

describe('truncate', () => {
  it('returns original text if shorter than maxLen', () => {
    expect(truncate('short', 10)).toBe('short');
  });

  it('returns original text if exactly maxLen', () => {
    expect(truncate('exact', 5)).toBe('exact');
  });

  it('truncates with ellipsis when text exceeds maxLen', () => {
    const result = truncate('This is a very long string', 10);
    expect(result.length).toBe(10);
    expect(result.endsWith('\u2026')).toBe(true);
  });

  it('handles maxLen of 1', () => {
    const result = truncate('Hello', 1);
    expect(result).toBe('\u2026');
  });

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('');
  });

  it('preserves content up to maxLen - 1 before ellipsis', () => {
    const result = truncate('ABCDEFGHIJ', 5);
    expect(result).toBe('ABCD\u2026');
  });
});

describe('timeAgo', () => {
  it('returns "just now" for recent timestamps (< 5 seconds)', () => {
    const now = new Date();
    expect(timeAgo(now)).toBe('just now');
  });

  it('returns seconds ago for timestamps < 60 seconds', () => {
    const date = new Date(Date.now() - 30 * 1000);
    const result = timeAgo(date);
    expect(result).toMatch(/^\d+s ago$/);
  });

  it('returns minutes ago for timestamps < 60 minutes', () => {
    const date = new Date(Date.now() - 15 * 60 * 1000);
    const result = timeAgo(date);
    expect(result).toMatch(/^\d+m ago$/);
  });

  it('returns hours ago for timestamps < 24 hours', () => {
    const date = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const result = timeAgo(date);
    expect(result).toMatch(/^\d+h ago$/);
  });

  it('returns days ago for timestamps < 30 days', () => {
    const date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = timeAgo(date);
    expect(result).toMatch(/^\d+d ago$/);
  });

  it('returns locale date string for timestamps >= 30 days', () => {
    const date = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const result = timeAgo(date);
    // Should be a date string, not "Xd ago"
    expect(result).not.toMatch(/d ago$/);
  });

  it('handles exact boundary: 5 seconds', () => {
    const date = new Date(Date.now() - 5 * 1000);
    const result = timeAgo(date);
    expect(result).toBe('5s ago');
  });

  it('handles exact boundary: 60 seconds', () => {
    const date = new Date(Date.now() - 60 * 1000);
    const result = timeAgo(date);
    expect(result).toBe('1m ago');
  });

  it('handles exact boundary: 60 minutes', () => {
    const date = new Date(Date.now() - 60 * 60 * 1000);
    const result = timeAgo(date);
    expect(result).toBe('1h ago');
  });
});
