/**
 * Orion CLI - Premium UI Component System
 * Reusable, beautiful terminal components inspired by cmux, Warp, and Claude Code.
 * Uses Unicode box-drawing characters, gradient colors, and responsive sizing.
 */

import chalk from 'chalk';

// ─── Color Palette ──────────────────────────────────────────────────────────

const noColor = !!process.env.NO_COLOR;

function c(hex: string) {
  return noColor ? chalk.reset : chalk.hex(hex);
}

export const palette = {
  purple: c('#9B59B6'),
  violet: c('#7C5CFC'),
  blue: c('#38BDF8'),
  green: c('#22C55E'),
  red: c('#EF4444'),
  yellow: c('#F59E0B'),
  orange: c('#D4A574'),
  teal: c('#74AA9C'),
  dim: noColor ? chalk.reset : chalk.dim,
  bold: chalk.bold,
  white: chalk.white,
};

// ─── Terminal Width ─────────────────────────────────────────────────────────

function getWidth(): number {
  return Math.min(process.stdout.columns || 80, 100);
}

// ─── String Width Helper (strip ANSI) ───────────────────────────────────────

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

// ─── Box with Rounded Corners ───────────────────────────────────────────────

export function box(
  content: string,
  options?: { title?: string; color?: string; width?: number; padding?: number }
): string {
  const color = options?.color ? c(options.color) : palette.dim;
  const width = options?.width || Math.min(getWidth() - 4, 60);
  const pad = options?.padding ?? 1;
  const innerWidth = width - 2;

  const lines: string[] = [];

  // Top border
  if (options?.title) {
    const titleStr = ` ${options.title} `;
    const remaining = innerWidth - visibleLength(titleStr) - 1;
    lines.push('  ' + color('\u256D\u2500') + color(titleStr) + color('\u2500'.repeat(Math.max(remaining, 0))) + color('\u256E'));
  } else {
    lines.push('  ' + color('\u256D' + '\u2500'.repeat(innerWidth) + '\u256E'));
  }

  // Top padding
  for (let i = 0; i < pad; i++) {
    lines.push('  ' + color('\u2502') + ' '.repeat(innerWidth) + color('\u2502'));
  }

  // Content lines
  const contentLines = content.split('\n');
  for (const line of contentLines) {
    const stripped = stripAnsi(line);
    const usedWidth = stripped.length;
    const rightPad = innerWidth - usedWidth - 2;
    if (rightPad >= 0) {
      lines.push('  ' + color('\u2502') + ' ' + line + ' '.repeat(rightPad) + ' ' + color('\u2502'));
    } else {
      // Truncate if too long
      lines.push('  ' + color('\u2502') + ' ' + line.substring(0, innerWidth - 2) + ' ' + color('\u2502'));
    }
  }

  // Bottom padding
  for (let i = 0; i < pad; i++) {
    lines.push('  ' + color('\u2502') + ' '.repeat(innerWidth) + color('\u2502'));
  }

  // Bottom border
  lines.push('  ' + color('\u2570' + '\u2500'.repeat(innerWidth) + '\u256F'));

  return lines.join('\n');
}

// ─── Horizontal Divider ─────────────────────────────────────────────────────

export function divider(label?: string): string {
  const width = Math.min(getWidth() - 4, 60);
  if (label) {
    const labelStr = ` ${label} `;
    const remaining = width - visibleLength(labelStr);
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    return '  ' + palette.dim('\u2500'.repeat(left) + labelStr + '\u2500'.repeat(right));
  }
  return '  ' + palette.dim('\u2500'.repeat(width));
}

// ─── Key-Value Display ──────────────────────────────────────────────────────

export function keyValue(pairs: [string, string][]): string {
  const maxKeyLen = Math.max(...pairs.map(([k]) => k.length));
  return pairs
    .map(([key, value]) => {
      const paddedKey = key.padEnd(maxKeyLen);
      return '  ' + palette.violet(paddedKey) + '  ' + value;
    })
    .join('\n');
}

// ─── Status Line with Icon ──────────────────────────────────────────────────

type StatusIcon = '\u2713' | '\u2717' | '!' | 'i' | '\u25CF' | '\u25CB' | '\u25D0' | '\u27F3';

