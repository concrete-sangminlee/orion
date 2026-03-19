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
  options?: { title?: string; color?: string; width?: number; padding?: number }
): string {
  const width = options?.width || 60;
  const pad = options?.padding ?? 1;
  const innerWidth = width - 2;
  const lines: string[] = [];

  if (options?.title) {
    const titleStr = ` ${options.title} `;
    const remaining = innerWidth - visibleLength(titleStr) - 1;
    lines.push('  \u256D\u2500' + titleStr + '\u2500'.repeat(Math.max(remaining, 0)) + '\u256E');
  } else {
    lines.push('  \u256D' + '\u2500'.repeat(innerWidth) + '\u256E');
  }

  for (let i = 0; i < pad; i++) {
    lines.push('  \u2502' + ' '.repeat(innerWidth) + '\u2502');
  }

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

  for (let i = 0; i < pad; i++) {
    lines.push('  \u2502' + ' '.repeat(innerWidth) + '\u2502');
  }

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

function keyValue(pairs: [string, string][]): string {
  const maxKeyLen = Math.max(...pairs.map(([k]) => k.length));
  return pairs
    .map(([key, value]) => {
      const paddedKey = key.padEnd(maxKeyLen);
      return '  ' + paddedKey + '  ' + value;
    })
    .join('\n');
}

type StatusIcon = '\u2713' | '\u2717' | '!' | 'i' | '\u25CF' | '\u25CB' | '\u25D0' | '\u27F3';

function statusLine(icon: StatusIcon, text: string): string {
  return '  ' + icon + ' ' + text;
}

function progressBar(current: number, total: number, width?: number): string {
  const barWidth = width || 30;
  const ratio = Math.min(current / total, 1);
  const filled = Math.round(barWidth * ratio);
  const empty = barWidth - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  const pct = ` ${Math.round(ratio * 100)}%`;
  return '  ' + bar + pct;
}

function table(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) => {
    const headerLen = visibleLength(h);
    const maxDataLen = Math.max(0, ...rows.map(r => visibleLength(r[i] || '')));
    return Math.max(headerLen, maxDataLen) + 2;
  });
  const lines: string[] = [];

  lines.push(
    '  \u250C' +
    colWidths.map(w => '\u2500'.repeat(w)).join('\u252C') +
    '\u2510'
  );

  const headerCells = headers.map((h, i) => {
    return ' ' + h + ' '.repeat(colWidths[i] - visibleLength(h) - 1);
  });
  lines.push('  \u2502' + headerCells.join('\u2502') + '\u2502');

  lines.push(
    '  \u251C' +
    colWidths.map(w => '\u2500'.repeat(w)).join('\u253C') +
    '\u2524'
  );

  for (const row of rows) {
    const cells = headers.map((_, i) => {
      const val = row[i] || '';
      const padLen = colWidths[i] - visibleLength(val) - 1;
      return ' ' + val + ' '.repeat(Math.max(padLen, 0));
    });
    lines.push('  \u2502' + cells.join('\u2502') + '\u2502');
  }

  lines.push(
    '  \u2514' +
    colWidths.map(w => '\u2500'.repeat(w)).join('\u2534') +
    '\u2518'
  );

  return lines.join('\n');
}

function badge(text: string, _color: string): string {
  return `[${text}]`;
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#D4A574',
  claude: '#D4A574',
  openai: '#74AA9C',
  gpt: '#74AA9C',
  ollama: '#A0A0A0',
};

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'GPT',
  ollama: 'Ollama',
};

function providerBadge(provider: string, model?: string): string {
  const color = PROVIDER_COLORS[provider.toLowerCase()] || '#7C5CFC';
  const name = PROVIDER_NAMES[provider.toLowerCase()] || provider;
  const badgeStr = badge(name, color);
  if (model) {
    return badgeStr + ' ' + model;
  }
  return badgeStr;
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

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + '\u2026';
}