const ICON_COLORS: Record<string, (s: string) => string> = {
  '\u2713': palette.green,
  '\u2717': palette.red,
  '!': palette.yellow,
  'i': palette.blue,
  '\u25CF': palette.green,
  '\u25CB': palette.dim,
  '\u25D0': palette.yellow,
  '\u27F3': palette.blue,
};

export function statusLine(icon: StatusIcon, text: string, color?: string): string {
  const iconColor = color ? c(color) : (ICON_COLORS[icon] || palette.dim);
  return '  ' + iconColor(icon) + ' ' + text;
}

// ─── Progress Bar ───────────────────────────────────────────────────────────

export function progressBar(current: number, total: number, width?: number): string {
  const barWidth = width || 30;
  const ratio = Math.min(current / total, 1);
  const filled = Math.round(barWidth * ratio);
  const empty = barWidth - filled;

  const bar = palette.violet('\u2588'.repeat(filled)) + palette.dim('\u2591'.repeat(empty));
  const pct = palette.dim(` ${Math.round(ratio * 100)}%`);

  return '  ' + bar + pct;
}

// ─── Table with Box Drawing ─────────────────────────────────────────────────

export function table(headers: string[], rows: string[][]): string {
  // Calculate column widths
  const colWidths = headers.map((h, i) => {
    const headerLen = visibleLength(h);
    const maxDataLen = Math.max(0, ...rows.map(r => visibleLength(r[i] || '')));
    return Math.max(headerLen, maxDataLen) + 2;
  });

  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + colWidths.length + 1;
  const lines: string[] = [];

  // Top border
  lines.push(
    '  ' + palette.dim('\u250C') +
    colWidths.map(w => palette.dim('\u2500'.repeat(w))).join(palette.dim('\u252C')) +
    palette.dim('\u2510')
  );

  // Header row
  const headerCells = headers.map((h, i) => {
    const padded = ' ' + h + ' '.repeat(colWidths[i] - visibleLength(h) - 1);
    return palette.violet.bold(padded);
  });
  lines.push('  ' + palette.dim('\u2502') + headerCells.join(palette.dim('\u2502')) + palette.dim('\u2502'));

  // Header separator
  lines.push(
    '  ' + palette.dim('\u251C') +
    colWidths.map(w => palette.dim('\u2500'.repeat(w))).join(palette.dim('\u253C')) +
    palette.dim('\u2524')
  );

  // Data rows
  for (const row of rows) {
    const cells = headers.map((_, i) => {
      const val = row[i] || '';
      const padLen = colWidths[i] - visibleLength(val) - 1;
      return ' ' + val + ' '.repeat(Math.max(padLen, 0));
    });
    lines.push('  ' + palette.dim('\u2502') + cells.join(palette.dim('\u2502')) + palette.dim('\u2502'));
  }

  // Bottom border
  lines.push(
    '  ' + palette.dim('\u2514') +
    colWidths.map(w => palette.dim('\u2500'.repeat(w))).join(palette.dim('\u2534')) +
    palette.dim('\u2518')
  );

  return lines.join('\n');
}

// ─── Badge / Pill ───────────────────────────────────────────────────────────

export function badge(text: string, color: string): string {
  if (noColor) return `[${text}]`;
  return chalk.bgHex(color).black.bold(` ${text} `);
}

// ─── Diff Block ─────────────────────────────────────────────────────────────

export function diffBlock(original: string, modified: string, filename?: string): string {
  const origLines = original.split(/\r?\n/);
  const modLines = modified.split(/\r?\n/);
  const lines: string[] = [];

  // Header
  if (filename) {
    lines.push(divider(filename));
  } else {
    lines.push(divider('Changes'));
  }
  lines.push('');

  const maxLines = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLines; i++) {
    const origLine = origLines[i];
    const modLine = modLines[i];

    if (origLine === undefined && modLine !== undefined) {
      lines.push('  ' + palette.green('+ ' + modLine));
    } else if (origLine !== undefined && modLine === undefined) {
      lines.push('  ' + palette.red('- ' + origLine));
    } else if (origLine !== modLine) {
      lines.push('  ' + palette.red('- ' + origLine));
      lines.push('  ' + palette.green('+ ' + modLine));
    } else {
      lines.push('  ' + palette.dim('  ' + origLine));
    }
  }

  lines.push('');
  lines.push(divider());

  return lines.join('\n');
}

// ─── Provider Badge ─────────────────────────────────────────────────────────

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

export function providerBadge(provider: string, model?: string): string {
  const color = PROVIDER_COLORS[provider.toLowerCase()] || '#7C5CFC';
  const name = PROVIDER_NAMES[provider.toLowerCase()] || provider;
  const badgeStr = badge(name, color);

  if (model) {
    return badgeStr + ' ' + palette.dim(model);
  }
  return badgeStr;
}

// ─── Relative Time ──────────────────────────────────────────────────────────

export function timeAgo(date: Date): string {
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

// ─── Truncate ───────────────────────────────────────────────────────────────

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + '\u2026';
}

// ─── Severity Badge ─────────────────────────────────────────────────────────

export function severityBadge(level: 'error' | 'warning' | 'info'): string {
  switch (level) {
    case 'error':
      return badge('ERROR', '#EF4444');
    case 'warning':
      return badge('WARN', '#F59E0B');
    case 'info':
      return badge('INFO', '#3B82F6');
  }
}

// ─── Command Header ─────────────────────────────────────────────────────────

export function commandHeader(title: string, meta?: [string, string][]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('  ' + palette.purple('\u2726') + ' ' + palette.violet.bold(title));
  lines.push(divider());

  if (meta && meta.length > 0) {
    for (const [key, value] of meta) {
      lines.push(statusLine('i' as StatusIcon, palette.dim(key + ': ') + value));
    }
    lines.push(divider());
  }

  return lines.join('\n');
}

// ─── Error Display ──────────────────────────────────────────────────────────

export function errorDisplay(message: string, howToFix?: string[]): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(statusLine('\u2717' as StatusIcon, palette.red.bold(message)));
  lines.push('');

  if (howToFix && howToFix.length > 0) {
    const fixContent = howToFix
      .map((step, i) => `${palette.dim((i + 1) + '.')} ${step}`)
      .join('\n');
    lines.push(box(fixContent, { title: 'How to fix', color: '#F59E0B', padding: 1 }));
  }

  return lines.join('\n');
}

// ─── Provider Status List ───────────────────────────────────────────────────

export function providerStatusList(
  providers: Array<{ name: string; provider: string; model: string; available: boolean; active?: boolean; reason?: string }>
): string {
  const lines: string[] = [];

  for (const p of providers) {
    const icon = p.available ? '\u25CF' : '\u25CB';
    const iconColor = p.available ? palette.green : palette.red;
    const nameStr = p.available
      ? palette.white(p.name.padEnd(10))
      : palette.dim(p.name.padEnd(10));
    const modelStr = p.available
      ? palette.dim(p.model.padEnd(22))
      : palette.dim((p.reason || 'unavailable').padEnd(22));
    const statusStr = p.available ? palette.green('ready') : palette.red('offline');
    const activeStr = p.active ? palette.yellow(' \u25C0') : '';

    lines.push('  ' + iconColor(icon) + ' ' + nameStr + modelStr + statusStr + activeStr);
  }

  return lines.join('\n');
}

// ─── Chat Message Box (User) ────────────────────────────────────────────────

export function userMessageBox(text: string): string {
  return box(text, { title: 'You', color: '#38BDF8', padding: 0 });
}

// ─── AI Response Header ────────────────────────────────────────────────────

export function aiResponseHeader(provider: string, model: string, timestamp?: Date): string {
  const name = PROVIDER_NAMES[provider.toLowerCase()] || provider;
  const color = PROVIDER_COLORS[provider.toLowerCase()] || '#7C5CFC';
  const nameStr = c(color).bold(name);
  const modelStr = palette.dim(model);
  const timeStr = timestamp ? palette.dim(' \u00B7 ' + timeAgo(timestamp)) : '';
  const line = palette.dim('\u2500'.repeat(Math.min(getWidth() - 4, 60)));

  return `  ${nameStr}  ${modelStr}${timeStr}\n  ${line}`;
}

// ─── Token Count Footer ────────────────────────────────────────────────────

export function tokenCountFooter(tokens: number): string {
  return '  ' + palette.dim(`~${tokens} tokens`);
}