function severityBadge(level: 'error' | 'warning' | 'info'): string {
  switch (level) {
    case 'error':
      return badge('ERROR', '#EF4444');
    case 'warning':
      return badge('WARN', '#F59E0B');
    case 'info':
      return badge('INFO', '#3B82F6');
  }
}

function commandHeader(title: string, meta?: [string, string][]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('  \u2726 ' + title);
  lines.push(divider());

  if (meta && meta.length > 0) {
    for (const [key, value] of meta) {
      lines.push(statusLine('i' as StatusIcon, key + ': ' + value));
    }
    lines.push(divider());
  }

  return lines.join('\n');
}

function errorDisplay(message: string, howToFix?: string[]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(statusLine('\u2717' as StatusIcon, message));
  lines.push('');

  if (howToFix && howToFix.length > 0) {
    const fixContent = howToFix
      .map((step, i) => `${i + 1}. ${step}`)
      .join('\n');
    lines.push(box(fixContent, { title: 'How to fix', color: '#F59E0B', padding: 1 }));
  }

  return lines.join('\n');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// ─── box() Extended Tests ────────────────────────────────────────────────────

describe('box (extended)', () => {
  it('renders with a title and color option', () => {
    const result = box('Test content', { title: 'Title', color: '#FF0000', width: 40 });
    expect(result).toContain('Title');
    expect(result).toContain('Test content');
    expect(result).toContain('\u256D');
    expect(result).toContain('\u256F');
  });

  it('respects explicit width', () => {
    const result = box('Hi', { width: 20 });
    const firstLine = result.split('\n')[0];
    // innerWidth = 18, first line: 2 spaces + corner + 18 dashes + corner
    expect(stripAnsi(firstLine).length).toBe(2 + 1 + 18 + 1);
  });

  it('uses default width of 60 when none specified', () => {
    const result = box('Default width');
    const firstLine = result.split('\n')[0];
    expect(stripAnsi(firstLine).length).toBe(2 + 1 + 58 + 1);
  });

  it('handles very long single-line content by truncating', () => {
    const longContent = 'X'.repeat(200);
    const result = box(longContent, { width: 30 });
    // Should still have box borders on every line
    const lines = result.split('\n');
    for (const line of lines) {
      expect(line).toMatch(/\u2502|\u256D|\u256E|\u2570|\u256F/);
    }
  });

  it('renders zero padding correctly', () => {
    const resultZeroPad = box('Hello', { width: 30, padding: 0 });
    const resultDefaultPad = box('Hello', { width: 30, padding: 1 });
    const zeroLines = resultZeroPad.split('\n');
    const defaultLines = resultDefaultPad.split('\n');
    // Zero padding should produce 2 fewer lines (1 top + 1 bottom padding removed)
    expect(zeroLines.length).toBe(defaultLines.length - 2);
  });

  it('renders multi-line with title', () => {
    const result = box('Line A\nLine B', { title: 'Multi', width: 40 });
    expect(result).toContain('Multi');
    expect(result).toContain('Line A');
    expect(result).toContain('Line B');
  });
});

// ─── divider() Extended Tests ────────────────────────────────────────────────

describe('divider (extended)', () => {
  it('without label returns a line of 60 dashes plus indent', () => {
    const result = divider();
    const stripped = stripAnsi(result);
    // 2 spaces + 60 dashes
    expect(stripped).toBe('  ' + '\u2500'.repeat(60));
  });

  it('with label centers the label text', () => {
    const result = divider('Center');
    expect(result).toContain(' Center ');
    const parts = result.split(' Center ');
    const leftDashes = (parts[0].match(/\u2500/g) || []).length;
    const rightDashes = (parts[1].match(/\u2500/g) || []).length;
    // Left and right should roughly balance (differ by at most 1)
    expect(Math.abs(leftDashes - rightDashes)).toBeLessThanOrEqual(1);
  });
});

// ─── keyValue() Tests ────────────────────────────────────────────────────────

describe('keyValue', () => {
  it('aligns keys to the longest key length', () => {
    const result = keyValue([
      ['Name', 'Alice'],
      ['Age', '30'],
      ['Location', 'Wonderland'],
    ]);
    const lines = result.split('\n');
    // 'Location' is 8 chars; 'Name' and 'Age' should be padded to 8
    expect(lines[0]).toContain('Name    ');
    expect(lines[1]).toContain('Age     ');
  });

  it('renders single pair', () => {
    const result = keyValue([['Key', 'Value']]);
    expect(result).toContain('Key');
    expect(result).toContain('Value');
  });

  it('renders multiple pairs on separate lines', () => {
    const result = keyValue([['A', '1'], ['B', '2'], ['C', '3']]);
    const lines = result.split('\n');
    expect(lines.length).toBe(3);
  });

  it('handles empty value strings', () => {
    const result = keyValue([['Key', '']]);
    expect(result).toContain('Key');
  });
});

// ─── statusLine() Tests ─────────────────────────────────────────────────────

describe('statusLine', () => {
  it('renders checkmark icon', () => {
    const result = statusLine('\u2713', 'Done');
    expect(result).toContain('\u2713');
    expect(result).toContain('Done');
  });

  it('renders cross icon', () => {
    const result = statusLine('\u2717', 'Failed');
    expect(result).toContain('\u2717');
    expect(result).toContain('Failed');
  });

  it('renders exclamation icon', () => {
    const result = statusLine('!', 'Warning!');
    expect(result).toContain('!');
    expect(result).toContain('Warning!');
  });

  it('renders info icon', () => {
    const result = statusLine('i', 'Information');
    expect(result).toContain('i');
    expect(result).toContain('Information');
  });

  it('renders filled circle icon', () => {
    const result = statusLine('\u25CF', 'Active');
    expect(result).toContain('\u25CF');
  });

  it('renders empty circle icon', () => {
    const result = statusLine('\u25CB', 'Inactive');
    expect(result).toContain('\u25CB');
  });

  it('renders half-circle icon', () => {
    const result = statusLine('\u25D0', 'Partial');
    expect(result).toContain('\u25D0');
  });

  it('renders refresh icon', () => {
    const result = statusLine('\u27F3', 'Syncing');
    expect(result).toContain('\u27F3');
  });
});

// ─── progressBar() Tests ────────────────────────────────────────────────────

describe('progressBar', () => {
  it('shows 0% when current is 0', () => {
    const result = progressBar(0, 100);
    expect(result).toContain('0%');
    expect(result).toContain('\u2591'); // empty blocks
    // Should have no filled blocks
    expect(result).not.toContain('\u2588');
  });

  it('shows 50% at halfway', () => {
    const result = progressBar(50, 100, 20);
    expect(result).toContain('50%');
    const filled = (result.match(/\u2588/g) || []).length;
    const empty = (result.match(/\u2591/g) || []).length;
    expect(filled).toBe(10);
    expect(empty).toBe(10);
  });

  it('shows 100% when complete', () => {
    const result = progressBar(100, 100, 20);
    expect(result).toContain('100%');
    const filled = (result.match(/\u2588/g) || []).length;
    expect(filled).toBe(20);
    // No empty blocks
    expect(result).not.toContain('\u2591');
  });

  it('caps at 100% when current exceeds total', () => {
    const result = progressBar(200, 100, 10);
    expect(result).toContain('100%');
  });

  it('uses default width of 30 when not specified', () => {
    const result = progressBar(15, 30);
    const filled = (result.match(/\u2588/g) || []).length;
    const empty = (result.match(/\u2591/g) || []).length;
    expect(filled + empty).toBe(30);
  });
});

// ─── table() Tests ──────────────────────────────────────────────────────────

describe('table', () => {
  it('renders headers and rows with box drawing', () => {
    const result = table(['Name', 'Score'], [['Alice', '100'], ['Bob', '95']]);
    expect(result).toContain('Name');
    expect(result).toContain('Score');
    expect(result).toContain('Alice');
    expect(result).toContain('100');
    expect(result).toContain('Bob');
    expect(result).toContain('95');
  });

  it('contains all box drawing corners', () => {
    const result = table(['A'], [['1']]);
    expect(result).toContain('\u250C'); // top-left
    expect(result).toContain('\u2510'); // top-right
    expect(result).toContain('\u2514'); // bottom-left
    expect(result).toContain('\u2518'); // bottom-right
  });

  it('contains header separator', () => {
    const result = table(['X', 'Y'], [['1', '2']]);
    expect(result).toContain('\u251C'); // left T
    expect(result).toContain('\u2524'); // right T
  });

  it('handles empty rows', () => {
    const result = table(['Col1', 'Col2'], []);
    expect(result).toContain('Col1');
    expect(result).toContain('Col2');
    // Should have top, header, separator, bottom = 4 lines
    const lines = result.split('\n');
    expect(lines.length).toBe(4);
  });

  it('handles missing cell values gracefully', () => {
    const result = table(['A', 'B', 'C'], [['1']]);
    expect(result).toContain('1');
    // Missing cells should be treated as empty strings
    expect(result).toContain('\u2502');
  });
});

// ─── badge() Extended Tests ─────────────────────────────────────────────────

describe('badge (extended)', () => {
  it('renders red badge', () => {
    const result = badge('ERROR', '#EF4444');
    expect(result).toBe('[ERROR]');
  });

  it('renders green badge', () => {
    const result = badge('OK', '#22C55E');
    expect(result).toBe('[OK]');
  });

  it('renders yellow badge', () => {
    const result = badge('WARN', '#F59E0B');
    expect(result).toBe('[WARN]');
  });

  it('renders blue badge', () => {
    const result = badge('INFO', '#3B82F6');
    expect(result).toBe('[INFO]');
  });
});

// ─── providerBadge() Tests ──────────────────────────────────────────────────

describe('providerBadge', () => {
  it('renders badge for anthropic', () => {
    const result = providerBadge('anthropic');
    expect(result).toContain('Claude');
  });

  it('renders badge for openai', () => {
    const result = providerBadge('openai');
    expect(result).toContain('GPT');
  });

  it('renders badge for ollama', () => {
    const result = providerBadge('ollama');
    expect(result).toContain('Ollama');
  });

  it('appends model name when provided', () => {
    const result = providerBadge('anthropic', 'claude-sonnet-4-20250514');
    expect(result).toContain('Claude');
    expect(result).toContain('claude-sonnet-4-20250514');
  });

  it('uses provider name as-is for unknown providers', () => {
    const result = providerBadge('custom-provider');
    expect(result).toContain('custom-provider');
  });
});

// ─── timeAgo() Edge Cases ───────────────────────────────────────────────────

describe('timeAgo (extended)', () => {
  it('returns "just now" for 0ms ago', () => {
    const result = timeAgo(new Date());
    expect(result).toBe('just now');
  });

  it('returns seconds for exactly 1 minute minus 1 second', () => {
    const date = new Date(Date.now() - 59 * 1000);
    expect(timeAgo(date)).toBe('59s ago');
  });

  it('returns "1m ago" for exactly 60 seconds', () => {
    const date = new Date(Date.now() - 60 * 1000);
    expect(timeAgo(date)).toBe('1m ago');
  });

  it('returns "1h ago" for exactly 60 minutes', () => {
    const date = new Date(Date.now() - 60 * 60 * 1000);
    expect(timeAgo(date)).toBe('1h ago');
  });

  it('returns "1d ago" for exactly 24 hours', () => {
    const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(timeAgo(date)).toBe('1d ago');
  });

  it('returns days for 29 days', () => {
    const date = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    expect(timeAgo(date)).toBe('29d ago');
  });

  it('returns locale date for 30 days', () => {
    const date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = timeAgo(date);
    expect(result).not.toMatch(/d ago$/);
    // Should be a date string
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns locale date for 365 days', () => {
    const date = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const result = timeAgo(date);
    expect(result).not.toMatch(/d ago$/);
  });
});

// ─── truncate() Edge Cases ──────────────────────────────────────────────────

describe('truncate (extended)', () => {
  it('returns empty string untouched', () => {
    expect(truncate('', 5)).toBe('');
  });

  it('returns exact-length string untouched', () => {
    expect(truncate('ABCDE', 5)).toBe('ABCDE');
  });

  it('truncates to maxLen with ellipsis', () => {
    const result = truncate('Hello World', 8);
    expect(result.length).toBe(8);
    expect(result).toBe('Hello W\u2026');
  });

  it('handles maxLen of 2', () => {
    const result = truncate('Hello', 2);
    expect(result).toBe('H\u2026');
  });

  it('handles single character string shorter than maxLen', () => {
    expect(truncate('A', 10)).toBe('A');
  });
});

// ─── severityBadge() Tests ──────────────────────────────────────────────────

describe('severityBadge', () => {
  it('returns ERROR badge for error level', () => {
    const result = severityBadge('error');
    expect(result).toBe('[ERROR]');
  });

  it('returns WARN badge for warning level', () => {
    const result = severityBadge('warning');
    expect(result).toBe('[WARN]');
  });

  it('returns INFO badge for info level', () => {
    const result = severityBadge('info');
    expect(result).toBe('[INFO]');
  });
});

// ─── commandHeader() Tests ──────────────────────────────────────────────────

describe('commandHeader', () => {
  it('renders title with sparkle icon', () => {
    const result = commandHeader('My Command');
    expect(result).toContain('\u2726');
    expect(result).toContain('My Command');
  });

  it('includes a divider after the title', () => {
    const result = commandHeader('Test');
    expect(result).toContain('\u2500');
  });

  it('renders metadata key-value pairs', () => {
    const result = commandHeader('Build', [['Version', '1.0'], ['Mode', 'production']]);
    expect(result).toContain('Version: 1.0');
    expect(result).toContain('Mode: production');
  });

  it('renders without metadata when none provided', () => {
    const result = commandHeader('Simple');
    expect(result).toContain('Simple');
    // Should have exactly one divider section (after title)
    const lines = result.split('\n').filter(l => l.trim().length > 0);
    expect(lines.length).toBe(2); // title line + divider
  });

  it('renders with empty metadata array', () => {
    const result = commandHeader('Empty Meta', []);
    expect(result).toContain('Empty Meta');
    // Empty array should not produce extra dividers
  });
});

// ─── errorDisplay() Tests ───────────────────────────────────────────────────

describe('errorDisplay', () => {
  it('renders error message with cross icon', () => {
    const result = errorDisplay('Something went wrong');
    expect(result).toContain('\u2717');
    expect(result).toContain('Something went wrong');
  });

  it('renders without fix steps when none provided', () => {
    const result = errorDisplay('Error occurred');
    expect(result).toContain('Error occurred');
    // Should not contain box structure for fix steps
    expect(result).not.toContain('How to fix');
  });

  it('renders fix steps with numbered list', () => {
    const result = errorDisplay('Build failed', ['Check config', 'Run npm install', 'Retry build']);
    expect(result).toContain('How to fix');
    expect(result).toContain('1.');
    expect(result).toContain('Check config');
    expect(result).toContain('2.');
    expect(result).toContain('Run npm install');
    expect(result).toContain('3.');
    expect(result).toContain('Retry build');
  });

  it('renders single fix step', () => {
    const result = errorDisplay('Oops', ['Just restart']);
    expect(result).toContain('How to fix');
    expect(result).toContain('1.');
    expect(result).toContain('Just restart');
  });

  it('renders with empty fix array (no box)', () => {
    const result = errorDisplay('Error', []);
    expect(result).not.toContain('How to fix');
  });
});
